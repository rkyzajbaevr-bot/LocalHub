"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const say = (element, text, error = false) => {
    if (!element) return;
    element.textContent = text;
    element.hidden = !text;
    element.classList.toggle("is-error", error);
    element.classList.toggle("is-success", !error && !!text);
  };
  const configStatus = $("#authConfigStatus");
  const pendingForms = [...document.querySelectorAll("form[data-auth]")];
  let client = null;
  let currentUser = null;
  let sessionVersion = 0;
  let sessionQueue = Promise.resolve();

  function setNav(user) {
    const link = $("#authNav");
    if (link) {
      link.href = user ? "account" : "login";
      link.textContent = user ? "Кабинет" : "Войти";
    }
    document.querySelectorAll("[data-auth-logout]").forEach((button) => {
      button.hidden = !user;
    });
    document.querySelectorAll("[data-auth-email]").forEach((node) => {
      node.textContent = user?.email || "";
    });
    const accountLogin = $("#accountLoginLink");
    if (accountLogin) accountLogin.hidden = !!user;
    const meta = $("#profileMeta");
    if (meta) meta.hidden = !user;
    const status = $("#accountAuthStatus");
    if (status) say(status, user ? "Аккаунт подключён. Персональные данные читаются из базы." : "Войдите, чтобы использовать аккаунт и синхронизировать данные.");
    const adminLink = $("#adminShortcut");
    if (adminLink) {
      adminLink.hidden = true;
      if (user && client) {
        const userId = user.id;
        const version = sessionVersion;
        client.auth.getUser().then(({ data, error }) => {
          if (version !== sessionVersion || currentUser?.id !== userId) return;
          adminLink.hidden = !!error || data.user?.app_metadata?.role !== "admin";
        }).catch(() => {
          if (version === sessionVersion && currentUser?.id === userId) adminLink.hidden = true;
        });
      }
    }
    const favoritesNote = $("#favoritesStorageNote");
    if (favoritesNote) favoritesNote.textContent = user ? "Избранное для аккаунта хранится в базе данных." : "Гостевое избранное хранится локально; после входа синхронизируется с базой.";
    const clearHistory = $("clearHistoryButton");
    if (clearHistory) clearHistory.hidden = false;
    if (!user) renderGuestHistory();
    const searchesNote = $("#savedSearchStorageNote");
    if (searchesNote) searchesNote.textContent = user ? "Сохранённые поиски для аккаунта хранятся в базе данных." : "Гостевые поиски локальные; в аккаунте сохраняются в базе данных.";
  }

  function renderGuestHistory() {
    const target = $("#accountHistory"), empty = $("#accountHistoryEmpty");
    if (!target || !empty) return;
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem("localhub:guest-history") || "[]"); if (!Array.isArray(rows)) rows = []; } catch {}
    target.innerHTML = rows.map((item) => `<article class="history-item"><div><b><a href="business.html?id=${encodeURIComponent(item.id)}">${escapeHtml(item.name || "Организация")}</a></b><small>${escapeHtml([item.city, item.address].filter(Boolean).join(" · "))}</small></div><time>${escapeHtml(new Date(item.viewedAt).toLocaleString("ru-RU"))}</time><button type="button" class="btn btn--ghost" data-guest-history-remove="${escapeHtml(item.id)}">Удалить</button></article>`).join("");
    empty.hidden = rows.length > 0;
    if (!rows.length) say(empty, "Недавно просмотренные организации появятся здесь.");
  }

  function setFormsEnabled(enabled) {
    pendingForms.forEach((form) => {
      form.querySelectorAll("input, button[type=submit]").forEach((control) => {
        control.disabled = !enabled;
      });
    });
  }

  function loadSdk() {
    return new Promise((resolve, reject) => {
      if (window.supabase?.createClient) return resolve();
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0";
      script.async = true;
      script.onload = () => window.supabase?.createClient ? resolve() : reject(new Error("Supabase SDK недоступен."));
      script.onerror = () => reject(new Error("Не удалось загрузить библиотеку Supabase. Проверьте подключение к интернету."));
      document.head.append(script);
    });
  }

  function recordPageView() {
    try {
      const now = Date.now();
      let visitorId = localStorage.getItem("localhub:site-visitor");
      if (!/^[0-9a-f-]{36}$/i.test(visitorId || "")) { visitorId = crypto.randomUUID(); localStorage.setItem("localhub:site-visitor", visitorId); }
      let sessionId = sessionStorage.getItem("localhub:site-session");
      const started = Number(sessionStorage.getItem("localhub:site-session-start")) || 0;
      if (!/^[0-9a-f-]{36}$/i.test(sessionId || "") || now - started > 30 * 60 * 1000) {
        sessionId = crypto.randomUUID(); sessionStorage.setItem("localhub:site-session", sessionId); sessionStorage.setItem("localhub:site-session-start", String(now));
      }
      const page = location.pathname.toLowerCase();
      fetch("/api/site-analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page, visitorId, sessionId }), keepalive: true }).catch(() => {});
    } catch {}
  }

  function clearPrivateUi() {
    for (const id of ["profileEmail", "profileCreatedAt", "profileUsername", "profileAvatar"]) {
      const element = $("#" + id);
      if (!element) continue;
      if (element instanceof HTMLInputElement) element.value = "";
      else element.textContent = "";
    }
    const history = $("#accountHistory");
    if (history) history.replaceChildren();
    const historyEmpty = $("#accountHistoryEmpty");
    if (historyEmpty) {
      historyEmpty.hidden = false;
      historyEmpty.textContent = "Войдите в аккаунт, чтобы вести историю в базе данных.";
    }
    const searches = $("#savedSearchList");
    if (searches) searches.replaceChildren();
    const searchesEmpty = $("#savedSearchEmpty");
    if (searchesEmpty) {
      searchesEmpty.hidden = false;
      searchesEmpty.textContent = "Сохранённых поисков пока нет.";
    }
    const favorites = $("#accountFavoriteList");
    if (favorites) favorites.replaceChildren();
    const notifications = $("#notificationList"); if (notifications) notifications.replaceChildren();
    const verification = $("#verificationPanel"); if (verification) verification.hidden = true;
    const claims = $("#claimPanel"); if (claims) claims.hidden = true;
    for (const id of ["accountFavCount", "favCount"]) {
      const count = $("#" + id);
      if (count) count.textContent = "0";
    }
  }

  function scheduleAuthState(eventName, session) {
    const version = ++sessionVersion;
    const user = session?.user || null;
    // Run after the Supabase auth callback has returned and released its internal lock.
    setTimeout(() => {
      sessionQueue = sessionQueue.catch(() => {}).then(async () => {
        if (version !== sessionVersion) return;
        const oldId = currentUser?.id || null;
        currentUser = user;
        if (oldId !== (user?.id || null)) clearPrivateUi();
        setNav(currentUser);
        document.dispatchEvent(new CustomEvent("localhub:auth-ready", {
          detail: { user: currentUser, event: eventName, version },
        }));
        if (currentUser) {
          loadProfile(currentUser, version).catch(() => {});
        }
      });
    }, 0);
  }

  async function loadProfile(user, version) {
    const email = $("#profileEmail");
    const created = $("#profileCreatedAt");
    const usernameInput = $("#profileUsername");
    const avatarInput = $("#profileAvatar");
    if (email) email.textContent = user?.email || "";
    if (created && user?.created_at) created.textContent = new Date(user.created_at).toLocaleDateString("ru-RU");
    if (!client || !user) return;
    if (usernameInput) {
      const { data, error } = await client.from("profiles").select("username, avatar_url").eq("id", user.id).maybeSingle();
      if (!error && data && version === sessionVersion && currentUser?.id === user.id) {
        usernameInput.value = data.username || "";
        if (avatarInput) avatarInput.value = data.avatar_url || "";
      }
    }
    await loadAccountHistory(user, version);
    await loadNotifications(user, version);
    await loadVerificationOptions(user, version);
    await loadBusinessClaimOptions(user, version);
  }

  async function loadBusinessClaimOptions(user, version) {
    const panel = $("#claimPanel"), select = $("#claimOrganization"), list = $("#businessClaimList");
    if (!panel || !client || !user) return;
    panel.hidden = false;
    const [orgResult, claimResult] = await Promise.all([
      client.from("organizations").select("id,name,city").order("name").limit(1000),
      client.from("business_claim_requests").select("id,organization_id,status,review_note,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    ]);
    if (version !== sessionVersion || currentUser?.id !== user.id) return;
    if (orgResult.error) { select.replaceChildren(new Option("Не удалось загрузить организации", "")); select.disabled = true; return; }
    select.disabled = false;
    select.replaceChildren(...(orgResult.data || []).map((org) => new Option(`${org.name} · ${org.city}`, org.id)));
    if (list) list.innerHTML = (claimResult.data || []).map((row) => `<article class="history-item"><b>${escapeHtml(orgResult.data?.find((org) => org.id === row.organization_id)?.name || row.organization_id)}</b><span>${escapeHtml(row.status)} · ${escapeHtml(row.review_note || new Date(row.created_at).toLocaleDateString("ru-RU"))}</span></article>`).join("");
  }

  async function loadNotifications(user, version) {
    const list = $("#notificationList");
    if (!list || !client || !user) return;
    const { data, error } = await client.from("user_notifications").select("id,notification_type,title,body,link,read_at,created_at").order("created_at", { ascending: false }).limit(100);
    if (version !== sessionVersion || currentUser?.id !== user.id) return;
    if (error) { list.textContent = "Не удалось загрузить уведомления."; return; }
    list.innerHTML = (data || []).map((item) => `<article class="history-item ${item.read_at ? "" : "notification-unread"}"><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.body)}</small></div><time>${escapeHtml(new Date(item.created_at).toLocaleString("ru-RU"))}</time><div class="notification-actions">${item.link ? `<a class="btn btn--ghost" href="${escapeHtml(item.link)}">Открыть</a>` : ""}${item.read_at ? "" : `<button type="button" class="btn btn--ghost" data-notification-read="${escapeHtml(item.id)}">Прочитано</button>`}<button type="button" class="btn btn--ghost" data-notification-delete="${escapeHtml(item.id)}">Удалить</button></div></article>`).join("");
    const empty = $("#notificationEmpty"); if (empty) { empty.hidden = !!data?.length; if (!data?.length) empty.textContent = "Новых уведомлений пока нет."; }
    const unread = (data || []).filter((item) => !item.read_at).length;
    const nav = document.querySelector('[data-notifications-count]'); if (nav) nav.textContent = String(unread);
    const all = $("#notificationsReadAll"); if (all) all.hidden = !unread;
  }

  async function loadVerificationOptions(user, version) {
    const panel = $("#verificationPanel"), select = $("#verificationOrganization"), list = $("#verificationRequestList");
    if (!panel || !client || !user) return;
    const { data: owners, error } = await client.from("business_owners").select("organization_id,organizations(name)").eq("user_id", user.id);
    if (version !== sessionVersion || currentUser?.id !== user.id) return;
    if (error || !owners?.length) { panel.hidden = true; return; }
    panel.hidden = false;
    select.replaceChildren(...owners.map((row) => new Option(row.organizations?.name || row.organization_id, row.organization_id)));
    const { data: requests } = await client.from("organization_verification_requests").select("organization_id,status,review_note,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
    if (list) list.innerHTML = (requests || []).map((row) => `<article class="history-item"><b>${escapeHtml(owners.find((owner) => owner.organization_id === row.organization_id)?.organizations?.name || row.organization_id)}</b><span>${escapeHtml(row.status)} · ${escapeHtml(row.review_note || new Date(row.created_at).toLocaleDateString("ru-RU"))}</span></article>`).join("");
  }

  async function loadAccountHistory(user, version) {
    const target = $("#accountHistory");
    const empty = $("#accountHistoryEmpty");
    if (!target || !empty || !user) return;
    const { data, error } = await cloud.history();
    if (version !== sessionVersion || currentUser?.id !== user.id) return;
    if (error) {
      say(empty, "Не удалось загрузить историю из базы.", true);
      return;
    }
    const rows = data || [];
    target.innerHTML = rows.map((item) => {
      const title = item.organizations?.name || (item.search_params?.type === "view" ? "Организация недоступна в каталоге" : "Поиск LocalHub");
      const details = item.organizations ? `${item.organizations.city || "Город не указан"} · ${item.organizations.category_id || "Категория не указана"}` : Object.entries(item.search_params || {}).map(([key, value]) => `${key}: ${value}`).join(" · ");
      const view = item.search_params?.type === "view" && item.organization_id;
      return `<article class="history-item"><div><b>${item.organizations?.id ? `<a href="business.html?id=${encodeURIComponent(item.organizations.id)}">${escapeHtml(title)}</a>` : escapeHtml(title)}</b><small>${escapeHtml(details || "")}</small></div><time>${escapeHtml(new Date(item.created_at).toLocaleString("ru-RU"))}</time>${view ? `<button type="button" class="btn btn--ghost" data-history-remove="${escapeHtml(item.id)}">Удалить</button>` : ""}</article>`;
    }).join("");
    empty.hidden = rows.length > 0;
    if (!rows.length) say(empty, "История пока пуста.");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  const cloud = {
    get user() { return currentUser; },
    get ready() { return !!client; },
    get client() { return client; },
    async favoriteIds() {
      if (!client || !currentUser) return { data: null, error: new Error("Требуется вход в аккаунт.") };
      const { data, error } = await client.from("favorites").select("organization_id");
      return { data: data?.map((row) => row.organization_id) || null, error };
    },
    async setFavorite(organizationId, isFavorite) {
      if (!client || !currentUser) return { error: new Error("Требуется вход в аккаунт.") };
      if (isFavorite) return client.from("favorites").insert({ user_id: currentUser.id, organization_id: organizationId });
      return client.from("favorites").delete().eq("user_id", currentUser.id).eq("organization_id", organizationId);
    },
    async savedSearches() {
      if (!client || !currentUser) return { data: null, error: new Error("Требуется вход в аккаунт.") };
      return client.from("saved_searches").select("id,name,search_params,created_at,updated_at").order("created_at", { ascending: false }).limit(100);
    },
    async saveSearch(entry) {
      if (!client || !currentUser) return { error: new Error("Требуется вход в аккаунт.") };
      const label = (entry.query || entry.city || "Мой поиск").slice(0, 100);
      return client.from("saved_searches").insert({ user_id: currentUser.id, name: label, search_params: entry });
    },
    async deleteSearch(id) {
      if (!client || !currentUser) return { error: new Error("Требуется вход в аккаунт.") };
      return client.from("saved_searches").delete().eq("id", id).eq("user_id", currentUser.id);
    },
    async renameSearch(id, name) {
      if (!client || !currentUser) return { error: new Error("Требуется вход в аккаунт.") };
      return client.from("saved_searches").update({ name }).eq("id", id).eq("user_id", currentUser.id);
    },
    async recordSearch(searchParams) {
      if (!client || !currentUser) return { error: null };
      return client.from("search_history").insert({ user_id: currentUser.id, search_params: searchParams });
    },
    async recordView(organizationId, organization = null) {
      if (!organizationId) return { error: null };
      if (organization) {
        try {
          const signalKey = scopedKey("localhub:recommendation-signals", currentUser?.id || "guest");
          const signals = JSON.parse(localStorage.getItem(signalKey) || "[]");
          localStorage.setItem(signalKey, JSON.stringify([{ id: String(organizationId), category: organization.category || organization.category_id || "", city: organization.city || "", viewedAt: new Date().toISOString() }, ...(Array.isArray(signals) ? signals.filter((item) => String(item.id) !== String(organizationId)) : [])].slice(0, 30)));
        } catch {}
      }
      if (!currentUser && organization) {
        try {
          const rows = JSON.parse(localStorage.getItem("localhub:guest-history") || "[]");
          const next = [{ id: String(organizationId), name: organization.name, city: organization.city, address: organization.address, viewedAt: new Date().toISOString() }, ...(Array.isArray(rows) ? rows.filter((item) => String(item.id) !== String(organizationId)) : [])].slice(0, 100);
          localStorage.setItem("localhub:guest-history", JSON.stringify(next));
          renderGuestHistory();
        } catch {}
      }
      try {
        let sessionId = localStorage.getItem("localhub:analytics-session");
        if (!sessionId) { sessionId = crypto.randomUUID(); localStorage.setItem("localhub:analytics-session", sessionId); }
        fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: String(organizationId), action: "view", sessionId }) }).catch(() => {});
      } catch {}
      if (!client || !currentUser) return { error: null };
      return client.rpc("record_organization_view", { p_organization_id: String(organizationId) });
    },
    async history() {
      if (!client || !currentUser) return { data: null, error: new Error("Требуется вход в аккаунт.") };
      return client.from("search_history").select("id,search_params,organization_id,created_at,organizations(id,name,city,category_id)").order("created_at", { ascending: false }).limit(100);
    },
    async clearHistory() {
      if (!client || !currentUser) return { error: new Error("Требуется вход в аккаунт.") };
      return client.from("search_history").delete().eq("user_id", currentUser.id);
    },
    async organizations() {
      if (!client) return { data: null, error: new Error("Supabase не настроен.") };
      const core = "id,name,category_id,city,region,address,lat,lon,phone,website,photo,hours,rating,rating_source,source,published_at,updated_at";
      let result = await client.from("organizations").select(`${core},description,price_summary,services`).order("name").limit(500);
      if (result.error && ["42703", "PGRST204"].includes(result.error.code)) result = await client.from("organizations").select(core).order("name").limit(500);
      if (result.error || !Array.isArray(result.data)) return result;
      const badges = await client.from("organization_badges").select("organization_id,badge_type,source,starts_at,expires_at").lte("starts_at", new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
      if (!badges.error) {
        const byOrganization = new Map();
        for (const badge of badges.data || []) { const list = byOrganization.get(badge.organization_id) || []; list.push(badge); byOrganization.set(badge.organization_id, list); }
        for (const organization of result.data) organization.badges = byOrganization.get(organization.id) || [];
      }
      let campaigns = { data: [], error: null };
      try {
        const response = await fetch("/api/ads?placement=catalog", { headers: { Accept: "application/json" } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("Campaign catalog unavailable");
        campaigns.data = Array.isArray(data.items) ? data.items : [];
      } catch { campaigns.error = new Error("Campaign catalog unavailable"); }
      if (!campaigns.error) {
        const advertised = new Map();
        for (const campaign of campaigns.data || []) { const list = advertised.get(campaign.organization_id) || []; list.push(campaign); advertised.set(campaign.organization_id, list); }
        for (const organization of result.data) {
          const campaign = (advertised.get(organization.id) || []).find((item) => (!item.city || item.city === organization.city) && (!item.category_id || item.category_id === organization.category_id));
          if (campaign) { organization.activeAd = true; organization.adName = campaign.name; }
        }
      }
      return result;
    },
    async categories() {
      if (!client) return { data: null, error: new Error("Supabase не настроен.") };
      return client.from("categories").select("id,name,description,icon,is_active").eq("is_active", true).order("name");
    },
    async submitOrganization(item) {
      if (!client || !currentUser) return { error: new Error("Войдите в аккаунт, чтобы отправить организацию на модерацию.") };
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) return { error: sessionError || new Error("Сессия истекла. Войдите снова.") };
      try {
        const response = await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session.access_token}` },
          body: JSON.stringify({
        organization_name: item.name,
        category_id: item.category,
        city: item.city,
        region: item.region || null,
        address: item.address,
        phone: item.phone || null,
        website: item.website || null,
        photo: item.photo || null,
        lat: item.lat,
        lon: item.lon,
        source: item.source,
      }),
        });
        const result = await response.json().catch(() => ({}));
        return response.ok ? { data: result.item, error: null } : { error: new Error(result.error || "Не удалось отправить предложение.") };
      } catch {
        return { error: new Error("Сервер временно недоступен. Предложение не отправлено.") };
      }
    },
    async saveProfile(username, avatarUrl) {
      if (!client || !currentUser) return { error: new Error("Требуется вход в аккаунт.") };
      return client.from("profiles").update({ username, avatar_url: avatarUrl || null }).eq("id", currentUser.id);
    },
  };
  window.LocalHubAuth = cloud;

  async function handleAuth(form) {
    const message = form.querySelector("[data-auth-status]");
    const submit = form.querySelector("[type=submit]");
    const values = Object.fromEntries(new FormData(form));
    const mode = form.dataset.auth;
    say(message, "");
    if ((mode === "register" || mode === "update-password") && values.password !== values.passwordConfirm) {
      say(message, "Пароли не совпадают.", true);
      return;
    }
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = "Подождите…";
    try {
      let result;
      if (mode === "login") {
        result = await client.auth.signInWithPassword({ email: values.email.trim(), password: values.password });
        if (!result.error) location.assign("account");
      } else if (mode === "register") {
        result = await client.auth.signUp({
          email: values.email.trim(),
          password: values.password,
          options: { emailRedirectTo: `${location.origin}/login` },
        });
        if (!result.error) say(message, result.data.session ? "Аккаунт создан. Вы вошли." : "Запрос принят. Если подтверждение email включено, проверьте почту.");
      } else if (mode === "forgot") {
        result = await client.auth.resetPasswordForEmail(values.email.trim(), { redirectTo: `${location.origin}/update-password` });
        if (!result.error) say(message, "Если для этого адреса есть аккаунт, письмо восстановления отправлено.");
      } else if (mode === "update-password") {
        const { data } = await client.auth.getSession();
        if (!data.session) throw new Error("Ссылка восстановления истекла или недействительна. Запросите новую.");
        result = await client.auth.updateUser({ password: values.password });
        if (!result.error) say(message, "Пароль обновлён. Теперь можно войти с новым паролем.");
      }
      if (result?.error) throw result.error;
    } catch (error) {
      say(message, error?.message || "Не удалось выполнить запрос. Попробуйте позже.", true);
    } finally {
      submit.disabled = false;
      submit.textContent = original;
    }
  }

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-auth]");
    if (!form || !client) return;
    event.preventDefault();
    handleAuth(form);
  });
  document.addEventListener("click", async (event) => {
    const logout = event.target.closest("[data-auth-logout]");
    if (!logout || !client) return;
    logout.disabled = true;
    try {
      const { error } = await client.auth.signOut();
      logout.disabled = false;
      if (error) say(configStatus, error.message, true);
      else {
        sessionVersion += 1;
        currentUser = null;
        clearPrivateUi();
        setNav(null);
        document.dispatchEvent(new CustomEvent("localhub:auth-ready", {
          detail: { user: null, event: "SIGNED_OUT", version: sessionVersion },
        }));
        location.assign("index.html");
      }
    } catch (error) {
      logout.disabled = false;
      say(configStatus, error?.message || "Не удалось завершить сеанс.", true);
    }
  });
  $("#profileForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector("[data-profile-status]");
    const username = form.elements.namedItem("username").value.trim();
    const avatar = form.elements.namedItem("avatar_url").value.trim();
    if (avatar && !/^https:\/\//i.test(avatar)) return say(status, "Аватар должен быть доступен по HTTPS-ссылке.", true);
    const { error } = await cloud.saveProfile(username || null, avatar || null);
    say(status, error ? error.message : "Профиль сохранён в Supabase.", !!error);
  });

  async function initialize() {
    let config;
    try {
      const response = await fetch("/api/supabase-config", { headers: { Accept: "application/json" } });
      config = await response.json();
      if (!response.ok || !config.configured) throw new Error(config.message || "Supabase не настроен.");
      await loadSdk();
    } catch (error) {
      say(configStatus, error.message || "Supabase сейчас недоступен.", true);
      setFormsEnabled(false);
      scheduleAuthState("CONFIG_MISSING", null);
      return;
    }
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    });
    let ignoreFirstInitialSession = true;
    client.auth.onAuthStateChange((_event, session) => {
      if (_event === "INITIAL_SESSION" && ignoreFirstInitialSession) {
        ignoreFirstInitialSession = false;
        return;
      }
      scheduleAuthState(_event, session);
    });
    const { data, error } = await client.auth.getSession();
    if (error) {
      say(configStatus, error.message, true);
      scheduleAuthState("INITIAL_SESSION", null);
    } else scheduleAuthState("INITIAL_SESSION", data?.session || null);
    setFormsEnabled(true);
    if (!error && configStatus) configStatus.hidden = true;
  }

  $("#accountHistory")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-guest-history-remove]");
    if (!button || currentUser) return;
    try {
      const rows = JSON.parse(localStorage.getItem("localhub:guest-history") || "[]");
      localStorage.setItem("localhub:guest-history", JSON.stringify((Array.isArray(rows) ? rows : []).filter((item) => String(item.id) !== button.dataset.guestHistoryRemove)));
      renderGuestHistory();
    } catch {}
  });
  $("#accountHistory")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-history-remove]");
    if (!button || !client || !currentUser) return;
    const { error } = await client.from("search_history").delete().eq("id", button.dataset.historyRemove).eq("user_id", currentUser.id);
    if (!error) await loadAccountHistory(currentUser, sessionVersion);
  });
  $("#notificationList")?.addEventListener("click", async (event) => {
    if (!client || !currentUser) return;
    const read = event.target.closest("[data-notification-read]"), remove = event.target.closest("[data-notification-delete]");
    const id = read?.dataset.notificationRead || remove?.dataset.notificationDelete;
    if (!id) return;
    const query = client.from("user_notifications");
    const result = read ? await query.update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", currentUser.id) : await query.delete().eq("id", id).eq("user_id", currentUser.id);
    if (result.error) return;
    await loadNotifications(currentUser, sessionVersion);
  });
  $("#notificationsReadAll")?.addEventListener("click", async () => {
    if (!client || !currentUser) return;
    await client.from("user_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", currentUser.id).is("read_at", null);
    await loadNotifications(currentUser, sessionVersion);
  });
  $("#verificationRequestForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget, status = $("#verificationRequestStatus");
    if (!client || !currentUser) return say(status, "Войдите в аккаунт.", true);
    const organizationId = form.elements.namedItem("organizationId").value;
    const evidenceUrl = form.elements.namedItem("evidenceUrl").value.trim();
    try { const url = new URL(evidenceUrl); if (url.protocol !== "https:") throw new Error(); } catch { return say(status, "Укажите корректную HTTPS-ссылку на подтверждающие материалы.", true); }
    const { error } = await client.from("organization_verification_requests").insert({ organization_id: organizationId, user_id: currentUser.id, evidence_url: evidenceUrl });
    if (error) return say(status, error.code === "23505" ? "Для этой организации уже есть заявка на рассмотрении." : "Заявку не удалось отправить. Проверьте права владельца.", true);
    say(status, "Заявка отправлена на проверку.");
    loadVerificationOptions(currentUser, sessionVersion).catch(() => {});
  });
  $("#businessClaimForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget, status = $("#businessClaimStatus");
    if (!client || !currentUser) return say(status, "Войдите в аккаунт.", true);
    const values = Object.fromEntries(new FormData(form));
    try { const url = new URL(values.evidenceUrl); if (url.protocol !== "https:") throw new Error(); } catch { return say(status, "Укажите корректную HTTPS-ссылку.", true); }
    const { error } = await client.from("business_claim_requests").insert({ organization_id: values.organizationId, user_id: currentUser.id, contact_name: values.contactName.trim(), contact_phone: values.contactPhone.trim(), evidence_url: values.evidenceUrl.trim() });
    if (error) return say(status, error.code === "23505" ? "Заявка для этой организации уже рассматривается." : "Не удалось отправить заявку.", true);
    say(status, "Заявка отправлена. Права доступа появятся после проверки администратором.");
    await loadBusinessClaimOptions(currentUser, sessionVersion);
  });
  recordPageView();
  initialize();
})();
