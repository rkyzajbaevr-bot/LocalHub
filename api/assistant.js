"use strict";
const { getConfig, rest, send } = require("../lib/supabase-server");
const CITIES = new Set(["Алматы", "Астана", "Шымкент", "Актобе", "Актау", "Атырау", "Караганда", "Павлодар", "Костанай", "Уральск", "Кызылорда", "Тараз", "Туркестан", "Кокшетау", "Петропавловск", "Усть-Каменогорск", "Семей", "Жезказган", "Темиртау", "Экибастуз"]);
const CATEGORIES = new Set(["restaurant", "dentistry", "medicine", "education", "english", "beauty", "barbershop", "gym", "auto", "hotel", "shops", "entertainment"]);
const limits = new Map();
function allow(key) { const now = Date.now(), row = limits.get(key); if (row && now - row.at < 60_000 && row.count >= 8) return false; if (!row || now - row.at >= 60_000) limits.set(key, { at: now, count: 1 }); else row.count += 1; if (limits.size > 2000) limits.clear(); return true; }
function outputText(data) { for (const item of data?.output || []) for (const part of item.content || []) if (part.type === "output_text" && typeof part.text === "string") return part.text; return ""; }
module.exports = async function assistant(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Поддерживается только POST.", code: "method_not_allowed" }); }
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) return send(res, 503, { error: "AI-помощник не настроен: требуется серверный OPENAI_API_KEY.", code: "ai_key_missing" });
  const config = getConfig();
  if (!config.adminKey) return send(res, 503, { error: "Каталог LocalHub не настроен.", code: "catalog_unavailable" });
  const forwarded = req.headers?.["x-vercel-forwarded-for"] || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  if (!allow(String(forwarded).split(",")[0].trim())) return send(res, 429, { error: "Слишком много запросов. Попробуйте позже.", code: "rate_limited" });
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  if (typeof body.message !== "string" || body.message.trim().length < 2 || body.message.length > 500) return send(res, 400, { error: "Введите запрос длиной от 2 до 500 символов.", code: "invalid_message" });
  const history = Array.isArray(body.history) ? body.history.slice(-6).filter((item) => ["user", "assistant"].includes(item?.role) && typeof item.content === "string").map((item) => ({ role: item.role, content: item.content.slice(0, 500) })) : [];
  const schema = { type: "object", additionalProperties: false, properties: {
    reply: { type: "string" }, city: { type: "string", enum: ["", ...CITIES] }, category: { type: "string", enum: ["", ...CATEGORIES] }, query: { type: "string" },
  }, required: ["reply", "city", "category", "query"] };
  const input = [...history, { role: "user", content: body.message.trim() }];
  let aiResponse;
  try {
    aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", store: false, max_output_tokens: 350,
        instructions: "Ты помощник каталога LocalHub Kazakhstan. Понимай запрос на русском, казахском или английском. Возвращай только заданные поля JSON. Город указывай только если его можно сопоставить с городом Казахстана, иначе пустую строку. Категорию выбирай только из списка: restaurant, dentistry, medicine, education, english, beauty, barbershop, gym, auto, hotel, shops, entertainment. Если пользователь просит найти место, query должен содержать короткие ключевые слова или быть пустым. Не выдумывай организации, рейтинги, адреса или наличие услуг. reply — краткий ответ до поиска; сообщай, что результаты будут только из каталога LocalHub.",
        input, text: { format: { type: "json_schema", name: "localhub_search", strict: true, schema } } }), signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    return send(res, error?.name === "AbortError" ? 504 : 502, { error: "AI-помощник временно недоступен.", code: "ai_unavailable" });
  }
  const aiData = await aiResponse.json().catch(() => ({}));
  if (!aiResponse.ok) return send(res, aiResponse.status === 429 ? 429 : 502, { error: aiResponse.status === 429 ? "Лимит AI-запросов провайдера достигнут." : "Не удалось обработать запрос AI-помощником.", code: "ai_upstream_error" });
  let parsed;
  try { parsed = JSON.parse(outputText(aiData)); } catch { return send(res, 502, { error: "AI вернул ответ, который не удалось обработать.", code: "ai_invalid_response" }); }
  const city = CITIES.has(parsed.city) ? parsed.city : "", category = CATEGORIES.has(parsed.category) ? parsed.category : "";
  const term = typeof parsed.query === "string" ? parsed.query.trim().slice(0, 80) : "";
  let items = [];
  if (city || category || term) {
    const columns = "id,name,category_id,city,region,address,lat,lon,phone,website,photo,hours,rating,rating_source,source,published_at,updated_at";
    const filters = `${city ? `&city=eq.${encodeURIComponent(city)}` : ""}${category ? `&category_id=eq.${category}` : ""}`;
    const safeTerm = term.replace(/[^\p{L}\p{M}\p{N} .'’-]/gu, " ").trim();
    const textFilter = safeTerm ? `&or=${encodeURIComponent(`(name.ilike.*${safeTerm}*,address.ilike.*${safeTerm}*)`)}` : "";
    const catalog = await rest(config, `/rest/v1/organizations?select=${columns}${filters}${textFilter}&order=name&limit=12`, { admin: true });
    if (!catalog.ok) return send(res, 502, { error: "Не удалось выполнить поиск в каталоге LocalHub.", code: "catalog_search_failed" });
    items = catalog.data || [];
  }
  return send(res, 200, { reply: String(parsed.reply || "").slice(0, 500), filters: { city, category, query: term }, items });
};
