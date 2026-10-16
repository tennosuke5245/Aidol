import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { startServer } from '../server/http.mjs';
import { registerCodexRoutes } from '../server/integrations.mjs';
import { CodexClient } from '../server/codex/client.mjs';
import { ProjectStore } from '../server/store.mjs';
import { nextAutopilotStep, settleReview, autopilotConfig, drawPrompt, reviewSchema } from '../shared/autopilot.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');
// 每張圖內容不同（核心用雜湊去重）：在 PNG 結尾後面加一點東西，檔頭仍是 PNG。
let serial = 0;
const uniquePng = () => Buffer.concat([png, Buffer.from(`#${++serial}`)]);
const crop = (x) => ({ x, y: 0.03, width: 0.3, height: 0.94 });
const frontItems = () => [{ view: 'front', crop: crop(0), frame: crop(0), figure: { x: 0.05, y: 0.05, width: 0.2, height: 0.9 }, buffer: png }];
const waitFor = async (check, { timeout = 5000, label = '條件' } = {}) => {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error(`等不到${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const scores = (value) => ({ identity: value, spec: value, anatomy: value, style: value, clean: value });

test('Design QA 結果整理：只認這次的候選；挑的那張不過關就改挑過關裡最高分的；設定一致或規格不到 4 分不算過關；都不過關時留下修正說明', () => {
  const settled = settleReview({ summary: '第二張比較好', pick: 'c1', redoNote: '不該出現', candidates: [
    { candidateId: 'c1', ...scores(5), identity: 3, issues: ['髮色偏紅'], verdict: 'pass' },
    { candidateId: 'c2', ...scores(4), issues: [], verdict: 'pass' },
    { candidateId: 'c3', ...scores(5), issues: [], verdict: 'pass' },
    { candidateId: 'ghost', ...scores(5), issues: [], verdict: 'pass' },
    { candidateId: 'c2', ...scores(1), issues: [], verdict: 'fail' },
  ] }, ['c1', 'c2', 'c3']);
  assert.deepEqual(settled.candidates.map((entry) => entry.candidateId), ['c1', 'c2', 'c3'], '不認不存在的候選、重複的只算第一次');
  assert.equal(settled.candidates[0].pass, false, '設定一致 3 分不過關');
  assert.equal(settled.pick, 'c3', 'AI 挑的不過關，改挑過關裡總分最高的');
  assert.equal(settled.redoNote, '', '有過關的就不用修正說明');
  const none = settleReview({ summary: '都不行', pick: 'c1', redoNote: '背面的領巾結要在左肩', candidates: [{ candidateId: 'c1', ...scores(2), issues: ['手指 6 根'], verdict: 'fail' }] }, ['c1']);
  assert.equal(none.pick, null);
  assert.equal(none.redoNote, '背面的領巾結要在左肩');
  assert.deepEqual(none.candidates[0].issues, ['手指 6 根']);
  const clamp = settleReview({ summary: '', pick: '', redoNote: '', candidates: [{ candidateId: 'c1', identity: 9, spec: 0, anatomy: 4.6, style: 'x', clean: 3, issues: [1, ' 有字 '], verdict: 'maybe' }] }, ['c1']);
  assert.deepEqual(clamp.candidates[0].scores, { identity: 5, spec: 1, anatomy: 5, style: 1, clean: 3 });
  assert.deepEqual(clamp.candidates[0].issues, ['有字']);
  assert.equal(clamp.candidates[0].verdict, 'fail');
});

test('全自動的下一步只看角色目前的狀態：沒有拆好的正面就畫正面、等畫面裁切、依角度順序補畫勾選的角度', () => {
  const config = autopilotConfig({ views: ['back', 'side', 'frontQuarter', 'front', 'bogus'] });
  assert.deepEqual(config.views, ['frontQuarter', 'side', 'back'], '照轉台順序，不收正面與不認得的角度');
  assert.equal(config.variants, 2);
  const project = (adopted, views) => ({ character: { adopted: adopted ? { character: adopted } : {} }, views });
  assert.deepEqual(nextAutopilotStep(project(null, null), config), { kind: 'draw', view: 'front' });
  assert.deepEqual(nextAutopilotStep(project('a1', { status: 'boxes', assetId: 'a1' }), config), { kind: 'wait', reason: 'split' });
  assert.deepEqual(nextAutopilotStep(project('a1', { status: 'detecting', assetId: 'a1' }), config), { kind: 'wait', reason: 'detecting' });
  assert.deepEqual(nextAutopilotStep(project('a1', { status: 'done', assetId: 'old', items: { front: {} } }), config), { kind: 'draw', view: 'front' }, '換過正式圖，舊的三視圖不算');
  assert.deepEqual(nextAutopilotStep(project('a1', { status: 'none', assetId: 'a1' }), config), { kind: 'draw', view: 'front' });
  assert.deepEqual(nextAutopilotStep({ ...project('a2', { status: 'done', assetId: 'a1', items: { front: {} } }), decomposition: { status: 'running', assetId: 'a2' } }, config), { kind: 'wait', reason: 'detecting' }, '剛換上的圖還在拆解就先等');
  assert.deepEqual(nextAutopilotStep(project('a1', { status: 'done', assetId: 'a1', items: { front: {} } }), config), { kind: 'draw', view: 'frontQuarter' });
  assert.deepEqual(nextAutopilotStep(project('a1', { status: 'done', assetId: 'a1', items: { front: {}, frontQuarter: {}, side: {} } }), config), { kind: 'draw', view: 'back' });
  assert.deepEqual(nextAutopilotStep(project('a1', { status: 'done', assetId: 'a1', items: { front: {}, frontQuarter: {}, side: {}, back: {} } }), config), { kind: 'done' });
});

test('畫圖提示：工作說明照用，換掉回報與回收那段；寫明不提交、不執行指令', () => {
  const prompt = drawPrompt('# AIDOL 精修工作\n\n本次輸出：正面全身\n\n## 回報與回收\n\n- 用 submit-candidate helper 提交', 2);
  assert.match(prompt, /本次輸出：正面全身/);
  assert.doesNotMatch(prompt, /## 回報與回收/);
  assert.match(prompt, /畫 2 張，一次呼叫只畫一張/);
  assert.match(prompt, /不要使用 submit-candidate、任何腳本或 API key/);
});

function fakeAppServer({ images = [] } = {}) {
  const requests = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const reply = (value) => child.stdout.write(`${JSON.stringify(value)}\n`);
  child.stdin = new Writable({ write(buffer, _encoding, callback) {
    const message = JSON.parse(buffer.toString()); requests.push(message);
    if (message.id) {
      let result = {};
      if (message.method === 'thread/start') result = { thread: { id: 'draw-thread' } };
      if (message.method === 'turn/start') {
        result = { turn: { id: 'draw-turn' } };
        const threadId = message.params.threadId;
        for (const image of images) {
          reply({ method: 'item/started', params: { threadId, item: { id: image.id, type: 'imageGeneration', status: 'inProgress' } } });
          reply({ method: 'item/completed', params: { threadId, item: { id: image.id, type: 'imageGeneration', ...image } } });
        }
        reply({ method: 'item/completed', params: { threadId, item: { id: 'msg', type: 'agentMessage', text: '畫好兩張' } } });
        reply({ method: 'turn/completed', params: { threadId, turn: { id: 'draw-turn', status: 'completed' } } });
      }
      reply({ id: message.id, result });
    }
    callback();
  } });
  child.kill = () => { child.stdout.end(); child.emit('exit', 0); };
  return { requests, spawnProcess: () => child };
}

test('畫圖對話：開放生圖的新 thread（read-only、不需核准），參考圖以 localImage 附上，每畫好一張就交出 base64', async () => {
  const fake = fakeAppServer({ images: [{ id: 'ig1', status: 'completed', result: png.toString('base64'), savedPath: '/x/1.png' }, { id: 'ig2', status: 'failed', result: '', failure: { type: 'usageLimitExceeded', limitId: 'codex', resetsAt: 1791820000 } }] });
  const client = new CodexClient({ spawnProcess: fake.spawnProcess });
  const seen = [];
  try {
    const result = await client.freshTurn({ draw: true, prompt: '畫正面', images: ['/refs/front.png'], onImage: (image) => seen.push(image) });
    assert.equal(result.images.length, 2);
    assert.equal(seen[0].result, png.toString('base64'));
    assert.equal(seen[1].failure.type, 'usageLimitExceeded');
    const start = fake.requests.find((message) => message.method === 'thread/start');
    assert.equal(start.params.sandbox, 'read-only'); assert.equal(start.params.approvalPolicy, 'never');
    assert.match(start.params.developerInstructions, /只用內建的圖片生成工具畫圖/);
    assert.deepEqual(fake.requests.find((message) => message.method === 'turn/start').params.input[1], { type: 'localImage', path: '/refs/front.png' });
    const plain = await client.freshTurn({ prompt: '寫人設' });
    assert.equal(plain.images, undefined, '一般對話不收圖');
    assert.match(fake.requests.filter((message) => message.method === 'thread/start')[1].params.developerInstructions, /不產生圖片/);
  } finally { client.close(); }
});

// 假的 Codex：畫圖時照 drawPlan 交圖；審查時照 reviewPlan 打分；拆解裝備回空的。
function fakeCodex({ drawPlan = () => ({}), reviewPlan = () => ({}) } = {}) {
  const calls = { draw: [], review: [], other: [] };
  const client = {
    close() {},
    async freshTurn(options) {
      if (options.draw) {
        calls.draw.push(options);
        const plan = await drawPlan(options, calls.draw.length);
        if (plan.wait) await plan.wait(options.signal);
        if (options.signal?.aborted) throw Object.assign(new Error('已停下。'), { name: 'AbortError' });
        for (let index = 0; index < (plan.count ?? 2); index += 1) {
          if (plan.slow) { await new Promise((resolve) => setTimeout(resolve, 15)); if (options.signal?.aborted) { calls.interrupted = (calls.interrupted || 0) + 1; throw Object.assign(new Error('已停下。'), { name: 'AbortError' }); } }
          options.onImage({ result: plan.bad ? Buffer.from('not an image').toString('base64') : uniquePng().toString('base64') });
        }
        if (plan.failure) options.onImage({ result: '', failure: plan.failure });
        return { threadId: `draw-${calls.draw.length}`, turnId: 't', text: plan.text || '畫好了', images: [] };
      }
      if (options.outputSchema === reviewSchema) {
        calls.review.push(options);
        const ids = [...options.prompt.matchAll(/^\d+\. 候選 (\S+)$/gm)].map((match) => match[1]);
        const plan = await reviewPlan(ids, calls.review.length, options);
        if (plan.invalid) return { threadId: 'bad', turnId: 't', text: '不是 JSON' };
        return { threadId: `review-${calls.review.length}`, turnId: 't', text: JSON.stringify({ summary: plan.summary || '審好了', pick: plan.pick ?? ids[0], redoNote: plan.redoNote || '', candidates: ids.map((candidateId) => ({ candidateId, ...scores(plan.fail ? 2 : 5), issues: plan.fail ? ['手指 6 根'] : [], verdict: plan.fail ? 'fail' : 'pass' })) }) };
      }
      calls.other.push(options);
      return { threadId: 'other', turnId: 't', text: JSON.stringify({ parts: [], views: [], summary: '沒有裝備' }) };
    },
  };
  return { client, calls };
}

async function withServer(t, codex, { access = async () => ({ ok: true, planType: 'plus' }), timing = { pollMs: 20 } } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-autodraw-'));
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-autodraw-work-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client: codex.client, version: async () => 'test', workDir, drawAccess: access, autopilotTiming: timing }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); await fs.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const call = async (method, url, body) => {
    const response = await fetch(`${running.url}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { running, store: running.store, call, dataDir, workDir };
}

test('AIDOL 直接畫：不用回收憑證，畫好的圖直接成為這個工作的候選；不在角色資料夾裡工作；Design QA 存下評分與挑的那張', async (t) => {
  const codex = fakeCodex();
  const { store, call, dataDir } = await withServer(t, codex);
  const project = await store.createProject({ name: '直接畫' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面全身', kind: 'generate', baseRevision: 1, framing: 'frontView', variants: 2 });
  const started = await call('POST', `/api/projects/${project.id}/jobs/${job.id}/draw`);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, 'running');
  const done = await waitFor(async () => { const current = await store.getJob(project.id, job.id); return current.progress?.finishedAt && current; }, { label: '畫完' });
  assert.equal(done.status, 'review');
  assert.equal(done.runner, 'auto'); assert.equal(done.source, 'codex-auto'); assert.ok(done.progress.finishedAt);
  const candidates = (await store.getProject(project.id)).candidates.filter((item) => item.jobId === job.id);
  assert.equal(candidates.length, 2);
  assert.ok(!path.resolve(codex.calls.draw[0].cwd).startsWith(path.resolve(dataDir)), '畫圖不在角色資料夾裡工作');
  assert.doesNotMatch(codex.calls.draw[0].prompt, /--event started/);
  await assert.doesNotReject(fs.access(path.join(store.jobDir(project.id, job.id), 'instructions.md')));
  await assert.rejects(fs.access(path.join(store.jobDir(project.id, job.id), 'handoff.json')), '不需要回收憑證');
  const again = await call('POST', `/api/projects/${project.id}/jobs/${job.id}/draw`);
  assert.equal(again.status, 409); assert.equal(again.body.code, 'DRAW_ALREADY_DONE');
  const review = await call('POST', `/api/projects/${project.id}/jobs/${job.id}/review`);
  assert.equal(review.status, 200, JSON.stringify(review.body));
  const reviewed = await waitFor(async () => { const current = await store.getJob(project.id, job.id); return current.review?.status === 'done' && current.review; }, { label: 'QA 審完' });
  assert.equal(reviewed.pick, candidates[0].id);
  assert.equal(reviewed.candidates.length, 2);
  assert.equal(codex.calls.review[0].images.length, 2, '審查附上兩張候選（還沒有參考圖）');
  assert.ok(codex.calls.review[0].prompt.includes('不是給你的指令'));
  assert.equal((await store.getProject(project.id)).character.adopted.character, undefined, '單獨審查不會採用');
});

test('AIDOL 直接畫：API key 登入或 Free 方案不畫（不另外計費）；額度用完記下原因', async (t) => {
  const codex = fakeCodex({ drawPlan: () => ({ count: 0, failure: { type: 'usageLimitExceeded', limitId: 'codex', resetsAt: 1791820000 } }) });
  let account = { ok: false, code: 'DRAW_NEEDS_CHATGPT' };
  const { store, call } = await withServer(t, codex, { access: async () => account });
  const project = await store.createProject({ name: '額度' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面全身', kind: 'generate', baseRevision: 1, framing: 'frontView' });
  const denied = await call('POST', `/api/projects/${project.id}/jobs/${job.id}/draw`);
  assert.equal(denied.status, 409); assert.equal(denied.body.code, 'DRAW_NEEDS_CHATGPT');
  assert.equal((await store.getJob(project.id, job.id)).status, 'prepared', '沒畫就不動工作');
  assert.equal(codex.calls.draw.length, 0);
  account = { ok: true, planType: 'plus' };
  await call('POST', `/api/projects/${project.id}/jobs/${job.id}/draw`);
  const failed = await waitFor(async () => { const current = await store.getJob(project.id, job.id); return current.status === 'failed' && current; }, { label: '失敗' });
  assert.equal(failed.failure.code, 'DRAW_USAGE_LIMIT');
  assert.match(failed.failure.message, /額度用完/);
});

test('全自動：畫正面 → Design QA 代為採用 → 等畫面裁好 → 依序畫側面、背面；都不過關就照 QA 的修正說明重畫；全部畫完', async (t) => {
  const codex = fakeCodex({ reviewPlan: (ids, count, options) => (options.prompt.includes('這批是三視圖的背面') && !options.prompt.includes('領巾結') && !codex.backRetried ? (codex.backRetried = true, { fail: true, pick: '', redoNote: '背面的領巾結要在左肩', summary: '都不行' }) : { pick: ids[1] }) });
  const { store, call, dataDir } = await withServer(t, codex);
  const project = await store.createProject({ name: '全自動' });
  // 模擬畫面：看到正面等著裁切就裁好送回來（瀏覽器的 canvas 裁切）。
  let screen = true;
  const browser = setInterval(async () => {
    if (!screen) return;
    const current = await store.getProject(project.id).catch(() => null);
    if (current?.views?.status === 'boxes' && current.views.assetId === current.character.adopted.character) await store.saveViews(project.id, { assetId: current.views.assetId, items: frontItems() }).catch(() => {});
  }, 20);
  t.after(() => { screen = false; clearInterval(browser); });
  const started = await call('POST', `/api/projects/${project.id}/autopilot`, { views: ['side', 'back'], variants: 2 });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.autopilot.status, 'running');
  const again = await call('POST', `/api/projects/${project.id}/autopilot`, {});
  assert.equal(again.body.code, 'AUTOPILOT_RUNNING');
  const finished = await waitFor(async () => { const current = await store.getProject(project.id); return ['done', 'failed', 'paused', 'needs-you'].includes(current.autopilot?.status) && current; }, { timeout: 15000, label: '全自動跑完' });
  assert.equal(finished.autopilot.status, 'done', JSON.stringify(finished.autopilot));
  assert.deepEqual(Object.keys(finished.views.items).sort(), ['back', 'front', 'side']);
  const accepted = finished.candidates.filter((item) => item.status === 'accepted');
  assert.equal(accepted.length, 3);
  assert.ok(accepted.every((item) => item.acceptedBy === 'design-qa'), '標出是 Design QA 代為採用');
  assert.ok(accepted.every((item) => finished.candidates.filter((other) => other.jobId === item.jobId)[1].id === item.id), '採用的是 QA 挑的那張');
  const jobs = finished.jobs;
  assert.deepEqual(jobs.map((job) => job.outputView), ['front', 'side', 'back', 'back'], '背面重畫一次');
  assert.ok(jobs.every((job) => job.runner === 'auto'));
  assert.equal(jobs[0].framing, 'frontView');
  assert.match(jobs[3].prompt, /上一輪 Design QA 沒有一張過關，這次要修正：背面的領巾結要在左肩/);
  assert.doesNotMatch(jobs[2].prompt, /領巾結/);
  assert.equal(jobs[2].status, 'cancelled', '沒過關的那批收起來，畫面不再提醒新圖');
  assert.equal(finished.candidates.filter((item) => item.jobId === jobs[2].id).length, 2, '圖留在圖鑑');
  // 畫側面只附正面（裁好的那張），不附整張正式圖。
  const sideDraw = codex.calls.draw[1];
  assert.deepEqual(sideDraw.images, [path.join(store.projectDir(project.id), 'assets', `${finished.views.items.front.assetId}.png`)]);
  assert.ok(codex.calls.draw.every((options) => !path.resolve(options.cwd).startsWith(path.resolve(dataDir))));
  assert.ok(codex.calls.other.length >= 1, '正面採用後自動拆解裝備');
  const codes = finished.autopilot.log.map((entry) => entry.code);
  assert.deepEqual(codes.filter((code) => ['started', 'adopted', 'redraw', 'done'].includes(code)), ['started', 'adopted', 'adopted', 'redraw', 'adopted', 'done']);
});

test('全自動：畫面沒開著就停在「等畫面裁切」，等太久先停下；畫面開了再按繼續就接著畫', async (t) => {
  const codex = fakeCodex();
  const { store, call } = await withServer(t, codex, { timing: { pollMs: 20, limitMs: 200 } });
  const project = await store.createProject({ name: '等畫面' });
  await call('POST', `/api/projects/${project.id}/autopilot`, { views: ['side'], variants: 1 });
  const paused = await waitFor(async () => { const current = await store.getProject(project.id); return current.autopilot.status === 'paused' && current; }, { label: '停下' });
  assert.equal(paused.autopilot.reason, 'AUTOPILOT_NEEDS_SCREEN');
  assert.ok(paused.autopilot.log.some((entry) => entry.code === 'waiting' && entry.reason === 'split'));
  assert.equal(paused.views.status, 'boxes', '正面已經採用，等畫面裁切');
  await store.saveViews(project.id, { assetId: paused.views.assetId, items: frontItems() });
  const resumed = await call('POST', `/api/projects/${project.id}/autopilot`, { views: ['side'], variants: 1 });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  const done = await waitFor(async () => { const current = await store.getProject(project.id); return current.autopilot.status === 'done' && current; }, { label: '跑完' });
  assert.ok(done.views.items.side);
  assert.equal(codex.calls.draw.length, 2, '繼續時不重畫正面');
});

test('全自動：按停下會打斷正在畫的那張；畫面沒開著時停在等裁切；核心重開後顯示中斷', async (t) => {
  let release;
  const codex = fakeCodex({ drawPlan: () => ({ wait: (signal) => new Promise((resolve) => { release = resolve; signal?.addEventListener('abort', resolve, { once: true }); }) }) });
  const { store, call } = await withServer(t, codex);
  const project = await store.createProject({ name: '停下' });
  await call('POST', `/api/projects/${project.id}/autopilot`, { views: ['side'] });
  await waitFor(() => codex.calls.draw.length === 1, { label: '開始畫' });
  const stopped = await call('POST', `/api/projects/${project.id}/autopilot/stop`);
  assert.equal(stopped.status, 200);
  const final = await waitFor(async () => { const current = await store.getProject(project.id); return current.autopilot.status === 'stopped' && current.jobs[0].status === 'failed' && current; }, { label: '停下' });
  assert.equal(final.jobs[0].failure.code, 'DRAW_STOPPED');
  assert.equal(final.candidates.length, 0);
  release?.();
  // 核心重開過：紀錄上還在跑的工作與全自動，畫面看到的是中斷。
  await store.saveAutopilot(project.id, (autopilot) => ({ ...autopilot, status: 'running' }));
  await store.updateJob(project.id, final.jobs[0].id, { status: 'running', progress: { startedAt: new Date().toISOString() }, review: { status: 'running' } });
  const shown = await store.getProject(project.id);
  assert.equal(shown.autopilot.status, 'interrupted');
  assert.equal(shown.jobs[0].status, 'failed'); assert.equal(shown.jobs[0].failure.code, 'DRAW_INTERRUPTED');
  assert.equal(shown.jobs[0].review.errorCode, 'REVIEW_INTERRUPTED');
});

test('回收 helper 直接連本機 AIDOL：設了 HTTP_PROXY（NO_PROXY 只寫 localhost）也不會把憑證和圖送給代理', async (t) => {
  const { execFile } = await import('node:child_process');
  const http = await import('node:http');
  const seen = [];
  const proxy = http.createServer((request, response) => { seen.push(`${request.method} ${request.url}`); response.end('{}'); });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => proxy.close());
  const { store, running } = await withServer(t, fakeCodex());
  const project = await store.createProject({ name: '代理' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面', kind: 'generate', baseRevision: 1 });
  const handoff = await (await fetch(`${running.url}/api/projects/${project.id}/jobs/${job.id}/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  assert.ok(handoff.url);
  const image = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-proxy-img-')), '候選.png');
  await fs.writeFile(image, png);
  const helper = path.resolve('.agents/skills/aidol/scripts/submit-candidate.mjs');
  const jobFile = path.join(store.jobDir(project.id, job.id), 'handoff.json');
  const env = { ...process.env, HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`, http_proxy: `http://127.0.0.1:${proxy.address().port}`, NO_PROXY: 'localhost', no_proxy: 'localhost', NODE_USE_ENV_PROXY: '1' };
  const run = (args) => new Promise((resolve, reject) => execFile(process.execPath, [helper, '--job', jobFile, ...args], { env }, (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve(stdout))));
  await run(['--event', 'started']);
  const out = JSON.parse(await run(['--image', image, '--name', '外套候選']));
  assert.equal(out.candidates.length, 1);
  assert.equal((await store.getProject(project.id)).candidates[0].jobId, job.id);
  assert.deepEqual(seen, [], '代理沒有收到任何請求');
});


test('Design QA 審圖時使用者自己先採用了：QA 不蓋掉使用者的選擇', async (t) => {
  let call;
  const codex = fakeCodex({ reviewPlan: async (ids) => { await call('POST', `/api/projects/${project.id}/candidates/${ids[0]}/accept`, { baseRevision: (await store.getProject(project.id)).character.revision }); return { pick: ids[1] }; } });
  const server = await withServer(t, codex);
  const { store } = server; call = server.call;
  const project = await store.createProject({ name: '自己挑' });
  const browser = setInterval(async () => {
    const current = await store.getProject(project.id).catch(() => null);
    if (current?.views?.status === 'boxes' && current.views.assetId === current.character.adopted.character) await store.saveViews(project.id, { assetId: current.views.assetId, items: frontItems() }).catch(() => {});
  }, 20);
  t.after(() => clearInterval(browser));
  await call('POST', `/api/projects/${project.id}/autopilot`, { views: [], variants: 2 });
  const done = await waitFor(async () => { const current = await store.getProject(project.id); return ['done', 'failed', 'paused', 'needs-you'].includes(current.autopilot.status) && current; }, { label: '跑完' });
  assert.equal(done.autopilot.status, 'done', JSON.stringify(done.autopilot));
  const [first, second] = done.candidates.filter((item) => item.jobId === done.jobs[0].id);
  assert.equal(done.character.adopted.character, first.assetId, '正式立繪是使用者挑的那張');
  assert.equal(first.acceptedBy, undefined);
  assert.equal(second.status, 'pending', 'QA 挑的那張沒有被採用');
  assert.ok(done.autopilot.log.some((entry) => entry.code === 'userPicked'));
});

test('全自動：開始畫之前就按了停下不會畫；翻牌畫面按這一批的停下，全自動也一起停下', async (t) => {
  let accessCalls = 0;
  const codex = fakeCodex({ drawPlan: () => ({ wait: (signal) => new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true })) }) });
  const { store, call } = await withServer(t, codex, { access: async () => { accessCalls += 1; if (accessCalls === 2) await new Promise((resolve) => setTimeout(resolve, 200)); return { ok: true }; } });
  const one = await store.createProject({ name: '還沒開始' });
  await call('POST', `/api/projects/${one.id}/autopilot`, { views: [] });
  await waitFor(async () => (await store.getProject(one.id)).autopilot.log.some((entry) => entry.code === 'drawing'), { label: '準備畫' });
  await call('POST', `/api/projects/${one.id}/autopilot/stop`);
  const stopped = await waitFor(async () => { const current = await store.getProject(one.id); return current.autopilot.status === 'stopped' && current; }, { label: '停下' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(codex.calls.draw.length, 0, '停下之後不開始畫');
  assert.equal(stopped.jobs[0].status, 'cancelled', '剛建立的工作收起來，不會留下「到 Codex 按送出」');
  const two = await store.createProject({ name: '翻牌停下' });
  await call('POST', `/api/projects/${two.id}/autopilot`, { views: [] });
  await waitFor(() => codex.calls.draw.length === 1, { label: '開始畫' });
  const jobId = (await store.getProject(two.id)).autopilot.step.jobId;
  await call('POST', `/api/projects/${two.id}/jobs/${jobId}/draw/stop`);
  const final = await waitFor(async () => { const current = await store.getProject(two.id); return current.autopilot.status === 'stopped' && current; }, { label: '全自動停下' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(codex.calls.draw.length, 1, '不會自己再畫一次');
  assert.equal(final.jobs[0].failure.code, 'DRAW_STOPPED');
});

test('全自動：Design QA 沒審完就同一批再審一次，還是不行就停下（不重畫）；按繼續會先審那一批', async (t) => {
  let broken = true;
  const codex = fakeCodex({ reviewPlan: (ids) => (broken ? { invalid: true } : { pick: ids[0] }) });
  const { store, call } = await withServer(t, codex);
  const project = await store.createProject({ name: 'QA 壞了' });
  await call('POST', `/api/projects/${project.id}/autopilot`, { views: [], variants: 2 });
  const paused = await waitFor(async () => { const current = await store.getProject(project.id); return current.autopilot.status === 'paused' && current; }, { label: '停下' });
  assert.equal(paused.autopilot.reason, 'AUTOPILOT_REVIEW_FAILED');
  assert.equal(codex.calls.draw.length, 1); assert.equal(codex.calls.review.length, 2);
  broken = false;
  await call('POST', `/api/projects/${project.id}/autopilot`, { views: [], variants: 2 });
  const adopted = await waitFor(async () => { const current = await store.getProject(project.id); return current.character.adopted.character && current; }, { label: '採用' });
  assert.equal(codex.calls.draw.length, 1, '繼續時審原本那一批，不重畫');
  assert.equal(adopted.candidates.find((item) => item.status === 'accepted').acceptedBy, 'design-qa');
});

test('同時送兩次：開始畫、開始全自動都只會跑一份', async (t) => {
  const codex = fakeCodex({ drawPlan: () => ({ slow: true }) });
  const { store, call } = await withServer(t, codex, { access: async () => { await new Promise((resolve) => setTimeout(resolve, 30)); return { ok: true }; } });
  const project = await store.createProject({ name: '兩次' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面', kind: 'generate', baseRevision: 1, framing: 'frontView', variants: 2 });
  const results = await Promise.all([call('POST', `/api/projects/${project.id}/jobs/${job.id}/draw`), call('POST', `/api/projects/${project.id}/jobs/${job.id}/draw`)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  await waitFor(async () => (await store.getJob(project.id, job.id)).progress?.finishedAt, { label: '畫完' });
  assert.equal(codex.calls.draw.length, 1);
  assert.equal((await store.getProject(project.id)).candidates.length, 2);
  const other = await store.createProject({ name: '兩次全自動' });
  const starts = await Promise.all([call('POST', `/api/projects/${other.id}/autopilot`, { views: [] }), call('POST', `/api/projects/${other.id}/autopilot`, { views: [] })]);
  assert.deepEqual(starts.map((result) => result.status).sort(), [200, 409]);
  await call('POST', `/api/projects/${other.id}/autopilot/stop`);
  await waitFor(async () => (await store.getProject(other.id)).autopilot.status === 'stopped', { label: '停下' });
});

test('畫夠張數就打斷這一輪；不是圖片的結果不算張數', async (t) => {
  const codex = fakeCodex({ drawPlan: (_options, count) => (count === 1 ? { count: 5, slow: true } : { count: 2, bad: true }) });
  const { store, call } = await withServer(t, codex);
  const project = await store.createProject({ name: '張數' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面', kind: 'generate', baseRevision: 1, framing: 'frontView', variants: 2 });
  await call('POST', `/api/projects/${project.id}/jobs/${job.id}/draw`);
  const done = await waitFor(async () => { const current = await store.getJob(project.id, job.id); return current.progress?.finishedAt && current; }, { label: '畫完' });
  assert.equal(done.status, 'review'); assert.equal(done.failure, undefined);
  assert.equal((await store.getProject(project.id)).candidates.length, 2);
  assert.equal(codex.calls.interrupted, 1, '第三張之前就打斷');
  const bad = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面', kind: 'generate', baseRevision: 1, framing: 'frontView', variants: 2 });
  await call('POST', `/api/projects/${project.id}/jobs/${bad.id}/draw`);
  const failed = await waitFor(async () => { const current = await store.getJob(project.id, bad.id); return current.status === 'failed' && current; }, { label: '失敗' });
  assert.equal(failed.failure.code, 'DRAW_NO_IMAGE');
});

test('直接畫失敗後改交給 Codex App：之後 Skill 回報開始，畫面顯示繪製中而不是中斷；畫到一半核心重開，畫面不會停在繪製中', async (t) => {
  const codex = fakeCodex({ drawPlan: () => ({ count: 0 }) });
  const { store, call } = await withServer(t, codex);
  const project = await store.createProject({ name: '改交給 App' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面', kind: 'generate', baseRevision: 1, variants: 2 });
  await call('POST', `/api/projects/${project.id}/jobs/${job.id}/draw`);
  await waitFor(async () => (await store.getJob(project.id, job.id)).status === 'failed', { label: '失敗' });
  const handoff = await call('POST', `/api/projects/${project.id}/jobs/${job.id}/handoff`, {});
  assert.equal(handoff.status, 200);
  assert.equal(handoff.body.job.runner, 'codex-app');
  await store.recordProgress(project.id, job.id, { event: 'started' });
  assert.equal((await store.getJob(project.id, job.id)).status, 'running', '不會被當成核心重開而中斷');
  // 畫到一半：已經回來一張（review）但還沒結束，核心重開。
  const half = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面', kind: 'generate', baseRevision: 1, variants: 2 });
  await store.updateJob(project.id, half.id, { runner: 'auto' });
  await store.recordProgress(project.id, half.id, { event: 'started' });
  await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: half.id });
  const shown = await store.getJob(project.id, half.id);
  assert.equal(shown.status, 'review');
  assert.ok(shown.progress.finishedAt, '補上結束時間');
  assert.equal(shown.failure.code, 'DRAW_INTERRUPTED');
});


test('全自動繼續時：設定改過就不審舊的那一批（收起來重畫）；使用者審圖時換上自己的正式圖，之後不會畫新的蓋掉它', async (t) => {
  let broken = true;
  const codex = fakeCodex({ reviewPlan: (ids) => (broken ? { invalid: true } : { pick: ids[0] }) });
  const { store, call } = await withServer(t, codex);
  const project = await store.createProject({ name: '舊批' });
  await call('POST', `/api/projects/${project.id}/autopilot`, { views: [], variants: 1 });
  await waitFor(async () => (await store.getProject(project.id)).autopilot.status === 'paused', { label: '停下' });
  const before = await store.getProject(project.id);
  const character = structuredClone(before.character); character.persona.traits = [...(character.persona.traits || []), '改過'];
  assert.equal((await call('PUT', `/api/projects/${project.id}/character`, { baseRevision: before.character.revision, character })).status, 200);
  broken = false;
  await call('POST', `/api/projects/${project.id}/autopilot`, { views: [], variants: 1 });
  const after = await waitFor(async () => { const current = await store.getProject(project.id); return current.character.adopted.character && current; }, { label: '採用' });
  assert.equal(after.jobs[0].status, 'cancelled'); assert.equal(after.jobs[0].closedBy, 'autopilot-stale');
  assert.equal(codex.calls.draw.length, 2, '舊批不審，重畫一批');
  assert.equal(after.candidates.find((item) => item.status === 'accepted').jobId, after.jobs[1].id);

  let server;
  const codex2 = fakeCodex({ reviewPlan: async (ids) => {
    const current = await server.store.getProject(other.id);
    const form = new FormData(); form.append('file', new Blob([uniquePng()], { type: 'image/png' }), 'mine.png'); form.append('baseRevision', String(current.character.revision));
    const response = await fetch(`${server.running.url}/api/projects/${other.id}/import-main`, { method: 'POST', body: form });
    assert.equal(response.status, 200, await response.clone().text());
    return { pick: ids[0] };
  } });
  server = await withServer(t, codex2);
  const other = await server.store.createProject({ name: '自己的圖' });
  await server.call('POST', `/api/projects/${other.id}/autopilot`, { views: ['side'], variants: 1 });
  const paused = await waitFor(async () => { const current = await server.store.getProject(other.id); return ['needs-you', 'done', 'failed', 'paused'].includes(current.autopilot.status) && current; }, { label: '停下' });
  assert.equal(paused.autopilot.status, 'needs-you'); assert.equal(paused.autopilot.reason, 'AUTOPILOT_FRONT_NEEDS_SPLIT');
  assert.equal(codex2.calls.draw.length, 1, '不畫新的正面蓋掉使用者的圖');
  assert.equal(paused.candidates.filter((item) => item.status === 'accepted' && item.acceptedBy === 'design-qa').length, 0);
});


test('核心關掉時：等背景工作停下才結束，不寫「已停下」；重開後畫面看到的是中斷了', async (t) => {
  const codex = fakeCodex({ drawPlan: () => ({ wait: (signal) => new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true })) }) });
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-close-'));
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-close-work-'));
  t.after(async () => { await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); await fs.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client: codex.client, version: async () => 'test', workDir, drawAccess: async () => ({ ok: true }) }) });
  const project = await running.store.createProject({ name: '關掉' });
  await fetch(`${running.url}/api/projects/${project.id}/autopilot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ views: [] }) });
  await waitFor(() => codex.calls.draw.length === 1, { label: '開始畫' });
  await running.close();
  const raw = JSON.parse(await fs.readFile(path.join(dataDir, 'projects', project.id, 'project.json'), 'utf8'));
  assert.equal(raw.autopilot.status, 'running', '沒有寫成已停下');
  assert.ok(!raw.jobs[0].progress.finishedAt, '畫圖紀錄沒有被寫成結束');
  const reopened = await new ProjectStore({ dataDir, demo: false }).init();
  const shown = await reopened.getProject(project.id);
  assert.equal(shown.autopilot.status, 'interrupted');
  assert.equal(shown.jobs[0].failure.code, 'DRAW_INTERRUPTED');
});

test('全自動的衣櫃（2026-10-14）：勾了才畫；表情之後畫還沒有立繪的另一套；只畫衣櫃時不重畫正面、不等裁切', async () => {
  const { outfitsToDraw } = await import('../shared/wardrobe.mjs');
  const config = autopilotConfig({ views: [], outfits: true });
  assert.equal(config.outfits, true);
  assert.equal(autopilotConfig({}).outfits, false);
  const assets = [{ id: 'main', outfitId: 'casual' }, { id: 'sleep-1', outfitId: 'sleep' }];
  const project = (extra = {}) => ({ character: { adopted: { character: 'main' }, outfits: { casual: { id: 'casual' }, sleep: { id: 'sleep' }, school: { id: 'school' } } }, assets, views: { status: 'boxes', assetId: 'main' }, wardrobe: { items: {} }, ...extra });
  assert.deepEqual(outfitsToDraw(project()), ['sleep', 'school'], '主要那套不畫');
  assert.deepEqual(nextAutopilotStep(project(), config), { kind: 'draw', view: 'outfit', outfitId: 'sleep' }, '正式立繪還沒裁好也不用等（衣櫃照整張正式立繪畫）');
  assert.deepEqual(nextAutopilotStep(project({ wardrobe: { items: { sleep: { assetId: 'sleep-1' } } } }), config), { kind: 'draw', view: 'outfit', outfitId: 'school' });
  assert.deepEqual(nextAutopilotStep(project({ wardrobe: { items: { sleep: { assetId: 'sleep-1' }, school: { assetId: 'sleep-1' } } } }), config), { kind: 'done' });
  assert.deepEqual(nextAutopilotStep(project(), autopilotConfig({ views: [], expressions: false })), { kind: 'wait', reason: 'split' }, '沒勾衣櫃、也沒勾表情：照原本的流程（等正面裁好）');
  // 角度都畫完、表情也畫完之後才輪到衣櫃。
  const full = project({ views: { status: 'done', assetId: 'main', items: { front: {}, side: {}, back: {} } } });
  assert.deepEqual(nextAutopilotStep(full, autopilotConfig({ views: ['side', 'back'], outfits: true })), { kind: 'draw', view: 'outfit', outfitId: 'sleep' });
  // 還沒有正式立繪：先畫正面（主要那套）。
  assert.deepEqual(nextAutopilotStep({ ...project(), character: { ...project().character, adopted: {} } }, config), { kind: 'draw', view: 'front' });
});

test('全自動只畫衣櫃：照正式立繪一套一套畫，Design QA 挑的放進那套的衣櫃；正式立繪不換', async (t) => {
  const codex = fakeCodex({ reviewPlan: (ids) => ({ pick: ids[1] }) });
  const { store, call } = await withServer(t, codex);
  let project = await store.createProject({ name: '衣櫃' });
  const first = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面', kind: 'generate', baseRevision: 1 });
  const image = await store.addAsset(project.id, { buffer: uniquePng(), mimeType: 'image/png', targetId: 'character', jobId: first.id });
  project = await store.acceptCandidate(project.id, image.candidate.id, { baseRevision: 1 });
  const main = project.character.adopted.character;
  const character = structuredClone(project.character);
  character.outfits.sleep = { id: 'sleep', name: '睡衣', equipped: [] };
  character.outfits.school = { id: 'school', name: '制服', equipped: [] };
  project = await store.updateCharacter(project.id, { baseRevision: project.character.revision, character });
  const started = await call('POST', `/api/projects/${project.id}/autopilot`, { views: [], variants: 2, outfits: true });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.autopilot.facesOnly, true, '只畫衣櫃：不重畫正面');
  const finished = await waitFor(async () => { const current = await store.getProject(project.id); return ['done', 'failed', 'paused', 'needs-you'].includes(current.autopilot?.status) && current; }, { timeout: 15000, label: '衣櫃畫完' });
  assert.equal(finished.autopilot.status, 'done', JSON.stringify(finished.autopilot));
  assert.equal(finished.character.adopted.character, main, '正式立繪不換');
  assert.deepEqual(Object.keys(finished.wardrobe.items).sort(), ['school', 'sleep']);
  const jobs = finished.jobs.filter((job) => job.autopilotId);
  assert.deepEqual(jobs.map((job) => job.outfitId), ['sleep', 'school']);
  assert.ok(jobs.every((job) => job.outfitVariant && job.outputView === 'front' && job.framing === 'frontView'));
  assert.match(jobs[0].prompt, /穿搭「睡衣」/);
  for (const job of jobs) assert.equal(finished.wardrobe.items[job.outfitId].assetId, finished.candidates.filter((item) => item.jobId === job.id)[1].assetId, '放進衣櫃的是 QA 挑的那張');
  assert.ok(codex.calls.review.every((options) => /這批是穿搭「(睡衣|制服)」的立繪/.test(options.prompt)), 'Design QA 照衣裝差分的規則審');
  const adopted = finished.autopilot.log.filter((entry) => entry.code === 'adopted');
  assert.deepEqual(adopted.map((entry) => entry.outfitId), ['sleep', 'school']);
});

test('全自動衣櫃：採用前剛好有人存了設定（捏角色會自動存檔）就照新的版本再採用一次，不重畫；建立工作時撞到也重新來過', async (t) => {
  const codex = fakeCodex({ reviewPlan: (ids) => ({ pick: ids[0] }) });
  const { store, call } = await withServer(t, codex);
  let project = await store.createProject({ name: '衣櫃撞版本' });
  const first = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面', kind: 'generate', baseRevision: 1 });
  const image = await store.addAsset(project.id, { buffer: uniquePng(), mimeType: 'image/png', targetId: 'character', jobId: first.id });
  project = await store.acceptCandidate(project.id, image.candidate.id, { baseRevision: 1 });
  const character = structuredClone(project.character);
  character.outfits.sleep = { id: 'sleep', name: '睡衣', equipped: [] };
  project = await store.updateCharacter(project.id, { baseRevision: project.character.revision, character });
  // 每次 Design QA 要採用前、第一次建立工作前，都剛好有人存了一次設定。
  const bump = async (id) => { const current = await store.getProject(id); const next = structuredClone(current.character); next.persona.description = `${next.persona.description || ''}。`; await store.updateCharacter(id, { baseRevision: current.character.revision, character: next }); };
  const accept = store.acceptCandidate.bind(store);
  let acceptBumps = 0;
  store.acceptCandidate = async (id, candidateId, options) => { if (options?.by === 'design-qa' && acceptBumps < 1) { acceptBumps += 1; await bump(id); } return accept(id, candidateId, options); };
  const create = store.createJob.bind(store);
  let createBumps = 0;
  store.createJob = async (id, input) => { if (createBumps < 1) { createBumps += 1; await bump(id); } return create(id, input); };
  const started = await call('POST', `/api/projects/${project.id}/autopilot`, { views: [], variants: 2, outfits: true });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const finished = await waitFor(async () => { const current = await store.getProject(project.id); return ['done', 'failed', 'paused', 'needs-you'].includes(current.autopilot?.status) && current; }, { timeout: 15000, label: '衣櫃畫完' });
  assert.equal(finished.autopilot.status, 'done', JSON.stringify(finished.autopilot));
  assert.ok(finished.wardrobe.items.sleep?.assetId, '放進衣櫃了');
  assert.equal(codex.calls.draw.length, 1, '沒有因為撞到版本而重畫');
  assert.equal(acceptBumps, 1);
  assert.equal(createBumps, 1);
});
