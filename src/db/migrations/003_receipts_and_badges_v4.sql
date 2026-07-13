CREATE TABLE IF NOT EXISTS pubkeys (
  key_id text PRIMARY KEY,
  algorithm text NOT NULL CHECK (algorithm = 'Ed25519'),
  public_key_base64 text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','retired')) DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);

CREATE TABLE IF NOT EXISTS receipts (
  id text PRIMARY KEY,
  report_id text NOT NULL REFERENCES verification_runs(id),
  key_id text NOT NULL REFERENCES pubkeys(key_id),
  payload jsonb NOT NULL,
  signature text NOT NULL,
  chain_anchor_tx text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id)
);

CREATE INDEX IF NOT EXISTS receipts_report_idx ON receipts(report_id);
CREATE INDEX IF NOT EXISTS receipts_created_idx ON receipts(created_at DESC);

CREATE TABLE IF NOT EXISTS badge_events (
  id text PRIMARY KEY,
  report_id text NOT NULL REFERENCES verification_runs(id),
  receipt_id text REFERENCES receipts(id),
  status text NOT NULL CHECK (status IN ('issued','denied','expired')),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS badge_events_report_created_idx ON badge_events(report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gallery_entries (
  id text PRIMARY KEY,
  report_id text NOT NULL UNIQUE REFERENCES verification_runs(id),
  decision text NOT NULL CHECK (decision IN ('BLOCK','UNKNOWN')),
  policy_version text NOT NULL,
  redacted_report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gallery_entries_created_idx ON gallery_entries(created_at DESC);
