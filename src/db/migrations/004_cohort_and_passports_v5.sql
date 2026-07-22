-- v5 is additive: legacy release-gate tables remain untouched.
CREATE TABLE IF NOT EXISTS agent_resolutions (
  agent_id text PRIMARY KEY,
  name jsonb NOT NULL,
  description jsonb NOT NULL,
  category_code jsonb NOT NULL,
  status jsonb NOT NULL,
  services jsonb NOT NULL,
  resolution_source text NOT NULL,
  resolved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS cohort_scans (
  scan_id text PRIMARY KEY,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  asps_scanned integer NOT NULL DEFAULT 0,
  policy_version text NOT NULL
);

CREATE TABLE IF NOT EXISTS cohort_results (
  id text PRIMARY KEY,
  scan_id text NOT NULL REFERENCES cohort_scans(scan_id),
  agent_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('RELEASE','BLOCK','UNKNOWN')),
  criterion_codes text[] NOT NULL DEFAULT '{}',
  declared jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed jsonb NOT NULL DEFAULT '{}'::jsonb,
  reachable boolean NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cohort_results_agent_checked_idx ON cohort_results(agent_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS cohort_results_scan_idx ON cohort_results(scan_id);

CREATE TABLE IF NOT EXISTS drift_events (
  id text PRIMARY KEY,
  agent_id text NOT NULL,
  field text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  scan_id text REFERENCES cohort_scans(scan_id)
);
CREATE INDEX IF NOT EXISTS drift_events_agent_detected_idx ON drift_events(agent_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS passports (
  agent_id text PRIMARY KEY,
  receipt_id text NOT NULL REFERENCES receipts(id),
  decision text NOT NULL CHECK (decision = 'RELEASE'),
  policy_version text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revocation_reason text,
  asserted_fields jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_runs (
  run_id text PRIMARY KEY,
  policy_version text NOT NULL,
  generated_at timestamptz NOT NULL,
  total integer NOT NULL,
  passing integer NOT NULL,
  cases jsonb NOT NULL
);

