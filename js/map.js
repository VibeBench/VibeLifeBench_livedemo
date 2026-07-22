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

function clearPulseTimers() {
  for (const t of pulseTimers) clearTimeout(t);
  pulseTimers = [];
  const rail = document.querySelector("#mapToastRail");
  if (rail) rail.replaceChildren();
}

/**
 * Transient feedback: text cards in the fixed mid rail + a tiny ping on the map.
 * Avoids covering the top status strip / bottom docks.
 */
export function pulseMapEvent({
  icon = "📌",
  label = "",
  title = "",
  detail = "",
  kind = "",
  durationMs = 5600,
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

  pushToastRail({ icon, head, sub, kindCls, durationMs });
  pulseTinyPin({ icon, durationMs: Math.min(2800, durationMs) });
  return true;
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

function pulseTinyPin({ icon = "📌", durationMs = 2400 } = {}) {
  if (!leafletMap || !window.L) return;
  if (!pulseLayer) pulseLayer = window.L.layerGroup().addTo(leafletMap);

  const here = lastCtx ? placeLatLng(lastCtx) : null;
  const center = leafletMap.getCenter();
  const latlng = window.L.latLng(here?.[0] ?? center.lat, here?.[1] ?? center.lng);

  const marker = window.L.marker(latlng, {
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
      requestAnimationFrame(() => {
        if (!leafletMap) return;
        leafletMap.invalidateSize(true);
        fitLeaflet(lastCtx || ctx);
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
  clearTimeout(tileWatch);
  clearTimeout(mapResizeTimer);
  clearPulseTimers();
  if (mapResizeObs) {
    try {
      mapResizeObs.disconnect();
    } catch {
      /* ignore */
    }
    mapResizeObs = null;
  }
  drawToken += 1;
  stopTravelerAnim();
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
      leafletMap.invalidateSize(true);
    }, 80);
  });
  const frame = host.closest(".map-frame") || host;
  mapResizeObs.observe(frame);
  window.addEventListener("resize", onViewportResize, { passive: true });
}

function onViewportResize() {
  clearTimeout(mapResizeTimer);
  mapResizeTimer = setTimeout(() => {
    if (!leafletMap) return;
    leafletMap.invalidateSize(true);
  }, 100);
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
    // Anchor near mid-road but nudge label aside so it doesn't sit on place/activity pills.
    const mid = latlngs[Math.floor(latlngs.length / 2)];
    const shortName = shortRoadName(road?.name || ev.road_id || "路段");
    window.L.marker(mid, {
      icon: window.L.divIcon({
        className: "map-emoji-icon closure-tag",
        html: `<span class="closure-pill">封闭 · ${escapeHtml(shortName)}</span>`,
        iconSize: [0, 0],
        iconAnchor: [-12, 8],
      }),
      zIndexOffset: 450,
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
    const marker = window.L.circleMarker([p.lat, p.lng], {
      radius: isHere ? (liveHere ? 5 : 10) : 7,
      color: "#ffffff",
      weight: 2,
      fillColor: isHere ? "#16a34a" : categoryColor(p.category),
      fillOpacity: isHere && liveHere ? 0.55 : 0.95,
    }).addTo(leafletLayer);
    // Permanent top tooltip collides with basemap POI pins + activity pill; only hover for "here".
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
    if (stays?.length) {
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
      color: "#38bdf8",
      weight: 3,
      opacity: 0.85,
      dashArray: "6 10",
      className: "flight-plan-line",
    })
      .addTo(routeLayer)
      .bindTooltip(`已确认航班 ${fno} · PVG → CHC`);
  }
}

function paintHomeActivity(ctx) {
  if (!activityLayer) return;
  const home = ctx.home;
  const emoji = ctx.activity?.emoji || "🏠";
  // Icon only — no permanent text label over the map
  window.L.marker([home.lat, home.lng], {
    icon: emojiIcon(emoji, "home-emoji"),
    zIndexOffset: 700,
  })
    .addTo(activityLayer)
    .bindTooltip(ctx.activity?.label || "行前准备", { permanent: false, direction: "right", offset: [12, 0] });
}

async function paintLiveActivity(ctx, token) {
  if (!activityLayer || token !== drawToken) return;
  activityLayer.clearLayers();
  stopTravelerAnim();

  const act = ctx.activity || classifyActivity("", { isHome: false });
  const path = await liveSegmentPath(ctx);
  if (token !== drawToken) return;

  if ((act.kind === "driving" || act.kind === "ferry" || act.kind === "cruise") && path.length >= 2) {
    window.L.polyline(path, {
      color: "#16a34a",
      weight: 8,
      opacity: 0.95,
      className: "route-live-line",
    })
      .addTo(activityLayer)
      .bindTooltip(`${act.emoji} ${act.label}`);

    startTravelerAnim(path, act.emoji, act.label);
    return;
  }

  // Stationary activity: side pill (not top tooltip) so it clears basemap red pins / place labels.
  const here = placeLatLng(ctx);
  if (!here) return;
  window.L.circle(here, {
    radius: 420,
    color: "#16a34a",
    weight: 2,
    fillColor: "#86efac",
    fillOpacity: 0.18,
    className: "activity-ring",
  }).addTo(activityLayer);

  window.L.marker(here, {
    icon: emojiIcon(act.emoji, "activity-here-emoji"),
    zIndexOffset: 700,
  })
    .addTo(activityLayer)
    .bindTooltip(`${act.emoji} ${act.label}`, { permanent: false, direction: "right", offset: [14, 0] });
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

function fitLeaflet(ctx) {
  if (!leafletMap) return;

  if (ctx.isHome) {
    const home = ctx.home;
    const chc = ctx.placeById?.pl_chc_airport || { lat: -43.4894, lng: 172.532 };
    if (ctx.flags?.showOutboundFlightArc || ctx.flags?.showPlannedArrival) {
      leafletMap.fitBounds(
        [
          [home.lat, home.lng],
          [chc.lat, chc.lng],
        ],
        { padding: [48, 48], maxZoom: ctx.flags?.showOutboundFlightArc ? 4 : 3.5 }
      );
    } else {
      // Pre-booking: stay on Shanghai, do not preview NZ
      leafletMap.setView([home.lat, home.lng], 10);
    }
    setTimeout(() => leafletMap && leafletMap.invalidateSize(true), 60);
    return;
  }

  const focus = [];
  const hiIds = highlightPlaceIds(ctx);
  for (const id of hiIds) {
    const p = ctx.placeById[id];
    if (p) focus.push([p.lat, p.lng]);
  }
  for (const ev of ctx.activeRoads) {
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
    leafletMap.setView([-41.2, 172.5], 5);
    setTimeout(() => leafletMap && leafletMap.invalidateSize(true), 60);
    return;
  }
  leafletMap.fitBounds(focus, {
    padding: [36, 36],
    maxZoom: ctx.herePlaceId ? 9 : 5.5,
  });
  setTimeout(() => leafletMap && leafletMap.invalidateSize(true), 60);
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

function startTravelerAnim(latlngs, emoji, label) {
  stopTravelerAnim();
  if (!activityLayer || !latlngs?.length) return;

  const marker = window.L.marker(latlngs[0], {
    icon: emojiIcon(emoji, "traveler-emoji"),
    zIndexOffset: 800,
  }).addTo(activityLayer);
  if (label) {
    marker.bindTooltip(label, { permanent: false, direction: "top", offset: [0, -14] });
  }

  const lengths = segmentLengths(latlngs);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const duration = Math.min(14000, Math.max(6000, total * 80));
  const t0 = performance.now();

  function frame(now) {
    const u = ((now - t0) % duration) / duration;
    const pos = pointAlong(latlngs, lengths, total, u);
    marker.setLatLng(pos);
    travelerAnim = requestAnimationFrame(frame);
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

function shortRoadName(name) {
  const s = String(name || "");
  if (/SH80|Mt Cook|库克/i.test(s)) return "SH80";
  if (/SH94|Milford|米尔福德/i.test(s)) return "SH94";
  const m = s.match(/SH\s?\d+/i);
  if (m) return m[0].replace(/\s+/g, "");
  return s.length > 12 ? s.slice(0, 10) + "…" : s || "路段";
}
