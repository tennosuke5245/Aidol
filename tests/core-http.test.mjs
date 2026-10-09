import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { request as httpRequest } from 'node:http';
import { startServer } from '../server/http.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');
async function setup(t, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-http-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, ...options });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const request = (route, options) => fetch(`${running.url}${route}`, options);
  const json = async (route, method = 'GET', body) => {
    const response = await request(route, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { response, body: await response.json() };
  };
  return { ...running, request, json };
}

test('HTTP實際建立角色、工作、匯回待審圖片、採用與下載', async (t) => {
  const { request, json } = await setup(t);
  const created = await json('/api/projects', 'POST', { name: '凜', brief: '送件的信使' });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.character.revision, 1);
  const id = created.body.id;
  const job = await json(`/api/projects/${id}/jobs`, 'POST', { prompt: '建立角色正面稿', targetId: 'character', kind: 'generate', baseRevision: 1 });
  assert.equal(job.response.status, 201);
  const form = new FormData();
  form.set('file', new Blob([png], { type: 'image/png' }), 'candidate.png');
  form.set('targetId', 'character');
  form.set('jobId', job.body.id);
  form.set('role', 'design');
  const submitted = await request(`/api/projects/${id}/assets`, { method: 'POST', body: form });
  assert.equal(submitted.status, 201);
  const candidate = await submitted.json();
  assert.equal(candidate.candidate.status, 'pending');
  assert.equal(candidate.project.character.adopted.character, undefined);
  const picture = await request(candidate.asset.url);
  assert.equal(picture.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await picture.arrayBuffer()), png);
  const accepted = await json(`/api/projects/${id}/candidates/${candidate.candidate.id}/accept`, 'POST', { baseRevision: 1 });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.character.adopted.character, candidate.asset.id);
  assert.equal(accepted.body.character.revision, 2);
  const exported = await request(`/api/projects/${id}/export`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /design-pack.zip/);
  assert.equal(Buffer.from(await exported.arrayBuffer()).readUInt32LE(0), 0x04034b50);
  const yaml = await request(`/api/projects/${id}/yaml`);
  assert.match(await yaml.text(), /revision: 2/);
});

test('HTTP錯誤清楚回報衝突、無效YAML、來源限制與路徑穿越', async (t) => {
  const { request, json, port } = await setup(t);
  const { body: project } = await json('/api/projects', 'POST', { name: '角色' });
  const conflict = await json(`/api/projects/${project.id}/character`, 'PUT', { baseRevision: 0, character: project.character });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, 'REVISION_CONFLICT');
  const invalid = await json(`/api/projects/${project.id}/character`, 'PUT', { baseRevision: 1, yaml: 'name: [bad' });
  assert.equal(invalid.response.status, 422);
  assert.equal(invalid.body.code, 'INVALID_YAML');
  const external = await request('/api/projects', { headers: { Origin: 'https://unrelated.example' } });
  assert.equal(external.status, 403);
  const rebinding = await new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path: '/api/projects', headers: { Host: 'attacker.example', Origin: 'http://attacker.example' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(rebinding.status, 403);
  assert.equal(rebinding.body.code, 'HOST_NOT_ALLOWED');
  const traversal = await request('/api/projects/%2e%2e%5coutside');
  assert.equal(traversal.status, 400);
  assert.equal((await traversal.json()).code, 'INVALID_ID');
  const missing = await json('/api/unknown');
  assert.equal(missing.response.status, 404);
});

test('靜態前端與整合callback共用本機服務', async (t) => {
  const client = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-client-'));
  t.after(() => fs.rm(client, { recursive: true, force: true }));
  await fs.writeFile(path.join(client, 'index.html'), '<html><body>AIDOL</body></html>');
  let closed = false;
  const { request, close } = await setup(t, { staticDir: client, registerIntegrations: (app, store) => {
    app.get('/api/integration-test', (_req, res) => res.json({ dataDir: store.dataDir }));
    return { close: () => { closed = true; } };
  } });
  assert.match(await (await request('/', { headers: { Accept: 'text/html' } })).text(), /AIDOL/);
  assert.equal((await request('/api/integration-test')).status, 200);
  await close();
  assert.equal(closed, true);
});
