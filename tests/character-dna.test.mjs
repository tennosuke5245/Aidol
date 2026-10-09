import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { demoCharacter, newCharacter, validateCharacter, parseCharacterYaml, characterYaml } from '../shared/domain.mjs';
import { compileBrief, dnaRows, directionOf, hasDna, mixerDiff } from '../shared/prompt-compiler.mjs';
import { describeChanges } from '../shared/character-diff.mjs';
import { mixerKeys, mixerPresets, hairStyles } from '../shared/libraries.mjs';
import { ProjectStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
import { registerCodexRoutes } from '../server/integrations.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYlIAAAAASUVORK5CYII=', 'base64');

test('角色 DNA 編譯：結構化欄位、色票、鎖定特徵與指定畫風方向', () => {
  const character = demoCharacter();
  const brief = compileBrief(character, { outfitId: 'combat', framing: 'sheet' });
  assert.equal(brief.empty, false);
  assert.deepEqual(brief.direction, { id: 'A', name: '輕渲染' });
  assert.ok(brief.prompt.includes('silver-white hair'));
  assert.ok(brief.prompt.includes('7.5-head body proportion'));
  assert.ok(brief.prompt.includes('light anime rendering'));
  assert.ok(brief.prompt.includes('clean character design sheet layout'));
  assert.ok(brief.prompt.endsWith('must keep: 銀白短髮; 琥珀金色眼睛; 黃銅月牙扣具'));
  assert.ok(brief.text.includes('鎖定特徵：銀白短髮；琥珀金色眼睛；黃銅月牙扣具（每張都必須保留）'));
  assert.ok(brief.text.includes('穿搭「主要穿搭」：旅行機能・平衡・多層・機能・深藍／青綠／黃銅'));
  const b = compileBrief(character, { directionId: 'B' });
  assert.equal(b.direction.id, 'B');
  assert.ok(b.prompt.includes('standard anime rendering'));
  assert.equal(compileBrief(character, { directionId: 'missing' }).direction.id, 'A', '不存在的方向退回目前方向');
});

test('沒有 DNA 的舊角色仍可編譯；完全沒有設定時不產生空白段落', () => {
  const legacy = newCharacter('legacy', '舊角色');
  delete legacy.style.directions; delete legacy.style.activeDirection; legacy.schema_version = 1;
  validateCharacter(legacy);
  const empty = compileBrief(legacy);
  assert.equal(empty.empty, true);
  assert.equal(empty.text, '');
  assert.equal(hasDna(legacy), false);
  assert.equal(directionOf(legacy), null);
  const fresh = newCharacter('fresh', '新角色');
  assert.equal(fresh.schema_version, 2);
  assert.deepEqual(Object.keys(fresh.style.directions.A.mixer).sort(), [...mixerKeys].sort());
  assert.equal(compileBrief(fresh).direction.name, '日常動畫');
});

test('左欄摘要列出身形、髮、眼、服裝與畫風，顏色另以色塊呈現', () => {
  const rows = dnaRows(demoCharacter(), { outfitId: 'combat' });
  assert.deepEqual(rows.map(row => row.label), ['身形', '髮', '眼', '服裝', '畫風']);
  assert.equal(rows[0].value, '青年・7.5 頭身・纖瘦・高挑');
  assert.equal(rows[1].swatch, '#D8DAE0');
  assert.ok(!rows[1].value.includes('銀白'));
  assert.equal(rows[2].swatch, '#C28A3E');
  assert.equal(rows[4].value, 'A · 輕渲染 · 渲染輕');
});

test('schema 驗證新欄位：方向、色票與穿搭配色引用', () => {
  const character = demoCharacter();
  assert.equal(parseCharacterYaml(characterYaml(character)).dna.hair.color, 'silver');
  const badDirection = structuredClone(character); badDirection.style.activeDirection = 'C';
  assert.throws(() => validateCharacter(badDirection), { code: 'UNKNOWN_DIRECTION' });
  const badHex = structuredClone(character); badHex.palette[0].hex = 'silver';
  assert.throws(() => validateCharacter(badHex), { code: 'INVALID_CHARACTER' });
  const badSwatch = structuredClone(character); badSwatch.outfits.combat.spec.colors.push('gold');
  assert.throws(() => validateCharacter(badSwatch), { code: 'UNKNOWN_SWATCH' });
  const badStep = structuredClone(character); badStep.style.directions.A.mixer.rendering = 5;
  assert.throws(() => validateCharacter(badStep), { code: 'INVALID_CHARACTER' });
  const badHair = structuredClone(character); badHair.dna.hair.style = 'not-a-style';
  assert.throws(() => validateCharacter(badHair), { code: 'INVALID_CHARACTER' });
  assert.ok(hairStyles.every(style => !/\bboy\b|shota/i.test(style.prompt + style.tags.join(' '))), '樣式庫提示詞維持中性');
});

test('設定差異以設計師的語言列出，取代閱讀整份 YAML', () => {
  const before = demoCharacter();
  const after = structuredClone(before);
  after.dna.body.headRatio = '6.5';
  after.dna.hair.color = 'black';
  after.style.directions.A.mixer.rendering = 2;
  after.palette.push({ id: 'cream', name: '米白', hex: '#EFE6D2', use: 'secondary' });
  after.locks = [...after.locks, '左耳耳環'];
  after.outfits.combat.equipped.find(item => item.componentId === 'clasp').enabled = false;
  const changes = describeChanges(before, after);
  const labels = changes.map(change => `${change.label}:${change.from}→${change.to}`);
  assert.ok(labels.includes('頭身比:7.5 頭身→6.5 頭身'));
  assert.ok(labels.includes('髮色:銀白→墨黑'));
  assert.ok(labels.includes('方向 A 渲染:輕→標準'));
  assert.ok(labels.includes('新增 米白:—→#EFE6D2'));
  assert.ok(labels.includes('主要穿搭：胸前扣具:穿戴→未穿戴'));
  assert.ok(changes.some(change => change.area === '鎖定特徵'));
  assert.deepEqual(describeChanges(before, structuredClone(before)), []);
  assert.deepEqual(mixerDiff(before.style.directions.A.mixer, before.style.directions.B.mixer).map(item => item.label), ['構圖', '細節', '渲染', '背景', '配件']);
  assert.equal(mixerPresets.length, 3);
});

test('工作快照帶入編譯後的 DNA、畫風方向與張數；不合法的張數或方向被拒絕', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidol-dna-'));
  try {
    const store = new ProjectStore({ dataDir: directory, demo: true });
    const job = await store.createJob('rin', { targetId: 'character', prompt: '探索兩個畫風方向', baseRevision: 1, directionId: 'B', variants: 4, framing: 'sheet' });
    assert.equal(job.variants, 4);
    assert.equal(job.directionId, 'B');
    assert.equal(job.framing, 'sheet');
    assert.ok(job.handoffPrompt.includes('本次請產生 4 張候選'));
    assert.ok(job.handoffPrompt.includes('畫風方向：B · 標準'));
    assert.ok(job.context.compiled.includes('## 畫風方向 B · 標準'));
    assert.ok(job.context.compiledPrompt.includes('standard anime rendering'));
    const instructions = await readFile(job.context.instructionsPath, 'utf8');
    assert.ok(instructions.includes('## 結構化角色 DNA'));
    assert.ok(instructions.includes('## English brief'));
    await assert.rejects(store.createJob('rin', { prompt: '太多張', baseRevision: 1, variants: 3 }), { code: 'INVALID_VARIANTS' });
    await assert.rejects(store.createJob('rin', { prompt: '方向', baseRevision: 1, directionId: 'Z' }), { code: 'UNKNOWN_DIRECTION' });
    await assert.rejects(store.createJob('rin', { prompt: '取景', baseRevision: 1, framing: 'wide' }), { code: 'INVALID_FRAMING' });
    await assert.rejects(store.updateJob('rin', job.id, { variants: 1 }), { code: 'INVALID_INPUT' });
    const plain = await store.createJob('rin', { prompt: '預設一張', baseRevision: 1 });
    assert.equal(plain.variants, 1);
    assert.equal(plain.directionId, 'A');
    const saved = await store.updateCharacter('rin', { baseRevision: 1, character: (await store.getProject('rin')).character });
    assert.equal(saved.character.schema_version, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('進度只由持有回收憑證的 Skill 回報：開始、完成、失敗各有明確狀態', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidol-progress-'));
  const running = await startServer({ dataDir: directory, demo: true, port: 0, announce: false, registerIntegrations: registerCodexRoutes });
  const post = (url, body, token) => fetch(`${running.url}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    const job = await running.store.createJob('rin', { prompt: '回報測試', baseRevision: 1, variants: 2 });
    const route = `/api/projects/rin/jobs/${job.id}`;
    assert.equal((await post(`${route}/handoff`, {})).status, 200);
    const handoffFile = path.join(running.store.jobDir('rin', job.id), 'handoff.json');
    const secret = JSON.parse(await readFile(handoffFile, 'utf8'));
    assert.equal(secret.variants, 2);
    assert.ok(secret.progressUrl.endsWith(`${route}/progress`));
    assert.equal((await post(`${route}/progress`, { event: 'started' })).status, 403);
    assert.equal((await post(`${route}/progress`, { event: 'started' }, 'wrong')).status, 403);
    assert.equal((await post(`${route}/progress`, { event: 'guess' }, secret.token)).status, 400);
    const helper = path.resolve('.agents/skills/aidol/scripts/submit-candidate.mjs');
    const started = JSON.parse((await promisify(execFile)(process.execPath, [helper, '--job', handoffFile, '--event', 'started'], { windowsHide: true })).stdout);
    assert.equal(started.status, 'running');
    let state = await running.store.getProject('rin');
    assert.equal(state.jobs.find(item => item.id === job.id).status, 'running');
    // 再次開啟交接不會把「生成中」退回「等你送出」。
    const again = await (await post(`${route}/handoff`, {})).json();
    assert.equal(again.job.status, 'running');
    const image = path.join(directory, 'one.png'); await writeFile(image, png);
    await promisify(execFile)(process.execPath, [helper, '--job', handoffFile, '--image', image], { windowsHide: true });
    state = await running.store.getProject('rin');
    assert.equal(state.jobs.find(item => item.id === job.id).status, 'review');
    const finished = await (await post(`${route}/progress`, { event: 'finished' }, secret.token)).json();
    assert.equal(finished.status, 'review');
    assert.ok(finished.progress.finishedAt);

    const other = await running.store.createJob('rin', { prompt: '失敗測試', baseRevision: 1 });
    await post(`/api/projects/rin/jobs/${other.id}/handoff`, {});
    const otherSecret = JSON.parse(await readFile(path.join(running.store.jobDir('rin', other.id), 'handoff.json'), 'utf8'));
    assert.equal((await post(`/api/projects/rin/jobs/${other.id}/progress`, { event: 'started' }, secret.token)).status, 403, '不同工作的憑證不能互用');
    const failed = await (await post(`/api/projects/rin/jobs/${other.id}/progress`, { event: 'failed', message: '沒有圖像工具' }, otherSecret.token)).json();
    assert.equal(failed.status, 'failed');
    state = await running.store.getProject('rin');
    assert.equal(state.jobs.find(item => item.id === other.id).failure.message, '沒有圖像工具');
    const retry = await (await post(`/api/projects/rin/jobs/${other.id}/handoff`, {})).json();
    assert.equal(retry.job.status, 'handed_off', '失敗後可以重新送出');
  } finally { await running.close(); await rm(directory, { recursive: true, force: true }); }
});

test('先採用其中一張時，同一輪還在畫的圖仍能傳回來，畫完才關閉', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidol-late-'));
  const running = await startServer({ dataDir: directory, demo: true, port: 0, announce: false, registerIntegrations: registerCodexRoutes });
  const post = (url, body, token) => fetch(`${running.url}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    const job = await running.store.createJob('rin', { prompt: '先挑一張', baseRevision: 1, variants: 2 });
    const route = `/api/projects/rin/jobs/${job.id}`;
    await post(`${route}/handoff`, {});
    const handoffFile = path.join(running.store.jobDir('rin', job.id), 'handoff.json');
    const secret = JSON.parse(await readFile(handoffFile, 'utf8'));
    const helper = path.resolve('.agents/skills/aidol/scripts/submit-candidate.mjs');
    const run = args => promisify(execFile)(process.execPath, [helper, '--job', handoffFile, ...args], { windowsHide: true });
    await run(['--event', 'started']);
    const first = path.join(directory, 'first.png'); await writeFile(first, png);
    await run(['--image', first]);
    let state = await running.store.getProject('rin');
    const picked = state.candidates.find(item => item.jobId === job.id);
    await running.store.acceptCandidate('rin', picked.id, { baseRevision: state.character.revision });
    const second = path.join(directory, 'second.png'); await writeFile(second, Buffer.concat([png, Buffer.from([0])]));
    await run(['--image', second]);
    state = await running.store.getProject('rin');
    assert.equal(state.candidates.filter(item => item.jobId === job.id).length, 2, '採用後還在畫的圖仍能回來');
    assert.equal(state.jobs.find(item => item.id === job.id).status, 'accepted', '不會把已採用退回待挑選');
    assert.equal((await post(`${route}/progress`, { event: 'finished' }, secret.token)).status, 200);
    await assert.rejects(run(['--image', first]), '畫完後不再收新圖');
  } finally { await running.close(); await rm(directory, { recursive: true, force: true }); }
});
