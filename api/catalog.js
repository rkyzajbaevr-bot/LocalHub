"use strict";
const { getConfig, rest, send } = require("../lib/supabase-server");
const CITIES = new Set(["Алматы", "Астана", "Шымкент", "Актобе", "Актау", "Атырау", "Караганда", "Павлодар", "Костанай", "Уральск", "Кызылорда", "Тараз", "Туркестан", "Кокшетау", "Петропавловск", "Усть-Каменогорск", "Семей", "Жезказган", "Темиртау", "Экибастуз"]);
const CATEGORIES = new Set(["restaurant", "dentistry", "medicine", "education", "english", "beauty", "barbershop", "gym", "auto", "hotel", "shops", "entertainment"]);
module.exports = async function catalog(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Поддерживается только GET.", code: "method_not_allowed" }); }
  const city = String(req.query?.city || ""); const category = String(req.query?.category || "");
  const search = String(req.query?.search || "").trim();
  const page = Math.max(1, Math.min(20, Number.parseInt(req.query?.page, 10) || 1));
  if (!CITIES.has(city) || (category && !CATEGORIES.has(category)) || search.length > 100) return send(res, 400, { error: "Недопустимый город, категория или поисковая фраза.", code: "invalid_catalog_filter" });
  const core = "id,name,category_id,city,region,address,lat,lon,phone,website,photo,hours,rating,rating_source,source,updated_at";
  const extra = ",description,price_summary,services";
  const escaped = search.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[%_*]/g, (value) => `\\${value}`);
  const textFilter = escaped ? `&or=${encodeURIComponent(`(name.ilike."*${escaped}*",address.ilike."*${escaped}*")`)}` : "";
  const filters = `&city=eq.${encodeURIComponent(city)}${category ? `&category_id=eq.${encodeURIComponent(category)}` : ""}${textFilter}&order=name&limit=50&offset=${(page - 1) * 50}`;
  let result = await rest(getConfig(), `/rest/v1/organizations?select=${core}${extra}${filters}`, { prefer: "count=exact" });
  if (!result.ok && ["42703", "PGRST204"].includes(result.data?.code)) result = await rest(getConfig(), `/rest/v1/organizations?select=${core}${filters}`, { prefer: "count=exact" });
  if (!result.ok) return send(res, result.status, { error: "Каталог города временно недоступен.", code: "catalog_unavailable" });
  const range = result.headers?.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  const items = Array.isArray(result.data) ? result.data : [];
  return send(res, 200, { items, total: Number.isFinite(total) ? total : null, hasMore: items.length === 50, page, pageSize: 50 });
};
