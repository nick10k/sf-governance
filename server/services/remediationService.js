'use strict';

const pool = require('../db');
const { retrieveMetadata, deployMetadata } = require('./deploymentService');

const generators = {
  wfrToFlow: require('./generators/wfrToFlow'),
  pbToFlow: require('./generators/pbToFlow'),
  consolidateToFlow: require('./generators/consolidateToFlow'),
  legacyToApex: require('./generators/legacyToApex'),
  apexFlowConsolidate: require('./generators/apexFlowConsolidate'),
};

// ── Generator routing ─────────────────────────────────────────────────────────

function resolveGenerator(pattern, items, profile) {
  const types = items.map((i) => i.automation_type);
  const apexFirst = profile?.automation_preference === 'apex_first';

  if (pattern === 'flow_and_apex' || pattern === 'apex_fragmented') return 'apexFlowConsolidate';
  if (apexFirst) return 'legacyToApex';
  if (types.every((t) => t === 'Workflow Rule')) return 'wfrToFlow';
  if (types.every((t) => t === 'Process Builder')) return 'pbToFlow';
  return 'consolidateToFlow';
}

// ── Metadata type for a given automation_type ─────────────────────────────────

function sfMetadataType(automationType) {
  if (automationType === 'Apex Trigger') return 'ApexTrigger';
  if (automationType === 'Apex Class') return 'ApexClass';
  if (automationType === 'Workflow Rule') return 'WorkflowRule';
  return 'Flow'; // Record-Triggered Flow, Process Builder, etc.
}

// ── initiateRemediation ───────────────────────────────────────────────────────

async function initiateRemediation(recommendationId) {
  // 1. Fetch recommendation and affected items with their raw_json
  const recResult = await pool.query(
    'SELECT * FROM recommendations WHERE id = $1',
    [recommendationId],
  );
  if (recResult.rows.length === 0) throw new Error('Recommendation not found');
  const rec = recResult.rows[0];

  const itemsResult = await pool.query(
    `SELECT ai.*, mi.raw_json
     FROM recommendation_items ri
     JOIN automation_inventory ai ON ai.id = ri.automation_inventory_id
     JOIN metadata_items mi ON mi.id = ai.metadata_item_id
     WHERE ri.recommendation_id = $1`,
    [recommendationId],
  );
  const items = itemsResult.rows;

  // 2. Fetch customer profile for org
  const profileResult = await pool.query(
    'SELECT * FROM customer_profiles WHERE org_id = $1',
    [rec.org_id],
  );
  const profile = profileResult.rows[0] || { automation_preference: 'flow_first' };

  // 3. Determine generator
  const generatorKey = resolveGenerator(rec.pattern, items, profile);
  const generator = generators[generatorKey];
  if (!generator) throw new Error(`Unknown generator: ${generatorKey}`);

  // 4. Insert job record (status=generating)
  const jobResult = await pool.query(
    `INSERT INTO remediation_jobs
       (recommendation_id, org_id, pattern, status, source_metadata)
     VALUES ($1, $2, $3, 'generating', $4)
     RETURNING *`,
    [recommendationId, rec.org_id, generatorKey, JSON.stringify(items)],
  );
  const job = jobResult.rows[0];

  // 5. Run generator
  let genResult;
  try {
    genResult = await generator.generate(items, profile);
  } catch (err) {
    await pool.query(
      "UPDATE remediation_jobs SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2",
      [err.message, job.id],
    );
    throw err;
  }

  // 6. Store result — XML generators return { xml, notes, conflictWarning, requiresManual }
  //    Apex generators return { trigger, handler, notes, requiresManual?, conflictWarning? }
  let generatedMetadata;
  if (genResult.xml !== undefined) {
    generatedMetadata = genResult.xml;
  } else {
    generatedMetadata = JSON.stringify({
      trigger: genResult.trigger,
      handler: genResult.handler,
    });
  }

  const updated = await pool.query(
    `UPDATE remediation_jobs
     SET status = 'review',
         generated_metadata = $1,
         generation_notes = $2,
         conflict_warning = $3,
         requires_manual_completion = $4,
         updated_at = NOW()
     WHERE id = $5
     RETURNING *`,
    [
      generatedMetadata,
      genResult.notes || null,
      genResult.conflictWarning || false,
      genResult.requiresManual || false,
      job.id,
    ],
  );

  return updated.rows[0];
}

// ── approveRemediation ────────────────────────────────────────────────────────

async function approveRemediation(jobId, editedMetadata) {
  const jobResult = await pool.query(
    'SELECT rj.*, o.* FROM remediation_jobs rj JOIN orgs o ON o.id = rj.org_id WHERE rj.id = $1',
    [jobId],
  );
  if (jobResult.rows.length === 0) throw new Error('Remediation job not found');
  const job = jobResult.rows[0];

  const finalMetadata = editedMetadata || job.generated_metadata;

  await pool.query(
    "UPDATE remediation_jobs SET status = 'approved', updated_at = NOW() WHERE id = $1",
    [jobId],
  );

  // Determine what to deploy based on pattern
  const isApexPattern = job.pattern === 'legacyToApex' ||
    (job.pattern === 'apexFlowConsolidate' && isApexJson(finalMetadata));

  try {
    let deploymentId, deployErrors;

    if (isApexPattern) {
      const { trigger, handler } = JSON.parse(finalMetadata);
      const sourceItems = JSON.parse(job.source_metadata);
      const objectName = sourceItems[0]?.object_name || 'SObject';
      const handlerName = `${objectName.replace(/\W/g, '')}Handler`;
      const triggerName = `${objectName.replace(/\W/g, '')}Trigger`;

      // Store rollback records before deploying
      await storeRollbackIfExists(jobId, job.org_id, 'ApexTrigger', triggerName);
      await storeRollbackIfExists(jobId, job.org_id, 'ApexClass', handlerName);

      await pool.query(
        "UPDATE remediation_jobs SET status = 'deploying', updated_at = NOW() WHERE id = $1",
        [jobId],
      );

      // Deploy trigger
      const triggerDeploy = await deployMetadata(job.org_id, 'ApexTrigger', triggerName, {
        code: trigger,
        objectName,
        apiVersion: '58.0',
      });

      if (triggerDeploy.status !== 'Succeeded') {
        const errMsg = (triggerDeploy.errors || []).join('; ') || 'Apex trigger deploy failed';
        await markFailed(jobId, errMsg);
        return fetchJob(jobId);
      }

      // Deploy handler class
      const classDeploy = await deployMetadata(job.org_id, 'ApexClass', handlerName, {
        code: handler,
        apiVersion: '58.0',
      });

      if (classDeploy.status !== 'Succeeded') {
        const errMsg = (classDeploy.errors || []).join('; ') || 'Apex handler deploy failed';
        // Rollback the already-deployed trigger
        try {
          const { rollbackDeployment } = require('./deploymentService');
          await rollbackDeployment(jobId);
        } catch { /* best-effort */ }
        await markFailed(jobId, errMsg);
        return fetchJob(jobId);
      }

      deploymentId = classDeploy.deploymentId;
      deployErrors = [];
    } else {
      // XML deployment (Flow, WorkflowRule)
      const sourceItems = JSON.parse(job.source_metadata);
      const firstItem = sourceItems[0] || {};
      const metadataType = 'Flow'; // All XML generators produce Flows
      const apiName = `${(firstItem.object_name || 'Object').replace(/\W/g, '')}_Migrated`;

      await storeRollbackIfExists(jobId, job.org_id, metadataType, firstItem.api_name);

      await pool.query(
        "UPDATE remediation_jobs SET status = 'deploying', updated_at = NOW() WHERE id = $1",
        [jobId],
      );

      const deployResult = await deployMetadata(job.org_id, metadataType, apiName, finalMetadata);
      deploymentId = deployResult.deploymentId;
      deployErrors = deployResult.errors || [];

      if (deployResult.status !== 'Succeeded') {
        await markFailed(jobId, deployErrors.join('; ') || 'Deploy failed');
        return fetchJob(jobId);
      }
    }

    // Success
    await pool.query(
      `UPDATE remediation_jobs
       SET status = 'deployed', deployment_id = $1, deployed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [deploymentId, jobId],
    );
  } catch (err) {
    await markFailed(jobId, err.message);
  }

  return fetchJob(jobId);
}

// ── rejectRemediation ─────────────────────────────────────────────────────────

async function rejectRemediation(jobId) {
  await pool.query(
    `UPDATE remediation_jobs
     SET status = 'pending', generated_metadata = NULL, generation_notes = NULL, updated_at = NOW()
     WHERE id = $1`,
    [jobId],
  );
  return fetchJob(jobId);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function storeRollbackIfExists(jobId, orgId, metadataType, apiName) {
  try {
    const original = await retrieveMetadata(orgId, metadataType, apiName);
    if (original) {
      await pool.query(
        `INSERT INTO remediation_rollbacks
           (remediation_job_id, original_metadata, original_type, original_api_name)
         VALUES ($1, $2, $3, $4)`,
        [jobId, original, metadataType, apiName],
      );
    }
  } catch {
    // Metadata may not exist yet (new artifact) — rollback record not needed
  }
}

async function markFailed(jobId, message) {
  await pool.query(
    "UPDATE remediation_jobs SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2",
    [message, jobId],
  );
}

async function fetchJob(jobId) {
  const result = await pool.query('SELECT * FROM remediation_jobs WHERE id = $1', [jobId]);
  return result.rows[0];
}

function isApexJson(str) {
  try {
    const obj = JSON.parse(str);
    return typeof obj === 'object' && ('trigger' in obj || 'handler' in obj);
  } catch {
    return false;
  }
}

module.exports = { initiateRemediation, approveRemediation, rejectRemediation };
