# 參與 AIDOL

謝謝你願意幫忙。開發環境與指令見 [README](README.md#開發)。

## 送出 pull request 前

```powershell
bun run build
bun test tests
bun run check:oss
```

`check:oss` 會檢查 git 要公開的每個檔案，擋下本機路徑、帳號名稱、Email、憑證、私人對話連結與不該公開的資料夾，也會確認 commit 用的是 GitHub noreply Email。有問題就修正後再送。

## 產品約定

- 介面與文件使用繁體中文。
- 角色描述以有版本的 `character.yaml` 為準；人物、部件、穿搭、繪風與圖稿分開，關聯圖由資料產生。
- 「繪製中」與張數只能來自 AIDOL Skill 的真實回報（`--event started/finished/failed`），送出前不得顯示進度；不可用模擬產圖或假 session 取代實際整合。
- 圖片資產不可覆寫；候選圖一律由使用者手動採用。
- 訂閱產圖由 Codex App 交接，不得默默改用另行計費的 Image API。
- 每次新的 agent 修訂使用全新 thread，只攜帶挑選過的設定與真實參考圖。

## 不要提交的東西

根目錄的 `.gitignore` 採白名單：新增根目錄檔案或資料夾時，確定可以公開才加進白名單。

- 本機角色資料（`.aidol/`）、測試暫存、建置產物（`dist/`、`src-tauri/target/` 等）
- `.env`、`.env.local` 等本機設定，以及任何交接憑證（`handoff.json` 的 token）
- 含有個人路徑或帳號名稱的檔案、截圖與紀錄
- 個人的 agent 指示檔與開發用 skills。`.agents/skills/aidol/` 是交接給 Codex 的產品 Skill，會公開；其他放在 `.agents/` 或根目錄 `AGENTS.md` 的內容只留在本機。
