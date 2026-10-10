// 2026-10-09 以前的存檔紀錄只存了繁中原文（沒有 messageKey）。換成其他語言時，照固定句型對回翻譯 key。
// 這裡的中文是比對舊資料用的，不是介面文字（check:i18n 允許這個檔案）。
export const legacyHistory = [
  [/^建立範例角色$/, 'demoCreated'], [/^建立角色草案$/, 'draftCreated'], [/^更新人物設定$/, 'settingsUpdated'], [/^採用人物設定提案$/, 'proposalAccepted'],
  [/^AI 拆解裝備：新增 (\d+) 件$/, 'decomposeAdded', match => ({ count: Number(match[1]) })], [/^AI 拆解裝備：更新位置$/, 'decomposeMoved'],
  [/^採用角色設定稿候選$/, 'sheetAdopted'],
  [/^採用(.+?)(正面主圖|完整主圖|背面|細節)候選$/, 'partAdopted', match => ({ name: match[1], view: { 正面主圖: 'front', 完整主圖: 'full', 背面: 'back', 細節: 'detail' }[match[2]] })],
  [/^恢復第 (\d+) 版設定$/, 'restored', match => ({ revision: Number(match[1]) })],
];
