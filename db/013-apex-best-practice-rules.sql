-- Migration 013: Apex Code Best Practice rules
-- Based on Salesforce Apex Code Best Practices documentation.
-- Requires parser enhancements in apexTrigger.js and apexClass.js
-- (hasSoqlInBody, hasHardcodedIds, hasFutureMethods) added alongside this migration.
-- These rules only produce findings for automations scanned after this migration is applied.

INSERT INTO rules
  (id, layer, name, description, severity, check_type, applies_to,
   recommendation_template, effort_estimate, is_builtin, sort_order)
VALUES

  -- APEX002: Trigger without handler class delegation
  -- Best practice: delegate all trigger logic to a handler class for testability,
  -- reusability, and proper bulk handling across shared governor limits.
  ('APEX002', 'quality',
   'Apex Trigger Without Handler Pattern',
   'This active Apex Trigger does not appear to delegate logic to a dedicated handler class. Embedding logic directly in the trigger body makes the code harder to test, reuse across triggers, and properly bulkify. Salesforce best practice is to keep the trigger body minimal — a single line dispatching to a handler.',
   'warning', 'per_item', ARRAY['Apex Trigger'],
   'Refactor ''{{api_name}}'' to keep the trigger body minimal and delegate all logic to a dedicated handler class (e.g. {{api_name}}Handler). This improves testability and ensures governor limits are shared correctly across invocations.',
   'medium', true, 131),

  -- APEX003: DML in trigger body
  -- Best practice: DML should live in a handler/service class that operates on
  -- collections, not in the trigger body where it may execute per-record.
  ('APEX003', 'risk',
   'DML Statements in Apex Trigger Body',
   'DML statements (insert, update, delete, upsert, or undelete) were detected directly in the trigger body of this automation. DML outside a handler class bypasses proper bulkification — if this trigger fires on a bulk load of 200 records, each record may cause a separate DML operation, rapidly exhausting the 150 DML statements per transaction limit.',
   'warning', 'per_item', ARRAY['Apex Trigger'],
   'Move all DML operations out of the ''{{api_name}}'' trigger body into a handler class method that accepts a List or Set of records and performs a single bulk DML call.',
   'medium', true, 132),

  -- APEX004: SOQL in trigger body
  -- Best practice: SOQL queries should be in a handler that runs once per transaction
  -- against a full record collection, never once per record in a loop.
  ('APEX004', 'risk',
   'SOQL Query in Apex Trigger Body',
   'SOQL queries were detected directly in the Apex trigger body. Queries in the trigger body are at elevated risk of executing inside for loops, rapidly consuming the 100 SOQL queries per transaction governor limit. For a bulk operation of 200 records, a single misplaced query can generate 200 query executions.',
   'warning', 'per_item', ARRAY['Apex Trigger'],
   'Move all SOQL queries out of the ''{{api_name}}'' trigger body into a handler class. The handler should query once for all affected records using a Set of IDs collected from Trigger.new, then operate on the result map.',
   'medium', true, 133),

  -- APEX005: Hardcoded Salesforce record IDs
  -- Best practice: IDs are org-specific. Code containing hardcoded IDs fails when
  -- deployed to sandboxes or after org refreshes.
  ('APEX005', 'quality',
   'Hardcoded Salesforce Record IDs',
   'Hardcoded Salesforce record IDs (15- or 18-character alphanumeric strings) were detected in this Apex code. Record IDs are environment-specific — an ID valid in production will not exist in a sandbox, and sandbox IDs change after a refresh. Hardcoded IDs cause deployment failures and silent data errors across environments.',
   'warning', 'per_item', ARRAY['Apex Trigger', 'Apex Class'],
   'Replace hardcoded record IDs in ''{{api_name}}'' with dynamic queries using stable, environment-independent fields such as DeveloperName, ExternalId__c, or a Custom Metadata Type. This ensures the code works correctly in all orgs.',
   'low', true, 134),

  -- APEX006: @future annotation usage
  -- Best practice: @future methods must be called with collections (not per-record)
  -- and are capped at 50 invocations per transaction, 200 per 24h per license.
  ('APEX006', 'quality',
   '@future Methods in Apex Class',
   'One or more @future (asynchronous) methods were detected in this Apex class. @future methods are capped at 50 invocations per transaction and 200 per 24-hour period per user license. Calling a @future method inside a loop — once per record — will exhaust this limit on any bulk operation and is a common cause of production failures.',
   'info', 'per_item', ARRAY['Apex Class'],
   'Review @future usage in ''{{api_name}}'': ensure each @future method is called once per transaction (passing a collection of IDs, not a single ID) and is never invoked inside a loop. Consider Queueable Apex for more flexibility, monitoring, and the ability to chain jobs.',
   'medium', true, 135),

  -- APEX007: Outdated API version
  -- Best practice: compile against a recent API version to benefit from governor
  -- limit increases, security patches, and new language/platform features.
  ('APEX007', 'quality',
   'Outdated Apex API Version',
   'This Apex code is compiled against an API version below 55.0 (Spring ''22), meaning it is missing multiple years of platform improvements including governor limit increases, security enhancements, new language features (null coalescing, safe navigation), and access to current platform APIs. Outdated API versions can also cause unexpected behavior differences from current org behavior.',
   'info', 'per_item', ARRAY['Apex Trigger', 'Apex Class'],
   'Update ''{{api_name}}'' to the current API version (58.0 or higher). Review the Salesforce release notes for any breaking changes between the current version and the target version before upgrading.',
   'low', true, 136);
