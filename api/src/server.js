import Fastify from "fastify";
import cors from "@fastify/cors";
import { walletRoute } from "./routes/wallet.js";
import { leaderboardRoute } from "./routes/leaderboard.js";
import { claimReferralRoute } from "./routes/claim-referral.js";
import { webhookRoute } from "./routes/webhook.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });

await app.register(cors, {
  origin: (process.env.CORS_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
});

app.get("/", async () => ({ name: "coyoti-api", ok: true }));
app.get("/health", async () => ({ ok: true, ts: Date.now() }));

await app.register(walletRoute);
await app.register(leaderboardRoute);
await app.register(claimReferralRoute);
await app.register(webhookRoute);

const port = Number(process.env.PORT || 3000);
app.listen({ host: "0.0.0.0", port }).then(() => {
  app.log.info(`coyoti-api listening on :${port}`);
});
