(function () {
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
  let session = null;

  const $ = (id) => document.getElementById(id);
  const status = (msg) => {
    const el = $("status");
    if (el) el.textContent = msg || "";
  };
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
    $("gate").hidden = on;
    $("app").hidden = !on;
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
    const child = ($("child-live") && $("child-live").value.trim()) || localStorage.getItem("steady.web.child") || "";
    client = buildClient({
      pair: sess.familyCode,
      secret: sess.familySecret,
      child,
      parent: "",
    });
    if ($("child-live")) $("child-live").value = child;
    showApp(true);
    $("session-meta").textContent = `${sess.email || sess.googleSub || "signed in"} · family ${sess.familyCode}`;
    await loadKidPhones();
    await refresh();
    if (window.__steadyPoll) clearInterval(window.__steadyPoll);
    window.__steadyPoll = setInterval(refresh, 15000);
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
    setToggle("tog-school", !!p.schoolModeEnabled);
    setToggle("tog-filter", p.filterEnabled !== false);
    setToggle("tog-install", p.installApprovalEnabled !== false);
    setToggle("tog-location", !!p.liveLocationEnabled);
    const until = p.familyPauseUntil || 0;
    const pauseEl = $("pause-state");
    if (pauseEl) {
      pauseEl.textContent =
        until > Date.now()
          ? `Paused — about ${Math.ceil((until - Date.now()) / 60000)} min left`
          : "Not paused";
    }
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
      div.innerHTML = `<strong>${escapeHtml(req.message || req.kind || "Ask")}</strong>
        <span class="muted">${escapeHtml(req.kind || "FUN")} · ${req.requestedMinutes || "?"} min</span>`;
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
          todosPayload.items = todosPayload.items.map((t) =>
            t.id === item.id ? Object.assign({}, t, { status: "DONE" }) : t
          );
          todosPayload.updatedAt = Date.now();
          await client.publishTodos(todosPayload);
          renderTodos(todosPayload);
        });
        row.appendChild(approve);
        div.appendChild(row);
      }
      box.appendChild(div);
    });
  }

  function renderApps(payload, overrides) {
    const box = $("apps-list");
    if (!box) return;
    const apps = (payload && payload.apps) || [];
    if (!apps.length) {
      box.innerHTML = '<p class="muted">No inventory yet — open Steady on the kid phone.</p>';
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
    box.innerHTML = "";
    apps.slice(0, 80).forEach((app) => {
      const pkg = app.packageName || "";
      const div = document.createElement("div");
      div.className = "dash-item";
      div.innerHTML = `<strong>${escapeHtml(app.label || pkg)}</strong>
        <span class="muted">${escapeHtml(pkg)} · ${escapeHtml(map[pkg] || app.category || "")}</span>`;
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

  async function onDecide(req, approve, minutes) {
    try {
      status(approve ? "Publishing approve…" : "Publishing deny…");
      const mins =
        minutes === null || minutes === undefined
          ? req.requestedMinutes || 5
          : minutes;
      await client.decideApproval(req, approve, mins);
      status(approve ? "Approved" : "Denied");
      await refresh();
    } catch (e) {
      status(String(e.message || e));
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
    try {
      status("Updating pause…");
      await patchPolicy((p) => {
        p.familyPauseUntil = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
      });
      status(minutes > 0 ? `Paused ${minutes} min` : "Pause ended");
      await refresh();
    } catch (e) {
      status(String(e.message || e));
    }
  }

  async function setAppOverride(pkg, category) {
    try {
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
      status("App rule sent");
      await refresh();
    } catch (e) {
      status(String(e.message || e));
    }
  }

  async function refresh() {
    if (!client) return;
    const child = ($("child-live") && $("child-live").value.trim()) || "";
    client.childId = child;
    if (child) localStorage.setItem("steady.web.child", child);
    if (!child) {
      status("Enter the kid device ID to load Approves / policy (Parent home shows it).");
      return;
    }
    status("Refreshing…");
    try {
      renderApprovals(await client.listPendingApprovals(child));
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
      renderApps(apps.data, policy.appOverridesJson);
      const loc = await client.fetchLiveLocation(child);
      const locBox = $("location-box");
      if (locBox) {
        locBox.textContent = loc.data
          ? `Lat ${loc.data.latitude?.toFixed?.(4)}, Lon ${loc.data.longitude?.toFixed?.(4)} · ${new Date(loc.data.updatedAt || 0).toLocaleString()}`
          : "No live location yet.";
      }
      status("Up to date");
    } catch (e) {
      status(String(e.message || e));
    }
  }

  // —— Auth wiring ——
  const googleOk = SteadyAuth.initGoogleButton($("google-btn"), (sess) => {
    loginError("");
    enterWithSession(sess).catch((e) => loginError(String(e.message || e)));
  });
  if (!googleOk) {
    $("google-hint").hidden = false;
  }

  $("otp-request").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    loginError("");
    const email = $("otp-email").value.trim();
    try {
      const code = SteadyAuth.randomOtp();
      const magic = SteadyAuth.randomMagicToken();
      await SteadyAuth.putOtpChallenge(email, code, magic);
      const sent = await SteadyAuth.sendOtpEmail(email, code, magic);
      $("otp-verify").hidden = false;
      const disp = $("otp-display");
      disp.hidden = false;
      if (sent.emailed) {
        disp.textContent =
          "Check your email for a magic link or 6-digit code (10 min). Spam folder too.";
      } else {
        disp.textContent =
          "Mailer not configured yet. Your code: " +
          code +
          " — add keys/mailer.json (Resend recommended) and republish to email codes.";
      }
    } catch (e) {
      loginError(String(e.message || e));
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

  $("pat-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const cfg = {
        pat: $("pat").value.trim(),
        pair: $("pair").value.trim(),
        secret: $("secret").value.trim(),
        child: $("child").value.trim(),
      };
      if (!cfg.pair) throw new Error("Family code required");
      session = {
        provider: "pat",
        email: "",
        familyCode: cfg.pair,
        familySecret: cfg.secret || cfg.pair,
      };
      client = buildClient(cfg);
      if ($("child-live")) $("child-live").value = cfg.child || "";
      showApp(true);
      await refresh();
    } catch (e) {
      loginError(String(e.message || e));
    }
  });

  $("btn-logout").addEventListener("click", () => {
    SteadyAuth.clearSession();
    if (window.__steadyPoll) clearInterval(window.__steadyPoll);
    client = null;
    session = null;
    showApp(false);
  });
  $("btn-refresh").addEventListener("click", async () => {
    await loadKidPhones();
    await refresh();
  });
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
  $("btn-end-pause").addEventListener("click", () => setPause(0));

  document.querySelectorAll("#mode-toggles input[data-policy]").forEach((tog) => {
    tog.addEventListener("change", async () => {
      const key = tog.dataset.policy;
      try {
        status(`Updating ${key}…`);
        await patchPolicy((p) => {
          p[key] = !!tog.checked;
        });
        status(tog.checked ? `${key} on` : `${key} off`);
        await refresh();
      } catch (e) {
        tog.checked = !tog.checked;
        status(String(e.message || e));
      }
    });
  });

  if ($("btn-unlock-settings")) {
    $("btn-unlock-settings").addEventListener("click", async () => {
      const mins = Number(($("quick-unlock") && $("quick-unlock").value) || 15) || 15;
      try {
        status("Unlocking Settings…");
        await patchPolicy((p) => {
          p.settingsUnlockUntil = Date.now() + mins * 60 * 1000;
        });
        status(`Settings unlock for ${mins} min`);
        await refresh();
      } catch (e) {
        status(String(e.message || e));
      }
    });
  }

  $("policy-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await patchPolicy((p) => {
        p.focusMinutes = Number(f.focusMinutes.value) || 0;
        p.workMinutes = Number(f.workMinutes.value) || 0;
        p.learningMinutes = Number(f.learningMinutes.value) || 0;
        p.entertainmentMinutes = Number(f.entertainmentMinutes.value) || 0;
        p.schoolStartHour = Number(f.schoolStartHour.value) || 8;
        p.schoolEndHour = Number(f.schoolEndHour.value) || 15;
        p.schoolModeEnabled = !!($("tog-school") && $("tog-school").checked);
        p.filterEnabled = !!($("tog-filter") && $("tog-filter").checked);
        p.installApprovalEnabled = !!($("tog-install") && $("tog-install").checked);
        p.liveLocationEnabled = !!($("tog-location") && $("tog-location").checked);
      });
      status("Budgets sent to kid");
      await refresh();
    } catch (e) {
      status(String(e.message || e));
    }
  });

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

  const existing = SteadyAuth.loadSession();
  if (existing && existing.familyCode) {
    enterWithSession(existing).catch((e) => loginError(String(e.message || e)));
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
