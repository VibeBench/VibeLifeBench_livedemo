/**
 * Generic case loader — works with any vibelifebench event.yaml of the same schema:
 *   stages: { N: [ { id, time, kind, body?, user_state?, from?, source?, channel?, apply?, silent? } ] }
 */
export const EVENT_KINDS = [
  "user_message",
  "app_notification",
  "world",
  "weather",
  "mutation",
  "notification",
  "routine",
  "env_change",
];

export async function loadDefaultCase(base = "./data") {
  const [events, meta, env, workspace] = await Promise.all([
    fetchJson(`${base}/events.json`),
    fetchJson(`${base}/meta.json`),
    fetchJson(`${base}/env_state.json`),
    fetchJson(`${base}/workspace.json`),
  ]);
  return normalizeCase({ events, meta, env, workspace });
}

export async function loadCaseFromFile(file) {
  const text = await file.text();
  const name = (file.name || "").toLowerCase();
  let raw;
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    if (typeof window.jsyaml === "undefined") {
      throw new Error("js-yaml not loaded — cannot parse YAML");
    }
    raw = window.jsyaml.load(text);
  } else {
    raw = JSON.parse(text);
  }
  return normalizeCaseFromRaw(raw, file.name);
}

export function normalizeCaseFromRaw(raw, sourceName = "uploaded") {
  // Accept either {stages:...} or full bundle {events, meta, env}
  if (raw.events?.stages || raw.stages) {
    const stages = raw.events?.stages || raw.stages;
    const events = { stages: coerceStages(stages) };
    const meta = raw.meta || buildMetaFallback(events.stages, sourceName);
    const env = raw.env || raw.env_state || emptyEnv();
    const workspace = raw.workspace || {};
    return normalizeCase({ events, meta, env, workspace });
  }
  throw new Error("Unrecognized case format: need top-level `stages` map");
}

export function normalizeCase({ events, meta, env, workspace }) {
  const stages = coerceStages(events.stages || {});
  const flat = flattenEvents(stages);
  const merged = { ...defaultMeta(), ...meta };
  if (!merged.prep_days?.length && merged.trip_days?.[0]?.date) {
    merged.prep_days = derivePrepDays(flat, merged.trip_days[0].date);
  }
  return {
    events: { stages },
    meta: merged,
    env: structuredClone(env || emptyEnv()),
    workspace: workspace || {},
    flat,
  };
}

/** Calendar days strictly before trip Day 1. */
function derivePrepDays(flat, firstTripDate) {
  const byDate = new Map();
  for (const ev of flat || []) {
    const d = String(ev.time || "").slice(0, 10);
    if (!d || (firstTripDate && d >= firstTripDate)) continue;
    if (!byDate.has(d)) {
      byDate.set(d, {
        date: d,
        stages: [],
        label: ev.user_state?.demo_action || "行前",
        place: (ev.user_state?.location || "上海").split("·")[0].trim().slice(0, 8) || "上海",
      });
    }
    const bucket = byDate.get(d);
    if (ev.stage != null && !bucket.stages.includes(ev.stage)) bucket.stages.push(ev.stage);
    if (ev.user_state?.demo_action && bucket.label === "行前") {
      bucket.label = String(ev.user_state.demo_action).slice(0, 10);
    }
  }
  return [...byDate.keys()].sort().map((d, i) => {
    const info = byDate.get(d);
    const dt = new Date(d + "T12:00:00");
    return {
      day: i + 1,
      date: d,
      label: shortLabel(info.label),
      icon: "pin",
      place: info.place,
      weekday: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][dt.getDay()],
      md: `${dt.getMonth() + 1}/${dt.getDate()}`,
      stages: info.stages,
    };
  });
}

function coerceStages(stages) {
  const out = {};
  for (const [k, evs] of Object.entries(stages || {})) {
    const idx = String(Number(k));
    out[idx] = (evs || []).map((ev) => ({
      id: ev.id || `ev_${idx}_${Math.random().toString(36).slice(2, 7)}`,
      time: ev.time || "",
      kind: ev.kind || "notification",
      from: ev.from || null,
      source: ev.source || ev.channel || null,
      channel: ev.channel || null,
      body: (ev.body || "").trim?.() ? String(ev.body).replace(/\s+$/, "") : ev.body || "",
      user_state: ev.user_state || null,
      apply: ev.apply || null,
      silent: Boolean(ev.silent),
      stage: Number(k),
    }));
    out[idx].sort((a, b) => String(a.time).localeCompare(String(b.time)) || String(a.id).localeCompare(String(b.id)));
  }
  return out;
}

export function flattenEvents(stages) {
  const keys = Object.keys(stages)
    .map(Number)
    .sort((a, b) => a - b);
  const list = [];
  for (const s of keys) {
    for (const ev of stages[String(s)] || []) {
      list.push({ ...ev, stage: s, flatIndex: list.length });
    }
  }
  return list;
}

function defaultMeta() {
  return {
    case_id: "case",
    title: "AI Travel Agent Demo",
    subtitle: "VibeLifeBench",
    budget_total_cny: 50000,
    trip_days: [],
    prep_days: [],
    speakers: {
      wang_li: { name: "王力", role: "user" },
      zhao_mei: { name: "赵梅", role: "user" },
      friend_lin: { name: "林建国", role: "friend" },
    },
    kind_labels: {
      user_message: "用户输入",
      app_notification: "APP/短信",
      world: "外部信息",
      weather: "日期天气",
      mutation: "静默变更",
      notification: "系统心跳",
      routine: "日常节点",
      env_change: "环境变更",
    },
    schema_version: 1,
  };
}

function buildMetaFallback(stages, sourceName) {
  const meta = defaultMeta();
  meta.case_id = sourceName.replace(/\.(ya?ml|json)$/i, "");
  // Derive trip days from unique dates with user_state
  const byDate = new Map();
  for (const [sk, evs] of Object.entries(stages)) {
    for (const ev of evs) {
      const d = String(ev.time || "").slice(0, 10);
      if (!d) continue;
      if (!byDate.has(d)) byDate.set(d, { date: d, stages: [], label: ev.user_state?.trip_node || d, place: ev.user_state?.location || "" });
      const bucket = byDate.get(d);
      const si = Number(sk);
      if (!bucket.stages.includes(si)) bucket.stages.push(si);
    }
  }
  const dates = [...byDate.keys()].sort();
  // Heuristic: treat the longest trailing contiguous block as trip days;
  // everything before the first NZ-ish stretch stays as prep when possible.
  // Fallback: all dates are trip days; normalizeCase will still derive prep_days
  // if trip_days[0] is set from a later override.
  meta.trip_days = dates.map((d, i) => {
    const info = byDate.get(d);
    const dt = new Date(d + "T12:00:00");
    return {
      day: i + 1,
      date: d,
      label: shortLabel(info.label || info.place),
      icon: "pin",
      place: info.place,
      weekday: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][dt.getDay()],
      md: `${dt.getMonth() + 1}/${dt.getDate()}`,
      stages: info.stages,
    };
  });
  return meta;
}

function shortLabel(s) {
  if (!s) return "Day";
  const t = String(s).replace(/^在途-/, "").replace(/^行前.*/, "Prep");
  return t.slice(0, 12);
}

function emptyEnv() {
  return {
    weather: { locations: [], daily_weather: [] },
    maps: {
      places: [],
      roads: [],
      road_events: [],
      transit_lines: [],
      transit_stops: [],
      transit_events: [],
      place_geo_map: {},
    },
    flights: {},
    hotels: {},
    ledger: {
      flights: [],
      hotels: [],
      calendar: [],
      notion: { title: "NZ Road Trip 2026 — Journal", sections: { journal: "", expense: "", safety: "" } },
      changes: [],
    },
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

/** Render event into the same agent-facing text as task.py */
export function renderEventForAgent(ev) {
  const time = ev.time || "";
  const kind = ev.kind || "";
  const body = ev.body || "";
  const src = ev.channel || ev.source || "system";
  let tag;
  if (kind === "user_message") tag = `[Message from ${ev.from || "user"} @ ${time}]`;
  else if (kind === "notification" || kind === "app_notification") tag = `[Notification @ ${time} from ${src}]`;
  else if (kind === "world" || kind === "env_change") tag = `[World event @ ${time} from ${src}]`;
  else if (kind === "weather") tag = `[Weather state @ ${time} from ${src}]`;
  else if (kind === "routine") tag = `[Routine trip node @ ${time}]`;
  else tag = `[${kind} @ ${time}]`;

  const st = ev.user_state || {};
  const parts = [];
  if (st.location) parts.push(`location=${st.location}`);
  if (st.geo_key) parts.push(`geo_key=${st.geo_key}`);
  if (st.trip_node) parts.push(`trip_node=${st.trip_node}`);
  if (st.demo_action) parts.push(`status=${st.demo_action}`);
  if (st.weather) parts.push(`weather=${st.weather}`);
  if (st.weather_impact) parts.push(`weather_impact=${st.weather_impact}`);
  if (st.budget) {
    parts.push(`budget=spent ${st.budget.spent_cny}/${st.budget.total_cny} CNY remaining ${st.budget.remaining_cny}`);
  }
  if (st.next_flight) {
    const f = st.next_flight;
    parts.push(`next_flight=${f.flight_no || "none"} ${f.status || ""} ${f.note || ""}`);
  }
  const stateLine = parts.length ? `[User state: ${parts.join(", ")}]` : "";
  const header = stateLine ? `${tag}\n${stateLine}` : tag;
  return body ? `${header}\n${body}` : header;
}
