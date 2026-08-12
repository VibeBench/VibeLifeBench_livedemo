/**
 * Wedding playground — single surface: Team IM / Inbox / Menu / Ledger / Contracts / Calendar / Runbook.
 * Aligns with ecom Team Inbox pattern (one big window, multi-contact).
 */

import { L, getLocale } from "../i18n.js?v=20260812-user-avatar";
import { sleepPlayback } from "../playback.js?v=20260812-user-avatar";

export const WORKSPACE_IDS = [
  "im",
  "mail",
  "sms",
  "menu",
  "invites",
  "files",
  "web",
  "ledger",
  "contracts",
  "calendar",
  "runbook",
  "booking",
];

const WORKSPACE_LABEL = {
  im: { zh: "协作消息", en: "Team IM" },
  mail: { zh: "邮件", en: "Mail" },
  sms: { zh: "短信", en: "SMS" },
  inbox: { zh: "邮件", en: "Mail" }, // legacy alias
  menu: { zh: "菜单忌口", en: "Menu" },
  invites: { zh: "请柬印刷", en: "Invitations" },
  files: { zh: "本地文件", en: "Local files" },
  web: { zh: "网页核验", en: "Web check" },
  ledger: { zh: "预算账本", en: "Budget ledger" },
  contracts: { zh: "合同比对", en: "Contracts" },
  calendar: { zh: "关键日程", en: "Calendar" },
  runbook: { zh: "当日 Runbook", en: "Day runbook" },
  booking: { zh: "预订状态", en: "Bookings" },
};

function normalizeWorkspaceId(id = "im") {
  if (id === "inbox" || id === "email") return "mail";
  if (id === "messages" || id === "message") return "sms";
  return WORKSPACE_IDS.includes(id) ? id : "im";
}

const MAIN_THREADS = new Set(["lin_qiao", "zhou_yu", "boss", "user"]);

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(getLocale() === "en" ? "en-US" : "zh-CN");
}

function pickStored(obj, key) {
  if (!obj) return "";
  if (typeof obj === "string") return localizeMaybe(obj);
  const zh = obj[`${key}_zh`] ?? obj[key];
  const en = obj[`${key}_en`] ?? obj[key];
  if (zh && typeof zh === "object") return pickStored(zh, "text") || pickStored(zh, "label");
  return getLocale() === "en" ? localizeMaybe(en || zh || "") : localizeMaybe(zh || en || "");
}

function localizeMaybe(value) {
  const s = String(value ?? "");
  if (!s) return "";
  if (getLocale() !== "en" || !/[\u4e00-\u9fff]/.test(s)) return s;
  const map = {
    已锁定: "Locked",
    保留中: "Held",
    待核验: "Verifying",
    "群文件 v1": "Group file v1",
    群文件: "Group file",
    邮件新附件: "New email attachment",
    邮件附件: "Email attachment",
    已签基准: "Signed baseline",
    尚未接受: "Not accepted",
    "官网：陈伟": "Site: Chen Wei",
    "执行：李浩 · 未核验": "Assigned: Li Hao · unverified",
    "匿名桌 12": "Anonymous table 12",
    匿名桌次: "Anon table",
    页面已锁: "UI locked",
    后台释放: "backend released",
  };
  if (map[s]) return map[s];
  let out = s;
  for (const [zh, en] of Object.entries(map)) out = out.split(zh).join(en);
  return out;
}

function pickLocaleText(obj, key = "text") {
  if (!obj) return "";
  const zh = obj[`${key}_zh`] ?? obj[key];
  const en = obj[`${key}_en`] ?? obj[key];
  return String(getLocale() === "en" ? en || zh || "" : zh || en || "");
}

/** Mask elder / private contact fields for vendor-facing views. */
export function maskContact(value = "", { showCount = false, count = 0 } = {}) {
  if (showCount || count > 0) {
    return L(`${count} 位 · 已脱敏`, `${count} contacts · redacted`);
  }
  const s = String(value || "");
  if (!s) return L("已脱敏", "Redacted");
  if (s.length <= 2) return "••";
  return `${s.slice(0, 1)}${"•".repeat(Math.min(6, s.length - 1))}`;
}

export function parseWeddingStageTracks(meta = {}, stageId = "") {
  const stage = (meta.stages || []).find((row) => row.id === stageId);
  const spec = String(stage?.track || "");
  if (spec === "ALL") return new Set(["A", "B", "C", "D", "E"]);
  return new Set(spec.match(/[A-E]/g) || []);
}

export class WeddingWorkspaces {
  /** Latest live cockpit owns tab clicks (avoids multi-instance listener pile-up). */
  static activeOwner = null;

  constructor({
    stageEl,
    tabsEl,
    titleEl,
    statusEl,
    getState = () => ({}),
  } = {}) {
    this.stageEl = stageEl;
    this.tabsEl = tabsEl;
    this.titleEl = titleEl;
    this.statusEl = statusEl;
    this.getState = getState;
    this.active = "im";
    this.replayPinned = false;
    this.seed = null;
    this.commThreads = [];
    this.commFeed = [];
    this.commSeenAt = {};
    this.activeCommThread = null;
    this._typingThread = null;
    this._freshCommId = null;
    this.inboxFeed = [];
    this.activeMailId = null;
    this.activeSmsThread = null;
    this._arrivingMailId = null;
    this._readingMailId = null;
    this._mailReadQueue = Promise.resolve();
    this.menuState = null;
    this.inviteState = null;
    this.runbookState = null;
    this.filesState = [];
    this.webState = null;
    this._vendorMessages = {};
    WeddingWorkspaces.activeOwner = this;
    WeddingWorkspaces._ensureTabDelegate();
  }

  static _ensureTabDelegate() {
    if (WeddingWorkspaces._delegated) return;
    WeddingWorkspaces._delegated = true;
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.("#weddingWorkspaceTabs [data-wedding-workspace]");
        if (!btn) return;
        const id = btn.dataset.weddingWorkspace;
        const owner = WeddingWorkspaces.activeOwner;
        if (owner && id) owner.switchWorkspace(id, { user: true });
      },
      true
    );
  }

  reset(seed = null) {
    WeddingWorkspaces.activeOwner = this;
    this.seed = seed || this.seed;
    this.active = "im";
    this._vendorMessages = {};
    this.commFeed = [];
    this.commSeenAt = {};
    this._typingThread = null;
    this._freshCommId = null;
    this.inboxFeed = [];
    this.activeMailId = null;
    this.activeSmsThread = null;
    this._arrivingMailId = null;
    this._readingMailId = null;
    this._mailReadQueue = Promise.resolve();
    this.menuState = null;
    this.inviteState = null;
    this.runbookState = null;
    this.filesState = (this.seed?.files || []).map((f) => ({ ...f }));
    this.webState = null;
    // IM is people chat only — app surfaces (ledger / invites) stay out of the contact list.
    this.commThreads = (this.seed?.threads || []).filter(
      (t) => !MAIN_THREADS.has(t.id) && (t.channel || "im") === "im"
    );
    this.activeCommThread = this.commThreads[0]?.id || null;
    if (this.activeCommThread) this.commSeenAt[this.activeCommThread] = Date.now();
    this._syncTabs();
    this.render();
  }

  /** Map seed thread → playground bench when it is not a people IM. */
  benchForThread(threadId) {
    const meta = (this.seed?.threads || []).find((t) => t.id === threadId);
    if (!meta) return null;
    if ((meta.channel || "im") === "app") return meta.bench || "ledger";
    return "im";
  }

  switchWorkspace(id = "im", { user = false } = {}) {
    const next = normalizeWorkspaceId(id);
    if (this.replayPinned && user && next !== this.active) {
      /* allow manual peek during replay */
    }
    const changed = next !== this.active;
    this.active = next;
    this._syncTabs();
    this.render({ softSwitch: changed });
  }

  _els() {
    // Re-query: scenario mounts / i18n can replace head nodes after construct.
    this.stageEl = document.querySelector("#weddingWorkspaceStage") || this.stageEl;
    this.tabsEl = document.querySelector("#weddingWorkspaceTabs") || this.tabsEl;
    this.titleEl = document.querySelector("#weddingWorkspaceTitle") || this.titleEl;
    this.statusEl = document.querySelector("#weddingWorkspaceStatus") || this.statusEl;
    return this;
  }

  render(opts = {}) {
    this._els();
    if (!this.stageEl) return;
    WeddingWorkspaces.activeOwner = this;
    const state = this.getState() || {};
    const renderers = {
      im: () => this._renderCommunication(),
      mail: () => this._renderMailWorkspace(),
      sms: () => this._renderSmsWorkspace(),
      inbox: () => this._renderMailWorkspace(),
      menu: () => this._renderMenu(state),
      invites: () => this._renderInvites(state),
      files: () => this._renderFiles(state),
      web: () => this._renderWeb(state),
      ledger: () => this._renderLedger(state),
      contracts: () => this._renderContracts(state),
      calendar: () => this._renderCalendar(state),
      runbook: () => this._renderRunbook(state),
      booking: () => this._renderBooking(state),
    };
    const html = (renderers[this.active] || (() => this._renderEmpty()))();

    const stage = this.stageEl;
    if (opts.softSwitch) {
      stage.classList.remove("is-switching");
      // force restart
      void stage.offsetWidth;
      stage.classList.add("is-switching");
      window.clearTimeout(this._switchAnimTimer);
      this._switchAnimTimer = window.setTimeout(() => stage.classList.remove("is-switching"), 360);
    }

    this.stageEl.innerHTML = `<div class="wedding-workspace-panel">${html}</div>`;
    // Re-assert tab label after body render (guards against stale multi-instance writes).
    this._syncTabs();
    if (this.active === "im") {
      const thread =
        this.commThreads.find((t) => t.id === this.activeCommThread) || this.commThreads[0];
      const localeKey = getLocale() === "en" ? "name_en" : "name_zh";
      const threadName = thread?.[localeKey] || thread?.name_zh || thread?.name_en || L("协作消息", "Messages");
      this.setTitle(L(`协作消息 · ${threadName}`, `Messages · ${threadName}`));
      this._bindCommsActions();
    }
    if (this.active === "mail" || this.active === "inbox") this._bindMailActions();
    if (this.active === "sms") this._bindSmsActions();
  }

  setReplayPinned(active = false) {
    this.replayPinned = Boolean(active);
    this._syncTabs();
  }

  _syncTabs() {
    this._els();
    this.tabsEl?.querySelectorAll("[data-wedding-workspace]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.weddingWorkspace === this.active);
    });
    const en = getLocale() === "en";
    const label = WORKSPACE_LABEL[this.active] || { zh: "—", en: "—" };
    if (this.titleEl) this.titleEl.textContent = en ? label.en : label.zh;
  }

  setStatus(text = "") {
    this._els();
    const el = this.statusEl;
    if (!el) return;
    const next = String(text || "");
    if (el.dataset.sig !== next) {
      el.dataset.sig = next;
      el.hidden = !next;
      el.textContent = next;
      el.title = next;
    }
  }

  pushVendorMessage(threadId, row = {}) {
    if (!threadId) return;
    if (!this._vendorMessages[threadId]) this._vendorMessages[threadId] = [];
    this._vendorMessages[threadId].push(row);
    if (this.active === "booking") this.render();
  }

  focusCommunication(threadId, { reveal = true } = {}) {
    if (!threadId || MAIN_THREADS.has(threadId)) return;
    const bench = this.benchForThread(threadId);
    if (bench && bench !== "im") {
      if (reveal) this.switchWorkspace(bench);
      return;
    }
    this.activeCommThread = threadId;
    this.commSeenAt[threadId] = Date.now();
    if (reveal) this.switchWorkspace("im");
    else if (this.active === "im") this.render();
  }

  pushCommunication(row, { reveal = true } = {}) {
    if (!row?.thread || MAIN_THREADS.has(row.thread)) return;
    const bench = this.benchForThread(row.thread);
    if (bench && bench !== "im") {
      if (row.thread === "invite_zhijian" || bench === "invites") {
        this.setInviteState({
          note_zh: row.text_zh || row.text || "",
          note_en: row.text_en || row.text || "",
          reveal,
        });
      } else if (reveal) {
        this.switchWorkspace(bench);
      }
      return;
    }
    this._typingThread = null;
    const idx = this.commFeed.findIndex((m) => m.id === row.id);
    if (idx >= 0) this.commFeed[idx] = row;
    else this.commFeed.push(row);
    this._freshCommId = row.id;
    if (reveal) {
      this.activeCommThread = row.thread;
      this.commSeenAt[row.thread] = Math.max(this.commSeenAt[row.thread] || 0, row.ts || Date.now());
      this.switchWorkspace("im");
      return;
    }
    if (this.active === "im") this.render();
    this._updateCommsBadge();
  }

  showCommsTyping(threadId) {
    if (!threadId || MAIN_THREADS.has(threadId)) return;
    this._typingThread = threadId;
    this.activeCommThread = threadId;
    if (this.active !== "im") this.switchWorkspace("im");
    else this.render();
    this.setStatus(L("Agent 正在输入…", "Agent is typing…"));
  }

  hideCommsTyping() {
    if (!this._typingThread) return;
    this._typingThread = null;
    if (this.active === "im") this.render();
  }

  pushInboxItem(item = {}) {
    const kind = item.kind || "email";
    const row = {
      id: item.id || `inbox_${this.inboxFeed.length}_${Date.now()}`,
      kind,
      from_zh: item.from_zh || item.from || "",
      from_en: item.from_en || item.from || "",
      subject_zh: item.subject_zh || item.subject || item.text_zh || "",
      subject_en: item.subject_en || item.subject || item.text_en || "",
      body_zh: item.body_zh || item.text_zh || "",
      body_en: item.body_en || item.text_en || "",
      level: item.level || "info",
      ts: item.ts || Date.now(),
      unread: item.unread !== false,
      phone: item.phone || "",
    };
    this.inboxFeed.unshift(row);
    const targetWs = kind === "sms" ? "sms" : "mail";
    if (kind === "sms") {
      this.activeSmsThread = pickLocaleText(row, "from") || row.id;
    } else if (!item.deferOpen) {
      this.activeMailId = row.id;
    }
    if (item.reveal !== false) this.switchWorkspace(targetWs);
    else if (this.active === targetWs) this.render();
    this._updateInboxBadge();
    return row;
  }

  /**
   * Deliver one inbox item and, for mail, read it in the app before continuing.
   * Multiple calls queue so emails open one-by-one in the current round.
   */
  async deliverInboxItem(item = {}) {
    const kind = item.kind || "email";
    const isMail = kind === "email" || kind === "mail";
    if (!isMail) {
      return this.pushInboxItem(item);
    }
    const run = async () => {
      const row = this.pushInboxItem({
        ...item,
        kind: "email",
        reveal: false,
        deferOpen: true,
        unread: true,
      });
      await this.presentMailItem(row.id, {
        holdMs: item.holdMs || item.readMs || 0,
        reveal: item.reveal !== false,
      });
      return row;
    };
    const next = this._mailReadQueue.then(run, run);
    this._mailReadQueue = next.catch(() => {});
    return next;
  }

  async presentMailItem(id, { holdMs = 0, reveal = true } = {}) {
    const row = this.inboxFeed.find((m) => m.id === id);
    if (!row || row.kind === "sms") return;
    this._arrivingMailId = id;
    this.activeMailId = null;
    this._readingMailId = null;
    if (reveal) this.switchWorkspace("mail");
    else if (this.active === "mail") this.render();
    else this.render();
    this.setStatus(L("新邮件到达…", "New mail arrived…"));
    await sleepPlayback(380, { min: 220, max: 560 });

    this._arrivingMailId = null;
    this.activeMailId = id;
    this._readingMailId = id;
    if (this.active === "mail") this.render();
    else if (reveal) this.switchWorkspace("mail");
    else this.render();

    const subject = pickLocaleText(row, "subject") || L("邮件", "Mail");
    const body = pickLocaleText(row, "body") || "";
    this.setStatus(L(`正在阅读：${subject}`, `Reading: ${subject}`));
    const byLen = Math.min(2400, 700 + String(body || subject).length * 16);
    const readMs = Math.max(Number(holdMs) || 0, byLen);
    await sleepPlayback(readMs, { min: 560, max: 2600 });

    row.unread = false;
    this._readingMailId = null;
    if (this.active === "mail") this.render();
    this._updateInboxBadge();
    this.setStatus(L("邮件已读", "Mail read"));
  }

  setMenuState(state = {}) {
    this.menuState = { ...(this.menuState || {}), ...state };
    if (state.reveal !== false) this.switchWorkspace("menu");
    else if (this.active === "menu") this.render();
  }

  setInviteState(state = {}) {
    this.inviteState = { ...(this.inviteState || {}), ...state };
    if (state.reveal !== false) this.switchWorkspace("invites");
    else if (this.active === "invites") this.render();
  }

  setFilesState(files = [], { reveal = true, highlight = null } = {}) {
    if (Array.isArray(files) && files.length) {
      const byId = new Map(this.filesState.map((f) => [f.id, f]));
      for (const f of files) byId.set(f.id || `f_${byId.size}`, { ...byId.get(f.id), ...f });
      this.filesState = Array.from(byId.values());
    }
    this._filesHighlight = highlight;
    if (reveal) this.switchWorkspace("files");
    else if (this.active === "files") this.render();
  }

  setWebState(state = {}) {
    this.webState = { ...(this.webState || {}), ...state };
    if (state.reveal !== false) this.switchWorkspace("web");
    else if (this.active === "web") this.render();
  }

  setRunbookState(state = {}) {
    this.runbookState = { ...(this.runbookState || {}), ...state };
    if (state.reveal !== false) this.switchWorkspace("runbook");
    else if (this.active === "runbook") this.render();
  }

  _updateCommsBadge() {
    const btn = this.tabsEl?.querySelector('[data-wedding-workspace="im"]');
    if (!btn) return;
    const unread = this.commThreads.reduce((n, t) => {
      const seenAt = this.commSeenAt[t.id] || 0;
      return (
        n +
        this.commFeed.filter((m) => m.thread === t.id && m.from !== "agent" && (m.ts || 0) > seenAt).length
      );
    }, 0);
    btn.dataset.badge = unread ? String(Math.min(unread, 9)) : "";
    btn.classList.toggle("has-badge", unread > 0);
  }

  _updateInboxBadge() {
    const mailBtn = this.tabsEl?.querySelector('[data-wedding-workspace="mail"]');
    const smsBtn = this.tabsEl?.querySelector('[data-wedding-workspace="sms"]');
    const mailUnread = this._mailItems().filter((m) => m.unread).length;
    const smsUnread = this._smsItems().filter((m) => m.unread).length;
    if (mailBtn) {
      mailBtn.dataset.badge = mailUnread ? String(Math.min(mailUnread, 9)) : "";
      mailBtn.classList.toggle("has-badge", mailUnread > 0);
    }
    if (smsBtn) {
      smsBtn.dataset.badge = smsUnread ? String(Math.min(smsUnread, 9)) : "";
      smsBtn.classList.toggle("has-badge", smsUnread > 0);
    }
  }

  _inboxAvatar(name = "", kind = "email") {
    const s = String(name || "?").trim();
    const ch = /[\u4e00-\u9fff]/.test(s) ? s.slice(0, 1) : (s[0] || "?").toUpperCase();
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const pal =
      kind === "sms"
        ? ["#34c759", "#30b0c7", "#5856d6", "#ff9500", "#af52de", "#007aff"]
        : ["#0a84ff", "#5e5ce6", "#ff375f", "#ff9f0a", "#30d158", "#64d2ff"];
    return { initial: ch, color: pal[h % pal.length] };
  }

  _inboxStamp(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString(getLocale() === "en" ? "en-US" : "zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
    return d.toLocaleDateString(getLocale() === "en" ? "en-US" : "zh-CN", {
      month: "numeric",
      day: "numeric",
    });
  }

  _mailItems() {
    return this.inboxFeed.filter((m) => m.kind !== "sms");
  }

  _smsItems() {
    return this.inboxFeed.filter((m) => m.kind === "sms");
  }

  _smsThreads() {
    const map = new Map();
    for (const m of this._smsItems()) {
      const key = pickLocaleText(m, "from") || m.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    }
    return [...map.entries()].map(([key, msgs]) => {
      const sorted = [...msgs].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const last = sorted[sorted.length - 1];
      return {
        key,
        from: key,
        phone: last?.phone || (getLocale() === "en" ? "+86 138 **** 6620" : "138****6620"),
        msgs: sorted,
        unread: sorted.some((x) => x.unread),
        last,
      };
    });
  }

  _renderEmpty() {
    return `<div class="wedding-workspace-empty">${esc(L("—", "—"))}</div>`;
  }

  _commIntent(thread) {
    const id = thread?.id || "";
    const tab = thread?.tab || "";
    if (/venue|yunting/.test(id) || tab === "venue") {
      return L("意图：核对场地报价、桌数与定金条款", "Why: verify venue quote, tables, deposit terms");
    }
    if (/photo|beian/.test(id) || tab === "photo") {
      return L("意图：核验国庆档期 hold 与主摄身份", "Why: verify holiday hold and lead identity");
    }
    if (/dress|baizhi/.test(id) || tab === "dress") {
      return L("意图：对齐工期与试穿窗口", "Why: align lead time and fittings");
    }
    if (/invite|zhijian|guest/.test(id) || tab === "guest") {
      return L("意图：请柬、回执与名单去重", "Why: invites, RSVP and household dedupe");
    }
    if (/mc_|kitchen|parent|family/.test(id)) {
      return L("意图：多人协调口味、忌口与流程", "Why: coordinate tastes, diets and run-of-show");
    }
    if (/scam|yitiaolong/.test(id)) {
      return L("意图：识别催款骗局并拦截付款", "Why: spot payment lures and block them");
    }
    if (/finance|ledger/.test(id) || tab === "ledger") {
      return L("意图：并账、预备金与授权门禁", "Why: merge ledger, reserve and auth gates");
    }
    return L("意图：推进外部协作，不打断新人主对话", "Why: advance vendor collab without interrupting the couple");
  }

  _renderCommunication() {
    const localeKey = getLocale() === "en" ? "name_en" : "name_zh";
    const thread =
      this.commThreads.find((t) => t.id === this.activeCommThread) || this.commThreads[0] || null;
    if (thread && !this.activeCommThread) this.activeCommThread = thread.id;
    const messages = this.commFeed.filter((m) => m.thread === thread?.id);
    const intent = this._commIntent(thread);
    const contacts = this.commThreads
      .map((t) => {
        const name = t[localeKey] || t.name_zh || t.name_en || t.id;
        const last = [...this.commFeed].reverse().find((m) => m.thread === t.id);
        const seenAt = this.commSeenAt[t.id] || 0;
        const unread =
          t.id === thread?.id
            ? 0
            : this.commFeed.filter(
                (m) => m.thread === t.id && m.from !== "agent" && (m.ts || 0) > seenAt
              ).length;
        const clock = last
          ? new Intl.DateTimeFormat(getLocale() === "en" ? "en" : "zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }).format(new Date(last.ts))
          : "";
        const avatarClass = t.avatar_kind === "group" ? "wedding-comms-avatar is-group" : "wedding-comms-avatar";
        const avatar = t.avatar_img
          ? `<img class="${avatarClass}" src="./${esc(String(t.avatar_img).replace(/^\.\//, ""))}" alt="" width="40" height="40" />`
          : `<span class="avatar-letter">${esc(t.avatar || name.slice(0, 1))}</span>`;
        return `<button type="button" class="ecom-comms-contact wedding-comms-contact ${
          t.id === thread?.id ? "is-active" : ""
        } ${unread ? "is-unread" : ""}" data-comm-thread="${esc(t.id)}">
          ${avatar}
          <span class="ecom-contact-copy">
            <span class="ecom-contact-row"><strong>${esc(name)}</strong><time>${esc(clock)}</time></span>
            <span class="ecom-contact-preview"><small>${esc(
              (last ? pickLocaleText(last, "text") : "") || L("等待消息", "No messages yet")
            )}</small>${unread ? `<b>${Math.min(unread, 9)}</b>` : ""}</span>
          </span>
        </button>`;
      })
      .join("");
    const threadName = thread?.[localeKey] || thread?.name_zh || thread?.name_en || L("协作消息", "Messages");
    const freshId = this._freshCommId;
    const typingHere = this._typingThread && this._typingThread === thread?.id;
    const bubbles = messages.length
      ? messages
          .map((m) => {
            const mine = m.from === "agent";
            const isNew = m.id === freshId;
            const text = pickLocaleText(m, "text");
            const peer = mine
              ? "AI Agent"
              : this.commThreads.find((t) => t.id === m.from)?.[localeKey] || threadName;
            return `<div class="ecom-app-msg ${mine ? "is-mine" : "is-peer"} ${isNew ? "is-new" : ""} ${
              /scam|yitiaolong/.test(m.thread || "") ? "is-scam" : ""
            }">
              <span class="ecom-app-msg-who">${esc(peer)}</span>
              ${m.html ? m.html : `<div class="ecom-app-bubble">${esc(text)}</div>`}
            </div>`;
          })
          .join("")
      : typingHere
        ? ""
        : `<div class="ecom-app-empty"><span class="ecom-empty-illustration">•••</span><strong>${esc(
            L("暂无消息", "No messages")
          )}</strong><small>${esc(
            L("多源报价与协调会显示在这里", "Multi-source quotes and coordination appear here")
          )}</small></div>`;
    const typingHtml = typingHere
      ? `<div class="ecom-app-msg is-mine is-typing" aria-live="polite">
          <span class="ecom-app-msg-who">AI Agent</span>
          <div class="ecom-app-bubble is-typing"><i></i><i></i><i></i></div>
        </div>`
      : "";
    this.setTitle(L(`协作消息 · ${threadName}`, `Messages · ${threadName}`));
    if (!typingHere) {
      this.setStatus(L(`Agent 代办 · ${threadName}`, `Agent handling · ${threadName}`));
    }
    this._updateCommsBadge();
    return `<div class="ecom-comms-app wedding-comms-app">
      <aside class="ecom-comms-contacts">
        <div class="ecom-comms-brand"><strong>${esc(L("协作 IM", "Team inbox"))}</strong><span>⌕　＋</span></div>
        ${contacts || `<p class="wedding-comms-empty">${esc(L("暂无联系人", "No contacts"))}</p>`}
      </aside>
      <section class="ecom-comms-thread">
        <header><span class="ecom-online-dot"></span><strong>${esc(threadName)}</strong><small>${esc(
          L("应用内沟通", "In-app conversation")
        )}</small></header>
        <p class="ecom-comms-intent ${typingHere ? "is-live" : ""}"><span>${esc(
          L("意图", "Why")
        )}</span><em>${esc(intent.replace(/^意图：|^Why:\s*/i, ""))}</em></p>
        <div class="ecom-app-messages">${bubbles}${typingHtml}</div>
        <div class="ecom-app-composer ${typingHere ? "is-agent" : ""}"><span>${esc(
          typingHere
            ? L("Agent 正在输入…", "Agent is typing…")
            : L("由 Agent 自动沟通 · 你可继续主对话", "Agent handles chat · you stay on main")
        )}</span><button type="button">➤</button></div>
      </section>
    </div>`;
  }

  _bindCommsActions() {
    const root = this.stageEl;
    root?.querySelectorAll("[data-comm-thread]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeCommThread = btn.dataset.commThread;
        this.commSeenAt[this.activeCommThread] = Date.now();
        this.render();
        this._updateCommsBadge();
      });
    });
    const msgBox = root?.querySelector(".ecom-app-messages");
    if (msgBox) {
      const max = Math.max(0, msgBox.scrollHeight - msgBox.clientHeight);
      const start = msgBox.scrollTop;
      const gap = max - start;
      if (Math.abs(gap) < 4) {
        msgBox.scrollTop = max;
      } else {
        let from = start;
        if (Math.abs(gap) > 200) {
          from = max - Math.sign(gap) * 140;
          msgBox.scrollTop = from;
        }
        const origin = msgBox.scrollTop;
        const delta = max - origin;
        const dur = Math.min(320, 150 + Math.abs(delta) * 0.35);
        const t0 = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - t0) / dur);
          const e = 1 - (1 - p) ** 3;
          msgBox.scrollTop = origin + delta * e;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }
    if (this._freshCommId) {
      const freshId = this._freshCommId;
      window.clearTimeout(this._freshCommTimer);
      this._freshCommTimer = window.setTimeout(() => {
        if (this._freshCommId === freshId) this._freshCommId = null;
        root?.querySelector(".ecom-app-msg.is-new")?.classList.remove("is-new");
      }, 900);
    }
  }

  setTitle(text) {
    this._els();
    if (this.titleEl) this.titleEl.textContent = text;
  }

  _renderMailWorkspace() {
    const mail = this._mailItems();
    this.setTitle(L("邮件", "Mail"));
    this.setStatus(L("收件箱 · 供应商与承办方邮件", "Inbox · vendor & venue mail"));
    this._updateInboxBadge();
    return this._renderMailApp(mail);
  }

  _renderSmsWorkspace() {
    const smsThreads = this._smsThreads();
    this.setTitle(L("短信", "SMS"));
    this.setStatus(L("运营商短信 · 验证码与业务通知", "Carrier SMS · codes & ops notices"));
    this._updateInboxBadge();
    return this._renderSmsApp(smsThreads);
  }

  _renderMailApp(mail = []) {
    if (!this.activeMailId && mail[0]) this.activeMailId = mail[0].id;
    const active = mail.find((m) => m.id === this.activeMailId) || mail[0] || null;
    const list =
      mail
        .map((m) => {
          const from = pickLocaleText(m, "from") || L("系统", "System");
          const subject = pickLocaleText(m, "subject") || L("（无主题）", "(No subject)");
          const body = pickLocaleText(m, "body") || "";
          const preview = body || subject;
          const av = this._inboxAvatar(from, m.kind === "system" ? "email" : "email");
          const isSys = m.kind === "system";
          return `<button type="button" class="w-mail-row ${m.id === active?.id ? "is-active" : ""} ${
            m.unread ? "is-unread" : ""
          } ${m.level === "warn" ? "is-warn" : ""} ${
            m.id === this._arrivingMailId ? "is-arriving" : ""
          } ${m.id === this._readingMailId ? "is-reading" : ""}" data-mail-id="${esc(m.id)}">
            <span class="w-mail-avatar" style="--av:${av.color}">${isSys ? "⚙" : esc(av.initial)}</span>
            <span class="w-mail-main">
              <span class="w-mail-top">
                <strong>${esc(from)}</strong>
                <time>${esc(this._inboxStamp(m.ts))}</time>
              </span>
              <span class="w-mail-subject">${esc(subject)}</span>
              <span class="w-mail-preview">${esc(preview)}</span>
            </span>
            ${m.unread ? `<span class="w-mail-dot" aria-hidden="true"></span>` : ""}
          </button>`;
        })
        .join("") ||
      `<div class="w-app-empty">
        <span class="w-app-empty-ico" aria-hidden="true">📭</span>
        <strong>${esc(L("收件箱为空", "Inbox Zero"))}</strong>
        <small>${esc(L("合同附件、档期变更会先出现在这里", "Annex updates and schedule changes land here first"))}</small>
      </div>`;

    const reader = active
      ? (() => {
          const from = pickLocaleText(active, "from") || L("系统", "System");
          const subject = pickLocaleText(active, "subject") || L("（无主题）", "(No subject)");
          const body = pickLocaleText(active, "body") || subject;
          const av = this._inboxAvatar(from);
          const addr =
            active.kind === "system"
              ? "noreply@wedding.ops"
              : `${from.replace(/\s+/g, ".").toLowerCase()}@mail.example`;
          return `<article class="w-mail-reader ${this._readingMailId === active.id ? "is-reading" : ""}">
            <header class="w-mail-reader-head">
              <div class="w-mail-reading-chip" ${this._readingMailId === active.id ? "" : "hidden"}>${esc(
                L("正在阅读", "Reading")
              )}</div>
              <h3>${esc(subject)}</h3>
              <div class="w-mail-reader-meta">
                <span class="w-mail-avatar lg" style="--av:${av.color}">${esc(av.initial)}</span>
                <div>
                  <strong>${esc(from)}</strong>
                  <small>To: ${esc(L("新人筹备组", "Couple planning"))} &lt;couple@dots.note&gt;</small>
                  <small class="w-mail-addr">&lt;${esc(addr)}&gt;</small>
                </div>
                <time>${esc(this._inboxStamp(active.ts))}</time>
              </div>
              <div class="w-mail-toolbar" aria-hidden="true">
                <span>↩ ${esc(L("回复", "Reply"))}</span>
                <span>↪ ${esc(L("转发", "Forward"))}</span>
                <span>🗑 ${esc(L("归档", "Archive"))}</span>
              </div>
            </header>
            <div class="w-mail-reader-body">${esc(body).replace(/\n/g, "<br>")}</div>
          </article>`;
        })()
      : `<div class="w-mail-reader is-empty"><p>${esc(L("选择一封邮件阅读", "Select a message to read"))}</p></div>`;

    return `<div class="w-mail-app">
      <header class="w-mail-chrome">
        <button type="button" class="w-chrome-ghost" tabindex="-1">${esc(L("信箱", "Boxes"))}</button>
        <strong>${esc(L("收件箱", "Inbox"))}</strong>
        <button type="button" class="w-chrome-ghost" tabindex="-1" aria-label="compose">✎</button>
      </header>
      <div class="w-mail-search" aria-hidden="true"><span>⌕</span>${esc(L("搜索邮件", "Search Mail"))}</div>
      <div class="w-mail-split">
        <div class="w-mail-list">${list}</div>
        ${reader}
      </div>
    </div>`;
  }

  _renderSmsApp(threads = []) {
    if (!this.activeSmsThread && threads[0]) this.activeSmsThread = threads[0].key;
    let active = threads.find((t) => t.key === this.activeSmsThread) || threads[0] || null;
    const list =
      threads
        .map((t) => {
          const lastText = pickLocaleText(t.last, "body") || pickLocaleText(t.last, "subject") || "";
          const av = this._inboxAvatar(t.from, "sms");
          return `<button type="button" class="w-sms-row ${t.key === active?.key ? "is-active" : ""} ${
            t.unread ? "is-unread" : ""
          }" data-sms-thread="${esc(t.key)}">
            <span class="w-sms-avatar" style="--av:${av.color}">${esc(av.initial)}</span>
            <span class="w-sms-main">
              <span class="w-sms-top"><strong>${esc(t.from)}</strong><time>${esc(
                this._inboxStamp(t.last?.ts)
              )}</time></span>
              <span class="w-sms-preview">${esc(lastText)}</span>
            </span>
            ${t.unread ? `<span class="w-sms-badge">${t.msgs.filter((m) => m.unread).length || 1}</span>` : ""}
          </button>`;
        })
        .join("") ||
      `<div class="w-app-empty">
        <span class="w-app-empty-ico" aria-hidden="true">💬</span>
        <strong>${esc(L("暂无短信", "No messages"))}</strong>
        <small>${esc(L("档期释放、验证码与催办会以短信进件", "Hold releases, codes and nudges arrive as SMS"))}</small>
      </div>`;

    const threadPane = active
      ? (() => {
          const av = this._inboxAvatar(active.from, "sms");
          const bubbles = active.msgs
            .map((m) => {
              const text = pickLocaleText(m, "body") || pickLocaleText(m, "subject");
              return `<div class="w-sms-bubble-wrap">
                <div class="w-sms-bubble ${m.level === "warn" ? "is-warn" : ""}">${esc(text).replace(/\n/g, "<br>")}</div>
                <time>${esc(this._inboxStamp(m.ts))}</time>
              </div>`;
            })
            .join("");
          return `<section class="w-sms-thread">
            <header class="w-sms-thread-head">
              <span class="w-sms-avatar lg" style="--av:${av.color}">${esc(av.initial)}</span>
              <div>
                <strong>${esc(active.from)}</strong>
                <small>${esc(active.phone)} · ${esc(L("短信", "SMS"))}</small>
              </div>
              <span class="w-sms-signal" aria-hidden="true">📶</span>
            </header>
            <div class="w-sms-thread-body">
              <p class="w-sms-daychip">${esc(L("短信对话", "Text message"))}</p>
              ${bubbles}
            </div>
            <footer class="w-sms-composer" aria-hidden="true">
              <span>${esc(L("iMessage / 短信", "Text Message"))}</span>
              <button type="button">⬆</button>
            </footer>
          </section>`;
        })()
      : `<section class="w-sms-thread is-empty"><p>${esc(L("选择一个会话", "Select a conversation"))}</p></section>`;

    return `<div class="w-sms-app">
      <header class="w-sms-chrome">
        <button type="button" class="w-chrome-ghost" tabindex="-1">${esc(L("编辑", "Edit"))}</button>
        <strong>${esc(L("信息", "Messages"))}</strong>
        <button type="button" class="w-chrome-ghost" tabindex="-1">✎</button>
      </header>
      <div class="w-sms-search" aria-hidden="true"><span>⌕</span>${esc(L("搜索", "Search"))}</div>
      <div class="w-sms-split">
        <div class="w-sms-list">${list}</div>
        ${threadPane}
      </div>
    </div>`;
  }

  _bindMailActions() {
    const root = this.stageEl;
    if (!root) return;
    root.querySelectorAll("[data-mail-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.mailId;
        this.activeMailId = id;
        const row = this.inboxFeed.find((m) => m.id === id);
        if (row) row.unread = false;
        this.render();
        this._updateInboxBadge();
      });
    });
  }

  _bindSmsActions() {
    const root = this.stageEl;
    if (!root) return;
    root.querySelectorAll("[data-sms-thread]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.smsThread;
        this.activeSmsThread = key;
        this.inboxFeed.forEach((m) => {
          if (m.kind === "sms" && (pickLocaleText(m, "from") || m.id) === key) m.unread = false;
        });
        this.render();
        this._updateInboxBadge();
      });
    });
    const body = root.querySelector(".w-sms-thread-body");
    if (body) body.scrollTop = body.scrollHeight;
  }

  _renderFiles(state = {}) {
    const files = this.filesState.length ? this.filesState : state.files || [];
    const hi = this._filesHighlight;
    this.setTitle(L("本地文件", "Local files"));
    this.setStatus(L("合同 / 报价单 / 口信备忘", "Contracts / quotes / verbal notes"));
    if (!files.length) {
      return `<div class="wedding-files-board"><div class="ecom-app-empty"><strong>${esc(
        L("尚无本地文件", "No local files yet")
      )}</strong></div></div>`;
    }
    return `<div class="wedding-files-board">
      <header class="wedding-panel-head">
        <strong>${esc(L("散落的证据文件", "Scattered evidence files"))}</strong>
        <span>${esc(L(`${files.length} 份`, `${files.length} files`))}</span>
      </header>
      <ul class="wedding-files-list">
        ${files
          .map((f) => {
            const name = pickLocaleText(f, "name") || f.id;
            const source = pickLocaleText(f, "source") || "";
            const note = pickLocaleText(f, "note") || "";
            const kind = f.kind || "file";
            const on = hi && hi === f.id ? "is-hot" : "";
            return `<li class="wedding-file-row ${on}">
              <em>${esc(kind.toUpperCase())}</em>
              <div><strong>${esc(name)}</strong><small>${esc(source)}</small>
              ${note ? `<p>${esc(note)}</p>` : ""}</div>
            </li>`;
          })
          .join("")}
      </ul>
    </div>`;
  }

  _renderWeb(state = {}) {
    const w = this.webState || {};
    const title = pickLocaleText(w, "title") || L("供应商页面", "Vendor page");
    const url = w.url || "https://vendor.example/hold";
    const ui = pickLocaleText(w, "ui") || L("页面显示：已锁定", "UI shows: Locked");
    const backend = pickLocaleText(w, "backend") || L("后台：待核验", "Backend: verifying");
    const mismatch = Boolean(w.mismatch);
    this.setTitle(L("网页核验", "Web check"));
    this.setStatus(mismatch ? L("页面 ≠ 后台", "UI ≠ backend") : L("交叉核验中", "Cross-checking"));
    return `<div class="wedding-web-board">
      <header class="wedding-panel-head">
        <strong>${esc(title)}</strong>
        <span>${esc(url)}</span>
      </header>
      <div class="wedding-web-chrome"><i></i><i></i><i></i><em>${esc(url)}</em></div>
      <div class="wedding-web-body ${mismatch ? "is-mismatch" : ""}">
        <p><span>${esc(L("页面状态", "Page status"))}</span><b>${esc(ui)}</b></p>
        <p><span>${esc(L("后台订单", "Backend order"))}</span><b>${esc(backend)}</b></p>
        ${
          pickLocaleText(w, "note")
            ? `<p class="wedding-web-note">${esc(pickLocaleText(w, "note"))}</p>`
            : ""
        }
      </div>
    </div>`;
  }

  _renderInvites(state = {}) {
    const kpi = state.kpi || {};
    const inv = this.inviteState || {};
    const status = pickLocaleText(inv, "status") || L("校样推进中", "Proof in progress");
    const note = pickLocaleText(inv, "note");
    const households = inv.households ?? kpi.inviteHouseholds ?? "—";
    this.setTitle(L("请柬印刷", "Invitations"));
    this.setStatus(L("印刷产线 · 非 IM 会话", "Print pipeline · not an IM chat"));
    return `<div class="wedding-invites-board">
      <header class="wedding-panel-head">
        <strong>${esc(L("请柬 · 印刷工作台", "Invites · print desk"))}</strong>
        <span>${esc(status)}</span>
      </header>
      <div class="wedding-menu-hero">
        <div><span>${esc(L("户数", "Households"))}</span><b>${esc(String(households))}</b></div>
        <div><span>${esc(L("回执", "RSVP"))}</span><b>${esc(String(kpi.rsvpPct ?? "—"))}%</b></div>
        <div><span>${esc(L("寄出", "Dispatch"))}</span><b>${esc(inv.dispatched ? L("进行中", "Running") : L("待齐名单", "Awaiting list"))}</b></div>
      </div>
      <ul class="wedding-menu-dishes">
        <li>${esc(L("名单去重后按户核算", "Bill by household after dedupe"))}</li>
        <li>${esc(L("校样确认后再开机", "Press starts after proof sign-off"))}</li>
        <li>${esc(L("地址校验失败会拦截漏寄", "Bad addresses are blocked from mailing"))}</li>
      </ul>
      ${note ? `<p class="wedding-invite-note">${esc(note)}</p>` : ""}
    </div>`;
  }

  _renderMenu(state = {}) {
    const kpi = state.kpi || {};
    const m = this.menuState || {};
    const table = pickLocaleText(m, "table") || pickStored(kpi, "dietaryTables") || L("匿名桌次", "Anon table");
    const dishes = m.dishes || [
      { zh: "中式主菜（可分餐）", en: "Chinese mains (individual plating)" },
      { zh: "去刺鱼", en: "Deboned fish" },
      { zh: "过敏餐单独出", en: "Allergy-safe plated separately" },
      { zh: "小食拼盘", en: "Small bites" },
    ];
    const notes = m.notes || [];
    this.setTitle(L("菜单忌口", "Menu & diets"));
    this.setStatus(L("一张菜单要对所有人说得通", "One menu that works for everyone"));
    return `<div class="wedding-menu-board">
      <header class="wedding-panel-head">
        <strong>${esc(L("忌口匿名桌次", "Anonymous dietary table"))}</strong>
        <span>${esc(L("不写姓名", "No names"))}</span>
      </header>
      <div class="wedding-menu-hero">
        <div><span>${esc(L("桌次", "Table"))}</span><b>${esc(table)}</b></div>
        <div><span>${esc(L("回执", "RSVP"))}</span><b>${esc(String(kpi.rsvpPct ?? "—"))}%</b></div>
        <div><span>${esc(L("重开加价", "Reopen fee"))}</span><b>¥${esc(fmt(m.reopenFee ?? 3600))}</b></div>
      </div>
      <ul class="wedding-menu-dishes">
        ${dishes
          .map((d) => `<li>${esc(getLocale() === "en" ? d.en || d.zh : d.zh || d.en)}</li>`)
          .join("")}
      </ul>
      ${
        notes.length
          ? `<div class="wedding-menu-notes">${notes
              .map((n) => `<p>${esc(pickLocaleText(n, "text") || n)}</p>`)
              .join("")}</div>`
          : `<p class="muted">${esc(
              L("口味、忌口、长辈体面与后厨产能需同时成立。", "Taste, diets, elders’ face and kitchen capacity must all hold.")
            )}</p>`
      }
    </div>`;
  }

  _renderRunbook(state = {}) {
    const kpi = state.kpi || {};
    const r = this.runbookState || {};
    const items = r.items || [
      { zh: "盯天气 · 启用室内备选条款", en: "Watch weather · invoke indoor backup clause", done: Boolean(r.weather) },
      { zh: "摄影机位重排", en: "Reposition photo angles", done: Boolean(r.photo) },
      { zh: "车队下客点调整", en: "Shift car drop-off", done: Boolean(r.fleet) },
      { zh: "长辈无障碍动线", en: "Step-free elder route", done: Boolean(r.access) },
      { zh: "开席时间对齐后厨", en: "Align kitchen serve time", done: Boolean(r.kitchen) },
      { zh: "宾客通知已发出", en: "Guest notices sent", done: Boolean(r.notify) },
    ];
    this.setTitle(L("当日 Runbook", "Day runbook"));
    this.setStatus(L("婚期与场地锁不能重来", "Date and venue lock cannot be redone"));
    return `<div class="wedding-runbook-board">
      <header class="wedding-panel-head">
        <strong>${esc(L("婚礼当天执行单", "Wedding-day runbook"))}</strong>
        <span>${esc(String(kpi.weddingDate || "2026-10-03"))}</span>
      </header>
      <ol class="wedding-runbook-list">
        ${items
          .map(
            (it, i) => `<li class="${it.done ? "is-done" : ""}">
              <em>${i + 1}</em>
              <span>${esc(getLocale() === "en" ? it.en || it.zh : it.zh || it.en)}</span>
              <b>${esc(it.done ? L("已对齐", "Aligned") : L("待办", "Open"))}</b>
            </li>`
          )
          .join("")}
      </ol>
      ${
        r.handoff
          ? `<p class="wedding-runbook-handoff">${esc(
              pickLocaleText(r, "handoff") ||
                L("交接：最终账本 · 供应商履约 · 差点出事复盘 · 可复用流程", "Handoff: final ledger · vendor delivery · near-miss review · reusable process")
            )}</p>`
          : ""
      }
    </div>`;
  }

  _renderLedger({ kpi = {}, locks = [], ledgerRows = [] } = {}) {
    const committed = Number(kpi.committedTotal) || 0;
    const cap = Number(kpi.budgetTotal) || 250000;
    const worst = Number(kpi.worstCaseExposure) || 0;
    const reserve = Number.isFinite(Number(kpi.reserveRemaining)) ? Number(kpi.reserveRemaining) : 20000;
    const pct = cap > 0 ? Math.min(100, Math.round((committed / cap) * 100)) : 0;
    const rows = ledgerRows.length ? ledgerRows : buildLedgerPreview(locks, kpi);
    this.setTitle(L("预算账本", "Budget ledger"));
    this.setStatus(L("Agent 不代签", "Agent does not sign"));

    return `<div class="wedding-ledger-board">
      <header class="wedding-panel-head">
        <strong>${esc(L("预算账本", "Budget ledger"))}</strong>
        <span>${esc(L("Agent 不代签", "Agent does not sign"))}</span>
      </header>
      <div class="wedding-ledger-hero">
        <div><span>${esc(L("已承诺", "Committed"))}</span><b>¥${esc(fmt(committed))}</b></div>
        <div><span>${esc(L("预算顶", "Cap"))}</span><b>¥${esc(fmt(cap))}</b></div>
        <div><span>${esc(L("最坏暴露", "Worst case"))}</span><b class="${worst > cap ? "is-warn" : ""}">¥${esc(fmt(worst))}</b></div>
        <div><span>${esc(L("预备金", "Reserve"))}</span><b>¥${esc(fmt(reserve))}</b></div>
      </div>
      <div class="wedding-ledger-meter" style="--pct:${pct}%"><i></i></div>
      <table class="wedding-ledger-table">
        <thead><tr>
          <th>${esc(L("锁/科目", "Lock / line"))}</th>
          <th>${esc(L("轨道", "Track"))}</th>
          <th>${esc(L("金额", "Amount"))}</th>
          <th>${esc(L("状态", "Status"))}</th>
        </tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr class="${r.changed ? "is-flash" : ""}">
              <td>${esc(r.label)}</td>
              <td>${esc(r.track || "—")}</td>
              <td>¥${esc(fmt(r.amount))}</td>
              <td><span class="wedding-status-pill is-${esc(r.statusClass || "planned")}">${esc(r.status)}</span></td>
            </tr>`
          )
          .join("")}</tbody>
      </table>
    </div>`;
  }

  _renderContracts({ contracts = {}, kpi = {} } = {}) {
    const v1 = contracts.v1 || {
      min_tables: 20,
      version: "v1",
      source_zh: "群文件",
      source_en: "Group file",
    };
    const attach = contracts.attachment || {
      min_tables: v1.min_tables,
      version: "pending",
      source_zh: "新附件尚未到达",
      source_en: "No new attachment yet",
    };
    const changed = Boolean(contracts.attachment) && v1.min_tables !== attach.min_tables;
    const v1Source = pickStored(v1, "source") || "v1";
    const attachSource = pickStored(attach, "source") || L("新附件", "New attachment");
    const v1Note = pickStored(v1, "note") || L("已签基准", "Signed baseline");
    const attachNote = pickStored(attach, "note") || L("待用户决定", "Awaiting user decision");
    this.setTitle(L("合同比对", "Contracts"));
    this.setStatus(L("只读 · 不代签", "Read-only · no signing"));
    return `<div class="wedding-contracts-board">
      <header class="wedding-panel-head">
        <strong>${esc(L("合同版本比对", "Contract diff"))}</strong>
        <span>${esc(L("只读 · 不代签", "Read-only · no signing"))}</span>
      </header>
      <div class="wedding-contract-columns">
        <article class="wedding-contract-col">
          <h3>${esc(v1Source)}</h3>
          <p>${esc(L("最低消费", "Min spend"))}: <b>${esc(String(v1.min_tables))}</b> ${esc(L("桌", "tables"))}</p>
          <p class="muted">${esc(v1Note)}</p>
        </article>
        <article class="wedding-contract-col ${changed ? "is-changed" : ""}">
          <h3>${esc(attachSource)}</h3>
          <p>${esc(L("最低消费", "Min spend"))}: <b>${esc(String(attach.min_tables))}</b> ${esc(L("桌", "tables"))}</p>
          <p class="muted">${esc(attachNote)}</p>
        </article>
      </div>
      ${
        changed
          ? `<p class="wedding-contract-warn">${esc(
              L(
                `漂移 +${attach.min_tables - v1.min_tables} 桌 · 最坏暴露约 ¥${fmt(kpi.worstCaseExposure || 274000)}`,
                `Drift +${attach.min_tables - v1.min_tables} tables · worst exposure ~ ¥${fmt(kpi.worstCaseExposure || 274000)}`
              )
            )}</p>`
          : ""
      }
      <p class="wedding-contract-foot muted">${esc(
        L("Agent 仅展示 diff，不会代替新人签署任何附件。", "Agent shows diffs only — never signs on your behalf.")
      )}</p>
    </div>`;
  }

  _renderBooking({ vendors = [], bookings = {} } = {}) {
    const en = getLocale() === "en";
    const list = vendors.length ? vendors : [];
    this.setTitle(L("预订状态", "Bookings"));
    this.setStatus(maskContact(""));
    return `<div class="wedding-booking-board">
      <header class="wedding-panel-head">
        <strong>${esc(L("供应商预订", "Vendor bookings"))}</strong>
        <span>${esc(maskContact(""))}</span>
      </header>
      <ul class="wedding-booking-list">
        ${list
          .map((v) => {
            const name = en ? v.name_en || v.name_zh : v.name_zh || v.name_en;
            const b = bookings[v.id] || v.booking || {};
            const ui = pickStored(b, "page_status") || pickStored(b, "uiStatus") || L("—", "—");
            const backend = pickStored(b, "order_status") || pickStored(b, "backendStatus") || L("—", "—");
            const mismatch = /released|unverified|释放|未核验/i.test(String(backend));
            const msgs = this._vendorMessages[v.id] || [];
            const preview = msgs.length
              ? pickStored(msgs[msgs.length - 1], "text")
              : pickStored(v, "preview") || v.preview || "";
            return `<li class="wedding-booking-row ${mismatch ? "is-mismatch" : ""}">
              <div class="wedding-booking-vendor">
                <strong>${esc(name || v.id)}</strong>
                <small>${esc(L(`轨道 ${v.track || "?"}`, `Track ${v.track || "?"}`))}</small>
              </div>
              <div class="wedding-booking-status">
                <span>${esc(L("页面", "UI"))}: <b>${esc(String(ui))}</b></span>
                <span>${esc(L("后台", "Backend"))}: <b>${esc(String(backend))}</b></span>
              </div>
              ${
                preview
                  ? `<p class="wedding-booking-preview">${esc(String(preview).slice(0, 120))}</p>`
                  : ""
              }
            </li>`;
          })
          .join("")}
      </ul>
      <p class="wedding-booking-foot muted">${esc(
        L("长辈联系方式不会进入商家系统。", "Elder contacts never enter vendor systems.")
      )}</p>
    </div>`;
  }

  _renderCalendar({ calendar = [], kpi = {}, meta = {} } = {}) {
    const en = getLocale() === "en";
    const fixed = meta.fixed_date || kpi.weddingDate || "2026-10-03";
    const events = calendar.length
      ? calendar
      : [
          { date: "2026-05-31", zh: "场地定金 L1", en: "Venue deposit L1" },
          { date: "2026-06-03", zh: "摄影定金 L2", en: "Photo deposit L2" },
          { date: "2026-07-31", zh: "回执截止", en: "RSVP close" },
          { date: fixed, zh: "婚礼当日", en: "Wedding day" },
        ];
    const [year, month, fixedDay] = fixed.split("-").map(Number);
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const eventDays = new Set(
      events
        .filter((event) => String(event.date || "").startsWith(`${year}-${String(month).padStart(2, "0")}-`))
        .map((event) => Number(String(event.date).slice(-2)))
    );
    const weekdayLabels = en ? ["S", "M", "T", "W", "T", "F", "S"] : ["日", "一", "二", "三", "四", "五", "六"];
    const cells = [
      ...Array.from({ length: firstWeekday }, () => `<span class="is-blank"></span>`),
      ...Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const fixedClass = day === fixedDay ? "is-fixed" : "";
        const eventClass = eventDays.has(day) ? "has-event" : "";
        return `<span class="${fixedClass} ${eventClass}"><b>${day}</b></span>`;
      }),
    ].join("");
    this.setTitle(L("关键日程", "Calendar"));
    this.setStatus(L(`倒计时 ${kpi.daysLeft ?? "—"} 天`, `Countdown ${kpi.daysLeft ?? "—"} d`));

    return `<div class="wedding-calendar-board">
      <div class="wedding-calendar-app">
        <section class="wedding-month">
          <div class="wedding-month-toolbar">
            <button type="button" disabled aria-hidden="true">‹</button>
            <strong>${esc(en ? `October ${year}` : `${year} 年 10 月`)}</strong>
            <button type="button" disabled aria-hidden="true">›</button>
          </div>
          <div class="wedding-month-weekdays">${weekdayLabels.map((label) => `<span>${esc(label)}</span>`).join("")}</div>
          <div class="wedding-month-grid">${cells}</div>
        </section>
        <aside class="wedding-agenda">
          <div class="wedding-agenda-head">
            <strong>${esc(L("筹备日程", "Planning agenda"))}</strong>
            <span>${esc(L("倒计时", "Countdown"))} ${esc(String(kpi.daysLeft ?? "—"))}${esc(L("天", "d"))}</span>
          </div>
          <ol class="wedding-calendar-list">
            ${events
              .map((ev) => {
                const label = en ? ev.en || ev.zh : ev.zh || ev.en;
                return `<li class="is-${esc(ev.status || "planned")}">
                  <time>${esc(String(ev.date || "").slice(5))}</time>
                  <span>${esc(label)}</span>
                  <em>${esc(calendarStatus(ev.status))}</em>
                </li>`;
              })
              .join("")}
          </ol>
        </aside>
      </div>
    </div>`;
  }
}

function buildLedgerPreview(locks = [], kpi = {}) {
  const en = getLocale() === "en";
  return locks.map((lock) => {
    const label = en ? lock.label_en || lock.label_zh : lock.label_zh || lock.label_en;
    const status = lock.status || "planned";
    return {
      label: `${lock.id || ""} ${label || ""}`.trim(),
      track: lock.track || "—",
      amount: lock.amount || 0,
      status: statusLabel(status),
      statusClass: status.includes("paid") ? "paid" : status.includes("auth") ? "auth" : "planned",
      changed: Boolean(kpi[`lock_${lock.id}`]),
    };
  });
}

function statusLabel(status) {
  const map = {
    planned: L("计划", "Planned"),
    authorized: L("已授权", "Authorized"),
    paid_nonrefundable: L("已付·不可退", "Paid · nonrefund"),
    held: L("保留", "Held"),
    blocked: L("已拦截", "Blocked"),
  };
  return map[status] || status;
}

function calendarStatus(status) {
  const map = {
    fixed: L("固定", "Fixed"),
    booked: L("已预约", "Booked"),
    planned: L("待执行", "Planned"),
    unavailable: L("已取消", "Cancelled"),
  };
  return map[status] || L("待执行", "Planned");
}
