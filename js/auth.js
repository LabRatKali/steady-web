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

  async function putOtpChallenge(email, code) {
    const gh = githubClientForSync();
    const id = await sha256Hex(email.trim().toLowerCase());
    const hash = await otpHash(email, code);
    const payload = {
      email: email.trim().toLowerCase(),
      hash,
      expiresAt: Date.now() + 10 * 60 * 1000,
      createdAt: Date.now(),
    };
    await gh.putEncoded(
      `auth/email-otp/${id.slice(0, 32)}.json.enc`,
      payload,
      "email otp challenge"
    );
    return payload;
  }

  async function verifyOtpChallenge(email, code) {
    const gh = githubClientForSync();
    const id = await sha256Hex(email.trim().toLowerCase());
    const got = await gh.getDecoded(`auth/email-otp/${id.slice(0, 32)}.json.enc`);
    if (!got.exists || !got.data) throw new Error("No code pending — request a new one");
    if (got.data.expiresAt < Date.now()) throw new Error("Code expired — request a new one");
    const hash = await otpHash(email, code);
    if (hash !== got.data.hash) throw new Error("Wrong code");
    return true;
  }

  async function sendOtpEmail(email, code) {
    const ej = runtime().emailjs || {};
    if (ej.serviceId && ej.templateId && ej.publicKey) {
      const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: ej.serviceId,
          template_id: ej.templateId,
          user_id: ej.publicKey,
          template_params: {
            to_email: email,
            otp_code: code,
            app_name: "Steady",
          },
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Email send failed: ${t.slice(0, 120)}`);
      }
      return { emailed: true, displayed: false };
    }
    // Free fallback — no SMS/email vendor: show code once (same as many bank “display OTP” modes)
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
    if (!clientId || !buttonEl) {
      if (buttonEl) {
        buttonEl.hidden = true;
      }
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
    putOtpChallenge,
    verifyOtpChallenge,
    sendOtpEmail,
    ensureAccountRecord,
    initGoogleButton,
    familyCodeFromIdentity,
    randomOtp,
  };
})(window);
