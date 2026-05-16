-- Generalize buys → trades (buy + sell).
-- Safe to run after 001_init.sql; if `buys` exists we migrate rows over.

CREATE TABLE IF NOT EXISTS trades (
  tx_sig       TEXT PRIMARY KEY,
  wallet       TEXT NOT NULL REFERENCES wallets(address),
  side         TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  sol_amount   NUMERIC(20,9) NOT NULL,
  slot         BIGINT NOT NULL DEFAULT 0,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(wallet);
CREATE INDEX IF NOT EXISTS idx_trades_side   ON trades(side);
CREATE INDEX IF NOT EXISTS idx_trades_ts     ON trades(ts DESC);

-- copy over any rows from the legacy buys table
INSERT INTO trades (tx_sig, wallet, side, sol_amount, slot, ts)
SELECT tx_sig, buyer, 'buy', sol_spent, slot, ts
FROM buys
ON CONFLICT (tx_sig) DO NOTHING;

-- expand kind constraint on point_events to include sell kinds
DO $$ BEGIN
  ALTER TABLE point_events DROP CONSTRAINT IF EXISTS point_events_kind_check;
  ALTER TABLE point_events ADD CONSTRAINT point_events_kind_check
    CHECK (kind IN ('buy', 'referral', 'sell', 'referral_sell'));
END $$;
