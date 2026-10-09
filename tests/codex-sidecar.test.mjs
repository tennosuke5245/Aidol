import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const executable = path.resolve('src-tauri/binaries/aidol-core-x86_64-pc-windows-msvc.exe');
const exists = await access(executable).then(() => true, () => false);

test('Bun封裝只有一個READY、整合路由可用，啟動不自動安裝skill', { skip: process.platform !== 'win32' || !exists ? '需先完成 Windows Bun sidecar 建置。' : false }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidol-binary-'));
  const child = spawn(executable, [], { windowsHide: true, env: {
    ...process.env, AIDOL_PORT: '0', AIDOL_DATA_DIR: path.join(directory, 'data'),
    AIDOL_STATIC_DIR: path.resolve('dist/client'), AIDOL_PUBLIC_DIR: path.resolve('public'),
    AIDOL_SKILL_SOURCE: path.resolve('.agents/skills/aidol'), CODEX_HOME: path.join(directory, 'codex-test-home'),
  } });
  let readyCount = 0; let stdout = '';
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.stdout.on('data', data => { stdout += data; readyCount = stdout.split('\n').filter(line => line.startsWith('AIDOL_READY ')).length; });
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('封裝服務未啟動。')), 15000);
      const data = () => {
        const line = stdout.split('\n').find(line => line.startsWith('AIDOL_READY '));
        if (line) { clearTimeout(timer); child.stdout.off('data', data); resolve(JSON.parse(line.slice(12))); }
      };
      child.stdout.on('data', data); child.once('error', reject);
    });
    assert.equal((await fetch(`${ready.url}/api/health`)).status, 200);
    assert.equal((await fetch(ready.url)).status, 200);
    const response = await fetch(`${ready.url}/api/codex/status`);
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.skill.installed, false);
    assert.equal(status.capabilities.imageGeneration, false);
    assert.equal(readyCount, 1);
    assert.equal(await access(path.join(directory, 'codex-test-home', 'skills', 'aidol', 'SKILL.md')).then(() => true, () => false), false);
  } finally {
    child.kill(); await exited;
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
