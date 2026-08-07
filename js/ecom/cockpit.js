/**
 * SaaS-style ecommerce full-chain cockpit.
 */

import { L, getLocale, applyDomI18n } from "../i18n.js?v=20260807-simple-chat";
import { EcomIm } from "./im.js?v=20260807-simple-chat";
import { EcomBenches } from "./benches.js?v=20260807-simple-chat";
import { EcomScriptPlayer, ecomProgressLabel } from "./script.js?v=20260807-simple-chat";
import { createEcomTools } from "./tools.js?v=20260807-simple-chat";

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
    this.notifyLog = [];
    this._lastKpiValues = [];
    this.im = new EcomIm({
      messagesEl: document.querySelector("#ecomMessages"),
      tabsEl: document.querySelector("#ecomChatTabs"),
      onFocusDeliverable: (id) => this.focusDeliverable(id),
      onExternalFocus: (id) => this.benches?.focusCommunication(id),
      onExternalMessage: (row, opts) => this.benches?.pushCommunication(row, opts),
      onReplay: () => this.onReplay?.(),
    });
    this.benches = new EcomBenches({
      stageEl: document.querySelector("#ecomBenchStage"),
      tabsEl: document.querySelector("#ecomBenchTabs"),
      playgroundEl: document.querySelector("#ecomPlayground"),
      titleEl: document.querySelector("#ecomPlayTitle"),
      onRichCard: (card) => this.im.pushRichCard(card),
      onUpdateCard: (id, patch) => this.im.updateMessage(id, patch),
      onStatus: (text) => {
        if (this.player?.running && text) this.setParallelTrack(true, text);
      },
      getStandbyContext: () => this._standbyContext(),
    });
    this.player = new EcomScriptPlayer(this);
    this.tools = null;

    document.querySelector("#ecomBtnReplay")?.addEventListener("click", () => this.onReplay?.());
    document.querySelector("#ecomBtnConfigure")?.addEventListener("click", () => this.onConfigure?.());
    document.querySelector("#ecomNotifyBtn")?.addEventListener("click", () => this.toggleNotifyPanel());
    document.addEventListener("click", (e) => {
      const panel = document.querySelector("#ecomNotifyPanel");
      const btn = document.querySelector("#ecomNotifyBtn");
      if (!panel || panel.hidden) return;
      if (panel.contains(e.target) || btn?.contains(e.target)) return;
      panel.hidden = true;
    });
    this.renderNotifyBadge();
    document.querySelector("#ecomComposer")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.querySelector("#ecomChatInput");
      const text = input?.value?.trim();
      if (!text) return;
      if (this.player?.running) {
        this.im.pushMessage({
          thread: "boss",
          from: "agent",
          kind: "text",
          text_zh: "Replay 进行中，我先把当前链路跑完。",
          text_en: "Replay is running — finishing the current chain first.",
        });
        input.value = "";
        return;
      }
      this.im.pushMessage({ thread: "boss", from: "boss", kind: "text", text_zh: text, text_en: text });
      input.value = "";
      this.im.pushMessage({
        thread: "boss",
        from: "agent",
        kind: "text",
        text_zh: "收到。点顶部 Replay，我会按完整经营链路执行并回写结果。",
        text_en: "Got it. Tap Replay and I’ll run the full ops chain with writebacks.",
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
    this.notifyLog = [];
    this._lastPlanStage = null;
    this._freshDeliverableId = null;
    window.clearTimeout(this._monitorAgeTimer);
    this.im.reset(this.seed.threads || []);
    const panel = document.querySelector("#ecomNotifyPanel");
    if (panel) panel.hidden = true;
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
    const prevId = this.stageId;
    this.stageId = id;
    this.renderStages();
    const st = this.meta?.stages?.find((s) => s.id === this.stageId);
    const label = st ? (getLocale() === "en" ? st.en : st.zh) : id;
    this.setAgentStatus(label);
    this.pushMonitor(label, "ok");
    if (prevId && prevId !== id) this.pushStageAdvance(prevId, id);
    if (this.benches?.active === "idle") this.benches.renderPlayground?.();
  }

  pushStageAdvance(fromId, toId) {
    const stages = this.meta?.stages || [];
    const en = getLocale() === "en";
    const from = stages.find((s) => s.id === fromId);
    const to = stages.find((s) => s.id === toId);
    if (!to) return;
    // Only announce when crossing a 7-act boundary — avoids 26-stage spam.
    const acts = [
      ["brief", "research"],
      ["sourcing", "sample_qc", "call"],
      ["pack_v1", "pack_reject", "pack_v2"],
      ["factory", "pricing", "soft_launch", "sell_w1"],
      ["disrupt_quality", "disrupt_takedown", "disrupt_delay", "recover"],
      ["promo_war", "livestream", "sell_w2", "heartbeat"],
      ["scam_mail", "scam_check", "scam_dispose", "disrupt_ledger", "profit", "sop_close"],
    ];
    const actOf = (id) => acts.findIndex((ids) => ids.includes(id));
    const fromAct = actOf(fromId);
    const toAct = actOf(toId);
    if (toAct < 0 || fromAct === toAct) return;
    const actNames = en
      ? ["Brief", "Source", "Pack", "Launch", "Shock", "Growth", "Close"]
      : ["立项", "寻源", "包装", "上架", "扰动", "增长", "收尾"];
    const toLabel = en ? to.en : to.zh;
    const subs = (en ? to.subs_en : to.subs_zh) || [];
    const next = subs[0] || toLabel;
    const idx = Math.max(0, stages.findIndex((s) => s.id === toId)) + 1;
    const watch = this._planWatchTip({ next });
    const ctx = this._standbyContext();
    const benchLabel = {
      phone: L("锁价通话", "Lock-price call"),
      pack: L("包装工作台", "Pack studio"),
      edit: L("剪辑台", "Edit bay"),
      sheet: L("库存定价表", "Stock & price sheet"),
      comms: L("协作消息", "Team inbox"),
    }[ctx.nextBench] || L("工作台", "Bench");
    const nextAction = L(
      `下一步：放大「${benchLabel}」→ ${next}`,
      `Next: magnify “${benchLabel}” → ${next}`
    );
    const beatHtml = this._beatRailHtml("planning", { className: "ecom-card-beat" });
    const html = `<div class="ecom-rich ecom-rich-stage">
      <div class="ecom-rich-head"><span class="ecom-pill is-live">${esc(L("幕切换", "Act up"))}</span>
        <strong>${esc(actNames[fromAct] || fromId)} → ${esc(actNames[toAct] || toId)}</strong>
        <em>${idx}/${stages.length}</em></div>
      <p class="muted">${esc(
        L(`进入「${toLabel}」· 本幕由 Agent 无人值守推进`, `Enter “${toLabel}” · Agent advances this act hands-free`)
      )}</p>
      <p class="ecom-card-beat-row" aria-hidden="true">${beatHtml}<em>${esc(
        L("感→想→做：先想清本幕重点，再放大工作台", "S→T→A: think the act focus, then magnify the bench")
      )}</em></p>
      <p class="ecom-stage-dual"><i></i><em>${esc(
        L("双轨：你忙门店 · 我跑完本幕链路", "Dual-track: you run the floor · I finish this act")
      )}</em><b>${esc(benchLabel)}</b></p>
      <p class="ecom-stage-watch is-${esc(watch.level || "info")}"><span>${esc(
        L("盯盘", "Watch")
      )}</span><em>${esc(watch.text)}</em></p>
      <p class="ecom-next-action">${esc(nextAction)}</p>
      ${
        subs.length
          ? `<ol class="ecom-stage-next">${subs
              .slice(0, 3)
              .map((s, i) => `<li class="${i === 0 ? "is-now" : ""}">${esc(s)}</li>`)
              .join("")}</ol>`
          : ""
      }
    </div>`;
    this.im.pushRichCard({
      thread: "boss",
      kind: "stage",
      title: toLabel,
      bodyHtml: html,
    });
    this.setParallelTrack?.(
      true,
      L(`进入 · ${actNames[toAct] || toLabel}`, `Enter · ${actNames[toAct] || toLabel}`)
    );
    this.setAgentActivity?.("planning", L(`进入 · ${toLabel}`, `Enter · ${toLabel}`));
  }

  pushReplayWrapUp() {
    const k = this.kpi || {};
    const n = (this.deliverables || []).length;
    const profit = Number(k.profit) || 0;
    const margin = Number(k.marginPct) || 0;
    const orders = Number(k.orders) || Number(k.sold) || 0;
    const en = getLocale() === "en";
    const acts = en
      ? ["Brief", "Source", "Pack", "Launch", "Shock", "Growth", "Close"]
      : ["立项", "寻源", "包装", "上架", "扰动", "增长", "收尾"];
    const trail = acts
      .map((name) => `<span class="is-done"><i></i>${esc(name)}</span>`)
      .join("");
    const topKinds = {};
    for (const d of this.deliverables || []) {
      const kind = d.kind || "file";
      topKinds[kind] = (topKinds[kind] || 0) + 1;
    }
    const kindBits = Object.entries(topKinds)
      .slice(0, 4)
      .map(([kind, count]) => `${kindLabel(kind)}×${count}`)
      .join(" · ");
    const html = `<div class="ecom-rich ecom-rich-wrapup">
      <div class="ecom-rich-head"><span class="ecom-pill is-live">${esc(L("本轮收尾", "Wrap-up"))}</span>
        <strong>${esc(L("任务链已跑完", "Task chain complete"))}</strong></div>
      <div class="ecom-wrapup-trail" aria-label="acts">${trail}</div>
      <ul class="ecom-wrapup-stats">
        <li><span>${esc(L("利润", "Profit"))}</span><b>¥${esc(fmt(profit))}</b></li>
        <li><span>${esc(L("毛利率", "Margin"))}</span><b>${esc(fmt(margin))}%</b></li>
        <li><span>${esc(L("订单", "Orders"))}</span><b>${esc(fmt(orders))}</b></li>
        <li><span>${esc(L("交付物", "Outputs"))}</span><b>${esc(String(n))}</b></li>
      </ul>
      <p class="ecom-wrapup-dual"><span>${esc(L("双轨收口", "Dual-track close"))}</span><em>${esc(
        L("你完成门店现场；我完成寻源→收尾无人值守链路", "You covered the floor; I finished sourcing → close hands-free")
      )}</em></p>
      <p class="ecom-wrapup-beat" aria-hidden="true">
        <b class="is-done">${esc(L("感", "S"))}</b><i></i>
        <b class="is-done">${esc(L("想", "T"))}</b><i></i>
        <b class="is-done">${esc(L("做", "A"))}</b>
        <em>${esc(L("七幕链路已按感→想→做收口", "Seven acts closed via sense → think → act"))}</em>
      </p>
      ${
        kindBits
          ? `<p class="ecom-wrapup-kinds muted">${esc(L("产出构成", "Output mix"))} · ${esc(kindBits)}</p>`
          : ""
      }
      <p class="ecom-stage-dual"><i></i><em>${esc(
        L("双轨收口完成 · 门店与后台链路都已对齐", "Dual-track close done · floor and backend chain aligned")
      )}</em><b>${esc(L("Dock", "Dock"))}</b></p>
      <p class="ecom-next-action">${esc(
        L("下一步：打开右侧 Dock 回看产出 · 或再看一遍 Replay", "Next: open the Dock to review outputs · or Replay again")
      )}</p>
      <p class="muted">${esc(
        L("交付物都在右侧 Dock，可随时点开回看。", "Outputs are pinned in the right dock — open any time.")
      )}</p>
      <div class="ecom-wrapup-actions">
        <button type="button" class="ecom-btn-primary" data-ecom-wrapup-replay>${esc(
          L("再看一遍 Replay", "Replay again")
        )}</button>
      </div>
    </div>`;
    this.im.pushMessage({
      thread: "boss",
      from: "agent",
      kind: "text",
      text_zh: "门店那边辛苦了——七幕链路已收尾，关键指标和交付物都在上面。",
      text_en: "While you ran the shop, all seven acts wrapped — KPIs and outputs are above.",
    });
    this.im.pushRichCard({
      thread: "boss",
      kind: "wrapup",
      title: L("本轮收尾", "Wrap-up"),
      bodyHtml: html,
    });
    this.setAgentActivity("verified", L("链路完成", "Chain complete"), { settle: false });
    this.setParallelTrack(false);
    this.benches.active = "idle";
    this.benches.renderPlayground?.();
    this.im?._pulseChatMode?.("boss");
    this._setComposerHint({ done: true });
    // Mark plan strip fully done for the close beat.
    const strip = document.querySelector("#ecomPlanStrip");
    strip?.classList.add("is-complete");
    strip?.querySelectorAll(".ecom-plan-act").forEach((node) => {
      node.classList.remove("is-active");
      node.classList.add("is-done");
    });
    const wall = document.querySelector("#ecomWall");
    if (wall) {
      wall.classList.add("is-celebrate", "is-dock-tip");
      const label = wall.querySelector(".ecom-wall-label strong");
      if (label) {
        label.dataset.prev = label.textContent || "";
        label.textContent = L("交付物就绪", "Outputs ready");
      }
      wall.querySelectorAll(".ecom-wall-chip").forEach((chip, i) => {
        window.setTimeout(() => chip.classList.add("is-wave"), 80 * i);
      });
      window.clearTimeout(this._dockTipTimer);
      this._dockTipTimer = window.setTimeout(() => {
        wall.classList.remove("is-celebrate", "is-dock-tip");
        wall.querySelectorAll(".ecom-wall-chip.is-wave").forEach((chip) => chip.classList.remove("is-wave"));
        if (label?.dataset.prev != null) {
          label.textContent = label.dataset.prev;
          delete label.dataset.prev;
        }
        strip?.classList.remove("is-complete");
      }, 2600);
    }
  }

  setReplayLocked(locked) {
    const form = document.querySelector("#ecomComposer");
    const input = document.querySelector("#ecomChatInput");
    const btn = form?.querySelector('button[type="submit"]');
    if (!form) return;
    form.classList.toggle("is-replay-locked", Boolean(locked));
    const stageChip = document.querySelector("#ecomAgentEta")?.textContent?.trim();
    if (input) {
      input.disabled = Boolean(locked);
      input.placeholder = locked
        ? stageChip
          ? L(`无人值守 · ${stageChip}`, `Hands-free · ${stageChip}`)
          : L("你忙门店时 · Agent 正在后台执行…", "You're on the floor · Agent works in background…")
        : L("给 Agent 下指令…", "Instruct the agent…");
    }
    if (btn) btn.disabled = Boolean(locked);
    this.setParallelTrack(Boolean(locked));
    this._setComposerHint(
      locked
        ? {
            on: true,
            agent: L("Agent 在后台推进任务链", "Agent advances the task chain"),
          }
        : { on: false }
    );
    this.renderStages?.();
  }

  /** Compact dual-track strip above the locked composer during Replay. */
  _setComposerHint({ on = false, agent = "", done = false } = {}) {
    const form = document.querySelector("#ecomComposer");
    if (!form) return;
    let hint = document.querySelector("#ecomComposerHint");
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "ecomComposerHint";
      hint.className = "ecom-composer-hint";
      hint.hidden = true;
      form.insertAdjacentElement("beforebegin", hint);
    }
    if (!on && !done) {
      hint.hidden = true;
      hint.classList.remove("is-on", "is-done");
      return;
    }
    hint.hidden = false;
    hint.classList.toggle("is-on", Boolean(on) && !done);
    hint.classList.toggle("is-done", Boolean(done));
    const agentText =
      agent ||
      document.querySelector("#ecomParallelAgent")?.textContent ||
      L("Agent 在后台推进任务链", "Agent advances the task chain");
    if (done) {
      hint.innerHTML = `<span class="ecom-composer-hint-done"><i></i><em>${esc(
        L("链路已收尾 · 交付物在右侧 Dock", "Chain wrapped · outputs in the dock")
      )}</em></span>
        <button type="button" class="ecom-composer-hint-btn" data-ecom-wrapup-replay>${esc(
          L("再看一遍", "Replay")
        )}</button>`;
      hint.querySelector("[data-ecom-wrapup-replay]")?.addEventListener("click", () => this.onReplay?.());
      window.clearTimeout(this._composerHintTimer);
      this._composerHintTimer = window.setTimeout(() => {
        if (hint.classList.contains("is-done") && !this.player?.running) {
          hint.hidden = true;
          hint.classList.remove("is-done");
        }
      }, 8000);
      return;
    }
    const humanText =
      document.querySelector("#ecomParallelStrip .ecom-parallel-human em")?.textContent?.trim() ||
      L("你在门店 / 冲咖啡", "You're on the floor / brewing");
    const mode = this._activityMode || this._modeFromStepType(this._replayProgress?.type) || "idle";
    const stageChip = document.querySelector("#ecomAgentEta")?.textContent?.trim() || "";
    const ctx = this._standbyContext?.() || {};
    const nextBenchLabel = {
      phone: L("下一拍 · 通话", "Next · call"),
      pack: L("下一拍 · 包装", "Next · pack"),
      edit: L("下一拍 · 剪辑", "Next · edit"),
      sheet: L("下一拍 · 账表", "Next · sheet"),
      comms: L("下一拍 · 协作", "Next · comms"),
    }[ctx.nextBench];
    hint.innerHTML = `<span class="ecom-composer-hint-human"><i></i><em>${esc(humanText)}</em></span>
      <span class="ecom-composer-hint-sep" aria-hidden="true"></span>
      <span class="ecom-composer-hint-agent"><i></i><em>${esc(agentText)}</em></span>
      <span class="ecom-composer-hint-meta">
        ${this._beatRailHtml(mode, { className: "ecom-composer-hint-beat" })}
        <b class="ecom-composer-hint-mode is-${esc(mode)}">${esc(this._activityModeLabel(mode))}</b>
        ${stageChip ? `<em>${esc(stageChip)}</em>` : ""}
        ${nextBenchLabel ? `<i class="ecom-composer-hint-next">${esc(nextBenchLabel)}</i>` : ""}
      </span>`;
  }

  _syncComposerHint(agentLabel = "") {
    const hint = document.querySelector("#ecomComposerHint");
    if (!hint || hint.hidden || hint.classList.contains("is-done")) return;
    const agent = hint.querySelector(".ecom-composer-hint-agent em");
    const human = hint.querySelector(".ecom-composer-hint-human em");
    const humanSrc = document
      .querySelector("#ecomParallelStrip .ecom-parallel-human em")
      ?.textContent?.trim();
    if (human && humanSrc) {
      const humanChanged = human.textContent !== humanSrc;
      human.textContent = humanSrc;
      if (humanChanged) {
        hint.classList.remove("is-human-tick");
        void hint.offsetWidth;
        hint.classList.add("is-human-tick");
        window.clearTimeout(this._composerHumanTickTimer);
        this._composerHumanTickTimer = window.setTimeout(
          () => hint.classList.remove("is-human-tick"),
          560
        );
      }
    }
    if (agent && agentLabel) {
      agent.textContent = agentLabel;
      hint.classList.remove("is-tick");
      void hint.offsetWidth;
      hint.classList.add("is-tick");
      window.clearTimeout(this._composerTickTimer);
      this._composerTickTimer = window.setTimeout(() => hint.classList.remove("is-tick"), 520);
    }
    const mode =
      this._activityMode || this._modeFromStepType(this._replayProgress?.type) || "idle";
    const modeEl = hint.querySelector(".ecom-composer-hint-mode");
    if (modeEl) {
      modeEl.className = `ecom-composer-hint-mode is-${mode}`;
      modeEl.textContent = this._activityModeLabel(mode);
    }
    const beatEl = hint.querySelector(".ecom-composer-hint-beat");
    if (beatEl) {
      const nextBeat = this._beatRailHtml(mode, { className: "ecom-composer-hint-beat" });
      if (beatEl.outerHTML !== nextBeat) beatEl.outerHTML = nextBeat;
    }
    const stageChip = document.querySelector("#ecomAgentEta")?.textContent?.trim();
    let stageMeta = hint.querySelector(".ecom-composer-hint-meta > em");
    const metaHost = hint.querySelector(".ecom-composer-hint-meta");
    if (stageChip && metaHost) {
      if (!stageMeta) {
        stageMeta = document.createElement("em");
        const modeNode = hint.querySelector(".ecom-composer-hint-mode");
        if (modeNode?.nextSibling) metaHost.insertBefore(stageMeta, modeNode.nextSibling);
        else metaHost.appendChild(stageMeta);
      }
      stageMeta.textContent = stageChip;
    }
    const ctx = this._standbyContext?.() || {};
    const nextBenchLabel = {
      phone: L("下一拍 · 通话", "Next · call"),
      pack: L("下一拍 · 包装", "Next · pack"),
      edit: L("下一拍 · 剪辑", "Next · edit"),
      sheet: L("下一拍 · 账表", "Next · sheet"),
      comms: L("下一拍 · 协作", "Next · comms"),
    }[ctx.nextBench];
    let nextEl = hint.querySelector(".ecom-composer-hint-next");
    if (nextBenchLabel && metaHost) {
      if (!nextEl) {
        nextEl = document.createElement("i");
        nextEl.className = "ecom-composer-hint-next";
        metaHost.appendChild(nextEl);
      }
      nextEl.textContent = nextBenchLabel;
    } else {
      nextEl?.remove();
    }
    const input = document.querySelector("#ecomChatInput");
    if (input?.disabled && stageChip) {
      input.placeholder = L(`无人值守 · ${stageChip}`, `Hands-free · ${stageChip}`);
    }
  }

  /** Dual-track cue: human busy elsewhere while Agent finishes the chain. */
  setParallelTrack(on, agentLabel = "") {
    const strip = document.querySelector("#ecomParallelStrip");
    if (!strip) return;
    const wasOn = strip.classList.contains("is-on");
    strip.hidden = !on;
    strip.classList.toggle("is-on", Boolean(on));
    const human = strip.querySelector(".ecom-parallel-human em");
    const agent = document.querySelector("#ecomParallelAgent") || strip.querySelector(".ecom-parallel-agent em");
    // Preserve rotating floor beats from setReplayProgress while dual-track stays on.
    if (human && !(on && wasOn && human.textContent?.trim())) {
      human.textContent = L("你在打理门店 / 冲咖啡", "You're running the shop / brewing");
    }
    if (agent) {
      agent.textContent =
        agentLabel ||
        (on
          ? L("Agent 在后台推进任务链", "Agent advances the task chain")
          : L("Agent 待命", "Agent idle"));
    }
    if (!on) {
      const meta = document.querySelector("#ecomParallelMeta");
      if (meta) {
        meta.hidden = true;
        meta.innerHTML = "";
      }
      return;
    }
    this._syncParallelMeta(this._activityMode || "idle");
  }

  /** Mini sense → think → act rail on the dual-track strip (Replay only). */
  _activityBeat(mode = "idle") {
    if (mode === "observing") return "sense";
    if (mode === "planning") return "think";
    if (mode === "acting" || mode === "communicating") return "act";
    if (mode === "verified") return "check";
    return "hold";
  }

  _beatRailHtml(mode = "idle", { className = "ecom-beat-rail" } = {}) {
    const beat = this._activityBeat(mode);
    const steps = [
      { id: "sense", zh: "感", en: "S" },
      { id: "think", zh: "想", en: "T" },
      { id: "act", zh: "做", en: "A" },
    ];
    const order = { sense: 0, think: 1, act: 2, check: 3, hold: -1 };
    const cur = order[beat] ?? -1;
    const en = getLocale() === "en";
    return `<span class="${esc(className)}" data-beat="${esc(beat)}" aria-hidden="true">${steps
      .map((s, i) => {
        const state =
          beat === "check" || i < cur ? "is-done" : i === cur ? "is-on" : "";
        return `<b class="${state}" data-beat="${s.id}">${esc(en ? s.en : s.zh)}</b>`;
      })
      .join("<i></i>")}</span>`;
  }

  _modeFromStepType(type = "") {
    return (
      {
        world: "observing",
        mutation: "observing",
        notification: "observing",
        stage: "planning",
        switch_bench: "planning",
        im_message: "communicating",
        focus_thread: "communicating",
        tool_call: "acting",
        bench_anim: "acting",
        deliverable: "acting",
        kpi_update: "verified",
      }[type] || ""
    );
  }

  _syncParallelMeta(mode = "idle") {
    const strip = document.querySelector("#ecomParallelStrip");
    const meta = document.querySelector("#ecomParallelMeta");
    if (!meta || !strip || strip.hidden || !strip.classList.contains("is-on")) return;
    const beat = this._activityBeat(mode);
    const prog = this._replayProgress || {};
    const total = Number(prog.total) || 0;
    const index = Number(prog.index) || 0;
    const pct = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
    const progHtml =
      total > 0
        ? `<span class="ecom-parallel-prog" title="${esc(
            L("轨迹进度", "Trajectory progress")
          )}"><i style="--p:${pct}%"></i><b>${index + 1}/${total}</b></span>`
        : "";
    meta.hidden = false;
    meta.dataset.beat = beat;
    meta.innerHTML = `${this._beatRailHtml(mode)}<span class="ecom-parallel-mode is-${esc(
      mode || "idle"
    )}">${esc(this._activityModeLabel(mode))}</span>${progHtml}`;
    meta.classList.remove("is-tick");
    void meta.offsetWidth;
    meta.classList.add("is-tick");
    window.clearTimeout(this._parallelMetaTick);
    this._parallelMetaTick = window.setTimeout(() => meta.classList.remove("is-tick"), 480);
  }

  bumpNotify(entry = null) {
    this.notifyCount = (this.notifyCount || 0) + 1;
    if (entry) {
      this.notifyLog = this.notifyLog || [];
      this.notifyLog.unshift({
        ...entry,
        phase: entry.phase || "sense",
        ts: entry.ts || Date.now(),
      });
      this.notifyLog = this.notifyLog.slice(0, 12);
    }
    this.renderNotifyBadge();
    this.renderNotifyPanel();
    const btn = document.querySelector("#ecomNotifyBtn");
    if (btn) {
      const level = entry?.level || "info";
      btn.classList.remove("is-ping", "is-warn", "is-danger");
      void btn.offsetWidth;
      btn.classList.add("is-ping", level === "danger" ? "is-danger" : level === "warn" ? "is-warn" : "is-ping");
      window.clearTimeout(this._notifyPingTimer);
      this._notifyPingTimer = window.setTimeout(() => btn.classList.remove("is-ping", "is-warn", "is-danger"), 900);
    }
  }

  renderNotifyBadge() {
    const badge = document.querySelector("#ecomNotifyBadge");
    if (!badge) return;
    const n = this.notifyCount || 0;
    badge.hidden = n <= 0;
    badge.textContent = String(n);
  }

  toggleNotifyPanel() {
    const panel = this.ensureNotifyPanel();
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      this.notifyCount = 0;
      this.renderNotifyBadge();
      this.renderNotifyPanel();
    }
  }

  ensureNotifyPanel() {
    let panel = document.querySelector("#ecomNotifyPanel");
    if (panel) return panel;
    const host = document.querySelector(".ecom-top-right") || this.root;
    if (!host) return null;
    panel = document.createElement("div");
    panel.id = "ecomNotifyPanel";
    panel.className = "ecom-notify-panel";
    panel.hidden = true;
    host.appendChild(panel);
    return panel;
  }

  _notifyPhaseLabel(phase = "sense") {
    return (
      {
        sense: L("感知", "Sense"),
        logged: L("已记下", "Logged"),
        verified: L("已校验", "Verified"),
      }[phase] || L("感知", "Sense")
    );
  }

  /** Promote an existing notify row after Agent decides (sense → logged/verified). */
  _markNotifyPhase(text = "", phase = "logged") {
    if (!text || !this.notifyLog?.length) return;
    const key = String(text).slice(0, 80);
    const row = this.notifyLog.find((r) => String(r.text || "").slice(0, 80) === key);
    if (!row) return;
    row.phase = phase;
    row.ts = row.ts || Date.now();
    const panel = document.querySelector("#ecomNotifyPanel");
    if (panel && !panel.hidden) this.renderNotifyPanel();
  }

  renderNotifyPanel() {
    const panel = document.querySelector("#ecomNotifyPanel");
    if (!panel) return;
    const rows = this.notifyLog || [];
    const live = Boolean(this.player?.running);
    const stageChip = document.querySelector("#ecomAgentEta")?.textContent?.trim() || "";
    const mode =
      this._activityMode || this._modeFromStepType(this._replayProgress?.type) || "idle";
    const topPhase = rows[0]?.phase || "sense";
    const beatMode =
      topPhase === "verified"
        ? "verified"
        : topPhase === "logged"
          ? "planning"
          : mode === "observing" || !rows.length
            ? "observing"
            : mode;
    const beatHtml = live
      ? this._beatRailHtml(beatMode, { className: "ecom-notify-beat" })
      : "";
    const hint = live
      ? L(
          `双轨中 · 你忙门店，我先感知再开口${stageChip ? ` · ${stageChip}` : ""}`,
          `Dual-track · you on floor, I sense before speaking${stageChip ? ` · ${stageChip}` : ""}`
        )
      : L("Agent 先感知，再决定是否开口", "Agent senses first, then decides whether to speak");
    panel.classList.toggle("is-dual", live);
    panel.innerHTML = rows.length
      ? `<header><strong>${esc(L("事件回执", "Event log"))}</strong><small>${rows.length}</small>${
          live ? `<i class="ecom-notify-dual">${esc(L("双轨", "Dual"))}</i>` : ""
        }</header>
        <p class="ecom-notify-hint ${live ? "is-live" : ""}">${
          beatHtml
        }<span>${esc(hint)}</span></p>
        <ul>${rows
          .map((r) => {
            const phase = r.phase || "sense";
            return `<li class="is-${esc(r.level || "info")} is-phase-${esc(phase)} ${
              live ? "is-dual" : ""
            }">
              <div><b>${esc(r.kind || L("事件", "Event"))}</b>
                <span class="ecom-notify-meta"><em class="ecom-notify-phase">${esc(
                  this._notifyPhaseLabel(phase)
                )}</em><time>${esc(this._monitorAge(r.ts))}</time></span>
              </div>
              <span>${esc(r.text)}</span>
            </li>`;
          })
          .join("")}</ul>
        ${
          live
            ? `<footer class="ecom-notify-foot">${esc(
                L("门店优先 · 高优先级才会请示 · 感→想→做", "Floor first · escalate only on high priority · S→T→A")
              )}</footer>`
            : ""
        }`
      : `<header><strong>${esc(L("事件回执", "Event log"))}</strong>${
          live ? `<i class="ecom-notify-dual">${esc(L("双轨", "Dual"))}</i>` : ""
        }</header>
        ${
          live
            ? `<p class="ecom-notify-hint is-live">${beatHtml}<span>${esc(
                L("等待世界事件 · 先感知进回执，再决定是否开口", "Waiting on world events · sense into the log, then decide whether to speak")
              )}</span></p>
              <footer class="ecom-notify-foot">${esc(
                L("门店优先 · 不剧透打断你的现场节奏", "Floor first · no spoilery interrupt to your floor rhythm")
              )}</footer>`
            : `<p class="muted">${esc(L("世界事件与通知会汇集在这里", "World events and notices gather here"))}</p>`
        }`;
  }

  pushMonitor(text, level = "info") {
    if (!text) return;
    const key = String(text).slice(0, 48);
    this.monitors = (this.monitors || []).filter((m) => m.key !== key);
    this.monitors.unshift({ key, text: key, level, ts: Date.now(), fresh: true });
    this.monitors = this.monitors.slice(0, 3);
    this.renderMonitors();
    const rail = document.querySelector("#ecomDynRail");
    if (rail) {
      rail.classList.remove("is-sense");
      void rail.offsetWidth;
      rail.classList.add("is-sense");
      window.clearTimeout(this._senseTimer);
      this._senseTimer = window.setTimeout(() => rail.classList.remove("is-sense"), 650);
    }
  }

  _monitorAge(ts = Date.now()) {
    const sec = Math.max(0, Math.round((Date.now() - Number(ts || Date.now())) / 1000));
    if (sec < 2) return L("刚感知", "just now");
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m`;
  }

  renderMonitors() {
    const el = document.querySelector("#ecomMonitors");
    if (!el) return;
    const live = Boolean(this.player?.running);
    const rows = this.monitors || [];
    el.classList.toggle("is-dual", live);
    el.classList.toggle("is-empty", !rows.length);
    if (!rows.length) {
      el.innerHTML = live
        ? `<span class="ecom-monitor-empty">${this._beatRailHtml("observing", {
            className: "ecom-monitor-empty-beat",
          })}<em>${esc(L("感知", "Sense"))}</em><b>${esc(
            L("等待外部信号 · 先记下再开口", "Waiting on signals · log first, then speak")
          )}</b><i>${esc(L("双轨", "Dual"))}</i></span>`
        : "";
      return;
    }
    el.innerHTML = rows
      .map(
        (m, i) =>
          `<span class="ecom-monitor-chip is-${esc(m.level || "info")} ${
            i === 0 && m.fresh ? "is-fresh" : ""
          } ${live ? "is-dual" : ""}" title="${esc(
            live
              ? L("双轨：先感知进监控，再决定是否开口", "Dual-track: sense into monitors, then decide whether to speak")
              : L("Agent 先感知，再决定是否开口", "Agent senses first, then decides whether to speak")
          )}">
            <em class="ecom-monitor-phase">${esc(L("感知", "Sense"))}</em>
            <b>${esc(m.text)}</b><time>${esc(this._monitorAge(m.ts))}</time>
          </span>`
      )
      .join("");
    if (this.monitors?.[0]) this.monitors[0].fresh = false;
    window.clearTimeout(this._monitorAgeTimer);
    if (live && rows.length) {
      this._monitorAgeTimer = window.setTimeout(() => {
        if (this.player?.running) this.renderMonitors();
      }, 2000);
    }
  }

  /** Live step ticker during Replay (type + index). */
  setReplayProgress({ index = 0, total = 0, step = null } = {}) {
    this._replayProgress = { index, total, type: step?.type || "" };
    const agent = document.querySelector("#ecomParallelAgent");
    const human = document.querySelector("#ecomParallelStrip .ecom-parallel-human em");
    if (!this.player?.running) return;
    const typeLabel = {
      stage: L("更新计划", "Planning"),
      focus_thread: L("切换对话", "Switch chat"),
      im_message: L("沟通协调", "Messaging"),
      switch_bench: L("打开工作台", "Open workspace"),
      bench_anim: L("持续执行", "Working"),
      deliverable: L("落盘交付", "Deliverable"),
      kpi_update: L("校验指标", "KPI check"),
      world: L("外部信号", "World signal"),
      mutation: L("扫描回写", "Scan writeback"),
      notification: L("消化通知", "Notice"),
      tool_call: L("调用工具", "Tool call"),
    }[step?.type] || L("推进中", "Advancing");
    const humanBeats = [
      L("你在冲手冲咖啡", "You're brewing pour-over"),
      L("你在招呼进店客人", "You're greeting walk-ins"),
      L("你在整理吧台器具", "You're resetting the bar"),
      L("你在核对门店库存", "You're checking shop stock"),
      L("你在回复店内取件", "You're handling pickup orders"),
    ];
    // Apply floor beat after setParallelTrack so it isn't wiped on re-entry.
    if (agent) agent.textContent = typeLabel;
    const mode =
      this._modeFromStepType(step?.type) || this._activityMode || "idle";
    this.setParallelTrack(true, typeLabel);
    if (human) {
      const nextHuman = humanBeats[index % humanBeats.length];
      const humanChanged = human.textContent !== nextHuman;
      human.textContent = nextHuman;
      if (humanChanged) {
        const strip = document.querySelector("#ecomParallelStrip");
        strip?.classList.remove("is-human-tick");
        void strip?.offsetWidth;
        strip?.classList.add("is-human-tick");
        window.clearTimeout(this._parallelHumanTickTimer);
        this._parallelHumanTickTimer = window.setTimeout(
          () => strip?.classList.remove("is-human-tick"),
          560
        );
      }
    }
    this._syncComposerHint(typeLabel);
    this._syncParallelMeta(mode);
    const planSteps = document.querySelector(".ecom-plan-steps");
    if (planSteps && total > 0) planSteps.textContent = `${index + 1}/${total}`;
    else if (!planSteps && total > 0) this.renderStages?.();
  }

  /** Soft world signal: monitor + notify only (Agent reacts next). */
  senseWorldEvent(step = {}) {
    const text = getLocale() === "en" ? step.text_en || step.text_zh : step.text_zh || step.text_en;
    const level = step.level || "info";
    const tone = level === "danger" ? "danger" : level === "warn" ? "warn" : "info";
    this.pushMonitor(text, tone);
    this.bumpNotify({ kind: L("外部信号", "External"), text, level: tone, phase: "sense" });
    return { text, level, tone };
  }

  /** Agent-authored reaction after sensing a world event. */
  pushWorldReaction(step = {}, { sensed = false } = {}) {
    if (!sensed) this.senseWorldEvent(step);
    const text = getLocale() === "en" ? step.text_en || step.text_zh : step.text_zh || step.text_en;
    this._markNotifyPhase(text, "logged");
    const level = step.level || "info";
    const toneLabel =
      level === "danger"
        ? L("高优先级", "High priority")
        : level === "warn"
          ? L("需关注", "Needs attention")
          : L("外部信号", "External signal");
    const speakZh =
      level === "danger"
        ? `刚捕获到高优先级外部信号：${text}。我先核验，再决定是否需要你授权。`
        : level === "warn"
          ? `外部出现需要关注的变化：${text}。我先核对影响面。`
          : `收到外部更新：${text}。我会把它并入当前计划。`;
    const speakEn =
      level === "danger"
        ? `High-priority external signal: ${text}. I’ll verify before asking for authorization.`
        : level === "warn"
          ? `External change needs attention: ${text}. Checking impact first.`
          : `External update: ${text}. Folding it into the current plan.`;
    const nextAction =
      level === "danger"
        ? L("下一步：核验来源 → 评估停售风险 → 必要时请示授权", "Next: verify source → assess takedown risk → ask if needed")
        : level === "warn"
          ? L("下一步：对照库存/定价表 → 给出应对动作", "Next: cross-check sheet → propose a response")
          : L("下一步：并入计划，不打断当前主任务", "Next: fold into plan without breaking the main chain");
    const beatCue =
      level === "danger"
        ? L("感→想→做：高优先级先核验再请示", "S→T→A: verify high priority before escalating")
        : L("感→想→做：先感知，再决定是否打断主链", "S→T→A: sense first, then decide whether to interrupt");
    const beatHtml = this._beatRailHtml("observing", { className: "ecom-card-beat" });
    const html = `<div class="ecom-rich ecom-rich-world is-${esc(level)}">
      <div class="ecom-rich-head"><span class="ecom-pill">${esc(toneLabel)}</span>
        <strong>${esc(text)}</strong></div>
      <p class="muted">${esc(
        L("已纳入 Agent 观察队列", "Queued for the agent")
      )}</p>
      <p class="ecom-card-beat-row" aria-hidden="true">${beatHtml}<em>${esc(beatCue)}</em></p>
      <p class="ecom-stage-dual"><i></i><em>${esc(
        L("双轨：外部信号由我消化 · 你继续门店", "Dual-track: I digest external signals · you stay on the floor")
      )}</em><b>${esc(L("已记下", "Logged"))}</b></p>
      <p class="ecom-next-action">${esc(nextAction)}</p>
    </div>`;
    this.im.pushMessage({
      thread: "boss",
      from: "agent",
      kind: "world",
      text_zh: speakZh,
      text_en: speakEn,
    });
    this.im.pushRichCard({ thread: "boss", kind: "world", title: text, bodyHtml: html });
    this.setParallelTrack?.(
      true,
      level === "danger"
        ? L("高优先级外部信号 · 核验中", "High-priority signal · verifying")
        : L("外部信号已感知 · 并入计划", "External signal sensed · folding in")
    );
  }

  /** Back-compat alias. */
  pushWorldEvent(step = {}) {
    this.pushWorldReaction(step, { sensed: false });
  }

  /** Silent writeback: KPI/monitor only — never spoil the chat as "mutation". */
  applySilentMutation(step = {}) {
    const hint = this._mutationHint(step);
    this.pushMonitor(hint.chip, "warn");
    this.bumpNotify({
      kind: L("状态漂移", "Drift"),
      text: hint.chip,
      level: "warn",
      phase: "sense",
    });
  }

  /** Agent-authored discovery after a short observe beat. */
  pushMutationDiscovery(step = {}) {
    const hint = this._mutationHint(step);
    this._markNotifyPhase(hint.chip, "verified");
    const nextAction = L(
      "下一步：对照表格写回 → 评估是否改价/补货/请示",
      "Next: cross-check the sheet → decide repricing / restock / escalate"
    );
    const watch = this._planWatchTip({ next: hint.title });
    const beatHtml = this._beatRailHtml("verified", { className: "ecom-card-beat" });
    const html = `<div class="ecom-rich ecom-rich-discovery">
      <div class="ecom-rich-head"><span class="ecom-pill is-live">${esc(L("已核对", "Verified"))}</span>
        <strong>${esc(hint.title)}</strong></div>
      <p class="muted">${esc(hint.detail)}</p>
      <p class="ecom-card-beat-row" aria-hidden="true">${beatHtml}<em>${esc(
        L("感→想→做：先感知漂移，再开口核对", "S→T→A: sense drift first, then speak the verify")
      )}</em></p>
      <p class="ecom-stage-dual"><i></i><em>${esc(
        L("双轨：静默漂移已核对 · 不剧透打断门店", "Dual-track: silent drift verified · no spoiler interrupt")
      )}</em><b>${esc(L("已校验", "Verified"))}</b></p>
      <p class="ecom-stage-watch is-${esc(watch.level || "info")}"><span>${esc(
        L("盯盘", "Watch")
      )}</span><em>${esc(watch.text)}</em></p>
      <p class="ecom-next-action">${esc(nextAction)}</p>
    </div>`;
    this.im.pushMessage({
      thread: "boss",
      from: "agent",
      kind: "discovery",
      text_zh: hint.speakZh,
      text_en: hint.speakEn,
    });
    this.im.pushRichCard({
      thread: "boss",
      kind: "discovery",
      title: hint.title,
      bodyHtml: html,
    });
    this.setParallelTrack?.(true, L("漂移已确认 · 继续推进", "Drift confirmed · continuing"));
    this._planWatchPulse = true;
    this.renderStages?.();
  }

  _mutationHint(step = {}) {
    const raw = getLocale() === "en" ? step.text_en || step.text_zh : step.text_zh || step.text_en;
    const kpi = step.kpi || {};
    const bits = [];
    if (kpi.sold != null || kpi.orders != null) bits.push(`${L("订单", "Orders")} ${kpi.orders ?? kpi.sold}`);
    if (kpi.stock != null) bits.push(`${L("库存", "Stock")} ${kpi.stock}`);
    if (kpi.refunds != null) bits.push(`${L("退款", "Refunds")} ¥${kpi.refunds}`);
    if (kpi.airFreight != null) bits.push(`${L("空运", "Air")} ¥${kpi.airFreight}`);
    if (kpi.profit != null) bits.push(`${L("利润", "Profit")} ¥${kpi.profit}`);
    if (kpi.budgetSpent != null) bits.push(`${L("已花预算", "Spent")} ¥${kpi.budgetSpent}`);
    const detail = bits.length
      ? bits.join(" · ")
      : L("需主动核对库存 / 订单 / 供方状态", "Must verify stock / orders / supplier state");
    return {
      title: raw || L("状态回写异常", "Unexpected writeback"),
      detail,
      chip: bits[0] || L("状态漂移", "State drift"),
      speakZh: `我刚扫到一处状态漂移：${raw || "回写与账面不一致"}。正在核对原因。`,
      speakEn: `I just caught a state drift: ${raw || "writeback doesn't match the ledger"}. Checking why.`,
    };
  }

  senseNotification(step = {}) {
    const text = getLocale() === "en" ? step.text_en || step.text_zh : step.text_zh || step.text_en;
    this.pushMonitor(text, "info");
    this.bumpNotify({ kind: L("通知", "Notice"), text, level: "info", phase: "sense" });
    return text;
  }

  pushNotificationEvent(step = {}, { sensed = false } = {}) {
    const text = sensed
      ? getLocale() === "en"
        ? step.text_en || step.text_zh
        : step.text_zh || step.text_en
      : this.senseNotification(step);
    this._markNotifyPhase(text, "logged");
    const nextAction = L(
      "下一步：记入上下文 · 若影响交付则插入核对步骤",
      "Next: log context · insert a verify step if outputs are affected"
    );
    const beatHtml = this._beatRailHtml("observing", { className: "ecom-card-beat" });
    const html = `<div class="ecom-rich ecom-rich-notify">
      <div class="ecom-rich-head"><span class="ecom-pill is-live">${esc(L("已读通知", "Notice read"))}</span>
        <strong>${esc(text)}</strong></div>
      <p class="muted">${esc(L("已纳入当前任务上下文", "Folded into the current task context"))}</p>
      <p class="ecom-card-beat-row" aria-hidden="true">${beatHtml}<em>${esc(
        L("感→想→做：先感知记下，再决定要不要动", "S→T→A: sense and log first, then decide whether to act")
      )}</em></p>
      <p class="ecom-stage-dual"><i></i><em>${esc(
        L("双轨：通知先记下 · 不打断门店节奏", "Dual-track: log notice first · don’t break floor rhythm")
      )}</em><b>${esc(L("已记下", "Logged"))}</b></p>
      <p class="ecom-next-action">${esc(nextAction)}</p>
    </div>`;
    this.im.pushMessage({
      thread: "boss",
      from: "agent",
      kind: "notify",
      text_zh: `收到通知：${text}。我先记进上下文，再决定要不要动作。`,
      text_en: `Notice received: ${text}. Logging it before deciding the next action.`,
    });
    this.im.pushRichCard({ thread: "boss", kind: "notify", title: text, bodyHtml: html });
    this.setParallelTrack?.(true, L("通知已纳入 · 继续推进", "Notice logged · continuing"));
  }

  pushKpiVerified(kpi = {}) {
    const bits = [];
    if (kpi.orders != null || kpi.sold != null) bits.push(`${L("订单", "Orders")} ${kpi.orders ?? kpi.sold}`);
    if (kpi.stock != null) bits.push(`${L("库存", "Stock")} ${kpi.stock}`);
    if (kpi.unitPrice != null) bits.push(`${L("售价", "Price")} ¥${kpi.unitPrice}`);
    if (kpi.profit != null) bits.push(`${L("利润", "Profit")} ¥${kpi.profit}`);
    if (kpi.budgetSpent != null) bits.push(`${L("已花", "Spent")} ¥${kpi.budgetSpent}`);
    const detail = bits.join(" · ") || L("经营指标已回写", "Ops metrics written back");
    const watch = this._planWatchTip({ next: detail });
    const nextAction = L(
      "下一步：若库存/毛利触线，插入补货或改价动作",
      "Next: if stock/margin hits a line, insert restock or repricing"
    );
    const beatHtml = this._beatRailHtml("verified", { className: "ecom-card-beat" });
    const html = `<div class="ecom-rich ecom-rich-discovery">
      <div class="ecom-rich-head"><span class="ecom-pill is-live">${esc(L("指标校验", "KPI check"))}</span>
        <strong>${esc(detail)}</strong></div>
      <p class="muted">${esc(L("表格与顶部 KPI 已同步", "Sheet and top KPIs are in sync"))}</p>
      <p class="ecom-card-beat-row" aria-hidden="true">${beatHtml}<em>${esc(
        L("感→想→做：写回已校验，账表对齐", "S→T→A: writeback verified, ledger aligned")
      )}</em></p>
      <p class="ecom-stage-dual"><i></i><em>${esc(
        L("双轨：账表校验不打断门店", "Dual-track: ledger verify without interrupting the floor")
      )}</em></p>
      <p class="ecom-stage-watch is-${esc(watch.level || "info")}"><span>${esc(
        L("盯盘", "Watch")
      )}</span><em>${esc(watch.text)}</em></p>
      <p class="ecom-next-action">${esc(nextAction)}</p>
    </div>`;
    this.im.pushRichCard({ thread: "boss", kind: "discovery", title: detail, bodyHtml: html });
    this._planWatchPulse = true;
    this.renderStages?.();
  }

  setAgentStatus(taskLabel) {
    const task = document.querySelector("#ecomAgentTask");
    if (task) {
      task.textContent = taskLabel
        ? `${L("当前阶段", "Stage")}: ${taskLabel}`
        : L("待命", "Idle");
    }
    // Stage chip is owned by renderStages (dual-track structure).
    if (taskLabel) this.renderStages?.();
    else {
      const eta = document.querySelector("#ecomAgentEta");
      if (eta && !this.player?.running) {
        eta.classList.remove("is-live", "is-warn");
        eta.innerHTML = `<em>${esc(L("待命", "Idle"))}</em>`;
        eta.title = L("启动 Replay 后进入双轨无人值守", "Start Replay for dual-track hands-free");
      }
    }
    if (!taskLabel) this.setAgentActivity("idle", L("观察", "Observe"), { settle: false });
  }

  _activityModeLabel(mode = "idle") {
    return (
      {
        idle: L("观察", "Observe"),
        observing: L("感知", "Sense"),
        planning: L("规划", "Plan"),
        acting: L("执行", "Act"),
        communicating: L("沟通", "Chat"),
        verified: L("已校验", "Verified"),
      }[mode] || L("观察", "Observe")
    );
  }

  _syncActivityModeChip(el, mode = "idle") {
    if (!el) return;
    let chip = el.querySelector(".ecom-agent-mode");
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "ecom-agent-mode";
      el.appendChild(chip);
    }
    chip.textContent = this._activityModeLabel(mode);
    chip.dataset.mode = mode || "idle";
  }

  _syncActivityBeat(el, mode = "idle") {
    if (!el) return;
    const running = Boolean(this.player?.running);
    const existing = el.querySelector(".ecom-activity-beat");
    if (!running) {
      existing?.remove();
      el.classList.remove("has-beat");
      return;
    }
    const html = this._beatRailHtml(mode, { className: "ecom-activity-beat" });
    el.classList.add("has-beat");
    if (!existing) {
      el.insertAdjacentHTML("beforeend", html);
      return;
    }
    if (existing.outerHTML !== html) existing.outerHTML = html;
  }

  setAgentActivity(mode = "idle", label = "", { settle = true } = {}) {
    const el = document.querySelector("#ecomAgentActivity");
    const dot = document.querySelector("#ecomLiveDot");
    if (!el) return;
    window.clearTimeout(this._activityTimer);
    this._activityMode = mode || "idle";
    el.className = `ecom-agent-activity is-${mode}`;
    const text = el.querySelector("em");
    const running = Boolean(this.player?.running);
    const idleLabel = running
      ? L("双轨观察 · 门店优先", "Dual-track observe · floor first")
      : L("观察", "Observe");
    if (text) text.textContent = label || idleLabel;
    this._syncActivityModeChip(el, mode);
    this._syncActivityBeat(el, mode);
    if (dot) {
      const live = mode !== "idle" || running;
      dot.classList.toggle("is-on", live);
      dot.dataset.mode = mode || "idle";
    }
    if (running) {
      const line = label || L("Agent 在后台推进任务", "Agent advancing tasks in background");
      this.setParallelTrack(true, line);
      this._syncComposerHint(line);
      this._syncParallelMeta(mode);
      this.benches?._syncPlayStatus?.();
      this._renderRailWatch();
      const planBeat = document.querySelector(".ecom-plan-beat");
      if (planBeat) {
        const nextBeat = this._beatRailHtml(mode, { className: "ecom-plan-beat" });
        if (planBeat.outerHTML !== nextBeat) planBeat.outerHTML = nextBeat;
      }
      const planCue = document.querySelector(".ecom-plan-beat-cue");
      if (planCue) {
        const beat = this._activityBeat(mode);
        planCue.textContent =
          beat === "sense"
            ? L("先感知", "Sense first")
            : beat === "think"
              ? L("先想清", "Think first")
              : beat === "act"
                ? L("正在做", "Acting")
                : beat === "check"
                  ? L("已校验", "Verified")
                  : L("双轨观察", "Dual observe");
      }
      const stageBeat = document.querySelector(".ecom-stage-beat");
      if (stageBeat) {
        const nextStageBeat = this._beatRailHtml(mode, { className: "ecom-stage-beat" });
        if (stageBeat.outerHTML !== nextStageBeat) stageBeat.outerHTML = nextStageBeat;
        const eta = document.querySelector("#ecomAgentEta");
        if (eta) eta.dataset.beat = this._activityBeat(mode);
      }
    }
    if (settle && mode !== "idle") {
      const hold =
        mode === "observing" ? 3200 : mode === "planning" ? 2400 : mode === "communicating" ? 2200 : 1600;
      this._activityTimer = window.setTimeout(() => {
        const stillRunning = Boolean(this.player?.running);
        this._activityMode = "idle";
        el.className = `ecom-agent-activity is-idle ${stillRunning ? "is-dual" : ""}`;
        if (text) {
          text.textContent = stillRunning
            ? L("双轨观察 · 门店优先", "Dual-track observe · floor first")
            : L("观察", "Observe");
        }
        this._syncActivityModeChip(el, "idle");
        this._syncActivityBeat(el, "idle");
        if (dot) {
          dot.dataset.mode = stillRunning ? "observing" : "idle";
          dot.classList.toggle("is-on", stillRunning);
        }
        if (stillRunning) {
          this.setParallelTrack(true, L("Agent 在后台推进任务", "Agent advancing tasks in background"));
          this._syncParallelMeta("idle");
        }
      }, hold);
    }
  }

  renderStages() {
    const stages = this.meta?.stages || [];
    const idx = Math.max(0, stages.findIndex((s) => s.id === this.stageId));
    const st = stages[idx] || stages[0];
    if (!st) return;
    const en = getLocale() === "en";
    const label = en ? st.en : st.zh;
    const acts = [
      { id: "brief", zh: "立项", en: "Brief", ids: ["brief", "research"] },
      { id: "source", zh: "寻源", en: "Source", ids: ["sourcing", "sample_qc", "call"] },
      { id: "pack", zh: "包装", en: "Pack", ids: ["pack_v1", "pack_reject", "pack_v2"] },
      { id: "launch", zh: "上架", en: "Launch", ids: ["factory", "pricing", "soft_launch", "sell_w1"] },
      { id: "disrupt", zh: "扰动", en: "Shock", ids: ["disrupt_quality", "disrupt_takedown", "disrupt_delay", "recover"] },
      { id: "growth", zh: "增长", en: "Growth", ids: ["promo_war", "livestream", "sell_w2", "heartbeat"] },
      { id: "close", zh: "收尾", en: "Close", ids: ["scam_mail", "scam_check", "scam_dispose", "disrupt_ledger", "profit", "sop_close"] },
    ];
    const actIdx = Math.max(
      0,
      acts.findIndex((a) => a.ids.includes(this.stageId))
    );
    const actName = acts[actIdx] ? (en ? acts[actIdx].en : acts[actIdx].zh) : "";
    const live = Boolean(this.player?.running);
    const strip = document.querySelector("#ecomPlanStrip");
    if (!strip) return;
    const total = stages.length || 1;
    const pct = Math.round(((idx + 1) / total) * 100);
    const subs = (en ? st.subs_en : st.subs_zh) || [];
    const sub = subs[Math.min(st.activeSub || 0, Math.max(0, subs.length - 1))] || "";
    const changing = this._lastPlanStage && this._lastPlanStage !== this.stageId;
    this._lastPlanStage = this.stageId;
    const watch = this._planWatchTip({ next: sub || label });
    const mode =
      this._activityMode ||
      this._modeFromStepType(this._replayProgress?.type) ||
      (changing ? "planning" : "idle");
    const eta = document.querySelector("#ecomAgentEta");
    if (eta) {
      eta.classList.toggle("is-live", live);
      eta.classList.toggle("is-warn", watch.level === "warn");
      eta.dataset.beat = live ? this._activityBeat(mode) : "";
      eta.title = watch.text || label;
      eta.innerHTML = live
        ? `${this._beatRailHtml(mode, { className: "ecom-stage-beat" })}<b>${esc(
            actName || label
          )}</b><em>${esc(label)}</em><i>${esc(L("双轨", "Dual"))}</i>`
        : `<em>${esc(actName ? `${actName} · ${label}` : label || L("待命", "Idle"))}</em>`;
    }
    const replayBtn = document.querySelector("#ecomBtnReplay");
    if (replayBtn) {
      replayBtn.classList.toggle("is-running", live);
      replayBtn.title = live
        ? L("Replay 进行中 · 门店优先，勿打断", "Replay running · floor first, don’t interrupt")
        : L("启动双轨无人值守 Replay", "Start dual-track hands-free Replay");
      if (live) replayBtn.setAttribute("aria-busy", "true");
      else replayBtn.removeAttribute("aria-busy");
    }
    strip.className = `ecom-plan-strip ${changing ? "is-advancing" : ""} ${live ? "is-live" : ""} ${
      watch.level ? `is-watch-${watch.level}` : ""
    }`;
    const ctx = this._standbyContext();
    const benchLabel = {
      phone: L("通话", "Call"),
      pack: L("包装", "Pack"),
      edit: L("剪辑", "Edit"),
      sheet: L("账表", "Sheet"),
      comms: L("协作", "Comms"),
    }[ctx.nextBench] || L("工作台", "Bench");
    const prog = this._replayProgress || {};
    const stepTotal = Number(prog.total) || 0;
    const stepIndex = Number(prog.index) || 0;
    const beatHtml = live
      ? this._beatRailHtml(mode, { className: "ecom-plan-beat" })
      : "";
    const beatCue =
      live
        ? `<span class="ecom-plan-beat-cue">${esc(
            this._activityBeat(mode) === "sense"
              ? L("先感知", "Sense first")
              : this._activityBeat(mode) === "think"
                ? L("先想清", "Think first")
                : this._activityBeat(mode) === "act"
                  ? L("正在做", "Acting")
                  : this._activityBeat(mode) === "check"
                    ? L("已校验", "Verified")
                    : L("双轨观察", "Dual observe")
          )}</span>`
        : "";
    strip.innerHTML = `
      <div class="ecom-plan-meta">
        <strong>${esc(L("执行计划", "Plan"))}</strong>
        ${live ? `<span class="ecom-plan-live">${esc(L("无人值守", "Hands-free"))}</span>` : ""}
        ${beatHtml}${beatCue}
        <span>${idx + 1}/${total}</span>
        ${
          live && stepTotal > 0
            ? `<span class="ecom-plan-steps">${stepIndex + 1}/${stepTotal}</span>`
            : ""
        }
        <em style="--p:${pct}%"></em>
      </div>
      <div class="ecom-plan-acts" role="list">
        ${acts
          .map((a, i) => {
            const state = i < actIdx ? "is-done" : i === actIdx ? "is-active" : "";
            return `<span class="ecom-plan-act ${state}" role="listitem">${esc(en ? a.en : a.zh)}</span>`;
          })
          .join("")}
      </div>
      <div class="ecom-plan-now">
        <b>${esc(label)}</b>
        ${sub ? `<small>${esc(sub)}</small>` : ""}
        ${
          live
            ? `<p class="ecom-plan-next-bench"><span>${esc(L("下一拍", "Next"))}</span><em>${esc(
                benchLabel
              )}</em><i>${esc(L("双轨 · 门店优先", "Dual · floor first"))}</i></p>`
            : ""
        }
        <p class="ecom-plan-watch is-${esc(watch.level || "info")}"><span>${esc(
          L("盯盘", "Watch")
        )}</span><em>${esc(watch.text)}</em></p>
      </div>`;
    if (changing) {
      window.clearTimeout(this._planAnimTimer);
      this._planAnimTimer = window.setTimeout(() => strip.classList.remove("is-advancing"), 900);
    }
    if (this._planWatchPulse) {
      this._planWatchPulse = false;
      const tip = strip.querySelector(".ecom-plan-watch");
      tip?.classList.remove("is-pulse");
      void tip?.offsetWidth;
      tip?.classList.add("is-pulse");
      window.clearTimeout(this._planWatchTimer);
      this._planWatchTimer = window.setTimeout(() => tip?.classList.remove("is-pulse"), 900);
    }
    this._renderRailWatch();
  }

  /** Context for Playground idle: current act + watch tip + likely next bench. */
  _standbyContext() {
    const en = getLocale() === "en";
    const stages = this.meta?.stages || [];
    const st = stages.find((s) => s.id === this.stageId) || stages[0];
    const stage = st ? (en ? st.en || st.zh : st.zh || st.en) : "";
    const subs = (en ? st?.subs_en : st?.subs_zh) || [];
    const next = subs[0] || stage;
    const watch = this._planWatchTip({ next });
    const id = st?.id || this.stageId || "";
    let nextBench = "comms";
    if (/call|sourcing|sample/.test(id)) nextBench = "phone";
    else if (/pack/.test(id)) nextBench = "pack";
    else if (/livestream|promo|sell|heartbeat/.test(id)) nextBench = "edit";
    else if (/pricing|factory|soft_launch|profit|disrupt|recover|scam|ledger/.test(id)) nextBench = "sheet";
    else if (/design|xhs|kol|marketing/.test(id)) nextBench = "comms";
    return {
      stage,
      next,
      watch: watch.text,
      level: watch.level,
      live: Boolean(this.player?.running),
      nextBench,
    };
  }

  /** Compact Agent watch line: KPI risk + next sub-step while human is on the floor. */
  _planWatchTip({ next = "" } = {}) {
    const k = this.kpi || {};
    const stock = Number(k.stock) || 0;
    const margin = Number(k.marginPct) || 0;
    const live = Boolean(this.player?.running);
    if (stock > 0 && stock < 450) {
      return {
        level: "warn",
        text: L(
          `库存 ${stock} 偏低 · 下一步：${next || "核对补货"}`,
          `Stock ${stock} low · next: ${next || "check restock"}`
        ),
      };
    }
    if (margin > 0 && margin < 40) {
      return {
        level: "warn",
        text: L(
          `毛利 ${margin}% 偏紧 · 下一步：${next || "核对称重/改价"}`,
          `Margin ${margin}% tight · next: ${next || "verify weight / reprice"}`
        ),
      };
    }
    if (Number(k.budgetSpent) > 0 && Number(k.budgetTotal) > 0 && k.budgetSpent / k.budgetTotal > 0.85) {
      return {
        level: "warn",
        text: L(
          `预算将触顶 · 下一步：${next || "收口投放"}`,
          `Budget near cap · next: ${next || "tighten spend"}`
        ),
      };
    }
    if (live) {
      return {
        level: "ok",
        text: L(
          `你忙门店 · 我推进「${next || "当前节点"}」`,
          `You on floor · I advance “${next || "current node"}”`
        ),
      };
    }
    return {
      level: "info",
      text: L("待命：启动 Replay 后进入双轨无人值守", "Standby: start Replay for dual-track hands-free"),
    };
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
    this._planWatchPulse = true;
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
    const live = Boolean(this.player?.running);
    const k = this.kpi;
    const sales = Number(k.revenue) > 0 ? k.revenue : 0;
    const profit = Number(k.profit) || 0;
    const margin = Number(k.marginPct) || 0;
    const orders = Number(k.orders) || Number(k.sold) || 0;
    const stock = Number(k.stock) || 0;
    const budgetSpent = Number(k.budgetSpent) || 0;
    const budgetTotal = Number(k.budgetTotal) || 30000;
    const marginTone = margin > 0 && margin < 40 ? "warn" : "up";
    const stockNote =
      stock > 0 && stock < 450
        ? `${fmt(stock)} ${L("库存偏低", "stock low")}`
        : stock > 0
          ? `${fmt(stock)} ${L("库存", "stock")}`
          : "";
    const cards = [
      [L("销售额", "Sales"), `¥${fmt(sales)}`, k.salesDelta, "up"],
      [L("利润", "Profit"), `¥${fmt(profit)}`, k.profitDelta, profit > 0 ? "up" : ""],
      [L("毛利率", "Margin"), `${fmt(margin)}%`, k.marginDelta, marginTone],
      [L("订单", "Orders"), fmt(orders), k.ordersDelta, "up"],
      [
        L("预算", "Budget"),
        `¥${fmt(budgetSpent)}/${fmt(budgetTotal / 1000)}k`,
        null,
        budgetSpent / budgetTotal > 0.85 || (stock > 0 && stock < 450) ? "warn" : "",
        stockNote,
      ],
    ];
    const anyChanged = cards.some(
      ([, value], index) => this._lastKpiValues[index] != null && this._lastKpiValues[index] !== value
    );
    el.classList.toggle("is-dual", live);
    el.classList.toggle("is-syncing", live && anyChanged);
    el.innerHTML = `${
      live
        ? `<div class="ecom-kpi-dual-cue" aria-hidden="true">${this._beatRailHtml(
            anyChanged ? "verified" : this._activityMode || "observing",
            { className: "ecom-kpi-beat" }
          )}<span>${esc(
            anyChanged
              ? L("双轨回写 · 先感知再开口", "Dual writeback · sense first, then speak")
              : L("双轨盯盘 · 门店优先", "Dual watch · floor first")
          )}</span></div>`
        : ""
    }${cards
      .map(([label, value, delta, tone, note], index) => {
        const changed =
          this._lastKpiValues[index] != null && this._lastKpiValues[index] !== value;
        return `<div class="ecom-top-kpi ${tone || ""} ${changed ? "is-changed" : ""} ${
          live ? "is-dual" : ""
        }" title="${esc(
          changed
            ? live
              ? L("静默回写已感知 · 不打断门店", "Silent writeback sensed · floor uninterrupted")
              : L("刚回写", "Just written")
            : label
        )}">
        <span class="ecom-kpi-label">${esc(label)}${
          changed
            ? `<b class="ecom-kpi-fresh">${esc(
                live ? L("感知", "Sense") : L("回写", "Sync")
              )}</b>`
            : ""
        }</span>
        <strong class="ecom-kpi-value">${esc(value)}</strong>
        ${
          delta != null
            ? `<em class="delta">+${esc(delta)}%</em>`
            : note
              ? `<em class="warn">${esc(note)}</em>`
              : ""
        }
      </div>`;
      })
      .join("")}`;
    this._lastKpiValues = cards.map(([, value]) => value);
    const rail = document.querySelector("#ecomDynRail");
    if (anyChanged && rail) {
      rail.classList.remove("is-kpi-tick");
      void rail.offsetWidth;
      rail.classList.add("is-kpi-tick");
      window.clearTimeout(this._kpiTickTimer);
      this._kpiTickTimer = window.setTimeout(() => rail.classList.remove("is-kpi-tick"), 700);
    }
    const hidden = document.querySelector("#ecomKpi");
    if (hidden) hidden.innerHTML = el.innerHTML;
    this._renderRailWatch();
  }

  /** Compact dual-track watch chip between KPIs and sense monitors. */
  _renderRailWatch() {
    const rail = document.querySelector("#ecomDynRail");
    const monitors = document.querySelector("#ecomMonitors");
    if (!rail || !monitors) return;
    let tip = document.querySelector("#ecomRailWatch");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "ecomRailWatch";
      tip.className = "ecom-rail-watch";
      tip.hidden = true;
      rail.insertBefore(tip, monitors);
    }
    const live = Boolean(this.player?.running);
    const watch = this._planWatchTip({});
    const show = live || watch.level === "warn";
    const mode =
      this._activityMode || this._modeFromStepType(this._replayProgress?.type) || "idle";
    const ctx = this._standbyContext();
    const nextBenchLabel = {
      phone: L("通话", "Call"),
      pack: L("包装", "Pack"),
      edit: L("剪辑", "Edit"),
      sheet: L("账表", "Sheet"),
      comms: L("协作", "Comms"),
    }[ctx.nextBench];
    tip.hidden = !show;
    tip.className = `ecom-rail-watch is-${watch.level || "info"} ${live ? "is-live" : ""}`;
    tip.dataset.beat = live ? this._activityBeat(mode) : "";
    tip.innerHTML = `${
      live ? this._beatRailHtml(mode, { className: "ecom-rail-watch-beat" }) : ""
    }<span>${esc(L("盯盘", "Watch"))}</span><em>${esc(watch.text)}</em>${
      live && nextBenchLabel
        ? `<i class="ecom-rail-watch-next">${esc(L(`下一拍 · ${nextBenchLabel}`, `Next · ${nextBenchLabel}`))}</i>`
        : ""
    }${live ? `<b>${esc(L("双轨", "Dual"))}</b>` : ""}`;
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
    const live = Boolean(this.player?.running);
    const mode =
      this._activityMode || this._modeFromStepType(this._replayProgress?.type) || "idle";
    const beatHtml = live
      ? this._beatRailHtml(stockTone ? "observing" : mode, { className: "ecom-snap-beat" })
      : "";
    el.classList.toggle("is-dual", live);
    el.innerHTML = `
      <div class="ecom-snap-sku">
        ${thumb ? `<img src="${esc(thumb)}" alt="" />` : ""}
        <div>
          <strong>${esc(en ? sku.name_en || sku.name_zh : sku.name_zh || sku.name_en)}</strong>
          <small>${esc(sku.id || "")}</small>
        </div>
      </div>
      ${
        live
          ? `<p class="ecom-snap-dual" aria-hidden="true">${beatHtml}<em>${esc(
              stockTone
                ? L("感→想→做：库存触线，先感知再开口", "S→T→A: stock line hit — sense first, then speak")
                : L("感→想→做：快照看账 · 门店优先", "S→T→A: quiet ledger watch · floor first")
            )}</em></p>`
          : ""
      }
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
      <div class="ecom-budget-bar ${pct > 85 ? "is-hot" : ""}" title="${esc(pct)}%"><i style="width:${esc(pct)}%"></i></div>
      ${
        stockTone
          ? `<p class="ecom-snap-hint">${esc(
              live
                ? L("库存偏低 · 双轨盯盘中，不打断门店", "Stock low · dual-track watch, no floor interrupt")
                : L("库存偏低 · Agent 已盯盘", "Stock low · Agent watching")
            )}</p>`
          : ""
      }
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

  _deliverableNext(kind = "") {
    return (
      {
        pack: L("下一步：合规过审后推进印刷 / 上架", "Next: clear compliance, then print / list"),
        video: L("下一步：同步运营投放，盯转化回写", "Next: sync ops for push and watch conversion"),
        note: L("下一步：观察笔记反馈，必要时改标题", "Next: watch note feedback, retitle if needed"),
        quote: L("下一步：锁价通话 → 写回定价表", "Next: lock-price call → write the price sheet"),
        profit: L("下一步：对照预算，收口本轮经营", "Next: check budget and close this ops loop"),
        sheet: L("下一步：继续销售节奏，盯库存触线", "Next: keep sales cadence, watch stock floor"),
      }[kind] || L("下一步：交付物已归档，继续本幕动作", "Next: output pinned — continue the act")
    );
  }

  deliverableCompactHtml(row, title, body) {
    const kind = kindLabel(row.kind || "file");
    const summary = String(body || "")
      .split(/\n/)
      .find(Boolean) || L("已生成并保存到交付物", "Generated and saved to deliverables");
    const thumb = row.cover
      ? `<img class="ecom-result-thumb" src="${esc(row.cover)}" alt="" />`
      : `<span class="ecom-result-icon">${esc(kind.slice(0, 1))}</span>`;
    const age = this._monitorAge(row.arrivedAt || Date.now());
    const live = Boolean(this.player?.running);
    const next = this._deliverableNext(row.kind);
    const beatHtml = live
      ? this._beatRailHtml("verified", { className: "ecom-result-beat" })
      : "";
    return `<div class="ecom-result-card is-arrive ${row.highlight ? "is-highlight" : ""} ${
      live ? "is-dual" : ""
    }">
      ${thumb}
      <div class="ecom-result-copy">
        <span>${esc(kind)}</span>
        <strong>${esc(title)}</strong>
        <small>${esc(summary)}</small>
        ${
          live
            ? `<div class="ecom-result-beat-row">${beatHtml}<em>${esc(
                L("感→想→做：产出已校验落盘", "S→T→A: output verified and pinned")
              )}</em></div>`
            : ""
        }
        <em class="ecom-result-meta">${esc(
          live
            ? L("无人值守落盘 · 门店优先", "Hands-free pin · floor first")
            : L("Agent 已落盘", "Pinned by Agent")
        )} · ${esc(age)}</em>
        <em class="ecom-result-next">${esc(next)}</em>
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
      arrivedAt: Date.now(),
    };
    const idx = this.deliverables.findIndex((d) => d.id === id);
    if (idx >= 0) this.deliverables[idx] = { ...this.deliverables[idx], ...row };
    else this.deliverables.unshift(row);
    this._freshDeliverableId = id;
    this.renderWall();

    const en = getLocale() === "en";
    const title = en ? row.title_en : row.title_zh;
    const body = en ? row.body_en : row.body_zh;
    // Thinking beat is owned by the script player (avoid double rail).
    if (announce) {
      this.im.showThinking?.(L("整理交付结果…", "Packaging the output…"));
      await new Promise((r) => setTimeout(r, 280));
      this.im.hideThinking?.();
    }
    const html = this.deliverableCompactHtml(row, title, body);
    this.im.pushRichCard({
      thread: "boss",
      kind: row.kind,
      title,
      bodyHtml: html,
      deliverableId: id,
    });
    if (this.player?.running) {
      this.setParallelTrack(
        true,
        L(`交付物已落盘 · ${title}`, `Output pinned · ${title}`)
      );
      this._syncComposerHint(L(`交付物已落盘 · ${kindLabel(row.kind)}`, `Pinned · ${kindLabel(row.kind)}`));
    }

    this.benches.showDeliverable(row);
    if (row.kind === "pack") this.benches.switchBench("pack");
    else if (row.kind === "sheet" || row.kind === "quote") this.benches.switchBench("sheet");
    else if (row.kind === "video") this.benches.switchBench("edit");
  }

  renderWall() {
    const el = document.querySelector("#ecomWall");
    if (!el) return;
    const live = Boolean(this.player?.running);
    const mode =
      this._activityMode || this._modeFromStepType(this._replayProgress?.type) || "idle";
    const beatMode = this._freshDeliverableId ? "acting" : mode;
    const beatHtml = live
      ? this._beatRailHtml(beatMode, { className: "ecom-wall-beat" })
      : "";
    const dualCue = live
      ? `<i class="ecom-wall-dual">${esc(L("双轨", "Dual"))}</i>`
      : "";
    if (!this.deliverables.length) {
      el.classList.toggle("is-live", live);
      el.innerHTML = `<div class="ecom-wall-label"><strong>${esc(
        L("交付物", "Deliverables")
      )}</strong><span>0</span>${
        live ? `<b class="ecom-wall-live">${esc(L("待命落盘", "Ready to pin"))}</b>` : ""
      }${dualCue}${beatHtml}</div><div class="ecom-wall-empty">${esc(
        live
          ? L("无人值守中 · 产出会自动落盘这里，忙完门店再回看", "Hands-free · outputs pin here — review after floor work")
          : L("任务产出将固定在这里", "Task outputs will be pinned here")
      )}</div>`;
      return;
    }
    const en = getLocale() === "en";
    const items = this.deliverables.slice(0, 8);
    const freshId = this._freshDeliverableId;
    const freshRow = items.find((d) => d.id === freshId) || items[0];
    const tip = freshRow
      ? this._deliverableNext(freshRow.kind).replace(/^下一步：|^Next:\s*/i, "")
      : "";
    el.classList.toggle("is-live", live);
    el.innerHTML = `<div class="ecom-wall-label">
        <strong>${esc(L("交付物", "Deliverables"))}</strong>
        <span>${items.length}</span>
        ${live ? `<b class="ecom-wall-live">${esc(L("落盘中", "Pinning"))}</b>` : ""}
        ${dualCue}
        ${beatHtml}
        ${tip ? `<em class="ecom-wall-tip" title="${esc(tip)}">${esc(tip)}</em>` : ""}
      </div>${items
      .map((d) => {
        const title = en ? d.title_en || d.title_zh : d.title_zh || d.title_en;
        const thumb = d.cover
          ? `<img class="ecom-wall-thumb" src="${esc(d.cover)}" alt="" />`
          : `<span class="ecom-wall-kind">${esc(kindLabel(d.kind))}</span>`;
        const isNew = d.id === freshId;
        const age = this._monitorAge(d.arrivedAt || Date.now());
        return `<button type="button" class="ecom-wall-chip ${d.highlight ? "is-highlight" : ""} ${
          isNew ? "is-new" : ""
        } ${live ? "is-dual" : ""}" data-deliv="${esc(d.id)}" title="${esc(this._deliverableNext(d.kind))}">${thumb}<span class="ecom-wall-copy"><strong>${esc(
          title
        )}</strong><small>${esc(kindLabel(d.kind))} · ${esc(age)}</small></span>${
          isNew ? `<em class="ecom-wall-new">${esc(L("新", "New"))}</em>` : ""
        }</button>`;
      })
      .join("")}`;
    el.querySelectorAll("[data-deliv]").forEach((btn) => {
      btn.addEventListener("click", () => this.focusDeliverable(btn.dataset.deliv));
    });
    const fresh = el.querySelector(".ecom-wall-chip.is-new");
    fresh?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    if (freshId) {
      window.clearTimeout(this._freshDelivTimer);
      this._freshDelivTimer = window.setTimeout(() => {
        if (this._freshDeliverableId === freshId) this._freshDeliverableId = null;
        el.querySelector(".ecom-wall-chip.is-new")?.classList.remove("is-new");
      }, 2400);
    }
    window.clearTimeout(this._wallAgeTimer);
    if (live && items.length) {
      this._wallAgeTimer = window.setTimeout(() => {
        if (this.player?.running) this.renderWall();
      }, 4000);
    }
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
    const acts = getLocale() === "en"
      ? ["Brief", "Source", "Pack", "Launch", "Shock", "Growth", "Close"]
      : ["立项", "寻源", "包装", "上架", "扰动", "增长", "收尾"];
    el.innerHTML = `<div class="ecom-welcome-card">
      <div class="ecom-welcome-kicker">VibeLifeBench</div>
      <h3>${esc(title || "")}</h3>
      <p>${esc(sub || "")}</p>
      <div class="ecom-welcome-dual" aria-hidden="true">
        <span class="ecom-welcome-human"><i></i><em>${esc(
          L("你 · 门店 / 冲咖啡", "You · floor / brewing")
        )}</em></span>
        <span class="ecom-welcome-sep"></span>
        <span class="ecom-welcome-agent"><i></i><em>${esc(
          L("Agent · 无人值守跑完链路", "Agent · hands-free chain")
        )}</em></span>
      </div>
      <div class="ecom-welcome-beat" aria-hidden="true">
        <b class="is-on">${esc(L("感", "S"))}</b><i></i>
        <b>${esc(L("想", "T"))}</b><i></i>
        <b>${esc(L("做", "A"))}</b>
        <em>${esc(L("先感知，再开口，再动手", "Sense first, then speak, then act"))}</em>
      </div>
      <ol>
        <li>${esc(L("你去冲咖啡 / 打理门店，Agent 在后台把任务链跑完", "You brew / run the shop — Agent finishes the task chain"))}</li>
        <li>${esc(L("左侧：统一对话（thinking · 工具意图 · 交付物）", "Left: unified chat (thinking · tool why · deliverables)"))}</li>
        <li>${esc(L("顶栏监控会先“感知”，右侧 Playground 放大当前工作台", "Top monitors sense first; Playground magnifies the active bench"))}</li>
      </ol>
      <p class="ecom-welcome-acts">${acts.map((a) => `<span>${esc(a)}</span>`).join("")}</p>
      <div class="ecom-welcome-actions">
        <button type="button" class="ecom-btn-primary" data-ecom="replay">${esc(L("开始 Replay", "Start Replay"))}</button>
        <button type="button" class="ecom-btn-ghost" data-ecom="configure">${esc(L("配置模型", "Configure model"))}</button>
      </div>
    </div>`;
    el.querySelector("[data-ecom=replay]")?.addEventListener("click", () => this.onReplay?.());
    el.querySelector("[data-ecom=configure]")?.addEventListener("click", () => this.onConfigure?.());
    document.querySelector("#ecomBtnReplay")?.classList.add("is-idle-pulse");
  }

  async startReplay({ onProgress, onToast } = {}) {
    if (!this.ready) await this.load();
    this.reset();
    this.showWelcome(false);
    document.querySelector("#ecomLiveDot")?.classList.add("is-on");
    document.querySelector("#ecomAutoExec") && (document.querySelector("#ecomAutoExec").checked = true);
    this.setReplayLocked(true);
    document.querySelector("#ecomBtnReplay")?.classList.remove("is-idle-pulse");
    onToast?.(L("挂耳电商 Replay 开始", "Drip-commerce replay started"));
    let result;
    try {
      result = await this.player.play({
        onProgress: (p) => {
          onProgress?.(p);
          this.setReplayProgress?.(p);
          const pill = document.querySelector("#progressLabel");
          if (pill) pill.textContent = ecomProgressLabel(p.index, p.total);
        },
      });
    } finally {
      this.setReplayLocked(false);
      document.querySelector("#ecomLiveDot")?.classList.remove("is-on");
      document.querySelector("#ecomBtnReplay")?.classList.add("is-idle-pulse");
    }
    if (result?.ok) {
      this.pushReplayWrapUp?.();
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
