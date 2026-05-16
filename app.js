(() => {
  const $ = (id) => document.getElementById(id);
  const isAddr = (s) => /^0x[a-fA-F0-9]{40}$/.test((s || "").trim());
  const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "—";

  // --- referred-by banner from ?ref= ---
  const params = new URLSearchParams(location.search);
  const refParam = params.get("ref");
  if (refParam && isAddr(refParam)) {
    $("referredBy").hidden = false;
    $("referredByAddr").textContent = short(refParam);
    try { localStorage.setItem("stackfi_ref", refParam); } catch {}
  }

  // --- restore last used addr ---
  let savedAddr = "";
  try { savedAddr = localStorage.getItem("stackfi_addr") || ""; } catch {}
  if (savedAddr) {
    $("addrInput").value = savedAddr;
    setTimeout(() => generate(savedAddr, true), 0);
  }

  // --- input handlers ---
  $("genBtn").addEventListener("click", () => generate($("addrInput").value));
  $("addrInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") generate($("addrInput").value);
  });

  $("connectBtn").addEventListener("click", async () => {
    const eth = window.ethereum;
    if (!eth) {
      hint("no wallet detected — paste an address manually");
      return;
    }
    try {
      const accs = await eth.request({ method: "eth_requestAccounts" });
      if (accs && accs[0]) {
        $("addrInput").value = accs[0];
        generate(accs[0]);
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
    if (!isAddr(addr)) { hint("not a valid 0x address (40 hex chars)"); return; }
    hint("");

    try { localStorage.setItem("stackfi_addr", addr); } catch {}

    const base = "https://stackfi.coyoti.xyz";
    const link = `${base}/?ref=${addr}`;
    $("linkOut").value = link;
    $("output").hidden = false;

    const tweet = encodeURIComponent(
      "stacking yield on @Coyoti / @StackFi — leverage, farms, vaults on PulseChain.\n\n" +
      "points -> airdrop. use my link:\n" + link
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
    "0x4FB80D9d4f1B47B4a9D27B6e0A0f9c2C5B8F7E11",
    "0x00D0876C2c1A2f3e4D5b6a7C8e9F0a1B2C3D4E5F",
    "0xA1B2C3d4E5F60718293a4b5c6d7e8f90a1b2c3d4",
    "0xC0FFEE1234567890AbCdEf1234567890AbCdEf12",
    "0xDEADBEEF00112233445566778899AaBbCcDdEeFf",
    "0xBADc0de00000Cc11223344556677889900aaBb22",
    "0x123456789aBcDeF0123456789ABcDef012345678",
    "0xFEEDFACE00000011223344556677889900aabb33",
    "0xCAFEBABE0011223344556677889900AABBCCDDEE",
    "0x9988776655443322110099887766554433221100",
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
