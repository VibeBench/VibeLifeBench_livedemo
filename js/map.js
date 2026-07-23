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
} from "./routing.js?v=20260723-107";
import { playbackMs } from "./playback.js?v=20260723-107";

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
/** Persistent booked flight arcs (flown + upcoming) — geometry locked, not rotated. */
let flightPlanLayer = null;
let flightRotateTimer = null;
let flightRotateIdx = 0;
/** @type {Array<{ polyline: object, flown: boolean, label: string, flightNo: string, route: string, from: number[], to: number[] }> } */
let flightPlanEntries = [];
/** Skip clear+redraw when the booked-flight set hasn't changed. */
let lastFlightCatalogSig = "";
/**
 * Locked great-circle geometry once a flight is booked.
 * Prevents endpoint drift when map focus / lastCtx.home / agent-plan fits change.
 * @type {Map<string, { from: number[], to: number[], arc: number[][] }>}
 */
let lockedFlightArcs = new Map();

/** Fixed airport hubs for air corridors (never depend on map focus). */
const FLIGHT_HUBS = {
  shanghai_home: [31.1443, 121.8083], // PVG
  pvg: [31.1443, 121.8083],
  christchurch: [-43.4894, 172.532], // CHC
  auckland: [-37.0082, 174.785], // AKL
};
/** Quick overland car hop between NZ places. */
let driveHopLayer = null;
let driveHopAnim = null;
let driveHopActive = false;
/** Bumped on rewind/reset — async overlays must check before painting. */
let mapSession = 1;
let mapActionToken = 0;
/** Persistent post-plan itinerary overlay (stays + corridor). */
let agentPlanLayer = null;
/** Road-check status pills — own pane above stay markers. */
let roadCheckLayer = null;
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
    roadCheckLayer?.clearLayers();
  } catch {
    /* ignore */
  }
  setPlanning