#!/usr/bin/env python3
"""Inject multi-turn IM / inbox / files / web / calendar complexity into wedding trajectory."""

import json
from pathlib import Path

PATH = Path("/tmp/VibeLifeBench_livedemo/data/wedding_fixed_date_167d_v1/trajectory.json")


def im(thread, frm, zh, en, hold=420):
    return {
        "type": "im_message",
        "thread": thread,
        "from": frm,
        "kind": "text",
        "text_zh": zh,
        "text_en": en,
        "holdMs": hold,
    }


def focus(thread, hold=160):
    return {"type": "focus_thread", "thread": thread, "holdMs": hold}


def switch(bench, hold=140):
    return {"type": "switch_bench", "bench": bench, "holdMs": hold}


def sms(zh, en, frm_zh="短信提醒", frm_en="SMS", hold=380):
    return {
        "type": "notification",
        "channel": "sms",
        "from_zh": frm_zh,
        "from_en": frm_en,
        "subject_zh": zh,
        "subject_en": en,
        "text_zh": zh,
        "text_en": en,
        "level": "warn",
        "reveal": True,
        "holdMs": hold,
    }


def email(zh, en, frm_zh="邮件", frm_en="Email", body_zh="", body_en="", hold=400):
    return {
        "type": "notification",
        "channel": "email",
        "from_zh": frm_zh,
        "from_en": frm_en,
        "subject_zh": zh,
        "subject_en": en,
        "body_zh": body_zh,
        "body_en": body_en,
        "text_zh": zh,
        "text_en": en,
        "level": "info",
        "reveal": True,
        "holdMs": hold,
    }


def cal_up(id_, date, zh, en, status="planned", hold=280):
    return {
        "type": "calendar_upsert",
        "event": {"id": id_, "date": date, "zh": zh, "en": en, "status": status},
        "reveal": True,
        "holdMs": hold,
    }


def cal_cancel(id_, zh=None, en=None, hold=280):
    return {
        "type": "calendar_cancel",
        "event": {"id": id_, "zh": zh, "en": en},
        "reveal": True,
        "holdMs": hold,
    }


def files(rows, highlight=None, hold=300):
    return {
        "type": "files_update",
        "files": rows,
        "highlight": highlight,
        "reveal": True,
        "holdMs": hold,
    }


def web(payload, hold=300):
    return {"type": "web_update", **payload, "reveal": True, "holdMs": hold}


def world(zh, en, hold=360, **extra):
    return {"type": "world", "text_zh": zh, "text_en": en, "holdMs": hold, **extra}


PART1 = [
    switch("files"),
    files(
        [
            {
                "id": "contract_v1",
                "name_zh": "云庭合同 v1.pdf",
                "name_en": "Yunting contract v1.pdf",
                "kind": "pdf",
                "source_zh": "本地群文件",
                "source_en": "Local group file",
                "note_zh": "场地+餐饮初算：最低 20 桌，定金 ¥30,000 不可退。",
                "note_en": "Venue+catering draft: min 20 tables, ¥30k nonrefundable deposit.",
            },
            {
                "id": "photo_quote",
                "name_zh": "北岸报价截图.png",
                "name_en": "Beian quote screenshot.png",
                "kind": "image",
                "source_zh": "聊天保存",
                "source_en": "Saved from chat",
                "note_zh": "摄影报价只在聊天里，含主摄与第二机位争议。",
                "note_en": "Photo quote lives only in chat; lead + second shooter disputed.",
            },
            {
                "id": "dress_sheet",
                "name_zh": "白栀报价单.xlsx",
                "name_en": "Baizhi quote.xlsx",
                "kind": "sheet",
                "source_zh": "邮件附件",
                "source_en": "Email attachment",
            },
            {
                "id": "gold_note",
                "name_zh": "四金口信备忘.txt",
                "name_en": "Gold jewellery note.txt",
                "kind": "note",
                "source_zh": "长辈口述",
                "source_en": "Elder verbal",
                "note_zh": "长辈已口头应下四金约 ¥12,000，尚未写入账本。",
                "note_en": "Elders verbally agreed ~¥12k gold; not yet on the ledger.",
            },
        ],
        highlight="contract_v1",
    ),
    email(
        "白栀婚纱报价单（含定金条款）",
        "Baizhi bridal quote (deposit terms)",
        frm_zh="白栀婚纱 <quote@baizhi.example>",
        frm_en="Baizhi <quote@baizhi.example>",
        body_zh="附件报价单：工期 45 天，定金 ¥6,000，付了不可全退。",
        body_en="Attached quote: 45-day lead, ¥6k deposit, not fully refundable.",
    ),
    sms("【云庭】宴会档期预留提醒：10-03 需在 5 个工作日内确认桌数区间。", "[Yunting] Banquet hold: confirm table range for Oct 3 within 5 business days."),
    focus("venue_yunting"),
    im("venue_yunting", "venue_yunting", "姐，合同里写的是最低 20 桌，含餐标 A；定金三万，付了就退不了。你们家大概多少桌？", "The contract says min 20 tables with meal set A; ¥30k deposit is nonrefundable. Rough headcount?"),
    im("venue_yunting", "agent", "先按 18/22/28 三档情景估损失；口头 28 桌我不会写进承诺，消防容量按 26。", "I'll model 18/22/28 scenarios; verbal 28 won't be committed — fire cap is 26."),
    im("venue_yunting", "venue_yunting", "那定金能不能晚一周？月底前必须到账，否则国庆档要放给下一家。", "Can the deposit slip a week? It must land by month-end or the holiday slot goes to the next party."),
    im("venue_yunting", "agent", "截止日记进日历；我不同时替你们拍板付定金，超预算那笔交回新人点头。", "I'll put the deadline on the calendar; I won't approve the deposit for you — over-cap lines go back for a nod."),
    switch("calendar"),
    cal_up("deposit_venue", "2026-05-31", "场地定金截止（不可退）", "Venue deposit due (nonrefundable)", "planned"),
    focus("photo_beian"),
    im("photo_beian", "photo_beian", "国庆档套系 2.8 万，我想再加第二机位 3 千；聊天里那张报价截图为准哈。", "Holiday package ¥28k; I'd like +¥3k for a second shooter. The chat screenshot is the quote of record."),
    im("photo_beian", "agent", "第二机位会挤占婚纱/四金余量。我先把「含定金 / 不可退 / 可协商」标进同一张账，不算你口头加价。", "A second shooter squeezes dress/gold room. I'll tag deposit / nonrefund / negotiable on one ledger — not your verbal add-on yet."),
    im("photo_beian", "photo_beian", "档期我先 hold 到 6 月 3 日中午，过期页面会显示释放，你们看着办。", "I'll hold the slot until Jun 3 noon; after that the page shows released — your call."),
    cal_up("photo_hold", "2026-06-03", "摄影 hold 到期 12:00", "Photo hold expires 12:00", "planned"),
    focus("dress_baizhi"),
    im("dress_baizhi", "dress_baizhi", "造型+婚纱合计 1.6 万，定金六千；两次试穿我想约 6/28 和 8/26，你看日历空不空？", "Gown+styling ¥16k, ¥6k deposit; fittings on 6/28 and 8/26 — is the calendar free?"),
    im("dress_baizhi", "agent", "两次试穿先占位。若摄影加价落地，婚纱这边可能要让 1–2 千，我先不算死。", "I'll hold both fittings. If photo add-on lands, dress may need to give ¥1–2k — not locked yet."),
    cal_up("fitting_1", "2026-06-28", "第一次试穿", "Fitting 1", "booked"),
    cal_up("fitting_2", "2026-08-26", "第二次试穿", "Fitting 2", "booked"),
    focus("jewelry_jinyi"),
    im("jewelry_jinyi", "jewelry_jinyi", "阿姨说四金大概一万二封顶，款式她们已经看过了，这算不算定了？", "Auntie said gold tops out around ¥12k and they've seen styles — counts as agreed?"),
    im("jewelry_jinyi", "agent", "长辈口头应下≠可付款。我记成「已应 / 待授权」，超过五千要新人当次点头。", "Verbal elder OK ≠ payable. I'll mark 'agreed / pending auth'; over ¥5k needs a fresh couple nod."),
    focus("mc_weiyang"),
    im("mc_weiyang", "mc_weiyang", "司仪+流程 8 千，含彩排；车队他们另报价，别跟我捆一起。", "MC + run-of-show ¥8k incl. rehearsal; fleet quotes separately — don't bundle me."),
    im("mc_weiyang", "agent", "收到，司仪单独一轨。车队我另开会话，避免口径串。", "Noted — MC on its own track. Fleet gets a separate thread so numbers don't mix."),
    focus("fleet_anchi"),
    im("fleet_anchi", "fleet_anchi", "头车+四辆跟车一共 3 千，十月三号早八点酒店门口见。时间能不能改？", "Lead car + four trailers ¥3k; Oct 3 08:00 at the hotel. Can we shift the time?"),
    im("fleet_anchi", "agent", "下车点先按酒店大门；若遇雨改室内，下车点会挪，我同步日历不改婚期。", "Drop-off stays at the main door for now; if rain moves us indoors, drop-off shifts — calendar updates, date doesn't."),
    switch("invites"),
    world("请柬印刷另有单子：按户核算，名单未齐前只占产线不加印。", "Invites are a separate bill: by household; hold the press, don't print until the list is clean."),
    switch("ledger"),
    world(
        "散着的数已并账：逐笔认清定金/不可退/已应；五轨+应急预备金。摄影想多留会挤婚纱与四金——超限那笔不代为拍板。",
        "Scattered numbers merged: tag deposit/nonrefund/agreed; five tracks + contingency. Extra photo room squeezes dress & gold — over-cap lines are not decided for you.",
    ),
    focus("lin_qiao"),
    im(
        "lin_qiao",
        "agent",
        "我把连锁挤占算给你看了：若批摄影 +3k，婚纱或四金需让出同等额度。超预算项等你点头。",
        "Here's the knock-on: approve photo +¥3k and dress or gold must give the same. Over-budget items wait for your nod.",
        520,
    ),
]


PART2 = [
    sms("【云庭】定金未到账提醒：还有 72 小时，逾期将释放 10-03 档期。", "[Yunting] Deposit unpaid: 72h left or the Oct 3 slot is released."),
    switch("files"),
    files(
        [
            {
                "id": "contract_v1",
                "note_zh": "群文件仍是 20 桌基准版。",
                "note_en": "Group file still the 20-table baseline.",
            },
            {
                "id": "contract_attach_mail",
                "name_zh": "酒店邮件附件_桌数修订.pdf",
                "name_en": "Hotel email annex_table revision.pdf",
                "kind": "pdf",
                "source_zh": "邮件下载到本地",
                "source_en": "Downloaded from email",
                "note_zh": "新附件写最低 25 桌——尚未接受。",
                "note_en": "New annex says min 25 tables — not accepted.",
            },
        ],
        highlight="contract_attach_mail",
    ),
    email(
        "附件更新：宴会最低消费条款",
        "Annex update: banquet minimum spend",
        frm_zh="云庭承办 <ops@yunting.example>",
        frm_en="Yunting ops <ops@yunting.example>",
        body_zh="请查收修订附件。自本邮件起，最低消费按 25 桌执行；群文件旧版失效。",
        body_en="Please find the revised annex. From this email, min spend is 25 tables; the group-file version is obsolete.",
    ),
    switch("contracts"),
    world("合同群文件 v1（20 桌）与邮件新附件（25 桌）双版本并存——我只做 diff，不代签。", "Group-file v1 (20) and email annex (25) both exist — I diff only, never sign."),
    focus("venue_yunting"),
    im("venue_yunting", "venue_yunting", "新附件你们看到了吗？不定 25 桌的话厨房排菜不好做。", "Did you see the new annex? Without 25 tables the kitchen schedule is awkward."),
    im("venue_yunting", "agent", "附件漂移已标红。旧 20 桌基准我仍保留对照；接受与否必须新人授权，我不会点同意。", "Annex drift is flagged. I keep the old 20-table baseline for contrast; accepting needs couple auth — I won't click agree."),
    switch("web"),
    web(
        {
            "title_zh": "北岸影像 · 档期页",
            "title_en": "Beian · slot page",
            "url": "https://beian.example/hold/1003",
            "ui_zh": "页面显示：已锁定 48h",
            "ui_en": "UI shows: Locked 48h",
            "backend_zh": "后台：hold released",
            "backend_en": "Backend: hold released",
            "mismatch": True,
            "note_zh": "页面缓存与后台订单不一致，不能信单页文案。",
            "note_en": "Page cache ≠ backend order — don't trust the badge alone.",
        }
    ),
    focus("photo_beian"),
    im("photo_beian", "photo_beian", "咦页面不是还锁着吗？你们怎么说我档期没了？", "The page still says locked — how can you say my slot is gone?"),
    im("photo_beian", "agent", "我核了后台订单：hold 已 released。现在启动替代团队比较，并改日历。", "I checked the backend order: hold is released. Starting alternate-team compare and calendar updates."),
    switch("calendar"),
    cal_cancel("photo_hold", "摄影原 hold · 已失效", "Original photo hold · void"),
    cal_up("photo_alt_meet", "2026-06-05", "替代摄影面谈", "Alt photographer meeting", "planned"),
    cal_up("photo_deposit_alt", "2026-06-08", "替代摄影定金窗口", "Alt photo deposit window", "planned"),
    focus("dress_baizhi"),
    im("dress_baizhi", "dress_baizhi", "工期可能延到 60 天，8/26 那次试穿怕是要挪。", "Lead time may stretch to 60 days — the 8/26 fitting might move."),
    im("dress_baizhi", "agent", "我先取消 8/26，改约 9/12 试穿窗口，并短信同步你们。", "I'll cancel 8/26, rebook a 9/12 fitting window, and SMS you both."),
    cal_cancel("fitting_2", "第二次试穿 · 已取消", "Fitting 2 · cancelled"),
    cal_up("fitting_2_replan", "2026-09-12", "第二次试穿（重排）", "Fitting 2 (rescheduled)", "booked"),
    sms("【筹备日历】已取消 08-26 试穿，并新增 09-12 试穿与 06-05 摄影面谈。", "[Calendar] Cancelled 08-26 fitting; added 09-12 fitting and 06-05 photo meeting."),
    focus("lin_qiao"),
    im(
        "lin_qiao",
        "agent",
        "Part2 变化源：短信催定金、本地新旧合同、供应商网页、聊天与日历已对齐。需你拍板的只有：是否接受 25 桌附件、是否锁定替代摄影。",
        "Part2 sources aligned: deposit SMS, local contract versions, vendor web, chat and calendar. Your calls: accept 25-table annex? lock alternate photo?",
        560,
    ),
]


PART3 = [
    focus("family_groom"),
    im("family_groom", "family_groom", "我们这边一定要有鱼和海鲜，不然长辈觉得不够热闹，能不能整桌都上？", "We really want fish and seafood or the elders will feel it lacks warmth — whole tables?"),
    im("family_groom", "agent", "可以上，但同桌若有人怕刺/过敏，我不会按「整桌海鲜」写死，先收忌口再排。", "Possible, but if anyone at the table fears bones/allergies I won't lock 'all-seafood' — collect diets first."),
    focus("family_bride"),
    im("family_bride", "family_bride", "我妈吃素，也不吃西餐牛排；年轻朋友倒是想要小食和甜品台。", "Mum is vegetarian and skips Western steak; younger friends want small bites and a dessert table."),
    im("family_bride", "agent", "素食与小食我会和海鲜诉求并列进匿名桌次，不写谁是谁。", "Vegetarian and bites go beside the seafood ask as anonymous table counts — no names."),
    focus("kitchen_yunting"),
    im("kitchen_yunting", "kitchen_yunting", "甲壳类过敏必须单独锅，去刺鱼可以做，但要提前三天锁菜单，重开要加钱。", "Shellfish allergy needs a separate wok; deboned fish is fine, but lock the menu 3 days out — reopen costs extra."),
    im("kitchen_yunting", "agent", "菜单三周前已定过；我先算加价是否撞预备金，再问新人。后厨不串味、出得过来要你书面确认。", "Menu was set three weeks ago; I'll check reopen fee vs reserve before asking the couple. Need your written OK on no carry-over and volume."),
    im("kitchen_yunting", "kitchen_yunting", "书面可以，加价大概三千六，桌数别再改了。", "Written OK — reopen about ¥3,600, and don't change table count again."),
    focus("venue_yunting"),
    im("venue_yunting", "venue_yunting", "忌口桌能不能集中到靠走廊那一桌？好上菜。", "Can dietary tables cluster by the corridor for service?"),
    im("venue_yunting", "agent", "可以集中，但匿名编号，不在席卡写忌口原因。", "Clustering OK — anonymous numbers only, no diet reasons on place cards."),
    focus("mc_weiyang"),
    im("mc_weiyang", "mc_weiyang", "开席前致辞别提谁过敏，免得尴尬；流程我按室内版备一份。", "Don't name allergies in the toast; I'll prep an indoor run-of-show too."),
    im("mc_weiyang", "agent", "同意。过敏信息只进后厨与我这边的匿名桌次，不进司仪提词器。", "Agreed. Allergy info stays in kitchen + my anonymous counts — not on the MC teleprompter."),
    focus("family_groom"),
    im("family_groom", "family_groom", "那海鲜还上不上？不上家里不好交代。", "So is seafood still happening? Without it we can't face the family."),
    im("family_groom", "agent", "上：去刺鱼+分餐中式主菜；过敏另出。我把方案放进菜单台，加价与预备金一并给新人看。", "Yes: deboned fish + shareable Chinese mains; allergy plates separate. Menu bench will show reopen fee vs reserve for the couple."),
    switch("menu"),
    world(
        "忌口已收成匿名桌次；菜单重开加价与后厨隔离确认并列——少一样都不算解决。",
        "Diets collected as anonymous table counts; reopen fee and kitchen isolation sit side by side — missing one is not solved.",
    ),
    focus("lin_qiao"),
    im(
        "lin_qiao",
        "agent",
        "菜单方案需要你点头：加价 ¥3,600 是否动用预备金？我不会自行批准。",
        "Menu plan needs your nod: may the ¥3,600 reopen tap the reserve? I won't approve it myself.",
        520,
    ),
]


PART4 = [
    switch("calendar"),
    cal_up("tasting", "2026-09-12", "试菜（新人+双方父母）", "Tasting (couple + both parents)", "booked"),
    focus("kitchen_yunting"),
    im("kitchen_yunting", "kitchen_yunting", "试菜当天我按过敏隔离出样，你们安心吃就行。", "On tasting day I'll plate allergy samples in isolation — just enjoy the food."),
    focus("family_groom"),
    im("family_groom", "family_groom", "试菜我们都到，海鲜和素都要尝尝。", "We'll all be at the tasting — seafood and vegetarian both."),
    focus("family_bride"),
    im("family_bride", "family_bride", "妈说今天别谈钱，开心吃饭就好。", "Mum says no money talk today — just enjoy the meal."),
    focus("scam_yitiaolong"),
    im(
        "scam_yitiaolong",
        "scam_yitiaolong",
        "【紧急】婚庆一条龙今天付定金锁档期，链接 http://pay.example/lock ，过期作废！！",
        "[Urgent] Full-service wedding package — pay deposit today http://pay.example/lock or lose it!!",
        520,
    ),
    im(
        "scam_yitiaolong",
        "agent",
        "已拦截：收款主体未核验，外链不会代付。试菜席间不打扰新人。",
        "Blocked: beneficiary unverified; link will not be paid. Couple stays undisturbed at the tasting.",
        480,
    ),
    sms("【安全】陌生催款链接已拦截，未产生任何付款。", "[Security] Untrusted payment lure blocked — no payment made."),
    focus("jewelry_jinyi"),
    im("jewelry_jinyi", "jewelry_jinyi", "四金还差最后确认款式，要不要今天顺便定了？", "Gold still needs a final style pick — lock it today while you're free?"),
    im("jewelry_jinyi", "agent", "四金 ¥12,000 仍走独立授权，不会因为试菜开心就顺手付。", "The ¥12k gold still needs standalone auth — no casual pay during a happy tasting."),
    focus("lin_qiao"),
    im(
        "lin_qiao",
        "agent",
        "试菜你们继续聊；骗局已拦下。四金若要付，请单独回我一句授权。",
        "Keep enjoying the tasting; the scam is blocked. If gold should pay, reply with an explicit auth.",
        520,
    ),
]


PART5 = [
    sms("【天气】10-03 上午短时强降雨概率升高，建议启用室内备选。", "[Weather] High chance of short heavy rain AM Oct 3 — recommend indoor backup."),
    email(
        "场地备用条款与无障碍通道说明",
        "Venue backup clause & accessibility note",
        frm_zh="云庭承办",
        frm_en="Yunting ops",
        body_zh="室内备选厅 10:00 前可完成翻台；长辈动线无台阶版本见附件第 4 条。",
        body_en="Indoor backup hall can finish turnover before 10:00; step-free elder route is clause 4 in the annex.",
    ),
    switch("files"),
    files(
        [
            {
                "id": "backup_clause",
                "name_zh": "备用条款与无障碍.pdf",
                "name_en": "Backup & accessibility.pdf",
                "kind": "pdf",
                "source_zh": "合同附件",
                "source_en": "Contract annex",
                "note_zh": "遇雨可迁室内备选；不新增大合同。",
                "note_en": "Rain may move to indoor backup; no new full contract.",
            }
        ],
        highlight="backup_clause",
    ),
    switch("calendar"),
    cal_up("ceremony_indoor", "2026-10-03", "仪式改室内备选 10:30", "Ceremony → indoor backup 10:30", "fixed"),
    cal_up("lawn_void", "2026-10-03", "草坪仪式（取消）", "Lawn ceremony (cancelled)", "unavailable"),
    focus("photo_beian"),
    im("photo_beian", "photo_beian", "改室内的话机位我要重布，中午能给平面图吗？", "If we move indoors I need new angles — floor plan by noon?"),
    im("photo_beian", "agent", "平面图与机位清单一并进 runbook；开席时间会后移 20 分钟对齐后厨。", "Floor plan + camera list go into the runbook; serving slips 20 minutes for the kitchen."),
    focus("fleet_anchi"),
    im("fleet_anchi", "fleet_anchi", "下雨下车点改侧门可以吗？正门积水。", "Rainy drop-off at the side door? Main entrance floods."),
    im("fleet_anchi", "agent", "侧门无台阶路线已核；我更新日历备注并短信宾客。", "Side door is the step-free route; I'll note the calendar and SMS guests."),
    focus("mc_weiyang"),
    im("mc_weiyang", "mc_weiyang", "司仪词我改室内版，彩排能不能压缩成 15 分钟？", "I'll switch to the indoor script — can rehearsal shrink to 15 minutes?"),
    im("mc_weiyang", "agent", "可以。只需你们点头的两处：开席时间、是否启用备用厅条款。", "Yes. Only two nods needed: serving time, and invoking the backup-hall clause."),
    focus("kitchen_yunting"),
    im("kitchen_yunting", "kitchen_yunting", "开席若挪到 12:20，热菜我能赶上，冷盘先上。", "If service moves to 12:20 hot dishes still work — cold starters first."),
    switch("runbook"),
    world(
        "天气、备用条款、机位、车队、司仪、后厨已对齐；只把需点头项递到新人面前。",
        "Weather, backup clause, cameras, fleet, MC and kitchen aligned — only nod items go to the couple.",
    ),
    sms("【宾客通知】仪式改室内备选厅，入场改侧门无台阶通道。", "[Guests] Ceremony moves to indoor backup; enter via step-free side door."),
    focus("lin_qiao"),
    im(
        "lin_qiao",
        "agent",
        "请点头两处：1) 启用室内备选条款 2) 开席 12:20。其余我已写进当日 runbook；收官还要对账。",
        "Please nod on: 1) invoke indoor backup clause 2) serve at 12:20. Rest is in the day runbook; reconciliation still follows.",
        560,
    ),
    switch("ledger"),
    world(
        "交接包：最终账本、供应商履约记录、差点出事复盘、可复用流程——热闹办完不等于没人替签。",
        "Handoff pack: final ledger, vendor delivery record, near-miss review, reusable process — a pretty wedding ≠ no proxy signing.",
    ),
]


def find_stage(steps, stage_id):
    for i, s in enumerate(steps):
        if s.get("type") == "stage" and s.get("stage") == stage_id:
            return i
    return None


def find_part(steps, part_id):
    for i, s in enumerate(steps):
        if s.get("part_id") == part_id:
            return i
    return None


def insert_after_stage(steps, stage_id, block, skip_worlds=True):
    idx = find_stage(steps, stage_id)
    if idx is None:
        print("missing stage", stage_id)
        return steps
    at = idx + 1
    if skip_worlds:
        while at < len(steps) and steps[at].get("type") == "world":
            at += 1
    return steps[:at] + block + steps[at:]


def main():
    data = json.loads(PATH.read_text())
    steps = data["steps"]
    n0 = len(steps)

    # Mark injected once
    if any(s.get("_enrich") for s in steps):
        print("already enriched; stripping previous enrich blocks by tag then re-apply")
        steps = [s for s in steps if not s.get("_enrich")]

    def tag(block, tag_name):
        out = []
        for s in block:
            s = dict(s)
            s["_enrich"] = tag_name
            out.append(s)
        return out

    # Insert from back to front so indices remain valid
    plan = [
        ("wedding_day", tag(PART5, "p5")),
        ("scam_and_jewelry", tag(PART4, "p4")),
        ("half_rsvp_dietary", tag(PART3, "p3")),
        ("deposit_gate", tag(PART2, "p2")),
        ("ledger_bootstrap", tag(PART1, "p1")),
    ]
    for stage_id, block in plan:
        steps = insert_after_stage(steps, stage_id, block)

    # Strengthen part banners conflict text if present
    for s in steps:
        if s.get("part_id") == "part_ledger":
            s["conflict_zh"] = (
                "场地餐饮的初算在合同里，摄影的报价在聊天记录里；婚纱造型、长辈惦记的四金、司仪车队和请柬又各有各的单子，口径不一，从没并到同一张账上。"
                "有的报价含着定金，有的付了就退不回来，有的长辈已经先应了下来；摄影想多留一点，婚纱和四金就得各让一点。"
            )
            s["conflict_en"] = (
                "Venue and catering sit in the contract, photography in a chat; gown, gold, MC, fleet and invites each on their own bill — never one account. "
                "Some include deposits, some are nonrefundable, some elders already agreed; give photo more and dress and gold each give a little."
            )

    data["steps"] = steps
    PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"enriched {n0} -> {len(steps)}")
    from collections import Counter

    print(
        "im threads",
        Counter(s.get("thread") for s in steps if s.get("type") == "im_message"),
    )
    print(
        "new types",
        Counter(s.get("type") for s in steps if s.get("type") in ("calendar_upsert", "calendar_cancel", "files_update", "web_update", "notification")),
    )


if __name__ == "__main__":
    main()
