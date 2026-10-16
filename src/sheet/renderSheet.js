// 設定資料集的排版與繪製（2026-10-14 起）：照 shared/model-sheet.mjs 給的內容，畫成一張 2400 寬的長圖。
// 先量一次（不畫）算出總高度，再開一張剛好的畫布畫一次；兩次用同一段排版程式，量的和畫的一定一樣。
// 圖都是本機核心給的同源圖，畫布不會被污染，可以直接輸出 PNG。

const WIDTH = 2400;
const MARGIN = 96;
const CONTENT = WIDTH - MARGIN * 2;
const GAP = 40;
const SECTION_GAP = 88;

export const SHEET_THEMES = {
  light: { paper: '#FBFAF7', ink: '#2B2A33', muted: '#6E6A76', line: '#E2DED5', tile: '#F0EDE6', accent: '#B8893A', pinText: '#FFFFFF', chip: '#EDE8DD' },
  dark: { paper: '#14172A', ink: '#ECEAF4', muted: '#A3A1B6', line: '#2E3352', tile: '#1D2140', accent: '#D8B26A', pinText: '#14172A', chip: '#252A4A' },
};

// 斷行：中日文一個字一個字斷，英文照空白斷；行首不放句讀（，。、）」等），放不下的長英文字硬斷。
const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F\u3040-\u30FF\uAC00-\uD7AF]/;
const NO_LINE_START = new Set(`${String.fromCodePoint(0xFF0C, 0x3002, 0x3001, 0xFF01, 0xFF1F, 0xFF1A, 0xFF1B, 0xFF09, 0x300D, 0x300F, 0x300B, 0x3009, 0x3011, 0x2026, 0x30FC, 0x301C)},.!?:;)]}`);
function tokens(text) {
  const out = [];
  let word = '';
  for (const char of text) {
    if (/\s/.test(char)) { if (word) out.push(word); word = ''; out.push(' '); }
    else if (CJK.test(char)) { if (word) out.push(word); word = ''; out.push(char); }
    else word += char;
  }
  if (word) out.push(word);
  return out;
}
export function wrapText(context, text, maxWidth, maxLines = Infinity) {
  const lines = [];
  const width = value => context.measureText(value).width;
  for (const paragraph of String(text || '').split('\n')) {
    let line = '';
    // 放到新的一行；一個字就超過一行（很長的英文或網址）時，一個字元一個字元塞。
    const start = token => {
      if (width(token) <= maxWidth) { line = token; return; }
      let piece = '';
      for (const char of token) { if (piece && width(piece + char) > maxWidth) { lines.push(piece); piece = ''; } piece += char; }
      line = piece;
    };
    for (const token of tokens(paragraph)) {
      if (!line) { if (token !== ' ') start(token); continue; }
      const next = line + token;
      // 句讀不放行首：放不下時掛在行尾（只有一兩個字元的句讀才掛，不會整串超出去）。
      if (width(next) <= maxWidth || (NO_LINE_START.has(token[0]) && Array.from(token).length <= 2)) line = next;
      else { lines.push(line.trimEnd()); if (token !== ' ') start(token); }
    }
    lines.push(line.trimEnd());
  }
  while (lines.length > 1 && !lines.at(-1)) lines.pop();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = Array.from(kept.at(-1));
    while (last.length && width(`${last.join('')}…`) > maxWidth) last.pop();
    kept[kept.length - 1] = `${last.join('')}…`;
    return kept;
  }
  return lines;
}

const fit = (width, height, boxWidth, boxHeight) => { const scale = Math.min(boxWidth / width, boxHeight / height); return { width: width * scale, height: height * scale }; };

// 一段排版：draw 為 false 時只量高度。回傳這段用掉的高度。
function layout(context, spec, images, fonts, theme, draw) {
  const font = (weight, size, family = fonts.ui) => { context.font = `${weight} ${size}px ${family}`; };
  const text = (value, x, y, { color = theme.ink, align = 'left' } = {}) => { if (draw) { context.fillStyle = color; context.textAlign = align; context.fillText(value, x, y); } };
  const lines = (list, x, y, lineHeight, options) => { list.forEach((line, index) => text(line, x, y + index * lineHeight, options)); return list.length * lineHeight; };
  const rect = (x, y, width, height, color, radius = 0) => {
    if (!draw) return;
    context.fillStyle = color;
    if (radius) { context.beginPath(); context.roundRect(x, y, width, height, radius); context.fill(); } else context.fillRect(x, y, width, height);
  };
  const image = (url, x, y, width, height, crop = null) => {
    const source = images.get(url);
    if (!source) return;
    const sx = crop ? crop.x * source.naturalWidth : 0, sy = crop ? crop.y * source.naturalHeight : 0;
    const sw = crop ? crop.width * source.naturalWidth : source.naturalWidth, sh = crop ? crop.height * source.naturalHeight : source.naturalHeight;
    const size = fit(sw, sh, width, height);
    if (draw) context.drawImage(source, sx, sy, sw, sh, x + (width - size.width) / 2, y + (height - size.height) / 2, size.width, size.height);
    return { x: x + (width - size.width) / 2, y: y + (height - size.height) / 2, ...size };
  };
  const sectionTitle = (title, y) => {
    font(700, 44, fonts.display);
    text(title, MARGIN, y + 44);
    rect(MARGIN, y + 70, CONTENT, 2, theme.line);
    return 100;
  };
  context.textBaseline = 'alphabetic';
  let y = MARGIN;

  // 標題、副標、日期。
  font(700, 84, fonts.display);
  const titleLines = wrapText(context, spec.title, CONTENT - 360, 2);
  y += lines(titleLines, MARGIN, y + 84, 104);
  if (spec.date) { font(500, 26); text(spec.date, WIDTH - MARGIN, MARGIN + 40, { color: theme.muted, align: 'right' }); }
  if (spec.subtitle) {
    font(500, 34);
    y += 12 + lines(wrapText(context, spec.subtitle, CONTENT, 3), MARGIN, y + 46, 52, { color: theme.muted });
  }
  rect(MARGIN, y + 28, 120, 6, theme.accent, 3);
  y += 28 + SECTION_GAP;

  for (const section of spec.sections) {
    const top = y;
    if (section.kind === 'overview') {
      const hasImage = section.image && images.get(section.image.url);
      const imageWidth = hasImage ? Math.round(CONTENT * 0.42) : 0;
      let imageHeight = 0;
      if (hasImage) {
        const source = images.get(section.image.url);
        const size = fit(source.naturalWidth, source.naturalHeight, imageWidth, 1500);
        imageHeight = size.height;
        rect(MARGIN, y, imageWidth, imageHeight, theme.tile, 18);
        image(section.image.url, MARGIN, y, imageWidth, imageHeight);
      }
      let textHeight = 0;
      if (section.profile) {
        const x = MARGIN + (hasImage ? imageWidth + 72 : 0);
        const width = CONTENT - (hasImage ? imageWidth + 72 : 0);
        let ty = y;
        font(700, 44, fonts.display);
        text(section.profile.title, x, ty + 44);
        rect(x, ty + 70, width, 2, theme.line);
        ty += 100;
        const labelWidth = 200;
        for (const row of section.profile.rows) {
          font(600, 28);
          text(row.label, x, ty + 36, { color: theme.muted });
          font(500, 32);
          ty += Math.max(52, lines(wrapText(context, row.value, width - labelWidth), x + labelWidth, ty + 36, 48)) + 14;
        }
        if (section.profile.traits.length) {
          ty += 16;
          font(600, 28);
          let cx = x;
          for (const trait of section.profile.traits) {
            // 很長的個性（一整句）：一個膠囊最多一行寬，放不下的用刪節號。
            const label = wrapText(context, trait, width - 44, 1)[0] || '';
            const chipWidth = context.measureText(label).width + 44;
            if (cx > x && cx + chipWidth > x + width) { cx = x; ty += 64; }
            rect(cx, ty, chipWidth, 52, theme.chip, 26);
            text(label, cx + 22, ty + 36);
            cx += chipWidth + 14;
          }
          ty += 80;
        }
        if (section.profile.description) {
          font(400, 31);
          ty += 10 + lines(wrapText(context, section.profile.description, width), x, ty + 40, 52);
          ty += 16;
        }
        if (section.profile.locks.length) {
          ty += 20;
          font(700, 30);
          text(section.profile.locksLabel, x, ty + 34, { color: theme.accent });
          ty += 52;
          font(500, 30);
          for (const lock of section.profile.locks) {
            rect(x + 4, ty + 20, 12, 12, theme.accent, 6);
            ty += lines(wrapText(context, lock, width - 36), x + 36, ty + 34, 46) + 8;
          }
        }
        textHeight = ty - y;
      }
      y += Math.max(imageHeight, textHeight);
    } else if (section.kind === 'strip') {
      y += sectionTitle(section.title, y);
      const ready = section.items.map(item => ({ ...item, source: images.get(item.url) })).filter(item => item.source);
      // 每個角度一樣高（裁切時已經照人物範圍切，同高就是頭頂腳底對齊）；太寬就整排縮小。
      let height = 980;
      const ratioSum = ready.reduce((sum, item) => sum + item.source.naturalWidth / item.source.naturalHeight, 0);
      const totalWidth = ratioSum * height + GAP * 1.5 * Math.max(0, ready.length - 1);
      if (totalWidth > CONTENT) height = (CONTENT - GAP * 1.5 * Math.max(0, ready.length - 1)) / ratioSum;
      const rowWidth = ratioSum * height + GAP * 1.5 * Math.max(0, ready.length - 1);
      let x = MARGIN + (CONTENT - rowWidth) / 2;
      for (const item of ready) {
        const width = item.source.naturalWidth / item.source.naturalHeight * height;
        image(item.url, x, y, width, height);
        if (draw) for (const pin of item.pins) {
          const px = x + pin.x * width, py = y + pin.y * height;
          context.beginPath(); context.arc(px, py, 24, 0, Math.PI * 2); context.fillStyle = theme.accent; context.fill();
          context.lineWidth = 4; context.strokeStyle = theme.paper; context.stroke();
          font(700, 24); text(String(pin.number), px, py + 9, { color: theme.pinText, align: 'center' });
        }
        font(600, 30);
        text(item.label, x + width / 2, y + height + 50, { align: 'center' });
        x += width + GAP * 1.5;
      }
      y += height + 76;
      if (section.notes.length) {
        y += 24;
        font(700, 32);
        text(section.notesTitle, MARGIN, y + 36, { color: theme.muted });
        y += 60;
        for (const note of section.notes) {
          if (draw) { context.beginPath(); context.arc(MARGIN + 22, y + 24, 22, 0, Math.PI * 2); context.fillStyle = theme.accent; context.fill(); }
          font(700, 22); text(String(note.number), MARGIN + 22, y + 32, { color: theme.pinText, align: 'center' });
          font(700, 30);
          let used = lines(wrapText(context, note.heading, CONTENT - 64, 2), MARGIN + 64, y + 34, 44);
          if (note.text) { font(400, 29); used += lines(wrapText(context, note.text, CONTENT - 64, 10), MARGIN + 64, y + 34 + used, 44); }
          y += Math.max(52, used) + 18;
        }
      }
    } else if (section.kind === 'grid') {
      y += sectionTitle(section.title, y);
      // 表情一排最多 6 個（預設 6 個剛好一排）、衣櫃一排最多 5 套；格子照一排的數量放大縮小。
      const columns = Math.max(1, Math.min(section.shape === 'bust' ? 6 : 5, section.items.length));
      const cellWidth = Math.min(section.shape === 'bust' ? 400 : 420, (CONTENT - GAP * (columns - 1)) / columns);
      const cell = { width: cellWidth, height: section.shape === 'bust' ? cellWidth : Math.round(cellWidth * 1.8) };
      const rowWidth = Math.min(section.items.length, columns) * (cell.width + GAP) - GAP;
      const startX = MARGIN + (CONTENT - rowWidth) / 2;
      section.items.forEach((item, index) => {
        const column = index % columns, row = Math.floor(index / columns);
        const x = startX + column * (cell.width + GAP), cy = y + row * (cell.height + 96);
        rect(x, cy, cell.width, cell.height, theme.tile, 16);
        image(item.url, x + 12, cy + 12, cell.width - 24, cell.height - 24);
        font(600, 28);
        const label = wrapText(context, item.label, cell.width - (item.badge ? 110 : 0), 1)[0] || '';
        const labelWidth = context.measureText(label).width;
        font(700, 22);
        const badgeWidth = item.badge ? context.measureText(item.badge).width + 26 : 0;
        const lx = x + (cell.width - labelWidth - (badgeWidth ? badgeWidth + 14 : 0)) / 2;
        font(600, 28);
        text(label, lx, cy + cell.height + 44);
        if (item.badge) {
          rect(lx + labelWidth + 14, cy + cell.height + 16, badgeWidth, 38, theme.accent, 19);
          font(700, 22);
          text(item.badge, lx + labelWidth + 14 + badgeWidth / 2, cy + cell.height + 43, { color: theme.pinText, align: 'center' });
        }
      });
      y += Math.ceil(section.items.length / columns) * (cell.height + 96) - 30;
    } else if (section.kind === 'cards') {
      y += sectionTitle(section.title, y);
      const columns = 3;
      const width = (CONTENT - GAP * (columns - 1)) / columns;
      const imageHeight = 420;
      let rowTop = y, rowHeight = 0;
      section.items.forEach((item, index) => {
        const column = index % columns;
        if (column === 0 && index > 0) { rowTop += rowHeight + GAP; rowHeight = 0; }
        const x = MARGIN + column * (width + GAP);
        let cy = rowTop;
        // 沒有圖（只有文字的排在最後）：不畫空格子。
        if (item.url && images.get(item.url)) {
          rect(x, cy, width, imageHeight, theme.tile, 16);
          image(item.url, x + 16, cy + 16, width - 32, imageHeight - 32, item.crop);
          cy += imageHeight + 22;
        }
        font(700, 32);
        cy += lines(wrapText(context, item.label, width, 2), x, cy + 34, 44);
        if (item.text) { font(400, 27); cy += 8 + lines(wrapText(context, item.text, width, 16), x, cy + 40, 42, { color: theme.muted }); }
        rowHeight = Math.max(rowHeight, cy - rowTop);
      });
      y = rowTop + rowHeight;
    } else if (section.kind === 'swatches') {
      y += sectionTitle(section.title, y);
      const width = 236, height = 150;
      const columns = Math.max(1, Math.floor((CONTENT + GAP) / (width + GAP)));
      section.items.forEach((item, index) => {
        const column = index % columns, row = Math.floor(index / columns);
        const x = MARGIN + column * (width + GAP), cy = y + row * (height + 150);
        rect(x, cy, width, height, item.hex, 18);
        if (draw) { context.lineWidth = 2; context.strokeStyle = theme.line; context.beginPath(); context.roundRect(x, cy, width, height, 18); context.stroke(); }
        font(700, 28);
        text(wrapText(context, item.name, width, 1)[0] || '', x, cy + height + 42);
        font(500, 24);
        text(item.meta, x, cy + height + 80, { color: theme.muted });
      });
      y += Math.ceil(section.items.length / columns) * (height + 150) - 40;
    }
    if (y > top) y += SECTION_GAP;
  }
  return y - SECTION_GAP + MARGIN;
}

// 把會用到的字先載好（字型照 unicode 範圍分檔，畫布不會自己去載）。
async function loadFonts(spec, fonts) {
  if (!document.fonts?.load) return;
  const all = [spec.title, spec.subtitle, spec.date || ''];
  for (const section of spec.sections) {
    all.push(section.title || '', section.notesTitle || '');
    if (section.profile) all.push(section.profile.title, section.profile.locksLabel, section.profile.description, ...section.profile.traits, ...section.profile.locks, ...section.profile.rows.flatMap(row => [row.label, row.value]));
    for (const item of section.items || []) all.push(item.label || '', item.text || '', item.badge || '', item.name || '', item.meta || '');
    for (const note of section.notes || []) all.push(note.heading, note.text);
  }
  const sample = `${all.join(' ')}0123456789${String.fromCodePoint(0xFF08, 0xFF09, 0x30FB, 0x2026)}`;
  await Promise.all([400, 500, 600, 700].flatMap(weight => [document.fonts.load(`${weight} 32px ${fonts.ui}`, sample), document.fonts.load(`${weight} 32px ${fonts.display}`, sample)]).map(promise => promise.catch(() => null)));
  await document.fonts.ready;
}

// cache：同一個對話框裡重排時不用再解一次圖（圖的網址對應一張不會變的圖）；讀不到的不記，下次再試。
async function loadImages(spec, cache) {
  const urls = new Set();
  for (const section of spec.sections) {
    if (section.image?.url) urls.add(section.image.url);
    for (const item of section.items || []) if (item.url) urls.add(item.url);
  }
  const entries = await Promise.all([...urls].map(async url => {
    if (cache?.has(url)) return [url, cache.get(url)];
    try { const image = new Image(); image.src = url; await image.decode(); cache?.set(url, image); return [url, image]; } catch { return [url, null]; }
  }));
  return new Map(entries.filter(([, image]) => image && image.naturalWidth));
}

// 瀏覽器的畫布最高三萬多像素；超過就整張等比例縮小（內容一樣都不少），canvas.dataset.scale 記縮小的比例。
const MAX_HEIGHT = 32000;
export async function renderSheet(spec, { theme: themeName = 'light', cache } = {}) {
  const theme = SHEET_THEMES[themeName] || SHEET_THEMES.light;
  const style = getComputedStyle(document.documentElement);
  const fonts = { ui: style.getPropertyValue('--font-ui').trim() || 'sans-serif', display: style.getPropertyValue('--font-display').trim() || 'serif' };
  const [images] = await Promise.all([loadImages(spec, cache), loadFonts(spec, fonts)]);
  const measure = document.createElement('canvas').getContext('2d');
  const height = Math.ceil(layout(measure, spec, images, fonts, theme, false));
  const scale = Math.min(1, MAX_HEIGHT / height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(WIDTH * scale);
  canvas.height = Math.min(MAX_HEIGHT, Math.ceil(height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = theme.paper;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  layout(context, spec, images, fonts, theme, true);
  canvas.dataset.scale = String(scale);
  return canvas;
}

export async function downloadCanvas(canvas, fileName) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
