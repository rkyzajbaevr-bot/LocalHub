"use strict";
const crypto = require("node:crypto");
const { authenticate, getConfig, rest, send } = require("../lib/supabase-server");
const limits = new Map();
function allow(key) {
  const now = Date.now(), entry = limits.get(key);
  if (entry && now - entry.at < 60_000 && entry.count >= 120) return false;
  if (!entry || now - entry.at >= 60_000) limits.set(key, { at: now, count: 1 }); else entry.count += 1;
  if (limits.size > 5000) limits.clear();
  return true;
}
function validUuid(value) { return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value); }
module.exports = async function siteAnalytics(req, res) {
  if (req.method === "POST") {
    const config = getConfig();
    if (!config.adminKey) return send(res, 503, { error: "Аналитика сайта не настроена.", code: "analytics_unavailable" });
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (!validUuid(body.sessionId) || !validUuid(body.visitorId) || typeof body.page !== "string") return send(res, 400, { error: "Недопустимое событие.", code: "invalid_event" });
    const page = body.page.split(/[?#]/, 1)[0].toLowerCase();
    const allowedPages = new Set(["/", "/index.html", "/map.html", "/map", "/categories.html", "/categories", "/account.html", "/account", "/favorites.html", "/favorites", "/collections.html", "/collections", "/compare.html", "/compare", "/business.html", "/business", "/city.html", "/login", "/register", "/add", "/admin", "/assistant", "/assistant.html"]);
    if (!allowedPages.has(page) && !/^\/[a-z0-9-]{2,60}\/[a-z0-9-]{2,60}$/.test(page)) return send(res, 400, { error: "Недопустимый путь страницы.", code: "invalid_page" });
    const sessionHash = crypto.createHmac("sha256", config.adminKey).update(`session:${body.sessionId}`).digest("hex");
    const visitorHash = crypto.createHmac("sha256", config.adminKey).update(`visitor:${body.visitorId}`).digest("hex");
    const forwarded = req.headers?.["x-vercel-forwarded-for"] || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "";
    const address = String(forwarded).split(",")[0].trim();
    const requesterHash = address ? crypto.createHmac("sha256", config.adminKey).update(`requester:${address}`).digest("hex") : "unknown";
    if (!allow(`requester:${requesterHash}`) || !allow(`session:${sessionHash}`)) return send(res, 202, { recorded: false });
    const result = await rest(config, "/rest/v1/rpc/record_site_page_view", { method: "POST", admin: true, body: { p_page_path: page, p_visitor_hash: visitorHash, p_session_hash: sessionHash } });
    if (!result.ok) return send(res, 400, { error: "Событие не записано.", code: "event_rejected" });
    return send(res, 202, { recorded: result.data === true });
  }
  if (req.method === "GET") {
    const auth = await authenticate(req);
    if (auth.error) return send(res, auth.status, { error: auth.error, code: "auth_required" });
    const role = await rest(auth.config, "/rest/v1/rpc/current_app_role", { method: "POST", token: auth.token, body: {} });
    if (!role.ok || role.data !== "admin") return send(res, 403, { error: "Недостаточно прав.", code: "forbidden" });
    const result = await rest(auth.config, "/rest/v1/rpc/site_analytics_summary", { method: "POST", token: auth.token, body: {} });
    if (!result.ok) return send(res, 400, { error: "Не удалось получить статистику сайта.", code: "summary_unavailable" });
    return send(res, 200, { summary: result.data });
  }
  res.setHeader("Allow", "GET, POST");
  return send(res, 405, { error: "Поддерживаются GET и POST.", code: "method_not_allowed" });
};
