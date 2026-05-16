import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
  max: 10,
});

export async function ensureWallet(client, address) {
  const q = client || pool;
  await q.query(
    "INSERT INTO wallets(address) VALUES ($1) ON CONFLICT DO NOTHING",
    [address]
  );
}
