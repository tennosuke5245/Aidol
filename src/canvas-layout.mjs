// 畫布排版：裝備節點排在人物節點左右兩側，高度對齊它在立繪上的位置（像設定集的引出線）。
// 2026-10-07 起每個節點的位置一旦排好就固定：拖一個節點不會讓其他節點重排；
// 新拆出的裝備只找空位放，不推開既有節點；只有按「整理」才全部重排。

export const characterNodeSize = { width: 420, height: 700 };
export const characterArtBox = { x: 14, y: 14, width: 392, height: 560 };
export const partNodeSize = { width: 216, height: 268 };
const columnGap = 96;
const columnStep = partNodeSize.width + 28;
const margin = 18;
const portGap = 14;
const kindOrder = { hair: 0, accessory: 1, garment: 2, weapon: 3, other: 4, body: 5, footwear: 6 };

function centerY(crop) { return crop.y + crop.height / 2; }
function centerX(crop) { return crop.x + crop.width / 2; }
const partRect = position => ({ x: position.x, y: position.y, width: partNodeSize.width, height: partNodeSize.height });
const intersects = (a, b) => a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;

/** object-fit: contain 時，圖片在框內實際顯示的位置與大小。 */
export function containBox(boxWidth, boxHeight, naturalWidth, naturalHeight) {
  if (!naturalWidth || !naturalHeight || !boxWidth || !boxHeight) return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  const ratio = naturalWidth / naturalHeight;
  if (boxWidth / boxHeight > ratio) { const width = boxHeight * ratio; return { x: (boxWidth - width) / 2, y: 0, width, height: boxHeight }; }
  const height = boxWidth / ratio;
  return { x: 0, y: (boxHeight - height) / 2, width: boxWidth, height };
}

/** 正式立繪在人物節點裡實際顯示的範圍（節點座標）；還不知道圖片尺寸時是整個圖區。 */
export function portraitBox(naturalWidth, naturalHeight) {
  if (!naturalWidth || !naturalHeight) return { ...characterArtBox };
  const inner = containBox(characterArtBox.width, characterArtBox.height, naturalWidth, naturalHeight);
  return { x: characterArtBox.x + inner.x, y: characterArtBox.y + inner.y, width: inner.width, height: inner.height };
}

/** 人物左（left）或右（right）側第 index 欄裝備的 x。 */
export function columnX(origin, side, index = 0) {
  return side === 'left'
    ? origin.x - columnGap - partNodeSize.width - index * columnStep
    : origin.x + characterNodeSize.width + columnGap + index * columnStep;
}

// 在 x 這一欄裡，找離理想高度最近、不會壓到任何既有矩形的位置。
function freeTop(x, want, rects) {
  const { width, height } = partNodeSize;
  const blocked = rects.filter(rect => x < rect.x + rect.width + margin && x + width + margin > rect.x)
    .map(rect => [rect.y - height - margin, rect.y + rect.height + margin]);
  const free = y => blocked.every(([top, bottom]) => y <= top || y >= bottom);
  if (free(want)) return want;
  let best = null;
  for (const range of blocked) for (const y of range) if (free(y) && (best === null || Math.abs(y - want) < Math.abs(best - want))) best = y;
  return best ?? want;
}

/**
 * 把還沒有位置的裝備放到人物兩側，高度盡量對齊它在立繪上的位置。
 * - 沒有任何既有裝備時（第一次排或按「整理」）：每一側依高度順序疊起來，整欄的平均位置對齊想要的高度，順序不會交錯；一側超過 4 件分成兩欄。
 * - 已經有裝備在畫布上時（新拆出、新增）：不移動任何既有節點，只找離想要的高度最近的空位，內側欄太遠才放外側欄。
 * @param {{x:number,y:number}} origin 人物節點左上角
 * @param {Array<{id:string, kind?:string, crop?:{x:number,y:number,width:number,height:number}|null}>} parts 要放的裝備（crop 只放屬於目前立繪的）
 * @param {{placed?: Array<{id:string,x:number,y:number,crop?:object|null}>, obstacles?: Array<{x:number,y:number,width:number,height:number}>, imageBox?: {x:number,y:number,width:number,height:number}|null}} options
 *   placed：已在畫布上的裝備（用來平衡兩側並避開）；obstacles：其他要避開的節點（便利貼、參考圖…）；imageBox：立繪實際顯示範圍
 * @returns {Record<string,{x:number,y:number}>}
 */
export function placeParts(origin, parts, { placed = [], obstacles = [], imageBox = null } = {}) {
  const box = imageBox || characterArtBox;
  const center = origin.x + characterNodeSize.width / 2;
  const sideOf = position => position.x + partNodeSize.width / 2 < center ? 'left' : 'right';
  const count = { left: 0, right: 0 };
  for (const item of placed) count[sideOf(item)]++;
  // 以所有位置框的中線為準（設定稿常把正面放在左半邊），明顯偏一側的放那一側。
  const centers = [...placed, ...parts].filter(item => item.crop).map(item => centerX(item.crop)).sort((a, b) => a - b);
  const mid = centers.length ? centers[Math.floor(centers.length / 2)] : 0.5;
  const want = part => (part.crop ? origin.y + box.y + centerY(part.crop) * box.height : origin.y + box.y + partNodeSize.height / 2) - partNodeSize.height / 2;
  const cropped = parts.filter(part => part.crop).sort((a, b) => Math.abs(centerX(b.crop) - mid) - Math.abs(centerX(a.crop) - mid));
  const loose = parts.filter(part => !part.crop).sort((a, b) => (kindOrder[a.kind] ?? 4) - (kindOrder[b.kind] ?? 4));
  const sides = { left: [], right: [] };
  for (const part of [...cropped, ...loose]) {
    let side = count.left <= count.right ? 'left' : 'right';
    if (part.crop) { const offset = centerX(part.crop) - mid; if (Math.abs(offset) > 0.08) side = offset < 0 ? 'left' : 'right'; }
    const other = side === 'left' ? 'right' : 'left';
    if (count[side] - count[other] >= 2) side = other;
    count[side]++;
    sides[side].push(part);
  }
  const rects = [{ x: origin.x, y: origin.y, width: characterNodeSize.width, height: characterNodeSize.height }, ...placed.map(partRect), ...obstacles];
  const positions = {};
  const put = (part, position) => { positions[part.id] = { x: Math.round(position.x), y: Math.round(position.y) }; rects.push(partRect(positions[part.id])); };
  for (const side of ['left', 'right']) {
    const group = sides[side].sort((a, b) => want(a) - want(b) || a.id.localeCompare(b.id));
    if (!placed.length) {
      const columns = group.length > 4 ? [group.filter((_, i) => i % 2 === 0), group.filter((_, i) => i % 2 === 1)] : [group];
      columns.forEach((column, index) => {
        const x = columnX(origin, side, index);
        let next = -Infinity;
        const stacked = column.map(part => { const y = Math.max(want(part), next); next = y + partNodeSize.height + margin; return { part, y }; });
        const shift = stacked.length ? stacked.reduce((sum, entry) => sum + want(entry.part) - entry.y, 0) / stacked.length : 0;
        const offset = stacked.length ? Math.max(origin.y - partNodeSize.height / 2 - stacked[0].y, Math.min(0, shift)) : 0;
        for (const entry of stacked) {
          const position = { x, y: entry.y + offset };
          put(entry.part, rects.some(rect => intersects(partRect(position), rect)) ? { x, y: freeTop(x, position.y, rects) } : position);
        }
      });
      continue;
    }
    for (const part of group) {
      let best = null;
      for (let column = 0; column < 4; column++) {
        const x = columnX(origin, side, column);
        const y = freeTop(x, want(part), rects);
        const cost = Math.abs(y - want(part)) + column * partNodeSize.height * 0.9;
        if (!best || cost < best.cost) best = { x, y, cost };
      }
      put(part, best);
    }
  }
  return positions;
}

/** 相容舊呼叫：saved 裡已有位置的裝備不動，其餘用 placeParts 找空位。 */
export function layoutParts(origin, parts, saved = {}, imageBox = null) {
  const placed = parts.filter(part => saved[part.id]).map(part => ({ id: part.id, ...saved[part.id], crop: part.crop }));
  return placeParts(origin, parts.filter(part => !saved[part.id]), { placed, imageBox });
}

/**
 * 人物節點邊框上的接點：裝備在人物左邊就從左邊框出線，在右邊就從右邊框；立繪上不放接點。
 * 接點高度跟著裝備節點的中線（限制在圖區內），同一側依上下順序排、至少相隔 14px，所以線不會交錯。
 * @param {{x:number,y:number}} origin 人物節點左上角
 * @param {Array<{id:string,x:number,y:number}>} parts 裝備節點目前的位置
 * @returns {Record<string,{side:'left'|'right', offset:number}>} offset 是從人物節點頂端算起的高度
 */
export function layoutPorts(origin, parts) {
  const center = origin.x + characterNodeSize.width / 2;
  const top = characterArtBox.y + 12, bottom = characterArtBox.y + characterArtBox.height - 12;
  const ports = parts.map(part => {
    const side = part.x + partNodeSize.width / 2 < center ? 'left' : 'right';
    const middle = part.y + partNodeSize.height / 2 - origin.y;
    return { id: part.id, side, middle, offset: Math.min(bottom, Math.max(top, middle)) };
  });
  for (const side of ['left', 'right']) {
    const group = ports.filter(port => port.side === side).sort((a, b) => a.middle - b.middle || a.id.localeCompare(b.id));
    for (let index = 1; index < group.length; index++) group[index].offset = Math.max(group[index].offset, group[index - 1].offset + portGap);
    if (group.length && group.at(-1).offset > bottom) {
      group.at(-1).offset = Math.max(bottom, top + (group.length - 1) * portGap);
      for (let index = group.length - 2; index >= 0; index--) group[index].offset = Math.min(group[index].offset, group[index + 1].offset - portGap);
    }
  }
  return Object.fromEntries(ports.map(port => [port.id, { side: port.side, offset: Math.round(port.offset) }]));
}

/**
 * 從整張圖裁出一個區塊顯示在固定比例的框裡（cover，四周留一點空間）。回傳 <img> 的百分比樣式。
 * crop 是 0–1 比例；aspect 是框的寬高比。
 */
export function cropStyle(crop, naturalWidth, naturalHeight, aspect = 1, padding = 0.18) {
  if (!naturalWidth || !naturalHeight) return null;
  let cw = crop.width * naturalWidth * (1 + padding);
  let ch = crop.height * naturalHeight * (1 + padding);
  if (cw / ch < aspect) cw = ch * aspect; else ch = cw / aspect;
  let cx = centerX(crop) * naturalWidth;
  let cy = centerY(crop) * naturalHeight;
  if (cw <= naturalWidth) cx = Math.min(naturalWidth - cw / 2, Math.max(cw / 2, cx));
  if (ch <= naturalHeight) cy = Math.min(naturalHeight - ch / 2, Math.max(ch / 2, cy));
  return {
    width: `${(naturalWidth / cw) * 100}%`,
    left: `${(-(cx - cw / 2) / cw) * 100}%`,
    top: `${(-(cy - ch / 2) / ch) * 100}%`,
  };
}
