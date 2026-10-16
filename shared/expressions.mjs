// 表情集（2026-10-13 起）：同一個角色的胸像表情，照正面定稿一張一張畫，採用後只放進表情集（不換正式立繪、不進版本）。
// 資料在 project.json 的 expressions（和三視圖的 views 一樣是成品，不是角色設定）：
//   list：表情集裡有哪些表情（順序就是排列順序）；沒動過時是預設的六個。
//   custom：自訂表情 { [key]: { name, note } }。
//   items：畫好的 { [key]: { assetId, sourceAssetId（畫的時候照的正面）, sourceMain（那時的正式立繪）, at } }。
// 這裡只放不碰檔案的部分，前端與本機核心共用。
import * as libraries from './libraries.mjs';

export const EXPRESSION_LIMIT = 24;
export const customExpressionKey = /^custom-[a-z0-9]{6,12}$/;

export const expressionList = (expressions) => (Array.isArray(expressions?.list) ? expressions.list : [...libraries.defaultExpressionSet]);

// 表情的名稱、交給 AI 的說明（繁中、英文）。lib 傳目前語言的樣式庫（名稱跟著換；brief 與 prompt 一律原文）。
export function expressionInfo(expressions, key, lib = libraries) {
  if (typeof key !== 'string') return null;
  const preset = lib.expressionPresets.find((item) => item.id === key);
  if (preset) return { key, label: preset.label, brief: preset.brief, prompt: preset.prompt, custom: false };
  const custom = customExpressionKey.test(key) ? expressions?.custom?.[key] : null;
  return custom ? { key, label: custom.name, brief: custom.note ? `${custom.name}：${custom.note}` : custom.name, prompt: '', note: custom.note || '', custom: true } : null;
}

// 畫表情照的正面：拆好的三視圖正面（目前這張正式立繪的），不然就是正式立繪本身。
export function expressionFront(project) {
  const main = project?.character?.adopted?.character;
  if (!main) return null;
  const views = project.views;
  return views?.status === 'done' && views.assetId === main && views.items?.front?.assetId ? views.items.front.assetId : main;
}

// 照舊的設計畫的（正式立繪之後換過）：還留著，但畫面提醒可以重畫。
// 看的是「那時的正式立繪」：同一張立繪重新裁切正面不算換設計。
export function expressionStale(project, key) {
  const item = project?.expressions?.items?.[key];
  const main = project?.character?.adopted?.character;
  if (!item || !main) return false;
  if (item.sourceMain) return item.sourceMain !== main;
  return Boolean(item.sourceAssetId && item.sourceAssetId !== main && item.sourceAssetId !== expressionFront(project));
}

// 取景參考：已經畫好的「一般」，沒有就是表情集裡第一個畫好的（不含這次要畫的那個）。整套表情才對得齊。
// 照舊立繪畫的不能當取景參考：AI 會把舊的設計一起帶進來。
export function framingReference(project, key) {
  const items = project?.expressions?.items || {};
  const order = ['neutral', ...expressionList(project?.expressions).filter((item) => item !== 'neutral')];
  const found = order.find((item) => item !== key && items[item]?.assetId && !expressionStale(project, item));
  return found ? items[found].assetId : null;
}

// 要畫的表情：還沒畫的，加上照舊立繪畫的（舊設計）。「一般」排第一（決定取景），其他照表情集的順序。
export function expressionsToDraw(project) {
  const list = expressionList(project?.expressions);
  const items = project?.expressions?.items || {};
  const order = list.includes('neutral') ? ['neutral', ...list.filter((item) => item !== 'neutral')] : list;
  return order.filter((key) => !items[key]?.assetId || expressionStale(project, key));
}

// 下一個要畫的表情（全自動用）。
export const nextExpression = (project) => expressionsToDraw(project)[0] || null;
