# AIDOL 角色設計工作室

AIDOL（AI + IDOL）是給人物設計師用的角色設計工作室：與 Codex 共創日式動漫／遊戲人物的人設、繪風與服裝裝備。Bun 本機核心、React 關聯畫布與 Tauri 桌面版共用同一套資料及操作流程。

> 專案仍在早期開發（0.1.x），資料格式與介面都可能調整。目前只有 Windows 桌面版的建置流程經過實際驗證。

## 功能

打開一個角色，先看到的是**角色畫布**：角色站在中間，裝備排在兩側並自動連線。點角色進入**捏角色**改外觀、畫立繪；立繪定案後，AIDOL 會請 Codex 從立繪拆出裝備，畫布上自動長出裝備節點。介面是安靜的深色工作台，不發光，圖最亮。

1. **角色選單**：每位角色一張立繪卡（還沒有立繪的用中性人台代替），卡上顯示最需要處理的狀態（例如「新圖 2」），點一下直接打開那次繪製。最後一張「創造新角色」：取個名字就能開始，也可以附一句描述讓 AI 寫設定。
2. **畫布**：人物節點顯示正式立繪；裝備節點排在兩側，高度盡量對齊它在立繪上的位置，連線一律從人物節點的邊框以同一種曲線拉出。節點排好就固定：拖一個不會牽動其他節點；新拆出的裝備只找空位放。點裝備打開右側裝備欄：改名字、種類、穿戴位置與描述，看正面／背面／細節設計圖，按「畫設計圖」照著立繪單獨畫，或脫下、不要這件。工具列可以新增裝備、便利貼、說明、參考圖，縮放、聚焦、全覽，「整理」把裝備重新排回人物兩側。
3. **自動拆解裝備**：把一張圖設為正式立繪後會自動開始；完成後裝備節點淡入並連線。裝備還沒有設計圖時，縮圖是從立繪裁出的真實位置。需要已安裝並登入的 Codex CLI；失敗會說明原因，可以再試一次，也能手動新增。
4. **捏角色**：左側分類欄是 角色／身形／髮型／五官／服裝／色彩／裝備／畫風；中間是正式立繪（外觀在立繪之後改過時會提醒重畫）；右側是選項。髮型、瀏海、神情、眼型、眉毛、體型、服裝風格、輪廓、層次用中性人台縮圖，點一下就換上；年齡、頭身、身高、髮長、蓬度用滑桿；畫風的九個旋鈕抓著轉。
5. **自動存檔**：所有修改自動存檔，頂欄可以復原／重做（Ctrl＋Z／Ctrl＋Shift＋Z）。「更多 → 存檔紀錄」可以讀取舊存檔，圖片與後面的紀錄都會保留。
6. **AI 寫設定**：在「角色」寫下想法請 AI 補完；寫好的內容逐項列出，按「全部套用」才會改，也可以按「不要」。等 AI 的時候你繼續捏也沒關係，套用時只合併 AI 真正改動的地方。
7. **開始繪製**：捏角色底部寫下這次想畫什麼（可不填）、選取景與張數（×1／×2／×4），按「開始繪製」。AIDOL 會開好 Codex 新對話並填好提示，你到 Codex 按送出；畫面會出現對應張數的卡背，每畫好一張就翻開一張，直接在卡上「設為立繪」。收起來不會取消，進度架隨時可以點回來。
8. **圖鑑**：這個角色畫過的所有圖。點開放大，可以設為正式、和目前的比較（擦拭滑桿）、框選局部修改、用一樣的要求再畫；還沒有圖回來的繪製列在上方，也能手動放入圖片。

繪製狀態只依實際收到的資料呈現，不會用模擬進度：

- 「到 Codex 按送出」：工作與固定快照已建立，Codex 新對話已準備好，仍需你按送出。
- 「繪製中 n／N」：AIDOL Skill 回報已開始；n 是已回來的張數。送出前不會出現。
- 「新圖 n」：真實圖片已回到 AIDOL；還在畫時顯示「新圖 n，還在畫」，可以先挑。
- 「已採用」：正式立繪或裝備設計圖已更新。採用後同一次繪製晚到的圖仍會收進圖鑑，之後也能換回別張。
- 「這次沒畫成」：Skill 回報失敗與原因；要求與設定都保留，可以再試一次。
- 「未送出」：用較早的設定準備、從沒送出的繪製，不會再催你；按「開始繪製」會用目前設定重新準備。

用較早的設定畫的圖照樣可以採用，只會標示「用較早的設定畫的」。

## Codex 整合

- 文字協作（AI 寫設定、拆解裝備）使用已安裝並登入的 Codex CLI，透過官方 app-server 協定，每次開新的 thread。
- 圖片生成交給 Codex App 的圖像工具（使用你自己的訂閱）。交接會開新對話並預填兩三行短提示（畫什麼、工作資料夾）；細節與回報方式寫在該工作的 `instructions.md`，你仍需在 Codex 按送出。
- 沒有可用的圖像工具時保留工作，也可以在圖鑑手動放入圖片。AIDOL 不會切換到另行計費的 Image API。
- 交接用的 [AIDOL Skill](.agents/skills/aidol/SKILL.md) 隨專案提供，每次交接會一併附上；也可以從「更多 → 原始設定檔與 Codex 連線」或 `bun run skill:install` 安裝到 `~/.codex/skills/aidol`。
- Skill 只會把圖片回傳到本機 loopback 的 AIDOL 核心，並以每個工作各自的交接憑證驗證。

## 需求

- [Bun](https://bun.sh/)
- Codex CLI（文字協作與拆解裝備）、Codex App（圖片生成）
- 建置 Windows 桌面版另需 Rust 與 MSVC C++ 工具鏈（見 [Tauri 的環境需求](https://tauri.app/start/prerequisites/)）

## 開發

```powershell
bun install
bun run dev:core
# 另一個終端機
bun run dev
```

Web 介面為 `http://127.0.0.1:4173`；本機核心為 `http://127.0.0.1:4318`，只接受 localhost 存取。開發伺服器預設只綁 127.0.0.1，因為它會把 `/api` 轉給本機核心；真的需要從其他裝置開啟時，才在 `.env.local` 設定 `AIDOL_DEV_HOST`。

```powershell
bun run build         # 建置前端到 dist/client（另附 Sites 部署用的 dist/server 與 dist/.openai）
bun test tests        # 單元與整合測試；Sites 打包測試需要先 build
bun run desktop:build # 建置 Windows 桌面版（NSIS 安裝檔）
```

桌面建置會先建前端，再把 `server/` 編譯成 Bun standalone sidecar，最後由 Tauri 產生 NSIS 安裝檔。桌面程序自行指定隨機 localhost port 並管理 sidecar；重複啟動會切回原視窗。發佈暫存驗證可使用 `bun scripts/build-sidecar.mjs --stage`。

可用的環境變數列在 [`.env.example`](.env.example)，例如 `AIDOL_DATA_DIR`、`AIDOL_PORT`、`AIDOL_SKILL_SOURCE`。

## 資料

- 開發模式存於 `.aidol/projects/`；桌面模式存於 Tauri 的使用者 App Data 下 `runtime/projects/`。兩者是獨立資料庫，`.aidol/` 不會進版本控制。
- `character.yaml` 是正式人物描述，包含人設、身份、繪風、部件、穿搭與採用圖引用；領域關係由它產生。schema_version 2 加入選填的 `dna`、`palette`、`locks`、`style.directions`／`activeDirection` 與 `outfits[].spec`；舊檔不用遷移，文字設定仍優先。
- `project.json` 的 `canvasAnnotations` 保存便利貼、說明及自由參考卡的內容、色調與位置；`decomposition` 記錄自動拆解裝備的狀態。裝備在立繪上的位置框存在 `character.yaml` 裝備的 `crop`。
- 工作保存 `input.yaml`、指定穿搭、輸出視角或取景、張數、畫風方向、編譯後的結構化 DNA、圖片雜湊、位置標註與交接說明。新修訂重新建立工作，不繼續累積舊聊天。
- 圖片不可覆寫；採用、恢復及修改都保留版本歷史。
- 「更多 → 匯出角色資料」的 ZIP 包含人物 YAML、可閱讀人設、圖片、工作快照、manifest 與 `canvas.json`；回收憑證不會匯出。

輸出的是設計圖片，不是已拆好的 PSD 圖層、Live2D rig 或可直接量產的服裝版型。

## 模組

| 模組 | 責任 |
|---|---|
| `shared/domain.mjs` | Schema、YAML 與引用驗證 |
| `shared/agent-workspace.mjs` | 真實繪製狀態、待處理摘要與同套裝比較 |
| `shared/libraries.mjs` | 樣式庫：身形、髮型、臉、服裝、色彩與畫風混音台資料 |
| `shared/prompt-compiler.mjs` | 把角色 DNA、色票、鎖定特徵與畫風方向編譯成交接說明 |
| `shared/character-diff.mjs` | 把兩版設定的差異整理成設計師看得懂的變更清單；AI 提案的三方合併 |
| `server/store.mjs` | 原子保存、版本 CAS、圖片與採用、工作、ZIP |
| `server/codex/client.mjs` | 官方 app-server 協定、每次新的文字 thread |
| `server/integrations.mjs` | Codex 狀態、描述提案、立繪讀圖拆解裝備、新對話交接、生成進度回報與成果回收 |
| `src/` | 介面：`App.jsx` 畫面切換、`useStudio.js` 資料、`Workspace.jsx` 角色工作台、`CanvasView.jsx`／`CharacterGraph.jsx`／`canvas-layout.mjs` 畫布與裝備欄、`creator/` 捏角色、`Summon.jsx` 繪製翻牌、`Gallery.jsx` 圖鑑；樣式在 `src/theme/` |
| `src-tauri/` | Windows 視窗、單一實例、本機程序及 Codex deep link |
| `.agents/skills/aidol/` | 交接給 Codex 的人物描述與真實出圖協作 Skill |

## 參與

歡迎 issue 與 pull request，開發慣例見 [CONTRIBUTING.md](CONTRIBUTING.md)；安全性問題請依 [SECURITY.md](SECURITY.md) 私下回報。

## 授權

程式碼以 [MIT License](LICENSE) 釋出。內附字型各依其 SIL Open Font License 1.1，示範角色圖與選項縮圖為 AI 生成；詳見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
