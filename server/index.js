const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./messenger.db', (err) => {
  if (err) console.error('DB error:', err);
  else console.log('Connected to SQLite');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      publicKey TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      userId TEXT,
      contactId TEXT,
      text TEXT,
      timestamp INTEGER,
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (contactId) REFERENCES users(id)
    )
  `);
});

app.post('/register', (req, res) => {
  const { email, password, publicKey } = req.body;
  if (!email || !password || !publicKey) return res.status(400).json({ error: 'Missing fields' });

  const id = Date.now().toString();
  db.run(
    'INSERT INTO users (id, email, password, publicKey) VALUES (?, ?, ?, ?)',
    [id, email, password, publicKey],
    (err) => {
      if (err) return res.status(500).json({ error: 'Registration failed' });
      res.status(201).json({ id });
    }
  );
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
    if (password !== user.password) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ id: user.id, publicKey: user.publicKey });
  });
});

app.put('/update-keys', (req, res) => {
  const { userId, publicKey } = req.body;
  if (!userId || !publicKey) return res.status(400).json({ error: 'Missing fields' });

  db.run('UPDATE users SET publicKey = ? WHERE id = ?', [publicKey, userId], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to update keys' });
    res.status(200).json({ message: 'Keys updated' });
  });
});

app.get('/users', (req, res) => {
  db.all('SELECT id, email, publicKey FROM users', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch users' });
    res.json(rows);
  });
});

app.get('/search', (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Query parameter is required' });

  db.all('SELECT id, email, publicKey FROM users WHERE email LIKE ?', [`${query}%`], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to search users' });
    res.json(rows);
  });
});

app.post('/messages', (req, res) => {
  const { userId, contactId, text, timestamp } = req.body;
  if (!userId || !contactId || !text || !timestamp) return res.status(400).json({ error: 'Missing fields' });

  const id = Date.now().toString();
  db.run(
    'INSERT INTO messages (id, userId, contactId, text, timestamp) VALUES (?, ?, ?, ?, ?)',
    [id, userId, contactId, text, timestamp],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to save message' });
      const message = { id, userId, contactId, text, timestamp };
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
      });
      res.status(201).json({ id });
    }
  );
});

app.get('/messages', (req, res) => {
  const { userId, contactId } = req.query;
  if (!userId || !contactId) return res.status(400).json({ error: 'Missing userId or contactId' });

  db.all(
    'SELECT * FROM messages WHERE (userId = ? AND contactId = ?) OR (userId = ? AND contactId = ?)',
    [userId, contactId, contactId, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch messages' });
      res.json(rows);
    }
  );
});

const server = app.listen(4000, () => console.log('Server running on port 4000'));
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  ws.on('close', () => console.log('WebSocket client disconnected'));
});