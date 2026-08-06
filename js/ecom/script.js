/**
 * Ecom trajectory player — Manus pacing (slower holds + tool visibility).
 */

import { sleepPlayback, setReplayMode } from "../playback.js?v=20260807-editor";
import { getLocale, L } from "../i18n.js?v=20260807-editor";

/** Slow factor vs baked holdMs (user asked not too fast). */
const HOLD_SCALE = 2.2;
const HOLD_FLOOR = 700;

export class EcomScriptPlayer {
  constructor(cockpit) {
    this.cockpit = cockpit;
    this.steps = [];
    this.running = false;
    this._epoch = 0;
  }

  load(trajectory) {
    this.steps = Array.isArray(trajectory?.steps) ? trajectory.steps.slice() : [];
  }

  stop() {
    this._epoch += 1;
    this.running = false;
    setReplayMode(false);
  }

  async play({ onProgress } = {}) {
    this.stop();
    const epoch = this._epoch;
    this.running = true;
    setReplayMode(true);
    const total = this.steps.length;
    try {
      for (let i = 0; i < total; i++) {
        if (epoch !== this._epoch) return { ok: false, aborted: true };
        onProgress?.({ index: i, total, step: this.steps[i] });
        await this._runStep(this.steps[i]);
        if (epoch !== this._epoch) return { ok: false, aborted: true };
        const raw = Number(this.steps[i].holdMs) || 0;
        const hold = Math.max(HOLD_FLOOR, Math.round(raw * HOLD_SCALE));
        if (hold > 0) await sleepPlayback(hold, { min: HOLD_FLOOR, max: Math.max(hold, HOLD_FLOOR) });
      }
      return { ok: true };
    } finally {
      if (epoch === this._epoch) {
        this.running = false;
        setReplayMode(false);
      }
    }
  }

  async _runStep(step) {
    const c = this.cockpit;
    const type = step?.type;
    if (type === "stage") {
      c.setAgentActivity?.("planning", L("更新计划", "Planning"));
      c.setStage(step.stage);
      return;
    }
    if (type === "focus_thread") {
      c.im.focusThread(step.thread);
      return;
    }
    if (type === "im_message") {
      c.setAgentActivity?.("communicating", L("协调沟通", "Coordinating"));
      c.im.focusThread(step.thread);
      c.im.pushMessage(step);
      return;
    }
    if (type === "switch_bench") {
      c.setAgentActivity?.("acting", L("切换工具", "Opening tool"));
      c.benches.switchBench(step.bench);
      return;
    }
    if (type === "bench_anim") {
      c.setAgentActivity?.("acting", L("持续执行", "Working"));
      const label = getLocale() === "en" ? step.label_en || step.label_zh : step.label_zh || step.label_en;
      const ms = Math.max(6500, Number(step.durationMs) || 7000);
      await c.benches.playAnim(step.bench, { durationMs: ms, label });
      return;
    }
    if (type === "deliverable") {
      c.setAgentActivity?.("verified", L("交付已生成", "Output ready"));
      await c.publishDeliverable(step, { announce: false });
      return;
    }
    if (type === "kpi_update") {
      c.setAgentActivity?.("verified", L("状态已校验", "State verified"));
      c.applyKpi(step.kpi || {});
      return;
    }
    if (type === "world") {
      c.setAgentActivity?.("observing", L("捕获变化", "Change detected"));
      c.pushWorldEvent?.(step);
      return;
    }
    if (type === "mutation") {
      c.setAgentActivity?.("observing", L("检测状态漂移", "State drift detected"));
      if (step.kpi) c.applyKpi(step.kpi);
      c.pushMutationEvent?.(step);
      return;
    }
    if (type === "notification") {
      c.setAgentActivity?.("observing", L("读取新消息", "Reading update"));
      c.pushNotificationEvent?.(step);
      return;
    }
    if (type === "tool_call") {
      c.setAgentActivity?.("acting", L("调用工具", "Using tool"), { settle: false });
      const toolId = c.im.pushToolCall?.(step.name, step.args || {}, { status: "running" });
      await sleepPlayback(900, { min: 700, max: 1400 });
      const fn = c.tools?.[step.name];
      let ok = true;
      let detail = "";
      try {
        if (typeof fn === "function") {
          const res = await fn(step.args || {});
          detail = summarizeTool(step.name, step.args, res);
        } else {
          ok = false;
          detail = `unknown tool: ${step.name}`;
          console.warn("[ecom] unknown tool", step.name);
        }
      } catch (e) {
        ok = false;
        detail = String(e?.message || e);
      }
      c.im.finishToolCall?.(toolId, { ok, detail });
      c.setAgentActivity?.("verified", ok ? L("结果已写回", "Result recorded") : L("需要重试", "Retry needed"));
      await sleepPlayback(600, { min: 400, max: 1000 });
      return;
    }
    console.warn("[ecom] unknown step", type);
  }
}

function summarizeTool(name, args = {}, res = {}) {
  if (name === "call_supplier") {
    return `${args.supplier_id || "?"} · ¥${args.agreed_price ?? "—"}`;
  }
  if (name === "update_inventory_pricing") {
    return `price ¥${args.unit_price ?? "—"} · cost ¥${args.unit_cost ?? "—"} · stock ${args.stock ?? "—"}`;
  }
  if (name === "publish_deliverable") {
    return args.id || args.kind || "deliverable";
  }
  try {
    return JSON.stringify(res || args).slice(0, 120);
  } catch {
    return name;
  }
}

export function ecomProgressLabel(index, total) {
  return L(`${Math.min(index + 1, total)} / ${total}`, `${Math.min(index + 1, total)} / ${total}`);
}
