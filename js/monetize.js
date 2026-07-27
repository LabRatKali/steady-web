/**
 * Steady website monetization — crypto-friendly networks (no Google AdMob/AdSense).
 * Waterfall: Monetag rewarded → AdsBitvex → custom steadyShowReward → timed Adsterra/Hilltop HTML.
 * Config: window.STEADY_RUNTIME from keys/monetize.json
 */
(function () {
  const RT = () => window.STEADY_RUNTIME || {};

  function provider() {
    return String(RT().monetizeProvider || "adsterra").trim().toLowerCase();
  }

  function scriptUrl() {
    return String(
      RT().monetizeScriptUrl ||
        RT().monetagScriptUrl ||
        RT().adsbitvexScriptUrl ||
        RT().rewardScriptUrl ||
        ""
    ).trim();
  }

  function appId() {
    return String(RT().monetizeAppId || RT().adsbitvexAppId || RT().monetagZoneId || "").trim();
  }

  function bannerHtml() {
    return String(RT().monetizeBannerHtml || RT().websiteBannerHtml || "").trim();
  }

  function rewardHtml() {
    return String(RT().monetizeRewardHtml || "").trim();
  }

  function isAppConfigured() {
    return !!(
      scriptUrl() ||
      RT().monetizeRewardWebUrl ||
      rewardHtml() ||
      bannerHtml()
    );
  }

  function isSiteConfigured() {
    return !!bannerHtml() || isAppConfigured();
  }

  function injectScript(src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject(new Error("No monetize script URL"));
        return;
      }
      if (document.querySelector('script[data-steady-monetize-src="' + src + '"]')) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.async = true;
      s.src = src;
      s.dataset.steadyMonetizeSrc = src;
      if (appId()) s.dataset.zone = appId();
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load sponsor script: " + src));
      document.head.appendChild(s);
    });
  }

  function injectHtml(host, html) {
    if (!host || !html) return;
    host.innerHTML = html;
    host.querySelectorAll("script").forEach((old) => {
      const s = document.createElement("script");
      if (old.src) s.src = old.src;
      else s.textContent = old.textContent || "";
      old.replaceWith(s);
    });
  }

  /** Try known rewarded APIs from Monetag / AdsBitvex / custom. */
  async function trySdkReward() {
    const fns = [
      "show_8862670", // Monetag sometimes generates show_<zone>
      "showRewarded",
      "showadsbitvex",
      "steadyShowReward",
      "monetagShowRewarded",
    ];
    for (const name of fns) {
      const fn = window[name];
      if (typeof fn === "function") {
        const result = await Promise.resolve(fn());
        if (result === true || result === "rewarded" || (result && result.rewarded)) return true;
        // Some SDKs resolve on close without boolean — treat resolved promise as success
        if (result === undefined || result === null) return true;
      }
    }
    // Monetag / Propeller-style: window.yaContextCb push
    if (typeof window.Ya === "object" || Array.isArray(window.yaContextCb)) {
      return await new Promise((resolve) => {
        try {
          if (typeof window.Ya !== "undefined" && window.Ya.Context && window.Ya.Context.AdvManager) {
            // Not a clean rewarded API — fall through
          }
        } catch (_) {}
        resolve(false);
      });
    }
    return false;
  }

  /**
   * Full rewarded attempt for League / download gate.
   */
  async function showRewarded() {
    const customUrl = String(RT().monetizeRewardWebUrl || "").trim();
    if (customUrl && !scriptUrl() && !rewardHtml()) {
      throw new Error("Open Watch ad in the Steady app for this publisher URL setup");
    }

    const host =
      document.getElementById("steady-reward-slot") ||
      document.querySelector("[data-steady-reward-slot]");

    // Social Bar / interstitial scripts prefer document body (Adsterra guidance).
    const rewardTarget = host || document.body;
    if (rewardHtml()) {
      injectHtml(rewardTarget, rewardHtml());
    } else if (bannerHtml() && host && !scriptUrl()) {
      injectHtml(host, bannerHtml());
    }

    if (scriptUrl()) {
      await injectScript(scriptUrl());
      await new Promise((r) => setTimeout(r, 600));
      const ok = await trySdkReward();
      if (ok) return true;
    }

    // Adsterra / Hilltop: HTML units don't always expose a Promise — timed confirm UX
    if (rewardHtml() || bannerHtml() || scriptUrl()) {
      return await timedSponsorConfirm(host);
    }

    if (RT().monetizeAllowDemo === true) {
      await new Promise((r) => setTimeout(r, 2500));
      return true;
    }

    throw new Error(
      "No sponsor SDK/HTML configured. Add Adsterra or Monetag codes to keys/monetize.json (docs/MONETIZE_SETUP.md)."
    );
  }

  function timedSponsorConfirm(host) {
    return new Promise((resolve) => {
      const seconds = Math.max(8, Number(RT().monetizeMinWatchSeconds) || 12);
      let left = seconds;
      const bar = document.createElement("div");
      bar.className = "sponsor-card";
      bar.innerHTML =
        "<strong>Watch the sponsor</strong>" +
        "<p id='steady-watch-tick'>Please wait " +
        left +
        "s…</p>" +
        "<button type='button' id='steady-watch-done' disabled>I finished — continue</button>";
      if (host) host.appendChild(bar);
      else document.body.appendChild(bar);
      const tickEl = bar.querySelector("#steady-watch-tick");
      const btn = bar.querySelector("#steady-watch-done");
      const t = setInterval(() => {
        left -= 1;
        if (tickEl) tickEl.textContent = left > 0 ? "Please wait " + left + "s…" : "You can continue.";
        if (left <= 0) {
          clearInterval(t);
          if (btn) btn.disabled = false;
        }
      }, 1000);
      btn.addEventListener("click", () => {
        clearInterval(t);
        resolve(true);
      });
    });
  }

  function mountBanner(host) {
    if (!host || host.dataset.mounted === "1") return;
    host.dataset.mounted = "1";
    const html = bannerHtml();
    if (html) {
      injectHtml(host, html);
      return;
    }
    host.innerHTML =
      '<div class="sponsor-card"><strong>Sponsor space</strong>' +
      "<p>Primary: <strong>Adsterra</strong> (USDT/BTC). Also supported: Monetag, HilltopAds. " +
      "Paste banner HTML into <code>keys/monetize.json</code> → see <code>docs/MONETIZE_SETUP.md</code>.</p></div>";
  }

  function runDownloadSupportGate(options) {
    const opts = options || {};
    const statusEl = opts.statusEl || null;
    const adHost = opts.adHost || document.querySelector("[data-steady-ad]");
    const seconds = Math.max(5, Number(opts.seconds) || 8);
    const storageKey = opts.storageKey || "steady.downloadUnlocked";
    const onUnlocked = typeof opts.onUnlocked === "function" ? opts.onUnlocked : () => {};

    try {
      if (sessionStorage.getItem(storageKey) === "1") {
        onUnlocked();
        return;
      }
    } catch (_) {}

    if (adHost) {
      adHost.hidden = false;
      adHost.removeAttribute("hidden");
      mountBanner(adHost);
    }

    const tryReward = isAppConfigured();
    let left = tryReward ? Math.max(seconds, 6) : seconds;

    async function start() {
      if (tryReward) {
        if (statusEl) statusEl.textContent = "Loading sponsor…";
        try {
          const ok = await showRewarded();
          if (ok) {
            try {
              sessionStorage.setItem(storageKey, "1");
            } catch (_) {}
            if (statusEl) statusEl.textContent = "Thanks — download unlocked.";
            onUnlocked();
            return;
          }
        } catch (_) {}
      }
      const tick = () => {
        if (statusEl) {
          statusEl.textContent =
            left > 0
              ? `Thanks for supporting Steady — unlock in ${left}s.`
              : "Unlocked — download below.";
        }
        if (left <= 0) {
          try {
            sessionStorage.setItem(storageKey, "1");
          } catch (_) {}
          onUnlocked();
          return;
        }
        left -= 1;
        window.setTimeout(tick, 1000);
      };
      tick();
    }
    start();
  }

  function showSignedInAds() {
    document.querySelectorAll("[data-steady-ad]").forEach(mountBanner);
  }

  window.SteadyMonetizeWeb = {
    showRewarded,
    runDownloadSupportGate,
    showSignedInAds,
    mountBanner,
    isAppConfigured,
    isSiteConfigured,
    provider,
  };
  window.SteadyAdsWeb = window.SteadyMonetizeWeb;
})();
