const pool = require('../db');
const { createConnection } = require('./connection');

const METADATA_TYPES = ['Flow', 'WorkflowRule', 'ApexTrigger'];
const READ_BATCH_SIZE = 10;

async function runMetadataScan(org, scanId) {
  const conn = createConnection(org);

  for (const type of METADATA_TYPES) {
    // List all components of this type
    const listResult = await conn.metadata.list([{ type }]);

    // jsforce returns null, a single object, or an array — normalize
    const components = Array.isArray(listResult)
      ? listResult
      : listResult
        ? [listResult]
        : [];

    if (components.length === 0) continue;

    // Read full metadata in batches of 10 (Salesforce API limit)
    const fullNames = components.map((c) => c.fullName);

    for (let i = 0; i < fullNames.length; i += READ_BATCH_SIZE) {
      const batch = fullNames.slice(i, i + READ_BATCH_SIZE);
      const readResult = await conn.metadata.read(type, batch);
      const items = Array.isArray(readResult) ? readResult : [readResult];

      for (const item of items) {
        await pool.query(
          `INSERT INTO metadata_items (scan_id, org_id, type, api_name, label, raw_json)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [scanId, org.id, type, item.fullName, item.fullName, JSON.stringify(item)]
        );
      }
    }
  }
}

module.exports = { runMetadataScan };
