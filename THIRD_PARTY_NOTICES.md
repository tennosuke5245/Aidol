# 第三方授權與素材來源

AIDOL 的程式碼以 [MIT License](LICENSE) 釋出。下列隨附素材各有自己的授權或來源說明。

## 字型

全部是未修改的官方 WOFF2，依 [SIL Open Font License 1.1](https://openfontlicense.org/) 散布；授權全文與原 copyright 放在字型旁，桌面版另外附在 `public/licenses/fonts/`。來源與版本見 [src/assets/fonts/README.md](src/assets/fonts/README.md)，每個檔案的 SHA-256 記錄在同資料夾的 `manifest.json` 與 `manifest-2.0.json`。

| 字型 | Copyright | 位置 | 授權全文 |
|---|---|---|---|
| Inter 4.1 | The Inter Project Authors | `src/assets/fonts/InterVariable-4.1.woff2` | [Inter-OFL.txt](src/assets/fonts/Inter-OFL.txt) |
| Noto Sans TC | Adobe，Reserved Font Name "Source" | `src/assets/fonts/noto-sans-tc-v40/` | [NotoSansTC-OFL.txt](src/assets/fonts/NotoSansTC-OFL.txt) |
| Noto Serif TC | Adobe（依字型檔記載；授權檔取自 fontsource 套件） | `src/assets/fonts/noto-serif-tc-variable/` | [OFL.txt](src/assets/fonts/noto-serif-tc-variable/OFL.txt) |
| 霞鶩文楷 TC（LXGW WenKai TC） | The LXGW WenKai Project Authors | `src/assets/fonts/lxgw-wenkai-tc/` | [OFL.txt](src/assets/fonts/lxgw-wenkai-tc/OFL.txt) |
| IBM Plex Mono | IBM Corp. | `src/assets/fonts/ibm-plex-mono/` | [OFL.txt](src/assets/fonts/ibm-plex-mono/OFL.txt) |

字型不得單獨販售；修改字型時須依 OFL 改名。

## AI 生成的圖片

- `public/assets/rin-*.png`：內建示範角色「凜」的設定稿與裝備圖，以 ChatGPT 的圖像生成（gpt-image）產生。檔案保留原本的 C2PA 來源資訊；每張圖的提示詞記錄在 `public/assets/assets-prompts.json`。
- `src/assets/options/**/*.webp`：捏角色選項的中性人台縮圖，以 ChatGPT 的圖像生成逐一產生後縮小轉檔。

這些圖片隨本專案以 MIT License 提供。AI 生成內容的著作權狀態依各地法律而定，使用前請自行判斷。

## 相依套件

npm 與 Cargo 相依套件依各自的授權散布，版本記錄在 `bun.lock` 與 `src-tauri/Cargo.lock`。
