#!/usr/bin/env python3
"""Convert a vibelifebench case (event.yaml + env seeds) into browser-ready JSON.

Usage:
  python scripts/build_data.py [--case PATH] [--out PATH]

Same-format cases work as long as they expose:
  - event.yaml with top-level `stages: {N: [event, ...]}`
  - each event: id, time, kind, body?, user_state?, from?, source?, channel?, apply?, silent?
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

try:
    import yaml
except ImportError as e:  # pragma: no cover
    raise SystemExit("PyYAML required: pip install pyyaml") from e

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CASE = ROOT.parent / "newzealand_drive_30d_fix"
DEFAULT_OUT = ROOT / "data"

# Trip calendar day labels for the day ribbon (override per case via meta).
TRIP_DAY_LABELS = [
    {"day": 1, "date": "2026-10-10", "label": "Depart", "icon": "plane", "place": "基督城"},
    {"day": 2, "date": "2026-10-11", "label": "Tekapo", "icon": "camp", "place": "蒂卡波"},
    {"day": 3, "date": "2026-10-12", "label": "Tekapo", "icon": "camp", "place": "蒂卡波"},
    {"day": 4, "date": "2026-10-13", "label": "Mt. Cook", "icon": "mountain", "place": "库克山"},
    {"day": 5, "date": "2026-10-14", "label": "Queenstown", "icon": "lake", "place": "皇后镇"},
    {"day": 6, "date": "2026-10-15", "label": "Te Anau", "icon": "tree", "place": "蒂阿瑙"},
    {"day": 7, "date": "2026-10-16", "label": "Fiordland", "icon": "boat", "place": "峡湾游船"},
    {"day": 8, "date": "2026-10-17", "label": "Transfer", "icon": "car", "place": "南岛中部"},
    {"day": 9, "date": "2026-10-18", "label": "Picton", "icon": "ferry", "place": "皮克顿"},
    {"day": 10, "date": "2026-10-19", "label": "Ferry", "icon": "ferry", "place": "库克海峡→惠灵顿"},
    {"day": 11, "date": "2026-10-20", "label": "Taupo", "icon": "waterfall", "place": "陶波"},
    {"day": 12, "date": "2026-10-21", "label": "Rotorua", "icon": "hot", "place": "罗托鲁阿"},
    {"day": 13, "date": "2026-10-22", "label": "Auckland", "icon": "city", "place": "奥克兰"},
    {"day": 14, "date": "2026-10-23", "label": "Return", "icon": "plane", "place": "返程准备"},
    {"day": 15, "date": "2026-10-24", "label": "Fly home", "icon": "home", "place": "返程"},
]

WEEKDAY_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def _strip_sql_line_comments(sql_text: str) -> str:
    """Remove `-- ...` comments so inline `;` in comments cannot truncate INSERT bodies."""
    out: list[str] = []
    for line in sql_text.splitlines():
        in_str = False
        i = 0
        cut = len(line)
        while i < len(line):
            ch = line[i]
            if in_str:
                if ch == "'" and i + 1 < len(line) and line[i + 1] == "'":
                    i += 2
                    continue
                if ch == "'":
                    in_str = False
                i += 1
                continue
            if ch == "'":
                in_str = True
                i += 1
                continue
            if ch == "-" and i + 1 < len(line) and line[i + 1] == "-":
                cut = i
                break
            i += 1
        out.append(line[:cut])
    return "\n".join(out)


def _extract_insert_values_blob(sql_text: str, table: str) -> list[tuple[str, str]]:
    """Find INSERT INTO table (cols) VALUES ... ; respecting quotes (notes may contain ';')."""
    sql_text = _strip_sql_line_comments(sql_text)
    out: list[tuple[str, str]] = []
    needle = f"INSERT INTO {table}"
    lower = sql_text.lower()
    start = 0
    while True:
        idx = lower.find(needle.lower(), start)
        if idx < 0:
            break
        rest = sql_text[idx + len(needle) :]
        # columns
        paren = rest.find("(")
        if paren < 0:
            break
        depth = 0
        i = paren
        while i < len(rest):
            ch = rest[i]
            if ch == "'" :
                i += 1
                while i < len(rest):
                    if rest[i] == "'" and i + 1 < len(rest) and rest[i + 1] == "'":
                        i += 2
                        continue
                    if rest[i] == "'":
                        i += 1
                        break
                    i += 1
                continue
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    cols = rest[paren + 1 : i]
                    break
            i += 1
        else:
            break
        after_cols = rest[i + 1 :].lstrip()
        if not after_cols.upper().startswith("VALUES"):
            start = idx + 1
            continue
        values_part = after_cols[6:].lstrip()
        # scan until ; outside quotes/parens
        in_str = False
        depth = 0
        j = 0
        while j < len(values_part):
            ch = values_part[j]
            if in_str:
                if ch == "'" and j + 1 < len(values_part) and values_part[j + 1] == "'":
                    j += 2
                    continue
                if ch == "'":
                    in_str = False
                j += 1
                continue
            if ch == "'":
                in_str = True
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif ch == ";" and depth == 0:
                out.append((cols, values_part[:j]))
                break
            j += 1
        start = idx + 1
    return out


def _parse_sql_inserts(sql_text: str, table: str) -> list[dict]:
    """Very small INSERT parser for seed SQL used in this repo."""
    rows: list[dict] = []
    for cols_raw, values_blob in _extract_insert_values_blob(sql_text, table):
        cols = [c.strip() for c in cols_raw.split(",")]
        # Split top-level tuples (geom JSON may contain nested brackets — keep shallow)
        tuples = re.findall(r"\(([^()]*(?:\([^()]*\)[^()]*)*)\)", values_blob)
        for t in tuples:
            vals = _split_sql_values(t)
            if len(vals) != len(cols):
                continue
            row = {}
            for c, v in zip(cols, vals):
                row[c] = _coerce_sql_value(v)
            rows.append(row)
    return rows


def _split_sql_values(s: str) -> list[str]:
    parts: list[str] = []
    cur: list[str] = []
    in_str = False
    depth = 0
    i = 0
    while i < len(s):
        ch = s[i]
        if in_str:
            cur.append(ch)
            if ch == "'" and i + 1 < len(s) and s[i + 1] == "'":
                cur.append(s[i + 1])
                i += 2
                continue
            if ch == "'":
                in_str = False
            i += 1
            continue
        if ch == "'":
            in_str = True
            cur.append(ch)
        elif ch in "([{":
            depth += 1
            cur.append(ch)
        elif ch in ")]}":
            depth -= 1
            cur.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
        i += 1
    if cur:
        parts.append("".join(cur).strip())
    return parts


def _coerce_sql_value(v: str):
    v = v.strip()
    if v.upper() == "NULL":
        return None
    if v.startswith("'") and v.endswith("'"):
        return v[1:-1].replace("''", "'")
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    if re.fullmatch(r"-?\d+\.\d+", v):
        return float(v)
    return v


def load_events(case_dir: Path) -> dict:
    raw = yaml.safe_load((case_dir / "event.yaml").read_text(encoding="utf-8")) or {}
    stages: dict[str, list] = {}
    for k, evs in (raw.get("stages") or {}).items():
        stages[str(int(k))] = list(evs or [])
    return {"title": (raw.get("title") if isinstance(raw, dict) else None), "stages": stages}


def load_workspace_prompt(case_dir: Path) -> dict:
    ws = case_dir / "workspace"
    files = {}
    for name in ("SOUL.md", "PERSONA.md", "USER.md", "AGENTS.md", "IDENTITY.md", "TOOLS.md", "HEARTBEAT.md"):
        p = ws / name
        if p.exists():
            files[name] = p.read_text(encoding="utf-8")
    return files


def _parse_json_field(value):
    if isinstance(value, (dict, list)) or value is None:
        return value
    if isinstance(value, str):
        s = value.strip()
        if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
            try:
                return json.loads(s)
            except json.JSONDecodeError:
                return value
    return value


def load_env_mock(case_dir: Path) -> dict:
    env: dict = {
        "weather": {"locations": [], "daily_weather": []},
        "maps": {
            "places": [],
            "roads": [],
            "road_events": [],
            "transit_lines": [],
            "transit_stops": [],
            "transit_events": [],
        },
        "flights": {},
    }
    weather_sql = case_dir / "envs/weather/newzealand_drive_30d/init.sql"
    # Prefer case-named folder; fall back to any init.sql under weather/
    if not weather_sql.exists():
        cands = list((case_dir / "envs/weather").glob("*/init.sql"))
        weather_sql = cands[0] if cands else weather_sql
    if weather_sql.exists():
        txt = weather_sql.read_text(encoding="utf-8")
        env["weather"]["locations"] = _parse_sql_inserts(txt, "locations")
        env["weather"]["daily_weather"] = _parse_sql_inserts(txt, "daily_weather")

    maps_sql = case_dir / "envs/maps/newzealand_drive_30d/init.sql"
    if not maps_sql.exists():
        cands = list((case_dir / "envs/maps").glob("*/init.sql"))
        maps_sql = cands[0] if cands else maps_sql
    if maps_sql.exists():
        txt = maps_sql.read_text(encoding="utf-8")
        env["maps"]["places"] = _parse_sql_inserts(txt, "places")
        env["maps"]["roads"] = _parse_sql_inserts(txt, "roads")
        env["maps"]["road_events"] = _parse_sql_inserts(txt, "road_events")
        env["maps"]["transit_lines"] = _parse_sql_inserts(txt, "transit_lines")
        env["maps"]["transit_stops"] = _parse_sql_inserts(txt, "transit_stops")
        env["maps"]["transit_events"] = _parse_sql_inserts(txt, "transit_events")

        # Normalize JSON columns from SQL string literals
        for road in env["maps"]["roads"]:
            road["geom"] = _parse_json_field(road.get("geom_json"))
        for line in env["maps"]["transit_lines"]:
            line["segment_minutes"] = _parse_json_field(line.get("segment_minutes_json"))

        # place_id → geo_key bridge (aligns maps.places with weather.geo_key / event user_state)
        env["maps"]["place_geo_map"] = {
            "pl_chc_airport": "christchurch",
            "pl_tekapo": "tekapo",
            "pl_mt_cook": "mt_cook",
            "pl_queenstown": "queenstown",
            "pl_milford": "milford",
            "pl_wanaka": "wanaka",
            "pl_picton": "picton",
            "pl_wellington": "wellington",
            "pl_taupo": "taupo",
            "pl_rotorua": "rotorua",
            "pl_akl_airport": "auckland",
        }

    # Flight delay seed from event mutations / known case facts
    env["flights"] = {
        "MU779": {"date": "2026-10-10", "status": "on_time", "delay_min": 0, "depart": "11:00", "note": "去程 PVG→CHC"},
        "MU780": {"date": "2026-10-24", "status": "on_time", "delay_min": 0, "depart": "11:30", "gate": "15", "note": "返程 AKL→PVG"},
    }
    return env


def derive_day_index(stages: dict) -> dict:
    """Map calendar date → stage indices that touch that date."""
    by_date: dict[str, list[int]] = {}
    for sk, evs in stages.items():
        for ev in evs:
            t = str(ev.get("time") or "")[:10]
            if not t:
                continue
            by_date.setdefault(t, [])
            si = int(sk)
            if si not in by_date[t]:
                by_date[t].append(si)
    return by_date


def build_prep_days(stages: dict, first_trip_date: str | None) -> list[dict]:
    """Calendar days strictly before trip Day 1, for the prep ribbon chips."""
    from datetime import date

    by_date: dict[str, list[int]] = {}
    labels: dict[str, str] = {}
    places: dict[str, str] = {}
    for sk, evs in stages.items():
        for ev in evs:
            t = str(ev.get("time") or "")[:10]
            if not t:
                continue
            if first_trip_date and t >= first_trip_date:
                continue
            by_date.setdefault(t, [])
            si = int(sk)
            if si not in by_date[t]:
                by_date[t].append(si)
            st = ev.get("user_state") or {}
            if st.get("demo_action") and t not in labels:
                labels[t] = str(st["demo_action"])[:10]
            if st.get("location") and t not in places:
                places[t] = str(st["location"]).split("·")[0].strip()[:8] or "上海"

    out = []
    for i, d in enumerate(sorted(by_date.keys()), start=1):
        dt = date.fromisoformat(d)
        out.append(
            {
                "day": i,
                "date": d,
                "label": labels.get(d) or "行前",
                "icon": "pin",
                "place": places.get(d) or "上海",
                "weekday": WEEKDAY_CN[dt.weekday()],
                "md": f"{dt.month}/{dt.day}",
                "stages": by_date[d],
            }
        )
    return out


def build_meta(case_dir: Path, stages: dict) -> dict:
    toml = case_dir / "task.toml"
    name = case_dir.name
    desc = ""
    if toml.exists():
        text = toml.read_text(encoding="utf-8")
        m = re.search(r'name\s*=\s*"([^"]+)"', text)
        if m:
            name = m.group(1)
        m = re.search(r'description\s*=\s*"([^"]+)"', text)
        if m:
            desc = m.group(1)

    by_date = derive_day_index(stages)
    trip_days = []
    for d in TRIP_DAY_LABELS:
        from datetime import date

        dt = date.fromisoformat(d["date"])
        trip_days.append(
            {
                **d,
                "weekday": WEEKDAY_CN[dt.weekday()],
                "md": f"{dt.month}/{dt.day}",
                "stages": by_date.get(d["date"], []),
            }
        )

    first_trip = trip_days[0]["date"] if trip_days else None
    prep_days = build_prep_days(stages, first_trip)

    # Prep stages (before trip day 1)
    prep_stages = sorted({int(k) for k in stages if int(k) not in {s for td in trip_days for s in td["stages"]} and int(k) < 7})
    post_stages = sorted(
        {
            int(k)
            for k in stages
            if int(k) not in {s for td in trip_days for s in td["stages"]} and int(k) >= 18
        }
    )

    return {
        "case_id": name,
        "title": "NZ南岛房车自驾（15天）",
        "subtitle": "VibeLifeBench",
        "description": desc,
        "budget_total_cny": 50000,
        "trip_days": trip_days,
        "prep_days": prep_days,
        "prep_stages": prep_stages,
        "post_stages": post_stages,
        "speakers": {
            "wang_li": {"name": "王力", "role": "user"},
            "zhao_mei": {"name": "赵梅", "role": "user"},
            "friend_lin": {"name": "林建国", "role": "friend"},
        },
        "kind_labels": {
            "user_message": "用户输入",
            "app_notification": "APP/短信",
            "world": "外部信息",
            "weather": "日期天气",
            "mutation": "静默变更",
            "notification": "系统心跳",
            "routine": "日常节点",
            "env_change": "环境变更",
        },
        "schema_version": 1,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", type=Path, default=DEFAULT_CASE)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    case_dir = args.case.resolve()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)

    events = load_events(case_dir)
    meta = build_meta(case_dir, events["stages"])
    env = load_env_mock(case_dir)
    workspace = load_workspace_prompt(case_dir)

    (out / "events.json").write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "env_state.json").write_text(json.dumps(env, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "workspace.json").write_text(json.dumps(workspace, ensure_ascii=False, indent=2), encoding="utf-8")

    n_ev = sum(len(v) for v in events["stages"].values())
    print(f"Built demo data from {case_dir}")
    print(f"  stages={len(events['stages'])} events={n_ev}")
    print(f"  weather_days={len(env['weather']['daily_weather'])} road_events={len(env['maps']['road_events'])}")
    print(f"  → {out}")
    print("  tip: run scripts/fetch_routes.py to refresh road-following polylines")


if __name__ == "__main__":
    main()
