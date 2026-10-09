import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../server/http.mjs';
import { registerCodexRoutes } from '../server/integrations.mjs';
import { characterYaml } from '../shared/domain.mjs';
import { installSkill, skillStatus } from '../scripts/install-skill.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYlIAAAAASUVORK5CYII=', 'base64');

test('App交接固定工作、候選回收去重、拒絕錯誤憑證與跨工作結果', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidol-codex-'));
  const running = await startServer({ dataDir: directory, demo: false, port: 0, announce: false, registerIntegrations: registerCodexRoutes });
  const json = async (url, body) => {
    const response = await fetch(`${running.url}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  try {
    const project = await json('/api/projects', { name: '回收測試' });
    const job = await json(`/api/projects/${project.id}/jobs`, { prompt: '參考線稿增加髮夾', baseRevision: 1, kind: 'generate' });
    const route = `/api/projects/${project.id}/jobs/${job.id}`;
    const handoff = await json(`${route}/handoff`, {});
    const link = new URL(handoff.url);
    assert.equal(link.protocol, 'codex:'); assert.equal(link.hostname, 'new');
    assert.equal(link.searchParams.get('path'), running.store.projectDir(project.id));
    assert.ok(link.searchParams.get('prompt').includes('input.yaml'));
    // 交接訊息要短：只寫畫什麼與相對於工作區的工作資料夾，不貼完整路徑與規則（規則在 skill 與 instructions.md）。
    const prompt = link.searchParams.get('prompt');
    assert.ok(prompt.length < 160, `交接訊息太長：${prompt.length} 字`);
    assert.ok(prompt.includes(path.join('jobs', job.id)), '寫出工作資料夾');
    assert.ok(!prompt.includes(running.store.projectDir(project.id)), '不貼完整路徑');
    assert.equal(handoff.prompt, prompt);
    const instructions = await readFile(path.join(running.store.jobDir(project.id, job.id), 'instructions.md'), 'utf8');
    assert.match(instructions, /## 回報與回收[\s\S]*--event started[\s\S]*本次共 1 張[\s\S]*--event finished/, '回報規則寫在 instructions.md');
    assert.equal(handoff.job.context.yaml, job.context.yaml);
    assert.ok(!JSON.stringify(handoff).includes('"token"'));
    const secret = JSON.parse(await readFile(path.join(running.store.jobDir(project.id, job.id), 'handoff.json'), 'utf8'));
    const submit = async ({ token = secret.token, id = job.id } = {}) => {
      const form = new FormData();
      form.set('manifest', JSON.stringify({ schemaVersion: 1, jobId: id, source: 'codex-app', threadId: 'test-session', outputs: [{ name: '髮夾候選', sha256: createHash('sha256').update(png).digest('hex') }] }));
      form.append('images', new Blob([png]), 'candidate.png');
      return fetch(`${running.url}${route}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    };
    assert.equal((await submit({ token: 'wrong' })).status, 403);
    assert.equal((await submit({ id: 'another-job' })).status, 400);
    const first = await (await submit()).json();
    const second = await (await submit()).json();
    assert.equal(first.candidates.length, 1); assert.equal(second.duplicate, true);
    assert.equal(first.candidates[0].id, second.candidates[0].id);
    const final = await running.store.getProject(project.id);
    assert.equal(final.candidates.length, 1); assert.equal(final.character.revision, 1);
    assert.deepEqual(final.character.adopted, {});
    assert.equal(final.jobs[0].threadId, 'test-session');
  } finally { await running.close(); await rm(directory, { recursive: true, force: true }); }
});

test('Codex聊天保存描述提案，原設定在採用前保持原樣', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidol-chat-'));
  let calls = 0; let current;
  const client = { close() {}, async freshTurn({ prompt }) {
    assert.ok(prompt.includes('必須使用自然繁體中文敘述角色或美術設計。'));
    assert.ok(prompt.includes('不要在這些內容提及 schema、identity、components、YAML 欄位'));
    calls++; const character = structuredClone(current.character); character.persona.traits.push(`提案${calls}`);
    return { threadId: `fresh-${calls}`, turnId: `turn-${calls}`, text: JSON.stringify({ yaml: characterYaml(character), summary: '新增個性提案' }) };
  } };
  const running = await startServer({ dataDir: directory, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client }) });
  try {
    current = await running.store.createProject({ name: '描述測試' });
    const invoke = async () => {
      const response = await fetch(`${running.url}/api/projects/${current.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '提出個性描述' }) });
      assert.ok(response.ok, await response.clone().text()); return response.json();
    };
    const first = await invoke(); const second = await invoke();
    assert.notEqual(first.threadId, second.threadId);
    const final = await running.store.getProject(current.id);
    assert.equal(final.proposals.length, 2); assert.deepEqual(final.character.persona.traits, []);
    assert.equal(first.draft.status, 'pending');
  } finally { await running.close(); await rm(directory, { recursive: true, force: true }); }
});

test('skill安裝可攜至指定位置且保留先前版本備份', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidol-skill-'));
  try {
    const destination = path.join(directory, 'skills', 'aidol');
    await installSkill({ destination });
    assert.equal((await skillStatus(destination)).installed, true);
    await installSkill({ destination });
    assert.ok((await readFile(path.join(destination, 'scripts', 'submit-candidate.mjs'), 'utf8')).includes('Authorization'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('回收helper省略視角時使用背面工作，候選採用不覆寫部件正面', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidol-helper-'));
  const running = await startServer({ dataDir: directory, demo: false, port: 0, announce: false, registerIntegrations: registerCodexRoutes });
  try {
    let project = await running.store.createProject({ name: '背面測試' });
    const character = structuredClone(project.character);
    character.components.coat = { id: 'coat', name: '外套', kind: 'garment', description: '深藍外套', designStatus: 'proposed' };
    project = await running.store.updateCharacter(project.id, { character, baseRevision: 1 });
    const job = await running.store.createJob(project.id, { targetId: 'coat', prompt: '展開外套背面', kind: 'expand', outputView: 'back', baseRevision: 2 });
    const response = await fetch(`${running.url}/api/projects/${project.id}/jobs/${job.id}/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok(response.ok, await response.clone().text());
    const handoff = JSON.parse(await readFile(path.join(running.store.jobDir(project.id, job.id), 'handoff.json'), 'utf8'));
    assert.equal(handoff.outputView, 'back');
    const { writeFile } = await import('node:fs/promises');
    const image = path.join(directory, 'back.png'); await writeFile(image, png);
    const result = await promisify(execFile)(process.execPath, [path.resolve('.agents/skills/aidol/scripts/submit-candidate.mjs'), '--job', path.join(running.store.jobDir(project.id, job.id), 'handoff.json'), '--image', image], { windowsHide: true });
    const submission = JSON.parse(result.stdout);
    const candidateId = submission.candidates[0].id;
    const before = await running.store.getProject(project.id);
    assert.equal(before.assets.find(asset => asset.id === submission.candidates[0].assetId).view, 'back');
    const accepted = await running.store.acceptCandidate(project.id, candidateId, { baseRevision: 2 });
    assert.equal(accepted.character.components.coat.assetId, undefined);
    assert.ok(accepted.character.components.coat.views.back);
  } finally { await running.close(); await rm(directory, { recursive: true, force: true }); }
});
