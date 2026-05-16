import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const migDir = path.resolve(__dirname, "../migrations");

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const { rows: applied } = await pool.query("SELECT name FROM schema_migrations");
const done = new Set(applied.map((r) => r.name));

const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
let count = 0;
for (const f of files) {
  if (done.has(f)) { console.log("skip", f); continue; }
  const sql = fs.readFileSync(path.join(migDir, f), "utf8");
  console.log("apply", f);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
    await client.query("COMMIT");
    count++;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
await pool.end();
console.log(`done — applied ${count} new migration(s)`);
