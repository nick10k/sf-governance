-- Migration 010: Switch automation_conflicts from pairwise to object-centric model
-- Old: one row per (automation_a, automation_b) pair
-- New: one row per Salesforce object, covering all conflicting automations on that object

-- Add new columns
ALTER TABLE automation_conflicts
  ADD COLUMN object_name   TEXT,
  ADD COLUMN automation_ids INTEGER[];

-- Migrate any existing pair rows
UPDATE automation_conflicts SET
  object_name = COALESCE(
    (SELECT ai.object_name FROM automation_inventory ai WHERE ai.id = automation_a_id),
    'Unknown'
  ),
  automation_ids = ARRAY[automation_a_id, automation_b_id];

-- Enforce NOT NULL on new columns
ALTER TABLE automation_conflicts
  ALTER COLUMN object_name   SET NOT NULL,
  ALTER COLUMN automation_ids SET NOT NULL;

-- Drop old pairwise FK columns
ALTER TABLE automation_conflicts
  DROP COLUMN automation_a_id,
  DROP COLUMN automation_b_id;

CREATE INDEX ON automation_conflicts (scan_id, object_name);
