"use strict";

const { authenticate, rest, send } = require("../lib/supabase-server");
const ISSUE_TYPES = new Set([
  "wrong_address", "wrong_phone", "closed", "wrong_hours",
  "duplicate", "wrong_category", "other",
]);

module.exports = async function reports(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Поддерживается только POST.", code: "method_not_allowed" });
  }
  const auth = await authenticate(req);
  if (auth.error) return send(res, auth.status, { error: auth.error, code: "auth_required" });
  if (!auth.config.adminKey) return send(res, 503, { error: "Серверная запись жалоб не настроена.", code: "report_backend_not_configured" });

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  if (typeof body.organizationId !== "string" || body.organizationId.length < 1 || body.organizationId.length > 100
    || !ISSUE_TYPES.has(body.issueType)
    || (body.description != null && (typeof body.description !== "string" || body.description.trim().length > 2000))) {
    return send(res, 400, { error: "Проверьте организацию, тип жалобы и описание.", code: "invalid_report" });
  }

  const result = await rest(auth.config, "/rest/v1/rpc/submit_organization_report", {
    method: "POST",
    admin: true,
    body: {
      p_reporter_id: auth.user.id,
      p_organization_id: body.organizationId,
      p_issue_type: body.issueType,
      p_description: typeof body.description === "string" ? body.description.trim() : "",
    },
  });
  if (!result.ok) {
    const message = String(result.data?.message || "");
    if (message.includes("report rate limit exceeded")) {
      return send(res, 429, { error: "Вы отправили несколько жалоб за последний час. Попробуйте позже.", code: "rate_limited" });
    }
    if (result.status === 404 || result.data?.code === "23503") {
      return send(res, 404, { error: "Организация не найдена в каталоге.", code: "organization_not_found" });
    }
    return send(res, 400, { error: "Жалобу не удалось сохранить.", code: "report_failed" });
  }
  return send(res, 201, { submitted: true });
};
