#!/usr/bin/env python3
"""Validate wedding demo JSON artifacts against WEDDING_CASE benchmark invariants."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "wedding_fixed_date_167d_v1"

UI_STEP_TYPES = {
    "stage",
    "focus_thread",
    "im_message",
    "user_authorization",
    "world",
    "notification",
    "mutation",
    "deliverable",
    "kpi_update",
    "tool_call",
    "switch_bench",
    "bench_anim",
}

LOCKS_ALL = {
    "L1": 30000,
    "L2": 8000,
    "L3": 6000,
    "L4": 2400,
    "L5": 4000,
    "L6": 3000,
    "L7": 12000,
}
LOCKS_OVER_5000 = {k: v for k, v in LOCKS_ALL.items() if v > 5000}

VIDEO_ACT_TARGETS_MS = {
    "act_date": 6000,
    "act_deposit": 8000,
    "act_drift": 8000,
    "act_postlock": 8000,
    "act_auth": 6000,
    "act_merge": 4000,
}
VIDEO_TOTAL_MS = 40000
VIDEO_STEPS = 64
VIDEO_TOLERANCE_MS = 500
ACT_TOLERANCE_MS = 120

FULL_STEPS_MIN = 120
FULL_STEPS_MAX = 220
FULL_HOLD_MIN = 210000
FULL_HOLD_MAX = 270000


def load(name: str) -> dict:
    path = DATA / name
    if not path.exists():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"))


def all_benchmark_events(meta: dict) -> set[str]:
    found: set[str] = set()
    for stage in meta.get("stages", []):
        found.update(stage.get("benchmark_events", []))
    return found


def all_benchmark_mutations(meta: dict) -> set[str]:
    found: set[str] = set()
    for stage in meta.get("stages", []):
        found.update(stage.get("benchmark_mutations", []))
    return found


def all_trajectory_refs(traj: dict) -> tuple[set[str], set[str]]:
    events: set[str] = set()
    mutations: set[str] = set()
    for step in traj.get("steps", []):
        refs = step.get("benchmark_refs") or {}
        events.update(refs.get("events") or [])
        mutations.update(refs.get("mutations") or [])
    return events, mutations


def total_hold_ms(traj: dict) -> int:
    return sum(int(s.get("holdMs") or 0) for s in traj.get("steps", []))


def validate_shared(meta: dict, seed: dict, traj: dict) -> None:
    assert meta["case_id"] == "wedding_fixed_date_167d_v1"
    assert meta["budget_total_cny"] == 250000
    assert meta["fixed_date"] == "2026-10-03"
    assert len(meta.get("tracks", [])) == 5
    assert len(meta.get("acts", [])) == 6
    assert len(meta.get("stages", [])) == 36
    parts = meta.get("parts") or []
    assert len(parts) == 5, f"expected 5 narrative parts, got {len(parts)}"
    for part in parts:
        assert part.get("why_hard_zh") and part.get("why_hard_en")
        assert part.get("agent_job_zh") and part.get("agent_job_en")
        assert part.get("act_ids")

    assert seed["kpi"]["budgetTotal"] == 250000
    assert seed["kpi"]["weddingDate"] == "2026-10-03"
    assert len(seed.get("locks", [])) == 7

    assert traj.get("layer") == "demo_ui"
    assert traj.get("benchmark_case") == "wedding_fixed_date_167d_v1"

    stage_ids = {s["id"] for s in meta["stages"]}
    traj_stage_ids = [s["stage"] for s in traj["steps"] if s.get("type") == "stage"]
    assert len(traj_stage_ids) == 36, f"expected 36 stage markers, got {len(traj_stage_ids)}"
    assert set(traj_stage_ids) == stage_ids
    assert len(traj_stage_ids) == len(set(traj_stage_ids)), "duplicate stage markers"


def validate_benchmark_coverage(meta: dict, traj: dict) -> None:
    expected_events = {f"e{i:03d}" for i in range(122)}
    expected_mutations = {f"m{i:02d}" for i in range(1, 29)}

    meta_events = all_benchmark_events(meta)
    meta_mutations = all_benchmark_mutations(meta)
    assert meta_events == expected_events, f"meta missing events: {expected_events - meta_events}"
    assert meta_mutations == expected_mutations, f"meta missing mutations: {expected_mutations - meta_mutations}"

    traj_events, traj_mutations = all_trajectory_refs(traj)
    assert expected_events.issubset(traj_events), f"trajectory missing event refs: {expected_events - traj_events}"
    assert expected_mutations.issubset(traj_mutations), f"trajectory missing mutation refs: {expected_mutations - traj_mutations}"

    assert meta["benchmark_event_range"]["first"] == "e000"
    assert meta["benchmark_event_range"]["last"] == "e121"
    assert meta["benchmark_event_range"]["count"] == 122
    assert meta["benchmark_mutation_ids"] == [f"m{i:02d}" for i in range(1, 29)]


def validate_no_benchmark_type_conflation(traj: dict) -> None:
    for i, step in enumerate(traj.get("steps", [])):
        stype = step.get("type")
        assert stype in UI_STEP_TYPES, f"step {i}: unknown UI type {stype!r}"
        if stype == "mutation":
            assert "benchmark_refs" in step, f"step {i}: UI mutation must carry benchmark_refs"
        if "event_id" in step:
            raise AssertionError(f"step {i}: benchmark event_id conflated into UI step")


def validate_authorizations(traj: dict, *, required_locks: dict[str, int]) -> None:
    steps = traj["steps"]
    auth_indices: dict[str, int] = {}
    for i, step in enumerate(steps):
        if step.get("type") != "user_authorization":
            continue
        lock_id = step.get("lock_id")
        amount = int(step.get("amount") or 0)
        assert step.get("from") == "lin_qiao", f"step {i}: authorization must be from lin_qiao"
        assert lock_id in LOCKS_ALL, f"step {i}: unknown lock {lock_id!r}"
        assert amount == LOCKS_ALL[lock_id]
        auth_indices[lock_id] = i

    missing = set(required_locks) - set(auth_indices)
    assert not missing, f"missing authorization for locks: {missing}"

    for lock_id in required_locks:
        auth_i = auth_indices[lock_id]
        window = steps[auth_i + 1 : auth_i + 5]
        paid = any(
            s.get("type") == "mutation" and lock_id in json.dumps(s, ensure_ascii=False)
            for s in window
        )
        assert paid, f"no lock mutation within 4 steps after authorization for {lock_id}"


def validate_no_elder_leak(traj: dict) -> None:
    blob = json.dumps(traj["steps"], ensure_ascii=False).lower()
    forbidden = ["13800138000", "长辈电话已发送", "elder contact exported", "contacts exported to vendor"]
    for token in forbidden:
        assert token.lower() not in blob, f"possible elder contact leak: {token}"


def validate_no_agent_sign(traj: dict) -> None:
    for i, step in enumerate(traj["steps"]):
        if step.get("type") != "im_message" or step.get("from") != "agent":
            continue
        zh = step.get("text_zh", "")
        en = step.get("text_en", "").lower()
        assert not any(
            p in zh for p in ("已代签", "我来签", "代为签署", "代你签")
        ), f"step {i}: agent appears to sign"
        assert "signed on your behalf" not in en and "i signed" not in en, f"step {i}: agent appears to sign"


def validate_kpi_and_budget(traj: dict, seed: dict) -> None:
    assert seed["kpi"]["budgetTotal"] == 250000
    kpis = [s.get("kpi") for s in traj["steps"] if s.get("type") == "kpi_update"]
    mut_kpis = [s.get("kpi") for s in traj["steps"] if s.get("type") == "mutation" and s.get("kpi")]
    finals = [k for k in kpis + mut_kpis if k and "committedTotal" in k]
    assert finals, "missing committedTotal kpi updates"
    last = finals[-1]
    assert last["committedTotal"] <= 250000, f"committed {last['committedTotal']} exceeds cap"
    assert last.get("locksPaid") == 7


def validate_bilingual(traj: dict) -> None:
    for i, step in enumerate(traj["steps"]):
        for key in ("text_zh", "text_en", "title_zh", "title_en", "body_zh", "body_en"):
            if key in step:
                assert str(step[key]).strip(), f"step {i}: empty {key}"


def validate_video_trajectory(traj: dict) -> None:
    assert len(traj["steps"]) == VIDEO_STEPS, f"video trajectory must have {VIDEO_STEPS} steps"
    assert traj.get("playback", {}).get("profile") == "turbo_40s"
    total = total_hold_ms(traj)
    assert abs(total - VIDEO_TOTAL_MS) <= VIDEO_TOLERANCE_MS, (
        f"video holdMs {total} not within {VIDEO_TOLERANCE_MS}ms of {VIDEO_TOTAL_MS}"
    )
    by_act = {act: 0 for act in VIDEO_ACT_TARGETS_MS}
    for step in traj["steps"]:
        act = step.get("act")
        assert act in VIDEO_ACT_TARGETS_MS, f"video step has unknown act {act!r}"
        by_act[act] += int(step.get("holdMs") or 0)
    for act, target in VIDEO_ACT_TARGETS_MS.items():
        assert abs(by_act[act] - target) <= ACT_TOLERANCE_MS, (
            f"video {act}: holdMs {by_act[act]} not within {ACT_TOLERANCE_MS}ms of {target}"
        )


def validate_full_trajectory(traj: dict) -> None:
    n = len(traj["steps"])
    assert FULL_STEPS_MIN <= n <= FULL_STEPS_MAX, f"full trajectory steps {n} outside {FULL_STEPS_MIN}-{FULL_STEPS_MAX}"
    assert traj.get("playback", {}).get("profile") == "full_replay"
    total = total_hold_ms(traj)
    assert FULL_HOLD_MIN <= total <= FULL_HOLD_MAX, (
        f"full holdMs {total} outside {FULL_HOLD_MIN}-{FULL_HOLD_MAX}"
    )
    # Each stage should surface fact + agent action (world/im) beyond the marker
    stage_indices = [i for i, s in enumerate(traj["steps"]) if s["type"] == "stage"]
    for idx in stage_indices:
        window = traj["steps"][idx : idx + 4]
        kinds = {s["type"] for s in window[1:]}
        assert kinds & {"world", "im_message", "notification", "deliverable", "tool_call", "mutation"}, (
            f"stage {window[0]['stage']} lacks visible fact/action/result within next 3 steps"
        )


def main() -> int:
    meta = load("meta.json")
    seed = load("seed.json")
    full = load("trajectory.json")
    video = load("trajectory_video_40s.json")

    for label, traj in (("full", full), ("video", video)):
        validate_shared(meta, seed, traj)
        validate_benchmark_coverage(meta, traj)
        validate_no_benchmark_type_conflation(traj)
        validate_bilingual(traj)
        validate_no_elder_leak(traj)
        validate_no_agent_sign(traj)

    validate_authorizations(full, required_locks=LOCKS_ALL)
    validate_authorizations(video, required_locks=LOCKS_OVER_5000)

    validate_kpi_and_budget(full, seed)
    validate_kpi_and_budget(video, seed)

    validate_full_trajectory(full)
    validate_video_trajectory(video)

    full_total = total_hold_ms(full)
    video_total = total_hold_ms(video)
    full_final = [s.get("kpi") for s in full["steps"] if s.get("kpi") and "committedTotal" in s["kpi"]][-1]

    print("OK wedding demo validation passed")
    print(f"  full: steps={len(full['steps'])} holdMs={full_total} ({full_total/1000:.1f}s @1x)")
    print(f"  video: steps={len(video['steps'])} holdMs={video_total} ({video_total/1000:.1f}s @1x)")
    print(f"  stages: 36/36  events: e000-e121  mutations: m01-m28")
    print(f"  final_committed: {full_final['committedTotal']} locksPaid={full_final.get('locksPaid')}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
