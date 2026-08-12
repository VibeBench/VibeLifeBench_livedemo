/**
 * Wedding trajectory player — deterministic replay, no sense-think-act chrome.
 */

import {
  sleepPlayback,
  setReplayMode,
  getPlaybackSpeed,
  playbackMs,
  chatPlaybackMs,
} from "../playback.js?v=20260812-closeout";
import { getLocale, L } from "../i18n.js?v=20260812-closeout";

const DEFAULT_INTERNAL_MS = {
  stage: 100,
  focus_thread: 120,
  im_message: 150,
  world: 350,
  notification: 200,
  notify: 200,
  mutation: 400,
  deliverable: 200,
  kpi_update: 300,
  tool_call: 600,
  switch_workspace: 180,
  switch_bench: 180,
  auth_record: 120,
  calendar_upsert: 220,
  calendar_cancel: 220,
  files_update: 200,
  web_update: 220,
  closeout_init: 180,
  closeout_tick: 220,
  invites_update: 200,
};

const HUMAN_SENDERS = new Set([
  "user",
  "boss",
  "lin_qiao",
  "zhou_yu",
  "bride",
  "groom",
  "human",
]);

/** Per-step hold ceiling after speed scaling (non-chat steps). */
function holdCapMs(speed) {
  const s = Number(speed) || 1;
  if (s >= 8) return 90;
  if (s >= 4) return 160;
  return Number.POSITIVE_INFINITY;
}

function isHumanChatSender(from = "") {
  const id = String(from || "").toLowerCase();
  if (!id || id === "agent" || id === "system" || id === "world") return false;
  if (HUMAN_SENDERS.has(id)) return true;
  // Vendor / family people in Team IM also count as "people messages".
  return !/^(agent|system|notify|world)/i.test(id);
}

function stepTextLen(step = {}) {
  return String(step.text_zh || step.text_en || step.text || step.html || "").replace(/<[^>]+>/g, "").length;
}

export class WeddingScriptPlayer {
  constructor(cockpit) {
    this.cockpit = cockpit;
    this.steps = [];
    this.playback = null;
    this.running = false;
    this._epoch = 0;
  }

  load(trajectory) {
    this.steps = Array.isArray(trajectory?.steps) ? trajectory.steps.slice() : [];
    this.playback = trajectory?.playback || null;
  }

  stop() {
    this._epoch += 1;
    this.running = false;
    setReplayMode(false);
    this.cockpit?.setReplayLocked?.(false);
  }

  _holdMs(step) {
    const p = this.playback || {};
    const scale = Number.isFinite(Number(p.holdScale)) ? Number(p.holdScale) : 1;
    const floor = Number.isFinite(Number(p.holdFloor)) ? Number(p.holdFloor) : 0;
    const raw = Number(step?.holdMs) || 0;
    return Math.max(floor, Math.round(raw * scale));
  }

  /** Wall-clock pause after each step — chat keeps a readable floor even at 8×. */
  _pacedHoldMs(step) {
    const hold = this._holdMs(step);
    const type = step?.type;
    if (type === "im_message" || type === "user_authorization") {
      return this._chatDwellMs(step, hold);
    }
    if (hold <= 0) return 0;
    const speed = getPlaybackSpeed();
    const wait = playbackMs(hold, { min: 0, max: hold });
    return Math.min(wait, holdCapMs(speed));
  }

  /** Readable dwell for couple chat / Team IM bubbles. */
  _chatDwellMs(step = {}, bakedHold = 0) {
    const human = isHumanChatSender(step.from) || step.type === "user_authorization";
    const chars = stepTextLen(step);
    const base = Math.max(Number(bakedHold) || 0, human ? 900 + chars * 18 : 420 + chars * 12);
    return chatPlaybackMs(base, { human, chars });
  }

  _internalMs(type) {
    const p = this.playback || {};
    const scale = Number.isFinite(Number(p.internalScale)) ? Number(p.internalScale) : 0.08;
    const base = DEFAULT_INTERNAL_MS[type] ?? 150;
    // Keep internals readable at 1×, but don't waste budget at 4×/8×.
    const speed = getPlaybackSpeed();
    const floor = speed >= 8 ? 4 : speed >= 4 ? 8 : 16;
    return Math.max(floor, Math.round(base * scale));
  }

  async _sleepChat(step, { compose = false } = {}) {
    const human = isHumanChatSender(step?.from) || step?.type === "user_authorization";
    const chars = stepTextLen(step);
    if (compose) {
      // Short compose beat; still visible at 8×.
      const ms = chatPlaybackMs(human ? 520 : 360, { human: false, chars: Math.min(chars, 40) });
      await new Promise((r) => setTimeout(r, ms));
      return;
    }
    await new Promise((r) => setTimeout(r, this._chatDwellMs(step)));
  }

  async play({ onProgress } = {}) {
    this.stop();
    const epoch = this._epoch;
    this.running = true;
    setReplayMode(true);
    this.cockpit?.setReplayLocked?.(true);
    this.cockpit?.resetAuthState?.();

    const total = this.steps.length;
    try {
      for (let i = 0; i < total; i++) {
        if (epoch !== this._epoch) return { ok: false, aborted: true };
        const step = this.steps[i];
        onProgress?.({ index: i, total, step });
        await this._runStep(step);
        if (epoch !== this._epoch) return { ok: false, aborted: true };
        const wait = this._pacedHoldMs(step);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      this.cockpit?.pushReplayWrapUp?.();
      return { ok: true };
    } finally {
      if (epoch === this._epoch) {
        this.running = false;
        setReplayMode(false);
        this.cockpit?.setReplayLocked?.(false);
      }
    }
  }

  async _runStep(step) {
    const c = this.cockpit;
    const type = step?.type;

    if (type === "stage") {
      c.setStage?.(step.stage);
      await sleepPlayback(this._internalMs("stage"));
      return;
    }

    if (type === "focus_thread") {
      const thread = step.thread || "lin_qiao";
      c.focusThread?.(thread);
      if (thread !== "lin_qiao" && thread !== "zhou_yu") {
        c.workspaces?.focusCommunication?.(thread, { reveal: true });
      }
      await sleepPlayback(this._internalMs("focus_thread"));
      return;
    }

    if (type === "im_message" || type === "user_authorization") {
      const from = step.from || "agent";
      const thread = step.thread || "lin_qiao";
      const external = thread !== "lin_qiao" && thread !== "zhou_yu";
      const human = isHumanChatSender(from) || type === "user_authorization";
      if (type === "user_authorization") {
        c.stream?.pushMessage?.({
          thread: "lin_qiao",
          from: "agent",
          kind: "text",
          text_zh: `需当次确认：${step.lock_id || ""} ¥${Number(step.amount || 0).toLocaleString("zh-CN")}，确认后才会执行。`,
          text_en: `Explicit approval required: ${step.lock_id || ""} ¥${Number(step.amount || 0).toLocaleString(
            "en-US"
          )}. Nothing executes before confirmation.`,
        });
        await this._sleepChat({ from: "agent", text_zh: "需当次确认" }, { compose: true });
      }
      // Keep a short compose beat even at 8× so chat doesn't teleport.
      if (from === "agent" && !step.html) {
        if (external) {
          c.workspaces?.showCommsTyping?.(thread);
          await this._sleepChat(step, { compose: true });
          c.workspaces?.hideCommsTyping?.();
        } else {
          c.stream?.showThinking?.(L("整理回复…", "Composing…"));
          await this._sleepChat(step, { compose: true });
          c.stream?.hideThinking?.();
        }
      } else if (human) {
        // Brief beat before a human line lands — helps at high speed.
        await this._sleepChat(step, { compose: true });
      }
      const row = c.stream?.pushMessage?.(step);
      if (c.isUserAuthorization?.(step)) {
        c.recordAuthorization?.(step, row);
      }
      // On-screen dwell is applied by _pacedHoldMs after the step (readable at 8×).
      return;
    }

    if (type === "switch_workspace" || type === "switch_bench") {
      const ws = normalizeWorkspace(step.workspace || step.bench || "im");
      c.workspaces?.switchWorkspace?.(ws);
      await sleepPlayback(this._internalMs("switch_workspace"));
      return;
    }

    if (type === "world") {
      await c.applyWorldEvent?.(step);
      await sleepPlayback(this._internalMs("world"));
      return;
    }

    if (type === "notification" || type === "notify") {
      await c.applyNotification?.(step);
      // Email reading already paced inside deliverInboxItem; only pad non-mail.
      if (step.channel !== "email" && step.channel !== "mail") {
        await sleepPlayback(this._internalMs("notification"));
      }
      return;
    }

    if (type === "mutation") {
      const gate = c.checkPaymentMutation?.(step);
      if (!gate.ok) {
        c.blockPaymentMutation?.(step, gate.reason);
        await sleepPlayback(this._internalMs("mutation"));
        return;
      }
      c.applySilentMutation?.(step);
      await sleepPlayback(this._internalMs("mutation") * 0.6);
      await c.pushMutationDiscovery?.(step);
      await sleepPlayback(this._internalMs("mutation") * 0.4);
      return;
    }

    if (type === "kpi_update") {
      c.applyKpi?.(step.kpi || {}, { flash: true });
      await sleepPlayback(this._internalMs("kpi_update"));
      return;
    }

    if (type === "deliverable") {
      await c.publishDeliverable?.(step, { announce: true });
      await sleepPlayback(this._internalMs("deliverable"));
      return;
    }

    if (type === "auth_record") {
      c.recordAuthorization?.(step);
      // Authorization already appears as the user message; skip omniscient "授权" labels in IM.
      await sleepPlayback(this._internalMs("auth_record"));
      return;
    }

    if (type === "tool_call") {
      // Tools still run and update workspaces — do not dump thinking/tool cards into couple IM.
      await c.runTool?.(step.name, step.args || {}, step);
      await sleepPlayback(this._internalMs("tool_call"));
      return;
    }

    if (type === "bench_anim") {
      const ws = normalizeWorkspace(step.workspace || step.bench || "im");
      c.workspaces?.switchWorkspace?.(ws);
      await sleepPlayback(Math.max(this._internalMs("switch_workspace"), Number(step.durationMs) || 180));
      return;
    }

    if (type === "calendar_upsert") {
      c.upsertCalendarEvent?.(step.event || step, { reveal: step.reveal !== false });
      await sleepPlayback(this._internalMs("mutation"));
      return;
    }

    if (type === "calendar_cancel") {
      c.cancelCalendarEvent?.(step.event || step, { reveal: step.reveal !== false });
      await sleepPlayback(this._internalMs("mutation"));
      return;
    }

    if (type === "files_update") {
      c.workspaces?.setFilesState?.(step.files || [], {
        reveal: step.reveal !== false,
        highlight: step.highlight || step.file_highlight,
      });
      await sleepPlayback(this._internalMs("switch_workspace"));
      return;
    }

    if (type === "web_update") {
      c.workspaces?.setWebState?.({ ...(step.web || step), reveal: step.reveal !== false });
      await sleepPlayback(this._internalMs("switch_workspace"));
      return;
    }

    if (type === "invites_update") {
      c.workspaces?.setInviteState?.({
        status_zh: step.status_zh,
        status_en: step.status_en,
        note_zh: step.note_zh,
        note_en: step.note_en,
        households: step.households,
        dispatched: step.dispatched,
        reveal: step.reveal !== false,
      });
      if (step.kpi) c.applyKpi?.(step.kpi, { flash: true });
      await sleepPlayback(this._internalMs("switch_workspace"));
      return;
    }

    if (type === "closeout_init") {
      c.workspaces?.setCloseoutState?.({
        items: step.items,
        activeId: null,
        focus_zh: step.focus_zh || "婚礼办完还有繁琐复盘",
        focus_en: step.focus_en || "Closeout still has messy reconciliation",
        focus_detail_zh: step.focus_detail_zh || "合同、主摄、试穿、忌口、尾款要一条条对回来",
        focus_detail_en: step.focus_detail_en || "Contracts, lead photo, fittings, diets and tails must reconcile line by line",
        reveal: step.reveal !== false,
      });
      await sleepPlayback(this._internalMs("switch_workspace"));
      return;
    }

    if (type === "closeout_tick") {
      const id = step.id || step.item || step.item_id;
      c.workspaces?.tickCloseout?.(id, {
        detail_zh: step.detail_zh,
        detail_en: step.detail_en,
        reveal: step.reveal !== false,
      });
      c.announceWorkspaceUpdate?.("closeout", {
        preview_zh: step.preview_zh || step.detail_zh || step.text_zh || "收尾复盘推进一项",
        preview_en: step.preview_en || step.detail_en || step.text_en || "Closeout advanced one check",
      });
      await sleepPlayback(this._internalMs("closeout_tick"));
      return;
    }

    console.warn("[wedding] unknown step type", type, step);
    await sleepPlayback(120);
  }
}

function normalizeWorkspace(id) {
  const map = {
    ledger: "ledger",
    sheet: "ledger",
    contracts: "contracts",
    contract: "contracts",
    booking: "booking",
    vendor_status: "im",
    vendors: "im",
    comms: "im",
    im: "im",
    inbox: "mail",
    mail: "mail",
    email: "mail",
    sms: "sms",
    messages: "sms",
    message: "sms",
    menu: "menu",
    dietary: "menu",
    invites: "invites",
    invite: "invites",
    print: "invites",
    files: "files",
    file: "files",
    docs: "files",
    web: "web",
    webpage: "web",
    browser: "web",
    calendar: "calendar",
    runbook: "runbook",
    closeout: "closeout",
    reconcile: "closeout",
    handoff: "closeout",
    tracks: "im",
    rsvp: "im",
  };
  return map[id] || id || "im";
}

function pickStepText(step) {
  return getLocale() === "en" ? step.text_en || step.text_zh : step.text_zh || step.text_en;
}

export function weddingProgressLabel(index, total) {
  return L(`${Math.min(index + 1, total)} / ${total}`, `${Math.min(index + 1, total)} / ${total}`);
}

export function estimateTrajectoryMs(trajectory) {
  const player = new WeddingScriptPlayer({ setReplayLocked() {}, resetAuthState() {} });
  player.load(trajectory);
  let total = 0;
  for (const step of player.steps) {
    total += player._holdMs(step) + player._internalMs(step.type);
  }
  return total;
}
