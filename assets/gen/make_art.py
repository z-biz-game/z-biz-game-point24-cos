#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""POINT 24 视觉母题的资产工厂：一条命令重画全部位图，落进本仓。

为什么自带工厂而不是手贴 PNG：图标是这局游戏的门面，而这张门面里每一个形状都必须是
可解释的（四张牌 = 玩法，分数线 = 有理数中间值，金/绿 = 牌桌与算对的颜色）。手贴的位图
改不动也验不了；脚本能，且任何人 `python3 assets/gen/make_art.py` 都能重跑出逐字节相同的
结果 —— 噪声与抖动全部走自己的 LCG，不碰 random / Math.random，也不联网。

依赖：Pillow（官方图标工厂 make_icons.py 同样依赖它）。找不到 TrueType 时，图标的
"24"退化为内置矢量字形（只画 2 和 4 两个数字），小尺寸下反而更清晰。

产出（全部为真实 PNG，尺寸见 SIZES / OUT_*）：
  icons/icon-1024.png 母图 · icon-512/192/96/48/32/16 · icon-maskable-512/192
  icons/apple-touch-icon.png(180) · icons/favicon-32.png · icons/favicon-16.png
  icons/og-card.png 1200x630 社交卡
  img/felt.png 256x256 可平铺牌桌绒面（canvas createPattern 用）
  img/pips.png 512x128 sprite（♠♥♦♣ 四帧 128px，胜利粒子贴图）
"""
import os
import struct
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    sys.exit("需要 Pillow：pip install pillow")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# 配色不是编的：逐个从本仓源码实测抽取。
#   #15201f/#243230 = js/view.js FELT/FELT_EDGE   #f3efe4 = CARD
#   #e0a63c = css/game.css --gold                 #101217 = --bg
#   #5fbf7c = --green                              #1d2320 = CARD_INK
FELT_DARK = (21, 32, 31)
FELT_EDGE = (36, 50, 48)
CARD = (243, 239, 228)
CARD_INK = (29, 35, 32)
CARD_SOFT = (109, 106, 95)
GOLD = (224, 166, 60)
GOLD_DEEP = (138, 100, 20)
GREEN = (95, 191, 124)
BG = (16, 18, 23)
SUIT_RED = (217, 96, 90)


class Lcg:
    """自己的确定性伪随机流：整数乘数 + 31 位掩码，逐字节可复现。"""

    def __init__(self, seed=0x5EED424):
        self.s = seed & 0x7FFFFFFF

    def next(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s

    def unit(self):
        return self.next() / 0x7FFFFFFF

    def range(self, a, b):
        return a + self.unit() * (b - a)


def lerp(c1, c2, t):
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * t)) for i in range(len(c1)))


def radial_weld(img, rng, strength=0.055):
    """绒面噪声：逐像素独立 ⇒ 平铺无缝；亮度用一张预知的偏移场做轻微起伏。"""
    w, h = img.size
    px = img.load()
    for y in range(h):
        for x in range(w):
            r, g, b, *rest = px[x, y]
            n = int(rng.range(-strength, strength) * 255)
            px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def digit_2(draw, x, y, w, h, color, stem=None):
    """矢量 '2'：粗笔画由三段折线/圆弧拼成，任何机器都不需要字体。"""
    t = stem or max(3, int(h * 0.19))
    draw.arc([x, y, x + w, y + h * 0.62], 180, 360, fill=color, width=t)
    draw.line([x + w - t // 2, y + h * 0.31, x, y + h], fill=color, width=t)
    draw.line([x, y + h - t // 2, x + w, y + h - t // 2], fill=color, width=t)


def digit_4(draw, x, y, w, h, color, stem=None):
    t = stem or max(3, int(h * 0.19))
    draw.line([x + w * 0.66, y, x + w * 0.66, y + h], fill=color, width=t)
    draw.line([x + w * 0.66, y, x, y + h * 0.66], fill=color, width=t)
    draw.line([x - t, y + h * 0.66, x + w + t, y + h * 0.66], fill=color, width=t)


def text_24(draw, cx, cy, size, color, font=None):
    """画 '24'：优先用真实字体（更结实），否则退到矢量字形。返回占位框。"""
    if font is not None:
        bb = font.getbbox('24')
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        draw.text((cx - w / 2 - bb[0], cy - h / 2 - bb[1]), '24', font=font, fill=color)
        return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    gap = size * 0.08
    dw = size * 0.58
    dh = size * 0.86
    left = cx - dw - gap / 2
    top = cy - dh / 2
    digit_2(draw, left, top, dw, dh, color)
    digit_4(draw, cx + gap / 2, top, dw, dh, color)
    return (left, top, cx + gap / 2 + dw, top + dh)


FONT_CANDIDATES = [
    '/System/Library/Fonts/HelveticaNeue.ttc',
    '/System/Library/Fonts/Supplemental/Helvetica Bold.ttc',
    '/System/Library/Fonts/SFNSMono.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial Bold.ttf',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]
CJK_CANDIDATES = [
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
]


def find_font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return None


try:
    from PIL import ImageFont
except ImportError:
    sys.exit('需要 Pillow')


def suit_spade(draw, cx, cy, r, color):
    """黑桃：朝下的三角叶 + 两片底弧 + 柄。"""
    draw.polygon([(cx, cy - r), (cx - r * 0.92, cy + r * 0.28), (cx + r * 0.92, cy + r * 0.28)], fill=color)
    draw.ellipse([cx - r * 0.95, cy - r * 0.12, cx, cy + r * 0.62], fill=color)
    draw.ellipse([cx, cy - r * 0.12, cx + r * 0.95, cy + r * 0.62], fill=color)
    draw.polygon([(cx - r * 0.34, cy + r), (cx + r * 0.34, cy + r), (cx + r * 0.08, cy + r * 0.42),
                  (cx - r * 0.08, cy + r * 0.42)], fill=color)


def suit_heart(draw, cx, cy, r, color):
    draw.ellipse([cx - r * 0.98, cy - r * 0.82, cx - r * 0.02, cy + r * 0.14], fill=color)
    draw.ellipse([cx + r * 0.02, cy - r * 0.82, cx + r * 0.98, cy + r * 0.14], fill=color)
    draw.polygon([(cx - r * 0.86, cy - r * 0.02), (cx + r * 0.86, cy - r * 0.02), (cx, cy + r)], fill=color)


def suit_diamond(draw, cx, cy, r, color):
    draw.polygon([(cx, cy - r), (cx + r * 0.72, cy), (cx, cy + r), (cx - r * 0.72, cy)], fill=color)


def suit_club(draw, cx, cy, r, color):
    draw.ellipse([cx - r * 0.5, cy - r, cx + r * 0.5, cy], fill=color)
    draw.ellipse([cx - r, cy - r * 0.3, cx - r * 0.06, cy + r * 0.62], fill=color)
    draw.ellipse([cx + r * 0.06, cy - r * 0.3, cx + r, cy + r * 0.62], fill=color)
    draw.polygon([(cx - r * 0.32, cy + r * 0.95), (cx + r * 0.32, cy + r * 0.95),
                  (cx + r * 0.07, cy + r * 0.3), (cx - r * 0.07, cy + r * 0.3)], fill=color)


SUIT_PAINTERS = [
    (suit_spade, CARD_INK),
    (suit_heart, SUIT_RED),
    (suit_diamond, SUIT_RED),
    (suit_club, CARD_INK),
]


def felt_background(size, rng, vignette=0.30, weave=True):
    """牌桌绒面：径向提亮 + 45° 织纹 + 逐像素噪声。返回 RGB 图。"""
    img = Image.new('RGB', (size, size), FELT_DARK)
    px = img.load()
    c = size / 2.0
    rr = (c * c + c * c) ** 0.5
    for y in range(size):
        for x in range(size):
            d = (((x - c * 0.72) ** 2 + (y - c * 0.42) ** 2) ** 0.5) / rr
            t = max(0.0, min(1.0, d))
            f = 1.0 - vignette * (t ** 1.6)
            px[x, y] = tuple(int(min(255, v * f)) for v in lerp(FELT_EDGE, FELT_DARK, min(1.0, d * 1.5)))
    if weave:
        draw = ImageDraw.Draw(img, 'RGBA')
        step = max(4, size // 22)
        for k in range(-size, size * 2, step):
            draw.line([(k, 0), (k + size, size)], fill=(255, 255, 255, 7), width=max(1, size // 400))
            draw.line([(k, size), (k + size, 0)], fill=(0, 0, 0, 10), width=max(1, size // 400))
    return radial_weld(img, rng)


def master(size=1024, mask=False):
    """母图：绒面底 + 扇形暗牌 + 中央奶油牌（24 与分数线）+ 四枚花色点。

    mask=True 时把主牌缩到 66% 并整体居中，满足 Android adaptive icon 的 80dp 安全区。
    """
    rng = Lcg(0x2424 if not mask else 0x2425)
    img = felt_background(size, rng)
    draw = ImageDraw.Draw(img, 'RGBA')
    s = size

    # 扇形暗牌：暗示「四张牌」，压在亮牌后面，只露出边。
    fan_w, fan_h = int(s * 0.20), int(s * 0.29)
    for i, (rot, dy) in enumerate([(-26, 0.085), (-13, 0.052), (13, 0.052), (26, 0.085)]):
        card = Image.new('RGBA', (fan_w, fan_h), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        rounded(cd, [2, 2, fan_w - 3, fan_h - 3], int(fan_w * 0.14), (30, 46, 44, 240),
                outline=(96, 124, 118, 235), width=max(1, s // 340))
        cd = card.rotate(rot, expand=True, resample=Image.BICUBIC)
        img.paste(cd, (int(s * 0.5 - cd.width / 2 + (i - 1.5) * s * 0.115),
                       int(s * (0.60 + dy) - cd.height / 2)), cd)

    # 主牌：奶油底、圆角、落地影。
    cw, ch = int(s * (0.44 if not mask else 0.40)), int(s * (0.62 if not mask else 0.56))
    cx, cy = s // 2, int(s * (0.52 if not mask else 0.50))
    shadow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    rounded(sd, [cx - cw // 2 + s * 0.012, cy - ch // 2 + s * 0.022,
                 cx - cw // 2 + cw + s * 0.012, cy - ch // 2 + ch + s * 0.022],
            int(cw * 0.13), (0, 0, 0, 130))
    img = Image.alpha_composite(img.convert('RGBA'), shadow).convert('RGB')
    draw = ImageDraw.Draw(img, 'RGBA')
    rounded(draw, [cx - cw // 2, cy - ch // 2, cx - cw // 2 + cw, cy - ch // 2 + ch],
            int(cw * 0.13), CARD, outline=(255, 255, 255, 90), width=max(2, s // 300))

    # 角标花色：左上 / 右下（右下旋转 180°，和真牌一致）。
    pip = int(cw * 0.11)
    corner = (cx - cw // 2 + int(cw * 0.14), cy - ch // 2 + int(ch * 0.15))
    suit_spade(draw, corner[0], corner[1], pip, CARD_INK)
    draw.text((corner[0] - pip * 0.9, corner[1] + pip * 0.7), '24', fill=CARD_INK,
              font=find_font(FONT_CANDIDATES, max(8, int(pip * 1.3))))
    suit_spade(draw, cx + cw // 2 - int(cw * 0.14), cy + ch // 2 - int(ch * 0.15), pip, CARD_INK)

    # 「24」本体 + 分数线：这局游戏的立身之处是分数中间值，所以把 24 写成 24/1。
    font = find_font(FONT_CANDIDATES, int(ch * 0.34))
    box = text_24(draw, cx, cy - int(ch * 0.06), int(ch * 0.34), CARD_INK, font)
    bar_y = int(box[3] + ch * 0.055)
    bar_w = int((box[2] - box[0]) * 1.18)
    draw.line([(cx - bar_w // 2, bar_y), (cx + bar_w // 2, bar_y)], fill=GOLD_DEEP,
              width=max(3, int(ch * 0.028)))
    small = find_font(FONT_CANDIDATES, int(ch * 0.14))
    if small:
        bb = small.getbbox('1')
        draw.text((cx - (bb[2] - bb[0]) / 2 - bb[0], bar_y + int(ch * 0.03) - bb[1]), '1',
                  font=small, fill=CARD_SOFT)
    else:
        t = max(3, int(ch * 0.03))
        draw.line([(cx, bar_y + int(ch * 0.045)), (cx, bar_y + int(ch * 0.16))], fill=CARD_SOFT, width=t)

    # 底缘四枚花色点：呼应「四张牌」，也给图标一条自己的横向节奏。
    row_y = int(s * 0.90)
    for i, (paint, col) in enumerate(SUIT_PAINTERS):
        paint(draw, int(s * (0.29 + i * 0.14)), row_y, int(s * 0.028), GOLD)
    return img


def og_card(path, font_paths):
    """1200x630 社交卡：左文右图标，色板与母图同源。"""
    rng = Lcg(0x0630)
    W, H = 1200, 630
    img = Image.new('RGB', (W, H), BG)
    px = img.load()
    for y in range(H):
        for x in range(W):
            t = x / W
            px[x, y] = lerp(FELT_DARK, BG, min(1.0, t * 0.85))
    img = radial_weld(img, Lcg(0x0631), strength=0.03)
    draw = ImageDraw.Draw(img, 'RGBA')
    for k in range(-H, W + H, 30):
        draw.line([(k, 0), (k + H, H)], fill=(255, 255, 255, 5), width=1)
    # 左侧：品牌 + 一句话 + 三个实测数字
    draw.line([(72, 96), (72, H - 96)], fill=GOLD, width=6)
    f_brand = find_font(font_paths, 74)
    f_sub = find_font(font_paths, 30)
    f_meta = find_font(font_paths, 22)
    if f_brand:
        draw.text((116, 112), '二十四点', font=f_brand, fill=CARD)
        draw.text((116, 208), 'POINT 24 · 难度是被量出来的', font=f_sub, fill=GOLD)
        draw.text((116, 268), '四张牌 · 加减乘除 · 分数中间值不丢', font=f_sub, fill=(159, 176, 189))
        draw.text((116, 452), '牌面 1..13 可重复四元组 1820 个，其中 1362 个可解', font=f_meta, fill=(226, 232, 240))
        draw.text((116, 492), '张数 / 步数 / 本质不同算式条数：有理数域穷举认证', font=f_meta, fill=(159, 176, 189))
    else:
        text_24(draw, 300, 200, 120, CARD)
        rounded(draw, [116, 452, 640, 470], 6, GOLD)
    # 右侧：母图缩到 380，圆角蒙版贴上去（方图直贴会显成一块补丁）
    ic = master(380).convert('RGBA').resize((380, 380), Image.LANCZOS)
    mask = Image.new('L', (380, 380), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 379, 379], radius=54, fill=255)
    ox, oy = W - 380 - 96, (H - 380) // 2
    img.paste(ic, (ox, oy), mask)
    img.save(path, 'PNG', optimize=True)
    return img.size


def felt_tile(path, size=256):
    """可平铺绒面：白噪声逐像素独立 + 周期整除 256 的织纹 ⇒ 四边无缝。"""
    rng = Lcg(0xFE17)
    img = Image.new('RGB', (size, size), FELT_DARK)
    draw = ImageDraw.Draw(img, 'RGBA')
    for k in range(-size, size * 2, 32):
        draw.line([(k, 0), (k + size, size)], fill=(255, 255, 255, 6), width=1)
        draw.line([(k, size), (k + size, 0)], fill=(0, 0, 0, 9), width=1)
    img = radial_weld(img, rng, strength=0.045)
    img.save(path, 'PNG', optimize=True)
    return img.size


def pips_sheet(path, frame=128):
    """♠♥♦♣ 四帧 sprite，胜利粒子按 (index % 4) 取帧。"""
    img = Image.new('RGBA', (frame * 4, frame), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for i, (paint, col) in enumerate(SUIT_PAINTERS):
        paint(draw, i * frame + frame // 2, int(frame * 0.52), int(frame * 0.38), col + (255,))
    img.save(path, 'PNG', optimize=True)
    return img.size


def main():
    icon_dir = os.path.join(ROOT, 'icons')
    img_dir = os.path.join(ROOT, 'img')
    gen_dir = os.path.join(ROOT, 'assets', 'gen')
    for d in (icon_dir, img_dir, gen_dir):
        os.makedirs(d, exist_ok=True)

    m = master(1024)
    m.save(os.path.join(icon_dir, 'icon-1024.png'), 'PNG', optimize=True)
    sizes = [512, 192, 180, 96, 48, 32, 16]
    for s in sizes:
        m.resize((s, s), Image.LANCZOS).save(os.path.join(icon_dir, f'icon-{s}.png'), 'PNG', optimize=True)
    m.resize((180, 180), Image.LANCZOS).save(os.path.join(icon_dir, 'apple-touch-icon.png'), 'PNG', optimize=True)
    m.resize((32, 32), Image.LANCZOS).save(os.path.join(icon_dir, 'favicon-32.png'), 'PNG', optimize=True)
    m.resize((16, 16), Image.LANCZOS).save(os.path.join(icon_dir, 'favicon-16.png'), 'PNG', optimize=True)
    mk = master(1024, mask=True)
    for s in (512, 192):
        mk.resize((s, s), Image.LANCZOS).save(os.path.join(icon_dir, f'icon-maskable-{s}.png'), 'PNG', optimize=True)

    print('og-card  ', og_card(os.path.join(icon_dir, 'og-card.png'), CJK_CANDIDATES or FONT_CANDIDATES))
    print('felt     ', felt_tile(os.path.join(img_dir, 'felt.png')))
    print('pips     ', pips_sheet(os.path.join(img_dir, 'pips.png')))
    # 供 CI 复核：字体缺失只影响 og 文案，不影响任何图标。
    print('font     ', 'ok' if find_font(FONT_CANDIDATES, 40) else 'fallback-vector')
    listing = [('icons/' + f) for f in sorted(os.listdir(icon_dir)) if f.endswith('.png')]
    listing += [('img/' + f) for f in sorted(os.listdir(img_dir)) if f.endswith('.png')]
    for p in listing:
        fp = os.path.join(ROOT, p)
        w, h = struct.unpack('>II', open(fp, 'rb').read(24)[16:24])
        print(f'{p:34s} {w}x{h} {os.path.getsize(fp)}B')


if __name__ == '__main__':
    main()
