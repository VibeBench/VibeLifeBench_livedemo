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
    this._aborted = false;
    this._abortController = null;
  }

  resetConversation(workspace, meta) {
    this.abort();
    this.messages = [{ role: "system", content: buildSystemPrompt(workspace, meta) }];
  }

  /** Cancel in-flight LLM stream / tool loop (清空回溯). */
  abort() {
    this._aborted = true;
    try {
      this._abortController?.abort();
    } catch {
      /* ignore */
    }
    this._abortController = null;
  }

  _throwIfAborted() {
    if (this._aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
  }

  async handleEnvEvent(agentText) {
    if (!agentText) return { content: "", thinking: "", toolCalls: [], usage: null };
    this._aborted = false;
    this.messages.push({ role: "user", content: agentText });
    return this._runLoop();
  }

  async handleUserChat(text) {
    this._aborted = false;
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
    this._abortController = new AbortController();

    for (let round = 0; round < this.maxToolRounds; round++) {
      this._throwIfAborted();
      const priorThinking = thinkingAcc;
      const result = await this._chatCompletionStream({
        onDelta: ({ thinking, content, phase, toolHint }) => {
          if (this._aborted) return;
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
      this._throwIfAborted();

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
          this._throwIfAborted();
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
          // Await tool cinematic so overlays play one-by-one (search → notion → …).
          await Promise.resolve(this.onTool({ name, args, result: toolResult }));
          this._throwIfAborted();
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
      signal: this._abortController?.signal,
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
      this._throwIfAborted();
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
        const q = `${args.road_id || ""} ${args.query || ""}`.toLowerCase().trim();
        const events = env.maps.road_events || [];
        const roads = env.maps.roads || [];
        const roadById = Object.fromEntries(roads.map((r) => [r.road_id, r]));
        const matchesQuery = (e) => {
          if (!q) return Number(e.active) === 1;
          const road = roadById[e.road_id] || {};
          const blob = `${e.event_id} ${e.road_id} ${e.note || ""} ${road.name || ""}`.toLowerCase();
          return q.split(/\s+/).some((t) => t && blob.includes(t.toLowerCase()));
        };
        const hitAll = events.filter(matchesQuery);
        // Only currently active events count as blockage for the map.
        const hitActive = hitAll.filter((e) => Number(e.active) === 1);
        const active = events.filter((e) => Number(e.active) === 1);
        const transit = (env.maps.transit_events || []).filter((e) => Number(e.active) === 1);
        // Specific road query with no active hit → clear (do not fall back to other closures).
        const matched = hitActive.length ? hitActive : q ? [] : active;
        const enrich = (e) => ({
          ...e,
          road_name: roadById[e.road_id]?.name || null,
          geom: roadById[e.road_id]?.geom || roadById[e.road_id]?.geom_json || null,
        });
        return {
          ok: true,
          query: q || null,
          status: matched.length ? "blocked" : "clear",
          matched: matched.map(enrich),
          mentioned_inactive: hitAll.filter((e) => Number(e.active) !== 1).map(enrich),
          roads: roads.map((r) => ({ road_id: r.road_id, name: r.name, city: r.city })),
          active_road_events: active.map(enrich),
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
        // Prefer live sticky budget; if somehow missing, rebuild cumulative max from revealed events.
        let budget = state.budget || null;
        if (!budget?.total_cny && this.engine?.revealed?.length) {
          let spent = 0;
          let total = null;
          for (const ev of this.engine.revealed) {
            const b = ev.user_state?.budget;
            if (!b) continue;
            if (b.total_cny != null) total = Number(b.total_cny);
            if (Number(b.spent_cny) > spent) spent = Number(b.spent_cny);
          }
          if (total != null) {
            budget = { total_cny: total, spent_cny: spent, remaining_cny: total - spent };
          }
        } else if (budget && budget.total_cny != null && budget.spent_cny != null) {
          budget = {
            ...budget,
            remaining_cny: Number(budget.total_cny) - Number(budget.spent_cny),
          };
        }
        return { ok: true, budget, location: state.location || null };
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
  const seen = new Set();
  const out = [];
  const push = (item) => {
    const key = String(item?.url || item?.title || "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  if (/sh80|库克|mt\s*cook|aoraki|落石/i.test(q)) {
    push({
      title: "NZTA：Aoraki/Mt Cook Highway (SH80) 临时管控",
      snippet: "落石风险路段实行间歇性封闭，建议出发前查询实时路况，并预留改道缓冲。",
      url: "nzta.govt.nz/traffic/sh80-mt-cook",
    });
    push({
      title: "DOC · Aoraki/Mt Cook 当日访客提示",
      snippet: "高山天气变化快，支线封闭时可改走 Twizel / Lake Pukaki 观景，勿强行进入管制区。",
      url: "doc.govt.nz/aoraki-alerts",
    });
    push({
      title: "改道参考：Twizel ↔ Tekapo 南岛内陆线",
      snippet: "SH80 不可用时，常见备选是沿 SH8 经 Twizel 衔接后续南下行程。",
      url: "aa.co.nz/maps/sh8-twizel",
    });
  }
  if (/sh94|milford|米尔福德|fiord|峡湾|doubtful|manapouri|马纳普里/i.test(q)) {
    push({
      title: "Milford Road (SH94) 天气与通行提示",
      snippet: "峡湾天气多变，浓雾/结冰/塌方时可能短时封闭。当日自驾请预留折返时间。",
      url: "milfordroad.co.nz/status",
    });
    push({
      title: "Doubtful Sound 一日游替代方案",
      snippet: "SH94 封闭时，可从 Manapouri 出发改走疑难峡湾（船+巴士+游船，约 7–8 小时）。",
      url: "realjourneys.co.nz/doubtful-sound",
    });
    push({
      title: "Fiordland 游船运营商改期说明",
      snippet: "Milford 当日游船受公路中断影响时可改期或退款，建议保留订单号联系客服。",
      url: "fiordland.travel/notices",
    });
  }
  if (/营地|holiday|park|tekapo|蒂卡波|住宿|酒店|motel/i.test(q)) {
    push({
      title: "Tekapo / Lakeview 营地评价摘要",
      snippet: "星空与湖景评分高；旺季建议提前确认 powered site 与取消政策。",
      url: "holidayparks.co.nz/tekapo",
    });
    push({
      title: "南岛热门营地可退订对比",
      snippet: "皇后镇、瓦纳卡、蒂卡波一带来看评分与退改；房车站点晚到可能改无电场地。",
      url: "bookacamping.co.nz/south-island",
    });
    push({
      title: "DOC 营地与预订须知",
      snippet: "部分国家公园营地需提前预约；旺季步行抵达营地请预留日照时间。",
      url: "doc.govt.nz/campsites",
    });
  }
  if (/签证|eta|入境|海关/i.test(q)) {
    push({
      title: "新西兰 NZeTA 办理要点",
      snippet: "多数访客需 NZeTA + IVL；建议出行前 72 小时确认批准状态。",
      url: "immigration.govt.nz/nzeta",
    });
    push({
      title: "入境申报与生物安全提示",
      snippet: "食品、户外装备需如实申报；未申报可能罚款并延误通关。",
      url: "customs.govt.nz/declare",
    });
    push({
      title: "旅客健康与保险建议",
      snippet: "山区活动建议确认旅行保险覆盖直升机救援与医疗转运条款。",
      url: "safetravel.govt.nz/insurance",
    });
  }
  if (/渡轮|ferry|库克海峡|interislander|picton|wellington/i.test(q)) {
    push({
      title: "Interislander 库克海峡渡轮动态",
      snippet: "大风浪时可能延误或改班；房车登船请按航次提前到达码头。",
      url: "interislander.co.nz/status",
    });
    push({
      title: "Bluebridge 备选航次与车位",
      snippet: "高峰日建议同时关注两家渡轮余票；房车高度/长度限制请提前核对。",
      url: "bluebridge.co.nz/sailings",
    });
    push({
      title: "皮克顿 / 惠灵顿码头到达指引",
      snippet: "登船截止通常早于开航 45–60 分钟；恶劣天气以码头现场广播为准。",
      url: "nzta.govt.nz/ferry-terminals",
    });
  }
  if (/天气|weather|forecast|风力|降雨/i.test(q)) {
    push({
      title: "MetService 南岛山区预报摘要",
      snippet: loc
        ? `关注「${loc}」附近阵风与能见度，峡谷路段午后变化更快。`
        : "山区午后对流增强，峡谷路段能见度可能骤降。",
      url: "metservice.com/mountain",
    });
    push({
      title: "驾驶天气安全要点",
      snippet: "低温路滑时降低车速，峡湾与垭口预留折返窗口，避免夜驶山路。",
      url: "nzta.govt.nz/winter-driving",
    });
  }

  // Surface any currently active road notes
  for (const e of (env?.maps?.road_events || []).filter((x) => Number(x.active) === 1).slice(0, 2)) {
    push({
      title: `路况快讯 · ${e.road_id || "road"}`,
      snippet: e.note || "有生效中的道路事件，请结合工具复核。",
      url: `maps.local/${e.road_id || "event"}`,
    });
  }

  // Always pad to 3–4 results so the map search overlay has a full result list.
  const pads = [
    {
      title: loc ? `当地指南 · ${loc}` : `检索：${query || "新西兰自驾"}`,
      snippet: loc
        ? `围绕「${loc}」整理了路况、天气与停留建议，可供行程决策参考。`
        : "已汇总官方路况、营地与签证相关公开信息摘要。",
      url: "vibelifebench.local/search",
    },
    {
      title: "AA Traveller · South Island driving tips",
      snippet: "南岛山路弯多、补给点稀疏；单日驾驶建议控制在 4–5 小时内。",
      url: "aa.co.nz/travel",
    },
    {
      title: "Tourism NZ · 本周行程灵感",
      snippet: "湖区、峡湾与地热线路热度高；热门景点建议错峰并预留弹性日。",
      url: "newzealand.com/tips",
    },
    {
      title: "加油站与补给间距参考",
      snippet: "南岛部分路段加油站间隔超过 100km，出发前加满并备饮水零食。",
      url: "gaspy.nz/south-island",
    },
  ];
  for (const p of pads) {
    if (out.length >= 4) break;
    push(p);
  }
  return out.slice(0, 5);
}

export { DEFAULT_MODEL, DEFAULT_BASE, DEFAULT_PROVIDER };
