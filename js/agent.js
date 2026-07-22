/**
 * OpenAI-compatible chat client (DeepSeek / OpenAI / OpenRouter / Ollama / …)
 * with optional thinking/reasoning streaming + mock MCP tools.
 *
 * Stream callback shape (Claude-like):
 *   onStream({ thinking, content, phase, toolHint })
 *   phase: 'thinking' | 'answering' | 'tool' | 'done'
 */
const DEFAULT_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_PROVIDER = "deepseek";

/** Normalize base so `${base}/chat/completions` resolves correctly. */
export function normalizeBaseUrl(base, provider = "") {
  let u = String(base || DEFAULT_BASE).trim().replace(/\/+$/, "");
  if (!u) u = DEFAULT_BASE;
  u = u.replace(/\/chat\/completions\/?$/i, "");
  if (/\/v\d+$/i.test(u) || /\/api\/v\d+$/i.test(u)) return u;

  if (/deepseek\.com$/i.test(u) || provider === "deepseek" || provider === "proxy" || provider === "custom") {
    // deepseek root OK; proxy/custom leave untouched
    if (/deepseek\.com$/i.test(u) || provider === "deepseek") return u;
  }
  if (/openrouter\.ai$/i.test(u) || provider === "openrouter") {
    if (/openrouter\.ai$/i.test(u)) return `${u}/api/v1`;
    if (/openrouter\.ai\/api$/i.test(u)) return `${u}/v1`;
  }
  if (/openai\.com$/i.test(u) || provider === "openai") return /openai\.com$/i.test(u) ? `${u}/v1` : u;
  if (/siliconflow\.cn$/i.test(u) || provider === "siliconflow") {
    return /siliconflow\.cn$/i.test(u) ? `${u}/v1` : u;
  }
  if (/:11434$/i.test(u) || provider === "ollama") return /\/v\d+$/i.test(u) ? u : `${u}/v1`;
  return u;
}

export function detectProvider(baseUrl = "") {
  const u = String(baseUrl).toLowerCase();
  if (/127\.0\.0\.1:8787|localhost:8787/.test(u)) return "proxy";
  if (/deepseek/.test(u)) return "deepseek";
  if (/openai\.com/.test(u)) return "openai";
  if (/openrouter\.ai/.test(u)) return "openrouter";
  if (/siliconflow/.test(u)) return "siliconflow";
  if (/11434|:11434|ollama/.test(u)) return "ollama";
  return "custom";
}

export function buildSystemPrompt(workspace, meta) {
  const parts = [
    "你是一位专业、主动、可靠的旅行助手（Travel Agent）。",
    "当前 demo case：" + (meta.title || meta.case_id),
    "请用中文与用户沟通。金额同时标注 CNY 与 NZD（约 1 NZD ≈ 4.2 CNY）。",
    "安全第一：靠左驾驶、疲劳驾驶、天气路况。赵梅有轻度关节炎，活动安排须低强度。",
    "遇到静默变更（mutation）相关线索时，请主动调用工具查询天气/路况/航班，不要假设一切正常。",
    "需要外部资讯时用 search_web；确认的行程要点可 write_journal / add_calendar_event 写入游记与日程。",
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
    {
      type: "function",
      function: {
        name: "search_web",
        description: "搜索行程相关资讯（路况公告、景点、签证、营地评价等），返回摘要结果",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索词，如 SH80 落石 / Tekapo 营地评价" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_journal",
        description: "把要点写入游记 / Notion 笔记（演示写入）",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "小节标题或章节名" },
            content: { type: "string", description: "要写入的正文要点" },
            section: { type: "string", description: "journal / safety / expense，默认 journal" },
          },
          required: ["content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_calendar_event",
        description: "把行程节点加入日程（演示写入）",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "日程标题" },
            date: { type: "string", description: "YYYY-MM-DD" },
            note: { type: "string", description: "补充说明" },
          },
          required: ["title"],
        },
      },
    },
  ];
}

export class TravelAgent {
  constructor({
    apiKey,
    baseUrl,
    model,
    provider,
    engine,
    workspace,
    meta,
    onStream,
    onTool,
    thinking = true,
  }) {
    this.apiKey = apiKey;
    this.provider = provider || detectProvider(baseUrl) || DEFAULT_PROVIDER;
    this.baseUrl = normalizeBaseUrl(baseUrl || DEFAULT_BASE, this.provider);
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
    const p = this.provider || detectProvider(this.baseUrl);

    if (this.thinking) {
      if (p === "deepseek" || (p === "proxy" && /deepseek/i.test(this.model))) {
        // DeepSeek V3/V4 thinking
        body.thinking = { type: "enabled" };
        body.reasoning_effort = "high";
      } else if (p === "openai" || /^(o[1-9]|gpt-5)/i.test(this.model)) {
        body.reasoning_effort = "high";
      } else if (p === "openrouter") {
        // Many OR reasoning models expose reasoning tokens when asked
        body.include_reasoning = true;
      } else {
        body.temperature = 0.4;
      }
    } else {
      if (p === "deepseek") body.thinking = { type: "disabled" };
      body.temperature = 0.4;
    }
    return body;
  }

  _requestHeaders() {
    const headers = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const p = this.provider || detectProvider(this.baseUrl);
    // Local CORS proxy: tell it where to forward (any OpenAI-compatible upstream)
    if (p === "proxy" || /127\.0\.0\.1:8787|localhost:8787/.test(this.baseUrl)) {
      const upstream = this._proxyUpstreamTarget();
      if (upstream) headers["X-Upstream-Base"] = upstream;
    }
    if (p === "openrouter" || /openrouter\.ai/.test(this.baseUrl)) {
      headers["HTTP-Referer"] = typeof location !== "undefined" ? location.origin : "https://vibebench.github.io";
      headers["X-Title"] = "VibeLifeBench Live Demo";
    }
    return headers;
  }

  /** When Base is local proxy, settings may stash real upstream in this.upstreamBase */
  _proxyUpstreamTarget() {
    return this.upstreamBase || null;
  }

  async _chatCompletionStream({ onDelta }) {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: this._requestHeaders(),
      body: JSON.stringify(this._requestBody()),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM API ${res.status}: ${errText.slice(0, 500)}`);
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

        // DeepSeek: reasoning_content; OpenRouter/others: reasoning; some: reasoning_text
        const reasonChunk =
          delta.reasoning_content || delta.reasoning || delta.reasoning_text || "";
        if (reasonChunk) {
          thinking += reasonChunk;
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
      case "search_web": {
        const query = String(args.query || "").trim();
        const results = mockSearchResults(query, env, state);
        return { ok: true, query, results, count: results.length };
      }
      case "write_journal": {
        const section = String(args.section || "journal").toLowerCase();
        const title = String(args.title || "行程游记").trim();
        const content = String(args.content || "").trim();
        env.ledger = env.ledger || {};
        env.ledger.notion = env.ledger.notion || {
          title: "NZ Road Trip 2026 — Journal",
          sections: { journal: "", expense: "", safety: "" },
        };
        const prev = env.ledger.notion.sections[section] || "";
        const stamp = state.__date || String(this.engine.latestDate() || "");
        const block = [`## ${title}${stamp ? ` · ${stamp}` : ""}`, content].filter(Boolean).join("\n");
        env.ledger.notion.sections[section] = prev ? `${prev}\n\n${block}` : block;
        return {
          ok: true,
          written: true,
          section,
          title,
          content,
          preview: content.slice(0, 160),
        };
      }
      case "add_calendar_event": {
        const title = String(args.title || "行程节点").trim();
        const date = String(args.date || state.__date || this.engine.latestDate() || "").slice(0, 10);
        const note = String(args.note || "").trim();
        env.ledger = env.ledger || {};
        env.ledger.calendar = env.ledger.calendar || [];
        const item = {
          id: `cal_agent_${Date.now()}`,
          date,
          title,
          note,
          kind: "plan",
          source: "agent",
        };
        env.ledger.calendar.push(item);
        return { ok: true, written: true, event: item };
      }
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  }
}

function mockSearchResults(query, env, state) {
  const q = String(query || "").toLowerCase();
  const loc = state?.location || "";
  const out = [];
  if (/sh80|库克|mt\s*cook|落石|封/i.test(q)) {
    out.push({
      title: "NZTA：Aoraki/Mt Cook Highway (SH80) 临时管控",
      snippet: "落石风险路段实行间歇性封闭，建议出发前查询实时路况，并预留改道缓冲。",
      url: "nzta.govt.nz/traffic/sh80-mt-cook",
    });
  }
  if (/sh94|milford|米尔福德/i.test(q)) {
    out.push({
      title: "Milford Road (SH94) 天气与通行提示",
      snippet: "峡湾天气多变，浓雾/结冰时可能短时封闭。当日自驾请预留折返时间。",
      url: "milfordroad.co.nz/status",
    });
  }
  if (/营地|holiday|park|tekapo|蒂卡波|住宿/i.test(q)) {
    out.push({
      title: "Tekapo / Lakeview 营地评价摘要",
      snippet: "星空与湖景评分高；旺季建议提前确认 powered site 与取消政策。",
      url: "holidayparks.co.nz/tekapo",
    });
  }
  if (/签证|eta|入境/i.test(q)) {
    out.push({
      title: "新西兰 NZeTA 办理要点",
      snippet: "多数访客需 NZeTA + IVL；建议出行前 72 小时确认批准状态。",
      url: "immigration.govt.nz/nzeta",
    });
  }
  if (/渡轮|ferry|库克海峡/i.test(q)) {
    out.push({
      title: "Interislander 库克海峡渡轮动态",
      snippet: "大风浪时可能延误或改班；房车登船请按航次提前到达码头。",
      url: "interislander.co.nz/status",
    });
  }
  if (!out.length) {
    out.push({
      title: `检索：${query || "新西兰自驾"}`,
      snippet: loc
        ? `围绕「${loc}」整理了路况、天气与停留建议，可供行程决策参考。`
        : "已汇总官方路况、营地与签证相关公开信息摘要。",
      url: "vibelifebench.local/search",
    });
    out.push({
      title: "AA Traveller · South Island driving tips",
      snippet: "南岛山路弯多、补给点稀疏；单日驾驶建议控制在 4–5 小时内。",
      url: "aa.co.nz/travel",
    });
  }
  // Surface any currently active road notes
  for (const e of (env?.maps?.road_events || []).filter((x) => Number(x.active) === 1).slice(0, 2)) {
    out.push({
      title: `路况快讯 · ${e.road_id || "road"}`,
      snippet: e.note || "有生效中的道路事件，请结合工具复核。",
      url: `maps.local/${e.road_id || "event"}`,
    });
  }
  return out.slice(0, 5);
}

export { DEFAULT_MODEL, DEFAULT_BASE, DEFAULT_PROVIDER };
