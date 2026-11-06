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
    } catch (error) { message(error.message, true); }
  }));

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
      const fields = ["name", "category_id", "city", "region", "address", "lat", "lon", "phone", "website", "photo", "hours", "rating", "rating_source", "source"];
      const updated = { id: item.id };
      for (const field of fields) {
        const value = prompt(`Измените ${field}:`, item[field] == null ? "" : String(item[field]));
        if (value === null) return;
        updated[field] = ["lat", "lon", "rating"].includes(field) && value.trim() ? Number(value) : value.trim() || null;
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

  document.addEventListener("localhub:auth-ready", () => activate().catch((error) => message(error.message, true)));
  if (window.LocalHubAuth?.ready) activate().catch((error) => message(error.message, true));
})();
