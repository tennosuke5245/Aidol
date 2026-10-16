import { formatDate, isSource, t } from './i18n';
import { isAngleView } from '../shared/domain.mjs';
import { expressionInfo } from '../shared/expressions.mjs';
import { isOutfitVariant, outfitRemoved } from '../shared/wardrobe.mjs';
import { L } from './lib-i18n';

export class ApiError extends Error {
  constructor(message, status, details, code) { super(message); this.status = status; this.details = details; this.code = code; }
}
// 錯誤訊息：繁中直接用本機核心寫好的原文（最具體）；其他語言依錯誤代碼翻譯，沒有對應時顯示通用說明與代碼。
// 通用的代碼（設定檔格式、引用不存在的東西）翻譯後會少掉是哪個欄位或 ID，附上核心的原文當作細節，免得資訊不見。
const keepDetail = new Set(['INVALID_INPUT', 'INVALID_CHARACTER', 'INVALID_YAML', 'UNKNOWN_ASSET', 'UNKNOWN_COMPONENT', 'UNKNOWN_SWATCH', 'UNKNOWN_DIRECTION', 'INVALID_MANIFEST']);
export function errorText(code, serverMessage, detail) {
  if (isSource() && serverMessage) return serverMessage;
  const text = code ? t(`errors.${code}`, { defaultValue: '' }) : '';
  const extra = detail || (keepDetail.has(code) ? serverMessage : '');
  if (text) return extra ? `${text} (${extra})` : text;
  return t('errors.UNKNOWN', { code: code || '?' }) + (serverMessage ? ` (${serverMessage})` : '');
}
// 丟出來的不一定是 Error：桌面版 Rust 指令失敗時是字串。提示一律要有看得懂的文字，不能出現 undefined。
export const messageOf = (error) => (typeof error === 'string' ? error : error?.message) || t('errors.UNKNOWN', { code: error?.code || '?' });
export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
    });
  } catch {
    throw new ApiError(t('errors.NETWORK'), 0, undefined, 'NETWORK');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || data.code ? errorText(data.code, data.error) : t('errors.NETWORK'), response.status, data.details, data.code);
  return data;
}
export const clone = value => structuredClone(value);
export function assetFor(project, targetId, outfitId, view = 'front') {
  if (!project) return;
  const assetId = targetId !== 'character' && view !== 'front' ? project.character.components[targetId]?.views?.[view] : project.character.adopted[targetId];
  const asset = project.assets.find(item => item.id === assetId);
  if (targetId === 'character' && outfitId && asset && (asset.outfitId || Object.keys(project.character.outfits)[0]) !== outfitId) return;
  return asset;
}
export const dateLabel = date => formatDate(date);
// 工作或圖片的目標名稱；角色的側面／背面是「三視圖・側面」（重畫三視圖的單一角度），不是正式立繪。
// 表情是「表情集・開心」；另一套穿搭的立繪是「套裝・睡衣」；照已經刪掉的套裝畫的是「已刪除的套裝・睡衣」（不是正式立繪）。
export const viewTargetLabel = (project, targetId, view, expression, outfitId) => targetId === 'character' && view === 'expression' ? t('summon.expressionTarget', { name: expressionInfo(project?.expressions, expression, L)?.label || (expression ? t('expressions.removedName') : '') })
  : targetId === 'character' && isAngleView(view) ? t('summon.viewTarget', { view: t(`canvas.views.view.${view}`) })
    : targetId === 'character' && isOutfitVariant(project, outfitId) ? t('summon.outfitTarget', { name: project.character.outfits[outfitId].name || t('creator.outfit.untitled') })
      : targetId === 'character' && project && outfitRemoved(project, outfitId) ? t('summon.outfitRemovedTarget', { name: removedOutfitName(project, outfitId) }) : targetLabel(project, targetId);
// 全自動衣櫃那一步的名稱（套裝刪掉了就用存檔紀錄裡的名字）。
export const outfitStepName = (project, outfitId) => t('autopilot.outfitStep', { name: project?.character?.outfits?.[outfitId]?.name || removedOutfitName(project, outfitId) });
// 已經刪掉的套裝叫什麼：從存檔紀錄找最近一版還有這套的。
export const removedOutfitName = (project, outfitId) => [...(project?.history || [])].reverse().find(entry => entry.character?.outfits?.[outfitId])?.character.outfits[outfitId].name || t('creator.outfit.untitled');
export const targetLabel = (project, id) => id === 'character' ? t('common.mainIllustration') : project?.character.components[id]?.name || [...(project?.history || [])].reverse().find(entry => entry.character.components[id])?.character.components[id]?.name || t('common.pastPiece');
