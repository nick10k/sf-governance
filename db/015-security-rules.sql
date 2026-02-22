-- Migration 015: Apex Security rules derived from PMD Apex Security ruleset
-- Ref: https://docs.pmd-code.org/latest/pmd_rules_apex_security.html
-- Requires parser enhancements in apexClass.js (hasInsecureEndpoint, hasXssFromEscapeFalse,
-- hasDangerousMethodCall, missesShareDeclaration, hasSoqlInjectionRisk, hasCrudViolationRisk,
-- hasHardcodedCrypto, hasHardcodedCredentials, hasOpenRedirectRisk) and apexTrigger.js
-- (hasXssFromEscapeFalse, hasSoqlInjectionRisk) added alongside this migration.
--
-- Skipped rule: ApexXSSFromURLParam (requires data-flow tracking across statements —
-- not feasible with static regex analysis).

INSERT INTO rules
  (id, layer, name, description, severity, check_type, applies_to,
   recommendation_template, effort_estimate, is_builtin, sort_order)
VALUES

  -- SEC001: ApexInsecureEndpoint
  -- Callouts over plain HTTP expose data in transit and will fail Salesforce
  -- security review for managed packages.
  ('SEC001', 'risk',
   'Insecure HTTP Endpoint in Callout',
   'This Apex class makes an HTTP callout to a plain "http://" endpoint rather than "https://". Unencrypted connections expose all data transmitted — including credentials, tokens, and sensitive business data — to interception. Salesforce''s security review process for managed packages will reject code containing HTTP callouts, and many enterprise firewall policies block outbound HTTP.',
   'error', 'per_item', ARRAY['Apex Class'],
   'Update all callout endpoints in ''{{api_name}}'' from "http://" to "https://". If the target server does not support HTTPS, that is a separate remediation item on the server side. Additionally, consider storing the endpoint URL in a Custom Metadata Type or Named Credential rather than hardcoding it.',
   'low', true, 201),

  -- SEC002: ApexXSSFromEscapeFalse
  -- addError(message, false) renders raw HTML to the user — XSS vector.
  ('SEC002', 'risk',
   'XSS Risk: addError() With Escaping Disabled',
   'This Apex code calls addError(message, false), where the false flag disables HTML escaping of the error message. If any part of the message originates from user input, field values, or external data, an attacker can inject HTML or JavaScript that executes in the user''s browser when the error is displayed — a cross-site scripting (XSS) vulnerability.',
   'error', 'per_item', ARRAY['Apex Trigger', 'Apex Class'],
   'Remove the false escape parameter from all addError() calls in ''{{api_name}}'', or replace it with true. The default behaviour (with escaping enabled) is safe. Only pass false if you have verified that the message string is entirely static and never influenced by user-supplied data. Use String.escapeSingleQuotes() or HTMLENCODE() to sanitize any dynamic content.',
   'low', true, 202),

  -- SEC003: ApexDangerousMethods
  -- Configuration.disableTriggerCRUDSecurity() globally removes CRUD checks.
  ('SEC003', 'risk',
   'Dangerous Method: disableTriggerCRUDSecurity()',
   'This Apex class calls Configuration.disableTriggerCRUDSecurity(), a FinancialForce/fflib framework method that globally disables CRUD and FLS enforcement for the entire transaction. Any code executing after this call — including unrelated triggers and classes — will bypass object- and field-level security. This is a critical privilege-escalation risk that can allow unprivileged users to read, create, or modify records they should not have access to.',
   'error', 'per_item', ARRAY['Apex Class'],
   'Remove the Configuration.disableTriggerCRUDSecurity() call from ''{{api_name}}''. Instead, add explicit permission checks (isAccessible(), isCreateable(), isUpdateable(), isDeletable()) before each operation that requires them, or use WITH SECURITY_ENFORCED / Security.stripInaccessible() in SOQL queries. This scopes security enforcement to the specific operation rather than disabling it globally.',
   'medium', true, 203),

  -- SEC004: ApexSharingViolations
  -- Class performs DML/SOQL but has no sharing declaration — runs in caller context.
  ('SEC004', 'risk',
   'Missing Sharing Declaration on Class With Data Operations',
   'This Apex class performs SOQL queries or DML operations but does not declare a sharing mode (with sharing, without sharing, or inherited sharing). Without an explicit declaration, the class runs in the sharing context of its caller — which is typically system context for trigger-invoked code, meaning all sharing rules are ignored. This can expose records that the running user does not have permission to see or modify.',
   'warning', 'per_item', ARRAY['Apex Class'],
   'Add an explicit sharing declaration to ''{{api_name}}''. Use ''with sharing'' to enforce the running user''s sharing rules (recommended for most service and controller classes). Use ''without sharing'' only where system-level access is explicitly required and documented. Use ''inherited sharing'' if the class is designed to be called from both contexts. Declaring ''without sharing'' deliberately is safer than the implicit default because it signals intent.',
   'low', true, 204),

  -- SEC005: ApexSOQLInjection
  -- Database.query() without String.escapeSingleQuotes() — injection risk.
  ('SEC005', 'risk',
   'SOQL Injection Risk: Dynamic Query Without Sanitization',
   'This Apex code uses Database.query() to execute a dynamic SOQL string but does not call String.escapeSingleQuotes() to sanitize user-supplied input. If any portion of the query string is derived from user input — such as URL parameters, form fields, or record field values — an attacker can inject SOQL clauses that bypass WHERE conditions, exfiltrate records from other objects, or modify query logic to access unauthorised data.',
   'error', 'per_item', ARRAY['Apex Trigger', 'Apex Class'],
   'Sanitize all user-supplied values in ''{{api_name}}'' before embedding them in a dynamic SOQL string: wrap each variable with String.escapeSingleQuotes(variable). Alternatively, replace dynamic SOQL with static SOQL using bind variables (e.g. WHERE Name = :nameVar) wherever possible — bind variables are immune to injection by design. Never concatenate raw field values, URL parameters, or user inputs directly into a SOQL string.',
   'medium', true, 205),

  -- SEC006: ApexCRUDViolation
  -- DML/SOQL without CRUD/FLS checks — bypasses org access controls.
  ('SEC006', 'risk',
   'CRUD/FLS Violation: Data Operation Without Permission Check',
   'This Apex class performs SOQL queries or DML operations without checking object- or field-level security permissions (isAccessible(), isCreateable(), isUpdateable(), isDeletable(), WITH SECURITY_ENFORCED, WITH USER_MODE, or Security.stripInaccessible()). Code running in system context — which is common in Apex — can read and modify records or fields that the running user is not authorised to access, violating the principle of least privilege.',
   'warning', 'per_item', ARRAY['Apex Class'],
   'Add CRUD and FLS checks to ''{{api_name}}'' before each data operation: use Schema.SObjectType.ObjectName.isAccessible() / isCreateable() / isUpdateable() / isDeletable() to guard operations, add WITH SECURITY_ENFORCED or WITH USER_MODE to SOQL queries to enforce field-level security inline, or call Security.stripInaccessible(AccessType, records) to remove inaccessible fields before returning or committing data.',
   'medium', true, 206),

  -- SEC007: ApexBadCrypto
  -- Blob.valueOf('literal') used as IV or key in Crypto API call.
  ('SEC007', 'risk',
   'Hardcoded Cryptographic IV or Key',
   'This Apex class calls the Salesforce Crypto API while using Blob.valueOf(''literal string'') as an initialization vector (IV) or encryption key. Hardcoded IV and key values completely undermine encryption security: anyone with access to the source code, version control history, or a decompiled managed package can recover the key and decrypt all data protected by it. A fixed IV also eliminates the semantic security guarantees of block cipher modes like CBC.',
   'error', 'per_item', ARRAY['Apex Class'],
   'Replace the hardcoded Blob.valueOf() IV and key in ''{{api_name}}'' with cryptographically random values generated at runtime: use Crypto.generateAesKey(256) to create a random AES key and Crypto.generateMac() or a random byte generator for the IV. Store long-lived keys securely in Custom Metadata, Protected Custom Settings, or a Named Credential — never in source code.',
   'medium', true, 207),

  -- SEC008: ApexSuggestUsingNamedCred
  -- Manual Authorization header construction instead of Named Credentials.
  ('SEC008', 'risk',
   'Hardcoded Credentials in HTTP Callout',
   'This Apex class sets an Authorization header manually on an HTTP request rather than using a Salesforce Named Credential. Credentials embedded directly in Apex source code — whether as literals or constructed via EncodingUtil.base64Encode — are exposed to anyone with access to the codebase, version control history, or org metadata. They are also difficult to rotate without a code deployment, increasing the window of exposure after a credential compromise.',
   'warning', 'per_item', ARRAY['Apex Class'],
   'Replace the manual Authorization header in ''{{api_name}}'' with a Named Credential: configure the external service credentials in Setup → Named Credentials, then reference it in the callout as ''callout:NamedCredentialName/path''. Named Credentials store secrets encrypted in Salesforce infrastructure, support per-user authentication, and can be rotated without code changes.',
   'low', true, 208),

  -- SEC009: ApexOpenRedirect
  -- PageReference from getCurrentPage().getParameters() — open redirect.
  ('SEC009', 'risk',
   'Open Redirect: PageReference From URL Parameters',
   'This Apex class constructs a PageReference from values obtained via getCurrentPage().getParameters(), creating an open redirect vulnerability. An attacker can craft a link to the org''s Salesforce domain with a manipulated URL parameter that causes the page to redirect users to an arbitrary external site — enabling phishing attacks that appear to originate from a trusted Salesforce domain.',
   'warning', 'per_item', ARRAY['Apex Class'],
   'Validate the URL parameter value in ''{{api_name}}'' before constructing a PageReference: maintain an allowlist of permitted redirect targets, verify the destination is within your Salesforce org (starts with the known instance URL), or redesign the flow to avoid user-controlled redirects entirely. Never construct a PageReference directly from a raw URL parameter without validation.',
   'low', true, 209);
