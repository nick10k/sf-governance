'use strict';

const { generateApexFromLegacy } = require('../claudeService');

// ── Main generator ────────────────────────────────────────────────────────────
// Uses Claude as the primary generator — outputs Apex code, not XML.
// Returns { trigger, handler, notes } where trigger and handler are Apex source strings.

async function generate(items, profile) {
  const result = await generateApexFromLegacy(items, profile);

  if (!result) {
    const objectName = items[0]?.object_name || 'SObject';
    const handlerName = `${objectName.replace(/\W/g, '')}Handler`;
    // Return a stub that makes the generation failure explicit
    return {
      trigger: `// LLM generation unavailable. Implement trigger for ${objectName} manually.\ntrigger ${objectName}Trigger on ${objectName} (before insert, before update, after insert, after update) {\n    ${handlerName}.handle(Trigger.new, Trigger.old, Trigger.operationType);\n}`,
      handler: `// LLM generation unavailable. Implement handler class for ${objectName} manually.\npublic class ${handlerName} {\n    public static void handle(List<${objectName}> newRecords, List<${objectName}> oldRecords, TriggerOperation op) {\n        // TODO: implement logic from: ${items.map((i) => i.api_name).join(', ')}\n    }\n}`,
      notes: 'LLM generation was unavailable. The stub above requires manual implementation.',
    };
  }

  return { trigger: result.trigger, handler: result.handler, notes: null };
}

module.exports = { generate };
