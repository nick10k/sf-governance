const pool = require('../db');
const { parseFlow } = require('./flow');
const { parseWorkflowRule } = require('./workflowRule');
const { parseApexTrigger } = require('./apexTrigger');
const { parseApexClass } = require('./apexClass');

const PARSERS = {
  Flow: parseFlow,
  ProcessBuilder: parseFlow,
  WorkflowRule: parseWorkflowRule,
  ApexTrigger: parseApexTrigger,
  ApexClass: parseApexClass,
};

async function parseInventory(scanId, orgId) {
  const result = await pool.query(
    'SELECT id, type, raw_json FROM metadata_items WHERE scan_id = $1',
    [scanId]
  );

  for (const item of result.rows) {
    const parser = PARSERS[item.type];
    if (!parser) continue;

    try {
      const parsed = parser(item.raw_json);
      await pool.query(
        `INSERT INTO automation_inventory
          (metadata_item_id, org_id, automation_type, api_name, label,
           object_name, trigger_events, is_active, has_description,
           is_managed_package, parsed_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          item.id,
          orgId,
          parsed.automation_type,
          item.raw_json.fullName || item.raw_json.Name || '',
          item.raw_json.fullName || item.raw_json.Name || '',
          parsed.object_name,
          parsed.trigger_events,
          parsed.is_active,
          parsed.has_description,
          parsed.is_managed_package,
          JSON.stringify(parsed.parsed_data),
        ]
      );
    } catch (err) {
      console.warn(`Failed to parse ${item.type} item ${item.id}:`, err.message);
    }
  }
}

module.exports = { parseInventory };
