const PROCESS_TYPE_MAP = {
  Flow: 'Screen Flow',
  Workflow: 'Process Builder',
  InvocableProcess: 'Process Builder',
};

const TRIGGER_TYPE_MAP = {
  RecordBeforeSave: 'before save',
  RecordAfterSave: 'after save',
  RecordBeforeDelete: 'before delete',
  Scheduled: 'scheduled',
};

function normalizeToArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

/**
 * Collects all field API names written by recordUpdates.
 * Works for both Process Builder and Record-Triggered Flows.
 */
function extractFieldUpdateFields(raw) {
  const fields = [];
  for (const update of normalizeToArray(raw.recordUpdates)) {
    for (const assignment of normalizeToArray(update.inputAssignments)) {
      if (assignment.field) fields.push(assignment.field);
    }
  }
  return [...new Set(fields)];
}

/**
 * Derives a human-readable list of action categories from a flow's elements.
 */
function extractActionTypes(raw) {
  const types = new Set();
  if (normalizeToArray(raw.recordUpdates).length > 0)    types.add('Record Update');
  if (normalizeToArray(raw.recordCreates).length > 0)    types.add('Record Create');
  if (normalizeToArray(raw.recordDeletes).length > 0)    types.add('Record Delete');
  if (normalizeToArray(raw.recordLookups).length > 0)    types.add('Record Lookup');
  if (normalizeToArray(raw.subflows).length > 0)         types.add('Subflow');
  for (const call of normalizeToArray(raw.actionCalls)) {
    if (call.actionType === 'emailAlert')            types.add('Email Alert');
    else if (call.actionType === 'quickAction')      types.add('Quick Action');
    else if (call.actionType === 'apex')             types.add('Apex Action');
    else if (call.actionType === 'externalService')  types.add('External Service');
    else if (call.actionType)                        types.add(call.actionType);
  }
  return [...types];
}

function extractSubflowNames(raw) {
  return normalizeToArray(raw.subflows)
    .map((s) => s.flowName)
    .filter(Boolean);
}

function parseFlow(raw) {
  const processType = raw.processType || '';
  const start = raw.start || {};

  let automationType;
  if (PROCESS_TYPE_MAP[processType]) {
    automationType = PROCESS_TYPE_MAP[processType];
  } else if (processType === 'AutoLaunchedFlow') {
    automationType = start.triggerType ? 'Record-Triggered Flow' : 'Autolaunched Flow';
  } else {
    automationType = processType || 'Flow';
  }

  const isProcessBuilder = processType === 'Workflow' || processType === 'InvocableProcess';
  const isRecordTriggeredFlow = processType === 'AutoLaunchedFlow' && !!start.triggerType;

  const fieldUpdateFields = extractFieldUpdateFields(raw);
  const actionTypes = extractActionTypes(raw);
  const subflowNames = extractSubflowNames(raw);

  const parsedData = {
    processType,
    triggerType: start.triggerType || null,
    status: raw.status,
    fieldUpdateFields,
    actionTypes,
    callsSubflows: subflowNames.length > 0,
    ...(subflowNames.length > 0 && { subflowNames }),
  };

  if (isProcessBuilder) {
    parsedData.criteriaCount = normalizeToArray(raw.decisions).length;
    parsedData.hasScheduledActions = normalizeToArray(raw.waits).length > 0;
    parsedData.recordUpdateCount = normalizeToArray(raw.recordUpdates).length;
  }

  if (isRecordTriggeredFlow) {
    parsedData.entryFilterLogic = start.filterLogic || null;
    parsedData.hasScheduledPaths = normalizeToArray(start.scheduledPaths).length > 0;
  }

  return {
    automation_type: automationType,
    object_name: start.object || null,
    trigger_events: TRIGGER_TYPE_MAP[start.triggerType] || null,
    is_active: raw.status === 'Active',
    has_description: !!(raw.description && raw.description.trim()),
    is_managed_package: /^[a-zA-Z0-9]+__/.test(raw.fullName || ''),
    parsed_data: parsedData,
  };
}

module.exports = { parseFlow };
