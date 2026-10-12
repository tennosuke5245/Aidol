// 三視圖拆分：照位置框把正面、側面、背面裁成三張 PNG。
// 在瀏覽器裡做（各種圖檔格式都能讀，不必替本機核心加影像函式庫）。
// 做法：
// 1. 從圖片四周取背景色，和背景差夠多的像素算人物（前景）。
// 2. 連在一起的前景各自成一塊，判給它所在的那個人（見 assignOwners）；裁的時候把「屬於別人」的筆畫擦成背景色，
//    隔壁的人就算尾巴伸進來也不會留在這張裡；沒框到的人（例如背面另外重畫了、只框正面和側面）也一樣擦掉。
// 3. 三張用同一個高度區間（最高的頭頂到最低的腳底）和同一個寬度，腳底自然對齊；不足的地方補背景色。

const VIEW_ORDER = ['front', 'side', 'back'];

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image'));
    image.src = url;
  });
}

function backgroundColor(data, width, height) {
  // 四邊各取一圈像素，用中位數，避開剛好碰到邊的頭髮或武器。
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 60));
  const push = (x, y) => { const index = (y * width + x) * 4; samples.push([data[index], data[index + 1], data[index + 2], data[index + 3]]); };
  for (let x = 0; x < width; x += step) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += step) { push(0, y); push(width - 1, y); }
  const median = (channel) => samples.map((sample) => sample[channel]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  return [median(0), median(1), median(2), median(3)];
}

function differs(data, index, background) {
  const alpha = data[index + 3];
  if (alpha < 24) return false;
  if (background[3] < 24) return true;
  return Math.abs(data[index] - background[0]) + Math.abs(data[index + 1] - background[1]) + Math.abs(data[index + 2] - background[2]) > 48;
}

// 在框裡找人物實際的範圍（像素座標）。每列／每欄要有一定數量的前景像素才算，避免雜點把框撐大。（重畫的單張用）
function tighten(data, width, height, box, background, minArea = 0.2) {
  const margin = 0.02;
  const x0 = Math.max(0, Math.floor((box.x - margin) * width)), x1 = Math.min(width, Math.ceil((box.x + box.width + margin) * width));
  const y0 = Math.max(0, Math.floor((box.y - margin) * height)), y1 = Math.min(height, Math.ceil((box.y + box.height + margin) * height));
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const columns = new Uint32Array(x1 - x0), rows = new Uint32Array(y1 - y0);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (differs(data, (y * width + x) * 4, background)) { columns[x - x0] += 1; rows[y - y0] += 1; }
    }
  }
  const columnMin = Math.max(2, Math.round((y1 - y0) * 0.004)), rowMin = Math.max(2, Math.round((x1 - x0) * 0.004));
  let left = 0; while (left < columns.length && columns[left] < columnMin) left += 1;
  let right = columns.length - 1; while (right > left && columns[right] < columnMin) right -= 1;
  let top = 0; while (top < rows.length && rows[top] < rowMin) top += 1;
  let bottom = rows.length - 1; while (bottom > top && rows[bottom] < rowMin) bottom -= 1;
  const tight = { left: x0 + left, right: x0 + right + 1, top: y0 + top, bottom: y0 + bottom + 1 };
  // 收出來的範圍太小（多半是背景判斷失準），就不採用。
  const area = (tight.right - tight.left) * (tight.bottom - tight.top);
  if (tight.right <= tight.left || tight.bottom <= tight.top || area < minArea * box.width * width * box.height * height) return null;
  return tight;
}

const pixelBox = (box, width, height) => ({ left: Math.round(box.x * width), right: Math.round((box.x + box.width) * width), top: Math.round(box.y * height), bottom: Math.round((box.y + box.height) * height) });

/**
 * 每個像素屬於哪個人（位置框的序號；-1 是背景或不屬於任何人），以及每個人身上的「塊」（用來量人物範圍）。
 * 連在一起的前景（8 連通）是一塊：
 * - 一塊只碰到一個人的中段（框中間三成寬）就整塊給那個人——例如伸到隔壁框裡的尾巴尖，還是原本那個人的；
 * - 碰到兩個人以上的中段（兩個人黏在一起、地平線、外框）才逐點分：點在哪個框裡就給誰，都不在就給最近的框；
 * - 沒碰到任何人的中段：大半在某個框裡、或中心就在框邊上（框得太緊漏掉的髮梢），才算那個人的；
 *   否則是框外的東西（沒選的那個人、文字、雜點），標成 FOREIGN，裁的時候擦掉——例如只框正面和側面時，背面那個人的蝴蝶結伸進側面的框也不會被帶走。
 * 每個點只算一次（框重疊的地方算給中心比較近的那個框）。
 */
export const FOREIGN = -2;
export function assignOwners(mask, width, height, rects) {
  const total = width * height;
  const labels = new Int32Array(total);
  const stack = new Int32Array(total);
  const owner = new Int8Array(total).fill(-1);
  const centers = rects.map((rect) => (rect.left + rect.right) / 2);
  const bands = rects.map((rect) => (rect.right - rect.left) * 0.15);
  const boxOf = (x, y) => {
    let found = -1;
    for (let i = 0; i < rects.length; i += 1) {
      const rect = rects[i];
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue;
      if (found === -1 || Math.abs(centers[i] - x) < Math.abs(centers[found] - x)) found = i;
    }
    return found;
  };
  const distance = (rect, x, y) => Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
  const closest = (x, y) => { let best = 0; for (let i = 1; i < rects.length; i += 1) if (distance(rects[i], x, y) < distance(rects[best], x, y)) best = i; return best; };
  const near = Math.round(Math.max(width, height) * 0.03);
  const parts = [];
  let next = 0;
  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || labels[start]) continue;
    next += 1;
    const pixels = [];
    const counts = new Array(rects.length).fill(0), central = new Array(rects.length).fill(0);
    let top = 0, minX = width, maxX = -1, minY = height, maxY = -1, sumX = 0, sumY = 0;
    stack[top++] = start; labels[start] = next;
    while (top) {
      const point = stack[--top];
      const x = point % width, y = (point - x) / width;
      pixels.push(point); sumX += x; sumY += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      const box = boxOf(x, y);
      if (box !== -1) { counts[box] += 1; if (Math.abs(x - centers[box]) <= bands[box]) central[box] += 1; }
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy; if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx; if (nx < 0 || nx >= width) continue;
          const neighbor = ny * width + nx;
          if (mask[neighbor] && !labels[neighbor]) { labels[neighbor] = next; stack[top++] = neighbor; }
        }
      }
    }
    // 很小的雜點（幾個像素）不算任何人；人物邊緣的細碎反鋸齒之後會由 grow 補回來。
    if (pixels.length < 8) continue;
    const reached = central.map((count, index) => (count > 0 ? index : -1)).filter((index) => index !== -1);
    if (reached.length >= 2) {
      // 黏在一起的：逐點分，各自記一塊。
      const split = rects.map(() => ({ count: 0, minX: width, maxX: -1, minY: height, maxY: -1 }));
      for (const point of pixels) {
        const x = point % width, y = (point - x) / width;
        let target = boxOf(x, y); if (target === -1) target = closest(x, y);
        owner[point] = target;
        const part = split[target]; part.count += 1;
        if (x < part.minX) part.minX = x; if (x > part.maxX) part.maxX = x; if (y < part.minY) part.minY = y; if (y > part.maxY) part.maxY = y;
      }
      split.forEach((part, index) => { if (part.count) parts.push({ owner: index, ...part }); });
      continue;
    }
    let target = reached.length ? reached[0] : -1;
    if (target === -1) {
      const cx = sumX / pixels.length, cy = sumY / pixels.length;
      target = counts.some((count) => count > 0) ? counts.indexOf(Math.max(...counts)) : closest(cx, cy);
      const rect = rects[target];
      const centered = cx >= rect.left - near && cx <= rect.right + near && cy >= rect.top - near && cy <= rect.bottom + near;
      if (counts[target] * 2 < pixels.length && !centered) {
        for (const point of pixels) owner[point] = FOREIGN;
        continue;
      }
    }
    for (const point of pixels) owner[point] = target;
    parts.push({ owner: target, count: pixels.length, minX, maxX, minY, maxY });
  }
  return { owner, parts };
}

// 補洞：人物輪廓裡面、顏色和背景很像的地方（淡色的頭髮陰影、衣服的淺灰）不算前景，但它被誰的筆畫圍住就是誰的。
// 不補的話，擦隔壁的人只會擦掉線條，裡面淡淡的一塊還留著，看起來像殘影。
// 背景從圖片四邊往裡找（4 連通，和前景的 8 連通互補）；碰不到四邊的就是洞，給圍住它最多的那個人。
// 洞比那個人本身大很多（例如一圈細外框把整個背景圍起來）就不算，免得把背景整片判給別人。
export function fillHoles(mask, owner, width, height) {
  const total = width * height;
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  const visit = (point) => { if (!mask[point] && !seen[point]) { seen[point] = 1; queue[tail++] = point; } };
  for (let x = 0; x < width; x += 1) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const point = queue[head++];
    const x = point % width;
    if (x > 0) visit(point - 1);
    if (x < width - 1) visit(point + 1);
    if (point >= width) visit(point - width);
    if (point < total - width) visit(point + width);
  }
  const sizes = new Map();
  for (let point = 0; point < total; point += 1) if (owner[point] !== -1) sizes.set(owner[point], (sizes.get(owner[point]) || 0) + 1);
  for (let start = 0; start < total; start += 1) {
    if (mask[start] || seen[start]) continue;
    head = 0; tail = 0;
    seen[start] = 1; queue[tail++] = start;
    const around = new Map();
    const look = (point) => {
      if (mask[point]) { if (owner[point] !== -1) around.set(owner[point], (around.get(owner[point]) || 0) + 1); }
      else if (!seen[point]) { seen[point] = 1; queue[tail++] = point; }
    };
    while (head < tail) {
      const point = queue[head++];
      const x = point % width;
      if (x > 0) look(point - 1);
      if (x < width - 1) look(point + 1);
      if (point >= width) look(point - width);
      if (point < total - width) look(point + width);
    }
    let best = -1, most = 0;
    for (const [value, count] of around) if (count > most) { best = value; most = count; }
    if (best === -1 || tail > 4 * (sizes.get(best) || 0) || tail > total / 4) continue;
    for (let index = 0; index < tail; index += 1) owner[queue[index]] = best;
  }
  return owner;
}

// 每個人的範圍：他身上的塊合起來；比他最大那塊小很多的（框裡的文字、色票、雜點）不算進範圍，只是照樣留在圖上。
export function figureRects(parts, count) {
  return Array.from({ length: count }, (_, index) => {
    const own = parts.filter((part) => part.owner === index);
    if (!own.length) return null;
    const largest = Math.max(...own.map((part) => part.count));
    const kept = own.filter((part) => part.count >= largest * 0.005);
    return { left: Math.min(...kept.map((part) => part.minX)), right: Math.max(...kept.map((part) => part.maxX)) + 1, top: Math.min(...kept.map((part) => part.minY)), bottom: Math.max(...kept.map((part) => part.maxY)) + 1 };
  });
}

// 往外長三圈：人物邊緣的反鋸齒（和背景只差一點點、沒被算成前景）也算那個人的，擦隔壁的人時不會留下一圈邊。
function grow(owner, width, height, times = 3) {
  let current = owner;
  for (let pass = 0; pass < times; pass += 1) {
    const next = current.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const point = y * width + x;
        if (current[point] !== -1) continue;
        const value = (x > 0 && current[point - 1] !== -1) ? current[point - 1] : (x < width - 1 && current[point + 1] !== -1) ? current[point + 1] : (y > 0 && current[point - width] !== -1) ? current[point - width] : (y < height - 1 && current[point + width] !== -1) ? current[point + width] : -1;
        if (value !== -1) next[point] = value;
      }
    }
    current = next;
  }
  return current;
}

// 大圖先縮小再分析（最長邊 2048），裁切時再照原尺寸取圖，速度和記憶體才不會爆。
const ANALYSIS_MAX = 2048;

/**
 * boxes：[{ view, x, y, width, height }]（0–1 比例）。
 * 回傳：[{ view, crop, frame, figure, blob }]（都是原圖的 0–1 比例）：
 * crop 是從原圖實際取的範圍；frame 是裁出來那張圖對應到原圖的範圍（左右補背景色時會超出 0–1，用來把原圖上的位置換算到裁好的圖上）；
 * figure 是人物本身的範圍（用來量比例）。
 * 只擦掉「屬於別人」和框外那些東西（沒選的人、文字）的筆畫，自己的陰影、淡色的地方、背景質感都照原圖留著。
 */
export async function cropViews(url, boxes, { padding = 0.05 } = {}) {
  const image = await loadImage(url);
  const width = image.naturalWidth, height = image.naturalHeight;
  const source = document.createElement('canvas');
  source.width = width; source.height = height;
  const context = source.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, width, height).data;
  const background = backgroundColor(data, width, height);
  const chosen = boxes.filter((box) => VIEW_ORDER.includes(box.view));
  if (!chosen.length) return [];
  // 分析用的縮圖。
  const scale = Math.min(1, ANALYSIS_MAX / Math.max(width, height));
  const aw = Math.max(1, Math.round(width * scale)), ah = Math.max(1, Math.round(height * scale));
  let analysis = data;
  if (scale < 1) {
    const small = document.createElement('canvas');
    small.width = aw; small.height = ah;
    const smallContext = small.getContext('2d', { willReadFrequently: true });
    smallContext.drawImage(image, 0, 0, aw, ah);
    analysis = smallContext.getImageData(0, 0, aw, ah).data;
  }
  // 框稍微放大一點再判，AI 的框常常切到頭髮或腳尖。
  const rects = chosen.map((box) => pixelBox({ x: box.x - 0.01, y: box.y - 0.01, width: box.width + 0.02, height: box.height + 0.02 }, aw, ah));
  const mask = new Uint8Array(aw * ah);
  for (let point = 0; point < mask.length; point += 1) if (differs(analysis, point * 4, background)) mask[point] = 1;
  const { owner, parts } = assignOwners(mask, aw, ah, rects);
  const found = figureRects(parts, chosen.length);
  fillHoles(mask, owner, aw, ah);
  const figures = chosen.map((box, index) => {
    const rect = found[index];
    // 框裡一個人都沒找到（框錯了）：照框原樣裁。
    if (!rect) return { view: box.view, index, ...pixelBox(box, width, height) };
    return { view: box.view, index, left: Math.floor(rect.left / scale), right: Math.min(width, Math.ceil(rect.right / scale)), top: Math.floor(rect.top / scale), bottom: Math.min(height, Math.ceil(rect.bottom / scale)) };
  });
  // 只有一個人、框外也沒有別的東西時完全不擦。
  const grown = chosen.length > 1 || owner.includes(FOREIGN) ? grow(owner, aw, ah) : null;
  const top = Math.min(...figures.map((figure) => figure.top)), bottom = Math.max(...figures.map((figure) => figure.bottom));
  const pad = Math.round(padding * (bottom - top));
  const bandTop = Math.max(0, top - pad), bandBottom = Math.min(height, bottom + pad);
  const outWidth = Math.max(...figures.map((figure) => figure.right - figure.left)) + pad * 2, outHeight = bandBottom - bandTop;
  const results = [];
  for (const figure of figures) {
    const center = (figure.left + figure.right) / 2;
    const windowLeft = Math.round(center - outWidth / 2);
    const out = document.createElement('canvas');
    out.width = outWidth; out.height = outHeight;
    const outContext = out.getContext('2d');
    const pixels = outContext.createImageData(outWidth, outHeight);
    const target = pixels.data;
    for (let y = 0; y < outHeight; y += 1) {
      const sy = bandTop + y, ay = Math.min(ah - 1, Math.floor(sy * scale));
      for (let x = 0; x < outWidth; x += 1) {
        const sx = windowLeft + x, at = (y * outWidth + x) * 4;
        let keep = sx >= 0 && sx < width;
        if (keep && grown) { const other = grown[ay * aw + Math.min(aw - 1, Math.floor(sx * scale))]; keep = other === -1 || other === figure.index; }
        if (keep) { const from = (sy * width + sx) * 4; target[at] = data[from]; target[at + 1] = data[from + 1]; target[at + 2] = data[from + 2]; target[at + 3] = data[from + 3]; }
        else { target[at] = background[0]; target[at + 1] = background[1]; target[at + 2] = background[2]; target[at + 3] = background[3]; }
      }
    }
    outContext.putImageData(pixels, 0, 0);
    const blob = await new Promise((resolve, reject) => out.toBlob((value) => (value ? resolve(value) : reject(new Error('encode'))), 'image/png'));
    const unit = (left, right, upper, lower) => ({ x: left / width, y: upper / height, width: (right - left) / width, height: (lower - upper) / height });
    results.push({ view: figure.view, crop: unit(Math.max(0, windowLeft), Math.min(width, windowLeft + outWidth), bandTop, bandBottom), frame: unit(windowLeft, windowLeft + outWidth, bandTop, bandBottom), figure: unit(figure.left, figure.right, figure.top, figure.bottom), blob });
  }
  return VIEW_ORDER.flatMap((view) => results.filter((item) => item.view === view));
}

/**
 * 重畫的單一角度（AI 交回來的整張圖）調成和三視圖拆出來的其他張一樣：同樣的畫布大小、人物一樣高、腳底在同一個位置、左右置中。
 * target：{ width, height, figureHeight, bottom }（像素，取自正面那張）。人物太寬放不下時改成縮到放得下，腳底仍對齊。
 */
export async function normalizeView(url, target) {
  const image = await loadImage(url);
  const width = image.naturalWidth, height = image.naturalHeight;
  const source = document.createElement('canvas');
  source.width = width; source.height = height;
  const context = source.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, width, height).data;
  const background = backgroundColor(data, width, height);
  const figure = tighten(data, width, height, { x: 0, y: 0, width: 1, height: 1 }, background, 0.01) || { left: 0, right: width, top: 0, bottom: height };
  const margin = Math.round(target.width * 0.04);
  let scale = target.figureHeight / (figure.bottom - figure.top);
  if ((figure.right - figure.left) * scale > target.width - margin * 2) scale = (target.width - margin * 2) / (figure.right - figure.left);
  const out = document.createElement('canvas');
  out.width = target.width; out.height = target.height;
  const outContext = out.getContext('2d');
  outContext.fillStyle = `rgba(${background[0]}, ${background[1]}, ${background[2]}, ${background[3] / 255})`;
  outContext.fillRect(0, 0, target.width, target.height);
  outContext.imageSmoothingQuality = 'high';
  outContext.drawImage(image, target.width / 2 - ((figure.left + figure.right) / 2) * scale, target.bottom - figure.bottom * scale, width * scale, height * scale);
  return new Promise((resolve, reject) => out.toBlob((value) => (value ? resolve(value) : reject(new Error('encode'))), 'image/png'));
}

/** 正面那張的畫布大小與人物位置（像素），給 normalizeView 當目標；沒有可用的就回傳 null。 */
export async function viewTarget(items, assets) {
  const item = ['front', 'side', 'back'].map((view) => items?.[view]).find((entry) => entry?.frame && entry?.figure && !entry.redrawn);
  const asset = item && assets.find((entry) => entry.id === item.assetId);
  if (!asset) return null;
  const image = await loadImage(asset.url);
  const { frame, figure } = item;
  const top = ((figure.y - frame.y) / frame.height) * image.naturalHeight;
  const figureHeight = (figure.height / frame.height) * image.naturalHeight;
  return { width: image.naturalWidth, height: image.naturalHeight, figureHeight, bottom: top + figureHeight };
}
