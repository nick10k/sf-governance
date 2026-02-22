'use strict';

const jsforce = require('jsforce');
const JSZip = require('jszip');
const pool = require('../db');

// ── Sandbox guard ─────────────────────────────────────────────────────────────

function assertSandbox(org) {
  if (org.env !== 'sandbox' && !org.instance_url.includes('sandbox')) {
    throw new Error('Production deployment is not permitted in this version.');
  }
}

// ── JSforce connection ────────────────────────────────────────────────────────

async function getConnection(orgId) {
  const result = await pool.query('SELECT * FROM orgs WHERE id = $1', [orgId]);
  if (result.rows.length === 0) throw new Error(`Org ${orgId} not found`);
  const org = result.rows[0];
  assertSandbox(org);
  return new jsforce.Connection({
    instanceUrl: org.instance_url,
    accessToken: org.access_token,
  });
}

// ── Metadata type → zip file path mapping ────────────────────────────────────

const METADATA_PATHS = {
  Flow: (name) => ({ main: `flows/${name}.flow-meta.xml` }),
  WorkflowRule: (name, objectName) => ({
    main: `workflows/${objectName || name}.workflow-meta.xml`,
  }),
  ApexTrigger: (name) => ({
    main: `triggers/${name}.trigger`,
    meta: `triggers/${name}.trigger-meta.xml`,
  }),
  ApexClass: (name) => ({
    main: `classes/${name}.cls`,
    meta: `classes/${name}.cls-meta.xml`,
  }),
};

function buildPackageXml(metadataType, apiName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>${apiName}</members>
    <name>${metadataType}</name>
  </types>
  <version>58.0</version>
</Package>`;
}

function buildApexMetaXml(apiVersion = '58.0') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>${apiVersion}</apiVersion>
  <status>Active</status>
</ApexClass>`;
}

function buildTriggerMetaXml(objectName, apiVersion = '58.0') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>${apiVersion}</apiVersion>
  <status>Active</status>
</ApexTrigger>`;
}

// ── Build deploy zip ──────────────────────────────────────────────────────────

// content: xmlString for Flow/WorkflowRule; { code, objectName, apiVersion } for Apex types
async function buildDeployZip(metadataType, apiName, content) {
  const zip = new JSZip();
  const paths = METADATA_PATHS[metadataType];
  if (!paths) throw new Error(`Unsupported metadata type: ${metadataType}`);

  const objectName = content?.objectName;
  const filePaths = paths(apiName, objectName);

  zip.file('package.xml', buildPackageXml(metadataType, apiName));

  if (metadataType === 'ApexTrigger') {
    zip.file(filePaths.main, content.code);
    zip.file(filePaths.meta, buildTriggerMetaXml(content.objectName, content.apiVersion));
  } else if (metadataType === 'ApexClass') {
    zip.file(filePaths.main, content.code);
    zip.file(filePaths.meta, buildApexMetaXml(content.apiVersion));
  } else {
    zip.file(filePaths.main, typeof content === 'string' ? content : content.xml);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

// ── Deploy ────────────────────────────────────────────────────────────────────

async function deployMetadata(orgId, metadataType, apiName, content) {
  const conn = await getConnection(orgId); // also calls assertSandbox
  const zipBuffer = await buildDeployZip(metadataType, apiName, content);

  const deployResult = await conn.metadata.deploy(zipBuffer, { allOrNone: true });
  const deployId = deployResult.id;

  // Poll until complete (3s interval, 120s timeout)
  const { status, errors } = await checkDeploymentStatus(orgId, deployId, conn);
  return { deploymentId: deployId, status, errors };
}

async function checkDeploymentStatus(orgId, deploymentId, connArg) {
  const conn = connArg || (await getConnection(orgId));
  const TIMEOUT_MS = 120_000;
  const POLL_MS = 3_000;
  const start = Date.now();

  while (Date.now() - start < TIMEOUT_MS) {
    await sleep(POLL_MS);
    const result = await conn.metadata.checkDeployStatus(deploymentId, true);
    if (result.done) {
      const errors = (result.details?.componentFailures || []).map(
        (f) => `${f.componentType}/${f.fullName}: ${f.problem}`,
      );
      return {
        status: result.success ? 'Succeeded' : 'Failed',
        errors,
      };
    }
  }
  return { status: 'Failed', errors: ['Deployment timed out after 120 seconds'] };
}

// ── Retrieve (for rollback store) ─────────────────────────────────────────────

async function retrieveMetadata(orgId, metadataType, apiName) {
  const conn = await getConnection(orgId);
  const retrieveResult = await conn.metadata.retrieve({
    apiVersion: '58.0',
    unpackaged: {
      types: [{ members: [apiName], name: metadataType }],
      version: '58.0',
    },
  });

  // retrieveResult may be a stream or buffer — handle both
  let zipBuffer;
  if (Buffer.isBuffer(retrieveResult)) {
    zipBuffer = retrieveResult;
  } else if (retrieveResult.zipFile) {
    zipBuffer = Buffer.from(retrieveResult.zipFile, 'base64');
  } else {
    // jsforce v3 returns a RetrieveResult with zipFile as base64
    const pollResult = await conn.metadata.checkRetrieveStatus(retrieveResult.id, true);
    zipBuffer = Buffer.from(pollResult.zipFile, 'base64');
  }

  const zip = await JSZip.loadAsync(zipBuffer);
  const paths = METADATA_PATHS[metadataType](apiName);
  const file = zip.file(paths.main);
  if (!file) return null;
  return file.async('string');
}

// ── Rollback ──────────────────────────────────────────────────────────────────

async function rollbackDeployment(remediationJobId) {
  const rollbackRows = await pool.query(
    'SELECT * FROM remediation_rollbacks WHERE remediation_job_id = $1',
    [remediationJobId],
  );

  if (rollbackRows.rows.length === 0) {
    throw new Error('No rollback records found for this job');
  }

  const jobRow = await pool.query(
    'SELECT org_id FROM remediation_jobs WHERE id = $1',
    [remediationJobId],
  );
  const orgId = jobRow.rows[0].org_id;

  for (const rb of rollbackRows.rows) {
    await deployMetadata(orgId, rb.original_type, rb.original_api_name, rb.original_metadata);
    await pool.query(
      'UPDATE remediation_rollbacks SET rolled_back_at = NOW() WHERE id = $1',
      [rb.id],
    );
  }

  await pool.query(
    "UPDATE remediation_jobs SET status = 'rolled_back', updated_at = NOW() WHERE id = $1",
    [remediationJobId],
  );

  const updated = await pool.query(
    'SELECT * FROM remediation_jobs WHERE id = $1',
    [remediationJobId],
  );
  return updated.rows[0];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { retrieveMetadata, deployMetadata, checkDeploymentStatus, rollbackDeployment };
