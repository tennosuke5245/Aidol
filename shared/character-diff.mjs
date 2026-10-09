// 把兩版人物設定的差異整理成設計師讀得懂的變更清單，取代直接閱讀整份 YAML。
import * as L from './libraries.mjs';

const dnaFields = [
  ['body', 'age', '年齡感', L.ages], ['body', 'headRatio', '頭身比', L.headRatios], ['body', 'build', '體型', L.builds], ['body', 'height', '身高感', L.heights],
  ['hair', 'style', '髮型', L.hairStyles], ['hair', 'length', '髮長', L.hairLengths], ['hair', 'volume', '蓬度', L.hairVolumes], ['hair', 'bangs', '瀏海', L.hairBangs], ['hair', 'texture', '髮質', L.hairTextures], ['hair', 'color', '髮色', L.hairColors], ['hair', 'accent', '挑染', L.hairColors],
  ['face', 'mood', '神情', L.moods], ['face', 'eyeShape', '眼型', L.eyeShapes], ['face', 'brows', '眉', L.brows], ['face', 'eyeColor', '眼色', L.eyeColors],
];
const specFields = [['style', '服裝風格', L.outfitStyles], ['silhouette', '輪廓', L.silhouettes], ['layers', '層次', L.layerOptions], ['detail', '細節', L.detailOptions]];
const optionLabel = (list, id) => (id ? L.findOption(list, id)?.label || id : '未設定');
const short = (value, size = 36) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text ? (text.length > size ? `${text.slice(0, size)}…` : text) : '空白'; };
const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

export function describeChanges(before, after) {
  const changes = [];
  const push = (area, label, from, to) => changes.push({ area, label, from, to });
  if (!before || !after) return changes;
  if (before.name !== after.name) push('人設', '名稱', before.name, after.name);
  if (before.persona?.description !== after.persona?.description) push('人設', '人設與故事', short(before.persona?.description), short(after.persona?.description));
  if (!same(before.persona?.traits, after.persona?.traits)) push('人設', '個性', (before.persona?.traits || []).join('、') || '空白', (after.persona?.traits || []).join('、') || '空白');
  for (const key of new Set([...Object.keys(before.identity || {}), ...Object.keys(after.identity || {})])) {
    if ((before.identity?.[key] || '') !== (after.identity?.[key] || '')) push('外觀', { hair: '髮型描述', eyes: '眼睛描述', silhouette: '輪廓描述' }[key] || key, short(before.identity?.[key]), short(after.identity?.[key]));
  }
  for (const [group, field, label, list] of dnaFields) {
    const from = before.dna?.[group]?.[field], to = after.dna?.[group]?.[field];
    if ((from ?? null) !== (to ?? null)) push('角色 DNA', label, optionLabel(list, from), optionLabel(list, to));
  }
  if ((before.dna?.notes || '') !== (after.dna?.notes || '')) push('角色 DNA', '補充', short(before.dna?.notes), short(after.dna?.notes));
  const beforeSwatches = new Map((before.palette || []).map(swatch => [swatch.id, swatch]));
  const afterSwatches = new Map((after.palette || []).map(swatch => [swatch.id, swatch]));
  for (const [id, swatch] of afterSwatches) {
    const old = beforeSwatches.get(id);
    if (!old) push('色票', `新增 ${swatch.name}`, '—', swatch.hex);
    else if (!same(old, swatch)) push('色票', swatch.name, `${old.name} ${old.hex}`, `${swatch.name} ${swatch.hex}`);
  }
  for (const [id, swatch] of beforeSwatches) if (!afterSwatches.has(id)) push('色票', `移除 ${swatch.name}`, swatch.hex, '—');
  if (!same(before.locks, after.locks)) push('鎖定特徵', '一定要保留的特徵', (before.locks || []).join('；') || '無', (after.locks || []).join('；') || '無');
  if (before.style?.name !== after.style?.name) push('畫風', '繪風名稱', before.style?.name, after.style?.name);
  if (before.style?.description !== after.style?.description) push('畫風', '繪風描述', short(before.style?.description), short(after.style?.description));
  const directionIds = new Set([...Object.keys(before.style?.directions || {}), ...Object.keys(after.style?.directions || {})]);
  for (const id of directionIds) {
    const old = before.style?.directions?.[id], next = after.style?.directions?.[id];
    if (!old) push('畫風', `新增方向 ${id}`, '—', next.name);
    else if (!next) push('畫風', `移除方向 ${id}`, old.name, '—');
    else {
      if (old.name !== next.name) push('畫風', `方向 ${id} 名稱`, old.name, next.name);
      for (const control of L.mixerControls) if (old.mixer[control.id] !== next.mixer[control.id]) push('畫風', `方向 ${id} ${control.label}`, control.steps[old.mixer[control.id]], control.steps[next.mixer[control.id]]);
    }
  }
  if ((before.style?.activeDirection || '') !== (after.style?.activeDirection || '')) push('畫風', '目前方向', before.style?.activeDirection || '未設定', after.style?.activeDirection || '未設定');
  const beforeParts = before.components || {}, afterParts = after.components || {};
  for (const [id, part] of Object.entries(afterParts)) {
    const old = beforeParts[id];
    if (!old) { push('部件', `新增 ${part.name}`, '—', short(part.description)); continue; }
    if (old.name !== part.name) push('部件', `${old.name} 名稱`, old.name, part.name);
    if (old.description !== part.description) push('部件', `${part.name} 描述`, short(old.description), short(part.description));
    if (old.designStatus !== part.designStatus) push('部件', `${part.name} 狀態`, old.designStatus, part.designStatus);
  }
  for (const [id, part] of Object.entries(beforeParts)) if (!afterParts[id]) push('部件', `移除 ${part.name}`, short(part.description), '—');
  for (const [id, outfit] of Object.entries(after.outfits || {})) {
    const old = before.outfits?.[id];
    if (!old) { push('穿搭', `新增 ${outfit.name}`, '—', `${outfit.equipped.length} 件`); continue; }
    if (old.name !== outfit.name) push('穿搭', '穿搭名稱', old.name, outfit.name);
    const worn = list => new Map(list.map(item => [item.componentId, item.enabled]));
    const oldWorn = worn(old.equipped), newWorn = worn(outfit.equipped);
    for (const [componentId, enabled] of newWorn) {
      const name = afterParts[componentId]?.name || componentId;
      if (!oldWorn.has(componentId) && enabled) push('穿搭', `${outfit.name}：穿上 ${name}`, '—', '穿戴');
      else if (oldWorn.has(componentId) && oldWorn.get(componentId) !== enabled) push('穿搭', `${outfit.name}：${name}`, oldWorn.get(componentId) ? '穿戴' : '未穿戴', enabled ? '穿戴' : '未穿戴');
    }
    for (const [field, label, list] of specFields) {
      if ((old.spec?.[field] ?? null) !== (outfit.spec?.[field] ?? null)) push('穿搭', `${outfit.name}：${label}`, optionLabel(list, old.spec?.[field]), optionLabel(list, outfit.spec?.[field]));
    }
    if (!same(old.spec?.colors, outfit.spec?.colors)) push('穿搭', `${outfit.name}：配色`, (old.spec?.colors || []).join('、') || '未設定', (outfit.spec?.colors || []).join('、') || '未設定');
  }
  for (const [id, outfit] of Object.entries(before.outfits || {})) if (!after.outfits?.[id]) push('穿搭', `移除 ${outfit.name}`, `${outfit.equipped.length} 件`, '—');
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
