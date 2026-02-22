'use strict';

const express = require('express');
const pool = require('../db');
const { approveRemediation, rejectRemediation } = require('../services/remediationService');
const { rollbackDeployment } = require('../services/deploymentService');

const router = express.Router();

// GET /api/remediation-jobs/:id
router.get('/:id', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM remediation_jobs WHERE id = $1',
    [req.params.id],
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
  res.json(result.rows[0]);
});

// POST /api/remediation-jobs/:id/approve
router.post('/:id/approve', async (req, res) => {
  try {
    const job = await approveRemediation(req.params.id, req.body?.editedMetadata || null);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/remediation-jobs/:id/reject
router.post('/:id/reject', async (req, res) => {
  try {
    const job = await rejectRemediation(req.params.id);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/remediation-jobs/:id/rollback
router.post('/:id/rollback', async (req, res) => {
  try {
    const job = await rollbackDeployment(req.params.id);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
