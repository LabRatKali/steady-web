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
      "Latest release: see GitHub Releases if the button above is unavailable.";
  }
}

loadLatest();
