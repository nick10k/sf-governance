CREATE TABLE rules (
  id                      TEXT PRIMARY KEY,
  layer                   TEXT NOT NULL,
  name                    TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  severity                TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  check_type              TEXT NOT NULL CHECK (check_type IN ('per_item', 'cross_item')),
  applies_to              TEXT[] NOT NULL DEFAULT '{}',
  recommendation_template TEXT NOT NULL DEFAULT '',
  conditions              JSONB,
  is_builtin              BOOLEAN NOT NULL DEFAULT false,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed built-in rules from library.json
INSERT INTO rules (id, layer, name, description, severity, check_type, applies_to, recommendation_template, is_builtin, sort_order) VALUES
  ('WFR001', 'platform', 'Active Workflow Rule',
   'Workflow Rules are deprecated by Salesforce and scheduled for retirement. Active rules should be migrated to Record-Triggered Flows.',
   'error', 'per_item', ARRAY['Workflow Rule'],
   'Migrate the active Workflow Rule ''{{api_name}}'' on {{object_name}} to a Record-Triggered Flow.',
   true, 10),

  ('WFR002', 'platform', 'Inactive Workflow Rule',
   'Even inactive Workflow Rules will be removed when Salesforce retires the feature. Migrate or delete this rule.',
   'warning', 'per_item', ARRAY['Workflow Rule'],
   'Migrate or delete the inactive Workflow Rule ''{{api_name}}'' on {{object_name}} before Salesforce retires the feature.',
   true, 20),

  ('WFR003', 'platform', 'Workflow Rule with Outbound Message',
   'Outbound Messages are also being retired by Salesforce. Workflow Rules containing Outbound Message actions need to be replaced with Flows using external service callouts.',
   'error', 'per_item', ARRAY['Workflow Rule'],
   'Replace Workflow Rule ''{{api_name}}'' and its Outbound Message action on {{object_name}} with a Record-Triggered Flow using an external service callout.',
   true, 30),

  ('PB001', 'platform', 'Active Process Builder',
   'Process Builder is deprecated by Salesforce. Active processes should be migrated to Flows.',
   'error', 'per_item', ARRAY['Process Builder'],
   'Migrate the active Process Builder ''{{api_name}}'' to a Flow.',
   true, 40),

  ('PB002', 'platform', 'Inactive Process Builder',
   'Even inactive Process Builders will be affected when Salesforce retires the feature. Migrate or delete this process.',
   'warning', 'per_item', ARRAY['Process Builder'],
   'Migrate or delete the inactive Process Builder ''{{api_name}}'' before Salesforce retires the feature.',
   true, 50),

  ('DESC001', 'quality', 'Missing Description',
   'Active automations without descriptions are harder to maintain and audit. All active, non-managed automations should have a description explaining their purpose.',
   'warning', 'per_item', ARRAY['Workflow Rule', 'Record-Triggered Flow', 'Autolaunched Flow', 'Screen Flow', 'Process Builder', 'Apex Trigger'],
   'Add a description to ''{{api_name}}'' explaining its purpose and business context.',
   true, 60),

  ('NAME001', 'quality', 'Naming Convention Violation',
   'Automation API names do not follow the org''s configured naming convention. Consistent naming improves discoverability and maintainability.',
   'warning', 'per_item', ARRAY[]::TEXT[],
   'Rename ''{{api_name}}'' to match the org naming convention.',
   true, 70),

  ('FLOW001', 'quality', 'Record-Triggered Flow Missing Object',
   'A Record-Triggered Flow has no associated object, which indicates a misconfiguration — it will not trigger as expected.',
   'warning', 'per_item', ARRAY['Record-Triggered Flow'],
   'Review ''{{api_name}}'' — it is a Record-Triggered Flow but has no object configured.',
   true, 80),

  ('MULTI001', 'risk', 'Multiple Active Flows on Same Object and Event',
   'Multiple active Record-Triggered Flows firing on the same object and trigger event can cause ordering issues, data conflicts, and governor limit errors.',
   'warning', 'cross_item', ARRAY[]::TEXT[], '', true, 90),

  ('MULTI002', 'risk', 'Apex Trigger and Flow on Same Object',
   'An active Apex Trigger and a Record-Triggered Flow both operate on the same object. This creates implicit ordering dependencies and can lead to unexpected behavior.',
   'info', 'cross_item', ARRAY[]::TEXT[], '', true, 100),

  ('MULTI003', 'risk', 'Multiple Active Apex Triggers on Same Object',
   'Multiple Apex Triggers on the same object fire in an undefined order. This is dangerous — consolidate them into a single trigger handler pattern.',
   'error', 'cross_item', ARRAY[]::TEXT[], '', true, 110),

  ('MULTI004', 'risk', 'Workflow Rule and Flow on Same Object',
   'An active Workflow Rule and an active Flow both operate on the same object, creating redundant and potentially conflicting automation.',
   'warning', 'cross_item', ARRAY[]::TEXT[], '', true, 120),

  ('APEX001', 'risk', 'Active Apex Trigger',
   'Apex Triggers are powerful but require developer expertise to maintain. Ensure each trigger is documented and owned by a developer on the team.',
   'info', 'per_item', ARRAY['Apex Trigger'],
   'Document the purpose of Apex Trigger ''{{api_name}}'' on {{object_name}} and confirm a developer owner.',
   true, 130),

  ('INACT001', 'housekeeping', 'Inactive Non-Managed Automation',
   'Inactive automations that are not part of a managed package add clutter and confusion. Consider deleting them if no longer needed.',
   'info', 'per_item', ARRAY[]::TEXT[],
   'Review ''{{api_name}}'' — it is inactive. Delete it if it is no longer needed.',
   true, 140),

  ('PKG001', 'housekeeping', 'Managed Package Automation',
   'This automation is part of a managed (AppExchange) package. It cannot be edited directly. Ensure the package is still needed and up to date.',
   'info', 'per_item', ARRAY[]::TEXT[],
   'Verify that the managed package automation ''{{api_name}}'' is still required and the package is current.',
   true, 150);
