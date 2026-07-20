/**
 * Live trajectory recorder — every env event + agent turn is appended.
 * Exportable as JSON for offline analysis.
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
}
