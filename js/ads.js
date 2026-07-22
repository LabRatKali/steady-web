/**
 * Website ads → your AdSense / AdMob publisher (keys/admob.json).
 * Download gate + signed-in dashboard.
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
    s.crossOrigin = "anonymous";
    s.src =
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" +
      encodeURIComponent(pub);
    document.head.appendChild(s);
  }

  function mountUnit(host) {
    if (!host || host.dataset.adsMounted === "1") return;
    const pub = publisherId();
    host.dataset.adsMounted = "1";
    host.innerHTML = "";

    if (!pub) {
      host.innerHTML =
        '<p class="muted" style="font-size:0.9rem">AdSense publisher id missing in site config.</p>';
      return;
    }

    injectScript(pub);

    const slot = slotId();
    if (slot) {
      const ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.style.minHeight = "100px";
      ins.setAttribute("data-ad-client", pub);
      ins.setAttribute("data-ad-slot", slot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      host.appendChild(ins);
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (_) {}
      return;
    }

    // No display slot yet — still load Auto ads client (revenue if Auto ads is on),
    // and show a clear sponsor card instead of a scary “enable …” error.
    const card = document.createElement("div");
    card.className = "sponsor-card";
    card.innerHTML =
      "<strong>Sponsor break</strong>" +
      "<p>Thanks — this pause helps Steady stay free and keeps the app lighter on ads. " +
      "Revenue goes to the Steady AdSense account (<code>" +
      pub.replace(/</g, "") +
      "</code>).</p>" +
      "<p class=\"muted sponsor-hint\">To show a real banner here: AdSense → Ads → By ad unit → " +
      "Display → copy the slot id into <code>keys/admob.json</code> as <code>adsenseSlotId</code>, " +
      "then republish the site. Also turn on Auto ads for <code>labratkali.github.io</code>.</p>";
    host.appendChild(card);
  }

  function showAds(selector) {
    const pub = publisherId();
    if (pub) injectScript(pub);
    document.querySelectorAll(selector || "[data-steady-ad]").forEach(mountUnit);
    return true;
  }

  function showSignedInAds() {
    return showAds("[data-steady-ad]");
  }

  function showPublicAds() {
    return showAds("[data-steady-ad]");
  }

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

  // Warm Auto ads client on marketing pages as soon as config is present.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      const pub = publisherId();
      if (pub) injectScript(pub);
    });
  } else if (publisherId()) {
    injectScript(publisherId());
  }

  window.SteadyAdsWeb = {
    showSignedInAds,
    showPublicAds,
    runDownloadSupportGate,
    publisherId,
    slotId,
  };
})();
