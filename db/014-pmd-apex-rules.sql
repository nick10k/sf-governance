-- Migration 014: Additional Apex best practice rules from PMD Apex ruleset
-- Ref: https://docs.pmd-code.org/latest/pmd_rules_apex_bestpractices.html
-- Requires parser enhancements in apexClass.js (hasSeeAllDataTrue, hasTestMethodKeyword,
-- hasGlobalModifier, hasDebugWithoutLevel, isQueueableWithoutFinalizer,
-- isTestClassWithoutAsserts, isTestClassWithoutRunAs) and apexTrigger.js
-- (hasDebugWithoutLevel) added alongside this migration.

INSERT INTO rules
  (id, layer, name, description, severity, check_type, applies_to,
   recommendation_template, effort_estimate, is_builtin, sort_order)
VALUES

  -- APEX008: @isTest(seeAllData=true)
  -- PMD: ApexUnitTestShouldNotUseSeeAllDataTrue
  -- Tests that access real org data are fragile, environment-specific, and can
  -- silently corrupt production records if run in the wrong context.
  ('APEX008', 'risk',
   '@isTest with seeAllData=true',
   'This test class uses @isTest(seeAllData=true), which grants the test access to all real org data rather than requiring it to create its own isolated test records. This makes the test fragile (results depend on org state), environment-specific (fails if expected data is absent), and potentially destructive (DML operations inside the test can modify or delete production records).',
   'warning', 'per_item', ARRAY['Apex Class'],
   'Remove seeAllData=true from the @isTest annotation on ''{{api_name}}''. Create all required test data explicitly within the test using @testSetup methods or inline setup. Use Test.loadData() for complex datasets. The test should pass in any empty org.',
   'low', true, 137),

  -- APEX009: Deprecated testMethod keyword
  -- PMD: ApexUnitTestMethodShouldHaveIsTestAnnotation
  -- The testMethod modifier was deprecated and may behave unexpectedly at newer
  -- API versions. @isTest is the supported replacement.
  ('APEX009', 'quality',
   'Deprecated testMethod Keyword',
   'This Apex class uses the deprecated testMethod keyword to mark test methods. The testMethod modifier has been replaced by the @isTest annotation since API version 28.0. Using the deprecated keyword can cause unexpected behaviour in newer API versions and is flagged by Salesforce''s own static analysis tooling.',
   'info', 'per_item', ARRAY['Apex Class'],
   'Replace all occurrences of the testMethod keyword in ''{{api_name}}'' with the @isTest annotation on each method. For example: change ''static testMethod void myTest()'' to ''@isTest static void myTest()''. No logic changes are required.',
   'low', true, 138),

  -- APEX010: Global class modifier
  -- PMD: AvoidGlobalModifier
  -- Global access cannot be reduced or removed post-deployment. Unnecessary global
  -- classes permanently expand the org's external API surface.
  ('APEX010', 'quality',
   'Unnecessary Global Class Modifier',
   'This Apex class is declared with the global access modifier. Global classes and their global members become a permanent, unremovable part of the org''s external API — they cannot be deleted, made less accessible, or have their global members removed without breaking any consumer. Unless this class is explicitly designed as an external API (e.g. for a managed package or Lightning component apex:attribute), global scope is unnecessary and over-permissive.',
   'warning', 'per_item', ARRAY['Apex Class'],
   'Review whether ''{{api_name}}'' truly requires global scope. If it is only used within the same org (no managed package distribution, no external consumers), change the class modifier to public. Ensure all method and property signatures are also reduced from global to public where applicable.',
   'low', true, 139),

  -- APEX011: System.debug() without LoggingLevel
  -- PMD: DebugsShouldUseLoggingLevel
  -- Unleveled debug calls default to DEBUG, flooding logs and masking real errors.
  ('APEX011', 'quality',
   'System.debug() Without Logging Level',
   'One or more System.debug() calls in this Apex code do not specify a LoggingLevel parameter. Calls without an explicit level default to LoggingLevel.DEBUG, generating excessive log output in production. This makes it harder to find meaningful log entries, can cause log truncation that hides actual errors, and degrades performance of log-heavy transactions.',
   'info', 'per_item', ARRAY['Apex Trigger', 'Apex Class'],
   'Update all System.debug() calls in ''{{api_name}}'' to specify an explicit log level, e.g. System.debug(LoggingLevel.ERROR, ''message'') for error conditions, System.debug(LoggingLevel.INFO, ''message'') for informational output, or System.debug(LoggingLevel.FINE, ''message'') for diagnostic traces that should be off by default.',
   'low', true, 140),

  -- APEX012: Queueable without finalizer
  -- PMD: QueueableWithoutFinalizer
  -- Async jobs without a finalizer have no failure-recovery or monitoring hook.
  ('APEX012', 'quality',
   'Queueable Job Without Finalizer',
   'This Apex class implements the Queueable interface but does not call System.attachFinalizer() in its execute() method. Without a finalizer, there is no mechanism to detect, log, or react to failures in the async job — failed jobs will silently disappear with no notification, retry, or compensating logic. Finalizers were introduced in API v52.0 specifically to address this gap.',
   'warning', 'per_item', ARRAY['Apex Class'],
   'Add a Finalizer implementation to ''{{api_name}}'': create a class implementing System.Finalizer, implement the execute(System.FinalizerContext ctx) method to log failures or trigger compensating logic, and call System.attachFinalizer(new MyFinalizer()) at the start of the Queueable''s execute() method.',
   'medium', true, 141),

  -- APEX013: Test class without assertions
  -- PMD: ApexUnitTestClassShouldHaveAsserts
  -- Tests that run code without asserting outcomes provide no coverage guarantee
  -- and will pass even when the code is completely broken.
  ('APEX013', 'quality',
   'Test Class Without Assertions',
   'No calls to System.assert(), System.assertEquals(), System.assertNotEquals(), or the Assert class were detected in this test class. Test methods that exercise code without asserting expected outcomes will pass even when the tested code produces incorrect results, throws swallowed exceptions, or returns null — giving false confidence in test coverage metrics.',
   'warning', 'per_item', ARRAY['Apex Class'],
   'Add meaningful assertions to each test method in ''{{api_name}}''. Use System.assertEquals(expected, actual, ''message'') to verify return values, Assert.isNotNull(result) to confirm records were created, or Assert.isTrue(condition, ''message'') for boolean outcomes. Each test method should have at least one assertion that would fail if the tested behaviour regressed.',
   'low', true, 142),

  -- APEX014: Test class without System.runAs
  -- PMD: ApexUnitTestClassShouldHaveRunAs
  -- Tests without runAs run as system context, bypassing sharing and profile
  -- permissions — hiding access control bugs that surface in production.
  ('APEX014', 'quality',
   'Test Class Without System.runAs()',
   'No calls to System.runAs() were detected in this test class. Tests that run without System.runAs() execute in system context, which bypasses all sharing rules, field-level security, and profile-based permissions. This means the test may pass in any context but the code could fail for real users who lack the required access — a common source of production support issues.',
   'info', 'per_item', ARRAY['Apex Class'],
   'Wrap the core test logic in ''{{api_name}}'' with System.runAs(testUser) where testUser is a test User record created with the minimum profile and permissions that the real feature requires. This ensures the tested code behaves correctly under realistic access constraints, not just in system context.',
   'low', true, 143);
