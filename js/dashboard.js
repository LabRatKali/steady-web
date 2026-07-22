(function () {
  const DURATIONS = [
    { label: "5m", mins: 5 },
    { label: "10m", mins: 10 },
    { label: "15m", mins: 15 },
    { label: "30m", mins: 30 },
    { label: "45m", mins: 45 },
    { label: "1h", mins: 60 },
    { label: "2h", mins: 120 },
    { label: "Always", mins: -1 },
    { label: "As asked", mins: null },
  ];

  let client = null;
  let policy = null;
  let todosPayload = null;
  let session = null;
  let pendingApprovals = [];
  let policyDirty = false;

  const $ = (id) => document.getElementById(id);
  const status = (msg, kind) => {
    const el = $("status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("ok", "err", "busy");
    if (kind) el.classList.add(kind);
  };
  const flashOk = (msg) => status(msg, "ok");
  const flashBusy = (msg) => status(msg, "busy");
  const flashErr = (msg) => status(msg, "err");

  function setDirty(on) {
    policyDirty = !!on;
    const bar = $("dash-push-bar");
    const label = $("push-label");
    const hint = $("push-hint");
    const btn = $("btn-push-kid");
    if (bar) bar.classList.toggle("is-dirty", policyDirty);
    if (label) label.textContent = policyDirty ? "Unsaved changes" : "Ready";
    if (hint) {
      hint.textContent = policyDirty
        ? "Save & push sends the whole profile to the kid phone."
        : "Change Controls or Budgets, then push the whole profile to the kid.";
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = policyDirty ? "Save & push to kid" : "Push again to kid";
    }
  }

  function mutatePolicyLocal(mutator) {
    if (!policy) {
      policy = {
        childDeviceId: (client && client.childId) || "",
        parentDeviceId: (client && client.parentId) || "",
        updatedAt: Date.now(),
      };
    }
    mutator(policy);
    policy.updatedAt = Date.now();
    if (client && client.childId) policy.childDeviceId = client.childId;
    setDirty(true);
    fillPolicyForm(policy);
  }
  const loginError = (msg) => {
    const el = $("login-error");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  };

  function showApp(on) {
    const gate = $("gate");
    const app = $("app");
    if (gate) {
      gate.hidden = on;
      gate.setAttribute("aria-hidden", on ? "true" : "false");
    }
    if (app) {
      app.hidden = !on;
      app.setAttribute("aria-hidden", on ? "false" : "true");
    }
    document.body.classList.toggle("signed-in", !!on);
    // Nav: swap Sign in for account controls when logged in
    const navAuth = $("nav-auth");
    if (navAuth) navAuth.hidden = !on;
    const navSign = $("nav-signin-link");
    if (navSign) navSign.hidden = !!on;
    // Signed-in AdSense units → your AdMob/AdSense publisher (keys/admob.json)
    document.querySelectorAll("[data-steady-ad]").forEach((el) => {
      el.hidden = !on;
      el.setAttribute("aria-hidden", on ? "false" : "true");
    });
    if (on && window.SteadyAdsWeb && typeof SteadyAdsWeb.showSignedInAds === "function") {
      try {
        SteadyAdsWeb.showSignedInAds();
      } catch (_) {}
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildClient(cfg) {
    const token = (cfg.pat || SteadyAuth.builtinToken() || "").trim();
    if (!token) throw new Error("No sync token — publish site with keys/steady-github.token");
    const c = new SteadyGithub({
      token,
      repo: SteadyAuth.runtime().repo || "LabRatKali/steady-sync",
      pairCode: cfg.pair,
      familySecret: cfg.secret || cfg.pair,
    });
    c.childId = cfg.child || "";
    c.parentId = cfg.parent || "";
    return c;
  }

  async function enterWithSession(sess) {
    session = sess;
    // Hide login shell immediately — never leave Welcome back over the remote.
    showApp(true);
    $("session-meta").textContent = `${sess.email || sess.name || sess.googleSub || "Signed in"} · family ${sess.familyCode}`;
    if ($("nav-user")) {
      $("nav-user").textContent = sess.email || sess.name || "Account";
    }
    try {
      const child =
        ($("child-live") && $("child-live").value.trim()) ||
        localStorage.getItem("steady.web.child") ||
        "";
      client = buildClient({
        pair: sess.familyCode,
        secret: sess.familySecret,
        child,
        parent: "",
      });
      if ($("child-live")) $("child-live").value = child;
      await loadKidPhones();
      await refresh();
      if (window.__steadyPoll) clearInterval(window.__steadyPoll);
      window.__steadyPoll = setInterval(refresh, 12000);
    } catch (e) {
      showApp(false);
      throw e;
    }
  }

  function setToggle(id, on) {
    const el = $(id);
    if (el) el.checked = !!on;
  }

  function fillPolicyForm(p) {
    const f = $("policy-form");
    if (!f || !p) return;
    f.focusMinutes.value = p.focusMinutes ?? 15;
    f.workMinutes.value = p.workMinutes ?? 120;
    f.learningMinutes.value = p.learningMinutes ?? 120;
    f.entertainmentMinutes.value = p.entertainmentMinutes ?? 5;
    f.schoolStartHour.value = p.schoolStartHour ?? 8;
    f.schoolEndHour.value = p.schoolEndHour ?? 15;
    if (f.bedtimeStartHour) f.bedtimeStartHour.value = p.bedtimeStartHour ?? 21;
    if (f.bedtimeEndHour) f.bedtimeEndHour.value = p.bedtimeEndHour ?? 7;
    setToggle("tog-school", !!p.schoolModeEnabled);
    setToggle("tog-filter", p.filterEnabled !== false);
    setToggle("tog-install", p.installApprovalEnabled !== false);
    setToggle("tog-location", !!p.liveLocationEnabled);
    setToggle("tog-wa", p.blockWhatsappUpdates !== false);
    setToggle("tog-inapp", p.blockInAppBrowsers !== false);
    setToggle("tog-adult", p.blockCatAdult !== false);
    setToggle("tog-social", p.blockCatSocial !== false);
    setToggle("tog-gambling", p.blockCatGambling !== false);
    setToggle("tog-dating", p.blockCatDating !== false);
    setToggle("tog-gaming", !!p.blockCatGaming);
    setToggle("tog-bedtime", !!p.bedtimeEnabled);
    setToggle("tog-hide-notifs", p.hideServiceNotifications !== false);
    setToggle("tog-league-ads", !!p.leagueAdsEnabled);
    const ptsEl = $("league-ad-points");
    if (ptsEl) ptsEl.value = String(p.leagueAdPointsPerWatch || 5);
    const capEl = $("league-ad-cap");
    if (capEl) capEl.value = String(p.leagueAdDailyCap || 40);
    const until = p.familyPauseUntil || 0;
    const pauseEl = $("pause-state");
    if (pauseEl) {
      pauseEl.textContent =
        until > Date.now()
          ? `Paused — about ${Math.ceil((until - Date.now()) / 60000)} min left`
          : "Not paused";
    }
    const unlockUntil = p.settingsUnlockUntil || 0;
    const unlockEl = $("unlock-state");
    if (unlockEl) {
      unlockEl.textContent =
        unlockUntil > Date.now()
          ? `Settings unlock — about ${Math.ceil((unlockUntil - Date.now()) / 60000)} min left`
          : "Settings locked on kid phone";
    }
    const breakUntil = p.softDisableUntil || 0;
    const breakEl = $("break-state");
    if (breakEl) {
      breakEl.textContent =
        breakUntil > Date.now()
          ? `Break Steady — about ${Math.ceil((breakUntil - Date.now()) / 60000)} min left`
          : "No break active";
    }
    const forceEl = $("force-mode-state");
    if (forceEl) {
      forceEl.textContent = p.forceMode
        ? `Forced: ${p.forceMode}`
        : "No forced mode";
    }
    renderAllowedSites(p.extraAllowedHosts || "");
  }

  function renderAllowedSites(csv) {
    const box = $("sites-list");
    if (!box) return;
    const hosts = String(csv || "")
      .split(/[,;\s]+/)
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (!hosts.length) {
      box.innerHTML = '<p class="muted">No always-allowed sites yet. Approve a site ask, or add one below.</p>';
      return;
    }
    box.innerHTML = "";
    hosts.forEach((host) => {
      const div = document.createElement("div");
      div.className = "dash-item";
      div.innerHTML = `<strong>${escapeHtml(host)}</strong>`;
      const row = document.createElement("div");
      row.className = "approve-btns";
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn ghost";
      rm.textContent = "Remove";
      rm.addEventListener("click", () => removeAllowedSite(host));
      row.appendChild(rm);
      div.appendChild(row);
      box.appendChild(div);
    });
  }

  async function removeAllowedSite(host) {
    mutatePolicyLocal((p) => {
      const hosts = String(p.extraAllowedHosts || "")
        .split(/[,;\s]+/)
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h && h !== host);
      p.extraAllowedHosts = hosts.join(",");
    });
    flashOk("Site removed — tap Save & push");
  }

  async function addAllowedSite(raw) {
    const host = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .replace(/^www\./, "");
    if (!host) return;
    mutatePolicyLocal((p) => {
      const hosts = String(p.extraAllowedHosts || "")
        .split(/[,;\s]+/)
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
      if (!hosts.includes(host)) hosts.push(host);
      p.extraAllowedHosts = hosts.join(",");
    });
    flashOk(`${host} allowed — tap Save & push`);
  }

  async function loadKidPhones() {
    const sel = $("child-select");
    if (!sel || !client) return;
    try {
      const phones = await client.listFamilyPhones();
      window.__steadyPhones = phones || [];
      const current = ($("child-live") && $("child-live").value.trim()) || "";
      sel.innerHTML = '<option value="">Choose a linked phone…</option>';
      const kids = (phones || []).filter((ph) => {
        const role = String(ph.role || "").toUpperCase();
        return role !== "PARENT";
      });
      kids.forEach((ph) => {
        const id = ph.deviceId || ph.childDeviceId || ph.id || "";
        if (!id) return;
        const opt = document.createElement("option");
        opt.value = id;
        const label = (ph.label || ph.name || "Kid phone").trim() || "Kid phone";
        const shortId = id.length > 10 ? id.slice(0, 8) + "…" : id;
        opt.textContent = `${label} · ${shortId}`;
        if (id === current) opt.selected = true;
        sel.appendChild(opt);
      });
      if (!kids.length) {
        flashOk("No linked kid phones yet — open Steady on the kid phone so it appears here.");
      }
      if (!current && kids.length === 1) {
        const only =
          kids[0].deviceId || kids[0].childDeviceId || kids[0].id || "";
        if (only && $("child-live")) {
          $("child-live").value = only;
          sel.value = only;
          syncKidLabelField(only);
        }
      } else if (current) {
        syncKidLabelField(current);
      }
    } catch (e) {
      flashErr(
        (e && e.message) ||
          "Couldn’t load linked phones. Hard-refresh the page and try again."
      );
    }
  }

  function syncKidLabelField(deviceId) {
    const phones = window.__steadyPhones || [];
    const ph = phones.find(
      (p) => (p.deviceId || p.childDeviceId || p.id) === deviceId
    );
    if ($("child-label")) {
      $("child-label").value = (ph && (ph.label || ph.name)) || "";
    }
  }

  async function renameKidPhone() {
    if (!client || !client.childId) {
      flashErr("Choose a kid phone first");
      return;
    }
    const label = (($("child-label") && $("child-label").value) || "").trim();
    if (!label) {
      flashErr("Type a name first — e.g. Maya’s phone");
      return;
    }
    try {
      flashBusy("Saving name…");
      const phones = window.__steadyPhones || [];
      const prev = phones.find(
        (p) => (p.deviceId || p.childDeviceId || p.id) === client.childId
      ) || {};
      await client.publishPhoneProfile({
        deviceId: client.childId,
        familyCode: client.pairCode || "",
        role: prev.role || "CHILD",
        label,
        name: label,
      });
      flashOk("Name saved");
      await loadKidPhones();
    } catch (e) {
      flashErr(e && e.message ? e.message : "Couldn’t save name");
    }
  }

  async function forgetKidPhone() {
    if (!client || !client.childId) {
      flashErr("Choose a kid phone first");
      return;
    }
    const id = client.childId;
    const phones = window.__steadyPhones || [];
    const ph = phones.find(
      (p) => (p.deviceId || p.childDeviceId || p.id) === id
    );
    const label = (ph && (ph.label || ph.name)) || id.slice(0, 8);
    const ok = window.confirm(
      `Forget “${label}” from parent remote?\n\nThis removes it from your linked phones list here. It does not factory-reset the phone — open Steady on that device to leave the family if needed.`
    );
    if (!ok) return;
    try {
      flashBusy("Forgetting phone…");
      await client.forgetFamilyPhone(id);
      if ($("child-live")) $("child-live").value = "";
      if ($("child-label")) $("child-label").value = "";
      if ($("child-select")) $("child-select").value = "";
      client.childId = "";
      try {
        localStorage.removeItem("steady.web.child");
      } catch (_) {}
      flashOk("Phone forgotten from parent remote");
      await loadKidPhones();
      refresh({ quiet: true });
    } catch (e) {
      flashErr(e && e.message ? e.message : "Couldn’t forget phone");
    }
  }

  function kindLabel(kind) {
    switch (String(kind || "").toUpperCase()) {
      case "APP":
        return "App";
      case "SITE":
        return "Website";
      case "MODE":
        return "Mode";
      case "REWARD":
        return "League reward";
      case "GATE":
      case "SETTINGS":
      case "CATEGORIES":
        return "Unlock";
      default:
        return "Fun";
    }
  }

  function friendlyAppName(pkg) {
    if (!pkg) return "App";
    const last = String(pkg).split(".").pop() || pkg;
    return last.charAt(0).toUpperCase() + last.slice(1);
  }

  function catDisplay(cat) {
    switch (String(cat || "").toUpperCase()) {
      case "ALWAYS_ALLOWED":
        return "Always";
      case "SYSTEM":
        return "System";
      case "FOCUS":
      case "FOCUS_ONLY":
        return "Focus";
      case "WORK":
        return "Work";
      case "LEARNING":
        return "Learn";
      case "ENTERTAINMENT":
        return "Fun";
      case "HYBRID":
        return "Hybrid";
      case "TOOLS":
        return "Tools";
      case "BLOCKED":
        return "Never";
      default:
        return cat || "Unsorted";
    }
  }

  function renderUsageFromApps(payload) {
    const box = $("usage-box");
    if (!box) return;
    const apps = ((payload && payload.apps) || [])
      .slice()
      .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
    if (!apps.length) {
      box.innerHTML =
        '<p class="muted">No app list yet — open Steady on the kid phone so apps sync. Full minute-by-minute usage stays on the phone under Usage.</p>';
      return;
    }
    const top = apps.slice(0, 24);
    box.innerHTML =
      '<ul class="usage-list">' +
      top
        .map((app) => {
          const name = escapeHtml(app.label || friendlyAppName(app.packageName));
          const bucket = escapeHtml(catDisplay(app.category));
          return `<li><strong>${name}</strong> <span class="muted">${bucket}</span></li>`;
        })
        .join("") +
      "</ul>" +
      '<p class="muted">Showing synced app names (not package codes). Open Usage on the kid phone for today’s minutes.</p>';
  }

  function renderApprovals(list) {
    pendingApprovals = Array.isArray(list) ? list.slice() : [];
    const box = $("approvals-list");
    if (!box) return;
    if (!pendingApprovals.length) {
      box.innerHTML = '<p class="muted">No pending asks.</p>';
      updateGlance();
      return;
    }
    box.innerHTML = "";
    pendingApprovals.forEach((req) => {
      const div = document.createElement("div");
      div.className = "dash-item";
      div.dataset.reqId = req.id || "";
      const kind = kindLabel(req.kind);
      const kindUp = String(req.kind || "FUN").toUpperCase();
      const isReward = kindUp === "REWARD";
      const needsMinutes =
        kindUp === "FUN" ||
        kindUp === "APP" ||
        kindUp === "SITE" ||
        kindUp === "ENTERTAINMENT";
      const meta = isReward
        ? `${kind} · ask Full / Half / Token · ${req.requestedMinutes || "?"} min full`
        : needsMinutes
          ? `${kind} · asked for ${req.requestedMinutes || "?"} min`
          : kind;
      div.innerHTML = `<strong>${escapeHtml(req.message || req.kind || "Ask")}</strong>
        <span class="muted">${escapeHtml(meta)}</span>`;
      const btns = document.createElement("div");
      btns.className = "approve-btns";
      if (isReward) {
        const full = Math.max(0, Number(req.requestedMinutes) || 0);
        const half = Math.max(1, Math.floor(full / 2));
        const token = Math.max(1, Math.min(5, Math.floor(full / 4) || 3));
        [
          { label: full > 0 ? `Full ${full}m` : "Full", mins: full || req.requestedMinutes || 0 },
          { label: full > 0 ? `Half ${half}m` : "Half", mins: half },
          { label: full > 0 ? `Token ${token}m` : "Token", mins: token },
        ].forEach((d) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn ghost";
          b.textContent = d.label;
          b.addEventListener("click", (ev) => {
            ev.preventDefault();
            onDecide(req, true, d.mins, b);
          });
          btns.appendChild(b);
        });
      } else if (needsMinutes) {
        DURATIONS.forEach((d) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn ghost";
          b.textContent = d.label;
          b.addEventListener("click", (ev) => {
            ev.preventDefault();
            onDecide(req, true, d.mins, b);
          });
          btns.appendChild(b);
        });
      } else {
        const allow = document.createElement("button");
        allow.type = "button";
        allow.className = "btn primary";
        allow.textContent = "Allow";
        allow.addEventListener("click", (ev) => {
          ev.preventDefault();
          onDecide(req, true, req.requestedMinutes || 0, allow);
        });
        btns.appendChild(allow);
      }
      const deny = document.createElement("button");
      deny.type = "button";
      deny.className = "btn ghost";
      deny.textContent = needsMinutes ? "Deny" : "Don’t allow";
      deny.addEventListener("click", (ev) => {
        ev.preventDefault();
        onDecide(req, false, 0, deny);
      });
      btns.appendChild(deny);
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "btn ghost";
      dismiss.textContent = "Dismiss";
      dismiss.title = "Remove this ask — it will not come back";
      dismiss.addEventListener("click", (ev) => {
        ev.preventDefault();
        onDecide(req, "DISMISS", 0, dismiss);
      });
      btns.appendChild(dismiss);
      div.appendChild(btns);
      box.appendChild(div);
    });
    updateGlance();
  }

  function updateGlance() {
    const box = $("glance-list");
    if (!box) return;
    const child = (client && client.childId) || "";
    if (!child) {
      box.innerHTML =
        "<li>Pick a linked phone to see pending asks and pause state.</li>";
      return;
    }
    const phones = window.__steadyPhones || [];
    const ph = phones.find(
      (p) => (p.deviceId || p.childDeviceId || p.id) === child
    );
    const label = (ph && (ph.label || ph.name)) || child.slice(0, 8) + "…";
    const asks = (pendingApprovals || []).length;
    const pauseUntil = policy && policy.familyPauseUntil ? Number(policy.familyPauseUntil) : 0;
    const paused = pauseUntil > Date.now();
    const force = (policy && policy.forceMode) || "";
    const bedtime = !!(policy && policy.bedtimeEnabled);
    const school = !!(policy && policy.schoolModeEnabled);
    box.innerHTML = [
      `<li><strong>${escapeHtml(label)}</strong> selected</li>`,
      `<li>${asks} pending ask${asks === 1 ? "" : "s"}</li>`,
      `<li>${paused ? "Day off / pause is active" : "No household pause"}</li>`,
      `<li>${force ? "Forced mode: " + escapeHtml(force) : "No forced mode"}</li>`,
      `<li>${school ? "School hours on" : "School hours off"} · ${bedtime ? "Bedtime on" : "Bedtime off"}</li>`,
    ].join("");
  }

  async function applyRoutine(name) {
    if (!client || !client.childId) {
      flashErr("Choose a kid phone first");
      return;
    }
    const labels = {
      "school-night": "School night",
      weekend: "Weekend",
      bedtime: "Bedtime now",
      "focus-hour": "Focus hour",
    };
    mutatePolicyLocal((p) => {
      if (name === "school-night") {
        p.schoolModeEnabled = true;
        p.bedtimeEnabled = true;
        p.bedtimeStartHour = p.bedtimeStartHour || 21;
        p.bedtimeEndHour = p.bedtimeEndHour || 7;
        p.entertainmentMinutes = Math.min(Number(p.entertainmentMinutes) || 5, 5);
        p.forceMode = "FOCUS";
        p.familyPauseUntil = 0;
      } else if (name === "weekend") {
        p.schoolModeEnabled = false;
        p.forceMode = "";
        p.entertainmentMinutes = Math.max(Number(p.entertainmentMinutes) || 5, 45);
        p.weekendBonusMinutes = Math.max(Number(p.weekendBonusMinutes) || 0, 30);
      } else if (name === "bedtime") {
        p.bedtimeEnabled = true;
        p.forceMode = "FOCUS";
        p.familyPauseUntil = 0;
        p.softDisableUntil = 0;
      } else if (name === "focus-hour") {
        p.forceMode = "FOCUS";
        p.familyPauseUntil = 0;
        p.softDisableUntil = 0;
      }
    });
    try {
      flashBusy("Pushing " + (labels[name] || "routine") + "…");
      await pushPolicyToKid();
      const st = $("routine-state");
      if (st) st.textContent = (labels[name] || "Routine") + " pushed to kid";
      flashOk((labels[name] || "Routine") + " pushed");
      updateGlance();
    } catch (e) {
      flashErr(String(e.message || e));
    }
  }

  async function applyInstant(name) {
    if (!client || !client.childId) {
      flashErr("Choose a kid phone first");
      return;
    }
    const labels = {
      "lock-now": "Lock Fun now",
      "pause-net": "Pause internet",
      "resume-net": "Resume internet",
      "clear-force": "Clear forced mode",
    };
    mutatePolicyLocal((p) => {
      if (name === "lock-now") {
        p.forceMode = "FOCUS";
        p.familyPauseUntil = 0;
        p.softDisableUntil = 0;
      } else if (name === "pause-net") {
        p.filterEnabled = false;
      } else if (name === "resume-net") {
        p.filterEnabled = true;
      } else if (name === "clear-force") {
        p.forceMode = "";
      }
    });
    try {
      flashBusy("Pushing " + (labels[name] || "action") + "…");
      await pushPolicyToKid();
      const st = $("instant-state");
      if (st) st.textContent = (labels[name] || "Action") + " pushed";
      flashOk((labels[name] || "Action") + " pushed");
      updateGlance();
    } catch (e) {
      flashErr(String(e.message || e));
    }
  }

  function renderTodos(payload) {
    const box = $("todos-list");
    if (!box) return;
    const items = (payload && payload.items) || [];
    if (!items.length) {
      box.innerHTML = '<p class="muted">No to-dos yet.</p>';
      return;
    }
    box.innerHTML = "";
    items.forEach((item) => {
      const div = document.createElement("div");
      div.className = "dash-item";
      const done = item.status === "DONE" || item.status === "APPROVED";
      div.innerHTML = `<strong>${done ? "✓ " : ""}${escapeHtml(item.title || "To-do")}</strong>
        <span class="muted">${escapeHtml(item.status || "OPEN")}</span>`;
      if (!done) {
        const row = document.createElement("div");
        row.className = "approve-btns";
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "btn ghost";
        approve.textContent = "Mark done";
        approve.addEventListener("click", async () => {
          try {
            approve.disabled = true;
            flashBusy("Approving to-do…");
            // APPROVED (not DONE) — matches kid Fun gate + merge ranks
            todosPayload.items = todosPayload.items.map((t) =>
              t.id === item.id
                ? Object.assign({}, t, { status: "APPROVED", updatedAt: Date.now() })
                : t
            );
            todosPayload.updatedAt = Date.now();
            renderTodos(todosPayload);
            await client.publishTodos(todosPayload);
            flashOk("To-do approved · sent");
          } catch (e) {
            approve.disabled = false;
            flashErr(String(e.message || e));
          }
        });
        row.appendChild(approve);
        div.appendChild(row);
      }
      box.appendChild(div);
    });
  }

  function renderInstalls(list) {
    const box = $("installs-list");
    if (!box) return;
    box.innerHTML = "";
    if (!list || !list.length) {
      box.innerHTML = '<p class="muted">No pending install asks.</p>';
      return;
    }
    list.forEach((req) => {
      const div = document.createElement("div");
      div.className = "dash-item";
      div.innerHTML = `<strong>${escapeHtml(req.label || req.packageName)}</strong>
        <span class="muted">${escapeHtml(req.packageName || "")}</span>`;
      const row = document.createElement("div");
      row.className = "approve-btns";
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "btn primary";
      yes.textContent = "Approve install";
      const no = document.createElement("button");
      no.type = "button";
      no.className = "btn ghost";
      no.textContent = "Deny";
      yes.addEventListener("click", async () => {
        try {
          div.classList.add("dash-item-sent");
          yes.disabled = true;
          no.disabled = true;
          flashBusy("Sending install approve…");
          await client.decideInstall(req, true);
          div.remove();
          flashOk("Install approved · sent");
        } catch (e) {
          yes.disabled = false;
          no.disabled = false;
          div.classList.remove("dash-item-sent");
          flashErr(String(e.message || e));
        }
      });
      no.addEventListener("click", async () => {
        try {
          div.classList.add("dash-item-sent");
          yes.disabled = true;
          no.disabled = true;
          flashBusy("Sending install deny…");
          await client.decideInstall(req, false);
          div.remove();
          flashOk("Install denied · sent");
        } catch (e) {
          yes.disabled = false;
          no.disabled = false;
          div.classList.remove("dash-item-sent");
          flashErr(String(e.message || e));
        }
      });
      row.appendChild(yes);
      row.appendChild(no);
      div.appendChild(row);
      box.appendChild(div);
    });
  }

  function renderApps(payload, overrides) {
    const box = $("apps-list");
    if (!box) return;
    const apps = (payload && payload.apps) || [];
    const q = (($("apps-filter") && $("apps-filter").value) || "").trim().toLowerCase();
    if (!apps.length) {
      box.innerHTML = '<p class="muted">No inventory yet — open Steady on the kid phone (Home / categories) so apps sync here.</p>';
      return;
    }
    let arr = [];
    try {
      arr = JSON.parse(overrides || "[]");
    } catch (_) {}
    const map = {};
    (arr || []).forEach((o) => {
      if (o && o.packageName) map[o.packageName] = o.category;
    });
    const filtered = apps.filter((app) => {
      if (!q) return true;
      const hay = `${app.label || ""} ${app.packageName || ""} ${map[app.packageName] || app.category || ""}`.toLowerCase();
      return hay.includes(q);
    });
    const countEl = $("apps-count");
    if (countEl) {
      countEl.textContent = `${filtered.length} of ${apps.length} apps`;
    }
    box.innerHTML = "";
    filtered.forEach((app) => {
      const pkg = app.packageName || "";
      const div = document.createElement("div");
      div.className = "dash-item";
      const cat = map[pkg] || app.category || "";
      const sysMark = app.isSystem ? " · OS" : "";
      div.innerHTML = `<strong>${escapeHtml(app.label || friendlyAppName(pkg))}</strong>
        <span class="muted">${escapeHtml(catDisplay(cat))}${sysMark}</span>
        <span class="muted" style="font-size:0.75rem">${escapeHtml(pkg)}</span>`;
      const row = document.createElement("div");
      row.className = "approve-btns";
      [
        { cat: "ALWAYS_ALLOWED", label: "Always" },
        { cat: "SYSTEM", label: "System" },
        { cat: "FOCUS_ONLY", label: "Focus" },
        { cat: "WORK", label: "Work" },
        { cat: "LEARNING", label: "Learn" },
        { cat: "ENTERTAINMENT", label: "Fun" },
        { cat: "TOOLS", label: "Tools" },
        { cat: "BLOCKED", label: "Never" },
      ].forEach((opt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn ghost" + (cat === opt.cat ? " primary" : "");
        b.textContent = opt.label;
        b.title =
          opt.cat === "SYSTEM"
            ? "System — always works, never locked or grayed"
            : opt.label;
        b.addEventListener("click", () => setAppOverride(pkg, opt.cat));
        row.appendChild(b);
      });
      div.appendChild(row);
      box.appendChild(div);
    });
  }

  async function onDecide(req, approve, minutes, btn) {
    const box = $("approvals-list");
    const card =
      (btn && btn.closest && btn.closest(".dash-item")) ||
      (box &&
        box.querySelector(`[data-req-id="${CSS.escape(req.id || "")}"]`));
    try {
      if (btn) btn.disabled = true;
      if (card) {
        card.classList.add("dash-item-sent");
        card.querySelectorAll("button").forEach((b) => {
          b.disabled = true;
        });
      }
      const dismiss = approve === "DISMISS" || approve === "dismiss";
      flashBusy(dismiss ? "Dismissing…" : approve ? "Sending approve…" : "Sending deny…");
      const mins =
        minutes === null || minutes === undefined
          ? req.requestedMinutes || 5
          : minutes;
      pendingApprovals = pendingApprovals.filter((r) => r.id !== req.id);
      if (card) card.remove();
      if (!pendingApprovals.length && box) {
        box.innerHTML = '<p class="muted">No pending asks.</p>';
      }
      await client.decideApproval(req, dismiss ? "DISMISS" : approve, mins);
      if (!dismiss && approve && mins < 0) {
        const kind = String(req.kind || "").toUpperCase();
        if (kind === "SITE") {
          const host = String(req.targetHost || req.host || "")
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .split("/")[0]
            .replace(/^www\./, "");
          if (host) {
            await patchPolicy((p) => {
              const hosts = String(p.extraAllowedHosts || "")
                .split(/[,;\s]+/)
                .map((h) => h.trim().toLowerCase())
                .filter(Boolean);
              if (!hosts.includes(host)) hosts.push(host);
              p.extraAllowedHosts = hosts.join(",");
            });
            renderAllowedSites(policy.extraAllowedHosts || "");
          }
        } else if (kind === "APP" && req.targetPackage) {
          await setAppOverride(req.targetPackage, "ALWAYS_ALLOWED");
        }
      }
      flashOk(
        dismiss
          ? "Dismissed · gone for good"
          : approve
            ? "Approved · sent to kid"
            : "Denied · sent to kid"
      );
    } catch (e) {
      flashErr(String(e.message || e));
      try {
        renderApprovals(await client.listPendingApprovals(client.childId));
      } catch (_) {}
    }
  }

  async function patchPolicy(mutator) {
    if (!client.childId) throw new Error("Set kid device ID first");
    if (!policy) {
      policy = {
        childDeviceId: client.childId,
        parentDeviceId: client.parentId || "",
        updatedAt: Date.now(),
      };
    }
    mutator(policy);
    policy.updatedAt = Date.now();
    policy.childDeviceId = client.childId;
    await client.publishPolicy(policy);
  }

  async function setPause(minutes) {
    mutatePolicyLocal((p) => {
      p.familyPauseUntil = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
    });
    flashOk(minutes > 0 ? `Pause ${minutes} min — tap Save & push` : "Pause cleared — tap Save & push");
  }

  async function setAppOverride(pkg, category) {
    try {
      flashBusy("Sending app rule…");
      await patchPolicy((p) => {
        let arr = [];
        try {
          arr = JSON.parse(p.appOverridesJson || "[]");
        } catch (_) {
          arr = [];
        }
        arr = (arr || []).filter((o) => o.packageName !== pkg);
        arr.push({ packageName: pkg, category, userSerial: 0 });
        p.appOverridesJson = JSON.stringify(arr);
      });
      setDirty(false);
      renderApps(window.__steadyAppsPayload || { apps: [] }, policy.appOverridesJson);
      flashOk("App rule sent");
    } catch (e) {
      flashErr(String(e.message || e));
    }
  }

  async function pushPolicyToKid() {
    if (!client || !client.childId) {
      flashErr("Choose a kid phone first");
      return;
    }
    try {
      flashBusy("Pushing full profile to kid…");
      applyBudgetFormToPolicy();
      policy.updatedAt = Date.now();
      policy.childDeviceId = client.childId;
      await client.publishPolicy(policy);
      setDirty(false);
      flashOk("Full profile pushed — kid Refresh applies it now (or within ~15s)");
    } catch (e) {
      flashErr(String(e.message || e));
    }
  }

  function applyBudgetFormToPolicy() {
    const f = $("policy-form");
    if (!f || !policy) return;
    policy.focusMinutes = Number(f.focusMinutes.value) || 0;
    policy.workMinutes = Number(f.workMinutes.value) || 0;
    policy.learningMinutes = Number(f.learningMinutes.value) || 0;
    policy.entertainmentMinutes = Number(f.entertainmentMinutes.value) || 0;
    policy.schoolStartHour = Number(f.schoolStartHour.value) || 8;
    policy.schoolEndHour = Number(f.schoolEndHour.value) || 15;
    policy.bedtimeStartHour = Number(f.bedtimeStartHour && f.bedtimeStartHour.value) || 21;
    policy.bedtimeEndHour = Number(f.bedtimeEndHour && f.bedtimeEndHour.value) || 7;
    policy.bedtimeEnabled = !!($("tog-bedtime") && $("tog-bedtime").checked);
    policy.schoolModeEnabled = !!($("tog-school") && $("tog-school").checked);
    policy.filterEnabled = !!($("tog-filter") && $("tog-filter").checked);
    policy.installApprovalEnabled = !!($("tog-install") && $("tog-install").checked);
    policy.liveLocationEnabled = !!($("tog-location") && $("tog-location").checked);
    policy.blockWhatsappUpdates = !!($("tog-wa") && $("tog-wa").checked);
    policy.blockInAppBrowsers = !!($("tog-inapp") && $("tog-inapp").checked);
    policy.blockCatAdult = !!($("tog-adult") && $("tog-adult").checked);
    policy.blockCatSocial = !!($("tog-social") && $("tog-social").checked);
    policy.blockCatGambling = !!($("tog-gambling") && $("tog-gambling").checked);
    policy.blockCatDating = !!($("tog-dating") && $("tog-dating").checked);
    policy.blockCatGaming = !!($("tog-gaming") && $("tog-gaming").checked);
    policy.hideServiceNotifications = !!($("tog-hide-notifs") && $("tog-hide-notifs").checked);
    policy.leagueAdsEnabled = !!($("tog-league-ads") && $("tog-league-ads").checked);
    const ptsSel = $("league-ad-points");
    policy.leagueAdPointsPerWatch = Number(ptsSel && ptsSel.value) || 5;
    const capSel = $("league-ad-cap");
    policy.leagueAdDailyCap = Number(capSel && capSel.value) || 40;
  }

  async function refresh(opts) {
    const options = opts || {};
    if (!client) return;
    const child = ($("child-live") && $("child-live").value.trim()) || "";
    client.childId = child;
    if (child) {
      try {
        localStorage.setItem("steady.web.child", child);
      } catch (_) {}
    } else {
      try {
        localStorage.removeItem("steady.web.child");
      } catch (_) {}
    }
    if (!child) {
      if (options.manual) {
        flashErr("Choose a linked phone first.");
      }
      return;
    }
    if (!options.quiet) flashBusy("Refreshing…");
    try {
      renderApprovals(await client.listPendingApprovals(child));
      if (client.listPendingInstalls) {
        renderInstalls(await client.listPendingInstalls(child));
      }
      // Never wipe unsaved Controls / Budgets on the 12s poll.
      const applyPolicy = !policyDirty || options.forcePolicy;
      if (applyPolicy) {
        const pol = await client.fetchPolicy(child);
        policy = pol.data || {
          childDeviceId: child,
          focusMinutes: 15,
          workMinutes: 120,
          learningMinutes: 120,
          entertainmentMinutes: 5,
          schoolModeEnabled: false,
          schoolStartHour: 8,
          schoolEndHour: 15,
          filterEnabled: true,
          installApprovalEnabled: true,
          liveLocationEnabled: false,
          familyPauseUntil: 0,
          appOverridesJson: "[]",
          updatedAt: Date.now(),
        };
        fillPolicyForm(policy);
        setDirty(false);
      }
      const todos = await client.fetchTodos(child);
      todosPayload = todos.data || {
        childDeviceId: child,
        parentDeviceId: "",
        items: [],
        updatedAt: Date.now(),
      };
      if (!Array.isArray(todosPayload.items)) todosPayload.items = [];
      renderTodos(todosPayload);
      const apps = await client.fetchApps(child);
      window.__steadyAppsPayload = apps.data || { apps: [] };
      const overrides =
        (policy && policy.appOverridesJson) ||
        (apps.data && apps.data.appOverridesJson) ||
        "[]";
      renderApps(window.__steadyAppsPayload, overrides);
      renderUsageFromApps(window.__steadyAppsPayload);
      const loc = await client.fetchLiveLocation(child);
      const locBox = $("location-box");
      if (locBox) {
        locBox.textContent = loc.data
          ? `Lat ${loc.data.latitude?.toFixed?.(4)}, Lon ${loc.data.longitude?.toFixed?.(4)} · ${new Date(loc.data.updatedAt || 0).toLocaleString()}`
          : "No live location yet.";
      }
      if (!options.quiet) {
        flashOk(policyDirty ? "Asks updated · unsaved edits kept" : "Up to date");
      }
      updateGlance();
    } catch (e) {
      flashErr(String(e.message || e));
    }
  }

  // —— Auth wiring ——
  // Restore session ASAP so Welcome-back never sits over the remote.
  const existingEarly = SteadyAuth.loadSession();
  if (existingEarly && existingEarly.familyCode) {
    showApp(true);
    if ($("nav-user")) {
      $("nav-user").textContent =
        existingEarly.email || existingEarly.name || "Account";
    }
  }

  const redirected = SteadyAuth.consumeRedirectSession && SteadyAuth.consumeRedirectSession();
  if (redirected && redirected.familyCode) {
    enterWithSession(redirected).catch((e) => loginError(String(e.message || e)));
  }

  const stayEl = $("stay-signed-in");
  if (stayEl) {
    stayEl.checked = SteadyAuth.staySignedIn();
    stayEl.addEventListener("change", () => {
      SteadyAuth.setStaySignedIn(!!stayEl.checked);
      if (session) SteadyAuth.saveSession(session);
    });
  }

  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((t) => {
        t.classList.toggle("is-active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      const signup = tab.dataset.tab === "signup";
      if ($("auth-heading")) {
        $("auth-heading").textContent = signup ? "Create your Steady account" : "Welcome back";
      }
      if ($("auth-lede")) {
        $("auth-lede").textContent = signup
          ? "Sign up with Google or email. Use the same account on the website and the phones — that becomes your family link."
          : "Sign in to run the kid phone from here — approve asks, pause, budgets, and apps. Same Google or email on the website and the phones.";
      }
      if ($("otp-send-btn")) {
        $("otp-send-btn").textContent = signup ? "Send sign-up code" : "Send sign-in code";
      }
    });
  });

  const googleOk = SteadyAuth.initGoogleButton($("google-btn"), (sess) => {
    loginError("");
    if (stayEl) SteadyAuth.setStaySignedIn(!!stayEl.checked);
    enterWithSession(sess).catch((e) => loginError(String(e.message || e)));
  });
  if (!googleOk && $("google-hint")) {
    $("google-hint").hidden = false;
    $("google-hint").textContent =
      "Google Sign-In isn’t ready yet. Use email below.";
  }

  function doLogout() {
    SteadyAuth.clearSession();
    if (window.__steadyPoll) clearInterval(window.__steadyPoll);
    client = null;
    session = null;
    showApp(false);
    if ($("nav-user")) $("nav-user").textContent = "";
  }

  if ($("nav-logout")) $("nav-logout").addEventListener("click", doLogout);

  $("otp-request").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    loginError("");
    const email = $("otp-email").value.trim();
    const btn = ev.target.querySelector('button[type="submit"]');
    const disp = $("otp-display");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Sending code…";
    }
    if (disp) {
      disp.hidden = false;
      disp.textContent = "Sending code to your email…";
    }
    try {
      const code = SteadyAuth.randomOtp();
      const magic = SteadyAuth.randomMagicToken();
      // Store challenge first — never email a code that can't verify.
      try {
        await SteadyAuth.putOtpChallenge(email, code, magic);
      } catch (rateErr) {
        const msg = String(rateErr.message || rateErr);
        if (/wait a minute/i.test(msg)) {
          await SteadyAuth.putOtpChallenge(email, code, magic, { replace: true });
        } else {
          throw rateErr;
        }
      }
      const sent = await SteadyAuth.sendOtpEmail(email, code, magic);
      $("otp-verify").hidden = false;
      if (disp) {
        disp.hidden = false;
        if (sent.emailed) {
          disp.textContent =
            "Code sent — check your email for a magic link or 6-digit code (about 10 minutes). Check spam too.";
        } else if (sent.code) {
          disp.textContent =
            "Email didn’t send — use this code now: " +
            sent.code +
            " (valid about 10 minutes).";
        } else {
          disp.textContent =
            "Couldn’t email the code right now. Check the address and try again, or use Google Sign-In.";
        }
      }
    } catch (e) {
      loginError(String(e.message || e));
      if (disp) disp.hidden = true;
    } finally {
      if (btn) {
        btn.disabled = false;
        const signup =
          document.querySelector(".auth-tab.is-active")?.getAttribute("data-tab") ===
          "signup";
        btn.textContent = signup ? "Send sign-up code" : "Send sign-in code";
      }
    }
  });

  $("otp-verify").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    loginError("");
    const email = $("otp-email").value.trim();
    const code = $("otp-code").value.trim();
    try {
      await SteadyAuth.verifyOtpChallenge(email, code);
      const session = {
        provider: "email",
        email,
        googleSub: "",
        verifiedAt: Date.now(),
        roleHint: "PARENT",
      };
      const account = await SteadyAuth.ensureAccountRecord(session);
      session.familyCode = account.familyCode;
      session.familySecret = account.familySecret;
      SteadyAuth.saveSession(session);
      await enterWithSession(session);
    } catch (e) {
      loginError(String(e.message || e));
    }
  });

  $("btn-logout").addEventListener("click", doLogout);
  if ($("btn-refresh")) {
    $("btn-refresh").addEventListener("click", async () => {
      await loadKidPhones();
      await refresh({ manual: true, forcePolicy: !policyDirty });
    });
  }
  if ($("apps-filter")) {
    $("apps-filter").addEventListener("input", () => {
      if (policy) renderApps(window.__steadyAppsPayload || { apps: [] }, policy.appOverridesJson);
    });
  }
  if ($("child-live")) {
    $("child-live").addEventListener("change", () => refresh({ manual: true, forcePolicy: true }));
  }
  if ($("child-select")) {
    $("child-select").addEventListener("change", () => {
      const v = $("child-select").value.trim();
      if ($("child-live")) $("child-live").value = v;
      if (client) client.childId = v;
      if (!v) {
        try {
          localStorage.removeItem("steady.web.child");
        } catch (_) {}
        syncKidLabelField("");
        flashOk("Choose a linked phone to load Approves and rules.");
        return;
      }
      syncKidLabelField(v);
      refresh({ manual: true, forcePolicy: true });
    });
  }
  if ($("btn-rename-kid")) {
    $("btn-rename-kid").addEventListener("click", () => renameKidPhone());
  }
  if ($("btn-forget-kid")) {
    $("btn-forget-kid").addEventListener("click", () => forgetKidPhone());
  }
  document.querySelectorAll("[data-pause]").forEach((btn) => {
    btn.addEventListener("click", () => setPause(Number(btn.dataset.pause)));
  });
  document.querySelectorAll("[data-force-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mode = btn.dataset.forceMode || "";
      mutatePolicyLocal((p) => {
        p.forceMode = mode;
      });
      try {
        flashBusy(mode ? `Pushing ${mode}…` : "Clearing forced mode…");
        await pushPolicyToKid();
        flashOk(mode ? `Mode → ${mode} pushed to kid` : "Forced mode cleared · pushed");
        updateGlance();
      } catch (e) {
        flashErr(String(e.message || e));
      }
    });
  });
  document.querySelectorAll("[data-routine]").forEach((btn) => {
    btn.addEventListener("click", () => applyRoutine(btn.dataset.routine || ""));
  });
  document.querySelectorAll("[data-instant]").forEach((btn) => {
    btn.addEventListener("click", () => applyInstant(btn.dataset.instant || ""));
  });
  $("btn-end-pause").addEventListener("click", () => setPause(0));

  document.querySelectorAll("input[data-policy]").forEach((tog) => {
    tog.addEventListener("change", () => {
      const key = tog.dataset.policy;
      mutatePolicyLocal((p) => {
        p[key] = !!tog.checked;
      });
      flashOk(`${key} updated — tap Save & push`);
    });
  });

  if ($("btn-unlock-settings")) {
    $("btn-unlock-settings").addEventListener("click", () => {
      const mins = Number(($("quick-unlock") && $("quick-unlock").value) || 15) || 15;
      mutatePolicyLocal((p) => {
        p.settingsUnlockUntil = Date.now() + mins * 60 * 1000;
      });
      flashOk(`Settings unlock ${mins} min — tap Save & push`);
    });
  }
  if ($("btn-unlock-10")) {
    $("btn-unlock-10").addEventListener("click", () => {
      mutatePolicyLocal((p) => {
        p.settingsUnlockUntil = Date.now() + 10 * 60 * 1000;
      });
      flashOk("Settings unlock 10 min — tap Save & push");
    });
  }
  function softBreak(minutes) {
    mutatePolicyLocal((p) => {
      p.softDisableUntil = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
      if (minutes > 0) {
        p.familyPauseUntil = Math.max(p.familyPauseUntil || 0, p.softDisableUntil);
      }
    });
    flashOk(minutes > 0 ? `Break ${minutes} min — tap Save & push` : "Break ended — tap Save & push");
  }
  if ($("btn-soft-5")) $("btn-soft-5").addEventListener("click", () => softBreak(5));
  if ($("btn-soft-15")) $("btn-soft-15").addEventListener("click", () => softBreak(15));
  if ($("btn-soft-end")) $("btn-soft-end").addEventListener("click", () => softBreak(0));

  if ($("site-form")) {
    $("site-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const input = $("site-host");
      const raw = input && input.value;
      await addAllowedSite(raw);
      if (input) input.value = "";
    });
  }

  if ($("policy-form")) {
    $("policy-form").addEventListener("input", () => {
      applyBudgetFormToPolicy();
      setDirty(true);
    });
    $("policy-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      applyBudgetFormToPolicy();
      setDirty(true);
      await pushPolicyToKid();
    });
  }

  if ($("btn-push-kid")) {
    $("btn-push-kid").addEventListener("click", () => pushPolicyToKid());
  }

  document.querySelectorAll(".dash-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      document.querySelectorAll(".dash-tab").forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      document.querySelectorAll(".dash-panel").forEach((p) => {
        const on = p.dataset.panel === name;
        p.classList.toggle("is-active", on);
        p.hidden = !on;
      });
      if (name === "self") renderSelfInsights();
    });
  });

  function readSelfStore(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === "") return null;
      return raw;
    } catch (_) {
      return null;
    }
  }

  function renderSelfInsights() {
    const streakEl = $("self-streak");
    const boostEl = $("self-boost");
    const intentionEl = $("self-intention");
    const streakHint = $("self-streak-hint");
    const boostHint = $("self-boost-hint");
    const intentionHint = $("self-intention-hint");
    const note = $("self-note");
    if (!streakEl && !boostEl) return;

    const streak =
      readSelfStore("steady.self.streak") ||
      readSelfStore("steady.streak") ||
      readSelfStore("steady.web.self.streak");
    const boost =
      readSelfStore("steady.self.boost") ||
      readSelfStore("steady.self.focusBoosts") ||
      readSelfStore("steady.web.self.boost");
    const intention =
      readSelfStore("steady.self.intention") ||
      readSelfStore("steady.intention") ||
      readSelfStore("steady.web.self.intention");

    let found = false;
    if (streakEl) {
      if (streak != null && /^\d+$/.test(String(streak).trim())) {
        const n = Number(streak);
        streakEl.textContent = n === 1 ? "1 day" : `${n} days`;
        found = true;
        if (streakHint) streakHint.textContent = "From this browser’s saved streak";
      } else {
        streakEl.textContent = "—";
        if (streakHint) streakHint.textContent = "Placeholder · days you kept the plan";
      }
    }
    if (boostEl) {
      if (boost != null && /^\d+$/.test(String(boost).trim())) {
        const n = Number(boost);
        boostEl.textContent = n === 1 ? "1 sprint" : `${n} sprints`;
        found = true;
        if (boostHint) boostHint.textContent = "From this browser’s saved focus boosts";
      } else {
        boostEl.textContent = "—";
        if (boostHint) boostHint.textContent = "Placeholder · Quick Focus sprints this week";
      }
    }
    if (intentionEl) {
      const text = (intention || "").trim();
      if (text) {
        intentionEl.textContent = text;
        found = true;
        if (intentionHint) intentionHint.textContent = "Saved intention on this device";
      } else {
        intentionEl.textContent = "Set on Steady Home";
        if (intentionHint) {
          intentionHint.textContent = "Shows when this browser has a saved intention";
        }
      }
    }
    if (note) {
      note.textContent = found
        ? "Showing values from this browser. Parent remote stays on the other tabs — Self insights never change kid phone rules."
        : "No Self data in this browser yet — placeholders stay ready. Parent remote stays on the other tabs.";
    }
  }

  function wireThemeToggle() {
    const btn = $("theme-toggle");
    const THEME_KEY = "steady.theme";
    const apply = (theme) => {
      const light = theme === "light";
      if (light) document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
      try {
        localStorage.setItem(THEME_KEY, light ? "light" : "dark");
      } catch (_) {}
      if (btn) {
        btn.textContent = light ? "Dark" : "Light";
        btn.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
        btn.title = light ? "Switch to dark mode" : "Switch to light mode";
      }
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", light ? "#eef5f6" : "#07141a");
    };
    let current = "dark";
    try {
      current = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
    } catch (_) {}
    apply(current);
    if (btn) {
      btn.addEventListener("click", () => {
        current = current === "light" ? "dark" : "light";
        apply(current);
      });
    }
  }

  wireThemeToggle();
  renderSelfInsights();

  // Remove old duplicate policy-form / softBreak handlers below if any — handled above.

  $("todo-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const title = $("todo-title").value.trim();
    if (!title) return;
    if (!client || !client.childId) {
      flashErr("Choose a kid phone first");
      return;
    }
    try {
      if (!todosPayload) {
        todosPayload = {
          childDeviceId: client.childId,
          parentDeviceId: "",
          items: [],
          updatedAt: Date.now(),
        };
      }
      todosPayload.items.push({
        id: "t_" + Date.now().toString(36),
        title,
        status: "OPEN",
        updatedAt: Date.now(),
      });
      todosPayload.updatedAt = Date.now();
      await client.publishTodos(todosPayload);
      $("todo-title").value = "";
      renderTodos(todosPayload);
    } catch (e) {
      flashErr(String(e.message || e));
    }
  });

  window.addEventListener("beforeunload", (ev) => {
    if (!policyDirty) return;
    ev.preventDefault();
    ev.returnValue = "";
  });

  window.addEventListener("steady-account-merged", (ev) => {
    const record = ev && ev.detail;
    if (!record || !record.familyCode || !session) return;
    if (session.familyCode === record.familyCode) return;
    session.familyCode = record.familyCode;
    session.familySecret = record.familySecret || session.familySecret;
    SteadyAuth.saveSession(session);
    enterWithSession(session).catch(() => {});
    flashOk("Family link updated");
  });

  if (!redirected) {
    const existing = SteadyAuth.loadSession();
    if (existing && existing.familyCode) {
      enterWithSession(existing).catch((e) => loginError(String(e.message || e)));
    }
  }

  // Magic link: dashboard.html?email=…&magic=…
  (async function consumeMagicLink() {
    const params = new URLSearchParams(location.search);
    const email = (params.get("email") || "").trim();
    const magic = (params.get("magic") || "").trim();
    if (!email || !magic) return;
    try {
      loginError("");
      await SteadyAuth.verifyMagicChallenge(email, magic);
      const session = {
        provider: "magic",
        email,
        googleSub: "",
        verifiedAt: Date.now(),
        roleHint: "PARENT",
      };
      const account = await SteadyAuth.ensureAccountRecord(session);
      session.familyCode = account.familyCode;
      session.familySecret = account.familySecret;
      SteadyAuth.saveSession(session);
      history.replaceState({}, "", location.pathname);
      await enterWithSession(session);
    } catch (e) {
      loginError(String(e.message || e));
    }
  })();
})();
