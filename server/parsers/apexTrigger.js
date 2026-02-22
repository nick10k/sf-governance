function parseApexTrigger(raw) {
  const body = raw.Body || '';

  // Extract object and trigger events from the trigger declaration
  // e.g. "trigger MyTrigger on Account (before insert, after update)"
  const match = body.match(/trigger\s+\w+\s+on\s+(\w+)\s*\(([^)]+)\)/i);
  const objectName = match ? match[1] : null;
  const events = match
    ? match[2].split(',').map((e) => e.trim().toLowerCase())
    : [];

  // Detect the trigger handler pattern: a single class static dispatch call
  // e.g. AccountTriggerHandler.run(trigger); or TriggerDispatcher.execute(new AccountHandler());
  // Match ClassName.methodName( at the start of a statement (ignoring Test/System classes)
  const handlerMatch = body.match(
    /\b([A-Z][A-Za-z0-9_]*)\s*\.\s*(?:run|execute|dispatch|handle|invoke|getInstance)\s*\(/,
  );
  // Exclude common non-handler Salesforce classes
  const NON_HANDLER = new Set(['System', 'Test', 'Database', 'Schema', 'Limits', 'Trigger']);
  const handlerClass =
    handlerMatch && !NON_HANDLER.has(handlerMatch[1]) ? handlerMatch[1] : null;

  // Detect DML directly in the trigger body (anti-pattern: logic in trigger)
  const hasDmlInBody = /\b(?:insert|update|delete|upsert|undelete)\s+/i.test(body);

  // Detect SOQL queries in the trigger body (should live in a handler/service class)
  const hasSoqlInBody = /\[\s*SELECT\b/i.test(body);

  // Detect hardcoded Salesforce record IDs (15- or 18-char, always starting with '0')
  // These break across environments — dynamic queries should be used instead.
  const hasHardcodedIds = /['"]0[0-9A-Za-z]{14}(?:[0-9A-Za-z]{3})?['"]/.test(body);

  // Detect System.debug() calls without a LoggingLevel parameter — these default to
  // DEBUG level and pollute production logs.
  const hasDebugWithoutLevel = /System\.debug\s*\(\s*(?!LoggingLevel\.)/i.test(body);

  // Detect addError(message, false) — disables HTML escaping on trigger error messages,
  // allowing attacker-controlled content to render as HTML/JS to users (XSS).
  const hasXssFromEscapeFalse = /\.addError\s*\([^)]+,\s*false\s*\)/i.test(body);

  // Detect Database.query() (dynamic SOQL) without String.escapeSingleQuotes().
  // Concatenating unsanitized user input into a SOQL query enables injection.
  const hasDynamicSoql = /Database\s*\.\s*query\s*\(/i.test(body);
  const hasSoqlInjectionRisk =
    hasDynamicSoql && !/String\s*\.\s*escapeSingleQuotes\s*\(/i.test(body);

  return {
    automation_type: 'Apex Trigger',
    object_name: objectName,
    trigger_events: events.length > 0 ? events.join(', ') : null,
    is_active: raw.Status === 'Active',
    has_description: false,
    is_managed_package: !!(raw.NamespacePrefix && raw.NamespacePrefix.trim()),
    parsed_data: {
      apiVersion: raw.ApiVersion || null,
      events,
      tableEnumOrId: raw.TableEnumOrId || null,
      handlerClass,
      hasDmlInBody,
      hasSoqlInBody,
      hasHardcodedIds,
      hasDebugWithoutLevel,
      hasXssFromEscapeFalse,
      hasSoqlInjectionRisk,
    },
  };
}

module.exports = { parseApexTrigger };
