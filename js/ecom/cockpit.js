/**
 * SaaS-style ecommerce full-chain cockpit.
 */

import { L, getLocale, applyDomI18n } from "../i18n.js?v=20260807-editor";
import { EcomIm } from "./im.js?v=20260807-editor";
import { EcomBenches } from "./benches.js?v=20260807-editor";
import { EcomScriptPlayer, ecomProgressLabel } from "./script.js?v=20260807-editor";
import { createEcomTools } from "./tools.js?v=20260807-editor";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class EcomCockpit {
  constructor() {
    this.root = document.querySelector("#ecomCockpit");
    this.meta = null;
    this.seed = null;
    this.trajectory = null;
    this.kpi = null;
    this.deliverables = [];
    this.stageId = null;
    this.ready = false;
    this._comparePublished = false;
    this._activityTimer = null;
    this._lastKpiValues = [];

    this.notifyCount = 0;
    this.monitors = [];
    this._lastKpiValues = [];
    this.im = new EcomIm({
      messagesEl: document.querySelector("#ecomMessages"),
      tabsEl: document.querySelector("#ecomChatTabs"),
      onFocusDeliverable: (id) => this.focusDeliverable(id),
      onExternalFocus: (id) => this.benches?.focusCommunication(id),
      onExternalMessage: (row, opts) => this.benches?.pushCommunication(row, opts),
    });
    this.benches = new EcomBenches({
      stageEl: document.querySelector("#ecomBenchStage"),
      tabsEl: document.querySelector("#ecomBenchTabs"),
      playgroundEl: document.querySelector("#ecomPlayground"),
      titleEl: document.querySelector("#ecomPlayTitle"),
      onRichCard: (card) => this.im.pushRichCard(card),
      onUpdateCard: (id, patch) => this.im.updateMessage(id, patch),
    });
    this.player = new EcomScriptPlayer(this);
    this.tools = null;

    document.querySelector("#ecomBtnReplay")?.addEventListener("click", () => this.onReplay?.());
    document.querySelector("#ecomBtnConfigure")?.addEventListener("click", () => this.onConfigure?.());
    this.renderNotifyBadge();
    document.querySelector("#ecomComposer")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.querySelector("#ecomChatInput");
      const text = input?.value?.trim();
      if (!text) return;
      this.im.pushMessage({ thread: "boss", from: "boss", kind: "text", text_zh: text, text_en: text });
      input.value = "";
      this.im.pushMessage({
        thread: "boss",
        from: "agent",
        kind: "text",
        text_zh: "收到。完整链路请点左侧「AI 生成方案 / Replay」观看预录演示。",
        text_en: "Got it. Tap “AI plan / Replay” on the left to watch the baked full-chain demo.",
      });
    });
  }

  async load(base = "./data/ecom_drip_coffee") {
    const [meta, seed, trajectory] = await Promise.all([
      fetch(`${base}/meta.json`).then((r) => {
        if (!r.ok) throw new Error("ecom meta");
        return r.json();
      }),
      fetch(`${base}/seed.json`).then((r) => {
        if (!r.ok) throw new Error("ecom seed");
        return r.json();
      }),
      fetch(`${base}/trajectory.json`).then((r) => {
        if (!r.ok) throw new Error("ecom trajectory");
        return r.json();
      }),
    ]);
    this.meta = meta;
    this.seed = seed;
    this.trajectory = trajectory;
    this.player.load(trajectory);
    this.tools = createEcomTools({
      seed,
      getSupplier: (id) => seed.suppliers?.find((s) => s.id === id),
      playCall: (opts) => this.benches.playCall(opts),
      focusThread: (id) => this.im.focusThread(id),
      pushIm: (msg) => this.im.pushMessage(msg),
      publishDeliverable: (item, opts) => this.publishDeliverable(item, opts),
      updatePricing: async (kpi) => {
        this.applyKpi(kpi, { switchSheet: true });
        this.benches.publishPricingCard(kpi);
      },
      onMockImEvent: () => {},
    });
    // After second supplier call, show comparison table once.
    const origCall = this.tools.call_supplier.bind(this.tools);
    this._callCount = 0;
    this.tools.call_supplier = async (args) => {
      const res = await origCall(args);
      this._callCount += 1;
      if (this._callCount >= 2 && !this._comparePublished) {
        this._comparePublished = true;
        this.benches.publishCompareTable(this.seed.suppliers || []);
      }
      return res;
    };
    this.ready = true;
    this.reset();
    return this;
  }

  reset() {
    if (!this.seed) return;
    this.deliverables = [];
    this.kpi = { ...(this.seed.kpi || {}) };
    this.stageId = this.meta?.stages?.[0]?.id || null;
    this._comparePublished = false;
    this._callCount = 0;
    this.notifyCount = 0;
    this.monitors = [];
    this.im.reset(this.seed.threads || []);
    this.benches.reset(this.seed);
    this.renderProject();
    this.renderStages();
    this.renderKpi();
    this.renderMonitors();
    this.renderWall();
    this.renderNotifyBadge();
    this.setAgentStatus(null);
    this.showWelcome(false);
  }

  show() {
    if (!this.root) return;
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    applyDomI18n(this.root);
    this.showWelcome(false);
  }

  hide() {
    this.player.stop();
    if (!this.root) return;
    this.root.hidden = true;
    this.root.setAttribute("aria-hidden", "true");
  }

  media(key, fallback = "") {
    const m = this.seed?.media || {};
    return m[key] || fallback || "";
  }

  assetUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
    // demo served from /demo/ root
    return path.startsWith("./") || path.startsWith("/") ? path : `./${path}`;
  }

  renderProject() {
    const en = getLocale() === "en";
    const p = this.seed?.project || {};
    const nameEl = document.querySelector("#ecomProjectName");
    if (nameEl) {
      const proj = en ? p.name_en || p.name_zh : p.name_zh || p.name_en;
      nameEl.textContent = proj ? `${proj} · ${p.id || ""}` : "VibeLifeBench";
    }
    const idEl = document.querySelector("#ecomProjectId");
    if (idEl) idEl.textContent = p.id || "—";
  }

  setStage(id) {
    this.stageId = id;
    this.renderStages();
    const st = this.meta?.stages?.find((s) => s.id === this.stageId);
    const label = st ? (getLocale() === "en" ? st.en : st.zh) : id;
    this.setAgentStatus(label);
    this.pushMonitor(label, "ok");
  }

  bumpNotify() {
    this.notifyCount = (this.notifyCount || 0) + 1;
    this.renderNotifyBadge();
  }

  renderNotifyBadge() {
    const badge = document.querySelector("#ecomNotifyBadge");
    if (!badge) return;
    const n = this.notifyCount || 0;
    badge.hidden = n <= 0;
    badge.textContent = String(n);
  }

  pushMonitor(text, level = "info") {
    if (!text) return;
    const key = String(text).slice(0, 48);
    this.monitors = (this.monitors || []).filter((m) => m.key !== key);
    this.monitors.unshift({ key, text: key, level, ts: Date.now() });
    this.monitors = this.monitors.slice(0, 3);
    this.renderMonitors();
  }

  renderMonitors() {
    const el = document.querySelector("#ecomMonitors");
    if (!el) return;
    el.innerHTML = (this.monitors || [])
      .map(
        (m) =>
          `<span class="ecom-monitor-chip is-${esc(m.level || "info")}">${esc(m.text)}</span>`
      )
      .join("");
  }

  pushWorldEvent(step = {}) {
    const text = getLocale() === "en" ? step.text_en || step.text_zh : step.text_zh || step.text_en;
    const level = step.level || "info";
    const tone = level === "danger" ? "danger" : level === "warn" ? "warn" : "info";
    const html = `<div class="ecom-rich ecom-rich-world is-${esc(level)}">
      <div class="ecom-rich-head"><span class="ecom-pill">${esc(L("世界事件", "World event"))}</span>
        <strong>${esc(text)}</strong></div>
    </div>`;
    this.im.pushRichCard({ thread: "boss", kind: "world", title: text, bodyHtml: html });
    this.pushMonitor(text, tone);
    this.bumpNotify();
  }

  pushMutationEvent(step = {}) {
    const text = getLocale() === "en" ? step.text_en || step.text_zh : step.text_zh || step.text_en;
    const html = `<div class="ecom-rich ecom-rich-mutation">
      <div class="ecom-rich-head"><span class="ecom-pill">${esc(L("静默变更", "Silent mutation"))}</span>
        <strong>${esc(text)}</strong></div>
      <p class="muted">${esc(L("需主动核对库存 / 订单 / 供方状态", "Must actively verify stock / orders / supplier state"))}</p>
    </div>`;
    this.im.pushRichCard({ thread: "boss", kind: "mutation", title: text, bodyHtml: html });
    this.pushMonitor(text, "warn");
    this.bumpNotify();
  }

  pushNotificationEvent(step = {}) {
    const text = getLocale() === "en" ? step.text_en || step.text_zh : step.text_zh || step.text_en;
    const html = `<div class="ecom-rich ecom-rich-notify">
      <div class="ecom-rich-head"><span class="ecom-pill is-live">${esc(L("通知", "Notice"))}</span>
        <strong>${esc(text)}</strong></div>
    </div>`;
    this.im.pushRichCard({ thread: "boss", kind: "notify", title: text, bodyHtml: html });
    this.pushMonitor(text, "info");
    this.bumpNotify();
  }

  setAgentStatus(taskLabel) {
    const task = document.querySelector("#ecomAgentTask");
    const eta = document.querySelector("#ecomAgentEta");
    if (task) {
      task.textContent = taskLabel
        ? `${L("当前阶段", "Stage")}: ${taskLabel}`
        : L("待命", "Idle");
    }
    if (eta) eta.textContent = taskLabel || "—";
    if (!taskLabel) this.setAgentActivity("idle", L("观察", "Observe"), { settle: false });
  }

  setAgentActivity(mode = "idle", label = "", { settle = true } = {}) {
    const el = document.querySelector("#ecomAgentActivity");
    if (!el) return;
    window.clearTimeout(this._activityTimer);
    el.className = `ecom-agent-activity is-${mode}`;
    const text = el.querySelector("em");
    if (text) text.textContent = label || L("观察", "Observe");
    if (settle && mode !== "idle") {
      this._activityTimer = window.setTimeout(() => {
        el.className = "ecom-agent-activity is-idle";
        if (text) text.textContent = L("观察", "Observe");
      }, 1800);
    }
  }

  renderStages() {
    const st = this.meta?.stages?.find((s) => s.id === this.stageId);
    if (!st) return;
    const label = getLocale() === "en" ? st.en : st.zh;
    const eta = document.querySelector("#ecomAgentEta");
    if (eta) eta.textContent = label;
  }

  applyKpi(kpi, { switchSheet = false } = {}) {
    this.kpi = { ...this.kpi, ...kpi };
    const sold = Number(this.kpi.sold) || 0;
    const unitPrice = Number(this.kpi.unitPrice) || 0;
    const unitCost = Number(this.kpi.unitCost) || 0;
    if (kpi.revenue == null) this.kpi.revenue = +(unitPrice * sold).toFixed(1);
    if (kpi.cogs == null) this.kpi.cogs = +(unitCost * sold).toFixed(1);
    if (kpi.profit == null) this.kpi.profit = +(this.kpi.revenue - this.kpi.cogs).toFixed(1);
    if (kpi.orders == null) this.kpi.orders = sold;
    if (kpi.marginPct == null && unitPrice > 0) {
      this.kpi.marginPct = +(((unitPrice - unitCost) / unitPrice) * 100).toFixed(1);
    }
    this.benches.updateSheetFromKpi(this.kpi, this.seed?.sku?.id);
    if (switchSheet) this.benches.switchBench("sheet");
    this.renderKpi();
    this.renderStages();
    if (Number(this.kpi?.stock) > 0 && Number(this.kpi.stock) < 450) {
      this.pushMonitor(L(`库存 ${this.kpi.stock}`, `Stock ${this.kpi.stock}`), "warn");
    }
    if (Number(this.kpi?.profit) > 0) {
      this.pushMonitor(L(`利润 ¥${this.kpi.profit}`, `Profit ¥${this.kpi.profit}`), "ok");
    }
  }

  renderKpi() {
    const el = document.querySelector("#ecomTopKpis");
    if (!el || !this.kpi) return;
    const k = this.kpi;
    const sales = Number(k.revenue) > 0 ? k.revenue : 0;
    const profit = Number(k.profit) || 0;
    const margin = Number(k.marginPct) || 0;
    const orders = Number(k.orders) || Number(k.sold) || 0;
    const stock = Number(k.stock) || 0;
    const budgetSpent = Number(k.budgetSpent) || 0;
    const budgetTotal = Number(k.budgetTotal) || 30000;
    const cards = [
      [L("销售额", "Sales"), `¥${fmt(sales)}`, k.salesDelta, "up"],
      [L("利润", "Profit"), `¥${fmt(profit)}`, k.profitDelta, profit > 0 ? "up" : ""],
      [L("毛利率", "Margin"), `${fmt(margin)}%`, k.marginDelta, "up"],
      [L("订单", "Orders"), fmt(orders), k.ordersDelta, "up"],
      [
        L("预算", "Budget"),
        `¥${fmt(budgetSpent)}/${fmt(budgetTotal / 1000)}k`,
        null,
        budgetSpent / budgetTotal > 0.85 ? "warn" : "",
        stock > 0 ? `${fmt(stock)} ${L("库存", "stock")}` : "",
      ],
    ];
    el.innerHTML = cards
      .map(
        ([label, value, delta, tone, note], index) => `<div class="ecom-top-kpi ${tone || ""} ${
          this._lastKpiValues[index] != null && this._lastKpiValues[index] !== value ? "is-changed" : ""
        }">
        <span class="ecom-kpi-label">${esc(label)}</span>
        <strong class="ecom-kpi-value">${esc(value)}</strong>
        ${
          delta != null
            ? `<em class="delta">+${esc(delta)}%</em>`
            : note
              ? `<em class="warn">${esc(note)}</em>`
              : ""
        }
      </div>`
      )
      .join("");
    this._lastKpiValues = cards.map(([, value]) => value);
    const hidden = document.querySelector("#ecomKpi");
    if (hidden) hidden.innerHTML = el.innerHTML;
  }

  /** Case-synced project snapshot (no static charts / fake orders). */
  renderSnapshot() {
    const el = document.querySelector("#ecomSnapshot");
    if (!el) return;
    const en = getLocale() === "en";
    const sku = this.seed?.sku || {};
    const k = this.kpi || {};
    const thumb = this.assetUrl(sku.thumb || this.media("sku_hero"));
    const stock = Number(k.stock) || 0;
    const price = Number(k.unitPrice) || 0;
    const cost = Number(k.unitCost) || 0;
    const spent = Number(k.budgetSpent) || 0;
    const total = Number(k.budgetTotal) || 30000;
    const pct = Math.max(0, Math.min(100, Math.round((spent / total) * 100)));
    const stockTone = stock > 0 && stock < 450 ? "is-alert" : "";
    el.innerHTML = `
      <div class="ecom-snap-sku">
        ${thumb ? `<img src="${esc(thumb)}" alt="" />` : ""}
        <div>
          <strong>${esc(en ? sku.name_en || sku.name_zh : sku.name_zh || sku.name_en)}</strong>
          <small>${esc(sku.id || "")}</small>
        </div>
      </div>
      <div class="ecom-snap-row"><span>${esc(L("售价", "Price"))}</span><strong>${
        price > 0 ? `¥${esc(fmt(price))}` : "—"
      }</strong></div>
      <div class="ecom-snap-row"><span>${esc(L("成本", "Cost"))}</span><strong>${
        cost > 0 ? `¥${esc(fmt(cost))}` : "—"
      }</strong></div>
      <div class="ecom-snap-row ${stockTone}"><span>${esc(L("库存", "Stock"))}</span><strong>${esc(
        fmt(stock)
      )} ${esc(L("盒", "boxes"))}</strong></div>
      <div class="ecom-snap-row"><span>${esc(L("预算进度", "Budget"))}</span><strong>¥${esc(
        fmt(spent)
      )} / ¥${esc(fmt(total))}</strong></div>
      <div class="ecom-budget-bar" title="${esc(pct)}%"><i style="width:${esc(pct)}%"></i></div>
    `;
  }

  resolveCover(item = {}) {
    if (item.cover) return this.assetUrl(item.cover);
    if (item.media) return this.assetUrl(this.media(item.media) || item.media);
    const map = {
      xhs_note_v1: "note_v1",
      xhs_note_v2: "note_v2",
      quote_sheet: "quote_sheet",
      qc_incident: "qc_incident",
      promo_cut_v1: "video_poster",
      live_script: "video_poster",
      compliance_memo: "cupping",
      profit_card: "sku_hero",
      sop_handoff: "sku_hero",
      disruption_ledger: "qc_incident",
      pack_v1: "pack_v1",
      pack_v2: "pack_v2",
      po_b080: "po",
      scam_mail: "scam_mail",
    };
    const key =
      map[item.id] ||
      (item.kind === "note"
        ? "note_v2"
        : item.kind === "video"
          ? "video_poster"
          : item.kind === "quote"
            ? "quote_sheet"
            : item.kind === "pack"
              ? "pack_v2"
              : "");
    return key ? this.assetUrl(this.media(key)) : "";
  }

  deliverableHtml(row, title, body) {
    const cover = row.cover || "";
    const kind = row.kind || "file";
    if (kind === "note" && cover) {
      return `<div class="ecom-rich ecom-rich-xhs ${row.highlight ? "is-highlight" : ""}">
        <div class="ecom-rich-head"><span class="ecom-pill">${esc(kindLabel(kind))}</span><strong>${esc(title)}</strong></div>
        <div class="ecom-xhs-cover"><img src="${esc(cover)}" alt="" /></div>
        <div class="ecom-xhs-meta"><pre>${esc(body)}</pre></div>
      </div>`;
    }
    if (kind === "video" && cover) {
      return `<div class="ecom-rich ecom-rich-video ${row.highlight ? "is-highlight" : ""}">
        <div class="ecom-rich-head"><span class="ecom-pill">${esc(kindLabel(kind))}</span><strong>${esc(title)}</strong></div>
        <div class="ecom-video-frame"><img src="${esc(cover)}" alt="" /><span class="ecom-video-play" aria-hidden="true">▶</span><span class="ecom-video-dur">00:28</span></div>
        <pre>${esc(body)}</pre>
      </div>`;
    }
    if ((kind === "quote" || kind === "file" || kind === "profit" || cover) && cover) {
      return `<div class="ecom-rich ecom-rich-doc ${row.highlight ? "is-highlight" : ""}">
        <div class="ecom-rich-head"><span class="ecom-pill">${esc(kindLabel(kind))}</span><strong>${esc(title)}</strong></div>
        <div class="ecom-doc-preview"><img src="${esc(cover)}" alt="" />
          <div class="ecom-doc-side"><b>${esc(title)}</b><span>PDF · ${esc(L("扫描件预览", "Scan preview"))}</span>
            <pre>${esc(body)}</pre></div>
        </div>
      </div>`;
    }
    if (kind === "pack") {
      const packSrc = cover || this.assetUrl(this.media("pack_v2"));
      return `<div class="ecom-rich ecom-rich-pack ${row.highlight ? "is-highlight" : ""}">
        <div class="ecom-rich-head"><span class="ecom-pill">${esc(kindLabel(kind))}</span><strong>${esc(title)}</strong></div>
        <div class="ecom-pack-canvas"><img class="ecom-pack-photo" src="${esc(packSrc)}" alt="" /></div>
        <pre>${esc(body)}</pre>
      </div>`;
    }
    return `<div class="ecom-rich ecom-rich-file ${row.highlight ? "is-highlight" : ""}">
      <div class="ecom-rich-head"><span class="ecom-pill">${esc(kindLabel(kind))}</span>
        <strong>${esc(title)}</strong></div>
      <pre>${esc(body)}</pre>
    </div>`;
  }

  deliverableCompactHtml(row, title, body) {
    const kind = kindLabel(row.kind || "file");
    const summary = String(body || "")
      .split(/\n/)
      .find(Boolean) || L("已生成并保存到交付物", "Generated and saved to deliverables");
    const thumb = row.cover
      ? `<img class="ecom-result-thumb" src="${esc(row.cover)}" alt="" />`
      : `<span class="ecom-result-icon">${esc(kind.slice(0, 1))}</span>`;
    return `<div class="ecom-result-card ${row.highlight ? "is-highlight" : ""}">
      ${thumb}
      <div class="ecom-result-copy">
        <span>${esc(kind)}</span>
        <strong>${esc(title)}</strong>
        <small>${esc(summary)}</small>
      </div>
      <button type="button" data-deliv-btn="${esc(row.id)}">${esc(L("打开", "Open"))}</button>
    </div>`;
  }

  async publishDeliverable(item, { announce = false } = {}) {
    const id = item.id || `d_${Date.now()}`;
    const cover = this.resolveCover(item);
    const row = {
      id,
      kind: item.kind || "file",
      title_zh: item.title_zh || item.title,
      title_en: item.title_en || item.title,
      body_zh: item.body_zh || item.body || "",
      body_en: item.body_en || item.body || "",
      highlight: Boolean(item.highlight),
      cover,
    };
    const idx = this.deliverables.findIndex((d) => d.id === id);
    if (idx >= 0) this.deliverables[idx] = row;
    else this.deliverables.unshift(row);
    this.renderWall();

    const en = getLocale() === "en";
    const title = en ? row.title_en : row.title_zh;
    const body = en ? row.body_en : row.body_zh;
    const html = this.deliverableCompactHtml(row, title, body);
    this.im.pushRichCard({
      thread: "boss",
      kind: row.kind,
      title,
      bodyHtml: html,
      deliverableId: id,
    });

    this.benches.showDeliverable(row);
    if (row.kind === "pack") this.benches.switchBench("pack");
    else if (row.kind === "sheet" || row.kind === "quote") this.benches.switchBench("sheet");
    else if (row.kind === "video") this.benches.switchBench("edit");
  }

  renderWall() {
    const el = document.querySelector("#ecomWall");
    if (!el) return;
    if (!this.deliverables.length) {
      el.innerHTML = `<div class="ecom-wall-label"><strong>${esc(
        L("交付物", "Deliverables")
      )}</strong><span>0</span></div><div class="ecom-wall-empty">${esc(
        L("任务产出将固定在这里", "Task outputs will be pinned here")
      )}</div>`;
      return;
    }
    const en = getLocale() === "en";
    const items = this.deliverables.slice(0, 8);
    el.innerHTML = `<div class="ecom-wall-label"><strong>${esc(
      L("交付物", "Deliverables")
    )}</strong><span>${items.length}</span></div>${items
      .map((d) => {
        const title = en ? d.title_en || d.title_zh : d.title_zh || d.title_en;
        const thumb = d.cover
          ? `<img class="ecom-wall-thumb" src="${esc(d.cover)}" alt="" />`
          : `<span class="ecom-wall-kind">${esc(kindLabel(d.kind))}</span>`;
        return `<button type="button" class="ecom-wall-chip ${d.highlight ? "is-highlight" : ""}" data-deliv="${esc(
          d.id
        )}">${thumb}<span class="ecom-wall-copy"><strong>${esc(title)}</strong><small>${esc(
          kindLabel(d.kind)
        )}</small></span></button>`;
      })
      .join("")}`;
    el.querySelectorAll("[data-deliv]").forEach((btn) => {
      btn.addEventListener("click", () => this.focusDeliverable(btn.dataset.deliv));
    });
  }

  focusDeliverable(id) {
    const d = this.deliverables.find((x) => x.id === id);
    if (!d) return;
    this.benches.showDeliverable(d);
  }

  showWelcome(show) {
    const el = document.querySelector("#ecomWelcome");
    if (!el) return;
    if (!show) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const title = getLocale() === "en" ? this.meta?.title_en : this.meta?.title_zh;
    const sub = getLocale() === "en" ? this.meta?.subtitle_en : this.meta?.subtitle_zh;
    el.innerHTML = `<div class="ecom-welcome-card">
      <div class="ecom-welcome-kicker">VibeLifeBench</div>
      <h3>${esc(title || "")}</h3>
      <p>${esc(sub || "")}</p>
      <ol>
        <li>${esc(L("左侧：Agent 聊天（含工具调用，对齐旅游 demo）", "Left: agent chat with tool calls (travel-aligned)"))}</li>
        <li>${esc(L("顶栏：监控项随剧情自动上浮；右侧 Playground 放大当前任务", "Top: live monitors; right Playground shows the active task"))}</li>
        <li>${esc(L("Replay 节奏已放慢，便于观察 thinking / 工具 / 交付", "Replay paced slower so tools & deliverables are readable"))}</li>
      </ol>
      <div class="ecom-welcome-actions">
        <button type="button" class="ecom-btn-primary" data-ecom="replay">${esc(L("开始 Replay", "Start Replay"))}</button>
        <button type="button" class="ecom-btn-ghost" data-ecom="configure">${esc(L("配置模型", "Configure model"))}</button>
      </div>
    </div>`;
    el.querySelector("[data-ecom=replay]")?.addEventListener("click", () => this.onReplay?.());
    el.querySelector("[data-ecom=configure]")?.addEventListener("click", () => this.onConfigure?.());
  }

  async startReplay({ onProgress, onToast } = {}) {
    if (!this.ready) await this.load();
    this.reset();
    this.showWelcome(false);
    document.querySelector("#ecomLiveDot")?.classList.add("is-on");
    document.querySelector("#ecomAutoExec") && (document.querySelector("#ecomAutoExec").checked = true);
    onToast?.(L("挂耳电商 Replay 开始", "Drip-commerce replay started"));
    const result = await this.player.play({
      onProgress: (p) => {
        onProgress?.(p);
        const pill = document.querySelector("#progressLabel");
        if (pill) pill.textContent = ecomProgressLabel(p.index, p.total);
      },
    });
    document.querySelector("#ecomLiveDot")?.classList.remove("is-on");
    if (result?.ok) {
      onToast?.(L("Replay 完成 · 利润已出账", "Replay done · profit booked"));
    }
    return result;
  }

  rerenderLocale() {
    applyDomI18n(this.root);
    this.renderProject();
    this.renderStages();
    this.renderKpi();
    this.renderMonitors();
    this.renderWall();
    this.renderNotifyBadge();
    this.im.renderChat({ stick: false });
    this.benches.renderPlayground?.();
    const welcome = document.querySelector("#ecomWelcome");
    if (welcome && !welcome.hidden) this.showWelcome(true);
  }
}

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}

function kindLabel(kind) {
  const map = {
    quote: L("报价", "Quote"),
    pack: L("包装", "Pack"),
    sheet: L("表格", "Sheet"),
    note: L("笔记", "Note"),
    video: L("成片", "Video"),
    profit: L("利润", "Profit"),
    file: L("文件", "File"),
  };
  return map[kind] || kind || L("交付", "Item");
}
