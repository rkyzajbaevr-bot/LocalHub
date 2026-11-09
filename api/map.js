"use strict";
const { getConfig, rest, send } = require("../lib/supabase-server");
const CITIES = Object.freeze({
  "Алматы": [76.945, 43.238], "Астана": [71.43, 51.16], "Шымкент": [69.59, 42.32], "Актобе": [57.17, 50.28],
  "Актау": [51.16, 43.65], "Атырау": [51.89, 47.11], "Караганда": [73.1, 49.8], "Павлодар": [76.95, 52.29],
  "Костанай": [63.62, 53.21], "Уральск": [51.37, 51.23], "Кызылорда": [65.48, 44.85], "Тараз": [71.37, 42.9],
  "Туркестан": [68.27, 43.3], "Кокшетау": [69.39, 53.28], "Петропавловск": [69.15, 54.87],
  "Усть-Каменогорск": [82.61, 49.95], "Семей": [80.23, 50.41], "Жезказган": [67.71, 47.78],
  "Темиртау": [72.96, 50.05], "Экибастуз": [75.32, 51.73],
});
const limits = new Map();
const CATEGORY_ID = /^[a-z0-9-]{2,60}$/;
function normalizeOrganization(row) {
  const lat = row.lat == null ? null : Number(row.lat);
  const lon = row.lon == null ? null : Number(row.lon);
  return {
    ...row,
    id: String(row.id),
    category: row.category_id || "",
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    rating: row.rating == null ? null : Number(row.rating),
    ratingSource: row.rating_source || null,
    updatedAt: row.updated_at || null,
  };
}
function completeCitySummaries(rows) {
  const actual = new Map();
  for (const row of rows || []) {
    const name = row.city || row.name;
    if (typeof name !== "string" || !name) continue;
    const center = CITIES[name] || row.center || (row.center_lon != null && row.center_lat != null && Number.isFinite(Number(row.center_lon)) && Number.isFinite(Number(row.center_lat)) ? [Number(row.center_lon), Number(row.center_lat)] : null);
    const count = Number(row.organization_count ?? row.count) || 0;
    if (center && center.length === 2) actual.set(name, { name, count, center });
  }
  for (const [name, center] of Object.entries(CITIES)) {
    if (!actual.has(name)) actual.set(name, { name, count: 0, center });
  }
  return [...actual.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
function respond(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", status === 200 ? "public, max-age=30, stale-while-revalidate=60" : "no-store");
  return res.status(status).json(body);
}
module.exports = async function map(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return respond(res, 405, { error: "Поддерживается только GET." }); }
  const config = getConfig();
  if (!config.adminKey) return respond(res, 503, { error: "Каталог карты не настроен.", code: "map_unavailable" });
  const forwarded = req.headers?.["x-vercel-forwarded-for"] || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  const requester = String(forwarded).split(",")[0].trim(), now = Date.now(), bucket = limits.get(requester);
  if (bucket && now - bucket.started < 60_000 && bucket.count >= 90) return respond(res, 429, { error: "Слишком много запросов к карте. Подождите минуту.", code: "rate_limited" });
  if (!bucket || now - bucket.started >= 60_000) limits.set(requester, { started: now, count: 1 }); else bucket.count += 1;
  if (limits.size > 2000) limits.clear();
  if (req.query?.mode === "cities") {
    const requestedCategory = String(req.query?.category || "");
    if (requestedCategory && !CATEGORY_ID.test(requestedCategory)) return respond(res, 400, { error: "Недопустимая категория.", code: "invalid_category" });
    let result = await rest(config, "/rest/v1/rpc/public_map_city_counts", { method: "POST", admin: true, body: { p_category: requestedCategory || null } });
    if (!result.ok && result.data?.code === "PGRST202") {
      // The main organizations table predates the city-count RPC. Keep the map
      // usable before the additive migration is applied, deriving centers only
      // from real geocoded organization rows and failing closed if truncated.
      const filter = requestedCategory ? `&category_id=eq.${requestedCategory}` : "";
      const fallback = await rest(config, `/rest/v1/organizations?select=city,lat,lon&lat=gte.40&lat=lte.56&lon=gte.45&lon=lte.88${filter}&order=city&limit=1000`, { admin: true, prefer: "count=exact" });
      if (!fallback.ok) return respond(res, 502, { error: "Не удалось загрузить число организаций по городам.", code: "city_counts_unavailable" });
      const total = Number((fallback.headers?.get("content-range") || "").split("/")[1]);
      if (Number.isFinite(total) && total > (fallback.data || []).length) return respond(res, 503, { error: "Для полного списка городов примените миграцию LocalHub; текущий резервный запрос ограничен.", code: "city_counts_migration_required" });
      const grouped = new Map();
      for (const row of fallback.data || []) {
        if (!row.city || !Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lon))) continue;
        const item = grouped.get(row.city) || { name: row.city, count: 0, lat: 0, lon: 0 };
        item.count += 1; item.lat += Number(row.lat); item.lon += Number(row.lon); grouped.set(row.city, item);
      }
      const cities = completeCitySummaries([...grouped.values()].map((row) => ({ name: row.name, count: row.count, center: [row.lon / row.count, row.lat / row.count] })));
      return respond(res, 200, { cities, source: "organizations_fallback" });
    }
    if (!result.ok) return respond(res, 502, { error: "Не удалось загрузить число организаций по городам.", code: "city_counts_unavailable" });
    return respond(res, 200, { cities: completeCitySummaries(result.data || []), source: "city_counts_rpc" });
  }
  if (req.query?.mode === "search") {
    const term = String(req.query?.q || "").trim();
    const category = String(req.query?.category || ""), city = String(req.query?.city || "");
    if (term.length < 2 || term.length > 100 || !/^[\p{L}\p{M}\p{N} .'’-]+$/u.test(term) || (category && !CATEGORY_ID.test(category)) || (city && (city.length > 80 || !/^[\p{L}\p{M}\p{N} .’'-]+$/u.test(city)))) return respond(res, 400, { error: "Уточните запрос или проверьте фильтры.", code: "invalid_search" });
    const escaped = term.replace(/[%_*]/g, (value) => `\\${value}`);
    const filter = encodeURIComponent(`(name.ilike.*${escaped}*,address.ilike.*${escaped}*)`);
    const columns = "id,name,category_id,city,region,address,lat,lon,phone,website,photo,hours,rating,rating_source,source,published_at,updated_at";
    const query = `/rest/v1/organizations?select=${columns}&lat=gte.40&lat=lte.56&lon=gte.45&lon=lte.88&or=${filter}${category ? `&category_id=eq.${category}` : ""}${city ? `&city=eq.${encodeURIComponent(city)}` : ""}&order=name&limit=100`;
    const result = await rest(config, query, { admin: true });
    if (!result.ok) return respond(res, 502, { error: "Поиск по организациям временно недоступен.", code: "map_search_unavailable" });
    return respond(res, 200, { items: (result.data || []).map(normalizeOrganization) });
  }
  const raw = String(req.query?.bbox || "").split(",").map(Number);
  if (raw.length !== 4 || raw.some((value) => !Number.isFinite(value)) || raw[0] < -90 || raw[2] > 90 || raw[1] < -180 || raw[3] > 180 || raw[0] >= raw[2] || raw[1] >= raw[3]) return respond(res, 400, { error: "Недопустимая область карты.", code: "invalid_bounds" });
  const category = String(req.query?.category || "");
  const city = String(req.query?.city || "");
  if ((category && !CATEGORY_ID.test(category)) || (city && (city.length > 80 || !/^[\p{L}\p{M}\p{N} .’'-]+$/u.test(city)))) return respond(res, 400, { error: "Недопустимый фильтр карты.", code: "invalid_filter" });
  const south = Math.max(40, raw[0]), west = Math.max(45, raw[1]), north = Math.min(56, raw[2]), east = Math.min(88, raw[3]);
  if (south >= north || west >= east) return respond(res, 200, { items: [], limited: false });
  const columns = "id,name,category_id,city,region,address,lat,lon,phone,website,photo,hours,rating,rating_source,source,published_at,updated_at";
  const query = `/rest/v1/organizations?select=${columns}&lat=gte.${south}&lat=lte.${north}&lon=gte.${west}&lon=lte.${east}${category ? `&category_id=eq.${category}` : ""}${city ? `&city=eq.${encodeURIComponent(city)}` : ""}&order=name&limit=250`;
  const result = await rest(config, query, { admin: true });
  if (!result.ok) return respond(res, 502, { error: "Не удалось загрузить организации в области карты.", code: "map_places_unavailable" });
  return respond(res, 200, { items: (result.data || []).map(normalizeOrganization), limited: (result.data || []).length === 250 });
};
