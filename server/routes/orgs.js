const express = require('express');
const pool = require('../db');
const { runMetadataScan } = require('../salesforce/scanner');
const { parseInventory } = require('../parsers/index');
const { runPostScanLlm } = require('../services/llmBackground');
const progress = require('../services/progressStore');

const router = express.Router();

// List all connected orgs (never expose tokens)
router.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, instance_url, env, env_label, created_at FROM orgs ORDER BY created_at DESC'
  );
  res.json(result.rows);
});

// Update org name and/or env_label
router.patch('/:orgId', async (req, res) => {
  const { orgId } = req.params;
  const { name, env_label } = req.body;

  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push(`name = $${fields.length + 1}`); values.push(name.trim()); }
  if (env_label !== undefined) { fields.push(`env_label = $${fields.length + 1}`); values.push(env_label || null); }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  values.push(orgId);
  const result = await pool.query(
    `UPDATE orgs SET ${fields.join(', ')} WHERE id = $${values.length}
     RETURNING id, name, instance_url, env, env_label, created_at`,
    values,
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Org not found' });
  res.json(result.rows[0]);
});

// List all scans for an org (with item count)
router.get('/:orgId/scans', async (req, res) => {
  const result = await pool.query(
    `SELECT s.id, s.status, s.started_at, s.completed_at, s.error_message,
            COUNT(m.id)::int AS item_count
     FROM scans s
     LEFT JOIN metadata_items m ON m.scan_id = s.id
     WHERE s.org_id = $1
     GROUP BY s.id
     ORDER BY s.started_at DESC`,
    [req.params.orgId]
  );
  res.json(result.rows);
});

// Trigger a scan for an org — returns immediately, scan runs in background
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
  const progressId = progress.create();

  // Return immediately so the client can navigate and start polling
  res.json({ id: scanId, status: 'running', progressId });

  setImmediate(async () => {
    try {
      progress.step(progressId, 'Connecting to org');
      await runMetadataScan(org, scanId, (label) => progress.step(progressId, label));

      await pool.query(
        `UPDATE scans SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [scanId]
      );

      try {
        progress.step(progressId, 'Parsing automation inventory');
        await parseInventory(scanId, orgId);
      } catch (parseErr) {
        console.warn('Inventory parse failed (scan data is safe):', parseErr.message);
      }

      progress.done(progressId);

      // LLM summarization + conflict detection runs in its own background pass
      runPostScanLlm(scanId, orgId).catch((err) =>
        console.error('[LLM] Post-scan background failed:', err.message),
      );
    } catch (err) {
      console.error('Scan failed:', err);
      await pool.query(
        `UPDATE scans SET status = 'failed', completed_at = NOW(), error_message = $1 WHERE id = $2`,
        [err.message, scanId]
      );
      progress.fail(progressId, err.message);
    }
  });
});

const DEFAULT_PROFILE = {
  automation_preference: 'flow_first',
  active_rule_layers: ['platform', 'quality', 'risk', 'housekeeping'],
  suppressed_rule_ids: [],
  naming_convention_pattern: null,
};

// Get customer profile for an org (returns default shape if none saved yet)
router.get('/:orgId/profile', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM customer_profiles WHERE org_id = $1',
    [req.params.orgId]
  );
  if (result.rows.length === 0) {
    return res.json({ org_id: parseInt(req.params.orgId), ...DEFAULT_PROFILE });
  }
  res.json(result.rows[0]);
});

// Create or update customer profile for an org
router.put('/:orgId/profile', async (req, res) => {
  const { orgId } = req.params;
  const { automation_preference, active_rule_layers, suppressed_rule_ids, naming_convention_pattern } = req.body;
  const result = await pool.query(
    `INSERT INTO customer_profiles
       (org_id, automation_preference, active_rule_layers, suppressed_rule_ids, naming_convention_pattern)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (org_id) DO UPDATE SET
       automation_preference     = EXCLUDED.automation_preference,
       active_rule_layers        = EXCLUDED.active_rule_layers,
       suppressed_rule_ids       = EXCLUDED.suppressed_rule_ids,
       naming_convention_pattern = EXCLUDED.naming_convention_pattern,
       updated_at                = NOW()
     RETURNING *`,
    [orgId, automation_preference, active_rule_layers, suppressed_rule_ids, naming_convention_pattern]
  );
  res.json(result.rows[0]);
});

module.exports = router;
