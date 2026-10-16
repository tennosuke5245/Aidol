<div align="center">

<img src="src/assets/brand/aidol-icon-v3.svg" width="112" alt="AIDOL logo">

<h1>AIDOL</h1>

<p><b>A character design studio for anime and game characters.</b><br>
Build a character, let Codex draw it, and keep every outfit piece on one canvas.</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tennosuke5245/Aidol?color=E5C27A&labelColor=161A30" alt="License"></a>
  <img src="https://img.shields.io/badge/status-early%20preview-E5C27A?labelColor=161A30" alt="Status: early preview">
  <img src="https://img.shields.io/badge/platform-Windows-ECEEF7?labelColor=161A30" alt="Platform: Windows">
  <img src="https://img.shields.io/badge/Bun-runtime-ECEEF7?logo=bun&logoColor=white&labelColor=161A30" alt="Bun">
  <img src="https://img.shields.io/badge/React-19-ECEEF7?logo=react&logoColor=white&labelColor=161A30" alt="React 19">
  <img src="https://img.shields.io/badge/Tauri-2-ECEEF7?logo=tauri&logoColor=white&labelColor=161A30" alt="Tauri 2">
  <a href="https://ko-fi.com/tennosuke5245"><img src="https://img.shields.io/badge/Ko--fi-support-E5C27A?logo=ko-fi&logoColor=white&labelColor=161A30" alt="Support on Ko-fi"></a>
</p>

<p><b>English</b> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a></p>

<img src="assets/screenshots/canvas.png" alt="AIDOL canvas: the character in the middle, outfit pieces linked on both sides" width="100%">

</div>

> The interface is available in English, Traditional Chinese and Japanese. It follows your system language, and you can switch at any time from the language menu. Profiles written by the AI are still in Traditional Chinese for now.

## What is AIDOL?

AIDOL (AI + IDOL) is a desktop app for people who design characters. You describe and tweak a character the way you would in a game's character creator. When you want a picture, AIDOL hands the job to [Codex](https://openai.com/codex/), and the finished images come back into the app for you to pick from.

Your character lives in a plain YAML file, so nothing is locked inside a chat history.

## Features

- **Canvas.** Open a character and you see the main illustration in the middle, with boots, jacket, accessories and other pieces lined up on both sides and linked to it. Drag things around; they stay where you put them.
- **Character creator.** Pick hair, bangs, eyes, body type and outfit style from thumbnails. Use sliders for age, height and hair length, and turn nine knobs to set the art style. Every color can be custom (color board, hex code, or an eyedropper that picks from anywhere on screen), and there are skin tones, heterochromia, pupil shapes, facial features, highlights and ombré. Species applies elf, animal ears, dragonkin, angel and more in one click, then you fine-tune ears, horns, tail and wings. Stuck? Roll the dice to randomize a page, and undo if you don't like it. The palette page can also pull the main colors from an illustration or reference image.
- **Drawing with your Codex.** Press "Start drawing" and AIDOL draws directly with your Codex (it counts toward your ChatGPT plan), with no app switching. In settings you can hand jobs off to the Codex App instead and press send yourself. Each image flips over on its card as it arrives, and you choose which one to keep.
- **Autopilot with Design QA.** Press "Autopilot" in the top bar. AIDOL draws the full-body front, Design QA picks the best image from each batch and adopts it for you, then each angle you chose (side, back, front 3/4…) is drawn from the front one at a time. Every score and issue is visible, and you can swap back or redraw anything. You can also just ask Design QA to pick from a single batch.
- **Automatic outfit breakdown.** Once you pick a main illustration, Codex looks at it and lists what the character is wearing. Each piece shows up on the canvas, cropped from the illustration.
- **Turnaround.** Draw the front first, then add the side and back on the canvas one at a time. AIDOL sizes the three to match with the feet aligned and lines them up under the character. If one view comes out wrong, redraw just that one and say what to fix; the old image is not sent to the AI, so the mistake isn't copied. You can also import a turnaround you already have; AIDOL splits it along each figure's outline, so nothing from the neighbor slips in. Add a front 3/4, back 3/4 or other-side view when the design needs it. Click any view to compare them all side by side with the feet aligned, and pin notes on the images ("the tail grows from the middle of the lower back"); every later drawing sends those notes to the AI. Exported ZIPs include a `views/` folder with the notes.
- **Expression sheet.** "Expressions" in the top bar draws bust-up expressions one at a time from the main illustration's front (neutral, happy, angry… or your own). Draw "Neutral" first to set the framing so the whole set lines up, or press "Draw the rest" to hand it to autopilot. Download the set as one labeled image; the ZIP export gets an `expressions/` folder too.
- **Wardrobe.** The top of the Outfit page is a wardrobe with an illustration for each outfit. Start a new outfit from an occasion (day off, pajamas, uniform, winter…). Drawing another outfit keeps the face, hair and body from the main illustration and changes only the clothes, so the main illustration stays as it is.
- **Final design.** Attach an earlier design sheet when you create a character and choose "Draw exactly as this (final design)". Every later drawing keeps that design and only changes the view, pose and layout, and the AI can fill in the character's look from it.
- **AI-written profiles.** Write a rough idea and let the AI fill in the profile. You see every change before it is applied.
- **Nothing gets lost.** Everything saves automatically, with undo/redo and a full save history. Images are never overwritten.
- **Export.** Download a character as a ZIP with its YAML, a readable profile and all images.
- **Three languages.** English, 繁體中文 and 日本語, with Japanese type for the Japanese interface.

<div align="center">
<img src="assets/screenshots/creator.png" alt="AIDOL character creator: hairstyle thumbnails on the right, the main illustration in the middle" width="100%">
</div>

## What you need

| | Used for |
|---|---|
| Windows | The desktop app. Other systems are not tested yet. |
| [Bun](https://bun.sh/) | Running and building AIDOL |
| Codex CLI (signed in) | AI-written profiles, outfit breakdown, Design QA, and direct drawing when signed in with a ChatGPT account (not an API key, not the free plan). Drawing counts toward your ChatGPT plan; once that runs out, credits are used if you have them. AIDOL never switches to the separately billed Image API. |
| Codex App | Optional: only if you want to press send in the Codex App yourself. |
| Rust + MSVC build tools | Only for building the desktop app ([Tauri prerequisites](https://tauri.app/start/prerequisites/)) |

## Download

Windows installers are on the [Releases page](https://github.com/tennosuke5245/Aidol/releases). The installer isn't code-signed yet, so Windows SmartScreen may warn you: choose **More info → Run anyway**.

To run AIDOL from source instead, see Getting started below.

## Getting started

```powershell
git clone https://github.com/tennosuke5245/Aidol.git
cd Aidol
bun install

bun run dev:core   # local core on http://127.0.0.1:4318
bun run dev        # in a second terminal: web UI on http://127.0.0.1:4173
```

To build the Windows installer:

```powershell
bun run desktop:build
```

The desktop app starts its own local service, so you don't need to run Bun or Vite yourself.

## How drawing works

AIDOL only shows what really happened. There is no fake progress bar.

1. **Ready to send.** Only when handing off to the Codex App: the job is ready and Codex has a new chat open. Press send in Codex. When AIDOL draws directly, this step is skipped.
2. **Drawing n/N.** Codex reported that it started. `n` is how many images have come back.
3. **New images.** Real images arrived. You can pick one even while the rest are still drawing.
4. **Adopted.** The main illustration or outfit sheet is updated. Images that arrive later still go into the gallery.
5. **Didn't work this time.** Codex reported a failure and the reason. Your request is kept, so you can try again.

Images drawn with older settings can still be used; they are just marked as such.

When AIDOL draws directly, progress and images come from the Codex chat AIDOL opens itself. When you hand off to the Codex App, Codex reports progress through the [AIDOL Skill](.agents/skills/aidol/SKILL.md), which ships with this repo and is attached to every job. It only sends images back to AIDOL on your own machine (localhost), never through a proxy.

## Where your data lives

- Dev mode: `.aidol/projects/` in the project folder (never committed).
- Desktop app: `runtime/projects/` under the app's data folder.
- Each character has a `character.yaml` (profile, art style, outfit pieces, chosen images) and a `project.json` (canvas notes and positions).

AIDOL makes design images. It does not produce layered PSD files, Live2D rigs or sewing patterns.

## For developers

```powershell
bun run build        # build first; one test checks the build output
bun test tests
bun run check:oss    # checks that nothing private is about to be published
bun run check:i18n   # checks that no UI text is hard-coded and all three languages have the same keys
```

| Path | What's inside |
|---|---|
| `src/` | The interface (React) |
| `server/` | Local core: saving, images, jobs, Codex integration |
| `shared/` | Data schema, style library, prompt builder, diff and merge |
| `src-tauri/` | Windows desktop shell |
| `.agents/skills/aidol/` | The skill Codex uses for AIDOL jobs |

All environment variables are listed in [`.env.example`](.env.example).

## Support

If AIDOL is useful to you, you can [buy me a coffee on Ko-fi](https://ko-fi.com/tennosuke5245). It helps me keep working on it.

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/tennosuke5245)

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. To report a security problem, see [SECURITY.md](SECURITY.md).

## License

The code is released under the [MIT License](LICENSE). Bundled fonts use the SIL Open Font License, and the demo character and option thumbnails are AI-generated. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.
