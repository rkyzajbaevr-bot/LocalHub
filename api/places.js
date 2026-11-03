"use strict";

const PAGE_SIZE = 10; // Safe for 2GIS demo keys.
const MAX_PAGE = 5; // 2GIS demo keys support up to five result pages.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const rateBuckets = new Map();

const CATEGORIES = Object.freeze({
  restaurant: "рестораны и кафе",
  dentistry: "стоматологии",
  medicine: "медицина",
  education: "образование",
  english: "курсы английского языка",
  beauty: "красота и здоровье",
  barbershop: "барбершопы",
  gym: "спортзалы",
  auto: "автосервисы",
  hotel: "гостиницы",
  shops: "магазины",
  entertainment: "развлечения",
});

function send(res, status, payload, extraHeaders = {}) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  return res.status(status).json(payload);
}

function checkRateLimit(req, res) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "")
    || req.socket?.remoteAddress
    || "unknown";
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
  }
  const bucket = rateBuckets.get(ip);
  if (bucket && now - bucket.startedAt < RATE_WINDOW_MS && bucket.count >= RATE_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - bucket.startedAt)) / 1000));
    send(res, 429, { error: "Слишком много поисковых запросов. Попробуйте позже.", code: "rate_limited" }, { "Retry-After": String(retryAfter) });
    return false;
  }
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.set(ip, { startedAt: now, count: 1 });
  else bucket.count += 1;
  // Keep this best-effort in-memory limiter bounded on warm serverless instances.
  if (rateBuckets.size > 1000) rateBuckets.clear();
  return true;
}

module.exports = async function places(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Поддерживается только GET.", code: "method_not_allowed" });
  }

  const rawKey = process.env.DGIS_API_KEY;
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  const configuration = {
    status: key ? "configured" : "missing",
    variable: "DGIS_API_KEY",
    deploymentEnvironment: process.env.VERCEL_ENV || "unknown",
  };

  // Safe, non-billable health check. It reports presence only, never the secret value.
  if (req.query?.diagnostic === "1") {
    return send(res, key ? 200 : 503, { configuration });
  }

  if (!key) {
    return send(res, 503, {
      error: "Поиск 2GIS пока не настроен: добавьте demo-ключ в переменную окружения DGIS_API_KEY на сервере.",
      code: "api_key_missing",
      status: "configuration_missing",
      diagnostic: configuration,
    });
  }

  const { city, category, page: rawPage = "1" } = req.query || {};
  if (typeof city !== "string" || city.trim().length < 2 || city.trim().length > 80 || !/^[\p{L}\p{M}\p{N} .’'-]+$/u.test(city.trim())) {
    return send(res, 400, { error: "Выберите корректный город.", code: "invalid_city" });
  }
  if (typeof category !== "string" || !Object.hasOwn(CATEGORIES, category)) {
    return send(res, 400, { error: "Выберите категорию из списка.", code: "invalid_category" });
  }
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return send(res, 400, { error: `В тестовом режиме доступны страницы 1–${MAX_PAGE} (до ${PAGE_SIZE} результатов на странице).`, code: "invalid_page" });
  }
  if (!checkRateLimit(req, res)) return;

  const upstreamUrl = new URL("https://catalog.api.2gis.com/3.0/items");
  upstreamUrl.searchParams.set("key", key);
  upstreamUrl.searchParams.set("q", `${CATEGORIES[category]} ${city.trim()}, Казахстан`);
  upstreamUrl.searchParams.set("locale", "ru_KZ");
  upstreamUrl.searchParams.set("page", String(page));
  upstreamUrl.searchParams.set("page_size", String(PAGE_SIZE));
  upstreamUrl.searchParams.set("fields", "items.point,items.address,items.full_address_name");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(upstreamUrl, { signal: controller.signal });
    let data;
    try {
      data = await upstream.json();
    } catch {
      return send(res, 502, { error: "2GIS вернул ответ, который не удалось прочитать.", code: "upstream_invalid_response" });
    }
    const apiCode = Number(data?.meta?.code || upstream.status);
    if (!upstream.ok || apiCode !== 200) {
      if (upstream.status === 429 || apiCode === 429) {
        return send(res, 429, { error: "2GIS временно ограничил поисковые запросы. Попробуйте позже.", code: "upstream_rate_limited" });
      }
      if (upstream.status === 401 || upstream.status === 403 || apiCode === 401 || apiCode === 403) {
        return send(res, 502, { error: "2GIS отклонил ключ или у ключа нет доступа к Places API. Проверьте demo-ключ и доступ продукта.", code: "upstream_key_rejected" });
      }
      return send(res, 502, { error: "Сервис 2GIS временно недоступен. Попробуйте позже.", code: "upstream_error" });
    }

    const result = data?.result || {};
    const items = Array.isArray(result.items) ? result.items : [];
    const businesses = items.map((item) => {
      const point = item.point && typeof item.point.lon === "number" && Number.isFinite(item.point.lon)
        && typeof item.point.lat === "number" && Number.isFinite(item.point.lat)
        ? { lon: item.point.lon, lat: item.point.lat }
        : null;
      return {
        id: typeof item.id === "string" ? item.id : null,
        name: typeof item.name === "string" ? item.name : null,
        address: typeof item.full_address_name === "string" ? item.full_address_name : (typeof item.address_name === "string" ? item.address_name : null),
        point,
        source: "2GIS",
      };
    });
    const total = Number.isFinite(Number(result.total)) ? Number(result.total) : businesses.length;
    return send(res, 200, {
      source: "2GIS",
      city: city.trim(),
      category,
      page,
      pageSize: PAGE_SIZE,
      total,
      maxPage: Math.min(MAX_PAGE, Math.ceil(total / PAGE_SIZE)),
      items: businesses,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return send(res, 504, { error: "2GIS не ответил вовремя. Попробуйте повторить поиск.", code: "upstream_timeout" });
    }
    return send(res, 502, { error: "Не удалось связаться с 2GIS. Проверьте соединение и попробуйте позже.", code: "upstream_unavailable" });
  } finally {
    clearTimeout(timeout);
  }
};

