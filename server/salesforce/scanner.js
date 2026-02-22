const pool = require('../db');
const { createConnection } = require('./connection');

const METADATA_TYPES = ['Flow', 'WorkflowRule'];
const READ_BATCH_SIZE = 10;

const TOOLING_QUERIES = [
  {
    type: 'ApexClass',
    soql: 'SELECT Id, Name, ApiVersion, Body, Status, NamespacePrefix FROM ApexClass ORDER BY Name',
  },
  {
    type: 'ApexTrigger',
    soql: 'SELECT Id, Name, ApiVersion, Body, Status, TableEnumOrId, NamespacePrefix FROM ApexTrigger ORDER BY Name',
  },
];

async function runMetadataScan(org, scanId, onStep = () => {}) {
  const conn = createConnection(org);

  // Metadata API types (Flow, WorkflowRule)
  for (const type of METADATA_TYPES) {
    onStep(`Listing ${type} metadata`);
    let listResult;
    try {
      listResult = await conn.metadata.list([{ type }]);
    } catch (err) {
      if (err.errorCode === 'sf:INVALID_TYPE') {
        console.warn(`Skipping metadata type '${type}': list() failed — not available in this org`);
        continue;
      }
      throw err;
    }

    // jsforce returns null, a single object, or an array — normalize
    const components = Array.isArray(listResult)
      ? listResult
      : listResult
        ? [listResult]
        : [];

    if (components.length === 0) {
      console.log(`No components found for type '${type}'`);
      continue;
    }

    console.log(`Found ${components.length} components for type '${type}'`);

    // Read full metadata in batches of 10 (Salesforce API limit)
    const fullNames = components.map((c) => c.fullName);
    const totalBatches = Math.ceil(fullNames.length / READ_BATCH_SIZE);

    for (let i = 0; i < fullNames.length; i += READ_BATCH_SIZE) {
      const batchNum = Math.floor(i / READ_BATCH_SIZE) + 1;
      if (totalBatches > 1) {
        onStep(`Reading ${type} (batch ${batchNum}/${totalBatches})`);
      } else {
        onStep(`Reading ${components.length} ${type} item${components.length !== 1 ? 's' : ''}`);
      }

      const batch = fullNames.slice(i, i + READ_BATCH_SIZE);
      let readResult;
      try {
        readResult = await conn.metadata.read(type, batch);
      } catch (err) {
        if (err.errorCode === 'sf:INVALID_TYPE') {
          console.warn(`Skipping metadata type '${type}': read() failed — not available in this org`);
          break;
        }
        throw err;
      }
      const items = Array.isArray(readResult) ? readResult : [readResult];

      for (const item of items) {
        const storedType = type === 'Flow' && item.processType === 'Workflow'
          ? 'ProcessBuilder'
          : type;
        await pool.query(
          `INSERT INTO metadata_items (scan_id, org_id, type, api_name, label, raw_json)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [scanId, org.id, storedType, item.fullName, item.fullName, JSON.stringify(item)]
        );
      }
    }
  }

  // Tooling API types (ApexClass, ApexTrigger)
  for (const { type, soql } of TOOLING_QUERIES) {
    onStep(`Querying ${type}`);
    try {
      let result = await conn.tooling.query(soql);
      const records = [...result.records];

      while (!result.done) {
        result = await conn.tooling.queryMore(result.nextRecordsUrl);
        records.push(...result.records);
      }

      if (records.length === 0) {
        console.log(`No components found for type '${type}'`);
        continue;
      }

      console.log(`Found ${records.length} components for type '${type}'`);

      for (const record of records) {
        await pool.query(
          `INSERT INTO metadata_items (scan_id, org_id, type, api_name, label, raw_json)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [scanId, org.id, type, record.Name, record.Name, JSON.stringify(record)]
        );
      }
    } catch (err) {
      console.warn(`Skipping type '${type}': ${err.message}`);
    }
  }
}

module.exports = { runMetadataScan };
