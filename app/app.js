const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const app = express();
const port = 8888;

const amountLimit = 1000;

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'codetest'
});

db.connect(err => {
  if (err) {
    console.error('Error connecting to the database:', err);
    process.exit(1);
  }
  console.log('Connected to the database');
});

app.use(bodyParser.json());

app.post('/transactions', (req, res) => {
  const { user_id, amount, description } = req.body;
  const apiKey = req.headers['apikey'];

  if (!user_id || !amount || !description || !apiKey) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (apiKey !== `secure-api-key-${user_id}`) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  db.query('SELECT SUM(amount) AS totalAmount FROM transactions WHERE user_id = ?', [user_id], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const totalAmount = results[0].totalAmount || 0;

    if (totalAmount + amount > amountLimit) {
      return res.status(402).json({ error: 'Amount limit exceeded' });
    }

    const transaction = { user_id, amount, description };
    db.query('INSERT INTO transactions SET ?', transaction, (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(201).json({ message: 'Transaction created', transactionId: result.insertId });
    });
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});