"use strict";

function send(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

module.exports = function supabaseConfig(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Поддерживается только GET.", code: "method_not_allowed" });
  }

  const url = typeof process.env.SUPABASE_URL === "string" ? process.env.SUPABASE_URL.trim() : "";
  // Publishable/anon keys are intended for browser clients and must be protected by RLS.
  // Secret/service-role keys are deliberately never read or returned by this endpoint.
  const publishableKey = typeof process.env.SUPABASE_PUBLISHABLE_KEY === "string"
    ? process.env.SUPABASE_PUBLISHABLE_KEY.trim()
    : (typeof process.env.SUPABASE_ANON_KEY === "string" ? process.env.SUPABASE_ANON_KEY.trim() : "");
  let validUrl = false;
  try {
    const parsed = new URL(url);
    validUrl = parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {}

  if (!validUrl || !publishableKey) {
    return send(res, 503, {
      configured: false,
      code: "supabase_not_configured",
      message: "Supabase не настроен. Добавьте SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY в окружение Vercel.",
    });
  }

  return send(res, 200, { configured: true, url, publishableKey });
};
