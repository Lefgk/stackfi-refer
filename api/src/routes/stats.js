import { pool } from "../db.js";

export async function statsRoute(app) {
  app.get("/api/stats", async () => {
    const { rows: agg } = await pool.query(`
      SELECT
        COALESCE((SELECT SUM(amount) FROM point_events), 0)                       AS total_points,
        COALESCE((SELECT COUNT(DISTINCT wallet) FROM point_events), 0)            AS total_wallets,
        COALESCE((SELECT COUNT(*) FROM trades), 0)                                AS total_trades,
        COALESCE((SELECT SUM(sol_amount) FROM trades), 0)                         AS total_sol_volume,
        COALESCE((SELECT SUM(sol_amount) FROM trades WHERE side='buy'), 0)        AS total_sol_buys,
        COALESCE((SELECT SUM(sol_amount) FROM trades WHERE side='sell'), 0)       AS total_sol_sells,
        COALESCE((SELECT COUNT(*) FROM referrals), 0)                             AS total_referrals,
        (SELECT MAX(ts) FROM trades)                                              AS last_trade_ts
    `);
    const a = agg[0] || {};
    return {
      total_points:     Number(a.total_points),
      total_wallets:    Number(a.total_wallets),
      total_trades:     Number(a.total_trades),
      total_sol_volume: Number(a.total_sol_volume),
      total_sol_buys:   Number(a.total_sol_buys),
      total_sol_sells:  Number(a.total_sol_sells),
      total_referrals:  Number(a.total_referrals),
      last_trade_ts:    a.last_trade_ts,
    };
  });
}
