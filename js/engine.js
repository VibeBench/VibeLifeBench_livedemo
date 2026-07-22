/**
 * Playback engine: advances through events, applies mutations to env state,
 * maintains current user_state for the dashboard.
 *
 * uiFocus holds a read-only snapshot when the user clicks a past/current day
 * on the ribbon (map + status follow the snapshot; agent tools still use live env).
 */
import { renderEventForAgent } from "./loader.js?v=20260720-41";
import { buildLedger, emptyLedger } from "./ledger.js?v=20260720-33";

export class DemoEngine {
  constructor(caseData) {
    this.reset(caseData);
  }

  reset(caseData) {
    this.caseData = caseData;
    this.env = structuredClone(caseData.env);
    if (!this.env.ledger) this.env.ledger = emptyLedger();
    this.cursor = -1; // last consumed flat index
    this.currentState = null;
    this.lastWeather = null; // sticky weather from kind:weather nodes
    this.revealed = []; // events shown on dashboard stream
    this.mutationsApplied = [];
    this.uiFocus = null; // { kind, date, dayNum, env, state } | null
    this.listeners = new Set();
    this.refreshLedger();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.listeners) fn({ type, payload, engine: this });
  }

  get flat() {
    return this.caseData.flat;
  }

  get meta() {
    return this.caseData.meta;
  }

  get progress() {
    const total = this.flat.length;
    return { cursor: this.cursor, total, done: this.cursor >= total - 1 };
  }

  peek() {
    return this.flat[this.cursor + 1] || null;
  }

  clearUiFocus() {
    this.uiFocus = null;
  }

  /** Env/state for map & status panels (respects day-ribbon focus). */
  mapView() {
    if (this.uiFocus) {
      return { env: this.uiFocus.env, state: this.uiFocus.state, focus: this.uiFocus };
    }
    return { env: this.env, state: this.currentState, focus: null };
  }

  /**
   * Unified trip-progress flags for map / status / tools UI.
   * Scoped to current day-ribbon focus when set.
   *
   * Timeline (NZ case):
   * - kickoff…D1: home only
   * - D2 flight booked: show「计划抵达」marker (no flight arc yet)
   * - D7 机场候机/出发: show PVG→CHC dashed arc
   * - arrived christchurch+: NZ itinerary fog-of-war
   */
  progressFlags() {
    const NZ_GEO = new Set([
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
    ]);
    const focus = this.uiFocus;
    const first = this.firstTripDate();
    const events = (this.revealed || []).filter((ev) => {
      const d = String(ev.time).slice(0, 10);
      if (focus?.kind === "pre") return !first || d < first;
      if (focus?.kind === "prep" && focus.date) return d <= focus.date;
      if (focus?.kind === "day" && focus.date) return d <= focus.date;
      return true;
    });

    let flightBooked = false;
    let atDepartureAirport = false;
    let inNewZealand = false;
    let tripClosing = false;
    let budgetMentioned = false;
    let outboundFlightNo = null;

    for (const ev of events) {
      const st = ev.user_state;
      if (!st) continue;
      const body = String(ev.body || "");
      if (ev.kind === "user_message" && /预算/.test(body) && (/万|50000|¥\s*50/.test(body) || st.budget?.total_cny != null)) {
        budgetMentioned = true;
      }
      const fno = st.next_flight?.flight_no;
      if (fno && Number(st.budget?.spent_cny) > 0) {
        flightBooked = true;
        if (!outboundFlightNo) outboundFlightNo = fno;
      }
      if (/机场候机|候机中/.test(st.demo_action || "") || /在途-出发/.test(st.trip_node || "")) {
        atDepartureAirport = true;
      }
      if (st.geo_key && NZ_GEO.has(st.geo_key)) inNewZealand = true;
      if (st.trip_node === "收尾") tripClosing = true;
    }

    const viewState = this.mapView().state;
    if (viewState) {
      if (/机场候机|候机中/.test(viewState.demo_action || "") || /在途-出发/.test(viewState.trip_node || "")) {
        atDepartureAirport = true;
      }
      if (viewState.geo_key && NZ_GEO.has(viewState.geo_key)) inNewZealand = true;
      if (viewState.trip_node === "收尾") tripClosing = true;
    }

    const atHomeBase = !inNewZealand || tripClosing || events.length === 0;
    const budgetSettled = budgetMentioned && events.some((ev) => Number(ev.user_state?.budget?.spent_cny) > 0);

    return {
      flightBooked,
      atDepartureAirport,
      inNewZealand,
      tripClosing,
      atHomeBase,
      outboundFlightNo,
      // UI disclosure
      budgetDisclosed: budgetMentioned,
      budgetSettled,
      flightDisclosed: flightBooked,
      // Map layers
      showShanghaiHome: atHomeBase,
      showPlannedArrival: flightBooked && !inNewZealand && !tripClosing,
      showOutboundFlightArc: atDepartureAirport && !inNewZealand && !tripClosing,
    };
  }

  /** Furthest calendar date already revealed by playback. */
  reachedDate() {
    return this.latestDate();
  }

  /** Whether a trip day can be opened in the ribbon. */
  isDayReached(dayNum) {
    const day = (this.meta.trip_days || []).find((d) => d.day === dayNum);
    if (!day) return false;
    const reached = this.reachedDate();
    if (!reached) return false;
    return day.date <= reached;
  }

  isPreTripReached() {
    const first = this.firstTripDate();
    if (!this.revealed.length) return false;
    if (!first) return true;
    return this.revealed.some((e) => String(e.time).slice(0, 10) < first);
  }

  /**
   * Rebuild env + user_state from seed by replaying revealed events up to dateEnd (inclusive).
   * @param {string} dateEnd YYYY-MM-DD
   * @param {{ preOnly?: boolean }} [opts]
   */
  snapshotThroughDate(dateEnd, { preOnly = false } = {}) {
    const env = structuredClone(this.caseData.env);
    if (!env.ledger) env.ledger = emptyLedger();
    let state = null;
    let lastWeather = null;
    const first = this.firstTripDate();
    const applied = [];
    for (const ev of this.revealed) {
      const d = String(ev.time).slice(0, 10);
      if (preOnly) {
        if (first && d >= first) break;
      } else if (d > dateEnd) {
        break; // revealed is chronological
      }
      if (ev.kind === "mutation") {
        this.applyMutationTo(env, ev);
      }
      if (ev.user_state) {
        state = this.applyUserState(ev.user_state, d, {
          track: false,
          seedWeather: lastWeather,
          prevState: state,
        });
        if (ev.user_state.weather) {
          lastWeather = {
            weather: ev.user_state.weather,
            weather_impact: ev.user_state.weather_impact || null,
            geo_key: ev.user_state.geo_key || null,
            __date: d,
          };
        }
      }
      applied.push(ev);
    }
    env.ledger = buildLedger({
      revealed: applied,
      meta: this.meta,
      env,
      dateEnd: preOnly ? null : dateEnd,
      preOnly,
    });
    return { env, state };
  }

  /**
   * Apply event user_state onto a state object.
   * - Sticky weather when the new event omits it
   * - Sticky cumulative budget: spent_cny never drops; missing budget is carried forward
   * @param {{ track?: boolean, seedWeather?: object|null, prevState?: object|null }} [opts]
   */
  applyUserState(userState, date, { track = true, seedWeather = null, prevState = null } = {}) {
    const prev = prevState || (track ? this.currentState : null);
    const base = { ...userState, __date: date };

    // Budget is a running total across the trip — weather/location-only events must not wipe it,
    // and a lower authored spent must not regress below what we already accumulated.
    const mergedBudget = mergeCumulativeBudget(prev?.budget, userState?.budget);
    if (mergedBudget) base.budget = mergedBudget;

    // Keep flight plan sticky when later events omit it (same class of bug as budget wipe).
    if (!userState?.next_flight && prev?.next_flight) {
      base.next_flight = prev.next_flight;
    }

    if (userState?.weather) {
      const w = {
        weather: userState.weather,
        weather_impact: userState.weather_impact || null,
        geo_key: userState.geo_key || null,
        __date: date,
      };
      if (track) this.lastWeather = w;
      return base;
    }
    const sticky = track ? this.lastWeather : seedWeather;
    if (sticky?.weather) {
      return {
        ...base,
        weather: sticky.weather,
        weather_impact: sticky.weather_impact || null,
      };
    }
    return base;
  }

  /** Persist weather observed via agent tools into sticky state + status bar. */
  setObservedWeather(weatherText, { impact = null, geo_key = null, date = null } = {}) {
    const text = String(weatherText || "").trim();
    if (!text) return null;
    const stamp = date || this.latestDate() || null;
    this.lastWeather = {
      weather: text,
      weather_impact: impact || null,
      geo_key: geo_key || null,
      __date: stamp,
    };
    if (this.currentState) {
      this.currentState = {
        ...this.currentState,
        weather: text,
        weather_impact: impact || null,
      };
    } else {
      this.currentState = {
        weather: text,
        weather_impact: impact || null,
        geo_key: geo_key || null,
        __date: stamp,
      };
    }
    return this.lastWeather;
  }

  /** Rebuild env.ledger from revealed events (and focused slice via mapView env). */
  refreshLedger() {
    this.env.ledger = buildLedger({
      revealed: this.revealed,
      meta: this.meta,
      env: this.env,
    });
    return this.env.ledger;
  }

  /** Ledger for UI (respects day-ribbon focus). */
  ledgerView() {
    const view = this.mapView();
    return view.env?.ledger || this.env.ledger || emptyLedger();
  }

  /** Jump UI focus to a trip day (does not change playback cursor). */
  focusDay(dayNum) {
    const day = (this.meta.trip_days || []).find((d) => d.day === dayNum);
    if (!day || !this.isDayReached(dayNum)) return false;
    const { env, state } = this.snapshotThroughDate(day.date);
    const lastRevealed = [...this.revealed].reverse().find((e) => String(e.time).startsWith(day.date));
    const focusState =
      state ||
      (lastRevealed?.user_state
        ? { ...lastRevealed.user_state, __date: day.date }
        : { __date: day.date, location: day.place, trip_node: day.label });
    this.uiFocus = {
      kind: "day",
      dayNum: day.day,
      date: day.date,
      env,
      state: focusState,
    };
    this.emit("day_focus", { day, state: focusState });
    return true;
  }

  /** Whether a prep calendar day can be opened in the ribbon. */
  isPrepDayReached(date) {
    if (!date) return false;
    const first = this.firstTripDate();
    if (first && date >= first) return false;
    const reached = this.reachedDate();
    if (!reached) return false;
    return date <= reached && (this.isPreTripReached() || this.isPreTrip());
  }

  /** Jump UI focus to a prep calendar day (does not change playback cursor). */
  focusPrepDay(date) {
    if (!this.isPrepDayReached(date)) return false;
    const dayMeta = (this.meta.prep_days || []).find((d) => d.date === date);
    const { env, state } = this.snapshotThroughDate(date);
    const lastRevealed = [...this.revealed].reverse().find((e) => String(e.time).startsWith(date));
    const focusState =
      state ||
      (lastRevealed?.user_state
        ? { ...lastRevealed.user_state, __date: date }
        : {
            __date: date,
            location: dayMeta?.place || "上海",
            trip_node: "行前准备",
            demo_action: dayMeta?.label || "行前准备",
          });
    this.uiFocus = {
      kind: "prep",
      dayNum: dayMeta?.day ?? 0,
      date,
      env,
      state: focusState,
    };
    this.emit("day_focus", { prep: true, day: dayMeta, state: focusState });
    return true;
  }

  /** Focus the latest reached prep day (legacy entry point). */
  focusPreTrip() {
    if (!this.isPreTripReached() && !this.isPreTrip()) return false;
    const reached = this.reachedDate();
    const prep = this.meta.prep_days || [];
    const last = [...prep].reverse().find((d) => !reached || d.date <= reached);
    if (last) return this.focusPrepDay(last.date);

    const first = this.firstTripDate();
    const preEnd = first
      ? (() => {
          const t = new Date(first + "T00:00:00Z");
          t.setUTCDate(t.getUTCDate() - 1);
          return t.toISOString().slice(0, 10);
        })()
      : "9999-12-31";
    const { env, state } = this.snapshotThroughDate(preEnd, { preOnly: true });
    this.uiFocus = {
      kind: "pre",
      dayNum: 0,
      date: null,
      env,
      state: state || this.currentState,
    };
    this.emit("day_focus", { pre: true, state: this.uiFocus.state });
    return true;
  }

  /** Simulated "now" from the latest revealed event (for chat timestamps). */
  simNow() {
    const ev = this.revealed[this.revealed.length - 1];
    return ev?.time || null;
  }

  eventsForDate(date) {
    return this.flat.filter((e) => String(e.time).startsWith(date));
  }

  eventsForCurrentDay() {
    const view = this.mapView();
    const date = String(view.state?.__date || this.latestDate() || "");
    return this.revealed.filter((e) => String(e.time).startsWith(date.slice(0, 10)));
  }

  latestDate() {
    const ev = this.revealed[this.revealed.length - 1];
    return ev ? String(ev.time).slice(0, 10) : null;
  }

  firstTripDate() {
    return this.meta.trip_days?.[0]?.date || null;
  }

  /** True when playback is before Day 1 (or nothing revealed yet). */
  isPreTrip() {
    const date = this.latestDate();
    const first = this.firstTripDate();
    if (!first) return true;
    if (!date) return true;
    return date < first;
  }

  currentTripDay() {
    const date = this.latestDate();
    if (!date) return null;
    return (this.meta.trip_days || []).find((d) => d.date === date) || null;
  }

  /**
   * Advance one event. Returns { event, agentText, visible, mutationResult }
   * Mutations are applied silently (not fed to agent unless body exists and not silent).
   */
  step() {
    const next = this.peek();
    if (!next) return null;

    this.clearUiFocus();
    this.cursor += 1;
    const ev = this.flat[this.cursor];
    let mutationResult = null;

    if (ev.kind === "mutation") {
      mutationResult = this.applyMutation(ev);
      this.mutationsApplied.push({ id: ev.id, time: ev.time, result: mutationResult });
    }

    if (ev.user_state) {
      this.currentState = this.applyUserState(ev.user_state, String(ev.time).slice(0, 10));
    }

    // Mutations apply silently — never marked visible for UI consumers.
    const visible = ev.kind !== "mutation" && !ev.silent;
    this.revealed.push(ev);

    const feedToAgent =
      ev.kind !== "mutation" &&
      !ev.silent &&
      ["user_message", "notification", "world", "app_notification", "env_change", "routine", "weather"].includes(
        ev.kind
      );

    const agentText = feedToAgent ? renderEventForAgent(ev) : "";

    const result = { event: ev, agentText, visible, mutationResult, feedToAgent };
    this.refreshLedger();
    this.emit("step", result);
    return result;
  }

  /** Jump cursor to just before a given flat index (replay from start). */
  seekTo(flatIndex) {
    this.clearUiFocus();
    this.env = structuredClone(this.caseData.env);
    if (!this.env.ledger) this.env.ledger = emptyLedger();
    this.cursor = -1;
    this.currentState = null;
    this.lastWeather = null;
    this.revealed = [];
    this.mutationsApplied = [];
    while (this.cursor < flatIndex - 1 && this.peek()) {
      const ev = this.flat[this.cursor + 1];
      this.cursor += 1;
      if (ev.kind === "mutation") {
        const mutationResult = this.applyMutation(ev);
        this.mutationsApplied.push({ id: ev.id, time: ev.time, result: mutationResult });
      }
      if (ev.user_state) {
        this.currentState = this.applyUserState(ev.user_state, String(ev.time).slice(0, 10));
      }
      this.revealed.push(ev);
    }
    this.refreshLedger();
    this.emit("seek", { cursor: this.cursor });
  }

  applyMutation(ev) {
    return this.applyMutationTo(this.env, ev);
  }

  applyMutationTo(env, ev) {
    const results = [];
    for (const entry of ev.apply || []) {
      const server = entry.server;
      if (entry.table && (entry.op === "update" || entry.op === "upsert")) {
        results.push(this.applyTableUpdate(env, server, entry, ev));
      } else if (entry.tool_call) {
        results.push({ server, tool_call: entry.tool_call.name, note: "tool_call recorded (demo mock)" });
      } else if (entry.sql_file) {
        results.push({ server, sql_file: entry.sql_file, note: "sql_file skipped in browser demo" });
      } else {
        results.push({ server, note: "generic mutation", entry });
      }
    }
    // Case-specific fallbacks (flight delay etc.)
    if (ev.id === "D19_return_delay_mutation") {
      env.flights = env.flights || {};
      env.flights.MU780 = {
        ...(env.flights.MU780 || {}),
        status: "delayed",
        delay_min: 180,
        depart: "14:30",
        gate: "15",
        note: "返程延误 +3h",
      };
    }
    return results;
  }

  applyTableUpdate(env, server, entry, _ev) {
    const table = entry.table;
    const set = { ...(entry.set || {}), ...(entry.values || {}) };
    const where = entry.where || {};
    let collection = null;

    if (server === "flight_booking" || table === "flight_status") {
      env.flights = env.flights || {};
      const fno = set.flight_no || where.flight_no || where.flight_id;
      if (fno) {
        env.flights[fno] = { ...(env.flights[fno] || {}), ...set };
        if (set.actual_depart) {
          const m = String(set.actual_depart).match(/T(\d{2}:\d{2})/);
          if (m) env.flights[fno].depart = m[1];
        }
        return { server, table, updated: 1, flight: fno, set };
      }
    }

    if (server === "maps") {
      if (table === "road_events") collection = env.maps.road_events;
      else if (table === "transit_events") collection = env.maps.transit_events;
    } else if (server === "hotel_booking") {
      env.hotels = env.hotels || {};
      const key = `${where.hotel_id || set.hotel_id || "hotel"}_${where.date || set.date || ""}`;
      env.hotels[key] = { ...(env.hotels[key] || {}), ...where, ...set };
      return { server, table, updated: 1, key, set };
    } else if (server === "weather") {
      collection = env.weather.daily_weather;
    } else if (server === "email") {
      env.emails = env.emails || [];
      const row = { ...where, ...set, mutation: true };
      const id = row.id ?? row.message_id;
      if (id != null) {
        const idx = env.emails.findIndex((e) => (e.id ?? e.message_id) === id);
        if (idx >= 0) env.emails[idx] = { ...env.emails[idx], ...row };
        else env.emails.push(row);
      } else {
        env.emails.push(row);
      }
      return { server, table, updated: 1 };
    }

    if (!collection) {
      return { server, table, updated: 0, note: "no collection", set };
    }

    let updated = 0;
    for (const row of collection) {
      if (matchesWhere(row, where)) {
        Object.assign(row, set);
        updated += 1;
      }
    }
    return { server, table, updated, set, where };
  }

  /** Active road closures for map panel (uses focused snapshot when set). */
  activeRoadEvents() {
    const { env } = this.mapView();
    return (env.maps?.road_events || []).filter((r) => Number(r.active) === 1);
  }

  weatherFor(geoKey, date) {
    const rows = this.env.weather.daily_weather || [];
    return rows.find((r) => r.geo_key === geoKey && r.date === date) || null;
  }
}

function matchesWhere(row, where) {
  return Object.entries(where).every(([k, v]) => String(row[k]) === String(v));
}

/**
 * Sticky cumulative budget across events.
 * - If the new event omits budget, keep the previous one.
 * - spent_cny is monotonic (max of prev/next) so partial snapshots can't regress totals.
 * - remaining always follows total - spent when total is known.
 */
function mergeCumulativeBudget(prevBudget, nextBudget) {
  if (!prevBudget && !nextBudget) return null;
  if (!nextBudget) return { ...prevBudget };
  if (!prevBudget) {
    const total = nextBudget.total_cny != null ? Number(nextBudget.total_cny) : null;
    const spent = Number(nextBudget.spent_cny) || 0;
    return {
      total_cny: total,
      spent_cny: spent,
      remaining_cny:
        total != null
          ? total - spent
          : nextBudget.remaining_cny != null
            ? Number(nextBudget.remaining_cny)
            : null,
    };
  }

  const total =
    nextBudget.total_cny != null
      ? Number(nextBudget.total_cny)
      : prevBudget.total_cny != null
        ? Number(prevBudget.total_cny)
        : null;
  const spent = Math.max(Number(prevBudget.spent_cny) || 0, Number(nextBudget.spent_cny) || 0);
  return {
    total_cny: total,
    spent_cny: spent,
    remaining_cny: total != null ? total - spent : null,
  };
}
