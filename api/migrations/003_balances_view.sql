-- Extend balances view to surface sell/referral_sell separately.
DROP VIEW IF EXISTS balances;
CREATE VIEW balances AS
SELECT
  w.address                                                                AS wallet,
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
