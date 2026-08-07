/**
 * Wedding main dialogue stream — text bubbles + compact timeline events only.
 * No rich cards, sense-think-act rails, or dual-track chrome.
 */

import { L, getLocale } from "../i18n.js?v=20260807-wedding-align2";

export const AUTH_PAYMENT_THRESHOLD = 5000;

const MAIN_THREAD = "lin_qiao";
const USER_IDS = new Set(["lin_qiao", "zhou_yu", "user", "boss"]);

const EVENT_KINDS = new Set(["world", "notify", "notification", "discovery", "mutation", "stage", "auth"]);

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
    couple = {},
  } = {}) {
    this.messagesEl = messagesEl;
    this.onFocusDeliverable = onFocusDeliverable;
    this.onReplay = onReplay;
    this.couple = couple;
    this.feed = [];
    this._thinking = null;
    this._freshId = null;
    this._freshTimer = null;
  }

  reset(couple = {}) {
    this.couple = couple;
    this.feed = [];
    this._thinking = null;
    this.render({ stick: true });
  }

  /** Short compose indicator — no beat rail or dual-track meta. */
  showThinking(label = "") {
    this._thinking = label || L("整理回复…", "Composing…");
    this._mountThinking();
  }

  hideThinking() {
    this._thinking = null;
    this.messagesEl?.querySelector(".wedding-thinking")?.remove();
  }

  _mountThinking() {
    if (!this.messagesEl || !this._thinking) return;
    let el = this.messagesEl.querySelector(".wedding-thinking");
    if (!el) {
      el = document.createElement("div");
      el.className = "wedding-thinking";
      this.messagesEl.appendChild(el);
    }
    el.innerHTML = `<i></i><i></i><i></i><span>${esc(this._thinking)}</span>`;
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  pushMessage(msg = {}) {
    const thread = msg.thread || MAIN_THREAD;
    const from = msg.from || "agent";
    const kind = msg.kind || "text";
    const row = {
      id: msg.id || `wm_${this.feed.length}_${Date.now()}`,
      thread,
      from,
      kind,
      text: pickLocale(msg, "text"),
      deliverableId: msg.deliverable_id || msg.deliverableId || null,
      auth: Boolean(msg.auth || msg.lock_id || msg.authorization),
      lockId: msg.lock_id || msg.lockId || null,
      amount: Number(msg.amount) || 0,
      ts: msg.ts || Date.now(),
    };
    this.feed.push(row);
    this._freshId = row.id;
    if (thread === MAIN_THREAD) this.render({ stick: true });
    return row;
  }

  pushTimelineEvent({ kind = "world", text_zh, text_en, text, id } = {}) {
    return this.pushMessage({
      id,
      thread: MAIN_THREAD,
      from: "agent",
      kind,
      text_zh: text_zh || text,
      text_en: text_en || text,
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

  render({ stick = true } = {}) {
    if (!this.messagesEl) return;
    const previousTop = this.messagesEl.scrollTop;
    const wasNearBottom =
      this.messagesEl.scrollHeight - this.messagesEl.clientHeight - this.messagesEl.scrollTop < 72;

    const list = this.feed.filter((m) => m.thread === MAIN_THREAD);
    if (!list.length) {
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

    this.messagesEl.innerHTML = list
      .map((m) => {
        const mine = m.from === "agent";
        const userSide = USER_IDS.has(m.from);
        const arrive = m.id === this._freshId ? "is-arrive" : "";
        const kind = String(m.kind || "text");
        const kindClass = `kind-${kind.replace(/[^a-z0-9_-]/gi, "")}`;

        if (m.deliverableId) {
          return `<article class="wedding-stream-item wedding-stream-output ${kindClass} ${arrive}">
            <span class="wedding-output-icon" aria-hidden="true">✓</span>
            <div class="wedding-output-copy">
              <span>${esc(L("已完成", "Done"))}</span>
              <strong>${esc(m.text)}</strong>
            </div>
            <button type="button" class="wedding-output-btn" data-wedding-deliv="${esc(m.deliverableId)}">${esc(
              L("查看", "Open")
            )}</button>
          </article>`;
        }

        if (EVENT_KINDS.has(kind)) {
          return `<article class="wedding-stream-item wedding-stream-event ${kindClass} ${arrive}">
            <span class="wedding-event-marker" aria-hidden="true"></span>
            <div class="wedding-event-copy">
              <strong>${esc(kindTag(kind))}</strong>
              <p>${esc(m.text)}</p>
            </div>
          </article>`;
        }

        const who = mine ? "Agent" : userSide ? bride : m.from;
        const avatar = mine ? "AI" : userSide ? Array.from(bride || "乔").slice(-1)[0] : Array.from(m.from || "·")[0];
        return `<article class="wedding-stream-item ${kindClass} ${userSide ? "is-user" : mine ? "is-agent" : ""} ${arrive}">
          <span class="wedding-message-avatar" aria-hidden="true">${esc(avatar)}</span>
          <div class="wedding-message-stack">
            <div class="wedding-stream-who"><span>${esc(who)}</span><time>${esc(formatTime(m.ts))}</time></div>
            <div class="wedding-msg-bubble">${esc(m.text)}</div>
          </div>
        </article>`;
      })
      .join("");

    this.messagesEl.querySelectorAll("[data-wedding-deliv]").forEach((btn) => {
      btn.addEventListener("click", () => this.onFocusDeliverable(btn.dataset.weddingDeliv));
    });
    this.messagesEl.querySelectorAll("[data-wedding-replay]").forEach((btn) => {
      btn.addEventListener("click", () => this.onReplay?.());
    });

    if (this._thinking) this._mountThinking();
    if (stick && wasNearBottom) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    else this.messagesEl.scrollTop = previousTop;

    if (this._freshId) {
      window.clearTimeout(this._freshTimer);
      this._freshTimer = window.setTimeout(() => {
        this._freshId = null;
      }, 480);
    }
  }
}

export { MAIN_THREAD, USER_IDS, pickLocale as pickWeddingLocale };
