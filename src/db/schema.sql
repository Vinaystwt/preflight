CREATE TABLE IF NOT EXISTS targets (
  id text PRIMARY KEY,
  endpoint_url text UNIQUE NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  badge_eligible boolean NOT NULL DEFAULT false
);

ALTER TABLE targets ADD COLUMN IF NOT EXISTS badge_eligible boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS checks (
  id text PRIMARY KEY,
  target_id text NOT NULL REFERENCES targets(id),
  kind text NOT NULL,
  expected jsonb,
  results jsonb NOT NULL,
  verdict text NOT NULL,
  score integer NOT NULL,
  findings jsonb NOT NULL,
  attestation_tx text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitors (
  id text PRIMARY KEY,
  target_id text NOT NULL REFERENCES targets(id),
  interval_s integer NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz
);

ALTER TABLE monitors ADD COLUMN IF NOT EXISTS next_run_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS last_run_at timestamptz;

CREATE TABLE IF NOT EXISTS probes (
  monitor_id text NOT NULL REFERENCES monitors(id),
  ts timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  latency_ms integer,
  finding_code text
);

CREATE TABLE IF NOT EXISTS calls (
  id text PRIMARY KEY,
  check_id text REFERENCES checks(id),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  tool text NOT NULL,
  price_usdt numeric(20, 6) NOT NULL,
  settle_ref text,
  settle_status text NOT NULL,
  payer text,
  owner_attestation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spend_ledger (
  id text PRIMARY KEY,
  target_url text NOT NULL,
  amount_usdt numeric(20, 6) NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved', 'spent', 'failed')),
  settle_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_attestations (
  id text PRIMARY KEY,
  check_id text UNIQUE NOT NULL REFERENCES checks(id),
  report_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'confirmed')) DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playground_usage (
  day date NOT NULL,
  usage_key text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, usage_key)
);

CREATE TABLE IF NOT EXISTS health_index_snapshots (
  id text PRIMARY KEY,
  aggregate jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checks_target_created_idx ON checks(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_check_idx ON calls(check_id);
CREATE INDEX IF NOT EXISTS spend_ledger_target_created_idx ON spend_ledger(target_url, created_at DESC);
CREATE INDEX IF NOT EXISTS spend_ledger_created_idx ON spend_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS pending_attestations_ready_idx ON pending_attestations(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS monitors_due_idx ON monitors(status, next_run_at);
CREATE INDEX IF NOT EXISTS health_index_created_idx ON health_index_snapshots(created_at DESC);
