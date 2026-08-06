#!/usr/bin/env python3
"""Generate realistic ecom demo media from stock photos + Chinese document mockups."""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "ecom"
SRC = OUT / "_src"
DOCS = OUT / "docs"
AVATARS = OUT / "avatars"

FONT = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
FONT_BOLD = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if bold else FONT
    try:
        return ImageFont.truetype(path, size=size, index=0)
    except OSError:
        return ImageFont.load_default()


def load_src(name: str, size: tuple[int, int], *, crop: str = "center") -> Image.Image:
    img = Image.open(SRC / name).convert("RGB")
    return ImageOps.fit(img, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.45 if crop == "top" else 0.5))


def save_webp(img: Image.Image, path: Path, quality: int = 82) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path, "WEBP", quality=quality, method=6)
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024}KB)")


def vignette(img: Image.Image, strength: float = 0.35) -> Image.Image:
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse((-w * 0.1, -h * 0.15, w * 1.1, h * 1.15), fill=int(255 * (1 - strength)))
    mask = mask.filter(ImageFilter.GaussianBlur(max(w, h) // 8))
    dark = Image.new("RGB", (w, h), (20, 12, 8))
    return Image.composite(img, dark, mask)


def rounded(img: Image.Image, r: int = 28) -> Image.Image:
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=r, fill=255)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (0, 0))
    out.putalpha(mask)
    bg = Image.new("RGB", (w, h), (245, 240, 234))
    bg.paste(out, mask=out.split()[-1])
    return bg


def draw_pack_card(size=(420, 560), version: str = "v2") -> Image.Image:
    """Photoreal-ish pouch on lifestyle backdrop."""
    base = load_src("beans.jpg", size)
    base = ImageEnhance.Color(base).enhance(1.05)
    base = ImageEnhance.Contrast(base).enhance(1.08)
    base = vignette(base, 0.28)
    d = ImageDraw.Draw(base, "RGBA")

    # soft pouch silhouette
    pouch = [(120, 90), (300, 90), (330, 470), (90, 470)]
    if version == "v1":
        fill, accent = (78, 46, 30, 235), (196, 163, 90)
        claim = "工位续命 · 提神"
    else:
        fill, accent = (52, 34, 26, 240), (212, 175, 98)
        claim = "云南日晒 · 莓果红茶感"

    d.rounded_rectangle((88, 78, 332, 482), radius=36, fill=fill)
    d.rounded_rectangle((108, 108, 312, 250), radius=18, fill=(255, 248, 236, 40))
    # drip silhouette
    for i, x in enumerate((150, 195, 240)):
        d.rounded_rectangle((x, 130, x + 28, 220), radius=6, fill=(255, 255, 255, 55 + i * 10))
    d.text((210, 270), "VIBE", font=font(36, True), fill=accent, anchor="mm")
    d.text((210, 310), "COFFEE", font=font(18), fill=(243, 235, 226), anchor="mm")
    d.text((210, 350), claim, font=font(16), fill=(230, 214, 190), anchor="mm")
    d.ellipse((250, 400, 300, 450), fill=accent)
    d.text((275, 425), "12", font=font(22, True), fill=(40, 28, 18), anchor="mm")
    badge = "v1 驳回稿" if version == "v1" else "v2 通过稿"
    d.rounded_rectangle((20, 20, 150, 54), radius=10, fill=(255, 255, 255, 210))
    d.text((85, 37), badge, font=font(16, True), fill=(60, 40, 28), anchor="mm")
    return base


def make_sku_hero() -> None:
    canvas = Image.new("RGB", (720, 720), (244, 236, 226))
    life = load_src("desk_brew.jpg", (720, 720))
    life = ImageEnhance.Brightness(life).enhance(0.92)
    canvas = Image.blend(canvas, life, 0.55)
    pack = draw_pack_card((360, 480), "v2")
    pack = rounded(pack, 28)
    canvas.paste(pack, (180, 90))
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((40, 600, 680, 680), radius=16, fill=(255, 255, 255, ))
    d.text((360, 628), "云南日晒挂耳 · 12 杯盒", font=font(28, True), fill=(45, 32, 24), anchor="mm")
    d.text((360, 660), "drip-yunnan-12  ·  ¥39.9", font=font(18), fill=(120, 90, 60), anchor="mm")
    save_webp(canvas, OUT / "sku_hero.webp")


def make_packs() -> None:
    save_webp(draw_pack_card((480, 640), "v1"), OUT / "pack_v1.webp")
    save_webp(draw_pack_card((480, 640), "v2"), OUT / "pack_v2.webp")


def phone_chrome(cover: Image.Image, title: str, likes: str, author: str = "咖啡工坊") -> Image.Image:
    """XHS-style note card with real photo cover."""
    w, h = 540, 720
    card = Image.new("RGB", (w, h), (255, 255, 255))
    cover = ImageOps.fit(cover, (w, 480), method=Image.Resampling.LANCZOS)
    card.paste(cover, (0, 0))
    d = ImageDraw.Draw(card)
    # bottom white panel
    d.rectangle((0, 460, w, h), fill=(255, 255, 255))
    # author row
    d.ellipse((24, 480, 64, 520), fill=(255, 36, 66))
    d.text((44, 500), "咖", font=font(16, True), fill="white", anchor="mm")
    d.text((76, 500), author, font=font(18, True), fill=(33, 33, 33), anchor="lm")
    # title
    d.text((24, 545), title, font=font(22, True), fill=(22, 22, 22))
    d.text((24, 585), "拆袋 → 热水 → 3 分钟 · 云南日晒果香", font=font(15), fill=(100, 100, 100))
    # engagement
    d.text((24, 655), f"♡  {likes}", font=font(16), fill=(80, 80, 80))
    d.text((150, 655), "★  收藏", font=font(16), fill=(80, 80, 80))
    d.text((260, 655), "↗  分享", font=font(16), fill=(80, 80, 80))
    d.rounded_rectangle((400, 640, 516, 680), radius=16, fill=(255, 36, 66))
    d.text((458, 660), "去购买", font=font(16, True), fill="white", anchor="mm")
    # top logo chip
    d.rounded_rectangle((16, 16, 110, 48), radius=12, fill=(255, 255, 255))
    d.text((63, 32), "小红书", font=font(16, True), fill=(255, 36, 66), anchor="mm")
    return card


def make_notes() -> None:
    v1 = phone_chrome(load_src("desk_brew.jpg", (540, 480)), "工位挂耳的一个小仪式", "2.1万")
    save_webp(v1, OUT / "note_v1_cover.webp")
    v2 = phone_chrome(load_src("pour.jpg", (540, 480)), "云南日晒挂耳的果香怎么泡", "8.6千", author="咖啡工坊·官方")
    # stamp re-approved
    d = ImageDraw.Draw(v2, "RGBA")
    d.ellipse((390, 70, 510, 190), outline=(16, 185, 129, 220), width=5)
    d.text((450, 130), "复审\n通过", font=font(22, True), fill=(16, 185, 129), anchor="mm", align="center")
    save_webp(v2, OUT / "note_v2_cover.webp")


def make_video_poster() -> None:
    base = load_src("cup.jpg", (720, 405))
    base = vignette(ImageEnhance.Contrast(base).enhance(1.1), 0.4)
    d = ImageDraw.Draw(base, "RGBA")
    d.ellipse((300, 142, 420, 262), fill=(0, 0, 0, 140))
    d.polygon([(345, 170), (345, 235), (400, 202)], fill=(255, 255, 255, 230))
    d.rounded_rectangle((24, 24, 210, 60), radius=10, fill=(0, 0, 0, 150))
    d.text((117, 42), "种草成片 · 28s", font=font(18, True), fill="white", anchor="mm")
    d.rounded_rectangle((600, 350, 696, 386), radius=8, fill=(0, 0, 0, 160))
    d.text((648, 368), "00:28", font=font(16), fill="white", anchor="mm")
    save_webp(base, OUT / "video_poster.webp")


def doc_canvas(w=720, h=960, title="DOCUMENT") -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (w, h), (248, 250, 252))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, w, 72), fill=(15, 23, 42))
    d.text((24, 36), title, font=font(26, True), fill="white", anchor="lm")
    d.text((w - 24, 36), "PDF · 扫描预览", font=font(14), fill=(148, 163, 184), anchor="rm")
    # paper shadow panel
    d.rounded_rectangle((28, 96, w - 28, h - 36), radius=12, fill=(255, 255, 255), outline=(226, 232, 240), width=2)
    return img, d


def make_quote_sheet() -> None:
    img, d = doc_canvas(title="QUOTE-09 · 供应商比价")
    d.text((52, 120), "日期 2026-09-06 · Agent 自动汇总 · 项目 PRJ-COFFEE-002", font=font(15), fill=(100, 116, 139))
    rows = [
        ("豆商 A", "¥68/kg", "MOQ 50", "QC FAIL", (220, 38, 38), False),
        ("豆商 B", "¥60/kg", "MOQ 80", "QC PASS", (16, 185, 129), True),
        ("保山合作社", "¥65/kg", "MOQ 60", "QC PASS", (16, 185, 129), False),
    ]
    y = 170
    for name, price, moq, qc, color, pick in rows:
        bg = (236, 253, 245) if pick else (248, 250, 252)
        d.rounded_rectangle((52, y, 668, y + 88), radius=12, fill=bg, outline=(226, 232, 240))
        d.text((76, y + 30), name, font=font(22, True), fill=(15, 23, 42))
        d.text((76, y + 60), f"{price}  ·  {moq}", font=font(16), fill=(71, 85, 105))
        d.rounded_rectangle((500, y + 28, 640, y + 62), radius=8, fill=color)
        d.text((570, y + 45), qc, font=font(15, True), fill="white", anchor="mm")
        if pick:
            d.text((640, y + 78), "← 选定", font=font(14, True), fill=(5, 150, 105), anchor="rm")
        y += 104
    d.rounded_rectangle((52, y + 10, 668, y + 150), radius=12, fill=(15, 23, 42))
    d.text((76, y + 45), "锁单纪要", font=font(18, True), fill=(148, 163, 184))
    d.text((76, y + 85), "PO-B-080 · 80kg · 合计 ¥4,800", font=font(24, True), fill="white")
    d.text((76, y + 125), "条款：不合格可退换 · 农残报告齐全", font=font(15), fill=(203, 213, 225))
    d.ellipse((560, y + 40, 650, y + 130), outline=(52, 211, 153), width=4)
    d.text((605, y + 85), "B", font=font(36, True), fill=(52, 211, 153), anchor="mm")
    save_webp(img, DOCS / "quote_sheet.webp")


def make_po() -> None:
    img, d = doc_canvas(title="PO-B-080 · 采购订单")
    lines = [
        ("供应商", "云南豆商 B"),
        ("SKU", "drip-yunnan-12 原料豆"),
        ("数量", "80 kg"),
        ("单价", "¥60 / kg"),
        ("金额", "¥4,800"),
        ("交期", "D+10"),
        ("质检", "杯测 + 农残报告"),
        ("状态", "LOCKED"),
    ]
    y = 130
    for k, v in lines:
        d.text((70, y), k, font=font(16), fill=(100, 116, 139))
        d.text((250, y), v, font=font(20, True), fill=(15, 23, 42))
        d.line((70, y + 28, 650, y + 28), fill=(241, 245, 249), width=1)
        y += 56
    d.rounded_rectangle((70, y + 20, 650, y + 120), radius=12, fill=(254, 243, 199))
    d.text((90, y + 55), "预付款 30% 已冻结 · 财务科目「原料-B」", font=font(18, True), fill=(146, 64, 14))
    d.text((90, y + 95), "Agent 签署 · 老板确认抄送", font=font(15), fill=(180, 83, 9))
    save_webp(img, DOCS / "po_b080.webp")


def make_cupping() -> None:
    img, d = doc_canvas(title="杯测报告 · LOT-B")
    # photo strip
    strip = load_src("beans.jpg", (620, 180))
    img.paste(strip, (50, 110))
    scores = [("香气", 8.2), ("酸质", 7.8), ("甜感", 8.0), ("余韵", 7.6), ("洁净", 8.4)]
    y = 320
    for name, sc in scores:
        d.text((70, y), name, font=font(18, True), fill=(51, 65, 85))
        bar_w = int(360 * (sc / 10))
        d.rounded_rectangle((160, y + 4, 520, y + 22), radius=6, fill=(226, 232, 240))
        d.rounded_rectangle((160, y + 4, 160 + bar_w, y + 22), radius=6, fill=(180, 83, 9))
        d.text((540, y + 2), f"{sc}", font=font(18, True), fill=(15, 23, 42))
        y += 48
    d.rounded_rectangle((70, y + 10, 650, y + 100), radius=12, fill=(236, 253, 245), outline=(110, 231, 183))
    d.text((90, y + 40), "结论：PASS · 可投产灌装", font=font(22, True), fill=(6, 95, 70))
    d.text((90, y + 78), "风味描述：莓果 / 红茶感 / 中等醇厚度", font=font(15), fill=(4, 120, 87))
    save_webp(img, DOCS / "cupping_qc.webp")


def make_qc_incident() -> None:
    img, d = doc_canvas(title="质量事件 · LOT-B07")
    photo = load_src("pour.jpg", (620, 200))
    photo = ImageEnhance.Color(photo).enhance(0.7)
    img.paste(photo, (50, 110))
    d.rounded_rectangle((50, 110, 200, 150), radius=8, fill=(220, 38, 38))
    d.text((125, 130), "客诉升温", font=font(16, True), fill="white", anchor="mm")
    bullets = [
        "现象：18 单反馈「酸味异常 / 滤袋渗粉」",
        "批次：LOT-B07 · 疑似仓储受潮",
        "处置：退款 ¥718 · 冻结该批次出库",
        "供应商：承诺补货 80kg + 承担返程运费",
        "对内：客服话术已同步 · 笔记暂缓投流",
    ]
    y = 340
    for b in bullets:
        d.ellipse((70, y + 8, 82, y + 20), fill=(220, 38, 38))
        d.text((96, y), b, font=font(17), fill=(30, 41, 59))
        y += 42
    d.rounded_rectangle((70, y + 10, 650, y + 90), radius=12, fill=(254, 226, 226))
    d.text((90, y + 40), "利润回撤中 · 需空运补货评估", font=font(20, True), fill=(153, 27, 27))
    d.text((90, y + 72), "关联：库存告警 · 空运费预估 ¥1,600", font=font(15), fill=(185, 28, 28))
    save_webp(img, DOCS / "qc_incident.webp")


def make_scam_mail() -> None:
    img = Image.new("RGB", (720, 900), (241, 245, 249))
    d = ImageDraw.Draw(img)
    # mail chrome
    d.rounded_rectangle((40, 40, 680, 860), radius=16, fill="white", outline=(203, 213, 225), width=2)
    d.rectangle((40, 40, 680, 110), fill=(15, 23, 42))
    d.text((60, 75), "收件箱 · 可疑邮件", font=font(22, True), fill="white", anchor="lm")
    d.rounded_rectangle((520, 58, 660, 92), radius=8, fill=(220, 38, 38))
    d.text((590, 75), "钓鱼风险", font=font(15, True), fill="white", anchor="mm")

    fields = [
        ("发件人", "payments@bean-b-pay-nz.info"),
        ("主　题", "【紧急】PO-B-080 尾款请改汇新账户"),
        ("时　间", "今天 09:14"),
    ]
    y = 140
    for k, v in fields:
        d.text((70, y), k, font=font(15), fill=(100, 116, 139))
        d.text((160, y), v, font=font(16, True), fill=(15, 23, 42) if "@" not in v else (185, 28, 28))
        y += 36
    d.line((60, y + 4, 660, y + 4), fill=(226, 232, 240), width=2)
    y += 30
    body = (
        "您好，\n\n"
        "因银行系统升级，请将 PO-B-080 剩余尾款\n"
        "汇至以下新账户（今日 18:00 前）：\n\n"
        "户名：Bean B Trading NZ\n"
        "账号：NZ62-8821-****-4410\n"
        "银行：KiwiPay Commerce\n\n"
        "否则订单将自动取消。"
    )
    for line in body.split("\n"):
        d.text((70, y), line, font=font(17), fill=(51, 65, 85))
        y += 28
    d.rounded_rectangle((70, 700, 650, 820), radius=12, fill=(254, 242, 242), outline=(252, 165, 165))
    d.text((90, 730), "Agent 核查结论", font=font(16, True), fill=(153, 27, 27))
    d.text((90, 765), "· 域名非豆商 B 历史域名", font=font(15), fill=(127, 29, 29))
    d.text((90, 795), "· 已标记垃圾并通知财务拒付", font=font(15), fill=(127, 29, 29))
    save_webp(img, DOCS / "scam_mail.webp")


def make_avatars() -> None:
    """Crop face-ish circles from lifestyle photos + solid brand avatars."""
    palette = {
        "boss": ((45, 32, 24), "岚"),
        "bean_a": ((120, 53, 15), "A"),
        "bean_b": ((22, 101, 52), "B"),
        "bean_c": ((30, 64, 175), "C"),
        "pack_factory": ((67, 56, 202), "包"),
        "design": ((157, 23, 77), "设"),
        "xhs_ops": ((190, 18, 60), "红"),
        "cs": ((14, 116, 144), "客"),
        "kol": ((126, 34, 206), "播"),
        "finance": ((15, 118, 110), "财"),
        "agent": ((15, 23, 42), "AI"),
    }
    crops = {
        "boss": ("desk_brew.jpg", (0.55, 0.2)),
        "kol": ("cup.jpg", (0.4, 0.25)),
        "design": ("pack_life.jpg", (0.5, 0.4)),
        "xhs_ops": ("pour.jpg", (0.6, 0.3)),
    }
    for key, (bg, label) in palette.items():
        size = 160
        if key in crops:
            src, center = crops[key]
            img = ImageOps.fit(
                Image.open(SRC / src).convert("RGB"),
                (size, size),
                method=Image.Resampling.LANCZOS,
                centering=center,
            )
            img = ImageEnhance.Brightness(img).enhance(0.95)
        else:
            img = Image.new("RGB", (size, size), bg)
            # subtle noise
            px = img.load()
            rnd = random.Random(hash(key) & 0xFFFF)
            for y in range(size):
                for x in range(size):
                    j = rnd.randint(-8, 8)
                    r, g, b = px[x, y]
                    px[x, y] = (max(0, min(255, r + j)), max(0, min(255, g + j)), max(0, min(255, b + j)))
            d = ImageDraw.Draw(img)
            d.text((size // 2, size // 2), label, font=font(48, True), fill=(255, 255, 255), anchor="mm")
        # circular mask baked onto warm bg for webp
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((2, 2, size - 3, size - 3), fill=255)
        canvas = Image.new("RGB", (size, size), (248, 250, 252))
        canvas.paste(img, mask=mask)
        # ring
        ImageDraw.Draw(canvas).ellipse((2, 2, size - 3, size - 3), outline=(226, 232, 240), width=3)
        if key in crops:
            # small initial badge
            ImageDraw.Draw(canvas).ellipse((108, 108, 152, 152), fill=bg)
            ImageDraw.Draw(canvas).text((130, 130), label[0], font=font(18, True), fill="white", anchor="mm")
        save_webp(canvas, AVATARS / f"{key}.webp", quality=78)


def main() -> None:
    assert SRC.exists(), f"missing source photos in {SRC}"
    make_sku_hero()
    make_packs()
    make_notes()
    make_video_poster()
    make_quote_sheet()
    make_po()
    make_cupping()
    make_qc_incident()
    make_scam_mail()
    make_avatars()
    print("done")


if __name__ == "__main__":
    main()
