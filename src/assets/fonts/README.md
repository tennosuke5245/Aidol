# AIDOL 本機字型

## 2.0 新增字型（2026-10-06）

AIDOL 2.0「紙與墨」在既有介面字型之外加入三套本機字型，全部是未修改的官方 WOFF2，CSS 在 `src/theme/fonts-extra.css`：

| 字型 | 來源 | 本機資料夾 | CSS family | 使用 |
| --- | --- | --- | --- | --- |
| Noto Serif TC（variable，200–900） | `@fontsource-variable/noto-serif-tc@5.3.0` | `noto-serif-tc-variable/`（108 份 WOFF2＋OFL） | `AIDOL Serif` | 頁面標題、角色名、設定稿標題欄 |
| 霞鶩文楷 TC（400） | `@fontsource/lxgw-wenkai-tc@5.3.0` | `lxgw-wenkai-tc/`（115 份 WOFF2＋OFL） | `AIDOL Hand` | 便利貼 |
| IBM Plex Mono（400、500，Latin） | `@fontsource/ibm-plex-mono@5.3.0` | `ibm-plex-mono/`（2 份 WOFF2＋OFL） | `AIDOL Mono` | 編號、版本、hex、時間 |

`manifest-2.0.json` 記錄 225 個檔案（10,385,696 bytes）的路徑、bytes 與 SHA-256。三套均為 SIL OFL 1.1，授權全文與原 copyright 在各資料夾的 `OFL.txt`。檔案只是從上列 npm 套件取出 WOFF2；未把套件加入 app 相依，不使用遠端 stylesheet。保留各分片原本的 `unicode-range`，沒有依目前文案裁字。

以下為 1.x 起使用、2.0 仍作為介面正文的字型。

選定日期：2026-10-02。採 **Inter 英數＋Noto Sans TC 繁中**。日式簡約由清楚的字形、字重與留白建立；介面不指定 Georgia、Segoe UI 或未提供的字型家族。

## 正式字型與來源

| 字型 | 固定來源／版本 | 本機檔案 | 使用 |
| --- | --- | --- | --- |
| Inter Variable | [官方 v4.1 tag 的 web WOFF2](https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable.woff2)；內部 font version `4.001;git-9221beed3` | `InterVariable-4.1.woff2`，352,240 bytes | 英數、品牌文字、工具介面；weight 100–900，optical size 14–32 |
| Noto Sans TC | [Google 官方 CSS2](https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@100..900&display=block)的 `notosanstc/v40` 完整官方分片；上游來源 TTF 為 `2.004-H2`，Google Fonts commit `b950a7257470b900078f2bf3223823a8602de7e1` | `noto-sans-tc-v40/` 共 108 份 WOFF2，合計 4,276,832 bytes | 繁中、標點及 Inter 未涵蓋的字元；weight 100–900 |

Inter WOFF2 的 SHA-256 已與 [官方 Inter-4.1.zip](https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip)中的 `web/InterVariable.woff2` 比對相同。Noto 分片保留官方 CSS 的所有 `unicode-range`，沒有按目前 UI 文案裁字。`noto-sans-tc-v40.google-css.txt` 是下載當日的官方來源快照，不由 app 匯入；正式 `src/fonts.css` 的 109 個 font URL 全部指向本機檔案。

`manifest.json` 保存每個檔案的精確官方 URL、bytes 與 SHA-256；下方亦列出各檔 hash。更新字型時應重新檢查來源、授權、字重、分片與樣張，不依賴可變動的 `latest` 或遠端 stylesheet。

## 授權

- Inter：[原始 OFL 1.1](Inter-OFL.txt)，原 copyright 與授權全文保留。
- Noto Sans TC：[原始 OFL 1.1](NotoSansTC-OFL.txt)，原 copyright 與授權全文保留；其 Reserved Font Name 為 Source。

以上均使用未修改的官方字型檔。CSS 的 `AIDOL Inter`、`AIDOL Noto Sans TC` 是本機 `@font-face` 載入別名，不修改字型內部 family／glyph。散布軟體時保留對應授權與 copyright；不將字型單獨販售。未新增字型下載服務、IBM npm 套件或 telemetry 安裝腳本。

## CSS 契約

`src/fonts.css` 提供 `--font-ui`、`--font-latin`、`--font-brand` 與 `--font-note`。前兩個正式 family 均已實際提供，不以 `local()` 使用使用者電腦上未知版本，不串接遠端 URL。`font-display: block` 避免字型載入時先顯示其他家族；本機載入失敗仍須修復資產，不能把瀏覽器隱含 fallback 當作成功。

啟用 `font-optical-sizing: auto`、正常 kerning、`liga`／`calt`；`font-synthesis: none` 避免假粗體或假斜體。UI 使用 400／500／600 真實 variable weights，正文 14／22 px，次要操作 13／20 px，metadata 12／18 px，卡片標題 16／24 px，面板標題 18／26 px，角色名 22／30 px。390 px 維持可讀字級，以內容與面板切換處理空間。

品牌文字建議 Inter 500、21–24 px、`letter-spacing: .16em–.18em`；保留專用 logo 的識別，這組排版不宣稱品牌圖形已定稿。數量、版本與時間可用 `font-variant-numeric: tabular-nums`。繁中正文不增加大幅 letter-spacing；較長說明維持 22–24 px 行高。

## SHA-256

官方 Google CSS 快照 SHA-256：`214792d3d6b70f09bad265ace63e9b907b41c19107c3fbe0f652719e5b4e1bc8`。

| 本機檔案 | SHA-256 |
| --- | --- |
| `noto-sans-tc-v40/000.woff2` | `6c02ade36f32d2cd4d1ca5c571d9060c946e8ea52be9645fcbd5ee3bfc07603a` |
| `noto-sans-tc-v40/001.woff2` | `d457693e96ab1dcfc36686344764b972c6652d9acfee44b2387be23fc596cf7a` |
| `noto-sans-tc-v40/002.woff2` | `9094e9e133cb9478ca5ca7dcbc23e45f16e7975d185cc1918c14564dbc4c3930` |
| `noto-sans-tc-v40/003.woff2` | `ecede38f43c38ee2b436ff9a6571b0c32a24c55560fa28f06b61b2e04bbb1165` |
| `noto-sans-tc-v40/004.woff2` | `eebfd4ca29167c424d7c7d5bf7aa8a826549fba2d681ba2935f40c2347a808f3` |
| `noto-sans-tc-v40/005.woff2` | `f0528779b2b46349960446692940dc1db4c19e2e8993f61209509346afebf642` |
| `noto-sans-tc-v40/006.woff2` | `49cabbad3eb1f64e4d9c8bde5b88ed93f3bb9bd4ceee2f8864a66a57a917b73c` |
| `noto-sans-tc-v40/007.woff2` | `c8ce7e021739e994f93f966a0b494afd55f16c73c870bfb4cd04aa97456deed5` |
| `noto-sans-tc-v40/008.woff2` | `3b6dc765d038d51dc2af8c8f893de4360c97d6ddd8b133bbf4073fa4734cc32c` |
| `noto-sans-tc-v40/009.woff2` | `b6468632a982f10a396097737e223f16a164158a26dae8d8515803d1c5a0a2f9` |
| `noto-sans-tc-v40/010.woff2` | `088cd1f52afad19783795550b3e1f7638d0de532052114a8a9e07855b68b6636` |
| `noto-sans-tc-v40/011.woff2` | `314f0610f39d77be6a575d3555a8ea8752a8e43e44c6289e8bc7816bd6db38a2` |
| `noto-sans-tc-v40/012.woff2` | `426ae2261dded173e816962b2fa52f8d2ab7a4027abfeb51f72ae1b07ba83a1a` |
| `noto-sans-tc-v40/013.woff2` | `0c9d3f4aaae85670ef963ff19ddd0869f5df98b97f20ded0b2a2df4360e9c97a` |
| `noto-sans-tc-v40/014.woff2` | `234f5abd49775a931a8510085895c965a52c42574913999971e20c8107a058ac` |
| `noto-sans-tc-v40/015.woff2` | `c486db9be5cca4a8174766a32c777d908ddc9c680e99138199039444d2c4fffc` |
| `noto-sans-tc-v40/016.woff2` | `d1f65a3e26e0cf75bf1540ecad280eff5c71f9e7a186add374a353225eab18e5` |
| `noto-sans-tc-v40/017.woff2` | `326baed1ec97c92ee1eaf6021d2a68f5b986b804d5d72c2137f7c108bcecba0d` |
| `noto-sans-tc-v40/018.woff2` | `0cdb041a2cec515317a2712fed379e754ac64d255a666d0ee20bf1939d716cfb` |
| `noto-sans-tc-v40/019.woff2` | `5cff39b472ccbb34eb7c97ab695f34b60425763ccd4e966c3584d5985e374f8c` |
| `noto-sans-tc-v40/020.woff2` | `88be081caedef7e870b5cb78ceecde6f852ee425631cee910ba12595f64419ea` |
| `noto-sans-tc-v40/021.woff2` | `9f28103cc9df09b63e982d84697a28022d6febaf0edf79666c34bb9c4029330e` |
| `noto-sans-tc-v40/022.woff2` | `6c6b0117a1020f2a6670f5da96c6c43d29926db6ad190fc893bd9a11a27e7d46` |
| `noto-sans-tc-v40/023.woff2` | `2b1cbdfa0990978d83c9ffe1d61534b2d68cf3b8e2d9581e6e3915a22e42136d` |
| `noto-sans-tc-v40/024.woff2` | `0238395c06a1445bd6de04ca46805330769019211854918ff2511f24909d7c65` |
| `noto-sans-tc-v40/025.woff2` | `1cd9285d4c99e780206f27e2f79db148d060df22808184a058e1229a69e42c25` |
| `noto-sans-tc-v40/026.woff2` | `790e83a902f6b90cf54bfb0830aa3c23f6f5b4841e1ee0c6a4cf981529f32901` |
| `noto-sans-tc-v40/027.woff2` | `5ac667848284ce3450b7373a930f9833d00b8551134af3bebe571a3c038bd56b` |
| `noto-sans-tc-v40/028.woff2` | `ed069b810c60b76031f8dfb42451ca4f464181c301c4a8b3e9a3c9b287cf46c7` |
| `noto-sans-tc-v40/029.woff2` | `b1f653b66b76b580fb1b6b47e47a7a821002b4fe32b2e59ff8b3d5f0048a01b6` |
| `noto-sans-tc-v40/030.woff2` | `9a94e55f634e8ffee37fa17c3850ec2267ebda2305b7218f753d163d3e1f499b` |
| `noto-sans-tc-v40/031.woff2` | `2f07826edf58aa3c5b3252fd0b492a5db718bc2277595e877f74a3922e522727` |
| `noto-sans-tc-v40/032.woff2` | `b05c43b9fbc824d1cf0f65792178c5adef0fed538599db18871bae49091cb6ca` |
| `noto-sans-tc-v40/033.woff2` | `3b751524c75e785fe22a849afb69e9ea0c8285efddf90aaf728507ad29758f4e` |
| `noto-sans-tc-v40/034.woff2` | `5517719fef79c98311b0891ddc4843cda2de11155fa62c53fdf96be1c492b871` |
| `noto-sans-tc-v40/035.woff2` | `0ed01e2146232fa54c4b60b827d45044fede55c7866a7803ec0ee706849f6a16` |
| `noto-sans-tc-v40/036.woff2` | `a280f30b51ac3596982009fe2ecfb3e56491a6b51406ff6f036f908ed7e152dd` |
| `noto-sans-tc-v40/037.woff2` | `42a440a7c25ccd18db399db1712d97a6a4ba7bbc4243056e3230fea9711a2f48` |
| `noto-sans-tc-v40/038.woff2` | `66d434f0ae9097969fbe53aed5d2b00c09688b744144af26d6393de7cbb8aba0` |
| `noto-sans-tc-v40/039.woff2` | `a28f661f37a88c395ddf477a0a0f70ad91164bdfbb0226b0bb2dfd9c93e9ee8a` |
| `noto-sans-tc-v40/040.woff2` | `c0d46806506b8ec52d5c110bd99a8aee3356d6c523dd51a9dbb85728c489acd1` |
| `noto-sans-tc-v40/041.woff2` | `a894d743d810bd696de0152315d8f0fc072c0eb8d4ec1148417546c29421075c` |
| `noto-sans-tc-v40/042.woff2` | `ff4d786d68227cc68998e93ffe2b13acfa4357737106f77cff157c0514f49fa7` |
| `noto-sans-tc-v40/043.woff2` | `b488365d2c1f4185c93a9acdcf49ac23b70a8e26e98e16f8b1cfe43c81add70e` |
| `noto-sans-tc-v40/044.woff2` | `6b975089993f845c713721afde6d64598443dbb4d4933ef45d4b538fd1e72b93` |
| `noto-sans-tc-v40/045.woff2` | `f8d8a533c5680c350e2d460f002fc9426942b550f16fc2a8873079e6a46962b8` |
| `noto-sans-tc-v40/046.woff2` | `58f630fa8bf9aea0e525364976eaaecfbc9479b593dd5e19d298173bb664fdc9` |
| `noto-sans-tc-v40/047.woff2` | `4ddf5cf6479c0768c2a73e4e3cf1c1f1d306127d947f65352290d4486a8e1fa1` |
| `noto-sans-tc-v40/048.woff2` | `2ddb05cd176cc897c761da4d5c85f318a392bd48f5c939f41f3c0ea69bd364e3` |
| `noto-sans-tc-v40/049.woff2` | `9387fea46c7324d4848cf259f78efde050d672007a7699744436f589d883e1e6` |
| `noto-sans-tc-v40/050.woff2` | `004fb3bf3d2b2a1ac1451d6d3000899ec3714e7ac83669f850c13fa3dbf2fe51` |
| `noto-sans-tc-v40/051.woff2` | `f91edeb30fc645ce0bc55c2f16df909d4e63082778a5e4b7de81b0f44e6fa4f9` |
| `noto-sans-tc-v40/052.woff2` | `f0a253a9bdb4843e3f15371d4b00031f87fa89949a2485aded714bfcab2976cc` |
| `noto-sans-tc-v40/053.woff2` | `296dbb017d008e68db19b0f4c78129115e5c8ecabb0b2c0f7ca5a673893b565c` |
| `noto-sans-tc-v40/054.woff2` | `ff31f68ea61f3e28bf9fe0799159a98ab1e490125adb8ed1be43df4b672ffcf6` |
| `noto-sans-tc-v40/055.woff2` | `66e6ad9edbcf1949083573c70c505ca3ceb5ad6a16ffb70c701388db207c8970` |
| `noto-sans-tc-v40/056.woff2` | `f6f2ded38ea2b042c8370555fe03a3038b3fa522d21cd9ee3aa5d0f6a08915f5` |
| `noto-sans-tc-v40/057.woff2` | `990c9a6dac4bf31746b5309579f4c9499aabd8557c97e9d2a519185933d2f5be` |
| `noto-sans-tc-v40/058.woff2` | `4ba7c9e1e0f92416f8cbdf4f32ece2d85ea5739075ba02db111ad789be8eb1bf` |
| `noto-sans-tc-v40/059.woff2` | `816dbef3671ea13a22635f4b9719f07ba6221ee2fa9c0ebab34f31d64caf0394` |
| `noto-sans-tc-v40/060.woff2` | `09328e751aa3c6061d732650474a714471887eca6e24c3b07319263725c47872` |
| `noto-sans-tc-v40/061.woff2` | `2e6df54804b12401ca46e3c70d3f2427daa8b8bfca192897af7503361af6e2da` |
| `noto-sans-tc-v40/062.woff2` | `e90f057942f083207de756e3b8ab5bb266bdfa2f6852cb17190e5c4538d0a3f1` |
| `noto-sans-tc-v40/063.woff2` | `9682a7b585e3f5981fe2782fa131d2b97f1170f6f35b3904129fc03d5c6d35ce` |
| `noto-sans-tc-v40/064.woff2` | `1a86ca2076d65ff35bc1bd876b12a25fd2b694e67bd3d6e9941f1d683b39073a` |
| `noto-sans-tc-v40/065.woff2` | `1a150ec2312381138818b912d56646aacf3928bf9ead9b2f7e7dbb9f14a46d21` |
| `noto-sans-tc-v40/066.woff2` | `50205076f92c6c6b9f036baa6122940d94a90e3b955636212e2347d6eeee7704` |
| `noto-sans-tc-v40/067.woff2` | `9eb7dc0620859909e6590521f6e0dae5745735ee0f43eb5d999c35a87c00eb1c` |
| `noto-sans-tc-v40/068.woff2` | `d8c6ae8d760fb0dc9e3ae738ec39d7f59c4fd8a20bdc7df24fbfd19d2139b272` |
| `noto-sans-tc-v40/069.woff2` | `b4d3f257df642b398a54e4b6d7dc258ef4b7845d5217cf921addc8c2e497e336` |
| `noto-sans-tc-v40/070.woff2` | `b660b94ffdee1a2391c2624c6f986e600cc0a2f9246bc1d9703772f82dec7f03` |
| `noto-sans-tc-v40/071.woff2` | `a91699833e572f444396fd01c22911d96217a9985836a01012afdbcaa76919e0` |
| `noto-sans-tc-v40/072.woff2` | `22a61580361ee1d7fe2b16009ee7be2209e3396073c98312d65d66a542d146a8` |
| `noto-sans-tc-v40/073.woff2` | `0d20e6fd4e4e6b971683454457021ecb7fa9c50d556a20ef03bac14d9e5a3dd4` |
| `noto-sans-tc-v40/074.woff2` | `3602d527734568a2ad44e5e3c9ac42fe8390e44e0ccc21213d2da2befb89038c` |
| `noto-sans-tc-v40/075.woff2` | `5dea5d7c90e9a878ee23a896523e7222a5b315e10e79c9c145c353b66dd48c1c` |
| `noto-sans-tc-v40/076.woff2` | `3b813fe4b8c5d434e3e58209d146220e5fb2997dffd55f4b2939ff27a2bbade3` |
| `noto-sans-tc-v40/077.woff2` | `b917262e9496b3bc21467bd640035308023de4bc86ec87539633be98537c2743` |
| `noto-sans-tc-v40/078.woff2` | `b9845afe4397f2da8de8542a857e601a34a674ed08809071691e96c44cc1f56d` |
| `noto-sans-tc-v40/079.woff2` | `2dda6ce387eef98b8582558f9cbb3e08a5d928e61d9643a761b2f705b36993c9` |
| `noto-sans-tc-v40/080.woff2` | `56611d848f44a92476ccb8781af3d43fbb2900dc87209299f245d04ec8dd24d9` |
| `noto-sans-tc-v40/081.woff2` | `ea0552a02bc1f5e3a28222fc865ea76c4b303f2e1d1dcec7cb6ad405ac28a192` |
| `noto-sans-tc-v40/082.woff2` | `a094bf63505a81bdc7ec8aa96ad14a74ae2b3c7f8ef4754d4ff0f5358acfea57` |
| `noto-sans-tc-v40/083.woff2` | `9a34f46cd87f8c3aa6c7164eecd40c18180642c3b9e1dc7083c24455d5174a9a` |
| `noto-sans-tc-v40/084.woff2` | `978066722e0ac2678fa92b638e31c1fa5e241cd6fe4a93bbad74a2bb8a617edf` |
| `noto-sans-tc-v40/085.woff2` | `15a3289663ef298196ff7d89999cb089166c81861378f106f23f5b3ab0da263a` |
| `noto-sans-tc-v40/086.woff2` | `52389083c0cb10b5dc929e84930e3aebcae3da09aa59d721ce39bfc09f98e4c2` |
| `noto-sans-tc-v40/087.woff2` | `1e8cef5ded9ee0e4dbd99329a02b1648334e576e619277e576dbc13616a8b99a` |
| `noto-sans-tc-v40/088.woff2` | `a8bc8a4dfae3e4786a72ec6bd54d053ffb9e2609008479668302a71a5cb5c069` |
| `noto-sans-tc-v40/089.woff2` | `01d7f4274d5b7028052fa63794a3797825604adbd5b51999fdc6b921998991d1` |
| `noto-sans-tc-v40/090.woff2` | `9b7e654129ab88f7ee94e02818fb5eb5f8989132cf11c6416d5b9dbf296df09f` |
| `noto-sans-tc-v40/091.woff2` | `abae95e3826f978b0978a2ab95ad5950083d622b0062015cd35a59bad9b57afa` |
| `noto-sans-tc-v40/092.woff2` | `2f4eae1564547c8c6e7d98c99cdf9030a8818919044fbb12cb310fff6b87e962` |
| `noto-sans-tc-v40/093.woff2` | `0e85e4c6e63427b665853ddc5fb776701e2468f871714ebe06e59b2d2782ffce` |
| `noto-sans-tc-v40/094.woff2` | `c6e3ff02c4731e75690733704fd98cf221fb6b30a7771609da43540f2cbf4951` |
| `noto-sans-tc-v40/095.woff2` | `ac5ae500abac5300c2f4ca3b3d3099b95f08ae621ad4b3cfd9070ec05d14ce99` |
| `noto-sans-tc-v40/096.woff2` | `0a7164a350c89cbb4c6d93603635f716ea45b0c7e44bc36de61929fe8a9d1e5d` |
| `noto-sans-tc-v40/097.woff2` | `6e5488052f51942126a739cb06b5857137bf228af36ce2efeb5fe54ca89f7ee1` |
| `noto-sans-tc-v40/098.woff2` | `1c4a603f3e81bc14bd358c0cb0450a660e8ce219acc6a6aa3212bc717cfb47e4` |
| `noto-sans-tc-v40/099.woff2` | `bc646cb3adcf00c25fe385d7d5379406c7b914b56f7008d81a3f93b9aef159d7` |
| `noto-sans-tc-v40/100.woff2` | `c3a3f199038b1f5e3291b5dc8a735c42b92443f0746d94ae9350d4ff01459e1a` |
| `noto-sans-tc-v40/101.woff2` | `44597d9384000cefb7f5422b2b57e702c68ff7a0a7e88af5a92d883a78e75b5b` |
| `noto-sans-tc-v40/102.woff2` | `60fb3c9aa8191f17e22e412909677d94e451016ed848db090b5bbaf4f93ed64b` |
| `noto-sans-tc-v40/103.woff2` | `a37c636cdd34e8722012a074342a6e4b4d3f0ee6ebc0653353b77466877a22aa` |
| `noto-sans-tc-v40/104.woff2` | `ac7ee765809e6557601d66a92c02b4cdab707b6067822a4b14769fa37601431b` |
| `noto-sans-tc-v40/105.woff2` | `b03b6554ea3075239368c128196861b8fbc6d3ae8b3d08a2ef28b74846b5a2c5` |
| `noto-sans-tc-v40/106.woff2` | `72d2f215ff5764c0cdf6c0f7d8167020aabea565a333bdb37f334d81f2036d21` |
| `noto-sans-tc-v40/107.woff2` | `ab0e8e76a5f721db5e7a0a673e821b129470976f84b60d212686b428dbd2f3b5` |
| `NotoSansTC-OFL.txt` | `1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9` |
| `InterVariable-4.1.woff2` | `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3` |
| `Inter-OFL.txt` | `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a` |
