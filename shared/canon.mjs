// 定稿：標成 canon 的參考圖就是角色長相的正確答案。畫圖時設計照定稿，只改視角、姿勢與排版。
// 定稿之後使用者又改了外觀設定，那些改動要明確列給 AI（「除了這些，其他照定稿」），其餘一律不動。
import { describeChanges } from './character-diff.mjs';

export const canonReferences = (character) => (character?.style?.references || []).filter((reference) => reference.canon);

// 只有會改變「長相」的設定才算；人設文字、畫風與部件狀態不算。
const designAreas = new Set(['appearance', 'dna', 'palette', 'locks', 'parts', 'outfits']);

// 從存檔紀錄最新的一版往回找：這些參考圖一直都是定稿的最早那一版，就是定稿當時的設定。
export function canonBaseline(history = [], character) {
  const ids = canonReferences(character).map((reference) => reference.id);
  if (!ids.length) return null;
  const isCanon = (entry) => ids.every((id) => (entry?.character?.style?.references || []).some((reference) => reference.id === id && reference.canon));
  let baseline = null;
  for (let index = history.length - 1; index >= 0 && isCanon(history[index]); index--) baseline = history[index].character;
  return baseline;
}

// 定稿之後才改的外觀設定。outfitId：只列這次要畫的那套穿搭的改動。
export function canonChanges(history, character, { outfitId, tr } = {}) {
  const baseline = canonBaseline(history, character);
  if (!baseline) return [];
  return describeChanges(baseline, character, tr).filter((change) => designAreas.has(change.areaKey) && change.key !== 'partStatus' && (!change.outfitId || !outfitId || change.outfitId === outfitId));
}
