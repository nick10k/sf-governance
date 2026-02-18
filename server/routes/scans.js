const express = require('express');
const pool = require('../db');

const router = express.Router();

// Get scan status + metadata items
router.get('/:id', async (req, res) => {
  const scan = await pool.query('SELECT * FROM scans WHERE id = $1', [req.params.id]);
  if (scan.rows.length === 0) {
    return res.status(404).json({ error: 'Scan not found' });
  }

  const items = await pool.query(
    'SELECT id, type, api_name, label, created_at FROM metadata_items WHERE scan_id = $1 ORDER BY type, api_name',
    [req.params.id]
  );

  res.json({ scan: scan.rows[0], items: items.rows });
});

module.exports = router;
