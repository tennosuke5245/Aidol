// 把角色 DNA、色票、鎖定特徵、穿搭規格與畫風方向編譯成一份可讀的描述。
// 同一份輸入在介面預覽、工作快照與 Codex 交接中都得到相同結果。
// 原則：結構化參數只補充；persona／identity／部件的自由文字仍是優先依據。
import {
  ages, headRatios, builds, heights, hairStyles, hairLengths, hairVolumes, hairBangs, hairTextures, hairColors,
  moods, eyeShapes, brows, eyeColors, skinTones, hairDyeStyles, hairExtras, pupils, faceShapes, faceMarks,
  speciesKinds, earTypes, hornTypes, tailTypes, wingTypes, speciesExtras,
  outfitStyles, silhouettes, layerOptions, detailOptions, outfitScenes, paletteUses,
  mixerControls, mixerGroups, framings, findOption,
} from './libraries.mjs';
import { colorName, isHex, resolveColor } from './colors.mjs';

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

const several = (list, values) => (Array.isArray(values) ? values.map(id => pick(list, id)) : []);
// 顏色欄位：預設色照舊用樣式庫的名稱與英文（舊角色的描述一字不差）；自訂色寫「名稱 #HEX」，英文寫「名稱 名詞 (#HEX)」。
// isColor：髮色、眼色、膚色這種「整塊顏色」，左欄摘要會改用色塊顯示。
function colorPart(value, list, noun, zh = label => label, options = {}) {
  const color = resolveColor(value, list, undefined, options);
  if (!color) return null;
  return color.custom
    ? { label: `${zh(color.label)} ${color.hex}`, prompt: `${color.prompt.replace(` (${color.hex})`, '')} ${noun} (${color.hex})`, hex: color.hex, isColor: true }
    : { label: zh(color.label), prompt: color.prompt, hex: color.hex, isColor: true };
}
// 不含名詞的顏色英文（挑染、異色瞳、特徵色組句子用）。
const colorWords = (value, list, noun) => {
  const color = resolveColor(value, list);
  return color ? (color.custom ? color.prompt : color.prompt.replace(` ${noun}`, '')) : '';
};
const colorLabel = (value, list) => { const color = resolveColor(value, list); return color ? (color.custom ? `${color.label} ${color.hex}` : color.label) : ''; };

function bodyParts(dna) {
  const body = dna?.body || {};
  return present([
    pick(ages, body.age), pick(headRatios, body.headRatio), pick(builds, body.build), pick(heights, body.height),
    // 自訂膚色接近哪個預設膚色就用那個名字（自然的膚色不要被叫成「淺橘」）。
    colorPart(body.skin, skinTones, 'skin tone', label => `${label}膚色`, { nearest: true, noun: 'skin tone' }),
  ]);
}

function hairParts(dna) {
  const hair = dna?.hair || {};
  const accent = resolveColor(hair.accent, hairColors);
  // 挑染方式沒寫的（舊資料）一律是「挑染」，描述和以前一樣。
  const dye = pick(hairDyeStyles, hair.accentStyle) || hairDyeStyles[0];
  return present([
    pick(hairStyles, hair.style), pick(hairLengths, hair.length), pick(hairVolumes, hair.volume),
    pick(hairBangs, hair.bangs), pick(hairTextures, hair.texture), colorPart(hair.color, hairColors, 'hair'),
    accent && { label: dye.brief.replace('{color}', colorLabel(hair.accent, hairColors)), prompt: dye.prompt.replace('{color}', colorWords(hair.accent, hairColors, 'hair')) },
    ...several(hairExtras, hair.extras),
  ]);
}

// 異色瞳：左右以角色自己為準（正面時右眼在畫面左邊），文字一定寫清楚，各角度才不會畫反。
const sameColor = (a, b) => String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase();
function eyeParts(face) {
  const right = face.eyeColor || face.eyeColorLeft;
  const left = face.eyeColorLeft;
  if (!right) return [];
  if (!left || sameColor(left, right) || !face.eyeColor) return [colorPart(right, eyeColors, 'eyes')];
  return [{
    label: `異色瞳（右眼${colorLabel(right, eyeColors)}、左眼${colorLabel(left, eyeColors)}；以角色自己的左右為準，正面時右眼在畫面左邊）`,
    prompt: `heterochromia: right eye ${colorWords(right, eyeColors, 'eyes')}, left eye ${colorWords(left, eyeColors, 'eyes')} (the character's own right and left; in a front view the right eye is on the viewer's left)`,
    hex: resolveColor(right, eyeColors)?.hex, isColor: true,
  }];
}

// mood：false 時不寫神情（畫表情集時，神情由這次的表情決定，寫了會互相打架）。
function faceParts(dna, { mood = true } = {}) {
  const face = dna?.face || {};
  return present([
    mood && pick(moods, face.mood), pick(eyeShapes, face.eyeShape), pick(brows, face.brows), ...eyeParts(face),
    pick(pupils, face.pupil), pick(faceShapes, face.shape), ...several(faceMarks, face.marks),
  ]);
}

// 種族：主題（精靈、龍人…）加上每個特徵；特徵色寫成一句。人類、其他、人耳、沒有角這類不寫。
// 特徵色套在哪些特徵上（英文、繁中）。尖耳、長尖耳是皮膚，不上特徵色；九尾是複數。
const featureNouns = { ears: ['ears', '耳朵'], horns: ['horns', '角'], tail: ['tail', '尾巴'], wings: ['wings', '翅膀'], scales: ['scales', '鱗片'], markings: ['markings', '紋路'], halo: ['halo', '光環'], gem: ['gem', '寶石'] };
const skinEars = new Set(['pointed', 'long']);
const nounOf = (key, species) => (key === 'ears' && skinEars.has(species.ears) ? null : key === 'tail' && species.tail === 'nineFox' ? ['tails', '尾巴'] : featureNouns[key]);
const englishList = items => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
function speciesParts(dna) {
  const species = dna?.species;
  if (!species) return [];
  const kind = pick(speciesKinds, species.kind);
  const slots = [['ears', earTypes], ['horns', hornTypes], ['tail', tailTypes], ['wings', wingTypes]].map(([key, list]) => [key, pick(list, species[key])]).filter(([, option]) => option?.prompt);
  const extras = several(speciesExtras, species.extras).filter(Boolean);
  const parts = [...(kind?.prompt ? [kind] : []), ...slots.map(([, option]) => option), ...extras];
  const nouns = [...slots.map(([key]) => key), ...extras.map(extra => extra.id)].map(key => nounOf(key, species)).filter(Boolean);
  if (isHex(species.color) && nouns.length) {
    const hex = species.color.toUpperCase();
    const name = colorName(hex);
    parts.push({ label: `${nouns.map(([, zh]) => zh).join('、')}是${name.label} ${hex}`, prompt: `${englishList(nouns.map(([en]) => en))} colored ${name.prompt} (${hex})` });
  }
  return parts;
}

function outfitParts(character, outfitId) {
  const outfit = character?.outfits?.[outfitId] || Object.values(character?.outfits || {})[0];
  const spec = outfit?.spec || {};
  const palette = character?.palette || [];
  const colors = (spec.colors || []).map(id => palette.find(swatch => swatch.id === id)).filter(Boolean);
  return {
    outfit,
    parts: present([
      pick(outfitScenes, spec.scene), pick(outfitStyles, spec.style), pick(silhouettes, spec.silhouette), pick(layerOptions, spec.layers), pick(detailOptions, spec.detail),
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
    { key: 'hair', label: '髮', value: joinLabels(hairParts(dna).filter(part => !part.isColor)) || character?.identity?.hair || '', swatch: resolveColor(hair?.color, hairColors)?.hex },
    { key: 'face', label: '眼', value: joinLabels(faceParts(dna).filter(part => !part.isColor)) || character?.identity?.eyes || '', swatch: resolveColor(face?.eyeColor || face?.eyeColorLeft, eyeColors)?.hex },
    { key: 'outfit', label: '服裝', value: joinLabels(outfit) },
    { key: 'direction', label: '畫風', value: direction ? `${direction.id} · ${direction.name}${renderStep ? ` · 渲染${renderStep}` : ''}` : character?.style?.name || '' },
  ];
}

export function hasDna(character) {
  return Boolean(speciesParts(character?.dna).length || bodyParts(character?.dna).length || hairParts(character?.dna).length || faceParts(character?.dna).length || character?.palette?.length || character?.locks?.length);
}

// canon：有定稿時，長相以定稿圖為準，這份文字只補充定稿上看不到的部分（標題寫清楚，避免和定稿打架）。
// expression：畫表情集的一張，不寫角色平常的神情（表情照這次的要求）。
// outfitVariant：畫另一套穿搭（衣裝差分）：有定稿時，長相照定稿、穿搭照這裡的設定（標題寫清楚）。
export function compileBrief(character, { directionId, outfitId, framing, canon = false, expression = false, outfitVariant = false } = {}) {
  const dna = character?.dna;
  const direction = directionOf(character, directionId);
  const { outfit, parts: outfitPartList } = outfitParts(character, outfitId);
  const palette = character?.palette || [];
  const locks = character?.locks || [];
  const frame = pick(framings, framing);
  const sections = [];
  const add = (title, parts) => { if (parts.length) sections.push({ title, zh: joinLabels(parts), en: joinPrompts(parts) }); };
  add('種族', speciesParts(dna));
  add('身形', bodyParts(dna));
  add('髮', hairParts(dna));
  add('眼與神情', faceParts(dna, { mood: !expression }));
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
    lines.push(canon ? (outfitVariant ? '## 結構化角色 DNA（AIDOL 編譯；長相以定稿為準，這裡補充定稿上看不到的部分；穿搭照這裡的設定）' : '## 結構化角色 DNA（AIDOL 編譯；長相以定稿為準，這裡只補充定稿上看不到的部分）') : '## 結構化角色 DNA（AIDOL 編譯；角色長相以文字設定為準）');
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
