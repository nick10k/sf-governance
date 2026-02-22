-- Migration 011: merge conflict analysis into recommendation records
-- Conflict detection now runs as part of the analysis pipeline and writes
-- its results directly into the matching recommendation row.

ALTER TABLE recommendations
  ADD COLUMN conflict_analysis TEXT,
  ADD COLUMN conflict_severity TEXT;

ALTER TABLE automation_conflicts
  ADD COLUMN analysis_run_id INTEGER REFERENCES analysis_runs(id);

CREATE INDEX ON automation_conflicts (analysis_run_id);
