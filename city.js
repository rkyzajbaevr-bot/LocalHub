"use strict";
(() => {
  const citySlugs = new Map([["almaty", "Алматы"], ["astana", "Астана"], ["shymkent", "Шымкент"], ["aktobe", "Актобе"], ["aktau", "Актау"], ["atyrau", "Атырау"], ["karaganda", "Караганда"], ["pavlodar", "Павлодар"], ["kostanay", "Костанай"], ["uralsk", "Уральск"], ["kyzylorda", "Кызылорда"], ["taraz", "Тараз"], ["turkistan", "Туркестан"], ["kokshetau", "Кокшетау"], ["petropavl", "Петропавловск"], ["oskemen", "Усть-Каменогорск"], ["semey", "Семей"], ["zhezkazgan", "Жезказган"], ["temirtau", "Темиртау"], ["ekibastuz", "Экибастуз"]]);
  const categorySlugs = new Map([["restaurants", "restaurant"], ["dentistry", "dentistry"], ["medicine", "medicine"], ["education", "education"], ["english-courses", "english"], ["beauty", "beauty"], ["barbershops", "barbershop"], ["gyms", "gym"], ["auto-services", "auto"], ["hotels", "hotel"], ["shops", "shops"], ["entertainment", "entertainment"]]);
  const params = new URLSearchParams(location.search), segments = location.pathname.split("/").filter(Boolean);
  const citySlug = params.get("city") || (segments[0] === "city" ? segments[1] : segments.at(-2) || segments.at(-1));
  const categorySlug = params.get("category") || (params.has("city") || segments[0] === "city" ? "" : segments.length > 1 ? segments.at(-1) : "");
  const cityName = citySlugs.get(citySlug), categoryId = categorySlugs.get(categorySlug) || "";
  const title = document.getElementById("cityTitle"), description = document.getElementById("cityDescription"), root = document.getElementById("cityResults"), empty = document.getElementById("cityEmpty"), catSelect = document.getElementById("seoCategory"), query = document.getElementById("cityQuery"), pageStatus = document.getElementById("cityPageStatus");
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  if (!cityName || (categorySlug && !categoryId)) {
    title.textContent = "Страница не найдена"; description.textContent = "Указанный город или категория отсутствует в справочнике LocalHub.";
    const robots = document.createElement("meta"); robots.name = "robots"; robots.content = "noindex,follow"; document.head.append(robots); return;
  }
  const categories = typeof CATEGORIES !== "undefined" ? CATEGORIES : [];
  for (const item of categories) catSelect.add(new Option(item.label, item.id));
  if (categoryId) catSelect.value = categoryId;
  const categoryName = categories.find((item) => item.id === categoryId)?.label;
  title.textContent = categoryName ? `${categoryName} в городе ${cityName}` : `Организации города ${cityName}`;
  description.textContent = `Каталог организаций ${cityName}${categoryName ? `: ${categoryName.toLocaleLowerCase("ru")}` : ""}. Здесь отображаются только опубликованные организации LocalHub.`;
  document.title = `${title.textContent} — LocalHub Kazakhstan`;
  const desc = document.querySelector('meta[name="description"]'); if (desc) desc.content = description.textContent;
  const canonical = document.createElement("link"); canonical.rel = "canonical"; canonical.href = `${location.origin}${categoryId ? `/${citySlug}/${categorySlug}` : `/city/${citySlug}`}`; document.head.append(canonical);
  const robots = document.createElement("meta"); robots.name = "robots"; robots.content = "noindex,follow"; document.head.append(robots);
  const ogTitle = document.createElement("meta"); ogTitle.setAttribute("property", "og:title"); ogTitle.content = document.title; document.head.append(ogTitle);
  const ogDescription = document.createElement("meta"); ogDescription.setAttribute("property", "og:description"); ogDescription.content = description.textContent; document.head.append(ogDescription);
  const adSlot = document.querySelector('[data-ad-placement="category"]'); if (adSlot) { adSlot.dataset.city = cityName; adSlot.dataset.category = categoryId; }
  let page = 1, total = null, pageCount = 1, hasMore = false, debounce;
  async function load() {
    const currentCategory = catSelect.value || categoryId;
    const params = new URLSearchParams({ city: cityName, page: String(page) });
    if (currentCategory) params.set("category", currentCategory);
    if (query.value.trim()) params.set("search", query.value.trim());
    root.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(`/api/catalog?${params}`, { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Каталог города временно недоступен.");
      const items = Array.isArray(data.items) ? data.items : [];
      total = Number.isFinite(data.total) ? data.total : null; pageCount = total == null ? 1 : Math.max(1, Math.ceil(total / data.pageSize)); hasMore = data.hasMore === true;
      root.innerHTML = items.map((item) => {
        const image = typeof item.photo === "string" && /^https:\/\//i.test(item.photo) ? `<img src="${esc(item.photo)}" alt="${esc(item.name)}" loading="lazy">` : "";
        return `<article class="card" data-organization-id="${esc(item.id)}"><a class="card__media" href="business.html?id=${encodeURIComponent(item.id)}">${image}<span class="card__city">${esc(cityName)}</span></a><div class="card__body"><span class="card__cat">${esc(categories.find((row) => row.id === item.category_id)?.label || item.category_id || "Не указано")}</span><h2 class="card__title"><a href="business.html?id=${encodeURIComponent(item.id)}">${esc(item.name)}</a></h2><p class="card__desc">${esc(item.address || "Не указано")}</p><div class="card__tools"><button class="btn btn--ghost" type="button" data-compare="${esc(item.id)}">Сравнить</button><button class="btn btn--ghost" type="button" data-collection-add="${esc(item.id)}">В подборку</button></div><a class="card__more" href="business.html?id=${encodeURIComponent(item.id)}">Подробнее →</a></div></article>`;
      }).join("");
      empty.hidden = items.length > 0; robots.content = items.length ? "index,follow" : "noindex,follow";
      pageStatus.textContent = total == null ? `Страница ${page}` : `Страница ${page} из ${pageCount} · Всего организаций: ${total}`;
      document.getElementById("cityPrev").disabled = page <= 1; document.getElementById("cityNext").disabled = total == null ? !hasMore : page >= pageCount;
      const schema = document.createElement("script"); schema.id = "citySchema"; schema.type = "application/ld+json";
      schema.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: (page - 1) * 50 + index + 1, item: { "@type": "LocalBusiness", name: item.name, address: item.address ? { "@type": "PostalAddress", streetAddress: item.address, addressLocality: cityName, addressCountry: "KZ" } : undefined, url: `${location.origin}/business.html?id=${encodeURIComponent(item.id)}` } })) });
      document.getElementById("citySchema")?.remove(); document.head.append(schema);
      if (adSlot) { adSlot.dataset.category = currentCategory; }
    } catch (error) { pageStatus.textContent = error.message; empty.hidden = false; root.replaceChildren(); }
    finally { root.removeAttribute("aria-busy"); }
  }
  catSelect.addEventListener("change", () => { page = 1; load(); });
  query.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(() => { page = 1; load(); }, 250); });
  document.getElementById("cityPrev").addEventListener("click", () => { if (page > 1) { page -= 1; load(); } });
  document.getElementById("cityNext").addEventListener("click", () => { if (total == null ? hasMore : page < pageCount) { page += 1; load(); } });
  load();
})();
