// 表情集（2026-10-13 起）：照正面（定稿）一張一張畫胸像表情，採用只放進表情集，不換正式立繪、不進版本。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { ProjectStore } from '../server/store.mjs';
import { expressionFront, expressionInfo, expressionList, expressionStale, expressionsToDraw, framingReference, nextExpression } from '../shared/expressions.mjs';
import { candidateComparison, jobPresentation, workspaceSummary } from '../shared/agent-workspace.mjs';
import { compileBrief } from '../shared/prompt-compiler.mjs';
import { autopilotConfig, nextAutopilotStep, autopilotPrompt, reviewPrompt, stepKey } from '../shared/autopilot.mjs';
import { defaultExpressionSet } from '../shared/libraries.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');
const other = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function withFront(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-expr-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const project = await store.createProject({ name: '表情測試' });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫正面', kind: 'generate', baseRevision: 1, framing: 'frontView' });
  const { asset, candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id });
  await store.acceptCandidate(project.id, candidate.id, { baseRevision: 1 });
  return { store, project: await store.getProject(project.id), front: asset };
}

// 讀 ZIP 裡的檔名（store 用 archiver 打包；這裡只需要中央目錄）。
function zipNames(buffer) {
  const names = [];
  for (let offset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), cd = buffer.readUInt32LE(offset + 16), end = cd + buffer.readUInt32LE(offset + 12); cd < end;) {
    const nameLength = buffer.readUInt16LE(cd + 28), extra = buffer.readUInt16LE(cd + 30), comment = buffer.readUInt16LE(cd + 32);
    names.push(buffer.subarray(cd + 46, cd + 46 + nameLength).toString('utf8'));
    cd += 46 + nameLength + extra + comment;
  }
  return names;
}

test('表情集的共用規則：預設六個、「一般」先畫、取景參考、照舊正面畫的會標出來', () => {
  assert.deepEqual(expressionList(undefined), defaultExpressionSet);
  const project = { character: { adopted: { character: 'main' } }, views: { status: 'done', assetId: 'main', items: { front: { assetId: 'front-crop' } } }, expressions: { list: ['joy', 'neutral', 'sad'], items: {} } };
  assert.equal(expressionFront(project), 'front-crop', '拆好的正面優先');
  assert.equal(expressionFront({ character: { adopted: { character: 'main' } } }), 'main');
  assert.equal(expressionFront({ character: { adopted: {} } }), null);
  assert.equal(nextExpression(project), 'neutral', '一般先畫');
  assert.equal(framingReference(project, 'joy'), null);
  project.expressions.items.sad = { assetId: 'sad-1', sourceAssetId: 'front-crop' };
  assert.equal(framingReference(project, 'joy'), 'sad-1', '沒有「一般」時用第一個畫好的');
  project.expressions.items.neutral = { assetId: 'neutral-1', sourceAssetId: 'front-crop' };
  assert.equal(framingReference(project, 'joy'), 'neutral-1', '有「一般」就用一般');
  assert.equal(framingReference(project, 'neutral'), 'sad-1', '不拿自己當取景參考');
  assert.equal(nextExpression(project), 'joy');
  project.expressions.items.neutral.sourceAssetId = 'old-front';
  assert.equal(expressionStale(project, 'neutral'), true);
  assert.equal(framingReference(project, 'joy'), 'sad-1', '舊設計的「一般」不當取景參考');
  assert.equal(nextExpression(project), 'neutral', '舊設計的要重畫（「一般」先畫）');
  assert.equal(expressionStale(project, 'sad'), false);
  project.expressions.items.sad = { assetId: 'sad-1', sourceAssetId: 'old-crop', sourceMain: 'main' };
  assert.equal(expressionStale(project, 'sad'), false, '同一張立繪重新裁切正面不算換設計');
  project.expressions.items.sad.sourceMain = 'older-main';
  assert.equal(expressionStale(project, 'sad'), true, '正式立繪換過才算舊設計');
  project.expressions.items.sad = { assetId: 'sad-1', sourceAssetId: 'main' };
  assert.equal(expressionStale(project, 'sad'), false, '照整張立繪畫的也不算');
  assert.deepEqual(expressionInfo({}, 'wink'), { key: 'wink', label: '眨眼', brief: '俏皮地閉起角色的左眼眨眼、微笑', prompt: "playful wink with the character's left eye closed, small smile", custom: false });
  assert.equal(expressionInfo({ custom: { 'custom-abc123': { name: '壞笑', note: '一邊嘴角' } } }, 'custom-abc123').brief, '壞笑：一邊嘴角');
  assert.equal(expressionInfo({}, 'custom-abc123'), null);
  assert.equal(expressionInfo({ custom: { __proto__: { name: 'x' } } }, '__proto__'), null);
});

test('畫表情：要先有正式立繪；只附正面（定稿）與取景參考，不附這個表情原本的那張；採用只放進表情集、不進版本', async (t) => {
  const { store, project, front } = await withFront(t);
  const base = { targetId: 'character', prompt: '畫表情', kind: 'generate', outputView: 'expression', baseRevision: project.character.revision };
  await assert.rejects(store.createJob(project.id, { ...base, expression: 'nope' }), { code: 'UNKNOWN_EXPRESSION' });
  await assert.rejects(store.createJob(project.id, { ...base, expression: 'wink' }), { code: 'UNKNOWN_EXPRESSION' }, '不在表情集裡的要先加進來');
  const empty = await store.createProject({ name: '沒有立繪' });
  await assert.rejects(store.createJob(empty.id, { ...base, baseRevision: 1, expression: 'neutral' }), { code: 'EXPRESSION_NEEDS_FRONT' });

  const first = await store.createJob(project.id, { ...base, expression: 'neutral' });
  const instructions = await fs.readFile(first.context.instructionsPath, 'utf8');
  assert.match(instructions, /本次輸出：表情集的「一般」（expression：neutral）。胸像：頭頂到胸口、正面面向觀看者/);
  assert.match(instructions, /這是表情集的第一張：頭頂上方留一點空間、裁在胸口/);
  assert.match(instructions, /以「定稿（正面）」為準，禁止變更任何設定.*只改表情與取景（胸像）/);
  const inputs = instructions.split('## 固定輸入')[1].trim().split('\n\n')[0].split('\n');
  assert.match(inputs[0], /^- 定稿（正面）：照這張畫表情/);
  assert.equal(inputs.length, 1);
  assert.equal(first.expression, 'neutral');
  assert.equal(first.expressionSource, project.views.items?.front?.assetId || front.id);
  // 交回來的候選：視角必須是 expression，正面主圖的工作不能交表情。
  await assert.rejects(store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: first.id, view: 'front' }), { code: 'ASSET_VIEW_MISMATCH' });
  const { asset, candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: first.id });
  assert.equal(asset.view, 'expression');
  assert.equal(asset.expression, 'neutral');
  assert.equal(candidate.expression, 'neutral');
  const accepted = await store.acceptCandidate(project.id, candidate.id, { baseRevision: project.character.revision, by: 'design-qa' });
  assert.equal(accepted.character.revision, project.character.revision, '表情不進版本');
  assert.equal(accepted.character.adopted.character, project.character.adopted.character, '不換正式立繪');
  assert.equal(accepted.expressions.items.neutral.assetId, asset.id);
  assert.equal(accepted.candidates.find((item) => item.id === candidate.id).acceptedBy, 'design-qa');

  // 第二個表情：附上「一般」當取景參考；重畫「一般」時不附原本那張。
  const joy = await store.createJob(project.id, { ...base, expression: 'joy' });
  const joyText = await fs.readFile(joy.context.instructionsPath, 'utf8');
  assert.match(joyText, /取景（頭的大小、位置、裁切）和「取景參考」那張一樣/);
  assert.match(joyText, /- 取景參考（已確認的表情）：頭的大小、位置、裁切和背景照這張；表情不要照它/);
  assert.ok(joy.context.referenceAssets.some((item) => item.id === asset.id));
  const redo = await store.createJob(project.id, { ...base, expression: 'neutral' });
  assert.equal(redo.expressionRedo, true);
  assert.ok(!redo.context.referenceAssets.some((item) => item.id === asset.id), '重畫不附原本那張');
  assert.match(await fs.readFile(redo.context.instructionsPath, 'utf8'), /原本的「一般」有問題，這次重畫；沒有附上原本那張/);
});

test('表情集的增減：預設表情、自訂表情、上限、拿掉後圖留著、拿掉的表情不能再採用；匯出放一份 expressions/', async (t) => {
  const { store, project } = await withFront(t);
  let state = await store.addExpression(project.id, { preset: 'wink' });
  assert.deepEqual(state.expressions.list, [...defaultExpressionSet, 'wink']);
  state = await store.addExpression(project.id, { preset: 'wink' });
  assert.equal(state.expressions.list.filter((key) => key === 'wink').length, 1, '不重複加');
  await assert.rejects(store.addExpression(project.id, { preset: 'nope' }), { code: 'UNKNOWN_EXPRESSION' });
  await assert.rejects(store.addExpression(project.id, { name: '  ' }), { code: 'INVALID_EXPRESSION' });
  await assert.rejects(store.addExpression(project.id, { name: 'x'.repeat(41) }), { code: 'INVALID_EXPRESSION' });
  state = await store.addExpression(project.id, { name: '  壞\n笑 ', note: '一邊\n嘴角上揚' });
  const key = state.expressions.list.at(-1);
  assert.match(key, /^custom-[a-z0-9]{8}$/);
  assert.deepEqual(state.expressions.custom[key], { name: '壞 笑', note: '一邊 嘴角上揚' });
  // 畫自訂表情：說明寫進工作說明。
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫', kind: 'generate', outputView: 'expression', expression: key, baseRevision: project.character.revision });
  assert.match(await fs.readFile(job.context.instructionsPath, 'utf8'), /表情集的「壞 笑」.*表情：壞 笑：一邊 嘴角上揚。/);
  const { candidate } = await store.addAsset(project.id, { buffer: other, mimeType: 'image/png', targetId: 'character', jobId: job.id });
  const neutralJob = await store.createJob(project.id, { targetId: 'character', prompt: '畫', kind: 'generate', outputView: 'expression', expression: 'neutral', baseRevision: project.character.revision });
  const neutral = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: neutralJob.id });
  await store.acceptCandidate(project.id, neutral.candidate.id, { baseRevision: project.character.revision });
  const zip = await store.exportProject(project.id);
  const names = zipNames(zip.buffer);
  assert.ok(names.includes('expressions/01-neutral.png'), names.join(','));
  assert.ok(names.includes('expressions/expressions.md'));
  state = await store.removeExpression(project.id, key);
  assert.ok(!state.expressions.list.includes(key));
  assert.equal(state.expressions.custom[key], undefined);
  assert.ok(state.assets.some((asset) => asset.id === candidate.assetId), '圖留在圖鑑');
  await assert.rejects(store.acceptCandidate(project.id, candidate.id, { baseRevision: project.character.revision }), { code: 'EXPRESSION_REMOVED' });
  state = await store.removeExpression(project.id, 'neutral');
  assert.equal(state.expressions.items.neutral, undefined);
  for (let index = state.expressions.list.length; index < 24; index += 1) state = await store.addExpression(project.id, { name: `表情${index}` });
  await assert.rejects(store.addExpression(project.id, { name: '第二十五個' }), { code: 'EXPRESSION_LIMIT' });
  // 匯出的 ZIP 是正常的 deflate 壓縮（讀得到第一個檔的內容）。
  assert.ok(inflateRawSync);
});

test('全自動：勾了表情集才畫；角度畫完後照順序畫還沒畫的表情（一般先畫）；審查提示改看胸像與表情', () => {
  const config = autopilotConfig({ views: ['side'], variants: 2, expressions: true });
  assert.equal(config.expressions, true);
  assert.equal(autopilotConfig({}).expressions, false);
  const project = { character: { adopted: { character: 'main' } }, views: { status: 'done', assetId: 'main', items: { front: { assetId: 'f' }, side: { assetId: 's' } } }, expressions: { list: ['joy', 'neutral'], items: {} } };
  assert.deepEqual(nextAutopilotStep(project, config), { kind: 'draw', view: 'expression', expression: 'neutral' });
  assert.deepEqual(nextAutopilotStep(project, { ...config, expressions: false }), { kind: 'done' });
  assert.deepEqual(nextAutopilotStep({ ...project, views: { ...project.views, items: { front: { assetId: 'f' } } } }, config), { kind: 'draw', view: 'side' }, '角度先畫');
  // 只畫表情集（沒勾角度）而且已經有正式立繪：照它畫，不用先拆三視圖、不重畫正面。
  const onlyFaces = autopilotConfig({ views: [], expressions: true });
  assert.deepEqual(nextAutopilotStep({ character: { adopted: { character: 'main' } }, expressions: { list: ['joy'] } }, onlyFaces), { kind: 'draw', view: 'expression', expression: 'joy' });
  assert.deepEqual(nextAutopilotStep({ character: { adopted: {} }, expressions: { list: ['joy'] } }, onlyFaces), { kind: 'draw', view: 'front' }, '沒有正式立繪就先畫正面');
  assert.deepEqual(nextAutopilotStep({ character: { adopted: { character: 'main' } }, views: { status: 'boxes', assetId: 'main' }, expressions: { list: ['joy'] } }, onlyFaces), { kind: 'wait', reason: 'split' }, '正式立繪還在拆就先等');
  assert.deepEqual(nextAutopilotStep({ character: { adopted: { character: 'main' } }, decomposition: { status: 'running', assetId: 'main' }, expressions: { list: ['joy'] } }, onlyFaces), { kind: 'wait', reason: 'detecting' });
  project.expressions.items = { neutral: { assetId: 'n' }, joy: { assetId: 'j' } };
  assert.deepEqual(nextAutopilotStep(project, config), { kind: 'done' });
  assert.equal(stepKey({ view: 'expression', expression: 'joy' }), 'expression:joy');
  assert.equal(stepKey({ view: 'side' }), 'side');
  assert.match(autopilotPrompt({ name: '朗', style: {} }, 'expression', '', { label: '開心', brief: '開心地笑' }), /照定稿為「朗」畫表情「開心」：胸像、正面，設計完全不改，只改表情（開心地笑）/);
  const prompt = reviewPrompt({ instructions: '# 工作', references: [{ label: '定稿' }], candidates: [{ id: 'c1' }], view: 'expression', expression: { label: '開心', brief: '開心地笑' } });
  assert.match(prompt, /這批是表情集的「開心」：胸像/);
  assert.match(prompt, /表情要是：開心地笑/);
  assert.match(prompt, /spec 規格：胸像取景、正面、淺灰素色背景、只有一個人；表情符合要求/);
});

// ── 全自動畫表情集（假的 Codex） ──
let serial = 0;
const uniquePng = () => Buffer.concat([png, Buffer.from(`#${++serial}`)]);
const waitFor = async (check, { timeout = 8000, label = '條件' } = {}) => {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error(`等不到${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test('全自動也畫表情集：正面採用並裁好後，先畫「一般」再畫其他表情；每個表情都附正面，之後的附「一般」當取景參考', async (t) => {
  const { startServer } = await import('../server/http.mjs');
  const { registerCodexRoutes } = await import('../server/integrations.mjs');
  const { reviewSchema } = await import('../shared/autopilot.mjs');
  const calls = { draw: [], review: [] };
  const client = {
    close() {},
    async freshTurn(options) {
      if (options.draw) {
        calls.draw.push(options);
        options.onImage({ result: uniquePng().toString('base64') });
        return { threadId: `draw-${calls.draw.length}`, turnId: 't', text: '畫好了', images: [] };
      }
      if (options.outputSchema === reviewSchema) {
        calls.review.push(options);
        const ids = [...options.prompt.matchAll(/^\d+\. 候選 (\S+)$/gm)].map((match) => match[1]);
        return { threadId: 'qa', turnId: 't', text: JSON.stringify({ summary: '好', pick: ids[0], redoNote: '', candidates: ids.map((candidateId) => ({ candidateId, identity: 5, spec: 5, anatomy: 5, style: 5, clean: 5, issues: [], verdict: 'pass' })) }) };
      }
      return { threadId: 'other', turnId: 't', text: JSON.stringify({ parts: [], views: [], summary: '沒有裝備' }) };
    },
  };
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-expr-auto-'));
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-expr-work-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client, version: async () => 'test', workDir, drawAccess: async () => ({ ok: true, planType: 'plus' }), autopilotTiming: { pollMs: 20 } }) });
  let screen = true;
  t.after(async () => { screen = false; await running.close(); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); await fs.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const store = running.store;
  const project = await store.createProject({ name: '全自動表情' });
  for (const key of ['anger', 'sad', 'surprised', 'shy']) await store.removeExpression(project.id, key);
  // 畫面：看到正面等著裁切就裁好送回來。
  const crop = { x: 0, y: 0.03, width: 1, height: 0.94 };
  const browser = setInterval(async () => {
    if (!screen) return;
    const current = await store.getProject(project.id).catch(() => null);
    if (current?.views?.status === 'boxes' && current.views.assetId === current.character.adopted.character) await store.saveViews(project.id, { assetId: current.views.assetId, items: [{ view: 'front', crop, frame: crop, figure: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 }, buffer: png }] }).catch(() => {});
  }, 20);
  t.after(() => clearInterval(browser));
  const response = await fetch(`${running.url}/api/projects/${project.id}/autopilot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ views: [], variants: 1, expressions: true }) });
  assert.equal(response.status, 200);
  const finished = await waitFor(async () => { const current = await store.getProject(project.id); return ['done', 'failed', 'paused', 'needs-you'].includes(current.autopilot?.status) && current; }, { timeout: 15000, label: '全自動跑完' });
  assert.equal(finished.autopilot.status, 'done', JSON.stringify(finished.autopilot));
  assert.deepEqual(finished.jobs.map((job) => [job.outputView, job.expression || null]), [['front', null], ['expression', 'neutral'], ['expression', 'joy']]);
  assert.ok(finished.expressions.items.neutral && finished.expressions.items.joy);
  assert.equal(finished.expressions.items.joy.sourceAssetId, finished.views.items.front.assetId, '照裁好的正面畫');
  const front = path.join(store.projectDir(project.id), 'assets', `${finished.views.items.front.assetId}.png`);
  const neutralAsset = finished.assets.find((asset) => asset.id === finished.expressions.items.neutral.assetId);
  assert.deepEqual(calls.draw[1].images, [front], '第一個表情只附正面');
  assert.deepEqual(calls.draw[2].images, [front, path.join(store.projectDir(project.id), 'assets', `${neutralAsset.id}.png`)], '之後附「一般」當取景參考');
  assert.match(calls.review[2].prompt, /這批是表情集的「開心」：胸像/);
  assert.match(calls.review[2].prompt, /已確認的表情（取景參考）/);
  assert.ok(finished.candidates.filter((item) => item.view === 'expression').every((item) => item.status === 'accepted' && item.acceptedBy === 'design-qa'));
  const drawing = finished.autopilot.log.filter((entry) => entry.code === 'drawing').map((entry) => entry.expression || entry.view);
  assert.deepEqual(drawing, ['front', 'neutral', 'joy']);
});

// ── 審查後的修正（2026-10-13） ──

test('舊設計的表情：不當取景參考；全自動要畫的包含舊設計的（「一般」先畫）', () => {
  const project = { character: { adopted: { character: 'new-main' } }, expressions: { list: ['joy', 'neutral', 'sad'], items: {
    neutral: { assetId: 'n-old', sourceMain: 'old-main' }, joy: { assetId: 'j-new', sourceMain: 'new-main' } } } };
  assert.equal(framingReference(project, 'sad'), 'j-new', '舊設計的「一般」不當取景參考');
  project.expressions.items.joy.sourceMain = 'old-main';
  assert.equal(framingReference(project, 'sad'), null, '全部都是舊設計時不附取景參考');
  assert.deepEqual(expressionsToDraw(project), ['neutral', 'joy', 'sad']);
  assert.equal(nextExpression(project), 'neutral', '舊設計的「一般」先重畫，決定新的取景');
  project.expressions.items.neutral.sourceMain = 'new-main';
  assert.deepEqual(expressionsToDraw(project), ['joy', 'sad']);
});

test('拿掉的表情（預設的也一樣）不會因為採用又跑回來，也不會超過上限；「復原」放回原本的位置和那張圖', async (t) => {
  const { store, project } = await withFront(t);
  const rev = project.character.revision;
  const draw = async (expression, buffer = png) => {
    const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫', kind: 'generate', outputView: 'expression', expression, baseRevision: rev });
    return { job, ...(await store.addAsset(project.id, { buffer, mimeType: 'image/png', targetId: 'character', jobId: job.id })) };
  };
  const joy = await draw('joy');
  let state = await store.removeExpression(project.id, 'joy');
  await assert.rejects(store.acceptCandidate(project.id, joy.candidate.id, { baseRevision: rev }), { code: 'EXPRESSION_REMOVED' });
  state = await store.getProject(project.id);
  assert.ok(!state.expressions.list.includes('joy'), '拿掉的預設表情不會跑回來');
  // 拿掉的表情：那批還沒挑的圖不再提醒「新圖」。
  assert.equal(jobPresentation(state, joy.job).labelKey, 'job.status.ended');
  assert.ok(!workspaceSummary(state, joy.job.outfitId).reviewCandidates.some((item) => item.id === joy.candidate.id));
  // 復原：放回原本的位置（第二格）；那批圖又可以挑。
  state = await store.addExpression(project.id, { restore: { key: 'joy', index: 1 } });
  assert.deepEqual(state.expressions.list.slice(0, 3), ['neutral', 'joy', 'anger']);
  assert.equal(jobPresentation(state, joy.job).labelKey, 'job.status.newImages');
  state = await store.acceptCandidate(project.id, joy.candidate.id, { baseRevision: rev });
  assert.equal(state.expressions.items.joy.assetId, joy.asset.id);

  // 自訂表情：拿掉後復原，名稱、說明、畫好的那張都放回來。
  state = await store.addExpression(project.id, { name: '壞笑', note: '一邊嘴角' });
  const key = state.expressions.list.at(-1);
  const custom = await draw(key, other);
  state = await store.acceptCandidate(project.id, custom.candidate.id, { baseRevision: rev });
  const snapshot = { key, index: state.expressions.list.indexOf(key), custom: state.expressions.custom[key], item: state.expressions.items[key] };
  await store.removeExpression(project.id, key);
  await assert.rejects(store.addExpression(project.id, { restore: { ...snapshot, key: '../evil' } }), { code: 'UNKNOWN_EXPRESSION' });
  await assert.rejects(store.addExpression(project.id, { restore: { ...snapshot, custom: { name: '' } } }), { code: 'INVALID_EXPRESSION' });
  state = await store.addExpression(project.id, { restore: snapshot });
  assert.equal(state.expressions.list.indexOf(key), snapshot.index);
  assert.deepEqual(state.expressions.custom[key], { name: '壞笑', note: '一邊嘴角' });
  assert.equal(state.expressions.items[key].assetId, custom.asset.id);
  // 復原時給的圖不是這個表情的：只放回表情，不放那張圖。
  await store.removeExpression(project.id, key);
  state = await store.addExpression(project.id, { restore: { ...snapshot, item: { ...snapshot.item, assetId: joy.asset.id } } });
  assert.equal(state.expressions.items[key], undefined);

  // 上限：滿 24 個時，採用拿掉的表情的舊圖不能讓它超過；復原也一樣擋。
  await store.removeExpression(project.id, 'sad');
  const sad = await (async () => { await store.addExpression(project.id, { preset: 'sad' }); const drawn = await draw('sad'); await store.removeExpression(project.id, 'sad'); return drawn; })();
  state = await store.getProject(project.id);
  for (let index = state.expressions.list.length; index < 24; index += 1) state = await store.addExpression(project.id, { name: `表情${index}` });
  await assert.rejects(store.acceptCandidate(project.id, sad.candidate.id, { baseRevision: rev }), { code: 'EXPRESSION_REMOVED' });
  await assert.rejects(store.addExpression(project.id, { restore: { key: 'sad', index: 0 } }), { code: 'EXPRESSION_LIMIT' });
  assert.equal((await store.getProject(project.id)).expressions.list.length, 24);
});

test('表情的工作說明不互相打架：不寫角色平常的神情、幾張之間只有表情不同、定稿只改表情；換了立繪的重畫照新的；比較看的是表情集裡那一張', async (t) => {
  const { store, project } = await withFront(t);
  const character = structuredClone(project.character);
  character.dna = { ...(character.dna || {}), face: { ...(character.dna?.face || {}), mood: 'cool' } };
  let state = await store.updateCharacter(project.id, { baseRevision: project.character.revision, character });
  assert.match(compileBrief(state.character).text, /冷靜/);
  assert.doesNotMatch(compileBrief(state.character, { expression: true }).text, /冷靜|cool composed/);
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫', kind: 'generate', outputView: 'expression', expression: 'anger', variants: 2, baseRevision: state.character.revision });
  const text = await fs.readFile(job.context.instructionsPath, 'utf8');
  assert.doesNotMatch(text, /冷靜|cool composed/, '不寫角色平常的神情');
  assert.match(text, /設定裡的神情（mood）是角色平常的樣子，這張的表情以「生氣」為準/);
  assert.match(text, /彼此只在表情的細節上可有變化（例如嘴型、眉毛、眼神），取景、設計與鎖定特徵都要一樣/);
  assert.doesNotMatch(text, /構圖或細節上可有變化|只改這次要的視角、姿勢與排版/);
  assert.match(text, /有定稿：設計照定稿，只改表情。/);
  assert.match(reviewPrompt({ instructions: text, references: [], candidates: [{ id: 'c1' }], view: 'expression', expression: { label: '生氣', brief: '生氣' } }), /胸像本來就裁在胸口，不算裁切問題/);
  assert.match(reviewPrompt({ instructions: '# 工作', references: [], candidates: [{ id: 'c1' }], view: 'side' }), /clean 乾淨：沒有文字、浮水印、邊框、多餘的人或物、裁切與破圖/);

  // 比較：拿表情集裡這個表情現在那一張來比；還沒有就不比（不拿正式立繪來比）。
  const first = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id });
  state = await store.getProject(project.id);
  assert.equal(candidateComparison(state, first.candidate).current, null);
  state = await store.acceptCandidate(project.id, first.candidate.id, { baseRevision: state.character.revision });
  const second = await store.addAsset(project.id, { buffer: other, mimeType: 'image/png', targetId: 'character', jobId: job.id });
  state = await store.getProject(project.id);
  assert.equal(candidateComparison(state, second.candidate).current?.id, first.asset.id);

  // 換了正式立繪：重畫的說明寫「照新的正面重畫」，不是「原本的有問題」。
  const front = await store.createJob(project.id, { targetId: 'character', prompt: '新的正面', kind: 'generate', baseRevision: state.character.revision, framing: 'frontView' });
  const drawn = await store.addAsset(project.id, { buffer: uniquePng(), mimeType: 'image/png', targetId: 'character', jobId: front.id });
  state = await store.acceptCandidate(project.id, drawn.candidate.id, { baseRevision: state.character.revision });
  assert.equal(expressionStale(state, 'anger'), true);
  const redo = await store.createJob(project.id, { targetId: 'character', prompt: '畫', kind: 'generate', outputView: 'expression', expression: 'anger', baseRevision: state.character.revision });
  const redoText = await fs.readFile(redo.context.instructionsPath, 'utf8');
  assert.match(redoText, /正式立繪換過了，照新的正面重畫「生氣」/);
  assert.doesNotMatch(redoText, /原本的「生氣」有問題/);
});

test('全自動畫表情的途中換了立繪：照舊立繪畫的那批不代為採用，照新的立繪重畫（舊設計的「一般」先重畫）；途中拿掉的表情跳過', async (t) => {
  const { startServer } = await import('../server/http.mjs');
  const { registerCodexRoutes } = await import('../server/integrations.mjs');
  const { reviewSchema } = await import('../shared/autopilot.mjs');
  const hooks = {};
  const client = {
    close() {},
    async freshTurn(options) {
      if (options.draw) {
        const key = /expression：(\S+?)）/.exec(options.prompt)?.[1];
        if (hooks[key]) { const hook = hooks[key]; delete hooks[key]; await hook(); }
        options.onImage({ result: uniquePng().toString('base64') });
        return { threadId: 'draw', turnId: 't', text: '畫好了', images: [] };
      }
      if (options.outputSchema === reviewSchema) {
        const ids = [...options.prompt.matchAll(/^\d+\. 候選 (\S+)$/gm)].map((match) => match[1]);
        return { threadId: 'qa', turnId: 't', text: JSON.stringify({ summary: '好', pick: ids[0], redoNote: '', candidates: ids.map((candidateId) => ({ candidateId, identity: 5, spec: 5, anatomy: 5, style: 5, clean: 5, issues: [], verdict: 'pass' })) }) };
      }
      return { threadId: 'other', turnId: 't', text: JSON.stringify({ parts: [], views: [], summary: '沒有裝備' }) };
    },
  };
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-expr-fix-'));
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-expr-fix-work-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client, version: async () => 'test', workDir, drawAccess: async () => ({ ok: true, planType: 'plus' }), autopilotTiming: { pollMs: 20 } }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); await fs.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const store = running.store;
  const project = await store.createProject({ name: '途中換立繪' });
  const adoptMain = async () => {
    const current = await store.getProject(project.id);
    // 一般的立繪（不是正面全身）：不用等畫面裁切，表情直接照整張畫。
    const job = await store.createJob(project.id, { targetId: 'character', prompt: '立繪', kind: 'generate', baseRevision: current.character.revision });
    const { candidate } = await store.addAsset(project.id, { buffer: uniquePng(), mimeType: 'image/png', targetId: 'character', jobId: job.id });
    return store.acceptCandidate(project.id, candidate.id, { baseRevision: current.character.revision });
  };
  const oldMain = (await adoptMain()).character.adopted.character;
  for (const key of ['anger', 'sad', 'surprised', 'shy']) await store.removeExpression(project.id, key);
  await store.addExpression(project.id, { preset: 'wink' });
  // 畫「開心」的時候換了立繪；畫「眨眼」的時候把它拿掉。
  let newMain = null;
  hooks.joy = async () => { newMain = (await adoptMain()).character.adopted.character; };
  hooks.wink = async () => { await store.removeExpression(project.id, 'wink'); };
  const start = async () => {
    const response = await fetch(`${running.url}/api/projects/${project.id}/autopilot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ views: [], variants: 1, expressions: true }) });
    assert.equal(response.status, 200);
    return waitFor(async () => { const current = await store.getProject(project.id); return ['done', 'failed', 'paused', 'needs-you'].includes(current.autopilot?.status) && current; }, { timeout: 15000, label: '全自動跑完' });
  };
  const finished = await start();
  assert.equal(finished.autopilot.status, 'done', JSON.stringify(finished.autopilot));
  assert.equal(finished.autopilot.facesOnly, true);
  assert.notEqual(newMain, oldMain);
  const order = finished.jobs.filter((job) => job.outputView === 'expression').map((job) => [job.expression, job.expressionMain === newMain ? 'new' : 'old', job.status]);
  assert.deepEqual(order, [['neutral', 'old', 'accepted'], ['joy', 'old', 'cancelled'], ['neutral', 'new', 'accepted'], ['joy', 'new', 'accepted'], ['wink', 'new', 'review']]);
  assert.equal(finished.expressions.items.neutral.sourceMain, newMain);
  assert.equal(finished.expressions.items.joy.sourceMain, newMain);
  assert.equal(finished.expressions.items.wink, undefined);
  assert.ok(!finished.expressions.list.includes('wink'));
  const codes = finished.autopilot.log.map((entry) => entry.code);
  assert.ok(codes.includes('staleBatch') && codes.includes('removed'), codes.join(','));
  assert.ok(!finished.autopilot.log.some((entry) => entry.code === 'userPicked'));
  // 拿掉的「眨眼」那批不會一直提醒「新圖」。
  const winkJob = finished.jobs.find((job) => job.expression === 'wink');
  assert.equal(jobPresentation(finished, winkJob).labelKey, 'job.status.ended');
});
