"use strict";
const crypto = require("node:crypto");
const { authenticate, getConfig, rest, send } = require("../lib/supabase-server");
const limits = new Map();
function withinLimit(key, ceiling, windowMs) {
  const now = Date.now(); const current = limits.get(key);
  if (current && now - current.start < windowMs && current.count >= ceiling) return false;
  if (!current || now - current.start >= windowMs) limits.set(key, { start: now, count: 1 }); else current.count += 1;
  if (limits.size > 5000) limits.clear();
  return true;
}
function requesterHash(req, secret) {
  const forwarded = req.headers?.["x-vercel-forwarded-for"] || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "";
  const address = String(forwarded).split(",")[0].trim();
  return address ? crypto.createHmac("sha256", secret).update(address).digest("hex") : "";
}
module.exports = async function analytics(req, res) {
  const config = getConfig();
  if (req.method === "POST") {
    if (!config.adminKey) return send(res, 503, { error: "Серверная аналитика не настроена.", code: "analytics_unavailable" });
    const requester = requesterHash(req, config.adminKey);
    if (requester && !withinLimit(`requester:${requester}`, 120, 60_000)) return send(res, 202, { recorded: false });
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const actions = new Set(["view", "website", "whatsapp", "phone", "route"]);
    if (typeof body.organizationId !== "string" || body.organizationId.length < 1 || body.organizationId.length > 100 || !actions.has(body.action) || typeof body.sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.sessionId)) return send(res, 400, { error: "Недопустимое событие аналитики.", code: "invalid_event" });
    const hash = crypto.createHmac("sha256", config.adminKey).update(body.sessionId).digest("hex");
    const key = `${body.organizationId}:${body.action}:${hash}`;
    if (!withinLimit(key, 1, 30_000)) return send(res, 202, { recorded: false });
    const result = await rest(config, "/rest/v1/rpc/record_business_analytics_event", { method: "POST", admin: true, body: { p_organization_id: body.organizationId, p_action: body.action, p_session_hash: hash } });
    if (!result.ok) return send(res, 400, { error: "Событие не записано.", code: "event_rejected" });
    return send(res, 202, { recorded: result.data === true });
  }
  if (req.method === "GET") {
    const auth = await authenticate(req);
    if (auth.error) return send(res, auth.status, { error: auth.error, code: "auth_required" });
    const organizationId = String(req.query?.organizationId || "");
    if (!organizationId || organizationId.length > 100) return send(res, 400, { error: "Укажите организацию.", code: "invalid_organization" });
    const result = await rest(auth.config, "/rest/v1/rpc/business_analytics_summary", { method: "POST", token: auth.token, body: { p_organization_id: organizationId } });
    if (!result.ok) return send(res, result.status === 403 ? 403 : 400, { error: "Статистика доступна только подтверждённому владельцу организации и администратору.", code: "analytics_forbidden" });
    return send(res, 200, { summary: result.data });
  }
  res.setHeader("Allow", "GET, POST"); return send(res, 405, { error: "Поддерживаются GET и POST.", code: "method_not_allowed" });
};
