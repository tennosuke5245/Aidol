// 骰子（2026-10-13 起）：隨機換「目前這一頁」的結構化外觀。不碰名字、人設、鎖定特徵、部件與畫風；年齡不骰。
// 直接改傳進來的角色（前端傳草稿的複本，按 Ctrl+Z 可以復原）。rng 可以注入，測試用固定種子。
import * as L from './libraries.mjs';
import { hslToRgb, rgbToHex } from './colors.mjs';

export const diceCategories = ['species', 'body', 'hair', 'face', 'outfit'];

const one = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const chance = (rng, probability) => rng() < probability;
const between = (rng, [low, high]) => low + rng() * (high - low);
// 自訂色只骰「好看的範圍」：不要太灰、太暗或太刺眼。
const randomHex = (rng, { s = [0.35, 0.75], l = [0.4, 0.75] } = {}) => rgbToHex(hslToRgb({ h: rng() * 360, s: between(rng, s), l: between(rng, l) }));
const setList = (target, key, values) => { if (values.length) target[key] = values; else delete target[key]; };

function rollSpecies(dna, rng) {
  // 三成多是人類，其餘平均分給有預設特徵的種族（「其他」不骰）。
  const kind = chance(rng, 0.35) ? L.speciesKinds.find((item) => item.id === 'human') : one(rng, L.speciesKinds.filter((item) => item.preset && item.id !== 'human'));
  const { extras, ...slots } = kind.preset;
  dna.species = { kind: kind.id, ...slots };
  setList(dna.species, 'extras', [...extras]);
}

// 依權重挑：常見的頭身多一點，Q 版少一點。
const weighted = (rng, entries) => {
  let target = rng() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of entries) { target -= weight; if (target < 0) return value; }
  return entries.at(-1)[0];
};

function rollBody(dna, rng) {
  const body = (dna.body ||= {});
  body.headRatio = weighted(rng, [['2.5', 0.05], ['4', 0.1], ['5.5', 0.2], ['6.5', 0.25], ['7.5', 0.25], ['8', 0.15]]);
  body.build = one(rng, L.builds).id;
  // Q 版、4 頭身不配「高挑、極高」。
  body.height = one(rng, ['2.5', '4'].includes(body.headRatio) ? L.heights.filter((height) => ['petite', 'short', 'average'].includes(height.id)) : L.heights).id;
  body.skin = one(rng, L.skinTones).id;
}

function rollHair(dna, rng) {
  const hair = (dna.hair ||= {});
  const style = one(rng, L.hairStyles);
  hair.style = style.id;
  Object.assign(hair, style.defaults);
  hair.color = chance(rng, 0.7) ? one(rng, L.hairColors).id : randomHex(rng, { s: [0.3, 0.7], l: [0.4, 0.8] });
  if (chance(rng, 0.3)) {
    hair.accent = one(rng, L.hairColors.filter((color) => color.id !== hair.color)).id;
    hair.accentStyle = one(rng, L.hairDyeStyles).id;
  } else {
    hair.accent = null;
    delete hair.accentStyle;
  }
  setList(hair, 'extras', chance(rng, 0.25) ? [one(rng, L.hairExtras).id] : []);
}

function rollFace(dna, rng) {
  const face = (dna.face ||= {});
  face.mood = one(rng, L.moods).id;
  face.eyeShape = one(rng, L.eyeShapes).id;
  face.brows = one(rng, L.brows).id;
  face.eyeColor = chance(rng, 0.75) ? one(rng, L.eyeColors).id : randomHex(rng, { s: [0.45, 0.85], l: [0.4, 0.65] });
  // 偶爾出異色瞳：左眼換一個不同的預設色。
  face.eyeColorLeft = chance(rng, 0.12) ? one(rng, L.eyeColors.filter((color) => color.id !== face.eyeColor)).id : null;
  if (chance(rng, 0.3)) face.pupil = one(rng, L.pupils.filter((pupil) => pupil.id !== 'round')).id; else delete face.pupil;
  face.shape = one(rng, L.faceShapes).id;
  setList(face, 'marks', chance(rng, 0.25) ? [one(rng, L.faceMarks).id] : []);
}

function rollOutfit(character, rng, outfitId) {
  const outfit = character.outfits?.[outfitId] || Object.values(character.outfits || {})[0];
  if (!outfit) return;
  const style = one(rng, L.outfitStyles);
  const spec = { ...(outfit.spec || {}), style: style.id, ...style.defaults };
  // 配色從角色色票挑 2～3 個（色票不夠就不動配色）。
  const palette = [...(character.palette || [])];
  if (palette.length >= 2) {
    const count = Math.min(palette.length, chance(rng, 0.5) ? 2 : 3);
    const picked = [];
    while (picked.length < count) { const swatch = one(rng, palette.filter((item) => !picked.includes(item.id))); picked.push(swatch.id); }
    spec.colors = picked;
  }
  outfit.spec = spec;
}

export function rollDice(character, category, { rng = Math.random, outfitId } = {}) {
  if (!diceCategories.includes(category)) return false;
  if (category === 'outfit') { rollOutfit(character, rng, outfitId); return true; }
  character.dna ||= {};
  ({ species: rollSpecies, body: rollBody, hair: rollHair, face: rollFace })[category](character.dna, rng);
  return true;
}
