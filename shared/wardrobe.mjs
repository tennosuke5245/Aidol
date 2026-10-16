// 衣裝差分（2026-10-13 起）：每套穿搭可以有自己的立繪。
// 正式立繪（character.adopted.character）屬於「主要那套」；其他套的立繪放在 project.json 的
// wardrobe.items[穿搭代號]（和三視圖、表情集一樣是成品，不是角色設定，採用不進版本）。
// 三視圖、表情集一律跟著正式立繪（主要那套）。這裡只放不碰檔案的部分，前端與本機核心共用。

const hasOutfit = (project, outfitId) => typeof outfitId === 'string' && Object.hasOwn(project?.character?.outfits || {}, outfitId);

// 主要那套：正式立繪畫的時候用的穿搭；那套被刪掉了（或舊資料沒記）就是第一套。
export function mainOutfitId(project) {
  const outfits = project?.character?.outfits || {};
  const main = project?.character?.adopted?.character;
  const asset = main && (project.assets || []).find((item) => item.id === main);
  if (asset?.outfitId && Object.hasOwn(outfits, asset.outfitId)) return asset.outfitId;
  return Object.keys(outfits)[0] || null;
}

// 「另一套」：已經有正式立繪，而且這套不是主要那套。這套畫的立繪放進衣櫃，不換正式立繪。
export function isOutfitVariant(project, outfitId) {
  return Boolean(project?.character?.adopted?.character && hasOutfit(project, outfitId) && outfitId !== mainOutfitId(project));
}

// 這套穿搭的立繪（圖片代號）：主要那套是正式立繪，其他套看衣櫃；還沒畫是 null。
export function outfitPortraitId(project, outfitId) {
  if (!hasOutfit(project, outfitId)) return null;
  if (isOutfitVariant(project, outfitId)) {
    const assetId = project.wardrobe?.items?.[outfitId]?.assetId;
    return assetId && (project.assets || []).some((item) => item.id === assetId) ? assetId : null;
  }
  return outfitId === mainOutfitId(project) ? project.character.adopted?.character || null : null;
}

export const outfitPortrait = (project, outfitId) => {
  const assetId = outfitPortraitId(project, outfitId);
  return assetId ? (project.assets || []).find((item) => item.id === assetId) || null : null;
};

// 這套穿搭已經刪掉了（服裝頁的「刪除這套」，或恢復到沒有這套的存檔）。照它畫的立繪不能採用：
// 衣服對不上任何一套，放進衣櫃或當正式立繪都會錯。衣櫃裡記的那張不清掉，復原這套之後就回來。
export const outfitRemoved = (project, outfitId) => typeof outfitId === 'string' && outfitId !== '' && !hasOutfit(project, outfitId);

// 照這套穿搭畫的立繪工作（不含三視圖的角度、表情集）：刪掉這套後當成結束，還沒挑的圖不再提醒。
export const removedOutfitJob = (project, job) => job?.targetId === 'character' && ['front', 'full'].includes(job.outputView || 'front') && outfitRemoved(project, job.outfitId);

// 衣櫃還沒有立繪的另一套穿搭（全自動的「衣櫃」，2026-10-14 起）：照套裝的順序；要先有正式立繪。
export function outfitsToDraw(project) {
  return Object.keys(project?.character?.outfits || {}).filter((outfitId) => isOutfitVariant(project, outfitId) && !outfitPortraitId(project, outfitId));
}
export const nextOutfit = (project) => outfitsToDraw(project)[0] || null;

// 套裝最多幾套（角色格式的上限）。
export const OUTFIT_LIMIT = 100;

// 把刪掉的套裝放回設定（提示上的「復原」、圖鑑的「復原套裝」、核心把正式立繪那套放回去）：放回原本的位置；
// 之後才拿掉的裝備、色票不帶回來（不然存檔會因為引用不存在的東西失敗）。已經在、或已經滿了就不動，回傳 false。
export function restoreOutfit(character, outfitId, outfit, index = Infinity) {
  const outfits = character?.outfits || {};
  if (!outfit || typeof outfitId !== 'string' || Object.hasOwn(outfits, outfitId) || Object.keys(outfits).length >= OUTFIT_LIMIT) return false;
  const swatches = new Set((character.palette || []).map((swatch) => swatch.id));
  const restored = { ...structuredClone(outfit), id: outfitId, equipped: (outfit.equipped || []).filter((item) => Object.hasOwn(character.components || {}, item.componentId)).map((item) => ({ ...item })) };
  if (restored.spec?.colors) restored.spec.colors = restored.spec.colors.filter((color) => swatches.has(color));
  const entries = Object.entries(outfits);
  entries.splice(Math.max(0, Math.min(index, entries.length)), 0, [outfitId, restored]);
  character.outfits = Object.fromEntries(entries);
  return true;
}

// 刪掉的套裝最後的樣子（存檔紀錄裡最近一版還有它的）：圖鑑的「復原套裝」用；找不到是 null。
export function removedOutfitSnapshot(project, outfitId) {
  if (!outfitRemoved(project, outfitId)) return null;
  const entry = [...(project.history || [])].reverse().find((item) => item.character?.outfits?.[outfitId]);
  return entry ? { outfit: entry.character.outfits[outfitId], index: Object.keys(entry.character.outfits).indexOf(outfitId) } : null;
}
