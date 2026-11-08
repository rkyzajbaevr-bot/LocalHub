"use strict";
(() => {
  const KEY = "localhub:compare";
  const root = document.getElementById("compareTable");
  const status = document.getElementById("compareStatus");
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const readIds = () => { try { const ids = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === "string"))].slice(0, 4) : []; } catch { return []; } };
  let ids = readIds();
  let catalog = [];
  const say = (text, error = false) => { if (!status) return; status.textContent = text; status.hidden = !text; status.classList.toggle("is-error", error); };
  function render() {
    if (!root) return;
    const items = ids.map((id) => catalog.find((item) => String(item.id) === id)).filter(Boolean);
    document.getElementById("compareEmpty").hidden = items.length > 0;
    if (!items.length) { root.replaceChildren(); return; }
    const fields = [["Название", (item) => item.name], ["Категория", (item) => item.category_id || item.category], ["Город", (item) => item.city], ["Адрес", (item) => item.address], ["Цена", (item) => item.price_summary], ["Рейтинг", (item) => item.rating != null && item.rating_source ? `${item.rating} (${item.rating_source})` : null], ["Услуги", (item) => Array.isArray(item.services) ? item.services.join(", ") : null], ["Описание", (item) => item.description], ["Телефон", (item) => item.phone], ["Сайт", (item) => item.website], ["График работы", (item) => item.hours]];
    const table = document.createElement("table");
    const header = document.createElement("tr");
    header.innerHTML = `<th>Характеристика</th>${items.map((item) => `<th><a href="business.html?id=${encodeURIComponent(item.id)}">${escape(item.name)}</a><button class="compare-remove" type="button" data-compare-remove="${escape(item.id)}" aria-label="Убрать из сравнения">×</button></th>`).join("")}`;
    const head = document.createElement("thead"); head.append(header); table.append(head);
    const body = document.createElement("tbody");
    for (const [label, getter] of fields) {
      const values = items.map(getter);
      const known = values.filter((value) => value != null && value !== "");
      const differs = new Set(known.map((value) => JSON.stringify(value))).size > 1;
      const row = document.createElement("tr");
      row.innerHTML = `<th>${escape(label)}</th>${values.map((value) => `<td class="${differs ? "compare-diff" : ""}">${value != null && value !== "" ? escape(Array.isArray(value) ? value.join(", ") : value) : "Не указано"}</td>`).join("")}`;
      body.append(row);
    }
    table.append(body); root.replaceChildren(table);
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-compare]");
    if (button) {
      const id = button.dataset.compare;
      if (ids.includes(id)) { say("Эта организация уже добавлена."); return; }
      if (ids.length >= 4) { say("Для удобного сравнения можно добавить не более четырёх организаций.", true); return; }
      ids.push(id); localStorage.setItem(KEY, JSON.stringify(ids)); say("Организация добавлена к сравнению.");
      if (root) load();
      return;
    }
    const remove = event.target.closest("[data-compare-remove]");
    if (remove) { ids = ids.filter((id) => id !== remove.dataset.compareRemove); localStorage.setItem(KEY, JSON.stringify(ids)); render(); }
  });
  async function load() {
    ids = readIds();
    let remote = [];
    try {
      const response = await window.LocalHubAuth?.organizations();
      if (!response?.error && Array.isArray(response?.data)) remote = response.data;
    } catch {}
    let local = [];
    try { const response = await fetch("businesses.json"); const data = await response.json(); local = Array.isArray(data) ? data : (data.businesses || []); } catch {}
    catalog = [...new Map([...local.map((item) => ({ ...item, category_id: item.category })) , ...remote].map((item) => [String(item.id), item])).values()];
    render();
  }
  document.addEventListener("localhub:auth-ready", load);
  load();
})();
