const CHECKS = {
  // --- Platform ---

  WFR001: (item) => item.automation_type === 'Workflow Rule' && item.is_active,

  WFR002: (item) => item.automation_type === 'Workflow Rule' && !item.is_active,

  WFR003: (item) =>
    item.automation_type === 'Workflow Rule' &&
    (item.parsed_data?.actionTypes || []).includes('Outbound Message'),

  PB001: (item) => item.automation_type === 'Process Builder' && item.is_active,

  PB002: (item) => item.automation_type === 'Process Builder' && !item.is_active,

  // --- Quality ---

  DESC001: (item) => item.is_active && !item.is_managed_package && !item.has_description,

  NAME001: (item, profile) => {
    if (!profile.naming_convention_pattern) return false;
    try {
      return !new RegExp(profile.naming_convention_pattern).test(item.api_name);
    } catch {
      return false;
    }
  },

  FLOW001: (item) =>
    item.automation_type === 'Record-Triggered Flow' && !item.object_name,

  // --- Risk ---

  APEX001: (item) => item.automation_type === 'Apex Trigger' && item.is_active,

  // Multiple active Record-Triggered Flows on same object + trigger event
  MULTI001: (items) => {
    const groups = {};
    for (const item of items) {
      if (item.automation_type !== 'Record-Triggered Flow' || !item.is_active || !item.object_name) continue;
      const key = `${item.object_name}|${item.trigger_events || ''}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    const findings = [];
    for (const group of Object.values(groups)) {
      if (group.length > 1) {
        const names = group.map((i) => i.api_name).join(', ');
        for (const item of group) {
          findings.push({
            item,
            message: `Multiple active Record-Triggered Flows on ${item.object_name} (${item.trigger_events || 'unspecified event'}): ${names}`,
          });
        }
      }
    }
    return findings;
  },

  // Active Apex Trigger + active Record-Triggered Flow on same object
  MULTI002: (items) => {
    const triggersByObject = {};
    const flowsByObject = {};
    for (const item of items) {
      if (!item.is_active || !item.object_name) continue;
      if (item.automation_type === 'Apex Trigger') {
        if (!triggersByObject[item.object_name]) triggersByObject[item.object_name] = [];
        triggersByObject[item.object_name].push(item);
      }
      if (item.automation_type === 'Record-Triggered Flow') {
        if (!flowsByObject[item.object_name]) flowsByObject[item.object_name] = [];
        flowsByObject[item.object_name].push(item);
      }
    }
    const findings = [];
    for (const [obj, triggers] of Object.entries(triggersByObject)) {
      if (flowsByObject[obj]) {
        const flowNames = flowsByObject[obj].map((i) => i.api_name).join(', ');
        for (const item of triggers) {
          findings.push({
            item,
            message: `Apex Trigger '${item.api_name}' and Record-Triggered Flow(s) [${flowNames}] both operate on ${obj}`,
          });
        }
      }
    }
    return findings;
  },

  // Multiple active Apex Triggers on same object
  MULTI003: (items) => {
    const groups = {};
    for (const item of items) {
      if (item.automation_type !== 'Apex Trigger' || !item.is_active || !item.object_name) continue;
      if (!groups[item.object_name]) groups[item.object_name] = [];
      groups[item.object_name].push(item);
    }
    const findings = [];
    for (const group of Object.values(groups)) {
      if (group.length > 1) {
        const names = group.map((i) => i.api_name).join(', ');
        for (const item of group) {
          findings.push({
            item,
            message: `Multiple active Apex Triggers on ${item.object_name} fire in undefined order: ${names}`,
          });
        }
      }
    }
    return findings;
  },

  // Active Workflow Rule + active Flow on same object
  MULTI004: (items) => {
    const wfrByObject = {};
    const flowsByObject = {};
    const flowTypes = ['Record-Triggered Flow', 'Autolaunched Flow', 'Process Builder'];
    for (const item of items) {
      if (!item.is_active || !item.object_name) continue;
      if (item.automation_type === 'Workflow Rule') {
        if (!wfrByObject[item.object_name]) wfrByObject[item.object_name] = [];
        wfrByObject[item.object_name].push(item);
      }
      if (flowTypes.includes(item.automation_type)) {
        if (!flowsByObject[item.object_name]) flowsByObject[item.object_name] = [];
        flowsByObject[item.object_name].push(item);
      }
    }
    const findings = [];
    for (const [obj, wfrs] of Object.entries(wfrByObject)) {
      if (flowsByObject[obj]) {
        const flowNames = flowsByObject[obj].map((i) => i.api_name).join(', ');
        for (const item of wfrs) {
          findings.push({
            item,
            message: `Workflow Rule '${item.api_name}' and Flow(s) [${flowNames}] both operate on ${obj} — redundant automation`,
          });
        }
      }
    }
    return findings;
  },

  // --- Apex Best Practices ---

  // Active trigger with no detectable handler class delegation.
  // Logic embedded in the trigger body is harder to test, reuse, and bulkify.
  APEX002: (item) =>
    item.automation_type === 'Apex Trigger' &&
    item.is_active &&
    !item.is_managed_package &&
    !item.parsed_data?.handlerClass,

  // DML statements found directly in the trigger body rather than in a handler class.
  // DML outside a handler bypasses proper bulkification and compounds governor limit risk
  // when multiple triggers run in the same transaction.
  APEX003: (item) =>
    item.automation_type === 'Apex Trigger' &&
    item.is_active &&
    !item.is_managed_package &&
    item.parsed_data?.hasDmlInBody === true,

  // SOQL queries found directly in the trigger body.
  // Queries in the trigger body are at elevated risk of executing inside for loops,
  // rapidly consuming the 100-query-per-transaction governor limit.
  APEX004: (item) =>
    item.automation_type === 'Apex Trigger' &&
    item.is_active &&
    !item.is_managed_package &&
    item.parsed_data?.hasSoqlInBody === true,

  // Hardcoded Salesforce record IDs (15- or 18-char strings starting with '0') found
  // in Apex code. These are org-specific and break when deploying to sandboxes or
  // refreshing orgs. Use dynamic queries instead.
  APEX005: (item) =>
    ['Apex Trigger', 'Apex Class'].includes(item.automation_type) &&
    !item.is_managed_package &&
    item.parsed_data?.hasHardcodedIds === true,

  // @future (asynchronous) methods detected in an Apex class.
  // @future calls are capped at 50 per transaction and 200 per 24h; calling them
  // per-record instead of once per bulk transaction will exhaust limits at scale.
  APEX006: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.hasFutureMethods === true,

  // Apex code compiled against API version below 55 (Spring '22).
  // Older API versions miss governor limit improvements, security patches,
  // and new language features available in current platform releases.
  APEX007: (item) =>
    ['Apex Trigger', 'Apex Class'].includes(item.automation_type) &&
    !item.is_managed_package &&
    !!item.parsed_data?.apiVersion &&
    Number(item.parsed_data.apiVersion) < 55,

  // @isTest(seeAllData=true) exposes tests to real org data — making them fragile,
  // environment-specific, and potentially destructive in production.
  APEX008: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.hasSeeAllDataTrue === true,

  // Deprecated testMethod keyword — replaced by @isTest annotation since API v28.
  // The keyword may behave unexpectedly in newer API versions.
  APEX009: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.hasTestMethodKeyword === true,

  // global modifier makes the class a permanent part of the org's external API surface.
  // Global members cannot be removed or made less accessible after deployment.
  APEX010: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.hasGlobalModifier === true,

  // System.debug() without a LoggingLevel parameter defaults to DEBUG level,
  // generating log volume that obscures real issues and degrades performance.
  APEX011: (item) =>
    ['Apex Trigger', 'Apex Class'].includes(item.automation_type) &&
    !item.is_managed_package &&
    item.parsed_data?.hasDebugWithoutLevel === true,

  // Queueable class without System.attachFinalizer — no mechanism to detect,
  // log, or recover from async job failures.
  APEX012: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.isQueueableWithoutFinalizer === true,

  // @isTest class with no assertion calls — executes code paths but verifies nothing,
  // providing false confidence that tested code is correct.
  APEX013: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.isTestClassWithoutAsserts === true,

  // @isTest class without System.runAs — tests run as system context, bypassing
  // sharing rules and profile-based permissions, masking real access issues.
  APEX014: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.isTestClassWithoutRunAs === true,

  // --- Security ---

  // HTTP endpoint in a callout — unencrypted; data exposed in transit.
  // Managed packages with HTTP callouts will fail Salesforce security review.
  SEC001: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.hasInsecureEndpoint === true,

  // addError(message, false) disables HTML escaping — the message renders as raw
  // HTML/JS in the user's browser, enabling XSS via trigger error messages.
  SEC002: (item) =>
    ['Apex Trigger', 'Apex Class'].includes(item.automation_type) &&
    !item.is_managed_package &&
    item.parsed_data?.hasXssFromEscapeFalse === true,

  // Configuration.disableTriggerCRUDSecurity() globally suppresses CRUD/FLS checks
  // across the entire transaction — a critical privilege-escalation risk.
  SEC003: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.hasDangerousMethodCall === true,

  // Class performs DML or SOQL but has no sharing declaration — runs in the caller's
  // context (usually system), silently bypassing all record-level sharing rules.
  SEC004: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.missesShareDeclaration === true,

  // Database.query() (dynamic SOQL) used without String.escapeSingleQuotes() —
  // user-supplied strings concatenated into the query enable SOQL injection.
  SEC005: (item) =>
    ['Apex Trigger', 'Apex Class'].includes(item.automation_type) &&
    !item.is_managed_package &&
    item.parsed_data?.hasSoqlInjectionRisk === true,

  // DML or SOQL performed without CRUD/FLS permission checks — code may bypass
  // org access controls and expose or modify records for unauthorised users.
  SEC006: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.hasCrudViolationRisk === true,

  // Crypto API call using Blob.valueOf('literal') as IV or key — hardcoded crypto
  // values undermine encryption and allow decryption by anyone with source access.
  SEC007: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.hasHardcodedCrypto === true,

  // Authorization header set manually in HTTP callout — credentials embedded in
  // source code are exposed in version control and hard to rotate. Use Named Credentials.
  SEC008: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.hasHardcodedCredentials === true,

  // PageReference constructed from getCurrentPage().getParameters() — an open redirect
  // that lets attackers craft URLs redirecting users to malicious sites via Salesforce.
  SEC009: (item) =>
    item.automation_type === 'Apex Class' &&
    !item.is_managed_package &&
    item.parsed_data?.hasOpenRedirectRisk === true,

  // --- Housekeeping ---

  INACT001: (item) => !item.is_active && !item.is_managed_package,

  PKG001: (item) => !!item.is_managed_package,
};

module.exports = { CHECKS };
