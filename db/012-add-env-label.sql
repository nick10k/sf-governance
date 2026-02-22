-- Migration 012: store a human-readable environment label per org
-- env stays as 'production' | 'sandbox' (used for OAuth login URL + sandbox guard).
-- env_label stores the specific type chosen at connect time
-- (e.g. 'Developer Sandbox', 'Full Sandbox', 'Scratch Org', 'Production').

ALTER TABLE orgs ADD COLUMN env_label TEXT;
