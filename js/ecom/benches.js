/**
 * Playground benches — call streaming transcript + agentic pack/video editing.
 */

import { L, getLocale } from "../i18n.js?v=20260807-event-ui";
import { sleepPlayback } from "../playback.js?v=20260807-event-ui";

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
  constructor({ stageEl, tabsEl, playgroundEl, titleEl, onRichCard, onUpdateCard, onStatus, getStandbyContext } = {}) {
    this.stageEl = stageEl;
    this.tabsEl = tabsEl;
    this.playgroundEl = playgroundEl || document.querySelector("#ecomPlayground");
    this.titleEl = titleEl || document.querySelector("#ecomPlayTitle");
    this.onRichCard = onRichCard || (() => {});
    this.onUpdateCard = onUpdateCard || (() => {});
    this.onStatus = onStatus || (() => {});
    this.getStandbyContext = getStandbyContext || (() => ({}));
    this.active = "idle";
    this.sheet = { headers: [], rows: [] };
    this._animToken = 0;
    this._callState = null;
    this._editState = null;
    this._packState = null;
    this.commThreads = [];
    this.commFeed = [];
    this.commSeenAt = {};
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
    this.commSeenAt = {};
    this.activeCommThread = this.commThreads[0]?.id || null;
    if (this.activeCommThread) this.commSeenAt[this.activeCommThread] = Date.now();
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

  _statusBeat({ acting = false } = {}) {
    if (acting) return "act";
    const mode =
      document.querySelector("#ecomAgentActivity .ecom-agent-mode")?.dataset?.mode ||
      document.querySelector("#ecomAgentActivity")?.className?.match(/is-([a-z]+)/)?.[1] ||
      "idle";
    if (mode === "observing") return "sense";
    if (mode === "planning") return "think";
    if (mode === "acting" || mode === "communicating") return "act";
    if (mode === "verified") return "check";
    return "hold";
  }

  setStatus(text = "") {
    const next = String(text || "");
    const el = document.querySelector("#ecomPlayStatus");
    if (el) {
      if (el.dataset.sig !== next) {
        el.dataset.sig = next;
        el.hidden = !next;
        el.className = "ecom-play-status";
        el.textContent = next;
        el.title = next;
      }
    }
    if (next) this.onStatus?.(next);
  }

  _callLive() {
    return Boolean(this._callState && this._callState.phase !== "ended" && !this._callState.ended);
  }

  _syncPlayStatus() {
    const busyPack = this._packState?.busy;
    const busyEdit = this._editState?.busy;
    const callLive = this._callLive();
    const map = {
      comms: L("Agent 正在协调外部沟通", "Agent coordinating external chats"),
      phone: callLive
        ? L("通话进行中 · 实时转写", "Live call · streaming transcript")
        : L("准备供应商通话", "Preparing supplier call"),
      sheet: L("核对库存 / 定价写回", "Checking inventory / pricing writeback"),
      pack: busyPack
        ? L("Agent 正在连续改稿", "Agent continuously editing pack")
        : L("包装工作台待命", "Pack bench idle"),
      edit: busyEdit
        ? L("Agent 正在剪辑时间线", "Agent editing the timeline")
        : L("视频工作台待命", "Edit bench idle"),
      deliverable: L("展示最新交付结果", "Showing latest deliverable"),
      idle: L("等待任务分配", "Waiting for a task"),
    };
    this.setStatus(map[this.active] || map.idle);
    this._updateCommsBadge();
    this._syncBenchBusy();
  }

  _syncBenchBusy() {
    const busy = {
      phone: this._callLive(),
      pack: Boolean(this._packState?.busy),
      edit: Boolean(this._editState?.busy),
      sheet: Boolean(this.active === "sheet" && this._sheetChanged?.some(Boolean)),
    };
    const ctx = this.getStandbyContext?.() || {};
    const nextBench = ctx.live ? ctx.nextBench || "" : "";
    this.tabsEl?.querySelectorAll("[data-bench]").forEach((btn) => {
      const id = btn.dataset.bench;
      const on = Boolean(busy[id]);
      const isNext = Boolean(nextBench && id === nextBench && !on);
      btn.classList.toggle("is-busy", on);
      btn.classList.toggle("is-next-hint", isNext);
      if (on) btn.title = L("Agent 正在此工作台执行", "Agent is working on this bench");
      else if (isNext) btn.title = L("预计下一拍会放大此工作台", "Likely next bench to magnify");
      else if (btn.title?.includes("Agent") || btn.title?.includes("下一拍") || btn.title?.includes("next")) {
        btn.removeAttribute("title");
      }
    });
  }

  _updateCommsBadge() {
    const btn = this.tabsEl?.querySelector('[data-bench="comms"]');
    if (!btn) return;
    const seen = this.commSeenAt || {};
    const unread = this.commFeed.filter(
      (m) => m.from !== "agent" && m.thread !== this.activeCommThread && (m.ts || 0) > (seen[m.thread] || 0)
    ).length;
    let badge = btn.querySelector(".ecom-bench-badge");
    if (!unread) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("b");
      badge.className = "ecom-bench-badge";
      btn.appendChild(badge);
    }
    badge.textContent = String(Math.min(unread, 9));
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
      const on = btn.dataset.bench === id;
      btn.classList.toggle("is-active", on);
      if (on && changed && !user) {
        btn.classList.remove("is-pulse");
        void btn.offsetWidth;
        btn.classList.add("is-pulse");
        window.setTimeout(() => btn.classList.remove("is-pulse"), 780);
      }
    });
    if (user) this.renderPlayground();
    else this.renderDock();
    this._syncPlayStatus();
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
    const next = [
      skuName || "drip-yunnan-12",
      kpi.unitCost ? `¥${kpi.unitCost}` : "—",
      kpi.unitPrice ? `¥${kpi.unitPrice}` : "—",
      String(kpi.stock ?? 0),
      String(kpi.sold ?? 0),
      kpi.refunds ? `¥${kpi.refunds}` : "0",
      margin,
    ];
    const prev = this._sheetSnapshot || [];
    this._sheetChanged = next.map((cell, i) => prev.length > 0 && cell !== prev[i]);
    this._sheetSnapshot = next;
    this.sheet.rows = [next];
    this._sheetVerifyAt = this._sheetChanged.some(Boolean) ? Date.now() : this._sheetVerifyAt;
    if (this.active === "sheet") this.renderPlayground();
    else if (this._sheetChanged.some(Boolean)) this._syncBenchBusy();
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
      const ctx = this.getStandbyContext?.() || {};
      const live = Boolean(ctx.live);
      this.setTitle(L("待命 · 双轨并行", "Standby · dual track"));
      this.setStatus(
        live
          ? L(`无人值守间隙 · ${ctx.stage || "推进中"}`, `Hands-free pause · ${ctx.stage || "advancing"}`)
          : L("你忙门店 · Agent 等待下一拍", "You on floor · Agent waits for next beat")
      );
      const chips = [
        ["phone", L("☎ 锁价通话", "☎ Lock-price call")],
        ["pack", L("◇ 包装迭代", "◇ Pack iterate")],
        ["edit", L("▶ 短视频剪辑", "▶ Short edit")],
        ["sheet", L("▦ 库存定价", "▦ Stock & price")],
        ["comms", L("✦ 协作消息", "✦ Team inbox")],
      ];
      const beat = this._statusBeat({ acting: false });
      const en = getLocale() === "en";
      const beatSteps = [
        { id: "sense", zh: "感", en: "S" },
        { id: "think", zh: "想", en: "T" },
        { id: "act", zh: "做", en: "A" },
      ];
      const order = { sense: 0, think: 1, act: 2, check: 3, hold: -1 };
      const cur = order[beat] ?? -1;
      const beatHtml = live
        ? `<p class="ecom-standby-beat" aria-hidden="true">${beatSteps
            .map((s, i) => {
              const state =
                beat === "check" || i < cur ? "is-done" : i === cur ? "is-on" : "";
              return `<b class="${state}">${esc(en ? s.en : s.zh)}</b>`;
            })
            .join("<i></i>")}<em>${esc(
            beat === "sense"
              ? L("先感知，再决定下一拍", "Sense first, then pick the next beat")
              : beat === "think"
                ? L("规划下一拍工作台", "Planning the next bench")
                : beat === "act"
                  ? L("即将放大执行面", "About to magnify the work surface")
                  : beat === "check"
                    ? L("本拍已校验，等待下一拍", "Beat verified — waiting for next")
                    : L("双轨观察 · 门店优先", "Dual-track observe · floor first")
          )}</em></p>`
        : "";
      el.innerHTML = `<div class="ecom-play-empty is-standby ${live ? "is-live" : ""}">
        <strong>${esc(
          live ? L("Playground 待命 · 下一拍即将放大", "Playground standby · next beat soon") : L("Playground 待命", "Playground standby")
        )}</strong>
        ${beatHtml}
        ${
          ctx.stage
            ? `<p class="ecom-standby-stage"><span>${esc(L("当前幕", "Act"))}</span><em>${esc(ctx.stage)}</em>${
                ctx.next ? `<small>${esc(ctx.next)}</small>` : ""
              }</p>`
            : ""
        }
        ${
          ctx.watch
            ? `<p class="ecom-standby-watch is-${esc(ctx.level || "info")}"><span>${esc(
                L("盯盘", "Watch")
              )}</span><em>${esc(ctx.watch)}</em></p>`
            : `<p>${esc(
                L("你去冲咖啡 / 打理门店时，Agent 会在这里放大：通话 · 包装 · 剪辑 · 定价表。", "While you brew / run the shop, Agent magnifies call · pack · edit · sheet here.")
              )}</p>`
        }
        <ul class="ecom-standby-chips">
          ${chips
            .map(
              ([id, label]) =>
                `<li class="${ctx.nextBench === id ? `is-next ${live ? "is-pulse" : ""}` : ""}">${esc(label)}${
                  ctx.nextBench === id ? `<b>${esc(L("下一拍", "Next"))}</b>` : ""
                }</li>`
            )
            .join("")}
        </ul>
        ${
          live
            ? `<p class="ecom-standby-dual"><i></i><em>${esc(
                L("你忙门店 · 我在后台选下一拍工作台", "You on floor · I pick the next bench in background")
              )}</em></p>`
            : ""
        }
      </div>`;
      this._syncBenchBusy();
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
      const changed = this._sheetChanged || [];
      const changeCount = changed.filter(Boolean).length;
      this.setStatus(
        changeCount
          ? L(`核对写回 · ${changeCount} 项变更`, `Writeback check · ${changeCount} fields`)
          : L("核对库存 / 定价写回", "Checking inventory / pricing writeback")
      );
      const heads = (this.sheet.headers || []).map((h) => `<th>${esc(h)}</th>`).join("");
      const row = (this.sheet.rows || [])[0] || [];
      const flashKey = {
        [L("成本", "Cost")]: 1,
        [L("售价", "Price")]: 2,
        [L("库存", "Stock")]: 3,
        [L("已售", "Sold")]: 4,
        [L("毛利", "Margin")]: 6,
      };
      const rows = (this.sheet.rows || [])
        .map(
          (r) =>
            `<tr>${r
              .map((c, i) => `<td class="${changed[i] ? "is-flash" : ""}">${esc(c)}</td>`)
              .join("")}</tr>`
        )
        .join("");
      const chips = [
        [L("成本", "Cost"), row[1]],
        [L("售价", "Price"), row[2]],
        [L("库存", "Stock"), row[3]],
        [L("已售", "Sold"), row[4]],
        [L("毛利", "Margin"), row[6]],
      ]
        .filter(([, v]) => v != null && v !== "")
        .map(
          ([k, v]) =>
            `<span class="ecom-sheet-chip ${changed[flashKey[k]] ? "is-flash" : ""}"><em>${esc(
              k
            )}</em><b>${esc(v)}</b></span>`
        )
        .join("");
      const ctx = this.getStandbyContext?.() || {};
      const live = Boolean(ctx.live);
      const en = getLocale() === "en";
      const beat = changeCount ? "check" : this._statusBeat({ acting: false });
      const beatSteps = [
        { id: "sense", zh: "感", en: "S" },
        { id: "think", zh: "想", en: "T" },
        { id: "act", zh: "做", en: "A" },
      ];
      const order = { sense: 0, think: 1, act: 2, check: 3, hold: -1 };
      const cur = order[beat] ?? -1;
      const beatHtml = live
        ? `<p class="ecom-sheet-beat" aria-hidden="true">${beatSteps
            .map((s, i) => {
              const state =
                beat === "check" || i < cur ? "is-done" : i === cur ? "is-on" : "";
              return `<b class="${state}">${esc(en ? s.en : s.zh)}</b>`;
            })
            .join("<i></i>")}<em>${esc(
            changeCount
              ? L("感→想→做：写回已静默校验", "S→T→A: writeback silently verified")
              : L("感→想→做：先感知回写，再开口汇报", "S→T→A: sense writebacks first, then speak")
          )}</em></p>`
        : "";
      const verify = changeCount
        ? `<p class="ecom-sheet-verify is-fresh"><i></i><span>${esc(
            L(`Agent 已核对 ${changeCount} 项写回 · 账表一致`, `Agent verified ${changeCount} writebacks · ledger in sync`)
          )}</span></p>`
        : `<p class="ecom-sheet-verify"><span>${esc(
            live
              ? L("无人值守盯盘 · 等待下一笔经营回写", "Hands-free watch · waiting for next ops writeback")
              : L("等待下一笔经营回写", "Waiting for the next ops writeback")
          )}</span></p>`;
      const dual = `<p class="ecom-sheet-dual ${changeCount ? "is-fresh" : ""}"><i></i><em>${esc(
        changeCount
          ? L("双轨：账表已对齐 · 你可继续门店", "Dual-track: ledger synced · keep the floor moving")
          : L("双轨：我盯账表回写 · 你忙门店现场", "Dual-track: I watch ledger writebacks · you run the floor")
      )}</em>${
        ctx.watch
          ? `<b class="is-${esc(ctx.level || "info")}">${esc(ctx.watch)}</b>`
          : ""
      }</p>
        <p class="ecom-next-action ecom-sheet-next">${esc(
          changeCount
            ? L("下一步：对照毛利/库存触线 → 决定改价或补货", "Next: check margin/stock lines → reprice or restock")
            : L("下一步：有回写时先静默核对，再开口汇报", "Next: verify silently on writeback, then speak")
        )}</p>`;
      el.innerHTML = `<div class="ecom-play-panel ecom-sheet-panel ${changeCount ? "is-verifying" : ""} ${
        live ? "is-dual" : ""
      }">
        <div class="ecom-sheet-summary">${chips || `<span class="muted">${esc(L("等待指标回写", "Waiting for KPI writeback"))}</span>`}</div>
        ${beatHtml}
        ${verify}
        ${dual}
        <div class="ecom-rich ecom-rich-table">
        <table><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>
      </div></div>`;
      this._syncBenchBusy();
      if (changeCount) {
        window.clearTimeout(this._sheetFlashTimer);
        this._sheetFlashTimer = window.setTimeout(() => {
          el.querySelectorAll(".is-flash").forEach((n) => n.classList.remove("is-flash"));
          el.querySelector(".ecom-sheet-verify")?.classList.remove("is-fresh");
          el.querySelector(".ecom-sheet-panel")?.classList.remove("is-verifying");
          this._sheetChanged = (this._sheetChanged || []).map(() => false);
          this._syncBenchBusy();
        }, 2200);
      }
      return;
    }

    if (mode === "deliverable" && this._deliverable) {
      const d = this._deliverable;
      const title = getLocale() === "en" ? d.title_en || d.title_zh : d.title_zh || d.title_en;
      this.setTitle(title || L("交付物", "Deliverable"));
      const cover = d.cover || "";
      const body = getLocale() === "en" ? d.body_en || d.body_zh : d.body_zh || d.body_en;
      const kind = d.kind || "file";
      const ctx = this.getStandbyContext?.() || {};
      const live = Boolean(ctx.live);
      const ageSec = Math.max(0, Math.round((Date.now() - Number(d.arrivedAt || Date.now())) / 1000));
      const age =
        ageSec < 2 ? L("刚落盘", "just pinned") : ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`;
      const nextByKind = {
        pack: L("下一步：合规过审后推进印刷 / 上架", "Next: clear compliance, then print / list"),
        video: L("下一步：同步运营投放，盯转化回写", "Next: sync ops for push and watch conversion"),
        note: L("下一步：观察笔记反馈，必要时改标题", "Next: watch note feedback, retitle if needed"),
        quote: L("下一步：锁价通话 → 写回定价表", "Next: lock-price call → write the price sheet"),
        profit: L("下一步：对照预算，收口本轮经营", "Next: check budget and close this ops loop"),
        sheet: L("下一步：继续销售节奏，盯库存触线", "Next: keep sales cadence, watch stock floor"),
      };
      const next =
        nextByKind[kind] ||
        L("下一步：交付物已归档，继续本幕动作", "Next: output pinned — continue the act");
      const summary = String(body || "")
        .split(/\n/)
        .find(Boolean) || L("已由 Agent 归档", "Pinned by Agent");
      this.setStatus(
        live
          ? L(`无人值守落盘 · ${kind}`, `Hands-free pin · ${kind}`)
          : L(`交付物预览 · ${kind}`, `Deliverable preview · ${kind}`)
      );
      el.innerHTML = `<div class="ecom-play-panel ecom-deliv-panel ${live ? "is-dual" : ""}">
        <div class="ecom-deliv-meta">
          <span class="ecom-pill is-done">${esc(kind)}</span>
          <strong>${esc(title || "")}</strong>
          <time>${esc(age)}</time>
        </div>
        ${this._digestBeatHtml(
          L("感→想→做：产出已校验落盘 · 门店优先", "S→T→A: output verified and pinned · floor first"),
          { mode: "verified" }
        )}
        <p class="ecom-stage-dual"><i></i><em>${esc(
          live
            ? L("双轨：产出已落盘 Dock · 你可继续门店", "Dual-track: output pinned in Dock · stay on the floor")
            : L("双轨：忙完门店后随时点开回看", "Dual-track: reopen anytime after floor work")
        )}</em><b>${esc(L("Dock", "Dock"))}</b></p>
        ${cover ? `<img class="ecom-play-hero" src="${esc(cover)}" alt="" />` : ""}
        <p class="ecom-deliv-summary">${esc(summary)}</p>
        <pre class="ecom-deliv-body">${esc(body || "")}</pre>
        ${
          ctx.watch
            ? `<p class="ecom-stage-watch is-${esc(ctx.level || "info")}"><span>${esc(
                L("盯盘", "Watch")
              )}</span><em>${esc(ctx.watch)}</em></p>`
            : ""
        }
        <p class="ecom-next-action">${esc(next)}</p>
      </div>`;
      return;
    }

    this.setTitle("—");
    el.innerHTML = `<div class="ecom-play-empty">—</div>`;
  }

  focusCommunication(threadId, { reveal = true } = {}) {
    if (!threadId || threadId === "boss") return;
    this.activeCommThread = threadId;
    this.commSeenAt = this.commSeenAt || {};
    this.commSeenAt[threadId] = Date.now();
    if (reveal) {
      this.switchBench("comms");
    }
  }

  pushCommunication(row, { reveal = true } = {}) {
    if (!row?.thread || row.thread === "boss") return;
    this._typingThread = null;
    const idx = this.commFeed.findIndex((m) => m.id === row.id);
    if (idx >= 0) this.commFeed[idx] = row;
    else this.commFeed.push(row);
    this._freshCommId = row.id;
    this.commSeenAt = this.commSeenAt || {};
    if (reveal) {
      this.activeCommThread = row.thread;
      this.commSeenAt[row.thread] = Math.max(this.commSeenAt[row.thread] || 0, row.ts || Date.now());
      this.switchBench("comms");
      return;
    }
    // Background arrival: keep unread unless the thread is already open.
    if (this.active === "comms" && this.activeCommThread === row.thread) {
      this.commSeenAt[row.thread] = Math.max(this.commSeenAt[row.thread] || 0, row.ts || Date.now());
      this._renderCommunication();
    } else if (this.active === "comms") {
      this._renderCommunication();
    }
    this._updateCommsBadge();
  }

  /** Show ephemeral "Agent is typing…" in the collaboration IM. */
  showCommsTyping(threadId) {
    if (!threadId || threadId === "boss") return;
    this._typingThread = threadId;
    this.activeCommThread = threadId;
    if (this.active !== "comms") this.switchBench("comms");
    else this._renderCommunication();
    this.setStatus(L("Agent 正在输入…", "Agent is typing…"));
  }

  hideCommsTyping() {
    if (!this._typingThread) return;
    this._typingThread = null;
    if (this.active === "comms") this._renderCommunication();
  }

  /** Why Agent opened this collaboration thread (dual-track cue). */
  _commIntent(thread) {
    const id = thread?.id || "";
    const tab = thread?.tab || "";
    if (/bean_|supplier|pack_factory/.test(id) || tab === "supplier") {
      return L("意图：核对报价 / 交期 / 锁单条款", "Why: verify quote / lead time / lock terms");
    }
    if (id === "design" || tab === "design") {
      return L("意图：推动包装合规与改稿闭环", "Why: drive pack compliance and revise loop");
    }
    if (/xhs|kol|marketing/.test(id) || tab === "marketing") {
      return L("意图：同步卖点、素材与投放节奏", "Why: sync pitch, assets, and push cadence");
    }
    if (id === "finance" || id === "cs" || tab === "ops") {
      return L("意图：对齐费用、客诉与交付风险", "Why: align cost, CS, and delivery risk");
    }
    return L("意图：推进本幕外部协作，不打断你门店事务", "Why: advance this act’s external collab without interrupting the floor");
  }

  _renderCommunication() {
    const el = this.playgroundEl;
    if (!el) return;
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
        const seenAt = (this.commSeenAt || {})[t.id] || 0;
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
        return `<button type="button" class="ecom-comms-contact ${
          t.id === thread?.id ? "is-active" : ""
        } ${unread ? "is-unread" : ""}" data-comm-thread="${esc(t.id)}">
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
    const freshId = this._freshCommId;
    const typingHere = this._typingThread && this._typingThread === thread?.id;
    const bubbles = messages.length
      ? messages
          .map((m) => {
            const mine = m.from === "agent";
            const isNew = m.id === freshId;
            return `<div class="ecom-app-msg ${mine ? "is-mine" : "is-peer"} ${isNew ? "is-new" : ""}">
              <span class="ecom-app-msg-who">${esc(mine ? "AI Agent" : threadName)}</span>
              ${m.html ? m.html : `<div class="ecom-app-bubble">${esc(m.text)}</div>`}
            </div>`;
          })
          .join("")
      : typingHere
        ? ""
        : `<div class="ecom-app-empty"><span class="ecom-empty-illustration">•••</span><strong>${esc(
            L("暂无消息", "No messages")
          )}</strong><small>${esc(
            L("由 Agent 创建或触发对话后，消息将显示在这里", "Messages appear here when the agent starts a conversation")
          )}</small></div>`;
    const typingHtml = typingHere
      ? `<div class="ecom-app-msg is-mine is-typing" aria-live="polite">
          <span class="ecom-app-msg-who">AI Agent</span>
          <div class="ecom-app-bubble is-typing"><i></i><i></i><i></i></div>
        </div>`
      : "";
    this.setTitle(L(`协作消息 · ${threadName}`, `Messages · ${threadName}`));
    if (!typingHere) {
      this.setStatus(
        L(`Agent 代办 · ${threadName}`, `Agent handling · ${threadName}`)
      );
    }
    const ctx = this.getStandbyContext?.() || {};
    const live = Boolean(ctx.live);
    const en = getLocale() === "en";
    const beat = typingHere ? "act" : this._statusBeat({ acting: false });
    const beatSteps = [
      { id: "sense", zh: "感", en: "S" },
      { id: "think", zh: "想", en: "T" },
      { id: "act", zh: "做", en: "A" },
    ];
    const order = { sense: 0, think: 1, act: 2, check: 3, hold: -1 };
    const cur = order[beat] ?? -1;
    const beatHtml = live
      ? `<p class="ecom-comms-beat" aria-hidden="true">${beatSteps
          .map((s, i) => {
            const state =
              beat === "check" || i < cur ? "is-done" : i === cur ? "is-on" : "";
            return `<b class="${state}">${esc(en ? s.en : s.zh)}</b>`;
          })
          .join("<i></i>")}<em>${esc(
          typingHere
            ? L("感→想→做：正在起草可执行回复", "S→T→A: drafting an actionable reply")
            : L("感→想→做：协作由我代办，不打断门店", "S→T→A: I handle collab without interrupting the floor")
        )}</em></p>`
      : "";
    const nextAction = typingHere
      ? L("下一步：发出可执行结论 → 细节落到工作台/交付物", "Next: send an actionable conclusion → park details on benches / outputs")
      : L("下一步：有外部回音时先记上下文，再决定是否插入动作", "Next: log context on external replies, then decide whether to insert an action");
    el.innerHTML = `<div class="ecom-comms-app ${live ? "is-dual" : ""}">
      <aside class="ecom-comms-contacts">
        <div class="ecom-comms-brand"><strong>${esc(L("协作 IM", "Team inbox"))}</strong><span>⌕　＋</span></div>
        ${contacts}
      </aside>
      <section class="ecom-comms-thread">
        <header><span class="ecom-online-dot"></span><strong>${esc(threadName)}</strong><small>${esc(
          live ? L("无人值守代办", "Hands-free handling") : L("应用内沟通", "In-app conversation")
        )}</small></header>
        <p class="ecom-comms-intent ${typingHere ? "is-live" : ""}"><span>${esc(
          L("意图", "Why")
        )}</span><em>${esc(intent.replace(/^意图：|^Why:\s*/i, ""))}</em></p>
        ${beatHtml}
        <p class="ecom-comms-dual"><i></i><em>${esc(
          typingHere
            ? L("双轨：你忙门店 · 我正在起草回复", "Dual-track: you on floor · I’m drafting a reply")
            : L("双轨：协作消息由我代办，不打断门店", "Dual-track: I handle collab chat without interrupting the floor")
        )}</em>${
          ctx.watch
            ? `<b class="is-${esc(ctx.level || "info")}">${esc(ctx.watch)}</b>`
            : `<b>${esc(L("门店优先", "Floor first"))}</b>`
        }</p>
        <p class="ecom-next-action ecom-comms-next">${esc(nextAction)}</p>
        <div class="ecom-app-messages">${bubbles}${typingHtml}</div>
        <div class="ecom-app-composer ${typingHere ? "is-agent" : ""}"><span>${esc(
          typingHere
            ? L("Agent 正在输入…", "Agent is typing…")
            : L("由 Agent 自动沟通 · 你可继续门店", "Agent handles chat · you stay on the floor")
        )}</span><button type="button">➤</button></div>
      </section>
    </div>`;
    el.querySelectorAll("[data-comm-thread]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeCommThread = btn.dataset.commThread;
        this.commSeenAt = this.commSeenAt || {};
        this.commSeenAt[this.activeCommThread] = Date.now();
        this._renderCommunication();
        this._updateCommsBadge();
      });
    });
    const msgBox = el.querySelector(".ecom-app-messages");
    if (msgBox) {
      msgBox.scrollTop = msgBox.scrollHeight;
      if (freshId || typingHere) {
        requestAnimationFrame(() => {
          msgBox.scrollTop = msgBox.scrollHeight;
        });
      }
    }
    if (freshId) {
      window.clearTimeout(this._freshCommTimer);
      this._freshCommTimer = window.setTimeout(() => {
        if (this._freshCommId === freshId) this._freshCommId = null;
        el.querySelector(".ecom-app-msg.is-new")?.classList.remove("is-new");
      }, 1600);
    }
    this._updateCommsBadge();
  }

  _scrollTranscript() {
    const box = this.playgroundEl?.querySelector(".ecom-stream-log");
    if (box) box.scrollTop = box.scrollHeight;
  }

  /* —— Call: card + streaming ASR transcript —— */

  _callSurfaceHtml(c = {}) {
    const lines = c.lines || [];
    const streaming = c.streamingLine;
    const live = c.phase !== "ended" && !c.ended;
    const ex = c.extract || {};
    const locked = ["price", "qty", "lead", "qc"].filter((k) => Boolean(ex[k]) || (k === "price" && c.agreedPrice != null))
      .length;
    const dualLive = Boolean(this.getStandbyContext?.()?.live);
    return `<div class="ecom-call-surface ${dualLive ? "is-dual" : ""} ${live ? "is-live" : "is-done"}">
      ${this._callCardHtml(c)}
      <p class="ecom-call-summary ${live ? "is-live" : "is-done"}"><span>${esc(
        live ? L("Agent 代办", "Agent handling") : L("通话完成", "Call complete")
      )}</span><em>${esc(
        live
          ? L("边听边锁条款", "Locking terms live")
          : L("条款已校验归档", "Terms verified and archived")
      )}</em><b>${esc(live ? `${locked}/4` : L("已归档", "Archived"))}</b></p>
      <div class="ecom-stream-panel">
        <div class="ecom-stream-panel-head">
          <span class="ecom-pill ${live ? "is-live" : "is-done"}">${esc(
            live ? L("实时转写", "Live transcript") : L("通话转写", "Transcript")
          )}</span>
          <span class="ecom-stream-hint">${esc(
            live ? L("ASR · 边听边锁条款", "ASR · extracting terms live") : L("ASR · 已归档", "ASR · archived")
          )}</span>
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
      </div>
    </div>`;
  }

  _callExtractHtml(extract = {}, { live = true, agreedPrice } = {}) {
    const chips = [
      ["price", L("锁价", "Price"), extract.price || (agreedPrice != null ? `¥${agreedPrice}/kg` : "")],
      ["qty", L("量", "Qty"), extract.qty || ""],
      ["lead", L("交期", "Lead"), extract.lead || ""],
      ["qc", L("质检", "QC"), extract.qc || ""],
    ];
    return `<div class="ecom-call-extract ${live ? "is-live" : "is-done"}" aria-label="terms">
      ${chips
        .map(([key, label, value]) => {
          const on = Boolean(value);
          return `<span class="${on ? "is-on" : "is-pending"}" data-term="${esc(key)}">
            <em>${esc(label)}</em><b>${esc(on ? value : live ? L("提取中", "Listening") : "—")}</b>
          </span>`;
        })
        .join("")}
    </div>`;
  }

  _callCardHtml({
    name,
    topic,
    note,
    agreedPrice,
    phase = "live",
    timer = "00:00",
    asrConf = 0.92,
    streamingLine = null,
    extract = null,
  } = {}) {
    const live = phase === "live";
    const pill = live
      ? `<span class="ecom-pill is-live">${esc(L("通话中", "On call"))}</span>`
      : `<span class="ecom-pill is-done">${esc(L("已结束", "Ended"))}</span>`;
    const title = live
      ? L("正在通话：", "On call with: ") + (name || "")
      : L("通话结束：", "Call ended · ") + (name || "");
    const confPct = Math.round((Number(asrConf) || 0.9) * 100);
    const ex = extract || {
      price: phase === "ended" && agreedPrice != null ? `¥${agreedPrice}/kg` : "",
      qty: phase === "ended" ? "80kg" : "",
      lead: phase === "ended" ? L("7 天", "7 days") : "",
      qc: phase === "ended" ? L("封样", "Sealed sample") : "",
    };
    const speaking = streamingLine
      ? streamingLine.role === "agent"
        ? L(`Agent 正在确认条款 · ${streamingLine.who || "AI"}`, `Agent confirming terms · ${streamingLine.who || "AI"}`)
        : L(`对方发言中 · ${streamingLine.who || name || ""}`, `Counterparty speaking · ${streamingLine.who || name || ""}`)
      : "";
    return `<div class="ecom-rich ecom-rich-call ${live ? "is-live" : "is-ended"}">
      <div class="ecom-rich-head">
        ${pill}
        <strong>${esc(title)}</strong>
        <span class="ecom-timer">${esc(timer)}</span>
      </div>
      <div class="ecom-wave ${streamingLine ? `is-speak-${esc(streamingLine.role || "peer")}` : ""}" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      ${
        live && topic
          ? `<p class="ecom-call-topic"><span>${esc(L("议题", "Topic"))}</span>${esc(topic)}</p>`
          : ""
      }
      <p class="ecom-call-speaking ${speaking ? "is-live" : "is-idle"}">${esc(
        speaking || L("正在监听…", "Listening…")
      )}</p>
      ${
        live
          ? `<p class="ecom-call-asr"><span>${esc(L("ASR 置信", "ASR conf"))}</span><i style="--c:${confPct}%"></i><em>${confPct}%</em></p>`
          : ""
      }
      ${this._callExtractHtml(ex, { live, agreedPrice })}
      ${
        phase === "ended"
          ? `<p class="ecom-call-note muted">${esc(
              note || L("条款已口头确认，Agent 将生成锁单纪要", "Terms confirmed verbally — Agent will draft the lock memo")
            )}</p>
             <p class="ecom-next-action">${esc(
               L("下一步：写回定价表 · 同步财务预留预算", "Next: write price sheet · reserve finance budget")
             )}</p>`
          : ""
      }
    </div>`;
  }

  _syncCallAsrUi(state) {
    const pct = Math.round((Number(state?.asrConf) || 0.9) * 100);
    const bar = this.playgroundEl?.querySelector(".ecom-call-asr i");
    const confEl = this.playgroundEl?.querySelector(".ecom-call-asr em");
    if (bar) bar.style.setProperty("--c", `${pct}%`);
    if (confEl) confEl.textContent = `${pct}%`;
    const speak = this.playgroundEl?.querySelector(".ecom-call-speaking");
    const wave = this.playgroundEl?.querySelector(".ecom-rich-call .ecom-wave");
    const line = state?.streamingLine;
    if (speak) {
      if (line) {
        speak.textContent =
          line.role === "agent"
            ? L(`Agent 正在确认条款 · ${line.who || "AI"}`, `Agent confirming terms · ${line.who || "AI"}`)
            : L(`对方发言中 · ${line.who || state.name || ""}`, `Counterparty speaking · ${line.who || state.name || ""}`);
        speak.classList.add("is-live");
        speak.classList.remove("is-idle");
      } else {
        speak.textContent = L("正在监听…", "Listening…");
        speak.classList.remove("is-live");
        speak.classList.add("is-idle");
      }
    }
    if (wave) {
      wave.classList.remove("is-speak-agent", "is-speak-peer");
      if (line?.role) wave.classList.add(`is-speak-${line.role}`);
    }
  }

  _syncCallExtractUi(state) {
    const root = this.playgroundEl?.querySelector(".ecom-call-extract");
    if (!root || !state) return;
    const extract = state.extract || {};
    root.querySelectorAll("[data-term]").forEach((chip) => {
      const key = chip.dataset.term;
      const value = extract[key];
      const on = Boolean(value);
      chip.classList.toggle("is-on", on);
      chip.classList.toggle("is-pending", !on);
      const b = chip.querySelector("b");
      if (b) b.textContent = on ? value : L("提取中", "Listening");
      if (on) {
        chip.classList.remove("is-pop");
        void chip.offsetWidth;
        chip.classList.add("is-pop");
      }
    });
  }

  _advanceCallExtract(state, lineIndex = 0) {
    if (!state) return;
    const price = state.agreedPrice;
    state.extract = state.extract || {};
    if (lineIndex >= 1 && price != null) state.extract.price = `¥${price}/kg`;
    if (lineIndex >= 1) state.extract.qty = "80kg";
    if (lineIndex >= 1) state.extract.lead = L("7 天", "7 days");
    if (lineIndex >= 3) state.extract.qc = L("封样可退换", "Sealed + replaceable");
    if (lineIndex >= 5) {
      state.extract.price = `¥${price}/kg`;
      state.extract.qty = "80kg";
      state.extract.lead = L("7 天", "7 days");
      state.extract.qc = L("封样", "Sealed sample");
    }
    this._syncCallExtractUi(state);
  }

  async _streamLine({ who, role, text, chunkMs = 36 }) {
    const state = this._callState;
    if (!state) return;
    state.streamingLine = { who, role, text: "" };
    state.asrConf = role === "peer" ? 0.86 : 0.94;
    this._syncCallAsrUi(state);
    // Refresh card speaking/wave without wiping the transcript DOM.
    const card = this.playgroundEl?.querySelector(".ecom-rich-call");
    if (card) {
      const fresh = document.createElement("div");
      fresh.innerHTML = this._callCardHtml(state);
      const nextCard = fresh.firstElementChild;
      if (nextCard) card.replaceWith(nextCard);
    }
    const log = this.playgroundEl?.querySelector(".ecom-stream-log");
    const row = document.createElement("div");
    row.className = `ecom-stream-line is-${role} is-typing`;
    row.innerHTML = `<span class="who">${esc(who)}</span><span class="text"></span><span class="asr-tag">${esc(
      L("识别中", "Listening")
    )}</span>`;
    log?.appendChild(row);
    this._scrollTranscript();
    this.setStatus(L(`通话转写 · ${who}`, `Call transcript · ${who}`));
    const chunks = transcriptChunks(text);
    let acc = "";
    for (let i = 0; i < chunks.length; i++) {
      if (this._animToken !== state.token) return;
      acc += chunks[i];
      state.streamingLine = { who, role, text: acc };
      state.asrConf = Math.min(0.98, (state.asrConf || 0.86) + 0.01);
      const typing = row.querySelector(".text");
      if (typing) {
        typing.textContent = acc;
        this._scrollTranscript();
      }
      this._syncCallAsrUi(state);
      await sleepPlayback(Math.max(70, chunkMs * 2.5), { min: 38, max: 110 });
    }
    state.lines = [...(state.lines || []), { who, role, text }];
    state.streamingLine = null;
    row.classList.remove("is-typing");
    row.querySelector(".asr-tag")?.remove();
    this._syncCallAsrUi(state);
  }

  async _glideCursor(points = [], hopMs = 180) {
    const token = this._packState?.token ?? this._animToken;
    for (const point of points) {
      if (!this._packState || token !== this._animToken) return;
      const [x, y] = Array.isArray(point) ? point : [point?.x, point?.y];
      if (x == null || y == null) continue;
      this._packState.cx = x;
      this._packState.cy = y;
      this._syncPackSurface();
      const cursor = this.playgroundEl?.querySelector(".ecom-agentic-cursor");
      cursor?.classList.add("is-click");
      await sleepPlayback(hopMs, { min: 110, max: hopMs + 90 });
      cursor?.classList.remove("is-click");
    }
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
      ended: false,
      timer: "00:08",
      lines: [],
      streamingLine: null,
      extract: {},
      asrConf: 0.9,
    };
    this.renderPlayground();
    this.setStatus(L(`锁价通话 · ${peer}`, `Lock-price call · ${peer}`));
    this._syncBenchBusy();

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
      this._advanceCallExtract(this._callState, i);
      if (i === 1 || i === 3 || i === lines.length - 1) {
        this.onUpdateCard?.(msgId || cardId, { html: this._callCardHtml(this._callState) });
      }
      await sleepPlayback(240, { min: 120, max: 360 });
    }

    await sleepPlayback(Math.max(800, durationMs * 0.15), { min: 600, max: 2000 });
    this._callState.phase = "ended";
    this._callState.ended = true;
    this._callState.timer = "03:21";
    this._callState.note = note || close;
    this._callState.extract = {
      price: `¥${price}/kg`,
      qty: "80kg",
      lead: L("7 天", "7 days"),
      qc: L("封样", "Sealed sample"),
    };
    this.renderPlayground();
    this.setStatus(L(`通话结束 · 锁价 ¥${price}/kg`, `Call ended · locked ¥${price}/kg`));
    this._syncBenchBusy();
    this.onUpdateCard?.(msgId || cardId, { html: this._callCardHtml(this._callState) });
    // Boss-thread decision digest so the human (busy in shop) still sees the lock.
    const callCtx = this.getStandbyContext?.() || {};
    const callLive = Boolean(callCtx.live);
    this.onRichCard?.({
      thread: "boss",
      kind: "call",
      title: L("锁单决策", "Lock decision"),
      bodyHtml: `<div class="ecom-rich ecom-rich-call is-ended is-digest ${callLive ? "is-dual" : ""}">
        <div class="ecom-rich-head"><span class="ecom-pill is-done">${esc(L("决策落定", "Decided"))}</span>
          <strong>${esc(L(`已与 ${peer} 锁价`, `Locked price with ${peer}`))}</strong></div>
        <div class="ecom-call-terms">
          <span><em>${esc(L("锁价", "Price"))}</em><b>¥${esc(String(price))}/kg</b></span>
          <span><em>${esc(L("量", "Qty"))}</em><b>80kg</b></span>
          <span><em>${esc(L("交期", "Lead"))}</em><b>${esc(L("7 天", "7 days"))}</b></span>
          <span><em>${esc(L("质检", "QC"))}</em><b>${esc(L("封样", "Sealed sample"))}</b></span>
        </div>
        ${this._digestBeatHtml(
          L("感→想→做：锁价条款已校验落定", "S→T→A: lock terms verified and set")
        )}
        <p class="ecom-stage-dual"><i></i><em>${esc(
          callLive
            ? L("双轨：锁价已落定 · 你继续门店", "Dual-track: price locked · you stay on the floor")
            : L("双轨：忙完门店后可回看锁单", "Dual-track: reopen the lock after floor work")
        )}</em><b>${esc(L("写回账表", "Write sheet"))}</b></p>
        ${
          callCtx.watch
            ? `<p class="ecom-stage-watch is-${esc(callCtx.level || "info")}"><span>${esc(
                L("盯盘", "Watch")
              )}</span><em>${esc(callCtx.watch)}</em></p>`
            : ""
        }
        <p class="ecom-next-action">${esc(
          L("下一步：写回定价表 · 同步财务预留预算", "Next: write price sheet · reserve finance budget")
        )}</p>
      </div>`,
    });
  }

  /* —— Pack: agentic continuous design —— */

  /** Live digest beat rail (感→想→做) for boss-thread decision / call cards. */
  _digestBeatHtml(cue = "", { mode = "verified" } = {}) {
    const live = Boolean(this.getStandbyContext?.()?.live);
    if (!live) return "";
    const en = getLocale() === "en";
    const steps = [
      { id: "sense", zh: "感", en: "S" },
      { id: "think", zh: "想", en: "T" },
      { id: "act", zh: "做", en: "A" },
    ];
    const beat =
      mode === "observing"
        ? "sense"
        : mode === "planning"
          ? "think"
          : mode === "acting"
            ? "act"
            : "check";
    const order = { sense: 0, think: 1, act: 2, check: 3 };
    const cur = order[beat] ?? 2;
    const rail = `<span class="ecom-card-beat" data-beat="${esc(beat)}" aria-hidden="true">${steps
      .map((s, i) => {
        const state =
          beat === "check" || i < cur ? "is-done" : i === cur ? "is-on" : "";
        return `<b class="${state}">${esc(en ? s.en : s.zh)}</b>`;
      })
      .join("<i></i>")}</span>`;
    return `<p class="ecom-card-beat-row" aria-hidden="true">${rail}<em>${esc(
      cue || L("感→想→做：决策已落定 · 门店优先", "S→T→A: decision set · floor first")
    )}</em></p>`;
  }

  /** Collab-thread start card while Agent runs pack/edit hands-free. */
  _agenticStartCardHtml({ kind = "pack", title = "", why = "", next = "" } = {}) {
    const live = Boolean(this.getStandbyContext?.()?.live);
    const isEdit = kind === "edit";
    const pill = isEdit ? L("剪辑中", "Editing") : L("包装设计", "Pack design");
    const dual = isEdit
      ? L("双轨：剪辑时间线由我推进 · 你忙门店", "Dual-track: I drive the edit timeline · you run the floor")
      : L("双轨：连续改稿交给我 · 你忙门店", "Dual-track: I take continuous revise · you run the floor");
    const nextLine =
      next ||
      (isEdit
        ? L("下一步：导出成片 → 归档交付物 → 通知运营", "Next: export cut → pin output → ping ops")
        : L("下一步：完成改稿节点 → 合规过审 → 归档交付", "Next: finish revise nodes → compliance → pin output"));
    const en = getLocale() === "en";
    const beatSteps = [
      { id: "sense", zh: "感", en: "S" },
      { id: "think", zh: "想", en: "T" },
      { id: "act", zh: "做", en: "A" },
    ];
    const beatHtml = live
      ? `<p class="ecom-card-beat-row" aria-hidden="true"><span class="ecom-card-beat">${beatSteps
          .map((s, i) => {
            const state = i < 2 ? "is-done" : "is-on";
            return `<b class="${state}">${esc(en ? s.en : s.zh)}</b>`;
          })
          .join("<i></i>")}</span><em>${esc(
          isEdit
            ? L("感→想→做：进入剪辑节点，门店优先", "S→T→A: enter edit node, floor first")
            : L("感→想→做：进入改稿节点，门店优先", "S→T→A: enter revise node, floor first")
        )}</em></p>`
      : "";
    return `<div class="ecom-rich ecom-rich-${esc(kind)} is-live ${live ? "is-dual" : ""}">
      <div class="ecom-rich-head"><span class="ecom-pill is-live">${esc(pill)}</span>
        <strong>${esc(title)}</strong></div>
      ${
        why
          ? `<p class="ecom-tool-why"><span>${esc(L("意图", "Why"))}</span>${esc(why)}</p>`
          : ""
      }
      ${beatHtml}
      <p class="ecom-stage-dual"><i></i><em>${esc(dual)}</em><b>${esc(L("无人值守", "Hands-free"))}</b></p>
      <p class="ecom-next-action">${esc(nextLine)}</p>
    </div>`;
  }

  _agenticMetaHtml({ busy, pct = 0, step = 0, total = 4, next = "", kind = "pack" } = {}) {
    const safeTotal = Math.max(1, total);
    const safeStep = Math.min(safeTotal, Math.max(0, step));
    const dual =
      kind === "edit"
        ? busy
          ? L("双轨：剪辑时间线由我推进 · 你忙门店", "Dual-track: I drive the edit timeline · you run the floor")
          : L("双轨：剪辑节点已完成 · 门店可继续", "Dual-track: edit node done · floor can continue")
        : busy
          ? L("双轨：连续改稿交给我 · 你忙门店", "Dual-track: I take continuous revise · you run the floor")
          : L("双轨：改稿节点已完成 · 门店可继续", "Dual-track: revise node done · floor can continue");
    const live = Boolean(this.getStandbyContext?.()?.live);
    const en = getLocale() === "en";
    const beat = busy ? "act" : "check";
    const beatSteps = [
      { id: "sense", zh: "感", en: "S" },
      { id: "think", zh: "想", en: "T" },
      { id: "act", zh: "做", en: "A" },
    ];
    const order = { sense: 0, think: 1, act: 2, check: 3 };
    const cur = order[beat] ?? 2;
    const beatHtml = live
      ? `<span class="ecom-agentic-beat" aria-hidden="true">${beatSteps
          .map((s, i) => {
            const state =
              beat === "check" || i < cur ? "is-done" : i === cur ? "is-on" : "";
            return `<b class="${state}">${esc(en ? s.en : s.zh)}</b>`;
          })
          .join("<i></i>")}<em>${esc(
          busy
            ? kind === "edit"
              ? L("正在做 · 剪辑节点", "Acting · edit node")
              : L("正在做 · 改稿节点", "Acting · revise node")
            : L("已校验 · 本步收口", "Verified · step closed")
        )}</em></span>`
      : "";
    return `<div class="ecom-agentic-meta ${live ? "is-dual" : ""}">
      <span class="ecom-agentic-hands ${busy ? "is-on" : "is-done"}">${esc(
        busy ? L("无人值守", "Hands-free") : L("本步完成", "Step done")
      )}</span>
      <span class="ecom-agentic-count">${esc(`${safeStep}/${safeTotal}`)}</span>
      <span class="ecom-agentic-pct">${esc(`${Math.round(pct)}%`)}</span>
      ${next ? `<em class="ecom-agentic-next">${esc(next)}</em>` : ""}
      ${beatHtml}
      <p class="ecom-agentic-dual ${busy ? "is-busy" : "is-done"}"><i></i><em>${esc(dual)}</em></p>
    </div>`;
  }

  _packChecksHtml(s = {}) {
    const useV1 = Boolean(s.useV1);
    const n = (s.steps || []).length;
    const done = !s.busy;
    const checks = useV1
      ? [
          [L("色板", "Palette"), n >= 1 || done],
          [L("袋型", "Pouch"), n >= 2 || done],
          [L("文案", "Copy"), n >= 3 || done],
          [L("预览", "Preview"), n >= 4 || done],
        ]
      : [
          [L("驳回", "Reject"), n >= 1 || done],
          [L("去功效", "Safe copy"), n >= 2 || done],
          [L("成分", "Ingredient"), n >= 3 || done],
          [L("过审", "Approved"), n >= 4 || done],
        ];
    return `<div class="ecom-agentic-checks">${checks
      .map(
        ([label, on]) =>
          `<span class="${on ? "is-on" : ""}"><i></i>${esc(label)}</span>`
      )
      .join("")}</div>`;
  }

  _packSurfaceHtml() {
    const s = this._packState || {};
    const src = s.src || this.media("pack_v2");
    const steps = s.steps || [];
    const pct = s.pct ?? 0;
    const total = s.totalSteps || 4;
    const why =
      s.why ||
      L("包装必须先过合规，再进印刷排期", "Pack must clear compliance before print scheduling");
    const next = s.busy
      ? L("下一步：完成当前改稿节点后归档", "Next: finish this revise node, then pin")
      : L("下一步：归档交付物并推进下一环", "Next: pin deliverable and advance");
    const packLive = Boolean(this.getStandbyContext?.()?.live);
    return `<div class="ecom-agentic-surface is-pack ${s.busy ? "is-busy" : ""} ${
      packLive ? "is-dual" : ""
    }">
      <div class="ecom-agentic-canvas">
        <img class="ecom-play-hero ${s.busy ? "is-scrubbing" : ""}" src="${esc(src)}" alt="" />
        ${s.busy ? `<div class="ecom-agentic-cursor" style="--x:${s.cx || 62}%;--y:${s.cy || 38}%"></div>` : ""}
        <div class="ecom-agentic-badge">${esc(s.badge || "Agent editing")}</div>
      </div>
      <div class="ecom-agentic-side">
        <p class="ecom-agentic-why"><span>${esc(L("意图", "Why"))}</span>${esc(why)}</p>
        ${this._agenticMetaHtml({ busy: s.busy, pct, step: steps.length, total, next, kind: "pack" })}
        <div class="ecom-agentic-progress"><i style="width:${esc(pct)}%"></i></div>
        ${this._packChecksHtml(s)}
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
    const count = root.querySelector(".ecom-agentic-count");
    const pctEl = root.querySelector(".ecom-agentic-pct");
    const checks = root.querySelector(".ecom-agentic-checks");
    if (progress) progress.style.width = `${state.pct}%`;
    if (cursor) {
      cursor.style.setProperty("--x", `${state.cx}%`);
      cursor.style.setProperty("--y", `${state.cy}%`);
    }
    if (badge) badge.textContent = state.badge || "";
    if (image && state.src && image.getAttribute("src") !== state.src) image.setAttribute("src", state.src);
    if (count) count.textContent = `${(state.steps || []).length}/${state.totalSteps || 4}`;
    if (pctEl) pctEl.textContent = `${Math.round(state.pct || 0)}%`;
    if (checks) checks.outerHTML = this._packChecksHtml(state);
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
    const editLive = Boolean(this.getStandbyContext?.()?.live);
    return `<div class="ecom-agentic-surface is-edit ${s.busy ? "is-busy" : ""} ${
      editLive ? "is-dual" : ""
    }">
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
        <p class="ecom-agentic-why"><span>${esc(L("意图", "Why"))}</span>${esc(
          s.why || L("短视频要跟上本周卖点与安全话术", "Clip must match this week’s pitch and safe copy")
        )}</p>
        ${this._agenticMetaHtml({
          busy: s.busy,
          pct,
          step: steps.length,
          total: s.totalSteps || 4,
          kind: "edit",
          next: s.busy
            ? L("下一步：卡点剪辑后叠安全字幕", "Next: beat-cut, then safe captions")
            : L("下一步：归档成片并通知运营", "Next: pin the cut and ping ops"),
        })}
        ${this._editChecksHtml(s)}
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

  _editChecksHtml(s = {}) {
    const n = (s.steps || []).length;
    const done = !s.busy;
    const checks = [
      [L("素材", "Media"), n >= 1 || done],
      [L("卡点", "Beat-cut"), n >= 2 || done],
      [L("字幕", "Caption"), n >= 3 || done],
      ["CTA", n >= 4 || done],
    ];
    return `<div class="ecom-agentic-checks">${checks
      .map(([label, on]) => `<span class="${on ? "is-on" : ""}"><i></i>${esc(label)}</span>`)
      .join("")}</div>`;
  }

  _syncEditMotion() {
    const state = this._editState;
    const root = this.playgroundEl;
    if (!state || !root) return;
    const playhead = root.querySelector(".ecom-playhead");
    const progress = root.querySelector(".ecom-edit-bar i");
    const progressText = root.querySelector(".ecom-edit-bar b");
    const timecode = root.querySelector(".ecom-video-dur");
    const count = root.querySelector(".ecom-agentic-count");
    const pctEl = root.querySelector(".ecom-agentic-pct");
    const checks = root.querySelector(".ecom-agentic-checks");
    const hands = root.querySelector(".ecom-agentic-hands");
    if (playhead) playhead.style.left = `${state.playhead}%`;
    if (progress) progress.style.width = `${state.pct}%`;
    if (progressText) progressText.textContent = `${state.pct}%`;
    if (timecode) timecode.textContent = `${state.timecode}:00`;
    if (count) count.textContent = `${(state.steps || []).length}/${state.totalSteps || 4}`;
    if (pctEl) pctEl.textContent = `${Math.round(state.pct || 0)}%`;
    if (hands) {
      hands.textContent = state.busy ? L("无人值守", "Hands-free") : L("本步完成", "Step done");
      hands.classList.toggle("is-on", Boolean(state.busy));
      hands.classList.toggle("is-done", !state.busy);
    }
    if (checks) checks.outerHTML = this._editChecksHtml(state);
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
      token,
      label: this._packLabel,
      src: useV1 ? srcV1 : srcV1,
      steps: [],
      pct: 6,
      busy: true,
      useV1,
      totalSteps: stepsPlan.length,
      badge: L("Agent 设计中", "Agent designing"),
      why: useV1
        ? L("先出可预览 v1，方便合规预审提意见", "Ship a reviewable v1 so compliance can comment early")
        : L("按驳回意见改稿，剔除功效暗示词", "Revise per reject notes and strip efficacy wording"),
      cx: 58,
      cy: 36,
    };
    this.renderPlayground();
    this._syncBenchBusy();
    this.setStatus(L(`无人值守 · 包装设计`, `Hands-free · pack design`));
    this.onRichCard({
      thread: "design",
      kind: "pack",
      title: "pack",
      bodyHtml: this._agenticStartCardHtml({
        kind: "pack",
        title: this._packLabel,
        why: this._packState.why,
        next: useV1
          ? L("下一步：出 v1 预览 → 合规预审提意见", "Next: ship v1 preview → compliance comments")
          : L("下一步：按驳回改稿 → 过审后归档交付", "Next: revise per reject → clear, then pin"),
      }),
    });

    const paths = [
      [
        { x: 28, y: 24 },
        { x: 46, y: 32, click: true },
        { x: 62, y: 28 },
      ],
      [
        { x: 70, y: 42 },
        { x: 58, y: 58, click: true },
        { x: 44, y: 52 },
      ],
      [
        { x: 34, y: 66 },
        { x: 52, y: 70, click: true },
        { x: 68, y: 62 },
      ],
      [
        { x: 74, y: 38 },
        { x: 60, y: 46, click: true },
        { x: 48, y: 34 },
      ],
    ];
    const slice = Math.max(900, Math.floor(durationMs / stepsPlan.length));
    for (let i = 0; i < stepsPlan.length; i++) {
      if (token !== this._animToken) return;
      this._packState.token = token;
      this._packState.steps = stepsPlan.slice(0, i + 1);
      this._packState.pct = Math.round(((i + 0.35) / stepsPlan.length) * 100);
      if (!useV1 && i >= 2) this._packState.src = srcV2;
      if (useV1) this._packState.src = srcV1;
      this._packState.badge = stepsPlan[i];
      this.setStatus(L(`无人值守 · ${i + 1}/${stepsPlan.length} · ${stepsPlan[i]}`, `Hands-free · ${i + 1}/${stepsPlan.length} · ${stepsPlan[i]}`));
      this._syncPackSurface();
      await this._glideCursor(paths[i % paths.length], Math.max(120, Math.floor(slice / 5)));
      this._packState.pct = Math.round(((i + 1) / stepsPlan.length) * 100);
      this._syncPackSurface();
      await sleepPlayback(Math.max(220, slice * 0.28), { min: 160, max: 520 });
    }
    if (token !== this._animToken) return;
    this._packState.busy = false;
    this._packState.badge = useV1 ? L("v1 定稿预览", "v1 draft ready") : L("v2 过审稿", "v2 approved");
    this._packState.src = useV1 ? srcV1 : srcV2;
    this.renderPlayground();
    this._syncPlayStatus();
    const packCtx = this.getStandbyContext?.() || {};
    const packLive = Boolean(packCtx.live);
    this.onRichCard?.({
      thread: "boss",
      kind: "pack",
      title: this._packState.badge,
      bodyHtml: `<div class="ecom-rich ecom-rich-pack is-digest ${packLive ? "is-dual" : ""}">
        <div class="ecom-rich-head"><span class="ecom-pill is-done">${esc(L("设计落定", "Design set"))}</span>
          <strong>${esc(this._packState.badge)}</strong></div>
        <div class="ecom-call-terms">
          <span><em>${esc(L("版本", "Ver"))}</em><b>${esc(useV1 ? "v1" : "v2")}</b></span>
          <span><em>${esc(L("合规", "Compliance"))}</em><b>${esc(
            useV1 ? L("待预审", "Pending") : L("已过审", "Cleared")
          )}</b></span>
          <span><em>${esc(L("节点", "Steps"))}</em><b>4/4</b></span>
          <span><em>${esc(L("落盘", "Pin"))}</em><b>${esc(L("推进中", "Next"))}</b></span>
        </div>
        <p class="muted">${esc(
          useV1
            ? L("袋型与主视觉已出 v1，待合规预审。", "Pouch + hero v1 ready for compliance pre-check.")
            : L("已按驳回意见改稿，功效暗示词已剔除。", "Revised per reject notes; efficacy wording removed.")
        )}</p>
        ${this._digestBeatHtml(
          useV1
            ? L("感→想→做：v1 定稿节点已收口", "S→T→A: v1 draft node closed")
            : L("感→想→做：改稿合规节点已收口", "S→T→A: revise/compliance node closed")
        )}
        <p class="ecom-stage-dual"><i></i><em>${esc(
          packLive
            ? L("双轨：改稿已收口 · 你继续门店", "Dual-track: revise closed · you stay on the floor")
            : L("双轨：忙完门店后可回看稿件", "Dual-track: reopen the art after floor work")
        )}</em><b>${esc(
          useV1 ? L("合规预审", "Pre-check") : L("归档交付", "Pin output")
        )}</b></p>
        ${
          packCtx.watch
            ? `<p class="ecom-stage-watch is-${esc(packCtx.level || "info")}"><span>${esc(
                L("盯盘", "Watch")
              )}</span><em>${esc(packCtx.watch)}</em></p>`
            : ""
        }
        <p class="ecom-next-action">${esc(
          useV1
            ? L("下一步：合规预审 → 按意见改 v2 → 归档交付物", "Next: compliance pre-check → revise to v2 → pin output")
            : L("下一步：归档交付物 → 推进印刷 / 上架", "Next: pin output → print / list")
        )}</p>
      </div>`,
    });
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
      totalSteps: stepsPlan.length,
      badge: L("Agent 剪辑中", "Agent editing"),
      why: L("用开箱/冲煮镜头讲清卖点，字幕只用安全话术", "Tell the offer with unbox/brew shots; captions stay safe"),
      playhead: 6,
      activeClip: 0,
      timecode: "00:02",
      barLabel: L("剪辑进度", "Edit progress"),
    };
    this.renderPlayground();
    this._syncBenchBusy();
    this.setStatus(L("无人值守 · 视频剪辑", "Hands-free · video edit"));
    this.onRichCard({
      thread: "xhs_ops",
      kind: "edit",
      title: "edit",
      bodyHtml: this._agenticStartCardHtml({
        kind: "edit",
        title: this._editLabel,
        why: this._editState.why,
        next: L("下一步：卡点剪辑 → 安全字幕 → 导出 28s", "Next: beat-cut → safe captions → export 28s"),
      }),
    });

    const slice = Math.max(900, Math.floor(durationMs / stepsPlan.length));
    for (let i = 0; i < stepsPlan.length; i++) {
      if (token !== this._animToken) return;
      this._editState.steps = stepsPlan.slice(0, i + 1);
      this._editState.activeClip = i;
      this._editState.clips = clips.map((c, idx) => ({ ...c, on: idx <= i }));
      this._editState.badge = stepsPlan[i];
      this._editState.barLabel = stepsPlan[i];
      this.setStatus(
        L(`无人值守 · ${i + 1}/${stepsPlan.length} · ${stepsPlan[i]}`, `Hands-free · ${i + 1}/${stepsPlan.length} · ${stepsPlan[i]}`)
      );
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
    this._syncPlayStatus();
    const editCtx = this.getStandbyContext?.() || {};
    const editLive = Boolean(editCtx.live);
    this.onRichCard?.({
      thread: "boss",
      kind: "edit",
      title: this._editState.badge,
      bodyHtml: `<div class="ecom-rich ecom-rich-edit is-digest ${editLive ? "is-dual" : ""}">
        <div class="ecom-rich-head"><span class="ecom-pill is-done">${esc(L("成片落定", "Cut ready"))}</span>
          <strong>${esc(L("28s 短视频已导出", "28s short exported"))}</strong></div>
        <div class="ecom-call-terms">
          <span><em>${esc(L("镜头", "Clips"))}</em><b>4</b></span>
          <span><em>${esc(L("时长", "Length"))}</em><b>00:28</b></span>
          <span><em>${esc(L("字幕", "Captions"))}</em><b>${esc(L("安全话术", "Safe copy"))}</b></span>
          <span><em>CTA</em><b>${esc(L("已加", "On"))}</b></span>
        </div>
        ${this._digestBeatHtml(
          L("感→想→做：成片导出已校验落定", "S→T→A: cut export verified and set")
        )}
        <p class="ecom-stage-dual"><i></i><em>${esc(
          editLive
            ? L("双轨：成片已导出 · 你继续门店", "Dual-track: cut exported · you stay on the floor")
            : L("双轨：忙完门店后可回看成片", "Dual-track: reopen the cut after floor work")
        )}</em><b>${esc(L("通知运营", "Ping ops"))}</b></p>
        ${
          editCtx.watch
            ? `<p class="ecom-stage-watch is-${esc(editCtx.level || "info")}"><span>${esc(
                L("盯盘", "Watch")
              )}</span><em>${esc(editCtx.watch)}</em></p>`
            : ""
        }
        <p class="ecom-next-action">${esc(
          L("下一步：归档交付物 → 同步运营投放 · 盯转化回写", "Next: pin output → sync ops push · watch conversion")
        )}</p>
      </div>`,
    });
  }

  publishCompareTable(suppliers = []) {
    const en = getLocale() === "en";
    const quoteImg = this.media("quote_sheet") || "assets/ecom/docs/quote_sheet.webp";
    this.switchBench("sheet");
    this.setTitle(L("供应商比价", "Supplier comparison"));
    const ranked = suppliers
      .slice()
      .sort((a, b) => Number(a.quote_per_kg || 99) - Number(b.quote_per_kg || 99) || Number(b.rating || 0) - Number(a.rating || 0));
    const pick = ranked[0] || suppliers[0];
    const pickName = pick ? (en ? pick.name_en || pick.name_zh : pick.name_zh || pick.name_en) : "—";
    const rows = suppliers
      .map((s) => {
        const name = en ? s.name_en : s.name_zh;
        const stars = "★★★★★".slice(0, s.rating || 4) + "☆☆☆☆☆".slice(0, 5 - (s.rating || 4));
        const preferred = pick && s.id === pick.id ? "is-pick" : "";
        return `<tr class="${preferred}"><td>${esc(name)}${
          preferred ? ` <em class="ecom-pick-tag">${esc(L("推荐", "Pick"))}</em>` : ""
        }</td><td>¥${esc(s.quote_per_kg)}</td><td>${esc(s.moq_kg)}kg</td><td>${esc(
          s.lead_days
        )}${esc(L("天", "d"))}</td><td class="stars">${stars}</td></tr>`;
      })
      .join("");
    this.setStatus(L(`比价完成 · 倾向 ${pickName}`, `Compare done · lean ${pickName}`));
    if (this.playgroundEl) {
      this.playgroundEl.innerHTML = `<div class="ecom-play-panel">
        <div class="ecom-doc-preview ecom-doc-preview-sm"><img src="${esc(quoteImg)}" alt="" /></div>
        <div class="ecom-rich ecom-rich-table" style="margin-top:12px">
          <table><thead><tr>
            <th>${esc(L("供应商", "Supplier"))}</th><th>${esc(L("单价", "Price"))}</th>
            <th>MOQ</th><th>${esc(L("交期", "Lead"))}</th><th>${esc(L("综合", "Score"))}</th>
          </tr></thead><tbody>${rows}</tbody></table>
        </div>
        <p class="ecom-stage-dual"><i></i><em>${esc(
          L("双轨：比价由我完成 · 你可继续门店", "Dual-track: I finish compare · you stay on the floor")
        )}</em><b>${esc(L("下一拍 · 通话", "Next · call"))}</b></p>
        <p class="ecom-next-action">${esc(
          L(`综合单价与交期，建议优先对接 ${pickName}。`, `Balancing price + lead time, prefer ${pickName}.`)
        )}</p>
      </div>`;
    }
    const cmpCtx = this.getStandbyContext?.() || {};
    const cmpLive = Boolean(cmpCtx.live);
    const html = `<div class="ecom-rich ecom-rich-table is-digest ${cmpLive ? "is-dual" : ""}">
      <div class="ecom-rich-head"><span class="ecom-pill is-done">${esc(L("比价决策", "Quote pick"))}</span>
        <strong>${esc(L(`倾向 ${pickName}`, `Lean ${pickName}`))}</strong></div>
      <div class="ecom-call-terms">
        <span><em>${esc(L("单价", "Price"))}</em><b>¥${esc(String(pick?.quote_per_kg ?? "—"))}</b></span>
        <span><em>MOQ</em><b>${esc(String(pick?.moq_kg ?? "—"))}kg</b></span>
        <span><em>${esc(L("交期", "Lead"))}</em><b>${esc(String(pick?.lead_days ?? "—"))}${esc(L("天", "d"))}</b></span>
        <span><em>${esc(L("评分", "Score"))}</em><b>${esc(String(pick?.rating ?? "—"))}</b></span>
      </div>
      ${this._digestBeatHtml(
        L("感→想→做：比价倾向已校验落定", "S→T→A: compare pick verified and set")
      )}
      <p class="ecom-stage-dual"><i></i><em>${esc(
        cmpLive
          ? L("双轨：决策已落定 · 门店事务可继续", "Dual-track: decision set · floor work can continue")
          : L("双轨：忙完门店后可回看比价", "Dual-track: reopen compare after floor work")
      )}</em><b>${esc(L("锁价通话", "Lock call"))}</b></p>
      ${
        cmpCtx.watch
          ? `<p class="ecom-stage-watch is-${esc(cmpCtx.level || "info")}"><span>${esc(
              L("盯盘", "Watch")
            )}</span><em>${esc(cmpCtx.watch)}</em></p>`
          : ""
      }
      <p class="ecom-next-action">${esc(
        L("下一步：锁价通话 → 写回定价表", "Next: lock-price call → write the price sheet")
      )}</p>
    </div>`;
    this.onRichCard({ thread: "boss", kind: "table", title: "compare", bodyHtml: html });
  }

  publishPricingCard(kpi) {
    const cost = Number(kpi.unitCost) || 12.8;
    const price = Number(kpi.unitPrice) || 39.9;
    const stock = Number(kpi.stock) || 0;
    const margin = price > 0 ? (((price - cost) / price) * 100).toFixed(1) : "0";
    const marginNum = Number(margin);
    const tone = marginNum >= 55 ? "ok" : marginNum >= 40 ? "warn" : "danger";
    this.switchBench("sheet");
    this.updateSheetFromKpi(kpi, this.seed?.sku?.id);
    this.setStatus(L(`定价写回 · 毛利 ${margin}%`, `Pricing written · margin ${margin}%`));
    const priceCtx = this.getStandbyContext?.() || {};
    const priceLive = Boolean(priceCtx.live);
    const html = `<div class="ecom-rich ecom-rich-price is-digest is-${tone} ${priceLive ? "is-dual" : ""}">
      <div class="ecom-rich-head"><span class="ecom-pill is-done">${esc(L("定价决策", "Pricing set"))}</span>
        <strong>${esc(L("建议零售价", "Suggested sale price"))} ¥${esc(price)}</strong></div>
      <div class="ecom-call-terms">
        <span><em>${esc(L("成本", "Cost"))}</em><b>¥${esc(cost)}</b></span>
        <span><em>${esc(L("售价", "Price"))}</em><b>¥${esc(price)}</b></span>
        <span><em>${esc(L("毛利率", "Margin"))}</em><b>${esc(margin)}%</b></span>
        <span><em>${esc(L("库存", "Stock"))}</em><b>${esc(stock > 0 ? String(stock) : "—")}</b></span>
      </div>
      ${this._digestBeatHtml(
        L("感→想→做：定价写回已校验落定", "S→T→A: pricing writeback verified and set")
      )}
      <p class="ecom-stage-dual"><i></i><em>${esc(
        priceLive
          ? L("双轨：账表已写回 · 你可继续门店", "Dual-track: sheet written · you can stay on the floor")
          : L("双轨：忙完门店后可回看定价", "Dual-track: reopen pricing after floor work")
      )}</em><b>${esc(L("盯库存", "Watch stock"))}</b></p>
      ${
        priceCtx.watch
          ? `<p class="ecom-stage-watch is-${esc(
              tone === "danger" || tone === "warn" ? "warn" : priceCtx.level || "info"
            )}"><span>${esc(L("盯盘", "Watch"))}</span><em>${esc(priceCtx.watch)}</em></p>`
          : ""
      }
      <p class="ecom-next-action">${esc(
        marginNum < 40
          ? L("下一步：核对称重与促销 → 再决定是否提价", "Next: verify gram weight / promo → then decide whether to raise price")
          : L("下一步：推进上架与投放 · 盯库存回写", "Next: proceed to listing / ads · watch stock writebacks")
      )}</p>
    </div>`;
    this.onRichCard({ thread: "boss", kind: "pricing", title: "pricing", bodyHtml: html });
  }
}
