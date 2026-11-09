"use strict";

const QRCode = require("qrcode");
const { send } = require("../lib/supabase-server");

module.exports = async function qr(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Поддерживается только GET.", code: "method_not_allowed" });
  }
  const id = String(req.query?.id || "");
  if (!/^[a-zA-Z0-9:_-]{2,100}$/.test(id)) return send(res, 400, { error: "Недопустимый идентификатор организации.", code: "invalid_organization" });

  const requestHost = String(req.headers?.host || "").toLowerCase();
  let origin = "";
  try {
    const referrer = new URL(String(req.headers?.referer || ""));
    if ((referrer.protocol === "https:" || referrer.protocol === "http:") && referrer.host.toLowerCase() === requestHost) origin = referrer.origin;
  } catch {}
  if (!origin) {
    const configured = String(process.env.PUBLIC_SITE_URL || "").trim();
    try {
      const publicUrl = new URL(configured);
      if (publicUrl.protocol === "https:") origin = publicUrl.origin;
    } catch {}
  }
  if (!origin && requestHost) {
    const forwardedProto = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    const protocol = forwardedProto === "https" || process.env.VERCEL ? "https:" : "http:";
    try { origin = new URL(`${protocol}//${requestHost}`).origin; } catch {}
  }
  if (!origin) return send(res, 400, { error: "Не удалось определить адрес текущего сайта.", code: "site_origin_unavailable" });

  const target = new URL("/business.html", origin);
  target.searchParams.set("id", id);
  try {
    const png = await QRCode.toBuffer(target.href, { type: "png", width: 220, margin: 2, errorCorrectionLevel: "M" });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.status(200).send(png);
  } catch {
    return send(res, 500, { error: "Не удалось сформировать QR-код.", code: "qr_generation_failed" });
  }
};
