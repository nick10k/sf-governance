CREATE TABLE automation_inventory (
  id                  SERIAL PRIMARY KEY,
  metadata_item_id    INTEGER REFERENCES metadata_items(id),
  org_id              INTEGER NOT NULL REFERENCES orgs(id),
  automation_type     TEXT NOT NULL,
  api_name            TEXT NOT NULL,
  label               TEXT,
  object_name         TEXT,
  trigger_events      TEXT,
  is_active           BOOLEAN,
  has_description     BOOLEAN,
  is_managed_package  BOOLEAN,
  parsed_data         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON automation_inventory (org_id);
CREATE INDEX ON automation_inventory (automation_type);
CREATE INDEX ON automation_inventory (object_name);
CREATE INDEX ON metadata_items (scan_id);
CREATE INDEX ON metadata_items (org_id);
CREATE INDEX ON metadata_items (type);
