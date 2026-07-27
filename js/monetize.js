/**
 * Steady website monetization — crypto networks only (no Google AdSense/AdMob).
 * Config from window.STEADY_RUNTIME (generated from keys/monetize.json).
 */
(function () {
  const RT = () => window.STEADY_RUNTIME || {};

  function provider() {
    return String(RT().monetizeProvider || "").trim().toLowerCase();
  }

  function scriptUrl() {
    return String(RT().monetizeScriptUrl || "").trim();
  }

  function appId() {
    return String(RT().monetizeAppId || "").trim();
  }

  function bannerHtml() {
    return String(RT().monetizeBannerHtml || "").trim();
  }

  function isAppConfigured() {
    return !!(scriptUrl() && (appId() || provider() === "custom")) || !!RT().monetizeRewardWebUrl;
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
      const existing = document.querySelector('script[data-steady-monetize="1"]');
      if (existing) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.async = true;
      s.src = src;
      s.dataset.steadyMonetize = "1";
      if (appId()) s.dataset.appId = appId();
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load sponsor script"));
      document.head.appendChild(s);
    });
  }

  /**
   * AdsBitvex: window.showadsbitvex() → Promise
   * Custom: window.steadyShowReward() if publisher provides it
   */
  async function showRewarded() {
    const customUrl = String(RT().monetizeRewardWebUrl || "").trim();
    if (customUrl && !scriptUrl()) {
      // Custom full-page reward URL opened by the app WebView, not here.
      throw new Error("Use the in-app Watch ad button for this publisher setup");
    }
    await injectScript(scriptUrl());
    await new Promise((r) => setTimeout(r, 400));

    if (typeof window.showadsbitvex === "function") {
      const result = await window.showadsbitvex();
      return result === true || result === "rewarded" || (result && result.rewarded);
    }
    if (typeof window.steadyShowReward === "function") {
      return !!(await window.steadyShowReward());
    }
    // Fallback demo completion only when explicitly allowed (local testing).
    if (RT().monetizeAllowDemo === true) {
      await new Promise((r) => setTimeout(r, 2500));
      return true;
    }
    throw new Error(
      "Sponsor SDK loaded but no showadsbitvex()/steadyShowReward(). Check AdsBitvex app id + script URL."
    );
  }

  function mountBanner(host) {
    if (!host || host.dataset.mounted === "1") return;
    host.dataset.mounted = "1";
    const html = bannerHtml();
    if (html) {
      host.innerHTML = html;
      // Execute any scripts inside pasted HTML
      host.querySelectorAll("script").forEach((old) => {
        const s = document.createElement("script");
        if (old.src) s.src = old.src;
        else s.textContent = old.textContent || "";
        old.replaceWith(s);
      });
      return;
    }
    host.innerHTML =
      '<div class="sponsor-card"><strong>Sponsor space</strong>' +
      "<p>Crypto ads are not configured yet. After you sign up for AdsBitvex (or paste banner HTML), " +
      "put keys in <code>keys/monetize.json</code> and republish — see <code>docs/MONETIZE_SETUP.md</code>.</p></div>";
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

    // If a rewarded web SDK is configured, try one rewarded view; else timed thank-you.
    const tryReward = isAppConfigured();
    let left = tryReward ? Math.max(seconds, 6) : seconds;

    async function start() {
      if (tryReward) {
        if (statusEl) statusEl.textContent = "Loading crypto sponsor…";
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
        } catch (_) {
          /* fall through to countdown */
        }
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

  // Back-compat alias while old pages refresh caches
  window.SteadyAdsWeb = window.SteadyMonetizeWeb;
})();
