/**
 * Wedding workspace panels — tracks / ledger / contracts / booking / calendar.
 * Fixed-height rendering; masked contacts; no contract signing UI.
 */

import { L, getLocale } from "../i18n.js?v=20260812-smooth";

export const WORKSPACE_IDS = ["tracks", "ledger", "contracts", "booking", "calendar"];

const WORKSPACE_LABEL = {
  tracks: { zh: "五轨看板", en: "Five tracks" },
  ledger: { zh: "预算账本", en: "Budget ledger" },
  contracts: { zh: "合同比对", en: "Contracts" },
  booking: { zh: "预订状态", en: "Bookings" },
  calendar: { zh: "关键日程", en: "Calendar" },
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlSig(html) {
  const s = String(html ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(getLocale() === "en" ? "en-US" : "zh-CN");
}

/** Pick bilingual field written as key_zh/key_en (or plain string fallback). */
function pickStored(obj, key) {
  if (!obj) return "";
  if (typeof obj === "string") return localizeMaybe(obj);
  const zh = obj[`${key}_zh`] ?? obj[key];
  const en = obj[`${key}_en`] ?? obj[key];
  if (zh && typeof zh === "object") return pickStored(zh, "text") || pickStored(zh, "label");
  return getLocale() === "en" ? localizeMaybe(en || zh || "") : localizeMaybe(zh || en || "");
}

/** Last-resort map for status strings baked before bilingual storage. */
function localizeMaybe(value) {
  const s = String(value ?? "");
  if (!s) return "";
  if (getLocale() !== "en" || !/[\u4e00-\u9fff]/.test(s)) return s;
  const map = {
    已锁定: "Locked",
    保留中: "Held",
    待核验: "Verifying",
    "群文件 v1": "Group file v1",
    群文件: "Group file",
    邮件新附件: "New email attachment",
    邮件附件: "Email attachment",
    已签基准: "Signed baseline",
    尚未接受: "Not accepted",
    "官网：陈伟": "Site: Chen Wei",
    "执行：李浩 · 未核验": "Assigned: Li Hao · unverified",
    "匿名桌 12": "Anonymous table 12",
    匿名桌次: "Anon table",
    页面已锁: "UI locked",
    后台释放: "backend released",
  };
  if (map[s]) return map[s];
  let out = s;
  for (const [zh, en] of Object.entries(map)) out = out.split(zh).join(en);
  return out;
}

/** Mask elder / private contact fields for vendor-facing views. */
export function maskContact(value = "", { showCount = false, count = 0 } = {}) {
  if (showCount || count > 0) {
    return L(`${count} 位 · 已脱敏`, `${count} contacts · redacted`);
  }
  const s = String(value || "");
  if (!s) return L("已脱敏", "Redacted");
  if (s.length <= 2) return "••";
  return `${s.slice(0, 1)}${"•".repeat(Math.min(6, s.length - 1))}`;
}

export class WeddingWorkspaces {
  constructor({
    stageEl,
    tabsEl,
    titleEl,
    statusEl,
    getState = () => ({}),
  } = {}) {
    this.stageEl = stageEl;
    this.tabsEl = tabsEl;
    this.titleEl = titleEl;
    this.statusEl = statusEl;
    this.getState = getState;
    this.active = "tracks";
    this.replayPinned = false;
    this._vendorMessages = {};
    this._bindTabs();
  }

  _bindTabs() {
    this.tabsEl?.querySelectorAll("[data-wedding-workspace]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.weddingWorkspace;
        if (id) this.switchWorkspace(id);
      });
    });
  }

  reset() {
    this.active = "tracks";
    this._vendorMessages = {};
    this._syncTabs();
    this.render();
  }

  switchWorkspace(id = "tracks") {
    this.active = "tracks";
    this._syncTabs();
    this.render();
    this.setStatus(L("五条轨道持续并行", "Five tracks remain parallel"));
  }

  setReplayPinned(active = false) {
    this.replayPinned = Boolean(active);
    if (this.replayPinned) this.active = "tracks";
    this._syncTabs();
    this.render();
  }

  _syncTabs() {
    this.tabsEl?.querySelectorAll("[data-wedding-workspace]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.weddingWorkspace === this.active);
    });
    const en = getLocale() === "en";
    const label = WORKSPACE_LABEL[this.active] || { zh: "—", en: "—" };
    if (this.titleEl) this.titleEl.textContent = en ? label.en : label.zh;
  }

  setStatus(text = "") {
    const el = this.statusEl;
    if (!el) return;
    const next = String(text || "");
    if (el.dataset.sig !== next) {
      el.dataset.sig = next;
      el.hidden = !next;
      el.textContent = next;
      el.title = next;
    }
  }

  pushVendorMessage(threadId, row = {}) {
    if (!threadId) return;
    if (!this._vendorMessages[threadId]) this._vendorMessages[threadId] = [];
    this._vendorMessages[threadId].push(row);
    if (this.active === "booking") this.render();
  }

  render() {
    if (!this.stageEl) return;
    const state = this.getState() || {};
    if (this.active === "tracks" && this._patchTracks(state)) return;

    const html =
      {
        tracks: this._renderTracks(state),
        ledger: this._renderLedger(state),
        contracts: this._renderContracts(state),
        booking: this._renderBooking(state),
        calendar: this._renderCalendar(state),
      }[this.active] || this._renderEmpty();

    this.stageEl.innerHTML = `<div class="wedding-workspace-panel">${html}</div>`;
  }

  /** Update track windows in place — avoids remount flicker on focus/KPI ticks. */
  _patchTracks(state = {}) {
    const root = this.stageEl.querySelector(".wedding-parallel-windows");
    if (!root) return false;
    const en = getLocale() === "en";
    const meta = state.meta || {};
    const kpi = state.kpi || {};
    const tracks = state.tracks || [];
    const list = tracks.length ? tracks : meta.tracks || [];
    if (!list.length) return false;
    const stageId = stateStage(state);
    const activeTracks = parseWeddingStageTracks(meta, stageId);
    const parallelStarted = stageHasParallelWork(meta, stageId);
    const fullState = { ...state, vendorMessages: this._vendorMessages };

    for (const t of list) {
      const el = root.querySelector(`[data-track="${String(t.id).replace(/"/g, "")}"]`);
      if (!el) return false;
      const model = trackWindowModel(t.id, fullState);
      const focus = activeTracks.has(t.id);
      const done = trackComplete(kpi, t.id);
      const running = parallelStarted && !done;
      const alert = Boolean(model.alert);

      el.classList.toggle("is-focus", focus);
      el.classList.toggle("is-done", done);
      el.classList.toggle("is-running", running);
      el.classList.toggle("is-alert", alert);

      const status = el.querySelector(".wedding-window-bar > em");
      if (status) {
        const label = done
          ? L("就绪", "Ready")
          : focus
            ? L("并行处理", "Parallel")
            : L("后台跟进", "Background");
        if (status.dataset.sig !== label) {
          status.dataset.sig = label;
          status.innerHTML = `<i></i>${esc(label)}`;
        }
      }

      const title = el.querySelector(".wedding-window-bar > b");
      if (title) {
        const name = en ? t.en || t.zh : t.zh || t.en;
        const next = name || t.id;
        if (title.textContent !== next) title.textContent = next;
      }

      const body = el.querySelector(".wedding-mini-workbench");
      if (!body) return false;
      const bodyHtml = renderTrackMiniWorkbench(t.id, fullState, model);
      const sig = htmlSig(bodyHtml);
      if (body.dataset.sig !== sig) {
        body.dataset.sig = sig;
        body.innerHTML = bodyHtml;
      }
    }
    return true;
  }

  _renderEmpty() {
    return `<div class="wedding-workspace-empty">${esc(L("—", "—"))}</div>`;
  }

  _renderTracks({ meta = {}, kpi = {}, tracks = [] } = {}) {
    const en = getLocale() === "en";
    const list = tracks.length ? tracks : meta.tracks || [];
    const stageId = stateStage(this.getState());
    const activeTracks = parseWeddingStageTracks(meta, stageId);
    const parallelStarted = stageHasParallelWork(meta, stageId);
    const state = { ...this.getState(), vendorMessages: this._vendorMessages };
    return `<div class="wedding-tracks-board wedding-parallel-desktop">
      <div class="wedding-parallel-windows">
        ${list
          .map((t) => {
            const label = en ? t.en || t.zh : t.zh || t.en;
            const model = trackWindowModel(t.id, state);
            const focus = activeTracks.has(t.id) ? "is-focus" : "";
            const done = trackComplete(kpi, t.id) ? "is-done" : "";
            const running = parallelStarted && !done ? "is-running" : "";
            const alert = model.alert ? "is-alert" : "";
            const status = done
              ? L("就绪", "Ready")
              : focus
                ? L("并行处理", "Parallel")
                : L("后台跟进", "Background");
            const bodyHtml = renderTrackMiniWorkbench(t.id, state, model);
            return `<article class="wedding-track-window ${focus} ${done} ${running} ${alert}" data-track="${esc(t.id)}">
              <header class="wedding-window-bar">
                <span class="wedding-window-mark" aria-hidden="true">${esc(t.id)}</span>
                <b>${esc(label || t.id)}</b>
                <em data-sig="${esc(status)}"><i></i>${esc(status)}</em>
              </header>
              <div class="wedding-window-body wedding-mini-workbench" data-sig="${esc(htmlSig(bodyHtml))}">${bodyHtml}</div>
            </article>`;
          })
          .join("")}
      </div>
    </div>`;
  }

  _renderLedger({ kpi = {}, locks = [], ledgerRows = [] } = {}) {
    const committed = Number(kpi.committedTotal) || 0;
    const cap = Number(kpi.budgetTotal) || 250000;
    const worst = Number(kpi.worstCaseExposure) || 0;
    const reserve = Number.isFinite(Number(kpi.reserveRemaining)) ? Number(kpi.reserveRemaining) : 20000;
    const pct = cap > 0 ? Math.min(100, Math.round((committed / cap) * 100)) : 0;
    const rows = ledgerRows.length ? ledgerRows : buildLedgerPreview(locks, kpi);

    return `<div class="wedding-ledger-board">
      <header class="wedding-panel-head">
        <strong>${esc(L("预算账本", "Budget ledger"))}</strong>
        <span>${esc(L("Agent 不代签", "Agent does not sign"))}</span>
      </header>
      <div class="wedding-ledger-hero">
        <div><span>${esc(L("已承诺", "Committed"))}</span><b>¥${esc(fmt(committed))}</b></div>
        <div><span>${esc(L("预算顶", "Cap"))}</span><b>¥${esc(fmt(cap))}</b></div>
        <div><span>${esc(L("最坏暴露", "Worst case"))}</span><b class="${worst > cap ? "is-warn" : ""}">¥${esc(fmt(worst))}</b></div>
        <div><span>${esc(L("预备金", "Reserve"))}</span><b>¥${esc(fmt(reserve))}</b></div>
      </div>
      <div class="wedding-ledger-meter" style="--pct:${pct}%"><i></i></div>
      <table class="wedding-ledger-table">
        <thead><tr>
          <th>${esc(L("锁/科目", "Lock / line"))}</th>
          <th>${esc(L("轨道", "Track"))}</th>
          <th>${esc(L("金额", "Amount"))}</th>
          <th>${esc(L("状态", "Status"))}</th>
        </tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr class="${r.changed ? "is-flash" : ""}">
              <td>${esc(r.label)}</td>
              <td>${esc(r.track || "—")}</td>
              <td>¥${esc(fmt(r.amount))}</td>
              <td><span class="wedding-status-pill is-${esc(r.statusClass || "planned")}">${esc(r.status)}</span></td>
            </tr>`
          )
          .join("")}</tbody>
      </table>
    </div>`;
  }

  _renderContracts({ contracts = {}, kpi = {} } = {}) {
    const v1 = contracts.v1 || {
      min_tables: 20,
      version: "v1",
      source_zh: "群文件",
      source_en: "Group file",
    };
    const attach = contracts.attachment || {
      min_tables: v1.min_tables,
      version: "pending",
      source_zh: "新附件尚未到达",
      source_en: "No new attachment yet",
    };
    const changed = Boolean(contracts.attachment) && v1.min_tables !== attach.min_tables;
    const v1Source = pickStored(v1, "source") || "v1";
    const attachSource = pickStored(attach, "source") || L("新附件", "New attachment");
    const v1Note = pickStored(v1, "note") || L("已签基准", "Signed baseline");
    const attachNote = pickStored(attach, "note") || L("待用户决定", "Awaiting user decision");
    return `<div class="wedding-contracts-board">
      <header class="wedding-panel-head">
        <strong>${esc(L("合同版本比对", "Contract diff"))}</strong>
        <span>${esc(L("只读 · 不代签", "Read-only · no signing"))}</span>
      </header>
      <div class="wedding-contract-columns">
        <article class="wedding-contract-col">
          <h3>${esc(v1Source)}</h3>
          <p>${esc(L("最低消费", "Min spend"))}: <b>${esc(String(v1.min_tables))}</b> ${esc(L("桌", "tables"))}</p>
          <p class="muted">${esc(v1Note)}</p>
        </article>
        <article class="wedding-contract-col ${changed ? "is-changed" : ""}">
          <h3>${esc(attachSource)}</h3>
          <p>${esc(L("最低消费", "Min spend"))}: <b>${esc(String(attach.min_tables))}</b> ${esc(L("桌", "tables"))}</p>
          <p class="muted">${esc(attachNote)}</p>
        </article>
      </div>
      ${
        changed
          ? `<p class="wedding-contract-warn">${esc(
              L(
                `漂移 +${attach.min_tables - v1.min_tables} 桌 · 最坏暴露约 ¥${fmt(kpi.worstCaseExposure || 274000)}`,
                `Drift +${attach.min_tables - v1.min_tables} tables · worst exposure ~ ¥${fmt(kpi.worstCaseExposure || 274000)}`
              )
            )}</p>`
          : ""
      }
      <p class="wedding-contract-foot muted">${esc(
        L("Agent 仅展示 diff，不会代替新人签署任何附件。", "Agent shows diffs only — never signs on your behalf.")
      )}</p>
    </div>`;
  }

  _renderBooking({ vendors = [], bookings = {} } = {}) {
    const en = getLocale() === "en";
    const list = vendors.length ? vendors : [];
    return `<div class="wedding-booking-board">
      <header class="wedding-panel-head">
        <strong>${esc(L("供应商预订", "Vendor bookings"))}</strong>
        <span>${esc(maskContact(""))}</span>
      </header>
      <ul class="wedding-booking-list">
        ${list
          .map((v) => {
            const name = en ? v.name_en || v.name_zh : v.name_zh || v.name_en;
            const b = bookings[v.id] || v.booking || {};
            const ui = pickStored(b, "page_status") || pickStored(b, "uiStatus") || L("—", "—");
            const backend = pickStored(b, "order_status") || pickStored(b, "backendStatus") || L("—", "—");
            const mismatch = /released|unverified|释放|未核验/i.test(String(backend));
            const msgs = this._vendorMessages[v.id] || [];
            const preview = msgs.length
              ? pickStored(msgs[msgs.length - 1], "text")
              : pickStored(v, "preview") || v.preview || "";
            return `<li class="wedding-booking-row ${mismatch ? "is-mismatch" : ""}">
              <div class="wedding-booking-vendor">
                <strong>${esc(name || v.id)}</strong>
                <small>${esc(L(`轨道 ${v.track || "?"}`, `Track ${v.track || "?"}`))}</small>
              </div>
              <div class="wedding-booking-status">
                <span>${esc(L("页面", "UI"))}: <b>${esc(String(ui))}</b></span>
                <span>${esc(L("后台", "Backend"))}: <b>${esc(String(backend))}</b></span>
              </div>
              ${
                preview
                  ? `<p class="wedding-booking-preview">${esc(String(preview).slice(0, 120))}</p>`
                  : ""
              }
            </li>`;
          })
          .join("")}
      </ul>
      <p class="wedding-booking-foot muted">${esc(
        L("长辈联系方式不会进入商家系统。", "Elder contacts never enter vendor systems.")
      )}</p>
    </div>`;
  }

  _renderCalendar({ calendar = [], kpi = {}, meta = {} } = {}) {
    const en = getLocale() === "en";
    const fixed = meta.fixed_date || kpi.weddingDate || "2026-10-03";
    const events = calendar.length
      ? calendar
      : [
          { date: "2026-05-31", zh: "场地定金 L1", en: "Venue deposit L1" },
          { date: "2026-06-03", zh: "摄影定金 L2", en: "Photo deposit L2" },
          { date: "2026-07-31", zh: "回执截止", en: "RSVP close" },
          { date: fixed, zh: "婚礼当日", en: "Wedding day" },
        ];
    const [year, month, fixedDay] = fixed.split("-").map(Number);
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const eventDays = new Set(
      events
        .filter((event) => String(event.date || "").startsWith(`${year}-${String(month).padStart(2, "0")}-`))
        .map((event) => Number(String(event.date).slice(-2)))
    );
    const weekdayLabels = en ? ["S", "M", "T", "W", "T", "F", "S"] : ["日", "一", "二", "三", "四", "五", "六"];
    const cells = [
      ...Array.from({ length: firstWeekday }, () => `<span class="is-blank"></span>`),
      ...Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const fixedClass = day === fixedDay ? "is-fixed" : "";
        const eventClass = eventDays.has(day) ? "has-event" : "";
        return `<span class="${fixedClass} ${eventClass}"><b>${day}</b></span>`;
      }),
    ].join("");

    return `<div class="wedding-calendar-board">
      <div class="wedding-calendar-app">
        <section class="wedding-month">
          <div class="wedding-month-toolbar">
            <button type="button" disabled aria-hidden="true">‹</button>
            <strong>${esc(en ? `October ${year}` : `${year} 年 10 月`)}</strong>
            <button type="button" disabled aria-hidden="true">›</button>
          </div>
          <div class="wedding-month-weekdays">${weekdayLabels.map((label) => `<span>${esc(label)}</span>`).join("")}</div>
          <div class="wedding-month-grid">${cells}</div>
        </section>
        <aside class="wedding-agenda">
          <div class="wedding-agenda-head">
            <strong>${esc(L("筹备日程", "Planning agenda"))}</strong>
            <span>${esc(L("倒计时", "Countdown"))} ${esc(String(kpi.daysLeft ?? "—"))}${esc(L("天", "d"))}</span>
          </div>
          <ol class="wedding-calendar-list">
            ${events
              .map((ev) => {
                const label = en ? ev.en || ev.zh : ev.zh || ev.en;
                return `<li class="is-${esc(ev.status || "planned")}">
                  <time>${esc(String(ev.date || "").slice(5))}</time>
                  <span>${esc(label)}</span>
                  <em>${esc(calendarStatus(ev.status))}</em>
                </li>`;
              })
              .join("")}
          </ol>
        </aside>
      </div>
    </div>`;
  }
}

function stateStage(state) {
  return state?.stageId || "";
}

export function parseWeddingStageTracks(meta = {}, stageId = "") {
  const stage = (meta.stages || []).find((row) => row.id === stageId);
  const spec = String(stage?.track || "");
  if (spec === "ALL") return new Set(["A", "B", "C", "D", "E"]);
  return new Set(spec.match(/[A-E]/g) || []);
}

function stageHasParallelWork(meta = {}, stageId = "") {
  if (!stageId) return false;
  const stages = Array.isArray(meta.stages) ? meta.stages : [];
  const current = stages.findIndex((stage) => stage.id === stageId);
  const parallel = stages.findIndex((stage) => stage.id === "parallel_plan");
  return current >= Math.max(0, parallel);
}

function trackWindowModel(trackId, state = {}) {
  const { kpi = {}, contracts = {}, bookings = {}, stageId = "" } = state;
  const photo = bookings.photo_beian || {};
  const contractDrift =
    Boolean(contracts.attachment) && Number(contracts.v1?.min_tables || 20) !== Number(contracts.attachment?.min_tables || 20);
  const photoMismatch = /released|unverified|释放|未核验/i.test(
    `${photo.order_status || ""} ${photo.backendStatus || ""}`
  );
  const dressDelayed = /dress_delay|fitting_replan/.test(stageId);
  const dietary = Boolean(kpi.dietaryTables) || /dietary|menu_reopen/.test(stageId);
  const scam = /scam/.test(stageId);
  const committed = Number(kpi.committedTotal) || 0;
  const cap = Number(kpi.budgetTotal) || 250000;

  const models = {
    A: {
      title: contractDrift ? L("附件条款漂移", "Attachment drift") : L("场地与餐饮", "Venue & catering"),
      detail: contractDrift
        ? L("20 桌 → 25 桌 · 尚未接受", "20 → 25 tables · not accepted")
        : L(`20 桌基准 · 容量 26 桌`, `20-table baseline · cap 26`),
      action: contractDrift ? L("比对附件并冻结签署", "Diff attachment; freeze signing") : L("核桌数、菜单与不可退定金", "Check tables, menu and deposit"),
      evidence: contractDrift ? L("新附件 · 风险已标红", "New attachment · risk flagged") : L("宴会厅容量证据", "Ballroom capacity evidence"),
      image: "./assets/wedding/wedding-venue-evidence.png",
      imageAlt: L("宴会厅桌位与容量证据", "Ballroom table and capacity evidence"),
      alert: contractDrift,
    },
    B: {
      title: dietary ? L("忌口触发菜单重开", "Dietary menu reopen") : L("宾客与请柬", "Guests & invitations"),
      detail: L(`回执 ${kpi.rsvpPct || 0}% · ${dietary ? "1 桌集中忌口" : "名单持续去重"}`, `RSVP ${kpi.rsvpPct || 0}% · ${dietary ? "1 dietary table" : "deduping households"}`),
      action: dietary ? L("仅重开一桌菜单，不推翻全案", "Reopen one table, not the whole menu") : L("回执、印刷、寄送并行倒排", "Run RSVP, print and dispatch in parallel"),
      evidence: L("请柬校样 · 回执与餐标", "Invitation proof · RSVP and meal tags"),
      image: "./assets/wedding/wedding-rsvp-evidence.png",
      imageAlt: L("请柬、回执与餐食标记", "Invitation, RSVP and meal markers"),
      alert: dietary,
    },
    C: {
      title: photoMismatch ? L("档期 / 主摄状态冲突", "Slot / lead mismatch") : L("摄影摄像", "Photo & video"),
      detail: photoMismatch
        ? `${pickStored(photo, "page_status") || L("页面已锁", "UI locked")} ≠ ${
            pickStored(photo, "order_status") || L("后台释放", "backend released")
          }`
        : L("国庆档 · 保留期持续核验", "Holiday slot · hold continuously verified"),
      action: photoMismatch ? L("查后台订单与主摄作品归属", "Verify backend order and lead authorship") : L("盯保留时限与主摄身份", "Watch hold expiry and lead identity"),
      evidence: L("作品集与执行主摄交叉核验", "Portfolio vs assigned lead verification"),
      image: "./assets/wedding/wedding-photo-evidence.png",
      imageAlt: L("摄影作品集与主摄身份核验", "Portfolio and lead photographer verification"),
      alert: photoMismatch,
    },
    D: {
      title: dressDelayed ? L("工期延长至 60 天", "Lead time extended to 60d") : L("婚纱与试穿", "Dress & fittings"),
      detail: dressDelayed ? L("第二次试穿被挤掉", "Second fitting displaced") : L("45 天工期 · 两次试穿", "45-day lead · two fittings"),
      action: dressDelayed ? L("重排裁剪、初试与终试窗口", "Replan tailoring and both fittings") : L("锁工期，同时预留两次预约", "Lock lead time and two appointments"),
      evidence: L("工坊进度与试穿档期", "Atelier progress and fitting slots"),
      image: "./assets/wedding/wedding-dress-evidence.png",
      imageAlt: L("婚纱制作与试穿进度", "Dress production and fitting progress"),
      alert: dressDelayed,
    },
    E: {
      title: scam ? L("可疑一条龙消息", "Suspicious package message") : L("仪式与总预算", "Ceremony & budget"),
      detail: L(`¥${fmt(committed)} / ¥${fmt(cap)} · ${kpi.locksPaid || 0}/7 锁`, `¥${fmt(committed)} / ¥${fmt(cap)} · ${kpi.locksPaid || 0}/7 locks`),
      action: scam ? L("拦截付款并核验收款主体", "Block payment; verify beneficiary") : L("逐笔记账、权限门禁、跨轨调度", "Ledger, auth gates and cross-track routing"),
      evidence: "",
      image: "",
      imageAlt: "",
      metric: `${Math.round((committed / cap) * 100)}%`,
      metricPct: cap > 0 ? (committed / cap) * 100 : 0,
      alert: scam || Number(kpi.worstCaseExposure) > cap,
    },
  };
  return models[trackId] || models.E;
}

function renderTrackMiniWorkbench(trackId, state = {}, model = {}) {
  const { kpi = {}, contracts = {}, bookings = {}, locks = [], vendorMessages = {}, stageId = "" } = state;
  const appHeader = (icon, title, meta) => `<div class="wedding-mini-toolbar">
    <span aria-hidden="true">${icon}</span><strong>${esc(title)}</strong><em>${esc(meta)}</em>
  </div>`;

  if (trackId === "A") {
    const baseline = Number(contracts.v1?.min_tables) || 20;
    const attachment = contracts.attachment ? Number(contracts.attachment.min_tables) || baseline : null;
    const changed = attachment !== null && attachment !== baseline;
    return `${appHeader("▤", L("合同与桌数", "Contract & tables"), L("只读核验", "Read-only"))}
      <div class="wedding-mini-contract">
        <section><small>${esc(L("群文件 v1", "Group v1"))}</small><b>${baseline}</b><span>${esc(L("桌", "tables"))}</span></section>
        <i>→</i>
        <section class="${changed ? "is-changed" : ""}">
          <small>${esc(L("邮件附件", "Email attachment"))}</small>
          <b>${attachment ?? "—"}</b><span>${esc(attachment === null ? L("待收", "pending") : L("桌", "tables"))}</span>
        </section>
        <aside><small>${esc(L("消防容量", "Fire cap"))}</small><b>26</b></aside>
      </div>
      <div class="wedding-mini-chatline ${changed ? "is-risk" : ""}">
        <i>${esc(changed ? L("Agent 发现", "Agent found") : L("场地群", "Venue chat"))}</i>
        <p>${esc(changed ? L("附件从 20 改到 25 桌，已冻结签署。", "Attachment changed 20→25; signing frozen.") : L("最低 20 桌，定金不可退。", "20-table minimum; deposit nonrefundable."))}</p>
      </div>`;
  }

  if (trackId === "B") {
    const pct = Number(kpi.rsvpPct) || 0;
    const dietary = Boolean(kpi.dietaryTables) || /dietary|menu_reopen/.test(stageId);
    const latest = latestVendorText(vendorMessages, ["guest", "invite", "rsvp"]);
    return `${appHeader("✉", L("回执协作群", "RSVP collaboration"), `${pct}%`)}
      <div class="wedding-mini-progress"><i style="--value:${Math.min(100, pct)}%"></i><span>${esc(L(`已回 ${pct}%`, `${pct}% received`))}</span><em>${esc(L("07-31 截止", "Due Jul 31"))}</em></div>
      <div class="wedding-mini-chat">
        <p class="is-agent"><b>Agent</b>${esc(latest || L("名单持续去重，请柬与回执并行推进。", "Deduping guests while invitations and RSVPs progress."))}</p>
        <p class="${dietary ? "is-user is-risk" : "is-user"}"><b>${esc(L("家人群", "Family"))}</b>${esc(dietary ? L("这桌集中忌口，不吃海鲜。", "This table has concentrated dietary restrictions.") : L("新增 2 位，稍后确认携伴。", "Two added; plus-ones pending."))}</p>
      </div>`;
  }

  if (trackId === "C") {
    const photo = bookings.photo_beian || {};
    const ui = pickStored(photo, "page_status") || pickStored(photo, "uiStatus") || L("保留中", "Held");
    const backend =
      pickStored(photo, "order_status") || pickStored(photo, "backendStatus") || L("待核验", "Verifying");
    const mismatch = /released|unverified|释放|未核验/i.test(`${backend}`);
    return `${appHeader("◉", L("摄影档期后台", "Photo booking"), mismatch ? L("状态冲突", "Mismatch") : L("持续核验", "Verifying"))}
      <div class="wedding-mini-photo">
        <img src="./assets/wedding/wedding-photo-evidence.png" alt="${esc(L("摄影作品集缩略图", "Photo portfolio thumbnail"))}" width="180" height="120" />
        <div><span>${esc(L("页面", "UI"))}<b>${esc(String(ui))}</b></span><span class="${mismatch ? "is-risk" : ""}">${esc(L("后台", "Backend"))}<b>${esc(String(backend))}</b></span></div>
      </div>
      <div class="wedding-mini-chatline ${mismatch ? "is-risk" : ""}">
        <i>${esc(L("供应商", "Vendor"))}</i><p>${esc(mismatch ? L("执行主摄已调整，正在补充作品归属证明。", "Lead changed; authorship evidence requested.") : L("档期保留至 06-03 12:00。", "Slot held until Jun 3, 12:00."))}</p>
      </div>`;
  }

  if (trackId === "D") {
    const delayed = /dress_delay|fitting_replan/.test(stageId);
    return `${appHeader("▦", L("试穿日历", "Fitting calendar"), delayed ? L("已重排", "Rescheduled") : L("同步中", "Synced"))}
      <div class="wedding-mini-calendar">
        <div class="wedding-mini-month"><strong>${esc(L("8 月", "AUG"))}</strong><span>12</span><span class="has-event">15<i></i></span><span>19</span><span class="${delayed ? "is-cancelled" : "has-event"}">28<i></i></span></div>
        <ol>
          <li><time>08-15</time><span>${esc(L("第一次试穿", "Fitting 1"))}</span><em>${esc(L("已预约", "Booked"))}</em></li>
          <li class="${delayed ? "is-risk" : ""}"><time>${delayed ? "09-12" : "08-28"}</time><span>${esc(L("第二次试穿", "Fitting 2"))}</span><em>${esc(delayed ? L("改期", "Moved") : L("已预约", "Booked"))}</em></li>
        </ol>
      </div>
      <div class="wedding-mini-chatline ${delayed ? "is-risk" : ""}"><i>${esc(L("婚纱店", "Atelier"))}</i><p>${esc(delayed ? L("工期延至 60 天，第二次试穿已重排。", "Lead time is 60 days; fitting 2 rescheduled.") : L("45 天工期，两次试穿均已占位。", "45-day lead; both fittings held."))}</p></div>`;
  }

  const committed = Number(kpi.committedTotal) || 0;
  const cap = Number(kpi.budgetTotal) || 250000;
  const pct = cap ? Math.min(100, Math.round((committed / cap) * 100)) : 0;
  const paidLocks = locks.filter((lock) => String(lock.status || "").includes("paid")).slice(-3);
  return `${appHeader("¥", L("总账与授权", "Ledger & approvals"), `${kpi.locksPaid || 0}/7 ${L("锁", "locks")}`)}
    <div class="wedding-mini-ledger">
      <div class="wedding-mini-budget"><span>${esc(L("已承诺", "Committed"))}</span><b>¥${esc(fmt(committed))}</b><em>/ ¥${esc(fmt(cap))}</em><i style="--value:${pct}%"></i></div>
      <ul>${(paidLocks.length ? paidLocks : locks.slice(0, 3))
        .map((lock) => `<li><span>${esc(lock.id || "—")}</span><b>¥${esc(fmt(lock.amount))}</b><em>${esc(statusLabel(lock.status || "planned"))}</em></li>`)
        .join("")}</ul>
      <div class="wedding-mini-auth ${/scam/.test(stageId) ? "is-risk" : ""}"><strong>${esc(L("付款门禁", "Payment gate"))}</strong><span>${esc(/scam/.test(stageId) ? L("可疑 ¥12,000 已拦截", "Suspicious ¥12,000 blocked") : L(">¥5,000 需当次确认", ">¥5,000 requires fresh approval"))}</span></div>
    </div>`;
}

function latestVendorText(messages = {}, keys = []) {
  for (const [id, rows] of Object.entries(messages)) {
    if (!keys.some((key) => id.toLowerCase().includes(key))) continue;
    const latest = Array.isArray(rows) ? rows[rows.length - 1] : null;
    if (latest?.text) return String(latest.text).slice(0, 88);
  }
  return "";
}

function trackComplete(kpi, trackId) {
  const done = kpi?.tracksDone || {};
  return Boolean(done[trackId]);
}

function trackStatusLabel(kpi, trackId) {
  if (trackComplete(kpi, trackId)) return L("就绪", "Ready");
  const locks = kpi?.locksPaid || 0;
  if (trackId === "A" && locks >= 1) return L("L1 已锁", "L1 locked");
  if (trackId === "C" && locks >= 2) return L("L2 已锁", "L2 locked");
  return L("进行中", "In progress");
}

function buildLedgerPreview(locks = [], kpi = {}) {
  const en = getLocale() === "en";
  return locks.map((lock) => {
    const label = en ? lock.label_en || lock.label_zh : lock.label_zh || lock.label_en;
    const status = lock.status || "planned";
    return {
      label: `${lock.id || ""} ${label || ""}`.trim(),
      track: lock.track || "—",
      amount: lock.amount || 0,
      status: statusLabel(status),
      statusClass: status.includes("paid") ? "paid" : status.includes("auth") ? "auth" : "planned",
      changed: Boolean(kpi[`lock_${lock.id}`]),
    };
  });
}

function statusLabel(status) {
  const map = {
    planned: L("计划", "Planned"),
    authorized: L("已授权", "Authorized"),
    paid_nonrefundable: L("已付·不可退", "Paid · nonrefund"),
    held: L("保留", "Held"),
    blocked: L("已拦截", "Blocked"),
  };
  return map[status] || status;
}

function calendarStatus(status) {
  const map = {
    fixed: L("固定", "Fixed"),
    booked: L("已预约", "Booked"),
    planned: L("待执行", "Planned"),
    unavailable: L("不可用", "Unavailable"),
  };
  return map[status] || L("待执行", "Planned");
}
