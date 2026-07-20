#!/usr/bin/env python3
"""Fetch OSRM driving polylines for demo itinerary legs → data/routes.json.

Also enriches stub road geoms in env_state.json when present.

Usage:
  python3 scripts/fetch_routes.py [--out demo/data]
"""
from __future__ import annotations

import argparse
import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data"

PAIRS = [
    ("pl_chc_airport", "pl_tekapo"),
    ("pl_tekapo", "pl_mt_cook"),
    ("pl_mt_cook", "pl_tekapo"),
    ("pl_mt_cook", "pl_wanaka"),  # Day5 leave spur → Lindis / Wanaka
    ("pl_wanaka", "pl_queenstown"),
    ("pl_tekapo", "pl_queenstown"),
    ("pl_queenstown", "pl_milford"),
    ("pl_milford", "pl_queenstown"),
    ("pl_queenstown", "pl_wanaka"),
    ("pl_milford", "pl_tekapo"),
    ("pl_tekapo", "pl_picton"),
    ("pl_wellington", "pl_taupo"),
    ("pl_taupo", "pl_rotorua"),
    ("pl_rotorua", "pl_akl_airport"),
]

ROAD_FROM_LEG = {
    "rd_sh80_mtcook": "pl_tekapo>pl_mt_cook",
    "rd_sh8_tekapo": "pl_chc_airport>pl_tekapo",
    "rd_sh94_milford": "pl_queenstown>pl_milford",
}


def haversine_m(a, b):
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def perpendicular_m(p, a, b):
    if a == b:
        return haversine_m(p, a)
    ax = a[1] * 111320 * math.cos(math.radians(a[0]))
    ay = a[0] * 110540
    bx = b[1] * 111320 * math.cos(math.radians(b[0]))
    by = b[0] * 110540
    px = p[1] * 111320 * math.cos(math.radians(p[0]))
    py = p[0] * 110540
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def douglas_peucker(pts, eps):
    if len(pts) < 3:
        return pts
    max_d, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = perpendicular_m(pts[i], pts[0], pts[-1])
        if d > max_d:
            max_d, idx = d, i
    if max_d > eps:
        left = douglas_peucker(pts[: idx + 1], eps)
        right = douglas_peucker(pts[idx:], eps)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def fetch_leg(p1: dict, p2: dict) -> tuple[list, float]:
    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{p1['lng']},{p1['lat']};{p2['lng']},{p2['lat']}"
        "?overview=full&geometries=geojson"
    )
    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.load(r)
    if data.get("code") != "Ok" or not data.get("routes"):
        raise RuntimeError(data.get("code") or "no route")
    coords = data["routes"][0]["geometry"]["coordinates"]
    latlngs = [[lat, lng] for lng, lat in coords]
    return latlngs, float(data["routes"][0]["distance"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--eps", type=float, default=80.0, help="Douglas-Peucker tolerance in meters")
    args = ap.parse_args()
    out: Path = args.out.resolve()
    env_path = out / "env_state.json"
    if not env_path.exists():
        raise SystemExit(f"missing {env_path} — run build_data.py first")

    env = json.loads(env_path.read_text(encoding="utf-8"))
    by = {p["place_id"]: p for p in env["maps"]["places"]}

    routes: dict = {}
    for a, b in PAIRS:
        if a not in by or b not in by:
            print(f"skip {a}->{b}: place missing")
            continue
        try:
            pts, dist = fetch_leg(by[a], by[b])
            simp = douglas_peucker(pts, args.eps)
            if len(simp) < 8 and len(pts) > 8:
                simp = douglas_peucker(pts, args.eps / 2)
            key = f"{a}>{b}"
            routes[key] = {
                "coordinates": [[round(lat, 5), round(lng, 5)] for lat, lng in simp],
                "distance_m": dist,
                "source": "osrm",
                "simplified": True,
            }
            print(f"OK {key}: {len(pts)} -> {len(simp)} pts, {dist/1000:.1f}km")
        except Exception as e:
            print(f"FAIL {a}->{b}: {e}")

    (out / "routes.json").write_text(json.dumps(routes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for road in env["maps"].get("roads") or []:
        key = ROAD_FROM_LEG.get(road.get("road_id"))
        if not key or key not in routes:
            continue
        coords = [[lng, lat] for lat, lng in routes[key]["coordinates"]]
        road["geom"] = {"type": "LineString", "coordinates": coords}
        print(f"enriched road {road['road_id']}: {len(coords)} pts")

    env_path.write_text(json.dumps(env, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"→ {out / 'routes.json'} ({len(routes)} legs)")


if __name__ == "__main__":
    main()
