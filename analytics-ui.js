"use strict";
(() => {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-track][data-org]");
    if (!target) return;
    try {
      let sessionId = localStorage.getItem("localhub:analytics-session");
      if (!sessionId) { sessionId = crypto.randomUUID(); localStorage.setItem("localhub:analytics-session", sessionId); }
      fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: target.dataset.org, action: target.dataset.track, sessionId }) }).catch(() => {});
    } catch {}
  });
})();
