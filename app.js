(() => {
  const $ = (id) => document.getElementById(id);
  // Solana addresses: base58, 32–44 chars (no 0, O, I, l)
  const isAddr = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((s || "").trim());
  const short = (a) => a ? a.slice(0, 4) + "…" + a.slice(-4) : "—";

  const TOKEN_MINT = "4u7KijCYFhh9hkArq41ysg4CfFns7Pv2jUKUoABCpump";
  const TOKEN_URL  = `https://pump.fun/coin/${TOKEN_MINT}`;

  // --- referred-by banner from ?ref= ---
  const params = new URLSearchParams(location.search);
  const refParam = params.get("ref");
  if (refParam && isAddr(refParam)) {
    $("referredBy").hidden = false;
    $("referredByAddr").textContent = short(refParam);
    try { localStorage.setItem("coyoti_ref", refParam); } catch {}
  }

  // --- restore last used addr ---
  let savedAddr = "";
  try { savedAddr = localStorage.getItem("coyoti_addr") || ""; } catch {}
  if (savedAddr) {
    $("addrInput").value = savedAddr;
    setTimeout(() => generate(savedAddr, true), 0);
  }

  // --- input handlers ---
  $("genBtn").addEventListener("click", () => generate($("addrInput").value));
  $("addrInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") generate($("addrInput").value);
  });

  // --- Phantom (Solana) wallet connect ---
  $("connectBtn").addEventListener("click", async () => {
    const provider = window.phantom?.solana || window.solana;
    if (!provider || !provider.isPhantom) {
      hint("no Phantom wallet detected — install phantom.app or paste an address");
      return;
    }
    try {
      const resp = await provider.connect();
      const pk = resp.publicKey?.toString();
      if (pk) {
        $("addrInput").value = pk;
        generate(pk);
      }
    } catch (e) {
      hint("wallet connection rejected");
    }
  });

  $("copyBtn").addEventListener("click", () => {
    const v = $("linkOut").value;
    navigator.clipboard?.writeText(v).then(() => {
      const b = $("copyBtn");
      const t = b.textContent;
      b.textContent = "copied ✓";
      setTimeout(() => (b.textContent = t), 1200);
    });
  });

  $("qrBtn").addEventListener("click", () => {
    const box = $("qrBox");
    if (!box.hidden) { box.hidden = true; return; }
    const link = encodeURIComponent($("linkOut").value);
    box.innerHTML = `<img alt="qr" width="180" height="180"
      src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${link}" />`;
    box.hidden = false;
  });

  function hint(msg) { $("addrHint").textContent = msg || ""; }

  // ---- rank system (Bronze → Diamond) ----
  const RANKS = [
    { name: "BRONZE",  min: 0,      next: 1000,    mult: 1.0 },
    { name: "SILVER",  min: 1000,   next: 10000,   mult: 1.5 },
    { name: "GOLD",    min: 10000,  next: 100000,  mult: 2.0 },
    { name: "DIAMOND", min: 100000, next: Infinity, mult: 3.0 },
  ];
  function rankFor(points) {
    let r = RANKS[0];
    for (const x of RANKS) if (points >= x.min) r = x;
    return r;
  }
  function rankProgress(points, rank) {
    if (rank.next === Infinity) return { pct: 100, toNext: 0 };
    const span = rank.next - rank.min;
    const pct = Math.max(2, Math.min(100, Math.round(((points - rank.min) / span) * 100)));
    return { pct, toNext: rank.next - points };
  }

  // deterministic mock seeded by address (until backend is wired)
  function mockStats(addr) {
    let h = 0;
    for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
    const points = (h % 145000) + 240;
    const refs   = (h % 38);
    const depth  = refs + ((h >>> 3) % 80);
    return { points, refs, depth };
  }

  function setActiveTier(rankName) {
    document.querySelectorAll(".tier").forEach((el) => {
      el.classList.toggle("active", el.dataset.rank === rankName);
    });
    const card = document.querySelector(".stat-card .stat-card-value.rank")?.closest(".stat-card");
    if (card) card.setAttribute("data-rank", rankName);
  }

  function generate(raw, silent) {
    const addr = (raw || "").trim();
    if (!addr) { if (!silent) hint("paste an address first"); return; }
    if (!isAddr(addr)) { hint("not a valid Solana address (base58, 32–44 chars)"); return; }
    hint("");

    try { localStorage.setItem("coyoti_addr", addr); } catch {}

    const base = location.origin + location.pathname.replace(/\/$/, "");
    const link = `${base}/?ref=${addr}`;
    $("linkOut").value = link;
    $("output").hidden = false;

    const tweet = encodeURIComponent(
      "stacking on @coyoti — Solana referral game.\n\n" +
      "grow your network. earn big. use my link:\n" + link
    );
    $("shareX").href  = `https://twitter.com/intent/tweet?text=${tweet}`;
    $("shareTg").href = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("stack with me on Coyoti")}`;

    const s = mockStats(addr);
    const rank = rankFor(s.points);
    const prog = rankProgress(s.points, rank);

    $("statPoints").textContent = s.points.toLocaleString();
    $("statRefs").textContent   = s.refs;
    $("statDepth").textContent  = s.depth;
    $("statMult").textContent   = rank.mult.toFixed(1) + "×";

    $("tierLabel").textContent = rank.name;
    $("progressBar").style.width = prog.pct + "%";
    $("rankSub").textContent = rank.next === Infinity
      ? "max rank — apex of the pack"
      : `${prog.toNext.toLocaleString()} pts to ${RANKS[RANKS.indexOf(rank) + 1].name}`;

    setActiveTier(rank.name);
  }

  // --- leaderboard (mock until backend) ---
  const sampleWallets = [
    "So11111111111111111111111111111111111111112",
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    "HnPmKGfX2hUUWuXh5jR6fcCxNvSj8w29VYHcDh5VJ7Mq",
    "BoNkW4xWLh1L4ePxYxX6sV5LXcKzGQyZ8mZ9D2sZ4U6V",
    "Ax9R5tQpVuJ2sN4WkXz6BcG7PfHmL8RvK1eYy3DnQXt5",
    "FzgN8mWqL2pK4xR7uT9YbCvE6sJ3HdN5MaB1kPwQvX8R",
    "5ZmHJ7sXKqL3vR8uYbN4WdC2pE9MaK7T6FxV1nQzGtP4",
  ];
  const lb = sampleWallets.map((w) => {
    const s = mockStats(w);
    const r = rankFor(s.points);
    return { wallet: w, refs: s.refs, points: s.points, rank: r.name };
  }).sort((a, b) => b.points - a.points);

  const body = $("lbBody");
  body.innerHTML = lb.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><code>${short(r.wallet)}</code></td>
      <td>${r.refs}</td>
      <td>${r.points.toLocaleString()}</td>
      <td><span class="rk" data-rank="${r.rank}">${r.rank}</span></td>
    </tr>
  `).join("");

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  $("lbUpdated").textContent = "updated " + stamp;
})();
