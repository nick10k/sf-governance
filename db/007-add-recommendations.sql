-- Add effort_estimate and depends_on_rules to rules table
ALTER TABLE rules
  ADD COLUMN effort_estimate    TEXT DEFAULT 'medium'
    CHECK (effort_estimate IN ('low', 'medium', 'high')),
  ADD COLUMN depends_on_rules   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE rules SET effort_estimate = 'medium' WHERE id = 'WFR001';
UPDATE rules SET effort_estimate = 'low'    WHERE id = 'WFR002';
UPDATE rules SET effort_estimate = 'high',   depends_on_rules = ARRAY['WFR001'] WHERE id = 'WFR003';
UPDATE rules SET effort_estimate = 'medium' WHERE id = 'PB001';
UPDATE rules SET effort_estimate = 'low'    WHERE id = 'PB002';
UPDATE rules SET effort_estimate = 'low'    WHERE id = 'DESC001';
UPDATE rules SET effort_estimate = 'low'    WHERE id = 'NAME001';
UPDATE rules SET effort_estimate = 'medium' WHERE id = 'FLOW001';
UPDATE rules SET effort_estimate = 'medium' WHERE id = 'MULTI001';
UPDATE rules SET effort_estimate = 'medium' WHERE id = 'MULTI002';
UPDATE rules SET effort_estimate = 'high'   WHERE id = 'MULTI003';
UPDATE rules SET effort_estimate = 'medium', depends_on_rules = ARRAY['WFR001'] WHERE id = 'MULTI004';
UPDATE rules SET effort_estimate = 'low'    WHERE id = 'APEX001';
UPDATE rules SET effort_estimate = 'low'    WHERE id = 'INACT001';
UPDATE rules SET effort_estimate = 'low'    WHERE id = 'PKG001';

-- Holistic object-centric recommendations (one per object/group)
CREATE TABLE recommendations (
  id               SERIAL PRIMARY KEY,
  scan_id          INTEGER NOT NULL REFERENCES scans(id),
  org_id           INTEGER NOT NULL REFERENCES orgs(id),
  analysis_run_id  INTEGER NOT NULL REFERENCES analysis_runs(id),
  object_name      TEXT,      -- null = global/org-level recommendation
  pattern          TEXT NOT NULL, -- e.g. 'deprecated_plus_flow', 'apex_fragmented'
  title            TEXT NOT NULL,
  rationale        TEXT NOT NULL,
  steps            JSONB NOT NULL DEFAULT '[]', -- [{step: 1, text: "..."}, ...]
  recommended_path TEXT NOT NULL,
  alternative_path TEXT,
  severity         TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  effort_estimate  TEXT NOT NULL CHECK (effort_estimate IN ('low', 'medium', 'high')),
  priority_score   NUMERIC NOT NULL,
  depends_on       INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'accepted', 'dismissed')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON recommendations (scan_id);
CREATE INDEX ON recommendations (analysis_run_id);

-- One row per affected automation item per recommendation
CREATE TABLE recommendation_items (
  id                      SERIAL PRIMARY KEY,
  recommendation_id       INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  automation_inventory_id INTEGER REFERENCES automation_inventory(id)
);
