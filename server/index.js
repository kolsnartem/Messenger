const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const multer = require('multer');
const path = require('path');

const app = express();
const options = {
  key: fs.readFileSync('./certs/key.pem'),
  cert: fs.readFileSync('./certs/cert.pem')
};
const server = https.createServer(options, app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 5000,
  pingInterval: 10000
});

app.use(cors());
app.use(express.json());

// Створюємо папку uploads, якщо її не існує
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Налаштування доступу до статичних файлів
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Налаштування multer для завантаження файлів
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({ storage: storage });

// ANSI-коди для кольорів
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

const db = new sqlite3.Database('./messenger.db', (err) => {
  if (err) console.error('SQLite connection error:', err);
  console.log('Connected to SQLite database');
});

// Оновлюємо схему бази даних, якщо необхідно
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    publicKey TEXT
  )`);
  
  // Перевіряємо, чи існують нові стовпці у таблиці messages
  db.all("PRAGMA table_info(messages)", (err, rows) => {
    if (err) {
      console.error('Error checking table schema:', err);
      return;
    }
    
    // Якщо таблиця вже містить нові стовпці, пропускаємо
    if (rows && rows.some(row => row.name === 'content')) {
      console.log('Database schema is up to date');
    } else {
      // Перейменовуємо стару таблицю
      db.run("ALTER TABLE messages RENAME TO messages_old", (err) => {
        if (err) {
          console.error('Error renaming table:', err);
          return;
        }
        
        // Створюємо нову таблицю з оновленою схемою
        db.run(`CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          contactId TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          isRead INTEGER DEFAULT 0,
          isP2P INTEGER DEFAULT 0
        )`, (err) => {
          if (err) {
            console.error('Error creating new table:', err);
            return;
          }
          
          // Переносимо дані зі старої таблиці в нову
          db.run(`INSERT INTO messages (id, userId, contactId, content, type, timestamp, isRead, isP2P)
                  SELECT id, userId, contactId, text, 'text', timestamp, isRead, isP2P
                  FROM messages_old`, (err) => {
            if (err) {
              console.error('Error migrating data:', err);
            } else {
              console.log('Database schema updated successfully');
              
              // Видаляємо стару таблицю після успішної міграції
              db.run("DROP TABLE messages_old", (err) => {
                if (err) console.error('Error dropping old table:', err);
              });
            }
          });
        });
      });
    }
  });
  
      db.run(`CREATE TABLE IF NOT EXISTS deleted_messages_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    message_content TEXT NOT NULL,
    message_type TEXT NOT NULL,
    deleted_at INTEGER NOT NULL
  )`);
});

const users = new Map();

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  if (!userId) return socket.disconnect();
  users.set(userId, socket.id);
  console.log(`New Socket.IO connection for user: ${userId}, total users: ${users.size}`);

  // Надсилаємо всі тимчасово збережені непрочитані повідомлення при підключенні
  db.all(
    `SELECT id, userId, contactId, content, type, timestamp, isRead, isP2P 
     FROM messages 
     WHERE contactId = ? AND isRead = 0 
     ORDER BY timestamp`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching unread messages:', err);
        return;
      }
      rows.forEach((msg) => {
        // Додаємо text для зворотної сумісності
        const compatibleMsg = { ...msg, text: msg.content };
        socket.emit('message', compatibleMsg);
      });
      console.log(`${colors.yellow}Sent ${rows.length} unread messages to user ${userId}${colors.reset}`);
    }
  );

  socket.on('message', (msg) => {
    // Обробляємо поля повідомлення для сумісності
    if (!msg) return;
    
    // Базова перевірка об'єкта повідомлення
    if (!msg.userId || !msg.contactId) {
      console.error('Invalid message format, missing userId or contactId');
      return;
    }
    
    // Встановлюємо значення за замовчуванням
    if (!msg.type) msg.type = 'text';
    
    // Обробляємо випадок, коли може бути text замість content (зворотна сумісність)
    if (msg.content === undefined && msg.text !== undefined) {
      msg.content = msg.text;
    } else if (msg.text === undefined && msg.content !== undefined) {
      msg.text = msg.content;
    } else if (msg.content === undefined && msg.text === undefined) {
      msg.content = '';
      msg.text = '';
    }
    
    const targetSocketId = users.get(msg.contactId);
    const senderSocketId = users.get(msg.userId);

    if (msg.isP2P) {
      if (targetSocketId) io.to(targetSocketId).emit('message', msg);
      return;
    }

    // Якщо отримувач онлайн, перенаправляємо без збереження
    if (targetSocketId) {
      io.to(targetSocketId).emit('message', msg);
      if (senderSocketId) io.to(senderSocketId).emit('message', msg); // Підтвердження відправнику
      console.log(`${colors.green}📩 ${msg.userId} → ${msg.contactId} (online, no save):${colors.reset} "${msg.content}" (type: ${msg.type})`);
    } else {
      // Якщо отримувач офлайн, зберігаємо тимчасово
      db.run(
        'INSERT INTO messages (id, userId, contactId, content, type, timestamp, isRead, isP2P) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [msg.id, msg.userId, msg.contactId, msg.content, msg.type, msg.timestamp, 0, msg.isP2P || 0],
        (err) => {
          if (err) {
            console.error('Failed to save message to DB:', err);
            return;
          }
          console.log(`${colors.green}📩 ${msg.userId} → ${msg.contactId} (offline, saved):${colors.reset} "${msg.content}" (type: ${msg.type})`);
        }
      );
    }
  });

  socket.on('p2p-offer', (data) => {
    const targetSocketId = users.get(data.target);
    const content = JSON.stringify({ type: 'offer', sdp: data.offer.sdp });
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('p2p-offer', { offer: data.offer, source: data.source });
      
      // Додаємо поле text для зворотної сумісності
      const p2pNotifyMsg = {
        id: `p2p-request-${Date.now()}`,
        userId: data.source,
        contactId: data.target,
        content: content,
        text: content,
        type: 'text',
        timestamp: Date.now(),
        isRead: 0,
        isP2P: true,
      };
      io.to(targetSocketId).emit('p2p-offer-notify', {
        message: p2pNotifyMsg
      });
    } else {
      const messageId = `p2p-offer-${Date.now()}`;
      const timestamp = Date.now();
      
      db.run(
        'INSERT INTO messages (id, userId, contactId, content, type, timestamp, isRead, isP2P) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [messageId, data.source, data.target, content, 'text', timestamp, 0, 1],
        (err) => {
          if (err) console.error('Failed to save P2P offer:', err);
        }
      );
    }
  });

  socket.on('p2p-answer', (data) => {
    const targetSocketId = users.get(data.target);
    if (targetSocketId) io.to(targetSocketId).emit('p2p-answer', { answer: data.answer, source: data.source });
  });

  socket.on('p2p-ice-candidate', (data) => {
    const targetSocketId = users.get(data.target);
    if (targetSocketId) io.to(targetSocketId).emit('p2p-ice-candidate', { candidate: data.candidate, source: data.source });
  });

  socket.on('p2p-offer-notify', (data) => {
    // Додаємо перевірку наявності повідомлення
    if (!data || !data.message) {
      console.error('Invalid p2p-offer-notify data format');
      return;
    }
    
    // Забезпечуємо сумісність полів
    if (data.message.content && !data.message.text) {
      data.message.text = data.message.content;
    } else if (data.message.text && !data.message.content) {
      data.message.content = data.message.text;
    }
    
    const targetSocketId = users.get(data.message.contactId);
    if (targetSocketId) io.to(targetSocketId).emit('p2p-offer-notify', { message: data.message });
  });

  socket.on('p2p-reject', (data) => {
    const targetSocketId = users.get(data.target);
    if (targetSocketId) io.to(targetSocketId).emit('p2p-reject', { source: data.source });
  });

  socket.on('call-offer', (data) => {
    const targetSocketId = users.get(data.target);
    if (targetSocketId) io.to(targetSocketId).emit('call-offer', { offer: data.offer, source: data.source });
  });

  socket.on('call-answer', (data) => {
    const targetSocketId = users.get(data.target);
    if (targetSocketId) io.to(targetSocketId).emit('call-answer', { answer: data.answer });
  });

  socket.on('ice-candidate', (data) => {
    const targetSocketId = users.get(data.target);
    if (targetSocketId) io.to(targetSocketId).emit('ice-candidate', { candidate: data.candidate });
  });

  socket.on('call-ended', (data) => {
    const targetSocketId = users.get(data.target);
    if (targetSocketId) io.to(targetSocketId).emit('call-ended');
  });

  socket.on('disconnect', () => {
    users.delete(userId);
    console.log(`User disconnected: ${userId}, remaining users: ${users.size}`);
  });
});

app.post('/register', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT email FROM users WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (row) return res.status(400).json({ error: 'User already exists' });
    db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, password], function(err) {
      if (err) return res.status(500).json({ error: 'Registration failed' });
      res.json({ id: this.lastID.toString() });
    });
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT id FROM users WHERE email = ? AND password = ?', [email, password], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ id: row.id.toString() });
  });
});

app.put('/update-keys', (req, res) => {
  const { userId, publicKey } = req.body;
  if (!publicKey || publicKey.length !== 44) return res.status(400).json({ error: 'Invalid public key format' });
  db.run('UPDATE users SET publicKey = ? WHERE id = ?', [publicKey, userId], (err) => {
    if (err) return res.status(500).json({ error: 'Update failed' });
    console.log(`${colors.cyan}🔑 ${userId}:${colors.reset} "${publicKey}"`);
    io.emit('key-updated', { userId, publicKey });
    res.json({ success: true });
  });
});

app.get('/users', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing userId' });
  db.get('SELECT id, email, publicKey FROM users WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json({ id: row.id.toString(), email: row.email, publicKey: row.publicKey || '' });
  });
});

app.get('/search', (req, res) => {
  const { query } = req.query;
  db.all('SELECT id, email, publicKey FROM users WHERE email LIKE ?', [`%${query}%`], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Search failed' });
    res.json(rows.map(row => ({ id: row.id.toString(), email: row.email, publicKey: row.publicKey || '' })));
  });
});

app.get('/chats', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  db.all(
    `SELECT DISTINCT u.id, u.email, u.publicKey 
     FROM users u
     INNER JOIN messages m 
     ON (u.id = m.userId OR u.id = m.contactId)
     WHERE (m.userId = ? OR m.contactId = ?) AND u.id != ?`,
    [userId, userId, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      const contacts = rows.map(row => ({ id: row.id.toString(), email: row.email, publicKey: row.publicKey || '' }));
      Promise.all(
        contacts.map(contact =>
          new Promise((resolve) => {
            db.get(
              `SELECT id, userId, contactId, content, type, timestamp, isRead 
               FROM messages 
               WHERE (userId = ? AND contactId = ?) OR (userId = ? AND contactId = ?) 
               ORDER BY timestamp DESC LIMIT 1`,
              [userId, contact.id, contact.id, userId],
              (err, msg) => {
                if (err) resolve({ ...contact, lastMessage: null });
                else {
                  // Додаємо поле text для зворотної сумісності
                  const lastMsg = msg ? { ...msg, text: msg.content } : null;
                  resolve({ ...contact, lastMessage: lastMsg });
                }
              }
            );
          })
        )
      ).then(results => {
        res.json(results.sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)));
      });
    }
  );
});

app.get('/messages', (req, res) => {
  const { userId, contactId } = req.query;
  db.all(
    `SELECT id, userId, contactId, content, type, timestamp, isRead, isP2P 
     FROM messages 
     WHERE (userId = ? AND contactId = ?) OR (userId = ? AND contactId = ?) 
     ORDER BY timestamp`,
    [userId, contactId, contactId, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      // Додаємо поле text для зворотної сумісності
      const compatibleRows = rows.map(row => ({...row, text: row.content}));
      res.json(compatibleRows);
    }
  );
});

app.post('/mark-as-read', (req, res) => {
  const { userId, contactId } = req.body;
  db.all(
    `SELECT id, userId, contactId, content, type FROM messages WHERE contactId = ? AND userId = ? AND isRead = 0`,
    [userId, contactId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      const messagesToDelete = rows;
      if (messagesToDelete.length === 0) return res.json({ success: true });

      // Видаляємо повідомлення після прочитання
      db.run(
        `DELETE FROM messages WHERE contactId = ? AND userId = ? AND isRead = 0`,
        [userId, contactId],
        (deleteErr) => {
          if (deleteErr) return res.status(500).json({ error: 'Database error' });
          messagesToDelete.forEach(msg => {
            const senderSocketId = users.get(contactId);
            if (senderSocketId) {
              io.to(senderSocketId).emit('message-read', { messageId: msg.id, contactId: userId });
            }
            console.log(`${colors.cyan}🗑️ Deleted after read: ${msg.userId} → ${msg.contactId}:${colors.reset} "${msg.content}" (type: ${msg.type})`);
          });
          res.json({ success: true });
        }
      );
    }
  );
});

// Роут для завантаження файлів
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const { userId, contactId } = req.body;
  if (!userId || !contactId) {
    return res.status(400).json({ error: 'Missing userId or contactId' });
  }

  const filePath = `/uploads/${req.file.filename}`;
  const fileType = req.file.mimetype.startsWith('image/') ? 'image' : 'file';
  const messageId = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
  const timestamp = Date.now();

  // Формуємо об'єкт повідомлення
  const message = {
    id: messageId,
    userId,
    contactId,
    content: filePath,
    text: filePath, // Додаємо поле text для зворотної сумісності
    type: fileType,
    timestamp,
    isRead: 0,
    isP2P: 0
  };

  // Перевіряємо, чи отримувач онлайн
  const targetSocketId = users.get(contactId);
  const senderSocketId = users.get(userId);

  if (targetSocketId) {
    // Якщо отримувач онлайн, надсилаємо йому повідомлення без збереження в БД
    io.to(targetSocketId).emit('message', message);
    if (senderSocketId) io.to(senderSocketId).emit('message', message); // Підтвердження відправнику
    console.log(`${colors.blue}📤 ${userId} → ${contactId} (online, file sent):${colors.reset} "${filePath}" (type: ${fileType})`);
    res.json({ success: true, message });
  } else {
    // Якщо отримувач офлайн, зберігаємо повідомлення в БД
    db.run(
      'INSERT INTO messages (id, userId, contactId, content, type, timestamp, isRead, isP2P) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [messageId, userId, contactId, filePath, fileType, timestamp, 0, 0],
      (err) => {
        if (err) {
          console.error('Failed to save file message to DB:', err);
          return res.status(500).json({ error: 'Failed to save message' });
        }
        console.log(`${colors.blue}📤 ${userId} → ${contactId} (offline, file saved):${colors.reset} "${filePath}" (type: ${fileType})`);
        if (senderSocketId) io.to(senderSocketId).emit('message', message); // Підтвердження відправнику
        res.json({ success: true, message });
      }
    );
  }
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) console.error('Error closing database:', err);
    console.log('Database connection closed');
    process.exit(0);
  });
});

const PORT = 4000;
server.listen(PORT, '100.64.221.88', () => {
  console.log(`Server running on https://100.64.221.88:${PORT}`);
});