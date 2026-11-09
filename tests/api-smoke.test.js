"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

function responseStub() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    send(payload) { this.payload = payload; return this; },
  };
}
function apiRequest(handler, query = {}, method = "GET", body = undefined, headers = {}) {
  const req = { method, query, body, headers, socket: { remoteAddress: "127.0.0.1" } };
  const res = responseStub();
  return Promise.resolve(handler(req, res)).then(() => res);
}
function restResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Content-Range": `0-${Math.max(0, data.length - 1)}/${data.length}` } });
}

test("QR endpoint generates a PNG for same-site organization links and rejects invalid IDs", async () => {
  const handler = require("../api/qr");
  const valid = await apiRequest(handler, { id: "org-123" }, "GET", undefined, { host: "localhost:8765", referer: "http://localhost:8765/business.html" });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.headers["Content-Type"], "image/png");
  assert.equal(valid.payload.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(valid.headers["Cache-Control"], /private/);
  const invalid = await apiRequest(handler, { id: "../x" }, "GET", undefined, { host: "localhost:8765" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.payload.code, "invalid_organization");
});

test("map rejects invalid bounds before contacting Supabase", async () => {
  const handler = require("../api/map");
  const previous = global.fetch;
  global.fetch = () => { throw new Error("unexpected network request"); };
  try {
    const res = await apiRequest(handler, { bbox: "43,76,91,77" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, "invalid_bounds");
  } finally { global.fetch = previous; }
});

test("map returns only the requested viewport and category results", async () => {
  const handler = require("../api/map");
  const previous = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => { requestedUrl = String(url); return restResponse([{ id: "org-1", name: "Test cafe", category_id: "restaurant", rating: 4.7, rating_source: "LocalHub", lat: 43.2, lon: 76.9 }]); };
  try {
    const res = await apiRequest(handler, { bbox: "43.0,76.5,43.5,77.2", category: "restaurant", city: "Алматы" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.items.length, 1);
    assert.equal(res.payload.items[0].category, "restaurant");
    assert.equal(res.payload.items[0].ratingSource, "LocalHub");
    assert.match(requestedUrl, /category_id=eq\.restaurant/);
    assert.match(requestedUrl, /lat=gte\.43/);
  } finally { global.fetch = previous; }
});

test("map clips a viewport crossing the Kazakhstan boundary and supports custom categories and cities", async () => {
  const handler = require("../api/map");
  const previous = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => { requestedUrl = String(url); return restResponse([]); };
  try {
    const res = await apiRequest(handler, { bbox: "39,44,57,89", category: "music-school", city: "Жаңа қала" });
    assert.equal(res.statusCode, 200);
    assert.match(requestedUrl, /lat=gte\.40/);
    assert.match(requestedUrl, /lat=lte\.56/);
    assert.match(requestedUrl, /category_id=eq\.music-school/);
    assert.match(requestedUrl, /city=eq\.%D0%96%D0%B0%D2%A3%D0%B0%20%D2%9B%D0%B0%D0%BB%D0%B0/);
  } finally { global.fetch = previous; }
});

test("map returns an empty result without querying outside Kazakhstan", async () => {
  const handler = require("../api/map");
  const previous = global.fetch;
  global.fetch = () => { throw new Error("unexpected network request"); };
  try {
    const res = await apiRequest(handler, { bbox: "10,10,20,20" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { items: [], limited: false });
  } finally { global.fetch = previous; }
});

test("map city summary maps real counts to supported city centers", async () => {
  const handler = require("../api/map");
  const previous = global.fetch;
  global.fetch = async () => restResponse([{ city: "Алматы", organization_count: 8 }, { city: "Unknown", organization_count: 3 }]);
  try {
    const res = await apiRequest(handler, { mode: "cities" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.cities.length, 20);
    assert.equal(res.payload.cities.find((city) => city.name === "Алматы").count, 8);
    assert.equal(res.payload.cities.some((city) => city.name === "Unknown"), false);
  } finally { global.fetch = previous; }
});

test("map falls back to real geocoded organizations when the city-count migration is not applied", async () => {
  const handler = require("../api/map");
  const previous = global.fetch;
  let calls = 0;
  let fallbackUrl = "";
  global.fetch = async (url) => {
    calls += 1;
    if (String(url).includes("/rpc/public_map_city_counts")) return new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 });
    fallbackUrl = String(url);
    return new Response(JSON.stringify([
      { city: "Тест-қала", lat: 43, lon: 76 },
      { city: "Тест-қала", lat: 45, lon: 78 },
    ]), { status: 200, headers: { "Content-Type": "application/json", "Content-Range": "0-1/2" } });
  };
  try {
    const res = await apiRequest(handler, { mode: "cities" });
    assert.equal(res.statusCode, 200);
    assert.equal(calls, 2);
    assert.match(fallbackUrl, /lat=gte\.40/);
    assert.match(fallbackUrl, /lon=lte\.88/);
    assert.equal(res.payload.source, "organizations_fallback");
    assert.equal(res.payload.cities.length, 21);
    assert.deepEqual(res.payload.cities.find((city) => city.name === "Тест-қала"), { name: "Тест-қала", count: 2, center: [77, 44] });
  } finally { global.fetch = previous; }
});

test("map refuses to show partial city totals if the fallback result is truncated", async () => {
  const handler = require("../api/map");
  const previous = global.fetch;
  global.fetch = async (url) => String(url).includes("/rpc/public_map_city_counts")
    ? new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 })
    : new Response(JSON.stringify([{ city: "Алматы", lat: 43, lon: 76 }]), { status: 200, headers: { "Content-Type": "application/json", "Content-Range": "0-0/1200" } });
  try {
    const res = await apiRequest(handler, { mode: "cities" });
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, "city_counts_migration_required");
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally { global.fetch = previous; }
});

test("map search rejects PostgREST filter syntax from user input", async () => {
  const handler = require("../api/map");
  const previous = global.fetch;
  global.fetch = () => { throw new Error("unexpected network request"); };
  try {
    const res = await apiRequest(handler, { mode: "search", q: "cafe),(id.neq.null" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, "invalid_search");
  } finally { global.fetch = previous; }
});

test("map search only returns Kazakhstan coordinates and normalized fields", async () => {
  const handler = require("../api/map");
  const previous = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return restResponse([{ id: "org-1", category_id: "restaurant", lat: "43.2", lon: "76.9", rating: "4.5", rating_source: "LocalHub" }]);
  };
  try {
    const res = await apiRequest(handler, { mode: "search", q: "cafe" });
    assert.equal(res.statusCode, 200);
    assert.match(requestedUrl, /lat=gte\.40/);
    assert.match(requestedUrl, /lon=lte\.88/);
    assert.equal(res.payload.items[0].category, "restaurant");
    assert.equal(res.payload.items[0].lat, 43.2);
    assert.equal(res.payload.items[0].rating, 4.5);
  } finally { global.fetch = previous; }
});

test("organization endpoint validates ID and returns mapped detail fields", async () => {
  const handler = require("../api/organization");
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return restResponse(calls === 1 ? [{ id: "org-1", name: "Test cafe", category_id: "restaurant", rating_source: "LocalHub", updated_at: "2026-11-01" }] : []); };
  try {
    const invalid = await apiRequest(handler, { id: "../secret" });
    assert.equal(invalid.statusCode, 400);
    const valid = await apiRequest(handler, { id: "org-1" });
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.payload.item.category, "restaurant");
    assert.equal(valid.payload.item.ratingSource, "LocalHub");
    assert.equal(valid.payload.item.updatedAt, "2026-11-01");
  } finally { global.fetch = previous; }
});

test("site analytics rejects malformed public events without storage calls", async () => {
  const handler = require("../api/site-analytics");
  const previous = global.fetch;
  global.fetch = () => { throw new Error("unexpected network request"); };
  try {
    const res = await apiRequest(handler, {}, "POST", { page: "/admin?secret=1", visitorId: "bad", sessionId: "bad" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, "invalid_event");
  } finally { global.fetch = previous; }
});

test("site analytics hashes accepted IDs before sending them to Supabase", async () => {
  const handler = require("../api/site-analytics");
  const previous = global.fetch;
  let rpcBody;
  global.fetch = async (url, options) => {
    assert.match(String(url), /record_site_page_view/);
    rpcBody = JSON.parse(options.body);
    return restResponse(true);
  };
  try {
    const res = await apiRequest(handler, {}, "POST", { page: "/map.html", visitorId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222" });
    assert.equal(res.statusCode, 202);
    assert.equal(res.payload.recorded, true);
    assert.match(rpcBody.p_visitor_hash, /^[0-9a-f]{64}$/);
    assert.match(rpcBody.p_session_hash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(rpcBody).includes("11111111"), false);
  } finally { global.fetch = previous; }
});

test("site analytics summary requires and checks the live administrator role", async () => {
  const handler = require("../api/site-analytics");
  const previous = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) return restResponse({ id: "admin-user" });
    if (target.endsWith("/rest/v1/rpc/current_app_role")) return restResponse("admin");
    if (target.endsWith("/rest/v1/rpc/site_analytics_summary")) return restResponse({ today_views: 4, today_visits: 2 });
    throw new Error(`Unexpected API call: ${target}`);
  };
  try {
    const res = await apiRequest(handler, {}, "GET", undefined, { authorization: "Bearer signed-session-token" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.summary.today_views, 4);
  } finally { global.fetch = previous; }
});

test("admin API refuses requests without a bearer session", async () => {
  const handler = require("../api/admin");
  const res = await apiRequest(handler, { action: "business-claims" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.code, "auth_required");
});

test("admin API ignores stale admin token metadata when the live database role is user", async () => {
  const handler = require("../api/admin");
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async (url) => {
    calls += 1;
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) return restResponse({ id: "ordinary-user", app_metadata: { role: "admin" } });
    if (target.endsWith("/rest/v1/rpc/current_app_role")) return restResponse("user");
    throw new Error("protected admin query should not run");
  };
  try {
    const res = await apiRequest(handler, { action: "business-claims" }, "GET", undefined, { authorization: "Bearer stale-token" });
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.code, "forbidden");
    assert.equal(calls, 2);
  } finally { global.fetch = previous; }
});

test("admin campaign list remains compatible with the current table API", async () => {
  const handler = require("../api/admin");
  const previous = global.fetch;
  const paths = [];
  global.fetch = async (url) => {
    const target = String(url); paths.push(target);
    if (target.endsWith("/auth/v1/user")) return restResponse({ id: "admin-user" });
    if (target.endsWith("/rest/v1/rpc/current_app_role")) return restResponse("admin");
    if (target.includes("/rest/v1/ad_campaigns?select=*&order=created_at.desc")) return restResponse([{ id: "campaign-1", impressions: 12, clicks: 3 }]);
    throw new Error(`Unexpected API call: ${target}`);
  };
  try {
    const res = await apiRequest(handler, { action: "campaigns" }, "GET", undefined, { authorization: "Bearer admin-token" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.items[0].impressions, 12);
    assert.ok(paths.some((url) => url.includes("/rest/v1/ad_campaigns?select=*&order=created_at.desc")));
  } finally { global.fetch = previous; }
});

test("campaign catalog endpoint reads only active, public-safe organization fields", async () => {
  const handler = require("../api/ads");
  const previous = global.fetch;
  let requested = "";
  global.fetch = async (url) => { requested = String(url); return restResponse([{ organization_id: "org-1", name: "Campaign", city: "Алматы", category_id: "restaurant" }]); };
  try {
    const res = await apiRequest(handler, { placement: "catalog" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.items.length, 1);
    assert.match(requested, /organization_id=not\.is\.null/);
    assert.match(requested, /status=eq\.active/);
    assert.match(requested, /select=id,name,organization_id,placement/);
    assert.doesNotMatch(requested, /impressions|clicks|created_by/);
  } finally { global.fetch = previous; }
});

test("assistant returns only database search results, never model-supplied organizations", async () => {
  const handler = require("../api/assistant");
  process.env.OPENAI_API_KEY = "test-openai-key";
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async (url) => {
    calls += 1;
    if (String(url).startsWith("https://api.openai.com/")) return restResponse({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ reply: "Ищу кафе в Актау.", city: "Актау", category: "restaurant", query: "кафе" }) }] }] });
    return restResponse([{ id: "real-org", name: "Organization from catalog", city: "Актау" }]);
  };
  try {
    const res = await apiRequest(handler, {}, "POST", { message: "Найди кафе в Актау" });
    assert.equal(res.statusCode, 200);
    assert.equal(calls, 2);
    assert.deepEqual(res.payload.items.map((item) => item.id), ["real-org"]);
  } finally { global.fetch = previous; delete process.env.OPENAI_API_KEY; }
});

test("assistant reports missing provider setup without making external requests", async () => {
  const handler = require("../api/assistant");
  const previousKey = process.env.OPENAI_API_KEY, previousFetch = global.fetch;
  delete process.env.OPENAI_API_KEY;
  global.fetch = () => { throw new Error("unexpected network request"); };
  try {
    const res = await apiRequest(handler, {}, "POST", { message: "Найди кафе в Актау" });
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, "ai_key_missing");
  } finally { global.fetch = previousFetch; if (previousKey !== undefined) process.env.OPENAI_API_KEY = previousKey; }
});

test("2GIS endpoint diagnostic reports missing setup without exposing secrets", async () => {
  const handler = require("../api/places");
  const previousKey = process.env.DGIS_API_KEY;
  delete process.env.DGIS_API_KEY;
  try {
    const res = await apiRequest(handler, { diagnostic: "1" });
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.configuration.status, "missing");
    assert.equal(JSON.stringify(res.payload).includes("test-service-key"), false);
  } finally { if (previousKey !== undefined) process.env.DGIS_API_KEY = previousKey; }
});

test("2GIS endpoint maps the official Places response shape without storing results", async () => {
  const handler = require("../api/places");
  const previousKey = process.env.DGIS_API_KEY, previousFetch = global.fetch;
  process.env.DGIS_API_KEY = "test-2gis-key";
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = new URL(String(url));
    return new Response(JSON.stringify({ meta: { code: 200 }, result: { total: 1, items: [{ id: "2gis-1", name: "Test venue", full_address_name: "Almaty, test street", point: { lon: 76.9, lat: 43.2 } }] } }), { status: 200 });
  };
  try {
    const res = await apiRequest(handler, { city: "Алматы", category: "restaurant", page: "1" });
    assert.equal(res.statusCode, 200);
    assert.equal(requestedUrl.hostname, "catalog.api.2gis.com");
    assert.equal(requestedUrl.searchParams.get("locale"), "ru_KZ");
    assert.equal(requestedUrl.searchParams.get("key"), "test-2gis-key");
    assert.deepEqual(res.payload.items[0], { id: "2gis-1", name: "Test venue", address: "Almaty, test street", point: { lon: 76.9, lat: 43.2 }, source: "2GIS" });
    assert.equal(JSON.stringify(res.payload).includes("test-2gis-key"), false);
  } finally { global.fetch = previousFetch; if (previousKey !== undefined) process.env.DGIS_API_KEY = previousKey; else delete process.env.DGIS_API_KEY; }
});
