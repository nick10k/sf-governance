'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEPRECATED_TYPES = new Set(['Workflow Rule', 'Process Builder']);
const MODERN_FLOW_TYPES = new Set(['Record-Triggered Flow']);
const APEX_TYPES = new Set(['Apex Trigger']);

// ─────────────────────────────────────────────────────────────────────────────
// Order of Execution Audit
// Models Salesforce's documented execution sequence for record-triggered
// automations and detects specific risks from the static metadata.
//
// Phases (lower = fires earlier):
//   1 Before-save Flow  — RecordBeforeSave; fires before Apex triggers
//   2 Apex before       — before insert / update / delete
//   3 Apex after        — after insert / update / delete
//   4 Workflow Rule     — after-save; field updates re-save → re-fires 1–3
//   5 Process Builder   — after workflow rules; record updates may re-trigger
//   6 After-save Flow   — RecordAfterSave; fires last
// ─────────────────────────────────────────────────────────────────────────────

const PHASE = {
  BEFORE_FLOW:     1,
  APEX_BEFORE:     2,
  APEX_AFTER:      3,
  WORKFLOW_RULE:   4,
  PROCESS_BUILDER: 5,
  AFTER_FLOW:      6,
};

const PHASE_LABEL = {
  [PHASE.BEFORE_FLOW]:     'Before-save Flow',
  [PHASE.APEX_BEFORE]:     'Apex before trigger',
  [PHASE.APEX_AFTER]:      'Apex after trigger',
  [PHASE.WORKFLOW_RULE]:   'Workflow Rule (after save)',
  [PHASE.PROCESS_BUILDER]: 'Process Builder (after save)',
  [PHASE.AFTER_FLOW]:      'After-save Flow',
};

/**
 * Returns the execution phase(s) for one automation_inventory row.
 * An Apex Trigger that covers both before and after events appears in two phases.
 */
function getExecutionPhases(item) {
  if (item.automation_type === 'Workflow Rule') return [PHASE.WORKFLOW_RULE];
  if (item.automation_type === 'Process Builder') return [PHASE.PROCESS_BUILDER];
  if (MODERN_FLOW_TYPES.has(item.automation_type)) {
    return item.parsed_data?.triggerType === 'RecordBeforeSave'
      ? [PHASE.BEFORE_FLOW]
      : [PHASE.AFTER_FLOW];
  }
  if (APEX_TYPES.has(item.automation_type)) {
    const events = item.parsed_data?.events || [];
    const phases = [];
    if (events.some((e) => e.startsWith('before'))) phases.push(PHASE.APEX_BEFORE);
    if (events.some((e) => e.startsWith('after')))  phases.push(PHASE.APEX_AFTER);
    return phases.length ? phases : [PHASE.APEX_BEFORE];
  }
  return [];
}

/**
 * Performs a static order-of-execution audit for active automations on one object.
 * Returns { sequence, risks } where:
 *   sequence — ordered array of { name, type, phase, phaseLabel }
 *   risks    — array of { type, severity, text } for specific detected issues
 */
function auditOrderOfExecution(activeItems) {
  // Build one entry per item per phase, sorted phase → api_name
  const entries = [];
  for (const item of activeItems) {
    for (const phase of getExecutionPhases(item)) {
      entries.push({ item, phase });
    }
  }
  entries.sort((a, b) => a.phase - b.phase || a.item.api_name.localeCompare(b.item.api_name));

  const byPhase = {};
  for (const e of entries) {
    (byPhase[e.phase] = byPhase[e.phase] || []).push(e);
  }

  const risks = [];

  // Risk: multiple Apex triggers in the same phase → undefined execution order
  for (const phase of [PHASE.APEX_BEFORE, PHASE.APEX_AFTER]) {
    const group = byPhase[phase] || [];
    if (group.length >= 2) {
      const names = group.map((e) => `"${e.item.api_name}"`).join(' and ');
      const label = phase === PHASE.APEX_BEFORE ? 'before' : 'after';
      risks.push({
        type: 'undefined_order',
        severity: 'high',
        text:
          `⚠ Undefined order: ${names} are both ${label}-trigger Apex triggers — ` +
          `Salesforce does not guarantee which fires first. Consolidate into a single trigger handler.`,
      });
    }
  }

  // Risk: multiple Flows in the same phase → alphabetical order (fragile)
  for (const phase of [PHASE.BEFORE_FLOW, PHASE.AFTER_FLOW]) {
    const group = byPhase[phase] || [];
    if (group.length >= 2) {
      const label = phase === PHASE.BEFORE_FLOW ? 'before-save' : 'after-save';
      const sortedNames = group.map((e) => e.item.api_name).sort();
      risks.push({
        type: 'flow_order',
        severity: 'warning',
        text:
          `⚠ Flow order: multiple ${label} Flows fire alphabetically ` +
          `(${sortedNames.map((n) => `"${n}"`).join(' → ')}) — verify this is intentional if they share fields.`,
      });
    }
  }

  // Risk: Workflow Rule field updates re-save the record → Apex triggers re-fire
  const apexEntries = [
    ...(byPhase[PHASE.APEX_BEFORE] || []),
    ...(byPhase[PHASE.APEX_AFTER] || []),
  ];
  const wfrWithUpdates = (byPhase[PHASE.WORKFLOW_RULE] || []).filter(
    (e) => (e.item.parsed_data?.fieldUpdateFields || []).length > 0,
  );
  if (wfrWithUpdates.length > 0 && apexEntries.length > 0) {
    const wfrNames = [...new Set(wfrWithUpdates.map((e) => `"${e.item.api_name}"`))].join(', ');
    const apexNames = [...new Set(apexEntries.map((e) => `"${e.item.api_name}"`))].join(', ');
    const fields = [...new Set(wfrWithUpdates.flatMap((e) => e.item.parsed_data.fieldUpdateFields))];
    const fieldList =
      fields.slice(0, 3).map((f) => `"${f}"`).join(', ') +
      (fields.length > 3 ? ` and ${fields.length - 3} more` : '');
    risks.push({
      type: 'retrigger_risk',
      severity: 'high',
      text:
        `⚠ Re-trigger: ${wfrNames} ${wfrWithUpdates.length === 1 ? 'updates' : 'update'} ` +
        `${fieldList}, re-saving the record and re-firing ${apexNames}. Confirm the trigger has a recursion guard.`,
    });
  }

  // Risk: Process Builder + Apex coexistence
  // If the PB parser captured fieldUpdateFields, show a specific risk; otherwise show a soft warning.
  const pbEntries = byPhase[PHASE.PROCESS_BUILDER] || [];
  if (pbEntries.length > 0 && apexEntries.length > 0) {
    const pbWithUpdates = pbEntries.filter(
      (e) => (e.item.parsed_data?.fieldUpdateFields || []).length > 0,
    );
    const apexNames = [...new Set(apexEntries.map((e) => `"${e.item.api_name}"`))].join(', ');

    if (pbWithUpdates.length > 0) {
      const pbNames = pbWithUpdates.map((e) => `"${e.item.api_name}"`).join(', ');
      const fields = [...new Set(pbWithUpdates.flatMap((e) => e.item.parsed_data.fieldUpdateFields))];
      const fieldList =
        fields.slice(0, 3).map((f) => `"${f}"`).join(', ') +
        (fields.length > 3 ? ` and ${fields.length - 3} more` : '');
      risks.push({
        type: 'pb_retrigger',
        severity: 'warning',
        text:
          `⚠ Re-trigger: ${pbNames} updates ${fieldList}, which may re-save the record and re-fire ${apexNames}. Confirm a recursion guard is in place.`,
      });
    } else {
      // PB exists but no field-update data (e.g. scanned before parser enhancement)
      const pbNames = pbEntries.map((e) => `"${e.item.api_name}"`).join(', ');
      risks.push({
        type: 'pb_retrigger',
        severity: 'warning',
        text:
          `⚠ Re-trigger: if ${pbNames} ${pbEntries.length === 1 ? 'updates' : 'update'} ` +
          `this object's fields, ${apexNames} will re-fire. Confirm a recursion guard is in place.`,
      });
    }
  }

  // Risk: same field written by automations in different phases → "last wins" conflict
  const fieldPhaseMap = {};
  for (const e of entries) {
    for (const field of e.item.parsed_data?.fieldUpdateFields || []) {
      (fieldPhaseMap[field] = fieldPhaseMap[field] || []).push(e);
    }
  }
  for (const [field, writers] of Object.entries(fieldPhaseMap)) {
    if (writers.length < 2) continue;
    const sortedWriters = [...writers].sort((a, b) => a.phase - b.phase);
    const winner = sortedWriters[sortedWriters.length - 1];
    const writerList = sortedWriters
      .map((e) => `"${e.item.api_name}" (${PHASE_LABEL[e.phase]})`)
      .join(', ');
    risks.push({
      type: 'field_conflict',
      severity: 'warning',
      text:
        `⚠ Field conflict on "${field}": ${writerList}. ` +
        `"${winner.item.api_name}" fires last and wins — verify this is intentional.`,
    });
  }

  const sequence = entries.map((e) => ({
    name: e.item.api_name,
    type: e.item.automation_type,
    phase: e.phase,
    phaseLabel: PHASE_LABEL[e.phase],
  }));

  return { sequence, risks };
}

/**
 * Formats an execution sequence as a human-readable multi-line step string.
 * Returns null when there is only one automation (no ordering to describe).
 */
function formatSequenceStep(sequence) {
  if (sequence.length <= 1) return null;
  const lines = sequence.map((s, i) => `  ${i + 1}. ${s.name} (${s.phaseLabel})`).join('\n');
  return `Order of execution on this object (earliest \u2192 latest):\n${lines}`;
}

// Recommended and alternative paths per pattern × automation_preference
const PATTERN_PATHS = {
  deprecated_only: {
    flow_first: {
      recommended: 'Migrate all deprecated automation to a single Record-Triggered Flow',
      alternative: 'Consolidate into a new Apex Trigger handler',
    },
    apex_first: {
      recommended: 'Consolidate all deprecated automation into a new Apex Trigger handler',
      alternative: 'Migrate to a Record-Triggered Flow',
    },
    balanced: {
      recommended: 'Migrate all deprecated automation to a Record-Triggered Flow',
      alternative: 'Consolidate into a new Apex Trigger handler',
    },
  },
  deprecated_plus_flow: {
    flow_first: {
      recommended: 'Consolidate existing Flows, then migrate deprecated automation into the unified Flow',
      alternative: 'Migrate everything to a single Apex Trigger handler',
    },
    apex_first: {
      recommended: 'Consolidate all automation (deprecated + Flows) into a single Apex Trigger handler',
      alternative: 'Consolidate Flows and migrate deprecated automation into a unified Flow',
    },
    balanced: {
      recommended: 'Consolidate Flows, then migrate deprecated automation into the unified Flow',
      alternative: 'Evaluate whether Apex or Flow is the better long-term consolidation target',
    },
  },
  deprecated_plus_apex: {
    flow_first: {
      recommended: 'Migrate deprecated automation to a new Flow; evaluate whether Apex logic can also move to Flow',
      alternative: 'Consolidate deprecated automation into the existing Apex Trigger handler',
    },
    apex_first: {
      recommended: 'Consolidate deprecated automation into the existing Apex Trigger handler',
      alternative: 'Migrate deprecated automation to a new Flow alongside the existing Apex Trigger',
    },
    balanced: {
      recommended: 'Migrate deprecated automation to a Flow; keep Apex only for operations that require it',
      alternative: 'Consolidate all into the existing Apex Trigger handler',
    },
  },
  deprecated_plus_mixed: {
    flow_first: {
      recommended: 'Consolidate all automation into a single Record-Triggered Flow where feasible; keep Apex only for operations requiring it',
      alternative: 'Consolidate all into a single Apex Trigger handler pattern',
    },
    apex_first: {
      recommended: 'Consolidate all automation into a single Apex Trigger handler pattern',
      alternative: 'Migrate simple logic to a Flow; consolidate complex logic in Apex',
    },
    balanced: {
      recommended: 'Segregate responsibilities: keep Apex for complex operations, consolidate simple logic into a Flow',
      alternative: 'Consolidate all into a single Apex Trigger handler',
    },
  },
  flow_fragmented: {
    flow_first: {
      recommended: 'Merge all Record-Triggered Flows into a single Flow using Decision elements',
      alternative: 'Consolidate all Flow logic into a single Apex Trigger handler',
    },
    apex_first: {
      recommended: 'Consolidate all Flow logic into a single Apex Trigger handler',
      alternative: 'Merge all Flows into a single Flow using Decision elements',
    },
    balanced: {
      recommended: 'Merge all Record-Triggered Flows into a single Flow using Decision elements',
      alternative: 'Consolidate into a single Apex Trigger handler',
    },
  },
  apex_fragmented: {
    flow_first: {
      recommended: 'Consolidate triggers into a single handler pattern; evaluate migrating simple logic to a Flow',
      alternative: 'Consolidate into a single Apex Trigger handler pattern',
    },
    apex_first: {
      recommended: 'Consolidate multiple Apex Triggers into a single trigger handler pattern',
      alternative: 'Evaluate migrating simpler trigger logic to a Flow',
    },
    balanced: {
      recommended: 'Consolidate multiple Apex Triggers into a single trigger handler pattern',
      alternative: 'Evaluate migrating simpler logic to a Flow after consolidation',
    },
  },
  flow_and_apex: {
    flow_first: {
      recommended: 'Evaluate migrating Apex Trigger logic into the existing Flow; document the coexistence if Apex must remain',
      alternative: 'Consolidate all logic into the Apex Trigger handler',
    },
    apex_first: {
      recommended: 'Evaluate migrating Flow logic into the Apex Trigger handler; document the coexistence if the Flow must remain',
      alternative: 'Keep the Flow and add explicit dependency documentation to both automations',
    },
    balanced: {
      recommended: 'Document the coexistence explicitly in both automations; evaluate consolidating into whichever type handles the majority of the logic',
      alternative: null,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function nameList(items) {
  return items.map((i) => `"${i.api_name}"`).join(', ');
}

function plural(n, word) {
  return `${n} ${word}${n !== 1 ? 's' : ''}`;
}

function computeScore(severity, affectedCount, effort) {
  const severityScore = { error: 100, warning: 50, info: 10 };
  const effortPenalty = { low: 0, medium: 10, high: 25 };
  return (severityScore[severity] || 10) + affectedCount * 5 - (effortPenalty[effort] || 10);
}

function estimateEffort(pattern, itemCount) {
  if (pattern === 'deprecated_plus_mixed' || pattern === 'apex_fragmented') return 'high';
  if (itemCount > 5) return 'high';
  if (['deprecated_only', 'deprecated_plus_flow', 'deprecated_plus_apex'].includes(pattern)) {
    return itemCount > 2 ? 'high' : 'medium';
  }
  if (pattern === 'flow_fragmented' || pattern === 'flow_and_apex') return 'medium';
  return 'low';
}

function worstSeverity(findings) {
  const order = { error: 0, warning: 1, info: 2 };
  let best = 2;
  for (const f of findings) {
    const rank = order[f.severity] ?? 2;
    if (rank < best) best = rank;
  }
  return ['error', 'warning', 'info'][best];
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Normalization
// Reduces automation-specific event strings to canonical: 'before save' |
// 'after save' | 'before delete' for cross-type comparison.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeEvents(item) {
  const type = item.automation_type;
  if (DEPRECATED_TYPES.has(type)) return ['after save'];
  if (MODERN_FLOW_TYPES.has(type)) return item.trigger_events ? [item.trigger_events] : [];
  if (APEX_TYPES.has(type)) {
    const events = item.parsed_data?.events || [];
    const result = new Set();
    for (const e of events) {
      if (e.includes('insert') || e.includes('update') || e.includes('undelete')) {
        result.add(e.startsWith('before') ? 'before save' : 'after save');
      }
      if (e.includes('delete')) result.add('before delete');
    }
    return [...result];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlap Detection
// Detects: (a) field-level write conflicts across WFRs and (b) trigger event
// overlap across all active automation types on the same object.
// Only runs on active items — inactive automation is not a consolidation concern.
// ─────────────────────────────────────────────────────────────────────────────

function detectOverlaps(activeItems) {
  const fieldOverlaps = [];
  const eventOverlaps = [];

  // Field update overlap (WFRs with parsed fieldUpdateFields)
  const fieldMap = {};
  for (const item of activeItems) {
    for (const field of item.parsed_data?.fieldUpdateFields || []) {
      if (!fieldMap[field]) fieldMap[field] = [];
      fieldMap[field].push(item.api_name);
    }
  }
  for (const [field, names] of Object.entries(fieldMap)) {
    if (names.length > 1) fieldOverlaps.push({ field, automations: names });
  }

  // Trigger event overlap across all types
  const eventMap = {};
  for (const item of activeItems) {
    for (const event of normalizeEvents(item)) {
      if (!eventMap[event]) eventMap[event] = [];
      eventMap[event].push({ api_name: item.api_name, type: item.automation_type });
    }
  }
  for (const [event, autos] of Object.entries(eventMap)) {
    if (autos.length > 1) eventOverlaps.push({ event, automations: autos });
  }

  return { fieldOverlaps, eventOverlaps };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stack Classification
// Inspects the active automation types on an object and returns the pattern
// that best describes the consolidation challenge.
// ─────────────────────────────────────────────────────────────────────────────

function classifyStack(activeItems) {
  const hasDeprecated = activeItems.some((i) => DEPRECATED_TYPES.has(i.automation_type));
  const hasFlow = activeItems.some((i) => MODERN_FLOW_TYPES.has(i.automation_type));
  const hasApex = activeItems.some((i) => APEX_TYPES.has(i.automation_type));

  if (hasDeprecated && hasFlow && hasApex) return 'deprecated_plus_mixed';
  if (hasDeprecated && hasFlow) return 'deprecated_plus_flow';
  if (hasDeprecated && hasApex) return 'deprecated_plus_apex';
  if (hasDeprecated) return 'deprecated_only';

  // No deprecated automation below this line
  const flowItems = activeItems.filter((i) => MODERN_FLOW_TYPES.has(i.automation_type));
  const apexItems = activeItems.filter((i) => APEX_TYPES.has(i.automation_type));

  if (flowItems.length > 0 && apexItems.length > 0) return 'flow_and_apex';
  if (apexItems.length > 1) return 'apex_fragmented';

  if (flowItems.length > 1) {
    // Only flag fragmentation when flows share the same trigger event
    const eventCounts = {};
    for (const f of flowItems) {
      const events = normalizeEvents(f);
      for (const e of events) {
        eventCounts[e] = (eventCounts[e] || 0) + 1;
      }
    }
    if (Object.values(eventCounts).some((c) => c > 1)) return 'flow_fragmented';
  }

  return 'clean';
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlap Warning Lines
// Formats overlap findings into step-level warning text.
// ─────────────────────────────────────────────────────────────────────────────

function buildOverlapWarnings(overlaps) {
  const warnings = [];
  for (const { field, automations } of overlaps.fieldOverlaps) {
    warnings.push(
      `⚠ Potential logic conflict: ${automations.map((a) => `"${a}"`).join(' and ')} both write ` +
        `to the "${field}" field — audit for conflicting values before consolidating.`,
    );
  }
  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler Class Helpers
// Resolves trigger → handler class relationships and detects DML conflicts
// between handler classes and other automation on the same object.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns an array of { trigger, handlerClass } pairs for every Apex Trigger
 * that delegates to a known class in classMap.
 */
function findHandlerPairs(apexItems, classMap) {
  return apexItems
    .map((trigger) => ({
      trigger,
      handlerClass: classMap[trigger.parsed_data?.handlerClass] || null,
    }))
    .filter((p) => p.handlerClass !== null);
}

/**
 * Given handler pairs and the full set of active items on an object, returns
 * warning strings for:
 *   - Handler DML on the trigger's object that co-exists with Flows/WFRs
 *   - Cross-object DML in handler classes (governor limit and conflict risk)
 *   - Apex triggers with DML directly in the trigger body (anti-pattern)
 */
function buildHandlerWarnings(handlerPairs, apexItems, otherActiveItems) {
  const warnings = [];

  for (const { trigger, handlerClass } of handlerPairs) {
    const dmlObjects = handlerClass.parsed_data?.dmlObjects || [];
    const objectName = trigger.object_name;

    // Handler performs DML on the same object AND other automation types coexist
    const selfDml = dmlObjects.some(
      (o) => o.toLowerCase() === (objectName || '').toLowerCase(),
    );
    if (selfDml && otherActiveItems.length > 0) {
      const otherNames = otherActiveItems.map((i) => `"${i.api_name}"`).join(', ');
      warnings.push(
        `⚠ Handler class conflict: "${handlerClass.api_name}" performs DML on ${objectName} and ` +
          `${otherNames} also execute on this object — audit for duplicate field writes or ` +
          `conflicting record updates across these automations.`,
      );
    }

    // Handler DML on other objects (governor limit risk)
    const crossObjects = dmlObjects.filter(
      (o) => o.toLowerCase() !== (objectName || '').toLowerCase(),
    );
    if (crossObjects.length > 0) {
      warnings.push(
        `⚠ Cross-object DML: "${handlerClass.api_name}" also performs DML on ` +
          `${crossObjects.join(', ')} — verify governor limit headroom and ensure ` +
          `these updates do not conflict with other automation on those objects.`,
      );
    }
  }

  // Anti-pattern: trigger with DML directly in the body (no handler delegation)
  for (const trigger of apexItems) {
    if (trigger.parsed_data?.hasDmlInBody && !trigger.parsed_data?.handlerClass) {
      warnings.push(
        `⚠ Best practice violation: "${trigger.api_name}" contains DML or logic directly ` +
          `in the trigger body. Best practice is to delegate all logic and DML to a ` +
          `dedicated handler class — this makes the trigger easier to test, version, and consolidate.`,
      );
    }
  }

  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Builders
// Each pattern generates a concrete, ordered list of implementation steps
// using actual API names from the scan inventory.
// ─────────────────────────────────────────────────────────────────────────────

function buildSteps(pattern, objectName, activeItems, overlaps, preference, handlerPairs, handlerWarnings, ooeAudit) {
  const deprecated = activeItems.filter((i) => DEPRECATED_TYPES.has(i.automation_type));
  const flows = activeItems.filter((i) => MODERN_FLOW_TYPES.has(i.automation_type));
  const apex = activeItems.filter((i) => APEX_TYPES.has(i.automation_type));

  // OOE risks replace the generic field-overlap warnings — they include phase context
  // and identify the "last wins" outcome rather than just flagging overlap.
  const ooeRisks = ooeAudit ? ooeAudit.risks.map((r) => r.text) : buildOverlapWarnings(overlaps);
  const sequenceStep = ooeAudit ? formatSequenceStep(ooeAudit.sequence) : null;

  // Combine OOE risks and handler warnings into the warnings list
  const allWarnings = [...ooeRisks, ...(handlerWarnings || [])];

  // Helper: describe each Apex Trigger, noting its handler class if present
  function describeApex(items) {
    return items
      .map((t) => {
        const pair = (handlerPairs || []).find((p) => p.trigger.id === t.id);
        return pair
          ? `"${t.api_name}" (delegates to ${pair.handlerClass.api_name})`
          : `"${t.api_name}"`;
      })
      .join(', ');
  }

  if (pattern === 'deprecated_only') {
    const target = preference === 'apex_first' ? 'Apex Trigger handler' : 'Record-Triggered Flow';
    return [
      `Audit ${nameList(deprecated)} on ${objectName}: document criteria, field updates, email alerts, and action sequences.`,
      ...(sequenceStep ? [sequenceStep] : []),
      ...allWarnings,
      preference === 'apex_first'
        ? `Build a new Apex Trigger on ${objectName} with a handler class. Implement each deprecated automation's criteria as a separate handler method.`
        : `Build a new Record-Triggered Flow on ${objectName} with Decision branches for each deprecated automation's criteria and actions.`,
      `Test the new ${target} in a full sandbox against the expected behavior of ${nameList(deprecated)}.`,
      `Deactivate and archive ${nameList(deprecated)} once testing passes.`,
    ];
  }

  if (pattern === 'deprecated_plus_flow') {
    const flowEventCounts = {};
    for (const f of flows) {
      for (const e of normalizeEvents(f)) flowEventCounts[e] = (flowEventCounts[e] || 0) + 1;
    }
    const flowsFragmented = Object.values(flowEventCounts).some((c) => c > 1);

    if (preference === 'apex_first') {
      return [
        `Audit the existing ${plural(flows.length, 'Flow')} on ${objectName}: ${nameList(flows)} — document all elements and field updates.`,
        `Audit ${nameList(deprecated)}: document criteria, field updates, and action sequences.`,
        ...(sequenceStep ? [sequenceStep] : []),
        ...allWarnings,
        `Consolidate all logic from the ${plural(flows.length, 'Flow')} and deprecated automations into a single Apex Trigger handler on ${objectName}.`,
        `Test the consolidated trigger against the expected behavior of all replaced automations.`,
        `Deactivate ${nameList([...flows, ...deprecated])} once testing passes.`,
      ];
    }

    const steps = [];
    if (flowsFragmented) {
      steps.push(
        `Consolidate ${plural(flows.length, 'Flow')} on ${objectName} (${nameList(flows)}) into a single Flow — they share a trigger event. Merge logic using Decision elements.`,
      );
    } else {
      steps.push(
        `Review the existing ${plural(flows.length, 'Flow')} on ${objectName}: ${nameList(flows)} — consolidation target for the deprecated automations.`,
      );
    }
    steps.push(`Audit ${nameList(deprecated)}: document criteria, field updates, and action sequences.`);
    if (sequenceStep) steps.push(sequenceStep);
    steps.push(...allWarnings);
    steps.push(
      `Migrate ${nameList(deprecated)} into the ${flowsFragmented ? 'consolidated' : 'existing'} Flow using Decision branches.`,
    );
    steps.push(`Test the updated Flow against the expected behavior of all migrated automations.`);
    steps.push(`Deactivate ${nameList(deprecated)}${flowsFragmented ? ` and redundant Flows` : ''} once testing passes.`);
    return steps;
  }

  if (pattern === 'deprecated_plus_apex') {
    const apexDesc = describeApex(apex);
    const steps = [
      `Audit ${apexDesc} on ${objectName}: map trigger events, field writes, DML, and callouts.${handlerPairs?.length ? ' Audit the handler class(es), not just the trigger body.' : ''}`,
      `Audit ${nameList(deprecated)}: document criteria, field updates, and action sequences.`,
      ...(sequenceStep ? [sequenceStep] : []),
      ...allWarnings,
    ];
    if (preference === 'flow_first') {
      steps.push(
        `Evaluate whether ${apexDesc} can move to a Flow. If it requires callouts or complex DML, keep it and document the dependency. Migrate ${nameList(deprecated)} into a new or existing Flow on ${objectName}.`,
      );
    } else {
      steps.push(
        `Consolidate ${nameList(deprecated)} into the existing Apex Trigger handler on ${objectName}.`,
      );
    }
    steps.push(`Test the consolidated automation against the expected behavior of all replaced items.`);
    steps.push(`Deactivate ${nameList(deprecated)} once testing passes.`);
    return steps;
  }

  if (pattern === 'deprecated_plus_mixed') {
    const apexDesc = describeApex(apex);
    const steps = [
      `Full audit required on ${objectName} — complex stack: ${nameList(activeItems)}.`,
      ...(sequenceStep ? [sequenceStep] : []),
      `Audit ${apexDesc}: map trigger events, field writes, DML, callouts, and async patterns.${handlerPairs?.length ? ' Audit handler class(es) directly.' : ''}`,
      `Audit ${nameList(flows)}: document all elements, field updates, and criteria.`,
      `Audit ${nameList(deprecated)}: document criteria, field updates, and action sequences.`,
      ...allWarnings,
    ];
    if (preference === 'apex_first') {
      steps.push(
        `Consolidate all automation into a single Apex Trigger handler on ${objectName}. Migrate Flow and deprecated logic as separate handler methods.`,
        `Build a full regression test suite before deactivating any existing automation.`,
        `Deactivate ${nameList([...deprecated, ...flows])} once the handler is tested and verified.`,
      );
    } else {
      steps.push(
        `Evaluate whether ${apexDesc} can move to the consolidated Flow. If not, document the Apex dependency. Consolidate ${plural(flows.length, 'Flow')} and migrate ${nameList(deprecated)} into a single Record-Triggered Flow on ${objectName}.`,
        `Build a full regression test suite before deactivating any existing automation.`,
        `Deactivate ${nameList(deprecated)}${flows.length > 1 ? ` and redundant Flows` : ''} once testing passes.`,
      );
    }
    return steps;
  }

  if (pattern === 'flow_fragmented') {
    return [
      `Audit ${plural(flows.length, 'Flow')} on ${objectName}: ${nameList(flows)} — multiple Flows share the same trigger event.`,
      ...(sequenceStep ? [sequenceStep] : []),
      ...allWarnings,
      `Merge all Flows into a single Record-Triggered Flow using Decision elements for each original Flow's logic.`,
      `Test the consolidated Flow against the expected behavior of all merged Flows.`,
      `Deactivate redundant Flows once testing passes.`,
    ];
  }

  if (pattern === 'apex_fragmented') {
    const apexDesc = describeApex(apex);
    return [
      `Audit ${apexDesc} on ${objectName}: map trigger events, field writes, and DML.${handlerPairs?.length ? ' Check referenced handler classes.' : ''} Multiple triggers fire in undefined order — high risk.`,
      ...(sequenceStep ? [sequenceStep] : []),
      ...allWarnings,
      `Implement a single trigger handler for ${objectName}. ` +
        `${handlerPairs?.length
          ? `Merge logic from ${handlerPairs.map((p) => p.handlerClass.api_name).join(', ')} into a unified handler with explicit method ordering.`
          : `Move each trigger's logic into a handler class with explicit execution order.`}`,
      `Replace all ${plural(apex.length, 'trigger')} with a single dispatch trigger delegating to the handler.`,
      `Test the consolidated handler against the expected behavior of all merged triggers.`,
      `Delete or deactivate redundant triggers once verified.`,
    ];
  }

  if (pattern === 'flow_and_apex') {
    const apexDesc = describeApex(apex);
    const steps = [
      `Audit ${nameList(flows)} (Flow): document elements, criteria, and field updates.`,
      `Audit ${apexDesc} (Apex): document trigger events, field writes, DML, and callouts.${handlerPairs?.length ? ' Audit the handler class directly.' : ''}`,
      ...(sequenceStep ? [sequenceStep] : []),
      ...allWarnings,
    ];
    if (preference === 'flow_first') {
      steps.push(
        `Evaluate migrating Apex logic into the existing Flow. If it requires callouts or complex DML, document the coexistence with explicit comments in both automations.`,
      );
    } else {
      steps.push(
        `Evaluate migrating Flow logic into the Apex handler. If the Flow is simpler admin-side, document the coexistence explicitly instead.`,
      );
    }
    steps.push(`Ensure both automations have descriptions referencing each other and explaining the dependency.`);
    return steps;
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Rationale Builder
// Produces a narrative paragraph describing why this recommendation exists.
// ─────────────────────────────────────────────────────────────────────────────

function buildRationale(pattern, objectName, activeItems, overlaps, handlerPairs, ooeAudit) {
  const deprecated = activeItems.filter((i) => DEPRECATED_TYPES.has(i.automation_type));
  const flows = activeItems.filter((i) => MODERN_FLOW_TYPES.has(i.automation_type));
  const apex = activeItems.filter((i) => APEX_TYPES.has(i.automation_type));
  const parts = [];

  if (objectName) {
    const typeSet = [...new Set(activeItems.map((i) => i.automation_type))];
    parts.push(
      `${objectName} has ${plural(activeItems.length, 'active automation')} ` +
        `across ${plural(typeSet.length, 'type')}: ${typeSet.join(', ')}.`,
    );
  }

  if (deprecated.length > 0) {
    const types = [...new Set(deprecated.map((i) => i.automation_type))].join(' and ');
    parts.push(
      `${plural(deprecated.length, types)} ${deprecated.length === 1 ? 'is' : 'are'} ` +
        `deprecated and scheduled for Salesforce retirement — migration is required before the deadline.`,
    );
  }

  if (pattern === 'flow_fragmented') {
    parts.push(
      `${plural(flows.length, 'Record-Triggered Flow')} share the same trigger event — execution order is fragile and must be consolidated.`,
    );
  }

  if (pattern === 'apex_fragmented') {
    parts.push(
      `${plural(apex.length, 'Apex Trigger')} fire in undefined order — a high-risk anti-pattern with data integrity risk.`,
    );
  }

  if (pattern === 'flow_and_apex') {
    parts.push(
      `A Flow and Apex Trigger coexist on this object — document their execution order and dependencies explicitly.`,
    );
  }

  // Add handler class context to the rationale
  if (handlerPairs && handlerPairs.length > 0) {
    const handlerNames = handlerPairs.map((p) => p.handlerClass.api_name);
    const triggerNames = handlerPairs.map((p) => p.trigger.api_name);
    parts.push(
      `${triggerNames.length === 1 ? `"${triggerNames[0]}"` : triggerNames.map((n) => `"${n}"`).join(', ')} ` +
        `delegate${triggerNames.length === 1 ? 's' : ''} to handler class${handlerNames.length > 1 ? 'es' : ''} ` +
        `${handlerNames.map((n) => `"${n}"`).join(', ')} — include ${handlerNames.length === 1 ? 'it' : 'them'} in any consolidation audit.`,
    );
  }

  // Check for triggers with DML in body (anti-pattern)
  const triggersWithBodyDml = apex.filter(
    (t) => t.parsed_data?.hasDmlInBody && !t.parsed_data?.handlerClass,
  );
  if (triggersWithBodyDml.length > 0) {
    parts.push(
      `${triggersWithBodyDml.length === 1 ? `"${triggersWithBodyDml[0].api_name}" has` : `${triggersWithBodyDml.map((t) => `"${t.api_name}"`).join(', ')} have`} ` +
        `DML directly in the trigger body (not a handler class) — harder to test and consolidate.`,
    );
  }

  if (overlaps.fieldOverlaps.length > 0) {
    const fields = overlaps.fieldOverlaps.map((o) => `"${o.field}"`).join(', ');
    parts.push(
      `${fields} ${overlaps.fieldOverlaps.length === 1 ? 'is' : 'are'} written by multiple automations — reconcile values before consolidating.`,
    );
  }

  // Mention high-severity OOE findings so the rationale signals urgency
  if (ooeAudit) {
    const highRisks = ooeAudit.risks.filter((r) => r.severity === 'high');
    if (highRisks.length > 0) {
      const riskTypes = [...new Set(highRisks.map((r) => {
        if (r.type === 'undefined_order') return 'undefined Apex trigger execution order';
        if (r.type === 'retrigger_risk') return 'Workflow Rule re-trigger risk';
        return r.type.replace(/_/g, ' ');
      }))].join(' and ');
      parts.push(`High-severity risks detected: ${riskTypes} — see implementation steps.`);
    }
  }

  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Title Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildTitle(pattern, objectName, activeItems) {
  const deprecated = activeItems.filter((i) => DEPRECATED_TYPES.has(i.automation_type));
  const obj = objectName || 'across org';
  switch (pattern) {
    case 'deprecated_only':
      return `Migrate ${plural(deprecated.length, 'Deprecated Automation')} on ${obj}`;
    case 'deprecated_plus_flow':
      return `Consolidate and Migrate All Automation on ${obj}`;
    case 'deprecated_plus_apex':
      return `Migrate Deprecated Automation and Evaluate Apex Coverage on ${obj}`;
    case 'deprecated_plus_mixed':
      return `Full Automation Consolidation Required on ${obj}`;
    case 'flow_fragmented':
      return `Consolidate Fragmented Flows on ${obj}`;
    case 'apex_fragmented':
      return `Consolidate Multiple Apex Triggers on ${obj}`;
    case 'flow_and_apex':
      return `Review Flow and Apex Coexistence on ${obj}`;
    default:
      return `Review Automation on ${obj}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Recommendations
// Object-agnostic recommendations: missing descriptions, inactive clutter.
// Only generated when there are enough items to justify a standalone rec.
// ─────────────────────────────────────────────────────────────────────────────

function buildGlobalRecs(allItems, byObject) {
  const recs = [];

  const undocumented = allItems.filter(
    (i) => i.is_active && !i.has_description && !i.is_managed_package,
  );
  if (undocumented.length >= 3) {
    recs.push({
      object_name: null,
      pattern: 'global_description',
      title: `Add Descriptions to ${plural(undocumented.length, 'Undocumented Automation')}`,
      rationale:
        `${plural(undocumented.length, 'active automation')} lack descriptions, making the org harder to audit and hand off.`,
      steps: [
        `Add descriptions to: ${nameList(undocumented)}.`,
        `Each description should include: purpose, business process, triggering condition, and dependencies.`,
      ],
      recommended_path: 'Add inline descriptions to all undocumented active automations',
      alternative_path: null,
      severity: 'warning',
      effort_estimate: undocumented.length > 10 ? 'medium' : 'low',
      affected_ids: undocumented.map((i) => i.id),
    });
  }

  const inactive = allItems.filter((i) => !i.is_active && !i.is_managed_package);
  if (inactive.length >= 3) {
    recs.push({
      object_name: null,
      pattern: 'global_inactive',
      title: `Clean Up ${plural(inactive.length, 'Inactive Automation')}`,
      rationale:
        `${plural(inactive.length, 'inactive automation')} exist outside managed packages — they add noise and complicate audits.`,
      steps: [
        `Review each inactive automation and confirm whether it is still needed: ${nameList(inactive)}.`,
        `Delete confirmed-unused automations. For retained automations, add a description explaining the inactive status.`,
      ],
      recommended_path: 'Delete or archive all confirmed-unused inactive automations',
      alternative_path: null,
      severity: 'info',
      effort_estimate: 'low',
      affected_ids: inactive.map((i) => i.id),
    });
  }

  // Active legacy automation (Workflow Rules + Process Builders): error severity.
  // Create one rec per object so each card can reference specific consolidation
  // candidates (Flows, Apex Triggers) that already exist on that object.
  const activeDeprecated = allItems.filter(
    (i) => i.is_active && !i.is_managed_package && DEPRECATED_TYPES.has(i.automation_type),
  );
  if (activeDeprecated.length > 0) {
    // Group legacy items by object
    const legacyByObject = {};
    for (const item of activeDeprecated) {
      const key = item.object_name || '__global__';
      if (!legacyByObject[key]) legacyByObject[key] = [];
      legacyByObject[key].push(item);
    }

    for (const [objectKey, legacyItems] of Object.entries(legacyByObject)) {
      const objectLabel = objectKey === '__global__' ? null : objectKey;

      // Find active modern automations on this object that are consolidation candidates
      const allOnObject = (byObject && objectKey !== '__global__') ? (byObject[objectKey] || []) : [];
      const modernActive = allOnObject.filter(
        (i) => i.is_active && !DEPRECATED_TYPES.has(i.automation_type) && i.automation_type !== 'Apex Class',
      );
      const flowsOnObject = modernActive.filter((i) => MODERN_FLOW_TYPES.has(i.automation_type));
      const apexOnObject  = modernActive.filter((i) => APEX_TYPES.has(i.automation_type));

      const wfrs = legacyItems.filter((i) => i.automation_type === 'Workflow Rule');
      const pbs  = legacyItems.filter((i) => i.automation_type === 'Process Builder');
      const typeParts = [];
      if (wfrs.length > 0) typeParts.push(`${plural(wfrs.length, 'Workflow Rule')} (${nameList(wfrs)})`);
      if (pbs.length > 0)  typeParts.push(`${plural(pbs.length, 'Process Builder')} (${nameList(pbs)})`);

      const hasOutboundMsg = wfrs.some((i) =>
        (i.parsed_data?.actionTypes || []).includes('Outbound Message'),
      );

      // Rationale: what exists + what are the consolidation options
      let rationale =
        `Salesforce has deprecated Workflow Rules and Process Builder. ` +
        (objectLabel
          ? `${objectLabel} has ${typeParts.join(' and ')} still active.`
          : `This org has ${typeParts.join(' and ')} without an object association still active.`);

      if (flowsOnObject.length > 0) {
        rationale += ` Existing ${flowsOnObject.length === 1 ? `Flow "${flowsOnObject[0].api_name}"` : `Flows (${nameList(flowsOnObject)})`} on ${objectLabel} can serve as the consolidation target.`;
      } else if (apexOnObject.length > 0) {
        rationale += ` Existing Apex Trigger ${nameList(apexOnObject)} on ${objectLabel} is a consolidation candidate.`;
      } else if (objectLabel) {
        rationale += ` No modern automation exists on ${objectLabel} — a new Flow or Apex Trigger will be needed.`;
      }

      // Steps: tailored to whether modern automation already exists
      const steps = [
        `Audit ${nameList(legacyItems)}${objectLabel ? ` on ${objectLabel}` : ''}: document criteria, field updates, email alerts, and action sequences.`,
      ];

      if (flowsOnObject.length > 0) {
        steps.push(
          `Migrate logic from ${nameList(legacyItems)} into ${flowsOnObject.length === 1 ? `"${flowsOnObject[0].api_name}"` : `the existing Flows (${nameList(flowsOnObject)})`} using Decision branches.`,
        );
      } else if (apexOnObject.length > 0) {
        steps.push(
          `Migrate logic from ${nameList(legacyItems)} into the existing Apex Trigger ${nameList(apexOnObject)} as handler methods.`,
        );
      } else {
        steps.push(
          objectLabel
            ? `Build a new Record-Triggered Flow on ${objectLabel} with Decision branches for each automation's criteria and actions.`
            : `Map the logic to a new Record-Triggered Flow or Apex Trigger.`,
        );
      }

      steps.push(
        `Test the replacement in a full sandbox regression.`,
        `⚠ Deactivate and delete legacy automation only after full validation.`,
      );

      recs.push({
        object_name: null,
        pattern: 'global_legacy',
        title: legacyItems.length === 1
          ? `Migrate "${legacyItems[0].api_name}"${objectLabel ? ` on ${objectLabel}` : ''}`
          : `Migrate ${plural(legacyItems.length, 'Legacy Automation')}${objectLabel ? ` on ${objectLabel}` : ''}`,
        rationale,
        steps,
        recommended_path: flowsOnObject.length > 0
          ? `Migrate into existing ${flowsOnObject.length === 1 ? `"${flowsOnObject[0].api_name}"` : 'Flows'}${objectLabel ? ` on ${objectLabel}` : ''}`
          : apexOnObject.length > 0
          ? `Consolidate into existing Apex Trigger${objectLabel ? ` on ${objectLabel}` : ''}`
          : `Migrate to a new Record-Triggered Flow${objectLabel ? ` on ${objectLabel}` : ''}`,
        alternative_path: hasOutboundMsg
          ? 'Automations using Outbound Messages should migrate to a Flow with Platform Events or Apex callouts'
          : flowsOnObject.length > 0
          ? 'Consolidate into an Apex Trigger handler if complex logic requires it'
          : 'Consolidate into a new Apex Trigger handler',
        severity: 'error',
        effort_estimate: legacyItems.length > 3 ? 'high' : 'medium',
        affected_ids: legacyItems.map((i) => i.id),
      });
    }
  }

  return recs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

async function generateRecommendations(scanId, orgId, analysisRunId, inventory, findings, profile, pool) {
  const preference = profile.automation_preference || 'flow_first';

  // Build a lookup of Apex Class items by api_name for handler resolution
  const classMap = {};
  for (const item of inventory) {
    if (item.automation_type === 'Apex Class') {
      classMap[item.api_name] = item;
    }
  }

  // Group all inventory by object_name (exclude Apex Classes — they have no object)
  const byObject = {};
  for (const item of inventory) {
    if (item.automation_type === 'Apex Class') continue;
    const key = item.object_name || '__global__';
    if (!byObject[key]) byObject[key] = [];
    byObject[key].push(item);
  }

  const recommendations = [];

  // Object-level recommendations
  for (const [objectKey, items] of Object.entries(byObject)) {
    if (objectKey === '__global__') continue;

    const activeItems = items.filter((i) => i.is_active);
    if (activeItems.length === 0) continue;

    const pattern = classifyStack(activeItems);
    if (pattern === 'clean') continue;

    const overlaps = detectOverlaps(activeItems);
    const ooeAudit = auditOrderOfExecution(activeItems);

    // Resolve handler classes for Apex Triggers in this object group
    const apexItems = activeItems.filter((i) => APEX_TYPES.has(i.automation_type));
    const handlerPairs = findHandlerPairs(apexItems, classMap);

    // Other active non-Apex automation on the same object (for handler conflict detection)
    const nonApexActive = activeItems.filter((i) => !APEX_TYPES.has(i.automation_type));
    const handlerWarnings = buildHandlerWarnings(handlerPairs, apexItems, nonApexActive);

    // Severity from findings for this object's items
    const itemIds = new Set(items.map((i) => i.id));
    const groupFindings = findings.filter((f) => itemIds.has(f.automation_inventory_id));
    const severity = groupFindings.length > 0 ? worstSeverity(groupFindings) : 'info';
    const effort = estimateEffort(pattern, activeItems.length);

    recommendations.push({
      scan_id: scanId,
      org_id: orgId,
      analysis_run_id: analysisRunId,
      object_name: objectKey,
      pattern,
      title: buildTitle(pattern, objectKey, activeItems),
      rationale: buildRationale(pattern, objectKey, activeItems, overlaps, handlerPairs, ooeAudit),
      steps: buildSteps(pattern, objectKey, activeItems, overlaps, preference, handlerPairs, handlerWarnings, ooeAudit),
      ...(PATTERN_PATHS[pattern]?.[preference] || {
        recommended: 'Review and consolidate automation',
        alternative_path: null,
      }),
      severity,
      effort_estimate: effort,
      priority_score: computeScore(severity, activeItems.length, effort),
      depends_on: [],
      affected_ids: activeItems.map((i) => i.id),
    });
  }

  // Global recommendations
  for (const rec of buildGlobalRecs(inventory, byObject)) {
    recommendations.push({
      scan_id: scanId,
      org_id: orgId,
      analysis_run_id: analysisRunId,
      ...rec,
      priority_score: computeScore(rec.severity, rec.affected_ids.length, rec.effort_estimate),
      depends_on: [],
    });
  }

  // Sort by priority_score descending before insert
  recommendations.sort((a, b) => b.priority_score - a.priority_score);

  // Persist to DB
  let count = 0;
  for (const rec of recommendations) {
    const result = await pool.query(
      `INSERT INTO recommendations
         (scan_id, org_id, analysis_run_id, object_name, pattern, title, rationale, steps,
          recommended_path, alternative_path, severity, effort_estimate, priority_score, depends_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [
        rec.scan_id,
        rec.org_id,
        rec.analysis_run_id,
        rec.object_name ?? null,
        rec.pattern,
        rec.title,
        rec.rationale,
        JSON.stringify(rec.steps.map((text, i) => ({ step: i + 1, text }))),
        rec.recommended ?? rec.recommended_path,
        rec.alternative ?? rec.alternative_path ?? null,
        rec.severity,
        rec.effort_estimate,
        rec.priority_score,
        rec.depends_on,
      ],
    );
    const recId = result.rows[0].id;
    count++;

    for (const inventoryId of rec.affected_ids || []) {
      await pool.query(
        'INSERT INTO recommendation_items (recommendation_id, automation_inventory_id) VALUES ($1, $2)',
        [recId, inventoryId],
      );
    }
  }

  return count;
}

module.exports = { generateRecommendations, auditOrderOfExecution };
