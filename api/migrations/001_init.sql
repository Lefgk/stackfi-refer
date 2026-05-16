-- wallets we've seen (lazy-created on first reference)
CREATE TABLE IF NOT EXISTS wallets (
  address     TEXT PRIMARY KEY,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- one row per (referee). a wallet can have at most one referrer, locked forever.
CREATE TABLE IF NOT EXISTS referrals (
  referee     TEXT PRIMARY KEY REFERENCES wallets(address),
  referrer    TEXT NOT NULL REFERENCES wallets(address),
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claim_sig   TEXT,
  CHECK (referee <> referrer)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer);

-- every on-chain buy we've indexed. tx_sig is the dedup key.
CREATE TABLE IF NOT EXISTS buys (
  tx_sig      TEXT PRIMARY KEY,
  buyer       TEXT NOT NULL REFERENCES wallets(address),
  sol_spent   NUMERIC(20,9) NOT NULL,
  slot        BIGINT NOT NULL DEFAULT 0,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_buys_buyer ON buys(buyer);
CREATE INDEX IF NOT EXISTS idx_buys_ts    ON buys(ts DESC);

-- one row per (tx, kind, recipient). idempotent.
CREATE TABLE IF NOT EXISTS point_events (
  id          BIGSERIAL PRIMARY KEY,
  wallet      TEXT NOT NULL REFERENCES wallets(address),
  amount      BIGINT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('buy', 'referral')),
  src_tx      TEXT REFERENCES buys(tx_sig),
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (src_tx, kind, wallet)
);
CREATE INDEX IF NOT EXISTS idx_pe_wallet ON point_events(wallet);
CREATE INDEX IF NOT EXISTS idx_pe_kind   ON point_events(kind);

-- aggregate view: real-time balances + ref counts
CREATE OR REPLACE VIEW balances AS
SELECT
  w.address                                                          AS wallet,
  COALESCE(SUM(pe.amount), 0)                                        AS points,
  COALESCE(SUM(CASE WHEN pe.kind='buy'      THEN pe.amount END), 0)  AS buy_points,
  COALESCE(SUM(CASE WHEN pe.kind='referral' THEN pe.amount END), 0)  AS ref_points,
  (SELECT COUNT(*) FROM referrals r WHERE r.referrer = w.address)    AS refs
FROM wallets w
LEFT JOIN point_events pe ON pe.wallet = w.address
GROUP BY w.address;
