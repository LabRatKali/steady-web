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
      Array.from(old.attributes || []).forEach((a) => {
        if (a.name !== "src") s.setAttribute(a.name, a.value);
      });
      old.replaceWith(s);
    });
  }

  /** Append reward scripts to document.body (Adsterra Social Bar guidance). */
  function injectRewardToBody(html) {
    if (!html) return;
    const wrap = document.createElement("div");
    wrap.id = "steady-reward-inject";
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    document.body.appendChild(wrap);
    injectHtml(wrap, html);
    // Move scripts out so Social Bar can attach overlays to the real body.
    wrap.querySelectorAll("script").forEach((s) => {
      document.body.appendChild(s);
    });
  }

  async function trySdkReward() {
    const fns = [
      "show_8862670",
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
        if (result === undefined || result === null) return true;
      }
    }
    return false;
  }

  /**
   * Clean timed confirm — uses on-page UI when present (reward-ad.html), else a single compact bar.
   * opts: { autoComplete, onTick(left, total), statusEl, tickEl, doneBtn, progressEl }
   */
  function timedSponsorConfirm(opts) {
    const o = opts || {};
    const seconds = Math.max(8, Number(RT().monetizeMinWatchSeconds) || 12);
    const autoComplete = o.autoComplete === true;
    return new Promise((resolve) => {
      let left = seconds;
      const tickEl = o.tickEl || document.getElementById("steady-watch-tick");
      const doneBtn = o.doneBtn || document.getElementById("steady-watch-done");
      const statusEl = o.statusEl || document.getElementById("status");
      const progressEl = o.progressEl || document.getElementById("steady-watch-progress");
      let bar = null;

      function paint() {
        const msg = left > 0 ? "Please wait " + left + "s…" : "Almost done…";
        if (tickEl) tickEl.textContent = msg;
        if (statusEl && !tickEl) statusEl.textContent = msg;
        if (typeof o.onTick === "function") o.onTick(left, seconds);
        if (progressEl) {
          const pct = Math.round(((seconds - left) / seconds) * 100);
          progressEl.style.width = pct + "%";
        }
      }

      if (!tickEl && !doneBtn) {
        bar = document.createElement("div");
        bar.className = "sponsor-card sponsor-card--timer";
        bar.innerHTML =
          "<strong>Watch the sponsor</strong>" +
          "<div class='sponsor-progress'><span id='steady-watch-progress'></span></div>" +
          "<p id='steady-watch-tick'>Please wait " +
          left +
          "s…</p>" +
          (autoComplete
            ? ""
            : "<button type='button' id='steady-watch-done' disabled>Continue</button>");
        const host =
          document.getElementById("steady-reward-slot") ||
          document.querySelector("[data-steady-reward-slot]") ||
          document.body;
        host.appendChild(bar);
      }

      const liveTick = document.getElementById("steady-watch-tick") || tickEl;
      const liveDone = document.getElementById("steady-watch-done") || doneBtn;
      const liveProgress = document.getElementById("steady-watch-progress") || progressEl;
      paint();

      const t = setInterval(() => {
        left -= 1;
        if (liveTick) {
          liveTick.textContent = left > 0 ? "Please wait " + left + "s…" : "You can continue.";
        }
        if (liveProgress) {
          liveProgress.style.width = Math.round(((seconds - Math.max(left, 0)) / seconds) * 100) + "%";
        }
        if (typeof o.onTick === "function") o.onTick(Math.max(left, 0), seconds);
        if (left <= 0) {
          clearInterval(t);
          if (autoComplete) {
            if (bar) bar.remove();
            resolve(true);
            return;
          }
          if (liveDone) liveDone.disabled = false;
        }
      }, 1000);

      if (liveDone) {
        liveDone.addEventListener(
          "click",
          () => {
            clearInterval(t);
            if (bar) bar.remove();
            resolve(true);
          },
          { once: true }
        );
      }
    });
  }

  async function showRewarded(options) {
    const opts = options || {};
    const customUrl = String(RT().monetizeRewardWebUrl || "").trim();
    if (customUrl && !scriptUrl() && !rewardHtml()) {
      throw new Error("Open Watch ad in the Steady app");
    }

    if (rewardHtml()) {
      injectRewardToBody(rewardHtml());
    } else if (bannerHtml() && !scriptUrl()) {
      const host =
        document.getElementById("steady-reward-slot") ||
        document.querySelector("[data-steady-reward-slot]");
      if (host) injectHtml(host, bannerHtml());
    }

    if (scriptUrl()) {
      await injectScript(scriptUrl());
      await new Promise((r) => setTimeout(r, 500));
      const ok = await trySdkReward();
      if (ok) return true;
    }

    if (rewardHtml() || bannerHtml() || scriptUrl()) {
      const fromApp = !!(window.SteadyNative) || opts.autoComplete === true;
      return await timedSponsorConfirm({
        autoComplete: fromApp || opts.autoComplete === true,
        statusEl: opts.statusEl,
        tickEl: opts.tickEl,
        doneBtn: opts.doneBtn,
        progressEl: opts.progressEl,
        onTick: opts.onTick,
      });
    }

    if (RT().monetizeAllowDemo === true) {
      await new Promise((r) => setTimeout(r, 2500));
      return true;
    }

    throw new Error(
      "Sponsor isn’t available right now. Try again in a minute."
    );
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
      "<p>Thanks for supporting Steady.</p></div>";
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

    let left = seconds;
    if (statusEl) {
      statusEl.textContent = `Thanks for supporting Steady — unlock in ${left}s.`;
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
