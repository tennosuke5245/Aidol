// 把角色 DNA、色票、鎖定特徵、穿搭規格與畫風方向編譯成一份可讀的描述。
// 同一份輸入在介面預覽、工作快照與 Codex 交接中都得到相同結果。
// 原則：結構化參數只補充；persona／identity／部件的自由文字仍是優先依據。
import {
  ages, headRatios, builds, heights, hairStyles, hairLengths, hairVolumes, hairBangs, hairTextures, hairColors,
  moods, eyeShapes, brows, eyeColors, outfitStyles, silhouettes, layerOptions, detailOptions, paletteUses,
  mixerControls, mixerGroups, framings, findOption,
} from './libraries.mjs';

const pick = (list, id) => (id ? findOption(list, id) : null);
const present = values => values.filter(Boolean);

export function directionOf(character, directionId) {
  const directions = character?.style?.directions || {};
  const ids = Object.keys(directions);
  if (!ids.length) return null;
  if (directionId && directions[directionId]) return directions[directionId];
  const active = character.style.activeDirection;
  return directions[active] || directions[ids[0]];
}

function bodyParts(dna) {
  const body = dna?.body || {};
  return present([pick(ages, body.age), pick(headRatios, body.headRatio), pick(builds, body.build), pick(heights, body.height)]);
}

function hairParts(dna) {
  const hair = dna?.hair || {};
  const accent = pick(hairColors, hair.accent);
  return present([
    pick(hairStyles, hair.style), pick(hairLengths, hair.length), pick(hairVolumes, hair.volume),
    pick(hairBangs, hair.bangs), pick(hairTextures, hair.texture), pick(hairColors, hair.color),
    accent && { label: `${accent.label}挑染`, prompt: `one restrained ${accent.prompt.replace(' hair', '')} accent streak` },
  ]);
}

function faceParts(dna) {
  const face = dna?.face || {};
  return present([pick(moods, face.mood), pick(eyeShapes, face.eyeShape), pick(brows, face.brows), pick(eyeColors, face.eyeColor)]);
}

function outfitParts(character, outfitId) {
  const outfit = character?.outfits?.[outfitId] || Object.values(character?.outfits || {})[0];
  const spec = outfit?.spec || {};
  const palette = character?.palette || [];
  const colors = (spec.colors || []).map(id => palette.find(swatch => swatch.id === id)).filter(Boolean);
  return {
    outfit,
    parts: present([
      pick(outfitStyles, spec.style), pick(silhouettes, spec.silhouette), pick(layerOptions, spec.layers), pick(detailOptions, spec.detail),
      colors.length && { label: colors.map(color => color.name).join('／'), prompt: `outfit colors ${colors.map(color => `${color.name} ${color.hex}`).join(', ')}` },
    ]),
  };
}

const joinLabels = parts => parts.map(part => part.label).join('・');
const joinPrompts = parts => parts.map(part => part.prompt).join(', ');

// 給左欄摘要與編輯頁使用的一行一類資料。
export function dnaRows(character, { outfitId, directionId } = {}) {
  const dna = character?.dna;
  const hair = dna?.hair, face = dna?.face;
  const direction = directionOf(character, directionId);
  const { parts: outfit } = outfitParts(character, outfitId);
  const renderStep = direction ? mixerControls.find(control => control.id === 'rendering').steps[direction.mixer.rendering] : null;
  return [
    { key: 'body', label: '身形', value: joinLabels(bodyParts(dna)) || character?.identity?.silhouette || '' },
    { key: 'hair', label: '髮', value: joinLabels(hairParts(dna).filter(part => !hairColors.includes(part))) || character?.identity?.hair || '', swatch: pick(hairColors, hair?.color)?.hex },
    { key: 'face', label: '眼', value: joinLabels(faceParts(dna).filter(part => !eyeColors.includes(part))) || character?.identity?.eyes || '', swatch: pick(eyeColors, face?.eyeColor)?.hex },
    { key: 'outfit', label: '服裝', value: joinLabels(outfit) },
    { key: 'direction', label: '畫風', value: direction ? `${direction.id} · ${direction.name}${renderStep ? ` · 渲染${renderStep}` : ''}` : character?.style?.name || '' },
  ];
}

export function hasDna(character) {
  return Boolean(bodyParts(character?.dna).length || hairParts(character?.dna).length || faceParts(character?.dna).length || character?.palette?.length || character?.locks?.length);
}

export function compileBrief(character, { directionId, outfitId, framing } = {}) {
  const dna = character?.dna;
  const direction = directionOf(character, directionId);
  const { outfit, parts: outfitPartList } = outfitParts(character, outfitId);
  const palette = character?.palette || [];
  const locks = character?.locks || [];
  const frame = pick(framings, framing);
  const sections = [];
  const add = (title, parts) => { if (parts.length) sections.push({ title, zh: joinLabels(parts), en: joinPrompts(parts) }); };
  add('身形', bodyParts(dna));
  add('髮', hairParts(dna));
  add('眼與神情', faceParts(dna));
  if (outfit) add(`穿搭「${outfit.name}」`, outfitPartList);
  if (palette.length) sections.push({ title: '色票', zh: palette.map(swatch => `${swatch.name} ${swatch.hex}${swatch.use ? `（${pick(paletteUses, swatch.use)?.label || swatch.use}）` : ''}`).join('、'), en: `color palette: ${palette.map(swatch => `${swatch.name} ${swatch.hex}`).join(', ')}` });
  if (locks.length) sections.push({ title: '鎖定特徵', zh: locks.join('；'), en: `must keep: ${locks.join('; ')}` });
  const directionLines = direction ? mixerGroups.map(group => {
    const controls = mixerControls.filter(control => control.group === group.id);
    return { title: group.label, zh: controls.map(control => `${control.label}${control.steps[direction.mixer[control.id]]}`).join('・'), en: controls.map(control => control.prompts[direction.mixer[control.id]]).join(', ') };
  }) : [];
  // 有繪風參考時，畫法交給參考圖決定，不再寫死「乾淨的日系動畫」，避免文字把參考圖的畫風蓋掉。
  const styleReferences = (character?.style?.references || []).filter(reference => reference.role === 'style');
  const styleFocus = styleReferences.flatMap(reference => reference.focus || []).join('、');
  const prompt = [
    ...sections.filter(section => section.title !== '鎖定特徵').map(section => section.en),
    frame?.prompt,
    styleReferences.length ? `line art, rendering and character drawing style must follow the supplied style reference image${styleFocus ? ` (${styleFocus})` : ''}, not a generic anime look` : 'clean Japanese anime illustration',
    ...directionLines.map(line => line.en),
    direction && 'simplify rendering, not color',
    locks.length && `must keep: ${locks.join('; ')}`,
  ].filter(Boolean).join(', ');
  const lines = [];
  if (sections.length || direction) {
    lines.push('## 結構化角色 DNA（AIDOL 編譯；角色長相以文字設定為準）');
    for (const section of sections) lines.push(`- ${section.title}：${section.zh}${section.title === '鎖定特徵' ? '（每張都必須保留）' : ''}`);
    if (frame) lines.push(`- 取景：${frame.label}`);
    if (direction) {
      lines.push('', `## 畫風方向 ${direction.id} · ${direction.name}`);
      for (const line of directionLines) lines.push(`- ${line.title}：${line.zh}`);
      lines.push('- 原則：簡化的是刻畫，不是顏色。');
      if (styleReferences.length) lines.push(`- 有繪風參考時，畫法以參考圖為準${styleFocus ? `（${styleFocus}）` : ''}；這裡只補充參考圖沒有涵蓋的部分。`);
    }
    lines.push('', '## English brief', prompt);
  }
  return { direction: direction ? { id: direction.id, name: direction.name } : null, sections, directionLines, prompt, text: lines.join('\n'), empty: !lines.length };
}

/** 只取「角色長相」那幾行（身形、髮、眼、穿搭、色票、鎖定、取景），用來判斷立繪之後外觀有沒有改過；標題、畫風方向與英文描述的寫法改了不算。 */
export function appearanceLines(text = '') {
  const lines = String(text).split('\n');
  const start = lines.findIndex(line => line.startsWith('## 結構化角色 DNA'));
  if (start < 0) return '';
  const result = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.startsWith('- ')) result.push(line);
  }
  return result.join('\n');
}

export function mixerDiff(left, right) {
  if (!left || !right) return [];
  return mixerControls.filter(control => left[control.id] !== right[control.id]).map(control => ({ id: control.id, label: control.label, left: control.steps[left[control.id]], right: control.steps[right[control.id]] }));
}
