CREATE TABLE orgs (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    instance_url  TEXT NOT NULL,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scans (
    id            SERIAL PRIMARY KEY,
    org_id        INTEGER NOT NULL REFERENCES orgs(id),
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    error_message TEXT
);

CREATE TABLE metadata_items (
    id         SERIAL PRIMARY KEY,
    scan_id    INTEGER NOT NULL REFERENCES scans(id),
    org_id     INTEGER NOT NULL REFERENCES orgs(id),
    type       TEXT NOT NULL,
    api_name   TEXT NOT NULL,
    label      TEXT,
    raw_json   JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
