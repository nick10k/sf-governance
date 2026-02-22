CREATE TABLE customer_profiles (
  id                        SERIAL PRIMARY KEY,
  org_id                    INTEGER NOT NULL REFERENCES orgs(id) UNIQUE,
  automation_preference     TEXT NOT NULL DEFAULT 'flow_first'
                            CHECK (automation_preference IN ('flow_first', 'apex_first', 'balanced')),
  active_rule_layers        TEXT[] NOT NULL DEFAULT ARRAY['platform', 'quality', 'risk', 'housekeeping'],
  suppressed_rule_ids       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  naming_convention_pattern TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE findings (
  id                      SERIAL PRIMARY KEY,
  scan_id                 INTEGER NOT NULL REFERENCES scans(id),
  org_id                  INTEGER NOT NULL REFERENCES orgs(id),
  rule_id                 TEXT NOT NULL,
  severity                TEXT NOT NULL,
  automation_inventory_id INTEGER REFERENCES automation_inventory(id),
  api_name                TEXT,
  object_name             TEXT,
  message                 TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON findings (scan_id);
CREATE INDEX ON findings (severity);
