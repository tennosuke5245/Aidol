// 把兩版人物設定的差異整理成設計師讀得懂的變更清單，取代直接閱讀整份 YAML。
import * as L from './libraries.mjs';
import { colorName, isHex } from './colors.mjs';

// [部位, 欄位, 繁中名稱, 選項清單, 翻譯用的欄位 key（沒寫就是欄位名）, 等同「沒設定」的值]。清單是 null 的欄位只存自訂色。
// 人類、人耳、沒有角這類值和「沒設定」畫出來一樣，不算改動（定稿後點了「人類」不會多出一串假的改動交給 AI）。
const dnaFields = [
  ['species', 'kind', '種族', 'speciesKinds', 'species', ['human', 'other']], ['species', 'ears', '耳朵', 'earTypes', 'ears', ['human']], ['species', 'horns', '角', 'hornTypes', 'horns', ['none']], ['species', 'tail', '尾巴', 'tailTypes', 'tail', ['none']], ['species', 'wings', '翅膀', 'wingTypes', 'wings', ['none']], ['species', 'color', '特徵色', null, 'featureColor'],
  ['body', 'age', '年齡感', 'ages'], ['body', 'headRatio', '頭身比', 'headRatios'], ['body', 'build', '體型', 'builds'], ['body', 'height', '身高感', 'heights'], ['body', 'skin', '膚色', 'skinTones'],
  ['hair', 'style', '髮型', 'hairStyles', 'hairStyle'], ['hair', 'length', '髮長', 'hairLengths'], ['hair', 'volume', '蓬度', 'hairVolumes'], ['hair', 'bangs', '瀏海', 'hairBangs'], ['hair', 'texture', '髮質', 'hairTextures'], ['hair', 'color', '髮色', 'hairColors'], ['hair', 'accent', '挑染', 'hairColors'], ['hair', 'accentStyle', '挑染方式', 'hairDyeStyles'],
  ['face', 'mood', '神情', 'moods'], ['face', 'eyeShape', '眼型', 'eyeShapes'], ['face', 'brows', '眉', 'brows'], ['face', 'eyeColor', '眼色', 'eyeColors'], ['face', 'eyeColorLeft', '左眼顏色（異色瞳）', 'eyeColors'], ['face', 'pupil', '瞳孔', 'pupils'], ['face', 'shape', '臉型', 'faceShapes', 'faceShape'],
];
// 可複選的欄位：[部位, 欄位, 繁中名稱, 選項清單, 翻譯用的欄位 key]。
const dnaLists = [
  ['species', 'extras', '種族特徵', 'speciesExtras', 'speciesExtras'], ['hair', 'extras', '髮型細節', 'hairExtras', 'hairExtras'], ['face', 'marks', '臉部特徵', 'faceMarks', 'faceMarks'],
];
const specFields = [['scene', '情境', 'outfitScenes'], ['style', '服裝風格', 'outfitStyles'], ['silhouette', '輪廓', 'silhouettes'], ['layers', '層次', 'layerOptions'], ['detail', '細節', 'detailOptions']];
const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

// 介面文字預設是繁中原文。前端傳入 tr 換成目前語言：
// tr.text(key, params, 原文) 查 shared.json 的 diff.*；tr.option(清單名, id) 給選項名稱；
// tr.step(旋鈕 id, 刻度) 給旋鈕刻度名稱；tr.list(陣列, 原文分隔符號) 把多個值接起來（鎖定特徵用較強的「；」）。
export function describeChanges(before, after, tr = {}) {
  const changes = [];
  const T = (key, source, params = {}) => (tr.text ? tr.text(`diff.${key}`, params, source) : source);
  // 接成一串前先去掉每一項句尾的中文句讀（AI 寫的個性常是一句話，接起來才不會變成「。、」「。；」）。
  // 只去中文全形的句尾（英文的 A.I.、GO! 不動）；整項都是標點就照原樣。
  const clean = items => items.map(item => { const text = String(item ?? '').trim(); return text.replace(/[。！；、，]+$/u, '') || text; }).filter(Boolean);
  const join = (items, separator) => (tr.list ? tr.list(items, separator) : items.join(separator));
  const list = (items, separator = '、') => join(clean(items), separator);
  // 前後兩版去掉句讀後看起來一樣（只差句尾標點）：照原文列，不然會出現「A → A」。
  const listPair = (from, to, separator = '、') => { const a = list(from, separator), b = list(to, separator); return a === b ? [join(from, separator), join(to, separator)] : [a, b]; };
  // 自訂色（#RRGGBB）顯示成「名稱 #HEX」；tr.color 給目前語言的名稱。
  const colorText = hex => `${tr.color ? tr.color(hex) : colorName(hex).label} ${hex.toUpperCase()}`;
  const optionLabel = (listName, id) => (!id ? T('unset', '未設定') : isHex(id) ? colorText(id) : listName ? tr.option?.(listName, id) || L.findOption(L[listName], id)?.label || id : id);
  const stepLabel = (control, step) => tr.step?.(control.id, step) ?? control.steps[step];
  const empty = () => T('empty', '空白');
  const short = (value, size = 36) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text ? (text.length > size ? `${text.slice(0, size)}…` : text) : empty(); };
  const pieces = count => T('pieces', `${count} 件`, { count });
  // areaKey 給程式判斷（例如定稿只看外觀相關的改動）；area 是畫面上的文字。
  const push = (areaKey, label, from, to, extra = {}) => changes.push({ area: area[areaKey], areaKey, label, from, to, ...extra });
  if (!before || !after) return changes;
  const area = {
    persona: T('area.persona', '人設'), appearance: T('area.appearance', '外觀'), dna: T('area.dna', '角色 DNA'), palette: T('area.palette', '色票'),
    locks: T('area.locks', '鎖定特徵'), style: T('area.style', '畫風'), parts: T('area.parts', '部件'), outfits: T('area.outfits', '穿搭'),
  };
  if (before.name !== after.name) push('persona', T('field.name', '名稱'), before.name, after.name);
  if (before.persona?.description !== after.persona?.description) push('persona', T('field.story', '人設與故事'), short(before.persona?.description), short(after.persona?.description));
  if (!same(before.persona?.traits, after.persona?.traits)) { const [from, to] = listPair(before.persona?.traits || [], after.persona?.traits || []); push('persona', T('field.traits', '個性'), from || empty(), to || empty()); }
  // 外觀的文字描述：AI 有時會自己取欄位名（appearance、signature…），常見的給中文名；認不得的英文欄位叫「其他外觀描述（欄位名）」，
  // 本來就是中日文的欄位名（例如「刺青」）直接用。用 Object.hasOwn 查，constructor 這類名稱不會查到物件內建的東西。
  const identityNames = {
    hair: ['hairText', '髮型描述'], eyes: ['eyesText', '眼睛描述'], silhouette: ['silhouetteText', '輪廓描述'], appearance: ['appearanceText', '外觀描述'], look: ['appearanceText', '外觀描述'],
    signature: ['signatureText', '招牌特徵'], face: ['faceText', '臉部描述'], body: ['bodyText', '身形描述'], build: ['bodyText', '身形描述'], outfit: ['outfitText', '服裝描述'], clothing: ['outfitText', '服裝描述'], clothes: ['outfitText', '服裝描述'],
    accessories: ['accessoriesText', '配件描述'], colors: ['colorsText', '配色描述'], palette: ['colorsText', '配色描述'], skin: ['skinText', '膚色描述'],
  };
  const identityLabel = key => {
    const name = String(key), lower = name.toLowerCase();
    if (Object.hasOwn(identityNames, lower)) { const [fieldKey, source] = identityNames[lower]; return T(`field.${fieldKey}`, source); }
    return /[^\x00-\x7F]/.test(name) ? name : T('field.otherText', `其他外觀描述（${name}）`, { key: name });
  };
  for (const key of new Set([...Object.keys(before.identity || {}), ...Object.keys(after.identity || {})])) {
    if ((before.identity?.[key] || '') !== (after.identity?.[key] || '')) push('appearance', identityLabel(key), short(before.identity?.[key]), short(after.identity?.[key]));
  }
  // 異色瞳（任一版有左眼顏色）時，eyeColor 是右眼，要寫清楚，AI 才不會以為兩眼都改了；左眼沒設定＝和右眼一樣。
  const hetero = Boolean(before.dna?.face?.eyeColorLeft || after.dna?.face?.eyeColorLeft);
  const normal = (value, blanks = []) => (value == null || blanks.includes(value) ? null : isHex(value) ? value.toUpperCase() : value);
  // 顏色欄位（髮色、眼色、膚色、特徵色…）：畫面照 swatch 畫出色塊。
  const hexOf = (listName, value) => (!value ? null : isHex(value) ? value.toUpperCase() : listName ? L.findOption(L[listName], value)?.hex || null : null);
  for (const [group, field, label, listName, key = field, blanks] of dnaFields) {
    const from = before.dna?.[group]?.[field], to = after.dna?.[group]?.[field];
    if (normal(from, blanks) === normal(to, blanks)) continue;
    const show = value => (field === 'eyeColorLeft' && !value ? T('sameAsRight', '和右眼一樣') : optionLabel(listName, value));
    const [fieldKey, fieldLabel] = field === 'eyeColor' && hetero ? ['eyeColorRight', '右眼顏色（異色瞳）'] : [key, label];
    const swatch = hexOf(listName, to);
    push('dna', T(`field.${fieldKey}`, fieldLabel), show(from), show(to), swatch ? { swatch } : {});
  }
  for (const [group, field, label, listName, key] of dnaLists) {
    const from = before.dna?.[group]?.[field] || [], to = after.dna?.[group]?.[field] || [];
    if (!same(from, to)) push('dna', T(`field.${key}`, label), list(from.map(id => optionLabel(listName, id))) || T('none', '無'), list(to.map(id => optionLabel(listName, id))) || T('none', '無'));
  }
  if ((before.dna?.notes || '') !== (after.dna?.notes || '')) push('dna', T('field.notes', '補充'), short(before.dna?.notes), short(after.dna?.notes));
  const beforeSwatches = new Map((before.palette || []).map(swatch => [swatch.id, swatch]));
  const afterSwatches = new Map((after.palette || []).map(swatch => [swatch.id, swatch]));
  // 色票：畫面可以照 swatch／fromSwatch 畫出色塊（不是只有色碼）。
  for (const [id, swatch] of afterSwatches) {
    const old = beforeSwatches.get(id);
    if (!old) push('palette', T('added', `新增 ${swatch.name}`, { name: swatch.name }), '—', swatch.hex, { swatch: swatch.hex });
    else if (!same(old, swatch)) push('palette', swatch.name, `${old.name} ${old.hex}`, `${swatch.name} ${swatch.hex}`, { swatch: swatch.hex, fromSwatch: old.hex });
  }
  for (const [id, swatch] of beforeSwatches) if (!afterSwatches.has(id)) push('palette', T('removed', `移除 ${swatch.name}`, { name: swatch.name }), swatch.hex, '—', { fromSwatch: swatch.hex });
  if (!same(before.locks, after.locks)) { const [from, to] = listPair(before.locks || [], after.locks || [], '；'); push('locks', T('field.mustKeep', '一定要保留的特徵'), from || T('none', '無'), to || T('none', '無')); }
  if (before.style?.name !== after.style?.name) push('style', T('field.styleName', '繪風名稱'), before.style?.name, after.style?.name);
  if (before.style?.description !== after.style?.description) push('style', T('field.styleDescription', '繪風描述'), short(before.style?.description), short(after.style?.description));
  const directionIds = new Set([...Object.keys(before.style?.directions || {}), ...Object.keys(after.style?.directions || {})]);
  for (const id of directionIds) {
    const old = before.style?.directions?.[id], next = after.style?.directions?.[id];
    if (!old) push('style', T('directionAdded', `新增方向 ${id}`, { id }), '—', next.name);
    else if (!next) push('style', T('directionRemoved', `移除方向 ${id}`, { id }), old.name, '—');
    else {
      if (old.name !== next.name) push('style', T('directionName', `方向 ${id} 名稱`, { id }), old.name, next.name);
      for (const control of L.mixerControls) {
        if (old.mixer[control.id] === next.mixer[control.id]) continue;
        const controlLabel = tr.option?.('mixerControls', control.id) || control.label;
        push('style', T('directionControl', `方向 ${id} ${control.label}`, { id, control: controlLabel }), stepLabel(control, old.mixer[control.id]), stepLabel(control, next.mixer[control.id]));
      }
    }
  }
  if ((before.style?.activeDirection || '') !== (after.style?.activeDirection || '')) push('style', T('field.activeDirection', '目前方向'), before.style?.activeDirection || T('unset', '未設定'), after.style?.activeDirection || T('unset', '未設定'));
  const beforeParts = before.components || {}, afterParts = after.components || {};
  for (const [id, part] of Object.entries(afterParts)) {
    const old = beforeParts[id];
    // partId：給定稿判斷這件裝備是不是這次要畫的穿搭穿著的。
    if (!old) { push('parts', T('added', `新增 ${part.name}`, { name: part.name }), '—', short(part.description), { partId: id }); continue; }
    if (old.name !== part.name) push('parts', T('partName', `${old.name} 名稱`, { name: old.name }), old.name, part.name, { partId: id });
    if (old.description !== part.description) push('parts', T('partDescription', `${part.name} 描述`, { name: part.name }), short(old.description), short(part.description), { partId: id });
    if (old.designStatus !== part.designStatus) push('parts', T('partStatus', `${part.name} 狀態`, { name: part.name }), old.designStatus, part.designStatus, { key: 'partStatus', partId: id });
  }
  for (const [id, part] of Object.entries(beforeParts)) if (!afterParts[id]) push('parts', T('removed', `移除 ${part.name}`, { name: part.name }), short(part.description), '—', { partId: id });
  const worn = () => T('worn', '穿戴'), notWorn = () => T('notWorn', '未穿戴');
  // 穿搭的改動記下是哪一套，定稿只列出這次畫的那套。
  const pushOutfit = (outfitId, label, from, to) => push('outfits', label, from, to, { outfitId });
  for (const [id, outfit] of Object.entries(after.outfits || {})) {
    const old = before.outfits?.[id];
    if (!old) { pushOutfit(id, T('added', `新增 ${outfit.name}`, { name: outfit.name }), '—', pieces(outfit.equipped.length)); continue; }
    if (old.name !== outfit.name) pushOutfit(id, T('field.outfitName', '穿搭名稱'), old.name, outfit.name);
    const wornMap = items => new Map(items.map(item => [item.componentId, item.enabled]));
    const oldWorn = wornMap(old.equipped), newWorn = wornMap(outfit.equipped);
    const item = (name) => T('outfitItem', `${outfit.name}：${name}`, { outfit: outfit.name, name });
    for (const [componentId, enabled] of newWorn) {
      const name = afterParts[componentId]?.name || componentId;
      if (!oldWorn.has(componentId) && enabled) pushOutfit(id, T('wear', `${outfit.name}：穿上 ${name}`, { outfit: outfit.name, name }), '—', worn());
      else if (oldWorn.has(componentId) && oldWorn.get(componentId) !== enabled) pushOutfit(id, item(name), oldWorn.get(componentId) ? worn() : notWorn(), enabled ? worn() : notWorn());
    }
    for (const [field, label, listName] of specFields) {
      if ((old.spec?.[field] ?? null) !== (outfit.spec?.[field] ?? null)) pushOutfit(id, item(T(`field.${field === 'style' ? 'outfitStyle' : field}`, label)), optionLabel(listName, old.spec?.[field]), optionLabel(listName, outfit.spec?.[field]));
    }
    // 套裝配色存的是色票代號：顯示色票的名字（找不到的色票才顯示代號）。
    const swatchNames = (ids, palette) => (ids || []).map(swatchId => (palette || []).find(swatch => swatch.id === swatchId)?.name || swatchId);
    // 名字一樣、色票不同（色票名稱不必唯一）時加上色碼，才看得出差別。
    const swatchHexes = (ids, palette) => (ids || []).map(swatchId => { const swatch = (palette || []).find(item => item.id === swatchId); return swatch ? `${swatch.name} ${swatch.hex}` : swatchId; });
    if (!same(old.spec?.colors, outfit.spec?.colors)) {
      let from = list(swatchNames(old.spec?.colors, before.palette)), to = list(swatchNames(outfit.spec?.colors, after.palette));
      if (from === to) { from = list(swatchHexes(old.spec?.colors, before.palette)); to = list(swatchHexes(outfit.spec?.colors, after.palette)); }
      pushOutfit(id, item(T('field.colors', '配色')), from || T('unset', '未設定'), to || T('unset', '未設定'));
    }
  }
  for (const [id, outfit] of Object.entries(before.outfits || {})) if (!after.outfits?.[id]) pushOutfit(id, T('removed', `移除 ${outfit.name}`, { name: outfit.name }), pieces(outfit.equipped.length), '—');
  return changes;
}

// 會改變畫出來的樣子的改動（「用較早的設定畫的」只看這些）：外觀、DNA、色票、鎖定特徵、裝備（狀態不算）、穿搭、畫風與繪風參考圖。
// 名稱、人設文字、個性不算。
const lookAreas = new Set(['appearance', 'dna', 'palette', 'locks', 'parts', 'outfits', 'style']);
export function looksChanged(before, after) {
  if (!before || !after) return true;
  if (!same(before.style?.references || [], after.style?.references || [])) return true;
  // 變更清單沒列、但畫出來會不一樣的：穿戴位置、整個拿掉（不是只取消穿戴）、裝備種類。
  const worn = outfit => (outfit?.equipped || []).map(item => [item.componentId, item.enabled !== false, item.anchor || '']).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  for (const id of new Set([...Object.keys(before.outfits || {}), ...Object.keys(after.outfits || {})])) if (!same(worn(before.outfits?.[id]), worn(after.outfits?.[id]))) return true;
  for (const id of new Set([...Object.keys(before.components || {}), ...Object.keys(after.components || {})])) if ((before.components?.[id]?.kind ?? null) !== (after.components?.[id]?.kind ?? null)) return true;
  return describeChanges(before, after).some(change => lookAreas.has(change.areaKey) && change.key !== 'partStatus');
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// 三方合併：base 是提案依據的版本、theirs 是提案、ours 是目前設定。
// 只採用提案真正改動的欄位；雙方都改的同一個值以提案為準（使用者按了「套用」）。
// 採用圖引用、版本號與 schema 一律保留目前設定。
export function mergeCharacter(base, theirs, ours) {
  const merge = (b, t, o) => {
    if (same(t, b)) return o;
    if (same(o, b)) return t;
    if (isPlainObject(b) && isPlainObject(t) && isPlainObject(o)) {
      const result = {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(t), ...Object.keys(o)])) {
        const value = merge(b[key], t[key], o[key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    return t;
  };
  const merged = merge(base, theirs, ours);
  return { ...merged, adopted: ours.adopted, revision: ours.revision, schema_version: ours.schema_version ?? merged.schema_version };
}
