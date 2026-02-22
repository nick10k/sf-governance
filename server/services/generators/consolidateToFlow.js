'use strict';

const { XMLBuilder } = require('fast-xml-parser');
const { reviewConsolidatedFlow } = require('../claudeService');

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '    ',
  suppressEmptyNode: true,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function asArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

// Extract field updates from a source automation item
function extractFieldUpdates(item) {
  const raw = item.raw_json || {};
  const parsed = item.parsed_data || {};
  const type = item.automation_type;

  if (type === 'Workflow Rule') {
    const actions = asArray(raw.actions);
    return actions
      .filter((a) => a.type === 'FieldUpdate' || a.field)
      .map((a) => ({
        field: a.field || '',
        value: a.newValue || '',
        source: item.api_name,
        context: 'before_save',
      }));
  }

  if (type === 'Process Builder') {
    return asArray(parsed.recordUpdates).flatMap((u) =>
      asArray(u.inputAssignments).map((ia) => ({
        field: ia.field || '',
        value: JSON.stringify(ia.value || {}),
        source: item.api_name,
        context: 'after_save',
      })),
    );
  }

  if (type === 'Record-Triggered Flow') {
    return asArray(parsed.recordUpdates).flatMap((u) =>
      asArray(u.inputAssignments).map((ia) => ({
        field: ia.field || '',
        value: JSON.stringify(ia.value || {}),
        source: item.api_name,
        context: parsed.triggerType === 'RecordBeforeSave' ? 'before_save' : 'after_save',
      })),
    );
  }

  return [];
}

// Detect field conflicts across sources
function detectConflicts(allUpdates) {
  const seen = new Map();
  const conflicts = [];
  for (const u of allUpdates) {
    const key = `${u.field}::${u.context}`;
    if (seen.has(key)) {
      conflicts.push({ field: u.field, sourceA: seen.get(key), sourceB: u.source });
    } else {
      seen.set(key, u.source);
    }
  }
  return conflicts;
}

// Build textTemplate comment element
function commentElement(text, idx) {
  return {
    name: `Comment_${idx}`,
    label: text,
    locationX: 176,
    locationY: 100 + idx * 50,
    text,
  };
}

// Build recordUpdate element from a source field update
function buildRecordUpdate(update, objectName, idx) {
  return {
    name: `Update_${update.source.replace(/\W/g, '_')}_${idx}`,
    label: `${update.source}: Update ${update.field}`,
    locationX: 176,
    locationY: 300 + idx * 100,
    filterLogic: 'no_conditions',
    inputAssignments: {
      field: update.field,
      value: { stringValue: update.value },
    },
    object: objectName,
  };
}

// ── Main generator ────────────────────────────────────────────────────────────

async function generate(items) {
  if (!items || items.length === 0) {
    return { xml: '', notes: 'No source automations provided.', conflictWarning: false, requiresManual: false };
  }

  const objectName = items[0].object_name || '';

  // Sequencing order per spec
  const ORDER = ['Workflow Rule', 'Process Builder', 'Record-Triggered Flow'];
  const sorted = [...items].sort((a, b) => {
    const ai = ORDER.indexOf(a.automation_type);
    const bi = ORDER.indexOf(b.automation_type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // Collect all field updates for conflict detection
  const allUpdates = sorted.flatMap(extractFieldUpdates);
  const conflicts = detectConflicts(allUpdates);
  const conflictWarning = conflicts.length > 0;

  // Build textTemplate elements (comments) and recordUpdates in sequenced groups
  const textTemplates = [];
  const recordUpdates = [];
  let commentIdx = 0;
  let updateIdx = 0;

  for (const item of sorted) {
    // Source header comment
    textTemplates.push(
      commentElement(`--- Source: ${item.api_name} (${item.automation_type}) ---`, commentIdx++),
    );

    const updates = extractFieldUpdates(item);
    for (const u of updates) {
      recordUpdates.push(buildRecordUpdate(u, objectName, updateIdx++));
    }
  }

  // Conflict comment elements
  for (const c of conflicts) {
    textTemplates.push(
      commentElement(
        `CONFLICT: Both ${c.sourceA} and ${c.sourceB} update ${c.field}. Review required before deployment.`,
        commentIdx++,
      ),
    );
  }

  const flowObj = {
    Flow: {
      '@_xmlns': 'http://soap.sforce.com/2006/04/metadata',
      apiVersion: 58.0,
      label: `${objectName} Consolidated Flow`,
      description: `Consolidated from: ${sorted.map((i) => i.api_name).join(', ')}`,
      processType: 'AutoLaunchedFlow',
      triggerType: 'RecordAfterSave',
      objectType: objectName,
      status: 'Draft',
      ...(textTemplates.length > 0 ? { textTemplates } : {}),
      ...(recordUpdates.length > 0 ? { recordUpdates } : {}),
    },
  };

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlBuilder.build(flowObj);

  // Ask Claude to review the consolidated output
  let notes = null;
  try {
    notes = await reviewConsolidatedFlow(sorted, xml);
  } catch {
    notes = null;
  }

  return { xml, notes, conflictWarning, requiresManual: false };
}

module.exports = { generate };
