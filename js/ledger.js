/**
 * Demo ledger: flights / hotels / calendar / notion synthesized from playback.
 * Shape aligns with future MCP writes so UI can stay stable.
 */

export function emptyLedger() {
  return {
    flights: [],
    hotels: [],
    calendar: [],
    notion: {
      title: "NZ Road Trip 2026 — Journal",
      sections: { journal: "", expense: "", safety: "" },
    },
    changes: [],
  };
}

/**
 * @param {{ revealed: object[], meta: object, env?: object, dateEnd?: string|null, preOnly?: boolean }} opts
 */
export function buildLedger({ revealed = [], meta = {}, env = {}, dateEnd = null, preOnly = false } = {}) {
  const first = meta.trip_days?.[0]?.date || null;
  const events = revealed.filter((ev) => {
    const d = String(ev.time).slice(0, 10);
    if (preOnly) return !first || d < first;
    if (dateEnd && d > dateEnd) return false;
    return true;
  });

  const ledger = emptyLedger();
  const changes = [];
  const ids = new Set(events.map((e) => e.id));
  const latestDate = events.length ? String(events[events.length - 1].time).slice(0, 10) : null;

  let spent = 0;
  let flightNo = null;
  let returnFlightNo = "MU780";

  for (const ev of events) {
    const st = ev.user_state;
    if (!st) continue;
    if (Number(st.budget?.spent_cny) > spent) spent = Number(st.budget.spent_cny);
    if (st.next_flight?.flight_no) flightNo = st.next_flight.flight_no;
  }

  // —— Flights ——
  if (spent > 0 && flightNo) {
    const bookedAt = firstDateWith((ev) => Number(ev.user_state?.budget?.spent_cny) > 0, events) || latestDate;
    ledger.flights.push({
      id: "flt_outbound",
      flight_no: flightNo,
      route: "PVG → CHC",
      date: "2026-10-10",
      status: "confirmed",
      booked_at: bookedAt,
      note: "去程已出票",
    });
    ledger.flights.push({
      id: "flt_return",
      flight_no: returnFlightNo,
      route: "AKL → PVG",
      date: "2026-10-24",
      status: ids.has("D19_return_delay_mutation") ? "delayed" : "confirmed",
      booked_at: bookedAt,
      note: ids.has("D19_return_delay_mutation") ? "返程延误 +3h · 登机口 15" : "返程已出票",
      delay_min: ids.has("D19_return_delay_mutation") ? 180 : 0,
    });
    // Prefer live env.flights overlay
    for (const f of ledger.flights) {
      const live = env.flights?.[f.flight_no];
      if (live) {
        if (live.status && live.status !== "on_time") f.status = live.status;
        else if (live.status === "on_time" && f.status === "confirmed") {
          /* keep confirmed */
        } else if (live.status) f.status = live.status;
        if (live.delay_min != null) f.delay_min = live.delay_min;
        if (live.note) f.note = live.note;
        if (live.depart) f.depart = live.depart;
        if (live.gate) f.gate = live.gate;
      }
    }
    pushChange(changes, {
      at: bookedAt,
      kind: "flight",
      tab: "trip",
      icon: "✈️",
      text: `已订 ${flightNo}`,
    });
    if (ids.has("D19_return_delay_mutation")) {
      pushChange(changes, {
        at: "2026-10-23",
        kind: "flight",
        tab: "trip",
        icon: "✈️",
        text: `${returnFlightNo} 延误 +3h`,
      });
    }
  }

  // —— Hotels ——
  // Early stay: Tekapo holiday park once camping days reached
  if (events.some((e) => e.user_state?.geo_key === "tekapo")) {
    const at = firstDateWith((e) => e.user_state?.geo_key === "tekapo", events) || "2026-10-11";
    ledger.hotels.push({
      id: "htl_tekapo_park",
      hotel_id: "htl_tekapo_park",
      name: "Tekapo Lakeside Holiday Park",
      place_id: "pl_tekapo",
      check_in: "2026-10-11",
      check_out: "2026-10-13",
      status: "confirmed",
      refundable: true,
      price_nzd: 55,
      note: "营地",
      booked_at: at,
    });
    pushChange(changes, { at, kind: "hotel", tab: "trip", icon: "🏨", text: "蒂卡波营地已订" });
  }

  const surgeDone = ids.has("D11_mut_hotel_price_surge") || ids.has("D11_hotel_surge_notice");
  const reselectDone = ids.has("D11_user_hotel_budget");
  if (surgeDone || reselectDone || events.some((e) => e.user_state?.geo_key === "queenstown")) {
    const at = firstDateWith(
      (e) =>
        e.id === "D11_mut_hotel_price_surge" ||
        e.id === "D11_hotel_surge_notice" ||
        e.user_state?.geo_key === "queenstown",
      events
    ) || "2026-10-14";

    if (reselectDone) {
      ledger.hotels.push({
        id: "htl_qtown_lakeview",
        hotel_id: "htl_qtown_lakeview",
        name: "Queenstown Lakeview Motel",
        place_id: "pl_queenstown",
        check_in: "2026-10-14",
        check_out: "2026-10-15",
        status: "cancelled",
        refundable: false,
        price_nzd: 145,
        note: "涨价后退订",
        booked_at: at,
      });
      ledger.hotels.push({
        id: "htl_qtown_alpine",
        hotel_id: "htl_qtown_alpine",
        name: "Queenstown Alpine Lodge",
        place_id: "pl_queenstown",
        check_in: "2026-10-14",
        check_out: "2026-10-15",
        status: "confirmed",
        refundable: true,
        price_nzd: 89,
        note: "可退 · 换订",
        booked_at: at,
      });
      pushChange(changes, {
        at,
        kind: "hotel",
        tab: "trip",
        icon: "🏨",
        text: "皇后镇换订 alpine（可退）",
      });
    } else if (surgeDone) {
      const surgePrice = env.hotels
        ? Object.values(env.hotels).find((h) => String(h.hotel_id || "").includes("lakeview"))?.nightly_price || 145
        : 145;
      ledger.hotels.push({
        id: "htl_qtown_lakeview",
        hotel_id: "htl_qtown_lakeview",
        name: "Queenstown Lakeview Motel",
        place_id: "pl_queenstown",
        check_in: "2026-10-14",
        check_out: "2026-10-15",
        status: "confirmed",
        refundable: false,
        price_nzd: Number(surgePrice) || 145,
        note: "涨价中 · 待换订",
        booked_at: at,
      });
      pushChange(changes, {
        at,
        kind: "hotel",
        tab: "trip",
        icon: "🏨",
        text: `Lakeview 涨至 NZ$${surgePrice}`,
      });
    } else {
      ledger.hotels.push({
        id: "htl_qtown_lakeview",
        hotel_id: "htl_qtown_lakeview",
        name: "Queenstown Lakeview Motel",
        place_id: "pl_queenstown",
        check_in: "2026-10-14",
        check_out: "2026-10-15",
        status: "confirmed",
        refundable: true,
        price_nzd: 58,
        note: "原价",
        booked_at: at,
      });
    }
  }

  // Rotorua lodging once there
  if (events.some((e) => e.user_state?.geo_key === "rotorua")) {
    const at = firstDateWith((e) => e.user_state?.geo_key === "rotorua", events) || "2026-10-21";
    ledger.hotels.push({
      id: "htl_rotorua",
      hotel_id: "htl_rotorua_spa",
      name: "Rotorua Spa Motel",
      place_id: "pl_rotorua",
      check_in: "2026-10-21",
      check_out: "2026-10-22",
      status: "confirmed",
      refundable: true,
      price_nzd: 72,
      note: "温泉友好",
      booked_at: at,
    });
  }

  // —— Calendar (one row per reached trip day) ——
  for (const day of meta.trip_days || []) {
    if (dateEnd && day.date > dateEnd) continue;
    if (preOnly) continue;
    if (!latestDate || day.date > latestDate) continue;
    const summary = calendarSummary(day);
    ledger.calendar.push({
      id: `cal_${day.date}`,
      date: day.date,
      summary,
      source: "itinerary",
      day: day.day,
      place: day.place,
    });
  }
  if (ledger.calendar.length) {
    const last = ledger.calendar[ledger.calendar.length - 1];
    pushChange(changes, {
      at: last.date,
      kind: "calendar",
      tab: "trip",
      icon: "📅",
      text: `+${ledger.calendar.length} 日历`,
    });
  }

  // —— Notion ——
  const safetyBits = [];
  if (events.some((e) => /靠左|左舵|IDP|驾照/.test(String(e.body || "")))) {
    safetyBits.push("靠左驾驶 + IDP/翻译件提醒已记入");
  }
  if (ids.has("D8_mut_quake_sh80_closure") || ids.has("D8_earthquake_alert")) {
    safetyBits.push("SH80 震后落石：留缓冲 / 等开放");
  }
  if (ids.has("D9_milford_road_closed_mutation") || ids.has("D9_milford_closed_notice")) {
    safetyBits.push("SH94 米尔福德封路 → 改 Doubtful Sound");
  }
  ledger.notion.sections.safety = safetyBits.join("\n");

  const journalBits = [];
  if (events.some((e) => e.user_state?.geo_key === "mt_cook")) {
    journalBits.push("库克山：胡克谷平缓步道 + 蒂卡波观星（赵梅低强度）");
  }
  if (events.some((e) => e.user_state?.geo_key === "queenstown")) {
    journalBits.push("皇后镇 / 瓦纳卡湖：缆车与湖畔漫步");
  }
  // s16 restaurant rebook → Notion gate
  if (
    ids.has("D16_user_dinner_lowsalt") ||
    ids.has("D16_restaurant_notice") ||
    ids.has("D16_user_rotorua") ||
    events.some((e) => /少盐|清淡|菜单/.test(String(e.body || "")) && e.user_state?.geo_key === "rotorua")
  ) {
    journalBits.push("罗托鲁阿：改订 Lakeside Light Grill（少盐 / 清淡 / 可取消）");
    pushChange(changes, {
      at: firstDateWith(
        (e) =>
          e.id === "D16_user_dinner_lowsalt" ||
          e.id === "D16_restaurant_notice" ||
          /少盐|清淡|菜单/.test(String(e.body || "")),
        events
      ) || "2026-10-21",
      kind: "notion",
      tab: "notes",
      icon: "📝",
      text: "少盐餐厅已记入 Notion",
    });
  }
  if (events.some((e) => e.user_state?.geo_key === "rotorua")) {
    journalBits.push("地热间歇泉 + 温泉（关节炎友好）");
  }
  ledger.notion.sections.journal = journalBits.join("\n");

  const expenseBits = [];
  if (spent > 0) {
    expenseBits.push(`累计已用约 ¥${Math.round(spent).toLocaleString("zh-CN")}（含机票等）`);
  }
  if (reselectDone) {
    expenseBits.push("皇后镇：Lakeview 退订 · Alpine NZ$89 可退入住");
  }
  if (ids.has("D19_user_total") || ids.has("D25_user_wrap")) {
    expenseBits.push("返程/收尾：费用对账与押金正规渠道核对");
  }
  ledger.notion.sections.expense = expenseBits.join("\n");

  if (ledger.notion.sections.journal || ledger.notion.sections.expense || ledger.notion.sections.safety) {
    if (!changes.some((c) => c.kind === "notion")) {
      pushChange(changes, {
        at: latestDate,
        kind: "notion",
        tab: "notes",
        icon: "📝",
        text: "游记有更新",
      });
    }
  }

  // Prefer booking diffs over calendar noise for the 1–2 line ticker
  ledger.changes = preferTickerChanges(dedupeChanges(changes), 2);
  return ledger;
}

function preferTickerChanges(arr, n) {
  const important = arr.filter((c) => c.kind === "hotel" || c.kind === "flight" || c.kind === "notion");
  const pool = important.length ? important : arr;
  return pool.slice(-n);
}

function calendarSummary(day) {
  const label = day.label || "";
  const place = day.place || "";
  if (/Depart|基督/.test(label + place)) return `✈️ 航班落地 · ${place}`;
  if (/Tekapo|蒂卡波/.test(label + place)) return `⛺ 营地 · ${place}`;
  if (/Cook|库克/.test(label + place)) return `🏔️ 景点日 · ${place}`;
  if (/Queenstown|皇后/.test(label + place)) return `🏞️ 湖畔 / 住宿 · ${place}`;
  if (/Wanaka|瓦纳卡/.test(label + place)) return `🌳 支线日 · ${place}`;
  if (/Fiord|峡湾/.test(label + place)) return `⛵ 峡湾游船 · ${place}`;
  if (/Transfer|南岛北上/.test(label + place)) return `🚗 DRIVE 转场 · ${place}`;
  if (/Ferry|皮克顿/.test(label + place)) return `⛴️ 渡轮日 · ${place}`;
  if (/Wellington|惠灵顿/.test(label + place)) return `🏙️ 北岛 · ${place}`;
  if (/Taupo|陶波/.test(label + place)) return `💧 湖畔 · ${place}`;
  if (/Rotorua|罗托鲁阿/.test(label + place)) return `♨️ 地热 / 晚宴 · ${place}`;
  if (/Auckland|奥克兰|Return|返/.test(label + place)) return `✈️ 还车返程 · ${place}`;
  return `📍 ${place || label}`;
}

function firstDateWith(pred, events) {
  const hit = events.find(pred);
  return hit ? String(hit.time).slice(0, 10) : null;
}

function pushChange(arr, item) {
  if (!item?.text) return;
  arr.push(item);
}

function dedupeChanges(arr) {
  const seen = new Set();
  const out = [];
  for (const c of arr) {
    const k = `${c.kind}|${c.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Group ledger items by date for trip timeline UI. */
export function groupLedgerByDate(ledger, { expandDate } = {}) {
  const map = new Map();
  const ensure = (date) => {
    if (!map.has(date)) map.set(date, { date, calendar: [], flights: [], hotels: [] });
    return map.get(date);
  };

  for (const c of ledger.calendar || []) ensure(c.date).calendar.push(c);
  for (const f of ledger.flights || []) ensure(f.date).flights.push(f);
  for (const h of ledger.hotels || []) ensure(h.check_in).hotels.push(h);

  const dates = [...map.keys()].sort();
  return dates.map((date) => ({
    ...map.get(date),
    open: expandDate ? date === expandDate : date === dates[dates.length - 1],
  }));
}
