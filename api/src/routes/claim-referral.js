import nacl from "tweetnacl";
import bs58 from "bs58";
import { pool, ensureWallet } from "../db.js";

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Referee signs a message with their Phantom wallet to consent to being referred.
// Message format (exact): `coyoti-refer\nreferrer=<R>\nreferee=<E>\nts=<unix_ms>`
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

    // verify ed25519 signature against the referee public key
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

    // already locked?
    const existing = await pool.query(
      "SELECT referrer FROM referrals WHERE referee = $1",
      [referee]
    );
    if (existing.rows.length) {
      return { locked: true, referrer: existing.rows[0].referrer };
    }
    // already traded without ref? -> organic, can't be claimed
    const priorBuys = await pool.query(
      "SELECT 1 FROM trades WHERE wallet = $1 AND side = 'buy' LIMIT 1",
      [referee]
    );
    if (priorBuys.rows.length) {
      return reply
        .code(409)
        .send({ error: "wallet already bought organically — referral not claimable" });
    }

    await pool.query(
      "INSERT INTO referrals (referee, referrer, claim_sig) VALUES ($1, $2, $3)",
      [referee, referrer, signature_b58]
    );
    return { ok: true, referrer };
  });
}
