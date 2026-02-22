const pool = require('../db');

// Load active rules for running analysis
async function loadActiveRules() {
  const rows = await pool.query(
    'SELECT * FROM rules WHERE is_active = true ORDER BY sort_order, id'
  );
  return rows.rows;
}

// Load all rules (active or not) for enriching findings with metadata
async function loadAllRulesMap() {
  const rows = await pool.query('SELECT * FROM rules ORDER BY sort_order, id');
  return Object.fromEntries(rows.rows.map((r) => [r.id, r]));
}

module.exports = { loadActiveRules, loadAllRulesMap };
