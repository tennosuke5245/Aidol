import { formatDate, isSource, t } from './i18n';

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
export const targetLabel = (project, id) => id === 'character' ? t('common.mainIllustration') : project?.character.components[id]?.name || [...(project?.history || [])].reverse().find(entry => entry.character.components[id])?.character.components[id]?.name || t('common.pastPiece');
