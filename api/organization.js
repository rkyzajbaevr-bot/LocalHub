"use strict";
const { getConfig, rest, send } = require("../lib/supabase-server");
module.exports = async function organization(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Поддерживается только GET.", code: "method_not_allowed" }); }
  const id = String(req.query?.id || "");
  if (!/^[a-zA-Z0-9:_-]{2,100}$/.test(id)) return send(res, 400, { error: "Укажите корректный ID организации.", code: "invalid_organization" });
  const columns = "id,name,category_id,city,region,address,lat,lon,phone,website,photo,hours,rating,rating_source,source,updated_at,description,price_summary,services,published_at";
  const config = getConfig();
  let result = await rest(config, `/rest/v1/organizations?select=${columns}&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!result.ok && ["42703", "PGRST204"].includes(result.data?.code)) result = await rest(config, `/rest/v1/organizations?select=id,name,category_id,city,region,address,lat,lon,phone,website,photo,hours,rating,rating_source,source,updated_at&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!result.ok) return send(res, 502, { error: "Не удалось загрузить страницу организации.", code: "organization_unavailable" });
  const item = Array.isArray(result.data) ? result.data[0] : null;
  if (!item) return send(res, 404, { error: "Организация не найдена.", code: "organization_not_found" });
  item.category = item.category_id || "";
  item.ratingSource = item.rating_source;
  item.updatedAt = item.updated_at;
  const badgeResult = await rest(getConfig(), `/rest/v1/organization_badges?select=badge_type,source,starts_at,expires_at&organization_id=eq.${encodeURIComponent(id)}&starts_at=lte.${encodeURIComponent(new Date().toISOString())}&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(new Date().toISOString())})`);
  if (badgeResult.ok) item.badges = badgeResult.data || [];
  return send(res, 200, { item });
};
