import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
import { registerCodexRoutes } from '../server/integrations.mjs';
import { newCharacter, parseCharacterYaml, characterYaml } from '../shared/domain.mjs';
import { characterArtBox, characterNodeSize, containBox, cropStyle, layoutParts, layoutPorts, partNodeSize, placeParts, portraitBox } from '../src/canvas-layout.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');

async function withPortrait(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-decompose-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const project = await store.createProject({ name: '拆解測試' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '整體立繪', kind: 'generate', baseRevision: 1 });
  const { asset, candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id });
  return { store, project, asset, candidate };
}

test('沒有正式立繪不能拆解；採用後拆出的裝備是提案、帶位置框並接上套裝', async (t) => {
  const { store, project, asset, candidate } = await withPortrait(t);
  await assert.rejects(store.startDecomposition(project.id, {}), { code: 'NO_PORTRAIT' });
  const adopted = await store.acceptCandidate(project.id, candidate.id, { baseRevision: 1 });
  const started = await store.startDecomposition(project.id, { auto: true });
  assert.equal(started.project.decomposition.status, 'running');
  assert.equal(started.asset.id, asset.id);
  assert.ok(started.path.endsWith('.png'));
  const again = await store.startDecomposition(project.id, {});
  assert.equal(again.skipped, true, '同一張立繪正在拆解時不重複開始');
  const done = await store.finishDecomposition(project.id, { assetId: asset.id, summary: '拆出外套與耳環', parts: [
    { id: 'Black Hooded Jacket!', name: '黑色連帽外套', kind: 'garment', description: '黑色防風布料。', anchor: '上身', bbox: { x: 0.2, y: 0.25, width: 0.5, height: 0.4 }, existingId: '' },
    { id: 'earring', name: '月牙耳環', kind: 'accessory', description: '黃銅。', anchor: '左耳', bbox: { x: 0.6, y: 0.12, width: 0.04, height: 0.05 }, existingId: '' },
    { id: 'broken', name: '', kind: 'other', description: '', anchor: '', bbox: { x: 0, y: 0, width: 0, height: 0 }, existingId: '' },
  ] });
  assert.equal(done.decomposition.status, 'done');
  assert.equal(done.decomposition.added, 2);
  assert.equal(done.character.revision, adopted.character.revision + 1);
  const jacket = done.character.components.black_hooded_jacket;
  assert.ok(jacket, '英文代號會整理成合法 ID');
  assert.equal(jacket.designStatus, 'proposed');
  assert.deepEqual(jacket.crop, { assetId: asset.id, x: 0.2, y: 0.25, width: 0.5, height: 0.4 });
  const outfit = Object.values(done.character.outfits)[0];
  assert.deepEqual(outfit.equipped.map(item => [item.componentId, item.anchor, item.enabled]), [['black_hooded_jacket', '上身', true], ['earring', '左耳', true]]);
  assert.equal(done.history.at(-1).message, 'AI 拆解裝備：新增 2 件');
  assert.ok(!done.syncTargets.includes('character'), '拆解不把立繪標成「設定改過」');
  // YAML 往返保留位置框；位置框引用的圖片必須存在。
  assert.deepEqual(parseCharacterYaml(characterYaml(done.character), done.assets.map(item => item.id)).components.earring.crop, done.character.components.earring.crop);
  const broken = structuredClone(done.character);
  broken.components.earring.crop.assetId = 'missing-asset';
  assert.throws(() => parseCharacterYaml(characterYaml(broken), done.assets.map(item => item.id)), { code: 'UNKNOWN_ASSET' });
});

test('重新拆解更新既有裝備的位置；過期或失敗的結果不套用', async (t) => {
  const { store, project, asset, candidate } = await withPortrait(t);
  await store.acceptCandidate(project.id, candidate.id, { baseRevision: 1 });
  await store.startDecomposition(project.id, {});
  const first = await store.finishDecomposition(project.id, { assetId: asset.id, parts: [{ id: 'coat', name: '外套', kind: 'garment', description: '', anchor: '上身', bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, existingId: '' }] });
  const stale = await store.finishDecomposition(project.id, { assetId: asset.id, parts: [{ id: 'hat', name: '帽子', kind: 'accessory', description: '', anchor: '頭', bbox: { x: 0.3, y: 0, width: 0.2, height: 0.1 }, existingId: '' }] });
  assert.equal(stale.character.components.hat, undefined, '沒有在拆解中時不套用');
  await store.startDecomposition(project.id, {});
  const second = await store.finishDecomposition(project.id, { assetId: asset.id, parts: [{ id: 'coat_again', name: '外套', kind: 'garment', description: '', anchor: '上身', bbox: { x: 0.12, y: 0.22, width: 0.48, height: 0.38 }, existingId: 'coat' }] });
  assert.equal(Object.keys(second.character.components).length, 1);
  assert.equal(second.character.components.coat.crop.x, 0.12);
  assert.equal(second.character.revision, first.character.revision + 1);
  await store.startDecomposition(project.id, {});
  const failed = await store.failDecomposition(project.id, { assetId: asset.id, message: 'Codex 讀圖逾時' });
  assert.equal(failed.decomposition.status, 'failed');
  assert.equal(failed.decomposition.error, 'Codex 讀圖逾時');
  assert.equal(failed.character.revision, second.character.revision, '失敗不改設定');
});

test('採用正式立繪會在背景請 Codex 讀圖拆解，畫布輪詢帶回裝備', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-decompose-http-'));
  const seen = [];
  const client = { close() {}, async freshTurn({ prompt, images, outputSchema, cwd }) {
    seen.push({ prompt, images, outputSchema, cwd });
    return { threadId: 'thread-decompose', turnId: 'turn-1', text: JSON.stringify({ summary: '拆出一件斗篷', parts: [{ id: 'cape', name: '短斗篷', kind: 'garment', description: '灰色短斗篷。', anchor: '肩上', bbox: { x: 0.2, y: 0.2, width: 0.5, height: 0.3 }, existingId: '' }] }) };
  } };
  const running = await startServer({ dataDir: directory, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client, version: async () => 'test' }) });
  const post = async (url, body = {}) => {
    const response = await fetch(`${running.url}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  try {
    const project = await post('/api/projects', { name: '自動拆解' });
    const job = await post(`/api/projects/${project.id}/jobs`, { prompt: '整體立繪', baseRevision: 1, kind: 'generate' });
    const { candidate } = await running.store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id });
    const accepted = await post(`/api/projects/${project.id}/candidates/${candidate.id}/accept`, { baseRevision: 1 });
    assert.equal(accepted.decomposition.status, 'running', '採用回應就帶著拆解中狀態');
    let latest;
    for (let attempt = 0; attempt < 50; attempt++) {
      latest = await running.store.getProject(project.id);
      if (latest.decomposition.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(latest.decomposition.status, 'done');
    assert.equal(latest.character.components.cape.name, '短斗篷');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].images.length, 1);
    assert.ok(seen[0].images[0].endsWith('.png'), '附上正式立繪的本機路徑');
    assert.ok(seen[0].images[0].startsWith(running.store.projectDir(project.id)), '圖片以完整路徑附上');
    assert.ok(seen[0].cwd && !path.resolve(seen[0].cwd).startsWith(path.resolve(directory)), '背景 Codex 不在角色資料夾裡工作，刪除角色時才搬得動');
    assert.ok(seen[0].outputSchema.properties.parts);
    const again = await post(`/api/projects/${project.id}/decompose`);
    assert.equal(again.decomposition.status, 'running', '也可以手動重新拆解');
    // 等背景拆解寫完再關閉，避免清理暫存資料夾時還有檔案在寫入。
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await running.store.getProject(project.id)).decomposition.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal((await running.store.getProject(project.id)).decomposition.status, 'done');
  } finally { await running.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

const overlap = (a, b) => a.x < b.x + partNodeSize.width && a.x + partNodeSize.width > b.x && a.y < b.y + partNodeSize.height && a.y + partNodeSize.height > b.y;

test('畫布排版：裝備分在人物兩側、彼此不重疊；拖過的不重排；裁切與 contain 的計算', () => {
  const parts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, index) => ({ id, crop: { x: 0.1 + (index % 3) * 0.15, y: index * 0.12, width: 0.1, height: 0.08 } }));
  const positions = layoutParts({ x: 0, y: 0 }, parts, { g: { x: 999, y: 999 } });
  assert.equal(positions.g, undefined, '使用者拖過的不重排');
  const placed = Object.values(positions);
  const left = placed.filter(item => item.x < 0), right = placed.filter(item => item.x > 0);
  assert.ok(left.length && right.length, '兩側都有');
  assert.ok(Math.abs(left.length - (right.length + 1)) <= 1, '連同拖過的那件，兩側數量平衡');
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!overlap(placed[i], placed[j]), '裝備彼此不重疊');
  for (const item of placed) assert.ok(item.x + partNodeSize.width <= 0 || item.x >= characterNodeSize.width, '不壓到人物節點');
  assert.deepEqual(containBox(400, 400, 200, 100), { x: 0, y: 100, width: 400, height: 200 });
  const style = cropStyle({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 1000, 1000, 1, 0);
  assert.deepEqual(style, { width: '200%', left: '-50%', top: '-50%' });
});

test('新拆出的裝備只找空位，不推開既有節點，也避開便利貼', () => {
  const origin = { x: 0, y: 0 };
  const existing = placeParts(origin, [
    { id: 'belt', crop: { x: 0.25, y: 0.45, width: 0.2, height: 0.06 } },
    { id: 'boots', crop: { x: 0.25, y: 0.85, width: 0.2, height: 0.1 } },
  ]);
  const note = { x: -320, y: 200, width: 240, height: 270 };
  const placed = Object.entries(existing).map(([id, position]) => ({ id, ...position }));
  const added = placeParts(origin, [
    { id: 'sash', crop: { x: 0.27, y: 0.47, width: 0.2, height: 0.06 } },
    { id: 'charm', kind: 'accessory', crop: null },
  ], { placed, obstacles: [note] });
  assert.deepEqual(Object.keys(added).sort(), ['charm', 'sash'], '只回傳新裝備的位置');
  const all = [...placed, ...Object.values(added)];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i], all[j]), '新舊裝備不重疊');
  for (const item of Object.values(added)) {
    const hitsNote = item.x < note.x + note.width && item.x + partNodeSize.width > note.x && item.y < note.y + note.height && item.y + partNodeSize.height > note.y;
    assert.ok(!hitsNote, '避開便利貼');
  }
  // 同樣的輸入，結果固定（不會每次重排都跳動）。
  assert.deepEqual(placeParts(origin, [{ id: 'sash', crop: { x: 0.27, y: 0.47, width: 0.2, height: 0.06 } }, { id: 'charm', kind: 'accessory', crop: null }], { placed, obstacles: [note] }), added);
});

test('第一次排版依高度順序疊放、不交錯；橫式設定稿的立繪範圍', () => {
  const origin = { x: 0, y: 0 };
  const box = portraitBox(1536, 1024);
  assert.equal(box.x, characterArtBox.x);
  assert.ok(box.y > characterArtBox.y && box.height < characterArtBox.height, '橫式圖上下留白');
  const crops = { hand: 0.62, chest: 0.3, coat: 0.4, belt: 0.5 };
  const positions = placeParts(origin, Object.entries(crops).map(([id, y]) => ({ id, crop: { x: 0.3, y, width: 0.1, height: 0.05 } })), { imageBox: box });
  for (const side of [-1, 1]) {
    const column = Object.entries(positions).filter(([, item]) => Math.sign(item.x) === side).sort((a, b) => a[1].y - b[1].y).map(([id]) => id);
    const expected = [...column].sort((a, b) => crops[a] - crops[b]);
    assert.deepEqual(column, expected, '同一欄由上到下照立繪上的高度排列');
  }
});

test('接點在人物節點邊框上：依裝備在哪一側換邊，順著上下順序排開，不放在立繪上', () => {
  const origin = { x: 0, y: 0 };
  const ports = layoutPorts(origin, [
    { id: 'top', x: -300, y: -200 },
    { id: 'mid', x: -300, y: 200 },
    { id: 'low', x: -300, y: 230 },
    { id: 'charm', x: 600, y: 900 },
  ]);
  assert.equal(ports.mid.side, 'left');
  assert.equal(ports.charm.side, 'right', '在右邊的裝備從右邊框出線');
  assert.ok(ports.top.offset < ports.mid.offset && ports.mid.offset < ports.low.offset, '接點上下順序和節點一致，線不交錯');
  assert.ok(ports.low.offset - ports.mid.offset >= 14, '同一側的接點分開');
  for (const port of Object.values(ports)) assert.ok(port.offset >= characterArtBox.y && port.offset <= characterArtBox.y + characterArtBox.height, '接點在圖區高度範圍內的邊框上');
  assert.equal(ports.mid.offset, 200 + partNodeSize.height / 2, '對齊裝備節點的中線');
  const moved = layoutPorts(origin, [{ id: 'charm', x: -500, y: 0 }]);
  assert.equal(moved.charm.side, 'left', '拖到左邊就改從左邊框出線');
});

test('裝備的位置框只能引用存在的圖片', () => {
  const character = newCharacter('crop-check', '角色');
  character.components.cap = { id: 'cap', name: '帽子', kind: 'accessory', description: '', designStatus: 'proposed', crop: { assetId: 'portrait', x: 0.1, y: 0, width: 0.3, height: 0.2 } };
  assert.equal(parseCharacterYaml(characterYaml(character), ['portrait']).components.cap.crop.width, 0.3);
  assert.throws(() => parseCharacterYaml(characterYaml(character), []), { code: 'UNKNOWN_ASSET' });
  character.components.cap.crop.width = 1.4;
  assert.throws(() => parseCharacterYaml(characterYaml(character), ['portrait']), { code: 'INVALID_CHARACTER' });
});
