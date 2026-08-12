/**
 * Wedding main dialogue stream — text bubbles + compact timeline events only.
 * No rich cards, sense-think-act rails, or dual-track chrome.
 */

import { L, getLocale } from "../i18n.js?v=20260812-tip-no-view";
import { isReplayMode } from "../playback.js?v=20260812-tip-no-view";

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
    if (Math.abs(gap) < 8) {
      el.scrollTop = max;
      return;
    }
    // Already near bottom: stick without a long ease that fights the next frame.
    if (gap > 0 && gap < 120) {
      el.scrollTop = max;
      return;
    }
    let origin = start;
    if (gap > 240) {
      origin = max - 140;
      el.scrollTop = origin;
    }
    const from = el.scrollTop;
    const delta = max - from;
    const dur = Math.min(240, 110 + Math.abs(delta) * 0.3);
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
      html: msg.html || null,
      deliverableId: msg.deliverable_id || msg.deliverableId || null,
      auth: Boolean(msg.auth || msg.lock_id || msg.authorization),
      lockId: msg.lock_id || msg.lockId || null,
      amount: Number(msg.amount) || 0,
      tipChannel: msg.tip_channel || msg.tipChannel || null,
      tipThread: msg.tip_thread || msg.tipThread || null,
      tipWorkspace: msg.tip_workspace || msg.tipWorkspace || null,
      tipPreviewZh: msg.tip_preview_zh || msg.tipPreviewZh || "",
      tipPreviewEn: msg.tip_preview_en || msg.tipPreviewEn || "",
      tipIcon: msg.tip_icon || msg.tipIcon || null,
      tipActionZh: msg.tip_action_zh || msg.tipActionZh || "",
      tipActionEn: msg.tip_action_en || msg.tipActionEn || "",
      meta: msg.meta || null,
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

  /** Compact tip inside the main couple IM (mail / SMS / people IM / app updates). */
  pushInboundTip({
    channel = "im",
    thread = null,
    workspace = null,
    from_zh = "",
    from_en = "",
    preview_zh = "",
    preview_en = "",
    title_zh = "",
    title_en = "",
  } = {}) {
    const fromZh = String(from_zh || L("联系人", "Contact"));
    const fromEn = String(from_en || fromZh || "Contact");
    const meta = tipChannelMeta(channel);
    const ch = meta.channel;
    const text_zh =
      title_zh ||
      (ch === "mail"
        ? `处理邮件 · ${fromZh}`
        : ch === "sms"
          ? `处理短信 · ${fromZh}`
          : ch === "im"
            ? `处理消息 · ${fromZh}`
            : `${meta.titleZh}${fromZh && fromZh !== L("联系人", "Contact") ? ` · ${fromZh}` : ""}`);
    const text_en =
      title_en ||
      (ch === "mail"
        ? `Handling mail · ${fromEn}`
        : ch === "sms"
          ? `Handling SMS · ${fromEn}`
          : ch === "im"
            ? `Handling message · ${fromEn}`
            : `${meta.titleEn}${fromEn && fromEn !== "Contact" ? ` · ${fromEn}` : ""}`);
    const ws = workspace || meta.workspace || ch;
    return this.pushMessage({
      thread: MAIN_THREAD,
      from: "agent",
      kind: TIP_KIND,
      text_zh,
      text_en,
      tip_channel: ch,
      tip_thread: thread,
      tip_workspace: ws,
      tip_preview_zh: String(preview_zh || "").slice(0, 90),
      tip_preview_en: String(preview_en || preview_zh || "").slice(0, 90),
      tip_icon: meta.icon,
      tip_action_zh: meta.actionZh,
      tip_action_en: meta.actionEn,
    });
  }

  /** Tip when calendar / ledger / contracts / menu / runbook etc. are updated. */
  pushWorkspaceTip({
    workspace = "ledger",
    preview_zh = "",
    preview_en = "",
    title_zh = "",
    title_en = "",
  } = {}) {
    const meta = tipChannelMeta(workspace);
    return this.pushInboundTip({
      channel: meta.channel,
      workspace: meta.workspace,
      title_zh: title_zh || meta.titleZh,
      title_en: title_en || meta.titleEn,
      preview_zh,
      preview_en,
      from_zh: "",
      from_en: "",
    });
  }

  pushTimelineEvent({ kind = "world", text_zh, text_en, text, id, title_zh, title_en } = {}) {
    // Stage / world / notify / discovery are narrator labels the model cannot "see" as chat.
    // Keep them out of couple IM; callers should use user messages, tips, or tool surfaces instead.
    const blocked = new Set(["stage", "world", "notify", "notification", "discovery", "mutation", "auth"]);
    if (blocked.has(String(kind || "world"))) return null;

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
      kind: "text",
      text_zh: text_zh || "骗局已拦截：试菜席间催款外链我没有点、也没有付。",
      text_en: text_en || "Scam blocked: I did not open or pay the tasting-table lure link.",
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

  /** Sticky thinking note that remains visible in the couple IM. */
  pushThinkingNote({ text_zh, text_en } = {}) {
    const zh = text_zh || L("梳理约束与下一步…", "Sorting constraints and next step…");
    const en = text_en || zh;
    return this.pushMessage({
      thread: MAIN_THREAD,
      from: "agent",
      kind: "thinking",
      text_zh: zh,
      text_en: en,
      html: weddingThinkingCardHtml(zh, en),
    });
  }

  pushToolCall(name, args = {}, { status = "running" } = {}) {
    const id = `wtool_${Date.now()}_${this.feed.length}`;
    const label = weddingToolLabel(name);
    const steps = weddingToolSteps(name);
    const html = weddingToolCardHtml({ name, label, args, status, steps, stepIdx: 0 });
    this.pushMessage({
      id,
      thread: MAIN_THREAD,
      from: "agent",
      kind: "tool",
      text_zh: label,
      text_en: label,
      html,
      meta: { tool: name, args, status, steps, stepIdx: 0 },
    });
    return id;
  }

  advanceToolCall(id, stepIdx = 1) {
    const row = this.feed.find((m) => m.id === id);
    if (!row?.meta) return;
    const steps = row.meta.steps || weddingToolSteps(row.meta.tool);
    const idx = Math.max(0, Math.min(stepIdx, steps.length - 1));
    row.meta = { ...row.meta, stepIdx: idx, status: "running" };
    row.html = weddingToolCardHtml({
      name: row.meta.tool,
      label: weddingToolLabel(row.meta.tool),
      args: row.meta.args || {},
      status: "running",
      steps,
      stepIdx: idx,
    });
    this.render({ stick: true });
  }

  finishToolCall(id, { ok = true, detail = "" } = {}) {
    const row = this.feed.find((m) => m.id === id);
    if (!row) return;
    const name = row.meta?.tool || "";
    const label = weddingToolLabel(name);
    const steps = row.meta?.steps || weddingToolSteps(name);
    row.meta = { ...(row.meta || {}), status: "done", ok, stepIdx: steps.length };
    row.html = weddingToolCardHtml({
      name,
      label,
      args: row.meta?.args || {},
      status: "done",
      ok,
      detail: detail || weddingFormatArgs(row.meta?.args || {}),
      steps,
      stepIdx: steps.length,
      next: ok ? weddingToolNext(name) : "",
    });
    this.render({ stick: true });
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
      const meta = tipChannelMeta(ch);
      const ico = m.tipIcon || meta.icon;
      return `<article class="wedding-stream-item wedding-inbound-tip ${arrive}" data-msg-id="${esc(m.id)}">
        <button type="button" class="wedding-inbound-tip-btn"
          data-tip-workspace="${esc(m.tipWorkspace || meta.workspace || ch)}"
          data-tip-thread="${esc(m.tipThread || "")}"
          data-tip-channel="${esc(ch)}">
          <span class="wedding-inbound-tip-ico" aria-hidden="true">${ico}</span>
          <span class="wedding-inbound-tip-copy">
            <strong>${esc(text)}</strong>
            ${preview ? `<em>${esc(preview)}</em>` : ""}
          </span>
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

    if (kind === "thinking" || kind === "tool" || m.html) {
      return `<article class="wedding-stream-item is-agent kind-${esc(kind)} ${arrive}" data-msg-id="${esc(m.id)}">
        <span class="wedding-log-bullet ${kind === "thinking" ? "is-think" : kind === "tool" ? "is-tool" : ""}" aria-hidden="true"></span>
        <div class="wedding-message-stack">
          <div class="wedding-stream-who"><span>Dots Note</span><time>${esc(formatTime(m.ts))}</time></div>
          ${m.html || `<div class="wedding-msg-bubble">${esc(text)}</div>`}
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
      m.meta?.status || "",
      m.meta?.stepIdx ?? "",
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

function tipChannelMeta(channel = "im") {
  const ch = String(channel || "im");
  const map = {
    mail: {
      channel: "mail",
      workspace: "mail",
      icon: "📧",
      titleZh: "处理邮件",
      titleEn: "Handling mail",
      actionZh: "查看",
      actionEn: "View",
    },
    email: {
      channel: "mail",
      workspace: "mail",
      icon: "📧",
      titleZh: "处理邮件",
      titleEn: "Handling mail",
      actionZh: "查看",
      actionEn: "View",
    },
    sms: {
      channel: "sms",
      workspace: "sms",
      icon: "📱",
      titleZh: "处理短信",
      titleEn: "Handling SMS",
      actionZh: "查看",
      actionEn: "View",
    },
    im: {
      channel: "im",
      workspace: "im",
      icon: "💬",
      titleZh: "处理消息",
      titleEn: "Handling message",
      actionZh: "查看",
      actionEn: "View",
    },
    ledger: {
      channel: "ledger",
      workspace: "ledger",
      icon: "📒",
      titleZh: "更新账本",
      titleEn: "Ledger updated",
      actionZh: "查看",
      actionEn: "View",
    },
    calendar: {
      channel: "calendar",
      workspace: "calendar",
      icon: "📅",
      titleZh: "更新日历",
      titleEn: "Calendar updated",
      actionZh: "查看",
      actionEn: "View",
    },
    contracts: {
      channel: "contracts",
      workspace: "contracts",
      icon: "📄",
      titleZh: "更新合同",
      titleEn: "Contracts updated",
      actionZh: "查看",
      actionEn: "View",
    },
    menu: {
      channel: "menu",
      workspace: "menu",
      icon: "🍽️",
      titleZh: "更新菜单",
      titleEn: "Menu updated",
      actionZh: "查看",
      actionEn: "View",
    },
    runbook: {
      channel: "runbook",
      workspace: "runbook",
      icon: "✅",
      titleZh: "更新 Runbook",
      titleEn: "Runbook updated",
      actionZh: "查看",
      actionEn: "View",
    },
    invites: {
      channel: "invites",
      workspace: "invites",
      icon: "💌",
      titleZh: "更新请柬",
      titleEn: "Invites updated",
      actionZh: "查看",
      actionEn: "View",
    },
    files: {
      channel: "files",
      workspace: "files",
      icon: "📁",
      titleZh: "更新文件",
      titleEn: "Files updated",
      actionZh: "查看",
      actionEn: "View",
    },
    web: {
      channel: "web",
      workspace: "web",
      icon: "🌐",
      titleZh: "更新网页核验",
      titleEn: "Web check updated",
      actionZh: "查看",
      actionEn: "View",
    },
    booking: {
      channel: "booking",
      workspace: "booking",
      icon: "📋",
      titleZh: "更新预订",
      titleEn: "Booking updated",
      actionZh: "查看",
      actionEn: "View",
    },
  };
  return map[ch] || map.im;
}

function weddingThinkingCardHtml(zh, en) {
  const body = getLocale() === "en" ? en || zh : zh || en;
  return `<div class="wedding-think-card" data-think-card>
    <div class="wedding-think-card-head"><i></i><span>${esc(L("思考", "Thinking"))}</span></div>
    <p>${esc(body)}</p>
  </div>`;
}

function weddingToolLabel(name = "") {
  return String(name || "tool").replace(/_/g, " ");
}

function weddingToolSteps(name = "") {
  const common = [
    L("核对输入与约束", "Check inputs & constraints"),
    L("执行可验证调用", "Run verifiable call"),
    L("写回工作台", "Write back to workspace"),
  ];
  const map = {
    ingest_scattered_quotes: [
      L("收集散落报价", "Collect scattered quotes"),
      L("标注性质字段", "Tag nature fields"),
      L("准备并账", "Ready to merge ledger"),
    ],
    merge_five_track_ledger: [
      L("对齐五轨科目", "Align five-track lines"),
      L("计算挤占", "Compute squeeze"),
      L("刷新账本", "Refresh ledger"),
    ],
    build_critical_path: [
      L("枚举锁点", "List lock points"),
      L("建依赖边", "Build dependencies"),
      L("倒排到婚期", "Back-schedule to wedding day"),
    ],
    compare_venue_quotes: [
      L("标准化条款", "Normalize terms"),
      L("并排比较", "Side-by-side compare"),
      L("标出风险", "Flag risks"),
    ],
    build_table_range: [
      L("去重名单", "Deduplicate guests"),
      L("估桌数区间", "Estimate table band"),
      L("写回日历", "Write to calendar"),
    ],
    backschedule_deadlines: [
      L("读取定金/回执日", "Read deposit/RSVP dates"),
      L("倒排关键路径", "Back-schedule critical path"),
      L("同步日历", "Sync calendar"),
    ],
    verify_hold_backend: [
      L("对照页面文案", "Compare UI copy"),
      L("核 order_id / expiry", "Verify order_id / expiry"),
      L("标真实状态", "Mark real status"),
    ],
    diff_contract_versions: [
      L("读取双版本", "Load both versions"),
      L("逐条 diff", "Line-by-line diff"),
      L("重算暴露", "Recompute exposure"),
    ],
    block_untrusted_payment: [
      L("识别陌生催款", "Flag untrusted ask"),
      L("拦截外链", "Block outbound link"),
      L("记入近失", "Log near-miss"),
    ],
    relocate_ceremony_indoor: [
      L("启用备选条款", "Enable backup clause"),
      L("对齐机位车队后厨", "Realign photo/fleet/kitchen"),
      L("更新 runbook", "Update runbook"),
    ],
  };
  return map[name] || common;
}

function weddingToolWhy(name = "") {
  const map = {
    ingest_scattered_quotes: L("把散落报价收成可并账事实", "Turn scattered quotes into mergeable facts"),
    merge_five_track_ledger: L("并成一张账，暴露连锁挤占", "Merge one ledger and surface cascade squeeze"),
    build_critical_path: L("把七个锁点钉上不可改婚期", "Pin seven locks onto the fixed wedding date"),
    compare_venue_quotes: L("统一比较口径后再谈定金", "Normalize venue terms before any deposit"),
    build_table_range: L("用区间而不是拍脑袋桌数", "Use a table band instead of a guess"),
    backschedule_deadlines: L("让截止日回到同一张图", "Pull deadlines onto one chart"),
    verify_hold_backend: L("不信单页锁定文案", "Don’t trust a single lock banner"),
    diff_contract_versions: L("只做 diff，不代签", "Diff only — never sign"),
    block_untrusted_payment: L("零点击拦截骗局", "Block scam with zero clicks"),
    relocate_ceremony_indoor: L("雨天切室内且不改婚期", "Move indoors on rain without moving the date"),
  };
  return map[name] || L("为当前决策补齐可验证事实", "Fill verifiable facts for the current decision");
}

function weddingToolNext(name = "") {
  return L("下一步：把结果带回主对话，只问需你点头的项", "Next: bring results back and ask only what needs your go-ahead");
}

function weddingFormatArgs(args = {}) {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args)
    .slice(0, 4)
    .map(([k, v]) => `${k} · ${String(v).slice(0, 40)}`)
    .join("　");
}

function weddingToolCardHtml({ name, label, args, status, ok = true, detail = "", steps = [], stepIdx = 0, next = "" }) {
  const running = status !== "done";
  const why = weddingToolWhy(name);
  const stepsHtml = steps
    .map((s, i) => {
      const state = !running && ok ? "is-done" : i < stepIdx ? "is-done" : i === stepIdx && running ? "is-active" : "";
      return `<li class="${state}"><i></i><span>${esc(s)}</span></li>`;
    })
    .join("");
  const head = running
    ? `<i class="spin" aria-hidden="true"></i><span>${esc(L("正在调用工具", "Using tool"))}</span><code>${esc(label)}</code>`
    : `<span class="wedding-tool-check ${ok ? "is-ok" : "is-bad"}" aria-hidden="true"></span>
       <span>${esc(ok ? L("工具完成", "Tool done") : L("工具失败", "Tool failed"))}</span>
       <code>${esc(label)}</code>`;
  const nextHtml = !running && ok && next ? `<p class="wedding-tool-next">${esc(next)}</p>` : "";
  return `<div class="wedding-tool-card ${running ? "" : "is-done"} ${ok ? "" : "is-failed"}" data-tool-card>
    <div class="wedding-tool-card-head">${head}</div>
    <div class="wedding-tool-card-body">
      <p class="wedding-tool-why">${esc(L("意图", "Why"))} · ${esc(why)}</p>
      <div class="wedding-tool-args">${esc(detail || weddingFormatArgs(args))}</div>
      <ol class="wedding-tool-steps">${stepsHtml}</ol>
      ${nextHtml}
    </div>
  </div>`;
}

export { MAIN_THREAD, USER_IDS, pickLocale as pickWeddingLocale };
