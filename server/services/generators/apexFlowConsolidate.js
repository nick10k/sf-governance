'use strict';

const { XMLBuilder } = require('fast-xml-parser');
const { generateApexFromLegacy } = require('../claudeService');

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '    ',
  suppressEmptyNode: true,
});

// ── Main generator ────────────────────────────────────────────────────────────
// Direction depends on automation_preference:
//   apex_first  → consolidate all logic (Apex + Flow) into Apex trigger + handler
//   flow_first  → generate Flow scaffold (requires_manual_completion = true)

async function generate(items, profile) {
  const objectName = items[0]?.object_name || 'SObject';
  const apexFirst = profile?.automation_preference === 'apex_first';

  if (apexFirst) {
    return generateApexDirection(items, profile, objectName);
  } else {
    return generateFlowDirection(items, objectName);
  }
}

// ── apex_first: extend legacyToApex to include Flow parsed_data ──────────────

async function generateApexDirection(items, profile, objectName) {
  // Pass all items (Apex + Flow) to Claude — it will use llm_summary or parsed_data as logic input
  const result = await generateApexFromLegacy(items, profile);

  if (!result) {
    const handlerName = `${objectName.replace(/\W/g, '')}Handler`;
    return {
      trigger: `// LLM generation unavailable. Implement consolidated trigger for ${objectName}.\ntrigger ${objectName}Trigger on ${objectName} (before insert, before update, after insert, after update) {\n    ${handlerName}.handle(Trigger.new, Trigger.old, Trigger.operationType);\n}`,
      handler: `// LLM generation unavailable. Implement consolidated handler class manually.\npublic class ${handlerName} {\n    public static void handle(List<${objectName}> newRecords, List<${objectName}> oldRecords, TriggerOperation op) {\n        // TODO: consolidate logic from: ${items.map((i) => i.api_name).join(', ')}\n    }\n}`,
      notes: 'LLM generation was unavailable. The stub above requires manual implementation.',
      requiresManual: false,
      conflictWarning: false,
    };
  }

  return {
    trigger: result.trigger,
    handler: result.handler,
    notes: null,
    requiresManual: false,
    conflictWarning: false,
  };
}

// ── flow_first: generate scaffold Flow with comment elements ─────────────────

async function generateFlowDirection(items, objectName) {
  const apexItems = items.filter(
    (i) => i.automation_type === 'Apex Trigger' || i.automation_type === 'Apex Class',
  );
  const flowItems = items.filter((i) => !apexItems.includes(i));

  // Build comment elements describing each source automation's logic
  const textTemplates = [];
  let idx = 0;

  textTemplates.push({
    name: `Scaffold_Header_${idx++}`,
    label: 'SCAFFOLD — Manual completion required before deployment',
    locationX: 176,
    locationY: 50,
    text: 'SCAFFOLD: This Flow was auto-generated from Apex logic. Each step below describes logic that must be manually implemented using Flow elements.',
  });

  for (const item of apexItems) {
    const logicDesc = item.llm_summary || `Apex logic from ${item.api_name} — review source code`;
    textTemplates.push({
      name: `Source_${item.api_name.replace(/\W/g, '_')}_${idx++}`,
      label: `From Apex: ${item.api_name}`,
      locationX: 176,
      locationY: 100 + idx * 60,
      text: `TODO: Implement the following Apex logic as Flow elements:\n${logicDesc}`,
    });
  }

  for (const item of flowItems) {
    textTemplates.push({
      name: `Source_${item.api_name.replace(/\W/g, '_')}_${idx++}`,
      label: `Existing Flow: ${item.api_name}`,
      locationX: 176,
      locationY: 100 + idx * 60,
      text: `Merge or replace logic from existing Flow: ${item.api_name}`,
    });
  }

  const flowObj = {
    Flow: {
      '@_xmlns': 'http://soap.sforce.com/2006/04/metadata',
      apiVersion: 58.0,
      label: `${objectName} Consolidated Flow (Scaffold)`,
      description: `SCAFFOLD: Auto-generated from Apex + Flow consolidation. Requires manual completion before activation. Sources: ${items.map((i) => i.api_name).join(', ')}`,
      processType: 'AutoLaunchedFlow',
      triggerType: 'RecordAfterSave',
      objectType: objectName,
      status: 'Draft',
      textTemplates,
    },
  };

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlBuilder.build(flowObj);

  return {
    xml,
    notes:
      'This is a scaffold only. The Apex logic described in comment elements must be manually implemented as Flow elements before this Flow can be activated. The source Apex trigger will be deactivated upon deployment.',
    requiresManual: true,
    conflictWarning: false,
  };
}

module.exports = { generate };
