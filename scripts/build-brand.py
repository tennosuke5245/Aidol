#!/usr/bin/env python3
"""產生 AIDOL 品牌檔（v3：「呆毛」標記＋「ΛIDOL」字標）。

來源：src/assets/brand/aidol-mark-v3.svg（由草圖描成的向量）。字標是照同一張草圖的字形用幾何重建，參數在 wordmark()。

需要：Python 3、Pillow、cairosvg（pip install pillow cairosvg）；桌面圖示另外呼叫 Tauri CLI（bunx tauri icon）。
用法：python3 scripts/build-brand.py            # 全部重建
      python3 scripts/build-brand.py --no-tauri # 不重跑 tauri icon，只更新 SVG／PNG／brand.js

輸出：
  src/assets/brand/aidol-wordmark-v3.svg   字標（淺色字，深色底用）
  src/assets/brand/aidol-lockup-v3.svg     橫式組合（金色標記＋淺色字標）
  src/assets/brand/aidol-icon-v3.svg       App 圖示／favicon（深靛藍圓角方底＋金色標記）
  src/assets/brand/aidol-icon-v3-32.png    favicon 備用 PNG（小尺寸加粗版）
  src/assets/brand/aidol-icon-v3-1024.png  tauri icon 的來源
  src/brand.js                             React 元件用的路徑（Mark、Wordmark）
  src-tauri/icons-v3/                      tauri icon 產生的整組；32px 以下與 icon.ico 每個尺寸另外各自繪製
"""
import io
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / 'src' / 'assets' / 'brand'
ICONS = ROOT / 'src-tauri' / 'icons-v3'
GOLD, TEXT, TILE = '#E5C27A', '#ECEEF7', '#161A30'
# 標記在 512 框內的實際範圍（aidol-mark-v3.svg 的註解有寫）
MARK_X0, MARK_Y0, MARK_X1, MARK_Y1 = 36.7, 32.0, 475.3, 480.0
MARK_H = MARK_Y1 - MARK_Y0
# 頭髮主體（不含呆毛）的垂直中心，橫式組合用它對齊字標
HEAD_CENTER = 305.0
# 介面用的取景：四周留一點空間給小尺寸加粗的描邊
UI_VIEWBOX = (30.0, 26.0, 452.0, 460.0)


def fmt(value, digits=2):
    text = f'{value:.{digits}f}'.rstrip('0').rstrip('.')
    return '0' if text in ('-0', '') else text


def mark_path():
    svg = (BRAND / 'aidol-mark-v3.svg').read_text(encoding='utf-8')
    return re.search(r'<path[^>]* d="([^"]+)"', svg).group(1)


def wordmark(s=23.0, sh=21.0, gaps=(10.0, 19.0, 15.0, 15.0), lam_w=138.0, d_w=92.0, o_w=104.0, l_w=70.0, apex_over=3.0, o_over=1.5):
    """幾何字標：大寫高 100（頂 y=0、基線 y=100）。s＝直筆粗細、sh＝橫筆粗細；Λ 尖端與 O 有視覺補償的超出量。
    回傳 (path, 寬度, 最高點 y)。"""
    parts = []
    x = 0.0
    # Λ：沒有橫槓，兩腳底部平切
    top = -apex_over
    half = lam_w / 2
    run = half / (100 - top)
    t = s / math.cos(math.atan(run))
    inner_apex = 100 - (half - t) / run
    parts.append(f'M{fmt(x)} 100L{fmt(x + half)} {fmt(top)}L{fmt(x + lam_w)} 100L{fmt(x + lam_w - t)} 100L{fmt(x + half)} {fmt(inner_apex)}L{fmt(x + t)} 100Z')
    x += lam_w + gaps[0]
    # I
    parts.append(f'M{fmt(x)} 0H{fmt(x + s)}V100H{fmt(x)}Z')
    x += s + gaps[1]
    # D：直筆＋半圓碗
    r = 50.0
    cx = x + d_w - r
    parts.append(f'M{fmt(x)} 0H{fmt(cx)}A{fmt(r)} {fmt(r)} 0 0 1 {fmt(cx)} 100H{fmt(x)}Z')
    parts.append(f'M{fmt(x + s)} {fmt(sh)}V{fmt(100 - sh)}H{fmt(cx)}A{fmt(r - s)} {fmt(r - sh)} 0 0 0 {fmt(cx)} {fmt(sh)}Z')
    x += d_w + gaps[2]
    # O：上下各超出 o_over
    rx, ry = o_w / 2, 50 + o_over
    ocx = x + rx
    parts.append(f'M{fmt(ocx - rx)} 50A{fmt(rx)} {fmt(ry)} 0 1 1 {fmt(ocx + rx)} 50A{fmt(rx)} {fmt(ry)} 0 1 1 {fmt(ocx - rx)} 50Z')
    irx, iry = rx - s, ry - sh - 0.5
    parts.append(f'M{fmt(ocx - irx)} 50A{fmt(irx)} {fmt(iry)} 0 1 0 {fmt(ocx + irx)} 50A{fmt(irx)} {fmt(iry)} 0 1 0 {fmt(ocx - irx)} 50Z')
    x += o_w + gaps[3]
    # L
    parts.append(f'M{fmt(x)} 0H{fmt(x + s)}V{fmt(100 - sh)}H{fmt(x + l_w)}V100H{fmt(x)}Z')
    x += l_w
    return ''.join(parts), x, top


def lockup(mark_d, word_d, word_w, word_top, mark_h=230.0, gap=22.0, pad=4.0):
    """橫式組合：標記高 mark_h（字標大寫高 100），頭髮主體中心對齊字標中心。
    回傳 dict(svg, viewBox, mark_transform, word_transform)。"""
    m = mark_h / MARK_H
    fy = 50 - HEAD_CENTER * m
    left = MARK_X0 * m
    tx = MARK_X1 * m + gap
    top = min(fy + MARK_Y0 * m, word_top) - pad
    bottom = max(fy + MARK_Y1 * m, 101.5) + pad
    width = tx + word_w + pad - (left - pad)
    view_box = f'{fmt(left - pad)} {fmt(top)} {fmt(width)} {fmt(bottom - top)}'
    mark_transform = f'translate(0 {fmt(fy)}) scale({fmt(m, 5)})'
    word_transform = f'translate({fmt(tx)} 0)'
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" role="img" aria-label="AIDOL">'
           f'<path fill="{GOLD}" transform="{mark_transform}" d="{mark_d}"/>'
           f'<path fill="{TEXT}" fill-rule="evenodd" transform="{word_transform}" d="{word_d}"/></svg>')
    return dict(svg=svg, viewBox=view_box, mark_transform=mark_transform, word_transform=word_transform)


def icon(mark_d, fill=0.72, stroke=0.0, radius=0.22):
    """App 圖示：深靛藍圓角方底，標記高度＝ fill × 邊長；小尺寸用 stroke 加粗（512 單位）。"""
    m = fill * 512 / MARK_H
    tx = 256 - (MARK_X0 + MARK_X1) / 2 * m
    ty = 256 - (MARK_Y0 + MARK_Y1) / 2 * m
    st = f' stroke="{GOLD}" stroke-width="{fmt(stroke)}" stroke-linejoin="round"' if stroke else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            f'<rect width="512" height="512" rx="{fmt(radius * 512)}" fill="{TILE}"/>'
            f'<path fill="{GOLD}"{st} transform="translate({fmt(tx)} {fmt(ty)}) scale({fmt(m, 5)})" d="{mark_d}"/></svg>')


def icon_for(mark_d, size):
    """每個尺寸各自的畫法：32px 以下標記放大並加粗，64px 以下稍放大。"""
    if size <= 32:
        return icon(mark_d, fill=0.80, stroke=8)
    if size <= 64:
        return icon(mark_d, fill=0.76, stroke=4)
    return icon(mark_d)


def render(svg, size):
    png = cairosvg.svg2png(bytestring=svg.encode('utf-8'), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert('RGBA')


def write_brand_js(mark_d, word_d, word_w, word_top, lock):
    vb = ' '.join(fmt(v) for v in UI_VIEWBOX)
    word_vb = f'0 {fmt(word_top)} {fmt(word_w)} {fmt(101.5 - word_top)}'
    text = ("// 由 scripts/build-brand.py 產生，請勿手動修改。來源：src/assets/brand/aidol-mark-v3.svg。\n"
            f"export const markViewBox = '{vb}';\n"
            f"export const markPath = '{mark_d}';\n"
            f"export const wordmarkViewBox = '{word_vb}';\n"
            f"export const wordmarkPath = '{word_d}';\n"
            f"export const lockupViewBox = '{lock['viewBox']}';\n"
            f"export const lockupMarkTransform = '{lock['mark_transform']}';\n"
            f"export const lockupWordTransform = '{lock['word_transform']}';\n")
    (ROOT / 'src' / 'brand.js').write_text(text, encoding='utf-8')


def run_tauri_icon(source):
    tmp = ROOT / 'src-tauri' / '.icons-v3-tmp'
    if tmp.exists():
        shutil.rmtree(tmp)
    subprocess.run(['bunx', 'tauri', 'icon', str(source), '-o', str(tmp)], cwd=ROOT, check=True)
    if ICONS.exists():
        shutil.rmtree(ICONS)
    tmp.rename(ICONS)


def main():
    mark_d = mark_path()
    word_d, word_w, word_top = wordmark()
    BRAND.mkdir(parents=True, exist_ok=True)
    word_svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {fmt(word_top)} {fmt(word_w)} {fmt(101.5 - word_top)}" role="img" aria-label="AIDOL">'
                f'<path fill="{TEXT}" fill-rule="evenodd" d="{word_d}"/></svg>')
    (BRAND / 'aidol-wordmark-v3.svg').write_text(word_svg + '\n', encoding='utf-8')
    lock = lockup(mark_d, word_d, word_w, word_top)
    (BRAND / 'aidol-lockup-v3.svg').write_text(lock['svg'] + '\n', encoding='utf-8')
    (BRAND / 'aidol-icon-v3.svg').write_text(icon(mark_d) + '\n', encoding='utf-8')
    render(icon_for(mark_d, 32), 32).save(BRAND / 'aidol-icon-v3-32.png', optimize=True)
    source = BRAND / 'aidol-icon-v3-1024.png'
    render(icon(mark_d), 1024).save(source, optimize=True)
    write_brand_js(mark_d, word_d, word_w, word_top, lock)
    if '--no-tauri' not in sys.argv:
        run_tauri_icon(source)
    if ICONS.exists():
        # tauri icon 從 1024 縮小；32px 以下改用加粗版各自繪製，icon.ico 每個尺寸也各自繪製。
        for name, size in (('32x32.png', 32), ('Square30x30Logo.png', 30)):
            if (ICONS / name).exists():
                render(icon_for(mark_d, size), size).save(ICONS / name, optimize=True)
        sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
        images = [render(icon_for(mark_d, size), size) for size in sizes]
        images[-1].save(ICONS / 'icon.ico', format='ICO', sizes=[(s, s) for s in sizes], append_images=images[:-1])
    print('brand assets written')


if __name__ == '__main__':
    main()
