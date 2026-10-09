import { spawn } from 'node:child_process';
import { mkdir, cp, access, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.env.AIDOL_TARGET_TRIPLE || (process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : process.platform === 'darwin' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin` : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`);
const executable = path.join(root, 'src-tauri', 'binaries', `aidol-core-${target}${process.platform === 'win32' ? '.exe' : ''}`);

async function mirrorGeneratedResources(source, destination) {
  const generatedRoot = path.join(root, 'src-tauri');
  const relativeDestination = path.relative(generatedRoot, path.resolve(destination));
  if (!relativeDestination || relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination)) throw new Error('資源目的地必須位於本專案的 src-tauri 產物目錄內。');
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true, force: true });
}

async function run() {
  const desktopConfig = JSON.parse(await readFile(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  await access(path.join(root, 'dist', 'client', 'index.html'));
  await mkdir(path.dirname(executable), { recursive: true });
  const resources = path.join(root, 'src-tauri', 'resources');
  await mkdir(resources, { recursive: true });
  await mirrorGeneratedResources(path.join(root, 'dist', 'client'), path.join(resources, 'client'));
  await mirrorGeneratedResources(path.join(root, 'public'), path.join(resources, 'public'));
  await mirrorGeneratedResources(path.join(root, '.agents', 'skills', 'aidol'), path.join(resources, 'skill'));
  const bun = process.env.AIDOL_BUN_BINARY || (process.versions.bun ? process.execPath : process.platform === 'win32' ? 'bun.exe' : 'bun');
  const child = spawn(bun, ['build', 'server/codex/desktop-entry.mjs', '--compile', '--minify', '--outfile', executable], { cwd: root, stdio: 'inherit', windowsHide: true });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Bun sidecar 建置失敗（${code}）。`))); });
  process.stdout.write(`AIDOL sidecar：${executable}\n`);
  const stageOption = process.argv.indexOf('--stage-dir');
  if (process.argv.includes('--stage') || stageOption >= 0) {
    // 在獨立的發佈目錄整理最新資源，不修改正在執行的 desktop binary。
    const stage = path.resolve(root, stageOption >= 0 ? process.argv[stageOption + 1] : `src-tauri/target/publish-${desktopConfig.version}`);
    const relativeStage = path.relative(path.join(root, 'src-tauri', 'target'), stage);
    if (!relativeStage || relativeStage.startsWith('..') || path.isAbsolute(relativeStage)) throw new Error('發佈暫存必須位於本專案 src-tauri/target 內的獨立目錄。');
    const release = path.join(stage, 'release');
    await mkdir(release, { recursive: true });
    const native = path.join(release, `aidol${process.platform === 'win32' ? '.exe' : ''}`);
    const nativeOption = process.argv.indexOf('--native-source');
    const nativeSource = nativeOption >= 0 ? path.resolve(root, process.argv[nativeOption + 1]) : path.join(root, 'src-tauri', 'target', 'release', `aidol${process.platform === 'win32' ? '.exe' : ''}`);
    if (!await access(native).then(() => true, () => false)) await cp(nativeSource, native);
    await cp(executable, path.join(release, `aidol-core${process.platform === 'win32' ? '.exe' : ''}`));
    await mirrorGeneratedResources(resources, path.join(release, 'resources'));
    const files = {};
    const hashDirectory = async (directory, prefix = '') => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = `${prefix}${entry.name}`;
        if (entry.isDirectory()) await hashDirectory(path.join(directory, entry.name), `${relative}/`);
        else files[relative] = createHash('sha256').update(await readFile(path.join(directory, entry.name))).digest('hex');
      }
    };
    for (const name of [`aidol${process.platform === 'win32' ? '.exe' : ''}`, `aidol-core${process.platform === 'win32' ? '.exe' : ''}`]) files[name] = createHash('sha256').update(await readFile(path.join(release, name))).digest('hex');
    await hashDirectory(path.join(release, 'resources'), 'resources/');
    await writeFile(path.join(stage, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), version: desktopConfig.version, target, externalBinarySource: executable, resourceSource: resources, files }, null, 2));
    process.stdout.write(`AIDOL 發佈暫存：${stage}\n`);
  }
}
run().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
