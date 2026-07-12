async function loadLatest() {
  const versionLine = document.getElementById("version-line");
  const apkLink = document.getElementById("apk-link");
  if (!versionLine || !apkLink) return;

  try {
    const res = await fetch(
      "https://api.github.com/repos/LabRatKali/steady-web/releases/latest"
    );
    if (!res.ok) throw new Error("release fetch failed");
    const data = await res.json();
    const asset = (data.assets || []).find((a) =>
      String(a.name).endsWith(".apk")
    );
    if (asset?.browser_download_url) {
      apkLink.href = asset.browser_download_url;
    }
    const ver = data.tag_name || data.name || "latest";
    versionLine.textContent = `Latest release: ${ver}`;
  } catch (_) {
    versionLine.textContent =
      "Latest release: use the Download button above. If it fails, try again in a moment.";
  }
}

function wireSuggestionForm() {
  const box = document.getElementById("suggest-form");
  const send = document.getElementById("suggest-send");
  const nameInput = document.getElementById("suggest-name");
  const bodyInput = document.getElementById("suggest-body");
  if (!box || !send || !bodyInput) return;

  const openMail = () => {
    const name = (nameInput?.value || "").trim();
    const idea = (bodyInput.value || "").trim();
    if (!idea) {
      bodyInput.focus();
      return;
    }

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

    window.location.href =
      "mailto:labratcomputers@gmail.com" +
      "?subject=" +
      encodeURIComponent("Steady - Suggestion") +
      "&body=" +
      encodeURIComponent(lines.join("\n"));
  };

  send.addEventListener("click", openMail);
  bodyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      openMail();
    }
  });
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
