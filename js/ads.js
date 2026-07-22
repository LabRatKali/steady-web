/**
 * Signed-in website ads → your AdSense / AdMob publisher account.
 * Loads only after SteadyAuth session exists (dashboard / signed-in pages).
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
    if (document.getElementById("steady-adsense-js")) return;
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
        '<p class="muted" style="font-size:0.85rem">Website ads need AdSense on this publisher — same Google account as AdMob.</p>';
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
      ins.setAttribute("data-ad-client", pub);
      ins.setAttribute("data-ad-slot", slot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      host.appendChild(ins);
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (_) {}
    } else {
      // Auto ads / placeholder until you add adsenseSlotId in keys/admob.json
      const note = document.createElement("p");
      note.className = "muted";
      note.style.fontSize = "0.85rem";
      note.textContent =
        "Signed in — ads use your AdSense publisher. Enable Auto ads for labratkali.github.io in AdSense, or add adsenseSlotId.";
      host.appendChild(note);
      // Still load client so Auto ads can fill if enabled in AdSense console.
    }
  }

  function showSignedInAds() {
    const pub = publisherId();
    if (!pub) return;
    injectScript(pub);
    document.querySelectorAll("[data-steady-ad]").forEach(mountUnit);
  }

  window.SteadyAdsWeb = {
    showSignedInAds,
    publisherId,
  };
})();
