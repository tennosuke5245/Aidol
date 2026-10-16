// 設定資料集（2026-10-14 起）：把一個角色的正式立繪、設定文字、三視圖（含標註）、表情集、衣櫃、裝備、配色表
// 排成一張可以直接交給客戶的長圖。這裡只決定「放什麼、順序、文字」，不碰畫布（前端用 canvas 畫，測試直接驗這份內容）。
// lib：目前語言的樣式庫（前端傳 L）；labels：介面文字（欄位名、區塊標題；heterochromia、noteHeading 是函式），由呼叫的地方依目前語言給。
import { allViews } from './domain.mjs';
import { expressionInfo, expressionList, expressionStale } from './expressions.mjs';
import { mainOutfitId, outfitPortrait } from './wardrobe.mjs';
import { isHex, resolveColor } from './colors.mjs';
import * as libraries from './libraries.mjs';

export const SHEET_SECTIONS = ['portrait', 'profile', 'turnaround', 'expressions', 'outfits', 'gear', 'palette'];
// 裝備區不放身體、頭髮（它們是角色本身，設定文字已經寫了）。
const GEAR_KINDS = new Set(['garment', 'accessory', 'weapon', 'footwear', 'other']);

const assetOf = (project, id) => (id ? (project.assets || []).find((asset) => asset.id === id) || null : null);
const labelOf = (list, id) => (id ? (list || []).find((option) => option.id === id)?.label || '' : '');
const labelsOf = (list, ids) => (ids || []).map((id) => labelOf(list, id)).filter(Boolean);
const colorLabel = (value, list, lib, options) => resolveColor(value, list || [], lib, options)?.label || '';

// 三視圖：拆好、而且是照目前的正式立繪拆的；正面以外至少還有一個角度才放（只有正面就和正式立繪重複了）。
function turnaroundItems(project) {
  const views = project.views;
  const main = project.character?.adopted?.character;
  if (!(views?.status === 'done' && views.assetId === main)) return [];
  const items = allViews.map((view) => ({ view, asset: assetOf(project, views.items?.[view]?.assetId) })).filter((item) => item.asset);
  return items.length >= 2 ? items : [];
}

// 衣櫃：有立繪的套裝（主要那套就是正式立繪）；只有主要那套有圖時不放（和正式立繪重複）。
function outfitItems(project) {
  const outfits = project.character?.outfits || {};
  const main = mainOutfitId(project);
  const items = Object.values(outfits).map((outfit) => ({ outfit, asset: outfitPortrait(project, outfit.id), main: outfit.id === main })).filter((item) => item.asset);
  return items.length >= 2 ? items : [];
}

// 表情集：畫好的表情（名稱查不到的不放：已經不在這套表情裡）。
function expressionItems(project, lib) {
  return expressionList(project.expressions).map((key) => ({ key, info: expressionInfo(project.expressions, key, lib), asset: assetOf(project, project.expressions?.items?.[key]?.assetId) })).filter((item) => item.asset && item.info);
}

// 裝備：有設計圖用設計圖；沒有但拆解時記了在立繪上的位置，就從那張圖裁一塊；都沒有就只列文字（排在有圖的後面）。
function gearItems(project) {
  const items = Object.values(project.character?.components || {}).filter((part) => GEAR_KINDS.has(part.kind)).map((part) => {
    const design = assetOf(project, part.assetId);
    const source = !design && part.crop ? assetOf(project, part.crop.assetId) : null;
    return { part, asset: design || source, crop: !design && source ? { x: part.crop.x, y: part.crop.y, width: part.crop.width, height: part.crop.height } : null };
  });
  return [...items.filter((item) => item.asset), ...items.filter((item) => !item.asset)];
}

// 設定區有沒有東西可寫（只算有沒有，不需要目前語言的文字）。
const COUNT_LABELS = { separator: ' ', heterochromia: () => '-', featureColor: () => '-' };
function hasProfile(character, lib) {
  return Boolean(profileRows(character, lib, COUNT_LABELS).length || (character.persona?.traits || []).some(Boolean) || (character.persona?.description || '').trim() || (character.locks || []).some(Boolean));
}

// 有內容可放的區塊（對話框用來決定哪些可以勾）。count：大概有幾樣。lib：目前語言的樣式庫（沒給用繁中原文）。
export function sheetAvailability(project, lib = libraries) {
  const character = project.character || {};
  return {
    portrait: assetOf(project, character.adopted?.character) ? 1 : 0,
    profile: hasProfile(character, lib) ? 1 : 0,
    turnaround: turnaroundItems(project).length,
    expressions: expressionItems(project, lib).length,
    outfits: outfitItems(project).length,
    gear: gearItems(project).length,
    palette: (character.palette || []).length,
  };
}

// 種族：種族名（人類、其他不寫）＋耳朵、角、尾巴、翅膀、特徵＋特徵色。和交給 AI 的文字一樣，
// 耳朵、翅膀這些不管選了哪個種族都算（人類也可以有翅膀）。
const SPECIES_SLOTS = [['ears', 'earTypes'], ['horns', 'hornTypes'], ['tail', 'tailTypes'], ['wings', 'wingTypes']];
function speciesText(species, lib, labels, join) {
  const kind = species.kind && !['human', 'other'].includes(species.kind) ? labelOf(lib.speciesKinds, species.kind) : '';
  const features = SPECIES_SLOTS.map(([key, list]) => (lib[list] || []).find((option) => option.id === species[key])).filter((option) => option?.prompt).map((option) => option.label);
  const extras = labelsOf(lib.speciesExtras, species.extras);
  const color = isHex(species.color) && (features.length || extras.length) ? labels.featureColor(colorLabel(species.color, [], lib)) : '';
  return join([kind, ...features, ...extras, color]);
}

// 設定文字：種族、身形、髮、眼、臉，照目前語言的名稱；沒設定的欄位不列。
export function profileRows(character, lib, labels) {
  const dna = character?.dna || {};
  const rows = [];
  const push = (label, value) => { if (value) rows.push({ label, value }); };
  const join = (values) => values.filter(Boolean).join(labels.separator);
  push(labels.species, speciesText(dna.species || {}, lib, labels, join));
  const body = dna.body || {};
  push(labels.body, join([labelOf(lib.ages, body.age), labelOf(lib.headRatios, body.headRatio), labelOf(lib.heights, body.height), labelOf(lib.builds, body.build)]));
  push(labels.skin, colorLabel(body.skin, lib.skinTones, lib, { nearest: true }));
  const hair = dna.hair || {};
  // 挑染方式沒記（舊資料、AI 填的）就是挑染。
  const accent = hair.accent ? join([labelOf(lib.hairDyeStyles, hair.accentStyle || 'streak'), colorLabel(hair.accent, lib.hairColors, lib)]) : '';
  push(labels.hair, join([labelOf(lib.hairStyles, hair.style), colorLabel(hair.color, lib.hairColors, lib), accent, ...labelsOf(lib.hairExtras, hair.extras)]) || character?.identity?.hair || '');
  const face = dna.face || {};
  // 右眼沒選色、只有左眼：和交給 AI 的一樣，當成兩眼同色。
  const right = colorLabel(face.eyeColor || face.eyeColorLeft, lib.eyeColors, lib);
  const left = face.eyeColor && face.eyeColorLeft ? colorLabel(face.eyeColorLeft, lib.eyeColors, lib) : '';
  const eyes = left && left !== right ? labels.heterochromia(right, left) : right;
  push(labels.eyes, join([eyes, labelOf(lib.eyeShapes, face.eyeShape), face.pupil && face.pupil !== 'round' ? labelOf(lib.pupils, face.pupil) : '']) || character?.identity?.eyes || '');
  push(labels.face, join([labelOf(lib.faceShapes, face.shape), labelOf(lib.moods, face.mood), ...labelsOf(lib.faceMarks, face.marks)]));
  return rows;
}

// 一張設定資料集的內容。options.sections：要放的區塊（Set 或陣列）；title／subtitle：自訂標題與副標。
export function buildSheet(project, options, lib, labels) {
  const character = project.character || {};
  const wanted = new Set(options?.sections || SHEET_SECTIONS);
  const available = sheetAvailability(project, lib);
  const on = (id) => wanted.has(id) && available[id] > 0;
  const sections = [];
  const portrait = on('portrait') ? assetOf(project, character.adopted.character) : null;
  if (portrait || on('profile')) {
    sections.push({
      id: 'overview', kind: 'overview',
      image: portrait ? { url: portrait.url } : null,
      profile: on('profile') ? {
        title: labels.profileTitle,
        rows: profileRows(character, lib, labels),
        traits: (character.persona?.traits || []).filter(Boolean),
        description: (character.persona?.description || '').trim(),
        locks: (character.locks || []).filter(Boolean),
        locksLabel: labels.locks,
      } : null,
    });
  }
  if (on('turnaround')) {
    const notes = project.viewNotes || [];
    const items = turnaroundItems(project).map(({ view, asset }) => ({
      label: labels.views[view] || view, url: asset.url,
      pins: notes.map((note, index) => ({ note, number: index + 1 })).filter(({ note }) => note.view === view).map(({ note, number }) => ({ number, x: note.x, y: note.y })),
    }));
    const shownViews = new Set(turnaroundItems(project).map((item) => item.view));
    sections.push({
      id: 'turnaround', kind: 'strip', title: labels.turnaroundTitle, items,
      notes: notes.map((note, index) => ({ note, number: index + 1 })).filter(({ note }) => shownViews.has(note.view) && (note.title || note.text)).map(({ note, number }) => {
        const view = labels.views[note.view] || note.view;
        return { number, heading: note.title ? labels.noteHeading(note.title, view) : view, text: note.text || '' };
      }),
      notesTitle: labels.notesTitle,
    });
  }
  if (on('expressions')) {
    sections.push({ id: 'expressions', kind: 'grid', shape: 'bust', title: labels.expressionsTitle, items: expressionItems(project, lib).map(({ key, info, asset }) => ({
      label: `${info.label}${expressionStale(project, key) ? labels.staleSuffix : ''}`, url: asset.url,
    })) });
  }
  if (on('outfits')) {
    sections.push({ id: 'outfits', kind: 'grid', shape: 'figure', title: labels.outfitsTitle, items: outfitItems(project).map(({ outfit, asset, main }) => ({ label: outfit.name || labels.untitledOutfit, url: asset.url, badge: main ? labels.mainBadge : '' })) });
  }
  if (on('gear')) {
    sections.push({ id: 'gear', kind: 'cards', title: labels.gearTitle, items: gearItems(project).map(({ part, asset, crop }) => ({ label: part.name, text: (part.description || '').trim(), url: asset?.url || null, crop })) });
  }
  if (on('palette')) {
    sections.push({ id: 'palette', kind: 'swatches', title: labels.paletteTitle, items: (character.palette || []).map((swatch) => ({ name: swatch.name, hex: swatch.hex.toUpperCase(), meta: [labelOf(lib.paletteUses, swatch.use), swatch.hex.toUpperCase()].filter(Boolean).join(labels.metaSeparator) })) });
  }
  const title = (options?.title ?? '').trim() || character.name || '';
  const subtitle = options?.subtitle !== undefined ? options.subtitle.trim() : (character.persona?.traits || []).filter(Boolean).join(labels.separator);
  return { title, subtitle, sections };
}

// 下載用的檔名：Windows 不允許的字元換成底線，太長截斷（照字算，不會切壞表情符號）。
export const safeFileName = (name, fallback = 'AIDOL') => (Array.from(String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim()).slice(0, 80).join('').trim() || fallback);
