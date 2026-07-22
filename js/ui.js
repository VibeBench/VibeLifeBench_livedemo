/**
 * Dashboard + phone chat rendering
 */
import {
  renderLeafletMap,
  destroyMap,
  abortMapPlayback,
  pulseMapEvent,
  syncPlanningFromText,
  clearPlanning,
  focusTrafficResult,
  focusGeoKey,
  focusPlanning,
  extractPlaceIdsFromText,
  extractRoadIdsFromText,
  playFlightCrossing,
  isOceanFlightCrossing,
  playMapAction,
  hideMapActionStage,
  commitAgentItineraryPlan,
  clearAgentPlan,
} from "./map.js?v=20260722-78";
import { groupLedgerByDate } from "./ledger.js?v=20260720-33";

const KIND_META = {
  user_message: { icon: "👤", cls: "kind-user", label: "用户消息" },
  app_notification: { icon: "🔔", cls: "kind-app", label: "APP / 短信" },
  world: { icon: "🌐", cls: "kind-world", label: "外部资讯" },
  weather: { icon: "🌦️", cls: "kind-weather", label: "天气更新" },
  mutation: { icon: "⚙️", cls: "kind-mut", label: "环境静默变更" },
  notification: { icon: "🫀", cls: "kind-heart", label: "系统心跳" },
  routine: { icon: "🚗", cls: "kind-routine", label: "行程节点" },
  env_change: { icon: "🌐", cls: "kind-world", label: "环境变更" },
  agent_tool: { icon: "🛠️", cls: "kind-agent-tool", label: "Agent 工具" },
  agent_reply: { icon: "💬", cls: "kind-agent-reply", label: "Agent 回复" },
  agent_state: { icon: "📋", cls: "kind-agent-state", label: "账本变更" },
};

const DAY_ICONS = {
  plane: "✈️",
  camp: "⛺",
  mountain: "🏔️",
  lake: "🏞️",
  tree: "🌳",
  boat: "⛵",
  car: "🚗",
  ferry: "⛴️",
  city: "🏙️",
  waterfall: "💧",
  hot: "♨️",
  home: "🏠",
  pin: "📍",
  sun: "☀️",
};

export class UI {
  constructor(root = document) {
    this.root = root;
    this.els = {
      dayRibbon: $("#dayRibbon"),
      statusGrid: $("#statusGrid"),
      eventStream: $("#eventStream"),
      mapPanel: $("#mapPanel"),
      footerStats: $("#footerStats"),
      chatMessages: $("#chatMessages"),
      chatInput: $("#chatInput"),
      progressLabel: $("#progressLabel"),
      agentStatus: $("#agentStatus"),
      toast: $("#toast"),
      phoneNav: $("#phoneNav"),
      phoneToast: $("#phoneToast"),
      tripLedger: $("#tripLedger"),
      notionLedger: $("#notionLedger"),
      notionTitle: $("#notionTitle"),
      mailInbox: $("#mailInbox"),
      paneChat: $("#paneChat"),
      paneTrip: $("#paneTrip"),
      paneMail: $("#paneMail"),
      paneNotes: $("#paneNotes"),
      paneSettings: $("#paneSettings"),
    };
    this.speakers = {};
    this.kindLabels = {};
    this.activeTab = "chat";
    this._seenLedgerKeys = new Set();
    this._badges = { trip: 0, notes: 0, mail: 0 };
    this._inbox = [];
    this._highlightMailKey = null;
    this._phoneToastTimer = null;
    this._phoneToastQueue = [];
    this._phoneToastShowing = false;
    this._onTabChange = null;
    /** Only auto-scroll chat when user is already near the bottom (or just sent). */
    this._chatStickToBottom = true;
    /** Agent tool / reply / state lines mirrored into the left event stream. */
    this._activityFeed = [];
    this._activitySeq = 0;
    this._envStreamEvents = [];
    this._streamMeta = null;
    this._bindPhoneNav();
    this._bindChatScroll();
  }

  _bindChatScroll() {
    const el = this.els.chatMessages;
    if (!el || el.dataset.scrollBound) return;
    el.dataset.scrollBound = "1";
    el.addEventListener(
      "scroll",
      () => {
        this._chatStickToBottom = this._chatNearBottom();
      },
      { passive: true }
    );
  }

  _chatNearBottom(thresholdPx = 80) {
    const el = this.els.chatMessages;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
  }

  /** Scroll chat to bottom only if user hasn't pulled away to read history. */
  _scrollChatToBottom({ force = false } = {}) {
    const el = this.els.chatMessages;
    if (!el) return;
    if (!force && !this._chatStickToBottom) return;
    el.scrollTop = el.scrollHeight;
    this._chatStickToBottom = true;
  }

  onTabChange(fn) {
    this._onTabChange = fn;
  }

  /**
   * Global cinematic queue: map tool overlays + status landings play one-by-one.
   * Call waitCinematicsIdle() before advancing to the next demo stage.
   */
  enqueueCinematic(fn, { fingerprint = null } = {}) {
    if (typeof fn !== "function") return Promise.resolve(false);
    if (fingerprint && this._wasCinematicPlayed(fingerprint)) {
      return Promise.resolve(false);
    }
    if (fingerprint) this._markCinematicPlayed(fingerprint);
    if (!this._cineQueue) this._cineQueue = [];
    return new Promise((resolve, reject) => {
      this._cineQueue.push({ fn, resolve, reject });
      this._drainCinematics();
    });
  }

  _markCinematicPlayed(fp) {
    if (!this._cinePlayed) this._cinePlayed = new Map();
    this._cinePlayed.set(fp, Date.now());
  }

  _wasCinematicPlayed(fp, withinMs = 12000) {
    const t = this._cinePlayed?.get(fp);
    return Boolean(t && Date.now() - t < withinMs);
  }

  async _drainCinematics() {
    if (this._cineBusy) return;
    this._cineBusy = true;
    try {
      while (this._cineQueue?.length) {
        const { fn, resolve, reject } = this._cineQueue.shift();
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      }
    } finally {
      this._cineBusy = false;
      if (this._cineQueue?.length) {
        this._drainCinematics();
        return;
      }
      const waiters = this._cineIdleWaiters || [];
      this._cineIdleWaiters = [];
      for (const w of waiters) w();
    }
  }

  /** Resolves when the cinematic queue is empty (all tool/status anims done). */
  waitCinematicsIdle() {
    if (!this._cineBusy && !(this._cineQueue?.length)) return Promise.resolve();
    return new Promise((resolve) => {
      if (!this._cineIdleWaiters) this._cineIdleWaiters = [];
      this._cineIdleWaiters.push(resolve);
    });
  }

  /** Hard-stop queued/in-flight map cinematics (清空回溯). */
  abortCinematics() {
    clearTimeout(this._planThinkTimer);
    this._planThinkTimer = null;
    this._lastPlanThinkLen = 0;
    const queue = this._cineQueue || [];
    this._cineQueue = [];
    this._cineBusy = false;
    this._cinePlayed = new Map();
    for (const item of queue) {
      try {
        item.resolve?.(false);
      } catch {
        /* ignore */
      }
    }
    const waiters = this._cineIdleWaiters || [];
    this._cineIdleWaiters = [];
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* ignore */
      }
    }
    for (const el of document.querySelectorAll(".status-fly")) {
      try {
        el.remove();
      } catch {
        /* ignore */
      }
    }
    abortMapPlayback();
    clearAgentPlan();
    clearPlanning({ immediate: true });
  }

  /** Enqueue a map action (search / notion / calendar) on the global queue. */
  playQueuedMapAction(opts = {}) {
    const kind = opts.kind || "search";
    const fp =
      opts.fingerprint ||
      `${kind}:${String(opts.title || opts.query || "").slice(0, 80)}`;
    return this.enqueueCinematic(() => playMapAction(opts), { fingerprint: fp });
  }

  _bindPhoneNav() {
    const nav = this.els.phoneNav;
    if (!nav || nav.dataset.bound) return;
    nav.dataset.bound = "1";
    nav.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (!btn) return;
      this.setPhoneTab(btn.dataset.tab);
    });
  }

  setPhoneTab(tab, { mailKey = null } = {}) {
    const t = tab || "chat";
    this.activeTab = t;
    if (t !== "settings") this.clearNavBadge(t);
    for (const btn of this.els.phoneNav?.querySelectorAll("[data-tab]") || []) {
      btn.classList.toggle("active", btn.dataset.tab === t);
    }
    const panes = {
      chat: this.els.paneChat,
      trip: this.els.paneTrip,
      mail: this.els.paneMail,
      notes: this.els.paneNotes,
      settings: this.els.paneSettings,
    };
    for (const [key, el] of Object.entries(panes)) {
      if (!el) continue;
      const on = key === t;
      el.hidden = !on;
      el.classList.toggle("active", on);
    }
    if (t === "mail") {
      this.markInboxRead();
      if (mailKey) this._highlightMailKey = mailKey;
      this.renderMailInbox();
      if (mailKey) {
        requestAnimationFrame(() => this.focusMailItem(mailKey));
      }
    }
    if (typeof this._onTabChange === "function") this._onTabChange(t);
  }

  _flashNav(tab) {
    const btn = this.els.phoneNav?.querySelector(`[data-tab="${tab}"]`);
    if (!btn) return;
    btn.classList.add("flash");
    setTimeout(() => btn.classList.remove("flash"), 400);
  }

  bumpNavBadge(tab, by = 1) {
    if (!this._badges[tab] && this._badges[tab] !== 0) return;
    if (tab === this.activeTab) return;
    this._badges[tab] = Math.min(99, (this._badges[tab] || 0) + by);
    this._paintBadges();
  }

  clearNavBadge(tab) {
    if (tab in this._badges) this._badges[tab] = 0;
    this._paintBadges();
  }

  _paintBadges() {
    for (const [tab, n] of Object.entries(this._badges)) {
      const el = this.els.phoneNav?.querySelector(`[data-badge="${tab}"]`);
      if (!el) continue;
      if (n > 0) {
        el.hidden = false;
        el.textContent = n > 9 ? "9+" : String(n);
      } else {
        el.hidden = true;
        el.textContent = "0";
      }
    }
  }

  /**
   * Detect new ledger items → tab badges + in-phone toast banners + chat history cards.
   * Fires once per new flight / hotel status / notion snippet (not only tip summary).
   */
  syncLedgerAlerts(ledger) {
    if (!this._seenLedgerKeys) this._seenLedgerKeys = new Set();
    if (!this._phoneToastQueue) this._phoneToastQueue = [];
    const alerts = collectLedgerAlerts(ledger);
    const fresh = alerts.filter((a) => !this._seenLedgerKeys.has(a.key));
    for (const a of fresh) this._seenLedgerKeys.add(a.key);
    if (!fresh.length) return;
    for (const a of fresh) {
      const tab = a.tab === "notes" ? "notes" : "trip";
      // notion / calendar：工具调用卡已展示，聊天里不再重复刷状态卡（地图动效仍保留）
      const skipChatCard = a.kind === "notion" || a.kind === "calendar";
      if (!skipChatCard) {
        this.bumpNavBadge(tab, 1);
        // Keep booking / status changes visible in chat history (not only toast).
        this.appendStateCard({
          icon: a.icon,
          title: a.title || a.text,
          body: a.body,
          tab,
          time: a.time || null,
          kind: a.kind || "ledger",
        });
        this.appendActivityFeed({
          id: `ledger:${a.key}`,
          kind: "agent_state",
          icon: a.icon,
          who: a.app || "账本",
          body: a.title || a.text,
          detail: a.body && a.body !== a.title ? truncate(a.body, 100) : "",
          time: a.time || null,
        });
      }
      // Map cinematic for major writes (queued; deduped vs focusMapFromTool)
      if (a.kind === "notion") {
        this.playQueuedMapAction({
          kind: "notion",
          title: a.title || "游记更新",
          body: a.mapBody || "", // stream on map; chat card stays title-only
          fingerprint: `notion:${String(a.title || "游记更新").slice(0, 80)}`,
        }).catch(() => {});
      } else if (a.kind === "calendar") {
        this.playQueuedMapAction({
          kind: "calendar",
          title: a.title || "日程",
          body: a.body || a.text || "",
          items: [
            a.time ? { label: "时间", value: String(a.time).slice(0, 16) } : null,
            { label: "日程", value: a.title || a.text || "日程" },
            a.body && a.body !== a.title ? { label: "详情", value: truncate(a.body, 48) } : null,
          ].filter(Boolean),
          fingerprint: `calendar-ledger:${a.key || a.title || Date.now()}`,
        }).catch(() => {});
      }
    }
    this.enqueuePhoneBanners(fresh.map((a) => ({ ...a, openTab: "mail" })));
  }

  /**
   * Persistent chat card for booking / ledger / write-tool side effects.
   * Stays in history; tap jumps to trip/notes tab when relevant.
   */
  appendStateCard({ icon = "🔔", title = "", body = "", tab = null, time = null, kind = "state" } = {}) {
    const wrap = document.createElement("div");
    wrap.className = `bubble state-card kind-${kind}`;
    const stamp = formatSimStamp(time);
    const timeHtml = stamp ? `<div class="bubble-time">${escapeHtml(stamp)}</div>` : "";
    const detail = body && body !== title ? `<div class="state-card-body">${escapeHtml(body)}</div>` : "";
    const tabHint =
      tab === "trip" ? "行程" : tab === "notes" ? "笔记" : tab === "mail" ? "邮件" : "";
    wrap.innerHTML = `
      ${timeHtml}
      <div class="state-card-inner">
        <span class="state-card-icon">${icon}</span>
        <div class="state-card-main">
          <div class="state-card-title">${escapeHtml(title)}</div>
          ${detail}
          ${tabHint ? `<div class="state-card-hint">已记入 · ${tabHint}</div>` : ""}
        </div>
      </div>`;
    if (tab) {
      wrap.classList.add("clickable");
      wrap.addEventListener("click", () => this.setPhoneTab(tab));
    }
    this.els.chatMessages.appendChild(wrap);
    this._scrollChatToBottom({ force: true });
    return wrap;
  }

  /** Pull silent email-server mutations into the inbox (+ banner). */
  syncEnvEmails(emails, fallbackTime = null) {
    if (!emails?.length) return;
    if (!this._seenLedgerKeys) this._seenLedgerKeys = new Set();
    const fresh = [];
    for (const em of emails) {
      const id = em.id ?? em.message_id ?? em.subject;
      if (id == null) continue;
      const key = `email:${id}`;
      if (this._seenLedgerKeys.has(key)) continue;
      this._seenLedgerKeys.add(key);
      const subject = String(em.subject || "无主题").trim();
      const from = String(em.from_addr || em.from || "未知发件人").trim();
      const body = String(em.body_text || em.body || "").trim();
      fresh.push({
        key,
        icon: "✉️",
        app: "邮件",
        text: subject.length > 42 ? subject.slice(0, 40) + "…" : subject,
        title: subject,
        body: body || subject,
        from,
        time: em.date || em.created_at || fallbackTime || null,
        kind: "email",
        openTab: "mail",
      });
    }
    if (fresh.length) this.enqueuePhoneBanners(fresh);
  }

  enqueuePhoneBanners(items) {
    if (!items?.length) return;
    if (!this._phoneToastQueue) this._phoneToastQueue = [];
    for (const item of items) this.archiveToInbox(item);
    const batch = items.length > 4 ? items.slice(-4) : items;
    this._phoneToastQueue.push(...batch);
    if (!this._phoneToastShowing) this._drainPhoneBannerQueue();
  }

  _drainPhoneBannerQueue() {
    const next = this._phoneToastQueue.shift();
    if (!next) {
      this._phoneToastShowing = false;
      return;
    }
    this.showPhoneBanner(next);
  }

  /**
   * In-phone notification. Auto-fades after 5s (tap × / card still dismisses early).
   * Tapping the card opens 邮件 and focuses the archived item.
   */
  showPhoneBanner(change) {
    const el = this.els.phoneToast || $("#phoneToast");
    if (!el || !change) return;
    this.els.phoneToast = el;
    this._phoneToastShowing = true;
    clearTimeout(this._phoneToastTimer);
    this._phoneToastTimer = null;
    clearTimeout(this._phoneToastFadeTimer);
    this._phoneToastFadeTimer = null;

    const icon = change.icon || "🔔";
    const text = change.text || "有新通知";
    const app = change.app || "通知";
    const mailKey = change.key || null;
    const pending = this._phoneToastQueue?.length || 0;

    el.hidden = false;
    el.removeAttribute("hidden");
    el.classList.remove("is-leaving");
    el.className = "phone-toast show";
    el.innerHTML = `
      <div class="phone-toast-top">
        <span class="phone-toast-app">${escapeHtml(app)}</span>
        ${pending ? `<span class="phone-toast-more">还有 ${pending} 条</span>` : ""}
        <button type="button" class="phone-toast-close" aria-label="关闭">×</button>
      </div>
      <span class="phone-toast-body">${icon} ${escapeHtml(text)}</span>`;

    const dismiss = (openMail) => {
      this.hidePhoneBanner({ advanceQueue: true });
      if (openMail) this.setPhoneTab("mail", { mailKey });
    };
    el.querySelector(".phone-toast-close")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      dismiss(false);
    });
    el.onclick = (ev) => {
      if (ev.target.closest(".phone-toast-close")) return;
      dismiss(true);
    };

    // Default: auto fade-out after 5s
    this._phoneToastTimer = setTimeout(() => {
      this._phoneToastTimer = null;
      this.hidePhoneBanner({ advanceQueue: true });
    }, 5000);
  }

  /** Explicit notify from tool writes / mutations / env events. */
  notifyStateChange({
    icon = "🔔",
    text = "状态已更新",
    tab = "mail",
    app = "账本",
    key,
    title,
    body,
    from,
    time,
    kind,
    chat = true,
  } = {}) {
    const k = key || `manual:${text}`;
    if (!this._seenLedgerKeys) this._seenLedgerKeys = new Set();
    if (this._seenLedgerKeys.has(k)) return;
    this._seenLedgerKeys.add(k);
    if (tab === "trip" || tab === "notes") this.bumpNavBadge(tab, 1);
    if (chat) {
      this.appendStateCard({
        icon,
        title: title || text,
        body: body || "",
        tab: tab === "mail" ? null : tab,
        time,
        kind: kind || "state",
      });
    }
    this.enqueuePhoneBanners([
      {
        icon,
        text,
        tab,
        app,
        key: k,
        title,
        body,
        from,
        time,
        kind,
        openTab: "mail",
      },
    ]);
  }

  /**
   * Silent env writes (mutations): applied in the engine only.
   * Intentionally not shown in chat / timeline / phone / map.
   */
  notifyMutation(_event) {
    return "";
  }

  /** Phone toast for playback events that should surface on the handset. */
  notifyEnvEvent(event) {
    if (!event) return;
    const toast = envEventToast(event);
    if (!toast) return;
    const body = String(event.body || "").trim();
    const title = firstLine(body) || toast.text;

    // Weather: bubble on the place — status bar keeps day weather from the timeline.
    if (event.kind === "weather") {
      const geoKey = event.user_state?.geo_key || null;
      const w = event.user_state?.weather || title || body;
      const blob = `${w} ${title} ${body}`;
      this.pulseMapFeedback({
        id: `env:${event.id}`,
        icon: weatherEmojiFromText(blob),
        title: geoLabel(geoKey) ? `${geoLabel(geoKey)}天气` : "天气更新",
        detail: String(w || "").slice(0, 96),
        kind: "weather",
        placeId: extractPlaceIdsFromText(blob)[0] || null,
        geoKey,
      });
      this.archiveToInbox({
        ...toast,
        key: `event:${event.id}`,
        title,
        body: body || toast.text,
        time: event.time || null,
        from: toast.from || toast.app,
      });
      return;
    }

    this.notifyStateChange({
      ...toast,
      tab: "mail",
      key: `event:${event.id}`,
      title,
      body: body || toast.text,
      time: event.time || null,
      kind: event.kind,
      from: toast.from || toast.app,
      // SMS goes into chat via appendSmsChat — skip generic state card.
      chat: !(event.kind === "world" || event.kind === "app_notification"),
    });

    // World / APP notices → chat SMS bubble + map: pan to user + shake emoji on pin.
    if (event.kind === "world" || event.kind === "app_notification") {
      const isMail =
        toast.app === "邮件" ||
        /email/i.test(String(event.channel || event.source || "")) ||
        /邮件|收件箱|@/.test(`${toast.from || ""} ${body || ""}`);
      this.appendSmsChat({
        text: truncate(body || toast.text || title, 160),
        from: toast.from || toast.app || (isMail ? "收件箱" : "短信通知"),
        time: event.time || null,
        channel: isMail ? "email" : "sms",
      });
      this.pulseMapFeedback({
        id: `env:${event.id}`,
        icon: toast.icon || (isMail ? "✉️" : "💬"),
        title: truncate(title, 36),
        detail: truncate(body && body !== title ? body : toast.text || "", 72),
        kind: isMail ? "email" : "sms",
        holdMs: 1600,
      });
      return;
    }

    // Other location-related env messages: place bubble on the map.
    const blob = `${title} ${body} ${event.user_state?.location || ""}`;
    const placeIds = extractPlaceIdsFromText(blob);
    const roadIds = extractRoadIdsFromText(blob);
    const geoKey = event.user_state?.geo_key || null;
    if (placeIds.length || roadIds.length || geoKey) {
      this.pulseMapFeedback({
        id: `env:${event.id}`,
        icon: toast.icon || "📌",
        title: truncate(title, 36),
        detail: truncate(body && body !== title ? body : toast.text || "", 72),
        kind: event.kind || "env",
        placeId: placeIds[0] || null,
        geoKey,
        roadId: roadIds[0] || null,
      });
    }
  }

  /** Archive a banner/notification into the mail inbox (deduped by key). */
  archiveToInbox(item) {
    if (!item) return;
    if (!this._inbox) this._inbox = [];
    const key = item.key || `mail:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const title = String(item.title || item.text || "新消息").trim();
    const body = String(item.body || item.text || "").trim();
    const entry = {
      key,
      time: item.time || null,
      app: item.app || "通知",
      icon: item.icon || "✉️",
      from: item.from || item.app || "系统",
      title,
      body,
      preview: previewText(body || title, 72),
      kind: item.kind || "notice",
      unread: true,
      open: false,
    };
    const idx = this._inbox.findIndex((m) => m.key === key);
    if (idx >= 0) {
      const prev = this._inbox[idx];
      this._inbox[idx] = { ...prev, ...entry, unread: true, open: prev.open };
      const [row] = this._inbox.splice(idx, 1);
      this._inbox.unshift(row);
    } else {
      this._inbox.unshift(entry);
      if (this.activeTab !== "mail") this.bumpNavBadge("mail", 1);
    }
    if (this.activeTab === "mail") {
      entry.unread = false;
      this.renderMailInbox();
    } else {
      this.renderMailInbox();
    }
  }

  markInboxRead() {
    for (const m of this._inbox || []) m.unread = false;
    this.clearNavBadge("mail");
  }

  focusMailItem(key) {
    const el = this.els.mailInbox?.querySelector(`[data-mail-key="${cssEscape(key)}"]`);
    if (!el) return;
    el.classList.add("mail-flash");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const item = (this._inbox || []).find((m) => m.key === key);
    if (item) item.open = true;
    el.open = true;
    setTimeout(() => el.classList.remove("mail-flash"), 1200);
  }

  renderMailInbox() {
    const el = this.els.mailInbox || $("#mailInbox");
    if (!el) return;
    this.els.mailInbox = el;
    const list = this._inbox || [];
    if (!list.length) {
      el.innerHTML = `<div class="ledger-empty">通知、资讯与邮件会归档在这里。点顶部 Banner 也可跳转查看。</div>`;
      return;
    }
    const highlight = this._highlightMailKey;
    el.innerHTML = list
      .map((m) => {
        const stamp = formatSimStamp(m.time) || "";
        const open = m.open || m.key === highlight;
        const unread = m.unread ? " unread" : "";
        const flash = m.key === highlight ? " mail-flash" : "";
        return `
        <details class="mail-item${unread}${flash}" data-mail-key="${escapeHtml(m.key)}" ${open ? "open" : ""}>
          <summary>
            <span class="mail-ico">${m.icon || "✉️"}</span>
            <span class="mail-meta">
              <span class="mail-from">${escapeHtml(m.from || m.app)}</span>
              <span class="mail-time">${escapeHtml(stamp)}</span>
            </span>
            <span class="mail-subject">${escapeHtml(m.title)}</span>
            <span class="mail-preview">${escapeHtml(m.preview)}</span>
          </summary>
          <div class="mail-body">${escapeHtml(m.body || m.title).replace(/\n/g, "<br>")}</div>
        </details>`;
      })
      .join("");
    if (highlight) this._highlightMailKey = null;
    el.querySelectorAll("details.mail-item").forEach((details) => {
      details.addEventListener("toggle", () => {
        const key = details.dataset.mailKey;
        const item = (this._inbox || []).find((m) => m.key === key);
        if (item) item.open = details.open;
      });
    });
  }

  hidePhoneBanner({ advanceQueue = false } = {}) {
    const el = this.els.phoneToast || $("#phoneToast");
    clearTimeout(this._phoneToastTimer);
    this._phoneToastTimer = null;
    clearTimeout(this._phoneToastFadeTimer);
    this._phoneToastFadeTimer = null;

    const finishHide = () => {
      if (el) {
        el.classList.remove("show", "is-leaving");
        el.hidden = true;
        el.setAttribute("hidden", "");
        el.replaceChildren();
        el.onclick = null;
      }
      this._phoneToastShowing = false;
      if (advanceQueue && this._phoneToastQueue?.length) {
        this._phoneToastTimer = setTimeout(() => {
          this._phoneToastTimer = null;
          this._drainPhoneBannerQueue();
        }, 220);
      }
    };

    if (!el || el.hidden || !el.classList.contains("show")) {
      finishHide();
      return;
    }

    // Fade out, then fully remove from layout
    el.classList.remove("show");
    el.classList.add("is-leaving");
    this._phoneToastFadeTimer = setTimeout(() => {
      this._phoneToastFadeTimer = null;
      finishHide();
    }, 320);
  }

  resetLedgerAlerts() {
    this._seenLedgerKeys = new Set();
    this._badges = { trip: 0, notes: 0, mail: 0 };
    this._inbox = [];
    this._highlightMailKey = null;
    this._phoneToastQueue = [];
    this._phoneToastShowing = false;
    this.clearActivityFeed();
    this._paintBadges();
    this.hidePhoneBanner();
    this.renderMailInbox();
  }

  setMeta(meta) {
    this.speakers = meta.speakers || {};
    this.kindLabels = meta.kind_labels || {};
    $("#caseTitle").textContent = "VibeLifeBench";
    const tripName = $("#tripName");
    if (tripName) tripName.textContent = meta.title || meta.case_id;
  }

  /**
   * @param {object[]} tripDays
   * @param {string|null} activeDate YYYY-MM-DD highlighted (focus or playback)
   * @param {{ prepDays?: object[], reachedDate?: string|null, liveDate?: string|null }} [opts]
   */
  renderDayRibbon(tripDays, activeDate, { prepDays = [], reachedDate = null, liveDate = null } = {}) {
    const el = this.els.dayRibbon;
    el.innerHTML = "";

    const chips = [
      ...prepDays.map((d) => ({ ...d, phase: "prep" })),
      ...tripDays.map((d) => ({ ...d, phase: "trip" })),
    ];

    for (const d of chips) {
      const isPrep = d.phase === "prep";
      const reached = Boolean(reachedDate) && d.date <= reachedDate;
      const locked = !reached;
      const isActive = Boolean(activeDate) && d.date === activeDate;
      const isPast = Boolean(activeDate) && d.date < activeDate;
      const isLive = Boolean(liveDate) && d.date === liveDate;
      const statusLabel = isActive ? (isLive || !liveDate ? "当前" : "查看") : "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "day-chip" +
        (isPrep ? " prep" : "") +
        (isActive ? " active" : "") +
        (isPast && !locked ? " past" : "") +
        (locked ? " locked" : "") +
        (!locked && !isActive && !isPast ? " upcoming" : "");
      btn.dataset.phase = d.phase;
      btn.dataset.day = String(d.day);
      btn.dataset.date = d.date;
      btn.disabled = locked;
      btn.title = locked
        ? isPrep
          ? "尚未进展到这一天"
          : "尚未进展到这一天（规划待揭晓）"
        : isPrep
          ? `查看行前 ${d.md} · ${d.label}`
          : `查看 Day ${d.day} 地图与状态`;
      if (locked) {
        btn.innerHTML = `
        <span class="day-icon">🔒</span>
        <span class="day-num">${isPrep ? "行前" : `Day ${d.day}`}</span>
        <span class="day-md">??/??</span>
        <span class="day-label">待揭晓</span>`;
      } else if (isPrep) {
        btn.innerHTML = `
        <span class="day-icon">${DAY_ICONS[d.icon] || "📋"}</span>
        <span class="day-num">行前</span>
        <span class="day-md">${d.md}</span>
        <span class="day-label">${statusLabel ? `${statusLabel} · ` : ""}${escapeHtml(d.label || "准备")}</span>`;
      } else {
        btn.innerHTML = `
        <span class="day-icon">${DAY_ICONS[d.icon] || "📍"}</span>
        <span class="day-num">Day ${d.day}</span>
        <span class="day-md">${d.md}</span>
        <span class="day-label">${statusLabel ? `${statusLabel} · ` : ""}${escapeHtml(d.label)}</span>`;
      }
      el.appendChild(btn);
    }
    const active = el.querySelector(".day-chip.active");
    if (active) active.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  renderStatus(state, env, { budgetDisclosed = false, budgetSettled = false, flightDisclosed = false, flags = {} } = {}) {
    const budget = state?.budget || {};
    const flight = state?.next_flight || {};
    // Align with engine.progressFlags(): no spoilers before narrative beats
    const settled = budgetSettled && budget.total_cny != null && Number(budget.spent_cny) > 0;
    const flightSettled = flightDisclosed && Boolean(flight.flight_no);
    const liveFlight = flightSettled && env?.flights?.[flight.flight_no];
    const flightStatus = flightSettled
      ? liveFlight
        ? `${liveFlight.flight_no || flight.flight_no} · ${liveFlight.status || flight.status || ""}${
            liveFlight.delay_min ? ` 延误${Math.round(liveFlight.delay_min / 60)}h` : ""
          }`
        : `${flight.flight_no} · ${flight.status || flight.note || "已预订"}`
      : "待预订";
    // Kickoff「预算 5 万」即可展示目标；有支出后再切换为已用/总额
    const budgetValue =
      budgetDisclosed && budget.total_cny != null
        ? settled
          ? `已用 ¥${fmt(budget.spent_cny)} / ¥${fmt(budget.total_cny)}`
          : `预算 ¥${fmt(budget.total_cny)}`
        : "待确定";
    const budgetSub =
      budgetDisclosed && budget.total_cny != null
        ? settled
          ? budget.remaining_cny != null
            ? `剩余 ¥${fmt(budget.remaining_cny)}`
            : ""
          : "用户已确认 · 预订产生后更新明细"
        : "用户说明预算后更新";
    const flightSub = flightSettled
      ? liveFlight?.note || flight.note || (flags.atDepartureAirport ? "已确认到机场" : "已出票")
      : "选定机票后更新";

    const cards = [
      { key: "location", icon: "📍", label: "当前位置", value: state?.location || "—", sub: state?.geo_key || "" },
      {
        key: "activity",
        icon: "🧭",
        label: "当前活动",
        value: !state
          ? "尚未开始"
          : !state.demo_action || state.demo_action === "行程中"
            ? state.geo_key === "shanghai_home" || state.trip_node === "行前准备"
              ? "行前准备"
              : "—"
            : state.demo_action,
        sub: state?.trip_node || (state ? "" : "开启自动播放开始"),
      },
      { key: "weather", icon: weatherEmojiFromText(state?.weather) || "☀️", label: "天气", value: shortWeather(state?.weather), sub: weatherSub(state) },
      {
        key: "budget",
        icon: "💰",
        label: "预算状态",
        value: budgetValue,
        sub: budgetSub,
      },
      {
        key: "flight",
        icon: "✈️",
        label: "下一航班",
        value: flightStatus,
        sub: flightSub,
      },
    ];

    const prev = this._statusSnap || {};
    const weatherValue = shortWeather(state?.weather);
    const nextSnap = { budget: budgetValue, flight: flightStatus, weather: weatherValue };
    const budgetChanged =
      prev.budget != null && prev.budget !== nextSnap.budget && nextSnap.budget !== "待确定";
    const flightChanged =
      prev.flight != null && prev.flight !== nextSnap.flight && nextSnap.flight !== "待预订";
    const weatherChanged =
      prev.weather != null &&
      prev.weather !== nextSnap.weather &&
      nextSnap.weather !== "—";

    this.els.statusGrid.innerHTML = cards
      .map(
        (c) => `
      <div class="status-chip" data-status="${c.key}" title="${escapeHtml(c.label)}${
          c.sub ? " · " + escapeHtml(c.sub) : ""
        }">
        <span class="status-chip-ico">${c.icon}</span>
        <span class="status-chip-val">${escapeHtml(c.value)}</span>
      </div>`
      )
      .join("");

    // Fly-in from map → land on status chip (skip first paint)
    if (budgetChanged) {
      this.enqueueStatusLanding({
        kind: "budget",
        icon: "💰",
        title: "费用更新",
        fromText: prev.budget,
        toText: nextSnap.budget,
        detail: budgetSub || "状态栏已同步",
      });
    }
    if (flightChanged) {
      this.enqueueStatusLanding({
        kind: "flight",
        icon: "✈️",
        title: "航班状态更新",
        fromText: prev.flight,
        toText: nextSnap.flight,
        detail: flightSub || "状态栏已同步",
      });
    }
    if (weatherChanged) {
      this.enqueueStatusLanding({
        kind: "weather",
        icon: weatherEmojiFromText(state?.weather) || "🌦️",
        title: "天气已更新",
        fromText: prev.weather,
        toText: nextSnap.weather,
        detail: weatherSub(state) || "状态栏已同步",
      });
    }
    this._statusSnap = nextSnap;
  }

  /** Queue status-bar landing on the global cinematic queue (after tool overlays). */
  enqueueStatusLanding(item) {
    if (!item) return;
    const fp = `status:${item.kind}:${String(item.toText || "").slice(0, 60)}`;
    this.enqueueCinematic(() => this.playStatusLandingAnim(item), { fingerprint: fp }).catch(
      () => {}
    );
  }

  /**
   * Fly a status update into the matching status chip.
   * When fromStage is true, reuse the bottom map-action card (no mid-map bubble).
   */
  playStatusLandingAnim({
    kind = "budget",
    icon = "💰",
    title = "状态更新",
    fromText = "",
    toText = "",
    detail = "",
    fromStage = false,
  } = {}) {
    return new Promise((resolve) => {
      const chip = this.els.statusGrid?.querySelector(`[data-status="${kind}"]`);
      if (!chip) {
        if (fromStage) hideMapActionStage();
        resolve(false);
        return;
      }

      const stageCard = fromStage
        ? document.querySelector("#mapActionStage .map-action-card")
        : null;
      const stageBox = stageCard?.getBoundingClientRect?.();
      const hasStage =
        stageCard && stageBox && stageBox.width > 8 && stageBox.height > 8;

      const fly = document.createElement("div");
      fly.className = `status-fly status-fly-${kind}${hasStage ? " status-fly-from-stage" : ""}`;

      if (hasStage) {
        // Clone the bottom card visually so it continues flying upward.
        fly.innerHTML = `<div class="status-fly-stage-clone">${stageCard.outerHTML}</div>`;
        hideMapActionStage();
      } else {
        fly.innerHTML = `
        <div class="status-fly-inner">
          <div class="status-fly-head">
            <span class="status-fly-ico">${icon}</span>
            <span class="status-fly-title">${escapeHtml(title)}</span>
            <span class="status-fly-badge">同步中</span>
          </div>
          <div class="status-fly-body">
            ${
              fromText && fromText !== toText
                ? `<div class="status-fly-from">${escapeHtml(fromText)}</div>
                   <div class="status-fly-arrow">↓</div>`
                : ""
            }
            <div class="status-fly-to">${escapeHtml(toText)}</div>
            ${detail ? `<div class="status-fly-detail">${escapeHtml(detail)}</div>` : ""}
          </div>
        </div>`;
      }
      document.body.appendChild(fly);

      const measure = () => fly.getBoundingClientRect();
      let startX;
      let startY;
      if (hasStage) {
        // Match the on-screen bottom card before flying.
        fly.style.width = `${stageBox.width}px`;
        startX = stageBox.left;
        startY = stageBox.top;
        fly.style.transform = `translate(${startX}px, ${startY}px) scale(1)`;
        fly.style.opacity = "1";
      } else {
        const mapPanel =
          document.querySelector("#mapPanel") ||
          document.querySelector(".map-stage-canvas") ||
          document.querySelector(".map-overlay");
        if (!mapPanel) {
          fly.remove();
          resolve(false);
          return;
        }
        const startBox = mapPanel.getBoundingClientRect();
        startX = startBox.left + startBox.width / 2 - measure().width / 2;
        startY = startBox.top + startBox.height * 0.42 - measure().height / 2;
        fly.style.transform = `translate(${Math.max(8, startX)}px, ${Math.max(8, startY)}px) scale(0.86)`;
        fly.style.opacity = "0";
      }

      const run = async () => {
        try {
          if (!hasStage) {
            await fly.animate(
              [
                { opacity: 0, transform: `translate(${startX}px, ${startY + 18}px) scale(0.86)` },
                { opacity: 1, transform: `translate(${startX}px, ${startY}px) scale(1)` },
              ],
              { duration: 520, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "forwards" }
            ).finished;

            const badge = fly.querySelector(".status-fly-badge");
            await new Promise((r) => setTimeout(r, 980));
            if (badge) badge.textContent = "写入状态栏";
          } else {
            // Brief beat so the handoff from bottom card reads clearly.
            await new Promise((r) => setTimeout(r, 180));
          }

          const end = chip.getBoundingClientRect();
          const flyBox = measure();
          const endX = end.left + end.width / 2 - flyBox.width / 2;
          const endY = end.top + end.height / 2 - flyBox.height / 2;

          await fly.animate(
            [
              {
                opacity: 1,
                transform: `translate(${startX}px, ${startY}px) scale(1)`,
                offset: 0,
              },
              {
                opacity: 1,
                transform: `translate(${(startX + endX) / 2}px, ${Math.min(startY, endY) - 28}px) scale(0.72)`,
                offset: 0.45,
              },
              {
                opacity: 0.12,
                transform: `translate(${endX}px, ${endY}px) scale(0.22)`,
                offset: 1,
              },
            ],
            { duration: hasStage ? 860 : 980, easing: "cubic-bezier(0.4, 0.0, 0.2, 1)", fill: "forwards" }
          ).finished;
        } catch {
          /* ignore abort */
        } finally {
          fly.remove();
          hideMapActionStage();
          const chipNow =
            this.els.statusGrid?.querySelector(`[data-status="${kind}"]`) || chip;
          if (chipNow) {
            chipNow.classList.add("status-chip-landed");
            chipNow.classList.add(
              kind === "flight"
                ? "status-chip-landed-flight"
                : kind === "weather"
                  ? "status-chip-landed-weather"
                  : "status-chip-landed-budget"
            );
            clearTimeout(chipNow._landTimer);
            chipNow._landTimer = setTimeout(() => {
              chipNow.classList.remove(
                "status-chip-landed",
                "status-chip-landed-flight",
                "status-chip-landed-budget",
                "status-chip-landed-weather"
              );
            }, 1400);
          }
          resolve(true);
        }
      };
      requestAnimationFrame(() => requestAnimationFrame(run));
    });
  }

  renderTripLedger(ledger, { expandDate } = {}) {
    const el = this.els.tripLedger;
    if (!el) return;
    const groups = groupLedgerByDate(ledger || {}, { expandDate });
    if (!groups.length) {
      el.innerHTML = `<div class="ledger-empty">暂无行程记录。预订机票 / 酒店或推进日程后会出现在这里。</div>`;
      return;
    }
    el.innerHTML = groups
      .map((g) => {
        const md = g.date.slice(5).replace("-", "/");
        const rows = [];
        for (const c of g.calendar) {
          rows.push(
            `<div class="ledger-row cal"><span class="lr-ico">📅</span><span class="lr-main">${escapeHtml(c.summary)}</span></div>`
          );
        }
        for (const f of g.flights) {
          const st = f.status === "delayed" ? "delayed" : f.status || "confirmed";
          rows.push(
            `<div class="ledger-row flight ${st}"><span class="lr-ico">✈️</span><span class="lr-main">${escapeHtml(
              f.flight_no
            )} · ${escapeHtml(f.route || "")}</span><span class="lr-meta">${escapeHtml(
              f.note || f.status || ""
            )}</span></div>`
          );
        }
        for (const h of g.hotels) {
          const cancelled = h.status === "cancelled";
          rows.push(
            `<div class="ledger-row hotel ${cancelled ? "cancelled" : "confirmed"}"><span class="lr-ico">🏨</span><span class="lr-main">${escapeHtml(
              h.name
            )}</span><span class="lr-meta">${cancelled ? "cancelled" : "confirmed"}${
              h.price_nzd != null ? ` · NZ$${h.price_nzd}` : ""
            }${h.refundable ? " · 可退" : ""}${h.note ? ` · ${escapeHtml(h.note)}` : ""}</span></div>`
          );
        }
        return `<section class="ledger-day">
          <div class="ledger-day-head"><span class="ld-date">${md}</span><span class="ld-count">${rows.length} 项</span></div>
          <div class="ledger-day-body">${rows.join("") || '<div class="ledger-empty">—</div>'}</div>
        </section>`;
      })
      .join("");
  }

  renderNotionLedger(ledger) {
    const el = this.els.notionLedger;
    if (!el) return;
    const notion = ledger?.notion || {};
    if (this.els.notionTitle) {
      this.els.notionTitle.textContent = notion.title || "NZ Road Trip 2026";
    }
    const sections = [
      { key: "journal", label: "Trip Journal", icon: "📓" },
      { key: "expense", label: "Expense Log", icon: "💶" },
      { key: "safety", label: "Driving & Safety", icon: "🛡️" },
    ];
    const body = sections
      .map((s) => {
        const text = (notion.sections && notion.sections[s.key]) || "";
        const lines = text
          ? text
              .split("\n")
              .filter(Boolean)
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join("")
          : `<li class="muted">尚无内容</li>`;
        return `<details class="notion-section" ${text ? "open" : ""}>
          <summary>${s.icon} ${s.label}</summary>
          <ul>${lines}</ul>
        </details>`;
      })
      .join("");
    const hasAny = sections.some((s) => notion.sections?.[s.key]);
    el.innerHTML = hasAny
      ? body
      : `<div class="ledger-empty">Agent 写入游记 / 费用 / 安全备注后会出现在这里。</div>${body}`;
  }

  renderEventStream(_events, _meta) {
    // Map-side event flow removed — tools/replies live in the phone chat.
  }

  clearActivityFeed() {
    this._activityFeed = [];
    this._activitySeq = 0;
  }

  /**
   * Activity lines used to mirror into the map timeline.
   * Kept as a no-op hook so call sites stay stable; phone chat is the source of truth.
   */
  appendActivityFeed({
    kind = "agent_tool",
    icon = null,
    who = null,
    body = "",
    time = null,
    detail = "",
    id = null,
    mapPulse = false,
  } = {}) {
    if (!mapPulse) return;
    const km = KIND_META[kind] || KIND_META.agent_tool;
    const text = [body, detail].filter(Boolean).join(" · ");
    if (!String(text || "").trim()) return;
    this.pulseMapFeedback({
      id: id || `act-map:${Date.now()}`,
      icon: icon || km.icon,
      title: body || km.label,
      detail,
      kind,
    });
  }

  _paintEventStream() {
    // no-op
  }

  /** Brief map toast — queued so overlays never stack / overwrite each other. */
  pulseMapFeedback({
    id = null,
    icon = "📌",
    label = "",
    title = "",
    detail = "",
    kind = "",
    placeId = null,
    geoKey = null,
    roadId = null,
    latlng = null,
    holdMs = 2000,
  } = {}) {
    if (!this._mapPulseSeen) this._mapPulseSeen = new Set();
    const key = id || `${kind}:${placeId || geoKey || roadId || ""}:${title || label}`;
    if (this._mapPulseSeen.has(key)) return Promise.resolve(false);
    this._mapPulseSeen.add(key);
    if (this._mapPulseSeen.size > 200) {
      this._mapPulseSeen = new Set([...this._mapPulseSeen].slice(-100));
    }

    let resolvedPlace = placeId;
    let resolvedGeo = geoKey;
    let resolvedRoad = roadId;
    if (!resolvedPlace && !resolvedGeo && !resolvedRoad && !latlng) {
      const blob = `${title || label || ""} ${detail || ""}`;
      const places = extractPlaceIdsFromText(blob);
      const roads = extractRoadIdsFromText(blob);
      resolvedPlace = places[0] || null;
      resolvedRoad = roads[0] || null;
    }

    const isWeather = String(kind || "").toLowerCase() === "weather";
    return this.enqueueCinematic(
      () =>
        Promise.resolve(
          pulseMapEvent({
            icon,
            title: title || label,
            detail,
            kind,
            durationMs: isWeather ? 3400 : 3000,
            holdMs: Math.max(2000, Number(holdMs) || 2000),
            placeId: resolvedPlace,
            geoKey: resolvedGeo,
            roadId: resolvedRoad,
            latlng,
          })
        ),
      { fingerprint: `pulse:${key}` }
    );
  }

  renderMap(engine) {
    const result = renderLeafletMap(engine);
    if (!result.ok) {
      this.els.mapPanel.innerHTML = `<div class="map-canvas map-fallback">地图加载失败：${escapeHtml(result.reason || "unknown")}<br/><small>请检查网络是否可访问 OpenStreetMap / Leaflet CDN</small></div>`;
    }
  }

  resetMap() {
    this.abortCinematics();
    destroyMap();
    if (this.els.mapPanel) this.els.mapPanel.innerHTML = "";
  }

  renderFooter(engine) {
    const meta = engine.meta;
    const day = engine.currentTripDay();
    const budget = engine.currentState?.budget;
    const spent =
      budget?.total_cny != null && Number(budget.spent_cny) > 0 ? `¥${fmt(budget.spent_cny)}` : "待定";
    const next = engine.currentState?.location || day?.place || "—";
    const liveDate = engine.latestDate();
    const prep = (engine.meta.prep_days || []).find((d) => d.date === liveDate);
    const dayLabel = engine.isPreTrip()
      ? prep
        ? `行前 ${prep.md}`
        : liveDate
          ? `行前 ${formatSimStamp(liveDate).split(" ")[0]}`
          : "行前"
      : day?.day != null
        ? `Day ${day.day}`
        : "—";
    if (this.els.footerStats) {
      this.els.footerStats.innerHTML = `
      <span>${dayLabel}/15</span>
      <span>预算已用 ${spent}</span>
      <span>下一站 ${escapeHtml(next)}</span>
      <span>事件 ${engine.progress.cursor + 1}/${engine.progress.total}</span>`;
    }
    this.els.progressLabel.textContent = `${engine.progress.cursor + 1} / ${engine.progress.total}`;
  }

  // —— Chat (phone) ——
  clearChat() {
    this.els.chatMessages.innerHTML = "";
    this._chatStickToBottom = true;
  }

  /**
   * First-entry guide in the phone chat: configure model → start auto-demo.
   * handlers: { onConfigure, onStartDemo, onDismiss }
   */
  showWelcomeGuide({ configured = false, providerLabel = "", model = "" } = {}, handlers = {}) {
    const host = this.els.chatMessages;
    if (!host) return null;
    host.querySelector(".welcome-guide")?.remove();

    const wrap = document.createElement("div");
    wrap.className = "bubble welcome-guide";
    const statusLine = configured
      ? `<div class="welcome-status ok">已连接 · ${escapeHtml(providerLabel || "LLM")} · ${escapeHtml(
          model || ""
        )}</div>`
      : `<div class="welcome-status warn">尚未配置 API Key — Agent 还不能回复</div>`;

    wrap.innerHTML = `
      <div class="welcome-title">开始 VibeLifeBench 演示</div>
      <ol class="welcome-steps">
        <li class="${configured ? "done" : "active"}">
          <span class="ws-num">1</span>
          <span>填写模型信息（提供商 + API Key）</span>
        </li>
        <li class="${configured ? "active" : ""}">
          <span class="ws-num">2</span>
          <span>开启自动播放，Agent 随行程事件互动</span>
        </li>
      </ol>
      ${statusLine}
      <div class="welcome-actions">
        <button type="button" class="welcome-btn ${configured ? "ghost" : "primary"}" data-welcome="configure">
          ${configured ? "更改模型" : "配置模型"}
        </button>
        <button type="button" class="welcome-btn ${configured ? "primary" : "ghost"}" data-welcome="start" ${
          configured ? "" : "disabled"
        }>
          开始自动演示
        </button>
      </div>
      <div class="welcome-foot">也可点顶部「演示控制台 / 自动播放」；手机底栏 ⚙️ 打开设置页</div>`;

    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-welcome]");
      if (!btn || btn.disabled) return;
      const act = btn.dataset.welcome;
      if (act === "configure") handlers.onConfigure?.();
      if (act === "start") handlers.onStartDemo?.();
    });

    host.appendChild(wrap);
    this._scrollChatToBottom({ force: true });
    return wrap;
  }

  appendChat({ role, text, from, streaming = false, time = null }) {
    const wrap = document.createElement("div");
    wrap.className = `bubble ${role}` + (streaming ? " streaming" : "");
    const stamp = formatSimStamp(time);
    const timeHtml = stamp ? `<div class="bubble-time">${escapeHtml(stamp)}</div>` : "";
    if (role === "user") {
      const name = this.speakers[from]?.name || from || "我";
      wrap.innerHTML = `${timeHtml}<div class="bubble-name">${escapeHtml(name)}</div><div class="bubble-text"></div>`;
    } else if (role === "system") {
      wrap.className = "bubble system";
      wrap.innerHTML = `${timeHtml}<div class="bubble-text"></div>`;
    } else {
      wrap.innerHTML = `${timeHtml}<div class="bubble-name">Agent</div><div class="bubble-text"></div>`;
    }
    const body = wrap.querySelector(".bubble-text");
    if (role === "agent") setMarkdown(body, text || "");
    else body.textContent = text || "";
    this.els.chatMessages.appendChild(wrap);
    // User / system messages: stick to bottom so the new message is visible.
    this._scrollChatToBottom({ force: role === "user" || role === "system" });
    return wrap;
  }

  /** Incoming SMS / email-style message (world / app notifications) — yellow shell. */
  appendSmsChat({ text = "", from = "系统通知", time = null, channel = "sms" } = {}) {
    const wrap = document.createElement("div");
    const isMail = channel === "email" || channel === "mail";
    wrap.className = `bubble sms-in${isMail ? " mail-in" : ""}`;
    const stamp = formatSimStamp(time);
    const timeHtml = stamp ? `<div class="bubble-time">${escapeHtml(stamp)}</div>` : "";
    const sender = String(from || "系统通知").trim() || "系统通知";
    const body = String(text || "").trim();
    wrap.innerHTML = `
      ${timeHtml}
      <div class="sms-shell">
        <div class="sms-meta">
          <span class="sms-badge">${isMail ? "邮件" : "短信"}</span>
          <span class="sms-from">${escapeHtml(sender)}</span>
        </div>
        <div class="sms-text"></div>
      </div>`;
    wrap.querySelector(".sms-text").textContent = body;
    this.els.chatMessages.appendChild(wrap);
    this._scrollChatToBottom({ force: true });
    return wrap;
  }

  /** Agent turn: thinking quote + 「正在使用工具」card + answer */
  beginAgentTurn({ time = null } = {}) {
    clearPlanning({ immediate: true });
    clearTimeout(this._planThinkTimer);
    this._planThinkTimer = null;
    this._lastPlanThinkLen = 0;
    const wrap = document.createElement("div");
    wrap.className = "bubble agent agent-turn streaming";
    const stamp = formatSimStamp(time);
    const timeHtml = stamp ? `<div class="bubble-time">${escapeHtml(stamp)}</div>` : "";
    wrap.innerHTML = `
      ${timeHtml}
      <div class="bubble-name">Agent</div>
      <div class="turn-header-bar" data-turn-header hidden></div>
      <div class="agent-rail" data-agent-rail hidden>
        <div class="rail-step rail-think is-collapsed" data-think hidden>
          <div class="rail-gutter">
            <span class="rail-dot think" aria-hidden="true"></span>
            <span class="rail-line" aria-hidden="true"></span>
          </div>
          <div class="rail-body">
            <button type="button" class="rail-think-head" data-think-toggle aria-expanded="false">
              <span class="rail-think-meta">
                <span class="rail-think-label">Thinking</span>
                <span class="rail-think-secs" data-think-secs></span>
              </span>
              <span class="rail-think-chevron" aria-hidden="true"></span>
            </button>
            <div class="rail-think-body" data-think-body>
              <blockquote class="rail-think-quote">
                <p class="rail-think-summary" data-think-summary></p>
                <div class="rail-think-full" data-think-full hidden></div>
              </blockquote>
              <button type="button" class="rail-think-more" data-think-more hidden>展开全文</button>
            </div>
          </div>
        </div>
        <div class="tool-panel" data-tool-panel hidden>
          <button type="button" class="tool-panel-head" data-tool-panel-toggle aria-expanded="true">
            <span class="tool-panel-title">正在使用工具</span>
            <span class="tool-panel-chevron" aria-hidden="true"></span>
          </button>
          <div class="tool-panel-body" data-tool-log></div>
          <div class="rail-collapse-wrap" data-rail-collapse hidden>
            <button type="button" class="rail-collapse-btn" data-rail-collapse-btn>… <span data-collapse-n>0</span> steps</button>
          </div>
        </div>
      </div>
      <div class="bubble-text answer-text"></div>`;

    const moreBtn = wrap.querySelector("[data-think-more]");
    moreBtn?.addEventListener("click", () => {
      const full = wrap.querySelector("[data-think-full]");
      if (!full) return;
      const open = full.hasAttribute("hidden");
      if (open) full.removeAttribute("hidden");
      else full.setAttribute("hidden", "");
      moreBtn.textContent = open ? "收起" : "展开全文";
    });

    const thinkToggle = wrap.querySelector("[data-think-toggle]");
    thinkToggle?.addEventListener("click", () => {
      const think = wrap.querySelector("[data-think]");
      if (!think) return;
      const collapsed = think.classList.toggle("is-collapsed");
      thinkToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });

    const panelToggle = wrap.querySelector("[data-tool-panel-toggle]");
    panelToggle?.addEventListener("click", () => {
      const panel = wrap.querySelector("[data-tool-panel]");
      if (!panel) return;
      const collapsed = panel.classList.toggle("is-collapsed");
      panelToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });

    const collapseBtn = wrap.querySelector("[data-rail-collapse-btn]");
    collapseBtn?.addEventListener("click", () => {
      wrap._railExpanded = !wrap._railExpanded;
      this._refreshRailCollapse(wrap);
    });

    wrap._startedAt = Date.now();
    wrap._toolRows = new Map();
    wrap._toolSeen = new Set();
    wrap._toolOrder = [];
    wrap._activityReplyPushed = false;
    wrap._simTime = time;
    wrap._railExpanded = false;
    this.els.chatMessages.appendChild(wrap);
    this._scrollChatToBottom();
    return wrap;
  }

  /**
   * Drive map focus from streaming thinking / tool results.
   * Throttled so we don't rebuild polylines every token.
   */
  syncMapPlanningFromThinking(thinking) {
    const text = String(thinking || "");
    if (text.length < 12) return;
    // Only re-run when enough new content arrived.
    if (text.length - (this._lastPlanThinkLen || 0) < 24 && this._lastPlanThinkLen > 0) {
      clearTimeout(this._planThinkTimer);
      this._planThinkTimer = setTimeout(() => {
        this._lastPlanThinkLen = text.length;
        syncPlanningFromText(text).catch(() => {});
      }, 520);
      return;
    }
    clearTimeout(this._planThinkTimer);
    this._planThinkTimer = setTimeout(() => {
      this._lastPlanThinkLen = text.length;
      syncPlanningFromText(text).catch(() => {});
    }, 380);
  }

  focusMapFromTool(name, args = {}, result = null) {
    if (!name) return;
    const meta = describeToolCall(name, args, result);
    const anchor = resolveToolMapAnchor(name, args, result);

    // Budget: bottom wallet card → flies straight into status bar (no mid-map bubble).
    if (name === "get_budget_snapshot") {
      clearPlanning({ immediate: true });
      const b = result?.budget || {};
      const total = b.total_cny != null ? `¥${fmt(b.total_cny)}` : "待确定";
      const spent = b.spent_cny != null ? `¥${fmt(b.spent_cny)}` : "—";
      const remain =
        b.total_cny != null && b.spent_cny != null
          ? `¥${fmt(Number(b.total_cny) - Number(b.spent_cny))}`
          : b.remaining_cny != null
            ? `¥${fmt(b.remaining_cny)}`
            : "—";
      const loc = result?.location || args.location || "";
      const toText =
        b.total_cny != null
          ? Number(b.spent_cny) > 0
            ? `已用 ${spent} / ${total}`
            : `预算 ${total}`
          : "待确定";
      return this.playQueuedMapAction({
        kind: "budget",
        title: "行程预算",
        items: [
          { label: "总额", value: total },
          { label: "已用", value: spent },
          { label: "剩余", value: remain },
          loc ? { label: "位置", value: loc } : null,
        ].filter(Boolean),
        fingerprint: `budget:${total}:${spent}`,
        leaveVisible: true,
      }).then(() =>
        this.enqueueCinematic(
          () =>
            this.playStatusLandingAnim({
              kind: "budget",
              icon: "💰",
              title: "预算已同步",
              fromText: "核对中…",
              toText,
              detail: remain !== "—" ? `剩余 ${remain}` : meta.detail || "",
              fromStage: true,
            }),
          { fingerprint: `status:budget:${String(toText).slice(0, 60)}` }
        )
      );
    }

    if (name === "list_active_alerts") {
      const roads = result?.road_events || [];
      const transit = result?.transit_events || [];
      const flights = Object.keys(result?.flights || {});
      const hasIssue = roads.length + transit.length + flights.length > 0;
      if (!hasIssue) {
        // "暂无告警" — stay put, no fake SH80/SH94 overlay.
        clearPlanning({ immediate: true });
        this.pulseMapFeedback({
          id: `tool-place:${name}:clear`,
          icon: meta.icon,
          title: meta.title,
          detail: meta.detail || "当前无路况/渡轮/航班异常",
          kind: "agent_tool",
          placeId: anchor.placeId,
          geoKey: anchor.geoKey,
        });
        return;
      }
      if (roads.length) {
        focusTrafficResult({ matched: roads, status: "blocked" }, {}).catch(() => {});
      }
      this.pulseMapFeedback({
        id: `tool-place:${name}:${anchor.roadId || roads[0]?.road_id || "alerts"}`,
        icon: meta.icon,
        title: meta.title,
        detail: meta.detail,
        kind: "agent_tool",
        placeId: anchor.placeId,
        geoKey: anchor.geoKey,
        roadId: anchor.roadId || roads[0]?.road_id || null,
      });
      return;
    }

    if (name === "get_traffic_estimate") {
      focusTrafficResult(result || {}, args || {}).catch(() => {});
    } else if (name === "get_current_weather" || name === "get_forecast_daily") {
      const geo = args.geo_key || result?.geo_key || anchor.geoKey;
      const place = geoLabel(geo) || geo || "";
      const weatherBlob = `${meta.detail || ""} ${result?.condition || ""} ${result?.summary || ""} ${result?.weather || ""}`;
      const wIcon = weatherEmojiFromText(weatherBlob);
      const detail =
        meta.detail ||
        formatObservedWeatherText(name, args, result) ||
        "天气查询完成";
      // Queue: pan to place, then bubble (2s hold) — never stack over other overlays.
      return this.enqueueCinematic(
        async () => {
          if (geo) {
            await Promise.resolve(
              focusGeoKey(geo, { label: `工具：天气 · ${place || geo}` })
            );
            await new Promise((r) => setTimeout(r, 320));
          }
          return pulseMapEvent({
            icon: wIcon,
            title: place ? `${place}天气` : name === "get_forecast_daily" ? "多日预报" : "当日天气",
            detail,
            kind: "weather",
            durationMs: 3400,
            holdMs: 2000,
            placeId: anchor.placeId,
            geoKey: geo || null,
          });
        },
        {
          fingerprint: `tool-weather:${name}:${geo || ""}:${String(detail).slice(0, 40)}`,
        }
      );
    } else if (name === "get_flight_status") {
      focusPlanning({
        placeIds: ["pl_chc_airport"],
        mode: "consider",
        label: args.flight_no ? `工具：航班 ${args.flight_no}` : "工具：航班动态",
        force: true,
      }).catch(() => {});
    } else if (name === "search_web") {
      const items = result?.results || [];
      // Return promise so agent can await one tool cinematic before the next.
      return this.playQueuedMapAction({
        kind: "search",
        query: args.query || result?.query || meta.title,
        items: items.map((r) => ({
          title: r.title,
          snippet: r.snippet,
          url: r.url,
        })),
        fingerprint: `search:${String(args.query || result?.query || meta.title || "").slice(0, 80)}`,
      });
    } else if (name === "write_journal" || /notion|journal|write_page/i.test(name)) {
      const notionTitle = args.title || result?.title || "游记";
      const notionBody =
        args.content || result?.content || result?.preview || meta.detail || "";
      // 工具调用卡已展示；只播地图动效，不再刷「已记入·笔记」状态卡
      return this.playQueuedMapAction({
        kind: "notion",
        title: notionTitle,
        body: notionBody, // map: stream content → 已提交
        fingerprint: `notion:${String(notionTitle).slice(0, 80)}`,
      });
    } else if (name === "add_calendar_event" || /calendar|schedule/i.test(name)) {
      const ev = result?.event || {};
      const calTitle = args.title || ev.title || "日程";
      const calDate = args.date || ev.date || "";
      const calNote = args.note || ev.note || "";
      const items = [
        calDate ? { label: "日期", value: String(calDate).slice(0, 10) } : null,
        { label: "标题", value: calTitle },
        calNote ? { label: "备注", value: truncate(calNote, 48) } : null,
      ].filter(Boolean);
      // 工具调用卡已展示；只播地图动效，不再刷「已记入·行程」状态卡
      return this.playQueuedMapAction({
        kind: "calendar",
        title: calTitle,
        body: [calDate, calNote, calTitle].filter(Boolean).join("\n"),
        items,
        // Unique per write so rapid successive adds each get an animation.
        fingerprint: `calendar:${calDate}:${calTitle}:${ev.id || Date.now()}`,
      });
    }

    // Place bubble for location lookups (weather / traffic / flight).
    if (anchor.placeId || anchor.geoKey || anchor.roadId) {
      this.pulseMapFeedback({
        id: `tool-place:${name}:${anchor.placeId || anchor.geoKey || anchor.roadId}`,
        icon: meta.icon,
        title: meta.title,
        detail: meta.detail,
        kind: "agent_tool",
        placeId: anchor.placeId,
        geoKey: anchor.geoKey,
        roadId: anchor.roadId,
      });
    }
  }

  endMapPlanning() {
    clearTimeout(this._planThinkTimer);
    this._planThinkTimer = null;
    clearPlanning({ immediate: false });
  }

  /** Ocean flight cutscene: plane flies from takeoff geo to landing geo. */
  async playFlightCrossing(opts = {}) {
    return playFlightCrossing(opts);
  }

  /**
   * Append / update a tool step on the rail.
   * Same tool name merges into one group with expandable children.
   * Budget tools go to the turn header bar (global state), not the rail.
   */
  appendToolCall(wrap, { name, args = {}, result = null, status = "done" } = {}) {
    if (!wrap || !name) return null;

    // Budget = global state → header bar, not a rail step
    if (name === "get_budget_snapshot" || (/budget/i.test(name) && !/book|cancel/i.test(name))) {
      this._setTurnBudgetHeader(wrap, args, result);
      let fp;
      try {
        fp = `${name}:${JSON.stringify(args || {})}:${JSON.stringify(result ?? null)}`;
      } catch {
        fp = `${name}:budget:${Date.now()}`;
      }
      if (!wrap._toolSeen) wrap._toolSeen = new Set();
      wrap._toolSeen.add(fp);
      return null;
    }

    const rail = wrap.querySelector("[data-agent-rail]");
    const panel = wrap.querySelector("[data-tool-panel]");
    const log = wrap.querySelector("[data-tool-log]");
    if (!log || !rail) return null;
    rail.hidden = false;
    rail.removeAttribute("hidden");
    if (panel) {
      panel.hidden = false;
      panel.removeAttribute("hidden");
    }
    if (!wrap._toolRows) wrap._toolRows = new Map();
    if (!wrap._toolSeen) wrap._toolSeen = new Set();
    if (!wrap._toolOrder) wrap._toolOrder = [];

    const key = String(name);
    let row = wrap._toolRows.get(key);
    if (!row) {
      row = document.createElement("div");
      row.className = "tool-step";
      row.dataset.toolName = name;
      row._calls = [];
      row._expanded = false;
      log.appendChild(row);
      wrap._toolRows.set(key, row);
      wrap._toolOrder.push(key);
    }

    if (status === "pending") {
      if (row._calls.length) return row;
      row.classList.add("pending");
      row.classList.remove("done", "err", "warn");
      const title = humanizeToolName(name);
      const sub = (TOOL_META[name] && TOOL_META[name].focus) || toolCallName(name);
      row.innerHTML = `
        <span class="tool-step-ico" aria-hidden="true">${toolEmojiIcon(name)}</span>
        <div class="tool-step-main">
          <div class="tool-step-title">${escapeHtml(title)}</div>
          <div class="tool-step-sub">${escapeHtml(sub)}</div>
        </div>
        <span class="tool-step-status pending" aria-label="进行中"><span class="tool-spin"></span></span>`;
      this._refreshRailCollapse(wrap);
      this._scrollChatToBottom();
      return row;
    }

    let fp;
    try {
      fp = `${name}:${JSON.stringify(args || {})}:${JSON.stringify(result ?? null)}`;
    } catch {
      fp = `${name}:${Date.now()}:${row._calls.length}`;
    }
    if (wrap._toolSeen.has(fp)) {
      this._paintToolRow(row, name, wrap);
      return row;
    }
    wrap._toolSeen.add(fp);

    const meta = describeToolCall(name, args, result);
    row._calls.push({ args, result, meta });
    this._paintToolRow(row, name, wrap);

    const n = row._calls.length;
    const baseLabel =
      (TOOL_META[name] && TOOL_META[name].label) || humanizeToolName(name);
    const title = n > 1 ? `${baseLabel} · ${n} 次` : meta.title;
    const detail = this._mergedToolDetail(row);

    this.appendActivityFeed({
      id: `tool:${wrap._simTime || wrap._startedAt || "t"}:${name}`,
      kind: "agent_tool",
      icon: meta.icon,
      who: "Agent 工具",
      body: title,
      detail,
      time: wrap._simTime || null,
      mapPulse: false,
    });

    const hasOwnCinematic =
      name === "search_web" ||
      name === "get_budget_snapshot" ||
      name === "get_current_weather" ||
      name === "get_forecast_daily" ||
      name === "write_journal" ||
      name === "add_calendar_event" ||
      /notion|journal|write_page|calendar|schedule/i.test(name || "");
    const anchor = resolveToolMapAnchor(name, args, result);
    if (!hasOwnCinematic && (anchor.placeId || anchor.geoKey || anchor.roadId)) {
      this.pulseMapFeedback({
        id: `tool-place:${name}:${anchor.placeId || anchor.geoKey || anchor.roadId}`,
        icon: meta.icon,
        title: meta.title,
        detail: meta.detail,
        kind: "agent_tool",
        placeId: anchor.placeId,
        geoKey: anchor.geoKey,
        roadId: anchor.roadId,
      });
    }

    this._scrollChatToBottom();
    return row;
  }

  _setTurnBudgetHeader(wrap, args = {}, result = null) {
    if (!wrap) return;
    const bar = wrap.querySelector("[data-turn-header]");
    if (!bar) return;
    const b = result?.budget || {};
    const total = b.total_cny != null ? `¥${fmt(b.total_cny)}` : "—";
    const spent = b.spent_cny != null ? `¥${fmt(b.spent_cny)}` : "—";
    const remain =
      b.total_cny != null && b.spent_cny != null
        ? `¥${fmt(Number(b.total_cny) - Number(b.spent_cny))}`
        : b.remaining_cny != null
          ? `¥${fmt(b.remaining_cny)}`
          : "—";
    const value =
      b.total_cny != null
        ? Number(b.spent_cny) > 0
          ? `已用 ${spent} / ${total} · 剩余 ${remain}`
          : `预算 ${total}`
        : "预算核对中…";
    bar.hidden = false;
    bar.removeAttribute("hidden");
    bar.innerHTML = `
      <span class="turn-header-ico" aria-hidden="true">${toolEmojiIcon("get_budget_snapshot")}</span>
      <span class="turn-header-label">行程预算</span>
      <span class="turn-header-value">${escapeHtml(value)}</span>`;
  }

  _mergedToolDetail(row) {
    const details = [];
    const seen = new Set();
    for (const c of row._calls || []) {
      const bit = String(c.meta?.detail || c.meta?.title || "").trim();
      if (!bit || seen.has(bit)) continue;
      seen.add(bit);
      details.push(bit);
    }
    if (details.length > 3) {
      return `${details.slice(0, 3).join("； ")}；…共 ${details.length} 条`;
    }
    return details.join("； ");
  }

  _paintToolRow(row, name, wrap = null) {
    if (!row) return;
    const calls = row._calls || [];
    const pending = row.classList.contains("pending") && !calls.length;
    if (pending) return;

    const last = calls[calls.length - 1] || { args: {}, result: null, meta: {} };
    const n = calls.length;
    const anyError = calls.some((c) => c.meta?.error || c.result?.ok === false);
    const anyWarn = calls.some((c) => c.meta?.warning || c.result?.warning);
    const title = humanizeToolName(name);
    const sub =
      n > 1
        ? `已调用 ${n} 次`
        : String(last.meta?.detail || "").trim() ||
          (TOOL_META[name] && TOOL_META[name].focus) ||
          toolCallName(name);

    row.classList.remove("pending");
    row.classList.add("done");
    row.classList.toggle("err", anyError);
    row.classList.toggle("warn", anyWarn && !anyError);

    const childrenOpen = !!row._expanded;
    row._expanded = childrenOpen;
    row.classList.toggle("is-group", n > 1);
    row.classList.toggle("is-open", n > 1 && childrenOpen);

    const childrenHtml =
      n > 1
        ? `<div class="tool-step-children"${childrenOpen ? "" : " hidden"}>${calls
            .map((c, i) => {
              const bit =
                String(c.meta?.detail || "").trim() ||
                firstArgPreview(c.args) ||
                `#${i + 1}`;
              const err = c.meta?.error ? " · 失败" : "";
              return `<div class="tool-step-child">${escapeHtml(truncate(bit, 56))}${err}</div>`;
            })
            .join("")}</div>`
        : "";

    const statusHtml = anyError
      ? `<span class="tool-step-status err" aria-label="失败">!</span>`
      : `<span class="tool-step-status ok" aria-label="完成">✓</span>`;

    const titleHtml = `${escapeHtml(title)}${n > 1 ? ` <span class="tool-step-count">×${n}</span>` : ""}`;
    const subHtml = escapeHtml(truncate(sub, 48));
    // Single calls are static text; only ×N groups are clickable (no hover/JSON expand).
    const mainInner =
      n > 1
        ? `<button type="button" class="tool-step-hit" aria-expanded="${childrenOpen ? "true" : "false"}">
            <div class="tool-step-title">${titleHtml}</div>
            <div class="tool-step-sub">${subHtml}</div>
          </button>${childrenHtml}`
        : `<div class="tool-step-static">
            <div class="tool-step-title">${titleHtml}</div>
            <div class="tool-step-sub">${subHtml}</div>
          </div>`;

    row.innerHTML = `
      <span class="tool-step-ico" aria-hidden="true">${toolEmojiIcon(name)}</span>
      <div class="tool-step-main">${mainInner}</div>
      ${statusHtml}`;

    const hit = row.querySelector(".tool-step-hit");
    const children = row.querySelector(".tool-step-children");
    hit?.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (!children) return;
      row._expanded = !row._expanded;
      row.classList.toggle("is-open", row._expanded);
      hit.setAttribute("aria-expanded", row._expanded ? "true" : "false");
      if (row._expanded) children.removeAttribute("hidden");
      else children.setAttribute("hidden", "");
    });

    if (wrap) this._refreshRailCollapse(wrap);
  }

  /** Collapse middle tool steps when the trajectory is long. */
  _refreshRailCollapse(wrap) {
    if (!wrap) return;
    const order = wrap._toolOrder || [];
    const collapseWrap = wrap.querySelector("[data-rail-collapse]");
    const log = wrap.querySelector("[data-tool-log]");
    const panel = wrap.querySelector("[data-tool-panel]");
    const EDGE = 3;
    const THRESHOLD = 8;

    for (const key of order) {
      wrap._toolRows?.get(key)?.classList.remove("is-collapsed-away");
    }

    if (!collapseWrap || !log) return;

    if (order.length <= THRESHOLD) {
      collapseWrap.hidden = true;
      collapseWrap.setAttribute("hidden", "");
      panel?.appendChild(collapseWrap);
      return;
    }

    if (wrap._railExpanded) {
      collapseWrap.hidden = false;
      collapseWrap.removeAttribute("hidden");
      const btn = collapseWrap.querySelector("[data-rail-collapse-btn]");
      if (btn) btn.textContent = "收起中间步骤";
      panel?.appendChild(collapseWrap);
      return;
    }

    const hiddenKeys = order.slice(EDGE, Math.max(EDGE, order.length - EDGE));
    for (const key of hiddenKeys) {
      wrap._toolRows?.get(key)?.classList.add("is-collapsed-away");
    }
    const btn = collapseWrap.querySelector("[data-rail-collapse-btn]");
    if (btn) btn.innerHTML = `… <span data-collapse-n>${hiddenKeys.length}</span> steps`;
    collapseWrap.hidden = false;
    collapseWrap.removeAttribute("hidden");

    const edgeRow = wrap._toolRows?.get(order[EDGE - 1]);
    if (edgeRow?.parentElement === log) {
      log.insertBefore(collapseWrap, edgeRow.nextSibling);
    }
  }

  /** Ensure every completed tool call from the turn is present in the log. */
  syncToolCalls(wrap, toolCalls = []) {
    if (!wrap || !toolCalls?.length) return;
    for (const tc of toolCalls) {
      this.appendToolCall(wrap, {
        name: tc.name,
        args: tc.args || {},
        result: tc.result,
        status: "done",
      });
    }
  }

  updateAgentTurn(wrap, { thinking, content, phase, toolHint } = {}) {
    if (!wrap) return;
    const thinkBlock = wrap.querySelector("[data-think]");
    const summaryEl = wrap.querySelector("[data-think-summary]");
    const fullEl = wrap.querySelector("[data-think-full]");
    const moreBtn = wrap.querySelector("[data-think-more]");
    const secsEl = wrap.querySelector("[data-think-secs]");
    const answer = wrap.querySelector(".answer-text");
    const rail = wrap.querySelector("[data-agent-rail]");

    if (thinking != null) {
      const text = String(thinking || "");
      if (text && rail) {
        rail.hidden = false;
        rail.removeAttribute("hidden");
      }
      if (thinkBlock) {
        if (text) {
          thinkBlock.hidden = false;
          thinkBlock.removeAttribute("hidden");
        }
      }
      if (summaryEl) summaryEl.textContent = thinkSummaryLine(text) || "…";
      if (fullEl) fullEl.textContent = text;
      if (moreBtn) {
        const needsMore = text.length > 96 || text.includes("\n");
        if (needsMore) {
          moreBtn.hidden = false;
          moreBtn.removeAttribute("hidden");
        } else {
          moreBtn.hidden = true;
          moreBtn.setAttribute("hidden", "");
        }
      }
      if (phase === "thinking" || phase === "tool" || !phase) {
        this.syncMapPlanningFromThinking(thinking);
      }
    }

    if (phase === "thinking") {
      thinkBlock?.classList.add("thinking");
      if (summaryEl && !summaryEl.textContent) summaryEl.textContent = "梳理行程约束…";
    } else if (phase === "tool") {
      thinkBlock?.classList.add("thinking");
      if (toolHint) {
        this.appendToolCall(wrap, { name: toolHint, args: {}, result: null, status: "pending" });
      }
    } else if (phase === "answering" || phase === "done") {
      thinkBlock?.classList.remove("thinking");
      if (secsEl && thinking) {
        const secs = Math.max(1, Math.round((Date.now() - (wrap._startedAt || Date.now())) / 1000));
        secsEl.textContent = `${secs}s`;
      }
    }

    if (content != null && answer) {
      setMarkdown(answer, content);
    }
    if (!thinking && thinkBlock && phase !== "thinking") {
      const hasText = Boolean(fullEl?.textContent || summaryEl?.textContent);
      if (!hasText) {
        thinkBlock.hidden = true;
        thinkBlock.setAttribute("hidden", "");
      }
    }

    this._scrollChatToBottom();
  }

  finishAgentTurn(wrap, { thinking, content, error, toolCalls = [], planContext = null } = {}) {
    if (!wrap) return;
    wrap.classList.remove("streaming");
    const thinkBlock = wrap.querySelector("[data-think]");
    thinkBlock?.classList.remove("thinking");

    this.syncToolCalls(wrap, toolCalls);
    wrap.querySelectorAll(".tool-step.pending").forEach((row) => {
      row.classList.remove("pending");
      row.classList.add("done");
      const st = row.querySelector(".tool-step-status");
      if (st) {
        st.className = "tool-step-status ok";
        st.innerHTML = "✓";
        st.setAttribute("aria-label", "完成");
      }
    });
    this._refreshRailCollapse(wrap);

    if (error) {
      const answer = wrap.querySelector(".answer-text");
      if (answer) answer.textContent = "⚠️ " + error;
      if (thinkBlock) {
        thinkBlock.hidden = true;
        thinkBlock.setAttribute("hidden", "");
      }
      this.endMapPlanning();
      return;
    }

    this.updateAgentTurn(wrap, {
      thinking: thinking || "",
      content: content || "（空回复）",
      phase: "done",
    });

    const afterPlan = () => {
      this.endMapPlanning();
      if (planContext) {
        commitAgentItineraryPlan({
          content: content || "",
          thinking: thinking || "",
          toolCalls: toolCalls || [],
          tripDays: planContext.tripDays || [],
          calendar: planContext.calendar || [],
        }).catch(() => {});
      }
    };
    if (thinking) {
      syncPlanningFromText(thinking)
        .catch(() => {})
        .finally(afterPlan);
    } else {
      afterPlan();
    }

    if (content && !wrap._activityReplyPushed) {
      wrap._activityReplyPushed = true;
      const plain = String(content)
        .replace(/[#>*`|_\[\]()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      this.appendActivityFeed({
        id: `reply:${wrap._simTime || Date.now()}`,
        kind: "agent_reply",
        icon: "💬",
        who: "Agent",
        body: truncate(plain || "已回复", 140),
        time: wrap._simTime || null,
      });
    }

    if (!thinking) {
      if (thinkBlock) {
        thinkBlock.hidden = true;
        thinkBlock.setAttribute("hidden", "");
      }
    } else {
      thinkBlock.hidden = false;
      thinkBlock.removeAttribute("hidden");
      const secs = Math.max(1, Math.round((Date.now() - (wrap._startedAt || Date.now())) / 1000));
      const secsEl = wrap.querySelector("[data-think-secs]");
      if (secsEl) secsEl.textContent = `${secs}s`;
    }
  }

  updateStreamingBubble(wrap, text) {
    if (!wrap) return;
    // backward compat for simple bubbles
    const el = wrap.querySelector(".answer-text") || wrap.querySelector(".bubble-text");
    if (el) setMarkdown(el, text);
    this._scrollChatToBottom();
  }

  finishStreamingBubble(wrap) {
    if (wrap) wrap.classList.remove("streaming");
  }

  setAgentStatus(text, online = true) {
    this.els.agentStatus.textContent = text;
    this.els.agentStatus.classList.toggle("offline", !online);
  }

  toast(msg, ms = 2200) {
    const el = this.els.toast;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.hidden = true;
    }, ms);
  }
}

function $(sel) {
  return document.querySelector(sel);
}

function streamItemHtml({ id, cls, time, icon, who, body }) {
  return `
        <div class="stream-item ${cls || ""}" data-id="${escapeHtml(id || "")}">
          <div class="stream-time">${escapeHtml(time || "")}</div>
          <div class="stream-icon">${icon || "•"}</div>
          <div class="stream-main">
            <div class="stream-who">${escapeHtml(who || "")}</div>
            <div class="stream-body">${escapeHtml(body || "")}</div>
          </div>
        </div>`;
}

const TOOL_META = {
  get_current_weather: {
    icon: "🌦️",
    label: "获取当日天气",
    focus: "气温 · 风力 · 降水",
  },
  get_forecast_daily: {
    icon: "📅",
    label: "获取多日预报",
    focus: "未来几天天气趋势",
  },
  get_traffic_estimate: {
    icon: "🛣️",
    label: "查询道路通行",
    focus: "封路 · 延误 · 通行状态",
  },
  get_flight_status: {
    icon: "✈️",
    label: "查询航班动态",
    focus: "准点 / 延误 / 登机口",
  },
  list_active_alerts: {
    icon: "🚨",
    label: "列出生效告警",
    focus: "路况 · 渡轮 · 航班异常",
  },
  get_budget_snapshot: {
    icon: "💰",
    label: "预算",
    focus: "已花 · 总额 · 剩余",
  },
  search_web: {
    icon: "🔍",
    label: "网页搜索",
    focus: "路况 · 营地 · 签证资讯",
  },
  write_journal: {
    icon: "📝",
    label: "写入游记",
    focus: "Notion 章节更新",
  },
  add_calendar_event: {
    icon: "📅",
    label: "加入日程",
    focus: "日期 · 行程节点",
  },
  book_hotel: { icon: "🏨", label: "预订酒店", focus: "入住日期 · 房价 · 确认状态" },
  book_flight: { icon: "✈️", label: "预订机票", focus: "航班号 · 航线 · 出票状态" },
  cancel_hotel: { icon: "🏨", label: "取消酒店", focus: "取消确认" },
  cancel_flight: { icon: "✈️", label: "取消机票", focus: "取消确认" },
  write_notion_page: { icon: "📝", label: "写入游记", focus: "Notion 页面更新" },
  "API-post-page": { icon: "📝", label: "创建 Notion 页面", focus: "游记文档" },
};

/** Colorful emoji icons for the tool rail (from TOOL_META). */
function toolEmojiIcon(name) {
  const n = String(name || "");
  if (TOOL_META[n]?.icon) return TOOL_META[n].icon;
  if (/budget/i.test(n)) return "💰";
  if (/search|web/i.test(n)) return "🔍";
  if (/forecast|calendar|schedule/i.test(n)) return "📅";
  if (/weather/i.test(n)) return "🌦️";
  if (/traffic|road/i.test(n)) return "🛣️";
  if (/alert/i.test(n)) return "🚨";
  if (/flight|air/i.test(n)) return "✈️";
  if (/hotel|stay/i.test(n)) return "🏨";
  if (/journal|notion|page|write/i.test(n)) return "📝";
  return "🛠️";
}

/** Tool call display name only — no params. */
function toolCallName(name) {
  return String(name || "tool").trim() || "tool";
}

/** First non-empty arg value for child-row preview (no key= param syntax). */
function firstArgPreview(args = {}) {
  for (const v of Object.values(args || {})) {
    if (v == null) continue;
    const s = typeof v === "string" ? v.trim() : String(v);
    if (s) return s;
  }
  return "";
}

function summarizeToolResult(result) {
  if (result == null) return null;
  if (typeof result !== "object") return result;
  const out = {};
  for (const [k, v] of Object.entries(result)) {
    if (k === "results" && Array.isArray(v)) {
      out.results = v.slice(0, 3).map((r) => r?.title || r);
      if (v.length > 3) out.results_more = v.length - 3;
    } else if (typeof v === "string" && v.length > 120) {
      out[k] = truncate(v, 120);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** One-line serif summary from a thinking blob. */
function thinkSummaryLine(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const m = raw.match(/^(.{12,110}?[。！？.!?])\s/);
  if (m) return m[1];
  if (raw.length <= 96) return raw;
  return `${raw.slice(0, 94)}…`;
}

function humanizeToolName(name) {
  const n = String(name || "").trim();
  if (!n) return "未知工具";
  if (TOOL_META[n]) return TOOL_META[n].label;
  const map = {
    get_current_weather: "获取当日天气",
    get_forecast_daily: "获取多日预报",
    get_traffic_estimate: "查询道路通行",
    get_flight_status: "查询航班动态",
    list_active_alerts: "列出生效告警",
    get_budget_snapshot: "读取行程预算",
    search_web: "网页搜索",
    write_journal: "写入游记",
    add_calendar_event: "加入日程",
    book_hotel: "预订酒店",
    book_flight: "预订机票",
    reserve_hotel: "预订酒店",
    reserve_flight: "预订机票",
    update_flight: "更新航班",
    send_email: "发送邮件",
    create_page: "创建页面",
  };
  if (map[n]) return map[n];
  if (/hotel/i.test(n) && /book|reserve|create/i.test(n)) return "预订酒店";
  if (/flight|air/i.test(n) && /book|reserve|create/i.test(n)) return "预订机票";
  if (/notion|page|journal/i.test(n)) return "更新游记";
  if (/weather/i.test(n)) return "获取天气";
  if (/traffic|road/i.test(n)) return "查询路况";
  if (/budget/i.test(n)) return "读取预算";
  if (/alert/i.test(n)) return "查询告警";
  return n
    .replace(/^API-/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isWriteToolName(name) {
  return /book|cancel|create|send|post|update|write|insert|reserve|confirm|refund/i.test(
    String(name || "")
  );
}

/** Resolve map anchor for a tool call (place / geo / road). */
function resolveToolMapAnchor(name, args = {}, result = null) {
  const geoKey = args.geo_key || result?.geo_key || null;
  let placeId = null;
  let roadId = args.road_id || result?.matched?.[0]?.road_id || null;

  if (name === "get_flight_status") placeId = "pl_chc_airport";
  if (name === "get_budget_snapshot" && result?.location) {
    const ids = extractPlaceIdsFromText(result.location);
    placeId = ids[0] || null;
  }

  const blob = [
    args.query,
    args.flight_no,
    result?.summary,
    result?.note,
    ...(result?.matched || []).map((e) => `${e.note || ""} ${e.road_name || ""}`),
  ]
    .filter(Boolean)
    .join(" ");
  if (!placeId) {
    const ids = extractPlaceIdsFromText(blob);
    placeId = ids[0] || null;
  }
  if (!roadId) {
    const roads = extractRoadIdsFromText(blob);
    roadId = roads[0] || null;
  }

  // geo_key → place when we only have weather keys
  if (!placeId && geoKey) {
    const map = {
      christchurch: "pl_chc_airport",
      tekapo: "pl_tekapo",
      mt_cook: "pl_mt_cook",
      queenstown: "pl_queenstown",
      milford: "pl_milford",
      wanaka: "pl_wanaka",
      picton: "pl_picton",
      wellington: "pl_wellington",
      taupo: "pl_taupo",
      rotorua: "pl_rotorua",
      auckland: "pl_akl_airport",
      shanghai_home: null,
    };
    placeId = map[String(geoKey).toLowerCase()] || null;
  }

  return { placeId, geoKey, roadId };
}

function geoLabel(key) {
  const k = String(key || "").toLowerCase();
  const map = {
    shanghai_home: "上海",
    christchurch: "基督城",
    tekapo: "蒂卡波",
    mt_cook: "库克山",
    queenstown: "皇后镇",
    milford: "米尔福德",
    wanaka: "瓦纳卡",
    te_anau: "蒂阿瑙",
    frankton: "弗兰克顿",
    picton: "皮克顿",
    wellington: "惠灵顿",
    rotorua: "罗托鲁阿",
    manapouri: "马纳保利",
  };
  return map[k] || key || "";
}

function roadLabel(idOrName) {
  const s = String(idOrName || "");
  if (/sh80|mt.?cook|quake/i.test(s)) return "SH80 库克山公路";
  if (/sh94|milford/i.test(s)) return "SH94 米尔福德公路";
  if (/ferry|cook.?strait|te_cook/i.test(s)) return "库克海峡渡轮";
  if (/sh6/i.test(s)) return "SH6";
  if (/sh8/i.test(s)) return "SH8";
  return s.replace(/^rd_|^re_|^te_|^htl_/i, "").replace(/_/g, " ") || "相关路段";
}

function hotelLabel(idOrName) {
  const s = String(idOrName || "");
  if (/tekapo/i.test(s)) return "蒂卡波营地";
  if (/lakeview|qtown/i.test(s)) return "皇后镇 Lakeview";
  if (/alpine/i.test(s)) return "Alpine 酒店";
  if (/rotorua/i.test(s)) return "罗托鲁阿住宿";
  return shortHotel(s) || "酒店";
}

function flightStatusLabel(st) {
  const s = String(st || "").toLowerCase();
  if (s === "delayed") return "延误";
  if (s === "cancelled" || s === "canceled") return "取消";
  if (s === "boarding") return "登机中";
  if (s === "landed") return "已落地";
  if (s === "departed") return "已起飞";
  if (s === "on_time" || s === "confirmed") return "准点";
  return st || "状态未知";
}

function weatherConditionLabel(c) {
  const s = String(c || "");
  const map = {
    Clear: "晴",
    Sunny: "晴",
    Cloudy: "多云",
    Overcast: "阴",
    Rain: "雨",
    "Heavy rain": "大雨",
    Showers: "阵雨",
    Snow: "雪",
    Windy: "大风",
    Fog: "雾",
  };
  return map[s] || s;
}

/** Pick a compact weather emoji from free text / condition. */
function weatherEmojiFromText(text) {
  const s = String(text || "").toLowerCase();
  if (/暴雨|大雨|雷暴|thunderstorm|heavy\s*rain|⚡/.test(s)) return "⛈️";
  if (/雪|blizzard|snow/.test(s)) return "🌨️";
  if (/雨|阵雨|降水|rain|shower|drizzle/.test(s)) return "🌧️";
  if (/雾|fog|mist|haze/.test(s)) return "🌫️";
  if (/大风|强风|gale|windy|storm/.test(s)) return "💨";
  if (/阴|overcast/.test(s)) return "☁️";
  if (/多云|cloudy|cloud/.test(s)) return "⛅";
  if (/晴|clear|sunny|日照/.test(s)) return "☀️";
  return "🌦️";
}

/** Compact weather string for status bar / sticky state. */
function formatObservedWeatherText(name, args = {}, result = null) {
  if (!result) return "";
  if (name === "get_forecast_daily") {
    const rows = result.forecast || [];
    if (!rows.length) return "";
    const place = geoLabel(args.geo_key || result.geo_key);
    const bits = rows.slice(0, 3).map((r) => {
      const d = String(r.date || "").slice(5) || "?";
      const cond = weatherConditionLabel(r.condition) || r.condition || "?";
      return `${d} ${cond} ${r.tmin ?? "?"}~${r.tmax ?? "?"}℃`;
    });
    return `${place ? `${place} · ` : ""}${bits.join("； ")}`;
  }
  if (result.summary) {
    return String(result.summary).replace(/^([A-Za-z ]+)/, (_, w) => weatherConditionLabel(w.trim()) || w);
  }
  if (result.condition != null) {
    const bits = [
      weatherConditionLabel(result.condition) || result.condition,
      `${result.tmin ?? "?"}~${result.tmax ?? "?"}℃`,
    ];
    if (result.wind_kmh != null) bits.push(`风 ${result.wind_kmh} km/h`);
    if (result.precip_mm != null && Number(result.precip_mm) > 0) bits.push(`降水 ${result.precip_mm} mm`);
    return bits.join(" · ");
  }
  if (result.weather) return String(result.weather).slice(0, 80);
  return "";
}

/** Rows for the bottom weather cinematic card. */
function buildWeatherActionRows(name, args = {}, result = null) {
  const place = geoLabel(args.geo_key || result?.geo_key) || args.geo_key || result?.geo_key || "";
  const date = args.date || result?.date || "";
  if (name === "get_forecast_daily") {
    const rows = result?.forecast || [];
    if (!rows.length) {
      return [
        { label: "地点", value: place || "—" },
        { label: "预报", value: "暂无数据" },
      ];
    }
    return rows.slice(0, 4).map((r) => {
      const d = String(r.date || "").slice(5) || "日期";
      const cond = weatherConditionLabel(r.condition) || r.condition || "—";
      return {
        label: d,
        value: `${cond} · ${r.tmin ?? "?"}~${r.tmax ?? "?"}℃`,
      };
    });
  }
  const rows = [];
  if (place) rows.push({ label: "地点", value: place });
  if (date) rows.push({ label: "日期", value: String(date).slice(0, 10) });
  if (result?.condition != null) {
    rows.push({
      label: "天气",
      value: weatherConditionLabel(result.condition) || String(result.condition),
    });
  } else if (result?.weather) {
    rows.push({ label: "天气", value: String(result.weather).slice(0, 40) });
  } else if (result?.summary) {
    rows.push({
      label: "概况",
      value: String(result.summary)
        .replace(/^([A-Za-z ]+)/, (_, w) => weatherConditionLabel(w.trim()) || w)
        .slice(0, 48),
    });
  }
  if (result?.tmin != null || result?.tmax != null) {
    rows.push({ label: "气温", value: `${result.tmin ?? "?"}~${result.tmax ?? "?"}℃` });
  }
  if (result?.wind_kmh != null) rows.push({ label: "风力", value: `${result.wind_kmh} km/h` });
  if (result?.precip_mm != null) rows.push({ label: "降水", value: `${result.precip_mm} mm` });
  if (result?.precip_prob != null) rows.push({ label: "降水概率", value: `${result.precip_prob}%` });
  if (!rows.length) rows.push({ label: "结果", value: result?.note || "查询完成" });
  return rows.slice(0, 5);
}

/** Core title + detail for tool rows / map toast / activity feed. */
function buildToolPulse(name, args = {}, result = null) {
  const base = TOOL_META[name] || {
    icon: isWriteToolName(name) ? "🔧" : "🛠️",
    label: humanizeToolName(name),
    focus: "查看调用结果",
  };
  const error = result && result.ok === false;
  let title = base.label;
  let detail = "";

  switch (name) {
    case "get_current_weather": {
      const place = geoLabel(args.geo_key || result?.geo_key);
      const date = args.date || result?.date || "";
      title = place ? `获取天气 · ${place}` : "获取当日天气";
      if (date) title += ` · ${String(date).slice(5)}`;
      if (result?.summary) {
        detail = String(result.summary)
          .replace(/^([A-Za-z ]+)/, (_, w) => weatherConditionLabel(w.trim()) || w);
      } else if (result?.condition != null) {
        const bits = [
          weatherConditionLabel(result.condition),
          `${result.tmin ?? "?"}~${result.tmax ?? "?"}℃`,
        ];
        if (result.wind_kmh != null) bits.push(`风力 ${result.wind_kmh} km/h`);
        if (result.precip_mm != null) bits.push(`降水 ${result.precip_mm} mm`);
        if (result.precip_prob != null) bits.push(`降水概率 ${result.precip_prob}%`);
        detail = bits.join(" · ");
      } else if (result?.weather) detail = String(result.weather).slice(0, 80);
      else detail = error ? result?.note || "天气数据不可用" : `待返回：${base.focus}`;
      break;
    }
    case "get_forecast_daily": {
      const place = geoLabel(args.geo_key || result?.geo_key);
      const days = args.days || result?.forecast?.length || 3;
      title = place ? `获取预报 · ${place}（${days}天）` : `获取多日预报（${days}天）`;
      const rows = result?.forecast || [];
      if (rows.length) {
        detail = rows
          .slice(0, 3)
          .map((r) => {
            const d = String(r.date || "").slice(5) || "?";
            return `${d} ${weatherConditionLabel(r.condition) || "?"} ${r.tmin ?? "?"}~${r.tmax ?? "?"}℃`;
          })
          .join("； ");
      } else detail = error ? result?.note || "预报不可用" : `将返回未来 ${days} 天趋势`;
      break;
    }
    case "get_traffic_estimate": {
      const road = roadLabel(args.road_id || args.query || result?.matched?.[0]?.road_id);
      title = `查询路况 · ${road}`;
      const matched = result?.matched || [];
      const status = String(result?.status || "").toLowerCase();
      if (error) detail = result?.error || result?.note || "路况查询失败";
      else if (status === "clear" || !matched.length) {
        detail = "未发现生效封路 · 路段可通行";
      } else {
        const top = matched[0];
        const closed =
          Number(top.active) === 1 &&
          (top.severity === "closed" ||
            /封|关闭|closed|avalanche|debris|落石|雪崩/i.test(`${top.note || ""}`));
        const label = closed ? "⚠ 已确认封闭" : "⚠ 有生效事件";
        detail = [label, top.note || top.road_name || roadLabel(top.road_id)]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 100);
        if (matched.length > 1) detail += `；另有 ${matched.length - 1} 条相关事件`;
      }
      break;
    }
    case "get_flight_status": {
      const no = args.flight_no || result?.flight_no || "";
      title = no ? `查询航班 · ${no}` : "查询航班动态";
      if (error) detail = result?.note || "未找到该航班";
      else {
        const bits = [flightStatusLabel(result?.status)];
        if (result?.delay_min) bits.push(`延误 ${result.delay_min} 分钟`);
        if (result?.gate) bits.push(`登机口 ${result.gate}`);
        if (result?.terminal) bits.push(`航站楼 ${result.terminal}`);
        if (result?.route || result?.legs) bits.push(result.route || result.legs);
        if (args.date || result?.date) bits.push(String(args.date || result.date).slice(0, 10));
        if (result?.note) bits.push(result.note);
        detail = bits.filter(Boolean).join(" · ");
      }
      break;
    }
    case "list_active_alerts": {
      const roads = result?.road_events || [];
      const transit = result?.transit_events || [];
      const flights = Object.entries(result?.flights || {});
      const n = roads.length + transit.length + flights.length;
      title = n ? `列出生效告警 · ${n} 条` : "列出生效告警 · 暂无";
      const bits = [];
      for (const e of roads.slice(0, 2)) bits.push(e.note || `道路 ${roadLabel(e.road_id)}`);
      for (const e of transit.slice(0, 1)) bits.push(e.note || "渡轮服务异常");
      for (const [fn, fv] of flights.slice(0, 1)) {
        bits.push(`${fn} ${flightStatusLabel(fv?.status)}`);
      }
      detail = bits.length ? bits.join("； ") : "当前无路况/渡轮/航班异常";
      break;
    }
    case "get_budget_snapshot": {
      title = "预算 · 行程费用";
      const b = result?.budget;
      if (b) {
        const bits = [];
        if (b.spent_cny != null) bits.push(`已花 ¥${fmt(b.spent_cny)}`);
        if (b.total_cny != null) bits.push(`总额 ¥${fmt(b.total_cny)}`);
        if (b.total_cny != null && b.spent_cny != null) {
          bits.push(`剩余 ¥${fmt(Number(b.total_cny) - Number(b.spent_cny))}`);
        }
        if (result.location) bits.push(`当前位置 ${result.location}`);
        detail = bits.join(" · ");
      } else detail = result?.location ? `位置 ${result.location} · 预算尚未确定` : "预算尚未写入";
      break;
    }
    case "search_web": {
      const q = args.query || result?.query || "";
      title = q ? `搜索 · ${truncate(q, 28)}` : "网页搜索";
      const rows = result?.results || [];
      if (error) detail = result?.error || "搜索失败";
      else if (rows.length) {
        detail = rows
          .slice(0, 2)
          .map((r) => r.title)
          .join("； ");
        if (rows.length > 2) detail += ` 等 ${rows.length} 条`;
      } else detail = error ? "无结果" : "检索中…";
      break;
    }
    case "write_journal": {
      const sec = args.section || result?.section || "journal";
      title = args.title ? `写入游记 · ${args.title}` : "写入游记";
      detail = `已记入 · ${sec === "safety" ? "安全备注" : sec === "expense" ? "费用" : "游记"}`;
      break;
    }
    case "add_calendar_event": {
      const ev = result?.event || {};
      title = args.title || ev.title ? `加入日程 · ${args.title || ev.title}` : "加入日程";
      detail = [args.date || ev.date, args.note || ev.note].filter(Boolean).join(" · ") || "已写入行程日历";
      break;
    }
    default: {
      title = base.label;
      if (/hotel/i.test(name)) {
        const hotel = hotelLabel(args.hotel_id || args.hotel_name || args.name || result?.hotel_id);
        title = `${base.label} · ${hotel}`;
        detail = [
          args.date || args.check_in,
          args.nightly_price != null ? `NZD ${args.nightly_price}` : null,
          result?.status,
          result?.note || result?.summary,
        ]
          .filter(Boolean)
          .join(" · ");
      } else if (/flight|air/i.test(name)) {
        const no = args.flight_no || result?.flight_no || "";
        title = no ? `${base.label} · ${no}` : base.label;
        detail = [args.date, result?.status && flightStatusLabel(result.status), result?.note || result?.summary]
          .filter(Boolean)
          .join(" · ");
      } else {
        const argBits = [];
        if (args.geo_key) argBits.push(geoLabel(args.geo_key) || args.geo_key);
        if (args.flight_no) argBits.push(args.flight_no);
        if (args.road_id || args.query) argBits.push(roadLabel(args.road_id || args.query));
        if (args.date) argBits.push(args.date);
        if (args.hotel_id || args.hotel_name) argBits.push(hotelLabel(args.hotel_id || args.hotel_name));
        detail = [base.focus, ...argBits, result?.summary || result?.note || result?.error]
          .filter(Boolean)
          .join(" · ");
      }
    }
  }

  if (error && !detail) detail = result?.error || result?.note || "调用失败";

  return {
    icon: base.icon,
    title,
    detail: String(detail || base.focus || "").slice(0, 110),
    focus: base.focus,
  };
}

function describeToolCall(name, args = {}, result = null) {
  const pulse = buildToolPulse(name, args, result);
  const stateful = isWriteToolName(name) || Boolean(result?.booked || result?.written || result?.mutated);
  const error = result && result.ok === false;
  const pending = !result && !error;
  return {
    icon: pulse.icon,
    title: pending && !Object.keys(args || {}).length ? humanizeToolName(name) : pulse.title,
    detail: pulse.detail || (stateful ? "已写入行程账本 / 环境状态" : pending ? "调用中…" : ""),
    focus: pulse.focus,
    pulse,
    stateful,
    error: Boolean(error),
  };
}

/** Build toastable alerts from ledger snapshot (stable keys for dedupe). */
function collectLedgerAlerts(ledger) {
  const out = [];
  if (!ledger) return out;
  for (const f of ledger.flights || []) {
    const no = f.flight_no || "航班";
    const st = flightStatusLabel(f.status);
    const title =
      f.status === "delayed"
        ? `航班延误 · ${no}`
        : f.status === "cancelled" || f.status === "canceled"
          ? `机票取消 · ${no}`
          : `预订机票 · ${no}`;
    const body = [
      f.route || f.legs,
      st,
      f.delay_min ? `延误 ${f.delay_min} 分钟` : null,
      f.gate ? `登机口 ${f.gate}` : null,
      f.note,
    ]
      .filter(Boolean)
      .join(" · ");
    out.push({
      key: `flight:${f.id}:${f.status}:${f.delay_min || 0}`,
      tab: "trip",
      app: "行程账本",
      from: "机票预订",
      icon: "✈️",
      text: title,
      title,
      body,
      kind: "ledger",
    });
  }
  for (const h of ledger.hotels || []) {
    const hotel = hotelLabel(h.name || h.hotel_id);
    const title =
      h.status === "cancelled"
        ? `取消酒店 · ${hotel}`
        : h.note?.includes("换订") || h.note?.includes("可退")
          ? `确认酒店 · ${hotel}`
          : `预订酒店 · ${hotel}`;
    const body = [
      h.name && h.name !== hotel ? h.name : null,
      h.date || h.check_in ? `入住 ${h.date || h.check_in}` : null,
      h.price_nzd != null ? `NZD ${h.price_nzd}` : null,
      h.status === "cancelled" ? "已取消" : h.status === "confirmed" ? "已确认" : h.status,
      h.note,
    ]
      .filter(Boolean)
      .join(" · ");
    out.push({
      key: `hotel:${h.id}:${h.status}:${h.price_nzd ?? ""}`,
      tab: "trip",
      app: "行程账本",
      from: "酒店预订",
      icon: "🏨",
      text: title,
      title,
      body,
      kind: "ledger",
    });
  }
  const notion = ledger.notion?.sections || {};
  for (const [sec, label] of [
    ["journal", "更新游记"],
    ["expense", "更新费用记录"],
    ["safety", "更新安全备注"],
  ]) {
    const text = String(notion[sec] || "").trim();
    if (!text) continue;
    out.push({
      key: `notion:${sec}:${text.slice(0, 40)}`,
      tab: "notes",
      app: "Notion 游记",
      from: "Notion",
      icon: "📝",
      text: label,
      title: label,
      body: "", // chat/toast: title only
      mapBody: text, // map overlay: stream then mark submitted
      kind: "notion",
    });
  }
  return out;
}

function shortHotel(name) {
  const s = String(name || "住宿");
  if (/Alpine/i.test(s)) return "Alpine";
  if (/Lakeview/i.test(s)) return "Lakeview";
  if (/Tekapo/i.test(s)) return "蒂卡波营地";
  if (/Rotorua/i.test(s)) return "罗托鲁阿";
  return s.length > 14 ? s.slice(0, 12) + "…" : s;
}

/** Guess a readable SMS sender from notification body. */
function guessSmsSender(body) {
  const s = String(body || "");
  if (/移民局|NZeTA|签证|入境/i.test(s)) return "新西兰移民局";
  if (/NZTA|路况|公路|封闭|封路/i.test(s)) return "NZTA 路况";
  if (/Interislander|渡轮|Bluebridge/i.test(s)) return "渡轮通知";
  if (/MetService|天气|风力|降雨/i.test(s)) return "天气提醒";
  if (/航空|航班|Airport|MU\d+/i.test(s)) return "航班通知";
  if (/酒店|营地|Holiday\s*Park|住宿/i.test(s)) return "住宿通知";
  const m = s.match(/^([^：:]{2,12})[：:]/);
  if (m) return m[1].trim();
  return "";
}

/** Map env playback events → phone toast copy (archived to 邮件). */
function envEventToast(ev) {
  const kind = ev.kind || "";
  const body = String(ev.body || "").replace(/\s+/g, " ").trim();
  const snippet = body.length > 56 ? body.slice(0, 54) + "…" : body;
  const src = String(ev.channel || ev.source || "");
  const isMail = /email/i.test(src);
  const appName = channelAppLabel(src);

  if (kind === "app_notification") {
    return {
      icon: isMail ? "✉️" : "💬",
      app: isMail ? "邮件" : appName || "短信",
      from: isMail ? "收件箱" : appName || guessSmsSender(body) || "短信通知",
      tab: "mail",
      text: snippet || (isMail ? "收到一封新邮件" : `${appName || "短信"}发来一条消息`),
    };
  }
  if (kind === "world") {
    return {
      icon: isMail ? "✉️" : "💬",
      app: isMail ? "邮件" : "短信",
      from: isMail ? "收件箱" : appName || guessSmsSender(body) || "外部通知",
      tab: "mail",
      text: snippet || "收到一条短信通知",
    };
  }
  if (kind === "notification") {
    return {
      icon: "🫀",
      app: "系统心跳",
      from: "系统检查",
      tab: "mail",
      text: snippet || "系统心跳：巡检当前行程风险",
    };
  }
  if (kind === "weather") {
    const impact = ev.user_state?.weather_impact;
    const w = ev.user_state?.weather || snippet;
    return {
      icon: impact === "disruptive" ? "🌧️" : "🌦️",
      app: "天气更新",
      from: "天气",
      tab: "mail",
      text: impact === "disruptive" ? `⚠ 不利天气 · ${w}` : w || "天气状态已更新",
    };
  }
  if (kind === "routine") {
    const action = ev.user_state?.demo_action || "";
    const loc = ev.user_state?.location || "";
    return {
      icon: "🚗",
      app: "行程节点",
      from: "行程推进",
      tab: "mail",
      text: [action || "日常行程节点", loc].filter(Boolean).join(" · ") || snippet || "行程节点更新",
    };
  }
  if (kind === "mutation") {
    return null;
  }
  return null;
}

function formatEnvStreamRow(ev, { labels = {}, speakers = {} } = {}) {
  const kind = ev.kind || "";
  const km = KIND_META[kind] || { icon: "•", cls: "", label: kind };
  const raw = String(ev.body || "").replace(/\s+/g, " ").trim();

  if (kind === "user_message") {
    return {
      icon: km.icon,
      cls: km.cls,
      who: speakers[ev.from]?.name || ev.from || "用户",
      body: truncate(raw || "（空消息）", 160),
    };
  }
  if (kind === "mutation") {
    return {
      icon: km.icon,
      cls: km.cls,
      who: "环境静默变更",
      body: truncate(mutationSummary(ev), 180),
    };
  }
  if (kind === "weather") {
    const w = ev.user_state?.weather || raw;
    const impact = ev.user_state?.weather_impact === "disruptive" ? "⚠ 可能影响行程" : null;
    return {
      icon: km.icon,
      cls: km.cls,
      who: "天气更新",
      body: truncate([w, impact].filter(Boolean).join(" · "), 160),
    };
  }
  if (kind === "routine") {
    const action = ev.user_state?.demo_action || "";
    const loc = ev.user_state?.location || "";
    return {
      icon: km.icon,
      cls: km.cls,
      who: "行程节点",
      body: truncate([action, loc, raw && raw !== action ? raw : null].filter(Boolean).join(" · ") || "行程推进", 160),
    };
  }
  if (kind === "notification") {
    return {
      icon: km.icon,
      cls: km.cls,
      who: "系统心跳",
      body: truncate(raw || "巡检当前行程状态", 160),
    };
  }
  if (kind === "app_notification" || kind === "world") {
    const src = channelAppLabel(ev.channel || ev.source) || (kind === "world" ? "外部资讯" : "APP / 短信");
    return {
      icon: km.icon,
      cls: km.cls,
      who: src,
      body: truncate(raw || "收到一条通知", 160),
    };
  }
  return {
    icon: km.icon,
    cls: km.cls,
    who: labels[kind] || km.label,
    body: truncate(raw || kind, 160),
  };
}

function channelAppLabel(src) {
  const s = String(src || "").toLowerCase();
  if (!s) return "";
  if (s.includes("flight")) return "航司";
  if (s.includes("hotel")) return "酒店";
  if (s.includes("weather")) return "天气";
  if (s.includes("maps") || s.includes("nzta")) return "路况";
  if (s.includes("visa")) return "签证";
  if (s.includes("ecommerce") || s.includes("britz")) return "租车";
  if (s.includes("notification")) return "通知";
  if (s.includes("email")) return "邮件";
  return "";
}

function firstLine(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  return line || "";
}

function previewText(text, n = 72) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function cssEscape(value) {
  const s = String(value ?? "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/["\\]/g, "\\$&");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render GFM markdown into an element (agent chat only). */
function setMarkdown(el, text) {
  if (!el) return;
  el.classList.add("md-body");
  const src = normalizeAgentMarkdown(String(text ?? ""));
  const markedApi = globalThis.marked;
  const purify = globalThis.DOMPurify;
  if (!markedApi?.parse) {
    el.textContent = src;
    recoverOrphanPipeTables(el);
    return;
  }
  try {
    if (typeof markedApi.setOptions === "function") {
      // breaks:false keeps GFM tables intact; we still get paragraphs via blank lines
      markedApi.setOptions({ gfm: true, breaks: false, pedantic: false });
    }
    let raw = markedApi.parse(src, { gfm: true, breaks: false });
    // Soft line breaks for non-table plain paragraphs (mobile chat feel)
    raw = softBreakParagraphs(raw);
    const clean = purify?.sanitize
      ? purify.sanitize(raw, {
          ADD_TAGS: ["table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col"],
          ADD_ATTR: ["align", "colspan", "rowspan", "scope"],
        })
      : raw;
    el.innerHTML = clean;
    recoverOrphanPipeTables(el);
    wrapMarkdownTables(el);
    scrubBrokenTableRows(el);
  } catch {
    el.textContent = src;
    recoverOrphanPipeTables(el);
  }
}

/**
 * Fix common LLM table mistakes for GFM:
 * - fullwidth / box-drawing pipes → ASCII |
 * - leading indent / NBSP (otherwise marked treats as code or plain <p>)
 * - blank line before table
 * - insert ONE header separator if missing
 * - drop repeated separator-only lines between body rows
 */
function normalizeAgentMarkdown(src) {
  let s = String(src ?? "").replace(/\r\n/g, "\n");
  // Unicode pipes / separators models often emit in CJK answers
  // Fullwidth / box-drawing vertical bars → ASCII pipe
  s = s.replace(/[\uFF5C\u2502\u2503\u2223]/g, "|");

  const lines = s.split("\n");
  const out = [];
  let inTable = false;
  let sawSeparator = false;

  for (let i = 0; i < lines.length; i++) {
    let line = stripRowIndent(lines[i]);
    const prev = out.length ? out[out.length - 1] : null;
    const nextRaw = lines[i + 1];
    const next = nextRaw != null ? stripRowIndent(nextRaw) : null;
    const isRow = isPipeRow(line);
    const isSep = isPipeSeparator(line);

    if (!isRow) {
      inTable = false;
      sawSeparator = false;
      out.push(lines[i]); // keep original non-table line (preserve intentional indent in lists/code)
      continue;
    }

    // Ensure blank line before a table so it is not swallowed by a paragraph
    if (!inTable && prev != null && prev.trim() !== "" && !isPipeRow(prev)) {
      out.push("");
    }

    if (!inTable) {
      inTable = true;
      sawSeparator = false;
      out.push(line);
      if (
        !isSep &&
        next != null &&
        isPipeRow(next) &&
        !isPipeSeparator(next) &&
        (prev == null || !isPipeRow(prev))
      ) {
        const cols = Math.max(countPipeCols(line), 1);
        out.push("| " + Array(cols).fill("---").join(" | ") + " |");
        sawSeparator = true;
      } else if (isSep) {
        sawSeparator = true;
      }
      continue;
    }

    if (isSep) {
      if (sawSeparator) continue;
      sawSeparator = true;
      out.push(normalizeSeparatorLine(line));
      continue;
    }

    if (isDashOnlyRow(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

/** Strip leading spaces/tabs/NBSP/ideographic space so pipe rows are not code-fenced. */
function stripRowIndent(line) {
  return String(line || "").replace(/^[\t \u00A0\u3000\u2000-\u200B\uFEFF]+/, "");
}

function normalizeSeparatorLine(line) {
  const cols = Math.max(countPipeCols(line), 1);
  return "| " + Array(cols).fill("---").join(" | ") + " |";
}

function isDashOnlyRow(line) {
  const cells = splitPipeCells(line);
  if (cells.length < 2) return false;
  return cells.every((c) => isSepCell(c));
}

function isSepCell(c) {
  const t = String(c || "").trim();
  return !t || /^:?[-–—−\u2013\u2014\u2212]{2,}:?$/.test(t) || t === "—" || t === "-" || t === "–";
}

function isPipeRow(line) {
  const t = stripRowIndent(line).trimEnd();
  if (!t.includes("|")) return false;
  return splitPipeCells(t).length >= 2;
}

function isPipeSeparator(line) {
  const cells = splitPipeCells(line);
  if (cells.length < 2) return false;
  return cells.every((c) => isSepCell(c));
}

function splitPipeCells(line) {
  return stripRowIndent(line)
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function countPipeCols(line) {
  return splitPipeCells(line).length;
}

function softBreakParagraphs(html) {
  // Inside <p>…</p>, turn single newlines into <br> (tables untouched)
  return String(html).replace(/<p>([\s\S]*?)<\/p>/g, (_, inner) => {
    if (inner.includes("<table") || inner.includes("<li") || inner.includes("<pre")) {
      return `<p>${inner}</p>`;
    }
    // Leave pipe-table-shaped paragraphs alone — recoverOrphanPipeTables will promote them
    const plain = inner.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
    if (looksLikePipeTable(plain)) return `<p>${inner}</p>`;
    return `<p>${inner.replace(/\n/g, "<br>\n")}</p>`;
  });
}

/**
 * When marked still emits a pipe table as <p> or <pre><code>, rebuild a real <table>.
 * Covers residual fullwidth/indent/edge cases after normalize.
 */
function recoverOrphanPipeTables(root) {
  if (!root?.querySelectorAll) return;

  const candidates = [...root.querySelectorAll("p, pre")];
  for (const node of candidates) {
    let text = "";
    if (node.tagName === "PRE") {
      text = node.textContent || "";
    } else {
      // Preserve soft line breaks from <br>
      text = (node.innerHTML || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "");
      text = decodeBasicEntities(text);
    }
    if (!looksLikePipeTable(text)) continue;
    const table = buildHtmlTableFromPipes(text);
    if (!table) continue;
    node.replaceWith(table);
  }
}

function looksLikePipeTable(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(stripRowIndent)
    .map((l) => l.trimEnd())
    .filter((l) => l.length);
  if (lines.length < 2) return false;
  // Entire block should be pipe rows (avoid false positives in prose)
  if (!lines.every(isPipeRow)) return false;
  // Need a separator, or ≥3 rows (header + 2 body)
  return lines.some(isPipeSeparator) || lines.length >= 3;
}

function buildHtmlTableFromPipes(text) {
  let lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(stripRowIndent)
    .map((l) => l.trimEnd())
    .filter((l) => l.length && isPipeRow(l));
  if (lines.length < 2) return null;

  // Drop leading separators
  while (lines.length && isPipeSeparator(lines[0])) lines = lines.slice(1);
  if (!lines.length) return null;

  let header = splitPipeCells(lines[0]);
  let bodyLines = lines.slice(1);
  if (bodyLines.length && isPipeSeparator(bodyLines[0])) {
    bodyLines = bodyLines.slice(1);
  }
  bodyLines = bodyLines.filter((l) => !isPipeSeparator(l) && !isDashOnlyRow(l));
  if (!header.length) return null;

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const cell of header) {
    const th = document.createElement("th");
    th.textContent = cell;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  if (bodyLines.length) {
    const tbody = document.createElement("tbody");
    for (const line of bodyLines) {
      const cells = splitPipeCells(line);
      const tr = document.createElement("tr");
      for (let i = 0; i < header.length; i++) {
        const td = document.createElement("td");
        td.textContent = cells[i] ?? "";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }
  return table;
}

function decodeBasicEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function wrapMarkdownTables(root) {
  root.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.classList.contains("md-table-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "md-table-wrap";
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
}

/** Remove leftover dash-only rows that survived parsing (visual noise on mobile). */
function scrubBrokenTableRows(root) {
  root.querySelectorAll("table tr").forEach((tr) => {
    const cells = [...tr.querySelectorAll("th, td")];
    if (!cells.length) return;
    const dashOnly = cells.every((c) => {
      const t = (c.textContent || "").trim();
      return !t || isSepCell(t);
    });
    if (dashOnly) tr.remove();
  });
}

function fmt(n) {
  return Number(n || 0).toLocaleString("zh-CN");
}

/** Simulated clock stamp for chat / stream, e.g. "9/25 09:00". */
function formatSimStamp(iso) {
  if (!iso) return "";
  const s = String(iso);
  const date = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return s.slice(0, 16);
  const [, m, day] = date.split("-");
  const md = `${Number(m)}/${Number(day)}`;
  const hm = s.length >= 16 ? s.slice(11, 16) : "";
  return hm ? `${md} ${hm}` : md;
}

function truncate(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function shortWeather(w) {
  if (!w) return "—";
  const m = String(w).match(/^([^,，]+)/);
  return m ? m[1].trim() : String(w).slice(0, 24);
}

function weatherSub(state) {
  if (!state?.weather) return "指定日期天气节点更新后显示";
  if (state.weather_impact === "disruptive") return `⚠ 影响行程 · ${state.weather}`;
  return state.weather;
}

function mutationSummary(ev) {
  const applies = ev.apply || [];
  if (!applies.length) return "后台静默写入了一条环境变更（需主动查工具才会发现）";

  const parts = applies.map((a) => describeMutationApply(a));
  return `${parts.join("； ")}（静默生效，需查工具才可见）`;
}

function describeMutationApply(a) {
  const server = String(a.server || "");
  const table = String(a.table || a.tool_call?.name || "");
  const op = String(a.op || "").toLowerCase();
  const values = a.values || a.set || {};
  const where = a.where || {};
  const args = a.tool_call?.args || {};

  if (server === "hotel_booking" || /hotel/i.test(server)) {
    const hotel = hotelLabel(values.hotel_id || where.hotel_id || args.hotel_id);
    const date = values.date || where.date || args.date || "";
    if (values.nightly_price != null || a.set?.nightly_price != null) {
      const price = values.nightly_price ?? a.set?.nightly_price;
      const inv = values.inventory_remaining ?? a.set?.inventory_remaining;
      return `酒店房价变更 · ${hotel}${date ? ` · ${date}` : ""} · NZD ${price}${
        inv != null ? ` · 剩余 ${inv} 间` : ""
      }`;
    }
    return `酒店库存/房价更新 · ${hotel}`;
  }

  if (server === "flight_booking" || /flight/i.test(server)) {
    const no = values.flight_no || where.flight_no || args.flight_no || "航班";
    const st = flightStatusLabel(values.status);
    const delay = values.delay_min ? `延误 ${values.delay_min} 分钟` : null;
    const gate = values.gate ? `登机口 ${values.gate}` : null;
    return [`航班状态更新 · ${no}`, st, delay, gate].filter(Boolean).join(" · ");
  }

  if (server === "maps" && /road/i.test(table)) {
    const id = where.event_id || values.event_id || "";
    const road = roadLabel(id);
    const active = values.active ?? a.set?.active;
    const note = values.note || a.set?.note || "";
    if (active === 1 || active === "1") return `道路封闭生效 · ${road}${note ? ` · ${note}` : ""}`;
    if (active === 0 || active === "0") return `道路恢复通行 · ${road}`;
    return `路况变更 · ${road}${note ? ` · ${note}` : ""}`;
  }

  if (server === "maps" && /transit/i.test(table)) {
    const id = where.event_id || values.event_id || "";
    const name = roadLabel(id);
    const active = values.active ?? a.set?.active;
    if (active === 1 || active === "1") return `渡轮服务中断 · ${name}`;
    if (active === 0 || active === "0") return `渡轮服务恢复 · ${name}`;
    return `渡轮动态变更 · ${name}`;
  }

  if (server === "weather" && /alert/i.test(table)) {
    const desc = values.description || a.set?.description || values.kind || "天气告警";
    const areas = (() => {
      try {
        const raw = values.areas_json;
        const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(arr)) return arr.map(geoLabel).filter(Boolean).join("/");
      } catch {
        /* ignore */
      }
      return "";
    })();
    const active = values.active ?? a.set?.active;
    if (op === "insert" || active === 1 || active === "1") {
      return `天气告警生效 · ${truncate(desc, 60)}${areas ? ` · 影响 ${areas}` : ""}`;
    }
    if (active === 0 || active === "0") return `天气告警解除 · ${where.alert_id || values.alert_id || ""}`;
    return `天气告警更新 · ${truncate(desc, 60)}`;
  }

  if (server === "email" || /mail/i.test(table)) {
    const sub = values.subject || args.subject || "无主题";
    const from = values.from_addr || args.from || "";
    return `收件箱新增邮件 · ${truncate(sub, 48)}${from ? ` · 来自 ${from}` : ""}`;
  }

  if (server === "notion" || /page|notion/i.test(table)) {
    const title =
      args?.properties?.title?.[0]?.text?.content ||
      values.title ||
      "游记页面";
    return `Notion 写入 · ${truncate(title, 48)}`;
  }

  const serverLabel =
    {
      maps: "地图服务",
      weather: "天气服务",
      hotel_booking: "酒店预订",
      flight_booking: "机票预订",
      email: "邮件",
      notion: "Notion",
    }[server] || server || "后台";
  return `${serverLabel}变更 · ${table || "未知表"} · ${op || "update"}`;
}
