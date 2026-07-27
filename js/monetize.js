/**
 * Steady website monetization.
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

  /** Cache-bust script URLs so each refresh can request a fresh fill. */
  function withCacheBust(html) {
    if (!html) return html;
    const bust = String(Date.now()) + String(Math.floor(Math.random() * 1e6));
    return html.replace(
      /(<script[^>]+src=["'])([^"']+)(["'])/gi,
      function (_, a, src, c) {
        if (/^(https?:)?\/\//i.test(src) || src.indexOf("/") === 0) {
          const sep = src.indexOf("?") >= 0 ? "&" : "?";
          return a + src + sep + "cb=" + bust + c;
        }
        return _;
      }
    );
  }

  function injectScript(src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject(new Error("No monetize script URL"));
        return;
      }
      const busted = src + (src.indexOf("?") >= 0 ? "&" : "?") + "cb=" + Date.now();
      const s = document.createElement("script");
      s.async = true;
      s.src = busted;
      s.dataset.steadyMonetizeSrc = src;
      if (appId()) s.dataset.zone = appId();
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load sponsor script"));
      document.head.appendChild(s);
    });
  }

  function injectHtml(host, html) {
    if (!host || !html) return;
    host.innerHTML = withCacheBust(html);
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

  function injectRewardToBody(html) {
    if (!html) return;
    const wrap = document.createElement("div");
    wrap.id = "steady-reward-inject";
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    document.body.appendChild(wrap);
    injectHtml(wrap, html);
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

  function timedSponsorConfirm(opts) {
    const o = opts || {};
    const seconds = Math.max(8, Number(RT().monetizeMinWatchSeconds) || 12);
    const autoComplete = o.autoComplete === true;
    const silent = o.silent === true;
    return new Promise((resolve) => {
      let left = seconds;
      const tickEl = o.tickEl || document.getElementById("steady-watch-tick");
      const doneBtn = o.doneBtn || document.getElementById("steady-watch-done");
      const statusEl = o.statusEl || document.getElementById("status");
      const progressEl = o.progressEl || document.getElementById("steady-watch-progress");
      let bar = null;

      function paint() {
        if (silent) return;
        const msg = left > 0 ? "Please wait " + left + "s…" : "Almost done…";
        if (tickEl) tickEl.textContent = msg;
        if (statusEl && !tickEl) statusEl.textContent = msg;
        if (typeof o.onTick === "function") o.onTick(left, seconds);
        if (progressEl) {
          const pct = Math.round(((seconds - left) / seconds) * 100);
          progressEl.style.width = pct + "%";
        }
      }

      if (!silent && !tickEl && !doneBtn) {
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

      const liveTick = silent ? null : document.getElementById("steady-watch-tick") || tickEl;
      const liveDone = silent ? null : document.getElementById("steady-watch-done") || doneBtn;
      const liveProgress = silent
        ? null
        : document.getElementById("steady-watch-progress") || progressEl;
      paint();

      const t = setInterval(() => {
        left -= 1;
        if (liveTick) {
          liveTick.textContent = left > 0 ? "Please wait " + left + "s…" : "You can continue.";
        }
        if (liveProgress) {
          liveProgress.style.width =
            Math.round(((seconds - Math.max(left, 0)) / seconds) * 100) + "%";
        }
        if (typeof o.onTick === "function") o.onTick(Math.max(left, 0), seconds);
        if (left <= 0) {
          clearInterval(t);
          if (autoComplete || silent) {
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
      const stage =
        document.getElementById("steady-ad-stage") ||
        document.getElementById("steady-reward-slot") ||
        document.querySelector("[data-steady-reward-slot]");
      if (stage) injectHtml(stage, rewardHtml());
      else injectRewardToBody(rewardHtml());
    } else if (bannerHtml() && !scriptUrl()) {
      const host =
        document.getElementById("steady-ad-stage") ||
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
        silent: opts.silent === true,
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

    throw new Error("Sponsor isn’t available right now. Try again in a minute.");
  }

  /**
   * Fresh mount every call (refresh / revisit). Clears prior mount flag.
   */
  function mountBanner(host, opts) {
    if (!host) return;
    const force = !opts || opts.force !== false;
    if (force) delete host.dataset.mounted;
    if (host.dataset.mounted === "1") return;
    host.dataset.mounted = "1";
    host.hidden = false;
    host.removeAttribute("hidden");
    const html = bannerHtml();
    if (html) {
      injectHtml(host, html);
      // Soft retry once if the slot stays empty (common no-fill).
      window.setTimeout(() => {
        if (!host.isConnected) return;
        const hasFrame = host.querySelector("iframe, ins, [id^='container-']");
        if (!hasFrame && html) {
          delete host.dataset.mounted;
          injectHtml(host, html);
          host.dataset.mounted = "1";
        }
      }, 2500);
      return;
    }
    host.innerHTML = "";
  }

  /**
   * Download section: show sponsors quietly, unlock after a hidden wait.
   * Every page load remounts ads (no cookie clear needed).
   */
  function runDownloadSupportGate(options) {
    const opts = options || {};
    const statusEl = opts.statusEl || null;
    const adHost = opts.adHost || document.querySelector("[data-steady-ad]");
    const seconds = Math.max(4, Number(opts.seconds) || 6);
    const storageKey = opts.storageKey || "steady.downloadUnlocked";
    const onUnlocked = typeof opts.onUnlocked === "function" ? opts.onUnlocked : () => {};
    const keepAds = opts.keepAds !== false;

    if (adHost) {
      mountBanner(adHost, { force: true });
    }

    let already = false;
    try {
      already = sessionStorage.getItem(storageKey) === "1";
    } catch (_) {}

    // Never show a countdown — unlock quietly.
    if (statusEl) statusEl.textContent = "";

    if (already) {
      onUnlocked();
      if (keepAds && adHost) mountBanner(adHost, { force: true });
      return;
    }

    window.setTimeout(() => {
      try {
        sessionStorage.setItem(storageKey, "1");
      } catch (_) {}
      onUnlocked();
      if (keepAds && adHost) mountBanner(adHost, { force: true });
    }, seconds * 1000);
  }

  function showSignedInAds() {
    document.querySelectorAll("[data-steady-ad]").forEach((el) => mountBanner(el, { force: true }));
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
