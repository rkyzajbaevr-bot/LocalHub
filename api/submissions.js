"use strict";

const { authenticate, rest, send } = require("../lib/supabase-server");

const limits = new Map();

function rateAllowed(userId) {
  const now = Date.now();
  const prior = limits.get(userId);
  if (prior && now - prior.started < 60_000 && prior.count >= 8) return false;
  if (!prior || now - prior.started >= 60_000) limits.set(userId, { started: now, count: 1 });
  else prior.count += 1;
  if (limits.size > 1000) limits.clear();
  return true;
}

function validText(value, min, max) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function validHttpsUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname; }
  catch { return false; }
}

module.exports = async function submissions(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Поддерживаются только GET и POST.", code: "method_not_allowed" });
  }
  const auth = await authenticate(req);
  if (auth.error) return send(res, auth.status, { error: auth.error, code: "auth_required" });
  if (req.method === "POST" && !rateAllowed(auth.user.id)) return send(res, 429, { error: "Слишком много предложений. Попробуйте позже.", code: "rate_limited" });

  if (req.method === "GET") {
    const result = await rest(auth.config, "/rest/v1/organization_submissions?select=id,organization_name,category_id,city,region,address,phone,website,photo,lat,lon,source,additional_info,status,rejection_reason,created_at,updated_at&order=created_at.desc&limit=100", { token: auth.token });
    if (!result.ok) return send(res, result.status, { error: "Не удалось загрузить ваши предложения.", code: "submissions_unavailable" });
    return send(res, 200, { items: Array.isArray(result.data) ? result.data : [] });
  }

  const input = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const name = typeof input.organization_name === "string" ? input.organization_name.trim() : "";
  const city = typeof input.city === "string" ? input.city.trim() : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";
  if (!validText(name, 2, 160) || !validText(city, 2, 80) || !validText(address, 2, 240)
    || typeof input.category_id !== "string" || !/^[a-z0-9-]{2,60}$/.test(input.category_id)) {
    return send(res, 400, { error: "Проверьте название, категорию, город и адрес.", code: "invalid_submission" });
  }
  const category = await rest(auth.config, `/rest/v1/categories?id=eq.${encodeURIComponent(input.category_id)}&is_active=eq.true&select=id&limit=1`, { token: auth.token });
  if (!category.ok || !Array.isArray(category.data) || category.data.length !== 1) {
    return send(res, 400, { error: "Выберите активную категорию каталога.", code: "invalid_category" });
  }
  if ((input.website != null && typeof input.website !== "string") || (input.photo != null && typeof input.photo !== "string")) {
    return send(res, 400, { error: "Сайт и фотография должны быть текстовыми HTTPS-ссылками.", code: "invalid_url" });
  }
  const website = input.website == null || input.website === "" ? null : input.website.trim();
  if (website && (website.length > 500 || !validHttpsUrl(website))) {
    return send(res, 400, { error: "Сайт должен начинаться с https://.", code: "invalid_website" });
  }
  const photo = input.photo == null || input.photo === "" ? null : input.photo.trim();
  if (photo && (photo.length > 500 || !validHttpsUrl(photo))) {
    return send(res, 400, { error: "Фотография должна начинаться с https://.", code: "invalid_photo" });
  }
  const lat = input.lat == null || input.lat === "" ? null : Number(input.lat);
  const lon = input.lon == null || input.lon === "" ? null : Number(input.lon);
  if ((lat === null) !== (lon === null) || (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180))) {
    return send(res, 400, { error: "Укажите корректные широту и долготу вместе или оставьте оба поля пустыми.", code: "invalid_coordinates" });
  }
  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (!validText(source, 3, 500)) return send(res, 400, { error: "Укажите источник данных.", code: "invalid_source" });
  if ((input.region != null && (typeof input.region !== "string" || input.region.trim().length > 100))
    || (input.phone != null && (typeof input.phone !== "string" || input.phone.trim().length > 60))
    || (input.additional_info != null && (typeof input.additional_info !== "string" || input.additional_info.trim().length > 2000))) {
    return send(res, 400, { error: "Проверьте длину и формат дополнительных полей.", code: "invalid_optional_fields" });
  }
  const payload = {
    user_id: auth.user.id,
    organization_name: name,
    category_id: input.category_id,
    city,
    region: typeof input.region === "string" ? input.region.trim().slice(0, 100) || null : null,
    address,
    phone: typeof input.phone === "string" ? input.phone.trim().slice(0, 60) || null : null,
    website,
    photo,
    lat,
    lon,
    source,
    additional_info: typeof input.additional_info === "string" ? input.additional_info.trim().slice(0, 2000) || null : null,
  };
  if (!auth.config.adminKey) return send(res, 503, { error: "Серверная запись предложений не настроена.", code: "submission_backend_not_configured" });
  const result = await rest(auth.config, "/rest/v1/organization_submissions?select=id,status,created_at", {
    method: "POST", admin: true, body: payload, prefer: "return=representation",
  });
  if (!result.ok) return send(res, result.status, { error: "Предложение не сохранено. Попробуйте ещё раз.", code: "submission_failed" });
  return send(res, 201, { item: Array.isArray(result.data) ? result.data[0] : result.data });
};
