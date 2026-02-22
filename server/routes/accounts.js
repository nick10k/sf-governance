const express = require('express');
const pool = require('../db');

const router = express.Router();

// List all accounts with org count
router.get('/', async (req, res) => {
  const rows = await pool.query(`
    SELECT a.id, a.name, a.created_at, COUNT(o.id)::int AS org_count
    FROM accounts a
    LEFT JOIN orgs o ON o.account_id = a.id
    GROUP BY a.id
    ORDER BY a.name
  `);
  res.json(rows.rows);
});

// Create a new account
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const result = await pool.query(
    'INSERT INTO accounts (name) VALUES ($1) RETURNING *',
    [name.trim()]
  );
  res.status(201).json(result.rows[0]);
});

// Get a single account with its connected orgs
router.get('/:id', async (req, res) => {
  const accountResult = await pool.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
  if (accountResult.rows.length === 0) return res.status(404).json({ error: 'Account not found' });

  const orgsResult = await pool.query(
    'SELECT id, name, instance_url, created_at FROM orgs WHERE account_id = $1 ORDER BY name',
    [req.params.id]
  );
  res.json({ account: accountResult.rows[0], orgs: orgsResult.rows });
});

module.exports = router;
