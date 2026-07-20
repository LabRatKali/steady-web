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
    setToggle("tog-hide-notifs", !!p.hideServiceNotifications);
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
      const current = ($("child-live") && $("child-live").value.trim()) || "";
      sel.innerHTML = '<option value="">Choose a linked phone…</option>';
      (phones || []).forEach((ph) => {
        const id = ph.deviceId || ph.childDeviceId || ph.id || "";
        if (!id) return;
        const opt = document.createElement("option");
        opt.value = id;
        const role = ph.role || ph.mode || "kid";
        const label = ph.label || ph.name || id;
        opt.textContent = `${label} (${role})`;
        if (id === current) opt.selected = true;
        sel.appendChild(opt);
      });
      if (!current && phones && phones.length === 1) {
        const only =
          phones[0].deviceId || phones[0].childDeviceId || phones[0].id || "";
        if (only && $("child-live")) {
          $("child-live").value = only;
          sel.value = only;
        }
      }
    } catch (_) {
      /* phones folder may be empty until kid links */
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
      case "GATE":
      case "SETTINGS":
      case "CATEGORIES":
        return "Unlock";
      default:
        return "Fun";
    }
  }

  function renderApprovals(list) {
    pendingApprovals = Array.isArray(list) ? list.slice() : [];
    const box = $("approvals-list");
    if (!box) return;
    if (!pendingApprovals.length) {
      box.innerHTML = '<p class="muted">No pending asks.</p>';
      return;
    }
    box.innerHTML = "";
    pendingApprovals.forEach((req) => {
      const div = document.createElement("div");
      div.className = "dash-item";
      div.dataset.reqId = req.id || "";
      const kind = kindLabel(req.kind);
      div.innerHTML = `<strong>${escapeHtml(req.message || req.kind || "Ask")}</strong>
        <span class="muted">${escapeHtml(kind)} · ${req.requestedMinutes || "?"} min</span>`;
      const btns = document.createElement("div");
      btns.className = "approve-btns";
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
      const deny = document.createElement("button");
      deny.type = "button";
      deny.className = "btn ghost";
      deny.textContent = "Deny";
      deny.addEventListener("click", (ev) => {
        ev.preventDefault();
        onDecide(req, false, 0, deny);
      });
      btns.appendChild(deny);
      div.appendChild(btns);
      box.appendChild(div);
    });
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
      div.innerHTML = `<strong>${escapeHtml(app.label || pkg)}</strong>
        <span class="muted">${escapeHtml(pkg)} · ${escapeHtml(cat)}</span>`;
      const row = document.createElement("div");
      row.className = "approve-btns";
      [
        { cat: "ALWAYS_ALLOWED", label: "Always" },
        { cat: "FOCUS", label: "Focus" },
        { cat: "WORK", label: "Work" },
        { cat: "LEARNING", label: "Learn" },
        { cat: "ENTERTAINMENT", label: "Fun" },
        { cat: "BLOCKED", label: "Never" },
      ].forEach((opt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn ghost" + (cat === opt.cat ? " primary" : "");
        b.textContent = opt.label;
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
      flashBusy(approve ? "Sending approve…" : "Sending deny…");
      const mins =
        minutes === null || minutes === undefined
          ? req.requestedMinutes || 5
          : minutes;
      // Optimistic: drop from local list immediately so UI feels instant.
      pendingApprovals = pendingApprovals.filter((r) => r.id !== req.id);
      if (card) card.remove();
      if (!pendingApprovals.length && box) {
        box.innerHTML = '<p class="muted">No pending asks.</p>';
      }
      await client.decideApproval(req, approve, mins);
      // Website Always-allow: also push into policy so DNS / apps update without waiting.
      if (approve && mins < 0) {
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
      flashOk(approve ? "Approved · sent to kid" : "Denied · sent to kid");
    } catch (e) {
      flashErr(String(e.message || e));
      // Put it back on next refresh
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
      flashOk("Full profile pushed — kid should tap Refresh");
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
  }

  async function refresh() {
    if (!client) return;
    const child = ($("child-live") && $("child-live").value.trim()) || "";
    client.childId = child;
    if (child) localStorage.setItem("steady.web.child", child);
    if (!child) {
      flashErr("Enter the kid device ID to load Approves / policy.");
      return;
    }
      flashBusy("Refreshing…");
      try {
      renderApprovals(await client.listPendingApprovals(child));
      if (client.listPendingInstalls) {
        renderInstalls(await client.listPendingInstalls(child));
      }
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
      renderApps(window.__steadyAppsPayload, policy.appOverridesJson);
      const loc = await client.fetchLiveLocation(child);
      const locBox = $("location-box");
      if (locBox) {
        locBox.textContent = loc.data
          ? `Lat ${loc.data.latitude?.toFixed?.(4)}, Lon ${loc.data.longitude?.toFixed?.(4)} · ${new Date(loc.data.updatedAt || 0).toLocaleString()}`
          : "No live location yet.";
      }
      flashOk("Up to date");
      setDirty(false);
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
    if (btn) btn.disabled = true;
    try {
      const code = SteadyAuth.randomOtp();
      const magic = SteadyAuth.randomMagicToken();
      const sent = await SteadyAuth.sendOtpEmail(email, code, magic);
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
      $("otp-verify").hidden = false;
      const disp = $("otp-display");
      disp.hidden = false;
      if (sent.emailed) {
        disp.textContent =
          "Check your email for a magic link or 6-digit code (about 10 minutes). Check spam too.";
      } else {
        disp.innerHTML =
          "Your sign-in code is <strong style=\"letter-spacing:0.2em\">" +
          code +
          "</strong> — type it below to continue.";
      }
    } catch (e) {
      loginError(String(e.message || e));
    } finally {
      if (btn) btn.disabled = false;
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
      await refresh();
    });
  }
  if ($("apps-filter")) {
    $("apps-filter").addEventListener("input", () => {
      if (policy) renderApps(window.__steadyAppsPayload || { apps: [] }, policy.appOverridesJson);
    });
  }
  if ($("child-live")) {
    $("child-live").addEventListener("change", () => refresh());
  }
  if ($("child-select")) {
    $("child-select").addEventListener("change", () => {
      const v = $("child-select").value.trim();
      if ($("child-live") && v) $("child-live").value = v;
      refresh();
    });
  }
  document.querySelectorAll("[data-pause]").forEach((btn) => {
    btn.addEventListener("click", () => setPause(Number(btn.dataset.pause)));
  });
  document.querySelectorAll("[data-force-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.forceMode || "";
      mutatePolicyLocal((p) => {
        p.forceMode = mode;
      });
      flashOk(mode ? `Mode → ${mode} — tap Save & push` : "Forced mode cleared — tap Save & push");
    });
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
    });
  });

  // Remove old duplicate policy-form / softBreak handlers below if any — handled above.

  $("todo-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const title = $("todo-title").value.trim();
    if (!title || !client.childId) return;
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
      status(String(e.message || e));
    }
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
