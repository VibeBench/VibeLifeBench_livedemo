/**
 * Map: Leaflet + Esri topo (north-up).
 * - Fog-of-war place pins (only revealed days)
 * - Drive plan: solid = already driven, dashed = planned ahead
 * - Live day state: green animated route + activity emoji
 * - Pre-trip phases: home only → +计划抵达(机票已订) → +航班虚线(已到机场)
 */
import {
  SOUTH_SPINE,
  NORTH_SPINE,
  MT_COOK_SPUR,
  WANAKA_SPUR,
  TRANSFER_DAY2,
  DATE_DRIVE_LEGS,
  resolveTodayDriveIds,
  buildDrivingPath,
  parseRoadGeom,
  loadPrecomputedRoutes,
} from "./routing.js?v=20260720-52";

/** Cook Strait ferry calendar day (case itinerary). */
const FERRY_DATE = "2026-10-19";

const DEFAULT_PLACE_GEO = {
  pl_chc_airport: "christchurch",
  pl_tekapo: "tekapo",
  pl_mt_cook: "mt_cook",
  pl_queenstown: "queenstown",
  pl_milford: "milford",
  pl_wanaka: "wanaka",
  pl_picton: "picton",
  pl_wellington: "wellington",
  pl_taupo: "taupo",
  pl_rotorua: "rotorua",
  pl_akl_airport: "auckland",
};

const SHANGHAI_HOME = { lat: 31.2304, lng: 121.4737, name: "上海·家中", geo_key: "shanghai_home" };

let leafletMap = null;
let leafletLayer = null;
let routeLayer = null;
let activityLayer = null;
let pulseLayer = null;
let planningLayer = null;
let tileWatch = null;
let lastCtx = null;
let drawToken = 0;
let travelerAnim = null;
let bannerHideTimer = null;
/** Alert signature user dismissed / auto-hid — don't keep blocking the map. */
let dismissedAlertKey = null;
let mapResizeObs = null;
let mapResizeTimer = null;
let pulseTimers = [];
/** Agent route-planning overlay (thinking / tools). */
let planningToken = 0;
let planningActive = false;
let planningFocusLatLngs = null;
let lastPlanningKey = "";
let planningClearTimer = null;
/** One-shot ocean-crossing flight animation. */
let flightLayer = null;
let flightAnim = null;
let flightCrossingActive = false;
/** Bumped on rewind/reset — async overlays must check before painting. */
let mapSession = 1;
let mapActionToken = 0;
/** Persistent post-plan itinerary overlay (stays + corridor). */
let agentPlanLayer = null;
/** @type {null | { stays: object[], routePlaceIds: string[], label?: string }} */
let lastAgentPlan = null;

export function currentMapSession() {
  return mapSession;
}

export function isMapSession(session) {
  return session === mapSession;
}

/** Hard-stop every in-flight map overlay / timer (call on 清空回溯). */
export function abortMapPlayback() {
  mapSession += 1;
  mapActionToken += 1;
  drawToken += 1;
  planningToken += 1;
  clearTimeout(mapActionTimer);
  mapActionTimer = null;
  hideMapActionStage();
  clearPulseTimers();
  clearTimeout(planningClearTimer);
  planningClearTimer = null;
  planningActive = false;
  planningFocusLatLngs = null;
  lastPlanningKey = "";
  try {
    planningLayer?.clearLayers();
  } catch {
    /* ignore */
  }
  setPlanningBadge("");
  stopTravelerAnim();
  stopFlightCrossing();
  try {
    pulseLayer?.clearLayers();
  } catch {
    /* ignore */
  }
  try {
    activityLayer?.clearLayers();
  } catch {
    /* ignore */
  }
  // Keep lastAgentPlan so a map rebuild can repaint; explicit clearAgentPlan on rewind.
  try {
    agentPlanLayer?.clearLayers();
  } catch {
    /* ignore */
  }
  // Remove floating status-fly cards left mid-animation.
  for (const el of document.querySelectorAll(".status-fly")) {
    try {
      el.remove();
    } catch {
      /* ignore */
    }
  }
}

function clearPulseTimers() {
  for (const t of pulseTimers) clearTimeout(t);
  pulseTimers = [];
  const rail = document.querySelector("#mapToastRail");
  if (rail) rail.replaceChildren();
}

/**
 * Transient feedback: prefer a bubble anchored near the related place;
 * fall back to mid-rail toast + traveler ping when no location is known.
 * Returns a Promise that resolves when the pulse finishes (for cinematic queue).
 */
export function pulseMapEvent({
  icon = "📌",
  label = "",
  title = "",
  detail = "",
  kind = "",
  durationMs = 3200,
  placeId = null,
  geoKey = null,
  roadId = null,
  latlng = null,
  rail = null,
  /** Full-opacity hold before fade (weather / bubbles default 2000ms). */
  holdMs = 2000,
} = {}) {
  const head = String(title || label || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  const sub = String(detail || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  const kindCls = String(kind || "")
    .replace(/[^a-z0-9_-]/gi, "")
    .slice(0, 24);

  const at = resolvePulseLatLng({ placeId, geoKey, roadId, latlng });
  const hold = Math.max(2000, Number(holdMs) || 2000);
  // enter ~400ms + hold + leave ~450ms
  const totalMs = Math.max(durationMs, hold + 900);

  // Weather: place bubble tip on the queried location (prefer city center coords).
  if (kindCls === "weather" || /weather/i.test(String(kind || ""))) {
    // Prefer geo_key → weather.locations so tip matches the city, not an airport pin.
    const weatherAt =
      resolvePulseLatLng({ placeId: null, geoKey, roadId: null, latlng }) || at;
    if (weatherAt) {
      return pulsePlaceBubble({
        icon: icon || "🌦️",
        head: head || "天气",
        sub,
        kindCls: "weather",
        latlng: weatherAt,
        durationMs: totalMs,
        holdMs: hold,
      });
    }
    return pulseWeatherEmoji({
      icon: icon || "🌦️",
      durationMs: totalMs,
      holdMs: hold,
      latlng: undefined,
    });
  }

  // SMS / email / world notices: pan to the traveler and shake an emoji on their pin.
  if (/^(world|app_notification|sms|email|mail)$/i.test(kindCls)) {
    const isMail =
      /^(email|mail)$/i.test(kindCls) || String(icon || "").includes("✉️");
    return pulseSmsOnUser({
      icon: icon || (isMail ? "✉️" : "💬"),
      durationMs: Math.min(2800, totalMs),
    });
  }

  if (at) {
    const p = pulsePlaceBubble({
      icon,
      head,
      sub,
      kindCls,
      latlng: at,
      durationMs: totalMs,
      holdMs: hold,
    });
    if (rail === true) pushToastRail({ icon, head, sub, kindCls, durationMs: totalMs });
    return p;
  }

  if (rail !== false) pushToastRail({ icon, head, sub, kindCls, durationMs: totalMs });
  pulseTinyPin({ icon, durationMs: Math.min(2800, totalMs) });
  return new Promise((r) => setTimeout(() => r(true), Math.min(2800, totalMs)));
}

function resolvePulseLatLng({ placeId = null, geoKey = null, roadId = null, latlng = null } = {}) {
  if (!window.L) return null;
  if (Array.isArray(latlng) && latlng.length >= 2) {
    return window.L.latLng(latlng[0], latlng[1]);
  }
  if (latlng && typeof latlng.lat === "number") return window.L.latLng(latlng.lat, latlng.lng);

  if (placeId && lastCtx?.placeById?.[placeId]) {
    const p = lastCtx.placeById[placeId];
    return window.L.latLng(p.lat, p.lng);
  }

  const geo = String(geoKey || "").toLowerCase();
  if (geo) {
    // Prefer weather.locations (city center) over place pins (often airports).
    const loc = (lastCtx?.locations || []).find(
      (l) => String(l.geo_key || "").toLowerCase() === geo
    );
    if (loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))) {
      return window.L.latLng(Number(loc.lat), Number(loc.lng));
    }
    const id = GEO_TO_PLACE[geo];
    if (id && lastCtx?.placeById?.[id]) {
      const p = lastCtx.placeById[id];
      return window.L.latLng(p.lat, p.lng);
    }
    if (lastCtx?.home && geo === "shanghai_home") {
      return window.L.latLng(lastCtx.home.lat, lastCtx.home.lng);
    }
  }

  if (roadId && lastCtx?.roadById?.[roadId]) {
    const road = lastCtx.roadById[roadId];
    const geom = parseRoadGeom(road.geom || road.geom_json);
    if (geom.length) {
      const mid = geom[Math.floor(geom.length / 2)];
      return window.L.latLng(mid[0], mid[1]);
    }
  }

  return null;
}

function pushToastRail({ icon, head, sub, kindCls, durationMs }) {
  const rail = document.querySelector("#mapToastRail");
  if (!rail) return;

  while (rail.children.length >= 3) {
    rail.firstElementChild?.remove();
  }

  const card = document.createElement("div");
  card.className = `map-pulse-card${sub ? " has-detail" : ""}${kindCls ? ` pulse-${kindCls}` : ""}`;
  card.innerHTML = `
    <span class="map-pulse-ring" aria-hidden="true"></span>
    <span class="map-pulse-ico">${icon}</span>
    <span class="map-pulse-text">
      ${head ? `<span class="map-pulse-title">${escapeHtml(head)}</span>` : ""}
      ${sub ? `<span class="map-pulse-detail">${escapeHtml(sub)}</span>` : ""}
    </span>`;
  rail.appendChild(card);

  const fadeAt = Math.max(1600, durationMs - 500);
  const t1 = setTimeout(() => card.classList.add("is-leaving"), fadeAt);
  const t2 = setTimeout(() => {
    try {
      card.remove();
    } catch {
      /* ignore */
    }
  }, durationMs);
  pulseTimers.push(t1, t2);
  if (pulseTimers.length > 48) pulseTimers = pulseTimers.slice(-24);
}

function pulseTinyPin({ icon = "📌", durationMs = 2400, latlng = null } = {}) {
  if (!leafletMap || !window.L) return;
  if (!pulseLayer) pulseLayer = window.L.layerGroup().addTo(leafletMap);

  const here = lastCtx ? placeLatLng(lastCtx) : null;
  const center = leafletMap.getCenter();
  const at =
    latlng ||
    window.L.latLng(here?.[0] ?? center.lat, here?.[1] ?? center.lng);

  const marker = window.L.marker(at, {
    icon: window.L.divIcon({
      className: "map-event-ping",
      html: `<span class="map-ping-ring"></span><span class="map-ping-ico">${icon}</span>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    }),
    interactive: false,
    keyboard: false,
    zIndexOffset: 900,
  }).addTo(pulseLayer);

  const t = setTimeout(() => {
    try {
      pulseLayer?.removeLayer(marker);
    } catch {
      /* ignore */
    }
  }, durationMs);
  pulseTimers.push(t);
}

/** Weather result: large emoji floating above the place (clear of 「现在」 orb). */
function pulseWeatherEmoji({ icon = "🌦️", durationMs = 3200, holdMs = 2000, latlng = null } = {}) {
  return new Promise((resolve) => {
    if (!leafletMap || !window.L) {
      resolve(false);
      return;
    }
    if (!pulseLayer) pulseLayer = window.L.layerGroup().addTo(leafletMap);

    const here = lastCtx ? placeLatLng(lastCtx) : null;
    const center = leafletMap.getCenter();
    const at =
      latlng ||
      window.L.latLng(here?.[0] ?? center.lat, here?.[1] ?? center.lng);

    const marker = window.L.marker(at, {
      icon: window.L.divIcon({
        className: "map-weather-emoji-wrap",
        html: `
        <div class="map-weather-emoji" aria-hidden="true">
          <span class="map-weather-emoji-ring"></span>
          <span class="map-weather-emoji-ico">${icon || "🌦️"}</span>
        </div>`,
        iconSize: [56, 56],
        iconAnchor: [28, 72],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1800,
    }).addTo(pulseLayer);

    const hold = Math.max(2000, Number(holdMs) || 2000);
    const fadeAt = 400 + hold;
    const total = Math.max(durationMs, fadeAt + 450);
    const t1 = setTimeout(() => {
      try {
        marker.getElement()?.querySelector(".map-weather-emoji")?.classList.add("is-leaving");
      } catch {
        /* ignore */
      }
    }, fadeAt);
    const t2 = setTimeout(() => {
      try {
        pulseLayer?.removeLayer(marker);
      } catch {
        /* ignore */
      }
      resolve(true);
    }, total);
    pulseTimers.push(t1, t2);
  });
}

/** Traveler / home pin latlng for SMS ping + camera focus. */
function resolveUserLatLng() {
  if (!window.L || !lastCtx) return null;
  if (lastCtx.isHome && lastCtx.home?.lat != null) {
    return window.L.latLng(lastCtx.home.lat, lastCtx.home.lng);
  }
  const here = placeLatLng(lastCtx);
  if (here) return window.L.latLng(here[0], here[1]);
  if (lastCtx.home?.lat != null) {
    return window.L.latLng(lastCtx.home.lat, lastCtx.home.lng);
  }
  return null;
}

/**
 * Short message cue: pan to the user marker and shake a notification emoji on it.
 * (No map SMS bubble — phone chat already shows the text.)
 */
function pulseSmsOnUser({ icon = "💬", durationMs = 2600 } = {}) {
  return new Promise((resolve) => {
    if (!leafletMap || !window.L) {
      resolve(false);
      return;
    }
    const latlng = resolveUserLatLng();
    if (!latlng) {
      pulseTinyPin({ icon, durationMs: Math.min(2400, durationMs) });
      resolve(true);
      return;
    }

    setViewInSafeArea(latlng, lastCtx?.isHome ? 10 : 11);

    if (!pulseLayer) pulseLayer = window.L.layerGroup().addTo(leafletMap);
    const emoji = String(icon || "💬").trim() || "💬";
    const marker = window.L.marker(latlng, {
      icon: window.L.divIcon({
        className: "map-sms-ping-wrap",
        html: `<div class="map-sms-ping" aria-hidden="true"><span class="map-sms-ping-ico">${emoji}</span></div>`,
        iconSize: [44, 44],
        // Sit just above the「现在」orb / home emoji center.
        iconAnchor: [22, 58],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 2200,
    }).addTo(pulseLayer);

    const total = Math.max(1800, Number(durationMs) || 2600);
    const t1 = setTimeout(() => {
      try {
        marker.getElement()?.querySelector(".map-sms-ping")?.classList.add("is-leaving");
      } catch {
        /* ignore */
      }
    }, Math.max(1000, total - 380));
    const t2 = setTimeout(() => {
      try {
        pulseLayer?.removeLayer(marker);
      } catch {
        /* ignore */
      }
      resolve(true);
    }, total);
    pulseTimers.push(t1, t2);
    if (pulseTimers.length > 64) pulseTimers = pulseTimers.slice(-32);
  });
}

/** Message bubble anchored next to a place / road on the map. */
function pulsePlaceBubble({ icon, head, sub, kindCls, latlng, durationMs, holdMs = 2000 }) {
  return new Promise((resolve) => {
    if (!leafletMap || !window.L || !latlng) {
      resolve(false);
      return;
    }
    if (!pulseLayer) pulseLayer = window.L.layerGroup().addTo(leafletMap);

    const isSms = /^(world|app_notification|sms|email|mail)$/i.test(String(kindCls || ""));
    const title = String(head || "").trim();
    const detail = String(sub || "").trim();
    const smsBody = (detail && detail !== title ? detail : title).slice(0, 72);
    const isMail =
      /^(email|mail)$/i.test(String(kindCls || "")) ||
      String(icon || "").includes("✉️") ||
      /邮件|收件箱|@\w+\.\w+/i.test(`${title} ${detail}`);
    const smsFrom = isSms
      ? isMail
        ? "收件箱"
        : /移民|签证|NZeTA|海关/i.test(`${title} ${detail}`)
          ? "新西兰移民局"
          : /租车|房车|Britz/i.test(`${title} ${detail}`)
            ? "租车"
            : "系统通知"
      : "";
    const smsBadge = isMail ? "邮件" : "短信";

    const html = isSms
      ? `
    <div class="map-sms-anchor">
      <div class="map-sms-bubble${isMail ? " is-mail" : ""}${kindCls ? ` pulse-${kindCls}` : ""}">
        <div class="map-sms-head">
          <span class="map-sms-badge">${smsBadge}</span>
          <span class="map-sms-from">${escapeHtml(smsFrom)}</span>
        </div>
        <div class="map-sms-body">${escapeHtml(smsBody)}</div>
        <span class="map-sms-pin" aria-hidden="true"></span>
      </div>
    </div>`
      : `
    <div class="map-place-bubble-anchor">
      <div class="map-place-bubble${sub ? " has-detail" : ""}${kindCls ? ` pulse-${kindCls}` : ""}">
        <span class="map-place-bubble-ico">${icon || "📍"}</span>
        <span class="map-place-bubble-text">
          ${head ? `<span class="map-place-bubble-title">${escapeHtml(head)}</span>` : ""}
          ${sub ? `<div class="map-place-bubble-detail">${escapeHtml(sub)}</div>` : ""}
        </span>
        <span class="map-place-bubble-pin" aria-hidden="true"></span>
      </div>
    </div>`;

    // 0×0 icon: CSS positions the tip at (0,0) = latlng, independent of bubble height.
    const marker = window.L.marker(latlng, {
      icon: window.L.divIcon({
        className: isSms ? "map-sms-wrap" : "map-place-bubble-wrap",
        html,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1600,
    }).addTo(pulseLayer);

    // Soft ping on the exact place the tip points to
    pulseTinyPin({ icon: "", durationMs: Math.min(2400, durationMs), latlng });

    const hold = Math.max(2000, Number(holdMs) || 2000);
    const fadeAt = 400 + hold; // enter anim ~400ms, then hold ≥2s
    const total = Math.max(Number(durationMs) || 0, fadeAt + 450);
    const t1 = setTimeout(() => {
      try {
        const el = marker
          .getElement()
          ?.querySelector(isSms ? ".map-sms-bubble" : ".map-place-bubble");
        el?.classList.add("is-leaving");
      } catch {
        /* ignore */
      }
    }, fadeAt);
    const t2 = setTimeout(() => {
      try {
        pulseLayer?.removeLayer(marker);
      } catch {
        /* ignore */
      }
      resolve(true);
    }, total);
    pulseTimers.push(t1, t2);
    if (pulseTimers.length > 64) pulseTimers = pulseTimers.slice(-32);
  });
}

const PLACE_MENTION_PATTERNS = [
  { re: /库克山|Mt\.?\s*Cook|Aoraki/gi, id: "pl_mt_cook" },
  { re: /蒂卡波|Tekapo/gi, id: "pl_tekapo" },
  { re: /皇后镇|Queenstown/gi, id: "pl_queenstown" },
  { re: /瓦纳卡|Wanaka/gi, id: "pl_wanaka" },
  { re: /米尔福德|马纳普里|蒂阿瑙|Milford|Manapouri|Te\s*Anau|峡湾/gi, id: "pl_milford" },
  { re: /皮克顿|Picton/gi, id: "pl_picton" },
  { re: /惠灵顿|Wellington/gi, id: "pl_wellington" },
  { re: /陶波|Taup[oō]/gi, id: "pl_taupo" },
  { re: /罗托鲁阿|Rotorua/gi, id: "pl_rotorua" },
  { re: /奥克兰|Auckland/gi, id: "pl_akl_airport" },
  { re: /基督城|Christchurch|\bCHC\b/gi, id: "pl_chc_airport" },
  { re: /上海|Shanghai/gi, id: "shanghai_home" },
];

const ROAD_MENTION_PATTERNS = [
  { re: /SH\s*80|国道\s*80|库克山公路|Mt\s*Cook\s*Road/gi, id: "rd_sh80_mtcook" },
  { re: /SH\s*94|国道\s*94|米尔福德公路|Milford\s*Road/gi, id: "rd_sh94_milford" },
  { re: /SH\s*8\b|国道\s*8\b|蒂卡波公路/gi, id: "rd_sh8_tekapo" },
];

const GEO_TO_PLACE = Object.fromEntries(
  Object.entries(DEFAULT_PLACE_GEO).map(([placeId, geo]) => [geo, placeId])
);

/** Ordered unique place ids mentioned in free text (thinking / replies). */
export function extractPlaceIdsFromText(text) {
  const s = String(text || "");
  if (!s.trim()) return [];
  const hits = [];
  for (const p of PLACE_MENTION_PATTERNS) {
    const re = new RegExp(p.re.source, "gi");
    let m;
    while ((m = re.exec(s))) hits.push({ i: m.index, id: p.id });
  }
  hits.sort((a, b) => a.i - b.i);
  const out = [];
  for (const h of hits) {
    if (h.id === "shanghai_home") continue;
    if (out[out.length - 1] !== h.id) out.push(h.id);
  }
  return out;
}

export function extractRoadIdsFromText(text) {
  const s = String(text || "");
  if (!s.trim()) return [];
  const out = [];
  const seen = new Set();
  for (const p of ROAD_MENTION_PATTERNS) {
    if (p.re.test(s) && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p.id);
    }
    p.re.lastIndex = 0;
  }
  return out;
}

function inferPlanningMode(text) {
  const s = String(text || "");
  // Confirmed blockage only — speculative "是否封闭 / 查一下" stays in checking (purple).
  if (/确认(?:了|为)?(?:受阻|封闭|封路)|已经封闭|目前仍?在?封闭|验证为|确实(?:封闭|无法通行)|仍在封闭/i.test(s)) {
    return "blocked";
  }
  if (/核查|查询路况|确认是否|是否封闭|检查路况|查一下.*(?:路|封)|看看.*封|路况如何/i.test(s)) {
    return "checking";
  }
  if (/封闭|封路|落石|雪崩|无法通行|cancelled|closed|暂缓前往|取消.*库克|defer/i.test(s)) {
    return "checking";
  }
  if (/改道|绕行|避开|调整路线|改走|改经|替代|alternate|reroute|via\s+wanaka|经瓦纳卡/i.test(s)) {
    return "adjust";
  }
  if (/通行正常|路况正常|可以通行|未封闭|无封路/i.test(s)) {
    return "clear";
  }
  return "consider";
}

/** True when text is actually about routing / roads — not budget, visa, packing, etc. */
function isRoutePlanningIntent(text) {
  const s = String(text || "");
  return /路线|改道|绕行|路况|封路|通行|自驾|开往|前往|开车|公路|路段|行程安排|重新规划|避开|封闭|渡轮时刻|ferry\s*route|drive|route|reroute|traffic|SH\s*\d+|国道/i.test(
    s
  );
}

/** Budget / money checks should never pull up a drive corridor. */
function isNonRouteIntent(text) {
  const s = String(text || "");
  if (isRoutePlanningIntent(s)) return false;
  return /预算|花费|费用|花了|还剩|够不够|机票钱|签证费|房车租金|住宿费|¥|￥|CNY|NZD|budget|cost|expense|price/i.test(
    s
  );
}

function planningStyle(mode) {
  if (mode === "blocked") {
    return { color: "#e11d48", weight: 6, opacity: 0.92, dashArray: "10 8", className: "route-planning-line route-planning-blocked" };
  }
  if (mode === "checking") {
    return {
      color: "#38bdf8",
      weight: 5,
      opacity: 0.55,
      dashArray: "6 12",
      className: "route-planning-line route-planning-checking",
    };
  }
  if (mode === "clear") {
    return { color: "#16a34a", weight: 5, opacity: 0.88, dashArray: "10 8", className: "route-planning-line route-planning-clear" };
  }
  if (mode === "adjust") {
    return { color: "#d97706", weight: 6, opacity: 0.95, dashArray: "12 10", className: "route-planning-line route-planning-adjust" };
  }
  return { color: "#2563eb", weight: 5, opacity: 0.88, dashArray: "12 10", className: "route-planning-line" };
}

function setPlanningBadge(label, mode) {
  const el = document.querySelector("#mapPlanningBadge");
  const text = document.querySelector("#mapPlanningBadgeText");
  if (!el) return;
  if (!label) {
    el.hidden = true;
    el.setAttribute("hidden", "");
    el.dataset.mode = "";
    return;
  }
  el.hidden = false;
  el.removeAttribute("hidden");
  el.dataset.mode = mode || "consider";
  if (text) text.textContent = label;
}

/**
 * Focus map on agent route planning. Draws ephemeral overlay; does not replace itinerary.
 * @param {{ placeIds?: string[], roadIds?: string[], latlngs?: number[][], mode?: string, label?: string, force?: boolean }} opts
 */
export async function focusPlanning(opts = {}) {
  if (!leafletMap || !window.L) return false;
  const placeIds = [...new Set((opts.placeIds || []).filter(Boolean))];
  const roadIds = [...new Set((opts.roadIds || []).filter(Boolean))];
  const latlngs = Array.isArray(opts.latlngs) ? opts.latlngs : [];
  const mode = opts.mode || "consider";
  if (!placeIds.length && !roadIds.length && latlngs.length < 2) return false;

  const key = JSON.stringify({ placeIds, roadIds, mode });
  if (!opts.force && key === lastPlanningKey && planningActive) return true;
  lastPlanningKey = key;

  const token = ++planningToken;
  clearTimeout(planningClearTimer);
  planningClearTimer = null;

  if (!planningLayer) planningLayer = window.L.layerGroup().addTo(leafletMap);

  const focus = latlngs.map((ll) => window.L.latLng(ll[0], ll[1]));
  let path = [];

  if (lastCtx) {
    for (const rid of roadIds) {
      const road = lastCtx.roadById?.[rid];
      const geom = parseRoadGeom(road?.geom || road?.geom_json);
      for (const ll of geom) focus.push(window.L.latLng(ll[0], ll[1]));
    }
    for (const id of placeIds) {
      const p = lastCtx.placeById?.[id];
      if (p) focus.push(window.L.latLng(p.lat, p.lng));
    }
    if (placeIds.length >= 2) {
      try {
        path = await buildDrivingPath(lastCtx, placeIds);
      } catch {
        path = placeIds
          .map((id) => lastCtx.placeById?.[id])
          .filter(Boolean)
          .map((p) => [p.lat, p.lng]);
      }
    }
  }

  if (token !== planningToken) return false;

  planningLayer.clearLayers();
  const style = planningStyle(mode);

  if (path.length >= 2) {
    window.L.polyline(path, style)
      .addTo(planningLayer)
      .bindTooltip(
        opts.label ||
          (mode === "blocked"
            ? "确认受阻"
            : mode === "checking"
              ? "核查路况中"
              : mode === "clear"
                ? "路况正常"
                : mode === "adjust"
                  ? "调整后路线"
                  : "推演路线")
      );
    for (const ll of path) focus.push(window.L.latLng(ll[0], ll[1]));
  } else if (roadIds.length && lastCtx) {
    for (const rid of roadIds) {
      const road = lastCtx.roadById?.[rid];
      const geom = parseRoadGeom(road?.geom || road?.geom_json);
      if (geom.length >= 2) {
        window.L.polyline(geom, style)
          .addTo(planningLayer)
          .bindTooltip(road?.name || rid);
      }
    }
  } else if (placeIds.length >= 2 && lastCtx) {
    const straight = placeIds
      .map((id) => lastCtx.placeById?.[id])
      .filter(Boolean)
      .map((p) => [p.lat, p.lng]);
    if (straight.length >= 2) {
      window.L.polyline(straight, { ...style, opacity: 0.55 }).addTo(planningLayer);
    }
  }

  for (const id of placeIds) {
    const p = lastCtx?.placeById?.[id];
    if (!p) continue;
    window.L.circleMarker([p.lat, p.lng], {
      radius: 7,
      color: "#fff",
      weight: 2,
      fillColor: style.color,
      fillOpacity: 0.95,
    })
      .addTo(planningLayer)
      .bindTooltip(p.name || id);
  }

  planningActive = true;
  planningFocusLatLngs = focus.length ? focus : null;
  const badge =
    opts.label ||
    (mode === "blocked"
      ? "确认受阻 · 地图已标记"
      : mode === "checking"
        ? "核查路况中"
        : mode === "clear"
          ? "路况正常"
          : mode === "adjust"
            ? "路线调整中"
            : placeIds.length >= 2
              ? "路线推演中"
              : "地图聚焦中");
  setPlanningBadge(badge, mode === "clear" ? "consider" : mode);

  if (planningFocusLatLngs?.length === 1) {
    setViewInSafeArea(planningFocusLatLngs[0], 8);
  } else if (planningFocusLatLngs?.length > 1) {
    try {
      leafletMap.fitBounds(window.L.latLngBounds(planningFocusLatLngs), fitOptions({ maxZoom: 9, animate: true }));
    } catch {
      /* ignore */
    }
  }
  return true;
}

/**
 * Parse thinking / answer text and update planning overlay (throttled by caller).
 * Only draws routes when the text is clearly about routing — not budget / generic place name-drops.
 */
export async function syncPlanningFromText(text, { label, force = false } = {}) {
  const session = mapSession;
  const raw = String(text || "");
  if (!force && isNonRouteIntent(raw)) return false;
  if (!force && !isRoutePlanningIntent(raw)) return false;

  const placeIds = extractPlaceIdsFromText(raw);
  const roadIds = extractRoadIdsFromText(raw);
  // Need a real corridor or road — a single place name is not a route plan.
  if (roadIds.length < 1 && placeIds.length < 2) return false;

  const routeIds =
    placeIds.length >= 2 ? placeIds.slice(Math.max(0, placeIds.length - 4)) : placeIds;
  const mode = inferPlanningMode(raw);
  if (!isMapSession(session)) return false;
  return focusPlanning({
    placeIds: routeIds,
    roadIds,
    mode,
    label:
      label ||
      (mode === "blocked"
        ? "思考：路段受阻"
        : mode === "checking"
          ? "思考：核查路况"
          : mode === "clear"
            ? "思考：路况正常"
            : mode === "adjust"
              ? "思考：调整路线"
              : "思考：推演路线"),
  });
}

export function clearPlanning({ immediate = false } = {}) {
  const run = () => {
    planningToken += 1;
    planningActive = false;
    planningFocusLatLngs = null;
    lastPlanningKey = "";
    try {
      planningLayer?.clearLayers();
    } catch {
      /* ignore */
    }
    setPlanningBadge("");
  };
  clearTimeout(planningClearTimer);
  if (immediate) {
    planningClearTimer = null;
    run();
    if (lastCtx) applyFitForCtx(lastCtx);
    return;
  }
  planningClearTimer = setTimeout(() => {
    planningClearTimer = null;
    run();
    // Prefer fitting the committed agent plan if present.
    if (lastAgentPlan?.stays?.length) {
      fitAgentPlanBounds();
    } else if (lastCtx) {
      applyFitForCtx(lastCtx);
    }
  }, 4200);
}

/** Clear the committed itinerary plan overlay (清空回溯). */
export function clearAgentPlan() {
  lastAgentPlan = null;
  try {
    agentPlanLayer?.clearLayers();
  } catch {
    /* ignore */
  }
  setAgentPlanBadge("");
}

function setAgentPlanBadge(text) {
  const el = document.querySelector("#mapAgentPlanBadge");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.setAttribute("hidden", "");
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.removeAttribute("hidden");
  el.textContent = text;
}

function primaryStayPlaceId(day) {
  const ids = placeIdsForTripDay(day);
  if (!ids.length) return null;
  const key = `${day.label || ""} ${day.place || ""}`;
  if (/cook|库克/.test(key) && !/海峡/.test(key)) return "pl_mt_cook";
  if (/queenstown|皇后/.test(key)) return "pl_queenstown";
  if (/wanaka|瓦纳卡/.test(key)) return "pl_wanaka";
  if (/ferry|渡轮|海峡/.test(key)) return "pl_picton";
  if (/wellington|惠灵顿/.test(key)) return "pl_wellington";
  if (/depart|基督|christchurch|\bchc\b/i.test(key)) return "pl_chc_airport";
  if (/auckland|奥克兰|返程|return/i.test(key)) return "pl_akl_airport";
  if (/milford|峡湾|fiord|游船|蒂阿瑙|te anau/i.test(key)) return "pl_milford";
  if (/picton|皮克顿/.test(key)) return "pl_picton";
  if (/taupo|陶波/.test(key)) return "pl_taupo";
  if (/rotorua|罗托鲁阿/.test(key)) return "pl_rotorua";
  if (/tekapo|蒂卡波/.test(key)) return "pl_tekapo";
  return ids[0];
}

function looksLikePlanCommit(text, toolCalls = []) {
  const blob = String(text || "");
  const places = extractPlaceIdsFromText(blob);
  const calWrites = (toolCalls || []).filter((t) =>
    /calendar|add_calendar|schedule/i.test(String(t?.name || ""))
  );
  if (calWrites.length >= 1) return true;
  if (places.length >= 4) return true;
  if (
    places.length >= 2 &&
    /规划|行程安排|整体行程|调整行程|改路线|自驾环线|过夜|住宿|营地|Day\s*\d+|第\s*\d+\s*天|路线如下|行程如下|更新后的行程/i.test(
      blob
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Build a live itinerary plan from the agent's own outputs (calendar writes + reply text).
 * Does NOT use hardcoded case trip_days — each plan commit redraws from the latest model output.
 */
function buildPlanFromAgentOutputs({ content = "", thinking = "", toolCalls = [], calendar = [] } = {}) {
  const blob = `${content || ""}\n${thinking || ""}`;

  // 1) Calendar events written this turn (tool args) — strongest signal for adjustments
  const fromTools = [];
  for (const tc of toolCalls || []) {
    if (!/calendar|schedule/i.test(String(tc?.name || ""))) continue;
    const args = tc.args || {};
    const ev = tc.result?.event || {};
    const title = String(args.title || ev.title || "").trim();
    const note = String(args.note || ev.note || "").trim();
    const date = String(args.date || ev.date || "").slice(0, 10);
    const ids = extractPlaceIdsFromText(`${title} ${note}`);
    if (!ids[0]) continue;
    fromTools.push({
      day: fromTools.length + 1,
      date: date || null,
      placeId: ids[0],
      label: title || placeLabel(ids[0]),
    });
  }
  if (fromTools.length >= 2) {
    return staysToPlan(fromTools, "行程规划 · 日程");
  }

  // 2) Accumulated agent calendar in ledger (sorted by date)
  const calAgent = (calendar || [])
    .filter((c) => c?.source === "agent" || c?.kind === "plan")
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const fromCal = [];
  for (const c of calAgent) {
    const ids = extractPlaceIdsFromText(`${c.title || ""} ${c.note || ""} ${c.summary || ""}`);
    if (!ids[0]) continue;
    // Skip consecutive same hub
    if (fromCal.length && fromCal[fromCal.length - 1].placeId === ids[0]) {
      // keep richer label if empty
      continue;
    }
    fromCal.push({
      day: fromCal.length + 1,
      date: c.date || null,
      placeId: ids[0],
      label: c.title || c.summary || placeLabel(ids[0]),
    });
  }
  if (fromCal.length >= 2) {
    return staysToPlan(fromCal, "行程规划 · 日程");
  }

  // 3) Day-structured lines in the reply (Day 2 蒂卡波 / 第3天·皇后镇)
  const fromDays = parseDayPlaceStays(blob);
  if (fromDays.length >= 2) {
    return staysToPlan(fromDays, "行程规划");
  }

  // 4) Ordered place mentions in the reply/thinking
  const ids = extractPlaceIdsFromText(blob).filter((id) => id !== "shanghai_home");
  if (ids.length >= 2) {
    const stays = ids.map((id, i) => ({
      day: i + 1,
      placeId: id,
      label: placeLabel(id),
    }));
    return staysToPlan(stays, "行程规划");
  }

  return null;
}

function staysToPlan(stays, label = "行程规划") {
  const routePlaceIds = [];
  for (const s of stays) {
    if (routePlaceIds[routePlaceIds.length - 1] !== s.placeId) routePlaceIds.push(s.placeId);
  }
  return { stays, routePlaceIds, label };
}

function placeLabel(placeId) {
  const map = {
    pl_chc_airport: "基督城",
    pl_tekapo: "蒂卡波",
    pl_mt_cook: "库克山",
    pl_queenstown: "皇后镇",
    pl_wanaka: "瓦纳卡",
    pl_milford: "米尔福德",
    pl_picton: "皮克顿",
    pl_wellington: "惠灵顿",
    pl_taupo: "陶波",
    pl_rotorua: "罗托鲁阿",
    pl_akl_airport: "奥克兰",
  };
  return map[placeId] || String(placeId || "").replace(/^pl_/, "");
}

/** Parse 「Day 3 皇后镇」「第4天：瓦纳卡」 style lines into ordered stays. */
function parseDayPlaceStays(text) {
  const s = String(text || "");
  if (!s.trim()) return [];
  const re =
    /(?:Day\s*(\d+)|第\s*(\d+)\s*天|D\s*(\d+))\s*[:：.、\-\s]*([^\n。；;]{1,48})/gi;
  const out = [];
  const seenDay = new Set();
  let m;
  while ((m = re.exec(s))) {
    const day = Number(m[1] || m[2] || m[3]) || out.length + 1;
    const chunk = String(m[4] || "").trim();
    const ids = extractPlaceIdsFromText(chunk);
    if (!ids[0]) continue;
    if (seenDay.has(day)) continue;
    seenDay.add(day);
    out.push({
      day,
      placeId: ids[0],
      label: chunk.replace(/[（(].*$/, "").trim().slice(0, 16) || placeLabel(ids[0]),
    });
  }
  out.sort((a, b) => a.day - b.day);
  // Dedupe consecutive same place
  const dedup = [];
  for (const row of out) {
    if (dedup.length && dedup[dedup.length - 1].placeId === row.placeId) continue;
    dedup.push(row);
  }
  return dedup;
}

/**
 * After the agent commits / adjusts an itinerary, paint corridor + stays from model output.
 * Always rebuilds from the latest reply / calendar writes (never the hardcoded case spine).
 */
export async function commitAgentItineraryPlan({
  content = "",
  thinking = "",
  toolCalls = [],
  tripDays = [],
  calendar = [],
} = {}) {
  const blob = `${content || ""}\n${thinking || ""}`;
  const calAgent = (calendar || []).filter((c) => c?.source === "agent" || c?.kind === "plan");
  const calTools = (toolCalls || []).filter((t) => /calendar|schedule/i.test(String(t?.name || "")));
  const force =
    looksLikePlanCommit(blob, toolCalls) ||
    calAgent.length >= 2 ||
    calTools.length >= 1 ||
    extractPlaceIdsFromText(blob).length >= 3;
  if (!force) return false;

  // Always rebuild from the latest model/calendar output — never paint the static case spine.
  const plan = buildPlanFromAgentOutputs({ content, thinking, toolCalls, calendar });
  if ((plan?.stays || []).length < 2) return false;
  return showAgentPlan(plan, { fit: true });
}

/** Paint / refresh the committed agent itinerary plan on the map. */
export async function showAgentPlan(plan, { fit = true } = {}) {
  if (!plan?.stays?.length) return false;
  lastAgentPlan = plan;
  return repaintAgentPlan({ fit });
}

function fitAgentPlanBounds() {
  if (!leafletMap || !window.L || !lastAgentPlan || !lastCtx) return;
  const pts = [];
  for (const s of lastAgentPlan.stays || []) {
    const p = lastCtx.placeById?.[s.placeId];
    if (p) pts.push(window.L.latLng(p.lat, p.lng));
  }
  if (pts.length === 1) {
    setViewInSafeArea(pts[0], 7);
  } else if (pts.length > 1) {
    try {
      leafletMap.fitBounds(window.L.latLngBounds(pts), fitOptions({ maxZoom: 7, animate: true }));
    } catch {
      /* ignore */
    }
  }
}

async function repaintAgentPlan({ fit = false } = {}) {
  if (!leafletMap || !window.L || !lastAgentPlan || !lastCtx) return false;
  if (!agentPlanLayer) agentPlanLayer = window.L.layerGroup().addTo(leafletMap);
  agentPlanLayer.clearLayers();

  const stays = (lastAgentPlan.stays || []).filter((s) => lastCtx.placeById?.[s.placeId]);
  if (!stays.length) return false;

  const routeIds =
    lastAgentPlan.routePlaceIds?.length >= 2
      ? lastAgentPlan.routePlaceIds.filter((id) => lastCtx.placeById?.[id])
      : [...new Set(stays.map((s) => s.placeId))];

  let path = [];
  if (routeIds.length >= 2) {
    try {
      path = await buildDrivingPath(lastCtx, routeIds);
    } catch {
      path = routeIds.map((id) => {
        const p = lastCtx.placeById[id];
        return p ? [p.lat, p.lng] : null;
      }).filter(Boolean);
    }
  }

  if (path.length >= 2) {
    // Persistent plan corridor: soft violet (not live blue), but opaque enough to read on topo.
    const under = window.L.polyline(path, {
      color: "#ffffff",
      weight: 7,
      opacity: 0.65,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
      className: "map-agent-plan-route-under",
    }).addTo(agentPlanLayer);
    const line = window.L.polyline(path, {
      color: "#7c3aed",
      weight: 3.5,
      opacity: 0.78,
      dashArray: "7 9",
      lineCap: "round",
      lineJoin: "round",
      className: "map-agent-plan-route",
    })
      .addTo(agentPlanLayer)
      .bindTooltip(lastAgentPlan.label || "行程规划路线");
    try {
      under.bringToBack?.();
      line.bringToBack?.();
      agentPlanLayer.bringToBack?.();
    } catch {
      /* ignore */
    }
  }

  // Deduplicate markers by place; keep first day's label if multi-night.
  const seen = new Set();
  for (const s of stays) {
    if (seen.has(s.placeId)) continue;
    seen.add(s.placeId);
    const p = lastCtx.placeById[s.placeId];
    if (!p) continue;
    const dayNum = s.day != null ? `D${s.day}` : "Stay";
    const tip = [s.label, s.date ? String(s.date).slice(5) : null].filter(Boolean).join(" · ");
    window.L.marker([p.lat, p.lng], {
      icon: window.L.divIcon({
        className: "map-stay-wrap",
        html: `<div class="map-stay-marker" title="${escapeHtml(tip)}">
          <span class="map-stay-day">${escapeHtml(dayNum)}</span>
          <span class="map-stay-name">${escapeHtml(String(s.label || "").slice(0, 8))}</span>
        </div>`,
        iconSize: [72, 44],
        iconAnchor: [36, 44],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 700,
    }).addTo(agentPlanLayer);
  }

  const n = seen.size;
  setAgentPlanBadge(`行程规划 · ${n} 个住宿点`);
  if (fit) fitAgentPlanBounds();
  return true;
}

/** Focus a weather / geo_key point during tool use. */
export function focusGeoKey(geoKey, { label } = {}) {
  const geo = String(geoKey || "").toLowerCase();
  if (!geo) return false;

  // Prefer weather.locations (city center) so camera matches the bubble tip.
  const loc = (lastCtx?.locations || []).find(
    (l) => String(l.geo_key || "").toLowerCase() === geo
  );
  if (
    loc &&
    Number.isFinite(Number(loc.lat)) &&
    Number.isFinite(Number(loc.lng)) &&
    leafletMap &&
    window.L
  ) {
    setViewInSafeArea(window.L.latLng(Number(loc.lat), Number(loc.lng)), 9);
    return true;
  }

  const id = GEO_TO_PLACE[geo] || null;
  if (id) {
    return focusPlanning({
      placeIds: [id],
      mode: "consider",
      label: label || `关注 · ${geoKey}`,
      force: true,
    });
  }
  return false;
}

/** Focus from get_traffic_estimate (or similar) tool result.
 *  Always paint "checking" (purple) first; red only after active+verified blockage. */
export async function focusTrafficResult(result, args = {}) {
  const session = mapSession;
  const status = String(result?.status || "").toLowerCase();
  const matched = result?.matched || [];
  const roadIds = matched.map((e) => e.road_id).filter(Boolean);
  if (args.road_id) roadIds.unshift(args.road_id);
  // Also focus roads mentioned in the query even when clear.
  const qRoads = extractRoadIdsFromText(`${args.query || ""} ${args.road_id || ""}`);
  for (const id of qRoads) roadIds.push(id);
  const uniqRoads = [...new Set(roadIds)];
  const placeIds = extractPlaceIdsFromText(
    [args.query, args.road_id, ...(matched.map((e) => `${e.note || ""} ${e.road_name || ""}`))].join(" ")
  );

  // Strict verification — inactive historical notes (with "closed" in text) must NOT paint red.
  const isBlockedEvent = (e) => {
    if (Number(e.active) !== 1) return false;
    const note = `${e.note || ""} ${e.severity || ""} ${e.kind || ""}`;
    return (
      e.severity === "closed" ||
      /封路|封闭|关闭|closed|avalanche|debris|落石|雪崩|不可通行|暂缓/i.test(note)
    );
  };
  const verifiedBlocked =
    status === "blocked" || (status !== "clear" && matched.some(isBlockedEvent));

  await focusPlanning({
    placeIds,
    roadIds: uniqRoads,
    mode: "checking",
    label: "工具：核查路况…",
    force: true,
  });
  if (!isMapSession(session)) return false;

  await new Promise((r) => setTimeout(r, 1300));
  if (!isMapSession(session)) return false;

  if (verifiedBlocked) {
    return focusPlanning({
      placeIds,
      roadIds: uniqRoads,
      mode: "blocked",
      label: "确认：路段受阻",
      force: true,
    });
  }
  return focusPlanning({
    placeIds,
    roadIds: uniqRoads,
    mode: "clear",
    label: "工具：路况正常",
    force: true,
  });
}

let mapActionTimer = null;

function ensureMapActionStage() {
  let el = document.querySelector("#mapActionStage");
  if (el) return el;
  // Prefer mid actions slot (above docks; never in bottom flex).
  const host =
    document.querySelector(".map-chrome-actions") ||
    document.querySelector(".map-chrome-mid") ||
    document.querySelector(".map-overlay");
  if (!host) return null;
  el = document.createElement("div");
  el.id = "mapActionStage";
  el.className = "map-action-stage";
  el.hidden = true;
  el.setAttribute("hidden", "");
  host.appendChild(el);
  return el;
}

function hideMapActionStage() {
  const el = document.querySelector("#mapActionStage");
  if (!el) return;
  el.classList.remove("show");
  el.hidden = true;
  el.setAttribute("hidden", "");
  el.innerHTML = "";
}

/** Hide the bottom map-action card (used after status-bar landing takes over). */
export { hideMapActionStage };

/**
 * Cinematic overlay for major agent actions on the map:
 * kind: 'search' | 'notion' | 'calendar' | 'budget' | 'weather'
 */
export function playMapAction({
  kind = "search",
  title = "",
  query = "",
  body = "",
  items = [],
  durationMs = 8500,
  /** Keep the card visible after resolve so status landing can fly it upward. */
  leaveVisible = false,
} = {}) {
  return new Promise((resolve) => {
    const session = mapSession;
    const actionId = ++mapActionToken;
    const alive = () => isMapSession(session) && actionId === mapActionToken;
    const stage = ensureMapActionStage();
    if (!stage) {
      resolve(false);
      return;
    }
    clearTimeout(mapActionTimer);
    const rows = (items || []).filter(Boolean).slice(0, 5);
    const q = String(query || title || "").trim();
    const text = String(body || "").trim();

    if (kind === "search") {
      stage.innerHTML = `
        <div class="map-action-card map-action-search">
          <div class="map-action-search-bar">
            <span class="map-action-search-logo">Vibe<span>Search</span></span>
            <div class="map-action-search-input">
              <span class="map-action-search-ico">🔍</span>
              <span class="map-action-search-query" id="mapActionQuery"></span>
              <span class="map-action-caret">|</span>
            </div>
          </div>
          <div class="map-action-search-meta">正在检索相关结果…</div>
          <div class="map-action-search-results" id="mapActionResults"></div>
        </div>`;
    } else if (kind === "notion") {
      stage.innerHTML = `
        <div class="map-action-card map-action-notion">
          <div class="map-action-notion-head">
            <span class="map-action-notion-ico">📝</span>
            <div>
              <div class="map-action-notion-app">Notion 游记</div>
              <div class="map-action-notion-title">${escapeHtml(title || "NZ Road Trip Journal")}</div>
            </div>
            <span class="map-action-status" id="mapActionStatus">生成中</span>
          </div>
          <div class="map-action-notion-body" id="mapActionBody">
            <span class="map-action-notion-stream" id="mapActionStream"></span><span class="map-action-notion-caret" id="mapActionCaret">▍</span>
          </div>
          <div class="map-action-notion-foot" id="mapActionFoot" hidden>
            <span class="map-action-notion-check">✓</span>
            <span>已提交 · 记入游记</span>
          </div>
        </div>`;
    } else if (kind === "calendar") {
      stage.innerHTML = `
        <div class="map-action-card map-action-calendar">
          <div class="map-action-cal-head">
            <span class="map-action-cal-ico">📅</span>
            <div>
              <div class="map-action-cal-app">日程</div>
              <div class="map-action-cal-title">${escapeHtml(title || "行程日程")}</div>
            </div>
            <span class="map-action-status" id="mapActionStatus">添加中</span>
          </div>
          <div class="map-action-cal-event" id="mapActionBody"></div>
          <div class="map-action-cal-foot" id="mapActionFoot" hidden>
            <span class="map-action-notion-check">✓</span>
            <span>已写入行程账本</span>
          </div>
        </div>`;
    } else if (kind === "budget") {
      stage.innerHTML = `
        <div class="map-action-card map-action-budget">
          <div class="map-action-budget-head">
            <span class="map-action-budget-ico">💰</span>
            <div>
              <div class="map-action-budget-app">行程预算</div>
              <div class="map-action-budget-title">${escapeHtml(title || "核对费用")}</div>
            </div>
            <span class="map-action-status" id="mapActionStatus">核对中</span>
          </div>
          <div class="map-action-budget-rows" id="mapActionBody"></div>
          <div class="map-action-budget-foot" id="mapActionFoot" hidden>
            <span class="map-action-notion-check">✓</span>
            <span>已同步到状态栏</span>
          </div>
        </div>`;
    } else if (kind === "weather") {
      const wIcon = String(query || "🌦️").trim() || "🌦️";
      stage.innerHTML = `
        <div class="map-action-card map-action-weather">
          <div class="map-action-weather-head">
            <span class="map-action-weather-ico">${escapeHtml(wIcon)}</span>
            <div>
              <div class="map-action-weather-app">天气服务</div>
              <div class="map-action-weather-title">${escapeHtml(title || "当日天气")}</div>
            </div>
            <span class="map-action-status" id="mapActionStatus">查询中</span>
          </div>
          <div class="map-action-weather-rows" id="mapActionBody"></div>
          <div class="map-action-weather-foot" id="mapActionFoot" hidden>
            <span class="map-action-notion-check">✓</span>
            <span>已同步到状态栏</span>
          </div>
        </div>`;
    } else {
      resolve(false);
      return;
    }

    if (!alive()) {
      resolve(false);
      return;
    }

    stage.hidden = false;
    stage.removeAttribute("hidden");
    requestAnimationFrame(() => {
      if (alive()) stage.classList.add("show");
    });

    let finished = false;
    const finish = (ok = true) => {
      if (finished) return;
      finished = true;
      if (!alive()) {
        resolve(false);
        return;
      }
      stage.classList.add("is-done");
      const st = stage.querySelector(".map-action-status") || stage.querySelector("#mapActionStatus");
      if (st) {
        st.textContent =
          kind === "search"
            ? "完成"
            : kind === "notion"
              ? "已提交"
              : kind === "budget" || kind === "weather"
                ? "已同步"
                : "已写入";
      }
      const caret = stage.querySelector(".map-action-caret, #mapActionCaret");
      if (caret) caret.hidden = true;
      const foot = stage.querySelector("#mapActionFoot");
      if (foot) {
        foot.hidden = false;
        foot.removeAttribute("hidden");
        foot.classList.add("show");
      }
      // Search: 1s. Calendar/notion: ~2s. Budget/weather handoff shorter when leaveVisible.
      const holdMs =
        kind === "search"
          ? 1000
          : kind === "calendar"
            ? 2000
            : kind === "budget" || kind === "weather"
              ? leaveVisible
                ? 700
                : 2000
              : kind === "notion"
                ? 2400
                : 1500;
      mapActionTimer = setTimeout(() => {
        if (!leaveVisible && alive()) hideMapActionStage();
        resolve(Boolean(ok) && alive());
      }, holdMs);
    };

    if (kind === "search") {
      const qEl = stage.querySelector("#mapActionQuery");
      const resEl = stage.querySelector("#mapActionResults");
      const meta = stage.querySelector(".map-action-search-meta");
      let i = 0;
      // Faster typing + staggered results; hold 1s after the last row.
      const typeMs = 11;
      const rowGapMs = 200;
      const firstRowDelayMs = 120;
      const typeTimer = setInterval(() => {
        if (!alive()) {
          clearInterval(typeTimer);
          finish(false);
          return;
        }
        i += 1;
        if (qEl) qEl.textContent = q.slice(0, i);
        if (i >= q.length) {
          clearInterval(typeTimer);
          if (meta) meta.textContent = `约 ${Math.max(rows.length, 1)} 条结果`;
          if (!rows.length) {
            if (resEl) {
              const row = document.createElement("div");
              row.className = "map-action-search-row";
              row.innerHTML = `<div class="map-action-search-row-title">${escapeHtml(q || "相关结果")}</div>`;
              resEl.appendChild(row);
            }
            finish();
            return;
          }
          let r = 0;
          const addRow = () => {
            if (!alive() || !resEl || finished) return finish(false);
            const item = rows[r];
            const row = document.createElement("div");
            row.className = "map-action-search-row";
            row.innerHTML = `
              <div class="map-action-search-row-title">${escapeHtml(item.title || item)}</div>
              ${item.snippet ? `<div class="map-action-search-row-snip">${escapeHtml(item.snippet)}</div>` : ""}
              ${item.url ? `<div class="map-action-search-row-url">${escapeHtml(item.url)}</div>` : ""}`;
            resEl.appendChild(row);
            r += 1;
            if (r < rows.length) setTimeout(addRow, rowGapMs);
            else finish(); // all rows in → hold 1s then hide
          };
          setTimeout(addRow, firstRowDelayMs);
        }
      }, typeMs);
      // Fallback only if typing/results somehow stall.
      mapActionTimer = setTimeout(() => finish(), 20000);
      return;
    }

    if (kind === "notion") {
      // Stream journal content onto the map, then mark as submitted/recorded.
      const streamEl = stage.querySelector("#mapActionStream");
      const statusEl = stage.querySelector("#mapActionStatus");
      const raw = text
        .replace(/\r/g, "")
        .split(/\n+/)
        .map((s) => s.replace(/^#+\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 6)
        .join("\n");
      const streamText = (raw || "正在整理行程要点…").slice(0, 320);
      let i = 0;
      const chunk = () => {
        if (!alive() || finished || !streamEl) return finish(false);
        // Slightly slower stream than search (search pace is already OK).
        const step = 2 + Math.floor(Math.random() * 2);
        i = Math.min(streamText.length, i + step);
        streamEl.textContent = streamText.slice(0, i);
        const bodyWrap = stage.querySelector("#mapActionBody");
        if (bodyWrap) bodyWrap.scrollTop = bodyWrap.scrollHeight;
        if (i > streamText.length * 0.55 && statusEl && statusEl.textContent === "生成中") {
          statusEl.textContent = "写入中";
        }
        if (i >= streamText.length) {
          if (statusEl) statusEl.textContent = "提交中";
          setTimeout(() => finish(), 480);
          return;
        }
        setTimeout(chunk, 42);
      };
      setTimeout(chunk, 300);
      mapActionTimer = setTimeout(() => finish(), Math.max(durationMs, 9000));
      return;
    }

    if (kind === "budget") {
      const bodyEl = stage.querySelector("#mapActionBody");
      const statusEl = stage.querySelector("#mapActionStatus");
      const budgetRows = rows.length
        ? rows
        : [
            { label: "总额", value: "核对中…" },
            { label: "已用", value: "—" },
            { label: "剩余", value: "—" },
          ];
      let bi = 0;
      const addBudgetRow = () => {
        if (!alive() || !bodyEl || finished) return finish(false);
        if (bi >= budgetRows.length) {
          if (statusEl) statusEl.textContent = "写入状态栏";
          return finish();
        }
        const item = budgetRows[bi];
        const row = document.createElement("div");
        row.className = "map-action-budget-row";
        row.innerHTML = `
          <span class="map-action-budget-label">${escapeHtml(item.label || item.title || "")}</span>
          <span class="map-action-budget-value">${escapeHtml(item.value || item.snippet || item)}</span>`;
        bodyEl.appendChild(row);
        bi += 1;
        if (bi < budgetRows.length) setTimeout(addBudgetRow, 420);
        else {
          if (statusEl) statusEl.textContent = "写入状态栏";
          setTimeout(() => finish(), 380);
        }
      };
      setTimeout(addBudgetRow, 280);
      mapActionTimer = setTimeout(() => finish(), 12000);
      return;
    }

    if (kind === "weather") {
      const bodyEl = stage.querySelector("#mapActionBody");
      const statusEl = stage.querySelector("#mapActionStatus");
      const weatherRows = rows.length
        ? rows
        : [
            { label: "概况", value: "查询中…" },
            { label: "气温", value: "—" },
          ];
      let wi = 0;
      const addWeatherRow = () => {
        if (!alive() || !bodyEl || finished) return finish(false);
        if (wi >= weatherRows.length) {
          if (statusEl) statusEl.textContent = "写入状态栏";
          return finish();
        }
        const item = weatherRows[wi];
        const row = document.createElement("div");
        row.className = "map-action-weather-row";
        row.style.animationDelay = `${wi * 0.06}s`;
        row.innerHTML = `
          <span class="map-action-weather-label">${escapeHtml(item.label || item.title || "")}</span>
          <span class="map-action-weather-value">${escapeHtml(item.value || item.snippet || item)}</span>`;
        bodyEl.appendChild(row);
        wi += 1;
        if (wi < weatherRows.length) setTimeout(addWeatherRow, 400);
        else {
          if (statusEl) statusEl.textContent = "写入状态栏";
          setTimeout(() => finish(), 380);
        }
      };
      setTimeout(addWeatherRow, 260);
      mapActionTimer = setTimeout(() => finish(), 12000);
      return;
    }

    if (kind === "calendar") {
      const bodyEl = stage.querySelector("#mapActionBody");
      const statusEl = stage.querySelector("#mapActionStatus");
      const calRows = rows.length
        ? rows
        : text
          ? text
              .split(/\n+|·/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 4)
              .map((line, i) => ({
                label: i === 0 ? "日程" : "详情",
                value: line,
              }))
          : [{ label: "日程", value: title || "已加入今日行程" }];
      let ci = 0;
      const addCalRow = () => {
        if (!alive() || !bodyEl || finished) return finish(false);
        if (ci >= calRows.length) {
          if (statusEl) statusEl.textContent = "已加入";
          return finish();
        }
        const item = calRows[ci];
        const row = document.createElement("div");
        row.className = "map-action-cal-row";
        row.style.animationDelay = `${ci * 0.05}s`;
        const label = item.label || item.title || "";
        const value = item.value || item.snippet || item;
        row.innerHTML = label
          ? `<span class="map-action-cal-label">${escapeHtml(label)}</span>
             <span class="map-action-cal-value">${escapeHtml(value)}</span>`
          : `<span class="map-action-cal-value">${escapeHtml(value)}</span>`;
        bodyEl.appendChild(row);
        ci += 1;
        if (statusEl && ci === 1) statusEl.textContent = "写入中";
        if (ci < calRows.length) setTimeout(addCalRow, 420);
        else {
          if (statusEl) statusEl.textContent = "已加入";
          setTimeout(() => finish(), 420);
        }
      };
      setTimeout(addCalRow, 280);
      mapActionTimer = setTimeout(() => finish(), 12000);
      return;
    }

    // Unknown kind
    finish(false);
  });
}

export function ensureMapContainer(panelEl) {
  let shell = panelEl.querySelector(".map-shell");
  const needsRebuild =
    shell &&
    (shell.querySelector(".map-toolbar") ||
      !shell.querySelector(".map-frame") ||
      shell.querySelector(".map-frame .map-legend") ||
      !shell.classList.contains("map-shell-stage"));
  if (needsRebuild) {
    panelEl.innerHTML = "";
    shell = null;
    destroyMap();
  }
  if (!shell) {
    panelEl.innerHTML = `
      <div class="map-shell map-shell-stage">
        <div class="map-frame">
          <div id="routeMap" class="map-canvas map-host"></div>
          <div class="map-banner" id="mapBanner" hidden></div>
        </div>
      </div>`;
    destroyMap();
  }
  return panelEl.querySelector("#routeMap");
}

export function renderLeafletMap(engine) {
  const panel = document.querySelector("#mapPanel");
  if (!panel) return { ok: false, reason: "mapPanel missing" };

  const host = ensureMapContainer(panel);
  const ctx = buildMapContext(engine);
  lastCtx = ctx;

  if (typeof window.L === "undefined") {
    host.innerHTML = `<div class="map-fallback">地图库未加载，请检查网络后刷新</div>`;
    return { ok: false, reason: "Leaflet 未加载" };
  }

  try {
    ensureLeaflet(host);
    bindMapResize(host);
    paintLeafletBase(ctx);
    watchTiles(host);
    // Wait for baked road polylines so live legs (e.g. SH80) don't flash as straight lines.
    loadPrecomputedRoutes("./data/routes.json").finally(() => {
      if (!leafletMap) return;
      paintLeafletRoutes(lastCtx || ctx);
      if (lastAgentPlan?.stays?.length) {
        repaintAgentPlan({ fit: false }).catch(() => {});
      }
      requestAnimationFrame(() => {
        if (!leafletMap) return;
        leafletMap.invalidateSize(true);
        if (lastAgentPlan?.stays?.length) fitAgentPlanBounds();
        else fitLeaflet(lastCtx || ctx);
      });
    });
  } catch (err) {
    console.warn(err);
    host.innerHTML = `<div class="map-fallback">地图渲染失败：${escapeHtml(err.message || String(err))}</div>`;
    return { ok: false, reason: err.message };
  }

  updateBanner(panel, ctx);
  updateLegend(panel, ctx);
  return { ok: true, mode: "leaflet" };
}

function updateLegend(panel, ctx) {
  const root = document.querySelector("#mapLegend") || panel?.querySelector("#mapLegend");
  const flightLeg = root?.querySelector('[data-leg="flight"]');
  if (!flightLeg) return;
  const flags = ctx.flags || {};
  if (flags.showOutboundFlightArc) {
    flightLeg.hidden = false;
    flightLeg.innerHTML = `<i class="lg-flight"></i>已确认航线`;
  } else if (flags.showPlannedArrival) {
    flightLeg.hidden = false;
    flightLeg.innerHTML = `<i class="lg-flight"></i>计划抵达`;
  } else {
    flightLeg.hidden = true;
  }
}

export function destroyMap() {
  abortMapPlayback();
  clearTimeout(tileWatch);
  clearTimeout(mapResizeTimer);
  clearTimeout(fitPassTimer);
  fitPassTimer = null;
  if (mapResizeObs) {
    try {
      mapResizeObs.disconnect();
    } catch {
      /* ignore */
    }
    mapResizeObs = null;
  }
  if (leafletMap) {
    try {
      leafletMap.remove();
    } catch {
      /* ignore */
    }
  }
  leafletMap = null;
  leafletLayer = null;
  routeLayer = null;
  activityLayer = null;
  pulseLayer = null;
  planningLayer = null;
  flightLayer = null;
  agentPlanLayer = null;
  lastCtx = null;
}

function bindMapResize(host) {
  if (!host || typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", onViewportResize, { passive: true });
    return;
  }
  if (mapResizeObs) {
    try {
      mapResizeObs.disconnect();
    } catch {
      /* ignore */
    }
  }
  mapResizeObs = new ResizeObserver(() => {
    clearTimeout(mapResizeTimer);
    mapResizeTimer = setTimeout(() => {
      if (!leafletMap) return;
      leafletMap.invalidateSize(false);
      if (lastCtx) applyFitForCtx(lastCtx);
    }, 120);
  });
  const frame = host.closest(".map-frame") || host;
  mapResizeObs.observe(frame);
  window.addEventListener("resize", onViewportResize, { passive: true });
}

function onViewportResize() {
  clearTimeout(mapResizeTimer);
  mapResizeTimer = setTimeout(() => {
    if (!leafletMap) return;
    leafletMap.invalidateSize(false);
    if (lastCtx) applyFitForCtx(lastCtx);
  }, 120);
}

function watchTiles(host) {
  clearTimeout(tileWatch);
  tileWatch = setTimeout(() => {
    const imgs = host.querySelectorAll(".leaflet-tile-loaded");
    if (imgs.length < 2) {
      console.warn("Map tiles slow — check Esri/network access");
    }
  }, 2500);
}

function buildMapContext(engine) {
  const view = typeof engine.mapView === "function" ? engine.mapView() : { env: engine.env, state: engine.currentState };
  const flags = typeof engine.progressFlags === "function" ? engine.progressFlags() : {};
  const maps = view.env?.maps || {};
  const places = maps.places || [];
  const roads = maps.roads || [];
  const placeGeo = { ...DEFAULT_PLACE_GEO, ...(maps.place_geo_map || {}) };
  const state = view.state;
  const geo = state?.geo_key || null;
  const planDate = planHorizonDate(engine, view);
  const revealedIds = revealedPlaceIds(engine, planDate);
  const home = resolveHome(view.env);
  const action = String(state?.demo_action || "");
  // Home/China base map until actually in NZ (not merely "no trip day yet")
  const isHome = Boolean(flags.showShanghaiHome ?? true) && !flags.inNewZealand;

  return {
    engine,
    places,
    roads,
    roadById: Object.fromEntries(roads.map((r) => [r.road_id, r])),
    transitStops: maps.transit_stops || [],
    placeById: Object.fromEntries(places.map((p) => [p.place_id, p])),
    placeGeo,
    state,
    geo,
    planDate,
    revealedIds,
    home,
    action,
    isHome,
    flags,
    activity: classifyActivity(action, { isHome }),
    locations: view.env?.weather?.locations || [],
    activeRoads: (maps.road_events || []).filter((e) => Number(e.active) === 1),
    activeTransit: (maps.transit_events || []).filter((e) => Number(e.active) === 1),
    herePlaceId: geoKeyToPlaceId(geo, placeGeo),
    hotelsByPlace: hotelsByPlace(view.env?.ledger?.hotels || []),
  };
}

function hotelsByPlace(hotels) {
  const map = {};
  for (const h of hotels) {
    if (!h.place_id || h.status === "cancelled") continue;
    if (!map[h.place_id]) map[h.place_id] = [];
    map[h.place_id].push(h);
  }
  return map;
}

function resolveHome(env) {
  const row = (env?.weather?.locations || []).find((l) => l.geo_key === "shanghai_home");
  if (row?.lat != null) {
    return { lat: row.lat, lng: row.lng, name: "上海·家中", geo_key: "shanghai_home" };
  }
  return { ...SHANGHAI_HOME };
}

function planHorizonDate(engine, view) {
  if (view?.focus?.kind === "pre") return null;
  if (view?.focus?.date) return view.focus.date;
  if (typeof engine.reachedDate === "function") return engine.reachedDate();
  return null;
}

function placeIdsForTripDay(day) {
  const key = `${day.label || ""} ${day.place || ""}`.toLowerCase();
  if (/depart|基督|christchurch|chc/.test(key)) return ["pl_chc_airport"];
  if (/tekapo|蒂卡波/.test(key)) return ["pl_tekapo"];
  // Mt Cook is an SH80 spur off Tekapo — keep hub revealed with the spur end.
  if (/cook|库克/.test(key)) return ["pl_mt_cook", "pl_tekapo"];
  // Day5 overnight Queenstown — route via Wanaka (That Wanaka Tree)
  if (/queenstown|皇后/.test(key)) return ["pl_queenstown", "pl_wanaka", "pl_mt_cook"];
  if (/wanaka|瓦纳卡/.test(key)) return ["pl_wanaka", "pl_queenstown"];
  if (/te anau|蒂阿瑙|anau/.test(key)) return ["pl_milford", "pl_queenstown"];
  if (/fiord|峡湾|milford|游船/.test(key)) return ["pl_milford"];
  if (/transfer|南岛北上|南岛中部/.test(key)) return ["pl_milford", "pl_tekapo", "pl_picton"];
  if (/picton|皮克顿/.test(key)) return ["pl_picton", "pl_tekapo"];
  if (/ferry|库克海峡/.test(key)) return ["pl_picton", "pl_wellington"];
  if (/wellington|惠灵顿/.test(key)) return ["pl_wellington", "pl_picton"];
  if (/taupo|陶波/.test(key)) return ["pl_taupo"];
  if (/rotorua|罗托鲁阿/.test(key)) return ["pl_rotorua"];
  if (/auckland|奥克兰|return|fly home|返程/.test(key)) return ["pl_akl_airport"];
  return [];
}

function revealedPlaceIds(engine, planDate) {
  const ids = new Set();
  if (!planDate) return ids;
  for (const d of engine.meta?.trip_days || []) {
    if (d.date <= planDate) {
      for (const id of placeIdsForTripDay(d)) ids.add(id);
    }
  }
  return ids;
}

function classifyActivity(action, { isHome = false } = {}) {
  const a = String(action || "").trim();
  // Before any playback / no action yet — never claim "行程中"
  if (!a) {
    if (isHome) return { kind: "home", emoji: "🏠", label: "行前准备" };
    return { kind: "idle", emoji: "📍", label: "待更新" };
  }
  if (/自驾|转场自驾|高速|山路/.test(a)) return { kind: "driving", emoji: "🚗", label: a };
  if (/飞行|空中|飞往|巡航|起飞后/.test(a)) return { kind: "flying", emoji: "✈️", label: a };
  if (/游船|峡湾游/.test(a)) return { kind: "cruise", emoji: "🛳️", label: a };
  if (/渡轮|登船|甲板/.test(a)) return { kind: "ferry", emoji: "⛴️", label: a };
  if (/温泉/.test(a)) return { kind: "hotspring", emoji: "♨️", label: a };
  if (/露营|营地/.test(a)) return { kind: "camp", emoji: "⛺", label: a };
  if (/机场|候机|落地|还车/.test(a)) return { kind: "airport", emoji: "✈️", label: a };
  if (/漫步|游览|景点|地热|湖畔休息|市区/.test(a)) return { kind: "sightseeing", emoji: "📸", label: a };
  if (/在家|规划|签证|比较|核对|查询|邮件|收尾|整理|准备/.test(a)) return { kind: "home", emoji: "🏠", label: a };
  // Explicit junk defaults some models/UI used before
  if (a === "行程中") {
    return isHome
      ? { kind: "home", emoji: "🏠", label: "行前准备" }
      : { kind: "idle", emoji: "📍", label: "待更新" };
  }
  return { kind: "other", emoji: "📍", label: a };
}

/* ===================== Leaflet ===================== */

function ensureLeaflet(host) {
  if (leafletMap && host.classList.contains("leaflet-container")) return;

  if (leafletMap) {
    try {
      leafletMap.remove();
    } catch {
      /* ignore */
    }
    leafletMap = null;
  }
  host.innerHTML = "";
  leafletMap = window.L.map(host, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true,
  });

  const topo = window.L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 18, attribution: "Tiles © Esri" }
  );
  const streets = window.L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 18, attribution: "Tiles © Esri" }
  );
  topo.addTo(leafletMap);
  topo.on("tileerror", () => {
    if (!leafletMap.hasLayer(streets)) {
      leafletMap.removeLayer(topo);
      streets.addTo(leafletMap);
    }
  });
  leafletLayer = window.L.layerGroup().addTo(leafletMap);
  routeLayer = window.L.layerGroup().addTo(leafletMap);
  activityLayer = window.L.layerGroup().addTo(leafletMap);
  pulseLayer = window.L.layerGroup().addTo(leafletMap);
  planningLayer = window.L.layerGroup().addTo(leafletMap);
  flightLayer = window.L.layerGroup().addTo(leafletMap);
  agentPlanLayer = window.L.layerGroup().addTo(leafletMap);
}

function paintLeafletBase(ctx) {
  leafletLayer.clearLayers();

  if (ctx.isHome) {
    paintHomeBase(ctx);
    fitLeaflet(ctx);
    setTimeout(() => leafletMap && leafletMap.invalidateSize(), 40);
    return;
  }

  for (const road of ctx.roads) {
    const latlngs = parseRoadGeom(road.geom || road.geom_json);
    if (latlngs.length < 2) continue;
    const closed = ctx.activeRoads.some((e) => e.road_id === road.road_id);
    window.L.polyline(latlngs, {
      color: closed ? "#e11d48" : "#0f766e",
      weight: closed ? 4 : 3,
      opacity: closed ? 0.9 : 0.55,
      dashArray: closed ? "7 8" : null,
    })
      .addTo(leafletLayer)
      .bindTooltip(road.name || road.road_id, { sticky: true });
  }

  for (const ev of ctx.activeRoads) {
    const road = ctx.roadById[ev.road_id];
    const latlngs = parseRoadGeom(road?.geom || road?.geom_json);
    if (latlngs.length < 2) continue;
    const shortName = shortRoadName(road?.name || ev.road_id || "路段");
    const here = placeLatLng(ctx);
    // Pick a point along the closed road farthest from the live "现在" marker,
    // so the pink pill never sits on top of the camping/drive orb + caption.
    const anchor = pickClosureLabelAnchor(latlngs, here);
    const side = closureLabelSide(anchor, here);
    window.L.marker(anchor, {
      icon: window.L.divIcon({
        className: `map-emoji-icon closure-tag closure-tag-${side}`,
        html: `<span class="closure-pill">封闭 · ${escapeHtml(shortName)}</span>`,
        iconSize: [128, 28],
        // Float above the road; shift left/right away from "here".
        iconAnchor: side === "left" ? [118, 34] : [10, 34],
      }),
      // Under the live "现在" marker so the orb/caption stay readable.
      zIndexOffset: 700,
      interactive: true,
    })
      .addTo(leafletLayer)
      .bindPopup(
        `<strong>${escapeHtml(road?.name || "路况中断")}</strong><br/>${escapeHtml(ev.note || "")}`
      );
  }

  // Ferry: show once NZ trip has started; dashed until the crossing day is done.
  const ferryStops = (ctx.transitStops || []).filter((s) => s.lat != null);
  const tripStarted = Boolean(ctx.revealedIds?.size);
  if (tripStarted && ferryStops.length >= 2) {
    const ferry = ferryStops.map((s) => [s.lat, s.lng]);
    const suspended = ctx.activeTransit.length > 0;
    const onFerry = ctx.activity?.kind === "ferry";
    const ferryDone = Boolean(ctx.planDate && ctx.planDate > FERRY_DATE);
    const plannedOnly = !ferryDone && !onFerry;
    window.L.polyline(ferry, {
      color: suspended ? "#e11d48" : onFerry ? "#16a34a" : ferryDone ? "#0369a1" : "#38bdf8",
      weight: suspended ? 5 : onFerry ? 6 : ferryDone ? 4 : 3,
      dashArray: ferryDone && !suspended ? "2 10" : "10 7",
      opacity: plannedOnly ? 0.55 : 0.95,
      className: onFerry ? "route-live-line" : plannedOnly ? "route-planned-line" : "",
    })
      .addTo(leafletLayer)
      .bindTooltip(
        suspended
          ? "渡轮中断"
          : onFerry
            ? "渡轮航行中"
            : ferryDone
              ? "库克海峡渡轮（已走）"
              : "规划·库克海峡渡轮（未走）"
      );
  }

  // Live activity already draws a status pill at "here" — skip stacked place tooltip/pin.
  const liveHere = Boolean(ctx.activity?.label) && !ctx.isHome;

  for (const p of visiblePlaces(ctx)) {
    const isHere = p.place_id === ctx.herePlaceId || ctx.placeGeo[p.place_id] === ctx.geo;
    // When live "现在" marker is on, keep place dots quiet so they don't compete.
    const marker = window.L.circleMarker([p.lat, p.lng], {
      radius: isHere ? (liveHere ? 4 : 10) : 6,
      color: "#ffffff",
      weight: isHere && liveHere ? 1.5 : 2,
      fillColor: isHere ? "#16a34a" : categoryColor(p.category),
      fillOpacity: isHere && liveHere ? 0.35 : isHere ? 0.95 : 0.82,
      opacity: isHere && liveHere ? 0.55 : 1,
    }).addTo(leafletLayer);
    marker.bindTooltip(p.name, {
      direction: isHere ? "right" : "top",
      offset: isHere ? [12, 0] : [0, -8],
      permanent: false,
    });
    marker.bindPopup(
      `<strong>${escapeHtml(p.name)}</strong><br/>${escapeHtml(p.city || "")} · ${escapeHtml(p.category || "")}` +
        (p.rating != null ? `<br/>★ ${p.rating}` : "")
    );

    const stays = ctx.hotelsByPlace?.[p.place_id];
    if (stays?.length && !(isHere && liveHere)) {
      const tip = stays.map((h) => `${h.name}${h.refundable ? " ·可退" : ""}`).join(" / ");
      window.L.marker([p.lat, p.lng], {
        icon: window.L.divIcon({
          className: "map-emoji-icon hotel-badge",
          html: `<span class="hotel-badge-pill">🏨</span>`,
          iconSize: [22, 22],
          iconAnchor: [-8, 18],
        }),
        zIndexOffset: 400,
        interactive: true,
      })
        .addTo(leafletLayer)
        .bindTooltip(tip, { direction: "right", offset: [8, 0] });
    }
  }

  fitLeaflet(ctx);
  setTimeout(() => leafletMap && leafletMap.invalidateSize(), 40);
}

function paintHomeBase(ctx) {
  const home = ctx.home;
  const flags = ctx.flags || {};
  const chc = ctx.placeById.pl_chc_airport || { lat: -43.4894, lng: 172.532 };
  const atAirport = Boolean(flags.atDepartureAirport);

  window.L.circleMarker([home.lat, home.lng], {
    radius: 11,
    color: "#fff",
    weight: 2,
    fillColor: atAirport ? "#16a34a" : "#2563eb",
    fillOpacity: 1,
  })
    .addTo(leafletLayer)
    .bindTooltip(atAirport ? "✈️ 上海·浦东机场" : "🏠 " + home.name, {
      permanent: false,
      direction: "top",
      offset: [0, -10],
    });

  // 「计划抵达」only after flight is booked (D2+)
  if (flags.showPlannedArrival) {
    const fno = flags.outboundFlightNo ? ` · ${flags.outboundFlightNo}` : "";
    window.L.circleMarker([chc.lat, chc.lng], {
      radius: 8,
      color: "#fff",
      weight: 2,
      fillColor: "#94a3b8",
      fillOpacity: 0.9,
    })
      .addTo(leafletLayer)
      .bindTooltip(`✈️ 计划抵达 · 基督城${fno}`, { permanent: false, direction: "bottom", offset: [0, 10] });
  }

  window.L.marker([home.lat, home.lng], {
    icon: emojiIcon(atAirport ? "✈️" : "🏠", "home-emoji"),
    zIndexOffset: 600,
  })
    .addTo(leafletLayer)
    .bindPopup(
      `<strong>${atAirport ? "上海·机场出发" : "上海·家中"}</strong><br/>${escapeHtml(
        ctx.activity?.label || (atAirport ? "机场候机中" : "行前准备")
      )}<br/><span style="color:#64748b">${
        flags.showPlannedArrival
          ? flags.showOutboundFlightArc
            ? "已确认到机场，航班航线已显示"
            : "机票已订，抵达机场后显示航线"
          : "机票确认前仅显示家中位置"
      }</span>`
    );
}

async function paintLeafletRoutes(ctx) {
  const token = ++drawToken;
  if (routeLayer) routeLayer.clearLayers();
  if (activityLayer) activityLayer.clearLayers();
  stopTravelerAnim();

  if (ctx.isHome) {
    // Arc only after 确认到机场 (D7+)
    if (ctx.flags?.showOutboundFlightArc) paintHomeFlightArc(ctx);
    paintHomeActivity(ctx);
    return;
  }

  const revealed = ctx.revealedIds || new Set();
  if (!revealed.size) {
    // Still in China with no NZ day unlocked — never draw a premature arc
    return;
  }

  const planDate = ctx.planDate || null;
  const sh80Closed = isRoadClosed(ctx, MT_COOK_SPUR.road_id);
  const legs = itineraryDriveLegs();

  // Lightweight straight preview while OSRM/precomputed paths resolve
  const previewIds = legs.flatMap((l) => l.ids).filter((id, i, arr) => arr.indexOf(id) === i);
  const preview = spineStraight(
    ctx,
    previewIds.filter((id) => revealed.has(id) || !planDate || legDateForPlace(id) >= planDate)
  );
  if (preview.length >= 2) {
    window.L.polyline(preview, {
      color: "#94a3b8",
      weight: 2,
      opacity: 0.2,
      dashArray: "4 6",
    }).addTo(routeLayer);
  }

  const built = await Promise.all(
    legs.map(async (leg) => ({
      ...leg,
      path: leg.ids.length >= 2 ? await buildDrivingPath(ctx, leg.ids) : [],
    }))
  );
  if (token !== drawToken || !routeLayer) return;

  routeLayer.clearLayers();

  for (const leg of built) {
    if (leg.path.length < 2) continue;
    const traveled = Boolean(planDate && leg.date < planDate);
    // Mt Cook spur: show early as deferred dashed when SH80 closed (even before its day)
    const isMtCook = leg.kind === "mt_cook";
    if (isMtCook && !traveled && sh80Closed && !revealed.has(MT_COOK_SPUR.from)) {
      continue;
    }
    if (isMtCook && !traveled && sh80Closed && revealed.has(MT_COOK_SPUR.from)) {
      window.L.polyline(leg.path, {
        color: "#e11d48",
        weight: 5,
        opacity: 0.9,
        dashArray: "10 8",
        className: "route-planned-line",
      })
        .addTo(routeLayer)
        .bindTooltip("原计划·库克山支线（SH80 落石封闭·暂缓/等开放）");
      continue;
    }

    const style = styleForDriveLeg(leg, traveled, sh80Closed);
    window.L.polyline(leg.path, {
      color: style.color,
      weight: style.weight,
      opacity: style.opacity,
      dashArray: style.dashArray,
      className: traveled ? "" : "route-planned-line",
    })
      .addTo(routeLayer)
      .bindTooltip(style.tooltip);
  }

  await paintLiveActivity(ctx, token);
}

/** Full campervan drive plan as dated legs (solid = done, dashed = planned ahead). */
function itineraryDriveLegs() {
  return Object.entries(DATE_DRIVE_LEGS)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, ids]) => {
      const list = [...ids];
      return { date, ids: list, kind: driveLegKind(list), label: driveLegLabel(date, list) };
    });
}

function driveLegKind(ids) {
  if (ids.includes("pl_mt_cook") && ids.includes("pl_tekapo") && ids.length === 2) return "mt_cook";
  if (ids.includes("pl_wanaka")) return "wanaka";
  if (
    (ids.includes("pl_milford") && ids.includes("pl_tekapo")) ||
    (ids.includes("pl_tekapo") && ids.includes("pl_picton"))
  ) {
    return "transfer";
  }
  if (ids.some((id) => NORTH_SPINE.includes(id))) return "north";
  return "south";
}

function driveLegLabel(date, ids) {
  const names = {
    pl_chc_airport: "基督城",
    pl_tekapo: "蒂卡波",
    pl_mt_cook: "库克山",
    pl_wanaka: "瓦纳卡",
    pl_queenstown: "皇后镇",
    pl_milford: "峡湾",
    pl_picton: "皮克顿",
    pl_wellington: "惠灵顿",
    pl_taupo: "陶波",
    pl_rotorua: "罗托鲁阿",
    pl_akl_airport: "奥克兰",
  };
  const route = ids.map((id) => names[id] || id).join("→");
  return `${date.slice(5)} ${route}`;
}

function legDateForPlace(placeId) {
  for (const [date, ids] of Object.entries(DATE_DRIVE_LEGS)) {
    if (ids.includes(placeId)) return date;
  }
  return "9999-99-99";
}

function styleForDriveLeg(leg, traveled, sh80Closed) {
  const baseTip = leg.label || "";
  if (leg.kind === "mt_cook" && sh80Closed && !traveled) {
    return {
      color: "#e11d48",
      weight: 5,
      opacity: 0.9,
      dashArray: "10 8",
      tooltip: "原计划·库克山支线（SH80 封闭）",
    };
  }
  if (traveled) {
    if (leg.kind === "mt_cook") {
      return { color: "#0f766e", weight: 4, opacity: 0.9, dashArray: null, tooltip: `已走 · ${baseTip}` };
    }
    if (leg.kind === "wanaka") {
      return { color: "#6d28d9", weight: 4, opacity: 0.88, dashArray: null, tooltip: `已走 · ${baseTip}` };
    }
    if (leg.kind === "transfer") {
      return { color: "#334155", weight: 4, opacity: 0.88, dashArray: null, tooltip: `已走 · ${baseTip}` };
    }
    return { color: "#1e3a8a", weight: 5, opacity: 0.9, dashArray: null, tooltip: `已走 · ${baseTip}` };
  }
  // Planned but not yet driven — dashed
  if (leg.kind === "mt_cook") {
    return {
      color: "#0f766e",
      weight: 3.5,
      opacity: 0.65,
      dashArray: "9 10",
      tooltip: `规划未走 · ${baseTip}`,
    };
  }
  if (leg.kind === "wanaka") {
    return {
      color: "#7c3aed",
      weight: 3.5,
      opacity: 0.6,
      dashArray: "9 10",
      tooltip: `规划未走 · ${baseTip}`,
    };
  }
  if (leg.kind === "transfer") {
    return {
      color: "#64748b",
      weight: 3.5,
      opacity: 0.6,
      dashArray: "9 10",
      tooltip: `规划未走 · ${baseTip}`,
    };
  }
  return {
    color: "#3b82f6",
    weight: 4,
    opacity: 0.55,
    dashArray: "9 11",
    tooltip: `规划未走 · ${baseTip}`,
  };
}

function paintHomeFlightArc(ctx) {
  if (!ctx.flags?.showOutboundFlightArc) return;
  const home = ctx.home;
  const chc = ctx.placeById?.pl_chc_airport || { lat: -43.4894, lng: 172.532 };
  const fno = ctx.flags?.outboundFlightNo || "MU779";
  const arc = greatCircle([home.lat, home.lng], [chc.lat, chc.lng], 48);
  if (arc.length >= 2) {
    window.L.polyline(arc, {
      color: "#94a3b8",
      weight: 3,
      opacity: 0.7,
      dashArray: "6 10",
      className: "flight-plan-line",
    })
      .addTo(routeLayer)
      .bindTooltip(`已确认航班 ${fno} · PVG → CHC`);
  }
}

const NZ_GEO_KEYS = new Set([
  "christchurch",
  "tekapo",
  "mt_cook",
  "queenstown",
  "milford",
  "wanaka",
  "picton",
  "wellington",
  "taupo",
  "rotorua",
  "auckland",
  "te_anau",
  "manapouri",
  "frankton",
]);

export function geoSide(geoKey) {
  const g = String(geoKey || "").toLowerCase();
  if (!g || g === "shanghai_home") return "cn";
  if (NZ_GEO_KEYS.has(g)) return "nz";
  return "other";
}

/** True when playback jumps China ↔ New Zealand (ocean flight). */
export function isOceanFlightCrossing(fromGeo, toGeo) {
  if (!toGeo || fromGeo === toGeo) return false;
  const a = geoSide(fromGeo);
  const b = geoSide(toGeo);
  return (a === "cn" && b === "nz") || (a === "nz" && b === "cn");
}

function latLngForGeoKey(geoKey) {
  const g = String(geoKey || "").toLowerCase();
  if (!g || g === "shanghai_home") {
    const home = lastCtx?.home || SHANGHAI_HOME;
    return [home.lat, home.lng];
  }
  const placeId = GEO_TO_PLACE[g];
  const p = placeId && lastCtx?.placeById?.[placeId];
  if (p) return [p.lat, p.lng];
  // Fallbacks when map ctx not ready
  const FALLBACK = {
    christchurch: [-43.4894, 172.532],
    auckland: [-37.0082, 174.785],
    tekapo: [-44.005, 170.477],
    queenstown: [-45.0312, 168.6626],
    wellington: [-41.3276, 174.807],
  };
  return FALLBACK[g] || null;
}

function bearingDeg(a, b) {
  const toR = (d) => (d * Math.PI) / 180;
  const lat1 = toR(a[0]);
  const lat2 = toR(b[0]);
  const dLng = toR(b[1] - a[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function stopFlightCrossing() {
  if (flightAnim) {
    cancelAnimationFrame(flightAnim);
    flightAnim = null;
  }
  flightCrossingActive = false;
  try {
    flightLayer?.clearLayers();
  } catch {
    /* ignore */
  }
}

/**
 * Cinematic one-shot plane crossing between two geos (e.g. shanghai_home → christchurch).
 * Blocks until the plane reaches the destination.
 */
export function playFlightCrossing({
  fromGeo = "shanghai_home",
  toGeo = "christchurch",
  flightNo = "",
  label = "",
  durationMs = 6800,
} = {}) {
  return new Promise((resolve) => {
    const session = mapSession;
    if (!leafletMap || !window.L) {
      resolve(false);
      return;
    }
    const a = latLngForGeoKey(fromGeo);
    const b = latLngForGeoKey(toGeo);
    if (!a || !b) {
      resolve(false);
      return;
    }

    stopFlightCrossing();
    if (!isMapSession(session) || !leafletMap) {
      resolve(false);
      return;
    }
    if (!flightLayer) flightLayer = window.L.layerGroup().addTo(leafletMap);
    flightLayer.clearLayers();
    flightCrossingActive = true;

    const outbound = geoSide(fromGeo) === "cn";
    const routeLabel =
      label ||
      (outbound
        ? `飞行中 · ${flightNo || "MU779"} · PVG → CHC`
        : `飞行中 · ${flightNo || "MU780"} · AKL → PVG`);
    setPlanningBadge(routeLabel, "consider");

    const arc = greatCircle(a, b, 72);
    const lengths = segmentLengths(arc);
    const total = lengths.reduce((s, n) => s + n, 0) || 1;

    window.L.polyline(arc, {
      color: "#cbd5e1",
      weight: 2,
      opacity: 0.55,
      dashArray: "4 8",
      className: "flight-plan-line",
    }).addTo(flightLayer);

    const flown = window.L.polyline([arc[0]], {
      color: "#64748b",
      weight: 4,
      opacity: 0.9,
      className: "flight-live-line",
    }).addTo(flightLayer);

    // Endpoints
    window.L.circleMarker(a, {
      radius: 6,
      color: "#fff",
      weight: 2,
      fillColor: "#94a3b8",
      fillOpacity: 1,
    })
      .addTo(flightLayer)
      .bindTooltip(outbound ? "上海浦东 PVG" : "奥克兰 AKL", { direction: "top" });
    window.L.circleMarker(b, {
      radius: 6,
      color: "#fff",
      weight: 2,
      fillColor: "#64748b",
      fillOpacity: 1,
    })
      .addTo(flightLayer)
      .bindTooltip(outbound ? "基督城 CHC" : "上海浦东 PVG", { direction: "top" });

    const initialBrg = bearingDeg(a, b);
    const plane = window.L.marker(a, {
      icon: window.L.divIcon({
        className: "map-flight-plane-wrap",
        html: `<span class="map-flight-plane" style="--brg:${initialBrg.toFixed(1)}deg">✈️</span>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
      zIndexOffset: 1200,
      interactive: false,
    }).addTo(flightLayer);

    try {
      leafletMap.fitBounds(window.L.latLngBounds(arc), fitOptions({ maxZoom: 4, padding: [40, 40] }));
    } catch {
      /* ignore */
    }

    const t0 = performance.now();
    const dur = Math.max(4200, Number(durationMs) || 6800);

    function frame(now) {
      if (!isMapSession(session) || !flightCrossingActive) {
        flightAnim = null;
        resolve(false);
        return;
      }
      const u = Math.min(1, (now - t0) / dur);
      const pos = pointAlong(arc, lengths, total, u);
      // Nose always toward destination (stable near the end of the arc).
      const brg = bearingDeg(pos, b);
      plane.setLatLng(pos);
      const el = plane.getElement()?.querySelector(".map-flight-plane");
      if (el) el.style.setProperty("--brg", `${brg.toFixed(1)}deg`);

      const idx = Math.max(1, Math.floor(u * (arc.length - 1)));
      flown.setLatLngs(arc.slice(0, idx + 1));

      if (u >= 1) {
        flightAnim = null;
        flightCrossingActive = false;
        if (!isMapSession(session)) {
          resolve(false);
          return;
        }
        setPlanningBadge(outbound ? "已落地 · 基督城" : "已落地 · 上海", "consider");
        setTimeout(() => {
          if (!isMapSession(session)) {
            resolve(false);
            return;
          }
          setPlanningBadge("");
          try {
            flightLayer?.clearLayers();
          } catch {
            /* ignore */
          }
          if (lastCtx) applyFitForCtx(lastCtx);
          resolve(true);
        }, 900);
        return;
      }
      flightAnim = requestAnimationFrame(frame);
    }
    flightAnim = requestAnimationFrame(frame);
  });
}

function paintHomeActivity(ctx) {
  if (!activityLayer) return;
  const home = ctx.home;
  const emoji = ctx.activity?.emoji || "🏠";
  const label = ctx.activity?.label || "行前准备";
  window.L.marker([home.lat, home.lng], {
    icon: hereMarkerIcon(emoji, label),
    zIndexOffset: 1200,
    interactive: false,
  }).addTo(activityLayer);
}

async function paintLiveActivity(ctx, token) {
  if (!activityLayer || token !== drawToken) return;
  activityLayer.clearLayers();
  stopTravelerAnim();

  const act = ctx.activity || classifyActivity("", { isHome: false });
  const path = await liveSegmentPath(ctx);
  if (token !== drawToken) return;

  if ((act.kind === "driving" || act.kind === "ferry" || act.kind === "cruise") && path.length >= 2) {
    // Status text lives under the here-marker — no side tooltip on the path.
    window.L.polyline(path, {
      color: "#16a34a",
      weight: 8,
      opacity: 0.95,
      className: "route-live-line",
      interactive: false,
    }).addTo(activityLayer);

    startTravelerAnim(path, act.emoji, act.label);
    return;
  }

  // Stationary: prominent "现在" marker (not a bare emoji among place pins).
  const here = placeLatLng(ctx);
  if (!here) return;
  window.L.circle(here, {
    radius: 520,
    color: "#16a34a",
    weight: 2,
    fillColor: "#86efac",
    fillOpacity: 0.16,
    className: "activity-ring",
  }).addTo(activityLayer);

  window.L.marker(here, {
    icon: hereMarkerIcon(act.emoji, act.label),
    zIndexOffset: 1200,
    interactive: false,
  }).addTo(activityLayer);
}

async function liveSegmentPath(ctx) {
  const id = ctx.herePlaceId;
  const act = ctx.activity?.kind;

  if (act === "ferry" && ctx.transitStops?.length >= 2) {
    return ctx.transitStops.filter((s) => s.lat != null).map((s) => [s.lat, s.lng]);
  }
  if (act === "cruise" && id) {
    // short scenic loop offset near milford / manapouri
    const p = ctx.placeById[id] || placeLatLng(ctx);
    if (!p) return [];
    const lat = p.lat ?? p[0];
    const lng = p.lng ?? p[1];
    return [
      [lat, lng],
      [lat - 0.08, lng + 0.12],
      [lat - 0.02, lng + 0.22],
      [lat + 0.05, lng + 0.1],
      [lat, lng],
    ];
  }
  return todayHighlightPath(ctx);
}

function placeLatLng(ctx) {
  if (ctx.herePlaceId && ctx.placeById[ctx.herePlaceId]) {
    const p = ctx.placeById[ctx.herePlaceId];
    return [p.lat, p.lng];
  }
  const row = (ctx.locations || []).find((l) => l.geo_key === ctx.geo);
  if (row?.lat != null) return [row.lat, row.lng];
  return null;
}

function spineStraight(ctx, ids) {
  return ids.map((id) => ctx.placeById[id]).filter(Boolean).map((p) => [p.lat, p.lng]);
}

async function todayHighlightPath(ctx) {
  const id = ctx.herePlaceId;
  const loc = String(ctx.state?.location || "");

  // Prefer explicit single-day leg from event location / calendar date.
  const dayIds = resolveTodayDriveIds({
    location: loc,
    planDate: ctx.planDate,
    herePlaceId: id,
  });
  if (dayIds?.length >= 2) {
    // Don't animate through a closed SH80 spur
    const usesSh80 =
      dayIds.includes(MT_COOK_SPUR.from) && dayIds.includes(MT_COOK_SPUR.to);
    if (usesSh80 && isRoadClosed(ctx, MT_COOK_SPUR.road_id)) return [];
    return buildDrivingPath(ctx, dayIds);
  }

  if (!id) return [];

  const hint = `${loc} ${ctx.state?.trip_node || ""} ${ctx.state?.demo_action || ""}`;
  // Day5 outbound: Mt Cook → Wanaka → Queenstown (README), not Tekapo→Mt Cook inbound.
  if (
    /在途-皇后镇|准备出发|库克山\s*→\s*皇后镇/i.test(hint) ||
    (id === "pl_mt_cook" && /皇后镇|queenstown/i.test(hint))
  ) {
    return buildDrivingPath(ctx, ["pl_mt_cook", "pl_wanaka", "pl_queenstown"]);
  }

  // Single inbound spur — Tekapo → Mt Cook only.
  if (id === "pl_mt_cook") {
    if (isRoadClosed(ctx, MT_COOK_SPUR.road_id)) return [];
    return buildDrivingPath(ctx, [MT_COOK_SPUR.from, MT_COOK_SPUR.to]);
  }
  if (id === "pl_wanaka") {
    return buildDrivingPath(ctx, [WANAKA_SPUR.from, WANAKA_SPUR.to]);
  }

  const southIdx = SOUTH_SPINE.indexOf(id);
  if (southIdx > 0) {
    return buildDrivingPath(ctx, [SOUTH_SPINE[southIdx - 1], SOUTH_SPINE[southIdx]]);
  }
  if (southIdx === 0) return [];

  const northIdx = NORTH_SPINE.indexOf(id);
  if (northIdx > 0) {
    return buildDrivingPath(ctx, [NORTH_SPINE[northIdx - 1], NORTH_SPINE[northIdx]]);
  }
  return [];
}

function isRoadClosed(ctx, roadId) {
  return (ctx.activeRoads || []).some((e) => e.road_id === roadId && Number(e.active) === 1);
}

/**
 * Pixel insets for map chrome so fitBounds / setView keep pins in the clear band
 * between the top ribbon+status and the bottom docks.
 */
function measureChromePadding() {
  const mapH = leafletMap?.getSize()?.y || leafletMap?.getContainer()?.clientHeight || 720;
  const mapW = leafletMap?.getSize()?.x || leafletMap?.getContainer()?.clientWidth || 960;
  const gutter = 14;

  const topEl = document.querySelector(".map-chrome-top");
  const bottomEl = document.querySelector(".map-chrome-bottom");
  const overlay = document.querySelector(".map-overlay");
  const overlayPad = overlay ? parseFloat(getComputedStyle(overlay).paddingTop) || 12 : 12;

  let top = Math.ceil((topEl?.offsetHeight || 0) + overlayPad + gutter);
  let bottom = Math.ceil((bottomEl?.offsetHeight || 0) + overlayPad + gutter);

  const events = document.querySelector("#eventDock");
  const info = document.querySelector("#infoDock");
  const legendHelp = document.querySelector("#btnMapLegend");
  let left = gutter + 8;
  let right = gutter + 8;
  if (events) {
    left = Math.max(left, Math.min(events.offsetWidth + 16, Math.floor(mapW * 0.28)));
  } else if (legendHelp) {
    left = Math.max(left, Math.min(legendHelp.offsetWidth + 20, 56));
  }
  if (info) {
    right = Math.max(right, Math.min(info.offsetWidth + 16, Math.floor(mapW * 0.32)));
  }

  const maxTop = Math.floor(mapH * 0.42);
  const maxBottom = Math.floor(mapH * 0.38);
  const maxSide = Math.floor(mapW * 0.34);
  top = Math.max(56, Math.min(top, maxTop));
  bottom = Math.max(48, Math.min(bottom, maxBottom));
  left = Math.max(16, Math.min(left, maxSide));
  right = Math.max(16, Math.min(right, maxSide));

  if (top + bottom > mapH * 0.72) {
    bottom = Math.max(40, Math.floor(mapH * 0.72 - top));
  }

  return { top, bottom, left, right };
}

function fitOptions(extra = {}) {
  const pad = measureChromePadding();
  return {
    paddingTopLeft: [pad.left, pad.top],
    paddingBottomRight: [pad.right, pad.bottom],
    animate: false,
    ...extra,
  };
}

/** Center a single point in the chrome-safe viewport (not geometric map center). */
function setViewInSafeArea(latlng, zoom) {
  if (!leafletMap) return;
  const pad = measureChromePadding();
  const size = leafletMap.getSize();
  const safeCx = pad.left + (size.x - pad.left - pad.right) / 2;
  const safeCy = pad.top + (size.y - pad.top - pad.bottom) / 2;
  const target = window.L.latLng(latlng);
  leafletMap.setView(target, zoom, { animate: false });
  const cur = leafletMap.latLngToContainerPoint(target);
  leafletMap.panBy([cur.x - safeCx, cur.y - safeCy], { animate: false });
}

function applyFitForCtx(ctx) {
  if (!leafletMap || !ctx) return;

  // Ocean-crossing flight owns the viewport until it finishes.
  if (flightCrossingActive) return;

  // While agent is planning, keep the map on the thinking corridor.
  if (planningActive && planningFocusLatLngs?.length) {
    if (planningFocusLatLngs.length === 1) {
      setViewInSafeArea(planningFocusLatLngs[0], 8);
    } else {
      try {
        leafletMap.fitBounds(window.L.latLngBounds(planningFocusLatLngs), fitOptions({ maxZoom: 9 }));
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (ctx.isHome) {
    const home = ctx.home;
    const chc = ctx.placeById?.pl_chc_airport || { lat: -43.4894, lng: 172.532 };
    if (ctx.flags?.showOutboundFlightArc || ctx.flags?.showPlannedArrival) {
      leafletMap.fitBounds(
        [
          [home.lat, home.lng],
          [chc.lat, chc.lng],
        ],
        fitOptions({ maxZoom: ctx.flags?.showOutboundFlightArc ? 4 : 3.5 })
      );
    } else {
      setViewInSafeArea([home.lat, home.lng], 10);
    }
    return;
  }

  const focus = [];
  const hiIds = highlightPlaceIds(ctx);
  for (const id of hiIds) {
    const p = ctx.placeById[id];
    if (p) focus.push([p.lat, p.lng]);
  }
  for (const ev of ctx.activeRoads || []) {
    for (const ll of parseRoadGeom(ctx.roadById[ev.road_id]?.geom || ctx.roadById[ev.road_id]?.geom_json)) {
      focus.push(ll);
    }
  }
  if (!focus.length) {
    for (const id of ctx.revealedIds || []) {
      const p = ctx.placeById[id];
      if (p) focus.push([p.lat, p.lng]);
    }
  }
  if (!focus.length) {
    setViewInSafeArea([-41.2, 172.5], 5);
    return;
  }
  if (focus.length === 1) {
    setViewInSafeArea(focus[0], ctx.herePlaceId ? 9 : 5.5);
  } else {
    leafletMap.fitBounds(focus, fitOptions({ maxZoom: ctx.herePlaceId ? 9 : 5.5 }));
  }
}

let fitPassTimer = null;

function fitLeaflet(ctx) {
  if (!leafletMap || !ctx) return;

  try {
    leafletMap.invalidateSize(false);
  } catch {
    /* ignore */
  }

  applyFitForCtx(ctx);

  // One follow-up pass after chrome layout (ribbon/status heights) settles.
  clearTimeout(fitPassTimer);
  fitPassTimer = setTimeout(() => {
    fitPassTimer = null;
    if (!leafletMap || !lastCtx) return;
    try {
      leafletMap.invalidateSize(false);
    } catch {
      /* ignore */
    }
    applyFitForCtx(lastCtx);
  }, 100);
}

function highlightPlaceIds(ctxOrId) {
  // Accept legacy call with place_id string, or full ctx for day-scoped legs.
  const ctx = typeof ctxOrId === "string" ? { herePlaceId: ctxOrId } : ctxOrId || {};
  const dayIds = resolveTodayDriveIds({
    location: ctx.state?.location || "",
    planDate: ctx.planDate || "",
    herePlaceId: ctx.herePlaceId || null,
  });
  if (dayIds?.length) return dayIds;

  const herePlaceId = ctx.herePlaceId;
  if (!herePlaceId) return [];
  if (herePlaceId === "pl_mt_cook") return [MT_COOK_SPUR.from, MT_COOK_SPUR.to];
  if (herePlaceId === "pl_wanaka") return [WANAKA_SPUR.from, WANAKA_SPUR.to];
  if (herePlaceId === "pl_picton") return [...TRANSFER_DAY2];
  const s = SOUTH_SPINE.indexOf(herePlaceId);
  if (s > 0) return [SOUTH_SPINE[s - 1], SOUTH_SPINE[s]];
  if (s === 0) return [SOUTH_SPINE[0]];
  const n = NORTH_SPINE.indexOf(herePlaceId);
  if (n > 0) return [NORTH_SPINE[n - 1], NORTH_SPINE[n]];
  if (n === 0) return [NORTH_SPINE[0]];
  return [herePlaceId];
}

function visiblePlaces(ctx) {
  const ids = ctx.revealedIds?.size ? ctx.revealedIds : new Set();
  return ctx.places.filter((p) => {
    if (p.lat == null) return false;
    if (!ids.has(p.place_id)) return false;
    if (p.category === "restaurant") return ctx.geo === "rotorua" && p.city === "Rotorua";
    return true;
  });
}

function categoryColor(cat) {
  return (
    {
      airport: "#4f46e5",
      natural: "#0d9488",
      town_center: "#2563eb",
      city_center: "#1d4ed8",
      ferry_terminal: "#0284c7",
      restaurant: "#ea580c",
    }[cat] || "#2563eb"
  );
}

function alertSignature(ctx) {
  return [
    ...ctx.activeRoads.map((e) => e.event_id || e.road_id),
    ...ctx.activeTransit.map((e) => e.event_id || e.line_id),
  ]
    .filter(Boolean)
    .sort()
    .join("|");
}

function shortAlertText(ctx) {
  const parts = [];
  for (const e of ctx.activeRoads || []) {
    if (e.road_id === MT_COOK_SPUR.road_id || /sh80|mt.?cook|quake/i.test(`${e.event_id} ${e.note}`)) {
      parts.push("SH80 库克山公路落石封闭·支线暂缓");
    } else if (/milford|sh94/i.test(`${e.event_id} ${e.road_id} ${e.note}`)) {
      parts.push("SH94 米尔福德公路封闭");
    } else {
      parts.push(e.note || e.event_id || "路况中断");
    }
  }
  for (const e of ctx.activeTransit || []) {
    parts.push(e.note || e.event_id || "渡轮中断");
  }
  return parts.join(" · ");
}

function hideMapBanner(banner) {
  if (!banner) return;
  banner.hidden = true;
  delete banner.dataset.alertKey;
  banner.replaceChildren();
  clearTimeout(bannerHideTimer);
  bannerHideTimer = null;
}

function updateBanner(panel, ctx) {
  const banner = panel.querySelector("#mapBanner");
  if (!banner) return;

  const key = alertSignature(ctx);
  if (!key) {
    dismissedAlertKey = null;
    hideMapBanner(banner);
    return;
  }

  // Same alert already dismissed / auto-hid — keep map clear.
  if (dismissedAlertKey === key) {
    hideMapBanner(banner);
    return;
  }

  // Already toasting this alert — don't rebuild / restart the auto-hide timer on every paint.
  if (!banner.hidden && banner.dataset.alertKey === key) return;

  const text = shortAlertText(ctx);
  banner.hidden = false;
  banner.dataset.alertKey = key;
  // Do NOT add global `.toast` — that class is position:fixed + dark pill and
  // would paint a giant oval over the dashboard when the closure banner appears.
  banner.className = "map-banner";
  banner.innerHTML = `
    <span class="map-banner-text">⚠ ${escapeHtml(text)}</span>
    <button type="button" class="map-banner-dismiss" aria-label="关闭提示">×</button>`;

  const dismiss = () => {
    dismissedAlertKey = key;
    hideMapBanner(banner);
  };
  banner.querySelector(".map-banner-dismiss")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    dismiss();
  });

  clearTimeout(bannerHideTimer);
  bannerHideTimer = setTimeout(dismiss, 4500);
}

function geoKeyToPlaceId(geo, placeGeo) {
  if (!geo || geo === "shanghai_home") return null;
  const hit = Object.entries(placeGeo).find(([, g]) => g === geo);
  return hit ? hit[0] : null;
}

function emojiIcon(emoji, extraClass = "") {
  return window.L.divIcon({
    className: `map-emoji-icon ${extraClass}`,
    html: `<span class="map-emoji">${emoji}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

/** Distinct "you are here" marker — 「现在」hangs under the orb with slight overlap. */
function hereMarkerIcon(emoji, label = "") {
  const raw = String(label || "").trim();
  const tip = escapeHtml(raw);
  const short = escapeHtml(raw.length > 8 ? `${raw.slice(0, 7)}…` : raw);
  return window.L.divIcon({
    className: "map-here-wrap",
    html: `
      <div class="map-here-marker" title="${tip}">
        <div class="map-here-orb">
          <span class="map-here-pulse" aria-hidden="true"></span>
          <span class="map-here-pulse map-here-pulse-late" aria-hidden="true"></span>
          <span class="map-here-core">
            <span class="map-here-emoji">${emoji || "📍"}</span>
          </span>
          <span class="map-here-tag">现在</span>
        </div>
        ${short ? `<div class="map-here-caption">${short}</div>` : ""}
      </div>`,
    // Orb + overlapping tag + caption; anchor at orb center.
    iconSize: [96, 96],
    iconAnchor: [48, 26],
  });
}

function startTravelerAnim(latlngs, emoji, label) {
  stopTravelerAnim();
  if (!activityLayer || !latlngs?.length) return;

  const marker = window.L.marker(latlngs[0], {
    icon: hereMarkerIcon(emoji, label),
    zIndexOffset: 1200,
    interactive: false,
  }).addTo(activityLayer);

  const lengths = segmentLengths(latlngs);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  // Slow one-shot crawl along the road (no loop). Typical day leg ≈ 25–40s.
  const duration = Math.min(42000, Math.max(24000, total * 340));
  const t0 = performance.now();

  function frame(now) {
    const u = Math.min(1, (now - t0) / duration);
    const pos = pointAlong(latlngs, lengths, total, u);
    marker.setLatLng(pos);
    if (u < 1) {
      travelerAnim = requestAnimationFrame(frame);
    } else {
      travelerAnim = null;
    }
  }
  travelerAnim = requestAnimationFrame(frame);
}

function stopTravelerAnim() {
  if (travelerAnim) {
    cancelAnimationFrame(travelerAnim);
    travelerAnim = null;
  }
}

function segmentLengths(latlngs) {
  const out = [];
  for (let i = 1; i < latlngs.length; i++) {
    out.push(haversineKm(latlngs[i - 1], latlngs[i]));
  }
  return out;
}

function pointAlong(latlngs, lengths, total, u) {
  let dist = u * total;
  for (let i = 0; i < lengths.length; i++) {
    const seg = lengths[i] || 0.0001;
    if (dist <= seg) {
      const t = dist / seg;
      const a = latlngs[i];
      const b = latlngs[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    dist -= seg;
  }
  return latlngs[latlngs.length - 1];
}

function haversineKm(a, b) {
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b[0] - a[0]);
  const dLng = toR(b[1] - a[1]);
  const la1 = toR(a[0]);
  const la2 = toR(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Approximate great-circle for home→CHC flight preview */
function greatCircle(a, b, n = 40) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const lat1 = toRad(a[0]);
  const lng1 = toRad(a[1]);
  const lat2 = toRad(b[0]);
  const lng2 = toRad(b[1]);
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2
      )
    );
  if (!d) return [a, b];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return pts;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Prefer a road sample farthest from the live "here" pin to avoid label stacking. */
function pickClosureLabelAnchor(latlngs, here) {
  if (!latlngs?.length) return null;
  if (!here) return latlngs[Math.floor(latlngs.length / 2)];
  const samples = [0.28, 0.42, 0.55, 0.68, 0.82].map((t) => {
    const i = Math.min(latlngs.length - 1, Math.max(0, Math.floor(t * (latlngs.length - 1))));
    return latlngs[i];
  });
  let best = samples[0];
  let bestD = -1;
  for (const p of samples) {
    const d = haversineKm(p, here);
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Put the closure pill on the side opposite the "here" marker. */
function closureLabelSide(anchor, here) {
  if (!anchor || !here) return "right";
  // here east of anchor → label left; otherwise right
  return here[1] >= anchor[1] ? "left" : "right";
}

function shortRoadName(name) {
  const s = String(name || "");
  if (/SH80|Mt Cook|库克/i.test(s)) return "SH80";
  if (/SH94|Milford|米尔福德/i.test(s)) return "SH94";
  const m = s.match(/SH\s?\d+/i);
  if (m) return m[0].replace(/\s+/g, "");
  return s.length > 12 ? s.slice(0, 10) + "…" : s || "路段";
}
