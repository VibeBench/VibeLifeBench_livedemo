/**
 * Wedding trajectory player — deterministic replay, no sense-think-act chrome.
 */

import { sleepPlayback, setReplayMode } from "../playback.js?v=20260807-loop21";
import { getLocale, L } from "../i18n.js?v=20260807-wedding-align2";

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
};

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

  _internalMs(type) {
    const p = this.playback || {};
    const scale = Number.isFinite(Number(p.internalScale)) ? Number(p.internalScale) : 0.08;
    const base = DEFAULT_INTERNAL_MS[type] ?? 150;
    return Math.max(16, Math.round(base * scale));
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
        const hold = this._holdMs(step);
        if (hold > 0) await sleepPlayback(hold, { min: 0, max: hold });
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
      c.focusThread?.(step.thread || "lin_qiao");
      await sleepPlayback(this._internalMs("focus_thread"));
      return;
    }

    if (type === "im_message" || type === "user_authorization") {
      const from = step.from || "agent";
      if (type === "user_authorization") {
        c.stream?.pushMessage?.({
          thread: step.thread || "lin_qiao",
          from: "agent",
          kind: "text",
          text_zh: `需当次确认：${step.lock_id || ""} ¥${Number(step.amount || 0).toLocaleString("zh-CN")}，确认后才会执行。`,
          text_en: `Explicit approval required: ${step.lock_id || ""} ¥${Number(step.amount || 0).toLocaleString(
            "en-US"
          )}. Nothing executes before confirmation.`,
        });
        await sleepPlayback(this._internalMs("im_message"));
      }
      if (from === "agent" && !step.html) {
        c.stream?.showThinking?.(L("整理回复…", "Composing…"));
        await sleepPlayback(this._internalMs("im_message"));
        c.stream?.hideThinking?.();
      }
      const row = c.stream?.pushMessage?.(step);
      if (c.isUserAuthorization?.(step)) {
        c.recordAuthorization?.(step, row);
      }
      await sleepPlayback(this._internalMs("im_message"));
      return;
    }

    if (type === "switch_workspace" || type === "switch_bench") {
      const ws = normalizeWorkspace(step.workspace || step.bench || "tracks");
      c.workspaces?.switchWorkspace?.(ws);
      await sleepPlayback(this._internalMs("switch_workspace"));
      return;
    }

    if (type === "world") {
      c.applyWorldEvent?.(step);
      await sleepPlayback(this._internalMs("world"));
      return;
    }

    if (type === "notification" || type === "notify") {
      c.applyNotification?.(step);
      await sleepPlayback(this._internalMs("notification"));
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
      c.pushMutationDiscovery?.(step);
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
      c.stream?.pushTimelineEvent?.({
        kind: "auth",
        text_zh: step.text_zh || pickStepText(step),
        text_en: step.text_en,
      });
      await sleepPlayback(this._internalMs("auth_record"));
      return;
    }

    if (type === "tool_call") {
      await c.runTool?.(step.name, step.args || {}, step);
      await sleepPlayback(this._internalMs("tool_call"));
      return;
    }

    if (type === "bench_anim") {
      const ws = normalizeWorkspace(step.workspace || step.bench || "tracks");
      c.workspaces?.switchWorkspace?.(ws);
      await sleepPlayback(Math.max(this._internalMs("switch_workspace"), Number(step.durationMs) || 180));
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
    vendor_status: "booking",
    vendors: "booking",
    comms: "booking",
    calendar: "calendar",
    runbook: "calendar",
    tracks: "tracks",
    rsvp: "booking",
  };
  return map[id] || id || "tracks";
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
