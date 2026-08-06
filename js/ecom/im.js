/**
 * Mock OpenClaw / agent workspace stream (center column).
 */

import { L, getLocale } from "../i18n.js?v=20260807-editor";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TAB_OF = {
  boss: "ops",
  bean_a: "supplier",
  bean_b: "supplier",
  bean_c: "supplier",
  pack_factory: "supplier",
  design: "design",
  xhs_ops: "marketing",
  cs: "ops",
  kol: "marketing",
  finance: "ops",
};

export class EcomIm {
  constructor({ messagesEl, tabsEl, onFocusDeliverable, onExternalFocus, onExternalMessage } = {}) {
    this.messagesEl = messagesEl;
    this.tabsEl = tabsEl;
    this.onFocusDeliverable = onFocusDeliverable || (() => {});
    this.onExternalFocus = onExternalFocus || (() => {});
    this.onExternalMessage = onExternalMessage || (() => {});
    this.threads = [];
    this.feed = [];
    this.activeTab = "all";
    this.activeThread = null;
    tabsEl?.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeTab = btn.dataset.tab || "all";
        tabsEl.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("is-active", b === btn));
        this.renderChat({ stick: true });
      });
    });
  }

  reset(threads = []) {
    this.threads = threads.slice();
    this.feed = [];
    this.activeThread = threads[0]?.id || null;
    this.activeTab = "all";
    this.tabsEl?.querySelectorAll("[data-tab]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.tab === "all");
    });
    this.renderChat();
  }

  /** Compatibility with script focus_thread */
  focusThread(id) {
    this.activeThread = id;
    if (id && id !== "boss") this.onExternalFocus(id);
    const tab = this.threads.find((t) => t.id === id)?.tab || TAB_OF[id] || "all";
    if (tab && tab !== "all") {
      this.activeTab = tab;
      this.tabsEl?.querySelectorAll("[data-tab]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.tab === tab);
      });
    }
    this.renderChat({ stick: true });
  }

  renderThreads() {
    /* threads live in center tabs in SaaS layout */
  }

  pushMessage(msg) {
    const thread = msg.thread || "boss";
    const tab = this.threads.find((t) => t.id === thread)?.tab || TAB_OF[thread] || "ops";
    const row = {
      id: msg.id || `m_${Date.now()}_${this.feed.length}`,
      thread,
      tab,
      from: msg.from || "agent",
      kind: msg.kind || "text",
      text: pickLocale(msg, "text"),
      html: msg.html || null,
      deliverableId: msg.deliverable_id || msg.deliverableId || null,
      meta: msg.meta || null,
      ts: msg.ts || Date.now(),
    };
    this.feed.push(row);
    if (thread !== "boss") {
      this.onExternalMessage(row, { reveal: !row.html });
      return row.id;
    }
    this.renderChat({ stick: true });
    return row.id;
  }

  pushRichCard({ id, thread = "boss", kind, title, bodyHtml, deliverableId = null } = {}) {
    const msgId = id || `rich_${Date.now()}_${this.feed.length}`;
    this.pushMessage({
      id: msgId,
      thread,
      from: "agent",
      kind: kind || "rich",
      text_zh: title || "",
      text_en: title || "",
      html: bodyHtml,
      deliverable_id: deliverableId,
    });
    return msgId;
  }

  /** Travel-aligned tool call card in the chat stream. */
  pushToolCall(name, args = {}, { status = "running" } = {}) {
    const id = `tool_${Date.now()}_${this.feed.length}`;
    const label = toolLabel(name);
    const argPreview = formatArgs(args);
    const html = `<div class="ecom-tool-card ${status === "done" ? "is-done" : ""}" data-tool-card>
      <div class="ecom-tool-card-head">
        <i class="spin" aria-hidden="true"></i>
        <span>${esc(L("正在使用工具", "Using tools"))}</span>
        <code>${esc(label)}</code>
      </div>
      <div class="ecom-tool-card-body"><code>${esc(name)}</code> ${esc(argPreview)}</div>
    </div>`;
    this.pushMessage({
      id,
      thread: "boss",
      from: "agent",
      kind: "tool",
      text_zh: label,
      text_en: label,
      html,
      meta: { tool: name, args, status },
    });
    return id;
  }

  finishToolCall(id, { ok = true, detail = "" } = {}) {
    const row = this.feed.find((m) => m.id === id);
    if (!row) return;
    const name = row.meta?.tool || "";
    const label = toolLabel(name);
    row.meta = { ...(row.meta || {}), status: "done", ok };
    row.html = `<div class="ecom-tool-card is-done" data-tool-card>
      <div class="ecom-tool-card-head">
        <span>${esc(ok ? L("工具完成", "Tool done") : L("工具失败", "Tool failed"))}</span>
        <code>${esc(label)}</code>
      </div>
      <div class="ecom-tool-card-body"><code>${esc(name)}</code> ${esc(detail || formatArgs(row.meta?.args || {}))}</div>
    </div>`;
    this.renderChat({ stick: true });
  }

  /** Replace an existing stream item's HTML (e.g. call: live → ended). */
  updateMessage(id, patch = {}) {
    const row = this.feed.find((m) => m.id === id);
    if (!row) return false;
    if (patch.html != null) row.html = patch.html;
    if (patch.kind != null) row.kind = patch.kind;
    if (patch.text != null) row.text = patch.text;
    if (patch.text_zh != null || patch.text_en != null) {
      row.text = pickLocale(patch, "text") || row.text;
    }
    this.renderChat({ stick: false });
    return true;
  }

  renderChat({ stick = true } = {}) {
    if (!this.messagesEl) return;
    const previousTop = this.messagesEl.scrollTop;
    const wasNearBottom =
      this.messagesEl.scrollHeight - this.messagesEl.clientHeight - this.messagesEl.scrollTop < 72;
    const list = this.feed.filter((m) => m.thread === "boss");
    if (!list.length) {
      this.messagesEl.innerHTML = `<div class="ecom-stream-empty">${esc(
        L("Agent 工作流将出现在这里", "Agent workstream will appear here")
      )}</div>`;
      return;
    }
    this.messagesEl.innerHTML = list
      .map((m) => {
        const mine = m.from === "agent";
        const kindClass = `kind-${String(m.kind || "text").replace(/[^a-z0-9_-]/gi, "")}`;
        const threadMeta =
          this.threads.find((t) => t.id === m.from || t.id === m.thread) || null;
        const who = mine
          ? "AI Agent"
          : threadMeta?.[getLocale() === "en" ? "name_en" : "name_zh"] || m.from;
        const avatarSrc = mine
          ? "assets/ecom/avatars/agent.webp"
          : threadMeta?.avatar_img || "";
        const avatarLetter = mine ? "AI" : threadMeta?.avatar || (who || "?").slice(0, 1);
        const avatarHtml = avatarSrc
          ? `<img class="ecom-stream-avatar" src="${esc(avatarSrc)}" alt="" />`
          : `<span class="ecom-stream-avatar is-letter">${esc(avatarLetter)}</span>`;
        if (m.kind === "deliverable") {
          return `<article class="ecom-stream-item ${kindClass} ${mine ? "mine" : ""}">
            <div class="ecom-stream-who">${avatarHtml}<span>${esc(who)}</span></div>
            <div class="ecom-msg-card">
              <div class="ecom-msg-card-label">${esc(L("交付结果", "Deliverable"))}</div>
              <div class="ecom-msg-card-body">${esc(m.text)}</div>
              <button type="button" class="ecom-msg-card-btn" data-deliv-btn="${esc(m.deliverableId || "")}">${esc(
            L("查看", "Open")
          )}</button>
            </div>
          </article>`;
        }
        if (m.html) {
          return `<article class="ecom-stream-item ${kindClass} ${mine ? "mine" : ""}">
            <div class="ecom-stream-who">${avatarHtml}<span>${esc(who)}</span></div>
            ${m.html}
          </article>`;
        }
        return `<article class="ecom-stream-item ${kindClass} ${mine ? "mine" : ""}">
          <div class="ecom-stream-who">${avatarHtml}<span>${esc(who)}</span></div>
          <div class="ecom-msg-bubble">${esc(m.text)}</div>
        </article>`;
      })
      .join("");
    this.messagesEl.querySelectorAll("[data-deliv-btn]").forEach((btn) => {
      btn.addEventListener("click", () => this.onFocusDeliverable(btn.dataset.delivBtn));
    });
    if (stick && wasNearBottom) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    else this.messagesEl.scrollTop = previousTop;
  }
}

function pickLocale(obj, key) {
  const zh = obj[`${key}_zh`] ?? obj[key];
  const en = obj[`${key}_en`] ?? obj[key];
  return getLocale() === "en" ? en || zh || "" : zh || en || "";
}

function toolLabel(name) {
  const map = {
    call_supplier: L("电话锁价", "Call supplier"),
    update_inventory_pricing: L("更新定价库存", "Update pricing"),
    publish_deliverable: L("发布交付物", "Publish deliverable"),
  };
  return map[name] || name;
}

function formatArgs(args) {
  if (!args || typeof args !== "object") return "";
  const en = getLocale() === "en";
  const rows = [];
  const supplier = args.supplier_id ?? args.supplierId;
  const topic = en ? args.topic_en ?? args.topic_zh ?? args.topic : args.topic_zh ?? args.topic_en ?? args.topic;
  const price = args.agreed_price ?? args.agreedPrice;
  if (supplier) rows.push(`${L("供应商", "Supplier")} · ${supplier}`);
  if (price != null) rows.push(`${L("目标价", "Target")} · ¥${price}/kg`);
  if (topic) rows.push(`${L("议题", "Topic")} · ${String(topic).slice(0, 64)}`);
  if (rows.length) return rows.join("　");
  const ignored = /_(zh|en)$/;
  return Object.entries(args)
    .filter(([key]) => !ignored.test(key))
    .slice(0, 3)
    .map(([key, value]) => `${humanizeKey(key)} · ${String(value).slice(0, 48)}`)
    .join("　");
}

function humanizeKey(key) {
  const labels = {
    unit_cost: L("单位成本", "Unit cost"),
    unit_price: L("售价", "Price"),
    stock: L("库存", "Stock"),
    sold: L("已售", "Sold"),
    title: L("标题", "Title"),
    kind: L("类型", "Type"),
  };
  return labels[key] || String(key).replace(/_/g, " ");
}
