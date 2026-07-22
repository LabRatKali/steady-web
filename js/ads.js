/**
 * Website ads → your AdSense / AdMob publisher account.
 * - Signed-in dashboard: passive units
 * - Download gate: public sponsor message before APK unlock
 */
(function () {
  const RT = () => window.STEADY_RUNTIME || {};

  function publisherId() {
    return String(RT().adsensePublisherId || "").trim();
  }

  function slotId() {
    return String(RT().adsenseSlotId || "").trim();
  }

  function injectScript(pub) {
    if (!pub || document.getElementById("steady-adsense-js")) return;
    const s = document.createElement("script");
    s.id = "steady-adsense-js";
    s.async = true;
    s.src =
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" +
      encodeURIComponent(pub);
    s.crossOrigin = "anonymous";
    document.head.appendChild(s);
  }

  function mountUnit(host) {
    if (!host || host.dataset.adsMounted === "1") return;
    const pub = publisherId();
    if (!pub) {
      host.innerHTML =
        '<p class="muted" style="font-size:0.85rem">Ads need AdSense on this publisher — same Google account as AdMob.</p>';
      return;
    }
    injectScript(pub);
    host.dataset.adsMounted = "1";
    host.innerHTML = "";
    const slot = slotId();
    if (slot) {
      const ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.style.minHeight = "90px";
      ins.setAttribute("data-ad-client", pub);
      ins.setAttribute("data-ad-slot", slot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      host.appendChild(ins);
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (_) {}
    } else {
      const note = document.createElement("p");
      note.className = "muted";
      note.style.fontSize = "0.85rem";
      note.textContent =
        "Loading sponsor space… Enable Auto ads for labratkali.github.io in AdSense (or add adsenseSlotId).";
      host.appendChild(note);
    }
  }

  function showAds(selector) {
    const pub = publisherId();
    if (!pub) return false;
    injectScript(pub);
    const nodes = document.querySelectorAll(selector || "[data-steady-ad]");
    nodes.forEach(mountUnit);
    return nodes.length > 0;
  }

  function showSignedInAds() {
    return showAds("[data-steady-ad]");
  }

  function showPublicAds() {
    return showAds("[data-steady-ad]");
  }

  /**
   * Download support gate: show ad unit + short wait, then unlock.
   * sessionStorage key so one unlock lasts the browser tab session.
   */
  function runDownloadSupportGate(options) {
    const opts = options || {};
    const statusEl = opts.statusEl || null;
    const adHost = opts.adHost || document.querySelector("[data-steady-download-ad]");
    const seconds = Math.max(5, Number(opts.seconds) || 10);
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
      mountUnit(adHost);
    } else {
      showPublicAds();
    }

    let left = seconds;
    const tick = () => {
      if (statusEl) {
        statusEl.textContent =
          left > 0
            ? `Thanks — unlock in ${left}s. This keeps Steady free and the app lighter on ads.`
            : "Unlocked — download Steady below.";
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

  window.SteadyAdsWeb = {
    showSignedInAds,
    showPublicAds,
    runDownloadSupportGate,
    publisherId,
  };
})();
