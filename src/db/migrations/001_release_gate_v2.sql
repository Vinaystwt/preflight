CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS release_manifests (
  id text PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'preflight.release-manifest.v1'),
  manifest_hash text UNIQUE NOT NULL CHECK (manifest_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_runs (
  id text PRIMARY KEY,
  manifest_id text NOT NULL REFERENCES release_manifests(id),
  request_identity text NOT NULL,
  idempotency_key_hash text,
  lifecycle_status text NOT NULL,
  policy_version text NOT NULL,
  build_sha text NOT NULL,
  runtime_snapshot jsonb,
  runtime_snapshot_hash text CHECK (runtime_snapshot_hash IS NULL OR runtime_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  criterion_groups jsonb,
  decision text CHECK (decision IS NULL OR decision IN ('RELEASE','BLOCK','UNKNOWN')),
  report jsonb,
  report_token_hash text UNIQUE,
  report_expires_at timestamptz,
  published_at timestamptz,
  safe_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((published_at IS NULL AND report_token_hash IS NULL) OR (published_at IS NOT NULL AND report IS NOT NULL AND report_token_hash IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_runs_idempotency_idx ON verification_runs(idempotency_key_hash) WHERE idempotency_key_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_attempts (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES verification_runs(id),
  payment_identifier text,
  payment_payload_hash text,
  network text NOT NULL,
  asset text NOT NULL,
  amount_atomic text NOT NULL CHECK (amount_atomic ~ '^[0-9]+$'),
  pay_to text NOT NULL,
  payer text,
  verification_state text NOT NULL,
  settlement_state text NOT NULL,
  settlement_reference text UNIQUE,
  transaction_hash text,
  refund_owed boolean NOT NULL DEFAULT false,
  safe_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempt_identifier_idx ON payment_attempts(payment_identifier) WHERE payment_identifier IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempt_payload_idx ON payment_attempts(payment_payload_hash) WHERE payment_payload_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  run_id text REFERENCES verification_runs(id),
  payment_attempt_id text REFERENCES payment_attempts(id),
  event_type text NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  scope text NOT NULL,
  key_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key_hash, window_start)
);

CREATE INDEX IF NOT EXISTS verification_runs_status_idx ON verification_runs(lifecycle_status, updated_at);
CREATE INDEX IF NOT EXISTS payment_attempts_state_idx ON payment_attempts(settlement_state, updated_at);
CREATE INDEX IF NOT EXISTS audit_events_run_idx ON audit_events(run_id, created_at);
