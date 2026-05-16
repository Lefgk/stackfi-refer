import { pool } from "../db.js";

export async function leaderboardRoute(app) {
  app.get("/api/leaderboard", async () => {
    const { rows } = await pool.query(
      `SELECT wallet, points, refs
       FROM balances
       WHERE points > 0
       ORDER BY points DESC
       LIMIT 100`
    );
    return {
      rows: rows.map((r) => ({
        wallet: r.wallet,
        points: Number(r.points),
        refs: Number(r.refs),
      })),
      updated: new Date().toISOString(),
    };
  });
}
