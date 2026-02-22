'use strict';

const { XMLBuilder } = require('fast-xml-parser');

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '    ',
  suppressEmptyNode: true,
});

// ── Operator mapping ──────────────────────────────────────────────────────────

const WFR_OPERATOR_MAP = {
  equals: 'EqualTo',
  notEqual: 'NotEqualTo',
  greaterThan: 'GreaterThan',
  greaterThanOrEqualTo: 'GreaterThanOrEqualTo',
  lessThan: 'LessThan',
  lessThanOrEqualTo: 'LessThanOrEqualTo',
  contains: 'Contains',
  notContain: 'NotContain',
  startsWith: 'StartsWith',
  null: 'IsNull',
};

function mapOperator(op) {
  return WFR_OPERATOR_MAP[op] || 'EqualTo';
}

// ── Entry conditions from WFR criteria ───────────────────────────────────────

function buildConditions(criteriaItems = []) {
  if (!criteriaItems || criteriaItems.length === 0) return [];
  const items = Array.isArray(criteriaItems) ? criteriaItems : [criteriaItems];
  return items.map((c, idx) => ({
    conditionLogic: 'and',
    conditions: {
      leftValueReference: c.field || '',
      operator: mapOperator(c.operator),
      rightValue: { stringValue: c.value || '' },
    },
  }));
}

// ── recordUpdates from FieldUpdate actions ────────────────────────────────────

function buildRecordUpdate(action, objectName) {
  return {
    name: `Update_${(action.name || 'Field').replace(/\W/g, '_')}`,
    label: action.name || 'Update Field',
    locationX: 176,
    locationY: 350,
    filterLogic: 'no_conditions',
    inputAssignments: {
      field: action.field || '',
      value: { stringValue: action.newValue || '' },
    },
    object: objectName || '',
  };
}

// ── Main generator ────────────────────────────────────────────────────────────

function generate(item) {
  const raw = item.raw_json || {};
  const objectName = item.object_name || raw.object || raw.tableName || '';
  const apiName = item.api_name || '';
  const isActive = item.is_active !== false;

  const actions = Array.isArray(raw.actions)
    ? raw.actions
    : raw.actions
    ? [raw.actions]
    : [];

  const fieldUpdates = actions.filter(
    (a) => a.type === 'FieldUpdate' || a['@_type'] === 'FieldUpdate' || a.field,
  );
  const skippedActions = actions.filter((a) => {
    const t = a.type || a['@_type'] || '';
    return t === 'Alert' || t === 'OutboundMessage' || t === 'Task' || t === 'Send';
  });

  const skippedTypes = [...new Set(skippedActions.map((a) => a.type || a['@_type'] || 'Unknown'))];
  const notes =
    skippedTypes.length > 0
      ? `The following action types were not migrated and require manual implementation: ${skippedTypes.join(', ')}.`
      : null;

  const conditions = buildConditions(raw.criteriaItems);
  const recordUpdates = fieldUpdates.map((a) => buildRecordUpdate(a, objectName));

  // Determine trigger type: field-only updates → RecordBeforeSave; otherwise RecordAfterSave
  const triggerType = fieldUpdates.length > 0 && skippedActions.length === 0
    ? 'RecordBeforeSave'
    : 'RecordAfterSave';

  const flowObj = {
    Flow: {
      '@_xmlns': 'http://soap.sforce.com/2006/04/metadata',
      apiVersion: 58.0,
      description: notes
        ? `Migrated from Workflow Rule: ${apiName}. NOTE: ${notes}`
        : `Migrated from Workflow Rule: ${apiName}`,
      label: `${apiName} (Migrated)`,
      processType: 'AutoLaunchedFlow',
      status: isActive ? 'Active' : 'Draft',
      triggerType,
      objectType: objectName,
      ...(conditions.length > 0 ? { start: { filterLogic: 'and', filters: conditions } } : {}),
      ...(recordUpdates.length > 0 ? { recordUpdates } : {}),
    },
  };

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlBuilder.build(flowObj);

  return { xml, notes };
}

module.exports = { generate };
