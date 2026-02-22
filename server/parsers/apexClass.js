function parseApexClass(raw) {
  const body = raw.Body || '';
  const name = raw.Name || '';

  // Detect trigger handler class by name suffix or by static dispatch method signature
  const isTriggerHandler =
    /(?:Handler|TriggerHandler|TH)$/i.test(name) ||
    /\bpublic\s+static\s+void\s+(?:run|execute|dispatch|handle|invoke)\s*\(/i.test(body);

  // Extract SObject names from SOQL queries: [SELECT ... FROM SObject ...]
  const soqlMatches = [...body.matchAll(/\[\s*SELECT\b[^\]]*?\bFROM\s+(\w+)/gi)];
  const soqlObjects = [...new Set(soqlMatches.map((m) => m[1]))];

  // Extract SObject types from DML statements.
  // Covers: insert x; insert new Account(); insert new List<Account>{}
  //         Database.insert(x); Database.insert(new List<Contact>{...})
  const dmlKeywordMatches = [
    ...body.matchAll(
      /\b(?:insert|update|delete|upsert|undelete)\s+(?:new\s+(?:List\s*<\s*(\w+)\s*>|(\w+)\s*[({])|(\w+)\s*[;,\)])/gi,
    ),
  ];
  const dbMethodMatches = [
    ...body.matchAll(
      /\bDatabase\s*\.\s*(?:insert|update|delete|upsert|undelete)\s*\(\s*(?:new\s+(?:List\s*<\s*(\w+)\s*>|(\w+)\s*[({])|(\w+)\s*[,)])/gi,
    ),
  ];

  // Exclude common non-SObject variable names that match patterns
  const EXCLUDE = new Set(['null', 'true', 'false', 'this', 'new', 'List', 'Map', 'Set']);
  const dmlObjects = [
    ...new Set([
      ...dmlKeywordMatches.flatMap((m) => [m[1], m[2], m[3]].filter(Boolean)),
      ...dbMethodMatches.flatMap((m) => [m[1], m[2], m[3]].filter(Boolean)),
    ]),
  ].filter((o) => !EXCLUDE.has(o) && /^[A-Z]/.test(o));

  // Detect @future annotations — async methods have strict limits (50/tx, 200/24h)
  // and must be called with collections, not per-record.
  const hasFutureMethods = /@future\b/i.test(body);

  // Detect hardcoded Salesforce record IDs (15- or 18-char, always starting with '0').
  // These are org-specific and break across environments.
  const hasHardcodedIds = /['"]0[0-9A-Za-z]{14}(?:[0-9A-Za-z]{3})?['"]/.test(body);

  // Detect @isTest(seeAllData=true) — exposes the test to real org data, making it
  // fragile, environment-specific, and potentially destructive in production orgs.
  const hasSeeAllDataTrue = /@isTest\s*\(\s*seeAllData\s*=\s*true/i.test(body);

  // Detect deprecated testMethod keyword — replaced by @isTest annotation since API v28.
  const hasTestMethodKeyword = /\btestMethod\b/i.test(body);

  // Detect global class/interface/enum modifier — global access is permanent and cannot
  // be removed after deployment without breaking API consumers.
  const hasGlobalModifier = /\bglobal\s+(?:class|interface|enum|virtual|abstract)\b/i.test(body);

  // Detect System.debug() calls without a LoggingLevel parameter — these default to
  // DEBUG level and pollute production logs, making diagnosis harder.
  const hasDebugWithoutLevel = /System\.debug\s*\(\s*(?!LoggingLevel\.)/i.test(body);

  // Detect Queueable implementations without System.attachFinalizer — missing a finalizer
  // means failed async jobs have no error-recovery or monitoring hook.
  const isQueueableWithoutFinalizer =
    /\bimplements\b[^{]*\bQueueable\b/i.test(body) &&
    !/System\.attachFinalizer\b/i.test(body);

  // Detect @isTest classes with no assertion calls — such tests exercise code paths
  // but never verify that behaviour is correct, providing false confidence.
  const isTestClassWithoutAsserts =
    /@isTest\b/i.test(body) && !/(System\.assert|Assert\.)/i.test(body);

  // Detect @isTest classes that never call System.runAs — running as system context
  // bypasses sharing rules and profile-based permissions, hiding real access issues.
  const isTestClassWithoutRunAs =
    /@isTest\b/i.test(body) && !/System\.runAs\s*\(/i.test(body);

  // --- Security checks ---

  // Detect HTTP (non-HTTPS) endpoint — unencrypted callouts expose data in transit
  // and will fail Salesforce security review for managed packages.
  const hasInsecureEndpoint = /\.setEndpoint\s*\(\s*['"]http:\/\//i.test(body);

  // Detect addError(message, false) — the false flag disables HTML escaping, allowing
  // attacker-controlled HTML/JS to render in the user's browser (XSS).
  const hasXssFromEscapeFalse = /\.addError\s*\([^)]+,\s*false\s*\)/i.test(body);

  // Detect Configuration.disableTriggerCRUDSecurity() — a FinancialForce/fflib method
  // that globally disables CRUD/FLS enforcement, opening the org to privilege escalation.
  const hasDangerousMethodCall =
    /Configuration\s*\.\s*disableTriggerCRUDSecurity\s*\(\s*\)/i.test(body);

  // Detect classes that perform DML or SOQL without a sharing declaration.
  // Without 'with sharing', 'without sharing', or 'inherited sharing', the class
  // silently runs in the caller's sharing context — usually system (no enforcement).
  const hasSharingDeclaration = /\b(?:with|without|inherited)\s+sharing\b/i.test(body);
  const hasDmlOrSoql =
    dmlObjects.length > 0 ||
    soqlObjects.length > 0 ||
    /\b(?:insert|update|delete|upsert|undelete)\s+/i.test(body) ||
    /\[\s*SELECT\b/i.test(body);
  const missesShareDeclaration = hasDmlOrSoql && !hasSharingDeclaration;

  // Detect Database.query() (dynamic SOQL) without String.escapeSingleQuotes().
  // Concatenating unsanitized user input into a SOQL query enables injection —
  // allowing an attacker to exfiltrate or modify arbitrary records.
  const hasDynamicSoql = /Database\s*\.\s*query\s*\(/i.test(body);
  const hasSoqlInjectionRisk =
    hasDynamicSoql && !/String\s*\.\s*escapeSingleQuotes\s*\(/i.test(body);

  // Detect DML or SOQL without CRUD/FLS permission checks. Code that performs data
  // operations without checking isAccessible(), isCreateable(), isUpdateable(),
  // isDeletable(), WITH SECURITY_ENFORCED, WITH USER_MODE, or Security.stripInaccessible()
  // may bypass org-level access controls and expose records to unauthorised users.
  const hasCrudChecks =
    /\b(?:isAccessible|isCreateable|isUpdateable|isDeletable|isUndeletable)\s*\(\s*\)/i.test(body) ||
    /\bWITH\s+(?:SECURITY_ENFORCED|USER_MODE)\b/i.test(body) ||
    /Security\s*\.\s*stripInaccessible\s*\(/i.test(body);
  const hasCrudViolationRisk = hasDmlOrSoql && !hasCrudChecks;

  // Detect Crypto API calls using a Blob.valueOf('literal') as IV or key material.
  // Hardcoded cryptographic values completely undermine encryption — anyone with
  // source code access can decrypt all data protected by the hardcoded key or IV.
  const hasHardcodedCrypto =
    /Crypto\s*\.\s*\w+\s*\(/i.test(body) && /Blob\s*\.\s*valueOf\s*\(\s*['"]/i.test(body);

  // Detect manual Authorization header construction instead of Named Credentials.
  // Hardcoded auth values embedded in source code are exposed to all code reviewers,
  // version control history, and anyone with org access — and are hard to rotate.
  const hasHardcodedCredentials =
    /\.setHeader\s*\(\s*['"]\s*Authorization\s*['"]/i.test(body);

  // Detect PageReference constructed from getCurrentPage().getParameters() — an open
  // redirect vulnerability. Attackers craft URLs that redirect users to malicious
  // sites via the trusted Salesforce domain, facilitating phishing.
  const hasOpenRedirectRisk =
    /new\s+PageReference\s*\(/i.test(body) &&
    /getCurrentPage\s*\(\s*\)\s*\.getParameters/i.test(body);

  return {
    automation_type: 'Apex Class',
    object_name: null,
    trigger_events: null,
    is_active: raw.Status === 'Active',
    has_description: false,
    is_managed_package: !!(raw.NamespacePrefix && raw.NamespacePrefix.trim()),
    parsed_data: {
      apiVersion: raw.ApiVersion || null,
      isTriggerHandler,
      dmlObjects,
      soqlObjects,
      hasFutureMethods,
      hasHardcodedIds,
      hasSeeAllDataTrue,
      hasTestMethodKeyword,
      hasGlobalModifier,
      hasDebugWithoutLevel,
      isQueueableWithoutFinalizer,
      isTestClassWithoutAsserts,
      isTestClassWithoutRunAs,
      hasInsecureEndpoint,
      hasXssFromEscapeFalse,
      hasDangerousMethodCall,
      missesShareDeclaration,
      hasSoqlInjectionRisk,
      hasCrudViolationRisk,
      hasHardcodedCrypto,
      hasHardcodedCredentials,
      hasOpenRedirectRisk,
    },
  };
}

module.exports = { parseApexClass };
