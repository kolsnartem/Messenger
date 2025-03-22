const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const https = require('https');

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

// ANSI-коди для кольорів
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

const db = new sqlite3.Database('./messenger.db', (err) => {
  if (err) console.error('SQLite connection error:', err);
  console.log('Connected to SQLite database');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    publicKey TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    contactId TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    isRead INTEGER DEFAULT 0,
    isP2P INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS deleted_messages_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    message_text TEXT NOT NULL,
    deleted_at INTEGER NOT NULL
  )`);
});

const users = new Map();

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  if (!userId) return socket.disconnect();
  users.set(userId, socket.id);
  console.log(`New Socket.IO connection for user: ${userId}, total users: ${users.size}`);

  socket.on('message', (msg) => {
    const targetSocketId = users.get(msg.contactId);
    const senderSocketId = users.get(msg.userId);

    if (msg.isP2P) {
      if (targetSocketId) io.to(targetSocketId).emit('message', msg);
      return;
    }

    if (targetSocketId && senderSocketId) {
      io.to(targetSocketId).emit('message', msg);
      io.to(senderSocketId).emit('message', msg);
      console.log(`${colors.green}📩 ${msg.userId} → ${msg.contactId}:${colors.reset} "${msg.text}"`);
    } else {
      db.get('SELECT id FROM messages WHERE id = ?', [msg.id], (err, row) => {
        if (err) return console.error('Error checking message existence:', err);
        if (row) return console.log(`Message ${msg.id} already exists, skipping`);

        db.run(
          'INSERT INTO messages (id, userId, contactId, text, timestamp, isRead, isP2P) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [msg.id, msg.userId, msg.contactId, msg.text, msg.timestamp, 0, msg.isP2P || 0],
          (err) => {
            if (err) console.error('Failed to save message to DB:', err);
            else {
              console.log(`${colors.green}📩 ${msg.userId} → ${msg.contactId}:${colors.reset} "${msg.text}"\n${colors.yellow}Message ${msg.id} stored for offline user ${msg.contactId}${colors.reset}`);
              if (targetSocketId) io.to(targetSocketId).emit('message', msg);
              if (senderSocketId) io.to(senderSocketId).emit('message', msg);
            }
          }
        );
      });
    }
  });

  socket.on('p2p-offer', (data) => {
    const targetSocketId = users.get(data.target);
    if (targetSocketId) {
      io.to(targetSocketId).emit('p2p-offer', { offer: data.offer, source: data.source });
      io.to(targetSocketId).emit('p2p-offer-notify', {
        message: {
          id: `p2p-request-${Date.now()}`,
          userId: data.source,
          contactId: data.target,
          text: JSON.stringify({ type: 'offer', sdp: data.offer.sdp }),
          timestamp: Date.now(),
          isRead: 0,
          isP2P: true,
        }
      });
    } else {
      db.run(
        'INSERT INTO messages (id, userId, contactId, text, timestamp, isRead, isP2P) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [`p2p-offer-${Date.now()}`, data.source, data.target, JSON.stringify({ type: 'offer', sdp: data.offer.sdp }), Date.now(), 0, 1],
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
    io.emit('key-updated', { userId, publicKey }); // Сповіщення всіх клієнтів про оновлення ключа
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
              `SELECT id, userId, contactId, text, timestamp, isRead 
               FROM messages 
               WHERE (userId = ? AND contactId = ?) OR (userId = ? AND contactId = ?) 
               ORDER BY timestamp DESC LIMIT 1`,
              [userId, contact.id, contact.id, userId],
              (err, msg) => {
                if (err) resolve({ ...contact, lastMessage: null });
                else resolve({ ...contact, lastMessage: msg || null });
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
    `SELECT id, userId, contactId, text, timestamp, isRead, isP2P 
     FROM messages 
     WHERE (userId = ? AND contactId = ?) OR (userId = ? AND contactId = ?) 
     ORDER BY timestamp`,
    [userId, contactId, contactId, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    }
  );
});

app.post('/mark-as-read', (req, res) => {
  const { userId, contactId } = req.body;
  db.all(
    `SELECT id, userId, contactId, text FROM messages WHERE contactId = ? AND userId = ? AND isRead = 0`,
    [userId, contactId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      const messagesToDelete = rows;
      if (messagesToDelete.length === 0) return res.json({ success: true });

      messagesToDelete.forEach(msg => {
        db.run(
          `INSERT INTO deleted_messages_log (message_id, sender_id, receiver_id, message_text, deleted_at) 
           VALUES (?, ?, ?, ?, ?)`,
          [msg.id, msg.userId, msg.contactId, msg.text, Date.now()],
          (logErr) => {
            if (logErr) console.error('Failed to log deleted message:', logErr);
          }
        );
        console.log(`${colors.red}🗑️ ${msg.userId} → ${msg.contactId}:${colors.reset} "${msg.text}"`);
      });

      db.run(
        `UPDATE messages SET isRead = 1 WHERE contactId = ? AND userId = ? AND isRead = 0`,
        [userId, contactId],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: 'Database error' });
          db.run(
            `DELETE FROM messages WHERE contactId = ? AND userId = ? AND isRead = 1`,
            [userId, contactId],
            (deleteErr) => {
              if (deleteErr) return res.status(500).json({ error: 'Database error' });
              messagesToDelete.forEach(msg => {
                const senderSocketId = users.get(contactId);
                if (senderSocketId) io.to(senderSocketId).emit('message-read', { messageId: msg.id, contactId: userId });
              });
              res.json({ success: true });
            }
          );
        }
      );
    }
  );
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