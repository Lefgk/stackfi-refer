import { pool, ensureWallet } from "../db.js";

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function walletRoute(app) {
  app.get("/api/wallet/:addr", async (req, reply) => {
    const addr = String(req.params.addr || "").trim();
    if (!ADDR_RE.test(addr)) {
      return reply.code(400).send({ error: "invalid address" });
    }
    await ensureWallet(null, addr);

    const { rows: bal } = await pool.query(
      "SELECT * FROM balances WHERE wallet = $1",
      [addr]
    );
    const b = bal[0] || { points: 0, buy_points: 0, ref_points: 0, refs: 0, nickname: null };

    const { rows: ref } = await pool.query(
      "SELECT referrer FROM referrals WHERE referee = $1",
      [addr]
    );

    return {
      wallet: addr,
      nickname: b.nickname || null,
      points: Number(b.points),
      buy_points: Number(b.buy_points),
      ref_points: Number(b.ref_points),
      refs: Number(b.refs),
      referrer: ref[0]?.referrer || null,
    };
  });
}
