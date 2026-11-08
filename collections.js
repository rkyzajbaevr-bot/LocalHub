"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const queryId = new URLSearchParams(location.search).get("id");
  const workspace = $("collectionWorkspace");
  const publicRoot = $("publicCollection");
  const status = $("collectionStatus");
  let authGeneration = 0;
  let toastTimer = null;
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function message(text, error = false) {
    let target = status;
    if (!target) {
      target = document.getElementById("collectionToast");
      if (!target) { target = document.createElement("div"); target.id = "collectionToast"; target.className = "auth-status collection-toast"; target.setAttribute("role", "status"); target.setAttribute("aria-live", "polite"); document.body.append(target); }
    }
    target.textContent = text;
    target.hidden = !text;
    target.classList.toggle("is-error", error);
    target.classList.toggle("is-success", !error && !!text);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { if (target.id === "collectionToast") target.hidden = true; }, 4500);
  }

  function client() { return window.LocalHubAuth?.client || null; }

  async function loadMine() {
    if (!workspace) return;
    const sb = client();
    if (!sb || !window.LocalHubAuth?.user) return;
    const generation = authGeneration, ownerId = window.LocalHubAuth.user.id;
    workspace.hidden = false;
    const { data, error } = await sb.from("business_collections")
      .select("id,name,description,is_public,created_at,business_collection_items(organization_id)")
      .order("created_at", { ascending: false });
    if (generation !== authGeneration || window.LocalHubAuth?.user?.id !== ownerId) return;
    if (error) return message("Не удалось загрузить подборки. Проверьте, что миграция подборок применена.", true);
    const rows = data || [];
    $("collectionEmpty").hidden = rows.length > 0;
    $("collectionList").innerHTML = rows.map((row) => {
      const url = `${location.origin}/collections.html?id=${encodeURIComponent(row.id)}`;
      return `<article class="saved-search"><div><b>${safe(row.name)}</b><small>${safe(row.description || "Без описания")} · ${row.business_collection_items?.length || 0} организаций · ${row.is_public ? "Публичная" : "Приватная"}</small></div><div class="saved-search__actions"><button class="btn btn--ghost" type="button" data-copy-url="${safe(url)}">Скопировать ссылку</button><button class="btn btn--ghost" type="button" data-edit-collection="${safe(row.id)}" data-name="${safe(row.name)}" data-description="${safe(row.description || "")}" data-public="${row.is_public}">Настроить</button><button class="btn btn--ghost" type="button" data-delete-collection="${safe(row.id)}">Удалить</button></div></article>`;
    }).join("");
  }

  async function loadPublic() {
    if (!publicRoot) return;
    const sb = client();
    if (!sb) return;
    const generation = authGeneration;
    publicRoot.hidden = false;
    workspace.hidden = true;
    const { data: collection, error } = await sb.from("business_collections")
      .select("id,name,description,is_public").eq("id", queryId).maybeSingle();
    if (generation !== authGeneration) return;
    let isOwner = false;
    if (collection && window.LocalHubAuth?.user) {
      const own = await sb.from("business_collections").select("id").eq("id", queryId).maybeSingle();
      if (generation !== authGeneration) return;
      isOwner = !own.error && !!own.data;
    }
    if (error || (!collection?.is_public && !isOwner)) {
      $("collectionIntro").textContent = "Подборка не найдена или она приватная.";
      return;
    }
    document.title = `${collection.name} — подборка LocalHub`;
    $("collectionIntro").textContent = collection.description || "Публичная подборка организаций LocalHub.";
    const { data: items, error: itemsError } = await sb.from("business_collection_items")
      .select("organization_id, organizations(id,name,category_id,city,address,photo,rating,rating_source)")
      .eq("collection_id", queryId).order("added_at");
    if (generation !== authGeneration) return;
    if (itemsError) {
      $("collectionIntro").textContent = "Не удалось загрузить организации этой подборки.";
      return;
    }
    $("publicCollectionItems").innerHTML = (items || []).map((row) => {
      const b = row.organizations;
      if (!b) return "";
      const image = typeof b.photo === "string" && /^https:\/\//i.test(b.photo) ? `<img src="${safe(b.photo)}" alt="${safe(b.name)}" loading="lazy">` : "";
      return `<article class="card"><a class="card__media" href="business.html?id=${encodeURIComponent(b.id)}">${image}<span class="card__city">⌖ ${safe(b.city || "Не указано")}</span></a><div class="card__body"><h3 class="card__title"><a href="business.html?id=${encodeURIComponent(b.id)}">${safe(b.name)}</a></h3><p class="card__desc">⌖ ${safe(b.address || "Не указано")}</p><span class="card__cat">${safe(b.category_id || "Не указано")}</span>${isOwner ? `<button class="btn btn--ghost" data-remove-collection-item="${safe(b.id)}">Убрать из подборки</button>` : ""}</div></article>`;
    }).join("");
  }

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "collectionForm") return;
    event.preventDefault();
    const sb = client();
    const user = window.LocalHubAuth?.user;
    if (!sb || !user) return message("Войдите, чтобы создавать подборки.", true);
    const values = Object.fromEntries(new FormData(event.target));
    const { error } = await sb.from("business_collections").insert({
      owner_id: user.id,
      name: String(values.name || "").trim(),
      description: String(values.description || "").trim(),
      is_public: values.is_public === "on",
    });
    if (error) return message("Подборку не удалось создать. Проверьте данные и настройки базы.", true);
    event.target.reset();
    message("Подборка создана.");
    await loadMine();
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-url],[data-edit-collection],[data-delete-collection],[data-collection-add],[data-remove-collection-item]");
    if (!button) return;
    const sb = client();
    if (button.dataset.collectionAdd) {
      if (!window.LocalHubAuth?.user) return message("Войдите, чтобы добавлять организации в подборки.", true);
      const { data: lists, error } = await sb.from("business_collections").select("id,name").order("created_at", { ascending: false });
      if (error) return message("Не удалось загрузить ваши подборки.", true);
      if (!lists?.length) return message("Сначала создайте подборку на странице «Подборки».", true);
      const choice = prompt(`Добавить в подборку (введите номер):\n${lists.map((row, index) => `${index + 1}. ${row.name}`).join("\n")}`);
      const list = lists[Number(choice) - 1];
      if (!list) return;
      const { error: insertError } = await sb.from("business_collection_items").insert({ collection_id: list.id, organization_id: button.dataset.collectionAdd });
      if (insertError && insertError.code !== "23505") return message("Не удалось добавить организацию в подборку.", true);
      return message(insertError ? "Организация уже в подборке." : "Организация добавлена в подборку.");
    }
    if (button.dataset.removeCollectionItem) {
      const { error } = await sb.from("business_collection_items").delete().eq("collection_id", queryId).eq("organization_id", button.dataset.removeCollectionItem);
      if (error) return message("Не удалось удалить организацию из подборки.", true);
      return loadPublic();
    }
    if (button.dataset.copyUrl) {
      try { await navigator.clipboard.writeText(button.dataset.copyUrl); message("Ссылка скопирована."); }
      catch { message(button.dataset.copyUrl); }
    } else if (button.dataset.editCollection) {
      const name = prompt("Название подборки:", button.dataset.name || "")?.trim();
      if (!name) return;
      const description = prompt("Описание подборки:", button.dataset.description || "");
      if (description === null) return;
      const isPublic = confirm("Сделать подборку публичной? Нажмите «Отмена», чтобы оставить её приватной.");
      const { error } = await sb.from("business_collections").update({ name, description, is_public: isPublic }).eq("id", button.dataset.editCollection);
      if (error) return message("Не удалось изменить подборку.", true);
      await loadMine();
    } else if (button.dataset.deleteCollection && confirm("Удалить подборку и её список организаций?")) {
      const { error } = await sb.from("business_collections").delete().eq("id", button.dataset.deleteCollection);
      if (error) return message("Не удалось удалить подборку.", true);
      await loadMine();
    }
  });

  document.addEventListener("localhub:auth-ready", () => {
    authGeneration += 1;
    const guest = $("collectionGuest");
    if (queryId) { if (guest) guest.hidden = true; loadPublic(); }
    else if (window.LocalHubAuth?.user) { if (guest) guest.hidden = true; if (workspace) workspace.hidden = false; $("collectionList")?.replaceChildren(); $("collectionEmpty") && ($("collectionEmpty").hidden = true); loadMine(); }
    else { if (workspace) workspace.hidden = true; $("collectionList")?.replaceChildren(); if (guest) guest.hidden = false; message("Войдите, чтобы создавать и редактировать подборки."); }
  });
  if (window.LocalHubAuth?.user && !queryId) loadMine();
})();
