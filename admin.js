"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const status = $("adminStatus");
  const workspace = $("adminWorkspace");
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let role = "user";

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle("is-error", error);
    status.classList.toggle("is-success", !error);
    status.hidden = !text;
  }

  async function request(action, method = "GET", body = null, params = {}) {
    const sessionResult = await window.LocalHubAuth.client.auth.getSession();
    const token = sessionResult.data?.session?.access_token;
    if (!token) throw new Error("Сессия истекла. Войдите снова.");
    const query = new URLSearchParams({ action, ...params });
    const response = await fetch(`/api/admin?${query}`, {
      method,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Сервер отклонил операцию.");
    return data;
  }

  function renderRows(target, rows, render) {
    target.innerHTML = rows.length ? rows.map(render).join("") : '<tr><td colspan="8" class="admin-empty">Записей пока нет.</td></tr>';
  }

  async function loadDashboard() {
    const { metrics } = await request("dashboard");
    $("metricUsers").textContent = metrics.registered_users ?? "—";
    $("metricPending").textContent = metrics.pending_submissions ?? "—";
    $("metricApproved").textContent = metrics.approved_submissions ?? "—";
    $("metricOrganizations").textContent = metrics.organizations ?? "—";
    const events = metrics.recent_events || [];
    renderRows($("dashboardEvents"), events, (row) => `<tr><td>${esc(row.action)}</td><td>${esc(row.entity_type)}</td><td>${esc(new Date(row.created_at).toLocaleString("ru-RU"))}</td></tr>`);
  }

  async function loadSubmissions() {
    const { items } = await request("submissions", "GET", null, { status: $("submissionStatus").value });
    renderRows($("submissionRows"), items || [], (item) => {
      const canReview = role === "admin";
      const controls = item.status === "pending" && canReview
        ? `<div class="admin-actions"><button type="button" class="btn" data-review="approved" data-id="${esc(item.id)}">Одобрить</button><button type="button" class="btn btn--ghost" data-review="rejected" data-id="${esc(item.id)}">Отклонить</button></div>`
        : "—";
      return `<tr><td><b>${esc(item.organization_name)}</b><small>${esc(item.phone || "Телефон не указан")}${item.website ? ` · ${esc(item.website)}` : ""}</small></td><td>${esc(item.category_id)}</td><td>${esc(item.city)}<small>${esc(item.address)}</small></td><td>${esc(item.status)}</td><td>${controls}</td></tr>`;
    });
  }

  async function loadUsers() {
    if (role !== "admin") return;
    const { items } = await request("users");
    renderRows($("userRows"), items || [], (user) => `<tr><td>${esc(user.email || "Email недоступен")}<small>${esc(user.id)}</small></td><td>${user.created_at ? esc(new Date(user.created_at).toLocaleDateString("ru-RU")) : "—"}</td><td>${user.last_sign_in_at ? esc(new Date(user.last_sign_in_at).toLocaleString("ru-RU")) : "—"}</td><td><select data-user-role="${esc(user.id)}"><option value="user" ${user.role === "user" ? "selected" : ""}>user</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>admin</option></select></td><td>${user.banned_until && new Date(user.banned_until) > new Date() ? "Заблокирован" : "Активен"}</td><td><button class="btn btn--ghost" type="button" data-user-block="${esc(user.id)}" data-blocked="${user.banned_until && new Date(user.banned_until) > new Date() ? "true" : "false"}">${user.banned_until && new Date(user.banned_until) > new Date() ? "Разблокировать" : "Заблокировать"}</button></td></tr>`);
  }

  async function loadCategories() {
    if (role !== "admin") return;
    const { items } = await request("categories");
    renderRows($("categoryRows"), items || [], (item) => `<tr><td>${esc(item.id)}</td><td>${esc(item.name)}</td><td>${esc(item.description)}</td><td>${item.is_active ? "Активна" : "Скрыта"}</td><td><button class="btn btn--ghost" type="button" data-category-delete="${esc(item.id)}">Удалить</button></td></tr>`);
  }

  async function loadOrganizations() {
    if (role !== "admin") return;
    const { items } = await request("organizations");
    renderRows($("organizationRows"), items || [], (item) => `<tr><td><b>${esc(item.name)}</b><small>${esc(item.address)}</small></td><td>${esc(item.category_id)}</td><td>${esc(item.city)}</td><td>${esc(item.updated_at ? new Date(item.updated_at).toLocaleDateString("ru-RU") : "—")}</td><td><div class="admin-actions"><button type="button" class="btn btn--ghost" data-organization-edit="${esc(item.id)}">Изменить</button><button type="button" class="btn btn--ghost" data-organization-delete="${esc(item.id)}">Удалить</button></div></td></tr>`);
  }

  async function loadEvents() {
    const { items } = await request("events");
    renderRows($("eventRows"), items || [], (item) => `<tr><td>${esc(item.action)}</td><td>${esc(item.entity_type)}</td><td>${esc(item.entity_id)}</td><td>${esc(new Date(item.created_at).toLocaleString("ru-RU"))}</td></tr>`);
  }

  async function loadReports() {
    const { items } = await request("reports");
    const labels = { wrong_address: "Неверный адрес", wrong_phone: "Неверный телефон", closed: "Закрылась", wrong_hours: "Неверный график", duplicate: "Дубликат", wrong_category: "Неверная категория", other: "Другое" };
    renderRows($("reportRows"), items || [], (item) => `<tr><td><b>${esc(item.organizations?.name || item.organization_id)}</b><small>${esc(item.organizations?.city || "")}, ${esc(item.organizations?.address || "")}</small></td><td>${esc(labels[item.issue_type] || item.issue_type)}</td><td>${esc(item.description || "—")}</td><td>${esc(item.status)}</td><td>${esc(new Date(item.created_at).toLocaleString("ru-RU"))}</td><td><div class="admin-actions"><select data-report-status="${esc(item.id)}"><option value="" selected disabled>Выбрать действие</option><option value="reviewing">Рассматривается</option><option value="resolved">Решена</option><option value="rejected">Отклонена</option></select><button type="button" class="btn" data-report-save="${esc(item.id)}">Сохранить</button><button type="button" class="btn btn--ghost" data-report-history="${esc(item.id)}">История</button></div></td></tr>`);
  }
  async function loadBadges() {
    const { items } = await request("badges");
    renderRows($("badgeRows"), items || [], (item) => `<tr><td>${esc(item.organizations?.name || item.organization_id)}</td><td>${esc(item.badge_type)}</td><td>${esc(item.source)}</td><td>${esc(item.expires_at || "Без срока")}</td><td><button class="btn btn--ghost" type="button" data-badge-delete="${esc(item.organization_id)}" data-badge-type="${esc(item.badge_type)}">Снять</button></td></tr>`);
  }
  async function loadCampaigns() {
    const { items } = await request("campaigns");
    renderRows($("campaignRows"), items || [], (item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.placement)}</td><td>${esc(item.status)}</td><td>${esc(item.impressions)} / ${esc(item.clicks)}</td><td>${esc(new Date(item.starts_at).toLocaleDateString("ru-RU"))} — ${esc(new Date(item.ends_at).toLocaleDateString("ru-RU"))}</td><td><div class="admin-actions"><button class="btn btn--ghost" type="button" data-campaign-edit="${esc(item.id)}">Изменить</button><button class="btn btn--ghost" type="button" data-campaign-delete="${esc(item.id)}">Удалить</button></div></td></tr>`);
  }
  async function loadOwners() {
    const { items } = await request("owners");
    renderRows($("ownerRows"), items || [], (item) => `<tr><td>${esc(item.organizations?.name || item.organization_id)}</td><td>${esc(item.organization_id)}</td><td>${esc(item.user_id)}</td><td>${esc(new Date(item.confirmed_at).toLocaleString("ru-RU"))}</td><td><button class="btn btn--ghost" type="button" data-owner-remove="${esc(item.organization_id)}" data-user-id="${esc(item.user_id)}">Отозвать</button></td></tr>`);
  }
  async function loadVerificationRequests() {
    const { items } = await request("verification-requests");
    renderRows($("verificationRows"), items || [], (item) => `<tr><td><b>${esc(item.organizations?.name || item.organization_id)}</b><small>${esc(item.organizations?.city || "")}</small></td><td>${esc(item.user_id)}</td><td><a href="${esc(item.evidence_url)}" target="_blank" rel="noopener">Открыть материалы ↗</a></td><td>${esc(new Date(item.created_at).toLocaleString("ru-RU"))}</td><td><div class="admin-actions"><button type="button" class="btn" data-verification-decision="approved" data-request-id="${esc(item.id)}">Подтвердить</button><button type="button" class="btn btn--ghost" data-verification-decision="rejected" data-request-id="${esc(item.id)}">Отклонить</button></div></td></tr>`);
  }
  async function loadBusinessClaims() {
    const { items } = await request("business-claims");
    renderRows($("businessClaimRows"), items || [], (item) => `<tr><td><b>${esc(item.organizations?.name || item.organization_id)}</b><small>${esc(item.organizations?.city || "")} · ${esc(item.organizations?.address || "")}</small></td><td>${esc(item.contact_name)}<small>${esc(item.user_id)}</small></td><td>${esc(item.contact_phone)}</td><td><a href="${esc(item.evidence_url)}" target="_blank" rel="noopener">Открыть ↗</a></td><td>${esc(new Date(item.created_at).toLocaleString("ru-RU"))}</td><td><div class="admin-actions"><button type="button" class="btn" data-claim-decision="approved" data-request-id="${esc(item.id)}">Одобрить</button><button type="button" class="btn btn--ghost" data-claim-decision="rejected" data-request-id="${esc(item.id)}">Отклонить</button></div></td></tr>`);
  }
  async function loadStatistics(organizationId) {
    const { summary } = await request("statistics", "GET", null, { organizationId });
    $("adminStatisticsMetrics").innerHTML = [["Сегодня", summary.today], ["7 дней", summary.days_7], ["30 дней", summary.days_30], ["За всё время", summary.all_time]].map(([label, value]) => `<article><span>${label}</span><b>${Number(value) || 0}</b></article>`).join("");
    const activity = Array.isArray(summary.activity) ? summary.activity : [];
    const maximum = Math.max(1, ...activity.map((item) => Number(item.count) || 0));
    const chart = $("adminStatisticsActivity");
    chart.innerHTML = activity.map((item) => `<span title="${esc(item.day)}: ${Number(item.count) || 0}" style="--bar:${Math.max(3, (Number(item.count) || 0) / maximum * 100)}%"></span>`).join("");
    chart.hidden = !activity.length;
  }

  async function loadSiteStatistics() {
    const session = await window.LocalHubAuth.client.auth.getSession();
    const token = session.data?.session?.access_token;
    if (!token) throw new Error("Сессия истекла. Войдите снова.");
    const response = await fetch("/api/site-analytics", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить статистику сайта.");
    const summary = data.summary || {};
    $("siteStatisticsMetrics").innerHTML = [["Просмотры сегодня", summary.today_views], ["Посещения сегодня", summary.today_visits], ["Уникальные браузеры сегодня", summary.today_visitors], ["Просмотры за 7 дней", summary.days_7_views], ["Посещения за 7 дней", summary.days_7_visits], ["Уникальные браузеры за 7 дней", summary.days_7_visitors], ["Просмотры за 30 дней", summary.days_30_views], ["Посещения за 30 дней", summary.days_30_visits], ["Уникальные браузеры за 30 дней", summary.days_30_visitors], ["Просмотры за всё время", summary.all_time_views]].map(([label, value]) => `<article><span>${label}</span><b>${Number(value) || 0}</b></article>`).join("");
    const activity = Array.isArray(summary.activity) ? summary.activity : [], max = Math.max(1, ...activity.map((day) => Number(day.views) || 0));
    const chart = $("siteStatisticsActivity");
    chart.innerHTML = activity.map((day) => `<span title="${esc(day.day)}: ${Number(day.views) || 0} просмотров · ${Number(day.visitors) || 0} посетителей" style="--bar:${Math.max(3, (Number(day.views) || 0) / max * 100)}%"></span>`).join("");
    chart.hidden = !activity.length;
    renderRows($("sitePopularPages"), summary.popular_pages || [], (page) => `<tr><td>${esc(page.page)}</td><td>${Number(page.views) || 0}</td></tr>`);
    renderRows($("sitePopularOrganizations"), summary.popular_organizations || [], (organization) => `<tr><td>${esc(organization.name || organization.id)}</td><td>${Number(organization.views) || 0}</td></tr>`);
    $("siteStatisticsStatus").hidden = false;
    $("siteStatisticsStatus").textContent = "Показатели рассчитаны по записанным и дедуплицированным событиям.";
  }

  async function activate() {
    const auth = window.LocalHubAuth;
    if (!auth?.ready) return message("Supabase не настроен. Для работы панели требуется реальная сессия и база данных.", true);
    const current = await auth.client.auth.getUser();
    const user = current.data?.user;
    if (current.error) return message("Не удалось проверить актуальную роль аккаунта.", true);
    if (!user) return message("Войдите в аккаунт, чтобы продолжить.", true);
    role = user.app_metadata?.role === "admin" ? "admin" : "user";
    $("adminRole").textContent = role;
    if (role === "user") return message("У этой учётной записи нет административных прав.", true);
    workspace.hidden = false;
    status.hidden = true;
    await loadSubmissions();
    if (role === "admin") await Promise.all([loadDashboard(), loadOrganizations(), loadUsers(), loadCategories(), loadEvents()]);
    else await loadEvents();
  }

  document.querySelectorAll("[data-admin-tab]").forEach((button) => button.addEventListener("click", async () => {
    document.querySelectorAll("[data-admin-tab]").forEach((tab) => tab.classList.toggle("is-active", tab === button));
    document.querySelectorAll("[data-admin-section]").forEach((section) => { section.hidden = section.dataset.adminSection !== button.dataset.adminTab; });
    try {
      if (button.dataset.adminTab === "submissions") await loadSubmissions();
      if (button.dataset.adminTab === "dashboard") await loadDashboard();
      if (button.dataset.adminTab === "users") await loadUsers();
      if (button.dataset.adminTab === "categories") await loadCategories();
      if (button.dataset.adminTab === "organizations") await loadOrganizations();
      if (button.dataset.adminTab === "events") await loadEvents();
      if (button.dataset.adminTab === "reports") await loadReports();
      if (button.dataset.adminTab === "badges") await loadBadges();
      if (button.dataset.adminTab === "campaigns") await loadCampaigns();
      if (button.dataset.adminTab === "owners") await loadOwners();
      if (button.dataset.adminTab === "verification") await loadVerificationRequests();
      if (button.dataset.adminTab === "business-claims") await loadBusinessClaims();
      if (button.dataset.adminTab === "site-statistics") await loadSiteStatistics();
    } catch (error) { message(error.message, true); }
  }));

  $("verificationRows")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-verification-decision]");
    if (!button) return;
    const decision = button.dataset.verificationDecision;
    const note = decision === "rejected" ? prompt("Причина отклонения:")?.trim() : "";
    if (decision === "rejected" && !note) return;
    button.disabled = true;
    try { await request("verification-review", "POST", { requestId: button.dataset.requestId, decision, note }); message("Решение по заявке сохранено."); await loadVerificationRequests(); }
    catch (error) { message(error.message, true); button.disabled = false; }
  });
  $("businessClaimRows")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-claim-decision]"); if (!button) return;
    const decision = button.dataset.claimDecision;
    const note = decision === "rejected" ? prompt("Причина отклонения:")?.trim() : "";
    if (decision === "rejected" && !note) return;
    button.disabled = true;
    try { await request("business-claim-review", "POST", { requestId: button.dataset.requestId, decision, note }); message("Решение по заявке сохранено."); await loadBusinessClaims(); }
    catch (error) { message(error.message, true); button.disabled = false; }
  });

  $("submissionStatus").addEventListener("change", () => loadSubmissions().catch((error) => message(error.message, true)));
  $("submissionRows").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-review]");
    if (!button) return;
    const reason = button.dataset.review === "rejected" ? prompt("Укажите причину отклонения:") : null;
    if (button.dataset.review === "rejected" && !reason?.trim()) return;
    if (!confirm(button.dataset.review === "approved" ? "Одобрить предложение и добавить организацию в каталог?" : "Отклонить предложение с указанной причиной?")) return;
    button.disabled = true;
    try {
      await request("review", "POST", { submissionId: button.dataset.id, decision: button.dataset.review, reason });
      message("Решение сохранено в базе данных.");
      await Promise.all([loadSubmissions(), role === "admin" ? loadDashboard() : Promise.resolve(), loadEvents()]);
    } catch (error) { message(error.message, true); button.disabled = false; }
  });

  $("categoryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    values.is_active = form.elements.namedItem("is_active").checked;
    try {
      await request("category-save", "POST", values);
      message("Категория сохранена.");
      form.reset();
      await loadCategories();
    } catch (error) { message(error.message, true); }
  });
  $("categoryRows").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-category-delete]");
    if (!button || !confirm("Удалить категорию? Связанные организации могут запретить удаление.")) return;
    try { await request("category-delete", "POST", { id: button.dataset.categoryDelete }); message("Категория удалена."); await loadCategories(); }
    catch (error) { message(error.message, true); }
  });
  $("organizationRows").addEventListener("click", async (event) => {
    const remove = event.target.closest("[data-organization-delete]");
    if (remove) {
      if (!confirm("Удалить эту организацию из опубликованного каталога?")) return;
      try { await request("organization-delete", "POST", { id: remove.dataset.organizationDelete }); message("Организация удалена из каталога."); await Promise.all([loadOrganizations(), loadDashboard()]); }
      catch (error) { message(error.message, true); }
      return;
    }
    const edit = event.target.closest("[data-organization-edit]");
    if (!edit) return;
    try {
      const { items } = await request("organizations");
      const item = (items || []).find((row) => row.id === edit.dataset.organizationEdit);
      if (!item) throw new Error("Организация больше не найдена.");
      const fields = ["name", "category_id", "city", "region", "address", "lat", "lon", "phone", "website", "photo", "hours", "rating", "rating_source", "source", "description", "price_summary", "services"];
      const updated = { id: item.id };
      for (const field of fields) {
        const value = prompt(`Измените ${field}:`, item[field] == null ? "" : String(item[field]));
        if (value === null) return;
        if (field === "services") updated[field] = value.trim() ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
        else updated[field] = ["lat", "lon", "rating"].includes(field) && value.trim() ? Number(value) : value.trim() || null;
      }
      if (!confirm("Сохранить изменения организации?")) return;
      await request("organization-update", "POST", updated);
      message("Изменения организации сохранены.");
      await loadOrganizations();
    } catch (error) { message(error.message, true); }
  });
  $("userRows").addEventListener("change", async (event) => {
    const select = event.target.closest("[data-user-role]");
    if (!select || !confirm(`Изменить роль пользователя на ${select.value}?`)) return loadUsers();
    try { await request("user-role", "POST", { userId: select.dataset.userRole, role: select.value }); message("Роль обновлена."); await loadUsers(); }
    catch (error) { message(error.message, true); }
  });
  $("userRows").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-user-block]");
    if (!button) return;
    const blocked = button.dataset.blocked !== "true";
    if (!confirm(blocked ? "Заблокировать пользователя?" : "Разблокировать пользователя?")) return;
    try { await request("user-block", "POST", { userId: button.dataset.userBlock, blocked }); message("Статус пользователя обновлён."); await loadUsers(); }
    catch (error) { message(error.message, true); }
  });

  $("reportRows").addEventListener("click", async (event) => {
    const history = event.target.closest("[data-report-history]");
    if (history) {
      try { const { items } = await request("report-events", "GET", null, { reportId: history.dataset.reportHistory }); const lines = (items || []).map((item) => `${new Date(item.created_at).toLocaleString("ru-RU")} · ${item.action} · ${JSON.stringify(item.details || {})}`); alert(lines.join("\n") || "История действий пуста."); }
      catch (error) { message(error.message, true); }
      return;
    }
    const button = event.target.closest("[data-report-save]"); if (!button) return;
    const select = document.querySelector(`[data-report-status="${CSS.escape(button.dataset.reportSave)}"]`);
    if (!select?.value) return message("Выберите новый статус жалобы.", true);
    try { await request("report-review", "POST", { reportId: button.dataset.reportSave, status: select.value, note: "" }); message("Статус жалобы обновлён."); await loadReports(); }
    catch (error) { message(error.message, true); }
  });
  $("badgeForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.expiresAt) values.expiresAt = new Date(values.expiresAt).toISOString(); else delete values.expiresAt;
    try { await request("badge-save", "POST", values); message("Метка сохранена."); event.currentTarget.reset(); await loadBadges(); }
    catch (error) { message(error.message, true); }
  });
  $("badgeRows").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-badge-delete]"); if (!button || !confirm("Снять эту метку?")) return;
    try { await request("badge-delete", "POST", { organizationId: button.dataset.badgeDelete, badgeType: button.dataset.badgeType }); message("Метка снята."); await loadBadges(); }
    catch (error) { message(error.message, true); }
  });
  $("campaignForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    for (const field of ["starts_at", "ends_at"]) if (values[field]) values[field] = new Date(values[field]).toISOString();
    try { await request("campaign-save", "POST", values); message("Кампания сохранена."); event.currentTarget.reset(); await loadCampaigns(); }
    catch (error) { message(error.message, true); }
  });
  $("campaignRows").addEventListener("click", async (event) => {
    const remove = event.target.closest("[data-campaign-delete]");
    if (remove) { if (!confirm("Удалить кампанию?")) return; try { await request("campaign-delete", "POST", { id: remove.dataset.campaignDelete }); message("Кампания удалена."); await loadCampaigns(); } catch (error) { message(error.message, true); } return; }
    const edit = event.target.closest("[data-campaign-edit]"); if (!edit) return;
    try {
      const { items } = await request("campaigns"); const item = items.find((row) => row.id === edit.dataset.campaignEdit); if (!item) return;
      const form = $("campaignForm"); for (const [key, value] of Object.entries(item)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = ["starts_at", "ends_at"].includes(key) ? new Date(value).toISOString().slice(0, 16) : value ?? "";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) { message(error.message, true); }
  });
  $("ownerForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    if (!confirm("Подтверждаете право этого пользователя управлять статистикой указанной организации?")) return;
    try { await request("owner-assign", "POST", values); message("Владелец организации подтверждён."); event.currentTarget.reset(); await loadOwners(); }
    catch (error) { message(error.message, true); }
  });
  $("ownerRows").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-owner-remove]"); if (!button || !confirm("Отозвать доступ владельца к аналитике?")) return;
    try { await request("owner-remove", "POST", { organizationId: button.dataset.ownerRemove, userId: button.dataset.userId }); message("Доступ отозван."); await loadOwners(); }
    catch (error) { message(error.message, true); }
  });
  $("adminStatisticsForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const value = new FormData(event.currentTarget).get("organizationId");
    try { await loadStatistics(String(value || "").trim()); $("adminStatisticsStatus").hidden = true; }
    catch (error) { $("adminStatisticsStatus").textContent = error.message; $("adminStatisticsStatus").hidden = false; $("adminStatisticsStatus").classList.add("is-error"); }
  });

  document.addEventListener("localhub:auth-ready", () => activate().catch((error) => message(error.message, true)));
  if (window.LocalHubAuth?.ready) activate().catch((error) => message(error.message, true));
})();
