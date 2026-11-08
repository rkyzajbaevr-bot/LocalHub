"use strict";
(() => {
  const roots = [...document.querySelectorAll("[data-ad-placement]")];
  if (!roots.length) return;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const recorded = new Set();
  const record = (campaignId, event) => {
    const key = `${campaignId}:${event}`;
    if (recorded.has(key)) return;
    recorded.add(key);
    fetch("/api/ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, event }) }).catch(() => {});
  };
  async function load(root) {
    try {
      const placement = root.dataset.adPlacement;
      if (placement === "business" && !root.dataset.organization) return;
      const response = await fetch(`/api/ads?placement=${encodeURIComponent(placement)}`, { headers: { Accept: "application/json" } });
      const data = await response.json();
      let city = root.dataset.city || "", category = root.dataset.category || "", organization = root.dataset.organization || "";
      if (!city && document.getElementById("cityFilter")?.value) city = document.getElementById("cityFilter").value;
      if (!category && document.getElementById("mapCategory")?.value && document.getElementById("mapCategory").value !== "all") category = document.getElementById("mapCategory").value;
      if (!organization) organization = document.getElementById("businessDetail")?.dataset.organization || "";
      const items = (Array.isArray(data.items) ? data.items : []).filter((item) => (!item.city || item.city === city) && (!item.category_id || item.category_id === category) && (!item.organization_id || item.organization_id === organization));
      root.innerHTML = items.map((item) => `<a class="ad-banner" href="${esc(item.destination_url)}" target="_blank" rel="sponsored noopener noreferrer" data-ad-click="${esc(item.id)}"><span class="ad-label">Реклама</span><img src="${esc(item.image_url)}" alt="${esc(item.name)}" loading="lazy"><b>${esc(item.name)}</b></a>`).join("");
      root.hidden = !items.length;
      for (const item of items) record(item.id, "impression");
    } catch { root.hidden = true; }
  }
  for (const root of roots) {
    root.addEventListener("click", (event) => {
    const ad = event.target.closest("[data-ad-click]");
    if (ad) record(ad.dataset.adClick, "click");
    });
    load(root);
  }
  const detail = document.getElementById("businessDetail");
  if (detail) new MutationObserver(() => { if (detail.dataset.organization) for (const root of roots) if (root.dataset.adPlacement === "business") { root.dataset.organization = detail.dataset.organization; root.dataset.city = detail.dataset.city || ""; root.dataset.category = detail.dataset.category || ""; load(root); } }).observe(detail, { childList: true, subtree: true });
  for (const searchRoot of roots.filter((root) => ["search", "category"].includes(root.dataset.adPlacement))) {
    const refresh = () => {
      searchRoot.dataset.city = document.getElementById("cityFilter")?.value || "";
      searchRoot.dataset.category = document.querySelector("[data-category].is-active")?.dataset.category || "";
      load(searchRoot);
    };
    document.getElementById("cityFilter")?.addEventListener("change", refresh);
    document.getElementById("chips")?.addEventListener("click", () => setTimeout(refresh, 0));
    document.addEventListener("localhub:auth-ready", refresh);
  }
})();
