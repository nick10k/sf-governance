CREATE TABLE accounts (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orgs ADD COLUMN account_id INTEGER REFERENCES accounts(id);
