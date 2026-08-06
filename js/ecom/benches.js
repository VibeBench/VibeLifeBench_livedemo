/**
 * Playground benches — call streaming transcript + agentic pack/video editing.
 */

import { L, getLocale } from "../i18n.js?v=20260807-editor";
import { sleepPlayback } from "../playback.js?v=20260807-editor";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function transcriptChunks(text) {
  const value = String(text || "");
  if (/[一-龥]/.test(value)) {
    const chars = Array.from(value);
    const chunks = [];
    for (let i = 0; i < chars.length; ) {
      const punctuationAt = chars.slice(i, i + 5).findIndex((ch) => /[，。；：！？、]/.test(ch));
      const size = punctuationAt >= 1 ? punctuationAt + 1 : Math.min(3, chars.length - i);
      chunks.push(chars.slice(i, i + size).join(""));
      i += size;
    }
    return chunks;
  }
  return value.match(/\S+\s*/g) || [];
}

export class EcomBenches {
  constructor({ stageEl, tabsEl, playgroundEl, titleEl, onRichCard, onUpdateCard } = {}) {
    this.stageEl = stageEl;
    this.tabsEl = tabsEl;
    this.playgroundEl = playgroundEl || document.querySelector("#ecomPlayground");
    this.titleEl = titleEl || document.querySelector("#ecomPlayTitle");
    this.onRichCard = onRichCard || (() => {});
    this.onUpdateCard = onUpdateCard || (() => {});
    this.active = "idle";
    this.sheet = { headers: [], rows: [] };
    this._animToken = 0;
    this._callState = null;
    this._editState = null;
    this._packState = null;
    this.commThreads = [];
    this.commFeed = [];
    this.activeCommThread = null;
    tabsEl?.querySelectorAll("[data-bench]").forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener("click", () => this.switchBench(btn.dataset.bench, { user: true }));
    });
  }

  reset(seed) {
    this._animToken += 1;
    const headers = getLocale() === "en" ? seed?.sheet?.headers_en : seed?.sheet?.headers_zh;
    this.sheet = {
      headers: headers || [],
      rows: (seed?.sheet?.rows || []).map((r) => r.slice()),
    };
    this.seed = seed;
    this._callState = null;
    this._editState = null;
    this._packState = null;
    this.commThreads = (seed?.threads || []).filter((t) => t.id !== "boss");
    this.commFeed = [];
    this.activeCommThread = this.commThreads[0]?.id || null;
    this.active = "comms";
    this.tabsEl?.querySelectorAll("[data-bench]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.bench === "comms");
    });
    this.renderPlayground();
  }

  media(key) {
    return this.seed?.media?.[key] || "";
  }

  setTitle(text) {
    if (this.titleEl) this.titleEl.textContent = text || "—";
  }

  switchBench(id, { user = false } = {}) {
    if (!id || id === "web" || id === "files") return;
    const changed = this.active !== id;
    this.active = id;
    if (changed && this.playgroundEl) {
      this.playgroundEl.classList.remove("is-switching");
      void this.playgroundEl.offsetWidth;
      this.playgroundEl.classList.add("is-switching");
      window.setTimeout(() => this.playgroundEl?.classList.remove("is-switching"), 260);
    }
    this.tabsEl?.querySelectorAll("[data-bench]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.bench === id);
    });
    if (user) this.renderPlayground();
    else this.renderDock();
  }

  renderDock() {
    if (this.stageEl) {
      this.stageEl.hidden = true;
      this.stageEl.innerHTML = "";
    }
    this.renderPlayground();
  }

  render() {
    this.renderDock();
  }

  updateSheetFromKpi(kpi, skuName) {
    const margin =
      kpi.unitPrice > 0 ? `${(((kpi.unitPrice - kpi.unitCost) / kpi.unitPrice) * 100).toFixed(1)}%` : "—";
    this.sheet.rows = [
      [
        skuName || "drip-yunnan-12",
        kpi.unitCost ? `¥${kpi.unitCost}` : "—",
        kpi.unitPrice ? `¥${kpi.unitPrice}` : "—",
        String(kpi.stock ?? 0),
        String(kpi.sold ?? 0),
        kpi.refunds ? `¥${kpi.refunds}` : "0",
        margin,
      ],
    ];
    if (this.active === "sheet") this.renderPlayground();
  }

  showDeliverable(item = {}) {
    this.active = "deliverable";
    this._deliverable = item;
    this.renderPlayground();
  }

  renderPlayground() {
    const el = this.playgroundEl;
    if (!el) return;
    const mode = this.active || "idle";

    if (mode === "comms") {
      this._renderCommunication();
      return;
    }

    if (mode === "idle") {
      this.setTitle(L("等待任务…", "Waiting for a task…"));
      el.innerHTML = `<div class="ecom-play-empty">${esc(
        L("任务进行时，这里会放大显示：通话转写 · 包装设计 · 视频剪辑 · 定价表", "Live task surface: call transcript · pack · video edit · pricing")
      )}</div>`;
      return;
    }

    if (mode === "phone" || mode === "call") {
      const c = this._callState || {};
      this.setTitle(c.name ? L(`通话 · ${c.name}`, `Call · ${c.name}`) : L("供应商通话", "Supplier call"));
      el.innerHTML = `<div class="ecom-play-panel">${this._callSurfaceHtml(c)}</div>`;
      this._scrollTranscript();
      return;
    }

    if (mode === "pack") {
      this.setTitle(this._packState?.label || this._packLabel || L("包装设计", "Pack design"));
      el.innerHTML = `<div class="ecom-play-panel">${this._packSurfaceHtml()}</div>`;
      return;
    }

    if (mode === "edit") {
      this.setTitle(this._editState?.label || this._editLabel || L("视频剪辑", "Video edit"));
      el.innerHTML = `<div class="ecom-play-panel">${this._editSurfaceHtml()}</div>`;
      return;
    }

    if (mode === "sheet") {
      this.setTitle(L("库存与定价", "Inventory & pricing"));
      const heads = (this.sheet.headers || []).map((h) => `<th>${esc(h)}</th>`).join("");
      const rows = (this.sheet.rows || [])
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
        .join("");
      el.innerHTML = `<div class="ecom-play-panel"><div class="ecom-rich ecom-rich-table">
        <table><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>
      </div></div>`;
      return;
    }

    if (mode === "deliverable" && this._deliverable) {
      const d = this._deliverable;
      const title = getLocale() === "en" ? d.title_en || d.title_zh : d.title_zh || d.title_en;
      this.setTitle(title || L("交付物", "Deliverable"));
      const cover = d.cover || "";
      const body = getLocale() === "en" ? d.body_en || d.body_zh : d.body_zh || d.body_en;
      el.innerHTML = `<div class="ecom-play-panel">
        ${cover ? `<img class="ecom-play-hero" src="${esc(cover)}" alt="" />` : ""}
        <pre style="margin-top:12px;white-space:pre-wrap;font:inherit;color:#475569">${esc(body || "")}</pre>
      </div>`;
      return;
    }

    this.setTitle("—");
    el.innerHTML = `<div class="ecom-play-empty">—</div>`;
  }

  focusCommunication(threadId, { reveal = true } = {}) {
    if (!threadId || threadId === "boss") return;
    this.activeCommThread = threadId;
    if (reveal) {
      this.switchBench("comms");
    }
  }

  pushCommunication(row, { reveal = true } = {}) {
    if (!row?.thread || row.thread === "boss") return;
    const idx = this.commFeed.findIndex((m) => m.id === row.id);
    if (idx >= 0) this.commFeed[idx] = row;
    else this.commFeed.push(row);
    this.activeCommThread = row.thread;
    if (reveal) {
      this.switchBench("comms");
    }
  }

  _renderCommunication() {
    const el = this.playgroundEl;
    if (!el) return;
    const localeKey = getLocale() === "en" ? "name_en" : "name_zh";
    const thread =
      this.commThreads.find((t) => t.id === this.activeCommThread) || this.commThreads[0] || null;
    if (thread && !this.activeCommThread) this.activeCommThread = thread.id;
    const messages = this.commFeed.filter((m) => m.thread === thread?.id);
    const contacts = this.commThreads
      .map((t) => {
        const name = t[localeKey] || t.name_zh || t.name_en || t.id;
        const last = [...this.commFeed].reverse().find((m) => m.thread === t.id);
        const unread =
          t.id === thread?.id ? 0 : this.commFeed.filter((m) => m.thread === t.id && m.from !== "agent").length;
        const clock = last
          ? new Intl.DateTimeFormat(getLocale() === "en" ? "en" : "zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }).format(new Date(last.ts))
          : "";
        return `<button type="button" class="ecom-comms-contact ${
          t.id === thread?.id ? "is-active" : ""
        }" data-comm-thread="${esc(t.id)}">
          ${
            t.avatar_img
              ? `<img src="${esc(t.avatar_img)}" alt="" />`
              : `<span class="avatar-letter">${esc(t.avatar || name.slice(0, 1))}</span>`
          }
          <span class="ecom-contact-copy">
            <span class="ecom-contact-row"><strong>${esc(name)}</strong><time>${esc(clock)}</time></span>
            <span class="ecom-contact-preview"><small>${esc(
              last?.text || L("等待消息", "No messages yet")
            )}</small>${unread ? `<b>${Math.min(unread, 9)}</b>` : ""}</span>
          </span>
        </button>`;
      })
      .join("");
    const threadName = thread?.[localeKey] || thread?.name_zh || thread?.name_en || L("协作消息", "Messages");
    const bubbles = messages.length
      ? messages
          .map((m) => {
            const mine = m.from === "agent";
            return `<div class="ecom-app-msg ${mine ? "is-mine" : "is-peer"}">
              <span class="ecom-app-msg-who">${esc(mine ? "AI Agent" : threadName)}</span>
              ${m.html ? m.html : `<div class="ecom-app-bubble">${esc(m.text)}</div>`}
            </div>`;
          })
          .join("")
      : `<div class="ecom-app-empty"><span class="ecom-empty-illustration">•••</span><strong>${esc(
          L("暂无消息", "No messages")
        )}</strong><small>${esc(
          L("由 Agent 创建或触发对话后，消息将显示在这里", "Messages appear here when the agent starts a conversation")
        )}</small></div>`;
    this.setTitle(L(`协作消息 · ${threadName}`, `Messages · ${threadName}`));
    el.innerHTML = `<div class="ecom-comms-app">
      <aside class="ecom-comms-contacts">
        <div class="ecom-comms-brand"><strong>${esc(L("协作 IM", "Team inbox"))}</strong><span>⌕　＋</span></div>
        ${contacts}
      </aside>
      <section class="ecom-comms-thread">
        <header><span class="ecom-online-dot"></span><strong>${esc(threadName)}</strong><small>${esc(
          L("应用内沟通", "In-app conversation")
        )}</small></header>
        <div class="ecom-app-messages">${bubbles}</div>
        <div class="ecom-app-composer"><span>${esc(L("由 Agent 自动沟通…", "Agent is handling this conversation…"))}</span><button type="button">➤</button></div>
      </section>
    </div>`;
    el.querySelectorAll("[data-comm-thread]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeCommThread = btn.dataset.commThread;
        this._renderCommunication();
      });
    });
    const msgBox = el.querySelector(".ecom-app-messages");
    if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;
  }

  _scrollTranscript() {
    const box = this.playgroundEl?.querySelector(".ecom-stream-log");
    if (box) box.scrollTop = box.scrollHeight;
  }

  /* —— Call: card + streaming ASR transcript —— */

  _callSurfaceHtml(c = {}) {
    const lines = c.lines || [];
    const streaming = c.streamingLine;
    const live = c.phase !== "ended";
    return `${this._callCardHtml(c)}
      <div class="ecom-stream-panel">
        <div class="ecom-stream-panel-head">
          <span class="ecom-pill ${live ? "is-live" : "is-done"}">${esc(
            live ? L("实时转写", "Live transcript") : L("通话转写", "Transcript")
          )}</span>
          <span class="ecom-stream-hint">${esc(L("ASR · streaming", "ASR · streaming"))}</span>
        </div>
        <div class="ecom-stream-log">
          ${lines
            .map(
              (ln) => `<div class="ecom-stream-line is-${esc(ln.role)}">
              <span class="who">${esc(ln.who)}</span>
              <span class="text">${esc(ln.text)}</span>
            </div>`
            )
            .join("")}
          ${
            streaming
              ? `<div class="ecom-stream-line is-${esc(streaming.role)} is-typing">
                  <span class="who">${esc(streaming.who)}</span>
                  <span class="text">${esc(streaming.text)}</span>
                </div>`
              : ""
          }
        </div>
      </div>`;
  }

  _callCardHtml({ name, topic, note, agreedPrice, phase = "live", timer = "00:00" } = {}) {
    const live = phase === "live";
    const pill = live
      ? `<span class="ecom-pill is-live">${esc(L("通话中", "On call"))}</span>`
      : `<span class="ecom-pill is-done">${esc(L("已结束", "Ended"))}</span>`;
    const title = live
      ? L("正在通话：", "On call with: ") + (name || "")
      : L("通话结束：", "Call ended · ") + (name || "");
    return `<div class="ecom-rich ecom-rich-call ${live ? "is-live" : "is-ended"}">
      <div class="ecom-rich-head">
        ${pill}
        <strong>${esc(title)}</strong>
        <span class="ecom-timer">${esc(timer)}</span>
      </div>
      <div class="ecom-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      ${note && phase === "ended" ? `<p class="ecom-call-note muted">${esc(note)}</p>` : ""}
    </div>`;
  }

  async _streamLine({ who, role, text, chunkMs = 36 }) {
    const state = this._callState;
    if (!state) return;
    state.streamingLine = { who, role, text: "" };
    const log = this.playgroundEl?.querySelector(".ecom-stream-log");
    const row = document.createElement("div");
    row.className = `ecom-stream-line is-${role} is-typing`;
    row.innerHTML = `<span class="who">${esc(who)}</span><span class="text"></span>`;
    log?.appendChild(row);
    this._scrollTranscript();
    const chunks = transcriptChunks(text);
    let acc = "";
    for (let i = 0; i < chunks.length; i++) {
      if (this._animToken !== state.token) return;
      acc += chunks[i];
      state.streamingLine = { who, role, text: acc };
      const typing = row.querySelector(".text");
      if (typing) {
        typing.textContent = acc;
        this._scrollTranscript();
      }
      await sleepPlayback(Math.max(70, chunkMs * 2.5), { min: 38, max: 110 });
    }
    state.lines = [...(state.lines || []), { who, role, text }];
    state.streamingLine = null;
    row.classList.remove("is-typing");
  }

  async playCall({ name, topic, note, durationMs = 5200, agreedPrice, thread = "bean_b" } = {}) {
    const token = ++this._animToken;
    this.switchBench("phone");
    const agentWho = "AI Agent";
    const peer = name || L("供应商", "Supplier");
    const open =
      topic || L("想按量谈批发价，并确认交期与质检条款。", "Want volume pricing, lead time and QC terms.");
    const close =
      note ||
      L("好的，我这边锁单并同步财务预留预算。", "Great — I'll lock the PO and reserve finance budget.");
    const price = agreedPrice || 64;
    const lines = [
      {
        who: agentWho,
        role: "agent",
        text: L(`您好，我是品牌采购 Agent。这次主要想确认：${open}`, `Hi, I'm the brand's purchasing agent. I need to confirm: ${open}`),
      },
      {
        who: peer,
        role: "peer",
        text: L(
          "可以。当前批次农残、重金属和杯测报告都齐全，今天可以先发扫描件，原件随货。",
          "Sure. Pesticide, heavy-metal and cupping reports are complete. Scans can go today; originals ship with the order."
        ),
      },
      {
        who: agentWho,
        role: "agent",
        text: L(
          "首单按 80kg 测市场，要求同一批次、含水率和瑕疵率写进合同。价格能否按长期合作价再调？",
          "We'll test with 80kg from one lot. Moisture and defect limits must be in the contract. Can you offer a long-term partner rate?"
        ),
      },
      {
        who: peer,
        role: "peer",
        text: L(
          `80kg 可以做到 ¥${price}/kg，收到定金后 7 天内出库。批次杯测分不低于 84，发货前可留封样。`,
          `For 80kg we can do ¥${price}/kg and ship within 7 days after deposit. Cupping score is at least 84, with a sealed pre-shipment sample.`
        ),
      },
      {
        who: agentWho,
        role: "agent",
        text: L(
          "质检条款再确认一下：到仓抽检不合格时，整批可退换，往返物流由供方承担；同时不接受临时换批。",
          "One more QC point: if arrival sampling fails, the full lot is replaceable or refundable, return freight paid by supplier, and no lot substitution."
        ),
      },
      {
        who: peer,
        role: "peer",
        text: L(
          "可以写入合同。付款按 30% 定金、验收后付尾款；如果产能或交期变化，我们至少提前 72 小时通知。",
          "Agreed. Payment is 30% deposit and balance after acceptance. Any capacity or lead-time change will be flagged at least 72 hours ahead."
        ),
      },
      {
        who: agentWho,
        role: "agent",
        text: L(
          `收到，我记录的是：¥${price}/kg、80kg、7 天出库、封样验货、不合格可退换。我现在生成锁单纪要，请您线上确认。`,
          `Got it: ¥${price}/kg, 80kg, ship in 7 days, sealed sample inspection, reject/replace protection. I'll generate the order-lock memo for confirmation.`
        ),
      },
      { who: peer, role: "peer", text: L("信息无误，可以确认。", "Everything is correct. Confirmed.") },
    ];

    this._callState = {
      token,
      name: peer,
      topic: open,
      note: "",
      agreedPrice,
      phase: "live",
      timer: "00:08",
      lines: [],
      streamingLine: null,
    };
    this.renderPlayground();

    const cardId = `call_${Date.now()}`;
    const msgId = this.onRichCard({
      id: cardId,
      thread,
      kind: "call",
      title: peer,
      bodyHtml: this._callCardHtml(this._callState),
    });

    for (let i = 0; i < lines.length; i++) {
      await this._streamLine({ ...lines[i], chunkMs: lines[i].role === "agent" ? 24 : 27 });
      if (token !== this._animToken) return;
      this._callState.timer = `0${Math.floor((i * 24 + 18) / 60)}:${String((i * 24 + 18) % 60).padStart(2, "0")}`;
      const timer = this.playgroundEl?.querySelector(".ecom-rich-call .ecom-timer");
      if (timer) timer.textContent = this._callState.timer;
      if (i === 3) {
        this.onUpdateCard?.(msgId || cardId, { html: this._callCardHtml(this._callState) });
      }
      await sleepPlayback(240, { min: 120, max: 360 });
    }

    await sleepPlayback(Math.max(800, durationMs * 0.15), { min: 600, max: 2000 });
    this._callState.phase = "ended";
    this._callState.timer = "03:21";
    this._callState.note = note || close;
    this.renderPlayground();
    this.onUpdateCard?.(msgId || cardId, { html: this._callCardHtml(this._callState) });
  }

  /* —— Pack: agentic continuous design —— */

  _packSurfaceHtml() {
    const s = this._packState || {};
    const src = s.src || this.media("pack_v2");
    const steps = s.steps || [];
    const pct = s.pct ?? 0;
    return `<div class="ecom-agentic-surface is-pack ${s.busy ? "is-busy" : ""}">
      <div class="ecom-agentic-canvas">
        <img class="ecom-play-hero ${s.busy ? "is-scrubbing" : ""}" src="${esc(src)}" alt="" />
        ${s.busy ? `<div class="ecom-agentic-cursor" style="--x:${s.cx || 62}%;--y:${s.cy || 38}%"></div>` : ""}
        <div class="ecom-agentic-badge">${esc(s.badge || "Agent editing")}</div>
      </div>
      <div class="ecom-agentic-side">
        <div class="ecom-agentic-progress"><i style="width:${esc(pct)}%"></i></div>
        <div class="ecom-agentic-log">
          ${steps
            .map(
              (st, i) =>
                `<div class="ecom-agentic-step ${i === steps.length - 1 && s.busy ? "is-active" : "is-done"}">
                  <span class="dot"></span><span>${esc(st)}</span>
                </div>`
            )
            .join("")}
        </div>
        <div class="ecom-pack-swatches"><i style="--c:#6b3f2a"></i><i style="--c:#c4a35a"></i><i style="--c:#f3ebe2"></i><i style="--c:#2c211c"></i></div>
      </div>
    </div>`;
  }

  _syncPackSurface() {
    const state = this._packState;
    const root = this.playgroundEl;
    if (!state || !root) return;
    const progress = root.querySelector(".ecom-agentic-progress i");
    const cursor = root.querySelector(".ecom-agentic-cursor");
    const badge = root.querySelector(".ecom-agentic-badge");
    const image = root.querySelector(".ecom-play-hero");
    const log = root.querySelector(".ecom-agentic-log");
    if (progress) progress.style.width = `${state.pct}%`;
    if (cursor) {
      cursor.style.setProperty("--x", `${state.cx}%`);
      cursor.style.setProperty("--y", `${state.cy}%`);
    }
    if (badge) badge.textContent = state.badge || "";
    if (image && state.src && image.getAttribute("src") !== state.src) image.setAttribute("src", state.src);
    if (log) {
      log.innerHTML = (state.steps || [])
        .map(
          (step, index, rows) => `<div class="ecom-agentic-step ${
            index === rows.length - 1 && state.busy ? "is-active" : "is-done"
          }"><span class="dot"></span><span>${esc(step)}</span></div>`
        )
        .join("");
      log.scrollTop = log.scrollHeight;
    }
  }

  /* —— Edit: agentic continuous cut —— */

  _editSurfaceHtml() {
    const s = this._editState || {};
    const poster = s.poster || this.media("video_poster") || "assets/ecom/video_poster.webp";
    const sourceImages = [
      this.media("sku_hero") || poster,
      this.media("note_v2") || poster,
      poster,
      this.media("pack_v2") || poster,
    ];
    const clips = s.clips || [
      { id: "c1", label: L("开箱", "Unbox"), on: false },
      { id: "c2", label: L("冲煮", "Brew"), on: false },
      { id: "c3", label: L("字幕", "Caption"), on: false },
      { id: "c4", label: "CTA", on: false },
    ];
    const steps = s.steps || [];
    const pct = s.pct ?? 0;
    const playhead = s.playhead ?? 8;
    return `<div class="ecom-agentic-surface is-edit ${s.busy ? "is-busy" : ""}">
      <div class="ecom-agentic-canvas">
        <div class="ecom-editor">
          <header class="ecom-editor-toolbar">
            <span class="ecom-editor-logo">V</span>
            <strong>${esc(L("山醒_种草成片_v03", "SHANXING_social_v03"))}</strong>
            <span>${esc(L("序列 01", "Sequence 01"))}</span>
            <i></i>
            <small>1080 × 1920 · 25fps</small>
          </header>
          <div class="ecom-editor-workspace">
            <aside class="ecom-media-bin">
              <div class="ecom-media-bin-head"><strong>${esc(L("素材", "Media"))}</strong><span>4</span></div>
              ${sourceImages
                .map(
                  (src, index) => `<div class="ecom-media-item ${index === s.activeClip ? "is-active" : ""}">
                    <img src="${esc(src)}" alt="" />
                    <span>${esc(
                      [L("产品主图", "Product"), L("冲煮特写", "Brew macro"), L("竖版主镜", "Hero shot"), L("包装镜头", "Pack")][
                        index
                      ]
                    )}</span>
                  </div>`
                )
                .join("")}
            </aside>
            <section class="ecom-program-monitor">
              <div class="ecom-monitor-top"><span>${esc(L("节目", "Program"))}</span><small>Fit 42%</small></div>
              <div class="ecom-viewer-stage">
                <div class="ecom-vertical-preview ${s.busy ? "is-scrubbing" : ""}">
                  <img src="${esc(poster)}" alt="" />
                  <i class="safe safe-x"></i><i class="safe safe-y"></i>
                  <div class="ecom-preview-caption">${esc(
                    L("3分钟，把云南日晒装进早晨", "Yunnan natural in three minutes")
                  )}</div>
                </div>
              </div>
              <div class="ecom-transport">
                <span>Ⅰ◀</span><span>◀</span><button type="button">${s.busy ? "❚❚" : "▶"}</button><span>▶</span><span>▶Ⅰ</span>
                <code class="ecom-video-dur">${esc(s.timecode || "00:00")}:00</code>
                <small>/ 00:28:00</small>
              </div>
            </section>
          </div>
          <div class="ecom-timeline-shell">
            <div class="ecom-timeline-toolbar">
              <span>⌁</span><span>✂</span><span>↕</span>
              <strong>${esc(s.barLabel || L("剪辑进度", "Edit progress"))}</strong>
              <small>−　━━━━　＋</small>
            </div>
            <div class="ecom-track-layout">
              <div class="ecom-track-labels"><span>V1</span><span>T1</span><span>A1</span></div>
              <div class="ecom-timeline-canvas">
                <div class="ecom-time-ruler"><span>00:00</span><span>00:07</span><span>00:14</span><span>00:21</span><span>00:28</span></div>
                <div class="ecom-track ecom-video-track">
                  ${clips
                    .map(
                      (clip, index) => `<div class="ecom-editor-clip ${clip.on ? "is-on" : ""} ${
                        s.activeClip === index ? "is-cutting" : ""
                      }" style="--thumb:url('${esc(sourceImages[index])}')">
                        <span>${esc(clip.label)}</span><small>${String(index * 7).padStart(2, "0")}:00</small>
                      </div>`
                    )
                    .join("")}
                </div>
                <div class="ecom-track ecom-caption-track">
                  <span>${esc(L("云南日晒", "Yunnan Natural"))}</span><span>${esc(
                    L("红糖·柑橘·可可", "Brown sugar · citrus")
                  )}</span><span>¥39.9 CTA</span>
                </div>
                <div class="ecom-track ecom-audio-track">
                  ${Array.from({ length: 42 }, (_, i) => `<i style="--h:${4 + ((i * 7) % 16)}px"></i>`).join("")}
                </div>
                <i class="ecom-playhead" style="left:${esc(playhead)}%"><b></b></i>
              </div>
            </div>
          </div>
          <div class="ecom-edit-bar"><span>${esc(s.barLabel || L("导出进度", "Export"))}</span><i style="width:${esc(
            pct
          )}%"></i><b>${esc(pct)}%</b></div>
        </div>
      </div>
      <div class="ecom-agentic-side">
        <div class="ecom-agentic-badge static">${esc(s.badge || L("Agent 剪辑中", "Agent editing"))}</div>
        <div class="ecom-edit-inspector">
          <div><span>${esc(L("画布", "Canvas"))}</span><strong>9:16</strong></div>
          <div><span>${esc(L("时长", "Duration"))}</span><strong>00:28</strong></div>
          <div><span>${esc(L("编码", "Codec"))}</span><strong>H.264</strong></div>
          <div><span>${esc(L("响度", "Loudness"))}</span><strong>−14 LUFS</strong></div>
          <div><span>${esc(L("字幕安全区", "Title safe"))}</span><strong>90%</strong></div>
        </div>
        <div class="ecom-agentic-log">
          ${steps
            .map(
              (st, i) =>
                `<div class="ecom-agentic-step ${i === steps.length - 1 && s.busy ? "is-active" : "is-done"}">
                  <span class="dot"></span><span>${esc(st)}</span>
                </div>`
            )
            .join("")}
        </div>
      </div>
    </div>`;
  }

  _syncEditMotion() {
    const state = this._editState;
    const root = this.playgroundEl;
    if (!state || !root) return;
    const playhead = root.querySelector(".ecom-playhead");
    const progress = root.querySelector(".ecom-edit-bar i");
    const progressText = root.querySelector(".ecom-edit-bar b");
    const timecode = root.querySelector(".ecom-video-dur");
    if (playhead) playhead.style.left = `${state.playhead}%`;
    if (progress) progress.style.width = `${state.pct}%`;
    if (progressText) progressText.textContent = `${state.pct}%`;
    if (timecode) timecode.textContent = `${state.timecode}:00`;
  }

  async playAnim(bench, { durationMs = 7000, label = "" } = {}) {
    const token = ++this._animToken;
    this.switchBench(bench);
    if (bench === "pack") {
      await this._runPackAgent({ token, durationMs, label });
    } else if (bench === "edit") {
      await this._runEditAgent({ token, durationMs, label });
    } else {
      this.renderPlayground();
      await sleepPlayback(durationMs, { min: 1600, max: 6000 });
    }
  }

  async _runPackAgent({ token, durationMs, label }) {
    const useV1 = /v1/i.test(label || "");
    const srcV1 = this.media("pack_v1") || this.media("pack_v2");
    const srcV2 = this.media("pack_v2") || srcV1;
    this._packLabel = label || L("迭代袋型色板与 Logo…", "Iterating pouch palette & logo…");
    const stepsPlan = useV1
      ? [
          L("拉取品牌色板 · 暖棕/日晒金", "Load brand palette · warm brown / sun-gold"),
          L("生成袋型轮廓与 Logo 占位", "Draft pouch silhouette & logo"),
          L("写入主视觉文案（待合规）", "Write hero copy (pending compliance)"),
          L("导出印刷预览 v1", "Export print preview v1"),
        ]
      : [
          L("读取预审驳回意见", "Read pre-check reject notes"),
          L("剔除功效暗示词", "Strip efficacy wording"),
          L("补成分表与产地风味区", "Add ingredient + origin/flavor panel"),
          L("导出过审稿 v2", "Export approved v2"),
        ];

    this._packState = {
      label: this._packLabel,
      src: useV1 ? srcV1 : srcV1,
      steps: [],
      pct: 6,
      busy: true,
      badge: L("Agent 设计中", "Agent designing"),
      cx: 58,
      cy: 36,
    };
    this.renderPlayground();
    this.onRichCard({
      thread: "design",
      kind: "pack",
      title: "pack",
      bodyHtml: `<div class="ecom-rich ecom-rich-pack"><div class="ecom-rich-head"><span class="ecom-pill">${esc(
        L("包装设计", "Pack design")
      )}</span><strong>${esc(this._packLabel)}</strong></div></div>`,
    });

    const slice = Math.max(900, Math.floor(durationMs / stepsPlan.length));
    for (let i = 0; i < stepsPlan.length; i++) {
      if (token !== this._animToken) return;
      this._packState.steps = stepsPlan.slice(0, i + 1);
      this._packState.pct = Math.round(((i + 0.35) / stepsPlan.length) * 100);
      this._packState.cx = 40 + (i % 3) * 18;
      this._packState.cy = 28 + (i % 2) * 22;
      if (!useV1 && i >= 2) this._packState.src = srcV2;
      if (useV1) this._packState.src = srcV1;
      this._packState.badge = stepsPlan[i];
      this._syncPackSurface();
      await sleepPlayback(slice, { min: 700, max: slice + 400 });
      this._packState.pct = Math.round(((i + 1) / stepsPlan.length) * 100);
      this._syncPackSurface();
    }
    if (token !== this._animToken) return;
    this._packState.busy = false;
    this._packState.badge = useV1 ? L("v1 定稿预览", "v1 draft ready") : L("v2 过审稿", "v2 approved");
    this._packState.src = useV1 ? srcV1 : srcV2;
    this.renderPlayground();
  }

  async _runEditAgent({ token, durationMs, label }) {
    this._editLabel = label || L("导出短视频…", "Exporting short video…");
    const poster = this.media("video_poster") || "assets/ecom/video_poster.webp";
    const clips = [
      { id: "c1", label: L("开箱", "Unbox"), on: false },
      { id: "c2", label: L("冲煮", "Brew"), on: false },
      { id: "c3", label: L("字幕", "Caption"), on: false },
      { id: "c4", label: "CTA", on: false },
    ];
    const stepsPlan = [
      L("导入素材 · 开箱/冲煮镜头", "Import footage · unbox / brew"),
      L("卡点剪辑 · 去空白帧", "Beat-cut · trim silence"),
      L("叠风味字幕与安全话术", "Overlay flavor captions (safe copy)"),
      L("加价格 CTA · 导出 28s", "Add price CTA · export 28s"),
    ];
    this._editState = {
      label: this._editLabel,
      poster,
      clips,
      steps: [],
      pct: 4,
      busy: true,
      badge: L("Agent 剪辑中", "Agent editing"),
      playhead: 6,
      activeClip: 0,
      timecode: "00:02",
      barLabel: L("剪辑进度", "Edit progress"),
    };
    this.renderPlayground();
    this.onRichCard({
      thread: "xhs_ops",
      kind: "edit",
      title: "edit",
      bodyHtml: `<div class="ecom-rich ecom-rich-edit"><div class="ecom-rich-head"><span class="ecom-pill">${esc(
        L("剪辑中", "Editing")
      )}</span><strong>${esc(this._editLabel)}</strong></div></div>`,
    });

    const slice = Math.max(900, Math.floor(durationMs / stepsPlan.length));
    for (let i = 0; i < stepsPlan.length; i++) {
      if (token !== this._animToken) return;
      this._editState.steps = stepsPlan.slice(0, i + 1);
      this._editState.activeClip = i;
      this._editState.clips = clips.map((c, idx) => ({ ...c, on: idx <= i }));
      this._editState.badge = stepsPlan[i];
      this._editState.barLabel = stepsPlan[i];
      this.renderPlayground();
      // scrub playhead across timeline while "cutting"
      const hops = 4;
      for (let h = 0; h < hops; h++) {
        if (token !== this._animToken) return;
        this._editState.playhead = Math.min(92, 8 + i * 22 + h * 5);
        this._editState.pct = Math.round(((i + h / hops) / stepsPlan.length) * 92);
        this._editState.timecode = `00:${String(Math.min(28, 2 + i * 7 + h * 2)).padStart(2, "0")}`;
        this._syncEditMotion();
        await sleepPlayback(Math.floor(slice / hops), { min: 160, max: 420 });
      }
    }
    if (token !== this._animToken) return;
    this._editState.busy = false;
    this._editState.pct = 100;
    this._editState.playhead = 96;
    this._editState.timecode = "00:28";
    this._editState.badge = L("成片已导出", "Cut exported");
    this._editState.barLabel = L("导出完成", "Export done");
    this._editState.activeClip = -1;
    this._editState.clips = clips.map((c) => ({ ...c, on: true }));
    this.renderPlayground();
  }

  publishCompareTable(suppliers = []) {
    const en = getLocale() === "en";
    const quoteImg = this.media("quote_sheet") || "assets/ecom/docs/quote_sheet.webp";
    this.active = "sheet";
    this.setTitle(L("供应商比价", "Supplier comparison"));
    const rows = suppliers
      .map((s) => {
        const name = en ? s.name_en : s.name_zh;
        const stars = "★★★★★".slice(0, s.rating || 4) + "☆☆☆☆☆".slice(0, 5 - (s.rating || 4));
        return `<tr><td>${esc(name)}</td><td>¥${esc(s.quote_per_kg)}</td><td>${esc(s.moq_kg)}kg</td><td>${esc(
          s.lead_days
        )}${esc(L("天", "d"))}</td><td class="stars">${stars}</td></tr>`;
      })
      .join("");
    if (this.playgroundEl) {
      this.playgroundEl.innerHTML = `<div class="ecom-play-panel">
        <div class="ecom-doc-preview ecom-doc-preview-sm"><img src="${esc(quoteImg)}" alt="" /></div>
        <div class="ecom-rich ecom-rich-table" style="margin-top:12px">
          <table><thead><tr>
            <th>${esc(L("供应商", "Supplier"))}</th><th>${esc(L("单价", "Price"))}</th>
            <th>MOQ</th><th>${esc(L("交期", "Lead"))}</th><th>${esc(L("综合", "Score"))}</th>
          </tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div>`;
    }
    const html = `<div class="ecom-rich ecom-rich-table">
      <div class="ecom-rich-head"><span class="ecom-pill">${esc(L("比价结果", "Quote result"))}</span>
        <strong>${esc(L("供应商比价表", "Supplier comparison"))}</strong></div>
      <div class="ecom-doc-preview ecom-doc-preview-sm"><img src="${esc(quoteImg)}" alt="" /></div>
    </div>`;
    this.onRichCard({ thread: "bean_b", kind: "table", title: "compare", bodyHtml: html });
  }

  publishPricingCard(kpi) {
    const cost = Number(kpi.unitCost) || 12.8;
    const price = Number(kpi.unitPrice) || 39.9;
    const margin = price > 0 ? (((price - cost) / price) * 100).toFixed(1) : "0";
    this.switchBench("sheet");
    this.updateSheetFromKpi(kpi, this.seed?.sku?.id);
    const html = `<div class="ecom-rich ecom-rich-price">
      <div class="ecom-rich-head"><span class="ecom-pill">${esc(L("定价策略", "Pricing"))}</span>
        <strong>${esc(L("建议零售价", "Suggested sale price"))} ¥${esc(price)}</strong></div>
      <p class="ecom-margin">${esc(L("预计毛利率", "Est. margin"))} <b>${esc(margin)}%</b></p>
    </div>`;
    this.onRichCard({ thread: "boss", kind: "pricing", title: "pricing", bodyHtml: html });
  }
}
