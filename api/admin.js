"use strict";

const { authenticate, hasRole, rest, send } = require("../lib/supabase-server");
const requests = new Map();

function allowed(userId) {
  const now = Date.now();
  const entry = requests.get(userId);
  if (entry && now - entry.started < 60_000 && entry.count >= 30) return false;
  if (!entry || now - entry.started >= 60_000) requests.set(userId, { started: now, count: 1 });
  else entry.count += 1;
  if (requests.size > 1000) requests.clear();
  return true;
}

function inputBody(req) {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
}

function validId(value) {
  return typeof value === "string" && value.length >= 2 && value.length <= 100 && /^[a-zA-Z0-9:_-]+$/.test(value);
}

function validHttpsUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname; }
  catch { return false; }
}

async function userAdminRequest(config, userId, method, body) {
  if (!config.adminKey) return { ok: false, status: 503 };
  const headers = {
    apikey: config.adminKey,
    Authorization: `Bearer ${config.adminKey}`,
    Accept: "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch { return { ok: false, status: 502 }; }
  let data = null;
  try { data = await response.json(); } catch {}
  return { ok: response.ok, status: response.status, data };
}

async function recordUserAdminEvent(auth, action, targetId, details) {
  return rest(auth.config, "/rest/v1/rpc/record_admin_user_event", {
    method: "POST",
    admin: true,
    body: { p_actor_id: auth.user.id, p_action: action, p_entity_id: targetId, p_details: details },
  });
}

module.exports = async function admin(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Поддерживаются только GET и POST.", code: "method_not_allowed" });
  }
  const auth = await authenticate(req);
  if (auth.error) return send(res, auth.status, { error: auth.error, code: "auth_required" });
  if (!hasRole(auth.user, ["admin"])) return send(res, 403, { error: "Недостаточно прав.", code: "forbidden" });
  if (!allowed(auth.user.id)) return send(res, 429, { error: "Слишком много административных запросов.", code: "rate_limited" });

  const action = String(req.query?.action || "");
  const isAdmin = hasRole(auth.user, ["admin"]);

  if (req.method === "GET") {
    if (action === "dashboard") {
      if (!isAdmin) return send(res, 403, { error: "Панель статистики доступна администраторам.", code: "forbidden" });
      const result = await rest(auth.config, "/rest/v1/rpc/admin_dashboard_metrics", { method: "POST", token: auth.token, body: {} });
      if (!result.ok) return send(res, result.status, { error: "Не удалось получить реальные показатели.", code: "dashboard_unavailable" });
      return send(res, 200, { metrics: result.data });
    }
    if (action === "submissions") {
      const status = String(req.query?.status || "pending");
      if (!['pending', 'approved', 'rejected', 'all'].includes(status)) return send(res, 400, { error: "Недопустимый статус.", code: "invalid_status" });
      const filter = status === "all" ? "" : `&status=eq.${status}`;
      const result = await rest(auth.config, `/rest/v1/organization_submissions?select=id,organization_name,category_id,city,region,address,phone,website,photo,lat,lon,source,additional_info,status,rejection_reason,created_at,updated_at&order=created_at.desc&limit=100${filter}`, { token: auth.token });
      if (!result.ok) return send(res, result.status, { error: "Не удалось загрузить предложения.", code: "submissions_unavailable" });
      return send(res, 200, { items: result.data || [] });
    }
    if (action === "categories") {
      if (!isAdmin) return send(res, 403, { error: "Управление категориями доступно администраторам.", code: "forbidden" });
      const result = await rest(auth.config, "/rest/v1/categories?select=id,name,description,icon,is_active,created_at,updated_at&order=name", { token: auth.token });
      if (!result.ok) return send(res, result.status, { error: "Не удалось загрузить категории.", code: "categories_unavailable" });
      return send(res, 200, { items: result.data || [] });
    }
    if (action === "organizations") {
      if (!isAdmin) return send(res, 403, { error: "Управление организациями доступно только администраторам.", code: "forbidden" });
      const result = await rest(auth.config, "/rest/v1/organizations?select=id,name,category_id,city,region,address,lat,lon,phone,website,photo,hours,rating,rating_source,source,updated_at&order=updated_at.desc&limit=500", { token: auth.token });
      if (!result.ok) return send(res, result.status, { error: "Не удалось загрузить организации каталога.", code: "organizations_unavailable" });
      return send(res, 200, { items: result.data || [] });
    }
    if (action === "users") {
      if (!isAdmin) return send(res, 403, { error: "Управление пользователями доступно только администраторам.", code: "forbidden" });
      if (!auth.config.adminKey) return send(res, 503, { error: "Не настроен серверный ключ управления Supabase.", code: "admin_key_missing" });
      let result;
      try {
        const response = await fetch(`${auth.config.url}/auth/v1/admin/users?page=1&per_page=100`, {
          headers: { apikey: auth.config.adminKey, Authorization: `Bearer ${auth.config.adminKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        result = response.ok ? await response.json() : null;
        if (!response.ok) return send(res, 502, { error: "Не удалось загрузить список пользователей.", code: "users_unavailable" });
      } catch { return send(res, 502, { error: "Сервис пользователей Supabase временно недоступен.", code: "users_unavailable" }); }
      const users = Array.isArray(result?.users) ? result.users : [];
      return send(res, 200, { items: users.map((user) => ({
        id: user.id, email: user.email || null, created_at: user.created_at || null,
        last_sign_in_at: user.last_sign_in_at || null, banned_until: user.banned_until || null,
        role: user.app_metadata?.role === "admin" ? "admin" : "user",
      })) });
    }
    if (action === "events") {
      const result = await rest(auth.config, "/rest/v1/moderation_events?select=id,actor_id,action,entity_type,entity_id,details,created_at&order=created_at.desc&limit=100", { token: auth.token });
      if (!result.ok) return send(res, result.status, { error: "Не удалось загрузить журнал модерации.", code: "events_unavailable" });
      return send(res, 200, { items: result.data || [] });
    }
    return send(res, 400, { error: "Неизвестный раздел панели.", code: "unknown_action" });
  }

  const body = inputBody(req);
  if (action === "review") {
    if (!validId(body.submissionId) || !['approved', 'rejected'].includes(body.decision)) return send(res, 400, { error: "Проверьте решение и идентификатор предложения.", code: "invalid_review" });
    if (body.decision === "rejected" && (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 1000)) return send(res, 400, { error: "Для отклонения укажите причину длиной до 1000 символов.", code: "invalid_reason" });
    const result = await rest(auth.config, "/rest/v1/rpc/review_organization_submission", {
      method: "POST", token: auth.token,
      body: { p_submission_id: body.submissionId, p_decision: body.decision, p_rejection_reason: body.reason || null },
    });
    if (!result.ok) return send(res, result.status, { error: "Предложение не удалось обработать. Возможно, его уже рассмотрел другой сотрудник.", code: "review_failed" });
    return send(res, 200, { item: result.data });
  }
  if (!isAdmin) return send(res, 403, { error: "Это действие доступно только администраторам.", code: "forbidden" });

  if (action === "organization-update") {
    if (typeof body.id !== "string" || !/^[a-zA-Z0-9:_-]{2,100}$/.test(body.id)) return send(res, 400, { error: "Недопустимый идентификатор организации.", code: "invalid_organization" });
    const fields = ["name", "category_id", "city", "region", "address", "lat", "lon", "phone", "website", "photo", "hours", "rating", "rating_source", "source"];
    const payload = {};
    for (const field of fields) if (Object.hasOwn(body, field)) payload[field] = body[field];
    if (typeof payload.name !== "string" || payload.name.trim().length < 2 || payload.name.trim().length > 160 || typeof payload.city !== "string" || !payload.city.trim() || typeof payload.address !== "string" || !payload.address.trim() || typeof payload.category_id !== "string" || typeof payload.source !== "string" || !payload.source.trim()) return send(res, 400, { error: "Название, категория, город, адрес и источник обязательны.", code: "invalid_organization" });
    const textLimits = { city: 80, region: 100, address: 240, phone: 60, website: 500, photo: 500, hours: 240, rating_source: 160, source: 500 };
    for (const [field, max] of Object.entries(textLimits)) {
      if (payload[field] != null && (typeof payload[field] !== "string" || payload[field].trim().length > max)) return send(res, 400, { error: `Проверьте поле ${field}.`, code: "invalid_organization_field" });
      if (typeof payload[field] === "string") payload[field] = payload[field].trim() || null;
    }
    if (!/^[a-z0-9-]{2,60}$/.test(payload.category_id) || payload.source == null) return send(res, 400, { error: "Проверьте категорию и источник организации.", code: "invalid_organization_field" });
    const lat = payload.lat == null || payload.lat === "" ? null : Number(payload.lat);
    const lon = payload.lon == null || payload.lon === "" ? null : Number(payload.lon);
    if ((lat === null) !== (lon === null) || (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180))) return send(res, 400, { error: "Укажите корректные координаты вместе или очистите оба поля.", code: "invalid_coordinates" });
    payload.lat = lat; payload.lon = lon;
    const rating = payload.rating == null || payload.rating === "" ? null : Number(payload.rating);
    if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 9.99)) return send(res, 400, { error: "Укажите рейтинг от 0 до 9.99.", code: "invalid_rating" });
    payload.rating = rating;
    if (rating !== null && !payload.rating_source) return send(res, 400, { error: "Для рейтинга укажите источник.", code: "rating_source_required" });
    for (const field of ["website", "photo"]) if (payload[field] && !validHttpsUrl(payload[field])) return send(res, 400, { error: "Сайт и фотография должны быть корректными HTTPS-ссылками.", code: "invalid_url" });
    const result = await rest(auth.config, `/rest/v1/organizations?id=eq.${encodeURIComponent(body.id)}`, { method: "PATCH", token: auth.token, body: payload, prefer: "return=representation" });
    if (!result.ok) return send(res, result.status, { error: "Изменение не сохранено. Проверьте категорию и данные.", code: "organization_update_failed" });
    return send(res, 200, { item: Array.isArray(result.data) ? result.data[0] || null : result.data });
  }
  if (action === "organization-delete") {
    if (typeof body.id !== "string" || !/^[a-zA-Z0-9:_-]{2,100}$/.test(body.id)) return send(res, 400, { error: "Недопустимый идентификатор организации.", code: "invalid_organization" });
    const result = await rest(auth.config, `/rest/v1/organizations?id=eq.${encodeURIComponent(body.id)}`, { method: "DELETE", token: auth.token, prefer: "return=representation" });
    if (!result.ok) return send(res, result.status, { error: "Не удалось удалить организацию.", code: "organization_delete_failed" });
    return send(res, 200, { deleted: Array.isArray(result.data) && result.data.length > 0 });
  }

  if (action === "category-save") {
    const id = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
    if (!/^[a-z0-9-]{2,60}$/.test(id) || typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 100) {
      return send(res, 400, { error: "Проверьте идентификатор и название категории.", code: "invalid_category" });
    }
    const result = await rest(auth.config, "/rest/v1/categories?on_conflict=id", {
      method: "POST", token: auth.token,
      body: { id, name: body.name.trim(), description: typeof body.description === "string" ? body.description.trim().slice(0, 500) : "", icon: typeof body.icon === "string" ? body.icon.trim().slice(0, 12) || "⌖" : "⌖", is_active: body.is_active !== false },
      prefer: "resolution=merge-duplicates,return=representation",
    });
    if (!result.ok) return send(res, result.status, { error: "Категория не сохранена.", code: "category_save_failed" });
    return send(res, 200, { item: Array.isArray(result.data) ? result.data[0] : result.data });
  }
  if (action === "category-delete") {
    if (!validId(body.id)) return send(res, 400, { error: "Недопустимый идентификатор категории.", code: "invalid_category" });
    const result = await rest(auth.config, `/rest/v1/categories?id=eq.${encodeURIComponent(body.id)}`, { method: "DELETE", token: auth.token, prefer: "return=representation" });
    if (!result.ok) return send(res, result.status, { error: "Категория не удалена. Сначала удалите или переназначьте связанные организации.", code: "category_delete_failed" });
    return send(res, 200, { deleted: Array.isArray(result.data) ? result.data.length > 0 : true });
  }
  if (action === "user-role" || action === "user-block") {
    const targetId = typeof body.userId === "string" ? body.userId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) return send(res, 400, { error: "Недопустимый идентификатор пользователя.", code: "invalid_user" });
    if (targetId === auth.user.id) return send(res, 400, { error: "Нельзя менять собственную роль или блокировать свой аккаунт.", code: "self_action_denied" });
    if (action === "user-role" && !['user', 'admin'].includes(body.role)) return send(res, 400, { error: "Недопустимая роль.", code: "invalid_role" });
    if (action === "user-block" && typeof body.blocked !== "boolean") return send(res, 400, { error: "Укажите булево значение блокировки.", code: "invalid_block_state" });
    const current = await userAdminRequest(auth.config, targetId, "GET");
    if (!current.ok) return send(res, current.status, { error: "Не удалось загрузить целевого пользователя.", code: "user_not_found" });
    const appMetadata = { ...(current.data?.app_metadata || {}) };
    const update = action === "user-role"
      ? { app_metadata: { ...appMetadata, role: body.role } }
      : { ban_duration: body.blocked === true ? "876600h" : "none" };
    const changed = await userAdminRequest(auth.config, targetId, "PUT", update);
    if (!changed.ok) return send(res, changed.status, { error: "Изменение пользователя не сохранено.", code: "user_update_failed" });
    const auditAction = action === "user-role"
      ? "user_role_changed"
      : (body.blocked === true ? "user_blocked" : "user_unblocked");
    const auditDetails = action === "user-role"
      ? { previous_role: appMetadata.role || "user", new_role: body.role }
      : { blocked: body.blocked === true };
    const audit = await recordUserAdminEvent(auth, auditAction, targetId, auditDetails);
    if (!audit.ok) return send(res, 502, { error: "Изменение применено, но запись аудита не сохранилась. Проверьте журнал перед повтором.", code: "admin_change_audit_failed", committed: true });
    return send(res, 200, { updated: true, userId: targetId, role: action === "user-role" ? body.role : undefined, blocked: action === "user-block" ? body.blocked === true : undefined });
  }
  return send(res, 400, { error: "Неизвестное административное действие.", code: "unknown_action" });
};
