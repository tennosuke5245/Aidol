# 安全性政策

## 回報弱點

請不要在公開 issue 裡描述弱點。請使用 GitHub 儲存庫的 **Security → Report a vulnerability**（private vulnerability reporting）私下回報，並附上重現步驟、影響範圍與版本。

## 支援範圍

目前只維護 `main` 分支的最新版本。

## 安全設計重點

- 本機核心只綁定 `127.0.0.1`，並檢查 `Host` 只能是 localhost；跨來源請求只接受同源、桌面版、開發伺服器與 `AIDOL_ALLOWED_ORIGINS` 列出的 Origin。
- 交接給 Codex 的每個工作各有隨機憑證，只存在該工作資料夾的 `handoff.json`，不會寫進預填的提示，也不會匯出到 ZIP；AIDOL Skill 只會把圖片與進度回傳到 loopback 位址。
- 桌面版視窗只有 `core:default` 權限；shell 外開只允許 `codex://new` deep link。
