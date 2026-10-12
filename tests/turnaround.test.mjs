import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { ProjectStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
import { registerCodexRoutes } from '../server/integrations.mjs';
import { TURNAROUND_SPEC, heightDrift, normalizeViewBoxes } from '../shared/turnaround.mjs';
import { cropInFrame, viewPosition, viewRowOrigin, viewRowWidth, viewNodeSize, characterNodeSize } from '../src/canvas-layout.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');
const sheetBoxes = [
  { view: 'front', bbox: { x: 0.04, y: 0.05, width: 0.24, height: 0.9 } },
  { view: 'side', bbox: { x: 0.38, y: 0.06, width: 0.2, height: 0.88 } },
  { view: 'back', bbox: { x: 0.7, y: 0.05, width: 0.25, height: 0.9 } },
];
const crop = (x) => ({ x, y: 0.03, width: 0.3, height: 0.94 });
const items = (views = ['front', 'side', 'back']) => views.map((view, index) => ({ view, crop: crop(index * 0.33), frame: { x: index * 0.33 - 0.01, y: 0.03, width: 0.32, height: 0.94 }, figure: { x: index * 0.33 + 0.05, y: 0.05, width: 0.2, height: 0.9 }, buffer: png }));

function entries(zip) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  const count = zip.readUInt16LE(end + 10);
  let central = zip.readUInt32LE(end + 16);
  const result = {};
  for (let index = 0; index < count; index++) {
    const method = zip.readUInt16LE(central + 10);
    const size = zip.readUInt32LE(central + 20);
    const nameLength = zip.readUInt16LE(central + 28);
    const extraLength = zip.readUInt16LE(central + 30);
    const commentLength = zip.readUInt16LE(central + 32);
    const local = zip.readUInt32LE(central + 42);
    const name = zip.toString('utf8', central + 46, central + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const compressed = zip.subarray(start, start + size);
    result[name] = method === 8 ? inflateRawSync(compressed) : compressed;
    central += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

// 角色有一張正式三視圖（還沒拆解）。
async function withSheet(t, store) {
  if (!store) {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-turnaround-'));
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    store = await new ProjectStore({ dataDir, demo: false }).init();
  }
  const project = await store.createProject({ name: '三視圖測試' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫三視圖', kind: 'generate', baseRevision: 1, framing: 'turnaround' });
  const { asset, candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id });
  const adopted = await store.acceptCandidate(project.id, candidate.id, { baseRevision: 1 });
  return { store, project: adopted, asset, job };
}

test('位置框整理：每個角度只留一個、夾在圖片內、太小的不要，依正側背排序', () => {
  const boxes = normalizeViewBoxes([
    { view: 'back', bbox: { x: 0.7, y: 0.05, width: 0.5, height: 0.9 } },
    { view: 'front', bbox: { x: -0.1, y: 0.05, width: 0.3, height: 0.9 } },
    { view: 'front', bbox: { x: 0.5, y: 0, width: 0.2, height: 0.9 } },
    { view: 'side', bbox: { x: 0.4, y: 0.1, width: 0.01, height: 0.9 } },
    { view: 'three-quarter', bbox: { x: 0.4, y: 0.1, width: 0.2, height: 0.9 } },
  ]);
  assert.deepEqual(boxes.map(box => box.view), ['front', 'back']);
  assert.equal(boxes[0].x, 0, '超出左邊的夾回圖片內');
  assert.ok(Math.abs(boxes[1].width - 0.3) < 1e-9, '超出右邊的寬度截掉');
  assert.deepEqual(normalizeViewBoxes(undefined), []);
});

test('比例檢查：側面、背面的人物高度和正面差超過 8% 才標出來', () => {
  const figure = height => ({ figure: { x: 0, y: 0, width: 0.2, height } });
  assert.deepEqual(heightDrift({ front: figure(0.8), side: figure(0.84), back: figure(0.92) }), { back: 15 });
  assert.deepEqual(heightDrift({ front: figure(0.8), side: figure(0.68) }), { side: -15 });
  assert.deepEqual(heightDrift({ side: figure(0.7) }), {}, '沒有正面就不比');
});

test('畫布：視角節點排在人物正下方置中，兩側裝備往下壓到時整排讓開；原圖上的裝備位置換算到正面圖上', () => {
  const origin = { x: 100, y: 50 };
  const anchor = viewRowOrigin(origin, viewRowWidth(3));
  const row = [0, 1, 2].map(index => viewPosition(anchor, index));
  assert.ok(row.every(item => item.y > origin.y + characterNodeSize.height), '在人物下方');
  const middle = (row[0].x + row[2].x + viewNodeSize.width) / 2;
  assert.equal(middle, origin.x + characterNodeSize.width / 2, '整排置中對齊人物');
  assert.ok(viewRowWidth(3, true) > viewRowWidth(3), '加角度那一格算進寬度');
  const part = { x: row[2].x + 10, y: anchor.y - 100, width: 216, height: 268 };
  const moved = viewRowOrigin(origin, viewRowWidth(3), [part]);
  assert.ok(moved.y >= part.y + part.height, '裝備卡往下壓到這一排時，整排往下讓開');
  assert.deepEqual(viewRowOrigin(origin, viewRowWidth(3), [{ x: origin.x - 2000, y: anchor.y, width: 216, height: 268 }]), anchor, '不相干的節點不影響');
  // 兩欄交錯疊下來的很多裝備：整排要讓到全部的下面。
  const many = Array.from({ length: 12 }, (_, index) => ({ x: index % 2 ? origin.x + 516 : origin.x - 312, y: origin.y + Math.floor(index / 2) * 286 + (index % 2) * 140, width: 216, height: 268 }));
  const below = viewRowOrigin(origin, viewRowWidth(3, true), many);
  const rowRect = { x: below.x, y: below.y, width: viewRowWidth(3, true), height: viewNodeSize.height };
  assert.ok(many.every(rect => !(rect.x < rowRect.x + rowRect.width && rect.x + rect.width > rowRect.x && rect.y < rowRect.y + rowRect.height && rect.y + rect.height > rowRect.y)), '沒有任何裝備壓到這一排');
  const frame = { x: 0.1, y: 0, width: 0.3, height: 1 };
  const mapped = cropInFrame({ assetId: 'sheet', x: 0.16, y: 0.2, width: 0.06, height: 0.1 }, frame);
  assert.equal(mapped.assetId, 'sheet');
  assert.ok(Math.abs(mapped.x - 0.2) < 1e-9 && Math.abs(mapped.width - 0.2) < 1e-9);
  assert.equal(cropInFrame({ x: 0.8, y: 0.2, width: 0.06, height: 0.1 }, frame), null, '框在別的角度上就不換算');
});

test('三視圖工作：交接說明寫明三視圖規格；一般取景不會出現', async (t) => {
  const { store, project, job } = await withSheet(t);
  const instructions = await fs.readFile(job.context.instructionsPath, 'utf8');
  assert.match(instructions, /本次輸出：三視圖（view：front）/);
  assert.ok(instructions.includes(TURNAROUND_SPEC));
  assert.match(TURNAROUND_SPEC, /正面、側面（臉朝畫面左）、背面/);
  assert.equal(job.framing, 'turnaround');
  // 已經有正式立繪時補畫三視圖：照立繪的設計畫，不重新設計。
  const redraw = await store.createJob(project.id, { targetId: 'character', prompt: '補畫三視圖', kind: 'generate', baseRevision: project.character.revision, framing: 'turnaround' });
  assert.match(await fs.readFile(redraw.context.instructionsPath, 'utf8'), /目前的正式立繪：三視圖照這張的設計畫，髮型、五官、服裝與配色不改/);
  const plain = await store.createJob(project.id, { targetId: 'character', prompt: '整體立繪', kind: 'generate', baseRevision: project.character.revision, framing: 'sheet' });
  const text = await fs.readFile(plain.context.instructionsPath, 'utf8');
  assert.doesNotMatch(text, /本次輸出：三視圖|三視圖規格/);
  assert.match(text, /目前的正式立繪：只用來確認角色長相/);
});

test('拆解時找到兩個以上的角度就等著拆；只有一個人不拆；已經拆好的不被重新拆解蓋掉', async (t) => {
  const { store, project, asset } = await withSheet(t);
  await store.startDecomposition(project.id, {});
  const found = await store.finishDecomposition(project.id, { assetId: asset.id, parts: [], views: sheetBoxes });
  assert.equal(found.views.status, 'boxes');
  assert.equal(found.views.assetId, asset.id);
  assert.deepEqual(found.views.boxes.map(box => box.view), ['front', 'side', 'back']);
  await store.saveViews(project.id, { assetId: asset.id, items: items() });
  await store.startDecomposition(project.id, {});
  const again = await store.finishDecomposition(project.id, { assetId: asset.id, parts: [], views: [sheetBoxes[0]] });
  assert.equal(again.views.status, 'done', '同一張圖拆好的三張留著');

  const single = await withSheet(t, store);
  await store.startDecomposition(single.project.id, {});
  const one = await store.finishDecomposition(single.project.id, { assetId: single.asset.id, parts: [], views: [sheetBoxes[0]] });
  assert.equal(one.views.status, 'none', '只有一個角度就不是三視圖');
});

test('存拆好的三張：新的圖片檔、不覆寫原圖；過期、資料不對、不是 PNG 都擋下；自動拆分只存一次', async (t) => {
  const { store, project, asset } = await withSheet(t);
  await assert.rejects(store.saveViews(project.id, { assetId: 'other', items: items() }), { code: 'VIEWS_STALE' });
  await assert.rejects(store.saveViews(project.id, { assetId: asset.id, items: [] }), { code: 'INVALID_VIEWS' });
  await assert.rejects(store.saveViews(project.id, { assetId: asset.id, items: [...items(['front']), ...items(['front'])] }), { code: 'INVALID_VIEWS' }, '同一個角度不能兩張');
  await assert.rejects(store.saveViews(project.id, { assetId: asset.id, items: [{ ...items(['front'])[0], crop: { x: 0.9, y: 0, width: 0.5, height: 1 } }] }), { code: 'INVALID_VIEWS' });
  await assert.rejects(store.saveViews(project.id, { assetId: asset.id, items: [{ ...items(['front'])[0], view: 'detail' }] }), { code: 'INVALID_VIEWS' });
  await assert.rejects(store.saveViews(project.id, { assetId: asset.id, items: [{ ...items(['front'])[0], buffer: Buffer.from('not an image') }] }), { code: 'INVALID_IMAGE' });

  const saved = await store.saveViews(project.id, { assetId: asset.id, items: items() });
  assert.equal(saved.views.status, 'done');
  assert.equal(saved.views.manual, false);
  for (const view of ['front', 'side', 'back']) {
    const item = saved.views.items[view];
    const viewAsset = saved.assets.find(entry => entry.id === item.assetId);
    assert.equal(viewAsset.role, 'view');
    assert.equal(viewAsset.view, view);
    assert.equal(viewAsset.fromAssetId, asset.id, '記得是從哪張三視圖裁出來的');
    assert.ok(item.frame && item.figure);
    await fs.access(path.join(store.projectDir(project.id), 'assets', `${viewAsset.id}.png`));
  }
  assert.equal(saved.character.adopted.character, asset.id, '正式三視圖還是原本那張');
  assert.equal(saved.assets.filter(entry => entry.role === 'design').length, 1, '裁出來的不算設計圖');

  const twice = await store.saveViews(project.id, { assetId: asset.id, items: items() });
  assert.equal(twice.assets.length, saved.assets.length, '自動拆分重送（例如開著兩個視窗）不再多存一份');

  // 手動調整：照使用者的框重裁；拿掉的角度不留，框記下來給下次調整用。
  const manual = await store.saveViews(project.id, { assetId: asset.id, manual: true, boxes: [{ view: 'front', x: 0.05, y: 0.04, width: 0.25, height: 0.9 }, { view: 'back', x: 0.7, y: 0.04, width: 0.25, height: 0.9 }], items: items(['front', 'back']) });
  assert.deepEqual(Object.keys(manual.views.items), ['front', 'back']);
  assert.notEqual(manual.views.items.front.assetId, saved.views.items.front.assetId);
  assert.equal(manual.views.manual, true);
  assert.deepEqual(manual.views.boxes.map(box => box.view), ['front', 'back']);

  // 裁出來的圖不能拿來當正式立繪。
  const character = structuredClone(manual.character);
  character.adopted.character = manual.views.items.front.assetId;
  await assert.rejects(store.updateCharacter(project.id, { baseRevision: character.revision, character }), { code: 'ASSET_TARGET_MISMATCH' });
});

test('設計包多一個 views/：正面、側面、背面三張', async (t) => {
  const { store, project, asset } = await withSheet(t);
  await store.saveViews(project.id, { assetId: asset.id, items: items() });
  const files = entries((await store.exportProject(project.id)).buffer);
  for (const view of ['front', 'side', 'back']) assert.ok(files[`views/${view}.png`], `缺少 views/${view}.png`);
});

test('網頁送來的三張（multipart）存成三視圖；找三視圖在背景跑，只找角度不動裝備', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-turnaround-http-'));
  const seen = [];
  let reply = { views: sheetBoxes };
  const client = { close() {}, async freshTurn({ prompt, images, outputSchema }) {
    seen.push({ prompt, images, outputSchema });
    if (reply instanceof Error) throw reply;
    return { threadId: 'thread-views', turnId: 'turn', text: JSON.stringify(reply) };
  } };
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client, version: async () => 'test' }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const { project, asset } = await withSheet(t, running.store);
  const settle = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const latest = await running.store.getProject(project.id);
      if (latest.views?.status !== 'detecting') return latest;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('找三視圖沒有結束');
  };

  const post = (body) => fetch(`${running.url}/api/projects/${project.id}/views/detect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const started = await post();
  assert.equal(started.status, 200, await started.clone().text());
  assert.equal((await started.json()).views.status, 'detecting');
  const found = await settle();
  assert.equal(found.views.status, 'boxes');
  assert.deepEqual(Object.keys(found.character.components), [], '只找角度，不拆裝備');
  assert.deepEqual(Object.keys(seen[0].outputSchema.properties), ['views']);
  assert.ok(seen[0].images[0].endsWith('.png'));

  reply = new Error('Codex 讀圖 timeout');
  await post();
  const failed = await settle();
  assert.equal(failed.views.status, 'failed');
  assert.equal(failed.views.errorCode, 'DECOMPOSE_TIMEOUT');

  const form = new FormData();
  const sent = items(['front', 'side']);
  form.append('meta', JSON.stringify({ assetId: asset.id, manual: true, boxes: sent.map(({ view, crop: box }) => ({ view, ...box })), items: sent.map(({ view, crop: box, frame, figure }) => ({ view, crop: box, frame, figure })) }));
  for (const item of sent) form.append(item.view, new Blob([png], { type: 'image/png' }), `${item.view}.png`);
  const response = await fetch(`${running.url}/api/projects/${project.id}/views`, { method: 'POST', body: form });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = await response.json();
  assert.deepEqual(Object.keys(saved.views.items), ['front', 'side']);
  assert.equal(saved.views.manual, true);
  const image = await fetch(`${running.url}${saved.assets.find(entry => entry.id === saved.views.items.side.assetId).url}`);
  assert.equal(image.headers.get('content-type'), 'image/png');

  const broken = new FormData();
  broken.append('meta', '{not json');
  const rejected = await fetch(`${running.url}/api/projects/${project.id}/views`, { method: 'POST', body: broken });
  assert.equal(rejected.status, 422);
  assert.equal((await rejected.json()).code, 'INVALID_VIEWS');
});

test('找三視圖時核心重開：畫面看到「中斷了」可以再試，不會一直轉圈；重新裁切後舊的裁切圖不留著', async (t) => {
  const { store, project, asset } = await withSheet(t);
  const started = await store.startViewDetection(project.id);
  assert.equal(started.project.views.status, 'detecting');
  assert.equal((await store.startViewDetection(project.id)).skipped, true, '正在找時不重複開始');
  // 模擬核心重開：記在記憶體裡的「正在找」不見了。
  store.markDetectingViews(project.id, false);
  const shown = await store.getProject(project.id);
  assert.equal(shown.views.status, 'failed');
  assert.equal(shown.views.errorCode, 'VIEWS_INTERRUPTED');
  assert.equal((await store.startViewDetection(project.id)).skipped, undefined, '可以再試一次');
  await store.finishViewDetection(project.id, { assetId: asset.id, views: sheetBoxes });

  const first = await store.saveViews(project.id, { assetId: asset.id, items: items() });
  const oldIds = Object.values(first.views.items).map(item => item.assetId);
  const again = await store.saveViews(project.id, { assetId: asset.id, manual: true, items: items(['front', 'side']) });
  for (const oldId of oldIds) {
    assert.equal(again.assets.some(entry => entry.id === oldId), false, '舊的裁切圖從角色裡移除');
    await assert.rejects(fs.access(path.join(store.projectDir(project.id), 'assets', `${oldId}.png`)));
  }
  assert.equal(again.assets.filter(entry => entry.role === 'view').length, 2);
});

test('拆分：伸進隔壁框的尾巴還是原本那個人的；黏在一起（地平線）才逐點分；框裡的小字不算進人物範圍；遠處的雜點不要', async () => {
  const { assignOwners, figureRects, FOREIGN } = await import('../src/views-split.js');
  const width = 260, height = 100;
  const mask = new Uint8Array(width * height);
  const fill = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) mask[y * width + x] = 1; };
  fill(20, 10, 60, 90);   // A 的身體
  fill(60, 50, 130, 56);  // A 的尾巴，伸到 B 的框裡（但沒到 B 的中段）
  fill(140, 10, 180, 90); // B 的身體
  fill(150, 93, 152, 97); fill(155, 93, 158, 97); fill(160, 93, 162, 97); // B 框裡、腳下的小字
  fill(5, 2, 9, 5);       // 框外但靠近 A 的框（像漏框的髮梢）
  fill(250, 2, 254, 4);   // 右上角離框很遠的雜點
  const rects = [{ left: 10, right: 100, top: 0, bottom: 100 }, { left: 100, right: 195, top: 0, bottom: 100 }];
  const { owner, parts } = assignOwners(mask, width, height, rects);
  assert.equal(owner[53 * width + 125], 0, '尾巴尖還是 A 的');
  assert.equal(owner[50 * width + 160], 1);
  assert.equal(owner[3 * width + 252], FOREIGN, '遠處的雜點不屬於任何人（裁的時候擦掉）');
  assert.equal(owner[3 * width + 7], 0, '框外但靠近 A 的（漏框的髮梢）算 A 的');
  const [a, b] = figureRects(parts, 2);
  assert.equal(a.right, 130, 'A 的範圍包含整條尾巴');
  assert.equal(b.bottom, 90, '腳下的小字不算進 B 的身高');

  // 地平線把兩個人連成一塊：逐點分給各自的框。
  const floor = new Uint8Array(width * height);
  for (let y = 10; y < 90; y += 1) for (let x = 20; x < 60; x += 1) floor[y * width + x] = 1;
  for (let y = 10; y < 90; y += 1) for (let x = 140; x < 180; x += 1) floor[y * width + x] = 1;
  for (let x = 0; x < width; x += 1) floor[89 * width + x] = 1;
  const split = assignOwners(floor, width, height, rects);
  assert.equal(split.owner[50 * width + 40], 0);
  assert.equal(split.owner[50 * width + 160], 1);
  assert.equal(split.owner[89 * width + 90], 0);
  assert.equal(split.owner[89 * width + 110], 1);

  // 沒框到的人（例如背面另外重畫了，只框正面）：蝴蝶結伸進正面的框，整個人還是不能算正面的。
  const lone = new Uint8Array(width * height);
  for (let y = 10; y < 90; y += 1) for (let x = 20; x < 60; x += 1) lone[y * width + x] = 1;
  for (let y = 10; y < 90; y += 1) for (let x = 100; x < 150; x += 1) lone[y * width + x] = 1;
  for (let y = 10; y < 16; y += 1) for (let x = 75; x < 100; x += 1) lone[y * width + x] = 1;
  const only = assignOwners(lone, width, height, [{ left: 10, right: 80, top: 0, bottom: 100 }]);
  assert.equal(only.owner[50 * width + 40], 0);
  assert.equal(only.owner[50 * width + 120], FOREIGN, '沒框到的人不屬於正面');
  assert.equal(only.owner[12 * width + 77], FOREIGN, '伸進框裡的蝴蝶結也是那個人的');
  assert.equal(figureRects(only.parts, 1)[0].right, 60, '正面的範圍不被隔壁撐大');
});

test('補洞：輪廓裡淡色的地方跟著圍住它的人（擦隔壁時不留殘影）；一圈外框圍住的整片背景不算洞', async () => {
  const { fillHoles, FOREIGN } = await import('../src/views-split.js');
  const width = 120, height = 60;
  const mask = new Uint8Array(width * height), owner = new Int8Array(width * height).fill(-1);
  const ring = (x0, y0, x1, y1, value) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      if (x < x0 + 3 || x >= x1 - 3 || y < y0 + 3 || y >= y1 - 3) { mask[y * width + x] = 1; owner[y * width + x] = value; }
    }
  };
  ring(5, 5, 40, 50, 0);           // 自己：輪廓裡有一塊淡色
  ring(60, 5, 100, 50, FOREIGN);   // 沒框到的人：輪廓裡也有淡色
  fillHoles(mask, owner, width, height);
  assert.equal(owner[20 * width + 20], 0);
  assert.equal(owner[20 * width + 80], FOREIGN, '別人輪廓裡的淡色一起擦');
  assert.equal(owner[2 * width + 50], -1, '外面的背景不動');

  const framed = new Uint8Array(width * height), frameOwner = new Int8Array(width * height).fill(-1);
  for (let x = 0; x < width; x += 1) for (const y of [1, height - 2]) { framed[y * width + x] = 1; frameOwner[y * width + x] = FOREIGN; }
  for (let y = 1; y < height - 1; y += 1) for (const x of [1, width - 2]) { framed[y * width + x] = 1; frameOwner[y * width + x] = FOREIGN; }
  fillHoles(framed, frameOwner, width, height);
  assert.equal(frameOwner[30 * width + 60], -1, '外框比圍住的背景小很多，不把背景判給外框');
});

test('標註的位置說明：從頭頂往下幾成、畫面哪一邊、是角色的哪一邊；側面類的角度寫出看到的是哪半邊', async () => {
  const { notePlaceText, toBodyPoint, toImagePoint } = await import('../shared/turnaround.mjs');
  assert.equal(notePlaceText({ view: 'front', bx: 0.9, by: 0.48 }), '從頭頂往下約 50% 的高度・畫面右邊（角色的左邊）');
  assert.equal(notePlaceText({ view: 'back', bx: 0.1, by: 0.48 }), '從頭頂往下約 50% 的高度・畫面左邊（角色的左邊）');
  assert.equal(notePlaceText({ view: 'side', bx: 0.5, by: 0.5 }), '從頭頂往下約 50% 的高度・畫面中間；這個角度看到的是角色的左半邊');
  assert.equal(notePlaceText({ view: 'side', bx: 0.9, by: 0.5 }), '從頭頂往下約 50% 的高度・畫面右邊（身體後面）；這個角度看到的是角色的左半邊');
  assert.equal(notePlaceText({ view: 'otherSide', bx: 0.9, by: 0.5 }), '從頭頂往下約 50% 的高度・畫面右邊（身體前面）；這個角度看到的是角色的右半邊');
  assert.equal(notePlaceText({ view: 'frontQuarter', bx: 0.2, by: 0.3 }), '從頭頂往下約 30% 的高度・畫面左邊；這個角度看到的是角色的左半邊');
  assert.equal(notePlaceText({ view: 'backQuarter', bx: 0.5, by: 0.3 }), '從頭頂往下約 30% 的高度・畫面中間；這個角度看到的是角色的左半邊');
  assert.match(notePlaceText({ view: 'front', bx: 0.5, by: -0.1 }), /^頭頂上方/);
  assert.match(notePlaceText({ view: 'front', bx: 0.5, by: 1.2 }), /^腳底下方/);
  const body = { left: 0.2, top: 0.1, width: 0.5, height: 0.8 };
  const point = toBodyPoint({ x: 0.45, y: 0.5 }, body);
  assert.deepEqual(point, { bx: 0.5, by: 0.5 });
  assert.deepEqual(toImagePoint(point, body), { x: 0.45, y: 0.5 });
});
