const express = require('express');
const pool = require('../db');
const { runMetadataScan } = require('../salesforce/scanner');

const router = express.Router();

// List all connected orgs (never expose tokens)
router.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, instance_url, created_at FROM orgs ORDER BY created_at DESC'
  );
  res.json(result.rows);
});

// Trigger a scan for an org (runs synchronously)
router.post('/:orgId/scans', async (req, res) => {
  const { orgId } = req.params;

  const orgResult = await pool.query('SELECT * FROM orgs WHERE id = $1', [orgId]);
  if (orgResult.rows.length === 0) {
    return res.status(404).json({ error: 'Org not found' });
  }
  const org = orgResult.rows[0];

  const scanResult = await pool.query(
    `INSERT INTO scans (org_id, status, started_at) VALUES ($1, 'running', NOW()) RETURNING id`,
    [orgId]
  );
  const scanId = scanResult.rows[0].id;

  try {
    await runMetadataScan(org, scanId);
    await pool.query(
      `UPDATE scans SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [scanId]
    );
    res.json({ scanId, status: 'completed' });
  } catch (err) {
    console.error('Scan failed:', err);
    await pool.query(
      `UPDATE scans SET status = 'failed', completed_at = NOW(), error_message = $1 WHERE id = $2`,
      [err.message, scanId]
    );
    res.status(500).json({ scanId, status: 'failed', error: err.message });
  }
});

module.exports = router;
