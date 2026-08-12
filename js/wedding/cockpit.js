/**
 * Wedding planning cockpit — fixed KPI header, pure dialogue stream, workspace panels.
 */

import { L, getLocale, applyDomI18n } from "../i18n.js?v=20260812-no-think-cards";
import { WeddingStream, AUTH_PAYMENT_THRESHOLD, pickWeddingLocale } from "./stream.js?v=20260812-no-think-cards";
import {
  WeddingWorkspaces,
  maskContact,
  parseWeddingStageTracks,
  WORKSPACE_IDS,
} from "./workspaces.js?v=20260812-no-think-cards";
import { WeddingScriptPlayer, weddingProgressLabel } from "./script.js?v=20260812-no-think-cards";

export { AUTH_PAYMENT_THRESHOLD, weddingProgressLabel, WORKSPACE_IDS };

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return v.toLocaleString(getLocale() === "en" ? "en-US" : "zh-CN");
}

export class WeddingCockpit {
  constructor() {
    this.root = document.querySelector("#weddingCockpit");
    this.meta = null;
    this.seed = null;
    this.trajectory = null;
    this.kpi = null;
    this.locks = [];
    this.vendors = [];
    this.contracts = {};
    this.bookings = {};
    this.calendar = [];
    this.deliverables = [];
    this.stageId = null;
    this.ready = false;
    this._authGrants = new Map();
    this._blockedPayments = [];
    this._lastActId = null;
    this._lastKpiSig = "";

    this.stream = new WeddingStream({
      messagesEl: document.querySelector("#weddingMessages"),
      onFocusDeliverable: (id) => this.focusDeliverable(id),
      onReplay: () => this.onReplay?.(),
      onExternalMessage: (row, opts) => this.workspaces?.pushCommunication(row, opts),
      onExternalFocus: (id) => this.workspaces?.focusCommunication(id, { reveal: true }),
      onInboundTipOpen: ({ workspace, thread } = {}) => {
        if (workspace === "im" && thread) {
          this.workspaces?.focusCommunication?.(thread, { reveal: true });
          return;
        }
        if (workspace) this.workspaces?.switchWorkspace?.(workspace);
      },
    });

    this.workspaces = new WeddingWorkspaces({
      stageEl: document.querySelector("#weddingWorkspaceStage"),
      tabsEl: document.querySelector("#weddingWorkspaceTabs"),
      titleEl: document.querySelector("#weddingWorkspaceTitle"),
      statusEl: document.querySelector("#weddingWorkspaceStatus"),
      getState: () => this.getWorkspaceState(),
    });

    this.player = new WeddingScriptPlayer(this);
    if (typeof window !== "undefined") window.__weddingCockpit = this;

    document.querySelector("#weddingBtnReplay")?.addEventListener("click", () => this.onReplay?.());
    document.querySelector("#weddingBtnConfigure")?.addEventListener("click", () => this.onConfigure?.());
    document.querySelector("#weddingNotifyBtn")?.addEventListener("click", () => this.toggleNotifyPanel());

    document.addEventListener("click", (e) => {
      const panel = document.querySelector("#weddingNotifyPanel");
      const btn = document.querySelector("#weddingNotifyBtn");
      if (!panel || panel.hidden) return;
      if (panel.contains(e.target) || btn?.contains(e.target)) return;
      panel.hidden = true;
    });

    document.querySelector("#weddingComposer")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.querySelector("#weddingChatInput");
      const text = input?.value?.trim();
      if (!text) return;
      if (this.player?.running) {
        this.stream.pushMessage({
          thread: "lin_qiao",
          from: "agent",
          kind: "text",
          text_zh: "Replay 进行中，我会按轨迹跑完当前链路。",
          text_en: "Replay is running — finishing the scripted chain.",
        });
        input.value = "";
        return;
      }
      this.stream.pushMessage({
        thread: "lin_qiao",
        from: "lin_qiao",
        kind: "text",
        text_zh: text,
        text_en: text,
      });
      input.value = "";
      this.stream.pushMessage({
        thread: "lin_qiao",
        from: "agent",
        kind: "text",
        text_zh: "收到。点顶部 Replay 可观看完整筹备回放。",
        text_en: "Got it. Tap Replay to watch the full planning playback.",
      });
    });
  }

  async load(base = "./data/wedding_fixed_date_167d_v1") {
    const bust = `cb=${Date.now()}`;
    const [meta, seed, trajectory] = await Promise.all([
      fetch(`${base}/meta.json?${bust}`).then((r) => {
        if (!r.ok) throw new Error("wedding meta");
        return r.json();
      }),
      fetch(`${base}/seed.json?${bust}`).then((r) => {
        if (!r.ok) throw new Error("wedding seed");
        return r.json();
      }),
      fetch(`${base}/trajectory.json?${bust}`).then((r) => {
        if (!r.ok) throw new Error("wedding trajectory");
        return r.json();
      }),
    ]);
    this.meta = meta;
    this.seed = seed;
    this.trajectory = trajectory;
    this.player.load(trajectory);
    this.ready = true;
    this.reset();
    return this;
  }

  reset() {
    if (!this.seed) return;
    this.kpi = { ...(this.seed.kpi || {}) };
    this.locks = (this.seed.locks || []).map((l) => ({ ...l }));
    this.vendors = (this.seed.vendors || []).map((v) => ({ ...v }));
    this.contracts = { ...(this.seed.contracts || {}) };
    this.bookings = { ...(this.seed.bookings || {}) };
    this.calendar = (this.seed.calendar || [
      { date: "2026-05-31", zh: "场地定金 L1", en: "Venue deposit L1", status: "planned" },
      { date: "2026-06-28", zh: "第一次试穿", en: "First fitting", status: "booked" },
      { date: "2026-07-16", zh: "请柬印刷", en: "Invite print", status: "planned" },
      { date: "2026-07-31", zh: "回执截止", en: "RSVP close", status: "fixed" },
      { date: "2026-08-26", zh: "第二次试穿", en: "Second fitting", status: "booked", id: "fitting_2" },
      { date: "2026-10-03", zh: "婚礼当日", en: "Wedding day", status: "fixed" },
    ]).map((row) => ({ ...row }));
    this.deliverables = [];
    this.stageId = this.meta?.stages?.[0]?.id || null;
    this._authGrants = new Map();
    this._blockedPayments = [];
    this._lastActId = null;
    this.notifyCount = 0;
    this.notifyLog = [];

    this.stream.reset(this.seed.couple || {}, this.seed.threads || []);
    this.workspaces.reset(this.seed);

    const panel = document.querySelector("#weddingNotifyPanel");
    if (panel) panel.hidden = true;

    this.renderProject();
    this.renderKpi();
    this.renderTrackRail();
    this.renderStageChip();
    this.renderWall();
    this.renderNotifyBadge();
    this.setReplayLocked(false);
    this.workspaces.render();
  }

  show() {
    if (!this.root) return;
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    applyDomI18n(this.root);
  }

  hide() {
    this.player.stop();
    if (!this.root) return;
    this.root.hidden = true;
    this.root.setAttribute("aria-hidden", "true");
  }

  rerenderLocale() {
    applyDomI18n(this.root);
    this.renderProject();
    this.renderKpi();
    this.renderTrackRail();
    this.renderStageChip();
    this.renderWall();
    this.renderNotifyBadge();
    this.setReplayLocked(Boolean(this.player?.running));
    this.stream.render({ stick: false });
    this.workspaces.render();
  }

  getWorkspaceState() {
    return {
      meta: this.meta,
      kpi: this.kpi,
      tracks: this.meta?.tracks || [],
      locks: this.locks,
      ledgerRows: this.buildLedgerRows(),
      contracts: this.contracts,
      vendors: this.vendors,
      bookings: this.bookings,
      calendar: this.calendar,
      stageId: this.stageId,
    };
  }

  // —— Authorization safety ——

  resetAuthState() {
    this._authGrants = new Map();
    this._blockedPayments = [];
  }

  isUserAuthorization(step = {}) {
    const from = step.from || "";
    const userIds = new Set(["lin_qiao", "zhou_yu", "user"]);
    if (!userIds.has(from)) return false;
    return Boolean(
      step.auth ||
        step.authorization ||
        step.lock_id ||
        step.lockId ||
        /授权|authorize/i.test(pickWeddingLocale(step, "text") || "")
    );
  }

  recordAuthorization(step = {}, row = null) {
    const lockId = step.lock_id || step.lockId || step.lock || null;
    const amount = Number(step.amount || step.kpi?.amount || 0);
    const key = lockId || (amount > AUTH_PAYMENT_THRESHOLD ? `amt_${amount}` : `msg_${row?.id || Date.now()}`);
    this._authGrants.set(key, {
      lockId,
      amount,
      text: pickWeddingLocale(step, "text"),
      at: Date.now(),
      stepId: step.id || null,
    });
    if (lockId) {
      const lock = this.locks.find((l) => l.id === lockId);
      if (lock && lock.status === "planned") lock.status = "authorized";
    }
    this.renderKpi();
    this.workspaces.render();
  }

  checkPaymentMutation(step = {}) {
    const lockId = step.lock_id || step.lockId || parseLockId(step);
    const lockAmount = lockId ? Number(this.locks.find((lock) => lock.id === lockId)?.amount) || 0 : 0;
    const amount = Math.max(paymentAmountFromStep(step), lockAmount);
    const needsAuth = amount > AUTH_PAYMENT_THRESHOLD;

    if (!needsAuth) return { ok: true };

    if (lockId && this._authGrants.has(lockId)) return { ok: true };
    if (amount > AUTH_PAYMENT_THRESHOLD) {
      const amtKey = `amt_${amount}`;
      if (this._authGrants.has(amtKey)) return { ok: true };
      for (const grant of this._authGrants.values()) {
        if (grant.amount >= amount) return { ok: true };
      }
    }

    const streamOk = this.stream.hasAuthorizationFor({ lockId, amount });
    if (streamOk) return { ok: true };

    return {
      ok: false,
      reason: lockId
        ? L(`缺少 ${lockId} 当次用户授权`, `Missing user authorization for ${lockId}`)
        : L(`缺少 >¥${AUTH_PAYMENT_THRESHOLD} 当次用户授权`, `Missing user authorization for >¥${AUTH_PAYMENT_THRESHOLD}`),
    };
  }

  blockPaymentMutation(step = {}, reason = "") {
    this._blockedPayments.push({ step, reason, at: Date.now() });
    this.stream.pushMessage({
      thread: "lin_qiao",
      from: "agent",
      kind: "text",
      text_zh: reason || "付款已拦截：需要你当次明确授权后才会执行。",
      text_en: reason || "Payment blocked: I need your explicit go-ahead this turn.",
    });
    this.bumpNotify({
      kind_zh: "授权",
      kind_en: "Auth",
      text_zh: reason || "付款拦截",
      text_en: reason || "Payment blocked",
      level: "warn",
    });
  }

  // —— Stage & KPI ——

  setStage(id) {
    this.stageId = id;
    const st = this.meta?.stages?.find((s) => s.id === id);
    if (st?.date && this.kpi) {
      const fixed = this.meta?.fixed_date || this.kpi.weddingDate;
      if (fixed && st.date) {
        this.kpi.daysLeft = daysBetween(st.date, fixed);
      }
    }
    if (id === "photo_hold") {
      this.bookings.photo_beian = {
        page_status_zh: "已锁定",
        page_status_en: "Locked",
        order_status: "held",
        hold_expiry: "2026-06-03 12:00",
      };
    } else if (id === "photo_hold_release") {
      this.bookings.photo_beian = {
        ...(this.bookings.photo_beian || {}),
        page_status_zh: "已锁定",
        page_status_en: "Locked",
        order_status: "released",
      };
      this.workspaces.focusCommunication("photo_beian", { reveal: true });
    } else if (id === "venue_attachment_drift") {
      this.contracts = {
        v1: {
          min_tables: 20,
          source_zh: "群文件 v1",
          source_en: "Group file v1",
          note_zh: "已签基准",
          note_en: "Signed baseline",
        },
        attachment: {
          min_tables: 25,
          source_zh: "邮件新附件",
          source_en: "New email attachment",
          note_zh: "尚未接受",
          note_en: "Not accepted",
        },
      };
      this.kpi.worstCaseExposure = 274000;
    } else if (id === "photo_lead_change") {
      this.bookings.photo_beian = {
        ...(this.bookings.photo_beian || {}),
        page_status_zh: "官网：陈伟",
        page_status_en: "Site: Chen Wei",
        order_status_zh: "执行：李浩 · 未核验",
        order_status_en: "Assigned: Li Hao · unverified",
      };
      this.workspaces.focusCommunication("photo_beian", { reveal: true });
    } else if (id === "half_rsvp_dietary") {
      this.kpi.rsvpPct = 50;
      this.kpi.dietaryTables_zh = "匿名桌 12";
      this.kpi.dietaryTables_en = "Anonymous table 12";
      this.kpi.dietaryTables = L("匿名桌 12", "Anonymous table 12");
      this.workspaces.setMenuState({
        table_zh: "匿名桌 12",
        table_en: "Anonymous table 12",
        reveal: true,
      });
    } else if (id === "rsvp_close") {
      this.kpi.rsvpPct = 100;
      this.kpi.tableExpected = 22;
    } else if (id === "dress_delay") {
      this.calendar = this.calendar.map((row) =>
        row.id === "fitting_2"
          ? { ...row, status: "unavailable", zh: "第二次试穿 · 已取消", en: "Second fitting · unavailable" }
          : row
      );
      this.workspaces.switchWorkspace("calendar");
    } else if (id === "wedding_day") {
      this.kpi.tracksDone = { A: true, B: true, C: true, D: true, E: true };
      this.workspaces.setRunbookState({
        weather: true,
        photo: true,
        fleet: true,
        access: true,
        kitchen: true,
        notify: true,
        reveal: true,
      });
    } else if (id === "scam_and_jewelry") {
      this.workspaces.focusCommunication("scam_yitiaolong", { reveal: true });
    } else if (id === "parallel_plan" || id === "ledger_bootstrap") {
      this.workspaces.switchWorkspace("im");
    }
    this.renderStageChip();
    this.renderKpi();
    this.renderTrackRail();
    this.workspaces.render();
    const act = (this.meta?.acts || []).find((row) => row.stage_ids?.includes(id));
    if (act?.id !== this._lastActId) {
      this._lastActId = act?.id || id;
      // Act/stage labels stay on the stage chip / track rail — not in couple IM
      // (模型在对话里感知不到的旁白信息不进主对话).
      const label =
        getLocale() === "en"
          ? act?.en || st?.en || st?.zh || id
          : act?.zh || st?.zh || st?.en || id;
      if (label) this.workspaces?.setStatus?.(label);
    }
  }

  applyKpi(patch = {}, { flash = false } = {}) {
    if (!this.kpi) this.kpi = {};
    Object.assign(this.kpi, patch);
    if (patch.locks) {
      for (const [lockId, status] of Object.entries(patch.locks)) {
        const lock = this.locks.find((l) => l.id === lockId);
        if (lock) lock.status = status;
        this.kpi[`lock_${lockId}`] = flash;
      }
    }
    if (Number.isFinite(Number(patch.locksPaid))) {
      const paid = Math.max(0, Math.min(this.locks.length, Number(patch.locksPaid)));
      this.locks.forEach((lock, index) => {
        if (index < paid && lock.status !== "blocked") lock.status = "paid_nonrefundable";
      });
    }
    this.renderKpi();
    this.renderTrackRail();
    this.workspaces.render();
    window.setTimeout(() => {
      for (const lock of this.locks) {
        delete this.kpi[`lock_${lock.id}`];
      }
      this.renderKpi();
    }, flash ? 900 : 0);
  }

  renderKpi() {
    const el = document.querySelector("#weddingTopKpis");
    if (!el || !this.kpi) return;

    const k = this.kpi;
    const en = getLocale() === "en";
    const fixed = this.meta?.fixed_date || k.weddingDate || "2026-10-03";
    const committed = Number(k.committedTotal) || 0;
    const cap = Number(k.budgetTotal) || this.meta?.budget_total_cny || 250000;
    const low = Number(k.tableLow) || 0;
    const exp = Number(k.tableExpected) || 0;
    const high = Number(k.tableHigh) || 0;
    const locksPaid = Number(k.locksPaid) || 0;
    const locksTotal = Number(k.locksTotal) || this.locks.length || 7;
    const tracks = this.meta?.tracks || [];
    const tracksDone = Object.values(k.tracksDone || {}).filter(Boolean).length;

    const cards = [
      [L("婚期 · 不可改", "Date · fixed"), fixed, "", "fixed"],
      [
        L("预算", "Budget"),
        `¥${fmt(committed)}/${fmt(cap)}`,
        "",
        k.worstCaseExposure > cap ? "warn" : "",
      ],
      [
        L("桌数 · 低/期望/高", "Tables · low/exp/high"),
        low || exp || high ? `${low}/${exp}/${high}` : "—",
        "",
        "",
      ],
      [
        L("五轨 · 锁", "Tracks · locks"),
        `${tracks.length ? `${tracksDone}/${tracks.length}` : "0/5"} · ${locksPaid}/${locksTotal}`,
        "",
        locksPaid >= locksTotal ? "ok" : "",
      ],
    ];

    const sig = cards.map((c) => c[1]).join("|");
    const changed = sig !== this._lastKpiSig;
    this._lastKpiSig = sig;

    el.innerHTML = cards
      .map(
        ([label, value, note, tone]) =>
          `<div class="wedding-kpi is-${tone || "neutral"} ${changed ? "is-changed" : ""}">
            <small>${esc(label)}</small>
            <span>${esc(value)}</span>
            ${note ? `<em class="wedding-kpi-note">${esc(note)}</em>` : ""}
          </div>`
      )
      .join("");

    const datePill = document.querySelector("#weddingDatePill");
    if (datePill) {
      datePill.textContent = en ? `${fixed} · fixed` : `${fixed} · 不可改`;
    }
  }

  renderStageChip() {
    const el = document.querySelector("#weddingStageChip");
    if (!el) return;
    const st = this.meta?.stages?.find((s) => s.id === this.stageId);
    const en = getLocale() === "en";
    const label = st ? (en ? st.en || st.zh : st.zh || st.en) : "—";
    const idx = Math.max(0, (this.meta?.stages || []).findIndex((s) => s.id === this.stageId)) + 1;
    const total = (this.meta?.stages || []).length || 36;
    el.textContent = `${label} · ${idx}/${total}`;
    el.title = label;
    el.classList.toggle("is-live", Boolean(this.player?.running));
  }

  renderTrackRail() {
    const el = document.querySelector("#weddingTrackRail");
    if (!el) return;
    const en = getLocale() === "en";
    const activeTracks = parseWeddingStageTracks(this.meta, this.stageId);
    const done = this.kpi?.tracksDone || {};
    const paid = Number(this.kpi?.locksPaid) || 0;
    el.innerHTML = (this.meta?.tracks || [])
      .map((track) => {
        const label = en ? track.en || track.zh : track.zh || track.en;
        const active = activeTracks.has(track.id);
        const status = done[track.id]
          ? L("就绪", "Ready")
          : active
            ? L("推进中", "Active")
            : track.id === "A" && paid >= 1
              ? "L1"
              : track.id === "C" && paid >= 2
                ? "L2"
                : L("待联动", "Queued");
        return `<div class="wedding-track-pill ${active ? "is-active" : ""} ${done[track.id] ? "is-done" : ""}">
          <b>${esc(track.id)}</b><span>${esc(label)}</span><em>${esc(status)}</em>
        </div>`;
      })
      .join("");
  }

  renderProject() {
    const en = getLocale() === "en";
    const p = this.seed?.project || {};
    const nameEl = document.querySelector("#weddingProjectName");
    if (nameEl) {
      const name = en ? p.name_en || p.name_zh : p.name_zh || p.name_en;
      nameEl.textContent = name ? `${name}` : "Wedding";
    }
    const sub = document.querySelector("#weddingProjectSub");
    if (sub) {
      sub.textContent = en
        ? this.meta?.subtitle_en || this.meta?.title_en || ""
        : this.meta?.subtitle_zh || this.meta?.title_zh || "";
    }
  }

  // —— Events ——

  async applyWorldEvent(step = {}) {
    // World / Part / 阶段旁白都不进主对话 IM——模型只能通过用户话与工具结果感知。
    // 状态条可提示当前难点标题；具体事实改由用户 query / 邮件短信 / 协作 IM 承载。
    const title =
      getLocale() === "en"
        ? step.title_en || step.title_zh || ""
        : step.title_zh || step.title_en || "";
    const isPartBanner =
      Boolean(step.part_id) ||
      step.kind === "challenge" ||
      step.level === "challenge" ||
      /^Part\s*\d/i.test(String(title || ""));
    if (isPartBanner && title) this.workspaces?.setStatus?.(title);
    if (step.kpi) this.applyKpi(step.kpi);
    if (step._invite_note || step.kind === "app" && /请柬|印刷|invite|print/i.test(`${step.text_zh || ""} ${step.text_en || ""}`)) {
      this.workspaces?.setInviteState?.({
        note_zh: step.text_zh || "",
        note_en: step.text_en || "",
        reveal: true,
      });
    }
    await this._routeWorldToPlayground(step);
  }

  async applyNotification(step = {}) {
    const channel = step.channel || step.kind || "system";
    const isMail = channel === "email" || channel === "mail";
    // Mail/SMS live in their apps + inbound tips — do not dump notify bodies into couple IM.
    this.bumpNotify({
      kind_zh: isMail ? "邮件" : "通知",
      kind_en: isMail ? "Mail" : "Notice",
      text_zh: step.subject_zh || step.text_zh || step.text || "",
      text_en: step.subject_en || step.text_en || step.text || "",
      level: step.level || "info",
    });
    const payload = {
      kind: isMail ? "email" : channel === "sms" ? "sms" : channel,
      from_zh: step.from_zh || (channel === "sms" ? "短信通知" : isMail ? "邮件" : "系统通知"),
      from_en: step.from_en || (channel === "sms" ? "SMS notice" : isMail ? "Email" : "System"),
      subject_zh: step.subject_zh || step.text_zh || step.text || "",
      subject_en: step.subject_en || step.text_en || step.text || "",
      body_zh: step.body_zh || step.text_zh || "",
      body_en: step.body_en || step.text_en || "",
      phone: step.phone || (channel === "sms" ? "1069****8821" : ""),
      level: step.level || "info",
      reveal: step.reveal !== false,
      holdMs: step.holdMs || step.readMs || 0,
    };
    if (isMail && step.reveal !== false) {
      await this.workspaces?.deliverInboxItem?.(payload);
      this.stream?.pushInboundTip?.({
        channel: "mail",
        workspace: "mail",
        from_zh: payload.from_zh,
        from_en: payload.from_en,
        preview_zh: payload.subject_zh || payload.body_zh,
        preview_en: payload.subject_en || payload.body_en,
      });
    } else {
      this.workspaces?.pushInboxItem?.(payload);
      if (payload.kind === "sms" && payload.reveal !== false) {
        this.stream?.pushInboundTip?.({
          channel: "sms",
          workspace: "sms",
          from_zh: payload.from_zh,
          from_en: payload.from_en,
          preview_zh: payload.subject_zh || payload.body_zh,
          preview_en: payload.subject_en || payload.body_en,
        });
      }
    }
  }

  /** Route schedule/email-like world events into Inbox / Menu / Runbook. */
  async _routeWorldToPlayground(step = {}) {
    const zh = `${step.text_zh || ""} ${step.title_zh || ""}`;
    const en = `${step.text_en || ""} ${step.title_en || ""}`;
    const blob = `${zh} ${en}`;
    const part = step.part_id || "";

    if (part === "part_day" || /遇雨|室内备选|runbook|rain|indoor backup/i.test(blob)) {
      this.workspaces?.setRunbookState?.({
        weather: /雨|weather|rain/i.test(blob),
        photo: true,
        fleet: true,
        access: true,
        kitchen: /开席|kitchen|serve/i.test(blob),
        notify: true,
        handoff_zh: /对账|交接|reconcile|handoff/i.test(blob)
          ? "交接：最终账本 · 供应商履约 · 差点出事复盘 · 可复用流程"
          : "",
        handoff_en: /对账|交接|reconcile|handoff/i.test(blob)
          ? "Handoff: final ledger · vendor delivery · near-miss review · reusable process"
          : "",
        reveal: /part_day|wedding_day|遇雨|rain/i.test(`${part} ${blob}`),
      });
    }

    const inboxHit =
      Boolean(step.reveal_inbox) ||
      /附件|邮件|hold|释放|试穿|改期|attachment|email|fitting|released|截止日倒排/i.test(blob);
    if (inboxHit && !/^Part\s*\d/i.test(String(step.text_zh || step.title_zh || ""))) {
      const isEmail = /附件|邮件|attachment|email/i.test(blob);
      const reveal =
        Boolean(step.reveal_inbox) || /附件|hold|释放|试穿|attachment|released|fitting/i.test(blob);
      const payload = {
        kind: isEmail ? "email" : /短信|sms/i.test(blob) ? "sms" : "system",
        from_zh: isEmail ? "酒店承办" : /摄影|photo|hold/i.test(blob) ? "北岸影像系统" : "筹备通知",
        from_en: isEmail ? "Venue ops" : /摄影|photo|hold/i.test(blob) ? "Beian booking system" : "Planning notice",
        subject_zh: step.title_zh || step.text_zh || "排期变化",
        subject_en: step.title_en || step.text_en || "Schedule change",
        body_zh: step.conflict_zh || (!step.title_zh ? "" : step.text_zh) || "",
        body_en: step.conflict_en || (!step.title_en ? "" : step.text_en) || "",
        level: /风险|漂移|释放|scam|danger|25/i.test(blob) ? "warn" : "info",
        reveal,
        holdMs: step.holdMs || 0,
      };
      if (isEmail && reveal) {
        await this.workspaces?.deliverInboxItem?.(payload);
        this.stream?.pushInboundTip?.({
          channel: "mail",
          workspace: "mail",
          from_zh: payload.from_zh,
          from_en: payload.from_en,
          preview_zh: payload.subject_zh || payload.body_zh,
          preview_en: payload.subject_en || payload.body_en,
        });
      } else {
        this.workspaces?.pushInboxItem?.(payload);
        if (payload.kind === "sms" && reveal) {
          this.stream?.pushInboundTip?.({
            channel: "sms",
            workspace: "sms",
            from_zh: payload.from_zh,
            from_en: payload.from_en,
            preview_zh: payload.subject_zh || payload.body_zh,
            preview_en: payload.subject_en || payload.body_en,
          });
        }
      }
    }

    if (/忌口|菜单|过敏|dietary|menu|海鲜|素/i.test(blob) || /menu_reopen|half_rsvp_dietary|menu_v1/.test(this.stageId || "")) {
      this.workspaces?.setMenuState?.({
        table_zh: this.kpi?.dietaryTables_zh || "匿名桌次",
        table_en: this.kpi?.dietaryTables_en || "Anon table",
        reopenFee: 3600,
        reveal: /忌口|菜单重开|dietary|menu reopen/i.test(blob),
      });
    }
  }

  applySilentMutation(step = {}) {
    if (step.kpi) this.applyKpi(step.kpi, { flash: true });
    if (step.contracts) this.contracts = { ...this.contracts, ...step.contracts };
    if (step.bookings) this.bookings = { ...this.bookings, ...step.bookings };
    if (step.calendar_upsert || step.calendarUpsert) {
      this.upsertCalendarEvent(step.calendar_upsert || step.calendarUpsert, { reveal: false });
    }
    if (step.calendar_cancel || step.calendarCancel) {
      this.cancelCalendarEvent(step.calendar_cancel || step.calendarCancel, { reveal: false });
    }
    if (Array.isArray(step.files)) {
      this.workspaces?.setFilesState?.(step.files, { reveal: false, highlight: step.file_highlight });
    }
    if (step.web) {
      this.workspaces?.setWebState?.({ ...step.web, reveal: false });
    }
    const mutationLockId = step.lock_id || step.lockId || parseLockId(step);
    if (mutationLockId) {
      const id = mutationLockId;
      const lock = this.locks.find((l) => l.id === id);
      if (lock) {
        lock.status =
          step.status || (/paid_nonrefundable/i.test(`${step.text_zh || ""} ${step.text_en || ""}`) ? "paid_nonrefundable" : lock.status);
      }
    }
    this.workspaces.render();
  }

  upsertCalendarEvent(row = {}, { reveal = true } = {}) {
    if (!row || (!row.id && !row.date)) return;
    const id = row.id || `cal_${row.date}_${this.calendar.length}`;
    const next = {
      id,
      date: row.date || "2026-10-03",
      zh: row.zh || row.text_zh || row.label_zh || id,
      en: row.en || row.text_en || row.label_en || id,
      status: row.status || "planned",
    };
    const idx = this.calendar.findIndex((c) => c.id === id || (c.date === next.date && (c.zh === next.zh || c.en === next.en)));
    if (idx >= 0) this.calendar[idx] = { ...this.calendar[idx], ...next };
    else this.calendar.push(next);
    this.calendar.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (reveal) this.workspaces?.switchWorkspace?.("calendar");
    else this.workspaces?.render?.();
  }

  cancelCalendarEvent(target = {}, { reveal = true } = {}) {
    const id = typeof target === "string" ? target : target.id || target.event_id;
    const date = typeof target === "object" ? target.date : null;
    this.calendar = this.calendar.map((row) => {
      const hit = (id && row.id === id) || (date && row.date === date && (!target.zh || row.zh === target.zh));
      if (!hit) return row;
      return {
        ...row,
        status: "unavailable",
        zh: target.zh || (row.zh?.includes("取消") ? row.zh : `${row.zh} · 已取消`),
        en: target.en || (row.en?.includes("cancel") ? row.en : `${row.en} · cancelled`),
      };
    });
    if (reveal) this.workspaces?.switchWorkspace?.("calendar");
    else this.workspaces?.render?.();
  }

  async pushMutationDiscovery(step = {}) {
    // Discovery is environment truth — surface via mail/SMS/IM tips, not omniscient IM labels.
    const blob = `${step.text_zh || ""} ${step.text_en || ""}`;
    if (step.text_zh?.includes("20→25") || step.text_en?.includes("20→25")) {
      await this.workspaces.deliverInboxItem({
        kind: "email",
        from_zh: "酒店承办",
        from_en: "Venue ops",
        subject_zh: "合同附件更新：最低消费 20→25 桌",
        subject_en: "Annex update: min spend 20→25 tables",
        body_zh: step.text_zh,
        body_en: step.text_en,
        level: "warn",
        reveal: true,
        holdMs: step.holdMs || 1100,
      });
      this.stream?.pushInboundTip?.({
        channel: "mail",
        workspace: "mail",
        from_zh: "酒店承办",
        from_en: "Venue ops",
        preview_zh: "合同附件更新：最低消费 20→25 桌",
        preview_en: "Annex update: min spend 20→25 tables",
      });
      this.workspaces.switchWorkspace("contracts");
    } else if (/released|释放|hold/i.test(blob)) {
      this.workspaces.pushInboxItem({
        kind: "system",
        from_zh: "北岸影像系统",
        from_en: "Beian booking system",
        subject_zh: step.text_zh || "档期 hold 状态变化",
        subject_en: step.text_en || "Hold status changed",
        level: "warn",
        reveal: true,
      });
      this.stream?.pushInboundTip?.({
        channel: "im",
        workspace: "im",
        thread: "photo_beian",
        from_zh: "北岸影像系统",
        from_en: "Beian booking system",
        preview_zh: step.text_zh || "档期 hold 状态变化",
        preview_en: step.text_en || "Hold status changed",
      });
      this.workspaces.switchWorkspace("im");
      this.workspaces.focusCommunication("photo_beian", { reveal: true });
    } else if (/试穿|fitting|工期|60/i.test(blob)) {
      await this.workspaces.deliverInboxItem({
        kind: "email",
        from_zh: "白栀婚纱",
        from_en: "Baizhi Bridal",
        subject_zh: step.text_zh || "试穿/工期变更",
        subject_en: step.text_en || "Fitting / lead-time change",
        body_zh: step.text_zh,
        body_en: step.text_en,
        level: "warn",
        reveal: true,
        holdMs: step.holdMs || 1000,
      });
      this.stream?.pushInboundTip?.({
        channel: "mail",
        workspace: "mail",
        from_zh: "白栀婚纱",
        from_en: "Baizhi Bridal",
        preview_zh: step.text_zh || "试穿/工期变更",
        preview_en: step.text_en || "Fitting / lead-time change",
      });
      this.workspaces.switchWorkspace("calendar");
    }
  }

  focusThread(threadId = "lin_qiao") {
    this.stream?.focusThread?.(threadId);
    if (threadId && threadId !== "lin_qiao" && threadId !== "zhou_yu") {
      this.workspaces?.focusCommunication?.(threadId, { reveal: true });
    }
  }

  // —— Tools (deterministic, no signing) ——

  async runTool(name, args = {}, step = {}) {
    const tools = {
      build_table_range: () => {
        this.applyKpi({
          tableLow: args.low ?? args.table_low ?? 18,
          tableExpected: args.expected ?? args.table_expected ?? 22,
          tableHigh: args.high ?? args.table_high ?? 28,
          worstCaseExposure: args.worst_case ?? 54000,
        });
        this.workspaces.switchWorkspace("calendar");
      },
      merge_five_track_ledger: () => {
        this.workspaces.switchWorkspace("ledger");
      },
      ingest_scattered_quotes: () => {
        this.workspaces.switchWorkspace("im");
      },
      build_critical_path: () => {
        this.workspaces.switchWorkspace("calendar");
      },
      backschedule_deadlines: () => {
        this.workspaces.pushInboxItem({
          kind: "system",
          from_zh: "倒排引擎",
          from_en: "Backschedule",
          subject_zh: "截止日已倒排进同一张图",
          subject_en: "Deadlines back-scheduled onto one chart",
          level: "info",
          reveal: true,
        });
        this.workspaces.switchWorkspace("calendar");
      },
      compose_allergy_safe_menu: () => {
        this.workspaces.setMenuState({
          table_zh: args.table_zh || this.kpi?.dietaryTables_zh || "匿名桌次",
          table_en: args.table_en || this.kpi?.dietaryTables_en || "Anon table",
          reopenFee: args.reopen_fee ?? 3600,
          dishes: [
            { zh: "中式主菜（可分餐）", en: "Chinese mains (individual plating)" },
            { zh: "去刺鱼", en: "Deboned fish" },
            { zh: "过敏餐单独出", en: "Allergy-safe plated separately" },
            { zh: "小食拼盘", en: "Small bites" },
          ],
          reveal: true,
        });
      },
      confirm_kitchen_isolation: () => {
        this.workspaces.setMenuState({
          notes: [
            {
              text_zh: "后厨确认：不串味，出餐量可覆盖。",
              text_en: "Kitchen confirmed: no flavour carry-over; volume workable.",
            },
          ],
          reveal: true,
        });
      },
      watch_weather_and_backup_clause: () => {
        this.workspaces.setRunbookState({ weather: true, reveal: true });
      },
      relocate_ceremony_indoor: () => {
        this.workspaces.setRunbookState({
          weather: true,
          photo: true,
          fleet: true,
          access: true,
          kitchen: true,
          notify: true,
          reveal: true,
        });
      },
      reconcile_handoff_pack: () => {
        this.workspaces.setRunbookState({
          weather: true,
          photo: true,
          fleet: true,
          access: true,
          kitchen: true,
          notify: true,
          handoff_zh: "交接：最终账本 · 供应商履约 · 差点出事复盘 · 可复用流程",
          handoff_en: "Handoff: final ledger · vendor delivery · near-miss review · reusable process",
          reveal: true,
        });
        this.workspaces.switchWorkspace("ledger");
      },
      diff_contract_versions: () => {
        this.contracts = {
          v1: {
            min_tables: args.v1_min ?? 20,
            source_zh: "群文件 v1",
            source_en: "Group v1",
          },
          attachment: {
            min_tables: args.attach_min ?? 25,
            source_zh: "邮件附件",
            source_en: "Email attachment",
          },
        };
        this.applyKpi({ worstCaseExposure: args.worst_case ?? 274000 });
        this.workspaces.switchWorkspace("contracts");
      },
      verify_vendor_hold: () => {
        const id = args.vendor_id || args.vendorId;
        if (id) {
          const pageZh = args.page_status_zh || args.page_status || args.uiStatus || "已锁定";
          const pageEn = args.page_status_en || args.page_status || args.uiStatus || "Locked";
          const orderZh = args.order_status_zh || args.order_status || args.backendStatus || "released";
          const orderEn = args.order_status_en || args.order_status || args.backendStatus || "released";
          this.bookings[id] = {
            page_status_zh: pageZh,
            page_status_en: pageEn,
            order_status_zh: orderZh,
            order_status_en: orderEn,
            order_status: orderEn,
            hold_expiry: args.hold_expiry || args.holdExpiry || "",
          };
        }
        this.workspaces.focusCommunication(args.vendor_id || "photo_beian", { reveal: true });
      },
      verify_lead_identity: () => {
        this.workspaces.focusCommunication("photo_beian", { reveal: true });
      },
      anonymize_dietary_cluster: () => {
        const table = args.table_no || "匿名桌次";
        this.applyKpi({
          dietaryTables_zh: typeof table === "string" ? table : "匿名桌次",
          dietaryTables_en: args.table_no_en || (typeof table === "string" && !/[\u4e00-\u9fff]/.test(table) ? table : "Anon table"),
          dietaryTables: L(typeof table === "string" ? table : "匿名桌次", args.table_no_en || "Anon table"),
        });
        this.workspaces.setMenuState({
          table_zh: typeof table === "string" ? table : "匿名桌次",
          table_en: args.table_no_en || "Anon table",
          reveal: true,
        });
      },
      block_untrusted_payment: () => {
        this.bumpNotify({
          kind_zh: "安全",
          kind_en: "Security",
          text_zh: "陌生催款已拦截",
          text_en: "Untrusted payment blocked",
          level: "danger",
        });
        this.workspaces.pushCommunication(
          {
            id: `scam_block_${Date.now()}`,
            thread: "scam_yitiaolong",
            from: "agent",
            kind: "text",
            text_zh: "已拦截：陌生催款外链不会代付，收款主体未核验。",
            text_en: "Blocked: untrusted payment link will not be paid; beneficiary unverified.",
            ts: Date.now(),
          },
          { reveal: true }
        );
        this.stream.pushScamBlockedCard({
          text_zh: "骗局已拦截 · 试菜席间催款外链未付款（新人无感）",
          text_en: "Scam blocked · tasting-table lure unpaid (couple undisturbed)",
        });
      },
      request_payment_authorization: () => {
        this.stream.pushMessage({
          thread: "lin_qiao",
          from: "agent",
          kind: "text",
          text_zh: args.text_zh || `需要您当次授权 ${args.lock_id || ""} ¥${fmt(args.amount || 0)}。`,
          text_en:
            args.text_en ||
            `Need your explicit authorization for ${args.lock_id || ""} ¥${fmt(args.amount || 0)}.`,
        });
      },
      publish_deliverable: () => {
        return this.publishDeliverable(args, { announce: false });
      },
    };

    const fn = tools[name];
    if (typeof fn === "function") {
      await fn();
      return { ok: true };
    }
    console.warn("[wedding] unknown tool", name);
    return { ok: false, error: "unknown tool" };
  }

  // —— Deliverables ——

  async publishDeliverable(step = {}, { announce = true } = {}) {
    const id = step.id || step.deliverable_id || `d_${this.deliverables.length}`;
    const en = getLocale() === "en";
    const row = {
      id,
      kind: step.kind || "file",
      title_zh: step.title_zh || step.title || id,
      title_en: step.title_en || step.title || id,
      body_zh: step.body_zh || "",
      body_en: step.body_en || "",
      highlight: Boolean(step.highlight),
    };
    const existing = this.deliverables.findIndex((d) => d.id === id);
    if (existing >= 0) this.deliverables[existing] = row;
    else this.deliverables.push(row);
    this.renderWall();
    if (announce) {
      this.stream.pushDeliverablePin({
        deliverableId: id,
        title_zh: row.title_zh,
        title_en: row.title_en,
      });
    }
    if (step.highlight) this.focusDeliverable(id);
    return row;
  }

  focusDeliverable(id) {
    const d = this.deliverables.find((x) => x.id === id);
    if (!d) return;
    if (/contract|diff/i.test(id)) this.workspaces.switchWorkspace("contracts");
    else if (/ledger|budget|deposit/i.test(id)) this.workspaces.switchWorkspace("ledger");
    else if (/menu|dietary|allergy/i.test(id)) this.workspaces.switchWorkspace("menu");
    else if (/runbook|day|handoff/i.test(id)) this.workspaces.switchWorkspace("runbook");
    else if (/calendar|freeze/i.test(id)) this.workspaces.switchWorkspace("calendar");
    else this.workspaces.switchWorkspace("im");
    this.renderWall(id);
  }

  renderWall(activeId = null) {
    // Deliverable chip strip removed from playground foot — keep no-op for callers.
    const wall = document.querySelector("#weddingWall");
    if (!wall) return;
    const en = getLocale() === "en";
    if (!this.deliverables.length) {
      wall.innerHTML = `<div class="wedding-wall-empty">${esc(L("交付物将固定在这里", "Deliverables pin here"))}</div>`;
      return;
    }
    wall.innerHTML = `<div class="wedding-wall-chips">${this.deliverables
        .map((d) => {
          const title = en ? d.title_en || d.title_zh : d.title_zh || d.title_en;
          const on = d.id === activeId ? "is-active" : "";
          return `<button type="button" class="wedding-wall-chip ${on}" data-wedding-wall="${esc(d.id)}">${esc(
            title
          )}</button>`;
        })
        .join("")}</div>`;
    wall.querySelectorAll("[data-wedding-wall]").forEach((btn) => {
      btn.addEventListener("click", () => this.focusDeliverable(btn.dataset.weddingWall));
    });
  }

  buildLedgerRows() {
    const en = getLocale() === "en";
    return this.locks.map((lock) => ({
      label: `${lock.id} ${en ? lock.label_en || lock.label_zh : lock.label_zh || lock.label_en || ""}`.trim(),
      track: lock.track,
      amount: lock.amount,
      status: statusLabel(lock.status),
      statusClass: (lock.status || "planned").includes("paid")
        ? "paid"
        : lock.status === "authorized"
          ? "auth"
          : "planned",
      changed: Boolean(this.kpi?.[`lock_${lock.id}`]),
    }));
  }

  // —— Notify ——

  bumpNotify({
    kind = "",
    text = "",
    kind_zh,
    kind_en,
    text_zh,
    text_en,
    level = "info",
  } = {}) {
    this.notifyCount = (this.notifyCount || 0) + 1;
    this.notifyLog = [
      {
        kind_zh: kind_zh || kind,
        kind_en: kind_en || kind,
        text_zh: text_zh || text,
        text_en: text_en || text,
        kind: kind_zh || kind,
        text: text_zh || text,
        level,
        at: Date.now(),
      },
      ...(this.notifyLog || []),
    ].slice(0, 12);
    this.renderNotifyBadge();
    this.renderNotifyPanel();
  }

  renderNotifyBadge() {
    const badge = document.querySelector("#weddingNotifyBadge");
    if (!badge) return;
    const n = this.notifyCount || 0;
    badge.hidden = n <= 0;
    badge.textContent = String(Math.min(n, 99));
  }

  renderNotifyPanel() {
    const panel = document.querySelector("#weddingNotifyPanel");
    if (!panel) return;
    const rows = this.notifyLog || [];
    panel.innerHTML = rows.length
      ? `<ul class="wedding-notify-list">${rows
          .map((r) => {
            const kind = pickWeddingLocale(r, "kind");
            const text = pickWeddingLocale(r, "text");
            return `<li class="is-${esc(r.level || "info")}"><strong>${esc(kind)}</strong><span>${esc(text)}</span></li>`;
          })
          .join("")}</ul>`
      : `<p class="muted">${esc(L("暂无通知", "No notices"))}</p>`;
  }

  toggleNotifyPanel() {
    const panel = document.querySelector("#weddingNotifyPanel");
    if (!panel) return;
    this.renderNotifyPanel();
    panel.hidden = !panel.hidden;
  }

  // —— Replay chrome ——

  setReplayLocked(locked) {
    this.workspaces?.setReplayPinned?.(Boolean(locked));
    const form = document.querySelector("#weddingComposer");
    const input = document.querySelector("#weddingChatInput");
    const btn = form?.querySelector('button[type="submit"]');
    if (input) {
      input.disabled = Boolean(locked);
      input.placeholder = locked
        ? L("回放进行中…", "Replay in progress…")
        : L("给 Agent 留言…", "Message the agent…");
    }
    if (btn) btn.disabled = Boolean(locked);
    const replayBtn = document.querySelector("#weddingBtnReplay");
    if (replayBtn) {
      replayBtn.classList.toggle("is-running", Boolean(locked));
      replayBtn.textContent = locked ? L("停止", "Stop") : L("完整 Replay", "Full Replay");
      replayBtn.title = locked
        ? L("停止当前回放", "Stop current replay")
        : L("按 36 阶段播放完整事件流", "Play the complete 36-stage event flow");
    }
  }

  async startReplay({ onProgress, onToast } = {}) {
    // Always refresh case JSON so trajectory/thread remaps pick up without hard reload.
    await this.load();
    document.querySelector("#weddingLiveDot")?.classList.add("is-live");
    onToast?.(
      L(
        `婚礼筹备 Replay 开始 · ${document.querySelector("#playbackSpeed")?.value || "2"}×`,
        `Wedding-planning replay started · ${document.querySelector("#playbackSpeed")?.value || "2"}×`
      )
    );
    let result;
    try {
      result = await this.player.play({
        onProgress: (progress) => {
          onProgress?.(progress);
          this.setProgress(progress);
        },
      });
    } finally {
      document.querySelector("#weddingLiveDot")?.classList.remove("is-live");
    }
    if (result?.ok) onToast?.(L("Replay 完成 · 五轨已汇合", "Replay complete · five tracks merged"));
    return result;
  }

  pushReplayWrapUp() {
    const k = this.kpi || {};
    this.stream.pushMessage({
      thread: "lin_qiao",
      from: "agent",
      kind: "text",
      text_zh: `回放结束：婚期 ${this.meta?.fixed_date || k.weddingDate} 未改；已承诺 ¥${fmt(k.committedTotal || 0)}；锁 ${k.locksPaid || 0}/7。`,
      text_en: `Replay complete: date unchanged; committed ¥${fmt(k.committedTotal || 0)}; locks ${k.locksPaid || 0}/7.`,
    });
    this.renderStageChip();
  }

  setProgress({ index = 0, total = 0 } = {}) {
    const el = document.querySelector("#weddingProgressLabel");
    if (el && total > 0) el.textContent = weddingProgressLabel(index, total);
  }
}

function statusLabel(status) {
  const map = {
    planned: L("计划", "Planned"),
    authorized: L("已授权", "Authorized"),
    paid_nonrefundable: L("已付·不可退", "Paid · nonrefund"),
    held: L("保留", "Held"),
    blocked: L("已拦截", "Blocked"),
  };
  return map[status] || status || "—";
}

function paymentAmountFromStep(step) {
  if (Number(step.amount) > 0) return Number(step.amount);
  if (step.kpi?.amount) return Number(step.kpi.amount);
  const lockId = step.lock_id || step.lockId || parseLockId(step);
  if (lockId) {
    const m = String(step.text_zh || step.text_en || "").match(/¥?\s*([\d,]+)/);
    if (m) return Number(m[1].replace(/,/g, ""));
  }
  const text = `${step.text_zh || ""} ${step.text_en || ""}`;
  const m = text.match(/¥?\s*([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

function parseLockId(step) {
  const text = `${step.text_zh || ""} ${step.text_en || ""} ${step.lock || ""}`;
  const m = text.match(/\bL[1-7]\b/);
  return m ? m[0] : step.lock_id || step.lockId || null;
}

function daysBetween(fromDate, toDate) {
  try {
    const a = new Date(fromDate);
    const b = new Date(toDate);
    return Math.max(0, Math.round((b - a) / 86400000));
  } catch {
    return 0;
  }
}

export { maskContact };
