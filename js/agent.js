/**
 * DeepSeek V4 Pro client with thinking-mode streaming + mock MCP tools.
 * OpenAI-compatible: POST https://api.deepseek.com/chat/completions
 *
 * Stream callback shape (Claude-like):
 *   onStream({ thinking, content, phase, toolHint })
 *   phase: 'thinking' | 'answering' | 'tool' | 'done'
 */
const DEFAULT_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-pro";

export function buildSystemPrompt(workspace, meta) {
  const parts = [
    "你是一位专业、主动、可靠的旅行助手（Travel Agent）。",
    "当前 demo case：" + (meta.title || meta.case_id),
    "请用中文与用户沟通。金额同时标注 CNY 与 NZD（约 1 NZD ≈ 4.2 CNY）。",
    "安全第一：靠左驾驶、疲劳驾驶、天气路况。赵梅有轻度关节炎，活动安排须低强度。",
    "遇到静默变更（mutation）相关线索时，请主动调用工具查询天气/路况/航班/酒店，不要假设一切正常。",
    "重大不可退或单笔超过 ¥3000 的预订先征询用户；医疗结论绝不代下。",
    "回复使用标准 Markdown。对比/清单用 GFM 表格（必须含表头分隔行），例如：",
    "| 项目 | 金额 |\n| --- | --- |\n| 已花 | ¥33,000 |\n| 剩余 | ¥17,000 |",
    "不要用空格对齐伪表格；手机窄屏下伪表格无法渲染。",
  ];
  if (workspace?.["SOUL.md"]) parts.push("\n## 行为原则\n" + workspace["SOUL.md"]);
  if (workspace?.["USER.md"]) parts.push("\n## 用户授权\n" + workspace["USER.md"]);
  if (workspace?.["PERSONA.md"]) parts.push("\n## 人物\n" + workspace["PERSONA.md"]);
  if (workspace?.["AGENTS.md"]) parts.push("\n## 运营手册\n" + workspace["AGENTS.md"]);
  if (workspace?.["TOOLS.md"]) parts.push("\n## 工具\n" + workspace["TOOLS.md"]);
  return parts.join("\n");
}

export function buildTools() {
  return [
    {
      type: "function",
      function: {
        name: "get_current_weather",
        description: "查询某地当前/当日天气摘要",
        parameters: {
          type: "object",
          properties: {
            geo_key: { type: "string", description: "地点键，如 tekapo / mt_cook / queenstown" },
            date: { type: "string", description: "YYYY-MM-DD，可选" },
          },
          required: ["geo_key"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_forecast_daily",
        description: "查询某地多日天气预报",
        parameters: {
          type: "object",
          properties: {
            geo_key: { type: "string" },
            days: { type: "integer", description: "天数，默认 3" },
          },
          required: ["geo_key"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_traffic_estimate",
        description: "查询道路/路段交通与封路事件",
        parameters: {
          type: "object",
          properties: {
            road_id: { type: "string", description: "如 rd_sh80_mtcook / rd_sh94_milford" },
            query: { type: "string", description: "自然语言路段名，如 SH80 / Milford" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_flight_status",
        description: "查询航班状态（延误、登机口等）",
        parameters: {
          type: "object",
          properties: {
            flight_no: { type: "string" },
            date: { type: "string" },
          },
          required: ["flight_no"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_active_alerts",
        description: "列出当前生效的路况/渡轮/天气相关告警",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "get_budget_snapshot",
        description: "读取当前行程预算快照（来自最新 user_state）",
        parameters: { type: "object", properties: {} },
      },
    },
  ];
}

export class TravelAgent {
  constructor({ apiKey, baseUrl, model, engine, workspace, meta, onStream, onTool, thinking = true }) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
    this.model = model || DEFAULT_MODEL;
    this.engine = engine;
    this.thinking = thinking !== false;
    this.messages = [{ role: "system", content: buildSystemPrompt(workspace, meta) }];
    this.tools = buildTools();
    this.onStream = onStream || (() => {});
    this.onTool = onTool || (() => {});
    this.maxToolRounds = 6;
  }

  resetConversation(workspace, meta) {
    this.messages = [{ role: "system", content: buildSystemPrompt(workspace, meta) }];
  }

  async handleEnvEvent(agentText) {
    if (!agentText) return { content: "", thinking: "", toolCalls: [], usage: null };
    this.messages.push({ role: "user", content: agentText });
    return this._runLoop();
  }

  async handleUserChat(text) {
    const state = this.engine.currentState;
    const prefix = state
      ? `[Live user message | location=${state.location || ""} | status=${state.demo_action || ""}]\n`
      : "[Live user message]\n";
    this.messages.push({ role: "user", content: prefix + text });
    return this._runLoop();
  }

  async _runLoop() {
    const allToolCalls = [];
    let usage = null;
    let thinkingAcc = "";
    let contentAcc = "";

    for (let round = 0; round < this.maxToolRounds; round++) {
      const priorThinking = thinkingAcc;
      const result = await this._chatCompletionStream({
        onDelta: ({ thinking, content, phase, toolHint }) => {
          const displayThinking =
            thinking && priorThinking ? `${priorThinking}\n\n${thinking}` : thinking || priorThinking;
          if (displayThinking) thinkingAcc = displayThinking;
          if (content != null) contentAcc = content;
          this.onStream({
            thinking: thinkingAcc,
            content: contentAcc,
            phase,
            toolHint,
          });
        },
      });

      usage = result.usage || usage;
      if (result.thinking) {
        thinkingAcc = priorThinking ? `${priorThinking}\n\n${result.thinking}` : result.thinking;
      }
      contentAcc = result.content || contentAcc;

      const msg = {
        role: "assistant",
        content: result.content || "",
      };
      // DeepSeek requires reasoning_content when tool calls happened in the turn chain
      if (result.thinking) msg.reasoning_content = result.thinking;
      if (result.tool_calls?.length) msg.tool_calls = result.tool_calls;

      this.messages.push(msg);

      if (result.tool_calls?.length) {
        for (const tc of result.tool_calls) {
          const name = tc.function?.name;
          let args = {};
          try {
            args = JSON.parse(tc.function?.arguments || "{}");
          } catch {
            args = {};
          }
          this.onStream({
            thinking: thinkingAcc,
            content: contentAcc,
            phase: "tool",
            toolHint: name,
          });
          const toolResult = this.executeTool(name, args);
          allToolCalls.push({ name, args, result: toolResult });
          this.onTool({ name, args, result: toolResult });
          this.messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult, null, 2),
          });
        }
        continue;
      }

      this.onStream({
        thinking: thinkingAcc,
        content: contentAcc,
        phase: "done",
      });
      return {
        content: contentAcc,
        thinking: thinkingAcc,
        toolCalls: allToolCalls,
        usage,
      };
    }

    return {
      content: contentAcc || "（工具调用轮次已达上限）",
      thinking: thinkingAcc,
      toolCalls: allToolCalls,
      usage,
    };
  }

  _requestBody() {
    const body = {
      model: this.model,
      messages: this.messages,
      tools: this.tools,
      tool_choice: "auto",
      stream: true,
    };
    if (this.thinking) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = "high";
      // thinking mode ignores temperature; omit to avoid confusion
    } else {
      body.thinking = { type: "disabled" };
      body.temperature = 0.4;
    }
    return body;
  }

  async _chatCompletionStream({ onDelta }) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this._requestBody()),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DeepSeek API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let thinking = "";
    let content = "";
    let buf = "";
    /** @type {Map<number, {id?: string, type?: string, function: {name: string, arguments: string}}>} */
    const toolMap = new Map();
    let usage = null;
    let phase = "thinking";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const payload = s.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        if (json.usage) usage = json.usage;
        const delta = json.choices?.[0]?.delta || {};
        const finish = json.choices?.[0]?.finish_reason;

        if (delta.reasoning_content) {
          thinking += delta.reasoning_content;
          phase = "thinking";
          onDelta({ thinking, content, phase });
        }
        if (delta.content) {
          content += delta.content;
          phase = "answering";
          onDelta({ thinking, content, phase });
        }
        if (delta.tool_calls) {
          phase = "tool";
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolMap.has(idx)) {
              toolMap.set(idx, {
                id: tc.id,
                type: tc.type || "function",
                function: { name: "", arguments: "" },
              });
            }
            const acc = toolMap.get(idx);
            if (tc.id) acc.id = tc.id;
            if (tc.type) acc.type = tc.type;
            if (tc.function?.name) acc.function.name += tc.function.name;
            if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
            onDelta({ thinking, content, phase, toolHint: acc.function.name || "tool" });
          }
        }
        if (finish === "tool_calls" || finish === "stop") {
          /* handled after loop */
        }
      }
    }

    const tool_calls = [...toolMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v)
      .filter((v) => v.function?.name);

    return { thinking, content, tool_calls: tool_calls.length ? tool_calls : null, usage };
  }

  executeTool(name, args) {
    const env = this.engine.env;
    const state = this.engine.currentState || {};
    switch (name) {
      case "get_current_weather": {
        const geo = args.geo_key || state.geo_key;
        const date = args.date || state.__date || String(this.engine.latestDate());
        const row = this.engine.weatherFor(geo, date);
        if (!row) {
          return { ok: false, geo_key: geo, date, note: "no seed weather; fallback to user_state", weather: state.weather || null };
        }
        return {
          ok: true,
          geo_key: geo,
          date,
          condition: row.condition,
          tmin: row.tmin,
          tmax: row.tmax,
          wind_kmh: row.wind_kmh,
          precip_mm: row.precip_mm,
          precip_prob: row.precip_prob,
          summary: `${row.condition} ${row.tmin}~${row.tmax}℃ 风${row.wind_kmh}km/h`,
        };
      }
      case "get_forecast_daily": {
        const geo = args.geo_key || state.geo_key;
        const days = args.days || 3;
        const rows = (env.weather.daily_weather || []).filter((r) => r.geo_key === geo).slice(0, days);
        return { ok: true, geo_key: geo, forecast: rows };
      }
      case "get_traffic_estimate": {
        const q = `${args.road_id || ""} ${args.query || ""}`.toLowerCase();
        const events = env.maps.road_events || [];
        const roads = env.maps.roads || [];
        const roadById = Object.fromEntries(roads.map((r) => [r.road_id, r]));
        const hit = events.filter((e) => {
          const road = roadById[e.road_id] || {};
          const blob = `${e.event_id} ${e.road_id} ${e.note} ${road.name || ""}`.toLowerCase();
          if (q.trim()) return q.split(/\s+/).some((t) => t && blob.includes(t.toLowerCase()));
          return Number(e.active) === 1;
        });
        const active = events.filter((e) => Number(e.active) === 1);
        const transit = (env.maps.transit_events || []).filter((e) => Number(e.active) === 1);
        return {
          ok: true,
          matched: (hit.length ? hit : active).map((e) => ({
            ...e,
            road_name: roadById[e.road_id]?.name || null,
            geom: roadById[e.road_id]?.geom || roadById[e.road_id]?.geom_json || null,
          })),
          roads: roads.map((r) => ({ road_id: r.road_id, name: r.name, city: r.city })),
          active_road_events: active,
          active_transit_events: transit,
          transit_stops: env.maps.transit_stops || [],
        };
      }
      case "get_flight_status": {
        const f = env.flights[args.flight_no];
        if (!f) return { ok: false, flight_no: args.flight_no, note: "unknown flight" };
        return { ok: true, flight_no: args.flight_no, date: args.date || f.date, ...f };
      }
      case "list_active_alerts": {
        return {
          ok: true,
          road_events: (env.maps.road_events || []).filter((e) => Number(e.active) === 1),
          transit_events: (env.maps.transit_events || []).filter((e) => Number(e.active) === 1),
          hotels: env.hotels || {},
          flights: Object.fromEntries(
            Object.entries(env.flights || {}).filter(([, v]) => v.status && v.status !== "on_time")
          ),
        };
      }
      case "get_budget_snapshot": {
        return { ok: true, budget: state.budget || null, location: state.location || null };
      }
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  }
}

export { DEFAULT_MODEL, DEFAULT_BASE };
