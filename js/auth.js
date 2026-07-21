/**
 * Steady account auth — Google Sign-In (GIS) + email OTP (free).
 * SMS OTP is not implemented: carriers charge; no free production SMS.
 */
(function (global) {
  const SESSION_KEY = "steady.web.auth.v1";
  const STAY_KEY = "steady.web.stay.v1";
  const OBF_KEY = "app.steady.android.v1";

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  function deobfuscateToken(hex) {
    if (!hex) return "";
    const key = utf8(OBF_KEY);
    const raw = new Uint8Array(hex.length / 2);
    for (let i = 0; i < raw.length; i++) {
      raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ key[i % key.length];
    return new TextDecoder().decode(out);
  }

  function runtime() {
    return global.STEADY_RUNTIME || {};
  }

  function builtinToken() {
    return deobfuscateToken(runtime().tokenObfHex || "");
  }

  function staySignedIn() {
    const v = localStorage.getItem(STAY_KEY);
    return v !== "0";
  }

  function setStaySignedIn(on) {
    localStorage.setItem(STAY_KEY, on ? "1" : "0");
  }

  function sessionStore() {
    return staySignedIn() ? localStorage : sessionStorage;
  }

  function loadSession() {
    try {
      const raw =
        localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "null";
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function saveSession(s) {
    const store = sessionStore();
    store.setItem(SESSION_KEY, JSON.stringify(s));
    // Clear the other store so stay-signed-in preference is respected.
    if (store === localStorage) sessionStorage.removeItem(SESSION_KEY);
    else localStorage.removeItem(SESSION_KEY);
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", utf8(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function randomOtp() {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    return String(n).padStart(6, "0");
  }

  function familyCodeFromIdentity(emailOrSub) {
    // Stable 8-char A-Z0-9 code from identity
    return sha256Hex(String(emailOrSub).trim().toLowerCase()).then((h) =>
      h
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8)
    );
  }

  async function otpHash(email, code) {
    return sha256Hex(`${email.trim().toLowerCase()}|${code}|steady.otp.v1`);
  }

  function githubClientForSync() {
    const token = builtinToken();
    if (!token) throw new Error("Sync token missing — rebuild site with keys/steady-github.token");
    return new SteadyGithub({
      token,
      repo: runtime().repo || "LabRatKali/steady-sync",
      pairCode: "AUTH",
      familySecret: "",
    });
  }

  async function magicHash(email, magicToken) {
    return sha256Hex(`${email.trim().toLowerCase()}|${magicToken}|steady.magic.v1`);
  }

  function randomMagicToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function putOtpChallenge(email, code, magicToken, opts) {
    const options = opts || {};
    const gh = githubClientForSync();
    const id = (await sha256Hex(email.trim().toLowerCase())).slice(0, 32);
    const path = `auth/email-otp/${id}.json.enc`;
    const now = Date.now();
    const dayKey = new Date().toISOString().slice(0, 10);
    let existing = null;
    try {
      const got = await gh.getDecoded(path);
      if (got.exists) existing = got.data;
    } catch (_) {}
    // Soft rate limit: allow replace within 60s when retrying after a failed send.
    if (
      !options.replace &&
      existing &&
      existing.lastSentAt &&
      now - existing.lastSentAt < 60 * 1000
    ) {
      throw new Error("Wait a minute before requesting another code");
    }
    const prevCount =
      existing && existing.dayKey === dayKey ? existing.sendCountToday || 0 : 0;
    const count = options.replace ? prevCount : prevCount;
    if (!options.replace && count >= 8) {
      throw new Error("Daily email code limit reached for this address");
    }
    if (options.replace && prevCount >= 8) {
      throw new Error("Daily email code limit reached for this address");
    }
    const payload = {
      email: email.trim().toLowerCase(),
      hash: await otpHash(email, code),
      magicHash: magicToken ? await magicHash(email, magicToken) : "",
      expiresAt: now + 10 * 60 * 1000,
      createdAt: (existing && existing.createdAt) || now,
      lastSentAt: now,
      dayKey,
      sendCountToday: options.replace ? Math.max(prevCount, 1) : prevCount + 1,
    };
    await gh.putEncoded(path, payload, "email otp challenge");
    return payload;
  }

  async function verifyOtpChallenge(email, code) {
    const gh = githubClientForSync();
    const id = (await sha256Hex(email.trim().toLowerCase())).slice(0, 32);
    const got = await gh.getDecoded(`auth/email-otp/${id}.json.enc`);
    if (!got.exists || !got.data) throw new Error("No code pending — request a new one");
    if (got.data.expiresAt < Date.now()) throw new Error("Code expired — request a new one");
    const hash = await otpHash(email, code);
    if (hash !== got.data.hash) throw new Error("Wrong code");
    return true;
  }

  async function verifyMagicChallenge(email, magicToken) {
    const gh = githubClientForSync();
    const id = (await sha256Hex(email.trim().toLowerCase())).slice(0, 32);
    const got = await gh.getDecoded(`auth/email-otp/${id}.json.enc`);
    if (!got.exists || !got.data) throw new Error("Magic link invalid");
    if (got.data.expiresAt < Date.now()) throw new Error("Magic link expired");
    if (!got.data.magicHash) throw new Error("Magic link invalid");
    const h = await magicHash(email, magicToken);
    if (h !== got.data.magicHash) throw new Error("Magic link invalid");
    return true;
  }

  function magicLinkBase() {
    const m = runtime().mailer || {};
    const configured = (m.magicLinkBase || "").trim();
    if (configured) return configured;
    if (typeof location !== "undefined" && location.origin) {
      return location.origin.replace(/\/$/, "") + "/dashboard.html";
    }
    return "https://steady.less-phone.workers.dev/dashboard.html";
  }

  async function postMail(payload) {
    const m = runtime().mailer || {};
    const candidates = [];
    const configured = (m.proxyUrl || m.mailProxyUrl || "").trim();
    if (configured) candidates.push(configured);
    if (typeof location !== "undefined" && location.origin) {
      candidates.push(location.origin.replace(/\/$/, "") + "/api/mail");
    }
    candidates.push("https://steady.less-phone.workers.dev/api/mail");

    let lastErr = null;
    const tried = new Set();
    for (const url of candidates) {
      if (!url || tried.has(url)) continue;
      tried.add(url);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) return { ok: true, via: url };
        const text = await res.text();
        lastErr = new Error("Mail proxy " + res.status + ": " + text.slice(0, 120));
        // 404 = worker not deployed on this host — try next
        if (res.status === 404 || res.status === 405) continue;
        // 5xx / 403 from Resend — stop and surface
        if (res.status >= 400 && res.status < 500 && res.status !== 404) {
          throw lastErr;
        }
      } catch (e) {
        lastErr = e;
        // Network / CORS / failed to fetch → try next candidate
      }
    }
    return { ok: false, error: lastErr };
  }

  async function sendOtpEmail(email, code, magicToken) {
    const m = runtime().mailer || {};
    const apiKey = deobfuscateToken(m.apiKeyObfHex || "");
    const fromEmail = m.fromEmail || "";
    const provider = (m.provider || "").toLowerCase();
    const base = magicLinkBase();
    if (!fromEmail || !provider) {
      return { emailed: false, displayed: true, code };
    }
    const magicUrl =
      base +
      "?email=" +
      encodeURIComponent(email) +
      "&magic=" +
      encodeURIComponent(magicToken);
    const html =
      '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">' +
      "<h1>Steady sign-in</h1>" +
      '<p><a href="' +
      magicUrl +
      '" style="background:#3dcf8a;color:#042316;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Sign in to Steady</a></p>' +
      "<p>Or enter this code: <strong style=\"letter-spacing:4px\">" +
      code +
      "</strong></p>" +
      "<p style=\"color:#666;font-size:13px\">Expires in 10 minutes. If you did not ask for this, ignore this email. Steady does not sell data.</p></div>";
    const text =
      "Steady code: " + code + "\nOr open: " + magicUrl + "\nExpires in 10 minutes.";

    // Prefer same-origin / workers mail proxy (browser cannot call Resend directly — CORS).
    if (provider === "resend" || provider === "mailersend") {
      const proxied = await postMail({
        to: email,
        from: fromEmail,
        subject: "Your Steady sign-in code",
        html,
        text,
        provider,
      });
      if (proxied.ok) return { emailed: true, displayed: false, via: "proxy" };
    }

    // Legacy direct call (works in some embeds; usually blocked by CORS in browsers).
    try {
      if (provider === "resend" && apiKey) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [email],
            subject: "Your Steady sign-in code",
            html,
            text,
          }),
        });
        if (res.ok) return { emailed: true, displayed: false, via: "resend-direct" };
      }
    } catch (_) {
      /* CORS / failed to fetch */
    }

    // Always succeed for UX: show the code on screen so sign-in still works.
    return { emailed: false, displayed: true, code };
  }

  async function ensureAccountRecord(session) {
    const gh = githubClientForSync();
    const email = String(session.email || "").trim().toLowerCase();
    const googleSub = String(session.googleSub || "").trim();
    // Email is canonical — Google on the website and email OTP on a kid phone merge.
    const emailKey = email && email.includes("@") ? await sha256Hex(email) : "";
    const subKey = googleSub ? await sha256Hex(googleSub.toLowerCase()) : "";
    let existing = null;
    if (emailKey) {
      try {
        const got = await gh.getDecoded(`accounts/${emailKey.slice(0, 32)}.json.enc`);
        if (got.data && got.data.familyCode) existing = got.data;
      } catch (_) {}
    }
    if (!existing && subKey) {
      try {
        const got = await gh.getDecoded(`accounts/${subKey.slice(0, 32)}.json.enc`);
        if (got.data && got.data.familyCode) existing = got.data;
      } catch (_) {}
    }
    if (existing && existing.familyCode) {
      const merged = Object.assign({}, existing, {
        email: email || existing.email || "",
        googleSub: googleSub || existing.googleSub || "",
        updatedAt: Date.now(),
      });
      await writeAccountAliases(gh, merged);
      return merged;
    }
    const id = email && email.includes("@") ? email : googleSub;
    if (!id) throw new Error("Email or Google account required");
    const familyCode = await familyCodeFromIdentity(id);
    const familySecret = (await sha256Hex(`secret|${id}|steady`)).slice(0, 48);
    const record = {
      email: email || "",
      googleSub: googleSub || "",
      familyCode,
      familySecret,
      roleHint: session.roleHint || "PARENT",
      updatedAt: Date.now(),
    };
    await writeAccountAliases(gh, record);
    try {
      await gh.putEncoded(
        `families/${steadyFamilyFolder(familyCode)}/account.json.enc`,
        {
          familyCode,
          email: record.email,
          googleSub: record.googleSub,
          updatedAt: Date.now(),
        },
        "family account link"
      );
    } catch (_) {}
    return record;
  }

  async function writeAccountAliases(gh, record) {
    const email = String(record.email || "").trim().toLowerCase();
    const googleSub = String(record.googleSub || "").trim();
    const keys = [];
    if (email && email.includes("@")) keys.push((await sha256Hex(email)).slice(0, 32));
    if (googleSub) keys.push((await sha256Hex(googleSub.toLowerCase())).slice(0, 32));
    if (!keys.length) {
      const id = email || googleSub;
      if (id) keys.push((await sha256Hex(id.toLowerCase())).slice(0, 32));
    }
    const unique = Array.from(new Set(keys));
    let wrote = 0;
    let lastErr = null;
    for (const key of unique) {
      try {
        await gh.putEncoded(`accounts/${key}.json.enc`, record, "steady account");
        wrote++;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!wrote && lastErr) {
      // Still allow local sign-in — family code is derived offline; sync can catch up.
      console.warn("Steady account sync deferred:", lastErr);
    }
  }

  const GOOGLE_AUTH_HOST = "labratkali.github.io";
  const GOOGLE_AUTH_PATH = "/steady-web/dashboard.html";

  function needsGoogleHostRedirect() {
    try {
      return location.hostname !== GOOGLE_AUTH_HOST;
    } catch (_) {
      return false;
    }
  }

  function encodeSessionForRedirect(session) {
    const json = JSON.stringify(session);
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function decodeSessionFromRedirect(raw) {
    try {
      let b64 = String(raw || "").replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      return JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch (_) {
      return null;
    }
  }

  /** If we landed with #steady_session=… from Google auth host, restore it. */
  function consumeRedirectSession() {
    const hash = (location.hash || "").replace(/^#/, "");
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const raw = params.get("steady_session");
    if (!raw) return null;
    const session = decodeSessionFromRedirect(raw);
    if (!session || !session.familyCode) return null;
    saveSession(session);
    history.replaceState({}, "", location.pathname + location.search);
    return session;
  }

  function finishGoogleSession(payload, onSignedIn, returnUrl) {
    return (async () => {
      const session = {
        provider: "google",
        email: payload.email || "",
        googleSub: payload.sub || "",
        name: payload.name || "",
        verifiedAt: Date.now(),
        roleHint: "PARENT",
      };
      const account = await ensureAccountRecord(session);
      session.familyCode = account.familyCode;
      session.familySecret = account.familySecret;
      saveSession(session);
      if (returnUrl) {
        const u = new URL(returnUrl);
        u.hash = "steady_session=" + encodeSessionForRedirect(session);
        location.href = u.toString();
        return;
      }
      onSignedIn(session);
    })();
  }

  function initGoogleButton(buttonEl, onSignedIn) {
    const clientId = runtime().googleClientId;
    if (!clientId || clientId.indexOf("REPLACE") >= 0 || !buttonEl) {
      if (buttonEl) buttonEl.hidden = true;
      return false;
    }

    // Google only allows Authorized JS origins. workers.dev is not in the list yet —
    // bounce through github.io (already authorized), then return with the session.
    if (needsGoogleHostRedirect()) {
      const returnTo = location.href.split("#")[0];
      const authUrl =
        "https://" +
        GOOGLE_AUTH_HOST +
        GOOGLE_AUTH_PATH +
        "?google=1&return=" +
        encodeURIComponent(returnTo);
      buttonEl.innerHTML = "";
      const a = document.createElement("a");
      a.className = "btn primary login-submit google-redirect-btn";
      a.href = authUrl;
      a.textContent = "Sign in with Google";
      a.style.textAlign = "center";
      a.style.textDecoration = "none";
      buttonEl.appendChild(a);
      return true;
    }

    const params = new URLSearchParams(location.search);
    const returnUrl = (params.get("return") || "").trim();
    const autoGoogle = params.get("google") === "1";

    const start = () => {
      if (!global.google || !google.accounts || !google.accounts.id) {
        setTimeout(start, 200);
        return;
      }
      google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp) => {
          try {
            const payload = parseJwt(resp.credential);
            await finishGoogleSession(payload, onSignedIn, returnUrl || "");
          } catch (e) {
            const raw = String((e && e.message) || e || "Sign-in failed");
            const friendly = /failed to fetch|network error|Could not reach GitHub/i.test(raw)
              ? "Could not finish sign-in (network). Disable ad-block for labratkali.github.io, check Wi‑Fi, then try Google again."
              : raw;
            alert(friendly);
          }
        },
      });
      google.accounts.id.renderButton(buttonEl, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "signin_with",
        width: 280,
      });
      if (autoGoogle) {
        // Prompt One Tap / focus the rendered button for return-flow users.
        try {
          google.accounts.id.prompt();
        } catch (_) {}
      }
    };
    start();
    return true;
  }

  function parseJwt(token) {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  }

  global.SteadyAuth = {
    builtinToken,
    runtime,
    loadSession,
    saveSession,
    clearSession,
    staySignedIn,
    setStaySignedIn,
    randomOtp,
    randomMagicToken,
    putOtpChallenge,
    verifyOtpChallenge,
    verifyMagicChallenge,
    sendOtpEmail,
    ensureAccountRecord,
    initGoogleButton,
    consumeRedirectSession,
    familyCodeFromIdentity,
  };
})(window);
