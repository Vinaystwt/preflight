-- v5 additive publication record for PreFlight's own paid self-check.
CREATE TABLE IF NOT EXISTS self_checks (
  id text PRIMARY KEY,
  report_id text NOT NULL REFERENCES verification_runs(id),
  receipt_id text REFERENCES receipts(id),
  decision text NOT NULL CHECK (decision IN ('RELEASE','BLOCK','UNKNOWN')),
  settlement_ref text,
  label text NOT NULL,
  customer_demand boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS self_checks_published_idx ON self_checks(published_at DESC);
