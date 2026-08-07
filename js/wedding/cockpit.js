/**
 * Wedding planning cockpit — fixed KPI header, pure dialogue stream, workspace panels.
 */

import { L, getLocale, applyDomI18n } from "../i18n.js?v=20260807-wedding-align2";
import { WeddingStream, AUTH_PAYMENT_THRESHOLD, pickWeddingLocale } from "./stream.js?v=20260807-wedding-real-ui";
import {
  WeddingWorkspaces,
  maskContact,
  parseWeddingStageTracks,
  WORKSPACE_IDS,
} from "./workspaces.js?v=20260807-wedding-mini-workbenches";
import { WeddingScriptPlayer, weddingProgressLabel } from "./script.js?v=20260807-wedding-real-ui";

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
    });

    this.workspaces = new WeddingWorkspaces({
      stageEl: document.querySelector("#weddingWorkspaceStage"),
      tabsEl: document.querySelector("#weddingWorkspaceTabs"),
      titleEl: document.querySelector("#weddingWorkspaceTitle"),
      statusEl: document.querySelector("#weddingWorkspaceStatus"),
      getState: () => this.getWorkspaceState(),
    });

    this.player = new WeddingScriptPlayer(this);

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
    const [meta, seed, trajectory] = await Promise.all([
      fetch(`${base}/meta.json`).then((r) => {
        if (!r.ok) throw new Error("wedding meta");
        return r.json();
      }),
      fetch(`${base}/seed.json`).then((r) => {
        if (!r.ok) throw new Error("wedding seed");
        return r.json();
      }),
      fetch(`${base}/trajectory.json`).then((r) => {
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

    this.stream.reset(this.seed.couple || {});
    this.workspaces.reset();

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
    this.renderProject();
    this.renderKpi();
    this.renderTrackRail();
    this.renderStageChip();
    this.renderWall();
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
    this.stream.pushTimelineEvent({
      kind: "auth",
      text_zh: reason || "付款已拦截：需要林乔当次明确授权。",
      text_en: reason || "Payment blocked: explicit authorization required.",
    });
    this.bumpNotify({
      kind: L("授权", "Auth"),
      text: reason || L("付款拦截", "Payment blocked"),
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
        page_status: L("已锁定", "Locked"),
        order_status: "held",
        hold_expiry: "2026-06-03 12:00",
      };
    } else if (id === "photo_hold_release") {
      this.bookings.photo_beian = {
        ...(this.bookings.photo_beian || {}),
        page_status: L("已锁定", "Locked"),
        order_status: "released",
      };
      this.workspaces.switchWorkspace("booking");
    } else if (id === "venue_attachment_drift") {
      this.contracts = {
        v1: { min_tables: 20, source: L("群文件 v1", "Group file v1"), note: L("已签基准", "Signed baseline") },
        attachment: {
          min_tables: 25,
          source: L("邮件新附件", "New email attachment"),
          note: L("尚未接受", "Not accepted"),
        },
      };
      this.kpi.worstCaseExposure = 274000;
    } else if (id === "photo_lead_change") {
      this.bookings.photo_beian = {
        ...(this.bookings.photo_beian || {}),
        page_status: L("官网：陈伟", "Site: Chen Wei"),
        order_status: L("执行：李浩 · 未核验", "Assigned: Li Hao · unverified"),
      };
      this.workspaces.switchWorkspace("booking");
    } else if (id === "half_rsvp_dietary") {
      this.kpi.rsvpPct = 50;
      this.kpi.dietaryTables = L("匿名桌 12", "Anonymous table 12");
      this.workspaces.switchWorkspace("tracks");
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
      this.workspaces.switchWorkspace("tracks");
    }
    this.renderStageChip();
    this.renderKpi();
    this.renderTrackRail();
    this.workspaces.render();
    const act = (this.meta?.acts || []).find((row) => row.stage_ids?.includes(id));
    if (act?.id !== this._lastActId) {
      this._lastActId = act?.id || id;
      this.stream.pushTimelineEvent({
        kind: "stage",
        text_zh: act?.zh || st?.zh || st?.en || id,
        text_en: act?.en || st?.en || st?.zh || id,
      });
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

  applyWorldEvent(step = {}) {
    this.stream.pushTimelineEvent({
      kind: "world",
      text_zh: step.text_zh,
      text_en: step.text_en,
    });
    if (step.kpi) this.applyKpi(step.kpi);
  }

  applyNotification(step = {}) {
    this.stream.pushTimelineEvent({
      kind: "notify",
      text_zh: step.text_zh,
      text_en: step.text_en,
    });
    this.bumpNotify({
      kind: L("通知", "Notice"),
      text: pickWeddingLocale(step, "text"),
      level: step.level || "info",
    });
  }

  applySilentMutation(step = {}) {
    if (step.kpi) this.applyKpi(step.kpi, { flash: true });
    if (step.contracts) this.contracts = { ...this.contracts, ...step.contracts };
    if (step.bookings) this.bookings = { ...this.bookings, ...step.bookings };
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

  pushMutationDiscovery(step = {}) {
    this.stream.pushTimelineEvent({
      kind: "discovery",
      text_zh: step.text_zh,
      text_en: step.text_en,
    });
    if (step.text_zh?.includes("20→25") || step.text_en?.includes("20→25")) {
      this.workspaces.switchWorkspace("contracts");
    }
    if (/released|释放|hold/i.test(`${step.text_zh} ${step.text_en}`)) {
      this.workspaces.switchWorkspace("booking");
    }
  }

  focusThread(threadId = "lin_qiao") {
    if (threadId && threadId !== "lin_qiao") {
      const vendor = this.vendors.find((v) => v.id === threadId || v.thread === threadId);
      if (vendor) this.workspaces.switchWorkspace("booking");
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
        this.workspaces.switchWorkspace("tracks");
      },
      diff_contract_versions: () => {
        this.contracts = {
          v1: { min_tables: args.v1_min ?? 20, source: L("群文件 v1", "Group v1") },
          attachment: {
            min_tables: args.attach_min ?? 25,
            source: L("邮件附件", "Email attachment"),
          },
        };
        this.applyKpi({ worstCaseExposure: args.worst_case ?? 274000 });
        this.workspaces.switchWorkspace("contracts");
      },
      verify_vendor_hold: () => {
        const id = args.vendor_id || args.vendorId;
        if (id) {
          this.bookings[id] = {
            page_status: args.page_status || args.uiStatus || L("已锁定", "Locked"),
            order_status: args.order_status || args.backendStatus || "released",
            hold_expiry: args.hold_expiry || args.holdExpiry || "",
          };
        }
        this.workspaces.switchWorkspace("booking");
      },
      verify_lead_identity: () => {
        this.workspaces.switchWorkspace("booking");
      },
      anonymize_dietary_cluster: () => {
        this.applyKpi({ dietaryTables: args.table_no || L("匿名桌次", "Anon table") });
        this.workspaces.switchWorkspace("booking");
      },
      block_untrusted_payment: () => {
        this.bumpNotify({
          kind: L("安全", "Security"),
          text: L("陌生催款已拦截", "Untrusted payment blocked"),
          level: "danger",
        });
        this.stream.pushTimelineEvent({
          kind: "discovery",
          text_zh: "陌生「一条龙」催款链接已拦截，未付款。",
          text_en: "Untrusted bundle payment lure blocked — no payment.",
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
    else if (/runbook|calendar|freeze/i.test(id)) this.workspaces.switchWorkspace("calendar");
    else this.workspaces.switchWorkspace("tracks");
    this.renderWall(id);
  }

  renderWall(activeId = null) {
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

  bumpNotify({ kind = "", text = "", level = "info" } = {}) {
    this.notifyCount = (this.notifyCount || 0) + 1;
    this.notifyLog = [{ kind, text, level, at: Date.now() }, ...(this.notifyLog || [])].slice(0, 12);
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
          .map(
            (r) =>
              `<li class="is-${esc(r.level || "info")}"><strong>${esc(r.kind)}</strong><span>${esc(r.text)}</span></li>`
          )
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
    if (!this.ready) await this.load();
    this.reset();
    document.querySelector("#weddingLiveDot")?.classList.add("is-live");
    onToast?.(L("婚礼筹备 Replay 开始", "Wedding-planning replay started"));
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
