(() => {
  const BOARD_URL = "league/board.json";
  const badgeLabel = (id) =>
    ({
      first_light: "First light",
      three_steady: "3-day steady",
      week_clean: "Week clean",
      month_anchor: "Month anchor",
      iron_will: "Iron will",
      essentials_day: "Essentials day",
      deep_focus: "Deep Focus",
      deep_work: "Deep work",
      league_rookie: "League rookie",
    }[id] || id);

  const fmtAgo = (ms) => {
    if (!ms) return "—";
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };

  async function load() {
    const boardEl = document.getElementById("board");
    const empty = document.getElementById("empty");
    try {
      const res = await fetch(`${BOARD_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("missing");
      const data = await res.json();
      const entries = Array.isArray(data.entries) ? data.entries : [];
      document.getElementById("stat-players").textContent = String(entries.length);
      document.getElementById("stat-top").textContent = entries[0]
        ? String(entries[0].score)
        : "—";
      document.getElementById("stat-updated").textContent = fmtAgo(data.updatedAt);

      boardEl.innerHTML = "";
      if (!entries.length) {
        empty.hidden = false;
        return;
      }
      empty.hidden = true;
      entries.forEach((e, i) => {
        const li = document.createElement("li");
        li.className = "row";
        li.style.animationDelay = `${Math.min(i, 12) * 40}ms`;
        const rankClass =
          i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
        const clean =
          (e.focusMin || 0) + (e.workMin || 0) + (e.learnMin || 0);
        const badges = (e.badges || [])
          .slice(0, 4)
          .map((b) => `<span class="badge">${badgeLabel(b)}</span>`)
          .join("");
        li.innerHTML = `
          <div class="rank ${rankClass}">${i + 1}</div>
          <div>
            <div class="name">${escapeHtml(e.displayName || e.handle)}</div>
            <div class="handle">@${escapeHtml(e.handle)} · ${e.streakDays || 0}d streak · ${clean}m clean · Fun ${e.funMin || 0}m</div>
            ${e.intention ? `<p class="intention">“${escapeHtml(e.intention)}”</p>` : ""}
            <div class="badges">${badges}</div>
          </div>
          <div class="score">${e.score ?? 0}</div>`;
        boardEl.appendChild(li);
      });
    } catch (_) {
      empty.hidden = false;
      empty.textContent = "Board not published yet — join from the Steady app.";
      document.getElementById("stat-players").textContent = "0";
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  document.getElementById("refresh")?.addEventListener("click", load);
  load();
})();
