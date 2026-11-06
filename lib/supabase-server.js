"use strict";

function getConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  const adminKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, publishableKey, adminKey, configured: Boolean(url && publishableKey) };
}

function send(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function bearerToken(req) {
  const value = req.headers?.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return "";
  const token = value.slice(7).trim();
  return token.length <= 8192 ? token : "";
}

async function authenticate(req) {
  const config = getConfig();
  if (!config.configured) return { error: "Supabase не настроен.", status: 503 };
  const token = bearerToken(req);
  if (!token) return { error: "Требуется вход в аккаунт.", status: 401 };
  let response;
  try {
    response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { error: "Не удалось проверить сессию. Попробуйте позже.", status: 502 };
  }
  if (!response.ok) return { error: "Сессия истекла. Войдите снова.", status: 401 };
  let user;
  try { user = await response.json(); } catch { return { error: "Не удалось прочитать ответ авторизации.", status: 502 }; }
  if (!user || typeof user.id !== "string") return { error: "Недействительная сессия.", status: 401 };
  return { user, token, config };
}

function roleOf(user) {
  return user?.app_metadata?.role === "admin" ? "admin" : "user";
}

function hasRole(user, allowed) {
  const role = roleOf(user);
  return allowed.includes(role);
}

async function rest(config, path, { method = "GET", token, body, admin = false, prefer } = {}) {
  const key = admin ? config.adminKey : config.publishableKey;
  if (!key) return { ok: false, status: 503, data: { message: "Серверная конфигурация Supabase отсутствует." } };
  const headers = { apikey: key, Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (admin) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  let response;
  try {
    response = await fetch(`${config.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { ok: false, status: 502, data: { message: "Supabase временно недоступен." } };
  }
  let data = null;
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { ok: response.ok, status: response.status, data, headers: response.headers };
}

module.exports = { authenticate, bearerToken, getConfig, hasRole, rest, roleOf, send };
