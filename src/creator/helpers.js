import { t } from '../i18n';
import { L } from '../lib-i18n';

export const uid = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export function setDna(character, part, key, value) {
  character.dna ||= {};
  character.dna[part] ||= {};
  if (value === undefined) delete character.dna[part][key]; else character.dna[part][key] = value;
}

// 舊角色沒有畫風方向時補上一個「日常動畫」，之後的旋鈕都調整目前方向。
export function ensureDirection(character) {
  character.style.directions ||= {};
  if (!Object.keys(character.style.directions).length) character.style.directions.A = { id: 'A', name: L.mixerPresets.find(preset => preset.id === 'casual').label, mixer: L.defaultMixer() };
  if (!character.style.directions[character.style.activeDirection]) character.style.activeDirection = Object.keys(character.style.directions)[0];
  return character.style.directions[character.style.activeDirection];
}

export function activeMixer(character) {
  const directions = character.style?.directions || {};
  return (directions[character.style?.activeDirection] || Object.values(directions)[0])?.mixer || L.defaultMixer();
}

// 用法照舊（kindLabels[kind]），取值當下才依目前語言查名稱。
const localized = (ids, key) => Object.defineProperties({}, Object.fromEntries(ids.map(id => [id, { enumerable: true, get: () => t(key(id)) }])));
export const kindLabels = localized(['hair', 'garment', 'footwear', 'accessory', 'weapon', 'body', 'other'], kind => `panels.part.kinds.${kind}`);
export const roleLabels = localized(['style', 'identity', 'color', 'clothing', 'material', 'composition'], role => `creator.style.roles.${role}`);

export function outfitOf(character, outfitId) {
  return character.outfits?.[outfitId] || Object.values(character.outfits || {})[0];
}
