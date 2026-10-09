<div align="center">

<img src="src/assets/brand/aidol-icon-v3.svg" width="112" alt="AIDOL logo">

<h1>AIDOL</h1>

<p><b>アニメ・ゲームのキャラクターデザイナーのためのデザインスタジオ。</b><br>
キャラクターを作り込み、絵は Codex に任せて、衣装パーツは一枚のキャンバスにまとめる。</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tennosuke5245/Aidol?color=E5C27A&labelColor=161A30" alt="License"></a>
  <img src="https://img.shields.io/badge/status-early%20preview-E5C27A?labelColor=161A30" alt="Status: early preview">
  <img src="https://img.shields.io/badge/platform-Windows-ECEEF7?labelColor=161A30" alt="Platform: Windows">
  <img src="https://img.shields.io/badge/Bun-runtime-ECEEF7?logo=bun&logoColor=white&labelColor=161A30" alt="Bun">
  <img src="https://img.shields.io/badge/React-19-ECEEF7?logo=react&logoColor=white&labelColor=161A30" alt="React 19">
  <img src="https://img.shields.io/badge/Tauri-2-ECEEF7?logo=tauri&logoColor=white&labelColor=161A30" alt="Tauri 2">
  <a href="https://ko-fi.com/tennosuke5245"><img src="https://img.shields.io/badge/Ko--fi-support-E5C27A?logo=ko-fi&logoColor=white&labelColor=161A30" alt="Support on Ko-fi"></a>
</p>

<p><a href="README.md">English</a> · <a href="README.zh-TW.md">繁體中文</a> · <b>日本語</b></p>

<img src="assets/screenshots/canvas.png" alt="AIDOL のキャンバス：中央にキャラクター、両側に衣装パーツ" width="100%">

</div>

> アプリの画面は現在、繁体字中国語のみです。

## AIDOL とは

AIDOL（AI + IDOL）は、キャラクターデザインをする人のためのデスクトップアプリです。ゲームのキャラクリのような感覚でキャラクターを少しずつ調整できます。絵が欲しくなったら、AIDOL が [Codex](https://openai.com/codex/) に作業を渡し、仕上がった画像がアプリに戻ってくるので、その中から選びます。

キャラクターの情報は普通の YAML ファイルに保存されるので、チャット履歴の中に埋もれることはありません。

## できること

- **キャンバス**：キャラクターを開くと、中央に立ち絵、両側にブーツやジャケット、小物などのパーツが並び、線でつながっています。ドラッグした場所からノードが勝手に動くことはありません。
- **キャラクター作成**：髪型、前髪、目の形、体型、服のスタイルはサムネイルをクリックするだけ。年齢・身長・髪の長さはスライダー、画風は9つのダイヤルで調整します。
- **Codex に描いてもらう**：「開始繪製」（描画開始）を押すと、AIDOL が Codex に新しいチャットを開いて依頼内容を入力しておきます。あとは送信を押すだけ。1枚描き上がるごとにカードがめくれ、気に入ったものを選べます。
- **衣装の自動分解**：立ち絵を決めると、Codex が絵を見てキャラクターが身に着けているものを書き出します。各パーツは立ち絵から切り抜いたサムネイル付きでキャンバスに追加されます。
- **AI による設定づくり**：ざっくりしたアイデアを書けば、AI がプロフィールを補います。変更点はすべて先に表示され、適用するかどうかは自分で決められます。
- **なくならない**：自動保存、元に戻す／やり直し、過去のセーブの読み込みに対応。画像が上書きされることはありません。
- **書き出し**：YAML、読みやすいプロフィール、すべての画像を ZIP にまとめてダウンロードできます。

<div align="center">
<img src="assets/screenshots/creator.png" alt="AIDOL のキャラクター作成画面：右に髪型のサムネイル、中央に立ち絵" width="100%">
</div>

## 必要なもの

| | 用途 |
|---|---|
| Windows | デスクトップ版。ほかの OS はまだ検証していません。 |
| [Bun](https://bun.sh/) | AIDOL の実行とビルド |
| Codex CLI（ログイン済み） | AI による設定づくり、衣装の自動分解 |
| Codex App | 画像の生成。ご自身のサブスクリプションを使います。別料金の Image API に勝手に切り替えることはありません。 |
| Rust + MSVC ビルドツール | デスクトップ版を自分でビルドするときだけ（[Tauri の前提条件](https://tauri.app/start/prerequisites/)） |

## はじめかた

```powershell
git clone https://github.com/tennosuke5245/Aidol.git
cd Aidol
bun install

bun run dev:core   # ローカルコア：http://127.0.0.1:4318
bun run dev        # 別のターミナルで。Web 画面：http://127.0.0.1:4173
```

Windows インストーラーのビルド：

```powershell
bun run desktop:build
```

デスクトップ版はローカルサービスを自分で起動するので、Bun や Vite を別に立ち上げる必要はありません。

## 描画の流れ

AIDOL は実際に起きたことだけを表示します。見せかけの進捗バーはありません。

1. **Codex で送信待ち**：準備ができて、Codex に新しいチャットが開いています。Codex で送信を押してください。
2. **描画中 n／N**：Codex から開始の報告がありました。`n` は戻ってきた枚数です。
3. **新しい画像**：実際に画像が届きました。残りを描いている途中でも選べます。
4. **採用済み**：立ち絵または衣装の設計図が更新されました。あとから届いた画像もギャラリーに入ります。
5. **今回は描けませんでした**：Codex から失敗とその理由が届きました。依頼内容は残っているので、もう一度試せます。

古い設定で描かれた画像も使えます。その場合は印が付くだけです。

Codex は [AIDOL Skill](.agents/skills/aidol/SKILL.md) を通じて進捗を報告します。この skill はリポジトリに含まれていて、毎回の依頼に添付されます。画像の送り先は自分のパソコン上の AIDOL（localhost）だけです。

## データの保存場所

- 開発モード：プロジェクトフォルダ内の `.aidol/projects/`（git には含まれません）。
- デスクトップ版：アプリのデータフォルダ内の `runtime/projects/`。
- キャラクターごとに `character.yaml`（プロフィール、画風、衣装パーツ、採用した画像）と `project.json`（キャンバス上のメモと配置）があります。

AIDOL が作るのはデザイン画です。レイヤー分けされた PSD、Live2D モデル、型紙は作りません。

## 開発者向け

```powershell
bun run build        # 先にビルド（ビルド結果を確認するテストがあります）
bun test tests
bun run check:oss    # 公開してはいけないものが含まれていないかチェック
```

| パス | 内容 |
|---|---|
| `src/` | 画面（React） |
| `server/` | ローカルコア：保存、画像、ジョブ、Codex 連携 |
| `shared/` | データ形式、スタイルライブラリ、プロンプト組み立て、差分とマージ |
| `src-tauri/` | Windows デスクトップのシェル |
| `.agents/skills/aidol/` | Codex が AIDOL の依頼を処理するときの skill |

環境変数はすべて [`.env.example`](.env.example) にあります。

## サポート

AIDOL が役に立ったら、[Ko-fi でコーヒーを一杯](https://ko-fi.com/tennosuke5245)おごってもらえるとうれしいです。開発を続ける励みになります。

## コントリビュート

Issue や Pull Request は歓迎です。はじめに [CONTRIBUTING.md](CONTRIBUTING.md)（繁体字中国語）を読んでください。セキュリティの問題は [SECURITY.md](SECURITY.md) の手順で非公開で報告してください。

## ライセンス

コードは [MIT License](LICENSE) で公開しています。同梱フォントは SIL Open Font License、デモキャラクターと選択肢のサムネイルは AI で生成したものです。詳しくは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) をご覧ください。
