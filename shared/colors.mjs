// 顏色工具（2026-10-13 起）：自訂色（#RRGGBB）的正規化、色彩空間轉換、自動命名，以及從圖片抓主色。
// 純函式，前端與本機核心共用。自動命名用樣式庫的 colorHues／colorTones；前端傳入目前語言的清單（lib-i18n 的 L）。
import * as libraries from './libraries.mjs';

export const hexPattern = '^#[0-9A-Fa-f]{6}$';
const hexRegex = /^#[0-9a-f]{6}$/i;
export const isHex = (value) => typeof value === 'string' && hexRegex.test(value);

// 接受 #abc、abc、#aabbcc、aabbcc（前後空白可），回傳大寫 #AABBCC；不合法回傳 null。
export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let text = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(text)) text = [...text].map((char) => char + char).join('');
  return /^[0-9a-f]{6}$/i.test(text) ? `#${text.toUpperCase()}` : null;
}

export function hexToRgb(hex) {
  const value = Number.parseInt(String(hex).slice(1, 7), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
const channel = (value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');
export const rgbToHex = ({ r, g, b }) => `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();

// HSV：h 0–360，s、v 0–1（調色盤用）。
export function rgbToHsv({ r, g, b }) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  let h = 0;
  if (delta) h = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}
export function hsvToRgb({ h, s, v }) {
  const hue = ((h % 360) + 360) % 360 / 60;
  const chroma = v * s, x = chroma * (1 - Math.abs((hue % 2) - 1)), m = v - chroma;
  const [red, green, blue] = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return { r: (red + m) * 255, g: (green + m) * 255, b: (blue + m) * 255 };
}
// HSL：h 0–360，s、l 0–1（命名與隨機配色用）。
export function rgbToHsl({ r, g, b }) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  const l = (max + min) / 2;
  const s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
  return { h: rgbToHsv({ r, g, b }).h, s: Math.min(1, s), l };
}
export function hslToRgb({ h, s, l }) {
  const v = l + s * Math.min(l, 1 - l);
  return hsvToRgb({ h, s: v ? 2 * (1 - l / v) : 0, v });
}

// 色相分區（度）。橘色區偏暗或偏灰是棕；黃、黃綠偏暗是橄欖綠；紅、紫紅很亮是粉紅。
function hueOf(h, s, l) {
  if (h >= 345 || h < 12) return l > 0.7 ? 'pink' : 'red';
  if (h < 40) return l < 0.4 || s < 0.45 ? 'brown' : 'orange';
  if (h < 68) return l < 0.35 ? 'olive' : 'yellow';
  if (h < 90) return l < 0.3 ? 'olive' : 'lime';
  if (h < 155) return 'green';
  if (h < 182) return 'teal';
  if (h < 205) return 'cyan';
  if (h < 240) return 'blue';
  if (h < 255) return 'indigo';
  if (h < 305) return 'purple';
  if (h < 325) return l > 0.8 ? 'pink' : 'magenta';
  return l < 0.4 ? 'magenta' : 'pink';
}

// 自訂色的稱呼：{ hue, tone, label（介面語言）, prompt（英文） }。lib 傳目前語言的樣式庫（預設繁中）。
export function colorName(hex, lib = libraries) {
  const rgb = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(rgb);
  const chroma = (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) / 255;
  let hue, tone = null;
  if (chroma < 0.1) {
    hue = l > 0.86 ? 'white' : l < 0.14 ? 'black' : 'gray';
    if (hue === 'gray') tone = l > 0.62 ? 'light' : l < 0.36 ? 'dark' : null;
  } else {
    hue = hueOf(h, s, l);
    tone = l < 0.24 ? 'dark' : l > 0.84 ? 'pale' : l > 0.64 ? 'light' : s < 0.38 ? 'muted' : s > 0.8 && l >= 0.4 && l <= 0.62 ? 'vivid' : null;
  }
  const hueOption = lib.colorHues.find((item) => item.id === hue);
  const toneOption = tone ? lib.colorTones.find((item) => item.id === tone) : null;
  // 英文這類以字母結尾的修飾語要空一格（light blue）；中日文直接接（淺藍、明るい青）。
  const toneLabel = toneOption?.label || '';
  const joined = toneLabel ? `${toneLabel}${/[A-Za-z]$/.test(toneLabel) ? ' ' : ''}${hueOption.label}` : hueOption.label;
  const label = joined.charAt(0).toUpperCase() + joined.slice(1); // 英文開頭大寫（Light blue）；中日文不受影響。
  const base = libraries.colorHues.find((item) => item.id === hue);
  const baseTone = tone ? libraries.colorTones.find((item) => item.id === tone) : null;
  return { hue, tone, label, prompt: [baseTone?.prompt, base.prompt].filter(Boolean).join(' ') };
}

// 和清單裡最接近的預設色（Lab 色差 ΔE）；離得太遠回傳 null。
export function nearestOption(hex, list, maxDelta = 15) {
  const lab = rgbToLab(Object.values(hexToRgb(hex)));
  let best = null, bestDelta = Infinity;
  for (const option of list) {
    if (!option.hex) continue;
    const delta = distance(lab, rgbToLab(Object.values(hexToRgb(option.hex))));
    if (delta < bestDelta) { best = option; bestDelta = delta; }
  }
  return bestDelta <= maxDelta ? best : null;
}

// 顏色欄位的值（預設代號或 #RRGGBB）→ { id, hex, label, prompt, custom }。
// prompt：預設色是樣式庫原本的英文（例如 amber eyes）；自訂色是「名稱 (#HEX)」，不含 hair／eyes 這類名詞。
// nearest：自訂色很接近某個預設色時用那個預設色的名字（膚色用：自然的膚色不要被叫成「淺橘」）；noun 是預設色英文裡要拿掉的名詞。
export function resolveColor(value, list, lib = libraries, { nearest = false, noun = '' } = {}) {
  if (!value) return null;
  if (isHex(value)) {
    const hex = value.toUpperCase();
    const close = nearest ? nearestOption(hex, list) : null;
    // 清單的名稱已經是目前語言（前端傳 L 的清單）；prompt 一律是樣式庫的英文原文。
    if (close) return { id: null, hex, label: close.label, prompt: `${noun ? close.prompt.replace(` ${noun}`, '') : close.prompt} (${hex})`, custom: true, near: close.id };
    const name = colorName(hex, lib);
    return { id: null, hex, label: name.label, prompt: `${name.prompt} (${hex})`, custom: true };
  }
  const option = list.find((item) => item.id === value);
  return option ? { id: option.id, hex: option.hex, label: option.label, prompt: option.prompt, custom: false } : null;
}

// ── 從圖片抓主色 ──
// data：RGBA（canvas 的 ImageData.data）。
// 1. 背景：從邊框往內漫延（漸層背景也吃得掉），碰到人物的線條就停；只從「邊框上最常見的那種顏色」出發，
//    人物貼到邊框（例如胸像下緣的衣服）時不會被當成背景。邊框顏色太雜（整張場景圖）就不去背景。
// 2. 剩下的像素用 k-means 分成十多群；種子固定，同一張圖每次結果一樣。
// 3. 挑色：先挑面積最大的，之後挑「面積夠、又和已挑的差最多」的，小面積的重點色（眼睛、滾邊）也挑得到。
// 回傳 [{ hex, share }]，依面積排序（share：佔人物的比例）。
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function seeded(seed = 7) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const rgbaAt = (data, index) => [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]];
const opaque = (data, index) => data[index * 4 + 3] >= 200;

// 背景遮罩：1 是背景（含透明）。
// 背景色看「上緣」：人物頭頂上方幾乎都是背景；胸像的下緣與兩側下半常是衣服，不能讓衣服投票變成背景。
// 左右兩邊也要看得到同一個顏色才算（頭髮貼到上緣的圖不會把頭髮當背景）；邊框大多透明的圖只去掉透明的部分。
export function backgroundMask(data, width, height) {
  const total = width * height;
  const mask = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) if (!opaque(data, index)) mask[index] = 1;
  const edges = {
    top: Array.from({ length: width }, (_, x) => x),
    bottom: Array.from({ length: width }, (_, x) => (height - 1) * width + x),
    left: Array.from({ length: height }, (_, y) => y * width),
    right: Array.from({ length: height }, (_, y) => y * width + width - 1),
  };
  const border = [...edges.top, ...edges.bottom, ...edges.left, ...edges.right];
  if (border.filter((index) => !opaque(data, index)).length >= border.length * 0.3) return mask;
  // 上緣最常見的顏色（每個色版 4 bit 分桶，取桶內平均）。
  const buckets = new Map();
  for (const index of edges.top) {
    if (!opaque(data, index)) continue;
    const [r, g, b] = rgbaAt(data, index);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = buckets.get(key) || { count: 0, sum: [0, 0, 0] };
    entry.count += 1; entry.sum[0] += r; entry.sum[1] += g; entry.sum[2] += b;
    buckets.set(key, entry);
  }
  const top = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  if (!top || top.count < width * 0.4) return mask;
  const dominant = top.sum.map((value) => value / top.count);
  const near = (index) => opaque(data, index) && distance(rgbaAt(data, index), dominant) < 26;
  if (edges.left.filter(near).length < height * 0.2 || edges.right.filter(near).length < height * 0.2) return mask;
  const queue = [];
  for (const index of border) if (near(index) && !mask[index]) { mask[index] = 1; queue.push(index); }
  while (queue.length) {
    const index = queue.pop();
    const x = index % width, y = (index - x) / width;
    const here = rgbaAt(data, index);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (mask[next]) continue;
      // 一步一步慢慢變、又和背景色差不多的才繼續漫延（漸層背景吃得掉）；碰到線條或人物的顏色就停。
      // 沒有線條的柔邊會一點一點變到衣服的顏色，所以還要限制離背景色多遠（淺灰背景和米白衣服才分得開）。
      const color = rgbaAt(data, next);
      if (distance(color, here) > 14 || distance(color, dominant) > 26) continue;
      mask[next] = 1;
      queue.push(next);
    }
  }
  return mask;
}

// sRGB → CIELAB（D65）：分群和比較顏色差異用（比 RGB 更接近人眼的感覺，奶油色和膚色才分得開）。
export function rgbToLab([r, g, b]) {
  const linear = (value) => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function extractPalette(data, width, height, { count = 6, maxSamples = 9000, seed = 7 } = {}) {
  const mask = backgroundMask(data, width, height);
  const rgb = [];
  const step = Math.max(1, Math.floor((width * height) / maxSamples));
  for (let index = 0; index < width * height; index += step) if (!mask[index]) rgb.push(rgbaAt(data, index));
  if (!rgb.length) return [];
  const lab = rgb.map(rgbToLab);
  const random = seeded(seed);
  const k = Math.min(14, lab.length);
  // k-means++（在 Lab 裡）：第一個中心隨機，之後挑離現有中心越遠的越有機會。
  const centers = [lab[Math.floor(random() * lab.length)].slice()];
  const nearest = lab.map((pixel) => distance(pixel, centers[0]) ** 2);
  while (centers.length < k) {
    const total = nearest.reduce((sum, weight) => sum + weight, 0);
    if (!total) break;
    let target = random() * total, chosen = 0;
    for (; chosen < nearest.length - 1 && target > nearest[chosen]; chosen += 1) target -= nearest[chosen];
    centers.push(lab[chosen].slice());
    lab.forEach((pixel, index) => { nearest[index] = Math.min(nearest[index], distance(pixel, centers.at(-1)) ** 2); });
  }
  const assignment = new Array(lab.length).fill(0);
  for (let round = 0; round < 14; round += 1) {
    let moved = false;
    lab.forEach((pixel, index) => {
      let best = 0, bestDistance = Infinity;
      centers.forEach((center, c) => { const d = distance(pixel, center); if (d < bestDistance) { best = c; bestDistance = d; } });
      if (assignment[index] !== best) { assignment[index] = best; moved = true; }
    });
    const sums = centers.map(() => [0, 0, 0, 0]);
    lab.forEach((pixel, index) => { const sum = sums[assignment[index]]; sum[0] += pixel[0]; sum[1] += pixel[1]; sum[2] += pixel[2]; sum[3] += 1; });
    sums.forEach((sum, c) => { if (sum[3]) centers[c] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]]; });
    if (!moved && round) break;
  }
  // 每群的代表色用成員的 RGB 平均（不用從 Lab 換回來）。
  const groups = centers.map((center) => ({ lab: center, rgb: [0, 0, 0], size: 0 }));
  assignment.forEach((c, index) => { const group = groups[c]; group.size += 1; group.rgb = group.rgb.map((value, i) => value + rgb[index][i]); });
  // 太接近的兩群合成一群（同一塊布的明暗不要佔兩個位置）。
  const merged = [];
  for (const group of groups.filter((item) => item.size).sort((a, b) => b.size - a.size)) {
    const near = merged.find((item) => distance(item.lab, group.lab) < 9);
    if (!near) { merged.push({ ...group }); continue; }
    near.lab = near.lab.map((value, i) => (value * near.size + group.lab[i] * group.size) / (near.size + group.size));
    near.rgb = near.rgb.map((value, i) => value + group.rgb[i]);
    near.size += group.size;
  }
  const candidates = merged.map((group) => ({ ...group, share: group.size / lab.length })).filter((group) => group.share >= 0.006);
  const chosen = [];
  while (chosen.length < count && candidates.length) {
    let best = -1, bestScore = -1;
    candidates.forEach((group, index) => {
      const gap = chosen.length ? Math.min(...chosen.map((item) => distance(item.lab, group.lab))) : 100;
      if (gap < 14) return;
      const score = Math.sqrt(group.share) * gap;
      if (score > bestScore) { best = index; bestScore = score; }
    });
    if (best < 0) break;
    chosen.push(candidates.splice(best, 1)[0]);
  }
  return chosen.sort((a, b) => b.share - a.share).map((group) => ({ hex: rgbToHex({ r: group.rgb[0] / group.size, g: group.rgb[1] / group.size, b: group.rgb[2] / group.size }), share: group.share }));
}
