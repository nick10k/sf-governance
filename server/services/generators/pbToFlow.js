'use strict';

const { XMLBuilder } = require('fast-xml-parser');

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '    ',
  suppressEmptyNode: true,
});

// ── Main generator ────────────────────────────────────────────────────────────
// Process Builders (processType=Workflow) are stored as Flow XML in Salesforce.
// Their parsed_data is already the Flow schema as JSONB. We read from parsed_data,
// not raw XML — this is intentionally different from wfrToFlow.js.

function generate(item) {
  const parsed = item.parsed_data || {};
  const raw = item.raw_json || {};
  const apiName = item.api_name || '';
  const isActive = item.is_active !== false;

  // Extract object type from processMetadataValues
  const metaValues = asArray(parsed.processMetadataValues);
  const objectTypeMeta = metaValues.find((v) => v.name === 'ObjectType');
  const objectName =
    item.object_name ||
    objectTypeMeta?.value?.stringValue ||
    '';

  const skippedReasons = [];

  // Decisions (criteria nodes) → Decision elements
  const decisions = asArray(parsed.decisions).map((d) => ({
    name: d.name || 'Decision',
    label: d.label || d.name || 'Decision',
    locationX: 176,
    locationY: 350,
    defaultConnectorLabel: 'Default Outcome',
    rules: asArray(d.rules).map((r) => ({
      name: r.name || 'Rule',
      label: r.label || r.name || 'Rule',
      conditionLogic: r.conditionLogic || 'and',
      conditions: asArray(r.conditions).map((c) => ({
        leftValueReference: c.leftValueReference || '',
        operator: c.operator || 'EqualTo',
        rightValue: c.rightValue || {},
      })),
      connector: r.connector || {},
    })),
  }));

  // Record updates → Update Records elements
  const recordUpdates = asArray(parsed.recordUpdates).map((u) => ({
    name: u.name || 'Update',
    label: u.label || u.name || 'Update Records',
    locationX: 176,
    locationY: 500,
    filterLogic: u.filterLogic || 'no_conditions',
    filters: asArray(u.filters),
    inputAssignments: asArray(u.inputAssignments),
    object: objectName,
  }));

  // Record creates → Create Records elements
  const recordCreates = asArray(parsed.recordCreates).map((c) => ({
    name: c.name || 'Create',
    label: c.label || c.name || 'Create Records',
    locationX: 176,
    locationY: 650,
    inputAssignments: asArray(c.inputAssignments),
    object: c.object || objectName,
  }));

  // Flag unsupported action types
  const apexActions = asArray(parsed.apexPluginCalls);
  const platformEvents = asArray(parsed.recordLookups).filter((l) => l.storeOutputAutomatically);
  if (apexActions.length > 0) {
    skippedReasons.push(`${apexActions.length} Apex plugin call(s) require manual migration`);
  }

  const notes = skippedReasons.length > 0
    ? `Could not auto-migrate: ${skippedReasons.join('; ')}. Review generated stub before deployment.`
    : null;

  const flowObj = {
    Flow: {
      '@_xmlns': 'http://soap.sforce.com/2006/04/metadata',
      apiVersion: 58.0,
      description: notes
        ? `Migrated from Process Builder: ${apiName}. NOTE: ${notes}`
        : `Migrated from Process Builder: ${apiName}`,
      label: `${apiName} (Migrated)`,
      processType: 'AutoLaunchedFlow',
      triggerType: 'RecordAfterSave',
      objectType: objectName,
      status: isActive ? 'Active' : 'Draft',
      ...(decisions.length > 0 ? { decisions } : {}),
      ...(recordUpdates.length > 0 ? { recordUpdates } : {}),
      ...(recordCreates.length > 0 ? { recordCreates } : {}),
    },
  };

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlBuilder.build(flowObj);

  return { xml, notes };
}

function asArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

module.exports = { generate };
