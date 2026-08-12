/**
 * Wedding main dialogue stream — text bubbles + compact timeline events only.
 * No rich cards, sense-think-act rails, or dual-track chrome.
 */

import { L, getLocale } from "../i18n.js?v=20260812-smooth";
import { isReplayMode } from "../playback.js?v=20260812-smooth";

export const AUTH_PAYMENT_THRESHOLD = 5000;

const MAIN_THREAD = "lin_qiao";
const USER_IDS = new Set(["lin_qiao", "zhou_yu", "user", "boss"]);

const EVENT_KINDS = new Set([
  "world",
  "notify",
  "notification",
  "discovery",
  "mutation",
  "stage",
  "auth",
  "challenge",
]);

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
      challenge: L("难点", "Hard"),
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
    this._arrivedIds = new Set();
    this._renderedCount = 0;
  }

  reset(couple = {}) {
    this.couple = couple;
    this.feed = [];
    this._thinking = null;
    this._freshId = null;
    this._arrivedIds = new Set();
    this._renderedCount = 0;
    this.render({ stick: true });
  }

  /** Short compose indicator — no beat rail or dual-track meta. */
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
          this.messagesEl.scrollHeight - this.messagesEl.clientHeight - this.messagesEl.scrollTop < 80;
        if (near) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
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
    }, 120);
  }

  _mountThinking() {
    if (!this.messagesEl || !this._thinking) return;
    let el = this.messagesEl.querySelector(".wedding-thinking");
    if (!el) {
      el = document.createElement("div");
      el.className = "wedding-thinking";
      el.innerHTML = `<i></i><i></i><i></i><span></span>`;
      this.messagesEl.appendChild(el);
    }
    el.classList.remove("is-leaving");
    const span = el.querySelector("span");
    if (span) span.textContent = this._thinking;
    const near =
      this.messagesEl.scrollHeight - this.messagesEl.clientHeight - this.messagesEl.scrollTop < 80;
    if (near) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
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
      title_zh: msg.title_zh || "",
      title_en: msg.title_en || "",
      conflict_zh: msg.conflict_zh || "",
      conflict_en: msg.conflict_en || "",
      part_n: msg.part_n || null,
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

  pushTimelineEvent({
    kind = "world",
    text_zh,
    text_en,
    text,
    title_zh,
    title_en,
    conflict_zh,
    conflict_en,
    part_n,
    id,
  } = {}) {
    return this.pushMessage({
      id,
      thread: MAIN_THREAD,
      from: "agent",
      kind,
      text_zh: text_zh || text,
      text_en: text_en || text,
      title_zh,
      title_en,
      conflict_zh,
      conflict_en,
      part_n,
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

    if (kind === "challenge") {
      const title = pickLocale(m, "title") || text;
      const job = text;
      const conflict = pickLocale(m, "conflict");
      const partLabel = m.part_n ? `Part ${m.part_n}` : L("难点框架", "Hardness");
      return `<article class="wedding-stream-item wedding-challenge-card ${arrive}" data-msg-id="${esc(m.id)}">
        <span class="wedding-challenge-mark" aria-hidden="true">${esc(partLabel)}</span>
        <div class="wedding-challenge-body">
          <small>${esc(L("为什么难", "Why hard"))}</small>
          <strong>${esc(title)}</strong>
          ${job ? `<p><em>${esc(L("Agent 在做", "Agent work"))}</em>${esc(job)}</p>` : ""}
          ${conflict ? `<aside>${esc(conflict)}</aside>` : ""}
        </div>
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
    const avatar = userSide
      ? Array.from(bride || (getLocale() === "en" ? "Q" : "乔")).slice(-1)[0]
      : Array.from(m.from || "·")[0];
    return `<article class="wedding-stream-item ${kindClass} ${userSide ? "is-user" : ""} ${arrive}" data-msg-id="${esc(m.id)}">
      <span class="wedding-message-avatar" aria-hidden="true">${esc(avatar)}</span>
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
  }

  _msgSig(m) {
    return [
      m.id,
      m.kind,
      m.from,
      m.deliverableId || "",
      m.text_zh || "",
      m.text_en || "",
      m.title_zh || "",
      m.conflict_zh || "",
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
      const el = this.messagesEl;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    } else if (rebuilt) {
      this.messagesEl.scrollTop = previousTop;
    }

    if (this._freshId) {
      window.clearTimeout(this._freshTimer);
      this._freshTimer = window.setTimeout(() => {
        this._freshId = null;
      }, 420);
    }
  }
}

export { MAIN_THREAD, USER_IDS, pickLocale as pickWeddingLocale };
