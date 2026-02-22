-- Add env column to orgs for reliable sandbox guard
ALTER TABLE orgs ADD COLUMN env TEXT NOT NULL DEFAULT 'production'
  CHECK (env IN ('production', 'sandbox'));

CREATE TABLE remediation_jobs (
  id                         SERIAL PRIMARY KEY,
  recommendation_id          INTEGER REFERENCES recommendations(id),
  org_id                     INTEGER NOT NULL REFERENCES orgs(id),
  pattern                    TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN (
                               'pending','generating','review','approved',
                               'deploying','deployed','failed','rolled_back'
                             )),
  source_metadata            JSONB NOT NULL,
  generated_metadata         TEXT,
  edited_metadata            TEXT,
  generation_notes           TEXT,
  conflict_warning           BOOLEAN NOT NULL DEFAULT FALSE,
  requires_manual_completion BOOLEAN NOT NULL DEFAULT FALSE,
  deployment_id              TEXT,
  deployed_at                TIMESTAMPTZ,
  verified_at                TIMESTAMPTZ,
  error_message              TEXT,
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE remediation_rollbacks (
  id                  SERIAL PRIMARY KEY,
  remediation_job_id  INTEGER NOT NULL REFERENCES remediation_jobs(id),
  original_metadata   TEXT NOT NULL,
  original_type       TEXT NOT NULL,
  original_api_name   TEXT NOT NULL,
  rolled_back_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON remediation_jobs (recommendation_id);
CREATE INDEX ON remediation_jobs (org_id);
CREATE INDEX ON remediation_rollbacks (remediation_job_id);
