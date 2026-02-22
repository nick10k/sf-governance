'use strict';

const express = require('express');
const pool = require('../db');
const { summarizeApexCode } = require('../services/claudeService');

const router = express.Router();

// POST /api/automations/:id/explain
// Returns llm_summary from cache or generates on-demand.
router.post('/:id/explain', async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT ai.*, mi.raw_json
     FROM automation_inventory ai
     JOIN metadata_items mi ON mi.id = ai.metadata_item_id
     WHERE ai.id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Automation not found' });
  }

  const item = result.rows[0];

  // Return cached summary immediately if available
  if (item.llm_summary) {
    return res.json({ summary: item.llm_summary });
  }

  // Determine code type and body based on automation type
  let codeType, codeBody;
  const rawJson = item.raw_json || {};

  if (item.automation_type === 'Apex Trigger') {
    codeType = 'trigger';
    codeBody = rawJson.Body || JSON.stringify(item.parsed_data);
  } else if (item.automation_type === 'Apex Class') {
    codeType = 'class';
    codeBody = rawJson.Body || JSON.stringify(item.parsed_data);
  } else if (item.automation_type === 'Workflow Rule') {
    codeType = 'workflow_rule';
    codeBody = JSON.stringify(item.parsed_data);
  } else {
    // Record-Triggered Flow, Process Builder, and other Flow types
    codeType = 'flow';
    codeBody = JSON.stringify(item.parsed_data);
  }

  const summary = await summarizeApexCode(item.api_name, codeBody, codeType);

  if (summary !== null) {
    await pool.query(
      'UPDATE automation_inventory SET llm_summary = $1, llm_summary_generated_at = NOW() WHERE id = $2',
      [summary, id],
    );
  }

  res.json({ summary });
});

module.exports = router;
