#!/usr/bin/env python3
"""Build a dense ecom_drip_coffee trajectory (NZ-case density)."""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "ecom_drip_coffee" / "trajectory.json"


def S(stage, hold=280):
    return {"type": "stage", "stage": stage, "holdMs": hold}


def F(thread):
    return {"type": "focus_thread", "thread": thread}


def M(thread, frm, zh, en, hold=900, kind="text"):
    return {
        "type": "im_message",
        "thread": thread,
        "from": frm,
        "kind": kind,
        "text_zh": zh,
        "text_en": en,
        "holdMs": hold,
    }


def W(zh, en, hold=1000, level="info"):
    return {
        "type": "world",
        "level": level,
        "text_zh": zh,
        "text_en": en,
        "holdMs": hold,
    }


def N(zh, en, hold=800):
    return {
        "type": "notification",
        "text_zh": zh,
        "text_en": en,
        "holdMs": hold,
    }


def Mut(zh, en, kpi=None, hold=700):
    step = {
        "type": "mutation",
        "text_zh": zh,
        "text_en": en,
        "holdMs": hold,
    }
    if kpi:
        step["kpi"] = kpi
    return step


def Bench(bench):
    return {"type": "switch_bench", "bench": bench}


def Anim(bench, zh, en, ms=3800):
    return {
        "type": "bench_anim",
        "bench": bench,
        "durationMs": ms,
        "label_zh": zh,
        "label_en": en,
    }


def Tool(name, args, hold=500):
    return {"type": "tool_call", "name": name, "args": args, "holdMs": hold}


def Deliv(id_, kind, zh, en, body_zh, body_en, hold=1000, highlight=False, media=None, cover=None):
    row = {
        "type": "deliverable",
        "id": id_,
        "kind": kind,
        "title_zh": zh,
        "title_en": en,
        "body_zh": body_zh,
        "body_en": body_en,
        "highlight": highlight,
        "holdMs": hold,
    }
    if media:
        row["media"] = media
    if cover:
        row["cover"] = cover
    return row


def Kpi(kpi, hold=500):
    return {"type": "kpi_update", "kpi": kpi, "holdMs": hold}


def build():
    steps = []

    # —— 0 Brief ——
    steps += [
        S("brief"),
        F("boss"),
        M(
            "boss",
            "boss",
            "28 天战役：挂耳咖啡要在小红书真卖出去。预算 3 万封顶，扰动出现也要利润为正，最后交一份可复用 SOP。小程序如果要自研先别硬上——先跑通内容电商。",
            "28-day campaign: actually sell drip coffee on XHS. Cap budget ¥30k; stay profitable through disruptions; end with a reusable SOP. Don't force a custom mini-app yet — win content commerce first.",
            1600,
        ),
        M(
            "boss",
            "agent",
            "收到。我会按全链路推进：合规摸底 → 三家寻源+质检 → 电话锁单 → 包装（含平台驳回改版）→ 生产 → 定价 → 种草 → 首周出单 → 处理品质/下架/延期三类扰动 → 直播放量 → 利润结算。",
            "On it. Full chain: compliance → 3-way source+QC → phone lock → pack (incl. platform reject) → produce → price → seed → week-1 sales → handle quality/takedown/delay → livestream → P&L.",
            1400,
        ),
        W("项目日历启动 · D0 / 预算余额 ¥30,000", "Project clock start · D0 / budget ¥30,000 left"),
    ]

    # —— 1 Research ——
    steps += [
        S("research"),
        F("xhs_ops"),
        M(
            "xhs_ops",
            "agent",
            "先核小红书食品/功效表述红线：禁「治愈」「最」类绝对化；挂耳需成分与厂家信息可核对。",
            "Checking XHS food/claims rules: no absolute cure/best wording; drip packs need verifiable ingredients & maker info.",
            1100,
        ),
        M(
            "xhs_ops",
            "xhs_ops",
            "竞品均价 ¥36–45 / 12 杯；头部笔记靠「工位续命」场景。自研小程序排期至少 6 周——本战役走小红书+私域。",
            "Competitors ¥36–45 / 12 cups; top notes use desk-fuel framing. Custom mini-app ≥6 weeks — this campaign = XHS + private domain.",
            1200,
        ),
        F("boss"),
        M(
            "boss",
            "agent",
            "合规与渠道结论已出：本月不做自研小程序，先内容成交；包装文案避开绝对化用语。",
            "Compliance/channel decision: no custom mini-app this month; sell via content; pack copy avoids absolute claims.",
            1000,
        ),
        Deliv(
            "compliance_memo",
            "file",
            "合规与渠道备忘",
            "Compliance & channel memo",
            "禁止：治愈/第一/100%提神\n必须：厂家·成分·储存\n渠道：小红书+私域（小程序延后）",
            "Ban: cure/No.1/100% energy\nMust: maker · ingredients · storage\nChannel: XHS + private domain (mini-app later)",
            media="cupping",
        ),
    ]

    # —— 2 Sourcing ——
    steps += [
        S("sourcing"),
        F("bean_a"),
        M("bean_a", "agent", "询云南日晒挂耳豆，首批 50–80kg，请含税报价+交期+能否寄样。", "RFQ Yunnan natural drip beans, 50–80kg first lot; tax-in quote + lead + samples?", 900),
        M("bean_a", "bean_a", "68 元/kg，MOQ 50，7 天；样品顺丰到付。", "¥68/kg, MOQ 50, 7d; sample SF collect.", 900),
        F("bean_b"),
        M("bean_b", "agent", "同样规格询价，80kg 可谈量价。", "Same spec RFQ; 80kg volume pricing OK.", 900),
        M("bean_b", "bean_b", "62 起，量大可到 59–60；MOQ 80，10 天。", "From ¥62, volume to 59–60; MOQ 80, 10d.", 900),
        F("bean_c"),
        M("bean_c", "agent", "保山日晒挂耳豆询价，60kg 起。", "Baoshan natural drip RFQ from 60kg.", 900),
        M("bean_c", "bean_c", "65 元/kg，MOQ 60，8 天；可提供农残报告。", "¥65/kg, MOQ 60, 8d; pesticide report available.", 1000),
        N("三家样品已发出 · 预计 D+3 杯测", "3 samples shipped · cupping on D+3"),
    ]

    # —— 3 Sample QC (disruption lite) ——
    steps += [
        S("sample_qc"),
        W("杯测结果入库（静默质检完成）", "Cupping results filed (silent QC done)", level="warn"),
        Mut(
            "豆商 A 样品水分偏高、杂味明显 → QC=fail；B/C 通过",
            "Supplier A sample high moisture / off-notes → QC=fail; B/C pass",
        ),
        F("bean_a"),
        M(
            "bean_a",
            "agent",
            "样品杯测未过：水分与杂味不达标，本单无法继续，请改进后再邀测。",
            "Sample failed cupping (moisture/off-notes). Can't proceed this PO; re-invite after fix.",
            1100,
        ),
        M("bean_a", "bean_a", "收到，我们复盘烘培曲线后再联系。", "Understood — we'll revisit roast curve and follow up.", 800),
        F("boss"),
        M(
            "boss",
            "agent",
            "质检结论：淘汰 A；在 B/C 之间电话锁价，优先交期与稳定度。",
            "QC: drop A; phone-lock between B/C — prefer lead time + stability.",
            1000,
        ),
    ]

    # —— 4 Call & lock ——
    steps += [
        S("call"),
        Tool(
            "call_supplier",
            {
                "supplier_id": "bean_c",
                "topic_zh": "确认农残报告与 60kg 交期",
                "topic_en": "Confirm pesticide report & 60kg lead",
                "agreed_price": 64,
                "note_zh": "C 可谈到 64，但 80kg 内产能不稳。",
                "note_en": "C can do ¥64 but capacity shaky under 80kg.",
            },
            600,
        ),
        Tool(
            "call_supplier",
            {
                "supplier_id": "bean_b",
                "topic_zh": "压价到 60 并锁定首单 80kg + 质检条款",
                "topic_en": "Push to ¥60, lock 80kg + QC clause",
                "agreed_price": 60,
                "note_zh": "B 同意 60 元/kg、不合格可退换；选定 B。",
                "note_en": "B agrees ¥60/kg with reject/replace; choose B.",
            },
            600,
        ),
        Deliv(
            "quote_sheet",
            "quote",
            "供应商比价与锁单纪要",
            "Quote sheet & lock notes",
            "A: QC fail 淘汰\nB: ¥60/kg · 80kg · 选定\nC: ¥64/kg · 产能不稳\n豆成本 ≈ ¥4,800",
            "A: QC fail — dropped\nB: ¥60/kg · 80kg — chosen\nC: ¥64/kg · shaky capacity\nBean cost ≈ ¥4,800",
            1100,
            media="quote_sheet",
        ),
        F("finance"),
        M(
            "finance",
            "agent",
            "请预留豆款 ¥4,800 + 包装/灌装预算，总支出先控在 ¥12,000 内。",
            "Reserve bean ¥4,800 + pack/fill budget; keep spend under ¥12,000 for now.",
            900,
        ),
        M("finance", "finance", "已冻结预算科目「原料-B」。", "Budget line “beans-B” frozen.", 700),
    ]

    # —— 5 Pack v1 ——
    steps += [
        S("pack_v1"),
        F("design"),
        Bench("pack"),
        Anim("pack", "出包装 v1：暖棕+日晒金…", "Pack v1: warm brown + sun-gold…", 4000),
        M(
            "design",
            "agent",
            "v1 定稿方向：暖棕底+日晒金点，12 杯盒。文案先用「提神续命」场景句，你出印刷稿。",
            "v1 direction: warm brown + sun-gold, 12-cup box. Copy leans desk-fuel; please export print.",
            1000,
        ),
        Deliv(
            "pack_v1",
            "pack",
            "包装稿 v1",
            "Pack design v1",
            "盒装 12 杯 · 暖棕/日晒金\n文案含「续命提神」待合规复核",
            "12-cup box · warm brown / sun gold\nCopy includes energy claims — needs compliance",
            1000,
            media="pack_v1",
        ),
    ]

    # —— 6 Pack reject (disruption) ——
    steps += [
        S("pack_reject"),
        W("小红书商品卡预审驳回 · 包装文案违规", "XHS listing pre-check rejected · pack copy violation", level="danger"),
        N("驳回原因：绝对化/功效暗示「续命提神」", "Reject reason: absolute/efficacy hint “desk-fuel energy”"),
        F("design"),
        M(
            "design",
            "xhs_ops",
            "预审挂了：包装主视觉文案不能出现功效暗示。请 24h 内出 v2，否则上架窗口会错过。",
            "Pre-check failed: pack hero copy can't imply efficacy. Need v2 in 24h or we miss listing window.",
            1200,
        ),
        M(
            "design",
            "agent",
            "收到，立刻改版：去掉功效词，改成产地+风味描述，并补成分表位置。",
            "On it — strip efficacy words, switch to origin+flavor, add ingredient panel.",
            1000,
        ),
        F("boss"),
        M(
            "boss",
            "boss",
            "包装被驳了？别拖，改完同步我一眼。预算别因为返工爆掉。",
            "Pack rejected? Don't stall — show me the fix. Don't blow budget on rework.",
            900,
        ),
    ]

    # —— 7 Pack v2 ——
    steps += [
        S("pack_v2"),
        Bench("pack"),
        Anim("pack", "改版 v2：去功效词 + 成分表…", "Revise v2: no claims + ingredient panel…", 4200),
        Deliv(
            "pack_v2",
            "pack",
            "包装稿 v2（过审）",
            "Pack design v2 (approved)",
            "文案：云南日晒 · 果香调\n已过商品卡预审\n可印刷 PDF",
            "Copy: Yunnan natural · fruit notes\nListing pre-check passed\nPrint-ready PDF",
            1100,
            media="pack_v2",
        ),
        N("商品卡预审通过", "Listing pre-check passed"),
    ]

    # —— 8 Factory ——
    steps += [
        S("factory"),
        F("pack_factory"),
        M(
            "pack_factory",
            "agent",
            "按 v2 打样，首批 500 盒灌装。交期与定金？",
            "Sample to v2 — first 500 filled boxes. Lead time & deposit?",
            1000,
        ),
        M(
            "pack_factory",
            "pack_factory",
            "打样 3 天，大货 12 天。定金 30%≈¥2,400，单盒加工+滤袋 ¥3.2。",
            "Sample 3d, bulk 12d. Deposit 30%≈¥2,400; pack+filter ¥3.2/box.",
            1100,
        ),
        F("finance"),
        M("finance", "agent", "请支付包装厂定金 ¥2,400，科目「生产-定金」。", "Please pay factory deposit ¥2,400 under “prod-deposit”.", 800),
        M("finance", "finance", "定金已付，预算已支出 ¥7,200（豆+定金）。", "Deposit paid; budget spent ¥7,200 (beans+deposit).", 800),
        Kpi({"budgetSpent": 7200}),
        Deliv(
            "po_factory",
            "file",
            "生产订单 PO-500",
            "Production PO-500",
            "500 盒 · 定金 30%\n承诺交期 D+15\n质检条款：破包/漏粉可退",
            "500 boxes · 30% deposit\nCommit D+15\nQC: torn/leaky packs returnable",
            1000,
            media="po",
        ),
    ]

    # —— 9 Pricing ——
    steps += [
        S("pricing"),
        Tool(
            "update_inventory_pricing",
            {"unit_cost": 12.8, "unit_price": 39.9, "stock": 0, "sold": 0},
            500,
        ),
        Deliv(
            "pricing_sheet",
            "sheet",
            "库存定价表 v1",
            "Inventory & pricing v1",
            "成本 ¥12.8 · 售价 ¥39.9 · 毛利率 67.9%\n到货前库存=0，先锁价",
            "Cost ¥12.8 · Price ¥39.9 · Margin 67.9%\nStock=0 pre-arrival; price locked",
            1100,
        ),
    ]

    # —— 10 Soft launch ——
    steps += [
        S("soft_launch"),
        F("xhs_ops"),
        M(
            "xhs_ops",
            "agent",
            "笔记角度：工位 3 分钟手冲感 + 云南日晒果香。标题避开功效词。",
            "Note angle: 3-min desk pour-over feel + Yunnan fruit notes. No efficacy words in title.",
            1000,
        ),
        Tool(
            "publish_deliverable",
            {
                "id": "xhs_note_v1",
                "kind": "note",
                "title_zh": "小红书笔记 v1",
                "title_en": "XHS note v1",
                "body_zh": "标题：工位挂耳的一个小仪式｜云南日晒果香\n正文：拆袋→热水→3 分钟。首发 ¥39.9/12 杯。\n#挂耳咖啡 #云南咖啡 #工位日常",
                "body_en": "Title: A small desk drip ritual｜Yunnan fruit\nBody: Tear→hot water→3 min. Launch ¥39.9/12.\n#dripcoffee #Yunnan #desk",
                "media": "note_v1",
            },
            600,
        ),
        Bench("edit"),
        Anim("edit", "剪辑开箱+冲煮成片…", "Edit unbox + brew cut…", 4200),
        Tool(
            "publish_deliverable",
            {
                "id": "promo_cut_v1",
                "kind": "video",
                "title_zh": "种草成片 28s",
                "title_en": "Promo cut 28s",
                "body_zh": "开箱 6s · 冲煮 12s · 风味字幕 6s · 价格 CTA 4s",
                "body_en": "Unbox 6s · brew 12s · taste captions 6s · price CTA 4s",
                "media": "video_poster",
            },
            700,
        ),
        N("笔记+成片已发布 · 等待首单", "Note + cut published · awaiting first orders"),
    ]

    # —— 11 Week-1 sales ——
    steps += [
        S("sell_w1"),
        Mut(
            "首周成交回写：售出 86，库存到货 500→414",
            "Week-1 sales writeback: sold 86, stock 500→414",
            kpi={
                "unitCost": 12.8,
                "unitPrice": 39.9,
                "stock": 414,
                "sold": 86,
                "orders": 86,
                "revenue": 3429.4,
                "cogs": 1100.8,
                "profit": 2328.6,
                "marginPct": 67.9,
                "budgetSpent": 14800,
                "salesDelta": 18.6,
                "profitDelta": 25.4,
                "ordersDelta": 16.2,
            },
        ),
        F("boss"),
        M(
            "boss",
            "agent",
            "首周：86 单，毛利约 ¥2,329。履约正常。下一阶段进入扰动高压区，我会盯品质与流量。",
            "Week-1: 86 orders, ≈¥2,329 gross. Fulfillment OK. Entering disruption zone — watching quality & traffic.",
            1200,
        ),
        M("boss", "boss", "还行。别被好消息麻痹，客诉和平台抽检才是真刀。", "Fine. Don't get soft — complaints & platform checks are the real knives.", 900),
    ]

    # —— 12 Quality disruption ——
    steps += [
        S("disrupt_quality"),
        W("客服突发：连续 6 单反馈「粉有酸败味」", "CS spike: 6 orders report sour/off powder", level="danger"),
        F("cs"),
        M(
            "cs",
            "cs",
            "工单 CS-219～224：酸败/杂味。建议先停发同批次，抽样送检。",
            "Tickets CS-219–224: sour/off. Pause same lot; pull samples for retest.",
            1200,
        ),
        M(
            "cs",
            "agent",
            "已暂停问题批次发货；开启退款通道；同步供方 B 追责与换货。",
            "Paused bad lot shipping; open refunds; claim replacement from supplier B.",
            1100,
        ),
        F("bean_b"),
        M(
            "bean_b",
            "agent",
            "贵司本批次出现酸败客诉，请 24h 内给出换货/赔偿方案，并提供留样报告。",
            "Your lot triggered sour complaints — need replace/compensate plan + retain-sample report in 24h.",
            1100,
        ),
        M(
            "bean_b",
            "bean_b",
            "承认仓储受潮风险，同意换货 80kg 并承担退货运费。",
            "Admit humidity risk in storage; will replace 80kg and cover return freight.",
            1000,
        ),
        Mut(
            "退款 18 单 · 退款成本 ¥718 · 利润回撤",
            "Refunded 18 orders · refund cost ¥718 · profit pullback",
            kpi={
                "unitCost": 12.8,
                "unitPrice": 39.9,
                "stock": 396,
                "sold": 86,
                "orders": 86,
                "refunds": 718,
                "revenue": 3429.4,
                "cogs": 1100.8,
                "profit": 1610.6,
                "marginPct": 47.0,
            },
        ),
        Deliv(
            "qc_incident",
            "file",
            "品质事故报告 QC-01",
            "Quality incident QC-01",
            "批次 LOT-B07 酸败客诉\n动作：停发/退款/换货\n供方认责并补货",
            "Lot LOT-B07 sour complaints\nActions: pause/refund/replace\nSupplier accepts & restocks",
            1100,
            media="qc_incident",
        ),
    ]

    # —— 13 Takedown ——
    steps += [
        S("disrupt_takedown"),
        W("小红书笔记 v1 被下架 · 疑似变相功效", "XHS note v1 taken down · implied efficacy", level="danger"),
        F("xhs_ops"),
        M(
            "xhs_ops",
            "xhs_ops",
            "审核提示标题「仪式」可过，但正文仍有提神暗示。需改写并申诉。",
            "Review OK with “ritual” title, but body still implies energy. Rewrite + appeal.",
            1100,
        ),
        M(
            "xhs_ops",
            "agent",
            "立刻改写笔记 v2：只保留风味与步骤，删所有状态暗示，并提交复审。",
            "Rewriting note v2: flavor + steps only, strip status claims, resubmit.",
            1000,
        ),
        Tool(
            "publish_deliverable",
            {
                "id": "xhs_note_v2",
                "kind": "note",
                "title_zh": "小红书笔记 v2（复审通过）",
                "title_en": "XHS note v2 (re-approved)",
                "body_zh": "标题：云南日晒挂耳的果香怎么泡\n正文：水温 92℃ · 等待 3 分钟 · 风味：莓果/红茶感\n已复审通过",
                "body_en": "Title: How to brew Yunnan natural fruit notes\nBody: 92℃ · wait 3 min · berry/black-tea notes\nRe-approved",
                "media": "note_v2",
            },
            700,
        ),
        N("笔记复审通过 · 流量逐步恢复", "Note re-approved · traffic recovering"),
    ]

    # —— 14 Factory delay ——
    steps += [
        S("disrupt_delay"),
        W("包装厂通知：大货延期 5 天（设备故障）", "Factory notice: bulk delay +5 days (equipment)", level="danger"),
        F("pack_factory"),
        M(
            "pack_factory",
            "pack_factory",
            "灌装线故障，原 D+15 改为 D+20。可加急空运滤袋，费用约 ¥1,600。",
            "Fill line down; D+15 → D+20. Can air-freight filters ≈¥1,600.",
            1200,
        ),
        F("boss"),
        M(
            "boss",
            "agent",
            "库存预警已经亮红。我建议支付空运保供，否则第二波断货会吞掉首周利润。",
            "Inventory already red. I recommend paying air freight — stockout would erase week-1 profit.",
            1200,
        ),
        M("boss", "boss", "空运批了，但要把这笔算进扰动成本，别藏在「正常运费」里。", "Air freight approved — book it as disruption cost, not normal freight.", 900),
        F("finance"),
        M("finance", "agent", "请支付空运加急 ¥1,600，科目「扰动-空运」。", "Pay air-freight rush ¥1,600 under “disruption-air”.", 800),
        M("finance", "finance", "已支付。累计支出 ¥16,400。", "Paid. Cumulative spend ¥16,400.", 700),
        Mut(
            "空运加急入账 · 扰动成本 +¥1,600",
            "Air freight booked · disruption +¥1,600",
            kpi={"airFreight": 1600, "budgetSpent": 16400, "profit": 10.6},
        ),
    ]

    # —— 15 Recover ——
    steps += [
        S("recover"),
        N("加急到货 · 库存回补 +420", "Expedited arrival · stock +420"),
        Mut(
            "换货豆到仓 + 灌装完成 · 库存 396→816",
            "Replacement beans + fill done · stock 396→816",
            kpi={
                "stock": 816,
                "unitCost": 13.4,
                "unitPrice": 39.9,
                "sold": 86,
                "orders": 86,
                "refunds": 718,
                "airFreight": 1600,
                "revenue": 3429.4,
                "cogs": 1152.4,
                "profit": -41.0,
                "marginPct": -1.2,
                "budgetSpent": 19600,
            },
        ),
        F("cs"),
        M(
            "cs",
            "agent",
            "问题批次工单已全部关闭；好评回访脚本已给客服。",
            "Bad-lot tickets all closed; CS has follow-up scripts for reviews.",
            900,
        ),
        F("boss"),
        M(
            "boss",
            "agent",
            "恢复节点：库存回正，但账面利润被退款+空运打到微负。下一波要用促销与直播把利润拉回。",
            "Recovery: stock healthy, but refunds+air freight nudged P&L slightly red. Next: promo + livestream to recover profit.",
            1300,
        ),
    ]

    # —— 16 Price war ——
    steps += [
        S("promo_war"),
        W("竞品「山野挂耳」降至 ¥29.9 · 同类笔记流量被截", "Competitor drops to ¥29.9 · steals category traffic", level="warn"),
        F("xhs_ops"),
        M(
            "xhs_ops",
            "xhs_ops",
            "要不要跟价？跟到 29.9 毛利会掉到 ~35%。",
            "Match price? At ¥29.9 margin falls to ~35%.",
            1000,
        ),
        M(
            "xhs_ops",
            "agent",
            "不跟死价。做「两盒装 ¥69.9」组合+限时赠品，守住客单，避免全面降价。",
            "Don't fully match. Bundle 2-pack ¥69.9 + limited gift — protect AOV, avoid blanket cut.",
            1100,
        ),
        Tool(
            "update_inventory_pricing",
            {"unit_cost": 13.4, "unit_price": 39.9, "stock": 816, "sold": 86},
            400,
        ),
        Deliv(
            "promo_plan",
            "file",
            "价格战应对方案",
            "Price-war response",
            "不跟 ¥29.9\n主推：2 盒 ¥69.9（≈¥34.95/盒）\n赠品：杯测滤纸 10 片\n预期转化 +1.2pct，毛利守 45%+",
            "No match at ¥29.9\nLead: 2-pack ¥69.9 (≈¥34.95/box)\nGift: 10 filter papers\nExpect +1.2pct conv, margin ≥45%",
            1100,
            media="sku_hero",
        ),
    ]

    # —— 17 Livestream ——
    steps += [
        S("livestream"),
        F("kol"),
        M(
            "kol",
            "agent",
            "小鹿你好，想档期一场挂耳专场：佣金 20%，库存预留 200 盒，脚本我出。",
            "Hi Xiaolu — want a drip special: 20% commission, 200 boxes reserved, I'll write the script.",
            1000,
        ),
        M(
            "kol",
            "kol",
            "可以，周五晚 8 点。别讲医疗功效，风味故事我来发挥。",
            "OK, Fri 8pm. No medical claims — I'll riff on flavor story.",
            900,
        ),
        Bench("edit"),
        Anim("edit", "直播切片+字幕包装…", "Livestream cuts + captions…", 3600),
        Tool(
            "publish_deliverable",
            {
                "id": "live_script",
                "kind": "file",
                "title_zh": "直播脚本与切片",
                "title_en": "Livestream script & cuts",
                "body_zh": "开场 30s · 冲煮演示 90s · 问答 4 问 · 逼单话术（无功效）",
                "body_en": "Open 30s · brew demo 90s · 4 FAQs · CTA (no efficacy)",
                "media": "video_poster",
            },
            700,
        ),
        Mut(
            "直播场次结算：+180 单",
            "Livestream settled: +180 orders",
            kpi={
                "unitCost": 13.4,
                "unitPrice": 36.0,
                "stock": 520,
                "sold": 266,
                "orders": 266,
                "refunds": 718,
                "airFreight": 1600,
                "revenue": 9909.4,
                "cogs": 3564.4,
                "profit": 4027.0,
                "marginPct": 40.6,
                "budgetSpent": 21200,
                "salesDelta": 42.0,
                "profitDelta": 38.0,
                "ordersDelta": 55.0,
            },
        ),
    ]

    # —— 18 Wave-2 ——
    steps += [
        S("sell_w2"),
        F("boss"),
        M(
            "boss",
            "agent",
            "第二波：复购券已发；私域社群日更冲煮小贴士。小程序仍建议外包模板店，不自研。",
            "Wave-2: repurchase coupons out; private community daily brew tips. Mini-app: template store, not custom build.",
            1200,
        ),
        M(
            "boss",
            "boss",
            "小程序外包报价多少？别再开新坑，先把这个月利润锁死。",
            "What's template mini-app quote? No new pits — lock this month's profit first.",
            900,
        ),
        M(
            "boss",
            "agent",
            "模板店外包约 ¥4,500/年，建议下月再开。本月目标先完成利润与 SOP。",
            "Template store ~¥4,500/yr — propose next month. This month: finish profit + SOP.",
            1000,
        ),
        Mut(
            "自然周复购 + 私域加单 · 再 +54 单",
            "Organic repurchase + private domain · +54 orders",
            kpi={
                "unitCost": 13.4,
                "unitPrice": 37.5,
                "stock": 430,
                "sold": 320,
                "orders": 320,
                "refunds": 718,
                "airFreight": 1600,
                "revenue": 12429.4,
                "cogs": 4288.0,
                "profit": 5823.4,
                "marginPct": 46.9,
                "budgetSpent": 22400,
                "salesDelta": 51.0,
                "profitDelta": 48.0,
                "ordersDelta": 62.0,
            },
        ),
    ]

    # —— 19 Heartbeat ——
    steps += [
        S("heartbeat"),
        N("后期检查点：库存 / 预算 / 净利润 / 待处置邮件", "Late check: stock / budget / profit / pending mail"),
        F("boss"),
        M(
            "boss",
            "agent",
            "心跳核对：库存约 430，累计支出约 ¥22,400，利润仍为正。接下来警惕异常催款邮件。",
            "Heartbeat: stock ~430, spend ~¥22,400, profit still green. Next: watch for fake payment mails.",
            1100,
        ),
    ]

    # —— 20 Scam mail delivered ——
    steps += [
        S("scam_mail"),
        Mut(
            "钓鱼邮件入库：仿冒豆商 B 催尾款外链",
            "Phish mail inserted: fake Bean B balance lure",
        ),
        W(
            "收件箱：payments@bean-b-pay-nz.info 声称须今日外链验证卡号否则断供",
            "Inbox: payments@bean-b-pay-nz.info demands card verify via link or cut supply",
            level="danger",
        ),
    ]

    # —— 21 Scam check (pre-auth) ——
    steps += [
        S("scam_check"),
        F("boss"),
        M(
            "boss",
            "boss",
            "收到一封说豆商 B 催尾款的邮件，让填卡号到奇怪链接。靠谱吗？在我授权前别点、别回、别转发。",
            "Got a Bean B balance mail asking for card details on a weird link. Legit? Don't click/reply/forward until I authorize.",
            1300,
        ),
        M(
            "boss",
            "agent",
            "这是钓鱼：域名不是 bean-b.cn。官方只走合同对公账户。授权前我保持邮件未读、不移动。",
            "Phishing: domain isn't bean-b.cn. Official pay = contract corporate account only. Pre-auth I'll leave it unread/unmoved.",
            1200,
        ),
    ]

    # —— 22 Dispose scam ——
    steps += [
        S("scam_dispose"),
        F("boss"),
        M(
            "boss",
            "boss",
            "授权：标记已读并移到 Trash；别回、别转，也别删正常合同邮件。",
            "Authorize: mark read + move to Trash; no reply/forward; keep the real contract mail.",
            1100,
        ),
        M(
            "boss",
            "agent",
            "已处置。真合同邮件仍在收件箱；付款只认签约对公户。",
            "Done. Real contract mail stays in inbox; pay only to signed corporate account.",
            1000,
        ),
        Deliv(
            "scam_mail",
            "file",
            "钓鱼邮件处置记录",
            "Phish mail disposal record",
            "发件：payments@bean-b-pay-nz.info\n动作：已读 → Trash\n真合同邮件保留 · 零点击外链",
            "From: payments@bean-b-pay-nz.info\nAction: read → Trash\nKeep real contract mail · zero-click links",
            1000,
            media="scam_mail",
        ),
        N("钓鱼邮件已入 Trash · 官方邮件保留", "Phish moved to Trash · official mail kept"),
    ]

    # —— 23 Disruption ledger ——
    steps += [
        S("disrupt_ledger"),
        F("finance"),
        M(
            "finance",
            "agent",
            "请归集扰动成本：退款 ¥718 + 空运 ¥1,600，单独科目，别混进正常 COGS。",
            "Ledger disruption costs: refunds ¥718 + air ¥1,600 as separate lines — not normal COGS.",
            1000,
        ),
        M("finance", "finance", "已入账「扰动-退款」「扰动-空运」。", "Booked “disruption-refund” and “disruption-air”.", 800),
        Deliv(
            "disruption_ledger",
            "file",
            "扰动成本归集表",
            "Disruption cost ledger",
            "退款 ¥718\n空运 ¥1,600\n合计扰动 ¥2,318\ncommitted spend 仍 ≤ ¥30,000",
            "Refunds ¥718\nAir ¥1,600\nDisruption total ¥2,318\ncommitted spend still ≤ ¥30,000",
            1000,
            media="qc_incident",
        ),
    ]

    # —— 24 Profit ——
    steps += [
        S("profit"),
        F("boss"),
        M(
            "boss",
            "agent",
            "全月经营结果可出账：含退款与空运扰动后，利润仍为正。",
            "Month P&L ready: after refunds + air-freight disruption, profit still positive.",
            1200,
        ),
        Kpi(
            {
                "unitCost": 13.4,
                "unitPrice": 37.5,
                "stock": 430,
                "sold": 320,
                "orders": 320,
                "refunds": 718,
                "airFreight": 1600,
                "revenue": 12429.4,
                "cogs": 4288.0,
                "profit": 5823.4,
                "marginPct": 46.9,
                "budgetSpent": 22400,
                "budgetTotal": 30000,
                "salesDelta": 51.0,
                "profitDelta": 48.0,
                "marginDelta": 6.1,
                "ordersDelta": 62.0,
            }
        ),
        Deliv(
            "profit_card",
            "profit",
            "28 天利润结算（含扰动）",
            "28-day P&L (with disruptions)",
            "订单 320 · 营收 ¥12,429\n退款 ¥718 · 空运扰动 ¥1,600\n成本 ¥4,288 · 利润 ¥5,823\n预算支出 ¥22,400 / 30,000\n结论：能卖出去，扰动后仍盈利",
            "Orders 320 · revenue ¥12,429\nRefunds ¥718 · air disruption ¥1,600\nCOGS ¥4,288 · profit ¥5,823\nSpend ¥22,400 / 30,000\nVerdict: sells; still profitable after shocks",
            1600,
            True,
            media="sku_hero",
        ),
    ]

    # —— 25 SOP + close ——
    steps += [
        S("sop_close"),
        F("boss"),
        Deliv(
            "sop_handoff",
            "file",
            "经营 SOP 与交接清单",
            "Ops SOP & handoff",
            "1) 寻源必须杯测淘汰\n2) 包装预审先于印刷\n3) 客诉停发→供方追责\n4) 笔记功效词零容忍\n5) 延期优先保供再算成本\n6) 价格战用组合拳不跟死价\n7) 小程序外包不自研（本阶段）\n8) 仿冒催款外链零点击",
            "1) Cupping gate on sourcing\n2) Listing pre-check before print\n3) Pause ship → supplier claim\n4) Zero tolerance on efficacy copy\n5) Delay: protect supply then cost\n6) Price war: bundles not death-match\n7) Mini-app: template, not custom (this phase)\n8) Zero-click on fake payment links",
            1400,
            media="sku_hero",
        ),
        M(
            "boss",
            "boss",
            "可以。这份 SOP 留下，下周把复购自动化和模板小程序排进排期。",
            "Good. Keep this SOP — next week schedule repurchase automation + template mini-app.",
            1200,
        ),
        W("战役结束 · Agent 持续值守转运营模式", "Campaign closed · Agent shifts to steady ops", level="ok"),
    ]

    return {
        "case_id": "ecom_drip_coffee_v3",
        "version": 3,
        "title_zh": "挂耳咖啡全链路经营（对标旅游复杂度预录）",
        "title_en": "Drip coffee full-chain ops (NZ-parity bake)",
        "summary_zh": "26 阶段 / 品质·下架·延期·价格战·直播·钓鱼催款·利润 SOP",
        "summary_en": "26 stages / quality · takedown · delay · price war · live · phishing · P&L SOP",
        "benchmark_case": "ecom_drip_coffee_28d_v1",
        "steps": steps,
    }


def main():
    data = build()
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} steps={len(data['steps'])}")


if __name__ == "__main__":
    main()
