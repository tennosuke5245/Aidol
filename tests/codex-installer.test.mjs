import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, access, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';

const desktopConfig = JSON.parse(await readFile(path.resolve('src-tauri/tauri.conf.json'), 'utf8'));
const stage = path.resolve(`src-tauri/target/publish-${desktopConfig.version}`);
const manifestFile = path.join(stage, 'manifest.json');
const installer = path.join(stage, `release/bundle/nsis/AIDOL_${desktopConfig.version}_x64-setup.exe`);
const extractor = 'C:\\Program Files\\7-Zip\\7z.exe';
const ready = process.platform === 'win32' && await Promise.all([manifestFile, installer, extractor].map(file => access(file).then(() => true, () => false))).then(values => values.every(Boolean));
const hash = buffer => createHash('sha256').update(buffer).digest('hex');

test('NSIS實際檔案符合發佈manifest，含最新sidecar、UI、圖片與skill', { skip: ready ? false : '需先完成 stage bundle，且本機需有 7-Zip。' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidol-installer-'));
  try {
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    assert.equal(manifest.version, desktopConfig.version, '發佈 manifest 與桌面版版本不一致');
    await promisify(execFile)(extractor, ['x', installer, `-o${directory}`, '-y'], { windowsHide: true, maxBuffer: 1000000 });
    for (const [file, expected] of Object.entries(manifest.files)) {
      assert.equal(hash(await readFile(path.join(directory, file))), expected, `installer 的 ${file} 雜湊不符`);
    }
    assert.equal(hash(await readFile(manifest.externalBinarySource)), manifest.files['aidol-core.exe']);
    const verifySource = async (source, destination) => {
      const sourceEntries = await readdir(source, { withFileTypes: true });
      assert.deepEqual((await readdir(destination)).sort(), sourceEntries.map(entry => entry.name).sort(), `${source} 與 installer 的資源清單不一致`);
      for (const entry of sourceEntries) {
        if (entry.isDirectory()) await verifySource(path.join(source, entry.name), path.join(destination, entry.name));
        else assert.equal(hash(await readFile(path.join(source, entry.name))), hash(await readFile(path.join(destination, entry.name))), `${entry.name} 不是目前 source`);
      }
    };
    await verifySource(path.resolve('dist/client'), path.join(directory, 'resources/client'));
    await verifySource(path.resolve('public'), path.join(directory, 'resources/public'));
    await verifySource(path.resolve('.agents/skills/aidol'), path.join(directory, 'resources/skill'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
