/**
 * Ecom trajectory player — Manus pacing (slower holds + tool visibility).
 */

import { sleepPlayback, setReplayMode } from "../playback.js?v=20260812-smooth";
import { getLocale, L } from "../i18n.js?v=20260812-smooth";

/** Slow factor vs baked holdMs at 1× (still readable; 4×/8× scale via playbackMs). */
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
      const st = c.meta?.stages?.find((s) => s.id === step.stage);
      const stageLabel = st
        ? getLocale() === "en"
          ? st.en || st.zh
          : st.zh || st.en
        : step.stage;
      c.setAgentActivity?.("planning", L("更新计划", "Planning"), { settle: false });
      c.im.showThinking?.(
        stageLabel
          ? L(`重排计划 → ${stageLabel}…`, `Replanning → ${stageLabel}…`)
          : L("重排下一步任务…", "Replanning next moves…"),
        L("按幕边界推进，避免打断你正在做的门店事", "Advance by act boundaries so shop work stays uninterrupted")
      );
      await sleepPlayback(420, { min: 280, max: 640 });
      c.im.hideThinking?.();
      c.setStage(step.stage);
      c.setAgentActivity?.("planning", stageLabel ? L(`进入 · ${stageLabel}`, `Enter · ${stageLabel}`) : L("更新计划", "Planning"));
      return;
    }
    if (type === "focus_thread") {
      const thread = step.thread || "boss";
      c.setAgentActivity?.(
        "communicating",
        thread === "boss" ? L("回到主对话", "Back to main chat") : L("切换协作对象", "Switching contact"),
        { settle: false }
      );
      if (thread !== "boss") {
        const meta = c.seed?.threads?.find((t) => t.id === thread);
        const name =
          getLocale() === "en"
            ? meta?.name_en || meta?.name_zh || thread
            : meta?.name_zh || meta?.name_en || thread;
        c.im.showThinking?.(
          L(`切换对接 → ${name}…`, `Switch contact → ${name}…`),
          L("先对齐沟通对象，再发可执行消息", "Align the contact first, then send an actionable message")
        );
        await sleepPlayback(280, { min: 180, max: 420 });
        c.im.hideThinking?.();
        c.im.focusThread(thread);
        c.benches?.setStatus?.(L(`正在对接 · ${name}`, `Opening chat · ${name}`));
        c.setParallelTrack?.(
          true,
          L(`对接 · ${name} · 门店优先`, `Contact · ${name} · floor first`)
        );
        c._syncComposerHint?.(L(`正在对接 · ${name}`, `Opening chat · ${name}`));
        await sleepPlayback(160, { min: 100, max: 240 });
      } else {
        c.im.focusThread(thread);
        c.setParallelTrack?.(
          true,
          L("回到主对话 · 门店优先", "Back to main chat · floor first")
        );
        c._syncComposerHint?.(L("回到主对话", "Back to main chat"));
      }
      c.setAgentActivity?.(
        "communicating",
        thread === "boss" ? L("回到主对话", "Back to main chat") : L("协调沟通", "Coordinating")
      );
      return;
    }
    if (type === "im_message") {
      const thread = step.thread || "boss";
      const from = step.from || "agent";
      c.setAgentActivity?.("communicating", L("协调沟通", "Coordinating"), { settle: false });
      c.im.focusThread(thread);
      // Compose beat: boss thinking rail, or collaboration IM typing dots.
      if (from === "agent" && !step.html) {
        if (thread === "boss") {
          c.im.showThinking?.(
            L("组织回复…", "Composing reply…"),
            L("先给可执行结论，细节落到工作台/交付物", "Lead with an actionable conclusion; park details on benches / outputs")
          );
          await sleepPlayback(360, { min: 240, max: 560 });
          c.im.hideThinking?.();
        } else {
          c.benches?.showCommsTyping?.(thread);
          await sleepPlayback(420, { min: 280, max: 640 });
          c.benches?.hideCommsTyping?.();
        }
      }
      c.im.pushMessage(step);
      if (thread !== "boss") {
        const meta = c.seed?.threads?.find((t) => t.id === thread);
        const name =
          getLocale() === "en"
            ? meta?.name_en || meta?.name_zh || thread
            : meta?.name_zh || meta?.name_en || thread;
        const agentLine =
          from === "agent"
            ? L(`已回复 · ${name}`, `Replied · ${name}`)
            : L(`收到消息 · ${name}`, `Message in · ${name}`);
        c.setParallelTrack?.(true, agentLine);
        c._syncComposerHint?.(agentLine);
      } else if (from === "agent") {
        c.setParallelTrack?.(true, L("主对话已更新 · 门店优先", "Main chat updated · floor first"));
        c._syncComposerHint?.(L("主对话已更新", "Main chat updated"));
      }
      c.setAgentActivity?.("communicating", L("协调沟通", "Coordinating"));
      return;
    }
    if (type === "switch_bench") {
      const bench = step.bench || "comms";
      const benchLabel =
        {
          comms: L("协作消息", "Comms"),
          phone: L("电话", "Phone"),
          sheet: L("库存定价表", "Inventory sheet"),
          pack: L("包装工作台", "Pack studio"),
          edit: L("剪辑台", "Edit bay"),
        }[bench] || bench;
      c.setAgentActivity?.("planning", L("选择工作台", "Picking workspace"), { settle: false });
      const benchWhy = {
        comms: L("外部协作需要可见进度，不让门店侧失联", "External collab needs a visible thread without losing the floor"),
        phone: L("锁价条款必须口头确认，再写回经营表", "Lock terms need a live call before ledger writeback"),
        sheet: L("账实要对齐，先放大库存/定价表", "Ledger must match reality — magnify the stock/price sheet"),
        pack: L("包装合规决定能不能印刷上架", "Pack compliance decides whether listing can proceed"),
        edit: L("短视频卖点要跟上本周转化节奏", "Short-form pitch must match this week’s conversion beat"),
      }[bench] || L("把当前动作放到最合适的工作台放大", "Magnify the current action on the best-fit bench");
      c.im.showThinking?.(L(`打开 ${benchLabel}…`, `Opening ${benchLabel}…`), benchWhy);
      await sleepPlayback(280, { min: 180, max: 420 });
      c.im.hideThinking?.();
      c.setParallelTrack?.(
        true,
        L(`下一拍放大 · ${benchLabel} · 门店优先`, `Next beat · ${benchLabel} · floor first`)
      );
      c.benches.switchBench(bench);
      c.benches?.setStatus?.(
        L(`无人值守 · ${benchLabel}`, `Hands-free · ${benchLabel}`)
      );
      c.setAgentActivity?.("acting", L(`使用 · ${benchLabel}`, `Using · ${benchLabel}`));
      c._syncComposerHint?.(L(`正在放大 · ${benchLabel}`, `Magnifying · ${benchLabel}`));
      await sleepPlayback(220, { min: 160, max: 360 });
      return;
    }
    if (type === "bench_anim") {
      const label = getLocale() === "en" ? step.label_en || step.label_zh : step.label_zh || step.label_en;
      const bench = step.bench || "pack";
      c.setAgentActivity?.("acting", L("持续执行", "Working"), { settle: false });
      c.im.showThinking?.(
        L("进入无人值守执行模式…", "Entering hands-free execution…"),
        L("连续操作交给我；你只盯门店现场", "I take the continuous ops — you stay with the floor")
      );
      await sleepPlayback(320, { min: 220, max: 480 });
      c.im.hideThinking?.();
      c.im.pushMessage?.({
        thread: "boss",
        from: "agent",
        kind: "text",
        text_zh: `我先在「${bench === "edit" ? "剪辑台" : bench === "pack" ? "包装台" : bench}」把「${label || "当前步骤"}」做完，你继续忙门店就行。`,
        text_en: `I'll finish “${label || "this step"}” on the ${bench} bench — keep running the shop.`,
      });
      const ms = Math.max(6500, Number(step.durationMs) || 7000);
      await c.benches.playAnim(bench, { durationMs: ms, label });
      c.setAgentActivity?.("verified", L("持续执行完成", "Hands-free step done"));
      return;
    }
    if (type === "deliverable") {
      c.setAgentActivity?.("acting", L("整理交付物", "Packaging output"), { settle: false });
      c.im.showThinking?.(
        L("归档到交付物 Dock…", "Pinning to deliverable dock…"),
        L("固定产出，方便你忙完门店后回看", "Pin outputs so you can review after shop work")
      );
      await sleepPlayback(360, { min: 240, max: 520 });
      c.im.hideThinking?.();
      await c.publishDeliverable(step, { announce: false });
      c.setAgentActivity?.("verified", L("交付已生成", "Output ready"));
      return;
    }
    if (type === "kpi_update") {
      c.setAgentActivity?.("acting", L("回写经营指标", "Writing KPIs"), { settle: false });
      c.benches?.switchBench("sheet");
      c.im.showThinking?.(
        L("同步库存 / 定价表…", "Syncing inventory / pricing sheet…"),
        L("账实一致后再开口汇报", "Speak only after ledger and sheet agree")
      );
      await sleepPlayback(420, { min: 280, max: 640 });
      c.applyKpi(step.kpi || {});
      c.im.hideThinking?.();
      c.pushKpiVerified?.(step.kpi || {});
      c.setParallelTrack?.(true, L("账表已对齐 · 继续推进", "Ledger synced · continuing"));
      c.setAgentActivity?.("verified", L("状态已校验", "State verified"));
      await sleepPlayback(320, { min: 220, max: 480 });
      return;
    }
    if (type === "world") {
      // Sense first (monitor/notify), then Agent speaks — same cadence as mutations.
      c.senseWorldEvent?.(step);
      c.setAgentActivity?.("observing", L("捕获外部信号", "External signal"), { settle: false });
      c.setParallelTrack?.(
        true,
        L("外部信号 · 先感知再决定", "External signal · sense first, then decide")
      );
      c._syncComposerHint?.(L("捕获外部信号…", "External signal…"));
      c.im.showThinking?.(
        L("评估影响并准备应对…", "Assessing impact…"),
        L("先感知，再决定是否打断主任务", "Sense first, then decide whether to interrupt the main chain")
      );
      await sleepPlayback(700, { min: 480, max: 1000 });
      c.im.hideThinking?.();
      c.pushWorldReaction?.(step, { sensed: true });
      c.setAgentActivity?.("planning", L("调整应对", "Adjusting response"));
      c._syncComposerHint?.(L("调整应对", "Adjusting response"));
      await sleepPlayback(360, { min: 240, max: 560 });
      return;
    }
    if (type === "mutation") {
      // Silent first: KPI flash + monitor chip, no spoilery "mutation" chat card.
      if (step.kpi) {
        c.applyKpi(step.kpi);
        if (
          step.kpi.stock != null ||
          step.kpi.sold != null ||
          step.kpi.orders != null ||
          step.kpi.refunds != null ||
          step.kpi.profit != null
        ) {
          c.benches?.switchBench("sheet");
        }
      }
      c.applySilentMutation?.(step);
      c.setAgentActivity?.("observing", L("扫描状态回写", "Scanning writebacks"), { settle: false });
      c.setParallelTrack?.(
        true,
        L("静默扫描回写 · 先感知再开口", "Silent writeback scan · sense before speaking")
      );
      c._syncComposerHint?.(L("静默扫描回写…", "Scanning writebacks…"));
      c.im.showThinking?.(
        L("扫描库存 / 订单回写…", "Scanning stock / order writebacks…"),
        L("静默漂移不剧透，核对后再开口", "Silent drift first — speak only after verify")
      );
      await sleepPlayback(820, { min: 560, max: 1200 });
      c.im.hideThinking?.();
      c.pushMutationDiscovery?.(step);
      c.setAgentActivity?.("verified", L("漂移已确认", "Drift confirmed"));
      c._syncComposerHint?.(L("漂移已确认", "Drift confirmed"));
      await sleepPlayback(420, { min: 280, max: 700 });
      return;
    }
    if (type === "notification") {
      c.senseNotification?.(step);
      c.setAgentActivity?.("observing", L("读取新消息", "Reading update"), { settle: false });
      c.setParallelTrack?.(
        true,
        L("消化通知 · 先记下再决定", "Digesting notice · log first, then decide")
      );
      c._syncComposerHint?.(L("消化通知…", "Digesting notice…"));
      c.im.showThinking?.(
        L("消化通知并更新上下文…", "Digesting notice into context…"),
        L("先记入上下文，再决定要不要插入动作", "Log context first, then decide whether to insert an action")
      );
      await sleepPlayback(520, { min: 360, max: 780 });
      c.im.hideThinking?.();
      c.pushNotificationEvent?.(step, { sensed: true });
      c.setAgentActivity?.("verified", L("通知已纳入", "Notice logged"));
      c._syncComposerHint?.(L("通知已纳入", "Notice logged"));
      await sleepPlayback(280, { min: 180, max: 420 });
      return;
    }
    if (type === "tool_call") {
      const toolLabel = String(step.name || "tool").replace(/_/g, " ");
      c.setAgentActivity?.("acting", L("调用工具", "Using tool"), { settle: false });
      c.setParallelTrack?.(
        true,
        L(`工具执行 · ${toolLabel} · 门店优先`, `Tool · ${toolLabel} · floor first`)
      );
      c._syncComposerHint?.(L(`正在调用 · ${toolLabel}`, `Calling · ${toolLabel}`));
      c.im.showThinking?.(
        L("选择工具并准备参数…", "Picking a tool and args…"),
        L("只调用能推进当前幕的可验证工具", "Only call tools that move the current act with evidence")
      );
      await sleepPlayback(480, { min: 320, max: 720 });
      c.im.hideThinking?.();
      const toolId = c.im.pushToolCall?.(step.name, step.args || {}, { status: "running" });
      await sleepPlayback(520, { min: 360, max: 800 });
      c.im.advanceToolCall?.(toolId, 1);
      await sleepPlayback(520, { min: 360, max: 800 });
      c.im.advanceToolCall?.(toolId, 2);
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
      const doneLine = ok
        ? L(`工具写回 · ${toolLabel}`, `Tool recorded · ${toolLabel}`)
        : L(`工具需重试 · ${toolLabel}`, `Tool retry · ${toolLabel}`);
      c.setParallelTrack?.(true, doneLine);
      c._syncComposerHint?.(doneLine);
      c.setAgentActivity?.("verified", ok ? L("结果已写回", "Result recorded") : L("需要重试", "Retry needed"));
      // Next-action lives on the tool card — keep the stream quiet.
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
