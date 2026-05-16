// Buy rates
export const BUYER_PTS_PER_SOL          = 1000;
export const REFERRER_PTS_PER_SOL_BUY   = 100;  // 10% of buyer pts

// Sell rates (half of buy rates to discourage wash-farming).
// 1 SOL of tokens sold → 500 pts to seller, 50 pts to seller's referrer.
export const SELLER_PTS_PER_SOL         = 500;
export const REFERRER_PTS_PER_SOL_SELL  = 50;

export const MIN_SOL_TRADE              = 0.01;

export const PUMP_MINT                  = "4u7KijCYFhh9hkArq41ysg4CfFns7Pv2jUKUoABCpump";
export const LAMPORTS_PER_SOL           = 1_000_000_000;
