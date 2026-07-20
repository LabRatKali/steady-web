(function () {
  const STORAGE_KEY = "steady.web.dashboard.v1";
  const DURATIONS = [
    { label: "5m", mins: 5 },
    { label: "15m", mins: 15 },
    { label: "30m", mins: 30 },
    { label: "1h", mins: 60 },
    { label: "Always", mins: -1 },
    { label: "As asked", mins: null },
  ];

  let client = null;
  let policy = null;
  let todosPayload = null;
  let appsPayload = null;

  const $ = (id) => document.getElementById(id);
  const status = (msg) => {
    const el = $("status");
    if (el) el.textContent = msg || "";
  };

  function loadSaved() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function saveSession(data) {
    if ($("remember").checked) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function showApp(on) {
    $("gate").hidden = on;
    $("app").hidden = !on;
  }

  function fillPolicyForm(p) {
    const f = $("policy-form");
    if (!f || !p) return;
    f.focusMinutes.value = p.focusMinutes ?? 15;
    f.workMinutes.value = p.workMinutes ?? 120;
    f.learningMinutes.value = p.learningMinutes ?? 120;
    f.entertainmentMinutes.value = p.entertainmentMinutes ?? 5;
    f.schoolModeEnabled.checked = !!p.schoolModeEnabled;
    f.schoolStartHour.value = p.schoolStartHour ?? 8;
    f.schoolEndHour.value = p.schoolEndHour ?? 15;
    f.filterEnabled.checked = p.filterEnabled !== false;
    f.installApprovalEnabled.checked = p.installApprovalEnabled !== false;
    f.liveLocationEnabled.checked = !!p.liveLocationEnabled;
    f.settingsUnlockMins.value = 0;
    const until = p.familyPauseUntil || 0;
    const pauseEl = $("pause-state");
    if (pauseEl) {
      if (until > Date.now()) {
        const mins = Math.ceil((until - Date.now()) / 60000);
        pauseEl.textContent = `Paused — about ${mins} min left`;
      } else {
        pauseEl.textContent = "Not paused";
      }
    }
  }

  function renderApprovals(list) {
    const box = $("approvals-list");
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<p class="muted">No pending asks.</p>';
      return;
    }
    box.innerHTML = "";
    list.forEach((req) => {
      const div = document.createElement("div");
      div.className = "dash-item";
      const title = req.message || req.kind || "Ask";
      div.innerHTML = `<strong>${escapeHtml(title)}</strong>
        <span class="muted">${escapeHtml(req.kind || "FUN")} · asked ${req.requestedMinutes || "?"} min · ${escapeHtml(req.childDeviceId || "")}</span>`;
      const btns = document.createElement("div");
      btns.className = "approve-btns";
      DURATIONS.forEach((d) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn ghost";
        b.textContent = d.label;
        b.addEventListener("click", () => onDecide(req, true, d.mins));
        btns.appendChild(b);
      });
      const deny = document.createElement("button");
      deny.type = "button";
      deny.className = "btn ghost";
      deny.textContent = "Deny";
      deny.addEventListener("click", () => onDecide(req, false, 0));
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
      div.innerHTML = `<strong>${done ? "✓ " : ""}${escapeHtml(item.title || item.text || "To-do")}</strong>
        <span class="muted">${escapeHtml(item.status || "OPEN")}</span>`;
      if (!done) {
        const row = document.createElement("div");
        row.className = "approve-btns";
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "btn ghost";
        approve.textContent = "Mark done";
        approve.addEventListener("click", () => markTodo(item.id, "DONE"));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn ghost";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => removeTodo(item.id));
        row.appendChild(approve);
        row.appendChild(remove);
        div.appendChild(row);
      }
      box.appendChild(div);
    });
  }

  function renderApps(payload, overrides) {
    const box = $("apps-list");
    if (!box) return;
    const apps = (payload && payload.apps) || (payload && payload.items) || [];
    if (!apps.length) {
      box.innerHTML = '<p class="muted">No inventory yet — open Steady on the kid phone.</p>';
      return;
    }
    const overrideMap = parseOverrides(overrides);
    box.innerHTML = "";
    apps.slice(0, 80).forEach((app) => {
      const pkg = app.packageName || app.pkg || "";
      const label = app.label || pkg;
      const div = document.createElement("div");
      div.className = "dash-item";
      const cur = overrideMap[pkg] || app.category || "";
      div.innerHTML = `<strong>${escapeHtml(label)}</strong><span class="muted">${escapeHtml(pkg)} · ${escapeHtml(cur)}</span>`;
      const row = document.createElement("div");
      row.className = "approve-btns";
      ["ALWAYS_ALLOWED", "BLOCKED", "ENTERTAINMENT"].forEach((cat) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn ghost";
        b.textContent =
          cat === "ALWAYS_ALLOWED" ? "Always" : cat === "BLOCKED" ? "Never" : "Fun";
        b.addEventListener("click", () => setAppOverride(pkg, cat));
        row.appendChild(b);
      });
      div.appendChild(row);
      box.appendChild(div);
    });
  }

  function parseOverrides(raw) {
    if (!raw) return {};
    try {
      const arr = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
      const map = {};
      (arr || []).forEach((o) => {
        if (o && o.packageName) map[o.packageName] = o.category || "";
      });
      return map;
    } catch (_) {
      return {};
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function onDecide(req, approve, minutes) {
    try {
      status(approve ? "Publishing approve…" : "Publishing deny…");
      const mins =
        minutes === null || minutes === undefined
          ? req.requestedMinutes || 5
          : minutes;
      await client.decideApproval(req, approve, mins);
      status(approve ? "Approved — kid will pick it up on Refresh / poll." : "Denied.");
      await refresh();
    } catch (e) {
      status(String(e.message || e));
    }
  }

  async function patchPolicy(mutator) {
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
    if (client.parentId) policy.parentDeviceId = client.parentId;
    await client.publishPolicy(policy);
  }

  async function setPause(minutes) {
    try {
      status("Updating pause…");
      await patchPolicy((p) => {
        p.familyPauseUntil =
          minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
      });
      status(minutes > 0 ? `Paused ${minutes} min` : "Pause ended");
      await refresh();
    } catch (e) {
      status(String(e.message || e));
    }
  }

  async function setAppOverride(pkg, category) {
    try {
      status("Saving app rule…");
      await patchPolicy((p) => {
        let arr = [];
        try {
          arr = JSON.parse(p.appOverridesJson || "[]");
        } catch (_) {
          arr = [];
        }
        if (!Array.isArray(arr)) arr = [];
        arr = arr.filter((o) => o.packageName !== pkg);
        arr.push({ packageName: pkg, category, userSerial: 0 });
        p.appOverridesJson = JSON.stringify(arr);
      });
      status("App rule sent");
      await refresh();
    } catch (e) {
      status(String(e.message || e));
    }
  }

  async function markTodo(id, statusName) {
    if (!todosPayload) return;
    todosPayload.items = (todosPayload.items || []).map((t) =>
      t.id === id ? Object.assign({}, t, { status: statusName }) : t
    );
    todosPayload.updatedAt = Date.now();
    await client.publishTodos(todosPayload);
    renderTodos(todosPayload);
    status("To-do updated");
  }

  async function removeTodo(id) {
    if (!todosPayload) return;
    todosPayload.items = (todosPayload.items || []).filter((t) => t.id !== id);
    todosPayload.updatedAt = Date.now();
    await client.publishTodos(todosPayload);
    renderTodos(todosPayload);
    status("To-do removed");
  }

  async function refresh() {
    if (!client) return;
    status("Refreshing…");
    try {
      const approvals = await client.listPendingApprovals(client.childId);
      renderApprovals(approvals);

      const pol = await client.fetchPolicy(client.childId);
      policy = pol.data || {
        childDeviceId: client.childId,
        parentDeviceId: client.parentId || "",
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

      const todos = await client.fetchTodos(client.childId);
      todosPayload = todos.data || {
        childDeviceId: client.childId,
        items: [],
        updatedAt: Date.now(),
      };
      if (!Array.isArray(todosPayload.items)) todosPayload.items = [];
      renderTodos(todosPayload);

      const apps = await client.fetchApps(client.childId);
      appsPayload = apps.data;
      renderApps(appsPayload, policy.appOverridesJson);

      const loc = await client.fetchLiveLocation(client.childId);
      const locBox = $("location-box");
      if (locBox) {
        if (loc.data) {
          const d = loc.data;
          locBox.innerHTML = `Lat ${d.latitude?.toFixed?.(4)}, Lon ${d.longitude?.toFixed?.(4)} · accuracy ${d.accuracyMeters || "?"}m · battery ${d.batteryPct ?? "?"} · ${new Date(d.updatedAt || 0).toLocaleString()}`;
        } else {
          locBox.textContent = "No live location yet (enable on parent rules + kid).";
        }
      }

      $("session-meta").textContent = `${client.repo} · family ${client.pairCode} · child ${client.childId}`;
      status("Up to date");
    } catch (e) {
      status(String(e.message || e));
    }
  }

  function start(cfg) {
    client = new SteadyGithub({
      token: cfg.pat,
      repo: cfg.repo,
      pairCode: cfg.pair,
      familySecret: cfg.secret,
    });
    client.childId = cfg.child;
    client.parentId = cfg.parent || "";
    showApp(true);
    refresh();
    if (window.__steadyPoll) clearInterval(window.__steadyPoll);
    window.__steadyPoll = setInterval(refresh, 15000);
  }

  $("login-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const err = $("login-error");
    err.hidden = true;
    const cfg = {
      pat: $("pat").value.trim(),
      repo: $("repo").value.trim(),
      pair: $("pair").value.trim(),
      secret: $("secret").value.trim(),
      child: $("child").value.trim(),
      parent: $("parent").value.trim(),
    };
    if (!cfg.pat || !cfg.pair || !cfg.child) {
      err.textContent = "PAT, family code, and child device ID are required.";
      err.hidden = false;
      return;
    }
    saveSession(cfg);
    start(cfg);
  });

  $("btn-logout").addEventListener("click", () => {
    clearSession();
    if (window.__steadyPoll) clearInterval(window.__steadyPoll);
    client = null;
    showApp(false);
  });

  $("btn-refresh").addEventListener("click", () => refresh());

  document.querySelectorAll("[data-pause]").forEach((btn) => {
    btn.addEventListener("click", () => setPause(Number(btn.dataset.pause)));
  });
  $("btn-end-pause").addEventListener("click", () => setPause(0));

  $("policy-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try {
      status("Sending rules…");
      await patchPolicy((p) => {
        p.focusMinutes = Number(f.focusMinutes.value) || 0;
        p.workMinutes = Number(f.workMinutes.value) || 0;
        p.learningMinutes = Number(f.learningMinutes.value) || 0;
        p.entertainmentMinutes = Number(f.entertainmentMinutes.value) || 0;
        p.schoolModeEnabled = f.schoolModeEnabled.checked;
        p.schoolStartHour = Number(f.schoolStartHour.value) || 8;
        p.schoolEndHour = Number(f.schoolEndHour.value) || 15;
        p.filterEnabled = f.filterEnabled.checked;
        p.installApprovalEnabled = f.installApprovalEnabled.checked;
        p.liveLocationEnabled = f.liveLocationEnabled.checked;
        const unlockMins = Number(f.settingsUnlockMins.value) || 0;
        p.settingsUnlockUntil =
          unlockMins > 0 ? Date.now() + unlockMins * 60 * 1000 : 0;
      });
      status("Rules sent to kid phone");
      await refresh();
    } catch (e) {
      status(String(e.message || e));
    }
  });

  $("todo-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const title = $("todo-title").value.trim();
    if (!title) return;
    try {
      if (!todosPayload) {
        todosPayload = {
          childDeviceId: client.childId,
          items: [],
          updatedAt: Date.now(),
        };
      }
      todosPayload.childDeviceId = client.childId;
      todosPayload.items = todosPayload.items || [];
      todosPayload.items.push({
        id: "t_" + Date.now().toString(36),
        title,
        status: "OPEN",
        createdAt: Date.now(),
      });
      todosPayload.updatedAt = Date.now();
      await client.publishTodos(todosPayload);
      $("todo-title").value = "";
      renderTodos(todosPayload);
      status("To-do added");
    } catch (e) {
      status(String(e.message || e));
    }
  });

  const saved = loadSaved();
  if (saved && saved.pat && saved.pair && saved.child) {
    $("pat").value = saved.pat;
    $("repo").value = saved.repo || "LabRatKali/steady-sync";
    $("pair").value = saved.pair;
    $("secret").value = saved.secret || "";
    $("child").value = saved.child;
    $("parent").value = saved.parent || "";
    start(saved);
  }
})();
