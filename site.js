async function loadLatest() {
  const versionLine = document.getElementById("version-line");
  const apkLink = document.getElementById("apk-link");
  if (!versionLine || !apkLink) return;

  const FALLBACK_VERSION = "v1.1.10";
  const template =
    versionLine.dataset.template || "Latest release: %s";
  const formatVersion = (ver) => template.replace("%s", ver);

  // Show a real version immediately — never leave "loading" stuck on the download button.
  if (/loading/i.test(versionLine.textContent || "")) {
    versionLine.textContent = formatVersion(FALLBACK_VERSION);
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4500);

  try {
    const res = await fetch(
      "https://api.github.com/repos/LabRatKali/steady-web/releases/latest",
      { signal: controller.signal }
    );
    if (!res.ok) throw new Error("release fetch failed");
    const data = await res.json();
    const asset = (data.assets || []).find((a) =>
      String(a.name).endsWith(".apk")
    );
    if (asset?.browser_download_url) {
      apkLink.href = asset.browser_download_url;
    }
    const ver = data.tag_name || data.name || FALLBACK_VERSION;
    versionLine.textContent = formatVersion(ver);
  } catch (_) {
    if (!versionLine.textContent || /loading/i.test(versionLine.textContent)) {
      versionLine.textContent = formatVersion(FALLBACK_VERSION);
    }
  } finally {
    window.clearTimeout(timer);
  }
}

function buildSuggestionMailto(name, idea) {
  const lines = [
    "Hi,",
    "",
    name ? `From: ${name}` : "",
    name ? "" : null,
    "I have a suggestion for Steady:",
    "",
    idea,
    "",
    "Thanks!",
  ].filter((line) => line !== null);

  return (
    "mailto:labratcomputers@gmail.com" +
    "?subject=" +
    encodeURIComponent("Steady - Suggestion") +
    "&body=" +
    encodeURIComponent(lines.join("\n"))
  );
}

function wireSuggestionForm() {
  const send = document.getElementById("suggest-send");
  const nameInput = document.getElementById("suggest-name");
  const bodyInput = document.getElementById("suggest-body");
  const status = document.getElementById("suggest-status");
  if (!send || !bodyInput) return;

  const refreshHref = () => {
    const name = (nameInput?.value || "").trim();
    const idea = (bodyInput.value || "").trim();
    if (!idea) {
      send.setAttribute(
        "href",
        "mailto:labratcomputers@gmail.com?subject=" +
          encodeURIComponent("Steady - Suggestion")
      );
      return false;
    }
    send.setAttribute("href", buildSuggestionMailto(name, idea));
    return true;
  };

  const markReady = () => {
    refreshHref();
    if (status && !status.dataset.fallback) {
      status.textContent =
        "Opens your mail app on this device — nothing is sent through this website.";
    }
  };

  nameInput?.addEventListener("input", markReady);
  bodyInput.addEventListener("input", markReady);

  send.addEventListener("click", (event) => {
    const idea = (bodyInput.value || "").trim();
    if (!idea) {
      event.preventDefault();
      bodyInput.focus();
      if (status) {
        status.textContent = "Write your idea first, then tap Open in email.";
        status.dataset.fallback = "1";
      }
      return;
    }

    refreshHref();

    // Fallback if the mail app never opens (common on some browsers / locked-down PCs).
    window.setTimeout(async () => {
      if (!status) return;
      status.dataset.fallback = "1";
      status.innerHTML =
        'If nothing opened, email <a href="mailto:labratcomputers@gmail.com">labratcomputers@gmail.com</a> — your idea was also copied if the browser allows it.';
      try {
        const name = (nameInput?.value || "").trim();
        const text = [
          "To: labratcomputers@gmail.com",
          "Subject: Steady - Suggestion",
          "",
          name ? `From: ${name}` : null,
          name ? "" : null,
          idea,
        ]
          .filter((line) => line !== null)
          .join("\n");
        await navigator.clipboard.writeText(text);
      } catch (_) {
        /* clipboard may be denied */
      }
    }, 900);
  });

  markReady();
}

function wireReveal() {
  const nodes = document.querySelectorAll(".reveal");
  if (!nodes.length) return;

  if (!("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("in"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );

  nodes.forEach((node) => observer.observe(node));
}

function wireNav() {
  const header = document.querySelector(".top");
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  if (!header || !toggle || !nav) return;

  toggle.addEventListener("click", () => {
    const open = header.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      header.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

function wirePathTabs() {
  const tabs = Array.from(document.querySelectorAll(".path-tab"));
  const panels = Array.from(document.querySelectorAll(".path-panel"));
  if (!tabs.length || !panels.length) return;

  const activate = (path) => {
    tabs.forEach((tab) => {
      const on = tab.dataset.path === path;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach((panel) => {
      const on = panel.dataset.panel === path;
      panel.classList.toggle("is-active", on);
      if (on) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activate(tab.dataset.path));
  });
}

loadLatest();
wireSuggestionForm();
wireReveal();
wireNav();
wirePathTabs();
