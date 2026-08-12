/**
 * Wedding main dialogue stream — text bubbles + compact timeline events only.
 * No rich cards, sense-think-act rails, or dual-track chrome.
 */

import { L, getLocale } from "../i18n.js?v=20260812-user-avatar";
import { isReplayMode } from "../playback.js?v=20260812-user-avatar";

export const AUTH_PAYMENT_THRESHOLD = 5000;

const MAIN_THREAD = "lin_qiao";
const USER_IDS = new Set(["lin_qiao", "zhou_yu", "user", "boss"]);

const EVENT_KINDS = new Set(["world", "notify", "notification", "discovery", "mutation", "stage", "auth"]);
const TIP_KIND = "inbound";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pickLocale(obj, key = "text") {
  const zh = obj[`${key}_zh`] ?? obj[key];
  const en = obj[`${key}_en`] ?? obj[key];
  return getLocale() === "en" ? en || zh || "" : zh || en || "";
}

function kindTag(kind = "text") {
  return (
    {
      stage: L("阶段", "Stage"),
      world: L("外部", "World"),
      notify: L("通知", "Notice"),
      notification: L("通知", "Notice"),
      discovery: L("已核对", "Verified"),
      mutation: L("状态", "State"),
      auth: L("授权", "Auth"),
    }[kind] || L("动态", "Update")
  );
}

function formatTime(ts) {
  const date = new Date(ts || Date.now());
  return date.toLocaleTimeString(getLocale() === "en" ? "en-US" : "zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export class WeddingStream {
  constructor({
    messagesEl,
    onFocusDeliverable = () => {},
    onReplay = () => {},
    onExternalMessage = () => {},
    onExternalFocus = () => {},
    onInboundTipOpen = () => {},
    couple = {},
    threads = [],
  } = {}) {
    this.messagesEl = messagesEl;
    this.onFocusDeliverable = onFocusDeliverable;
    this.onReplay = onReplay;
    this.onExternalMessage = onExternalMessage;
    this.onExternalFocus = onExternalFocus;
    this.onInboundTipOpen = onInboundTipOpen;
    this.couple = couple;
    this.threads = threads;
    this.activeThread = MAIN_THREAD;
    this.feed = [];
    this._thinking = null;
    this._freshId = null;
    this._freshTimer = null;
    this._arrivedIds = new Set();
    this._renderedCount = 0;
  }

  reset(couple = {}, threads = null) {
    this.couple = couple;
    if (threads) this.threads = threads;
    this.activeThread = MAIN_THREAD;
    this.feed = [];
    this._thinking = null;
    this._freshId = null;
    this._arrivedIds = new Set();
    this._renderedCount = 0;
    this._pulseChatMode(MAIN_THREAD);
    this.render({ stick: true });
  }

  focusThread(id = MAIN_THREAD) {
    this.activeThread = id || MAIN_THREAD;
    if (id && id !== MAIN_THREAD) this.onExternalFocus(id);
    this._pulseChatMode(id);
  }

  /** Surface who Agent is coordinating with in the chat header. */
  _pulseChatMode(threadId = MAIN_THREAD) {
    const mode =
      document.querySelector(".wedding-chat-mode-tabs .wedding-mode-chip") ||
      document.querySelector(".wedding-chat-mode-tabs .ecom-mode-chip") ||
      document.querySelector(".wedding-chat-mode-tabs > span");
    if (!mode) return;
    const en = getLocale() === "en";
    if (threadId && threadId !== MAIN_THREAD) {
      const meta = (this.threads || []).find((t) => t.id === threadId);
      const name = en ? meta?.name_en || meta?.name_zh || threadId : meta?.name_zh || meta?.name_en || threadId;
      const kicker = esc(L("协作", "With"));
      mode.innerHTML = `<i aria-hidden="true"></i><em><b>${kicker}</b>${esc(name)}</em>`;
      mode.classList.add("is-live");
      mode.classList.remove("is-active");
      mode.setAttribute("title", L(`正在协作 · ${name}`, `Coordinating · ${name}`));
    } else {
      mode.innerHTML = `<i aria-hidden="true"></i><em>${esc(L("主对话", "Main chat"))}</em>`;
      mode.classList.add("is-active");
      mode.classList.remove("is-live");
      mode.removeAttribute("title");
    }
    mode.classList.remove("is-pulse");
    // Avoid forced reflow flash; soft class toggle is enough.
    mode.classList.add("is-pulse");
    window.clearTimeout(this._modePulseTimer);
    this._modePulseTimer = window.setTimeout(() => mode.classList.remove("is-pulse"), 680);
  }

  /** Soft scroll — avoids hard jump flashes when messages / typing land. */
  _scrollToBottom(el = this.messagesEl) {
    if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const start = el.scrollTop;
    const gap = max - start;
    if (Math.abs(gap) < 2) {
      el.scrollTop = max;
      return;
    }
    // If far away, snap near the end first, then ease the last stretch.
    let origin = start;
    if (Math.abs(gap) > 220) {
      origin = max - Math.sign(gap) * 160;
      el.scrollTop = origin;
    }
    const from = el.scrollTop;
    const delta = max - from;
    const dur = Math.min(340, 160 + Math.abs(delta) * 0.4);
    const t0 = performance.now();
    const token = (this._scrollEpoch = (this._scrollEpoch || 0) + 1);
    const tick = (now) => {
      if (this._scrollEpoch !== token) return;
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - p) ** 3;
      el.scrollTop = from + delta * e;
      if (p < 1) requestAnimationFrame(tick);
      else el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    };
    requestAnimationFrame(tick);
  }

  /** Soft compose indicator — no beat rail or dual-track meta. */
  showThinking(label = "") {
    const next = label || L("整理回复…", "Composing…");
    this._thinking = next;
    this._thinkEpoch = (this._thinkEpoch || 0) + 1;
    const el = this.messagesEl?.querySelector(".wedding-thinking");
    if (el) {
      el.classList.remove("is-leaving");
      const span = el.querySelector("span");
      if (span) {
        span.textContent = next;
        const near =
          this.messagesEl.scrollHeight - this.messagesEl.clientHeight - this.messagesEl.scrollTop < 100;
        if (near) this._scrollToBottom();
        return;
      }
    }
    this._mountThinking();
  }

  hideThinking() {
    this._thinking = null;
    const el = this.messagesEl?.querySelector(".wedding-thinking");
    if (!el) return;
    el.classList.add("is-leaving");
    const token = (this._thinkEpoch = (this._thinkEpoch || 0) + 1);
    window.setTimeout(() => {
      if (this._thinkEpoch !== token || this._thinking) return;
      el.remove();
    }, 240);
  }

  _mountThinking() {
    if (!this.messagesEl || !this._thinking) return;
    let el = this.messagesEl.querySelector(".wedding-thinking");
    if (!el) {
      el = document.createElement("div");
      el.className = "wedding-thinking is-enter";
      el.innerHTML = `<i></i><i></i><i></i><span></span>`;
      this.messagesEl.appendChild(el);
      requestAnimationFrame(() => el.classList.remove("is-enter"));
    }
    el.classList.remove("is-leaving");
    const span = el.querySelector("span");
    if (span) span.textContent = this._thinking;
    const near =
      this.messagesEl.scrollHeight - this.messagesEl.clientHeight - this.messagesEl.scrollTop < 100;
    if (near) this._scrollToBottom();
  }

  pushMessage(msg = {}) {
    const thread = msg.thread || MAIN_THREAD;
    const from = msg.from || "agent";
    const kind = msg.kind || "text";
    const text_zh = msg.text_zh ?? msg.text ?? "";
    const text_en = msg.text_en ?? msg.text ?? text_zh;
    const row = {
      id: msg.id || `wm_${this.feed.length}_${Date.now()}`,
      thread,
      from,
      kind,
      text_zh,
      text_en,
      text: pickLocale({ text_zh, text_en, text: msg.text }, "text"),
      deliverableId: msg.deliverable_id || msg.deliverableId || null,
      auth: Boolean(msg.auth || msg.lock_id || msg.authorization),
      lockId: msg.lock_id || msg.lockId || null,
      amount: Number(msg.amount) || 0,
      tipChannel: msg.tip_channel || msg.tipChannel || null,
      tipThread: msg.tip_thread || msg.tipThread || null,
      tipWorkspace: msg.tip_workspace || msg.tipWorkspace || null,
      tipPreviewZh: msg.tip_preview_zh || msg.tipPreviewZh || "",
      tipPreviewEn: msg.tip_preview_en || msg.tipPreviewEn || "",
      ts: msg.ts || Date.now(),
    };
    this.feed.push(row);
    this._freshId = row.id;
    if (thread !== MAIN_THREAD && !EVENT_KINDS.has(kind) && kind !== "deliverable" && kind !== TIP_KIND) {
      this.onExternalMessage(row, { reveal: true });
      // Only pulse collaboration chip for people IM threads.
      const meta = (this.threads || []).find((t) => t.id === thread);
      if (!meta || (meta.channel || "im") === "im") {
        this._pulseChatMode(thread);
        // Incoming people messages get a tip in the main couple IM.
        if (from !== "agent") {
          const en = getLocale() === "en";
          const name = en
            ? meta?.name_en || meta?.name_zh || from
            : meta?.name_zh || meta?.name_en || from;
          this.pushInboundTip({
            channel: "im",
            thread,
            workspace: "im",
            from_zh: meta?.name_zh || name,
            from_en: meta?.name_en || name,
            preview_zh: text_zh,
            preview_en: text_en,
          });
        }
      }
      return row;
    }
    if (thread === MAIN_THREAD) {
      this._pulseChatMode(MAIN_THREAD);
      this.render({ stick: true });
    }
    return row;
  }

  /** Compact “new message received” tip inside the main couple IM. */
  pushInboundTip({
    channel = "im",
    thread = null,
    workspace = null,
    from_zh = "",
    from_en = "",
    preview_zh = "",
    preview_en = "",
  } = {}) {
    const fromZh = String(from_zh || L("联系人", "Contact"));
    const fromEn = String(from_en || fromZh || "Contact");
    const ch = channel === "mail" || channel === "email" ? "mail" : channel === "sms" ? "sms" : "im";
    const text_zh =
      ch === "mail" ? `收到邮件 · ${fromZh}` : ch === "sms" ? `收到短信 · ${fromZh}` : `收到消息 · ${fromZh}`;
    const text_en =
      ch === "mail"
        ? `Mail received · ${fromEn}`
        : ch === "sms"
          ? `SMS received · ${fromEn}`
          : `Message received · ${fromEn}`;
    const ws = workspace || (ch === "mail" ? "mail" : ch === "sms" ? "sms" : "im");
    return this.pushMessage({
      thread: MAIN_THREAD,
      from: "agent",
      kind: TIP_KIND,
      text_zh,
      text_en,
      tip_channel: ch,
      tip_thread: thread,
      tip_workspace: ws,
      tip_preview_zh: String(preview_zh || "").slice(0, 72),
      tip_preview_en: String(preview_en || preview_zh || "").slice(0, 72),
    });
  }

  pushTimelineEvent({ kind = "world", text_zh, text_en, text, id, title_zh, title_en } = {}) {
    // Difficulty / conflict copy stays out of IM — use title+body only for operational notices.
    const bodyZh = text_zh || text || "";
    const bodyEn = text_en || text || "";
    let zh = bodyZh;
    let en = bodyEn;
    if (title_zh || title_en) {
      zh = title_zh ? `${title_zh}${bodyZh ? ` — ${bodyZh}` : ""}` : bodyZh;
      en = title_en ? `${title_en}${bodyEn ? ` — ${bodyEn}` : ""}` : bodyEn;
    }
    return this.pushMessage({
      id,
      thread: MAIN_THREAD,
      from: "agent",
      kind,
      text_zh: zh,
      text_en: en,
    });
  }

  /** Scam blocked card in the main couple dialogue. */
  pushScamBlockedCard({ text_zh, text_en } = {}) {
    return this.pushMessage({
      thread: MAIN_THREAD,
      from: "agent",
      kind: "discovery",
      text_zh: text_zh || "骗局已拦截 · 试菜席间催款外链未付款",
      text_en: text_en || "Scam blocked · tasting-table payment lure not paid",
    });
  }

  pushDeliverablePin({ id, title_zh, title_en, title, deliverableId } = {}) {
    return this.pushMessage({
      id,
      thread: MAIN_THREAD,
      from: "agent",
      kind: "deliverable",
      text_zh: title_zh || title,
      text_en: title_en || title,
      deliverable_id: deliverableId || id,
    });
  }

  /** Messages from the primary user that grant payment authorization. */
  listUserAuthorizations() {
    return this.feed.filter(
      (m) =>
        m.thread === MAIN_THREAD &&
        USER_IDS.has(m.from) &&
        (m.auth || m.lockId || /授权|authorize/i.test(m.text || ""))
    );
  }

  hasAuthorizationFor({ lockId = null, amount = 0 } = {}) {
    const grants = this.listUserAuthorizations();
    if (lockId) {
      return grants.some((g) => g.lockId === lockId || (g.text || "").includes(lockId));
    }
    if (amount > AUTH_PAYMENT_THRESHOLD) {
      return grants.some((g) => g.amount >= amount || /授权|authorize/i.test(g.text || ""));
    }
    return grants.length > 0;
  }

  _arriveClass(id) {
    if (!id || isReplayMode()) return "";
    if (id !== this._freshId || this._arrivedIds.has(id)) return "";
    this._arrivedIds.add(id);
    return "is-arrive";
  }

  _itemHtml(m, bride) {
    const mine = m.from === "agent";
    const userSide = USER_IDS.has(m.from);
    const arrive = this._arriveClass(m.id);
    const kind = String(m.kind || "text");
    const kindClass = `kind-${kind.replace(/[^a-z0-9_-]/gi, "")}`;
    const text = pickLocale(m, "text");

    if (m.deliverableId) {
      return `<article class="wedding-stream-item wedding-stream-output ${kindClass} ${arrive}" data-msg-id="${esc(m.id)}">
        <span class="wedding-log-bullet is-done" aria-hidden="true"></span>
        <div class="wedding-message-stack wedding-output-row">
          <div class="wedding-output-copy">
            <span>${esc(L("已完成", "Done"))}</span>
            <strong title="${esc(text)}">${esc(text)}</strong>
          </div>
          <button type="button" class="wedding-output-btn" data-wedding-deliv="${esc(m.deliverableId)}">${esc(
            L("查看", "View")
          )}</button>
        </div>
      </article>`;
    }

    if (kind === TIP_KIND) {
      const preview = pickLocale(
        { text_zh: m.tipPreviewZh, text_en: m.tipPreviewEn, text: m.tipPreviewZh },
        "text"
      );
      const ch = m.tipChannel || "im";
      const ico = ch === "mail" ? "📧" : ch === "sms" ? "📱" : "💬";
      const openLabel =
        ch === "mail" ? L("打开邮件", "Open mail") : ch === "sms" ? L("打开短信", "Open SMS") : L("去看", "Open");
      return `<article class="wedding-stream-item wedding-inbound-tip ${arrive}" data-msg-id="${esc(m.id)}">
        <button type="button" class="wedding-inbound-tip-btn"
          data-tip-workspace="${esc(m.tipWorkspace || ch)}"
          data-tip-thread="${esc(m.tipThread || "")}"
          data-tip-channel="${esc(ch)}">
          <span class="wedding-inbound-tip-ico" aria-hidden="true">${ico}</span>
          <span class="wedding-inbound-tip-copy">
            <strong>${esc(text)}</strong>
            ${preview ? `<em>${esc(preview)}</em>` : ""}
          </span>
          <span class="wedding-inbound-tip-go">${esc(openLabel)}</span>
        </button>
      </article>`;
    }

    if (EVENT_KINDS.has(kind)) {
      return `<article class="wedding-stream-item wedding-stream-event ${kindClass} ${arrive}" data-msg-id="${esc(m.id)}">
        <span class="wedding-log-bullet is-event" aria-hidden="true"></span>
        <div class="wedding-event-copy">
          <strong>${esc(kindTag(kind))}</strong>
          <p>${esc(text)}</p>
        </div>
      </article>`;
    }

    if (mine) {
      return `<article class="wedding-stream-item is-agent ${kindClass} ${arrive}" data-msg-id="${esc(m.id)}">
        <span class="wedding-log-bullet" aria-hidden="true"></span>
        <div class="wedding-message-stack">
          <div class="wedding-stream-who"><span>Dots Note</span><time>${esc(formatTime(m.ts))}</time></div>
          <div class="wedding-msg-bubble">${esc(text)}</div>
        </div>
      </article>`;
    }

    const who = userSide ? bride : m.from;
    const meta = (this.threads || []).find((t) => t.id === m.from) || null;
    const avatarImg =
      (userSide && (this.couple?.bride?.avatar_img || meta?.avatar_img)) ||
      (!userSide && meta?.avatar_img) ||
      "";
    const avatarLetter = userSide
      ? Array.from(bride || (getLocale() === "en" ? "Q" : "乔")).slice(-1)[0]
      : Array.from(meta?.avatar || m.from || "·")[0];
    const avatarHtml = avatarImg
      ? `<img class="wedding-message-avatar is-photo" src="./${esc(String(avatarImg).replace(/^\.\//, ""))}" alt="" width="26" height="26" />`
      : `<span class="wedding-message-avatar" aria-hidden="true">${esc(avatarLetter)}</span>`;
    return `<article class="wedding-stream-item ${kindClass} ${userSide ? "is-user" : ""} ${arrive}" data-msg-id="${esc(m.id)}">
      ${avatarHtml}
      <div class="wedding-message-stack">
        <div class="wedding-stream-who"><span>${esc(who)}</span><time>${esc(formatTime(m.ts))}</time></div>
        <div class="wedding-msg-bubble">${esc(text)}</div>
      </div>
    </article>`;
  }

  _bindActions(root = this.messagesEl) {
    root?.querySelectorAll("[data-wedding-deliv]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => this.onFocusDeliverable(btn.dataset.weddingDeliv));
    });
    root?.querySelectorAll("[data-wedding-replay]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => this.onReplay?.());
    });
    root?.querySelectorAll("[data-tip-workspace]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        this.onInboundTipOpen?.({
          workspace: btn.dataset.tipWorkspace || "im",
          thread: btn.dataset.tipThread || null,
          channel: btn.dataset.tipChannel || "im",
        });
      });
    });
  }

  _msgSig(m) {
    return [
      m.id,
      m.kind,
      m.from,
      m.deliverableId || "",
      m.tipThread || "",
      m.tipWorkspace || "",
      m.text_zh || "",
      m.text_en || "",
      m.html ? String(m.html).length : 0,
    ].join("|");
  }

  _mountArticle(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const node = wrap.firstElementChild;
    if (!node) return null;
    const thinkingEl = this.messagesEl.querySelector(".wedding-thinking");
    if (thinkingEl) thinkingEl.before(node);
    else this.messagesEl.appendChild(node);
    this._bindActions(node);
    return node;
  }

  _patchArticles(list, bride) {
    const articles = [...this.messagesEl.querySelectorAll("article[data-msg-id]")];
    if (articles.length !== list.length) return false;
    for (let i = 0; i < list.length; i++) {
      if (articles[i].dataset.msgId !== String(list[i].id)) return false;
    }
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const el = articles[i];
      const sig = this._msgSig(m);
      if (el.dataset.sig === sig) continue;
      const wrap = document.createElement("div");
      wrap.innerHTML = this._itemHtml(m, bride);
      const next = wrap.firstElementChild;
      if (!next) return false;
      next.dataset.sig = sig;
      el.replaceWith(next);
      this._bindActions(next);
    }
    return true;
  }

  render({ stick = true } = {}) {
    if (!this.messagesEl) return;
    const previousTop = this.messagesEl.scrollTop;
    const wasNearBottom =
      this.messagesEl.scrollHeight - this.messagesEl.clientHeight - this.messagesEl.scrollTop < 80;

    const list = this.feed.filter((m) => m.thread === MAIN_THREAD);
    if (!list.length) {
      this._renderedCount = 0;
      this.messagesEl.innerHTML = `<div class="wedding-stream-empty">
        <strong>${esc(L("对话会出现在这里", "Conversation will appear here"))}</strong>
        <p>${esc(L("执行细节请看右侧工作台", "See the workspace for execution details"))}</p>
      </div>`;
      return;
    }

    const bride =
      getLocale() === "en"
        ? this.couple?.bride?.name_en || this.couple?.bride?.name_zh || "Lin Qiao"
        : this.couple?.bride?.name_zh || this.couple?.bride?.name_en || "林乔";

    const articleCount = this.messagesEl.querySelectorAll("article[data-msg-id]").length;
    const canAppend =
      list.length === this._renderedCount + 1 &&
      articleCount === this._renderedCount &&
      this._renderedCount > 0;
    const canPatch =
      !canAppend &&
      list.length === this._renderedCount &&
      articleCount === this._renderedCount &&
      this._renderedCount > 0;

    let rebuilt = false;
    if (canAppend) {
      const last = list[list.length - 1];
      const node = this._mountArticle(this._itemHtml(last, bride));
      if (node) node.dataset.sig = this._msgSig(last);
      this._renderedCount = list.length;
    } else if (canPatch && this._patchArticles(list, bride)) {
      this._renderedCount = list.length;
    } else {
      const thinking = this._thinking;
      this.messagesEl.innerHTML = list
        .map((m) =>
          this._itemHtml(m, bride).replace(
            /^<article\b/,
            `<article data-sig="${esc(this._msgSig(m))}"`
          )
        )
        .join("");
      this._bindActions(this.messagesEl);
      this._renderedCount = list.length;
      rebuilt = true;
      if (thinking) this._mountThinking();
    }

    if (this._thinking) this._mountThinking();
    if (stick && wasNearBottom) {
      requestAnimationFrame(() => this._scrollToBottom());
    } else if (rebuilt) {
      this.messagesEl.scrollTop = previousTop;
    }

    if (this._freshId) {
      window.clearTimeout(this._freshTimer);
      this._freshTimer = window.setTimeout(() => {
        this._freshId = null;
        this.messagesEl
          ?.querySelectorAll(".wedding-stream-item.is-arrive")
          .forEach((n) => n.classList.remove("is-arrive"));
      }, 520);
    }
  }
}

export { MAIN_THREAD, USER_IDS, pickLocale as pickWeddingLocale };
