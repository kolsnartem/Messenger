const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./messenger.db', err => {
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
});

app.post('/register', (req, res) => {
  const { email, password, publicKey } = req.body;
  if (!email || !password || !publicKey) return res.status(400).json({ error: 'Missing fields' });

  const id = Date.now().toString();
  db.run(
    'INSERT INTO users (id, email, password, publicKey) VALUES (?, ?, ?, ?)',
    [id, email, password, publicKey], // Зберігаємо пароль як є (захешований клієнтом)
    err => {
      if (err) {
        console.error('Register error:', err);
        return res.status(500).json({ error: 'Registration failed' });
      }
      console.log('User registered:', { id, email });
      res.status(201).json({ id });
    }
  );
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err || !user) {
      console.log('Login failed: User not found or DB error', { email, err });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (password !== user.password) {
      console.log('Login failed: Password mismatch', { email });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('Login successful:', { id: user.id, email });
    res.json({ id: user.id, publicKey: user.publicKey });
  });
});

app.listen(4000, () => console.log('Server running on port 4000'));