import express from 'express';
import bodyParser from 'body-parser';
import mysql from 'mysql2/promise';

const app = express();
app.use(bodyParser.json());

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
};

const pool = mysql.createPool(dbConfig);

const amountLimit = 1000;
const maxRetries = 3;

app.post('/transactions', async (req, res) => {
  const { user_id, amount, description } = req.body;
  const apiKey = req.headers['apikey'];

  // Simply validation, can be improve to check the type of the fields
  if (!user_id || !amount || !description || !apiKey) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const connection = await pool.getConnection();

  // Check the API key
  const [validation] = await connection.execute(
    'SELECT api_key as apiKey FROM users WHERE id = ?',
    [user_id]
  );
  const userApiKey = validation[0].apiKey;
  if (apiKey !== userApiKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  let retries = 0;
  while (retries < maxRetries) {
    await connection.beginTransaction();
    try {
      // Check the current total amount for the user
      const [results] = await connection.execute(
        'SELECT SUM(amount) AS totalAmount FROM transactions WHERE user_id = ? for update',
        [user_id]
      );
      const totalAmount = results[0].totalAmount || 0;

      // If the new total amount exceeds the limit, rollback and return an error
      if (parseInt(totalAmount, 10) + parseInt(amount, 10) > amountLimit) {
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
        connection.release();
        continue;
      } else {
        await connection.rollback();
        connection.release();
        return res.status(500).json({ error: 'Database error' });
      }
    } finally {
      connection.release();
    }
  }

  return res.status(402).json({ error: 'Transaction failed after multiple retries due to deadlock' });
});

app.listen(process.env.APP_PORT, () => {
  console.log(`Server running at http://localhost:${process.env.APP_PORT}/`);
});