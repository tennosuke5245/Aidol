import * as L from '../../shared/libraries.mjs';

export const uid = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export function setDna(character, part, key, value) {
  character.dna ||= {};
  character.dna[part] ||= {};
  if (value === undefined) delete character.dna[part][key]; else character.dna[part][key] = value;
}

// 舊角色沒有畫風方向時補上一個「日常動畫」，之後的旋鈕都調整目前方向。
export function ensureDirection(character) {
  character.style.directions ||= {};
  if (!Object.keys(character.style.directions).length) character.style.directions.A = { id: 'A', name: '日常動畫', mixer: L.defaultMixer() };
  if (!character.style.directions[character.style.activeDirection]) character.style.activeDirection = Object.keys(character.style.directions)[0];
  return character.style.directions[character.style.activeDirection];
}

export function activeMixer(character) {
  const directions = character.style?.directions || {};
  return (directions[character.style?.activeDirection] || Object.values(directions)[0])?.mixer || L.defaultMixer();
}

export const kindLabels = { hair: '髮型', garment: '服裝', footwear: '鞋靴', accessory: '配件', weapon: '武器', body: '身體特徵', other: '其他' };
export const roleLabels = { style: '畫風', identity: '外觀特徵', color: '配色', clothing: '服裝結構', material: '材質', composition: '構圖' };

export function outfitOf(character, outfitId) {
  return character.outfits?.[outfitId] || Object.values(character.outfits || {})[0];
}
