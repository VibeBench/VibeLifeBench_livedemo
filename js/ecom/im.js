/**
 * Mock OpenClaw / agent workspace stream (center column).
 */

import { L, getLocale } from "../i18n.js?v=20260807-simple-chat";

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
  constructor({ messagesEl, tabsEl, onFocusDeliverable, onExternalFocus, onExternalMessage, onReplay } = {}) {
    this.messagesEl = messagesEl;
    this.tabsEl = tabsEl;
    this.onFocusDeliverable = onFocusDeliverable || (() => {});
    this.onExternalFocus = onExternalFocus || (() => {});
    this.onExternalMessage = onExternalMessage || (() => {});
    this.onReplay = onReplay || (() => {});
    this.threads = [];
    this.feed = [];
    this.activeTab = "all";
    this.activeThread = null;
    this._thinking = null;
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
    this._thinking = null;
    this.activeThread = threads[0]?.id || null;
    this.activeTab = "all";
    this.tabsEl?.querySelectorAll("[data-tab]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.tab === "all");
    });
    this.renderChat();
  }

  /** Ephemeral Manus-style thinking rail under the boss stream. */
  showThinking(label = "", reason = "") {
    this._thinking = {
      label: label || L("核对中", "Checking"),
      reason: reason || "",
    };
    this._mountThinking();
  }

  hideThinking() {
    this._thinking = null;
    this.messagesEl?.querySelector(".ecom-thinking")?.remove();
  }

  _thinkingBeatHtml(modeKey = "planning") {
    const beat =
      modeKey === "observing"
        ? "sense"
        : modeKey === "acting" || modeKey === "communicating"
          ? "act"
          : modeKey === "verified"
            ? "check"
            : "think";
    const en = getLocale() === "en";
    const steps = [
      { id: "sense", zh: "感", en: "S" },
      { id: "think", zh: "想", en: "T" },
      { id: "act", zh: "做", en: "A" },
    ];
    const order = { sense: 0, think: 1, act: 2, check: 3 };
    const cur = order[beat] ?? 1;
    return `<span class="ecom-thinking-beat" data-beat="${esc(beat)}" aria-hidden="true">${steps
      .map((s, i) => {
        const state =
          beat === "check" || i < cur ? "is-done" : i === cur ? "is-on" : "";
        return `<b class="${state}">${esc(en ? s.en : s.zh)}</b>`;
      })
      .join("<i></i>")}</span>`;
  }

  _mountThinking() {
    if (!this.messagesEl || !this._thinking) return;
    let el = this.messagesEl.querySelector(".ecom-thinking");
    if (!el) {
      el = document.createElement("div");
      el.className = "ecom-thinking";
      this.messagesEl.appendChild(el);
    }
    const label = typeof this._thinking === "string" ? this._thinking : this._thinking.label;
    el.classList.remove("is-dual");
    el.innerHTML = `<i></i><i></i><i></i><span class="ecom-thinking-copy"><em>${esc(
      label
    )}</em></span>`;
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
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
    this._pulseChatMode(id);
    this.renderChat({ stick: true });
  }

  /** Surface who Agent is coordinating with in the unified stream header. */
  _pulseChatMode(threadId = "boss") {
    const mode = document.querySelector(".ecom-chat-mode-tabs > span");
    if (!mode) return;
    const en = getLocale() === "en";
    if (threadId && threadId !== "boss") {
      const meta = this.threads.find((t) => t.id === threadId);
      const name = en ? meta?.name_en || meta?.name_zh || threadId : meta?.name_zh || meta?.name_en || threadId;
      mode.textContent = L(`对接 · ${name}`, `Chat · ${name}`);
      mode.classList.add("is-live");
    } else {
      mode.textContent = L("对话", "Chat");
      mode.classList.remove("is-live");
    }
    mode.classList.remove("is-pulse");
    void mode.offsetWidth;
    mode.classList.add("is-pulse");
    window.clearTimeout(this._modePulseTimer);
    this._modePulseTimer = window.setTimeout(() => mode.classList.remove("is-pulse"), 780);
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
    this._freshId = row.id;
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
    const steps = toolSteps(name);
    const html = toolCardHtml({ name, label, args, status, steps, stepIdx: 0 });
    this.pushMessage({
      id,
      thread: "boss",
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
    const steps = row.meta.steps || toolSteps(row.meta.tool);
    const idx = Math.max(0, Math.min(stepIdx, steps.length - 1));
    row.meta = { ...row.meta, stepIdx: idx, status: "running" };
    row.html = toolCardHtml({
      name: row.meta.tool,
      label: toolLabel(row.meta.tool),
      args: row.meta.args || {},
      status: "running",
      steps,
      stepIdx: idx,
    });
    this.renderChat({ stick: true });
  }

  finishToolCall(id, { ok = true, detail = "" } = {}) {
    const row = this.feed.find((m) => m.id === id);
    if (!row) return;
    const name = row.meta?.tool || "";
    const label = toolLabel(name);
    const steps = row.meta?.steps || toolSteps(name);
    row.meta = { ...(row.meta || {}), status: "done", ok, stepIdx: steps.length };
    row.html = toolCardHtml({
      name,
      label,
      args: row.meta?.args || {},
      status: "done",
      ok,
      detail: detail || formatArgs(row.meta?.args || {}),
      steps,
      stepIdx: steps.length,
      next: ok ? toolNext(name) : "",
    });
    this.renderChat({ stick: true });
    if (ok) this._pulseChatMode(this.activeThread || "boss");
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

  _streamKindTag(kind = "text") {
    return (
      {
        stage: L("幕切换", "Act"),
        world: L("外部信号", "World"),
        discovery: L("已核对", "Verified"),
        notify: L("通知", "Notice"),
        tool: L("工具", "Tool"),
        call: L("通话", "Call"),
        pack: L("包装", "Pack"),
        edit: L("剪辑", "Edit"),
        table: L("比价", "Compare"),
        pricing: L("定价", "Pricing"),
        wrapup: L("收尾", "Wrap-up"),
        deliverable: L("交付", "Output"),
        note: L("笔记", "Note"),
        video: L("视频", "Video"),
        quote: L("报价", "Quote"),
        profit: L("利润", "Profit"),
      }[kind] || ""
    );
  }

  renderChat({ stick = true } = {}) {
    if (!this.messagesEl) return;
    const previousTop = this.messagesEl.scrollTop;
    const wasNearBottom =
      this.messagesEl.scrollHeight - this.messagesEl.clientHeight - this.messagesEl.scrollTop < 72;
    // Keep the conversation pane conversational. Rich execution cards remain
    // available in Playground / Dock instead of repeating inside the chat.
    const list = this.feed.filter(
      (m) => m.thread === "boss" && (!m.html || Boolean(m.deliverableId))
    );
    if (!list.length) {
      this.messagesEl.innerHTML = `<div class="ecom-stream-empty is-simple">
        <strong>${esc(L("对话会出现在这里", "Conversation will appear here"))}</strong>
        <p>${esc(L("执行细节请看右侧 Playground", "See Playground for execution details"))}</p>
      </div>`;
      return;
    }
    this.messagesEl.innerHTML = list
      .map((m) => {
        const mine = m.from === "agent";
        const arrive = m.id === this._freshId ? "is-arrive" : "";
        const kind = String(m.kind || "text");
        const kindClass = `kind-${kind.replace(/[^a-z0-9_-]/gi, "")}`;
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
        const whoMeta = `${avatarHtml}<span>${esc(who)}</span>`;
        if (m.deliverableId) {
          return `<article class="ecom-stream-item ${kindClass} ${mine ? "mine" : ""} ${arrive} ${
            "is-output"
          }">
            <div class="ecom-stream-who">${whoMeta}</div>
            <div class="ecom-msg-card is-simple">
              <div class="ecom-msg-card-body">${esc(
                L(`已完成：${m.text}`, `Done: ${m.text}`)
              )}</div>
              <button type="button" class="ecom-msg-card-btn" data-deliv-btn="${esc(m.deliverableId || "")}">${esc(
                L("查看", "Open")
              )}</button>
            </div>
          </article>`;
        }
        return `<article class="ecom-stream-item ${kindClass} ${mine ? "mine" : ""} ${arrive}">
          <div class="ecom-stream-who">${whoMeta}</div>
          <div class="ecom-msg-bubble">${esc(m.text)}</div>
        </article>`;
      })
      .join("");
    this.messagesEl.querySelectorAll("[data-deliv-btn]").forEach((btn) => {
      btn.addEventListener("click", () => this.onFocusDeliverable(btn.dataset.delivBtn));
    });
    this.messagesEl.querySelectorAll("[data-ecom-wrapup-replay]").forEach((btn) => {
      btn.addEventListener("click", () => this.onReplay?.());
    });
    if (this._thinking) this._mountThinking();
    if (stick && wasNearBottom) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    else this.messagesEl.scrollTop = previousTop;
    if (this._freshId) {
      window.clearTimeout(this._freshTimer);
      this._freshTimer = window.setTimeout(() => {
        this._freshId = null;
      }, 520);
    }
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

function toolSteps(name) {
  const map = {
    call_supplier: [
      L("拨号并建立通话", "Dial and connect"),
      L("确认价格与条款", "Confirm price & terms"),
      L("写回锁单结果", "Write back lock result"),
    ],
    update_inventory_pricing: [
      L("读取成本结构", "Read cost structure"),
      L("更新售价 / 库存", "Update price / stock"),
      L("校验毛利红线", "Check margin floor"),
    ],
    publish_deliverable: [
      L("收集素材与文案", "Collect assets & copy"),
      L("生成交付物", "Generate deliverable"),
      L("挂到任务结果", "Pin to results"),
    ],
  };
  return (
    map[name] || [
      L("准备参数", "Prepare args"),
      L("执行调用", "Execute call"),
      L("写回结果", "Write result"),
    ]
  );
}

function toolWhy(name, args = {}) {
  const map = {
    call_supplier: L("需要锁价与交期，直接通话比邮件更快", "Need price + lead time — a call is faster than email"),
    update_inventory_pricing: L("把核对后的售价/库存写回经营表，避免账实漂移", "Write verified price/stock back so the ledger stays truthful"),
    publish_deliverable: L("把已完成产出固定到交付物 Dock，方便随时回看", "Pin finished output to the deliverable dock for later review"),
    web_search: L("先核对外界信号，再决定是否改价/补货", "Verify external signals before repricing / restock"),
    check_inventory: L("对照销量回写，确认库存是否触线", "Match sales writebacks against stock thresholds"),
    draft_pack: L("包装必须先过合规，再进印刷", "Pack must clear compliance before print"),
    edit_video: L("短视频素材要跟上本周卖点", "Clip assets need to match this week’s pitch"),
    send_email: L("把已确认条款落成可追溯沟通", "Turn confirmed terms into a traceable thread"),
    price_sim: L("测算毛利空间后再写回定价表", "Model margin room before writing the price sheet"),
  };
  if (map[name]) return map[name];
  if (args?.supplier_id || args?.supplierId) {
    return L("围绕供应商条款做一次可验证调用", "Run a verifiable call around supplier terms");
  }
  return L("为当前阶段补齐必要事实", "Fill facts required by the current act");
}

function toolNext(name) {
  const map = {
    call_supplier: L("下一步：生成锁单备忘 → 进入包装/上架链路", "Next: lock memo → move into pack / launch"),
    update_inventory_pricing: L("下一步：校验毛利与库存触线 → 继续销售节奏", "Next: verify margin & stock floor → keep the sales cadence"),
    publish_deliverable: L("下一步：交付物已落盘 Dock，继续本幕剩余动作", "Next: output pinned in Dock — finish remaining act steps"),
  };
  return map[name] || L("下一步：按执行计划推进", "Next: continue along the plan");
}

function toolCardHtml({ name, label, args, status, ok = true, detail = "", steps = [], stepIdx = 0, next = "" }) {
  const running = status !== "done";
  const why = toolWhy(name, args);
  const dual = document.querySelector("#ecomParallelStrip")?.classList.contains("is-on");
  const beatIdx = running ? Math.min(stepIdx, Math.max(0, steps.length - 1)) : steps.length;
  const beatLabels = [L("感", "S"), L("想", "T"), L("做", "A")];
  const beatHtml = `<span class="ecom-tool-beat" aria-hidden="true">${beatLabels
    .map((b, i) => {
      const state = !running && ok ? "is-done" : i < beatIdx ? "is-done" : i === beatIdx && running ? "is-on" : "";
      return `<b class="${state}">${esc(b)}</b>`;
    })
    .join("<i></i>")}</span>`;
  const stepsHtml = steps
    .map((s, i) => {
      const state = !running && ok ? "is-done" : i < stepIdx ? "is-done" : i === stepIdx && running ? "is-active" : "";
      return `<li class="${state}"><i></i><span>${esc(s)}</span></li>`;
    })
    .join("");
  const head = running
    ? `<i class="spin" aria-hidden="true"></i>
        <span>${esc(L("正在使用工具", "Using tools"))}</span>
        <code>${esc(label)}</code>
        ${beatHtml}`
    : `<span class="ecom-tool-check ${ok ? "is-ok" : "is-bad"}" aria-hidden="true"></span>
        <span>${esc(ok ? L("工具完成", "Tool done") : L("工具失败", "Tool failed"))}</span>
        <code>${esc(label)}</code>
        ${beatHtml}`;
  const nextHtml =
    !running && ok && next ? `<p class="ecom-next-action ecom-tool-next">${esc(next)}</p>` : "";
  const dualHtml = dual
    ? `<p class="ecom-tool-dual"><i></i><em>${esc(
        running
          ? L("双轨：你忙门店 · 我在可验证调用里推进", "Dual-track: you on floor · I advance via verifiable calls")
          : L("双轨：结果已写回 · 门店事务可继续", "Dual-track: result recorded · floor work can continue")
      )}</em></p>`
    : "";
  const body = running
    ? `<p class="ecom-tool-why">${esc(L("意图", "Why"))} · ${esc(why)}</p>
        <div class="ecom-tool-args">${esc(formatArgs(args))}</div>
        <ol class="ecom-tool-steps">${stepsHtml}</ol>
        ${dualHtml}`
    : `<p class="ecom-tool-why">${esc(L("意图", "Why"))} · ${esc(why)}</p>
        <div class="ecom-tool-args">${esc(detail || formatArgs(args))}</div>
        <ol class="ecom-tool-steps">${stepsHtml}</ol>
        ${dualHtml}
        ${nextHtml}`;
  return `<div class="ecom-tool-card ${running ? "" : "is-done"} ${ok ? "" : "is-failed"} ${
    dual ? "is-dual" : ""
  }" data-tool-card>
      <div class="ecom-tool-card-head">${head}</div>
      <div class="ecom-tool-card-body">${body}</div>
    </div>`;
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
