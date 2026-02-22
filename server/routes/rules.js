const express = require('express');
const pool = require('../db');

const router = express.Router();

// List all rules ordered by sort_order
router.get('/', async (req, res) => {
  const rows = await pool.query('SELECT * FROM rules ORDER BY sort_order, id');
  res.json(rows.rows);
});

// Create a custom rule
router.post('/', async (req, res) => {
  const { id, layer, name, description, severity, check_type, applies_to, recommendation_template, conditions } = req.body;

  if (!id?.trim()) return res.status(400).json({ error: 'id is required' });
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!['error', 'warning', 'info'].includes(severity)) return res.status(400).json({ error: 'Invalid severity' });
  if (!['per_item', 'cross_item'].includes(check_type)) return res.status(400).json({ error: 'Invalid check_type' });

  const maxResult = await pool.query('SELECT MAX(sort_order) AS max FROM rules');
  const nextSort = (maxResult.rows[0].max || 0) + 10;

  try {
    const result = await pool.query(
      `INSERT INTO rules (id, layer, name, description, severity, check_type, applies_to, recommendation_template, conditions, is_builtin, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10) RETURNING *`,
      [
        id.trim(), layer, name.trim(), description || '', severity, check_type,
        applies_to || [], recommendation_template || '',
        conditions ? JSON.stringify(conditions) : null,
        nextSort,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Rule ID '${id}' already exists` });
    throw err;
  }
});

// Update a rule
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await pool.query('SELECT * FROM rules WHERE id = $1', [id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Rule not found' });

  const rule = existing.rows[0];
  const { layer, name, description, severity, check_type, applies_to, recommendation_template, conditions, is_active } = req.body;

  if (rule.is_builtin) {
    // Builtin rules: only metadata fields editable
    const result = await pool.query(
      `UPDATE rules SET name=$1, description=$2, severity=$3, recommendation_template=$4, is_active=$5
       WHERE id=$6 RETURNING *`,
      [
        name ?? rule.name, description ?? rule.description,
        severity ?? rule.severity, recommendation_template ?? rule.recommendation_template,
        is_active ?? rule.is_active, id,
      ]
    );
    return res.json(result.rows[0]);
  }

  // Custom rules: all fields editable
  const result = await pool.query(
    `UPDATE rules SET layer=$1, name=$2, description=$3, severity=$4, check_type=$5,
       applies_to=$6, recommendation_template=$7, conditions=$8, is_active=$9
     WHERE id=$10 RETURNING *`,
    [
      layer ?? rule.layer, name ?? rule.name, description ?? rule.description,
      severity ?? rule.severity, check_type ?? rule.check_type,
      applies_to ?? rule.applies_to, recommendation_template ?? rule.recommendation_template,
      conditions !== undefined ? JSON.stringify(conditions) : rule.conditions,
      is_active ?? rule.is_active, id,
    ]
  );
  res.json(result.rows[0]);
});

// Delete a custom rule (builtin rules cannot be deleted)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await pool.query('SELECT is_builtin FROM rules WHERE id = $1', [id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
  if (existing.rows[0].is_builtin) return res.status(403).json({ error: 'Built-in rules cannot be deleted' });

  await pool.query('DELETE FROM rules WHERE id = $1', [id]);
  res.status(204).end();
});

module.exports = router;
