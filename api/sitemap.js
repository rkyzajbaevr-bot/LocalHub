"use strict";
const { getConfig, rest } = require("../lib/supabase-server");
const CITY_SLUGS = new Map([["Алматы", "almaty"], ["Астана", "astana"], ["Шымкент", "shymkent"], ["Актобе", "aktobe"], ["Актау", "aktau"], ["Атырау", "atyrau"], ["Караганда", "karaganda"], ["Павлодар", "pavlodar"], ["Костанай", "kostanay"], ["Уральск", "uralsk"], ["Кызылорда", "kyzylorda"], ["Тараз", "taraz"], ["Туркестан", "turkistan"], ["Кокшетау", "kokshetau"], ["Петропавловск", "petropavl"], ["Усть-Каменогорск", "oskemen"], ["Семей", "semey"], ["Жезказган", "zhezkazgan"], ["Темиртау", "temirtau"], ["Экибастуз", "ekibastuz"]]);
const CATEGORY_SLUGS = new Map([["restaurant", "restaurants"], ["dentistry", "dentistry"], ["medicine", "medicine"], ["education", "education"], ["english", "english-courses"], ["beauty", "beauty"], ["barbershop", "barbershops"], ["gym", "gyms"], ["auto", "auto-services"], ["hotel", "hotels"], ["shops", "shops"], ["entertainment", "entertainment"]]);
module.exports = async function sitemap(req, res) {
  const config = getConfig();
  const result = await rest(config, "/rest/v1/organizations?select=city,category_id&limit=5000");
  const host = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || req.headers?.host || "localhost").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const origin = `https://${/^[a-z0-9.-]+(?::\d+)?$/i.test(host) ? host : "localhost"}`;
  const urls = new Set([`${origin}/`, `${origin}/categories.html`]);
  if (result.ok && Array.isArray(result.data)) for (const item of result.data) {
    const city = CITY_SLUGS.get(item.city), category = CATEGORY_SLUGS.get(item.category_id);
    if (city) urls.add(`${origin}/city/${city}`);
    if (city && category) urls.add(`${origin}/${city}/${category}`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...urls].map((url) => `<url><loc>${url.replace(/&/g, "&amp;")}</loc></url>`).join("")}</urlset>`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=900");
  return res.status(200).send(xml);
};
