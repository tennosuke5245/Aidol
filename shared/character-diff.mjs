// 把兩版人物設定的差異整理成設計師讀得懂的變更清單，取代直接閱讀整份 YAML。
import * as L from './libraries.mjs';

const dnaFields = [
  ['body', 'age', '年齡感', 'ages'], ['body', 'headRatio', '頭身比', 'headRatios'], ['body', 'build', '體型', 'builds'], ['body', 'height', '身高感', 'heights'],
  ['hair', 'style', '髮型', 'hairStyles'], ['hair', 'length', '髮長', 'hairLengths'], ['hair', 'volume', '蓬度', 'hairVolumes'], ['hair', 'bangs', '瀏海', 'hairBangs'], ['hair', 'texture', '髮質', 'hairTextures'], ['hair', 'color', '髮色', 'hairColors'], ['hair', 'accent', '挑染', 'hairColors'],
  ['face', 'mood', '神情', 'moods'], ['face', 'eyeShape', '眼型', 'eyeShapes'], ['face', 'brows', '眉', 'brows'], ['face', 'eyeColor', '眼色', 'eyeColors'],
];
const specFields = [['style', '服裝風格', 'outfitStyles'], ['silhouette', '輪廓', 'silhouettes'], ['layers', '層次', 'layerOptions'], ['detail', '細節', 'detailOptions']];
const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

// 介面文字預設是繁中原文。前端傳入 tr 換成目前語言：
// tr.text(key, params, 原文) 查 shared.json 的 diff.*；tr.option(清單名, id) 給選項名稱；
// tr.step(旋鈕 id, 刻度) 給旋鈕刻度名稱；tr.list(陣列, 原文分隔符號) 把多個值接起來（鎖定特徵用較強的「；」）。
export function describeChanges(before, after, tr = {}) {
  const changes = [];
  const T = (key, source, params = {}) => (tr.text ? tr.text(`diff.${key}`, params, source) : source);
  const list = (items, separator = '、') => (tr.list ? tr.list(items, separator) : items.join(separator));
  const optionLabel = (listName, id) => (id ? tr.option?.(listName, id) || L.findOption(L[listName], id)?.label || id : T('unset', '未設定'));
  const stepLabel = (control, step) => tr.step?.(control.id, step) ?? control.steps[step];
  const empty = () => T('empty', '空白');
  const short = (value, size = 36) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text ? (text.length > size ? `${text.slice(0, size)}…` : text) : empty(); };
  const pieces = count => T('pieces', `${count} 件`, { count });
  const push = (area, label, from, to) => changes.push({ area, label, from, to });
  if (!before || !after) return changes;
  const area = {
    persona: T('area.persona', '人設'), appearance: T('area.appearance', '外觀'), dna: T('area.dna', '角色 DNA'), palette: T('area.palette', '色票'),
    locks: T('area.locks', '鎖定特徵'), style: T('area.style', '畫風'), parts: T('area.parts', '部件'), outfits: T('area.outfits', '穿搭'),
  };
  if (before.name !== after.name) push(area.persona, T('field.name', '名稱'), before.name, after.name);
  if (before.persona?.description !== after.persona?.description) push(area.persona, T('field.story', '人設與故事'), short(before.persona?.description), short(after.persona?.description));
  if (!same(before.persona?.traits, after.persona?.traits)) push(area.persona, T('field.traits', '個性'), list(before.persona?.traits || []) || empty(), list(after.persona?.traits || []) || empty());
  const identityLabel = key => (key === 'hair' ? T('field.hairText', '髮型描述') : key === 'eyes' ? T('field.eyesText', '眼睛描述') : key === 'silhouette' ? T('field.silhouetteText', '輪廓描述') : key);
  for (const key of new Set([...Object.keys(before.identity || {}), ...Object.keys(after.identity || {})])) {
    if ((before.identity?.[key] || '') !== (after.identity?.[key] || '')) push(area.appearance, identityLabel(key), short(before.identity?.[key]), short(after.identity?.[key]));
  }
  for (const [group, field, label, listName] of dnaFields) {
    const from = before.dna?.[group]?.[field], to = after.dna?.[group]?.[field];
    if ((from ?? null) !== (to ?? null)) push(area.dna, T(`field.${field === 'style' ? 'hairStyle' : field}`, label), optionLabel(listName, from), optionLabel(listName, to));
  }
  if ((before.dna?.notes || '') !== (after.dna?.notes || '')) push(area.dna, T('field.notes', '補充'), short(before.dna?.notes), short(after.dna?.notes));
  const beforeSwatches = new Map((before.palette || []).map(swatch => [swatch.id, swatch]));
  const afterSwatches = new Map((after.palette || []).map(swatch => [swatch.id, swatch]));
  for (const [id, swatch] of afterSwatches) {
    const old = beforeSwatches.get(id);
    if (!old) push(area.palette, T('added', `新增 ${swatch.name}`, { name: swatch.name }), '—', swatch.hex);
    else if (!same(old, swatch)) push(area.palette, swatch.name, `${old.name} ${old.hex}`, `${swatch.name} ${swatch.hex}`);
  }
  for (const [id, swatch] of beforeSwatches) if (!afterSwatches.has(id)) push(area.palette, T('removed', `移除 ${swatch.name}`, { name: swatch.name }), swatch.hex, '—');
  if (!same(before.locks, after.locks)) push(area.locks, T('field.mustKeep', '一定要保留的特徵'), list(before.locks || [], '；') || T('none', '無'), list(after.locks || [], '；') || T('none', '無'));
  if (before.style?.name !== after.style?.name) push(area.style, T('field.styleName', '繪風名稱'), before.style?.name, after.style?.name);
  if (before.style?.description !== after.style?.description) push(area.style, T('field.styleDescription', '繪風描述'), short(before.style?.description), short(after.style?.description));
  const directionIds = new Set([...Object.keys(before.style?.directions || {}), ...Object.keys(after.style?.directions || {})]);
  for (const id of directionIds) {
    const old = before.style?.directions?.[id], next = after.style?.directions?.[id];
    if (!old) push(area.style, T('directionAdded', `新增方向 ${id}`, { id }), '—', next.name);
    else if (!next) push(area.style, T('directionRemoved', `移除方向 ${id}`, { id }), old.name, '—');
    else {
      if (old.name !== next.name) push(area.style, T('directionName', `方向 ${id} 名稱`, { id }), old.name, next.name);
      for (const control of L.mixerControls) {
        if (old.mixer[control.id] === next.mixer[control.id]) continue;
        const controlLabel = tr.option?.('mixerControls', control.id) || control.label;
        push(area.style, T('directionControl', `方向 ${id} ${control.label}`, { id, control: controlLabel }), stepLabel(control, old.mixer[control.id]), stepLabel(control, next.mixer[control.id]));
      }
    }
  }
  if ((before.style?.activeDirection || '') !== (after.style?.activeDirection || '')) push(area.style, T('field.activeDirection', '目前方向'), before.style?.activeDirection || T('unset', '未設定'), after.style?.activeDirection || T('unset', '未設定'));
  const beforeParts = before.components || {}, afterParts = after.components || {};
  for (const [id, part] of Object.entries(afterParts)) {
    const old = beforeParts[id];
    if (!old) { push(area.parts, T('added', `新增 ${part.name}`, { name: part.name }), '—', short(part.description)); continue; }
    if (old.name !== part.name) push(area.parts, T('partName', `${old.name} 名稱`, { name: old.name }), old.name, part.name);
    if (old.description !== part.description) push(area.parts, T('partDescription', `${part.name} 描述`, { name: part.name }), short(old.description), short(part.description));
    if (old.designStatus !== part.designStatus) push(area.parts, T('partStatus', `${part.name} 狀態`, { name: part.name }), old.designStatus, part.designStatus);
  }
  for (const [id, part] of Object.entries(beforeParts)) if (!afterParts[id]) push(area.parts, T('removed', `移除 ${part.name}`, { name: part.name }), short(part.description), '—');
  const worn = () => T('worn', '穿戴'), notWorn = () => T('notWorn', '未穿戴');
  for (const [id, outfit] of Object.entries(after.outfits || {})) {
    const old = before.outfits?.[id];
    if (!old) { push(area.outfits, T('added', `新增 ${outfit.name}`, { name: outfit.name }), '—', pieces(outfit.equipped.length)); continue; }
    if (old.name !== outfit.name) push(area.outfits, T('field.outfitName', '穿搭名稱'), old.name, outfit.name);
    const wornMap = items => new Map(items.map(item => [item.componentId, item.enabled]));
    const oldWorn = wornMap(old.equipped), newWorn = wornMap(outfit.equipped);
    const item = (name) => T('outfitItem', `${outfit.name}：${name}`, { outfit: outfit.name, name });
    for (const [componentId, enabled] of newWorn) {
      const name = afterParts[componentId]?.name || componentId;
      if (!oldWorn.has(componentId) && enabled) push(area.outfits, T('wear', `${outfit.name}：穿上 ${name}`, { outfit: outfit.name, name }), '—', worn());
      else if (oldWorn.has(componentId) && oldWorn.get(componentId) !== enabled) push(area.outfits, item(name), oldWorn.get(componentId) ? worn() : notWorn(), enabled ? worn() : notWorn());
    }
    for (const [field, label, listName] of specFields) {
      if ((old.spec?.[field] ?? null) !== (outfit.spec?.[field] ?? null)) push(area.outfits, item(T(`field.${field === 'style' ? 'outfitStyle' : field}`, label)), optionLabel(listName, old.spec?.[field]), optionLabel(listName, outfit.spec?.[field]));
    }
    if (!same(old.spec?.colors, outfit.spec?.colors)) push(area.outfits, item(T('field.colors', '配色')), list(old.spec?.colors || []) || T('unset', '未設定'), list(outfit.spec?.colors || []) || T('unset', '未設定'));
  }
  for (const [id, outfit] of Object.entries(before.outfits || {})) if (!after.outfits?.[id]) push(area.outfits, T('removed', `移除 ${outfit.name}`, { name: outfit.name }), pieces(outfit.equipped.length), '—');
  return changes;
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
