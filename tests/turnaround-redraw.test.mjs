import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { ProjectStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
import { registerCodexRoutes } from '../server/integrations.mjs';
import { candidateComparison } from '../shared/agent-workspace.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');
const crop = (x) => ({ x, y: 0.03, width: 0.3, height: 0.94 });
const items = (views = ['front', 'side', 'back']) => views.map((view, index) => ({ view, crop: crop(index * 0.33), frame: crop(index * 0.33), figure: { x: index * 0.33 + 0.05, y: 0.05, width: 0.2, height: 0.9 }, buffer: png }));

async function withSplitSheet(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-redraw-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const project = await store.createProject({ name: '重畫測試' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫三視圖', kind: 'generate', baseRevision: 1, framing: 'turnaround' });
  const { asset, candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id });
  await store.acceptCandidate(project.id, candidate.id, { baseRevision: 1 });
  return { store, project: await store.getProject(project.id), sheet: asset };
}

test('重畫單一角度：要先拆好正面；只附正面（定稿）與其他已確認的角度，不附整張圖也不附畫壞的那張；角色的側面圖只能從這種工作交回來', async (t) => {
  const { store, project, sheet } = await withSplitSheet(t);
  const base = { targetId: 'character', prompt: '重畫側面', kind: 'generate', outputView: 'side' };
  await assert.rejects(store.createJob(project.id, { ...base, baseRevision: project.character.revision }), { code: 'VIEWS_NOT_READY' });
  await assert.rejects(store.createJob(project.id, { ...base, outputView: 'detail', baseRevision: project.character.revision }), { code: 'INVALID_OUTPUT_VIEW' });
  await assert.rejects(store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', role: 'reference', view: 'side' }), { code: 'INVALID_OUTPUT_VIEW' });
  const split = await store.saveViews(project.id, { assetId: sheet.id, items: items() });
  const job = await store.createJob(project.id, { ...base, baseRevision: project.character.revision });
  const instructions = await fs.readFile(job.context.instructionsPath, 'utf8');
  assert.match(instructions, /本次輸出：三視圖的「側面」（view：side）/);
  assert.match(instructions, /只畫一個全身的側面。側面：臉朝畫面左的正側面輪廓，看到的是角色的左半邊.*設計完全照附上的正面（定稿）與已確認的其他角度/);
  assert.match(instructions, /原本的側面有問題，這次重畫；沒有附上原本那張/);
  const inputs = instructions.split('## 固定輸入')[1].trim().split('\n\n')[0].split('\n');
  assert.match(inputs[0], /^- 定稿（正面）：照這張畫側面/);
  assert.match(inputs[1], /^- 已確認的背面：同一個角色/);
  assert.equal(inputs.length, 2, '不附整張正式圖、不附原本的側面');
  const attached = job.context.referenceAssets.map(asset => asset.id);
  assert.ok(!attached.includes(sheet.id) && !attached.includes(split.views.items.side.assetId));
  assert.match(instructions, /以「定稿」為準，禁止變更任何設定/);
  assert.equal(job.outputView, 'side');
  assert.equal(job.viewRedo, true);
});

test('分開畫：正面全身採用後直接拆成正面（不等 AI），拆解結果不蓋掉；第一次畫側面時不說「原本的有問題」；舊角色可以把整張當正面', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-front-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const project = await store.createProject({ name: '分開畫' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面', kind: 'generate', baseRevision: 1, framing: 'frontView' });
  assert.match(await fs.readFile(job.context.instructionsPath, 'utf8'), /本次輸出：正面全身（view：front）。正面全身規格：直式/);
  const { asset, candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id });
  const adopted = await store.acceptCandidate(project.id, candidate.id, { baseRevision: 1 });
  assert.equal(adopted.views.status, 'boxes');
  assert.equal(adopted.views.assetId, asset.id);
  assert.deepEqual(adopted.views.boxes, [{ view: 'front', x: 0, y: 0, width: 1, height: 1 }]);
  await store.startDecomposition(project.id, {});
  const decomposed = await store.finishDecomposition(project.id, { assetId: asset.id, parts: [], views: [] });
  assert.equal(decomposed.views.status, 'boxes', '拆解（只找到一個人）不會把它改成「只有一個角度」');
  await assert.rejects(store.createJob(project.id, { targetId: 'character', prompt: '畫側面', kind: 'generate', outputView: 'side', baseRevision: adopted.character.revision }), { code: 'VIEWS_NOT_READY' }, '正面拆好之前不能畫側面');
  await store.saveViews(project.id, { assetId: asset.id, items: items(['front']) });
  const side = await store.createJob(project.id, { targetId: 'character', prompt: '畫側面', kind: 'generate', outputView: 'side', baseRevision: adopted.character.revision });
  const text = await fs.readFile(side.context.instructionsPath, 'utf8');
  assert.doesNotMatch(text, /原本的側面|已確認的其他角度/);
  assert.equal(side.viewRedo, undefined);
  assert.deepEqual(side.context.referenceAssets.map(entry => entry.role), ['view'], '只附正面');

  // 舊角色：一般的立繪，按「當正面」。
  const old = await store.createProject({ name: '舊角色' });
  await assert.rejects(store.useMainAsFront(old.id), { code: 'NO_PORTRAIT' });
  const oldJob = await store.createJob(old.id, { targetId: 'character', prompt: '整體立繪', kind: 'generate', baseRevision: 1 });
  const oldImage = await store.addAsset(old.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: oldJob.id });
  const oldAdopted = await store.acceptCandidate(old.id, oldImage.candidate.id, { baseRevision: 1 });
  assert.equal(oldAdopted.views, undefined, '一般立繪採用時不自動當正面');
  const front = await store.useMainAsFront(old.id);
  assert.equal(front.views.status, 'boxes');
  assert.equal(front.views.assetId, oldImage.asset.id);
});

test('採用重畫的側面：只換掉三視圖裡那一張（舊裁切圖移除），正式三視圖與角色版本不動；調好大小後存成新的圖；手動重裁不會蓋掉它', async (t) => {
  const { store, project, sheet } = await withSplitSheet(t);
  const split = await store.saveViews(project.id, { assetId: sheet.id, items: items() });
  const oldSide = split.views.items.side.assetId;
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '重畫側面', kind: 'generate', outputView: 'side', baseRevision: split.character.revision });
  const { asset, candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id, view: 'side' });
  assert.equal(candidate.view, 'side');
  const before = await store.getProject(project.id);
  assert.equal(candidateComparison(before, candidate).current.id, oldSide, '翻牌比較的是三視圖裡現在的側面');
  const adopted = await store.acceptCandidate(project.id, candidate.id, { baseRevision: before.character.revision });
  assert.equal(adopted.character.adopted.character, sheet.id, '正式三視圖不變');
  assert.equal(adopted.character.revision, before.character.revision, '視角不進角色版本');
  assert.deepEqual(adopted.views.items.side, { assetId: asset.id, sourceAssetId: asset.id, redrawn: true });
  assert.equal(adopted.assets.some(entry => entry.id === oldSide), false);
  await assert.rejects(fs.access(path.join(store.projectDir(project.id), 'assets', `${oldSide}.png`)));
  assert.equal(adopted.candidates.find(entry => entry.id === candidate.id).status, 'accepted');

  await assert.rejects(store.saveNormalizedView(project.id, { view: 'side', sourceAssetId: 'other', buffer: png }), { code: 'VIEWS_STALE' });
  await assert.rejects(store.saveNormalizedView(project.id, { view: 'side', sourceAssetId: asset.id, buffer: Buffer.from('nope') }), { code: 'INVALID_IMAGE' });
  const normalized = await store.saveNormalizedView(project.id, { view: 'side', sourceAssetId: asset.id, buffer: png });
  const side = normalized.views.items.side;
  assert.notEqual(side.assetId, asset.id);
  assert.equal(side.sourceAssetId, asset.id);
  assert.equal(normalized.assets.find(entry => entry.id === side.assetId).role, 'view');
  assert.equal(normalized.assets.find(entry => entry.id === asset.id).role, 'design', '交回來的原圖留在圖鑑');
  const again = await store.saveNormalizedView(project.id, { view: 'side', sourceAssetId: asset.id, buffer: png });
  assert.equal(again.assets.length, normalized.assets.length, '調好之後再送不會多存');

  const manual = await store.saveViews(project.id, { assetId: sheet.id, manual: true, boxes: [{ view: 'front', x: 0, y: 0, width: 0.3, height: 1 }], items: items(['front']) });
  assert.deepEqual(Object.keys(manual.views.items).sort(), ['front', 'side'], '沒勾的重畫角度留著；沒勾也沒重畫的拿掉');
  assert.equal(manual.views.items.side.assetId, asset.id, '重裁後改回交回來的原圖，畫面照新的大小再調一次');
});

test('匯入現成的三視圖：上傳或直接用定稿，都另存成正式立繪並開始拆解；讀定稿填設定會把定稿圖交給 AI', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-import-'));
  const seen = [];
  const client = { close() {}, async freshTurn({ prompt, images, outputSchema }) {
    seen.push({ prompt, images, outputSchema });
    if (outputSchema.properties.yaml) {
      const project = (await running.store.listProjects())[0];
      const yaml = await running.store.getYaml(project.id);
      return { threadId: 'thread-chat', turnId: 'turn', text: JSON.stringify({ yaml, summary: '從定稿讀到黑色短髮。' }) };
    }
    return { threadId: 'thread', turnId: 'turn', text: JSON.stringify({ summary: '', parts: [], views: [{ view: 'front', bbox: { x: 0.05, y: 0.05, width: 0.25, height: 0.9 } }, { view: 'back', bbox: { x: 0.7, y: 0.05, width: 0.25, height: 0.9 } }] }) };
  } };
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client, version: async () => 'test' }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const store = running.store;
  const project = await store.createProject({ name: '匯入測試' });
  const post = (url, body) => fetch(`${running.url}/api/projects/${project.id}${url}`, body instanceof FormData ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  const noCanon = await post('/chat', { message: '照定稿填外觀', readCanon: true });
  assert.equal(noCanon.status, 422);
  assert.equal((await noCanon.json()).code, 'NO_CANON');

  const { asset: reference } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', role: 'reference', name: '舊設定稿.png' });
  const character = structuredClone((await store.getProject(project.id)).character);
  character.style.references.push({ id: 'ref-old', assetId: reference.id, role: 'identity', focus: [], canon: true });
  const saved = await store.updateCharacter(project.id, { baseRevision: character.revision, character });

  const chat = await post('/chat', { message: '照定稿填外觀', readCanon: true });
  assert.equal(chat.status, 200, await chat.clone().text());
  assert.deepEqual(seen.at(-1).images, [path.join(store.projectDir(project.id), 'assets', `${reference.id}.png`)]);
  assert.match(seen.at(-1).prompt, /附圖是這個角色的定稿/);

  const stale = new FormData(); stale.append('fromAssetId', reference.id); stale.append('baseRevision', String(saved.character.revision - 1));
  assert.equal((await post('/import-main', stale)).status, 409, '版本不對不匯入');
  const form = new FormData(); form.append('fromAssetId', reference.id); form.append('baseRevision', String(saved.character.revision));
  const response = await post('/import-main', form);
  assert.equal(response.status, 200, await response.clone().text());
  const imported = await response.json();
  const main = imported.assets.find(entry => entry.id === imported.character.adopted.character);
  assert.equal(main.role, 'design');
  assert.equal(main.imported, true);
  assert.notEqual(main.id, reference.id, '另存一份，參考圖不動');
  assert.equal(imported.history.at(-1).messageKey, 'sheetImported');
  assert.equal(imported.character.revision, saved.character.revision + 1);
  let latest;
  for (let attempt = 0; attempt < 100; attempt++) {
    latest = await store.getProject(project.id);
    if (latest.decomposition?.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(latest.decomposition.status, 'done', '匯入後和採用時一樣自動拆解');
  assert.equal(latest.views.status, 'boxes');
  assert.equal(latest.views.assetId, main.id);

  const upload = new FormData();
  upload.append('file', new Blob([png], { type: 'image/png' }), 'sheet.png');
  upload.append('baseRevision', String(latest.character.revision));
  const uploaded = await post('/import-main', upload);
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await store.getProject(project.id)).decomposition?.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
});

test('交給 Codex App 的短提示寫出「這次只重畫側面」', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-redraw-http-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client: { close() {} }, version: async () => 'test' }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const store = running.store;
  const project = await store.createProject({ name: '短提示' });
  const first = await store.createJob(project.id, { targetId: 'character', prompt: '畫三視圖', kind: 'generate', baseRevision: 1, framing: 'turnaround' });
  const { asset, candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: first.id });
  const adopted = await store.acceptCandidate(project.id, candidate.id, { baseRevision: 1 });
  await store.saveViews(project.id, { assetId: asset.id, items: items() });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '重畫背面', kind: 'generate', outputView: 'back', baseRevision: adopted.character.revision });
  const response = await fetch(`${running.url}/api/projects/${project.id}/jobs/${job.id}/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.match(body.prompt, /短提示・三視圖的背面/);
  assert.match(body.prompt, /這次重畫背面：原本那張有問題，沒有附上；設計照正面，不要改。/);
  const handoff = JSON.parse(await fs.readFile(path.join(store.jobDir(project.id, job.id), 'handoff.json'), 'utf8'));
  assert.equal(handoff.outputView, 'back', 'submit helper 會用這個視角提交');
});

test('照舊三視圖重畫的角度不能放進新的三視圖；有原本的定稿時正面排第一、原本的定稿退為參考；手動重裁後重畫的角度要重新調大小；拆解只接受正式立繪', async (t) => {
  const { store, project, sheet } = await withSplitSheet(t);
  const { asset: reference } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', role: 'reference', name: '舊定稿.png' });
  const character = structuredClone((await store.getProject(project.id)).character);
  character.style.references.push({ id: 'ref-canon', assetId: reference.id, role: 'identity', focus: [], canon: true });
  let current = await store.updateCharacter(project.id, { baseRevision: character.revision, character });
  await store.saveViews(project.id, { assetId: sheet.id, items: items() });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '重畫側面', kind: 'generate', outputView: 'side', baseRevision: current.character.revision });
  assert.equal(job.sheetAssetId, sheet.id);
  const inputs = (await fs.readFile(job.context.instructionsPath, 'utf8')).split('## 固定輸入')[1].trim().split('\n');
  assert.match(inputs[0], /^- 定稿（正面）/, '正面排第一');
  assert.match(inputs.find(line => line.includes('原本的定稿')), /^- 原本的定稿：設計以正面為準/);
  const { candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id, view: 'side' });
  await assert.rejects(store.startDecomposition(project.id, { assetId: candidate.assetId }), { code: 'NO_PORTRAIT' }, '側面圖不能拿去拆解');

  // 換了一張新的三視圖並拆好：舊的側面候選不能放進來。
  const next = await store.createJob(project.id, { targetId: 'character', prompt: '新三視圖', kind: 'generate', baseRevision: (await store.getProject(project.id)).character.revision, framing: 'turnaround' });
  const added = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: next.id });
  current = await store.acceptCandidate(project.id, added.candidate.id, { baseRevision: (await store.getProject(project.id)).character.revision });
  await store.saveViews(project.id, { assetId: added.asset.id, items: items() });
  await assert.rejects(store.acceptCandidate(project.id, candidate.id, { baseRevision: current.character.revision }), { code: 'VIEWS_STALE' });

  // 新三視圖重畫側面、採用、調好大小；之後只重裁正面：側面改回原圖，等畫面照新的大小再調一次。
  const redraw = await store.createJob(project.id, { targetId: 'character', prompt: '重畫側面', kind: 'generate', outputView: 'side', baseRevision: current.character.revision });
  const side = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: redraw.id, view: 'side' });
  await store.acceptCandidate(project.id, side.candidate.id, { baseRevision: current.character.revision });
  const normalized = await store.saveNormalizedView(project.id, { view: 'side', sourceAssetId: side.asset.id, buffer: png });
  const oldNormalized = normalized.views.items.side.assetId;
  const recropped = await store.saveViews(project.id, { assetId: added.asset.id, manual: true, boxes: [{ view: 'front', x: 0, y: 0, width: 0.3, height: 1 }], items: items(['front']) });
  assert.deepEqual(recropped.views.items.side, { assetId: side.asset.id, sourceAssetId: side.asset.id, redrawn: true });
  assert.equal(recropped.assets.some(entry => entry.id === oldNormalized), false, '舊的調整圖移除');
});

test('單張全身採用後：拆解只找到一個正面、而且是用全身取景畫的，就直接當正面；其他取景照舊等使用者決定', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-single-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const draw = async (name, framing) => {
    const project = await store.createProject({ name });
    const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫全身', kind: 'generate', baseRevision: 1, ...(framing ? { framing } : {}) });
    const { asset, candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id });
    await store.acceptCandidate(project.id, candidate.id, { baseRevision: 1 });
    await store.startDecomposition(project.id, {});
    return store.finishDecomposition(project.id, { assetId: asset.id, parts: [], views: [{ view: 'front', bbox: { x: 0.2, y: 0.05, width: 0.6, height: 0.9 } }] });
  };
  const full = await draw('全身', 'full');
  assert.equal(full.views.status, 'boxes');
  assert.equal(full.views.single, true);
  const [box] = full.views.boxes;
  assert.equal(box.view, 'front');
  assert.ok(Math.abs(box.x - 0.17) < 1e-9 && Math.abs(box.y - 0.02) < 1e-9 && Math.abs(box.width - 0.66) < 1e-9 && Math.abs(box.height - 0.96) < 1e-9, '一般全身可能有背景：照 AI 的框，四周多留一點');
  const portrait = await draw('半身', 'half');
  assert.equal(portrait.views.status, 'none', '半身之類的取景不自動當正面');
});

test('加角度：要先有正面；加了先是空位，畫好採用後放進那個角度；可以拿掉；重新裁切三視圖不會弄丟加的角度', async (t) => {
  const { store, project, sheet } = await withSplitSheet(t);
  await assert.rejects(store.addExtraView(project.id, { view: 'otherSide' }), { code: 'VIEWS_NOT_READY' });
  const split = await store.saveViews(project.id, { assetId: sheet.id, items: items() });
  await assert.rejects(store.addExtraView(project.id, { view: 'side' }), { code: 'INVALID_OUTPUT_VIEW' }, '基本三個角度不是加的');
  await store.addExtraView(project.id, { view: 'otherSide' });
  const added = await store.addExtraView(project.id, { view: 'frontQuarter' });
  assert.deepEqual(added.views.extra, ['frontQuarter', 'otherSide'], '照轉台的順序排');
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫另一側', kind: 'generate', outputView: 'otherSide', baseRevision: split.character.revision });
  const text = await fs.readFile(job.context.instructionsPath, 'utf8');
  assert.match(text, /三視圖的「另一側」（view：otherSide）。只畫一個全身的另一側。另一側：臉朝畫面右的正側面輪廓，看到的是角色的右半邊/);
  assert.equal(job.context.referenceAssets.length, 3, '附正面、側面、背面');
  const { candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id, view: 'otherSide' });
  const adopted = await store.acceptCandidate(project.id, candidate.id, { baseRevision: split.character.revision });
  assert.equal(adopted.views.items.otherSide.redrawn, true);
  const recut = await store.saveViews(project.id, { assetId: sheet.id, manual: true, items: items(['front', 'side']) });
  assert.deepEqual(recut.views.extra, ['frontQuarter', 'otherSide']);
  assert.ok(recut.views.items.otherSide, '重新裁切不動加的角度');
  await store.createViewNote(project.id, { view: 'otherSide', x: 0.5, y: 0.5, text: '右腰的小刀' });
  await store.createViewNote(project.id, { view: 'front', x: 0.5, y: 0.5, text: '胸前的徽章' });
  const removed = await store.removeExtraView(project.id, 'otherSide');
  assert.deepEqual(removed.views.extra, ['frontQuarter']);
  assert.equal(removed.views.items.otherSide, undefined);
  assert.deepEqual(removed.viewNotes.map(note => note.text), ['胸前的徽章'], '標在拿掉的角度上的標註一起拿掉');
  await assert.rejects(store.removeExtraView(project.id, 'back'), { code: 'INVALID_OUTPUT_VIEW' }, '基本三個角度不能拿掉');
});

test('設計標註：可以新增、修改、刪除；畫角色的圖都會附上位置與說明（畫裝備不附）；匯出時另有一份文字', async (t) => {
  const { store, project, sheet } = await withSplitSheet(t);
  const split = await store.saveViews(project.id, { assetId: sheet.id, items: items() });
  await assert.rejects(store.createViewNote(project.id, { view: 'back', x: 0.5, y: 0.5, text: '' }), { code: 'INVALID_NOTE' });
  await assert.rejects(store.createViewNote(project.id, { view: 'top', x: 0.5, y: 0.5, text: '尾巴' }), { code: 'INVALID_NOTE' });
  await assert.rejects(store.createViewNote(project.id, { view: 'back', x: 1.5, y: 0.5, text: '尾巴' }), { code: 'INVALID_NOTE' });
  await assert.rejects(store.createViewNote(project.id, { view: 'otherSide', x: 0.5, y: 0.5, text: '還沒畫的角度' }), { code: 'INVALID_NOTE' }, '只能標在有圖的角度上');
  // 背面裁切圖裡人物在 (0.05/0.3 … ) 的範圍；標在人物正中間、往下一半多的地方。
  const created = await store.createViewNote(project.id, { view: 'back', x: 0.5, y: 0.6, title: ' 尾巴 ', text: '從腰後正中間長出來，\n尾尖白色' });
  const note = created.viewNotes[0];
  assert.equal(note.title, '尾巴');
  assert.equal(note.text, '從腰後正中間長出來， 尾尖白色', '換行收成空白：交給 AI 時一個標註一行');
  assert.ok(Math.abs(note.x - 0.5) < 1e-9 && Math.abs(note.y - 0.6) < 1e-9, '畫面拿到的是在這張圖上的位置');
  // 重新裁切後人物在圖上的位置變了：標註跟著人物走（還是同一個部位）。
  const recut = await store.saveViews(project.id, { assetId: sheet.id, manual: true, items: items().map(item => item.view === 'back' ? { ...item, frame: { ...item.frame, y: 0 }, figure: { ...item.figure, y: 0.1, height: 0.8 } } : item) });
  const moved = recut.viewNotes[0];
  assert.equal(moved.bx, note.bx); assert.equal(moved.by, note.by);
  assert.notEqual(Math.round(moved.y * 1000), Math.round(note.y * 1000), '在新的裁切圖上換算到新的位置');
  await store.updateViewNote(project.id, note.id, { text: '從腰後正中間長出來，尾尖白色' });
  await store.createViewNote(project.id, { view: 'front', x: 0.2, y: 0.3, text: '左胸的徽章' });
  const updated = await store.updateViewNote(project.id, note.id, { text: '從腰後正中間長出來，尾尖白色，平常往上捲', bogus: 1 });
  assert.equal(updated.viewNotes[0].text, '從腰後正中間長出來，尾尖白色，平常往上捲');
  assert.equal(updated.viewNotes[0].bogus, undefined);
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '重畫背面', kind: 'generate', outputView: 'back', baseRevision: split.character.revision });
  const text = await fs.readFile(job.context.instructionsPath, 'utf8');
  assert.match(text, /設計標註（設計師標在角度圖上的重點/);
  assert.match(text, /1\. 〔背面・從頭頂往下約 \d+% 的高度・畫面中間〕尾巴：從腰後正中間長出來，尾尖白色，平常往上捲/);
  assert.match(text, /2\. 〔正面・從頭頂往下約 \d+% 的高度・畫面左邊（角色的右邊）〕左胸的徽章/);
  assert.match(job.context.yaml, /# 設計標註/);
  const main = await store.createJob(project.id, { targetId: 'character', prompt: '整張重畫', kind: 'generate', baseRevision: split.character.revision });
  assert.match(main.handoffPrompt, /尾巴：從腰後正中間長出來/);
  const exported = (await store.exportProject(project.id)).buffer;
  // ZIP 的中央目錄找 views/notes.md（匯出用 deflate，解開比對）。
  let end = exported.length - 22;
  while (end >= 0 && exported.readUInt32LE(end) !== 0x06054b50) end--;
  let central = exported.readUInt32LE(end + 16), notes = null;
  for (let index = 0; index < exported.readUInt16LE(end + 10); index++) {
    const nameLength = exported.readUInt16LE(central + 28), name = exported.toString('utf8', central + 46, central + 46 + nameLength);
    if (name === 'views/notes.md') {
      const local = exported.readUInt32LE(central + 42), start = local + 30 + exported.readUInt16LE(local + 26) + exported.readUInt16LE(local + 28);
      const body = exported.subarray(start, start + exported.readUInt32LE(central + 20));
      notes = (exported.readUInt16LE(central + 10) === 8 ? inflateRawSync(body) : body).toString('utf8');
    }
    central += 46 + nameLength + exported.readUInt16LE(central + 30) + exported.readUInt16LE(central + 32);
  }
  assert.match(notes || '', /^# 設計標註\n\n1\. 〔背面/);
  await store.deleteViewNote(project.id, note.id);
  await assert.rejects(store.deleteViewNote(project.id, note.id), { code: 'NOTE_NOT_FOUND' });
  assert.equal((await store.getProject(project.id)).viewNotes.length, 1);
});

test('HTTP：加角度、拿掉角度與設計標註的介面', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-notes-http-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client: { close() {} }, version: async () => 'test' }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const store = running.store;
  const project = await store.createProject({ name: '標註介面' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫三視圖', kind: 'generate', baseRevision: 1, framing: 'turnaround' });
  const { asset, candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id });
  await store.acceptCandidate(project.id, candidate.id, { baseRevision: 1 });
  await store.saveViews(project.id, { assetId: asset.id, items: items() });
  const call = (method, url, body) => fetch(`${running.url}/api/projects/${project.id}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const added = await call('POST', '/views/extra', { view: 'backQuarter' });
  assert.equal(added.status, 200);
  assert.deepEqual((await added.json()).views.extra, ['backQuarter']);
  assert.equal((await call('POST', '/views/extra', { view: 'nope' })).status, 422);
  const created = await call('POST', '/view-notes', { view: 'back', x: 0.5, y: 0.5, title: '尾巴', text: '從腰後正中間長出來' });
  assert.equal(created.status, 201);
  const note = (await created.json()).viewNotes[0];
  const patched = await call('PATCH', `/view-notes/${note.id}`, { x: 0.4, y: 0.45 });
  assert.equal(patched.status, 200);
  assert.ok(Math.abs((await patched.json()).viewNotes[0].x - 0.4) < 1e-9);
  assert.equal((await call('PATCH', '/view-notes/note-missing', { text: '找不到' })).status, 404);
  assert.equal((await call('DELETE', `/view-notes/${note.id}`)).status, 200);
  const removed = await call('DELETE', '/views/extra/backQuarter');
  assert.deepEqual((await removed.json()).views.extra, []);
});
