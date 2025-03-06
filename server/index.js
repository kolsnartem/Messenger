const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const url = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./messenger.db', (err) => {
  if (err) {
    console.error('SQLite connection error:', err);
    return;
  }
  console.log('Connected to SQLite database');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      publicKey TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      contactId TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      isRead INTEGER DEFAULT 0
    )
  `);
});

const clients = new Map();

wss.on('connection', (ws, req) => {
  const params = url.parse(req.url, true).query;
  const userId = params.userId;
  if (!userId) {
    ws.close(4000, 'Missing userId');
    return;
  }

  clients.set(userId, ws);
  console.log(`New WebSocket connection established for user: ${userId}`);

  ws.on('message', (message) => {
    const msg = JSON.parse(message);
    if (msg.type === 'read') {
      sendToParticipants(msg);
      return;
    }
    console.log(`Received WebSocket message: From ${msg.userId} to ${msg.contactId} (ID: ${msg.id}, Text: ${msg.text})`);

    db.get('SELECT id FROM messages WHERE id = ?', [msg.id], (err, row) => {
      if (err) {
        console.error('Error checking message existence:', err);
        return;
      }
      if (row) {
        console.log(`Message ${msg.id} already exists, skipping`);
        return;
      }

      db.run(
        'INSERT INTO messages (id, userId, contactId, text, timestamp, isRead) VALUES (?, ?, ?, ?, ?, ?)',
        [msg.id, msg.userId, msg.contactId, msg.text, msg.timestamp, 0],
        (err) => {
          if (err) {
            console.error('Failed to save WebSocket message to DB:', err);
          } else {
            console.log(`WebSocket message saved to DB: ${msg.id}, Text: ${msg.text}`);
            sendToParticipants(msg);
          }
        }
      );
    });
  });

  ws.on('close', (code, reason) => {
    console.log(`WebSocket connection closed for user: ${userId} (Code: ${code}, Reason: ${reason || 'unknown'})`);
    clients.delete(userId);
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for user ${userId}:`, err);
  });
});

const sendToParticipants = (message) => {
  const participants = message.type === 'read' ? [message.contactId] : [message.userId, message.contactId];
  participants.forEach((id) => {
    const client = clients.get(id);
    if (client && client.readyState === WebSocket.OPEN) {
      console.log(`Sending message to user ${id}:`, message);
      client.send(JSON.stringify(message));
    }
  });
};

app.post('/register', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT email FROM users WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (row) return res.status(400).json({ error: 'User already exists' });

    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email, password],
      function(err) {
        if (err) return res.status(500).json({ error: 'Registration failed' });
        console.log(`User registered: ${email} (ID: ${this.lastID})`);
        res.json({ id: this.lastID.toString() });
      }
    );
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get(
    'SELECT id FROM users WHERE email = ? AND password = ?',
    [email, password],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!row) return res.status(401).json({ error: 'Invalid credentials' });
      console.log(`User logged in: ${email} (ID: ${row.id})`);
      res.json({ id: row.id.toString() });
    }
  );
});

app.put('/update-keys', (req, res) => {
  const { userId, publicKey } = req.body;
  console.log('Received public key (before save):', publicKey, 'Length:', publicKey.length);
  if (!publicKey || publicKey.length !== 44) {
    console.error('Invalid public key length or empty, expected 44 characters, got:', publicKey?.length || 0);
    return res.status(400).json({ error: 'Invalid public key format' });
  }
  db.run(
    'UPDATE users SET publicKey = ? WHERE id = ?',
    [publicKey, userId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Update failed' });
      console.log(`Updated keys for user ID: ${userId}, PublicKey: ${publicKey}`);
      res.json({ success: true });
    }
  );
});

app.get('/users', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing userId' });

  db.get('SELECT id, email, publicKey FROM users WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'User not found' });
    console.log(`Fetched user ${id} publicKey:`, row.publicKey, 'Length:', row.publicKey?.length || 0);
    res.json({
      id: row.id.toString(),
      email: row.email,
      publicKey: row.publicKey || '',
    });
  });
});

app.get('/search', (req, res) => {
  const { query } = req.query;
  db.all(
    'SELECT id, email, publicKey FROM users WHERE email LIKE ?',
    [`%${query}%`],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Search failed' });
      rows.forEach(row => console.log(`Search result for ${row.email}, publicKey:`, row.publicKey, 'Length:', row.publicKey?.length || 0));
      res.json(rows.map(row => ({
        id: row.id.toString(),
        email: row.email,
        publicKey: row.publicKey || '', // Гарантуємо, що publicKey завжди є
      })));
    }
  );
});

app.get('/chats', (req, res) => {
  const { userId } = req.query;

  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  db.all(
    `
      SELECT DISTINCT u.id, u.email, u.publicKey 
      FROM users u
      INNER JOIN messages m 
      ON (u.id = m.userId OR u.id = m.contactId)
      WHERE (m.userId = ? OR m.contactId = ?) AND u.id != ?
    `,
    [userId, userId, userId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching chats:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      const contacts = rows.map(row => ({
        id: row.id.toString(),
        email: row.email,
        publicKey: row.publicKey || '', // Гарантуємо, що publicKey завжди є
      }));

      Promise.all(
        contacts.map(contact =>
          new Promise((resolve) => {
            db.get(
              `
                SELECT id, userId, contactId, text, timestamp, isRead 
                FROM messages 
                WHERE (userId = ? AND contactId = ?) OR (userId = ? AND contactId = ?) 
                ORDER BY timestamp DESC LIMIT 1
              `,
              [userId, contact.id, contact.id, userId],
              (err, msg) => {
                if (err) {
                  console.error('Error fetching last message:', err);
                  resolve({ ...contact, lastMessage: null });
                } else {
                  resolve({ ...contact, lastMessage: msg || null });
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
    `SELECT id, userId, contactId, text, timestamp, isRead 
     FROM messages 
     WHERE (userId = ? AND contactId = ?) OR (userId = ? AND contactId = ?) 
     ORDER BY timestamp`,
    [userId, contactId, contactId, userId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching messages:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      console.log(`Fetched messages for user ${userId} and contact ${contactId}:`, rows);
      res.json(rows);
    }
  );
});

app.post('/mark-as-read', (req, res) => {
  const { userId, contactId } = req.body;
  db.run(
    `UPDATE messages SET isRead = 1 WHERE contactId = ? AND userId = ? AND isRead = 0`,
    [userId, contactId],
    (err) => {
      if (err) {
        console.error('Error marking messages as read:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      const readUpdate = { type: 'read', userId, contactId };
      sendToParticipants(readUpdate);
      res.json({ success: true });
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
server.listen(PORT, '192.168.31.185', () => {
  console.log(`Server running on http://192.168.31.185:${PORT}`);
});