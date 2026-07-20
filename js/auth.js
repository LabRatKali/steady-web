/**
 * Steady account auth — Google Sign-In (GIS) + email OTP (free).
 * SMS OTP is not implemented: carriers charge; no free production SMS.
 */
(function (global) {
  const SESSION_KEY = "steady.web.auth.v1";
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

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function saveSession(s) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
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

  async function putOtpChallenge(email, code, magicToken) {
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
    if (existing && existing.lastSentAt && now - existing.lastSentAt < 60 * 1000) {
      throw new Error("Wait a minute before requesting another code");
    }
    const count =
      existing && existing.dayKey === dayKey ? existing.sendCountToday || 0 : 0;
    if (count >= 8) {
      throw new Error("Daily email code limit reached for this address");
    }
    const payload = {
      email: email.trim().toLowerCase(),
      hash: await otpHash(email, code),
      magicHash: magicToken ? await magicHash(email, magicToken) : "",
      expiresAt: now + 10 * 60 * 1000,
      createdAt: now,
      lastSentAt: now,
      dayKey,
      sendCountToday: count + 1,
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

  async function sendOtpEmail(email, code, magicToken) {
    const m = runtime().mailer || {};
    const apiKey = deobfuscateToken(m.apiKeyObfHex || "");
    const fromEmail = m.fromEmail || "";
    const provider = (m.provider || "").toLowerCase();
    const base = m.magicLinkBase || "https://labratkali.github.io/steady-web/dashboard.html";
    if (!apiKey || !fromEmail || !provider) {
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

    if (provider === "resend") {
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
      if (!res.ok) throw new Error("Resend failed: " + (await res.text()).slice(0, 120));
      return { emailed: true, displayed: false };
    }

    if (provider === "mailersend") {
      const fromAddr = (fromEmail.match(/<([^>]+)>/) || [])[1] || fromEmail;
      const fromName = fromEmail.replace(/<[^>]+>/, "").trim() || "Steady";
      const res = await fetch("https://api.mailersend.com/v1/email", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: { email: fromAddr, name: fromName },
          to: [{ email }],
          subject: "Your Steady sign-in code",
          html,
          text,
        }),
      });
      if (!res.ok) throw new Error("MailerSend failed: " + (await res.text()).slice(0, 120));
      return { emailed: true, displayed: false };
    }

    return { emailed: false, displayed: true, code };
  }

  async function ensureAccountRecord(session) {
    const gh = githubClientForSync();
    const key = await sha256Hex(
      (session.googleSub || session.email || "").toLowerCase()
    );
    const path = `accounts/${key.slice(0, 32)}.json.enc`;
    const existing = await gh.getDecoded(path);
    if (existing.data && existing.data.familyCode) {
      return existing.data;
    }
    const familyCode = await familyCodeFromIdentity(
      session.googleSub || session.email
    );
    const familySecret =
      (await sha256Hex(`secret|${session.googleSub || session.email}|steady`)).slice(
        0,
        48
      );
    const record = {
      email: session.email || "",
      googleSub: session.googleSub || "",
      familyCode,
      familySecret,
      roleHint: session.roleHint || "PARENT",
      updatedAt: Date.now(),
    };
    await gh.putEncoded(path, record, "steady account");
    // Seed family folder README so paths exist
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

  function initGoogleButton(buttonEl, onSignedIn) {
    const clientId = runtime().googleClientId;
    if (!clientId || clientId.indexOf("REPLACE") >= 0 || !buttonEl) {
      if (buttonEl) buttonEl.hidden = true;
      return false;
    }
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
            onSignedIn(session);
          } catch (e) {
            alert(String(e.message || e));
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
    randomOtp,
    randomMagicToken,
    putOtpChallenge,
    verifyOtpChallenge,
    verifyMagicChallenge,
    sendOtpEmail,
    ensureAccountRecord,
    initGoogleButton,
    familyCodeFromIdentity,
  };
})(window);
