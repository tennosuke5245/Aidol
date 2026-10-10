# AIDOL 介面翻譯 / UI translations / UI の翻訳

繁體中文（`zh-TW`）是原文，另有 English（`en`）與日本語（`ja`）。**不提供簡體中文**，也不收簡體中文的翻譯。

Traditional Chinese (`zh-TW`) is the source language; English (`en`) and Japanese (`ja`) are translations. Simplified Chinese is not offered, and Simplified Chinese translations are not accepted.

## 檔案 / Files

- `src/locales/<語言>/<命名空間>.json`，格式與 i18next 相容：巢狀 JSON、`{{變數}}`、英文複數用 `key_one`／`key_other`（中日文只寫 `key_other`）。
- 程式裡：元件用 `const t = useT();` 再 `t('命名空間.key', { 變數 })`；元件外的函式 `import { t } from './i18n'`。
- 樣式庫選項（髮型、旋鈕…）：`import { L } from './lib-i18n'`，用法與 `shared/libraries.mjs` 相同；英日名稱在 `lib.json`。
- shared 模組（工作狀態、設定差異）回傳繁中原文與 key；介面用 `sharedText(key, params, 原文)`，英日翻譯在 `shared.json`。
- 本機核心的錯誤依 `code` 翻譯，見 `errors.json`。
- 日期用 `formatDate`，多個值接起來用 `formatList`（`src/i18n.js`）。
- 使用者自己寫的內容（角色名、人設、部件名稱與描述）不翻譯。
- `bun run check:i18n` 會擋住寫死在程式裡的中日文字，並檢查三種語言的 key 是否一致。

## 語氣 / Tone

- English: sentence case, short and plain, friendly but not cute. No exclamation marks. Buttons are verbs ("Start drawing").
- 日本語：文は「です・ます」、ボタンや見出しは体言止めか短い動詞（「描画開始」「採用」）。感嘆符は使わない。
- 繁中原文的口吻：簡短、口語、像設計師同事在說話。

## 用語表 / Glossary

| 繁中 | English | 日本語 |
| --- | --- | --- |
| 角色 | character | キャラクター |
| 角色選單 | Characters | キャラクター一覧 |
| 畫布 | Canvas | キャンバス |
| 捏角色 | Creator（介面頁籤）／character creator | キャラクリ |
| 立繪、正式立繪 | main illustration | 立ち絵 |
| 設定稿 | design sheet | 設定画 |
| 裝備、部件 | piece（outfit piece） | パーツ |
| 裝備欄 | pieces（list） | パーツ一覧 |
| 套裝、穿搭 | outfit | 衣装 |
| 穿戴／未穿戴 | worn / not worn（裝備卡的開關旁用 On／Off） | 着用／未着用 |
| 拆解裝備 | outfit breakdown／break down the outfit | 衣装の分解 |
| 人設 | profile | プロフィール（捏角色的分頁名稱用「人物設定」） |
| 個性 | personality | 性格 |
| 角色 DNA | character DNA | キャラクター DNA |
| 外觀 | look／appearance | 見た目 |
| 色票 | palette／palette color | カラーパレット／色 |
| 鎖定特徵 | locked features | 固定する特徴 |
| 畫風 | art style | 画風 |
| 繪風參考 | style reference | 画風リファレンス |
| 畫風方向 | style direction | 画風の方向 |
| 旋鈕（混音台） | knob（style knobs） | ダイヤル |
| 參考圖 | reference image | 参考画像 |
| 便利貼 | sticky note | 付箋 |
| 說明（畫布文字） | text note | テキスト |
| 圖鑑 | Gallery | ギャラリー |
| 開始繪製 | Start drawing | 描画開始 |
| 繪製中 | drawing | 描画中 |
| 等你送出 | ready to send | 送信待ち |
| 新圖 | new images | 新しい画像 |
| 採用、設為正式立繪 | adopt／use as main illustration | 採用／立ち絵に採用 |
| 已採用 | adopted | 採用済み |
| 這次沒畫成、失敗 | didn't work this time | 今回は描けませんでした |
| 候選 | image（candidate） | 候補 |
| 提案（AI 寫的） | suggestion | 提案 |
| 套用 | apply | 適用 |
| 存檔、自動存檔 | save／saved automatically | セーブ／自動保存 |
| 存檔紀錄 | save history | セーブ履歴 |
| 復原／重做 | undo / redo | 元に戻す／やり直し |
| 匯出 | export | 書き出し |
| 視角：正面／背面／細節／完整 | front / back / detail / full | 正面／背面／細部／全体 |
| 取景 | framing | 構図 |
| 張（圖片數量） | image(s) | 枚 |
