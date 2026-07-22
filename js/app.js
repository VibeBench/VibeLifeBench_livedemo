import { loadDefaultCase, loadCaseFromFile } from "./loader.js?v=20260722-56";
import { DemoEngine } from "./engine.js?v=20260722-56";
import {
  TravelAgent,
  DEFAULT_MODEL,
  DEFAULT_BASE,
  DEFAULT_PROVIDER,
  normalizeBaseUrl,
  detectProvider,
} from "./agent.js?v=20260722-56";
import { Trajectory } from "./trajectory.js?v=20260720-27";
import { UI } from "./ui.js?v=20260722-56";
import { isOceanFlightCrossing } from "./map.js?v=20260722-56";

/** OpenAI-compatible provider presets for the demo console. */
const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    base: "https://api.deepseek.com",
    models: ["deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
    hint: "推荐默认。浏览器直连可能 CORS → Base 改用本地代理 http://127.0.0.1:8787，并保留提供商=DeepSeek。",
    thinking: true,
  },
  openai: {
    label: "OpenAI",
    base: "https://api.openai.com/v1",
    models: ["gpt-4.1", "gpt-4o", "o3-mini", "o4-mini"],
    hint: "需可 CORS 的网关或本地代理。o 系列可开 Thinking（reasoning_effort）。",
    thinking: true,
  },
  openrouter: {
    label: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
    models: [
      "deepseek/deepseek-r1",
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-flash",
    ],
    hint: "一站式多模型；github.io 上通常比直连各家更方便（仍可能需代理）。",
    thinking: true,
  },
  siliconflow: {
    label: "硅基流动 SiliconFlow",
    base: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct", "Pro/deepseek-ai/DeepSeek-R1"],
    hint: "国内常用 OpenAI 兼容网关；模型名以控制台为准。",
    thinking: false,
  },
  ollama: {
    label: "Ollama（本地）",
    base: "http://127.0.0.1:11434/v1",
    models: ["llama3.2", "qwen2.5", "deepseek-r1"],
    hint: "本机 Ollama，可无 Key。需浏览器能访问 11434（同机或已放行 CORS）。",
    thinking: false,
  },
  proxy: {
    label: "本地 CORS 代理",
    base: "http://127.0.0.1:8787",
    models: ["deepseek-v4-pro", "gpt-4o", "deepseek/deepseek-r1"],
    hint: "配合 ./start.sh。请求经代理转发；真实上游由「上游 Base」或默认 DeepSeek 决定。",
    thinking: true,
    upstream: "https://api.deepseek.com",
  },
  custom: {
    label: "自定义 OpenAI 兼容",
    base: "",
    models: [],
    hint: "任意 Chat Completions 兼容地址。Base 填到 /v1 一层（不要带 /chat/completions）。",
    thinking: false,
  },
};

const ui = new UI();
let caseData = null;
let engine = null;
let agent = null;
let trajectory = null;

let autoplay = false;
let busy = false;
let autoplayTimer = null;
/** Bumped on 清空回溯 — in-flight step/agent work must stop applying UI. */
let playbackEpoch = 1;
/** Last geo_key after a step — used to detect China↔NZ flight jumps. */
let lastSceneGeo = null;
/** Play ocean-flight cutscene at most once per from→to pair per run. */
let flightPlayed = new Set();

const settings = loadSettings();

async function main() {
  bindChrome();
  fillProviderSelect();
  applySettingsToForm();
  bindProviderUi();
  try {
    caseData = await loadDefaultCase("./data");
    bootCase(caseData);
    ui.toast("已加载 newzealand_drive_30d_fix");
    maybeAutoOpenConsole();
  } catch (e) {
    console.error(e);
    ui.toast("默认数据加载失败：" + e.message);
  }
}

function bootCase(data) {
  caseData = data;
  engine = new DemoEngine(data);
  trajectory = new Trajectory(data.meta.case_id);
  lastSceneGeo = null;
  flightPlayed = new Set();
  ui.setMeta(data.meta);
  ui.clearChat();
  ui.resetLedgerAlerts();
  ui.setPhoneTab("chat");
  // Tool-queried weather → sticky state + status chip (landing anim comes from focusMapFromTool).
  ui.onWeatherObserved = ({ weather, geo_key } = {}) => {
    if (!engine || !weather) return;
    engine.setObservedWeather(weather, { geo_key });
    const brief = String(weather).split(/[,，]/)[0].trim().slice(0, 24) || "—";
    ui._statusSnap = { ...(ui._statusSnap || {}), weather: brief };
    refreshDashboard();
  };
  refreshDashboard();
  lastSceneGeo = engine.currentState?.geo_key || "shanghai_home";
  ensureAgent();
  showEntryGuide();
}

function currentSceneGeo() {
  return engine?.currentState?.geo_key || lastSceneGeo || null;
}

function flightNoForCrossing(fromGeo, toGeo, event = null) {
  const fromEvent = event?.user_state?.next_flight?.flight_no;
  if (fromEvent) return fromEvent;
  const flags = engine?.progressFlags?.() || {};
  const toNz = isOceanFlightCrossing(fromGeo || "shanghai_home", toGeo) && toGeo !== "shanghai_home";
  if (toNz) return flags.outboundFlightNo || "MU779";
  return "MU780";
}

/** If geo jumped China↔NZ, play the plane cutscene once. */
async function maybePlayFlightCrossing(fromGeo, toGeo, { event = null, time = null } = {}) {
  const from = fromGeo || "shanghai_home";
  const to = toGeo;
  if (!isOceanFlightCrossing(from, to)) return false;
  const key = `${from}>${to}`;
  if (flightPlayed.has(key)) return false;
  flightPlayed.add(key);
  const flightNo = flightNoForCrossing(from, to, event);
  const outbound = to !== "shanghai_home";
  ui.appendChat({
    role: "system",
    text: outbound
      ? `✈️ 航班起飞 · ${flightNo} · 上海浦东 → 基督城`
      : `✈️ 返程起飞 · ${flightNo} · 奥克兰 → 上海浦东`,
    time,
  });
  await ui.playFlightCrossing({
    fromGeo: from,
    toGeo: to,
    flightNo,
    durationMs: 7200,
  });
  return true;
}

function hasApiKeyConfigured() {
  const provider = settings.provider || DEFAULT_PROVIDER;
  if (provider === "ollama") return true;
  return Boolean((settings.apiKey || "").trim());
}

function showEntryGuide() {
  const provider = settings.provider || DEFAULT_PROVIDER;
  // Don't construct agent just to probe — key presence is enough for the CTA state.
  const configured = hasApiKeyConfigured();
  ui.showWelcomeGuide(
    {
      configured,
      providerLabel: PROVIDERS[provider]?.label || provider,
      model: settings.model || DEFAULT_MODEL,
    },
    {
      onConfigure: () => {
        openConsole(true);
        document.querySelector("#apiKey")?.focus();
      },
      onStartDemo: () => {
        if (!hasApiKeyConfigured() || !ensureAgent()) {
          ui.toast("请先配置 API Key");
          openConsole(true);
          return;
        }
        ui.setPhoneTab("chat");
        startAutoplay();
        pulseAutoplayButton();
        ui.toast("自动演示已开始");
      },
    }
  );
}

/** First visit without a key: open the console once so the path is obvious. */
function maybeAutoOpenConsole() {
  if (hasApiKeyConfigured()) return;
  try {
    if (localStorage.getItem("vibelifebench_console_autopen")) return;
    localStorage.setItem("vibelifebench_console_autopen", "1");
  } catch {
    /* ignore */
  }
  setTimeout(() => openConsole(true), 450);
}

function pulseAutoplayButton() {
  const btn = document.querySelector("#btnAutoplay");
  if (!btn) return;
  btn.classList.remove("guide-pulse");
  void btn.offsetWidth;
  btn.classList.add("guide-pulse");
  setTimeout(() => btn.classList.remove("guide-pulse"), 4000);
}

function syncConsoleOnboard() {
  const el = document.querySelector("#consoleOnboard");
  if (!el) return;
  el.hidden = hasApiKeyConfigured();
  const saveBtn = document.querySelector("#btnSaveSettings");
  if (saveBtn) {
    saveBtn.textContent = hasApiKeyConfigured() ? "保存并连接" : "保存并连接 → 下一步";
  }
}

/** Clear chat / agent memory / trajectory and rewind env playback to stage 0. */
function clearAndRewind({ confirm: needConfirm = true } = {}) {
  if (!caseData) return;
  const hasProgress =
    (engine && engine.cursor >= 0) ||
    (trajectory && trajectory.steps.length > 0) ||
    (ui.els.chatMessages?.children?.length > 1);
  if (needConfirm && hasProgress) {
    const ok = window.confirm("清空对话、Agent 记忆与 trajectory，并回溯到行程起点？");
    if (!ok) return;
  }
  // Invalidate every in-flight step / stream / map cinematic first.
  playbackEpoch += 1;
  stopAutoplay();
  busy = false;
  setBusyUI(false);
  try {
    agent?.abort?.();
  } catch {
    /* ignore */
  }
  ui._streamBubble = null;
  lastSceneGeo = null;
  flightPlayed = new Set();

  // Fresh engine + trajectory
  engine = new DemoEngine(caseData);
  trajectory = new Trajectory(caseData.meta.case_id);

  // Reset agent conversation (keep API settings)
  if (agent) {
    agent.engine = engine;
    agent.resetConversation(caseData.workspace, caseData.meta);
    trajectory.setModel(settings.model || DEFAULT_MODEL);
  } else {
    ensureAgent();
  }

  ui.resetMap();
  ui.clearChat();
  ui.resetLedgerAlerts();
  ui.setPhoneTab("chat");
  refreshDashboard();
  lastSceneGeo = engine.currentState?.geo_key || "shanghai_home";
  showEntryGuide();
  ui.toast("已清空回溯到起点");
}

function ensureAgent() {
  const provider = settings.provider || DEFAULT_PROVIDER;
  const key = settings.apiKey || document.querySelector("#apiKey")?.value?.trim();
  const allowEmptyKey = provider === "ollama";
  if (!key && !allowEmptyKey) {
    agent = null;
    ui.setAgentStatus("Offline · 需配置 API Key", false);
    return null;
  }
  const model = settings.model || DEFAULT_MODEL;
  let baseUrl = settings.baseUrl || PROVIDERS[provider]?.base || DEFAULT_BASE;
  // When using local CORS proxy, still call proxy host; real upstream goes via header.
  const upstreamBase =
    provider === "proxy"
      ? settings.upstreamBase || PROVIDERS.proxy.upstream || DEFAULT_BASE
      : null;
  if (provider === "proxy") baseUrl = "http://127.0.0.1:8787";

  trajectory?.setModel(model);
  agent = new TravelAgent({
    apiKey: key || "ollama",
    baseUrl,
    model,
    provider: provider === "proxy" ? "proxy" : provider,
    engine,
    workspace: caseData.workspace,
    meta: caseData.meta,
    thinking: settings.thinking !== false,
    onStream: (payload) => {
      if (agent?._aborted) return;
      if (ui._streamBubble) ui.updateAgentTurn(ui._streamBubble, payload);
      if (payload?.thinking) ui.syncMapPlanningFromThinking(payload.thinking);
    },
    onTool: async ({ name, args, result }) => {
      if (agent?._aborted) return;
      console.debug("tool", name, args, result);
      if (ui._streamBubble) {
        ui.appendToolCall(ui._streamBubble, {
          name,
          args: args || {},
          result,
          status: "done",
        });
      }
      // Wait for this tool's map cinematic before the next tool runs.
      await Promise.resolve(ui.focusMapFromTool(name, args || {}, result));
      // Write / booking tools also leave a durable state card in chat history
      if (/book|cancel|create|send|post|update|write|insert|reserve|confirm|refund/i.test(name || "")) {
        const tab = /notion|page|block/i.test(name) ? "notes" : "trip";
        let title = "已写入行程状态";
        if (/hotel/i.test(name)) {
          title = `预订酒店${args.hotel_name || args.hotel_id || args.name ? ` · ${args.hotel_name || args.hotel_id || args.name}` : ""}`;
        } else if (/flight|air/i.test(name)) {
          title = `预订机票${args.flight_no ? ` · ${args.flight_no}` : ""}`;
        } else if (/notion|page|journal/i.test(name)) {
          title = args.title ? `写入游记 · ${args.title}` : "写入游记";
        } else if (/cancel/i.test(name) && /hotel/i.test(name)) {
          title = "取消酒店预订";
        } else if (/cancel/i.test(name) && /flight/i.test(name)) {
          title = "取消机票";
        } else {
          title = `已执行 · ${String(name).replace(/[_-]+/g, " ")}`;
        }
        // Notion writes: title only — dumping content=… makes chat unreadable
        const isNotion = /notion|page|journal/i.test(name || "");
        const detail = isNotion
          ? ""
          : result?.summary ||
            result?.note ||
            Object.entries(args || {})
              .filter(([, v]) => v != null && String(v).trim() !== "")
              .map(([k, v]) => `${k}=${v}`)
              .slice(0, 4)
              .join(" · ");
        ui.notifyStateChange({
          icon: tab === "notes" ? "📝" : /flight|air/i.test(name) ? "✈️" : /hotel|stay/i.test(name) ? "🏨" : "🔧",
          text: title,
          title,
          body: detail,
          tab,
          kind: isNotion ? "notion" : "tool-write",
          key: `tool-write:${name}:${JSON.stringify(args || {}).slice(0, 80)}`,
        });
      }
    },
  });
  if (upstreamBase) agent.upstreamBase = normalizeBaseUrl(upstreamBase, detectProvider(upstreamBase));
  const tag = PROVIDERS[provider]?.label || provider;
  ui.setAgentStatus(`Online · ${tag} · ${model}`, true);
  return agent;
}

function refreshDashboard() {
  if (!engine) return;
  const liveDate = engine.latestDate();
  const focus = engine.uiFocus;
  let viewDate = liveDate;
  if (focus?.kind === "day" || focus?.kind === "prep") {
    viewDate = focus.date;
  } else if (focus?.kind === "pre") {
    const prepReached = (engine.meta.prep_days || []).filter((d) => !liveDate || d.date <= liveDate);
    viewDate = prepReached[prepReached.length - 1]?.date || liveDate;
  }
  const reached = engine.reachedDate();

  ui.renderDayRibbon(engine.meta.trip_days || [], viewDate, {
    prepDays: engine.meta.prep_days || [],
    reachedDate: reached,
    liveDate,
  });

  const view = engine.mapView();
  const flags = engine.progressFlags();
  ui.renderStatus(view.state, view.env, {
    budgetDisclosed: flags.budgetDisclosed,
    budgetSettled: flags.budgetSettled,
    flightDisclosed: flags.flightDisclosed,
    flags,
  });

  const ledger = engine.ledgerView();
  const expandDate = viewDate || liveDate || undefined;
  ui.renderTripLedger(ledger, { expandDate });
  ui.renderNotionLedger(ledger);
  ui.syncLedgerAlerts(ledger);

  // Map event flow removed — tool steps are visible in the phone chat.
  ui.syncEnvEmails(view.env?.emails || engine.env?.emails, engine.simNow?.());
  ui.renderMap(engine);
  ui.renderFooter(engine);
}

async function stepOnce() {
  if (!engine || busy) return;
  if (engine.progress.done) {
    ui.toast("全部事件已播放完毕");
    stopAutoplay();
    return;
  }

  const epoch = playbackEpoch;
  busy = true;
  setBusyUI(true);
  try {
    const prevGeo = currentSceneGeo();
    const result = engine.step();
    if (!result) return;
    if (epoch !== playbackEpoch) return;
    const { event, agentText, feedToAgent, mutationResult } = result;
    trajectory.pushEnvEvent(event, { mutationResult, feedToAgent });

    const t = event.time || null;
    const nextGeo = event.user_state?.geo_key || currentSceneGeo();

    // Phone: surface user / notifications / heartbeats / routines
    if (event.kind === "user_message") {
      ui.appendChat({ role: "user", text: event.body, from: event.from, time: t });
    } else if (event.kind === "app_notification" || event.kind === "world") {
      ui.notifyEnvEvent(event);
    } else if (event.kind === "notification") {
      ui.appendChat({ role: "system", text: `🫀 心跳 · ${truncate(event.body, 180)}`, time: t });
      ui.notifyEnvEvent(event);
    } else if (event.kind === "weather") {
      const w = event.user_state?.weather || truncate(event.body, 120);
      const bad = event.user_state?.weather_impact === "disruptive";
      ui.appendChat({
        role: "system",
        text: `${bad ? "🌧️" : "🌦️"} 天气 · ${w}`,
        time: t,
      });
      ui.notifyEnvEvent(event);
    } else if (event.kind === "routine") {
      const action = event.user_state?.demo_action || "日常节点";
      ui.appendChat({
        role: "system",
        text: `🚗 ${action}${event.user_state?.location ? ` · ${event.user_state.location}` : ""}`,
        time: t,
      });
      ui.notifyEnvEvent(event);
    } else if (event.kind === "mutation") {
      // Silent backend write — apply via engine only; never surface in chat/timeline/UI.
    }

    if (epoch !== playbackEpoch) return;
    refreshDashboard();
    await maybePlayFlightCrossing(prevGeo, nextGeo, { event, time: t });
    if (epoch !== playbackEpoch) return;
    lastSceneGeo = nextGeo || prevGeo || lastSceneGeo;

    if (feedToAgent && agentText) {
      const a = ensureAgent();
      if (!a) {
        ui.appendChat({
          role: "agent",
          text: "（未配置 DeepSeek API Key — 打开演示控制台填入后可继续生成回复）",
          time: t,
        });
      } else {
        ui._streamBubble = ui.beginAgentTurn({ time: t });
        try {
          const turn = await a.handleEnvEvent(agentText);
          if (epoch !== playbackEpoch) return;
          ui.finishAgentTurn(ui._streamBubble, {
            thinking: turn.thinking,
            content: turn.content || "（空回复）",
            toolCalls: turn.toolCalls || [],
          });
          trajectory.pushAgentTurn({
            eventId: event.id,
            input: agentText,
            output: turn.content,
            thinking: turn.thinking,
            toolCalls: turn.toolCalls,
            usage: turn.usage,
          });
        } catch (err) {
          if (err?.name === "AbortError" || epoch !== playbackEpoch) return;
          console.error(err);
          ui.finishAgentTurn(ui._streamBubble, { error: err.message });
          stopAutoplay();
        } finally {
          if (epoch === playbackEpoch) ui._streamBubble = null;
        }
      }
    }

    if (epoch !== playbackEpoch) return;
    // Wait until all tool / status cinematics finish before ending this stage.
    refreshDashboard();
    await ui.waitCinematicsIdle();
  } finally {
    if (epoch === playbackEpoch) {
      busy = false;
      setBusyUI(false);
    }
  }
}

async function sendUserChat(text) {
  text = (text || "").trim();
  if (!text || busy) return;
  const a = ensureAgent();
  if (!a) {
    ui.toast("请先在演示控制台配置 DeepSeek API Key");
    openConsole(true);
    return;
  }
  const epoch = playbackEpoch;
  busy = true;
  setBusyUI(true);
  const simTime = engine?.simNow?.() || null;
  ui.appendChat({ role: "user", text, from: "wang_li", time: simTime });
  trajectory.pushUserChat({ text, from: "live_user" });
  document.querySelector("#chatInput").value = "";
  ui._streamBubble = ui.beginAgentTurn({ time: simTime });
  try {
    const turn = await a.handleUserChat(text);
    if (epoch !== playbackEpoch) return;
    ui.finishAgentTurn(ui._streamBubble, {
      thinking: turn.thinking,
      content: turn.content || "（空回复）",
      toolCalls: turn.toolCalls || [],
    });
    trajectory.pushAgentTurn({
      eventId: null,
      input: text,
      output: turn.content,
      thinking: turn.thinking,
      toolCalls: turn.toolCalls,
      usage: turn.usage,
    });
  } catch (err) {
    if (err?.name === "AbortError" || epoch !== playbackEpoch) return;
    ui.finishAgentTurn(ui._streamBubble, { error: err.message });
  } finally {
    if (epoch === playbackEpoch) {
      ui._streamBubble = null;
      refreshDashboard();
      await ui.waitCinematicsIdle();
      busy = false;
      setBusyUI(false);
    }
  }
}

function startAutoplay() {
  autoplay = true;
  document.querySelector("#btnAutoplay").classList.add("active");
  document.querySelector("#btnAutoplay").textContent = "自动播放中";
  tickAutoplay();
}

function stopAutoplay() {
  autoplay = false;
  clearTimeout(autoplayTimer);
  document.querySelector("#btnAutoplay").classList.remove("active");
  document.querySelector("#btnAutoplay").textContent = "自动播放";
}

async function tickAutoplay() {
  if (!autoplay) return;
  await stepOnce();
  if (autoplay && !engine.progress.done) {
    const delay = Number(settings.autoplayMs) || 1200;
    autoplayTimer = setTimeout(tickAutoplay, delay);
  } else {
    stopAutoplay();
  }
}

function setBusyUI(on) {
  document.body.classList.toggle("is-busy", on);
}

function bindChrome() {
  document.querySelector("#btnAutoplay").addEventListener("click", () => {
    if (autoplay) stopAutoplay();
    else startAutoplay();
  });
  document.querySelector("#btnConsole").addEventListener("click", () => openConsole());
  document.querySelector("#btnCloseConsole").addEventListener("click", () => openConsole(false));
  document.querySelector("#btnSaveSettings").addEventListener("click", () => {
    saveSettingsFromForm();
    const a = ensureAgent();
    syncConsoleOnboard();
    applySettingsToForm();
    if (!a) {
      ui.toast("请填写 API Key 后再保存");
      document.querySelector("#apiKey")?.focus();
      return;
    }
    openConsole(false);
    showEntryGuide();
    pulseAutoplayButton();
    ui.toast("已连接 · 点「开始自动演示」或顶部自动播放");
  });
  document.querySelector("#btnClearKey")?.addEventListener("click", () => {
    clearSavedApiKey({ toast: true });
  });
  document.querySelector("#btnExport").addEventListener("click", () => {
    if (!trajectory) return;
    trajectory.download();
    ui.toast("Trajectory 已导出");
  });
  document.querySelector("#btnRewind").addEventListener("click", () => clearAndRewind());
  document.querySelector("#btnReset").addEventListener("click", () => clearAndRewind());
  document.querySelector("#caseFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await loadCaseFromFile(file);
      // Keep env/workspace from default if upload is bare event.yaml
      if (!data.env?.weather?.daily_weather?.length && caseData?.env) {
        data.env = structuredClone(caseData.env);
      }
      if (!Object.keys(data.workspace || {}).length && caseData?.workspace) {
        data.workspace = caseData.workspace;
      }
      data.flat = data.flat; // already normalized
      bootCase(data);
      ui.toast("已加载：" + file.name);
    } catch (err) {
      ui.toast("加载失败：" + err.message);
    }
  });

  document.querySelector("#dayRibbon").addEventListener("click", async (e) => {
    const chip = e.target.closest(".day-chip");
    if (!chip || chip.disabled || chip.classList.contains("locked")) return;
    const prevGeo = currentSceneGeo();
    if (chip.dataset.phase === "prep") {
      if (!engine.focusPrepDay(chip.dataset.date)) {
        ui.toast("该行前日期尚未到达");
        return;
      }
      refreshDashboard();
      lastSceneGeo = currentSceneGeo() || lastSceneGeo;
      return;
    }
    if (chip.dataset.phase === "pre") {
      if (!engine.focusPreTrip()) {
        ui.toast("行前阶段尚未开始");
        return;
      }
      refreshDashboard();
      lastSceneGeo = currentSceneGeo() || lastSceneGeo;
      return;
    }
    const dayNum = Number(chip.dataset.day);
    if (!engine.focusDay(dayNum)) {
      ui.toast("尚未进展到这一天");
      return;
    }
    refreshDashboard();
    const nextGeo = currentSceneGeo();
    await maybePlayFlightCrossing(prevGeo, nextGeo, { time: null });
    lastSceneGeo = nextGeo || prevGeo || lastSceneGeo;
  });

  document.querySelector("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    sendUserChat(document.querySelector("#chatInput").value);
  });

  document.querySelector("#btnHelp")?.addEventListener("click", () => {
    sendUserChat("我们需要帮助，请根据当前行程状态主动检查有没有风险。");
  });

  const legendBtn = document.querySelector("#btnMapLegend");
  const legendPop = document.querySelector("#mapLegendPop");
  const setLegendOpen = (open) => {
    if (!legendPop || !legendBtn) return;
    legendPop.hidden = !open;
    if (open) legendPop.removeAttribute("hidden");
    else legendPop.setAttribute("hidden", "");
    legendBtn.setAttribute("aria-expanded", open ? "true" : "false");
    legendBtn.classList.toggle("is-open", open);
  };
  legendBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setLegendOpen(legendPop?.hidden !== false);
  });
  document.querySelector("#btnMapLegendClose")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setLegendOpen(false);
  });
  document.addEventListener("click", (e) => {
    if (!legendPop || legendPop.hidden) return;
    if (legendPop.contains(e.target) || legendBtn?.contains(e.target)) return;
    setLegendOpen(false);
  });
}

function openConsole(show) {
  const want =
    typeof show === "boolean" ? show : ui.activeTab !== "settings";
  if (want) {
    applySettingsToForm();
    syncConsoleOnboard();
    ui.setPhoneTab("settings");
  } else {
    ui.setPhoneTab("chat");
  }
}

function loadSettings() {
  let raw = {};
  try {
    raw = JSON.parse(localStorage.getItem("vibelifebench_demo_settings") || "{}");
  } catch {
    raw = {};
  }
  // One-time wipe: drop previously saved keys so they no longer sit in localStorage / UI.
  const wipeFlag = "vibelifebench_key_wipe_20260722";
  if (!localStorage.getItem(wipeFlag)) {
    if (raw.apiKey) {
      delete raw.apiKey;
      try {
        localStorage.setItem("vibelifebench_demo_settings", JSON.stringify(raw));
      } catch {
        /* ignore */
      }
    }
    localStorage.setItem(wipeFlag, "1");
  }
  return raw;
}

function clearSavedApiKey({ toast = false } = {}) {
  settings.apiKey = "";
  try {
    const next = { ...settings };
    delete next.apiKey;
    localStorage.setItem("vibelifebench_demo_settings", JSON.stringify(next));
  } catch {
    /* ignore */
  }
  const input = document.querySelector("#apiKey");
  if (input) input.value = "";
  agent = null;
  applySettingsToForm();
  ensureAgent();
  syncConsoleOnboard();
  showEntryGuide();
  if (toast) ui.toast("已清除本机 API Key");
}

function fillProviderSelect() {
  const sel = document.querySelector("#apiProvider");
  if (!sel || sel.options.length) return;
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }
}

function fillModelSuggestions(providerId) {
  const list = document.querySelector("#modelSuggestions");
  if (!list) return;
  list.innerHTML = "";
  for (const m of PROVIDERS[providerId]?.models || []) {
    const opt = document.createElement("option");
    opt.value = m;
    list.appendChild(opt);
  }
}

function updateProviderHint(providerId) {
  const el = document.querySelector("#providerHint");
  if (el) el.textContent = PROVIDERS[providerId]?.hint || "";
}

function applyProviderPreset(providerId, { keepModel = false } = {}) {
  const p = PROVIDERS[providerId] || PROVIDERS.custom;
  const baseInput = document.querySelector("#apiBase");
  const modelInput = document.querySelector("#apiModel");
  const think = document.querySelector("#apiThinking");
  const upstreamField = document.querySelector("#upstreamField");
  const upstreamInput = document.querySelector("#apiUpstream");
  if (providerId === "proxy") {
    baseInput.value = p.base;
    if (upstreamField) upstreamField.hidden = false;
    if (upstreamInput) upstreamInput.value = settings.upstreamBase || p.upstream || DEFAULT_BASE;
  } else {
    if (upstreamField) upstreamField.hidden = true;
    if (p.base) baseInput.value = p.base;
  }
  fillModelSuggestions(providerId);
  if (!keepModel && p.models?.[0]) modelInput.value = p.models[0];
  if (think) think.checked = p.thinking !== false;
  updateProviderHint(providerId);
}

function bindProviderUi() {
  const sel = document.querySelector("#apiProvider");
  if (!sel || sel.dataset.bound) return;
  sel.dataset.bound = "1";
  sel.addEventListener("change", () => {
    applyProviderPreset(sel.value, { keepModel: false });
  });
}

function applySettingsToForm() {
  const provider = settings.provider || DEFAULT_PROVIDER;
  const sel = document.querySelector("#apiProvider");
  if (sel) sel.value = PROVIDERS[provider] ? provider : "custom";
  // Never paint the saved secret into the DOM.
  const keyInput = document.querySelector("#apiKey");
  if (keyInput) {
    keyInput.value = "";
    keyInput.placeholder = hasApiKeyConfigured()
      ? "已保存（留空沿用）· 输入新 Key 可更换"
      : "粘贴 API Key（保存后不会回显）";
  }
  const keyHint = document.querySelector("#apiKeyHint");
  if (keyHint) {
    if (hasApiKeyConfigured()) {
      keyHint.hidden = false;
      keyHint.textContent = "本机已保存 Key，输入框故意留空以免泄露；点「清除 Key」可删除。";
    } else {
      keyHint.hidden = true;
      keyHint.textContent = "";
    }
  }
  document.querySelector("#apiBase").value =
    settings.baseUrl || PROVIDERS[provider]?.base || DEFAULT_BASE;
  document.querySelector("#apiModel").value = settings.model || DEFAULT_MODEL;
  const think = document.querySelector("#apiThinking");
  if (think) think.checked = settings.thinking !== false;
  document.querySelector("#autoplayMs").value = settings.autoplayMs || 1200;
  const upstreamField = document.querySelector("#upstreamField");
  const upstreamInput = document.querySelector("#apiUpstream");
  if (provider === "proxy") {
    if (upstreamField) upstreamField.hidden = false;
    if (upstreamInput) {
      upstreamInput.value = settings.upstreamBase || PROVIDERS.proxy.upstream || DEFAULT_BASE;
    }
    document.querySelector("#apiBase").value = "http://127.0.0.1:8787";
  } else if (upstreamField) {
    upstreamField.hidden = true;
  }
  fillModelSuggestions(sel?.value || provider);
  updateProviderHint(sel?.value || provider);
}

function saveSettingsFromForm() {
  const provider = document.querySelector("#apiProvider")?.value || DEFAULT_PROVIDER;
  settings.provider = provider;
  const typedKey = document.querySelector("#apiKey")?.value.trim() || "";
  // Empty input keeps the previously saved key (field is intentionally blank).
  if (typedKey) settings.apiKey = typedKey;
  settings.baseUrl = document.querySelector("#apiBase").value.trim() || PROVIDERS[provider]?.base || DEFAULT_BASE;
  settings.model = document.querySelector("#apiModel").value.trim() || DEFAULT_MODEL;
  settings.thinking = Boolean(document.querySelector("#apiThinking")?.checked);
  settings.autoplayMs = Number(document.querySelector("#autoplayMs").value) || 1200;
  if (provider === "proxy") {
    settings.upstreamBase =
      document.querySelector("#apiUpstream")?.value.trim() ||
      PROVIDERS.proxy.upstream ||
      DEFAULT_BASE;
    settings.baseUrl = "http://127.0.0.1:8787";
  } else {
    settings.upstreamBase = null;
  }
  localStorage.setItem("vibelifebench_demo_settings", JSON.stringify(settings));
}

function truncate(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

main();
