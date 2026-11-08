"use strict";
const { getConfig, rest, send } = require("../lib/supabase-server");
const crypto = require("node:crypto");
const limits = new Map();
function limited(id, event, ceiling = 300, windowMs = 60_000) {
  const key = `${id}:${event}`;
  const now = Date.now();
  const current = limits.get(key);

  if (current && now - current.start < windowMs && current.count >= ceiling) {
    return true;
  }

  if (!current || now - current.start >= windowMs) {
    limits.set(key, { start: now, count: 1 });
  } else {
    current.count += 1;
  }

  if (limits.size > 2000) limits.clear();

  return false;
}
function requesterHash(req, secret) {
  const forwarded = req.headers?.["x-vercel-forwarded-for"] || req.socket?.remoteAddress || "";
  const address = String(forwarded).split(",")[0].trim();
  if (!address) return "";
  return crypto.createHmac("sha256", secret).update(address).digest("hex");
}
module.exports = async function ads(req, res) {
  const config = getConfig();
  if (req.method === "GET") {
    const placement = String(req.query?.placement || "home_banner");
    if (!["home_banner", "search", "category", "business"].includes(placement)) return send(res, 400, { error: "Недопустимый тип размещения.", code: "invalid_placement" });
    const result = await rest(config, `/rest/v1/ad_campaigns?select=id,name,organization_id,placement,image_url,destination_url,city,category_id,starts_at,ends_at&placement=eq.${encodeURIComponent(placement)}&status=eq.active&starts_at=lte.${encodeURIComponent(new Date().toISOString())}&ends_at=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.desc&limit=10`);
    if (!result.ok) return send(res, result.status, { error: "Рекламные блоки пока недоступны.", code: "ads_unavailable" });
    return send(res, 200, { items: result.data || [] });
  }
  if (req.method === "POST") {
    if (!config.adminKey) return send(res, 503, { error: "Счётчики рекламы не настроены.", code: "ads_unavailable" });
    const requester = requesterHash(req, config.adminKey);
    if (!requester || limited(`requester:${requester}`, "events", 600, 60_000)) return send(res, 202, { recorded: false });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (typeof body.campaignId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.campaignId) || !["impression", "click"].includes(body.event)) return send(res, 400, { error: "Недопустимое рекламное событие.", code: "invalid_event" });
    if (limited(body.campaignId, body.event)) return send(res, 202, { recorded: false });
    const result = await rest(config, "/rest/v1/rpc/record_ad_campaign_event", { method: "POST", admin: true, body: { p_campaign_id: body.campaignId, p_event: body.event, p_requester_hash: requester } });
    if (!result.ok) return send(res, 400, { error: "Событие не записано.", code: "event_rejected" });
    return send(res, 202, { recorded: result.data === true });
  }
  res.setHeader("Allow", "GET, POST"); return send(res, 405, { error: "Поддерживаются GET и POST.", code: "method_not_allowed" });
};
