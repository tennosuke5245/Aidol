import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');

async function setup(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-canvas-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const project = await store.createProject({ name: '畫布驗證', brief: '角色設定與自由說明分開保存' });
  return { dataDir, store, project };
}

test('畫布註記重開保留，CRUD 不寫入人物 YAML、版本、歷史或固定工作輸入', async t => {
  const { dataDir, store, project } = await setup(t);
  const reference = await store.addAsset(project.id, { buffer: png, role: 'reference', name: '色彩研究' });
  const job = await store.createJob(project.id, { baseRevision: 1, prompt: '依正式人設建立角色稿', kind: 'generate' });
  const before = await store.getProject(project.id);
  const yamlPath = path.join(store.projectDir(project.id), 'character.yaml');
  const yaml = await fs.readFile(yamlPath, 'utf8');
  const yamlModifiedAt = (await fs.stat(yamlPath)).mtimeMs;
  const note = await store.createCanvasAnnotation(project.id, { kind: 'note', text: '袖口收窄，但尚未決定', tone: 'rose', position: { x: -40.5, y: 180 } });
  const explanation = await store.createCanvasAnnotation(project.id, { kind: 'text', text: '這是畫布說明，不是人設', tone: 'neutral' });
  const image = await store.createCanvasAnnotation(project.id, { kind: 'reference', assetId: reference.asset.id, title: '色彩方向', description: '供自由比較，尚未加入正式繪風', position: { x: 240, y: -30 } });
  const patched = await store.updateCanvasAnnotation(project.id, note.annotation.id, { text: '先保留原輪廓' });
  assert.equal(patched.annotation.tone, 'rose');
  assert.deepEqual(patched.annotation.position, { x: -40.5, y: 180 });
  assert.equal(patched.annotation.createdAt, note.annotation.createdAt);
  const reopened = await new ProjectStore({ dataDir, demo: false }).init();
  const restored = await reopened.getProject(project.id);
  assert.deepEqual(restored.canvasAnnotations, patched.project.canvasAnnotations);
  assert.equal(restored.canvasAnnotations.length, 3);
  const afterDelete = await store.deleteCanvasAnnotation(project.id, image.annotation.id);
  assert.deepEqual(afterDelete.canvasAnnotations.map(item => item.id), [note.annotation.id, explanation.annotation.id]);
  for (const field of ['character', 'history', 'jobs', 'candidates', 'proposals', 'syncTargets', 'assets']) assert.deepEqual(afterDelete[field], before[field], field);
  assert.equal(await fs.readFile(yamlPath, 'utf8'), yaml);
  assert.equal((await fs.stat(yamlPath)).mtimeMs, yamlModifiedAt, '畫布 CRUD 不應重寫 character.yaml');
  assert.deepEqual((await store.readAsset(project.id, reference.asset.id)).buffer, png, '移除圖卡保留圖片資產');
  const nextJob = await store.createJob(project.id, { baseRevision: 1, prompt: '建立下一張正式角色稿', kind: 'generate' });
  assert.equal(nextJob.context.yaml, job.context.yaml);
  assert.deepEqual(nextJob.context.referenceAssets, [], '自由參考圖卡不自動成為 agent 參考');
});

test('同專案佇列合併局部更新，拖曳與文字不互相覆寫，也不覆寫並行人物更新', async t => {
  const { store, project } = await setup(t);
  const { annotation } = await store.createCanvasAnnotation(project.id, { kind: 'note', text: '起始文字', tone: 'gold' });
  const character = structuredClone(project.character);
  character.persona.description = '已正式更新的人設';
  await Promise.all([
    store.updateCanvasAnnotation(project.id, annotation.id, { position: { x: 50.25, y: -60.5 } }),
    store.updateCharacter(project.id, { baseRevision: 1, character }),
    store.updateCanvasAnnotation(project.id, annotation.id, { text: '保存後的自由說明', tone: 'blue' }),
  ]);
  const result = await store.getProject(project.id);
  assert.equal(result.character.revision, 2);
  assert.equal(result.character.persona.description, '已正式更新的人設');
  assert.equal(result.canvasAnnotations[0].text, '保存後的自由說明');
  assert.equal(result.canvasAnnotations[0].tone, 'blue');
  assert.deepEqual(result.canvasAnnotations[0].position, { x: 50.25, y: -60.5 });
  assert.equal(result.history.length, 2, '只有正式人物更新新增歷史');
});

test('舊專案缺註記欄位時讀為空陣列，第一次保存仍保留其他 metadata', async t => {
  const { dataDir, store, project } = await setup(t);
  const metadataPath = path.join(store.projectDir(project.id), 'project.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  delete metadata.canvasAnnotations;
  metadata.canvasSettings = { viewport: { x: 15, y: 25, zoom: 0.8 } };
  await fs.writeFile(metadataPath, JSON.stringify(metadata));
  const reopened = await new ProjectStore({ dataDir, demo: false }).init();
  assert.deepEqual((await reopened.getProject(project.id)).canvasAnnotations, []);
  const result = await reopened.createCanvasAnnotation(project.id, { kind: 'note' });
  assert.equal(result.annotation.text, '');
  assert.deepEqual(result.annotation.position, { x: 0, y: 0 });
  assert.deepEqual(JSON.parse(await fs.readFile(metadataPath, 'utf8')).canvasSettings, metadata.canvasSettings);
  assert.equal(result.project.character.revision, 1);
});

test('註記資料拒絕外部圖片、跨專案引用、無效座標與固定欄位變更，錯誤不寫入資料', async t => {
  const { store, project } = await setup(t);
  const other = await store.createProject({ name: '另一位角色' });
  const foreign = await store.addAsset(other.id, { buffer: png, role: 'reference' });
  for (const input of [
    { kind: 'reference', assetId: foreign.asset.id },
    { kind: 'reference', assetId: 'https://example.com/image.png' },
    { kind: 'note', text: '錯誤座標', position: { x: Infinity, y: 0 } },
    { kind: 'note', position: { x: 1 } },
    { kind: 'note', position: { x: 0, y: 0, width: 200 } },
    { kind: 'note', tone: 'arbitrary-css' },
    { kind: 'note', text: 'x'.repeat(12001) },
    { kind: 'note', character: project.character },
  ]) await assert.rejects(store.createCanvasAnnotation(project.id, input), { status: 422 });
  assert.deepEqual((await store.getProject(project.id)).canvasAnnotations, []);
  const { annotation } = await store.createCanvasAnnotation(project.id, { kind: 'note', text: '有效內容' });
  const before = await store.getProject(project.id);
  for (const input of [{}, { kind: 'text' }, { id: 'another' }, { createdAt: 'fake' }, { assetId: foreign.asset.id }]) {
    await assert.rejects(store.updateCanvasAnnotation(project.id, annotation.id, input), { code: 'INVALID_CANVAS_ANNOTATION' });
  }
  await assert.rejects(store.updateCanvasAnnotation(other.id, annotation.id, { text: '跨專案修改' }), { code: 'CANVAS_ANNOTATION_NOT_FOUND' });
  await assert.rejects(store.deleteCanvasAnnotation(other.id, annotation.id), { code: 'CANVAS_ANNOTATION_NOT_FOUND' });
  await assert.rejects(store.deleteCanvasAnnotation(project.id, '../outside'), { code: 'INVALID_ID' });
  assert.deepEqual(await store.getProject(project.id), before);
});

async function httpSetup(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-canvas-http-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const json = async (route, method = 'GET', body) => {
    const response = await fetch(`${running.url}${route}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { response, body: await response.json() };
  };
  return { ...running, json };
}

test('HTTP 保存、修改與移除便利貼及圖片卡，重新載入仍使用同一份本機資料', async t => {
  const { url, json, store } = await httpSetup(t);
  const { body: project } = await json('/api/projects', 'POST', { name: 'HTTP 畫布' });
  const collection = `/api/projects/${project.id}/canvas-annotations`;
  const preflight = await fetch(`${url}${collection}`, { method: 'OPTIONS', headers: { Origin: url, 'Access-Control-Request-Method': 'PATCH' } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
  assert.match(preflight.headers.get('access-control-allow-methods'), /DELETE/);
  const created = await json(collection, 'POST', { kind: 'note', text: '自由便利貼', position: { x: 15, y: 25 } });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.project.character.revision, 1);
  const updated = await json(`${collection}/${created.body.annotation.id}`, 'PATCH', { text: '修改文字', tone: 'neutral' });
  assert.equal(updated.response.status, 200);
  assert.deepEqual(updated.body.annotation.position, { x: 15, y: 25 });
  const form = new FormData();
  form.set('file', new Blob([png], { type: 'image/png' }), 'reference.png');
  form.set('role', 'reference');
  const uploaded = await fetch(`${url}/api/projects/${project.id}/assets`, { method: 'POST', body: form });
  const { asset } = await uploaded.json();
  const image = await json(collection, 'POST', { kind: 'reference', assetId: asset.id, title: '真實匯入圖片', description: '畫布中的參考' });
  assert.equal(image.response.status, 201);
  const list = await json(collection);
  assert.equal(list.body.length, 2);
  assert.equal((await json(`/api/projects/${project.id}`)).body.canvasAnnotations[1].assetId, asset.id);
  const removed = await json(`${collection}/${image.body.annotation.id}`, 'DELETE');
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.canvasAnnotations.length, 1);
  assert.equal(removed.body.character.style.references.length, 0);
  assert.equal(removed.body.character.revision, 1);
  assert.deepEqual((await store.readAsset(project.id, asset.id)).buffer, png);
  const yaml = await (await fetch(`${url}/api/projects/${project.id}/yaml`)).text();
  assert.doesNotMatch(yaml, /修改文字|畫布中的參考|canvasAnnotations/);
});

test('HTTP 註記校驗提供明確 422／404，不能透過 PATCH 改寫人物或外部圖網址', async t => {
  const { json } = await httpSetup(t);
  const { body: project } = await json('/api/projects', 'POST', { name: '錯誤驗證' });
  const collection = `/api/projects/${project.id}/canvas-annotations`;
  const external = await json(collection, 'POST', { kind: 'reference', assetId: 'https://example.com/picture.png' });
  assert.equal(external.response.status, 422);
  assert.equal(external.body.code, 'INVALID_CANVAS_ANNOTATION');
  const { body: created } = await json(collection, 'POST', { kind: 'text', text: '純說明' });
  const invalid = await json(`${collection}/${created.annotation.id}`, 'PATCH', { revision: 999, position: { x: null, y: 0 } });
  assert.equal(invalid.response.status, 422);
  assert.equal(invalid.body.code, 'INVALID_CANVAS_ANNOTATION');
  const missing = await json(`${collection}/annotation-missing`, 'DELETE');
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.code, 'CANVAS_ANNOTATION_NOT_FOUND');
  const reloaded = (await json(`/api/projects/${project.id}`)).body;
  assert.equal(reloaded.character.revision, 1);
  assert.equal(reloaded.canvasAnnotations[0].text, '純說明');
});

test('HTTP 自由參考圖片匯入與圖卡保存只更新 metadata，不重寫人物 YAML 或工作資料', async t => {
  const { url, json, store } = await httpSetup(t);
  const { body: project } = await json('/api/projects', 'POST', { name: '自由圖片保存' });
  const job = await store.createJob(project.id, { baseRevision: 1, kind: 'generate', prompt: '按正式人物設定建立圖稿' });
  const before = await store.getProject(project.id);
  const yamlPath = path.join(store.projectDir(project.id), 'character.yaml');
  const yaml = await fs.readFile(yamlPath, 'utf8');
  const yamlModifiedAt = (await fs.stat(yamlPath)).mtimeMs;
  const form = new FormData();
  form.set('file', new Blob([png], { type: 'image/png' }), 'canvas-reference.png');
  form.set('role', 'reference');
  const uploaded = await fetch(`${url}/api/projects/${project.id}/assets`, { method: 'POST', body: form });
  assert.equal(uploaded.status, 201);
  const { asset, project: afterUpload } = await uploaded.json();
  assert.equal(afterUpload.character.revision, 1);
  assert.equal((await fs.stat(yamlPath)).mtimeMs, yamlModifiedAt, '匯入自由參考圖片不重寫 YAML');
  const created = await json(`/api/projects/${project.id}/canvas-annotations`, 'POST', { kind: 'reference', assetId: asset.id, title: '自由參考', position: { x: 300, y: 200 } });
  assert.equal(created.response.status, 201);
  assert.equal(await fs.readFile(yamlPath, 'utf8'), yaml);
  assert.equal((await fs.stat(yamlPath)).mtimeMs, yamlModifiedAt, '加入參考圖卡也不重寫 YAML');
  for (const field of ['character', 'history', 'jobs', 'candidates', 'proposals', 'syncTargets']) assert.deepEqual(created.body.project[field], before[field], field);
  assert.equal(created.body.project.jobs[0].context.yaml, job.context.yaml);
  assert.deepEqual((await store.readAsset(project.id, asset.id)).buffer, png);
});
