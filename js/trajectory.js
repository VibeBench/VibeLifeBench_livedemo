/**
 * Live trajectory recorder — every env event + agent turn is appended.
 * Exportable as JSON for offline analysis / fast replay.
 */
export class Trajectory {
  constructor(caseId) {
    this.caseId = caseId;
    this.startedAt = new Date().toISOString();
    this.steps = [];
    this.meta = { model: null, schema_version: 1 };
  }

  setModel(model) {
    this.meta.model = model;
  }

  pushEnvEvent(ev, extra = {}) {
    this.steps.push({
      type: "env_event",
      ts: new Date().toISOString(),
      event_id: ev.id,
      stage: ev.stage,
      kind: ev.kind,
      time: ev.time,
      from: ev.from || null,
      body: ev.body || "",
      user_state: ev.user_state || null,
      ...extra,
    });
  }

  pushAgentTurn({ eventId, input, output, thinking, toolCalls, usage }) {
    this.steps.push({
      type: "agent_turn",
      ts: new Date().toISOString(),
      event_id: eventId || null,
      input,
      output,
      thinking: thinking || "",
      tool_calls: toolCalls || [],
      usage: usage || null,
    });
  }

  pushUserChat({ text, from }) {
    this.steps.push({
      type: "user_chat",
      ts: new Date().toISOString(),
      from: from || "live_user",
      text,
    });
  }

  pushNote(text) {
    this.steps.push({ type: "note", ts: new Date().toISOString(), text });
  }

  toJSON() {
    return {
      case_id: this.caseId,
      started_at: this.startedAt,
      finished_at: new Date().toISOString(),
      meta: this.meta,
      steps: this.steps,
      stats: {
        env_events: this.steps.filter((s) => s.type === "env_event").length,
        agent_turns: this.steps.filter((s) => s.type === "agent_turn").length,
        user_chats: this.steps.filter((s) => s.type === "user_chat").length,
      },
    };
  }

  download(filename) {
    const blob = new Blob([JSON.stringify(this.toJSON(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `trajectory_${this.caseId}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Rebuild from exported / baked JSON (mutates this instance). */
  static fromJSON(raw) {
    if (!isValidRecording(raw)) {
      throw new Error("Invalid trajectory: need case_id and steps with at least one agent_turn");
    }
    const t = new Trajectory(raw.case_id);
    t.startedAt = raw.started_at || t.startedAt;
    t.meta = { ...(raw.meta || {}), schema_version: raw.meta?.schema_version || 1 };
    t.steps = Array.isArray(raw.steps) ? raw.steps.slice() : [];
    return t;
  }
}

/** True when a recording can drive加速回放 (case + ≥1 agent turn). */
export function isValidRecording(raw, expectedCaseId = null) {
  if (!raw || typeof raw !== "object") return false;
  if (!raw.case_id || !Array.isArray(raw.steps) || !raw.steps.length) return false;
  if (expectedCaseId != null && raw.case_id !== expectedCaseId) return false;
  return raw.steps.some((s) => s && s.type === "agent_turn");
}
