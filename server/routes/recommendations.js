const express = require('express');
const pool = require('../db');
const { initiateRemediation } = require('../services/remediationService');

const router = express.Router();

// PATCH /api/recommendations/:id — update status (open | accepted | dismissed)
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['open', 'accepted', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'status must be open, accepted, or dismissed' });
  }

  const result = await pool.query(
    'UPDATE recommendations SET status = $1 WHERE id = $2 RETURNING *',
    [status, id],
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Recommendation not found' });
  res.json(result.rows[0]);
});

// POST /api/recommendations/:id/remediate — initiate remediation job
router.post('/:id/remediate', async (req, res) => {
  try {
    const job = await initiateRemediation(req.params.id);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
