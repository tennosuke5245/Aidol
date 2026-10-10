<div align="center">

<img src="src/assets/brand/aidol-icon-v3.svg" width="112" alt="AIDOL logo">

<h1>AIDOL</h1>

<p><b>給動漫、遊戲角色設計師用的角色設計工作室。</b><br>
捏好角色，交給 Codex 畫，所有服裝配件都整理在同一張畫布上。</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tennosuke5245/Aidol?color=E5C27A&labelColor=161A30" alt="License"></a>
  <img src="https://img.shields.io/badge/status-early%20preview-E5C27A?labelColor=161A30" alt="Status: early preview">
  <img src="https://img.shields.io/badge/platform-Windows-ECEEF7?labelColor=161A30" alt="Platform: Windows">
  <img src="https://img.shields.io/badge/Bun-runtime-ECEEF7?logo=bun&logoColor=white&labelColor=161A30" alt="Bun">
  <img src="https://img.shields.io/badge/React-19-ECEEF7?logo=react&logoColor=white&labelColor=161A30" alt="React 19">
  <img src="https://img.shields.io/badge/Tauri-2-ECEEF7?logo=tauri&logoColor=white&labelColor=161A30" alt="Tauri 2">
  <a href="https://ko-fi.com/tennosuke5245"><img src="https://img.shields.io/badge/Ko--fi-support-E5C27A?logo=ko-fi&logoColor=white&labelColor=161A30" alt="Support on Ko-fi"></a>
</p>

<p><a href="README.md">English</a> · <b>繁體中文</b> · <a href="README.ja.md">日本語</a></p>

<img src="assets/screenshots/canvas.png" alt="AIDOL 畫布：角色在中間，裝備連在兩側" width="100%">

</div>

## AIDOL 是什麼？

AIDOL（AI + IDOL）是給角色設計師用的桌面 App。你可以像玩遊戲的創角畫面一樣，一點一點調整角色。想看圖的時候，AIDOL 會把工作交給 [Codex](https://openai.com/codex/) 去畫，畫好的圖會回到 App 裡讓你挑。

角色資料存成一般的 YAML 檔，不會被鎖在某段聊天紀錄裡。

## 功能

- **畫布**：打開角色，正式立繪在中間，鞋子、外套、配件排在兩側並自動連線。節點拖到哪就停在哪，不會亂跑。
- **捏角色**：髮型、瀏海、眼型、體型、服裝風格都有縮圖，點一下就換上；年齡、身高、髮長用滑桿調，畫風用九個旋鈕轉。
- **交給 Codex 畫**：按「開始繪製」，AIDOL 會在 Codex 開好新對話、把要求填好，你按送出就好。每畫好一張，卡片就翻開一張，喜歡哪張就用哪張。
- **自動拆裝備**：選定正式立繪後，Codex 會看圖列出角色身上的東西，每一件都會出現在畫布上，縮圖直接從立繪裁出來。
- **AI 幫忙寫設定**：寫下大概的想法，讓 AI 補完人設。每一項改動都會先給你看，按了才會套用。
- **不怕弄丟**：自動存檔，可以復原、重做，也能讀取以前的存檔。圖片不會被覆蓋。
- **匯出**：把角色打包成 ZIP，裡面有 YAML、好讀的人設和所有圖片。
- **三種語言**：繁體中文、English、日本語，第一次打開依系統語言，之後可在語言選單切換；日文介面用日文字型。AI 寫的人設目前仍是繁體中文。

<div align="center">
<img src="assets/screenshots/creator.png" alt="AIDOL 捏角色：右邊是髮型縮圖，中間是正式立繪" width="100%">
</div>

## 需要準備

| | 用途 |
|---|---|
| Windows | 桌面版。其他系統還沒測過。 |
| [Bun](https://bun.sh/) | 執行與建置 AIDOL |
| Codex CLI（已登入） | AI 寫設定、自動拆裝備 |
| Codex App | 畫圖。用的是你自己的訂閱；AIDOL 不會偷偷改用另外計費的 Image API。 |
| Rust + MSVC 建置工具 | 只有要自己打包桌面版才需要（[Tauri 環境需求](https://tauri.app/start/prerequisites/)） |

## 下載

Windows 安裝檔在 [Releases 頁面](https://github.com/tennosuke5245/Aidol/releases)。安裝檔還沒有程式碼簽章，Windows 可能會跳出「Windows 已保護您的電腦」：按「其他資訊」→「仍要執行」即可。

想從原始碼執行，看下面的「開始使用」。

## 開始使用

```powershell
git clone https://github.com/tennosuke5245/Aidol.git
cd Aidol
bun install

bun run dev:core   # 本機核心：http://127.0.0.1:4318
bun run dev        # 另開一個終端機，網頁介面：http://127.0.0.1:4173
```

打包 Windows 安裝檔：

```powershell
bun run desktop:build
```

桌面版會自己啟動本機服務，不用另外開 Bun 或 Vite。

## 畫圖的流程

AIDOL 只顯示真的發生的事，不會有假的進度條。

1. **到 Codex 按送出**：工作準備好了，Codex 也開好新對話，等你按送出。
2. **繪製中 n／N**：Codex 回報開始畫了，`n` 是已經回來的張數。
3. **新圖**：真的有圖回來了。還在畫的時候就可以先挑。
4. **已採用**：正式立繪或裝備圖已更新。之後才回來的圖還是會收進圖鑑。
5. **這次沒畫成**：Codex 回報失敗和原因。你的要求都還在，可以再試一次。

用舊設定畫的圖一樣可以用，只是會標示出來。

Codex 是透過 [AIDOL Skill](.agents/skills/aidol/SKILL.md) 回報進度的。這個 skill 跟著專案一起提供，每次交接都會附上；它只會把圖送回你自己電腦上的 AIDOL（localhost）。

## 資料存在哪裡

- 開發模式：專案資料夾裡的 `.aidol/projects/`（不會進 git）。
- 桌面版：App 資料夾底下的 `runtime/projects/`。
- 每個角色有一份 `character.yaml`（人設、畫風、裝備、採用的圖）和一份 `project.json`（畫布上的便利貼與位置）。

AIDOL 產出的是設計圖，不是分好圖層的 PSD、Live2D 模型或打版用的紙型。

## 開發

```powershell
bun run build        # 先建置，有一個測試會檢查建置結果
bun test tests
bun run check:oss    # 發佈前檢查有沒有不該公開的東西
bun run check:i18n   # 檢查介面文字沒有寫死在程式裡、三種語言的 key 一致
```

| 路徑 | 內容 |
|---|---|
| `src/` | 介面（React） |
| `server/` | 本機核心：存檔、圖片、工作、Codex 串接 |
| `shared/` | 資料格式、樣式庫、提示詞組裝、差異比對與合併 |
| `src-tauri/` | Windows 桌面殼 |
| `.agents/skills/aidol/` | Codex 處理 AIDOL 工作時用的 skill |

所有環境變數都列在 [`.env.example`](.env.example)。

## 支持這個專案

如果 AIDOL 對你有幫助，可以在 [Ko-fi 請我喝杯咖啡](https://ko-fi.com/tennosuke5245)，讓我有動力繼續做下去。

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/tennosuke5245)

## 參與貢獻

歡迎開 issue 或送 pull request，開始前請先看 [CONTRIBUTING.md](CONTRIBUTING.md)。發現安全性問題請照 [SECURITY.md](SECURITY.md) 私下回報。

## 授權

程式碼以 [MIT License](LICENSE) 釋出。內附字型使用 SIL Open Font License，示範角色和選項縮圖是 AI 生成的，詳見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
