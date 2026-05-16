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

  const tokenTransfers  = evt.tokenTransfers  || [];
  const nativeTransfers = evt.nativeTransfers || [];

  // SOL spent/received by a wallet = native SOL + WSOL token transfers (AMMs use WSOL).
  function solOutFor(wallet) {
    const native = nativeTransfers
      .filter((n) => n.fromUserAccount === wallet)
      .reduce((a, n) => a + Number(n.amount || 0) / LAMPORTS_PER_SOL, 0);
    const wsol = tokenTransfers
      .filter((t) => t.mint === WSOL_MINT && t.fromUserAccount === wallet)
      .reduce((a, t) => a + Number(t.tokenAmount || 0), 0);
    return native + wsol;
  }
  function solInFor(wallet) {
    const native = nativeTransfers
      .filter((n) => n.toUserAccount === wallet)
      .reduce((a, n) => a + Number(n.amount || 0) / LAMPORTS_PER_SOL, 0);
    const wsol = tokenTransfers
      .filter((t) => t.mint === WSOL_MINT && t.toUserAccount === wallet)
      .reduce((a, t) => a + Number(t.tokenAmount || 0), 0);
    return native + wsol;
  }

  let credited = false;

  // BUY side: wallet receives PUMP_MINT AND nets SOL out
  const mintReceives = tokenTransfers.filter(
    (t) => t.mint === PUMP_MINT && Number(t.tokenAmount || 0) > 0 && t.toUserAccount
  );
  for (const tt of mintReceives) {
    const buyer = tt.toUserAccount;
    const solNet = solOutFor(buyer) - solInFor(buyer);
    if (solNet < MIN_SOL_TRADE) continue;

    await creditTrade({ txSig, slot, wallet: buyer, side: "buy", solAmount: solNet });
    credited = true;
  }

  // SELL side: wallet sends PUMP_MINT AND nets SOL in
  const mintSends = tokenTransfers.filter(
    (t) => t.mint === PUMP_MINT && Number(t.tokenAmount || 0) > 0 && t.fromUserAccount
  );
  for (const tt of mintSends) {
    const seller = tt.fromUserAccount;
    if (mintReceives.some((r) => r.toUserAccount === seller)) continue; // internal hop
    const solNet = solInFor(seller) - solOutFor(seller);
    if (solNet < MIN_SOL_TRADE) continue;

    await creditTrade({ txSig, slot, wallet: seller, side: "sell", solAmount: solNet });
    credited = true;
  }

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
