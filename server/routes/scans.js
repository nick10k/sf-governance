const express = require('express');
const pool = require('../db');
const { runAnalysis } = require('../rules/evaluator');
const { loadActiveRules, loadAllRulesMap } = require('../rules/loader');
const { generateRecommendations } = require('../rules/recommendationEngine');
const { runPostAnalysisLlm, runConflictDetection } = require('../services/llmBackground');
const progress = require('../services/progressStore');

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

// Get parsed automation inventory for a scan (includes llm_summary when available)
router.get('/:id/inventory', async (req, res) => {
  const rows = await pool.query(
    `SELECT id, automation_type, api_name, label, object_name,
            trigger_events, is_active, has_description, is_managed_package,
            parsed_data, llm_summary
     FROM automation_inventory
     WHERE metadata_item_id IN (
       SELECT id FROM metadata_items WHERE scan_id = $1
     )
     ORDER BY object_name, automation_type, api_name`,
    [req.params.id]
  );
  res.json(rows.rows);
});

// Run rule analysis against a scan's inventory — returns immediately, runs in background
router.post('/:id/analysis', async (req, res) => {
  const { id } = req.params;

  const scanResult = await pool.query('SELECT * FROM scans WHERE id = $1', [id]);
  if (scanResult.rows.length === 0) return res.status(404).json({ error: 'Scan not found' });
  const scan = scanResult.rows[0];

  // Create analysis run record up front so the client has a run_id immediately
  const runResult = await pool.query(
    'INSERT INTO analysis_runs (scan_id, org_id, finding_count) VALUES ($1, $2, 0) RETURNING id',
    [id, scan.org_id],
  );
  const runId = runResult.rows[0].id;
  const progressId = progress.create();

  res.json({ run_id: runId, progressId });

  setImmediate(async () => {
    try {
      progress.step(progressId, 'Loading automation inventory');
      const inventoryResult = await pool.query(
        `SELECT id, automation_type, api_name, label, object_name,
                trigger_events, is_active, has_description, is_managed_package, parsed_data
         FROM automation_inventory
         WHERE metadata_item_id IN (SELECT id FROM metadata_items WHERE scan_id = $1)`,
        [id],
      );

      const profileResult = await pool.query(
        'SELECT * FROM customer_profiles WHERE org_id = $1',
        [scan.org_id],
      );
      const profile = profileResult.rows[0] || {
        automation_preference: 'flow_first',
        active_rule_layers: ['platform', 'quality', 'risk', 'housekeeping'],
        suppressed_rule_ids: [],
        naming_convention_pattern: null,
      };

      progress.step(progressId, 'Running rule evaluation');
      const rules = await loadActiveRules();
      const findings = runAnalysis(inventoryResult.rows, rules, profile);

      for (const f of findings) {
        await pool.query(
          `INSERT INTO findings (scan_id, org_id, analysis_run_id, rule_id, severity, automation_inventory_id, api_name, object_name, message)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, scan.org_id, runId, f.rule_id, f.severity, f.automation_inventory_id, f.api_name, f.object_name, f.message],
        );
      }

      // Delete any prior recommendations for this run (idempotent re-run)
      await pool.query(
        'DELETE FROM recommendation_items WHERE recommendation_id IN (SELECT id FROM recommendations WHERE analysis_run_id = $1)',
        [runId],
      );
      await pool.query('DELETE FROM recommendations WHERE analysis_run_id = $1', [runId]);

      progress.step(progressId, 'Generating recommendations');
      const recommendationCount = await generateRecommendations(
        id, scan.org_id, runId,
        inventoryResult.rows, findings, profile, pool,
      );

      await runConflictDetection(
        id, scan.org_id,
        (label) => progress.step(progressId, label),
        runId,
      );

      await pool.query(
        'UPDATE analysis_runs SET finding_count = $1 WHERE id = $2',
        [findings.length, runId],
      );

      progress.step(progressId, 'Enhancing recommendation narratives');
      await runPostAnalysisLlm(runId, scan.org_id);

      progress.step(progressId, `Complete — ${findings.length} finding${findings.length !== 1 ? 's' : ''}, ${recommendationCount} recommendation${recommendationCount !== 1 ? 's' : ''}`);
      progress.done(progressId);
    } catch (err) {
      console.error('Analysis failed:', err);
      progress.fail(progressId, err.message);
    }
  });
});

// List all analysis runs for a scan
router.get('/:id/analysis-runs', async (req, res) => {
  const rows = await pool.query(
    'SELECT id, scan_id, created_at, finding_count FROM analysis_runs WHERE scan_id = $1 ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json(rows.rows);
});

// Get findings for a specific analysis run (defaults to latest run)
router.get('/:id/findings', async (req, res) => {
  const { runId } = req.query;
  let targetRunId = runId ? parseInt(runId) : null;

  if (!targetRunId) {
    const latestRun = await pool.query(
      'SELECT id FROM analysis_runs WHERE scan_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    if (latestRun.rows.length > 0) {
      targetRunId = latestRun.rows[0].id;
    }
  }

  if (!targetRunId) return res.json([]);

  const rows = await pool.query(
    'SELECT * FROM findings WHERE analysis_run_id = $1 ORDER BY severity, rule_id',
    [targetRunId]
  );
  const ruleMap = await loadAllRulesMap();
  res.json(rows.rows.map((f) => ({ ...f, rule: ruleMap[f.rule_id] })));
});

// Get all recommendations for a specific analysis run (includes llm_rationale)
router.get('/:id/recommendations', async (req, res) => {
  const { runId } = req.query;
  let targetRunId = runId ? parseInt(runId) : null;

  if (!targetRunId) {
    const latestRun = await pool.query(
      'SELECT id FROM analysis_runs WHERE scan_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.id],
    );
    if (latestRun.rows.length > 0) targetRunId = latestRun.rows[0].id;
  }

  if (!targetRunId) return res.json([]);

  const recs = await pool.query(
    `SELECT r.*,
       COALESCE(
         json_agg(
           json_build_object(
             'id', ai.id, 'api_name', ai.api_name, 'automation_type', ai.automation_type,
             'object_name', ai.object_name, 'is_active', ai.is_active
           ) ORDER BY ai.api_name
         ) FILTER (WHERE ai.id IS NOT NULL),
         '[]'
       ) AS items
     FROM recommendations r
     LEFT JOIN recommendation_items ri ON ri.recommendation_id = r.id
     LEFT JOIN automation_inventory ai ON ai.id = ri.automation_inventory_id
     WHERE r.analysis_run_id = $1
     GROUP BY r.id
     ORDER BY r.priority_score DESC`,
    [targetRunId],
  );

  res.json(recs.rows);
});

// Delete a scan and all its associated data
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const scan = await pool.query('SELECT id FROM scans WHERE id = $1', [id]);
  if (scan.rows.length === 0) {
    return res.status(404).json({ error: 'Scan not found' });
  }
  // Cascade order: conflicts → recommendation_items → recommendations → findings → analysis_runs → inventory → metadata_items → scan
  await pool.query('DELETE FROM automation_conflicts WHERE scan_id = $1', [id]);
  await pool.query(
    'DELETE FROM recommendation_items WHERE recommendation_id IN (SELECT id FROM recommendations WHERE scan_id = $1)',
    [id],
  );
  await pool.query('DELETE FROM recommendations WHERE scan_id = $1', [id]);
  await pool.query('DELETE FROM findings WHERE scan_id = $1', [id]);
  await pool.query('DELETE FROM analysis_runs WHERE scan_id = $1', [id]);
  await pool.query(
    `DELETE FROM automation_inventory
     WHERE metadata_item_id IN (SELECT id FROM metadata_items WHERE scan_id = $1)`,
    [id],
  );
  await pool.query('DELETE FROM metadata_items WHERE scan_id = $1', [id]);
  await pool.query('DELETE FROM scans WHERE id = $1', [id]);
  res.status(204).end();
});

module.exports = router;
