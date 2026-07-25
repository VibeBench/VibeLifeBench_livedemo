/**
 * Demo locale: zh (default) / en.
 * Chrome copy via t(); case task text via localizeEvent() + data/i18n/en.json.
 */

const STORAGE_KEY = "vibe.locale";

/** @type {'zh'|'en'} */
let locale = "zh";
/** @type {object|null} */
let enPack = null;
/** @type {object|null} */
let workspaceEn = null;
/** @type {Set<Function>} */
const listeners = new Set();

const DICT = {
  zh: {
    "lang.zh": "中",
    "lang.en": "EN",
    "lang.toast.zh": "界面语言：中文",
    "lang.toast.en": "Language · English",
    "lang.btnTitle": "切换中文 / English",
    "top.speed": "倍速",
    "top.speedTitle": "动画与回放倍速",
    "top.speedAria": "播放倍速",
    "top.autoplay": "自动播放",
    "top.autoplayStop": "停止自动播放",
    "top.autoplayStart": "开始自动演示",
    "top.replay": "加速回放",
    "top.replayTitle": "跑完后可加速回放本局全部动画与模型结果（不重调 LLM）",
    "top.rewind": "清空回溯",
    "top.rewindTitle": "清空对话与轨迹，回退到行程起点",
    "top.console": "演示控制台",
    "map.controls": "地图控制",
    "map.zoomIn": "放大",
    "map.zoomOut": "缩小",
    "map.clear": "清除地图标注",
    "map.planning": "路线推演中",
    "map.legendTitle": "查看图例",
    "map.legendHead": "地图图例",
    "map.legendClose": "关闭",
    "map.leg.done": "已走",
    "map.leg.route": "规划未走",
    "map.leg.live": "当前路段",
    "map.leg.plan": "推演/调整",
    "map.leg.stay": "计划住宿",
    "map.leg.check": "核查中",
    "map.leg.flight": "航线 · 已飞/未飞",
    "map.leg.ferry": "渡轮",
    "map.leg.close": "确认受阻",
    "phone.offline": "Offline",
    "phone.online": "Online",
    "phone.chatPlaceholder": "输入消息，与 Agent 持续互动…",
    "phone.send": "发送",
    "phone.tripTitle": "行程账本",
    "phone.tripSub": "机票 · 酒店 · 日历",
    "phone.mailTitle": "收件箱",
    "phone.mailSub": "通知 · 资讯 · 邮件归档",
    "phone.notesSub": "Notion 游记摘要",
    "phone.settingsTitle": "演示控制台",
    "phone.settingsSub": "API · 自动播放 · 导出",
    "nav.chat": "对话",
    "nav.trip": "行程",
    "nav.mail": "邮件",
    "nav.notes": "笔记",
    "nav.settings": "设置",
    "console.onboardTitle": "两步开始自动演示",
    "console.onboard1": "选择提供商，填写 <strong>API Key</strong>（推荐 DeepSeek）",
    "console.onboard2": "点下方「保存并连接」，回到对话再点 <strong>开始自动演示</strong>",
    "console.onboardNote": "Key 只保存在本机；打开设置时不会回显，避免泄露。",
    "console.hint":
      "任意 <strong>OpenAI 兼容</strong> Chat Completions 端点均可。浏览器直连常被 CORS 拦截时：本机 <code>./start.sh</code>，Base 填 <code>http://127.0.0.1:8787</code>。",
    "console.provider": "提供商",
    "console.apiKey": "API Key",
    "console.apiKeyPh": "粘贴新 Key（不会回显已保存的 Key）",
    "console.apiBase": "API Base",
    "console.upstream": "上游 Base（经本地代理转发）",
    "console.model": "Model",
    "console.thinking": "启用 Thinking / Reasoning（DeepSeek / 部分 OpenAI·OpenRouter 模型）",
    "console.autoplayMs": "自动播放间隔 (ms)",
    "console.caseFile": "加载同格式 case 文件",
    "console.save": "保存并连接",
    "console.clearKey": "清除 Key",
    "console.clearKeyTitle": "清除本机保存的 API Key",
    "console.export": "导出 Trajectory",
    "console.reset": "清空回溯",
    "console.back": "返回对话",
    "status.location": "当前位置",
    "status.activity": "当前活动",
    "status.weather": "天气",
    "status.budget": "预算状态",
    "status.visa": "签证",
    "status.rental": "房车",
    "status.flight": "已订航班",
    "status.notStarted": "尚未开始",
    "status.prep": "行前准备",
    "status.prepHint": "开启自动播放开始",
    "status.budgetPending": "用户说明预算后更新",
    "status.budgetReady": "用户已确认 · 预订产生后更新明细",
    "status.budgetUsed": "已用 ¥{spent} / ¥{total} · 剩余 ¥{remain}",
    "status.budgetUsedShort": "已用 ¥{spent} / ¥{total}",
    "tool.using": "正在使用工具",
    "tool.expand": "展开全文",
    "tool.collapse": "收起工具",
    "sms.badge": "短信",
    "mail.badge": "邮件",
    "sms.system": "系统通知",
    "kind.user_message": "用户消息",
    "kind.app_notification": "APP / 短信",
    "kind.world": "外部资讯",
    "kind.weather": "天气更新",
    "kind.mutation": "环境静默变更",
    "kind.notification": "系统心跳",
    "kind.routine": "行程节点",
    "kind.env_change": "环境变更",
    "kind.agent_tool": "Agent 工具",
    "kind.agent_reply": "Agent 回复",
    "kind.agent_state": "账本变更",
    "toast.newMail": "收到一封新邮件",
    "toast.newSms": "收到一条短信通知",
    "toast.heartbeat": "系统心跳：巡检当前行程风险",
    "toast.weatherOk": "天气状态已更新",
    "toast.weatherBad": "⚠ 不利天气 · {w}",
    "toast.routine": "日常行程节点",
    "app.mail": "邮件",
    "app.sms": "短信",
    "app.inbox": "收件箱",
    "app.smsNotify": "短信通知",
    "app.external": "外部通知",
    "app.heartbeat": "系统心跳",
    "app.sysCheck": "系统检查",
    "app.weather": "天气",
    "app.weatherUpdate": "天气更新",
    "app.routine": "行程节点",
    "app.routineFrom": "行程推进",
    "chat.heartbeat": "🫀 心跳 · {body}",
    "chat.weather": "🌦️ 天气 · {body}",
    "chat.routine": "🚗 {action} · {loc}",
    "chat.empty": "（空消息）",
    "plan.badge": "行程规划 · {n} 个住宿点",
    "plan.label": "行程规划",
    "plan.stays": "行程规划 · 住宿",
    "ribbon.prep": "行前",
    "ribbon.now": "当前",
    "ribbon.locked": "待揭晓",
    "confirm.rewind": "清空对话、Agent 记忆与 trajectory，并回溯到行程起点？",
    "toast.rewound": "已清空回溯到起点",
    "geo.shanghai_home": "上海·家中",
    "geo.christchurch": "基督城",
    "geo.tekapo": "蒂卡波",
    "geo.mt_cook": "库克山",
    "geo.queenstown": "皇后镇",
    "geo.wanaka": "瓦纳卡",
    "geo.milford": "米尔福德",
    "geo.te_anau": "蒂阿瑙",
    "geo.picton": "皮克顿",
    "geo.wellington": "惠灵顿",
    "geo.taupo": "陶波",
    "geo.rotorua": "罗托鲁阿",
    "geo.auckland": "奥克兰",
  },
  en: {
    "lang.zh": "中",
    "lang.en": "EN",
    "lang.toast.zh": "界面语言：中文",
    "lang.toast.en": "Language · English",
    "lang.btnTitle": "Switch 中文 / English",
    "top.speed": "Speed",
    "top.speedTitle": "Animation & replay speed",
    "top.speedAria": "Playback speed",
    "top.autoplay": "Autoplay",
    "top.autoplayStop": "Stop autoplay",
    "top.autoplayStart": "Start auto demo",
    "top.replay": "Fast replay",
    "top.replayTitle": "After a run, replay all animations & cached model results (no new LLM calls)",
    "top.rewind": "Clear & rewind",
    "top.rewindTitle": "Clear chat, trajectory, and rewind to trip start",
    "top.console": "Demo console",
    "map.controls": "Map controls",
    "map.zoomIn": "Zoom in",
    "map.zoomOut": "Zoom out",
    "map.clear": "Clear map overlays",
    "map.planning": "Routing…",
    "map.legendTitle": "Map legend",
    "map.legendHead": "Map legend",
    "map.legendClose": "Close",
    "map.leg.done": "Driven",
    "map.leg.route": "Planned",
    "map.leg.live": "Current leg",
    "map.leg.plan": "Draft / adjust",
    "map.leg.stay": "Planned stays",
    "map.leg.check": "Checking",
    "map.leg.flight": "Flights · flown / upcoming",
    "map.leg.ferry": "Ferry",
    "map.leg.close": "Confirmed closure",
    "phone.offline": "Offline",
    "phone.online": "Online",
    "phone.chatPlaceholder": "Type a message to keep chatting with the Agent…",
    "phone.send": "Send",
    "phone.tripTitle": "Trip ledger",
    "phone.tripSub": "Flights · Hotels · Calendar",
    "phone.mailTitle": "Inbox",
    "phone.mailSub": "Alerts · News · Archived mail",
    "phone.notesSub": "Notion trip journal",
    "phone.settingsTitle": "Demo console",
    "phone.settingsSub": "API · Autoplay · Export",
    "nav.chat": "Chat",
    "nav.trip": "Trip",
    "nav.mail": "Mail",
    "nav.notes": "Notes",
    "nav.settings": "Settings",
    "console.onboardTitle": "Start auto demo in two steps",
    "console.onboard1": "Pick a provider and paste your <strong>API Key</strong> (DeepSeek recommended)",
    "console.onboard2": "Tap <strong>Save & connect</strong>, then go back to Chat and press <strong>Start auto demo</strong>",
    "console.onboardNote": "The key stays on this device only; it is never echoed back when you reopen settings.",
    "console.hint":
      "Any <strong>OpenAI-compatible</strong> Chat Completions endpoint works. If the browser hits CORS: run <code>./start.sh</code> locally and set Base to <code>http://127.0.0.1:8787</code>.",
    "console.provider": "Provider",
    "console.apiKey": "API Key",
    "console.apiKeyPh": "Paste a new key (saved keys are never shown)",
    "console.apiBase": "API Base",
    "console.upstream": "Upstream Base (via local proxy)",
    "console.model": "Model",
    "console.thinking": "Enable Thinking / Reasoning (DeepSeek / some OpenAI·OpenRouter models)",
    "console.autoplayMs": "Autoplay interval (ms)",
    "console.caseFile": "Load a matching case file",
    "console.save": "Save & connect",
    "console.clearKey": "Clear key",
    "console.clearKeyTitle": "Clear the API key saved on this device",
    "console.export": "Export trajectory",
    "console.reset": "Clear & rewind",
    "console.back": "Back to chat",
    "status.location": "Location",
    "status.activity": "Activity",
    "status.weather": "Weather",
    "status.budget": "Budget",
    "status.visa": "Visa",
    "status.rental": "Campervan",
    "status.flight": "Booked flights",
    "status.notStarted": "Not started",
    "status.prep": "Pre-trip prep",
    "status.prepHint": "Start autoplay to begin",
    "status.budgetPending": "Updates after the user sets a budget",
    "status.budgetReady": "Confirmed · details update after bookings",
    "status.budgetUsed": "Spent ¥{spent} / ¥{total} · left ¥{remain}",
    "status.budgetUsedShort": "Spent ¥{spent} / ¥{total}",
    "tool.using": "Using tools",
    "tool.expand": "Show full text",
    "tool.collapse": "Collapse tools",
    "sms.badge": "SMS",
    "mail.badge": "Mail",
    "sms.system": "System",
    "kind.user_message": "User message",
    "kind.app_notification": "App / SMS",
    "kind.world": "External info",
    "kind.weather": "Weather update",
    "kind.mutation": "Silent change",
    "kind.notification": "Heartbeat",
    "kind.routine": "Trip node",
    "kind.env_change": "Environment change",
    "kind.agent_tool": "Agent tool",
    "kind.agent_reply": "Agent reply",
    "kind.agent_state": "Ledger change",
    "toast.newMail": "New email received",
    "toast.newSms": "New SMS notification",
    "toast.heartbeat": "Heartbeat: scanning trip risks",
    "toast.weatherOk": "Weather status updated",
    "toast.weatherBad": "⚠ Disruptive weather · {w}",
    "toast.routine": "Trip routine",
    "app.mail": "Mail",
    "app.sms": "SMS",
    "app.inbox": "Inbox",
    "app.smsNotify": "SMS alert",
    "app.external": "External alert",
    "app.heartbeat": "Heartbeat",
    "app.sysCheck": "System check",
    "app.weather": "Weather",
    "app.weatherUpdate": "Weather update",
    "app.routine": "Trip node",
    "app.routineFrom": "Trip progress",
    "chat.heartbeat": "🫀 Heartbeat · {body}",
    "chat.weather": "🌦️ Weather · {body}",
    "chat.routine": "🚗 {action} · {loc}",
    "chat.empty": "(empty)",
    "plan.badge": "Itinerary · {n} stays",
    "plan.label": "Itinerary",
    "plan.stays": "Itinerary · stays",
    "ribbon.prep": "Prep",
    "ribbon.now": "Now",
    "ribbon.locked": "Locked",
    "confirm.rewind": "Clear chat, Agent memory, and trajectory, then rewind to trip start?",
    "toast.rewound": "Cleared and rewound to start",
    "geo.shanghai_home": "Shanghai · Home",
    "geo.christchurch": "Christchurch",
    "geo.tekapo": "Tekapo",
    "geo.mt_cook": "Mt Cook",
    "geo.queenstown": "Queenstown",
    "geo.wanaka": "Wanaka",
    "geo.milford": "Milford",
    "geo.te_anau": "Te Anau",
    "geo.picton": "Picton",
    "geo.wellington": "Wellington",
    "geo.taupo": "Taupō",
    "geo.rotorua": "Rotorua",
    "geo.auckland": "Auckland",
  },
};

function fill(template, vars = {}) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : `{${k}}`
  );
}

export function getLocale() {
  return locale;
}

export function isEn() {
  return locale === "en";
}

export function t(key, vars) {
  const table = DICT[locale] || DICT.zh;
  const raw = table[key] ?? DICT.zh[key] ?? key;
  return vars ? fill(raw, vars) : raw;
}

export function onLocaleChange(fn) {
  if (typeof fn === "function") listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try {
      fn(locale);
    } catch {
      /* ignore */
    }
  }
}

export function applyDomI18n(root = document) {
  document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const val = t(key);
    if (el.hasAttribute("data-i18n-html")) el.innerHTML = val;
    else el.textContent = val;
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.setAttribute("placeholder", t(key));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) el.setAttribute("title", t(key));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (key) el.setAttribute("aria-label", t(key));
  });
  const btn = root.querySelector("#btnLang");
  if (btn) {
    btn.textContent = locale === "en" ? "中" : "EN";
    btn.setAttribute("title", t("lang.btnTitle"));
    btn.setAttribute("aria-label", t("lang.btnTitle"));
    btn.dataset.locale = locale;
  }
}

export async function loadI18nPacks() {
  const base = new URL("../data/", import.meta.url);
  try {
    const res = await fetch(new URL("i18n/en.json", base));
    if (res.ok) enPack = await res.json();
  } catch {
    enPack = null;
  }
  try {
    const res = await fetch(new URL("workspace.en.json", base));
    if (res.ok) workspaceEn = await res.json();
  } catch {
    workspaceEn = null;
  }
  return { enPack, workspaceEn };
}

export function getWorkspaceEn() {
  return workspaceEn;
}

export function getEnPack() {
  return enPack;
}

function phrase(bucket, zh) {
  if (!zh || locale !== "en" || !enPack?.phrases?.[bucket]) return zh;
  return enPack.phrases[bucket][zh] || zh;
}

export function localizeUserState(state) {
  if (!state || locale !== "en") return state ? { ...state } : state;
  const out = { ...state };
  if (out.location) out.location = phrase("locations", out.location);
  if (out.trip_node) out.trip_node = phrase("trip_nodes", out.trip_node);
  if (out.demo_action) out.demo_action = phrase("demo_actions", out.demo_action);
  if (typeof out.weather === "string") out.weather = phrase("weather", out.weather);
  if (out.next_flight && typeof out.next_flight === "object") {
    out.next_flight = { ...out.next_flight };
    if (out.next_flight.note) {
      out.next_flight.note = phrase("flight_notes", out.next_flight.note);
    }
  }
  return out;
}

/** Deep-merge object overlays (user_state from pack). */
function mergeState(base, overlay) {
  if (!overlay) return base;
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(overlay)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = mergeState(out[k], v);
    } else if (v != null) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Return a shallow-cloned event with body + user_state localized for current locale.
 */
export function localizeEvent(ev) {
  if (!ev) return ev;
  if (locale !== "en" || !enPack) {
    return { ...ev, user_state: ev.user_state ? { ...ev.user_state } : ev.user_state };
  }
  const pack = enPack.events?.[ev.id] || {};
  let body = pack.body != null ? pack.body : ev.body;
  let user_state = localizeUserState(ev.user_state);
  if (pack.user_state) user_state = mergeState(user_state, pack.user_state);
  return { ...ev, body, user_state };
}

export function localizeMeta(meta) {
  if (!meta) return meta;
  if (locale !== "en" || !enPack?.meta) return meta;
  const m = enPack.meta;
  const out = { ...meta };
  if (m.title) out.title = m.title;
  if (m.subtitle) out.subtitle = m.subtitle;
  if (m.kind_labels) out.kind_labels = { ...(meta.kind_labels || {}), ...m.kind_labels };
  if (Array.isArray(meta.trip_days) && m.trip_days) {
    out.trip_days = meta.trip_days.map((d) => {
      const patch = m.trip_days[String(d.day)] || m.trip_days[d.day];
      return patch ? { ...d, ...patch } : d;
    });
  }
  if (Array.isArray(meta.prep_days) && m.prep_days) {
    out.prep_days = meta.prep_days.map((d) => {
      const patch = m.prep_days[String(d.day)] || m.prep_days[d.day];
      return patch ? { ...d, ...patch } : d;
    });
  }
  return out;
}

export function workspaceForLocale(workspaceZh) {
  if (locale === "en" && workspaceEn && Object.keys(workspaceEn).length) {
    return workspaceEn;
  }
  return workspaceZh || {};
}

export function kindLabel(kind) {
  const key = `kind.${kind}`;
  const translated = t(key);
  if (translated !== key) return translated;
  if (locale === "en" && enPack?.meta?.kind_labels?.[kind]) {
    return enPack.meta.kind_labels[kind];
  }
  return kind;
}

export function geoDisplayName(geoKey) {
  const g = String(geoKey || "").toLowerCase();
  const key = `geo.${g}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return geoKey || "";
}

export function setLocale(next, { persist = true, silent = false } = {}) {
  const loc = next === "en" ? "en" : "zh";
  if (loc === locale) {
    applyDomI18n();
    return locale;
  }
  locale = loc;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  }
  applyDomI18n();
  if (!silent) notify();
  return locale;
}

export function initLocaleFromStorage() {
  let saved = "zh";
  try {
    saved = localStorage.getItem(STORAGE_KEY) || "zh";
  } catch {
    saved = "zh";
  }
  locale = saved === "en" ? "en" : "zh";
  applyDomI18n();
  return locale;
}

export function toggleLocale() {
  return setLocale(locale === "en" ? "zh" : "en");
}
