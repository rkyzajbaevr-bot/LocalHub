"use strict";
(() => {
  const panel = document.getElementById("businessAnalyticsPanel");
  if (!panel) return;
  const status = document.getElementById("businessAnalyticsStatus");
  const select = document.getElementById("ownedOrganization");
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const say = (text, error = false) => { status.textContent = text; status.hidden = !text; status.classList.toggle("is-error", error); };
  let generation = 0;
  async function loadMetrics(version = generation) {
    const tokenResult = await window.LocalHubAuth?.client?.auth.getSession();
    const token = tokenResult?.data?.session?.access_token;
    if (!token) return say("Войдите, чтобы загрузить статистику.", true);
    const response = await fetch(`/api/analytics?organizationId=${encodeURIComponent(select.value)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (version !== generation) return;
    if (!response.ok) return say(payload.error || "Нет доступа к статистике.", true);
    const summary = payload.summary || {};
    document.getElementById("businessAnalyticsMetrics").innerHTML = [["Сегодня", summary.today], ["7 дней", summary.days_7], ["30 дней", summary.days_30], ["За всё время", summary.all_time]].map(([label, value]) => `<article><span>${label}</span><b>${Number(value) || 0}</b></article>`).join("");
    const actions = summary.actions || {};
    document.getElementById("businessAnalyticsActions").innerHTML = `<b>Действия посетителей</b><p>Просмотры: ${Number(actions.view) || 0} · Сайт: ${Number(actions.website) || 0} · Телефон: ${Number(actions.phone) || 0} · WhatsApp: ${Number(actions.whatsapp) || 0} · Маршрут: ${Number(actions.route) || 0}</p>`;
    const activity = Array.isArray(summary.activity) ? summary.activity : [];
    const max = Math.max(1, ...activity.map((row) => Number(row.count) || 0));
    const chart = document.createElement("div"); chart.className = "analytics-chart"; chart.setAttribute("role", "img"); chart.setAttribute("aria-label", "Активность за 30 дней");
    chart.innerHTML = activity.map((row) => `<span title="${safe(row.day)}: ${Number(row.count) || 0}" style="--bar:${Math.max(3, (Number(row.count) || 0) / max * 100)}%"></span>`).join("");
    document.getElementById("businessAnalyticsActions").append(chart);
    say("");
  }
  async function loadOwners() {
    const version = ++generation;
    panel.hidden = true; select.replaceChildren(); document.getElementById("businessAnalyticsMetrics").replaceChildren(); document.getElementById("businessAnalyticsActions").replaceChildren();
    const cloud = window.LocalHubAuth;
    if (!cloud?.user || !cloud?.client) return say("");
    const userId = cloud.user.id;
    const { data, error } = await cloud.client.from("business_owners").select("organization_id,organizations(name)").eq("user_id", userId);
    if (version !== generation || window.LocalHubAuth?.user?.id !== userId) return;
    if (error) return say("Не удалось загрузить подтверждённые организации владельца.", true);
    select.replaceChildren(...(data || []).map((row) => new Option(row.organizations?.name || row.organization_id, row.organization_id)));
    panel.hidden = !(data || []).length;
    if (data?.length) await loadMetrics(version);
  }
  select.addEventListener("change", () => loadMetrics().catch(() => say("Не удалось получить статистику.", true)));
  document.addEventListener("localhub:auth-ready", loadOwners);
  loadOwners();
})();
