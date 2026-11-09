"use strict";
(() => {
  const dictionaries = {
    ru: { assistant: "AI-помощник", catalog: "Каталог", map: "Карта", categories: "Категории", favorites: "Избранное", account: "Кабинет", login: "Войти", add: "Добавить организацию", collections: "Подборки", compare: "Сравнение", search: "Найти", city: "Город", region: "Регион", sort: "Сортировка", allCities: "Все города", allRegions: "Все регионы", allCategories: "Все", language: "Язык", unknown: "Не указано", report: "Пожаловаться", compareButton: "Сравнить", collectionButton: "В подборку", noResults: "Организаций пока нет.", searchPlaceholder: "Название, адрес или категория", restaurant: "Рестораны и кафе", dentistry: "Стоматологии", medicine: "Медицина", education: "Образование", english: "Курсы английского", beauty: "Красота и здоровье", barbershop: "Барбершопы", gym: "Спортзалы", auto: "Автосервисы", hotel: "Гостиницы", shops: "Магазины", entertainment: "Развлечения" },
    kk: { assistant: "AI-көмекші", catalog: "Каталог", map: "Карта", categories: "Санаттар", favorites: "Таңдаулылар", account: "Жеке кабинет", login: "Кіру", add: "Ұйым қосу", collections: "Топтамалар", compare: "Салыстыру", search: "Іздеу", city: "Қала", region: "Өңір", sort: "Сұрыптау", allCities: "Барлық қалалар", allRegions: "Барлық өңірлер", allCategories: "Барлығы", language: "Тіл", unknown: "Көрсетілмеген", report: "Шағымдану", compareButton: "Салыстыру", collectionButton: "Топтамаға", noResults: "Әзірше ұйымдар жоқ.", searchPlaceholder: "Атауы, мекенжайы немесе санаты", restaurant: "Мейрамханалар мен дәмханалар", dentistry: "Стоматология", medicine: "Медицина", education: "Білім беру", english: "Ағылшын курстары", beauty: "Сұлулық және денсаулық", barbershop: "Барбершоптар", gym: "Спорт залдары", auto: "Автосервис", hotel: "Қонақ үйлер", shops: "Дүкендер", entertainment: "Ойын-сауық" },
    en: { assistant: "AI assistant", catalog: "Directory", map: "Map", categories: "Categories", favorites: "Favorites", account: "Account", login: "Sign in", add: "Add organization", collections: "Collections", compare: "Compare", search: "Search", city: "City", region: "Region", sort: "Sort", allCities: "All cities", allRegions: "All regions", allCategories: "All", language: "Language", unknown: "Not specified", report: "Report an issue", compareButton: "Compare", collectionButton: "Add to collection", noResults: "No organizations yet.", searchPlaceholder: "Name, address or category", restaurant: "Restaurants and cafes", dentistry: "Dentistry", medicine: "Healthcare", education: "Education", english: "English courses", beauty: "Beauty and wellness", barbershop: "Barbershops", gym: "Gyms", auto: "Auto services", hotel: "Hotels", shops: "Shops", entertainment: "Entertainment" },
  };
  const localeKey = "localhub:language";
  const valid = (value) => Object.hasOwn(dictionaries, value) ? value : "ru";
  let locale = "ru";
  try { locale = valid(localStorage.getItem(localeKey) || document.documentElement.lang || "ru"); } catch { locale = valid(document.documentElement.lang || "ru"); }
  document.querySelectorAll(".nav__links").forEach((nav) => {
    for (const [href, key] of [["collections.html", "collections"], ["compare.html", "compare"], ["assistant.html", "assistant"]]) {
      if (nav.querySelector(`a[href="${href}"]`)) continue;
      const link = document.createElement("a"); link.href = href; link.dataset.i18n = key; link.textContent = key === "collections" ? "Подборки" : key === "compare" ? "Сравнение" : "AI-помощник"; nav.append(link);
    }
  });
  const navKeys = new Map([["index.html", "catalog"], ["/", "catalog"], ["map.html", "map"], ["categories.html", "categories"], ["favorites.html", "favorites"], ["account.html", "account"], ["account", "account"], ["login.html", "login"], ["login", "login"], ["add.html", "add"], ["collections.html", "collections"], ["compare.html", "compare"], ["assistant.html", "assistant"]]);
  document.querySelectorAll(".nav__links a, .footer__links a").forEach((link) => {
    const key = navKeys.get(link.getAttribute("href"));
    if (key && !link.dataset.i18n) link.dataset.i18n = key;
  });
  const setLabel = (node, key) => { if (node) node.dataset.i18n = key; };
  for (const [id, key] of [["cityFilter", "city"], ["regionFilter", "region"], ["sortFilter", "sort"], ["seoCategory", "categories"]]) setLabel(document.getElementById(id)?.closest("label")?.querySelector("span"), key);
  const searchInput = document.getElementById("searchInput"); if (searchInput) searchInput.dataset.i18nPlaceholder = "searchPlaceholder";
  const cityOption = document.querySelector("#cityFilter option[value='']"); if (cityOption) cityOption.dataset.i18n = "allCities";
  const regionOption = document.querySelector("#regionFilter option[value='']"); if (regionOption) regionOption.dataset.i18n = "allRegions";
  const categoryOption = document.querySelector("#seoCategory option[value='']"); if (categoryOption) categoryOption.dataset.i18n = "allCategories";
  function apply() {
    document.documentElement.lang = locale;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const value = dictionaries[locale][node.dataset.i18n];
      if (value) {
        const textNode = [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE);
        if (textNode && node.children.length) textNode.nodeValue = `${value} `;
        else node.textContent = value;
      }
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      const value = dictionaries[locale][node.dataset.i18nPlaceholder];
      if (value) node.setAttribute("placeholder", value);
    });
    document.querySelectorAll("[data-language-select]").forEach((select) => { select.value = locale; });
    document.dispatchEvent(new CustomEvent("localhub:language-change", { detail: { locale } }));
  }
  document.querySelectorAll(".nav__inner").forEach((header) => {
    if (header.querySelector("[data-language-select]")) return;
    const label = document.createElement("label");
    label.className = "language-picker";
    label.innerHTML = '<span class="visually-hidden">Язык</span><select data-language-select aria-label="Язык"><option value="ru">RU</option><option value="kk">ҚАЗ</option><option value="en">EN</option></select>';
    header.append(label);
  });
  document.addEventListener("change", (event) => {
    if (!event.target.matches("[data-language-select]")) return;
    locale = valid(event.target.value); try { localStorage.setItem(localeKey, locale); } catch {} apply();
  });
  document.addEventListener("localhub:auth-ready", apply);
  window.LocalHubI18n = { get locale() { return locale; }, text: (key, fallback = "") => dictionaries[locale][key] || fallback, categoryLabel: (id, fallback) => dictionaries[locale][id] || fallback };
  apply();
})();
