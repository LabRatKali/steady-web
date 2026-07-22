(() => {
  const BOARD_URL = "league/board.json";

  const BADGE_LABELS = {
    first_light: "First light",
    three_steady: "3-day steady",
    week_clean: "Week clean",
    fortnight_fire: "Fortnight fire",
    month_anchor: "Month anchor",
    iron_will: "Iron will",
    unbreakable: "Unbreakable",
    essentials_day: "Essentials day",
    monk_mode: "Monk mode",
    deep_focus: "Deep Focus",
    deep_work: "Deep work",
    marathon: "Marathon",
    league_rookie: "League rookie",
    focus_champ: "Focus champ",
    sprint_star: "Sprint star",
  };

  const TRACKS = {
    score: {
      field: "score",
      blurb: "Ranked by overall clean-day score — Focus, Work, Learn up; Fun down.",
      label: "Score",
    },
    focusScore: {
      field: "focusScore",
      blurb: "Ranked by Focus race — deep Focus minutes and Focus badges lead.",
      label: "Focus",
    },
    essentialsScore: {
      field: "essentialsScore",
      blurb: "Ranked by Essentials only — low Fun, high discipline.",
      label: "Essentials",
    },
    sprintScore: {
      field: "sprintScore",
      blurb: "Ranked by one-day sprint — today's sharpest clean day.",
      label: "Sprint",
    },
  };

  let entries = [];
  let activeTrack = "score";
  let boardMeta = { updatedAt: 0 };

  const badgeLabel = (id) => BADGE_LABELS[id] || String(id).replace(/_/g, " ");

  const escapeHtml = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const fmtAgo = (ms) => {
    if (!ms) return "—";
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };

  const initials = (name, handle) => {
    const src = String(name || handle || "?").trim();
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return src.slice(0, 2).toUpperCase();
  };

  const trackValue = (entry, field) => {
    const v = entry[field];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (field === "score") return Number(entry.score) || 0;
    return 0;
  };

  const sortedEntries = () => {
    const field = TRACKS[activeTrack].field;
    return [...entries].sort(
      (a, b) => trackValue(b, field) - trackValue(a, field)
    );
  };

  const moveTabInk = () => {
    const ink = document.querySelector(".tab-ink");
    const active = document.querySelector(".tab.is-active");
    if (!ink || !active) return;
    ink.style.width = `${active.offsetWidth}px`;
    ink.style.transform = `translateX(${active.offsetLeft}px)`;
  };

  const setTrack = (track) => {
    if (!TRACKS[track]) return;
    activeTrack = track;
    document.querySelectorAll(".tab").forEach((btn) => {
      const on = btn.dataset.track === track;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const blurb = document.getElementById("track-blurb");
    if (blurb) blurb.textContent = TRACKS[track].blurb;
    moveTabInk();
    renderBoard();
  };

  const renderHero = () => {
    const sorted = sortedEntries();
    const players = document.getElementById("stat-players");
    const top = document.getElementById("stat-top");
    const updated = document.getElementById("stat-updated");
    if (players) players.textContent = String(entries.length);
    if (top) {
      top.textContent = sorted[0]
        ? String(trackValue(sorted[0], TRACKS[activeTrack].field))
        : "—";
    }
    if (updated) updated.textContent = fmtAgo(boardMeta.updatedAt);
  };

  const buildAvatar = (entry) => {
    const wrap = document.createElement("div");
    wrap.className = "avatar";
    const letters = initials(entry.displayName, entry.handle);
    const url = entry.avatarUrl && String(entry.avatarUrl).trim();

    if (!url) {
      wrap.innerHTML = `<span class="avatar-initials">${escapeHtml(letters)}</span>`;
      return wrap;
    }

    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      wrap.innerHTML = `<span class="avatar-initials">${escapeHtml(letters)}</span>`;
    });
    wrap.appendChild(img);
    return wrap;
  };

  const renderBoard = () => {
    const boardEl = document.getElementById("board");
    const empty = document.getElementById("empty");
    if (!boardEl || !empty) return;

    const sorted = sortedEntries();
    const field = TRACKS[activeTrack].field;
    const scoreLabel = TRACKS[activeTrack].label;

    renderHero();
    boardEl.innerHTML = "";

    if (!sorted.length) {
      empty.hidden = false;
      return;
    }

    empty.hidden = true;

    sorted.forEach((e, i) => {
      const li = document.createElement("li");
      li.className = "row";
      li.style.animationDelay = `${Math.min(i, 14) * 45}ms`;

      const rankClass =
        i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
      const clean =
        (e.focusMin || 0) + (e.workMin || 0) + (e.learnMin || 0);
      const badges = (e.badges || [])
        .slice(0, 5)
        .map((b) => `<span class="badge">${escapeHtml(badgeLabel(b))}</span>`)
        .join("");
      const intention = e.intention
        ? `<p class="intention">“${escapeHtml(e.intention)}”</p>`
        : "";

      li.innerHTML = `
        <div class="rank ${rankClass}" aria-label="Rank ${i + 1}">${i + 1}</div>
        <div class="avatar-slot"></div>
        <div class="row-body">
          <div class="name-line">
            <span class="name">${escapeHtml(e.displayName || e.handle || "Anonymous")}</span>
            <span class="handle">@${escapeHtml(e.handle || "—")}</span>
          </div>
          <div class="meta">
            <span>${e.streakDays || 0}d streak</span>
            <span>${clean}m clean</span>
            <span class="fun">Fun −${e.funMin || 0}m</span>
          </div>
          ${intention}
          <div class="badges">${badges}</div>
        </div>
        <div class="score-block">
          <div class="score">${trackValue(e, field)}</div>
          <span class="score-label">${escapeHtml(scoreLabel)}</span>
        </div>`;
      const slot = li.querySelector(".avatar-slot");
      if (slot) slot.replaceWith(buildAvatar(e));
      boardEl.appendChild(li);
    });
  };

  async function load() {
    const empty = document.getElementById("empty");
    try {
      const res = await fetch(`${BOARD_URL}?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("missing");
      const data = await res.json();
      entries = Array.isArray(data.entries) ? data.entries : [];
      boardMeta = { updatedAt: data.updatedAt || 0 };
      renderBoard();
    } catch (_) {
      entries = [];
      boardMeta = { updatedAt: 0 };
      renderBoard();
      if (empty) {
        empty.hidden = false;
        const title = empty.querySelector(".empty-title");
        const body = empty.querySelector("p:not(.empty-title)");
        if (title) title.textContent = "Board not published yet";
        if (body) {
          body.textContent =
            "Join from the Steady app — your opt-in stats will appear here.";
        }
      }
    }
  }

  const initNav = () => {
    const header = document.querySelector(".top");
    const toggle = document.querySelector(".nav-toggle");
    if (!header || !toggle) return;
    toggle.addEventListener("click", () => {
      const open = header.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  };

  const initTabs = () => {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => setTrack(btn.dataset.track));
    });
    requestAnimationFrame(moveTabInk);
    window.addEventListener("resize", moveTabInk);
  };

  document.getElementById("refresh")?.addEventListener("click", load);
  initNav();
  initTabs();
  load();
})();
