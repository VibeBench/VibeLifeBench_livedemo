/**
 * Road-following itinerary for NZ demo.
 *
 * Priority per leg:
 *   1) Precomputed OSRM polylines (demo/data/routes.json) — offline-friendly
 *   2) Live OSRM fetch
 *   3) Seed road geom only if detailed enough (≥ 4 points)
 *   4) Straight fallback (last resort)
 *
 * Topology note: Aoraki/Mt Cook sits on a dead-end spur (SH80). It must NOT sit on the
 * continuous south spine, or Mt Cook → Queenstown will backtrack the same road and look
 * like the itinerary "re-drives" a segment.
 */

/** Main campervan spine — geographic through-route (spurs off-spine) */
export const SOUTH_SPINE = [
  "pl_chc_airport",
  "pl_tekapo",
  "pl_queenstown",
  "pl_milford",
];

export const NORTH_SPINE = ["pl_wellington", "pl_taupo", "pl_rotorua", "pl_akl_airport"];

/** Dead-end alpine spur (SH80) — out-and-back from Tekapo */
export const MT_COOK_SPUR = { from: "pl_tekapo", to: "pl_mt_cook", road_id: "rd_sh80_mtcook" };

/** Day-trip spur off Queenstown */
export const WANAKA_SPUR = { from: "pl_queenstown", to: "pl_wanaka" };

/**
 * South-island northbound transfer is TWO driving days with a mid-island overnight
 * (Tekapo / Mackenzie), not one Milford→Picton mega-leg.
 *   Day 8: Fiordland → mid-island
 *   Day 9: mid-island → Picton
 */
export const TRANSFER_HUB = "pl_tekapo";
export const TRANSFER_DAY1 = ["pl_milford", "pl_tekapo"];
export const TRANSFER_DAY2 = ["pl_tekapo", "pl_picton"];
/** Revealed corridor (via overnight hub) for fog-of-war backbone */
export const TRANSFER_CORRIDOR = ["pl_milford", "pl_tekapo", "pl_picton"];
/** @deprecated use TRANSFER_DAY1 / TRANSFER_DAY2 / TRANSFER_CORRIDOR */
export const TRANSFER_LEG = { from: "pl_milford", to: "pl_picton", via: "pl_tekapo" };

/**
 * Calendar-day drive endpoints (YYYY-MM-DD → place_id[]).
 * Only used when the traveler is actively driving that day.
 */
/**
 * Expected overnight / drive endpoints per calendar day (case README).
 * Mt Cook → Queenstown goes via Wanaka (Lindis), NOT back through Tekapo town.
 */
export const DATE_DRIVE_LEGS = {
  "2026-10-11": ["pl_chc_airport", "pl_tekapo"], // Day2 overnight Tekapo (no event row; ribbon focus)
  "2026-10-13": ["pl_tekapo", "pl_mt_cook"], // Day4 SH80 spur
  "2026-10-14": ["pl_mt_cook", "pl_wanaka", "pl_queenstown"], // Day5 via Wanaka / That Wanaka Tree
  "2026-10-15": ["pl_queenstown", "pl_milford"], // Day6 → Te Anau / Fiordland hub
  "2026-10-17": TRANSFER_DAY1, // Day8 Fiordland → mid-island
  "2026-10-18": TRANSFER_DAY2, // Day9 mid-island → Picton
  "2026-10-20": ["pl_wellington", "pl_taupo"], // Day11
  "2026-10-21": ["pl_taupo", "pl_rotorua"], // Day12
  "2026-10-22": ["pl_rotorua", "pl_akl_airport"], // Day13
};

/** Prefer case seed geom for these short alpine legs — only if geom is detailed. */
const SEED_ROAD_LEGS = [
  { from: "pl_tekapo", to: "pl_mt_cook", road_id: "rd_sh80_mtcook" },
  { from: "pl_mt_cook", to: "pl_tekapo", road_id: "rd_sh80_mtcook" },
];

const OSRM = "https://router.project-osrm.org/route/v1/driving";
const routeCache = new Map();
/** @type {Map<string, [number, number][]>} */
const precomputed = new Map();
let precomputedLoaded = false;

/** Map event location fragments → place_id (order matters for compound names). */
export function placeAliasToId(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (/马纳普里|manapouri|milford|峡湾|蒂阿瑙|te\s*anau/.test(s)) return "pl_milford";
  if (/南岛中部|中部/.test(s)) return TRANSFER_HUB;
  if (/库克山|mt\.?\s*cook|aoraki/.test(s)) return "pl_mt_cook";
  if (/蒂卡波|tekapo/.test(s)) return "pl_tekapo";
  if (/皇后镇|queenstown/.test(s)) return "pl_queenstown";
  if (/瓦纳卡|wanaka/.test(s)) return "pl_wanaka";
  if (/皮克顿|picton/.test(s)) return "pl_picton";
  if (/惠灵顿|wellington/.test(s)) return "pl_wellington";
  if (/陶波|taup[oō]/.test(s)) return "pl_taupo";
  if (/罗托鲁阿|rotorua/.test(s)) return "pl_rotorua";
  if (/奥克兰|auckland/.test(s)) return "pl_akl_airport";
  if (/基督城|christchurch|chc/.test(s)) return "pl_chc_airport";
  return null;
}

/**
 * Resolve today's single driving leg from location copy and/or calendar date.
 * Returns place_id[] or null.
 */
export function resolveTodayDriveIds({ location = "", planDate = "", herePlaceId = null } = {}) {
  const loc = String(location || "").trim();
  if (loc.includes("→")) {
    const [rawFrom, rawTo = ""] = loc.split(/\s*→\s*/);
    const fromId = placeAliasToId(rawFrom);
    const toId = placeAliasToId(
      String(rawTo)
        .replace(/\s*途中.*$/u, "")
        .replace(/\(.*?\)/g, "")
        .trim()
    );
    if (fromId && toId && fromId !== toId) {
      // Dead-end spur: leave Mt Cook via SH80, then Lindis → Wanaka → Queenstown
      if (fromId === "pl_mt_cook" && toId === "pl_queenstown") {
        return ["pl_mt_cook", "pl_wanaka", "pl_queenstown"];
      }
      // "皇后镇/马纳普里 → 南岛中部" etc. already aliased; keep pair
      return [fromId, toId];
    }
  }

  if (planDate && DATE_DRIVE_LEGS[planDate]) {
    return [...DATE_DRIVE_LEGS[planDate]];
  }

  // Transfer day fallbacks when location text is sparse but geo is set
  if (herePlaceId === "pl_picton" && (!planDate || planDate >= "2026-10-18")) {
    return [...TRANSFER_DAY2];
  }
  return null;
}

export function allRoutePlaceIds() {
  return [...SOUTH_SPINE, "pl_mt_cook", "pl_wanaka", "pl_picton", ...NORTH_SPINE];
}

/** Load baked OSRM polylines from demo/data/routes.json (called once at boot). */
export async function loadPrecomputedRoutes(url = "./data/routes.json") {
  if (precomputedLoaded) return precomputed.size;
  precomputedLoaded = true;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    for (const [key, leg] of Object.entries(data || {})) {
      const coords = leg?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        precomputed.set(key, coords.map(([lat, lng]) => [Number(lat), Number(lng)]));
      }
    }
  } catch (err) {
    console.warn("precomputed routes unavailable", err);
  }
  return precomputed.size;
}

export async function buildDrivingPath(ctx, placeIds) {
  const coords = [];
  for (let i = 0; i < placeIds.length; i++) {
    const id = placeIds[i];
    const place = ctx.placeById[id];
    if (!place) continue;

    if (i === 0) {
      coords.push([place.lat, place.lng]);
      continue;
    }

    const prevId = placeIds[i - 1];
    const prev = ctx.placeById[prevId];
    if (!prev) {
      coords.push([place.lat, place.lng]);
      continue;
    }

    const leg = await resolveLeg(ctx, prevId, id, prev, place);
    for (let k = 0; k < leg.length; k++) {
      if (k === 0 && coords.length) continue;
      coords.push(leg[k]);
    }
  }
  return coords;
}

async function resolveLeg(ctx, fromId, toId, fromPlace, toPlace) {
  // 1) Precomputed road-following polyline
  const baked = precomputed.get(`${fromId}>${toId}`);
  if (baked?.length >= 2) return orientGeom(baked, fromPlace, toPlace);

  // 2) Live OSRM
  const osrm = await fetchOsrm(fromPlace.lng, fromPlace.lat, toPlace.lng, toPlace.lat);
  if (osrm.length >= 2) return osrm;

  // 3) Seed geom — only if detailed (2-point stubs are useless straight lines)
  const seed = SEED_ROAD_LEGS.find((l) => l.from === fromId && l.to === toId);
  if (seed) {
    const geom = parseRoadGeom(ctx.roadById[seed.road_id]?.geom || ctx.roadById[seed.road_id]?.geom_json);
    if (geom.length >= 4) return orientGeom(geom, fromPlace, toPlace);
  }

  // 4) Straight fallback
  return [
    [fromPlace.lat, fromPlace.lng],
    [toPlace.lat, toPlace.lng],
  ];
}

async function fetchOsrm(lng1, lat1, lng2, lat2) {
  const key = `${lng1.toFixed(4)},${lat1.toFixed(4)};${lng2.toFixed(4)},${lat2.toFixed(4)}`;
  if (routeCache.has(key)) return routeCache.get(key);

  try {
    const url = `${OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const line = data.routes?.[0]?.geometry?.coordinates || [];
    const latlngs = line.map(([lng, lat]) => [lat, lng]);
    if (latlngs.length >= 2) routeCache.set(key, latlngs);
    return latlngs;
  } catch (err) {
    console.warn("OSRM leg failed", err);
    // Do not cache failures — allow retry on next paint
    return [];
  }
}

function orientGeom(geom, fromPlace, toPlace) {
  const start = geom[0];
  const end = geom[geom.length - 1];
  const dStart = dist2(fromPlace.lat, fromPlace.lng, start[0], start[1]);
  const dEnd = dist2(fromPlace.lat, fromPlace.lng, end[0], end[1]);
  return dStart <= dEnd ? geom : [...geom].reverse();
}

function dist2(a, b, c, d) {
  return (a - c) ** 2 + (b - d) ** 2;
}

export function parseRoadGeom(geom) {
  if (!geom) return [];
  let g = geom;
  if (typeof g === "string") {
    try {
      g = JSON.parse(g);
    } catch {
      return [];
    }
  }
  return (g.coordinates || []).map(([lng, lat]) => [lat, lng]);
}

/** Preload common legs so live paint can reuse cache */
export async function preloadItineraryRoutes(ctx) {
  await loadPrecomputedRoutes();
  await buildDrivingPath(ctx, SOUTH_SPINE);
  await buildDrivingPath(ctx, NORTH_SPINE);
  const t = ctx.placeById[MT_COOK_SPUR.from];
  const c = ctx.placeById[MT_COOK_SPUR.to];
  if (t && c) await resolveLeg(ctx, MT_COOK_SPUR.from, MT_COOK_SPUR.to, t, c);
  const q = ctx.placeById[WANAKA_SPUR.from];
  const w = ctx.placeById[WANAKA_SPUR.to];
  if (q && w) await resolveLeg(ctx, WANAKA_SPUR.from, WANAKA_SPUR.to, q, w);
  await buildDrivingPath(ctx, TRANSFER_CORRIDOR);
  // Modified post-spur day: Mt Cook → Tekapo → Queenstown
  await buildDrivingPath(ctx, ["pl_mt_cook", "pl_tekapo", "pl_queenstown"]);
}
