const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const app = express();
const port = 8888;
const amountLimit = 1000;
const maxRetries = 3;
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'codetest'
};

app.use(bodyParser.json());

app.post('/transactions', async (req, res) => {
  const { user_id, amount, description } = req.body;
  console.log('🚀 ~ app.post ~ user_id, amount, description:', user_id, amount, description);
  const apiKey = req.headers['apikey'];

  if (!user_id || !amount || !description || !apiKey) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (apiKey !== `secure-api-key-${user_id}`) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  let retries = 0;
  while (retries < maxRetries) {
    const connection = await mysql.createConnection(dbConfig);
    await connection.beginTransaction();

    try {
      // Check the current total amount for the user
      const [results] = await connection.execute(
        'SELECT SUM(amount) AS totalAmount FROM transactions WHERE user_id = ? lock in share mode',
        [user_id]
      );
      const totalAmount = results[0].totalAmount || 0;

      // If the new total amount exceeds the limit, rollback and return an error
      if (parseInt(totalAmount, 10) + parseInt(amount, 10) > amountLimit) {
        console.log('🚀 ~ app.post ~ totalAmount + amount > amountLimit:', totalAmount + amount > amountLimit);
        await connection.rollback();
        return res.status(402).json({ error: 'Amount limit exceeded' });
      }

      // Insert the new transaction
      const [result] = await connection.execute(
        'INSERT INTO transactions (user_id, amount, description) VALUES (?, ?, ?)',
        [user_id, amount, description]
      );
      await connection.commit();
      return res.status(201).json({ message: 'Transaction created', transactionId: result.insertId });
    } catch (err) {
      if (err.code === 'ER_LOCK_DEADLOCK') {
        retries += 1;
        console.log(`Deadlock detected, retrying transaction (${retries}/${maxRetries})`);
        await connection.rollback();
        await connection.end();
        continue;
      } else {
        console.log('🚀 ~ app.post ~ err:', err);
        await connection.rollback();
        await connection.end();
        return res.status(500).json({ error: 'Database error' });
      }
    } finally {
      await connection.end();
    }
  }

  return res.status(402).json({ error: 'Transaction failed after multiple retries due to deadlock' });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});