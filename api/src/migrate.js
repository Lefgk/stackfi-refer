import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const migDir = path.resolve(__dirname, "../migrations");

const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  const sql = fs.readFileSync(path.join(migDir, f), "utf8");
  console.log("applying", f);
  await pool.query(sql);
}
await pool.end();
console.log("migrations done");
