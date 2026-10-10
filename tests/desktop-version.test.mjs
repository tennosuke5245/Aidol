import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 發版標籤（vX.Y.Z）以 tauri.conf.json 為準；Cargo 兩處沒跟著改，安裝檔與 App 內的版本就會對不上。
test('桌面版版本號三處一致：tauri.conf.json、Cargo.toml、Cargo.lock', async () => {
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8')).version;
  const manifest = (await readFile('src-tauri/Cargo.toml', 'utf8')).match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const lock = (await readFile('src-tauri/Cargo.lock', 'utf8')).match(/\[\[package\]\]\r?\nname = "aidol"\r?\nversion = "([^"]+)"/)?.[1];
  assert.match(config, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest, config, 'Cargo.toml 的版本和 tauri.conf.json 不同');
  assert.equal(lock, config, 'Cargo.lock 裡 aidol 的版本和 tauri.conf.json 不同');
});
