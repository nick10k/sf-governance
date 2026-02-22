const TRIGGER_TYPE_MAP = {
  onCreateOnly: 'on create',
  onAllChanges: 'on every save',
  onCreateOrTriggeringUpdate: 'on create or update',
  onLogicalEvaluationTrue: 'when criteria met',
};

function normalizeToArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function parseWorkflowRule(raw) {
  // fullName format: "ObjectName.RuleName"
  const dotIndex = raw.fullName ? raw.fullName.indexOf('.') : -1;
  const objectName = dotIndex >= 0 ? raw.fullName.slice(0, dotIndex) : null;

  const fieldUpdates = normalizeToArray(raw.fieldUpdates);
  const emailAlerts = normalizeToArray(raw.emailAlerts);
  const outboundMessages = normalizeToArray(raw.outboundMessages);
  const tasks = normalizeToArray(raw.tasks);
  const timeTriggers = normalizeToArray(raw.timeTriggers);

  const actionTypes = [
    ...fieldUpdates.map(() => 'Field Update'),
    ...emailAlerts.map(() => 'Email Alert'),
    ...outboundMessages.map(() => 'Outbound Message'),
    ...tasks.map(() => 'Task'),
  ];
  // Capture the specific fields being updated so the engine can detect overlap
  const fieldUpdateFields = [...new Set(fieldUpdates.map((fu) => fu.field).filter(Boolean))];

  // Entry criteria
  const criteriaItems = normalizeToArray(raw.criteriaItems);
  let criteriaType = 'none';
  if (raw.formula) criteriaType = 'formula';
  else if (criteriaItems.length > 0) criteriaType = 'criteriaItems';

  // Detect managed package: namespace prefix on either object or rule name
  const isManagedPackage = /^[a-zA-Z0-9]+__/.test(objectName || '') ||
    (dotIndex >= 0 && /^[a-zA-Z0-9]+__/.test(raw.fullName.slice(dotIndex + 1)));

  return {
    automation_type: 'Workflow Rule',
    object_name: objectName,
    trigger_events: TRIGGER_TYPE_MAP[raw.triggerType] || raw.triggerType || null,
    is_active: raw.active === 'true',
    has_description: !!(raw.description && raw.description.trim()),
    is_managed_package: isManagedPackage,
    parsed_data: {
      triggerType: raw.triggerType || null,
      active: raw.active,
      actionTypes: [...new Set(actionTypes)],
      fieldUpdateFields,
      fieldUpdateCount: fieldUpdates.length,
      emailAlertCount: emailAlerts.length,
      outboundMessageCount: outboundMessages.length,
      taskCount: tasks.length,
      timeTriggerCount: timeTriggers.length,
      criteriaType,
      criteriaFormula: raw.formula || null,
      criteriaItems: criteriaItems.map((c) => ({
        field: c.field || null,
        operator: c.operator || null,
        value: c.value || null,
      })),
      booleanFilter: raw.booleanFilter || null,
    },
  };
}

module.exports = { parseWorkflowRule };
