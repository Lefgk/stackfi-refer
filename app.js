(() => {
  // ====== CONFIG ======
  const API_BASE = "https://coyoti-api-production.up.railway.app";

  const PROD_BASE = "https://stackfi-refer.vercel.app";
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
    $("referredByAddr").textContent = short(refParam);
    try { localStorage.setItem("coyoti_ref", refParam); } catch {}
  }

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

  // ====== GENERATE LINK + LOAD STATS ======
  async function generate(raw, silent) {
    const addr = (raw || "").trim();
    if (!addr) { if (!silent) hint("paste an address first"); return; }
    if (!isAddr(addr)) { hint("not a valid Solana address (base58, 32–44 chars)"); return; }
    hint("");

    try { localStorage.setItem("coyoti_addr", addr); } catch {}

    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname) || location.protocol === "file:";
    const base = isLocal ? PROD_BASE : (location.origin + location.pathname.replace(/\/$/, ""));
    const link = `${base}/?ref=${addr}`;
    $("linkOut").value = link;
    $("output").hidden = false;

    const tweet = encodeURIComponent(
      "stacking on @coyoti — Solana referral game.\n\n" +
      "grow your network. earn big. use my link:\n" + link
    );
    $("shareX").href  = `https://twitter.com/intent/tweet?text=${tweet}`;
    $("shareTg").href = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("stack with me on Coyoti")}`;

    if (!API_BASE) { renderEmpty(); return; }
    try {
      const s = await api(`/api/wallet/${addr}`);
      renderStats(addr, s);
    } catch (e) {
      hint("could not load stats: " + (e?.message || "unknown"));
      renderEmpty();
    }
  }

  // ====== LEADERBOARD ======
  (async function loadLeaderboard() {
    const body = $("lbBody");
    if (!API_BASE) {
      body.innerHTML = `<tr><td colspan="5" class="muted center">indexer not yet live — leaderboard will populate when the first on-chain buy is indexed</td></tr>`;
      $("lbUpdated").textContent = "";
      return;
    }
    try {
      const { rows, updated } = await api("/api/leaderboard");
      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="5" class="muted center">no buys indexed yet — be the first to mint points</td></tr>`;
      } else {
        body.innerHTML = rows.map((r, i) => {
          const rk = rankFor(r.points).name;
          return `<tr>
            <td>${i + 1}</td>
            <td><code>${short(r.wallet)}</code></td>
            <td>${r.refs}</td>
            <td>${r.points.toLocaleString()}</td>
            <td><span class="rk" data-rank="${rk}">${rk}</span></td>
          </tr>`;
        }).join("");
      }
      $("lbUpdated").textContent = "updated " + (updated || new Date().toISOString()).replace("T", " ").slice(0, 16) + " UTC";
    } catch (e) {
      body.innerHTML = `<tr><td colspan="5" class="muted center">leaderboard offline (${e?.message || "error"})</td></tr>`;
    }
  })();
})();
