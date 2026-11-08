"use strict";
(() => {
  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("#organizationReportForm");
    if (!form) return;
    event.preventDefault();
    const status = document.getElementById("reportStatus");
    const say = (text, error = false) => { status.textContent = text; status.hidden = !text; status.classList.toggle("is-error", error); status.classList.toggle("is-success", !error); };
    const auth = window.LocalHubAuth;
    if (!auth?.user || !auth?.client) { say("Войдите, чтобы отправить жалобу.", true); return; }
    const { data, error } = await auth.client.auth.getSession();
    const token = data?.session?.access_token;
    if (error || !token) { say("Сессия истекла. Войдите снова.", true); return; }
    const values = Object.fromEntries(new FormData(form));
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ organizationId: form.dataset.reportOrg, issueType: values.issueType, description: values.description }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Жалобу не удалось отправить.");
      form.reset(); say("Жалоба отправлена. Администратор проверит сведения.");
    } catch (error) { say(error.message || "Не удалось связаться с сервером.", true); }
    finally { button.disabled = false; }
  });
})();
