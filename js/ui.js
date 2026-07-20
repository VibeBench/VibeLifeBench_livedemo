/**
 * Dashboard + phone chat rendering
 */
import { renderLeafletMap, destroyMap } from "./map.js?v=20260720-47";
import { groupLedgerByDate } from "./ledger.js?v=20260720-33";

const KIND_META = {
  user_message: { icon: "👤", cls: "kind-user", label: "用户输入" },
  app_notification: { icon: "🔔", cls: "kind-app", label: "APP/短信" },
  world: { icon: "🌐", cls: "kind-world", label: "外部信息" },
  weather: { icon: "🌦️", cls: "kind-weather", label: "日期天气" },
  mutation: { icon: "⚙️", cls: "kind-mut", label: "静默变更" },
  notification: { icon: "🫀", cls: "kind-heart", label: "系统心跳" },
  routine: { icon: "🚗", cls: "kind-routine", label: "日常节点" },
  env_change: { icon: "🌐", cls: "kind-world", label: "环境变更" },
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
      planList: $("#planList"),
      impactBox: $("#impactBox"),
      footerStats: $("#footerStats"),
      chatMessages: $("#chatMessages"),
      chatInput: $("#chatInput"),
      quickChips: $("#quickChips"),
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
    if (t === "settings") {
      document.querySelector("#btnConsole")?.click();
      this._flashNav("settings");
      return;
    }
    this.activeTab = t;
    this.clearNavBadge(t);
    for (const btn of this.els.phoneNav?.querySelectorAll("[data-tab]") || []) {
      btn.classList.toggle("active", btn.dataset.tab === t);
    }
    const panes = {
      chat: this.els.paneChat,
      trip: this.els.paneTrip,
      mail: this.els.paneMail,
      notes: this.els.paneNotes,
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
   * Detect new ledger items → tab badges + in-phone toast banners.
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
      this.bumpNavBadge(tab, 1);
    }
    this.enqueuePhoneBanners(fresh.map((a) => ({ ...a, openTab: "mail" })));
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
   * In-phone notification. Stays until user taps × or the card (no auto-dismiss).
   * Tapping the card opens 邮件 and focuses the archived item.
   */
  showPhoneBanner(change) {
    const el = this.els.phoneToast || $("#phoneToast");
    if (!el || !change) return;
    this.els.phoneToast = el;
    this._phoneToastShowing = true;
    clearTimeout(this._phoneToastTimer);
    this._phoneToastTimer = null;

    const icon = change.icon || "🔔";
    const text = change.text || "有新通知";
    const app = change.app || "通知";
    const mailKey = change.key || null;
    const pending = this._phoneToastQueue?.length || 0;

    el.hidden = false;
    el.removeAttribute("hidden");
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
  } = {}) {
    const k = key || `manual:${text}`;
    if (!this._seenLedgerKeys) this._seenLedgerKeys = new Set();
    if (this._seenLedgerKeys.has(k)) return;
    this._seenLedgerKeys.add(k);
    if (tab === "trip" || tab === "notes") this.bumpNavBadge(tab, 1);
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

  /** Phone toast for playback events that should surface on the handset. */
  notifyEnvEvent(event) {
    if (!event) return;
    const toast = envEventToast(event);
    if (!toast) return;
    const body = String(event.body || "").trim();
    const title = firstLine(body) || toast.text;
    this.notifyStateChange({
      ...toast,
      tab: "mail",
      key: `event:${event.id}`,
      title,
      body: body || toast.text,
      time: event.time || null,
      kind: event.kind,
      from: toast.from || toast.app,
    });
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
    if (el) {
      el.classList.remove("show");
      el.hidden = true;
      el.setAttribute("hidden", "");
      el.replaceChildren();
      el.onclick = null;
    }
    clearTimeout(this._phoneToastTimer);
    this._phoneToastTimer = null;
    this._phoneToastShowing = false;
    if (advanceQueue && this._phoneToastQueue?.length) {
      this._phoneToastTimer = setTimeout(() => {
        this._phoneToastTimer = null;
        this._drainPhoneBannerQueue();
      }, 200);
    }
  }

  resetLedgerAlerts() {
    this._seenLedgerKeys = new Set();
    this._badges = { trip: 0, notes: 0, mail: 0 };
    this._inbox = [];
    this._highlightMailKey = null;
    this._phoneToastQueue = [];
    this._phoneToastShowing = false;
    this._paintBadges();
    this.hidePhoneBanner();
    this.renderMailInbox();
  }

  setMeta(meta) {
    this.speakers = meta.speakers || {};
    this.kindLabels = meta.kind_labels || {};
    $("#caseTitle").textContent = "VibeLifeBench";
    $("#tripName").textContent = meta.title || meta.case_id;
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
      { icon: "📍", label: "当前位置", value: state?.location || "—", sub: state?.geo_key || "" },
      {
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
      { icon: "☀️", label: "天气", value: shortWeather(state?.weather), sub: weatherSub(state) },
      {
        icon: "💰",
        label: "预算状态",
        value: budgetValue,
        sub: budgetSub,
      },
      {
        icon: "✈️",
        label: "下一航班",
        value: flightStatus,
        sub: flightSub,
      },
    ];

    this.els.statusGrid.innerHTML = cards
      .map(
        (c) => `
      <article class="status-card">
        <div class="status-icon">${c.icon}</div>
        <div class="status-body">
          <div class="status-label">${c.label}</div>
          <div class="status-value">${escapeHtml(c.value)}</div>
          <div class="status-sub">${escapeHtml(c.sub)}</div>
        </div>
      </article>`
      )
      .join("");
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

  renderEventStream(events, meta) {
    const labels = meta?.kind_labels || this.kindLabels;
    const speakers = meta?.speakers || this.speakers;
    this.els.eventStream.innerHTML = events
      .map((ev) => {
        const km = KIND_META[ev.kind] || { icon: "•", cls: "", label: ev.kind };
        const time = formatSimStamp(ev.time) || "--:--";
        const who =
          ev.kind === "user_message"
            ? speakers[ev.from]?.name || ev.from || "用户"
            : labels[ev.kind] || km.label;
        const body = truncate(ev.body || (ev.kind === "mutation" ? mutationSummary(ev) : ""), 160);
        return `
        <div class="stream-item ${km.cls}" data-id="${escapeHtml(ev.id)}">
          <div class="stream-time">${escapeHtml(time)}</div>
          <div class="stream-icon">${km.icon}</div>
          <div class="stream-main">
            <div class="stream-who">${escapeHtml(who)}</div>
            <div class="stream-body">${escapeHtml(body)}</div>
          </div>
        </div>`;
      })
      .join("");
    this.els.eventStream.scrollTop = this.els.eventStream.scrollHeight;
  }

  renderMap(engine) {
    const result = renderLeafletMap(engine);
    if (!result.ok) {
      this.els.mapPanel.innerHTML = `<div class="map-canvas map-fallback">地图加载失败：${escapeHtml(result.reason || "unknown")}<br/><small>请检查网络是否可访问 OpenStreetMap / Leaflet CDN</small></div>`;
    }

    const active = engine.activeRoadEvents();
    const today = engine.eventsForCurrentDay().filter((e) => e.kind !== "mutation");
    const planItems = today
      .filter((e) => e.kind === "app_notification" || e.kind === "routine")
      .slice(0, 4)
      .map((e) => truncate(e.body, 80));
    const reached = typeof engine.reachedDate === "function" ? engine.reachedDate() : null;
    const defaults = reached
      ? ["按已揭晓行程推进", "关注天气与路况", "控制单日驾驶时长"]
      : ["行程规划将随日程推进逐步揭晓", "先完成行前准备", "关注签证 / 机票 / 房车"];
    this.els.planList.innerHTML = (planItems.length ? planItems : defaults)
      .map((t) => `<li>${escapeHtml(t)}</li>`)
      .join("");

    if (active.length) {
      this.els.impactBox.innerHTML = `
        <div class="impact-title">当前影响</div>
        <ul>${active.map((a) => `<li>${escapeHtml(a.note || a.event_id)}</li>`).join("")}</ul>
        <p class="impact-hint">建议：主动查路况工具，必要时调整当日行程（留缓冲 / 改景点）。</p>`;
      this.els.impactBox.hidden = false;
    } else {
      this.els.impactBox.hidden = true;
      this.els.impactBox.innerHTML = "";
    }
  }

  resetMap() {
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
    this.els.footerStats.innerHTML = `
      <span>${dayLabel}/15</span>
      <span>预算已用 ${spent}</span>
      <span>下一站 ${escapeHtml(next)}</span>
      <span>事件 ${engine.progress.cursor + 1}/${engine.progress.total}</span>`;
    this.els.progressLabel.textContent = `${engine.progress.cursor + 1} / ${engine.progress.total}`;
  }

  // —— Chat (phone) ——
  clearChat() {
    this.els.chatMessages.innerHTML = "";
    this._chatStickToBottom = true;
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

  /** Claude-homepage-like agent turn: collapsible Thinking + answer stream */
  beginAgentTurn({ time = null } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "bubble agent agent-turn streaming";
    const stamp = formatSimStamp(time);
    const timeHtml = stamp ? `<div class="bubble-time">${escapeHtml(stamp)}</div>` : "";
    wrap.innerHTML = `
      ${timeHtml}
      <div class="bubble-name">Agent</div>
      <div class="think-block open thinking" data-think>
        <button type="button" class="think-toggle" aria-expanded="true">
          <span class="think-chevron">▾</span>
          <span class="think-label">Thinking</span>
        </button>
        <div class="think-body"><div class="think-text"></div></div>
      </div>
      <div class="tool-chip" data-tool hidden></div>
      <div class="bubble-text answer-text"></div>`;
    wrap.querySelector(".think-toggle").addEventListener("click", () => {
      const block = wrap.querySelector("[data-think]");
      const open = block.classList.toggle("open");
      wrap.querySelector(".think-toggle").setAttribute("aria-expanded", open ? "true" : "false");
      wrap.querySelector(".think-chevron").textContent = open ? "▾" : "▸";
    });
    wrap._startedAt = Date.now();
    this.els.chatMessages.appendChild(wrap);
    this._scrollChatToBottom();
    return wrap;
  }

  updateAgentTurn(wrap, { thinking, content, phase, toolHint } = {}) {
    if (!wrap) return;
    const thinkBlock = wrap.querySelector("[data-think]");
    const thinkText = wrap.querySelector(".think-text");
    const answer = wrap.querySelector(".answer-text");
    const toolChip = wrap.querySelector("[data-tool]");
    const label = wrap.querySelector(".think-label");

    if (thinking != null && thinkText) {
      thinkText.textContent = thinking;
      if (thinking) thinkBlock.hidden = false;
      const body = wrap.querySelector(".think-body");
      // Only pin think-body scroll if the outer chat is still following the stream.
      if (body && thinkBlock?.classList.contains("open") && this._chatStickToBottom) {
        body.scrollTop = body.scrollHeight;
      }
    }

    if (phase === "thinking") {
      thinkBlock?.classList.add("thinking", "open");
      if (label) label.textContent = "Thinking";
      wrap.querySelector(".think-chevron").textContent = "▾";
    } else if (phase === "tool") {
      thinkBlock?.classList.add("thinking", "open");
      if (label) label.textContent = "Thinking";
      if (toolChip) {
        toolChip.hidden = !toolHint;
        toolChip.textContent = toolHint ? `Using ${toolHint}…` : "";
      }
    } else if (phase === "answering" || phase === "done") {
      if (toolChip) toolChip.hidden = true;
      thinkBlock?.classList.remove("thinking");
      if (label && thinking) {
        const secs = Math.max(1, Math.round((Date.now() - (wrap._startedAt || Date.now())) / 1000));
        label.textContent = `Thought for ${secs}s`;
      }
      // Auto-collapse thinking when answer starts (Claude-like)
      if (phase === "answering" && thinking && !wrap._collapsedOnce) {
        thinkBlock?.classList.remove("open");
        wrap.querySelector(".think-toggle")?.setAttribute("aria-expanded", "false");
        const chev = wrap.querySelector(".think-chevron");
        if (chev) chev.textContent = "▸";
        wrap._collapsedOnce = true;
      }
    }

    if (content != null && answer) setMarkdown(answer, content);
    if (!thinking && thinkBlock && phase !== "thinking") {
      // no thinking payload — hide empty block
      if (!thinkText?.textContent) thinkBlock.hidden = true;
    }

    this._scrollChatToBottom();
  }

  finishAgentTurn(wrap, { thinking, content, error } = {}) {
    if (!wrap) return;
    wrap.classList.remove("streaming");
    const thinkBlock = wrap.querySelector("[data-think]");
    thinkBlock?.classList.remove("thinking");
    const toolChip = wrap.querySelector("[data-tool]");
    if (toolChip) toolChip.hidden = true;

    if (error) {
      const answer = wrap.querySelector(".answer-text");
      if (answer) answer.textContent = "⚠️ " + error;
      if (thinkBlock) thinkBlock.hidden = true;
      return;
    }

    this.updateAgentTurn(wrap, {
      thinking: thinking || "",
      content: content || "（空回复）",
      phase: "done",
    });

    if (!thinking) {
      if (thinkBlock) thinkBlock.hidden = true;
    } else {
      // keep collapsed summary visible
      thinkBlock.hidden = false;
      thinkBlock.classList.remove("open");
      wrap.querySelector(".think-toggle")?.setAttribute("aria-expanded", "false");
      const chev = wrap.querySelector(".think-chevron");
      if (chev) chev.textContent = "▸";
      const secs = Math.max(1, Math.round((Date.now() - (wrap._startedAt || Date.now())) / 1000));
      const label = wrap.querySelector(".think-label");
      if (label) label.textContent = `Thought for ${secs}s`;
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

  setQuickChips(items) {
    this.els.quickChips.innerHTML = items
      .map((t) => `<button type="button" class="chip" data-chip="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
      .join("");
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

/** Build toastable alerts from ledger snapshot (stable keys for dedupe). */
function collectLedgerAlerts(ledger) {
  const out = [];
  if (!ledger) return out;
  for (const f of ledger.flights || []) {
    const text = f.status === "delayed" ? `${f.flight_no} 延误` : `已订 ${f.flight_no}`;
    out.push({
      key: `flight:${f.id}:${f.status}:${f.delay_min || 0}`,
      tab: "trip",
      app: "账本",
      from: "行程账本",
      icon: "✈️",
      text,
      title: text,
      body: [f.flight_no, f.route || f.legs, f.status, f.note].filter(Boolean).join(" · "),
      kind: "ledger",
    });
  }
  for (const h of ledger.hotels || []) {
    const text =
      h.status === "cancelled"
        ? `${shortHotel(h.name)} 已取消`
        : h.note?.includes("换订") || h.note?.includes("可退")
          ? `${shortHotel(h.name)} 已确认`
          : `酒店 ${shortHotel(h.name)}`;
    out.push({
      key: `hotel:${h.id}:${h.status}:${h.price_nzd ?? ""}`,
      tab: "trip",
      app: "账本",
      from: "行程账本",
      icon: "🏨",
      text,
      title: text,
      body: [h.name, h.date || h.check_in, h.status, h.note].filter(Boolean).join(" · "),
      kind: "ledger",
    });
  }
  const notion = ledger.notion?.sections || {};
  for (const [sec, label] of [
    ["journal", "游记有更新"],
    ["expense", "费用记录有更新"],
    ["safety", "安全备注有更新"],
  ]) {
    const text = String(notion[sec] || "").trim();
    if (!text) continue;
    out.push({
      key: `notion:${sec}:${text.slice(0, 40)}`,
      tab: "notes",
      app: "Notion",
      from: "Notion",
      icon: "📝",
      text: label,
      title: label,
      body: text,
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

/** Map env playback events → phone toast copy (archived to 邮件). */
function envEventToast(ev) {
  const kind = ev.kind || "";
  const body = String(ev.body || "").replace(/\s+/g, " ").trim();
  const snippet = body.length > 42 ? body.slice(0, 40) + "…" : body;
  const src = String(ev.channel || ev.source || "");
  const isMail = /email/i.test(src);

  if (kind === "app_notification") {
    return {
      icon: isMail ? "✉️" : "🔔",
      app: isMail ? "邮件" : channelAppLabel(src) || "通知",
      from: isMail ? "收件箱" : channelAppLabel(src) || "通知",
      tab: "mail",
      text: snippet || (isMail ? "收到一封新邮件" : "收到一条 APP / 短信通知"),
    };
  }
  if (kind === "world") {
    return {
      icon: isMail ? "✉️" : "🌐",
      app: isMail ? "邮件" : channelAppLabel(src) || "资讯",
      from: isMail ? "收件箱" : channelAppLabel(src) || "资讯",
      tab: "mail",
      text: snippet || "收到一条外部信息",
    };
  }
  if (kind === "notification") {
    return {
      icon: "🫀",
      app: "心跳",
      from: "系统",
      tab: "mail",
      text: snippet || "系统心跳检查",
    };
  }
  if (kind === "weather") {
    const impact = ev.user_state?.weather_impact;
    return {
      icon: impact === "disruptive" ? "🌧️" : "🌦️",
      app: "天气",
      from: "天气",
      tab: "mail",
      text: ev.user_state?.weather || snippet || "天气状态更新",
    };
  }
  if (kind === "routine") {
    const action = ev.user_state?.demo_action || "";
    return {
      icon: "🚗",
      app: "行程",
      from: "行程",
      tab: "mail",
      text: action ? `日常节点 · ${action}` : snippet || "行程日常节点",
    };
  }
  if (kind === "mutation") {
    // Silent by design — chat stream only, no phone toast
    return null;
  }
  return null;
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
    wrapMarkdownTables(el);
    scrubBrokenTableRows(el);
  } catch {
    el.textContent = src;
  }
}

/**
 * Fix common LLM table mistakes for GFM:
 * - blank line before table
 * - insert ONE header separator if missing (not between every data row)
 * - drop repeated separator-only lines the model sometimes emits between rows
 */
function normalizeAgentMarkdown(src) {
  let s = src.replace(/\r\n/g, "\n");
  s = s.replace(/([^\n|])\n(\|[^\n]+\|)\n/g, "$1\n\n$2\n");
  const lines = s.split("\n");
  const out = [];
  let inTable = false;
  let sawSeparator = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = out.length ? out[out.length - 1] : null;
    const next = lines[i + 1];
    const isRow = isPipeRow(line);
    const isSep = isPipeSeparator(line);

    if (!isRow) {
      inTable = false;
      sawSeparator = false;
      out.push(line);
      continue;
    }

    // Start of a new table block
    if (!inTable) {
      inTable = true;
      sawSeparator = false;
      out.push(line);
      // Header row without separator → insert one before next data row
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

    // Inside table: keep at most one separator line; skip extras / dash-only junk rows
    if (isSep) {
      if (sawSeparator) continue; // duplicate |---|---| between body rows
      sawSeparator = true;
      out.push(line);
      continue;
    }

    if (isDashOnlyRow(line)) continue; // model emitted "| --- | --- |" as a "data" row
    out.push(line);
  }
  return out.join("\n");
}

function isDashOnlyRow(line) {
  const cells = String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
  if (cells.length < 2) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "—" || c === "-" || c === "–");
}

function isPipeRow(line) {
  const t = String(line || "").trim();
  if (!t.includes("|")) return false;
  // at least two cells
  return t.split("|").filter((c) => c.trim() !== "").length >= 2;
}

function isPipeSeparator(line) {
  const t = String(line || "").trim();
  if (!t.includes("|")) return false;
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(t);
}

function countPipeCols(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|").length;
}

function softBreakParagraphs(html) {
  // Inside <p>…</p>, turn single newlines into <br> (tables untouched)
  return String(html).replace(/<p>([\s\S]*?)<\/p>/g, (_, inner) => {
    if (inner.includes("<table") || inner.includes("<li") || inner.includes("<pre")) {
      return `<p>${inner}</p>`;
    }
    return `<p>${inner.replace(/\n/g, "<br>\n")}</p>`;
  });
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
      return !t || /^:?-{2,}:?$/.test(t) || t === "—" || t === "-" || t === "–";
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
  const apps = (ev.apply || []).map((a) => `${a.server}.${a.table || a.tool_call?.name || "mut"}`).join(", ");
  return apps ? `后台变更：${apps}（需主动查工具才可见）` : "静默后台变更";
}
