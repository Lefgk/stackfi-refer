-- nicknames: optional, 2-24 chars, case-insensitive unique
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS nickname TEXT;

-- case-insensitive uniqueness via expression index
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_nickname_ci
  ON wallets (LOWER(nickname))
  WHERE nickname IS NOT NULL;

-- charset + length guard
ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS wallets_nickname_check;
ALTER TABLE wallets
  ADD CONSTRAINT wallets_nickname_check
  CHECK (
    nickname IS NULL
    OR (
      length(nickname) BETWEEN 2 AND 24
      AND nickname ~ '^[A-Za-z0-9_-]+$'
    )
  );

-- surface nickname in the balances view (rebuild)
DROP VIEW IF EXISTS balances;
CREATE VIEW balances AS
SELECT
  w.address                                                                AS wallet,
  w.nickname                                                               AS nickname,
  COALESCE(SUM(pe.amount), 0)                                              AS points,
  COALESCE(SUM(CASE WHEN pe.kind='buy'            THEN pe.amount END), 0)  AS buy_points,
  COALESCE(SUM(CASE WHEN pe.kind='sell'           THEN pe.amount END), 0)  AS sell_points,
  COALESCE(SUM(CASE WHEN pe.kind='referral'       THEN pe.amount END), 0)  AS ref_buy_points,
  COALESCE(SUM(CASE WHEN pe.kind='referral_sell'  THEN pe.amount END), 0)  AS ref_sell_points,
  COALESCE(SUM(CASE WHEN pe.kind IN ('referral','referral_sell') THEN pe.amount END), 0) AS ref_points,
  (SELECT COUNT(*) FROM referrals r WHERE r.referrer = w.address)          AS refs
FROM wallets w
LEFT JOIN point_events pe ON pe.wallet = w.address
GROUP BY w.address;
