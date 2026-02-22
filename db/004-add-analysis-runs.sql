CREATE TABLE analysis_runs (
  id            SERIAL PRIMARY KEY,
  scan_id       INTEGER NOT NULL REFERENCES scans(id),
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finding_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ON analysis_runs (scan_id);

ALTER TABLE findings ADD COLUMN analysis_run_id INTEGER REFERENCES analysis_runs(id);
