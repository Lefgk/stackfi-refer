import nacl from "tweetnacl";
import bs58 from "bs58";
import { pool, ensureWallet } from "../db.js";

const ADDR_RE     = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NICK_RE     = /^[A-Za-z0-9_-]{2,24}$/;
const RESERVED    = new Set(["coyoti", "admin", "team", "official", "support", "mod", "moderator", "anonymous", "deleted", "null", "system"]);

// Wallet signs to set or clear a nickname.
// Message format: `coyoti-nickname\nwallet=<W>\nnickname=<N>\nts=<unix_ms>`
//   N may be empty to clear.
export async function nicknameRoute(app) {
  app.post("/api/nickname", async (req, reply) => {
    const { wallet, nickname, message, signature_b58 } = req.body || {};

    if (
      typeof wallet !== "string" ||
      typeof nickname !== "string" ||
      typeof message !== "string" ||
      typeof signature_b58 !== "string" ||
      !ADDR_RE.test(wallet)
    ) {
      return reply.code(400).send({ error: "bad body" });
    }
    if (nickname !== "" && !NICK_RE.test(nickname)) {
      return reply.code(400).send({ error: "nickname must be 2-24 chars: letters, digits, _ or -" });
    }
    if (nickname && RESERVED.has(nickname.toLowerCase())) {
      return reply.code(400).send({ error: "reserved nickname" });
    }
    if (
      !message.startsWith("coyoti-nickname") ||
      !message.includes(`wallet=${wallet}`) ||
      !message.includes(`nickname=${nickname}`)
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
      pub = bs58.decode(wallet);
    } catch {
      return reply.code(400).send({ error: "bad base58" });
    }
    const ok = nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pub);
    if (!ok) return reply.code(401).send({ error: "bad signature" });

    await ensureWallet(null, wallet);

    const value = nickname === "" ? null : nickname;
    try {
      await pool.query("UPDATE wallets SET nickname = $1 WHERE address = $2", [value, wallet]);
    } catch (e) {
      if (e?.code === "23505") return reply.code(409).send({ error: "nickname taken" });
      throw e;
    }
    return { ok: true, wallet, nickname: value };
  });
}
