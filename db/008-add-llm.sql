-- LLM cache — deduplication across all API calls (keyed by SHA-256 of inputs)
CREATE TABLE llm_cache (
  id          SERIAL PRIMARY KEY,
  input_hash  TEXT UNIQUE NOT NULL,
  feature     TEXT NOT NULL,
  response    TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Apex plain-English summaries stored on the inventory record
ALTER TABLE automation_inventory
  ADD COLUMN llm_summary               TEXT,
  ADD COLUMN llm_summary_generated_at  TIMESTAMPTZ;

-- Consultant-style narratives stored on recommendation records
ALTER TABLE recommendations
  ADD COLUMN llm_rationale               TEXT,
  ADD COLUMN llm_rationale_generated_at  TIMESTAMPTZ;

-- Detected automation conflict pairs (one row per pair per scan)
CREATE TABLE automation_conflicts (
  id               SERIAL PRIMARY KEY,
  scan_id          INTEGER REFERENCES scans(id),
  org_id           INTEGER REFERENCES orgs(id),
  automation_a_id  INTEGER REFERENCES automation_inventory(id),
  automation_b_id  INTEGER REFERENCES automation_inventory(id),
  conflict_analysis TEXT NOT NULL,
  severity         TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  llm_generated    BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON automation_conflicts (scan_id);
