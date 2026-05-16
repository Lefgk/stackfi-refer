import { pool } from "../db.js";
import {
  BUYER_PTS_PER_SOL,
  REFERRER_PTS_PER_SOL,
  MIN_SOL_TRADE,
  PUMP_MINT,
  LAMPORTS_PER_SOL,
} from "../points.js";

// POST /api/webhook/helius
// Accepts Helius "Enhanced Transactions" webhook payload (array of tx objects).
// We detect a "buy of PUMP_MINT" by: same wallet has positive tokenTransfer of PUMP_MINT
// AND a net-negative nativeTransfer (SOL out) in the same tx.
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

  const mintReceives = tokenTransfers.filter(
    (t) => t.mint === PUMP_MINT && Number(t.tokenAmount || 0) > 0
  );
  if (!mintReceives.length) return false;

  let credited = false;
  for (const tt of mintReceives) {
    const buyer = tt.toUserAccount;
    if (!buyer) continue;

    // sum of SOL leaving the buyer in this tx
    const lamportsOut = nativeTransfers
      .filter((n) => n.fromUserAccount === buyer)
      .reduce((acc, n) => acc + Number(n.amount || 0), 0);
    const solSpent = lamportsOut / LAMPORTS_PER_SOL;
    if (solSpent < MIN_SOL_TRADE) continue;

    await creditBuy({ txSig, slot, buyer, solSpent });
    credited = true;
  }
  return credited;
}

async function creditBuy({ txSig, slot, buyer, solSpent }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO wallets(address) VALUES ($1) ON CONFLICT DO NOTHING",
      [buyer]
    );

    const insBuy = await client.query(
      `INSERT INTO buys(tx_sig, buyer, sol_spent, slot)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tx_sig) DO NOTHING
       RETURNING tx_sig`,
      [txSig, buyer, solSpent, slot]
    );
    if (!insBuy.rows.length) {
      // already processed
      await client.query("ROLLBACK");
      return;
    }

    const buyerPts = Math.floor(solSpent * BUYER_PTS_PER_SOL);
    if (buyerPts > 0) {
      await client.query(
        `INSERT INTO point_events(wallet, amount, kind, src_tx)
         VALUES ($1, $2, 'buy', $3)
         ON CONFLICT (src_tx, kind, wallet) DO NOTHING`,
        [buyer, buyerPts, txSig]
      );
    }

    const { rows: refRows } = await client.query(
      "SELECT referrer FROM referrals WHERE referee = $1",
      [buyer]
    );
    if (refRows.length) {
      const referrer = refRows[0].referrer;
      const refPts = Math.floor(solSpent * REFERRER_PTS_PER_SOL);
      if (refPts > 0) {
        await client.query(
          `INSERT INTO point_events(wallet, amount, kind, src_tx)
           VALUES ($1, $2, 'referral', $3)
           ON CONFLICT (src_tx, kind, wallet) DO NOTHING`,
          [referrer, refPts, txSig]
        );
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
