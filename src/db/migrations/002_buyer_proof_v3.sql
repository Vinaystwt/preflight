CREATE TABLE IF NOT EXISTS buyer_proof_spend (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES verification_runs(id),
  target_url text NOT NULL,
  amount_atomic numeric(78,0) NOT NULL,
  amount_usdt numeric(18,6) NOT NULL,
  terms_hash text NOT NULL,
  idempotency_key_hash text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('reserved','settled','failed','aborted')),
  settlement_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buyer_proof_spend_target_created_idx ON buyer_proof_spend(target_url, created_at DESC);
CREATE INDEX IF NOT EXISTS buyer_proof_spend_created_idx ON buyer_proof_spend(created_at DESC);
