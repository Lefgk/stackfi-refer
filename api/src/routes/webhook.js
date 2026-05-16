import { pool } from "../db.js";
import {
  BUYER_PTS_PER_SOL,
  REFERRER_PTS_PER_SOL_BUY,
  SELLER_PTS_PER_SOL,
  REFERRER_PTS_PER_SOL_SELL,
  MIN_SOL_TRADE,
  PUMP_MINT,
  WSOL_MINT,
  LAMPORTS_PER_SOL,
} from "../points.js";

// POST /api/webhook/helius
// Accepts Helius "Enhanced Transactions" webhook payload (array of tx objects).
// We classify each tx as:
//   BUY  → wallet receives PUMP_MINT *and* sends SOL out
//   SELL → wallet sends PUMP_MINT out *and* receives SOL in
// Anything else (transfers, swaps to other tokens) is ignored.
export async function webhookRoute(app) {
  app.post("/api/webhook/helius", async (req, reply) => {
    if (process.env.HELIUS_WEBHOOK_AUTH) {
      const got = req.headers.authorization || req.headers["x-webhook-auth"];
      if (got !== process.env.HELIUS_WEBHOOK_AUTH) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }
    const events = Array.isArray(req.body) ? req.body : [req.body];
    let processed = 0;
    for (const evt of events) {
      try {
        if (await processEvent(evt)) processed++;
      } catch (e) {
        app.log.error({ err: e, sig: evt?.signature }, "event failed");
      }
    }
    return { processed, total: events.length };
  });
}

async function processEvent(evt) {
  if (!evt?.signature) return false;
  const txSig = evt.signature;
  const slot  = Number(evt.slot || 0);
  const feePayer = evt.feePayer; // the signing user — everyone else is plumbing

  const tokenTransfers  = evt.tokenTransfers  || [];
  const nativeTransfers = evt.nativeTransfers || [];

  // Real SOL value spent or received by a wallet in this tx.
  // If the wallet moved WSOL, that IS the SOL leg (AMM swaps wrap SOL through WSOL).
  // Otherwise fall back to native SOL (bonding-curve / direct transfers).
  // Mixing both double-counts wrap/unwrap plumbing.
  function solNet(wallet, dir /* 'out'|'in' */) {
    const wsolFor = (filterFn) => tokenTransfers
      .filter((t) => t.mint === WSOL_MINT && filterFn(t))
      .reduce((a, t) => a + Number(t.tokenAmount || 0), 0);
    const wsolOut = wsolFor((t) => t.fromUserAccount === wallet);
    const wsolIn  = wsolFor((t) => t.toUserAccount === wallet);
    if (wsolOut > 0 || wsolIn > 0) {
      return dir === "out" ? Math.max(0, wsolOut - wsolIn) : Math.max(0, wsolIn - wsolOut);
    }
    const nativeFor = (filterFn) => nativeTransfers
      .filter(filterFn)
      .reduce((a, n) => a + Number(n.amount || 0) / LAMPORTS_PER_SOL, 0);
    const nativeOut = nativeFor((n) => n.fromUserAccount === wallet);
    const nativeIn  = nativeFor((n) => n.toUserAccount === wallet);
    return dir === "out" ? Math.max(0, nativeOut - nativeIn) : Math.max(0, nativeIn - nativeOut);
  }

  let credited = false;

  // We only ever credit the tx's feePayer (the signing user). Everything else
  // in tokenTransfers is plumbing: pool vaults, intermediate WSOL ATAs, etc.
  if (!feePayer) return false;

  const payerReceivesMint = tokenTransfers.some(
    (t) => t.mint === PUMP_MINT && t.toUserAccount === feePayer && Number(t.tokenAmount || 0) > 0
  );
  const payerSendsMint = tokenTransfers.some(
    (t) => t.mint === PUMP_MINT && t.fromUserAccount === feePayer && Number(t.tokenAmount || 0) > 0
  );

  if (payerReceivesMint && !payerSendsMint) {
    const sol = solNet(feePayer, "out");
    if (sol >= MIN_SOL_TRADE) {
      await creditTrade({ txSig, slot, wallet: feePayer, side: "buy", solAmount: sol });
      credited = true;
    }
  } else if (payerSendsMint && !payerReceivesMint) {
    const sol = solNet(feePayer, "in");
    if (sol >= MIN_SOL_TRADE) {
      await creditTrade({ txSig, slot, wallet: feePayer, side: "sell", solAmount: sol });
      credited = true;
    }
  }
  // if both true (mint comes in AND goes out for same user) it's a transfer / arb / etc — skip.

  return credited;
}

async function creditTrade({ txSig, slot, wallet, side, solAmount }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO wallets(address) VALUES ($1) ON CONFLICT DO NOTHING",
      [wallet]
    );

    const insTrade = await client.query(
      `INSERT INTO trades(tx_sig, wallet, side, sol_amount, slot)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tx_sig) DO NOTHING
       RETURNING tx_sig`,
      [txSig, wallet, side, solAmount, slot]
    );
    if (!insTrade.rows.length) {
      await client.query("ROLLBACK");
      return; // already processed
    }

    const isBuy = side === "buy";
    const selfPts = Math.floor(solAmount * (isBuy ? BUYER_PTS_PER_SOL : SELLER_PTS_PER_SOL));
    const refPts  = Math.floor(solAmount * (isBuy ? REFERRER_PTS_PER_SOL_BUY : REFERRER_PTS_PER_SOL_SELL));
    const selfKind = isBuy ? "buy" : "sell";
    const refKind  = isBuy ? "referral" : "referral_sell";

    if (selfPts > 0) {
      await client.query(
        `INSERT INTO point_events(wallet, amount, kind, src_tx)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (src_tx, kind, wallet) DO NOTHING`,
        [wallet, selfPts, selfKind, txSig]
      );
    }

    const { rows: refRows } = await client.query(
      "SELECT referrer FROM referrals WHERE referee = $1",
      [wallet]
    );
    if (refRows.length && refPts > 0) {
      await client.query(
        `INSERT INTO point_events(wallet, amount, kind, src_tx)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (src_tx, kind, wallet) DO NOTHING`,
        [refRows[0].referrer, refPts, refKind, txSig]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
