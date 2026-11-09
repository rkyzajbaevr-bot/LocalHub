"use strict";
(() => {
  const form = document.getElementById("assistantForm"), input = document.getElementById("assistantInput");
  if (!form || !input) return;
  const messages = document.getElementById("assistantMessages"), status = document.getElementById("assistantStatus"), submit = document.getElementById("assistantSend");
  const STORAGE_KEY = "localhub:assistant-history";
  const escText = (value) => String(value ?? "").slice(0, 1200);
  let history = [];
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); if (Array.isArray(saved)) history = saved.filter((item) => ["user", "assistant"].includes(item.role) && typeof item.content === "string").slice(-20); } catch {}
  function showStatus(text, error = false) { status.textContent = text; status.hidden = !text; status.classList.toggle("is-error", error); }
  function appendMessage(role, content, items = []) {
    const bubble = document.createElement("article"); bubble.className = `assistant-message assistant-message--${role}`;
    const label = document.createElement("b"); label.textContent = role === "user" ? "Вы" : "LocalHub AI";
    const body = document.createElement("p"); body.textContent = escText(content); bubble.append(label, body);
    if (items.length) {
      const cards = document.createElement("div"); cards.className = "assistant-results";
      for (const item of items) {
        const card = document.createElement("article"); card.className = "assistant-result";
        const title = document.createElement("b"); title.textContent = item.name || "Организация";
        const meta = document.createElement("span"); meta.textContent = [item.city, item.address, item.rating && item.rating_source ? `★ ${item.rating}` : ""].filter(Boolean).join(" · ");
        const link = document.createElement("a"); link.className = "btn btn--ghost"; link.href = `business.html?id=${encodeURIComponent(item.id)}`; link.textContent = "Подробнее";
        card.append(title, meta, link);
        if (item.lat != null && item.lon != null && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)) && Number(item.lat) >= 40 && Number(item.lat) <= 56 && Number(item.lon) >= 45 && Number(item.lon) <= 88) {
          const route = document.createElement("a"); route.className = "btn btn--ghost"; route.href = `https://2gis.kz/directions/points/|${item.lon},${item.lat}`; route.target = "_blank"; route.rel = "noopener"; route.textContent = "Маршрут в 2GIS ↗"; card.append(route);
        }
        cards.append(card);
      }
      bubble.append(cards);
    }
    messages.append(bubble); messages.scrollTop = messages.scrollHeight;
  }
  function renderHistory() {
    messages.replaceChildren();
    if (!history.length) { appendMessage("assistant", "Спросите, где найти нужную организацию в Казахстане. Я использую только каталог LocalHub."); return; }
    for (const item of history) appendMessage(item.role, item.content);
  }
  async function ask(message) {
    const previous = history.slice(-6);
    appendMessage("user", message); history.push({ role: "user", content: message });
    submit.disabled = true; input.disabled = true; submit.textContent = "Ищем…"; showStatus("Разбираем запрос и ищем в каталоге LocalHub…");
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ message, history: previous }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось выполнить поиск.");
      let reply = data.reply || "";
      if (Array.isArray(data.items) && data.items.length) reply += ` Нашёл организаций: ${data.items.length}.`;
      else if (data.filters?.city || data.filters?.category || data.filters?.query) reply += " В каталоге по этому запросу организаций нет. Попробуйте другой город или категорию.";
      else reply += " Уточните город или категорию, и я поищу точнее.";
      appendMessage("assistant", reply, Array.isArray(data.items) ? data.items : []);
      history.push({ role: "assistant", content: reply }); history = history.slice(-20);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch {}
      showStatus("");
    } catch (error) { showStatus(error.message || "AI-помощник временно недоступен.", true); }
    finally { submit.disabled = false; input.disabled = false; submit.innerHTML = "Найти <span>→</span>"; input.focus(); }
  }
  form.addEventListener("submit", (event) => { event.preventDefault(); const value = input.value.trim(); if (value.length < 2) return; input.value = ""; ask(value); });
  document.querySelectorAll("[data-assistant-prompt]").forEach((button) => button.addEventListener("click", () => { input.value = button.dataset.assistantPrompt || ""; form.requestSubmit(); }));
  renderHistory();
})();
