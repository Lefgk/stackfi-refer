import nacl from "tweetnacl";
import bs58 from "bs58";
import { pool, ensureWallet } from "../db.js";
import {
  REFERRER_PTS_PER_SOL_BUY,
  REFERRER_PTS_PER_SOL_SELL,
} from "../points.js";

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Referee signs a message with their Phantom wallet to consent to being referred.
// Message format (exact): `coyoti-refer\nreferrer=<R>\nreferee=<E>\nts=<unix_ms>`
//
// Late claims ARE allowed and trigger retroactive credit:
// every prior trade by the referee gets a corresponding referral point_event
// inserted, crediting the referrer at 10% / 5% of buy / sell rates.
export async function claimReferralRoute(app) {
  app.post("/api/claim-referral", async (req, reply) => {
    const { referrer, referee, message, signature_b58 } = req.body || {};

    if (
      typeof referrer !== "string" ||
      typeof referee !== "string" ||
      typeof message !== "string" ||
      typeof signature_b58 !== "string" ||
      !ADDR_RE.test(referrer) ||
      !ADDR_RE.test(referee)
    ) {
      return reply.code(400).send({ error: "bad body" });
    }
    if (referrer === referee) {
      return reply.code(400).send({ error: "self-referral blocked" });
    }
    if (
      !message.startsWith("coyoti-refer") ||
      !message.includes(`referrer=${referrer}`) ||
      !message.includes(`referee=${referee}`)
    ) {
      return reply.code(400).send({ error: "malformed message" });
    }
    const tsMatch = message.match(/ts=(\d{13})/);
    if (!tsMatch) return reply.code(400).send({ error: "missing ts" });
    const ts = Number(tsMatch[1]);
    if (Math.abs(Date.now() - ts) > 10 * 60 * 1000) {
      return reply.code(400).send({ error: "stale signature (>10min)" });
    }

    let sig, pub;
    try {
      sig = bs58.decode(signature_b58);
      pub = bs58.decode(referee);
    } catch {
      return reply.code(400).send({ error: "bad base58" });
    }
    const ok = nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pub);
    if (!ok) return reply.code(401).send({ error: "bad signature" });

    await ensureWallet(null, referrer);
    await ensureWallet(null, referee);

    // referee can only have one referrer, ever (PK on referee)
    const existing = await pool.query(
      "SELECT referrer FROM referrals WHERE referee = $1",
      [referee]
    );
    if (existing.rows.length) {
      return { locked: true, referrer: existing.rows[0].referrer, backfilled: 0 };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO referrals (referee, referrer, claim_sig) VALUES ($1, $2, $3)",
        [referee, referrer, signature_b58]
      );

      // RETROACTIVE: credit referrer for every past trade by referee
      const { rows: past } = await client.query(
        "SELECT tx_sig, side, sol_amount FROM trades WHERE wallet = $1",
        [referee]
      );
      let backfilled = 0;
      let backfilledPts = 0;
      for (const t of past) {
        const isBuy = t.side === "buy";
        const rate = isBuy ? REFERRER_PTS_PER_SOL_BUY : REFERRER_PTS_PER_SOL_SELL;
        const pts  = Math.floor(Number(t.sol_amount) * rate);
        if (pts <= 0) continue;
        const kind = isBuy ? "referral" : "referral_sell";
        const ins = await client.query(
          `INSERT INTO point_events(wallet, amount, kind, src_tx)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (src_tx, kind, wallet) DO NOTHING
           RETURNING id`,
          [referrer, pts, kind, t.tx_sig]
        );
        if (ins.rows.length) {
          backfilled++;
          backfilledPts += pts;
        }
      }

      await client.query("COMMIT");
      return { ok: true, referrer, backfilled, backfilled_points: backfilledPts };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });
}
