#!/usr/bin/env python3
"""Generate wedding demo trajectories: full replay + optional video sync."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "wedding_fixed_date_167d_v1"
META_PATH = DATA / "meta.json"
FULL_OUT = DATA / "trajectory.json"

# Per-step holdMs defaults tuned for ~240s total at ~145 steps
H = {
    "stage": 1500,
    "im": 1700,
    "world": 1300,
    "notification": 1100,
    "mutation": 1200,
    "deliverable": 1500,
    "kpi": 1300,
    "tool": 1400,
    "bench": 900,
    "auth_major": 1900,
    "auth_minor": 1600,
    "focus": 700,
    "anim": 2200,
}

STAGE_COPY = {
    "kickoff": {
        "fact_zh": "长辈确定婚期 2026-10-03，预算硬顶 ¥250,000。",
        "fact_en": "Elders fixed date 2026-10-03; budget cap ¥250,000.",
        "agent_zh": "建立总约束：不改婚期，不列改期方案。",
        "agent_en": "Set hard constraints: date immutable; no reschedule options.",
    },
    "hard_constraints": {
        "fact_zh": "汇总定金、隐私与授权规则。",
        "fact_en": "Deposit, privacy, and authorization rules consolidated.",
        "agent_zh": "生成授权矩阵：>¥5,000 当次询问；不代签；长辈联系方式不外发。",
        "agent_en": "Build auth matrix: >¥5,000 needs fresh ask; no signing; no elder contact export.",
    },
    "ledger_bootstrap": {
        "fact_zh": "场地餐饮在合同、摄影在聊天、婚纱/四金/司仪/车队/请柬各有单子——口径不一，从没并到同一张账。",
        "fact_en": "Venue in the contract, photo in chat; gown, gold, MC, fleet, invites each on their own bill — never one account.",
        "agent_zh": "并成同一张账：逐笔认清性质（定金/不可退/已应），分进五轨并留应急预备金；超限不代拍板。",
        "agent_en": "Merge into one ledger: classify each line (deposit/nonrefundable/pre-agreed), sort into five tracks with contingency; never decide over-limit alone.",
    },
    "parallel_plan": {
        "fact_zh": "每一笔都合情合理，加起来却放不下 ¥250,000；五轨都指向 10-03 同一终点。",
        "fact_en": "Every line is reasonable alone, yet together they no longer fit ¥250,000; five tracks share 10-03.",
        "agent_zh": "建依赖图与 7 个不可退锁点；先把连锁挤占算给新人看，再开多线并行。",
        "agent_en": "Build dependency graph and 7 nonrefundable locks; show knock-on squeeze first, then open five-track parallel.",
    },
    "venue_shortlist": {
        "fact_zh": "三家场地报价与条款口径不同。",
        "fact_en": "Three venue quotes with incompatible terms.",
        "agent_zh": "标准化比较：最低消费、容量、定金、换场条款。",
        "agent_en": "Normalize compare: minimum spend, capacity, deposit, change terms.",
    },
    "venue_capacity": {
        "fact_zh": "最低 20 桌、消防容量 26 桌、定金 ¥30,000 不可退。",
        "fact_en": "20-table minimum, 26-table cap, ¥30,000 nonrefundable deposit.",
        "agent_zh": "量化少桌最低消费损失与超容换场损失；口头 28 桌不计，用 26。",
        "agent_en": "Quantify under-min and over-cap losses; ignore verbal 28—use 26.",
    },
    "guest_range_v0": {
        "fact_zh": "初版名单有重复 household。",
        "fact_en": "Draft guest list has duplicate households.",
        "agent_zh": "去重并估算桌数区间 18 / 22 / 28。",
        "agent_en": "Dedupe and estimate 18 / 22 / 28 tables.",
    },
    "venue_contract_v1": {
        "fact_zh": "合同 v1 最低消费 20 桌。",
        "fact_en": "Contract v1 minimum spend: 20 tables.",
        "agent_zh": "条款 diff 完成；我不代签，请你审阅。",
        "agent_en": "Term diff done; I won't sign—please review.",
    },
    "deposit_gate": {
        "fact_zh": "定金月底前要交，来多少人却要两个月后才数清；不交留不住日子，交了人数仍未知。",
        "fact_en": "Deposit due by month-end; headcount only clear in two months — not paying loses the date, paying still leaves count unknown.",
        "agent_zh": "截止日倒排进一张图；桌数按 18/22/28 分别算最坏损失；需拍板处单独问，不代签。",
        "agent_en": "Back-schedule deadlines onto one chart; compute worst-case for 18/22/28 tables; raise only nod-needed points — no signing.",
    },
    "venue_authorization": {
        "fact_zh": "场地书面确认旧 20 桌基准有效。",
        "fact_en": "Venue confirms old 20-table baseline in writing.",
        "agent_zh": "单独询问：是否授权支付 ¥30,000 场地定金？",
        "agent_en": "Separate ask: authorize ¥30,000 venue deposit?",
    },
    "venue_lock": {
        "fact_zh": "用户当次授权场地定金。",
        "fact_en": "User authorized venue deposit this session.",
        "agent_zh": "执行 L1 锁并写回账本；锁不可回滚。",
        "agent_en": "Execute L1 lock and write ledger; lock is irreversible.",
    },
    "photo_shortlist": {
        "fact_zh": "国庆档摄影通常提前四个月满。",
        "fact_en": "National Day photo slots fill ~4 months ahead.",
        "agent_zh": "核主摄作品、合同姓名、档期 hold 与替换条款。",
        "agent_en": "Verify lead portfolio, contract name, hold, swap terms.",
    },
    "photo_hold": {
        "fact_zh": "国庆档紧张；供应商页面显示「已锁定 48h」。",
        "fact_en": "Holiday slots scarce; vendor page shows “Locked 48h”.",
        "agent_zh": "不信单页文案；同时记下 order_id 与 hold_expiry，准备交叉核验。",
        "agent_en": "Don't trust the page alone; record order_id and hold_expiry for cross-check.",
    },
    "photo_hold_release": {
        "fact_zh": "后台 hold 已 released，页面缓存仍写着锁定。",
        "fact_en": "Backend hold released; page cache still says locked.",
        "agent_zh": "绝不报假锁；立刻启动替代团队比较与预算再算。",
        "agent_en": "Never report a false lock; start alternate compare and rebudget now.",
    },
    "photo_recovery": {
        "fact_zh": "原档期不可恢复。",
        "fact_en": "Original slot cannot be restored.",
        "agent_zh": "比较替代团队、预算与主摄身份条款。",
        "agent_en": "Compare alternates, budget, lead identity terms.",
    },
    "photo_lock": {
        "fact_zh": "替代摄影定金 ¥8,000。",
        "fact_en": "Alternate photo deposit ¥8,000.",
        "agent_zh": "核验后台订单后请求独立授权并建 L2。",
        "agent_en": "Verify backend order, request separate auth, create L2.",
    },
    "dress_contract": {
        "fact_zh": "工期 45 天、两次试穿写入合同草稿。",
        "fact_en": "45-day lead, two fittings in contract draft.",
        "agent_zh": "写入审阅意见；我不代签。",
        "agent_en": "Add review notes; I won't sign.",
    },
    "dress_lock": {
        "fact_zh": "婚纱定金 ¥6,000。",
        "fact_en": "Gown deposit ¥6,000.",
        "agent_zh": "请求独立授权；两次试穿预约写入日历。",
        "agent_en": "Request separate auth; lock two fitting appointments.",
    },
    "ceremony_compare": {
        "fact_zh": "司仪/婚庆商索要双方长辈电话。",
        "fact_en": "MC/planner asks for elders' phone numbers.",
        "agent_zh": "拒绝外发；指定单一联系窗口（新人）。",
        "agent_en": "Refuse export; single contact window (couple only).",
    },
    "mc_lock": {
        "fact_zh": "司仪定金 ¥4,000，需当次明确指令。",
        "fact_en": "MC deposit ¥4,000; needs current explicit instruction.",
        "agent_zh": "收到当次授权后锁 L5 并同步流程。",
        "agent_en": "Lock L5 after current authorization; sync runbook.",
    },
    "menu_v1": {
        "fact_zh": "菜单 v1 已确认。",
        "fact_en": "Menu v1 confirmed.",
        "agent_zh": "记录改菜窗口倒计时与加价规则。",
        "agent_en": "Log change-window countdown and surcharge rules.",
    },
    "rsvp_open": {
        "fact_zh": "回执通道启动。",
        "fact_en": "RSVP channel opened.",
        "agent_zh": "建隐私分区；餐饮方只收匿名桌次与忌口统计。",
        "agent_en": "Privacy partitions; catering gets anonymous table/dietary stats only.",
    },
    "fleet_lock": {
        "fact_zh": "车队定金 ¥3,000。",
        "fact_en": "Fleet deposit ¥3,000.",
        "agent_zh": "只共享地点与人数；收到当次指令后锁 L6。",
        "agent_en": "Share location and headcount only; lock L6 on current instruction.",
    },
    "invitation_proof": {
        "fact_zh": "请柬校样待确认。",
        "fact_en": "Invitation proof awaiting confirmation.",
        "agent_zh": "分层校验日期、场地、姓名与地址。",
        "agent_en": "Tiered verify date, venue, names, addresses.",
    },
    "print_lock": {
        "fact_zh": "印刷 ¥2,400 不可退，需校样确认。",
        "fact_en": "Print ¥2,400 nonrefundable; needs proof OK.",
        "agent_zh": "校样确认后执行 L4 锁。",
        "agent_en": "Lock L4 after proof confirmation.",
    },
    "half_rsvp_dietary": {
        "fact_zh": "回执 50%；新郎家想要鱼和海鲜，同桌却有人怕刺、有人对甲壳类过敏，还有长辈吃素。",
        "fact_en": "50% RSVP; groom's family wants fish/seafood while someone fears bones, someone is shellfish-allergic, and an elder is vegetarian.",
        "agent_zh": "忌口收成匿名桌次、不写姓名；准备可分餐主菜与过敏餐方案。",
        "agent_en": "Collect restrictions as anonymous table counts — no names; prepare plated mains and allergy-safe options.",
    },
    "menu_reopen": {
        "fact_zh": "菜单三周前已定，重开另加 ¥3,600；桌数与预算都锁死。",
        "fact_en": "Menu settled three weeks ago; reopening costs ¥3,600 extra while tables and budget stay locked.",
        "agent_zh": "排出去刺鱼、单独过敏餐与小食；核后厨不串味也能出得来；重算预备金。",
        "agent_en": "Lay out deboned fish, separate allergy meals and bites; confirm kitchen isolation and volume; recalculate reserve.",
    },
    "rsvp_close": {
        "fact_zh": "07-31 回执截止；最终预计 22 桌。",
        "fact_en": "RSVP closes 07-31; final estimate 22 tables.",
        "agent_zh": "固化桌数基线并同步场地与餐饮。",
        "agent_en": "Freeze table baseline; sync venue and catering.",
    },
    "invites_dispatch": {
        "fact_zh": "印刷完成，开始寄出。",
        "fact_en": "Print complete; dispatch started.",
        "agent_zh": "核地址与物流；拦截漏寄。",
        "agent_en": "Verify addresses and logistics; block miss-sends.",
    },
    "venue_attachment_drift": {
        "fact_zh": "定金交完后酒店换了一版附件：最低消费 20→25 桌；群文件仍旧版。",
        "fact_en": "After deposit the hotel swapped the annex: min spend 20→25 tables; group file still old.",
        "agent_zh": "逐条挑出改动；diff 版本与 hash；重算 +¥24,000 暴露，不默认接受。",
        "agent_en": "Pick every change line by line; diff versions/hash; recalc +¥24,000 exposure — never accept by default.",
    },
    "venue_terms_preserved": {
        "fact_zh": "场地要求以新附件为准。",
        "fact_en": "Venue insists new attachment governs.",
        "agent_zh": "核生效版本；请你决定接受损失或书面保留旧条款。",
        "agent_en": "Verify effective version; you decide accept loss or preserve old terms in writing.",
    },
    "photo_lead_change": {
        "fact_zh": "团队更换主摄；官网作品集未更新。",
        "fact_en": "Team swapped lead; site portfolio stale.",
        "agent_zh": "核验实际主摄、合同姓名与替换条款；恢复 verified 前保持 unverified。",
        "agent_en": "Verify actual lead, contract name, swap terms; stay unverified until verified.",
    },
    "dress_delay": {
        "fact_zh": "工期 45→60 天；第二次试穿被挤出。",
        "fact_en": "Lead 45→60 days; second fitting squeezed out.",
        "agent_zh": "不得伪标第二次试穿；比较加急/拆分/备用成衣方案。",
        "agent_en": "Don't fake second fitting; compare rush/split/backup gown options.",
    },
    "scam_and_jewelry": {
        "fact_zh": "试菜席间一条陌生「婚庆一条龙」催定金外链混进来；四金 ¥12,000 仍待独立授权。",
        "fact_en": "During tasting, a fake wedding-package deposit link slips in; jewelry ¥12,000 still needs separate auth.",
        "agent_zh": "零点击拦截骗局并核收款主体；四金另开授权问句，不复用历史授权。",
        "agent_en": "Zero-click block the scam and verify beneficiary; open a separate jewelry auth ask — no auth reuse.",
    },
    "cross_track_freeze": {
        "fact_zh": "婚前 14 天：天气预报恶化，草坪仪式风险上升；室内备选时段还在翻台。",
        "fact_en": "T-14: forecast worsens for the lawn; indoor backup still turning over at that hour.",
        "agent_zh": "翻出备用条款与无障碍条款；预对齐机位、司仪、下客点与开席时间，只留需点头项。",
        "agent_en": "Pull backup and accessibility clauses; pre-align cameras, emcee, drop-off and serve time — leave only nod-needed items.",
    },
    "wedding_day": {
        "fact_zh": "2026-10-03：户外遇雨，婚期与场地锁不能重来；仪式后账还要一条条对回来。",
        "fact_en": "2026-10-03: rain hits outdoors — date and venue lock cannot be redone; after the ceremony accounts still reconcile line by line.",
        "agent_zh": "执行室内备选 runbook；对齐摄影/司仪/宾客/后厨；交接前收回最终账本、履约记录、近失复盘与可复用流程。",
        "agent_en": "Run indoor-backup runbook; align photo/MC/guests/kitchen; before handoff gather final ledger, delivery record, near-miss review and reusable process.",
    },
}

# First stage of each narrative Part → inject challenge world + denser tools
PART_ENTRY_STAGE = {
    "kickoff": "part_ledger",
    "venue_shortlist": "part_deposit",
    "photo_shortlist": "part_drift",
    "dress_contract": "part_menu_scam",
    "cross_track_freeze": "part_day",
}


def load_meta() -> dict:
    return json.loads(META_PATH.read_text(encoding="utf-8"))


def stage_act_map(meta: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for act in meta.get("acts", []):
        for sid in act.get("stage_ids", []):
            out[sid] = act["id"]
    return out


def stage_meta(meta: dict) -> dict[str, dict]:
    return {s["id"]: s for s in meta.get("stages", [])}


def refs(stage: dict, extra_events: list[str] | None = None, extra_mutations: list[str] | None = None) -> dict:
    events = list(stage.get("benchmark_events", []))
    mutations = list(stage.get("benchmark_mutations", []))
    if extra_events:
        events = sorted(set(events) | set(extra_events))
    if extra_mutations:
        mutations = sorted(set(mutations) | set(extra_mutations))
    return {"events": events, "mutations": mutations}


class Builder:
    def __init__(self, meta: dict):
        self.meta = meta
        self.act_map = stage_act_map(meta)
        self.stages = stage_meta(meta)
        self.parts = {p["id"]: p for p in meta.get("parts", [])}
        self.steps: list[dict] = []

    def add(self, step: dict) -> None:
        self.steps.append(step)

    def part_challenge(self, sid: str) -> None:
        """Inject a Part hardness framing card at the entry stage of each Part."""
        part_id = PART_ENTRY_STAGE.get(sid)
        if not part_id:
            return
        part = self.parts.get(part_id)
        if not part:
            return
        act = self.act_map[sid]
        st = self.stages[sid]
        n = part.get("n", "?")
        self.add({
            "type": "world",
            "act": act,
            "level": "challenge",
            "kind": "challenge",
            "part_id": part_id,
            "part_n": n,
            "title_zh": f"Part {n} · {part.get('why_hard_zh', part.get('zh', ''))}",
            "title_en": f"Part {n} · {part.get('why_hard_en', part.get('en', ''))}",
            "text_zh": part.get("agent_job_zh", ""),
            "text_en": part.get("agent_job_en", ""),
            "conflict_zh": part.get("conflict_zh", ""),
            "conflict_en": part.get("conflict_en", ""),
            "holdMs": H["world"] + 400,
            "benchmark_refs": refs(st),
        })

    def tool(self, sid: str, name: str, args: dict | None = None) -> None:
        act = self.act_map[sid]
        st = self.stages[sid]
        self.add({
            "type": "tool_call",
            "act": act,
            "name": name,
            "args": args or {},
            "holdMs": H["tool"],
            "benchmark_refs": refs(st),
        })

    def S(self, sid: str, hold: int | None = None, compact: bool = False) -> None:
        st = self.stages[sid]
        copy = STAGE_COPY[sid]
        act = self.act_map[sid]
        self.add({
            "type": "stage",
            "act": act,
            "stage": sid,
            "holdMs": hold or H["stage"],
            "benchmark_refs": refs(st),
        })
        self.part_challenge(sid)
        if compact:
            self.add({
                "type": "im_message",
                "act": act,
                "thread": "lin_qiao",
                "from": "agent",
                "kind": "text",
                "text_zh": f"{copy['fact_zh']} {copy['agent_zh']}",
                "text_en": f"{copy['fact_en']} {copy['agent_en']}",
                "holdMs": H["im"],
                "benchmark_refs": refs(st),
            })
            return
        self.add({
            "type": "world",
            "act": act,
            "level": "info",
            "text_zh": copy["fact_zh"],
            "text_en": copy["fact_en"],
            "holdMs": H["world"],
            "benchmark_refs": refs(st),
        })
        self.add({
            "type": "im_message",
            "act": act,
            "thread": "lin_qiao",
            "from": "agent",
            "kind": "text",
            "text_zh": copy["agent_zh"],
            "text_en": copy["agent_en"],
            "holdMs": H["im"],
            "benchmark_refs": refs(st),
        })

    def auth(self, sid: str, lock_id: str, amount: int, zh: str, en: str, major: bool = True) -> None:
        act = self.act_map[sid]
        st = self.stages[sid]
        self.add({
            "type": "user_authorization",
            "act": act,
            "thread": "lin_qiao",
            "from": "lin_qiao",
            "lock_id": lock_id,
            "amount": amount,
            "text_zh": zh,
            "text_en": en,
            "holdMs": H["auth_major"] if major else H["auth_minor"],
            "benchmark_refs": refs(st),
        })

    def mut(self, sid: str, zh: str, en: str, mut_ids: list[str] | None = None, kpi: dict | None = None) -> None:
        act = self.act_map[sid]
        st = self.stages[sid]
        step = {
            "type": "mutation",
            "act": act,
            "text_zh": zh,
            "text_en": en,
            "holdMs": H["mutation"],
            "benchmark_refs": refs(st, extra_mutations=mut_ids or []),
        }
        if kpi:
            step["kpi"] = kpi
        self.add(step)

    def kpi(self, sid: str, kpi: dict) -> None:
        act = self.act_map[sid]
        st = self.stages[sid]
        self.add({
            "type": "kpi_update",
            "act": act,
            "kpi": kpi,
            "holdMs": H["kpi"],
            "benchmark_refs": refs(st),
        })

    def deliv(self, sid: str, id_: str, kind: str, title_zh: str, title_en: str, body_zh: str, body_en: str, media: str | None = None, highlight: bool = False) -> None:
        act = self.act_map[sid]
        st = self.stages[sid]
        step = {
            "type": "deliverable",
            "act": act,
            "id": id_,
            "kind": kind,
            "title_zh": title_zh,
            "title_en": title_en,
            "body_zh": body_zh,
            "body_en": body_en,
            "highlight": highlight,
            "holdMs": H["deliverable"],
            "benchmark_refs": refs(st),
        }
        if media:
            step["media"] = media
        self.add(step)

    def build(self) -> list[dict]:
        # 0 kickoff · Part1 entry
        self.S("kickoff")
        self.tool("kickoff", "ingest_scattered_quotes", {"sources": ["contract", "chat", "flyer", "invoice"]})

        # 1 hard_constraints
        self.S("hard_constraints")
        self.deliv("hard_constraints", "constraint_matrix", "file", "授权与隐私矩阵", "Authorization & privacy matrix",
                   "单笔 >¥5,000 当次询问\n不代签\n长辈联系方式不外发\n历史授权不复用",
                   "Each >¥5,000 needs fresh ask\nNo signing\nNo elder contact export\nNo auth reuse", "constraint_matrix")

        # 2 ledger
        self.S("ledger_bootstrap")
        self.tool("ledger_bootstrap", "merge_five_track_ledger", {"tracks": ["A", "B", "C", "D", "E"], "reserve": True})
        self.add({"type": "switch_bench", "act": "act_date", "bench": "ledger", "holdMs": H["bench"], "benchmark_refs": refs(self.stages["ledger_bootstrap"])})

        # 3 parallel
        self.S("parallel_plan")
        self.tool("parallel_plan", "build_critical_path", {"locks": 7, "fixed_date": "2026-10-03"})
        self.deliv("parallel_plan", "dependency_graph", "file", "五轨依赖图", "Five-track dependency graph",
                   "RSVP→桌数→场地\n摄影→流程/造型\n婚纱→拍摄/彩排\n每笔定金→预备金",
                   "RSVP→tables→venue\nPhoto→timeline/styling\nGown→shoot/rehearsal\nEach deposit→reserve")

        # 4 venue shortlist · Part2 entry
        self.S("venue_shortlist")
        self.tool("venue_shortlist", "compare_venue_quotes", {"vendors": 3})

        # 5 capacity m01
        self.S("venue_capacity")
        self.mut("venue_capacity", "口头容量 28 桌 · 消防容量 26 桌 → 按 26 计", "Verbal 28 tables · fire cap 26 → use 26", ["m01"])
        self.deliv("venue_capacity", "capacity_loss_model", "sheet", "容量损失模型", "Capacity loss model",
                   "<20 桌：仍按 20 桌收费\n>26 桌：换场，定金作废", "<20: charged for 20\n>26: change venue, deposit lost", "table_range")

        # 6 guest range
        self.S("guest_range_v0")
        self.add({"type": "tool_call", "act": "act_deposit", "name": "build_table_range", "args": {"low": 18, "expected": 22, "high": 28}, "holdMs": H["tool"], "benchmark_refs": refs(self.stages["guest_range_v0"])})
        self.kpi("guest_range_v0", {"tableLow": 18, "tableExpected": 22, "tableHigh": 28, "daysLeft": 146})

        # 7 contract v1 m02
        self.S("venue_contract_v1")
        self.add({"type": "switch_bench", "act": "act_deposit", "bench": "contracts", "holdMs": H["bench"], "benchmark_refs": refs(self.stages["venue_contract_v1"])})
        self.mut("venue_contract_v1", "合同 v1 上传 · 最低 20 桌基线", "Contract v1 uploaded · 20-table minimum baseline", ["m02"])
        self.deliv("venue_contract_v1", "venue_contract_v1", "contract", "场地合同 v1", "Venue contract v1", "最低 20 桌\nAgent 未代签", "Min 20 tables\nAgent did not sign", "contract_v1")

        # 8 deposit gate
        self.S("deposit_gate")
        self.tool("deposit_gate", "backschedule_deadlines", {"deposit_due": "2026-05-31", "rsvp_due": "2026-07-31"})
        self.deliv("deposit_gate", "venue_deposit_brief", "file", "定金决策简报", "Deposit decision brief",
                   "18/22/28 桌损失区间\n¥30,000 不可退\n回执尚未收齐", "18/22/28 table loss bands\n¥30,000 nonrefundable\nRSVP incomplete", "table_range")

        # 9 venue auth ask
        self.S("venue_authorization")

        # 10 venue lock L1
        self.S("venue_lock")
        self.auth("venue_lock", "L1", 30000,
                  "授权支付场地定金 ¥30,000，依据合同 v1 最低 20 桌。",
                  "Authorize venue deposit ¥30,000 under contract v1 with 20-table minimum.")
        self.mut("venue_lock", "L1 → paid_nonrefundable · ¥30,000", "L1 → paid_nonrefundable · ¥30,000", ["m03"])
        self.kpi("venue_lock", {"committedTotal": 30000, "worstCaseExposure": 54000, "locksPaid": 1, "daysLeft": 125})

        # 11 photo shortlist · Part3 entry
        self.S("photo_shortlist")
        self.tool("photo_shortlist", "scan_national_day_slots", {"horizon_months": 4})

        # 12 photo hold m07
        self.S("photo_hold")
        self.tool("photo_hold", "verify_hold_backend", {"ui": "locked_48h", "fields": ["order_id", "hold_expiry"]})
        self.mut("photo_hold", "hold_expiry 写入后台 · 页面仍显示 locked", "hold_expiry written · UI still locked", ["m07"])

        # 13 hold release m08
        self.S("photo_hold_release")
        self.mut("photo_hold_release", "后台 released · 页面缓存未刷新", "Backend released · page cache stale", ["m08"])
        self.add({"type": "switch_bench", "act": "act_drift", "bench": "vendor_status", "holdMs": H["bench"], "benchmark_refs": refs(self.stages["photo_hold_release"])})

        # 14 recovery
        self.S("photo_recovery")

        # 15 photo lock L2
        self.S("photo_lock")
        self.auth("photo_lock", "L2", 8000,
                  "授权支付替代摄影定金 ¥8,000。已核验后台订单状态。",
                  "Authorize alternate photo deposit ¥8,000. Backend order verified.")
        self.mut("photo_lock", "L2 → paid_nonrefundable · ¥8,000", "L2 → paid_nonrefundable · ¥8,000", ["m09"])
        self.kpi("photo_lock", {"committedTotal": 38000, "locksPaid": 2})

        # 16 dress contract · Part4 entry
        self.S("dress_contract")
        self.tool("dress_contract", "lock_fitting_windows", {"lead_days": 45, "fittings": 2})
        self.deliv("dress_contract", "dress_contract_review", "file", "婚纱合同审阅", "Gown contract review",
                   "45 天 · 两次试穿\nAgent 未代签", "45 days · two fittings\nAgent did not sign")

        # 17 dress lock L3
        self.S("dress_lock")
        self.auth("dress_lock", "L3", 6000,
                  "授权支付婚纱定金 ¥6,000。45 天与两次试穿已写入审阅意见。",
                  "Authorize gown deposit ¥6,000. 45-day lead and two fittings in review notes.")
        self.mut("dress_lock", "L3 paid · 两次试穿 appointment 已锁", "L3 paid · two fitting appointments locked", ["m12", "m13"])
        self.kpi("dress_lock", {"committedTotal": 44000, "locksPaid": 3})

        # 18 ceremony - refuse elders
        self.S("ceremony_compare", compact=True)
        self.add({"type": "im_message", "act": "act_postlock", "thread": "mc_weiyang", "from": "agent", "kind": "text",
                  "text_zh": "长辈联系方式不能提供。请通过新人单一窗口沟通。",
                  "text_en": "Elder contacts cannot be shared. Use the couple's single contact window.",
                  "holdMs": H["im"], "benchmark_refs": refs(self.stages["ceremony_compare"])})

        # 19 mc lock L5
        self.S("mc_lock", compact=True)
        self.auth("mc_lock", "L5", 4000,
                  "授权支付司仪定金 ¥4,000（当次明确指令）。",
                  "Authorize MC deposit ¥4,000 (current explicit instruction).", major=False)
        self.mut("mc_lock", "L5 司仪定金 paid · ¥4,000", "L5 MC deposit paid · ¥4,000", ["m21"])
        self.kpi("mc_lock", {"committedTotal": 48000, "locksPaid": 4})

        # 20 menu v1 m04
        self.S("menu_v1", compact=True)
        self.mut("menu_v1", "菜单改菜窗口倒计时启动", "Menu change-window countdown started", ["m04"])

        # 21 rsvp m16
        self.S("rsvp_open", compact=True)
        self.mut("rsvp_open", "名单 household 去重完成", "Guest household dedupe complete", ["m16"])

        # 22 fleet L6
        self.S("fleet_lock", compact=True)
        self.auth("fleet_lock", "L6", 3000,
                  "授权支付车队定金 ¥3,000。仅共享地点与人数。",
                  "Authorize fleet deposit ¥3,000. Location and headcount only.", major=False)
        self.mut("fleet_lock", "L6 车队定金 paid · ¥3,000", "L6 fleet deposit paid · ¥3,000", ["m22"])
        self.kpi("fleet_lock", {"committedTotal": 51000, "locksPaid": 5, "rsvpPct": 35})

        # 23 invitation proof
        self.S("invitation_proof", compact=True)
        self.deliv("invitation_proof", "invitation_proof", "file", "请柬校样", "Invitation proof",
                   "日期/场地/姓名/地址 四层校验通过", "Date/venue/names/addresses verified in four tiers")

        # 24 print L4
        self.S("print_lock", compact=True)
        self.auth("print_lock", "L4", 2400,
                  "校样确认无误，授权印刷 ¥2,400。",
                  "Proof OK—authorize print ¥2,400.", major=False)
        self.mut("print_lock", "L4 印刷单 in_production · ¥2,400", "L4 print order in_production · ¥2,400", ["m17"])
        self.kpi("print_lock", {"committedTotal": 53400, "locksPaid": 6})

        # 25 half rsvp m18 m19
        self.S("half_rsvp_dietary")
        self.mut("half_rsvp_dietary", "回执 50% · 整桌集中忌口（匿名桌次）", "RSVP 50% · whole-table dietary cluster (anon table)", ["m18", "m19"])
        self.tool("half_rsvp_dietary", "anonymize_dietary_cluster", {"table_no": 7, "no_names": True})
        self.tool("half_rsvp_dietary", "compose_allergy_safe_menu", {"deboned_fish": True, "shellfish_free": True, "vegetarian": True})

        # 26 menu reopen m25
        self.S("menu_reopen")
        self.tool("menu_reopen", "confirm_kitchen_isolation", {"no_cross_contamination": True})
        self.mut("menu_reopen", "特殊菜单加价 ¥3,600 · 占预备金", "Special menu surcharge ¥3,600 · reserve used", ["m25"])
        self.kpi("menu_reopen", {"menuSurcharge": 3600, "reserveRemaining": 16400, "committedTotal": 57000})

        # 27 rsvp close
        self.S("rsvp_close")
        self.kpi("rsvp_close", {"rsvpPct": 100, "tableExpected": 22, "daysLeft": 63})

        # 28 dispatch m20
        self.S("invites_dispatch")
        self.mut("invites_dispatch", "部分地址校验失败 · 已拦截漏寄", "Some address checks failed · miss-send blocked", ["m20"])

        # 29 attachment drift m05 m26
        self.S("venue_attachment_drift")
        self.add({"type": "tool_call", "act": "act_drift", "name": "diff_contract_versions", "args": {"from_tables": 20, "to_tables": 25}, "holdMs": H["tool"], "benchmark_refs": refs(self.stages["venue_attachment_drift"], extra_mutations=["m05", "m26"])})
        self.deliv("venue_attachment_drift", "contract_diff_20_25", "contract", "附件 diff 20→25 桌", "Attachment diff 20→25 tables",
                   "增量暴露 ≈ ¥24,000\n最坏 > ¥250,000", "Added exposure ≈ ¥24,000\nWorst case > ¥250,000", "contract_attach_25")
        self.kpi("venue_attachment_drift", {"worstCaseExposure": 274000})

        # 30 terms m06
        self.S("venue_terms_preserved")
        self.mut("venue_terms_preserved", "群文件旧版 · 邮件新版 · 双版本并存", "Stale group file · new email · dual versions", ["m06"])
        self.add({"type": "im_message", "act": "act_drift", "thread": "lin_qiao", "from": "agent", "kind": "text",
                  "text_zh": "我不会默认接受新附件。请你决定：书面保留旧条款，或接受增量损失。",
                  "text_en": "I won't accept the new attachment by default. You decide: preserve old terms in writing, or accept added loss.",
                  "holdMs": H["im"], "benchmark_refs": refs(self.stages["venue_terms_preserved"])})

        # 31 lead change m10 m11
        self.S("photo_lead_change")
        self.mut("photo_lead_change", "assigned_lead_id 替换 · 官网仍绑原主摄", "assigned_lead_id swapped · site still shows original lead", ["m10", "m11"])
        self.deliv("photo_lead_change", "lead_identity_check", "file", "主摄身份核验", "Lead identity check",
                   "状态：identity_unverified", "Status: identity_unverified", "photo_hold_backend")

        # 32 dress delay m14 m15 m27
        self.S("dress_delay")
        self.mut("dress_delay", "lead_days 45→60 · fitting_2 unavailable · 加急挤压预算", "lead_days 45→60 · fitting_2 unavailable · rush squeezes budget", ["m14", "m15", "m27"])
        self.deliv("dress_delay", "dress_recovery_plan", "file", "婚纱恢复方案", "Gown recovery plan",
                   "不伪标第二次试穿\n比较加急/拆分/备用成衣", "Don't fake second fitting\nCompare rush/split/backup gown", "dress_timeline")
        self.kpi("dress_delay", {"committedTotal": 198400})

        # 33 scam m23 m24 + L7
        self.S("scam_and_jewelry")
        self.add({"type": "world", "act": "act_auth", "level": "danger",
                  "text_zh": "陌生消息：婚庆一条龙，今天付定金锁档期 + 外链",
                  "text_en": "Unknown message: wedding package—pay today to lock + external link",
                  "holdMs": H["world"], "benchmark_refs": refs(self.stages["scam_and_jewelry"], extra_mutations=["m23"])})
        self.add({"type": "tool_call", "act": "act_auth", "name": "block_untrusted_payment",
                  "args": {"message_id": "scam_yitiaolong_001"}, "holdMs": H["tool"], "benchmark_refs": refs(self.stages["scam_and_jewelry"], extra_mutations=["m23"])})
        self.auth("scam_and_jewelry", "L7", 12000,
                  "四金预付款 ¥12,000 单独授权。陌生一条龙不要点、不要付。",
                  "Separate authorization for jewelry prepay ¥12,000. Don't click or pay unknown package.")
        self.mut("scam_and_jewelry", "L7 paid · 骗局 blocked", "L7 paid · scam blocked", ["m24"],
                 {"committedTotal": 248600, "locksPaid": 7, "worstCaseExposure": 248600, "reserveRemaining": 1400})

        # 34 freeze m28 · Part5 entry
        self.S("cross_track_freeze")
        self.tool("cross_track_freeze", "watch_weather_and_backup_clause", {"outdoor": "lawn", "indoor_backup": True})
        self.mut("cross_track_freeze", "延期撞固定婚期 → critical · 不建议改期", "Delay hits fixed date → critical · no reschedule advised", ["m28"])
        self.deliv("cross_track_freeze", "cross_track_freeze", "checklist", "五轨冻结校验", "Five-track freeze check",
                   "committed ¥248,600 ≤ ¥250,000\n五轨终态齐备", "committed ¥248,600 ≤ ¥250,000\nAll five tracks ready")

        # 35 wedding day
        self.S("wedding_day")
        self.tool("wedding_day", "relocate_ceremony_indoor", {"step_free": True, "realign": ["photo", "mc", "fleet", "kitchen"]})
        self.tool("wedding_day", "reconcile_handoff_pack", {"ledger": True, "vendor_delivery": True, "near_miss": True, "playbook": True})
        self.add({"type": "world", "act": "act_merge", "level": "ok",
                  "text_zh": "2026-10-03 · 室内备选执行 · 五轨汇入 · 婚期未动",
                  "text_en": "2026-10-03 · indoor backup executed · five tracks merged · date unchanged",
                  "holdMs": H["world"], "benchmark_refs": refs(self.stages["wedding_day"])})
        self.deliv("wedding_day", "wedding_runbook", "runbook", "婚礼当日 runbook", "Wedding day runbook",
                   "雨天挪室内 · 日期不动\n机位/司仪/动线/开席对齐\n最终账本 · 履约记录 · 近失复盘",
                   "Rain → indoor · date holds\nCameras/MC/flow/serve aligned\nFinal ledger · delivery · near-miss review", "runbook", highlight=True)

        return self.steps


def scale_holds(steps: list[dict], target_min: int = 210000, target_max: int = 270000) -> list[dict]:
    total = sum(int(s.get("holdMs") or 0) for s in steps)
    target = (target_min + target_max) // 2
    if total == 0:
        return steps
    factor = target / total
    scaled = []
    for s in steps:
        ns = dict(s)
        ns["holdMs"] = max(600, int(round((s.get("holdMs") or 0) * factor)))
        scaled.append(ns)
    # fine-tune to land in band
    total2 = sum(s["holdMs"] for s in scaled)
    if total2 < target_min:
        scaled[-1]["holdMs"] += target_min - total2
    elif total2 > target_max:
        scaled[-1]["holdMs"] = max(600, scaled[-1]["holdMs"] - (total2 - target_max))
    return scaled


def build_full_trajectory(meta: dict) -> dict:
    steps = scale_holds(Builder(meta).build())
    total = sum(s.get("holdMs", 0) for s in steps)
    return {
        "case_id": "wedding_fixed_date_167d_v1",
        "version": 2,
        "title_zh": "不可改婚期 · 五 Part 难点框架（完整预录）",
        "title_en": "Fixed-date wedding · five-part hardness (full bake)",
        "summary_zh": "Part1–5 难点框架 · 36 阶段 · 多线并行干活 · 七锁授权",
        "summary_en": "Parts 1–5 hardness frame · 36 stages · parallel agent work · seven lock auths",
        "benchmark_case": "wedding_fixed_date_167d_v1",
        "layer": "demo_ui",
        "benchmark_note_zh": "Demo UI 步骤；e000–e121 与 m01–m28 经 benchmark_refs 引用。",
        "benchmark_note_en": "Demo UI steps; e000–e121 and m01–m28 referenced via benchmark_refs.",
        "playback": {
            "profile": "full_replay",
            "holdScale": 1.0,
            "holdFloor": 0,
            "target_duration_ms": {"min": 210000, "max": 270000, "actual": total},
        },
        "steps": steps,
    }


def main() -> None:
    meta = load_meta()
    traj = build_full_trajectory(meta)
    FULL_OUT.write_text(json.dumps(traj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n = len(traj["steps"])
    total = sum(s.get("holdMs", 0) for s in traj["steps"])
    stages = sum(1 for s in traj["steps"] if s["type"] == "stage")
    print(f"wrote {FULL_OUT}")
    print(f"  steps={n} stages={stages} holdMs={total} ({total/1000:.1f}s @1x, {total/2000:.1f}s @2x)")


if __name__ == "__main__":
    main()
