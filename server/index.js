const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Ініціалізація бази даних SQLite
const db = new sqlite3.Database('./messenger.db', (err) => {
  if (err) {
    console.error('SQLite connection error:', err);
    return;
  }
  console.log('Connected to SQLite database');
});

// Створення таблиць
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      publicKey TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      contactId TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);
});

// WebSocket логіка
const clients = new Map();

wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');

  ws.on('message', (message) => {
    const msg = JSON.parse(message);
    console.log(`Received WebSocket message: From ${msg.userId} to ${msg.contactId} (ID: ${msg.id})`);

    // Збереження повідомлення в базу даних
    db.run(
      'INSERT INTO messages (id, userId, contactId, text, timestamp) VALUES (?, ?, ?, ?, ?)',
      [msg.id, msg.userId, msg.contactId, msg.text, msg.timestamp],
      (err) => {
        if (err) {
          console.error('Failed to save WebSocket message to DB:', err);
        } else {
          console.log(`WebSocket message saved to DB: ${msg.id}`);
          broadcastMessage(msg); // Розсилка повідомлення всім клієнтам
        }
      }
    );
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    clients.forEach((value, key) => {
      if (value === ws) {
        clients.delete(key);
      }
    });
  });
});

const broadcastMessage = (message) => {
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
};

// API ендпоінти
app.post('/register', (req, res) => {
  const { email, password, publicKey } = req.body;
  db.get('SELECT email FROM users WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (row) return res.status(400).json({ error: 'User already exists' });

    db.run(
      'INSERT INTO users (email, password, publicKey) VALUES (?, ?, ?)',
      [email, password, publicKey],
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
  db.run(
    'UPDATE users SET publicKey = ? WHERE id = ?',
    [publicKey, userId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Update failed' });
      console.log(`Updated keys for user ID: ${userId}`);
      res.json({ success: true });
    }
  );
});

app.get('/users', (req, res) => {
  db.all('SELECT id, email, publicKey FROM users', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows.map(row => ({
      id: row.id.toString(),
      email: row.email,
      publicKey: row.publicKey
    })));
  });
});

app.get('/search', (req, res) => {
  const { query } = req.query;
  db.all(
    'SELECT id, email, publicKey FROM users WHERE email LIKE ?',
    [`%${query}%`],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Search failed' });
      res.json(rows.map(row => ({
        id: row.id.toString(),
        email: row.email,
        publicKey: row.publicKey
      })));
    }
  );
});

app.get('/messages', (req, res) => {
  const { userId, contactId } = req.query;
  db.all(
    `SELECT id, userId, contactId, text, timestamp 
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

app.post('/messages', (req, res) => {
  const { id, userId, contactId, text, timestamp } = req.body;
  db.run(
    'INSERT INTO messages (id, userId, contactId, text, timestamp) VALUES (?, ?, ?, ?, ?)',
    [id, userId, contactId, text, timestamp],
    (err) => {
      if (err) {
        console.error(`Failed to save HTTP message to DB: ${id}`, err);
        return res.status(500).json({ error: 'Failed to send message' });
      }
      console.log(`HTTP message saved to DB: From ${userId} to ${contactId} (ID: ${id})`);
      const message = { id, userId, contactId, text, timestamp };
      broadcastMessage(message);
      res.json({ success: true });
    }
  );
});

// Закриття бази даних при завершенні роботи
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) console.error('Error closing database:', err);
    console.log('Database connection closed');
    process.exit(0);
  });
});

// Запуск сервера
const PORT = 4000;
server.listen(PORT, '192.168.31.185', () => {
  console.log(`Server running on http://192.168.31.185:${PORT}`);
});