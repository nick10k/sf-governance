'use strict';

const pool = require('../db');
const {
  summarizeApexCode,
  enhanceRecommendationNarrative,
  analyzeObjectAutomations,
} = require('./claudeService');
const { auditOrderOfExecution } = require('../rules/recommendationEngine');

const APEX_TYPES = ['Apex Trigger', 'Apex Class'];
const OBJECT_CAP = 20; // max number of objects analyzed per scan

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseEvents(triggerEvents) {
  if (!triggerEvents) return [];
  return triggerEvents.split(',').map((e) => e.trim().toLowerCase());
}

// Returns true if any automation in the group shares a trigger event with any other.
function groupHasOverlap(automations) {
  for (let i = 0; i < automations.length; i++) {
    for (let j = i + 1; j < automations.length; j++) {
      const ea = parseEvents(automations[i].trigger_events);
      const eb = parseEvents(automations[j].trigger_events);
      if (ea.some((e) => eb.includes(e))) return true;
    }
  }
  return false;
}

// ── Post-scan: summarize Apex + detect conflicts ──────────────────────────────

async function runPostScanLlm(scanId, orgId) {
  console.log(`[LLM] Starting post-scan processing for scan ${scanId}`);
  try {
    // 1. Summarize Apex Trigger and Apex Class items (skip already-summarized)
    const apexItems = await pool.query(
      `SELECT ai.id, ai.api_name, ai.automation_type, ai.parsed_data, mi.raw_json
       FROM automation_inventory ai
       JOIN metadata_items mi ON mi.id = ai.metadata_item_id
       WHERE mi.scan_id = $1
         AND ai.automation_type = ANY($2)
         AND ai.llm_summary IS NULL`,
      [scanId, APEX_TYPES],
    );

    for (const item of apexItems.rows) {
      const rawJson = item.raw_json || {};
      const codeBody = rawJson.Body || JSON.stringify(item.parsed_data);
      const codeType = item.automation_type === 'Apex Trigger' ? 'trigger' : 'class';

      const summary = await summarizeApexCode(item.api_name, codeBody, codeType);
      if (summary !== null) {
        await pool.query(
          'UPDATE automation_inventory SET llm_summary = $1, llm_summary_generated_at = NOW() WHERE id = $2',
          [summary, item.id],
        );
      }
      await sleep(200);
    }

    console.log(`[LLM] Summarized ${apexItems.rows.length} Apex items for scan ${scanId}`);
  } catch (err) {
    console.error(`[LLM] Post-scan processing failed for scan ${scanId}:`, err.message);
  }
}

// ── Post-analysis: enhance recommendation narratives ─────────────────────────

async function runPostAnalysisLlm(analysisRunId, orgId) {
  console.log(`[LLM] Starting narrative enhancement for analysis run ${analysisRunId}`);
  try {
    const profileResult = await pool.query(
      'SELECT * FROM customer_profiles WHERE org_id = $1',
      [orgId],
    );
    const profile = profileResult.rows[0] || { automation_preference: 'flow_first' };

    const recs = await pool.query(
      `SELECT r.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id', ai.id, 'api_name', ai.api_name,
               'automation_type', ai.automation_type,
               'object_name', ai.object_name,
               'is_active', ai.is_active
             ) ORDER BY ai.api_name
           ) FILTER (WHERE ai.id IS NOT NULL),
           '[]'
         ) AS items
       FROM recommendations r
       LEFT JOIN recommendation_items ri ON ri.recommendation_id = r.id
       LEFT JOIN automation_inventory ai ON ai.id = ri.automation_inventory_id
       WHERE r.analysis_run_id = $1
         AND r.llm_rationale IS NULL
       GROUP BY r.id`,
      [analysisRunId],
    );

    for (const rec of recs.rows) {
      const narrative = await enhanceRecommendationNarrative(rec, rec.items || [], profile);
      if (narrative !== null) {
        await pool.query(
          'UPDATE recommendations SET llm_rationale = $1, llm_rationale_generated_at = NOW() WHERE id = $2',
          [narrative, rec.id],
        );
      }
      await sleep(200);
    }

    console.log(`[LLM] Enhanced ${recs.rows.length} narratives for run ${analysisRunId}`);
  } catch (err) {
    console.error(`[LLM] Post-analysis processing failed for run ${analysisRunId}:`, err.message);
  }
}

// ── Object-first conflict detection (runs as part of analysis pipeline) ──────

async function runConflictDetection(scanId, orgId, onStep = () => {}, analysisRunId = null) {
  console.log(`[LLM] Starting object-first conflict detection for scan ${scanId}`);

  onStep('Loading active automations');
  const activeItems = await pool.query(
    `SELECT ai.id, ai.automation_type, ai.api_name, ai.object_name,
            ai.trigger_events, ai.parsed_data, ai.llm_summary
     FROM automation_inventory ai
     WHERE ai.metadata_item_id IN (SELECT id FROM metadata_items WHERE scan_id = $1)
       AND ai.is_active = true
       AND ai.object_name IS NOT NULL`,
    [scanId],
  );

  // Group active automations by object
  const byObject = {};
  for (const item of activeItems.rows) {
    if (!byObject[item.object_name]) byObject[item.object_name] = [];
    byObject[item.object_name].push(item);
  }

  // Only objects with 2+ automations that have overlapping trigger events
  const conflictingObjects = Object.entries(byObject).filter(
    ([, automations]) => automations.length >= 2 && groupHasOverlap(automations),
  );

  if (conflictingObjects.length === 0) {
    onStep('No objects with overlapping triggers found');
  } else {
    onStep(`Found ${conflictingObjects.length} object${conflictingObjects.length !== 1 ? 's' : ''} with overlapping triggers`);
  }

  if (conflictingObjects.length > OBJECT_CAP) {
    console.warn(
      `[LLM] Object cap hit for scan ${scanId}: ${conflictingObjects.length} conflicting objects, processing first ${OBJECT_CAP}`,
    );
  }
  const capped = conflictingObjects.slice(0, OBJECT_CAP);

  // Clear any existing conflicts for this scan before inserting fresh results
  await pool.query('DELETE FROM automation_conflicts WHERE scan_id = $1', [scanId]);

  for (const [idx, [objectName, automations]] of capped.entries()) {
    onStep(`Analyzing ${objectName} (${idx + 1}/${capped.length})`);
    console.log(`[LLM] Analyzing ${automations.length} automations on ${objectName}`);
    const automationIds = automations.map((a) => a.id);

    // Static order-of-execution audit — provides structured context to the LLM
    // and generates the fallback text when the LLM is unavailable.
    const ooeAudit = auditOrderOfExecution(automations);
    const seqLines = ooeAudit.sequence
      .map((s, i) => `  ${i + 1}. ${s.name} (${s.phaseLabel})`)
      .join('\n');
    const ooeContext = [
      ooeAudit.sequence.length > 1 ? `Execution sequence:\n${seqLines}` : null,
      ooeAudit.risks.length > 0
        ? `Detected risks:\n${ooeAudit.risks.map((r) => `  - ${r.text.replace(/^⚠ /, '')}`).join('\n')}`
        : null,
    ].filter(Boolean).join('\n\n');

    const result = await analyzeObjectAutomations(objectName, automations, ooeContext || null);

    // If LLM returns a result, use it; otherwise fall back to the static OOE audit findings.
    let conflictAnalysis;
    if (result !== null) {
      conflictAnalysis = result.analysis;
    } else if (ooeAudit.risks.length > 0) {
      conflictAnalysis = ooeAudit.risks.map((r) => r.text).join(' ');
    } else {
      conflictAnalysis =
        'Multiple automations share this object — review trigger timing and field writes for execution order risks.';
    }
    const severity = result !== null
      ? result.severity
      : (ooeAudit.risks.some((r) => r.severity === 'high') ? 'high' : 'medium');
    const llmGenerated = result !== null;

    if (result !== null) {
      console.log(
        `[LLM] Object conflict analysis succeeded (severity=${severity}) for ${objectName}`,
      );
    } else {
      console.warn(
        `[LLM] Conflict analysis returned null for ${objectName} — using static fallback`,
      );
    }

    await pool.query(
      `INSERT INTO automation_conflicts
         (scan_id, org_id, object_name, automation_ids, conflict_analysis, severity, llm_generated, analysis_run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [scanId, orgId, objectName, automationIds, conflictAnalysis, severity, llmGenerated, analysisRunId],
    );

    // Write conflict analysis back into the matching recommendation
    if (analysisRunId) {
      await pool.query(
        `UPDATE recommendations
         SET conflict_analysis = $1, conflict_severity = $2
         WHERE analysis_run_id = $3 AND object_name = $4`,
        [conflictAnalysis, severity, analysisRunId, objectName],
      );
    }
    await sleep(200);
  }

  console.log(
    `[LLM] Conflict detection complete: ${capped.length} object records for scan ${scanId}`,
  );
  return capped.length;
}

module.exports = { runPostScanLlm, runPostAnalysisLlm, runConflictDetection };
