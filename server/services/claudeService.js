'use strict';

const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db');

// ── Kill switch ──────────────────────────────────────────────────────────────

function isEnabled() {
  return process.env.LLM_ENABLED !== 'false';
}

// ── Lazy-initialize the Anthropic client ─────────────────────────────────────

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

function getModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function checkCache(hash) {
  const result = await pool.query(
    'SELECT response FROM llm_cache WHERE input_hash = $1',
    [hash],
  );
  return result.rows[0]?.response ?? null;
}

async function storeCache(hash, feature, response, model) {
  await pool.query(
    `INSERT INTO llm_cache (input_hash, feature, response, model)
     VALUES ($1, $2, $3, $4) ON CONFLICT (input_hash) DO NOTHING`,
    [hash, feature, response, model],
  );
}

// ── Core API caller ───────────────────────────────────────────────────────────

async function callClaude(feature, systemPrompt, userContent, maxTokens, hash) {
  const cached = await checkCache(hash);
  if (cached !== null) {
    console.log(`[LLM] Cache hit for ${feature} (${hash.slice(0, 8)})`);
    return cached;
  }

  const model = getModel();
  let response;
  try {
    response = await getClient().messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (apiErr) {
    console.error(`[LLM] API call failed for feature="${feature}" model="${model}": ${apiErr.message}`);
    throw apiErr;
  }

  const text = response.content[0]?.text ?? null;
  if (text) {
    try {
      await storeCache(hash, feature, text, model);
    } catch (cacheErr) {
      console.warn(`[LLM] Cache write failed for feature="${feature}" (${hash.slice(0, 8)}): ${cacheErr.message}`);
    }
  }
  return text;
}

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Summarizes an Apex trigger, class, flow, or workflow rule.
 * codeType: 'trigger' | 'class' | 'flow' | 'workflow_rule'
 * Returns a string summary, or null if LLM is disabled or the call fails.
 */
async function summarizeApexCode(apiName, codeBody, codeType) {
  if (!isEnabled()) return null;
  try {
    const truncated =
      codeBody.length > 3000 ? codeBody.slice(0, 3000) + '\n[truncated]' : codeBody;
    const hash = sha256(`summarize:${apiName}:${codeType}:${truncated}`);

    const isCodeType = codeType === 'trigger' || codeType === 'class';
    const typeLabel = {
      trigger: 'Apex Trigger',
      class: 'Apex Class',
      flow: 'Record-Triggered Flow',
      workflow_rule: 'Workflow Rule',
    }[codeType] || codeType;

    const userContent = isCodeType
      ? `Summarize this Salesforce ${typeLabel} named "${apiName}".\n\nDocument in a structured manner: which object(s) it operates on, what trigger events it fires on (if a trigger), what it does (field updates, objects it queries and/or performs DML operations on, callouts, queueable/batch invocations), and any obvious risks or code quality concerns (hardcoded IDs, missing null checks, no bulkification, etc.).\n\nLimit your response to 500 characters.\n\n${truncated}`
      : `Summarize this Salesforce ${typeLabel} named "${apiName}" based on its parsed metadata.\n\nDocument in a structured manner: what object it operates on, what trigger events or criteria it uses, and what actions it performs.\n\nLimit your response to 500 characters.\n\nParsed metadata:\n${truncated}`;

    return await callClaude(
      'summarize',
      'You are an expert Salesforce architect analyzing automations for the purposes of documenting, streamlining, helping customers follow best practices, and cleaning up technical debt. Be concise and not too technical. Do not use filler phrases like "This code..." or "The following...". Write in present tense.',
      userContent,
      500,
      hash,
    );
  } catch (err) {
    console.error('[LLM] summarizeApexCode failed:', err.message);
    return null;
  }
}

/**
 * Writes a 2-sentence consultant advisory note for a recommendation.
 * Uses all available specific findings (OOE warnings, conflict analysis, affected names)
 * so the output references actual automations and detected risks rather than generic language.
 * Returns a string, or null if LLM is disabled or the call fails.
 */
async function enhanceRecommendationNarrative(recommendation, affectedItems, customerProfile) {
  if (!isEnabled()) return null;
  try {
    // Pull ⚠ warning lines out of the steps array — these carry the most specific OOE findings
    const steps = Array.isArray(recommendation.steps) ? recommendation.steps : [];
    const warningLines = steps.filter((s) => typeof s === 'string' && s.startsWith('⚠'));

    // Build a compact list of affected automations: "AccountTrigger (Apex Trigger), Send_Welcome_WFR (Workflow Rule)"
    const itemList = affectedItems
      .map((i) => `${i.api_name} (${i.automation_type})`)
      .join(', ');

    // Include conflict_analysis when present — it has the deepest per-object findings
    const conflictSection = recommendation.conflict_analysis
      ? `\nConflict analysis:\n${recommendation.conflict_analysis}`
      : '';

    // Include ⚠ warnings from implementation steps — field names, re-trigger details, etc.
    const warningSection = warningLines.length > 0
      ? `\nDetected risks:\n${warningLines.join('\n')}`
      : '';

    // v3 prefix busts earlier caches; include conflict_analysis fingerprint so cache
    // is invalidated if the conflict analysis changes between runs.
    const conflictFingerprint = (recommendation.conflict_analysis || '').slice(0, 80);
    const hash = sha256(
      `narrative_v3:${recommendation.id}:${recommendation.pattern}:${recommendation.object_name}:${conflictFingerprint}`,
    );

    const userContent =
      `Write exactly 2 concise sentences for a Salesforce consultant to present to their client.\n\n` +
      `Sentence 1 — The specific finding: name the automations and state exactly what risk or problem was detected.\n` +
      `Sentence 2 — The recommended action: state what must be done and why it resolves the issue or prevents a specific consequence.\n\n` +
      `Recommendation: ${recommendation.title}\n` +
      `Pattern: ${recommendation.pattern}\n` +
      `Severity: ${recommendation.severity}\n` +
      `Effort: ${recommendation.effort_estimate}\n` +
      `Affected automations: ${itemList}\n` +
      `Recommended path: ${recommendation.recommended_path}\n` +
      (recommendation.alternative_path ? `Alternative path: ${recommendation.alternative_path}\n` : '') +
      `\nAnalysis:\n${recommendation.rationale}` +
      conflictSection +
      warningSection +
      `\n\nRules: Use the actual automation names listed above. Do not start with "I", "We", or "This". Do not restate the title. Be direct — no filler phrases.`;

    return await callClaude(
      'narrative',
      'You are a senior Salesforce consultant writing advisory notes for a governance report. Always reference specific automation names. Never write generic risk statements — if you mention execution order, recursion, or field conflicts, name the exact automations involved.',
      userContent,
      200,
      hash,
    );
  } catch (err) {
    console.error('[LLM] enhanceRecommendationNarrative failed:', err.message);
    return null;
  }
}

/**
 * Analyzes ALL active automations on a single Salesforce object holistically.
 * automations: array of automation_inventory rows (id, api_name, automation_type,
 *   trigger_events, parsed_data, llm_summary, object_name)
 * Returns { analysis: string, severity: 'high'|'medium'|'low' }, or null on failure.
 */
async function analyzeObjectAutomations(objectName, automations, ooeContext = null) {
  if (!isEnabled()) return null;
  try {
    const sortedIds = automations.map((a) => a.id).sort((a, b) => a - b).join(',');
    // Include ooeContext fingerprint in hash so cache busts when detected risks change
    const ooeFingerprint = ooeContext ? ooeContext.slice(0, 120) : '';
    const hash = sha256(`object_conflict_v2:${objectName}:${sortedIds}:${ooeFingerprint}`);

    const automationList = automations.map((a) => {
      const raw = a.llm_summary || JSON.stringify(a.parsed_data);
      const summary = raw.length > 400 ? raw.slice(0, 400) + '…' : raw;
      return `- ${a.api_name} (${a.automation_type}) | Triggers: ${a.trigger_events || 'n/a'} | ${summary}`;
    }).join('\n');

    const contextSection = ooeContext
      ? `\n\nExecution order analysis for ${objectName}:\n${ooeContext}`
      : '';

    const userContent =
      `Write 2–3 concise sentences for a Salesforce consultant to present to their client about the automation stack on the "${objectName}" object.\n\n` +
      `Sentence 1 — Name the specific automations present and what type of risk or conflict was detected between them.\n` +
      `Sentence 2 — State the most critical finding and its concrete business consequence (data loss, duplicate execution, governor limits, etc.).\n` +
      `Sentence 3 (only if needed) — State the recommended action and what it resolves.\n\n` +
      `Automations on ${objectName} (${automations.length} total):\n${automationList}${contextSection}\n\n` +
      `Rules: Name every automation you reference by its exact API name above. Do not write generic statements like "unpredictable execution order" without naming the specific automations involved. ` +
      `Do not start with "I", "We", or "This". Rate the overall severity as high, medium, or low somewhere in your response.`;

    const response = await callClaude(
      'object_conflict',
      'You are a senior Salesforce consultant writing advisory notes for a client governance report. Always reference specific automation names. Never write generic risk statements — if you mention execution order, recursion, or field conflicts, name the exact automations involved. Do not speculate beyond what the metadata shows.',
      userContent,
      350,
      hash,
    );

    if (!response) return null;

    const lower = response.toLowerCase();
    let severity = 'medium';
    if (lower.includes('high')) severity = 'high';
    else if (lower.includes('low') && !lower.includes('high')) severity = 'low';

    return { analysis: response, severity };
  } catch (err) {
    console.error('[LLM] analyzeObjectAutomations failed:', err.message);
    return null;
  }
}

/**
 * Reviews a consolidated Flow XML for obvious errors or migration issues.
 * Returns a plain-text commentary string, or null if LLM is disabled or call fails.
 */
async function reviewConsolidatedFlow(sourceAutomations, generatedXml) {
  if (!isEnabled()) return null;
  try {
    const sourceList = sourceAutomations
      .map((a) => `- ${a.api_name} (${a.automation_type})`)
      .join('\n');
    const truncatedXml =
      generatedXml.length > 4000
        ? generatedXml.slice(0, 4000) + '\n[truncated]'
        : generatedXml;
    const hash = sha256(`consolidation_review:${sourceList}:${truncatedXml}`);

    const userContent =
      `Review this consolidated Salesforce Flow XML that was auto-generated from the following source automations:\n\n${sourceList}\n\n` +
      `Generated Flow XML:\n${truncatedXml}\n\n` +
      `Identify: (1) any obvious logic gaps or missing elements from the source automations, (2) any structural issues in the generated XML, (3) whether the sequencing of elements looks correct. ` +
      `Keep your response to 4 sentences maximum. If the output looks correct, say so briefly.`;

    return await callClaude(
      'consolidation_review',
      'You are an expert Salesforce automation architect reviewing auto-generated Flow metadata. Be concise and specific. Focus on correctness and completeness, not style.',
      userContent,
      600,
      hash,
    );
  } catch (err) {
    console.error('[LLM] reviewConsolidatedFlow failed:', err.message);
    return null;
  }
}

/**
 * Generates Apex Trigger + Handler class from legacy WFR/PB automations.
 * Returns { trigger: string, handler: string }, or null if LLM is disabled or call fails.
 */
async function generateApexFromLegacy(sourceAutomations, orgProfile) {
  if (!isEnabled()) return null;
  try {
    const objectName = sourceAutomations[0]?.object_name || 'SObject';
    const handlerName = `${objectName.replace(/\W/g, '')}Handler`;

    const sourceBlock = sourceAutomations
      .map((a) => {
        const logic = a.llm_summary || JSON.stringify(a.parsed_data || a.raw_json || {});
        const truncated = logic.length > 1000 ? logic.slice(0, 1000) + '[truncated]' : logic;
        return (
          `Automation: ${a.api_name} (${a.automation_type})\n` +
          `Object: ${a.object_name || objectName}\n` +
          `Trigger events: ${a.trigger_events || 'before insert, before update'}\n` +
          `Logic summary: ${truncated}`
        );
      })
      .join('\n\n');

    const hash = sha256(
      `apex_generator:${objectName}:${sourceAutomations.map((a) => a.api_name).join(',')}`,
    );

    const userContent =
      `Generate an Apex Trigger and Handler class that replicates the logic of the following Salesforce automations being retired:\n\n${sourceBlock}\n\n` +
      `Requirements:\n` +
      `- Single trigger on ${objectName} covering all necessary trigger events\n` +
      `- Handler class named ${handlerName} with one method per logical group\n` +
      `- Preserve all field update logic exactly as described\n` +
      `- Add an inline comment above each method identifying which source automation the logic originated from\n` +
      `- Flag any logic that could not be safely migrated with a TODO comment\n` +
      `- All collections must be bulkified — no SOQL or DML inside loops\n` +
      `- Use null-safe field access\n\n` +
      `Return your response as exactly two code blocks delimited with \`\`\`apex — first the trigger, then the handler class. No other text outside the code blocks.`;

    const response = await callClaude(
      'apex_generator',
      'You are an expert Salesforce Apex developer. Generate clean, bulkified, production-quality Apex code. One trigger per object. Logic delegated to a handler class. No hardcoded IDs. Null-safe field access.',
      userContent,
      2000,
      hash,
    );

    if (!response) return null;

    // Parse two ```apex code blocks
    const blocks = [...response.matchAll(/```apex\s*([\s\S]*?)```/g)].map((m) => m[1].trim());
    if (blocks.length < 2) {
      console.warn('[LLM] generateApexFromLegacy: expected 2 apex blocks, got', blocks.length);
      return blocks.length === 1 ? { trigger: blocks[0], handler: '' } : null;
    }
    return { trigger: blocks[0], handler: blocks[1] };
  } catch (err) {
    console.error('[LLM] generateApexFromLegacy failed:', err.message);
    return null;
  }
}

module.exports = {
  summarizeApexCode,
  enhanceRecommendationNarrative,
  analyzeObjectAutomations,
  reviewConsolidatedFlow,
  generateApexFromLegacy,
};
