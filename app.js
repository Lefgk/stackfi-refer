(() => {
  // ====== CONFIG ======
  const API_BASE = "https://coyoti-api-production.up.railway.app";

  const PROD_BASE = "https://referrals.coyoti.xyz";
  const TOKEN_MINT = "4u7KijCYFhh9hkArq41ysg4CfFns7Pv2jUKUoABCpump";

  // ====== HELPERS ======
  const $ = (id) => document.getElementById(id);
  // Solana addresses: base58, 32–44 chars (no 0, O, I, l)
  const isAddr = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((s || "").trim());
  const short = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
  function hint(msg) { $("addrHint").textContent = msg || ""; }

  async function api(path, opts) {
    if (!API_BASE) throw new Error("API not configured");
    const res = await fetch(API_BASE + path, {
      ...opts,
      headers: { "content-type": "application/json", ...(opts?.headers || {}) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `http ${res.status}`);
    }
    return res.json();
  }

  // ====== REFERRED-BY BANNER ======
  const params = new URLSearchParams(location.search);
  const refParam = params.get("ref");
  if (refParam && isAddr(refParam)) {
    $("referredBy").hidden = false;
    const el = $("referredByAddr");
    el.textContent = short(refParam);
    el.classList.add("copyable");
    el.dataset.full = refParam;
    el.title = "click to copy " + refParam;
    try { localStorage.setItem("coyoti_ref", refParam); } catch {}
  }

  // ====== CLICK-TO-COPY (event delegation) ======
  document.addEventListener("click", (e) => {
    const t = e.target.closest(".copyable");
    if (!t) return;
    const full = t.dataset.full;
    if (!full) return;
    navigator.clipboard?.writeText(full).then(() => {
      const prev = t.textContent;
      t.textContent = "copied ✓";
      t.classList.add("copied");
      setTimeout(() => {
        t.textContent = prev;
        t.classList.remove("copied");
      }, 1100);
    });
  });

  // ====== RESTORE LAST USED ADDR ======
  let savedAddr = "";
  try { savedAddr = localStorage.getItem("coyoti_addr") || ""; } catch {}
  if (savedAddr) {
    $("addrInput").value = savedAddr;
    setTimeout(() => generate(savedAddr, true), 0);
  }

  // ====== INPUT HANDLERS ======
  $("genBtn").addEventListener("click", () => generate($("addrInput").value));
  $("addrInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") generate($("addrInput").value);
  });

  // ====== PHANTOM PROVIDER HELPER ======
  let phantomProvider = null;
  let connectedPubkey = null;
  function getProvider() {
    return phantomProvider || window.phantom?.solana || window.solana;
  }

  // ====== NICKNAME UI ======
  function nickHint(msg) { const el = $("nickHint"); if (el) el.textContent = msg || ""; }
  async function signAndSendNickname(newNick) {
    const provider = getProvider();
    if (!provider || !connectedPubkey) {
      nickHint("connect your wallet first");
      return;
    }
    const ts = Date.now();
    const message = `coyoti-nickname\nwallet=${connectedPubkey}\nnickname=${newNick}\nts=${ts}`;
    try {
      const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
      const sigBytes = signed.signature || signed;
      const signature_b58 = bytesToBase58(sigBytes);
      const res = await api("/api/nickname", {
        method: "POST",
        body: JSON.stringify({ wallet: connectedPubkey, nickname: newNick, message, signature_b58 }),
      });
      if (res.ok) {
        nickHint(newNick ? `✓ nickname set: ${newNick}` : "✓ nickname cleared");
        // refresh user stats + leaderboard
        if (connectedPubkey) generate(connectedPubkey, true);
        loadLeaderboardForce();
      }
    } catch (e) {
      nickHint(e?.message || "could not set nickname");
    }
  }
  $("nickSetBtn").addEventListener("click", () => {
    const v = ($("nickInput").value || "").trim();
    if (!v) { nickHint("type a nickname first"); return; }
    if (!/^[A-Za-z0-9_-]{2,24}$/.test(v)) { nickHint("2-24 chars: letters, digits, _ or -"); return; }
    signAndSendNickname(v);
  });
  $("nickClearBtn").addEventListener("click", () => {
    $("nickInput").value = "";
    signAndSendNickname("");
  });

  // ====== PHANTOM CONNECT + REFERRAL CLAIM ======
  $("connectBtn").addEventListener("click", async () => {
    const provider = window.phantom?.solana || window.solana;
    if (!provider || !provider.isPhantom) {
      hint("no Phantom wallet detected — install phantom.app or paste an address");
      return;
    }
    try {
      const resp = await provider.connect();
      const pk = resp.publicKey?.toString();
      if (!pk) return;
      phantomProvider = provider;
      connectedPubkey = pk;
      $("nickRow").hidden = false;

      $("addrInput").value = pk;
      generate(pk);

      // if we have a stored referrer and it isn't us, prompt the user to sign a claim
      const storedRef = (() => {
        try { return localStorage.getItem("coyoti_ref") || ""; } catch { return ""; }
      })();
      if (API_BASE && storedRef && isAddr(storedRef) && storedRef !== pk) {
        await tryClaimReferral(provider, storedRef, pk);
      }
    } catch (e) {
      hint(e?.message || "wallet connection rejected");
    }
  });

  async function tryClaimReferral(provider, referrer, referee) {
    try {
      const ts = Date.now();
      const message = `coyoti-refer\nreferrer=${referrer}\nreferee=${referee}\nts=${ts}`;
      const encoded = new TextEncoder().encode(message);
      const signed = await provider.signMessage(encoded, "utf8");
      const sigBytes = signed.signature || signed; // some wallets return raw bytes
      const signature_b58 = bytesToBase58(sigBytes);

      const res = await api("/api/claim-referral", {
        method: "POST",
        body: JSON.stringify({ referrer, referee, message, signature_b58 }),
      });
      if (res.locked) {
        hint("referral already locked to " + short(res.referrer));
      } else if (res.ok) {
        const bp = Number(res.backfilled_points || 0);
        if (bp > 0) {
          hint(`✓ referral locked to ${short(referrer)} — they got +${bp.toLocaleString()} retroactive pts from your ${res.backfilled} past trades`);
        } else {
          hint(`✓ referral locked to ${short(referrer)} — they earn 10% of every SOL you buy from now on`);
        }
      }
    } catch (e) {
      hint("could not lock referral: " + (e?.message || "unknown"));
    }
  }

  // base58 encoder (avoids adding a dep on the frontend)
  const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function bytesToBase58(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let n = 0n;
    for (const b of arr) n = (n << 8n) | BigInt(b);
    let s = "";
    while (n > 0n) {
      const r = Number(n % 58n);
      n = n / 58n;
      s = B58_ALPHABET[r] + s;
    }
    for (const b of arr) { if (b === 0) s = "1" + s; else break; }
    return s;
  }

  // ====== COPY / SHARE / QR ======
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

  // ====== TIERS ======
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
  function setActiveTier(rankName) {
    document.querySelectorAll(".tier").forEach((el) => {
      el.classList.toggle("active", el.dataset.rank === rankName);
    });
    const card = document.querySelector(".stat-card .stat-card-value.rank")?.closest(".stat-card");
    if (card) card.setAttribute("data-rank", rankName);
  }

  function renderStats(addr, s) {
    personalLoaded = true;
    restorePersonalLabels();
    const rank = rankFor(s.points);
    const prog = rankProgress(s.points, rank);
    $("statPoints").textContent = s.points.toLocaleString();
    $("statRefs").textContent   = s.refs;
    $("statDepth").textContent  = s.buy_points?.toLocaleString?.() ?? "—";
    $("statMult").textContent   = rank.mult.toFixed(1) + "×";
    $("tierLabel").textContent  = rank.name;
    $("progressBar").style.width = prog.pct + "%";
    $("rankSub").textContent = rank.next === Infinity
      ? "max rank — apex of the pack"
      : `${prog.toNext.toLocaleString()} pts to ${RANKS[RANKS.indexOf(rank) + 1].name}`;
    setActiveTier(rank.name);
  }
  function renderEmpty() {
    $("statPoints").textContent = "0";
    $("statRefs").textContent   = "0";
    $("statDepth").textContent  = "0";
    $("statMult").textContent   = "1.0×";
    $("tierLabel").textContent  = "BRONZE";
    $("progressBar").style.width = "2%";
    $("rankSub").textContent = API_BASE ? "no buys yet — buy the token to mint points" : "indexer not yet live";
    setActiveTier("BRONZE");
  }

  // ====== GLOBAL STATS (shown until a personal address is loaded) ======
  let personalLoaded = false;
  async function loadGlobalStats() {
    if (personalLoaded) return;
    try {
      const s = await api("/api/stats");
      if (personalLoaded) return; // personal loaded while we were waiting
      $("statPoints").textContent = Number(s.total_points).toLocaleString();
      $("statRefs").textContent   = Number(s.total_wallets).toLocaleString();
      $("statDepth").textContent  = Math.round(Number(s.total_sol_volume)).toLocaleString() + " SOL";
      $("statMult").textContent   = Number(s.total_trades).toLocaleString();
      // re-label the cards while in "global" mode
      const labels = document.querySelectorAll(".stat-label");
      if (labels[0]) labels[0].textContent = "wallets indexed";
      if (labels[1]) labels[1].textContent = "total SOL traded";
      if (labels[2]) labels[2].textContent = "trades indexed";
      // Hero panel
      const card = document.querySelector(".stat-card .stat-card-value.rank")?.closest(".stat-card");
      $("tierLabel").textContent = "NETWORK";
      if (card) card.removeAttribute("data-rank");
      $("rankSub").textContent = s.last_trade_ts
        ? "last trade " + new Date(s.last_trade_ts).toISOString().replace("T", " ").slice(0, 16) + " UTC"
        : "no trades indexed yet";
      $("progressBar").style.width = "100%";
    } catch {
      renderEmpty();
    }
  }

  function restorePersonalLabels() {
    const labels = document.querySelectorAll(".stat-label");
    if (labels[0]) labels[0].textContent = "referrals";
    if (labels[1]) labels[1].textContent = "buy points";
    if (labels[2]) labels[2].textContent = "multiplier";
  }

  // ====== GENERATE LINK + LOAD STATS ======
  async function generate(raw, silent) {
    const addr = (raw || "").trim();
    if (!addr) { if (!silent) hint("paste an address first"); return; }
    if (!isAddr(addr)) { hint("not a valid Solana address (base58, 32–44 chars)"); return; }
    hint("");

    try { localStorage.setItem("coyoti_addr", addr); } catch {}

    const base = PROD_BASE;
    const link = `${base}/?ref=${addr}`;
    $("linkOut").value = link;
    $("output").hidden = false;

    const tweet = encodeURIComponent(
      "joining @coyoti — Solana referral game.\n\n" +
      "grow your network. earn big. use my link:\n" + link
    );
    $("shareX").href  = `https://twitter.com/intent/tweet?text=${tweet}`;
    $("shareTg").href = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("join me on Coyoti")}`;

    if (!API_BASE) { renderEmpty(); return; }
    try {
      const s = await api(`/api/wallet/${addr}`);
      renderStats(addr, s);
      // if this is the connected wallet, populate the nickname input
      if (connectedPubkey === addr && $("nickInput")) {
        $("nickInput").value = s.nickname || "";
      }
    } catch (e) {
      hint("could not load stats: " + (e?.message || "unknown"));
      renderEmpty();
    }
  }

  // ====== INITIAL GLOBAL STATS ======
  if (API_BASE) loadGlobalStats();

  // ====== LIVE TOKEN STATS (DexScreener) ======
  function fmtUsd(n) {
    if (!isFinite(n) || n <= 0) return "—";
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
    if (n >= 1)   return `$${n.toFixed(2)}`;
    return `$${n.toPrecision(3)}`;
  }
  function fmtPct(n) {
    if (!isFinite(n)) return "—";
    const sign = n >= 0 ? "+" : "";
    return `${sign}${n.toFixed(2)}%`;
  }
  function setVal(id, txt) { const el = $(id); if (el) el.textContent = txt; }
  function setChange(id, n) {
    const el = $(id); if (!el) return;
    el.textContent = fmtPct(n);
    el.classList.toggle("pos", isFinite(n) && n >= 0);
    el.classList.toggle("neg", isFinite(n) && n < 0);
  }
  async function loadTokenStats() {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${TOKEN_MINT}`);
      if (!res.ok) throw new Error("dexscreener " + res.status);
      const d = await res.json();
      const p = (d.pairs || [])[0];
      if (!p) throw new Error("no pair");

      const price = Number(p.priceUsd);
      const ch24  = Number(p.priceChange?.h24);
      const vol24 = Number(p.volume?.h24);
      const liq   = Number(p.liquidity?.usd);
      const mcap  = Number(p.marketCap || p.fdv);

      // header ticker
      setVal("hdPrice", fmtUsd(price));
      setChange("hdChange", ch24);
      setVal("hdVol",   fmtUsd(vol24));
      setVal("hdMcap",  fmtUsd(mcap));

      // body card (liquidity only)
      setVal("tkLiq",   fmtUsd(liq));
    } catch {
      ["hdPrice","hdChange","hdVol","hdMcap","tkLiq"].forEach(i => setVal(i, "—"));
    }
  }
  loadTokenStats();
  setInterval(loadTokenStats, 60_000); // refresh every minute

  // ====== LEADERBOARD (with pagination) ======
  const LB_PAGE_SIZE = 10;
  let lbAllRows = [];
  let lbPage = 1;

  function renderLbPage() {
    const body = $("lbBody");
    const pager = $("lbPager");
    const info = $("lbPageInfo");
    const prev = $("lbPrev");
    const next = $("lbNext");
    if (!lbAllRows.length) {
      body.innerHTML = `<tr><td colspan="5" class="muted center">no buys indexed yet — be the first to mint points</td></tr>`;
      pager.hidden = true;
      return;
    }
    const totalPages = Math.max(1, Math.ceil(lbAllRows.length / LB_PAGE_SIZE));
    lbPage = Math.min(Math.max(1, lbPage), totalPages);
    const start = (lbPage - 1) * LB_PAGE_SIZE;
    const slice = lbAllRows.slice(start, start + LB_PAGE_SIZE);

    body.innerHTML = slice.map((r, i) => {
      const rk = rankFor(r.points).name;
      const rank = start + i + 1;
      const display = r.nickname
        ? `<span class="nick">${escapeHtml(r.nickname)}</span><span class="nick-sub copyable" data-full="${r.wallet}" title="click to copy ${r.wallet}">${short(r.wallet)}</span>`
        : `<code class="copyable" data-full="${r.wallet}" title="click to copy ${r.wallet}">${short(r.wallet)}</code>`;
      return `<tr>
        <td>${rank}</td>
        <td>${display}</td>
        <td>${r.refs}</td>
        <td>${r.points.toLocaleString()}</td>
        <td><span class="rk" data-rank="${rk}">${rk}</span></td>
      </tr>`;
    }).join("");

    pager.hidden = totalPages <= 1;
    info.textContent = `page ${lbPage} of ${totalPages} · ${lbAllRows.length} wallets`;
    prev.disabled = lbPage <= 1;
    next.disabled = lbPage >= totalPages;
  }

  $("lbPrev").addEventListener("click", () => { lbPage--; renderLbPage(); window.scrollTo({ top: document.getElementById("leaderboard").offsetTop - 20, behavior: "smooth" }); });
  $("lbNext").addEventListener("click", () => { lbPage++; renderLbPage(); window.scrollTo({ top: document.getElementById("leaderboard").offsetTop - 20, behavior: "smooth" }); });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function loadLeaderboardForce() {
    try {
      const { rows, updated } = await api("/api/leaderboard");
      lbAllRows = rows || [];
      renderLbPage();
      $("lbUpdated").textContent = "updated " + (updated || new Date().toISOString()).replace("T", " ").slice(0, 16) + " UTC";
    } catch {}
  }

  (async function loadLeaderboard() {
    const body = $("lbBody");
    if (!API_BASE) {
      body.innerHTML = `<tr><td colspan="5" class="muted center">indexer not yet live — leaderboard will populate when the first on-chain buy is indexed</td></tr>`;
      $("lbUpdated").textContent = "";
      return;
    }
    try {
      const { rows, updated } = await api("/api/leaderboard");
      lbAllRows = rows || [];
      renderLbPage();
      $("lbUpdated").textContent = "updated " + (updated || new Date().toISOString()).replace("T", " ").slice(0, 16) + " UTC";
    } catch (e) {
      body.innerHTML = `<tr><td colspan="5" class="muted center">leaderboard offline (${e?.message || "error"})</td></tr>`;
    }
  })();
})();
