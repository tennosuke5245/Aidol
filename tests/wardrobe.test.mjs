// 衣裝差分（2026-10-13 起）：每套穿搭可以有自己的立繪；正式立繪屬於主要那套，其他套的立繪放進衣櫃（不換正式立繪、不進版本）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../server/store.mjs';
import { isOutfitVariant, mainOutfitId, outfitPortraitId, outfitRemoved, removedOutfitJob, removedOutfitSnapshot, restoreOutfit } from '../shared/wardrobe.mjs';
import { candidateComparison, jobPresentation, workspaceSummary } from '../shared/agent-workspace.mjs';
import { compileBrief } from '../shared/prompt-compiler.mjs';
import { newCharacter, validateCharacter } from '../shared/domain.mjs';
import { canonChanges } from '../shared/canon.mjs';
import { reviewPrompt } from '../shared/autopilot.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');
let serial = 0;
const uniquePng = () => Buffer.concat([png, Buffer.from(`#${++serial}`)]);

// 有正式立繪（主要那套 combat）＋第二套「睡衣」的角色。
async function withOutfits(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-wardrobe-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const created = await store.createProject({ name: '衣櫃測試' });
  const job = await store.createJob(created.id, { targetId: 'character', prompt: '立繪', kind: 'generate', baseRevision: 1 });
  const { asset: main, candidate } = await store.addAsset(created.id, { buffer: uniquePng(), mimeType: 'image/png', targetId: 'character', jobId: job.id });
  let project = await store.acceptCandidate(created.id, candidate.id, { baseRevision: 1 });
  const character = structuredClone(project.character);
  character.outfits.sleep = { id: 'sleep', name: '睡衣', equipped: [], spec: { scene: 'sleepwear' } };
  project = await store.updateCharacter(created.id, { baseRevision: project.character.revision, character });
  const draw = async (outfitId, extra = {}) => {
    const current = await store.getProject(created.id);
    const drawn = await store.createJob(created.id, { targetId: 'character', prompt: '畫', kind: 'generate', outfitId, baseRevision: current.character.revision, ...extra });
    return { job: drawn, ...(await store.addAsset(created.id, { buffer: uniquePng(), mimeType: 'image/png', targetId: 'character', jobId: drawn.id })) };
  };
  return { store, id: created.id, project, main, draw };
}

test('衣櫃的共用規則：主要那套看正式立繪畫的時候的穿搭；另一套的立繪在衣櫃', () => {
  const project = { character: { outfits: { a: { id: 'a' }, b: { id: 'b' } }, adopted: {} }, assets: [] };
  assert.equal(mainOutfitId(project), 'a', '沒有正式立繪：第一套');
  assert.equal(isOutfitVariant(project, 'b'), false, '還沒有正式立繪時，畫哪套都是正式立繪');
  project.character.adopted.character = 'main';
  project.assets.push({ id: 'main', outfitId: 'b' }, { id: 'a-1', outfitId: 'a' });
  assert.equal(mainOutfitId(project), 'b', '正式立繪是 b 套畫的');
  assert.equal(isOutfitVariant(project, 'a'), true);
  assert.equal(isOutfitVariant(project, 'b'), false);
  assert.equal(isOutfitVariant(project, 'gone'), false, '不存在的穿搭不算');
  assert.equal(outfitPortraitId(project, 'b'), 'main');
  assert.equal(outfitPortraitId(project, 'a'), null);
  project.wardrobe = { items: { a: { assetId: 'a-1' } } };
  assert.equal(outfitPortraitId(project, 'a'), 'a-1');
  project.wardrobe.items.a.assetId = 'deleted';
  assert.equal(outfitPortraitId(project, 'a'), null, '圖不見了就當沒有');
  project.assets[0].outfitId = 'removed';
  assert.equal(mainOutfitId(project), 'a', '正式立繪的那套被刪掉：第一套');
});

test('穿搭情境：寫進格式驗證與交給 AI 的描述；舊資料沒有情境，描述不變', () => {
  const character = { name: 'x', outfits: { a: { id: 'a', name: '睡衣', spec: { scene: 'sleepwear', style: 'soft-casual' } } }, palette: [] };
  const brief = compileBrief(character, { outfitId: 'a' });
  assert.match(brief.text, /穿搭「睡衣」：睡衣・日常休閒/);
  assert.match(brief.prompt, /comfortable pajamas, simple contemporary casual outfit/);
  delete character.outfits.a.spec.scene;
  assert.doesNotMatch(compileBrief(character, { outfitId: 'a' }).text, /睡衣・/);
});

test('另一套穿搭的立繪：工作說明照正式立繪只換衣服；採用放進衣櫃、不換正式立繪、不進版本；可以改成正式立繪', async (t) => {
  const { store, id, project, main, draw } = await withOutfits(t);
  // 加別套穿搭不算正式立繪的設定改了（不會標「設定改過」）；改主要那套才算。
  assert.ok(!project.syncTargets.includes('character'));
  const edited = structuredClone(project.character);
  edited.outfits.sleep.spec = { scene: 'sleepwear', style: 'soft-casual' };
  assert.ok(!(await store.updateCharacter(id, { baseRevision: project.character.revision, character: edited })).syncTargets.includes('character'));
  assert.throws(() => validateCharacter({ ...structuredClone(project.character), outfits: { ...project.character.outfits, sleep: { ...project.character.outfits.sleep, spec: { scene: 'bogus' } } } }, project.assets.map((asset) => asset.id)));
  const variant = await draw('sleep', { variants: 2 });
  assert.equal(variant.job.outfitVariant, true);
  assert.equal(variant.job.outfitMain, main.id);
  const text = await fs.readFile(variant.job.context.instructionsPath, 'utf8');
  assert.match(text, /這是穿搭「睡衣」的立繪：照正式立繪畫同一個角色，臉、五官、髮型、髮色、膚色、身形與比例都不改，只換成這套穿搭的衣服與配件/);
  assert.match(text, /- 正式立繪（主要那套穿搭）：照它畫同一個角色.*衣服不要照它/);
  assert.match(text, /穿搭「睡衣」：睡衣/, '情境寫進描述');
  assert.doesNotMatch(text, /只改這次要的視角、姿勢與排版/);
  // 主要那套照舊：不是另一套。
  const again = await draw('combat');
  assert.equal(again.job.outfitVariant, undefined);

  const before = await store.getProject(id);
  let state = await store.acceptCandidate(id, variant.candidate.id, { baseRevision: before.character.revision });
  assert.equal(state.character.adopted.character, main.id, '不換正式立繪');
  assert.equal(state.character.revision, before.character.revision, '不進版本');
  assert.equal(state.wardrobe.items.sleep.assetId, variant.asset.id);
  assert.equal(outfitPortraitId(state, 'sleep'), variant.asset.id);
  assert.equal(outfitPortraitId(state, 'combat'), main.id);
  // 比較：拿這套現在的立繪來比（不拿正式立繪）。
  assert.equal(candidateComparison(state, variant.candidate).current.id, variant.asset.id);
  const second = await draw('sleep');
  state = await store.getProject(id);
  assert.equal(candidateComparison(state, second.candidate).current.id, variant.asset.id);
  assert.equal(candidateComparison(state, again.candidate).current.id, main.id);

  // 表情、三視圖的角度跟著正式立繪：選了別套也用主要那套。
  const expression = await store.createJob(id, { targetId: 'character', prompt: '畫', kind: 'generate', outputView: 'expression', expression: 'neutral', outfitId: 'sleep', baseRevision: state.character.revision });
  assert.equal(expression.outfitId, 'combat');
  assert.equal(expression.outfitVariant, undefined);
  await store.saveViews(id, { assetId: main.id, items: [{ view: 'front', crop: { x: 0, y: 0, width: 1, height: 1 }, frame: { x: 0, y: 0, width: 1, height: 1 }, figure: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 }, buffer: png }] });
  const side = await store.createJob(id, { targetId: 'character', prompt: '畫側面', kind: 'generate', outputView: 'side', outfitId: 'sleep', baseRevision: state.character.revision });
  assert.equal(side.outfitId, 'combat');

  // 匯出：每套穿搭的立繪另外放一份。
  const zip = (await store.exportProject(id)).buffer.toString('latin1');
  assert.ok(zip.includes('outfits/01-combat.png') && zip.includes('outfits/02-sleep.png') && zip.includes('outfits/outfits.md'));

  // 改主要那套才算正式立繪要重畫。
  const mainEdit = structuredClone(state.character);
  mainEdit.outfits.combat.spec = { style: 'formal' };
  state = await store.updateCharacter(id, { baseRevision: state.character.revision, character: mainEdit });
  assert.ok(state.syncTargets.includes('character'));
  // 改成正式立繪：原本的正式立繪放進它那套的衣櫃，進版本。
  state = await store.acceptCandidate(id, variant.candidate.id, { baseRevision: state.character.revision, asMain: true });
  assert.equal(state.character.adopted.character, variant.asset.id);
  assert.equal(state.character.revision, before.character.revision + 2);
  assert.equal(mainOutfitId(state), 'sleep');
  assert.equal(state.wardrobe.items.combat.assetId, main.id, '原本的正式立繪放進它那套');
  assert.equal(state.wardrobe.items.sleep, undefined);
  assert.equal(outfitPortraitId(state, 'combat'), main.id);
  assert.equal(outfitPortraitId(state, 'sleep'), variant.asset.id);
});

test('全自動已經有正式立繪時一律用主要那套畫（畫面選了別套也一樣）', async (t) => {
  const { startServer } = await import('../server/http.mjs');
  const { registerCodexRoutes } = await import('../server/integrations.mjs');
  const client = {
    close() {},
    async freshTurn(options) {
      if (options.draw) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        options.onImage({ result: uniquePng().toString('base64') });
        return { threadId: 'draw', turnId: 't', text: '畫好了', images: [] };
      }
      return { threadId: 'other', turnId: 't', text: JSON.stringify({ parts: [], views: [], summary: '沒有裝備' }) };
    },
  };
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-wardrobe-auto-'));
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-wardrobe-work-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client, version: async () => 'test', workDir, drawAccess: async () => ({ ok: true, planType: 'plus' }), autopilotTiming: { pollMs: 20 } }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); await fs.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const store = running.store;
  const created = await store.createProject({ name: '全自動衣櫃' });
  const job = await store.createJob(created.id, { targetId: 'character', prompt: '立繪', kind: 'generate', baseRevision: 1 });
  const { candidate } = await store.addAsset(created.id, { buffer: uniquePng(), mimeType: 'image/png', targetId: 'character', jobId: job.id });
  const adopted = await store.acceptCandidate(created.id, candidate.id, { baseRevision: 1 });
  const character = structuredClone(adopted.character);
  character.outfits.sleep = { id: 'sleep', name: '睡衣', equipped: [] };
  await store.updateCharacter(created.id, { baseRevision: adopted.character.revision, character });
  const response = await fetch(`${running.url}/api/projects/${created.id}/autopilot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ views: ['side'], variants: 1, outfitId: 'sleep' }) });
  assert.equal(response.status, 200);
  const until = Date.now() + 8000;
  let first;
  while (!first && Date.now() < until) {
    first = (await store.getProject(created.id)).jobs.find((item) => item.autopilotId);
    if (!first) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await fetch(`${running.url}/api/projects/${created.id}/autopilot/stop`, { method: 'POST' });
  assert.ok(first, '全自動有開始畫');
  assert.equal(first.outputView, 'front');
  assert.equal(first.outfitId, 'combat', '用主要那套');
  assert.equal(first.outfitVariant, undefined);
});

test('另一套穿搭有繪風參考時：說明不叫 AI 照正式立繪的衣服', async (t) => {
  const { store, id, draw, main } = await withOutfits(t);
  const current = await store.getProject(id);
  const character = structuredClone(current.character);
  character.style.references = [...(character.style.references || []), { id: 'ref-style', assetId: main.id, role: 'style', focus: ['線條'] }];
  await store.updateCharacter(id, { baseRevision: current.character.revision, character });
  const text = await fs.readFile((await draw('sleep')).job.context.instructionsPath, 'utf8');
  assert.match(text, /正式立繪只用來確認長相（衣服照這次的穿搭，不要照它）/);
  assert.match(text, /角色的長相、髮型與髮色依 input\.yaml 和上面的正式立繪保持一致；衣服照這次的穿搭設定，不要照正式立繪的衣服；畫法/);
  assert.doesNotMatch(text, /用來確認長相與服裝|服裝與配色依 input\.yaml/);
  // 主要那套照舊。
  const mainText = await fs.readFile((await draw('combat')).job.context.instructionsPath, 'utf8');
  assert.match(mainText, /正式立繪與裝備圖只用來確認長相與服裝/);
});

// ── 審查後的修正（2026-10-13） ──

test('局部修改另一套的立繪：附上那張（選區以它為準）；畫新的不附', async (t) => {
  const { store, id, draw } = await withOutfits(t);
  const first = await draw('sleep');
  let state = await store.getProject(id);
  state = await store.acceptCandidate(id, first.candidate.id, { baseRevision: state.character.revision });
  const refine = await store.createJob(id, { targetId: 'character', prompt: '袖子捲起來', kind: 'refine', outfitId: 'sleep', region: { x: 0.1, y: 0.2, width: 0.3, height: 0.3 }, baseRevision: state.character.revision });
  assert.ok(refine.context.referenceAssets.some((asset) => asset.id === first.asset.id), '附上要改的那張');
  assert.match(await fs.readFile(refine.context.instructionsPath, 'utf8'), /- 這套穿搭「睡衣」目前的立繪：這次照這張局部修改，選區以這張為準/);
  const fresh = await draw('sleep');
  assert.ok(!fresh.job.context.referenceAssets.some((asset) => asset.id === first.asset.id), '畫新的不附舊的那張');
  // 正面全身的規格不說「之後照這張畫側面背面」（另一套不畫三視圖）。
  const front = await draw('sleep', { framing: 'frontView' });
  const text = await fs.readFile(front.job.context.instructionsPath, 'utf8');
  assert.match(text, /正面全身規格：/);
  assert.doesNotMatch(text, /之後會照這張畫側面與背面/);
});

test('定稿＋另一套穿搭：定稿之後的長相改動照樣列出（穿搭的改動不列）；DNA 標題寫穿搭照設定', () => {
  const v1 = newCharacter('canon-wardrobe', '定稿');
  v1.dna = { hair: { color: 'black' } };
  v1.outfits.sleep = { id: 'sleep', name: '睡衣', equipped: [] };
  const v2 = structuredClone(v1); v2.revision = 2;
  v2.style.references.push({ id: 'ref', assetId: 'asset', role: 'identity', focus: [], canon: true });
  const v3 = structuredClone(v2); v3.revision = 3;
  v3.dna.hair.color = 'silver';
  v3.outfits.sleep.spec = { scene: 'sleepwear' };
  const history = [v1, v2, v3].map((character) => ({ revision: character.revision, character }));
  const changes = canonChanges(history, v3, { outfitId: 'sleep', variant: true });
  assert.deepEqual(changes.map((change) => change.areaKey), ['dna'], JSON.stringify(changes));
  assert.ok(canonChanges(history, v3, { outfitId: 'sleep' }).some((change) => change.areaKey === 'outfits'), '一般（主要那套）照舊會列穿搭');
  assert.match(compileBrief(v3, { outfitId: 'sleep', canon: true, outfitVariant: true }).text, /長相以定稿為準，這裡補充定稿上看不到的部分；穿搭照這裡的設定/);
  assert.match(compileBrief(v3, { outfitId: 'sleep', canon: true }).text, /長相以定稿為準，這裡只補充定稿上看不到的部分）/);
});

test('改成正式立繪後再恢復舊存檔：被換下來的那張回到它那套的衣櫃；匯入的立繪也能再設回正式立繪', async (t) => {
  const { store, id, main, draw } = await withOutfits(t);
  const variant = await draw('sleep');
  let state = await store.getProject(id);
  state = await store.acceptCandidate(id, variant.candidate.id, { baseRevision: state.character.revision });
  const beforeSwap = state.history.at(-1);
  state = await store.acceptCandidate(id, variant.candidate.id, { baseRevision: state.character.revision, asMain: true });
  assert.equal(state.character.adopted.character, variant.asset.id);
  state = await store.restore(id, { historyId: beforeSwap.id, baseRevision: state.character.revision });
  assert.equal(state.character.adopted.character, main.id);
  assert.equal(outfitPortraitId(state, 'sleep'), variant.asset.id, '睡衣那張回到衣櫃');

  // 匯入的立繪（沒有候選）被換下來後，也能用「改成正式立繪」設回去。
  const imported = await store.importMainImage(id, { buffer: uniquePng(), mimeType: 'image/png', name: '我的三視圖.png', outfitId: 'combat', baseRevision: state.character.revision });
  state = imported.project;
  state = await store.acceptCandidate(id, variant.candidate.id, { baseRevision: state.character.revision, asMain: true });
  assert.equal(outfitPortraitId(state, 'combat'), imported.asset.id);
  await assert.rejects(store.promoteOutfit(id, 'sleep', { baseRevision: state.character.revision }), { code: 'OUTFIT_NOT_VARIANT' });
  state = await store.promoteOutfit(id, 'combat', { baseRevision: state.character.revision });
  assert.equal(state.character.adopted.character, imported.asset.id);
  assert.equal(outfitPortraitId(state, 'sleep'), variant.asset.id, '換下來的睡衣回到衣櫃');
  const character = structuredClone(state.character);
  character.outfits.empty = { id: 'empty', name: '空的', equipped: [] };
  state = await store.updateCharacter(id, { baseRevision: state.character.revision, character });
  await assert.rejects(store.promoteOutfit(id, 'empty', { baseRevision: state.character.revision }), { code: 'OUTFIT_NO_PORTRAIT' });
});

test('只有別套穿的裝備改了：不算正式立繪的設定改了', async (t) => {
  const { store, id } = await withOutfits(t);
  let state = await store.getProject(id);
  const character = structuredClone(state.character);
  character.components.pjtop = { id: 'pjtop', name: '睡衣上衣', kind: 'garment', description: '條紋', designStatus: 'draft' };
  character.outfits.sleep.equipped.push({ id: 'wear-pj', componentId: 'pjtop', anchor: '上身', enabled: true });
  state = await store.updateCharacter(id, { baseRevision: state.character.revision, character });
  assert.ok(!state.syncTargets.includes('character'), JSON.stringify(state.syncTargets));
  const worn = structuredClone(state.character);
  worn.components.boots = { id: 'boots', name: '短靴', kind: 'footwear', description: '黑色', designStatus: 'draft' };
  worn.outfits.combat.equipped.push({ id: 'wear-boots', componentId: 'boots', anchor: '雙腳', enabled: true });
  state = await store.updateCharacter(id, { baseRevision: state.character.revision, character: worn });
  assert.ok(state.syncTargets.includes('character'), '主要那套穿的裝備改了才算');
});

test('Design QA 審另一套穿搭：要同一個角色，但衣服不必和正式立繪一樣', () => {
  const prompt = reviewPrompt({ instructions: '# 工作', references: [{ label: '正式立繪' }], candidates: [{ id: 'c1' }], view: 'front', outfit: { name: '睡衣' } });
  assert.match(prompt, /這批是穿搭「睡衣」的立繪：要和參考裡的正式立繪是同一個角色/);
  assert.match(prompt, /衣服與配件照這次的穿搭設定（不必和正式立繪一樣）/);
  assert.doesNotMatch(prompt, /這批是正面全身/);
});

// ── 刪除套裝（2026-10-13 起）──
const waitFor = async (check, { timeout = 8000, label = '條件' } = {}) => {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error(`等不到${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test('刪掉的套裝：共用規則只認立繪工作（三視圖的角度、表情、裝備不算）', () => {
  const project = { character: { outfits: { a: { id: 'a' } }, adopted: {} }, assets: [] };
  assert.equal(outfitRemoved(project, 'a'), false);
  assert.equal(outfitRemoved(project, 'gone'), true);
  assert.equal(outfitRemoved(project, null), false, '舊工作沒記穿搭：不算刪掉');
  assert.equal(outfitRemoved(project, ''), false);
  assert.equal(removedOutfitJob(project, { targetId: 'character', outfitId: 'gone' }), true);
  assert.equal(removedOutfitJob(project, { targetId: 'character', outfitId: 'gone', outputView: 'front' }), true);
  assert.equal(removedOutfitJob(project, { targetId: 'character', outfitId: 'gone', outputView: 'expression' }), false);
  assert.equal(removedOutfitJob(project, { targetId: 'character', outfitId: 'gone', outputView: 'side' }), false);
  assert.equal(removedOutfitJob(project, { targetId: 'boots', outfitId: 'gone' }), false, '裝備的圖不分穿搭');
  assert.equal(removedOutfitJob(project, { targetId: 'character', outfitId: 'a' }), false);
});

test('刪除另一套穿搭：正式立繪不標改過；照它畫的圖不能採用（改成正式立繪也不行）、工作當成結束；衣櫃記著那張，復原後回來、也能採用', async (t) => {
  const { store, id, main, draw } = await withOutfits(t);
  const kept = await draw('sleep');
  let state = await store.getProject(id);
  state = await store.acceptCandidate(id, kept.candidate.id, { baseRevision: state.character.revision });
  assert.equal(outfitPortraitId(state, 'sleep'), kept.asset.id);
  const pending = await draw('sleep', { variants: 2 });
  state = await store.getProject(id);
  const withSleep = structuredClone(state.character);
  const character = structuredClone(state.character);
  delete character.outfits.sleep;
  state = await store.updateCharacter(id, { baseRevision: state.character.revision, character });
  assert.ok(!state.syncTargets.includes('character'), '刪掉別套不算正式立繪的設定改了');
  assert.equal(state.wardrobe.items.sleep.assetId, kept.asset.id, '衣櫃記著（復原用）');
  assert.equal(outfitPortraitId(state, 'sleep'), null);
  assert.equal(mainOutfitId(state), 'combat');

  for (const asMain of [false, true]) {
    await assert.rejects(store.acceptCandidate(id, pending.candidate.id, { baseRevision: state.character.revision, asMain }), { code: 'OUTFIT_REMOVED' });
  }
  // 先前採用過、現在在衣櫃記著的那張也一樣（換回來也不行）。
  await assert.rejects(store.acceptCandidate(id, kept.candidate.id, { baseRevision: state.character.revision }), { code: 'OUTFIT_REMOVED' });
  state = await store.getProject(id);
  assert.equal(state.character.adopted.character, main.id, '正式立繪沒被換掉');
  assert.equal(state.candidates.find((item) => item.id === pending.candidate.id).status, 'pending', '圖留著');
  const job = state.jobs.find((item) => item.id === pending.job.id);
  assert.equal(jobPresentation(state, job).labelKey, 'job.status.ended', '不再提醒新圖');
  const sleepSummary = workspaceSummary(state, 'sleep');
  assert.equal(sleepSummary.attentionJobs.length, 0, '刪掉那套的立繪工作不列在等你處理');
  assert.equal(sleepSummary.reviewCandidates.length, 0);
  assert.equal((await store.listProjects()).find((item) => item.id === id).attentionCount, 0, '角色庫也不提醒');
  await assert.rejects(store.promoteOutfit(id, 'sleep', { baseRevision: state.character.revision }), { code: 'OUTFIT_NOT_VARIANT' });
  await assert.rejects(store.createJob(id, { targetId: 'character', prompt: '畫', kind: 'generate', outfitId: 'sleep', baseRevision: state.character.revision }), { code: 'UNKNOWN_OUTFIT' });
  const zip = (await store.exportProject(id)).buffer.toString('latin1');
  assert.ok(zip.includes('outfits/01-combat.png') && !zip.includes('sleep.png'), '匯出只有還在的套裝');

  // 復原（畫面上的「復原」就是把那套放回設定）：衣櫃那張回來，還沒挑的圖也能採用了。
  const restored = structuredClone(state.character);
  restored.outfits = { ...restored.outfits, sleep: withSleep.outfits.sleep };
  state = await store.updateCharacter(id, { baseRevision: state.character.revision, character: restored });
  assert.equal(outfitPortraitId(state, 'sleep'), kept.asset.id, '復原後衣櫃那張回來');
  assert.equal(jobPresentation(state, state.jobs.find((item) => item.id === pending.job.id)).labelKey, 'job.status.newImages');
  state = await store.acceptCandidate(id, pending.candidate.id, { baseRevision: state.character.revision });
  assert.equal(outfitPortraitId(state, 'sleep'), pending.asset.id);
  assert.equal(state.character.adopted.character, main.id);
});

test('恢復到沒有那套穿搭的存檔：照它畫的圖不會變成正式立繪；再恢復回來就能採用', async (t) => {
  const { store, id, main, draw } = await withOutfits(t);
  let state = await store.getProject(id);
  const beforeSleep = state.history.find((entry) => !entry.character.outfits.sleep && entry.character.adopted.character === main.id);
  assert.ok(beforeSleep, '有加睡衣之前、已經有正式立繪的存檔');
  const pending = await draw('sleep');
  state = await store.getProject(id);
  const withSleep = state.history.at(-1);
  state = await store.restore(id, { historyId: beforeSleep.id, baseRevision: state.character.revision });
  assert.equal(state.character.outfits.sleep, undefined);
  await assert.rejects(store.acceptCandidate(id, pending.candidate.id, { baseRevision: state.character.revision }), { code: 'OUTFIT_REMOVED' });
  assert.equal((await store.getProject(id)).character.adopted.character, main.id);
  state = await store.restore(id, { historyId: withSleep.id, baseRevision: state.character.revision });
  state = await store.acceptCandidate(id, pending.candidate.id, { baseRevision: state.character.revision });
  assert.equal(outfitPortraitId(state, 'sleep'), pending.asset.id);
  assert.equal(state.character.adopted.character, main.id);
});

test('全自動畫第一張時把選的套裝刪掉：那批不代為採用，改用還在的那套重畫', async (t) => {
  const { startServer } = await import('../server/http.mjs');
  const { registerCodexRoutes } = await import('../server/integrations.mjs');
  const { reviewSchema } = await import('../shared/autopilot.mjs');
  let onFirstDraw = null;
  const client = {
    close() {},
    async freshTurn(options) {
      if (options.draw) {
        if (onFirstDraw) { const hook = onFirstDraw; onFirstDraw = null; await hook(); }
        options.onImage({ result: uniquePng().toString('base64') });
        return { threadId: 'draw', turnId: 't', text: '畫好了', images: [] };
      }
      if (options.outputSchema === reviewSchema) {
        const ids = [...options.prompt.matchAll(/^\d+\. 候選 (\S+)$/gm)].map((match) => match[1]);
        reviewed.push(ids);
        return { threadId: 'qa', turnId: 't', text: JSON.stringify({ summary: '好', pick: ids[0], redoNote: '', candidates: ids.map((candidateId) => ({ candidateId, identity: 5, spec: 5, anatomy: 5, style: 5, clean: 5, issues: [], verdict: 'pass' })) }) };
      }
      return { threadId: 'other', turnId: 't', text: JSON.stringify({ parts: [], views: [], summary: '沒有裝備' }) };
    },
  };
  const reviewed = [];
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-wardrobe-del-'));
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-wardrobe-del-work-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client, version: async () => 'test', workDir, drawAccess: async () => ({ ok: true, planType: 'plus' }), autopilotTiming: { pollMs: 20 } }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); await fs.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const store = running.store;
  const created = await store.createProject({ name: '全自動途中刪套裝' });
  const character = structuredClone(created.character);
  character.outfits.sleep = { id: 'sleep', name: '睡衣', equipped: [] };
  await store.updateCharacter(created.id, { baseRevision: created.character.revision, character });
  onFirstDraw = async () => {
    const current = await store.getProject(created.id);
    const next = structuredClone(current.character);
    delete next.outfits.sleep;
    await store.updateCharacter(created.id, { baseRevision: current.character.revision, character: next });
  };
  const response = await fetch(`${running.url}/api/projects/${created.id}/autopilot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ views: [], variants: 1, outfitId: 'sleep' }) });
  assert.equal(response.status, 200);
  const adopted = await waitFor(async () => { const current = await store.getProject(created.id); return (current.character.adopted.character || ['failed', 'paused', 'needs-you', 'stopped'].includes(current.autopilot?.status)) && current; }, { timeout: 15000, label: '代為採用' });
  await fetch(`${running.url}/api/projects/${created.id}/autopilot/stop`, { method: 'POST' });
  assert.notEqual(adopted.autopilot.status, 'failed', JSON.stringify(adopted.autopilot));
  const [first, second] = adopted.jobs.filter((job) => job.autopilotId);
  assert.equal(first.outfitId, 'sleep');
  assert.equal(second?.outfitId, 'combat', '改用還在的那套');
  assert.ok(adopted.candidates.filter((item) => item.jobId === first.id).every((item) => item.status === 'pending'), '刪掉那套的圖沒被採用');
  const main = adopted.assets.find((asset) => asset.id === adopted.character.adopted.character);
  assert.equal(main.outfitId, 'combat');
  assert.ok(adopted.autopilot.log.some((entry) => entry.code === 'outfitRemoved'), adopted.autopilot.log.map((entry) => entry.code).join(','));
  assert.ok(!adopted.autopilot.log.some((entry) => entry.code === 'redraw'), '不算重畫');
  const firstIds = adopted.candidates.filter((item) => item.jobId === first.id).map((item) => item.id);
  assert.ok(!reviewed.some((ids) => ids.some((candidateId) => firstIds.includes(candidateId))), '刪掉那套的那批不請 Design QA 看');
  assert.equal(jobPresentation(adopted, first).labelKey, 'job.status.ended');
});

test('Design QA 審圖時套裝被刪、而且這批都沒過：不算重畫、不留修正說明，改用還在的那套畫', async (t) => {
  const { startServer } = await import('../server/http.mjs');
  const { registerCodexRoutes } = await import('../server/integrations.mjs');
  const { reviewSchema } = await import('../shared/autopilot.mjs');
  let onFirstReview = null;
  const client = {
    close() {},
    async freshTurn(options) {
      if (options.draw) {
        options.onImage({ result: uniquePng().toString('base64') });
        return { threadId: 'draw', turnId: 't', text: '畫好了', images: [] };
      }
      if (options.outputSchema === reviewSchema) {
        const ids = [...options.prompt.matchAll(/^\d+\. 候選 (\S+)$/gm)].map((match) => match[1]);
        if (onFirstReview) {
          const hook = onFirstReview; onFirstReview = null; await hook();
          return { threadId: 'qa', turnId: 't', text: JSON.stringify({ summary: '睡衣的釦子畫錯', pick: '', redoNote: '睡衣的釦子要在左邊', candidates: ids.map((candidateId) => ({ candidateId, identity: 2, spec: 2, anatomy: 5, style: 5, clean: 5, issues: ['釦子'], verdict: 'fail' })) }) };
        }
        return { threadId: 'qa', turnId: 't', text: JSON.stringify({ summary: '好', pick: ids[0], redoNote: '', candidates: ids.map((candidateId) => ({ candidateId, identity: 5, spec: 5, anatomy: 5, style: 5, clean: 5, issues: [], verdict: 'pass' })) }) };
      }
      return { threadId: 'other', turnId: 't', text: JSON.stringify({ parts: [], views: [], summary: '沒有裝備' }) };
    },
  };
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-wardrobe-qa-'));
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-wardrobe-qa-work-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client, version: async () => 'test', workDir, drawAccess: async () => ({ ok: true, planType: 'plus' }), autopilotTiming: { pollMs: 20 } }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); await fs.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const store = running.store;
  const created = await store.createProject({ name: 'QA 途中刪套裝' });
  const character = structuredClone(created.character);
  character.outfits.sleep = { id: 'sleep', name: '睡衣', equipped: [] };
  await store.updateCharacter(created.id, { baseRevision: created.character.revision, character });
  onFirstReview = async () => {
    const current = await store.getProject(created.id);
    const next = structuredClone(current.character);
    delete next.outfits.sleep;
    await store.updateCharacter(created.id, { baseRevision: current.character.revision, character: next });
  };
  const response = await fetch(`${running.url}/api/projects/${created.id}/autopilot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ views: [], variants: 1, outfitId: 'sleep', maxRedraws: 0 }) });
  assert.equal(response.status, 200);
  const adopted = await waitFor(async () => { const current = await store.getProject(created.id); return (current.character.adopted.character || ['failed', 'paused', 'needs-you', 'stopped'].includes(current.autopilot?.status)) && current; }, { timeout: 15000, label: '代為採用' });
  await fetch(`${running.url}/api/projects/${created.id}/autopilot/stop`, { method: 'POST' });
  assert.ok(adopted.character.adopted.character, JSON.stringify(adopted.autopilot));
  const codes = adopted.autopilot.log.map((entry) => entry.code);
  assert.ok(codes.includes('outfitRemoved') && !codes.includes('redraw') && !codes.includes('gaveUp'), codes.join(','));
  assert.ok(!adopted.autopilot.redoNotes?.front, '不留那批的修正說明');
  const [first, second] = adopted.jobs.filter((job) => job.autopilotId);
  assert.equal(first.outfitId, 'sleep');
  assert.equal(second.outfitId, 'combat');
  assert.doesNotMatch(second.prompt, /釦子/, '說明不會帶到別套');
});

test('正式立繪那套不能刪：存檔拿掉它（Ctrl＋Z、AI 提案）時核心放回原位並提示；直接把正式立繪換成刪掉的套裝畫的圖也不行', async (t) => {
  const { store, id, main, draw } = await withOutfits(t);
  let state = await store.getProject(id);
  const order = Object.keys(state.character.outfits);
  // Ctrl＋Z 退到新增主要那套之前（或任何拿掉它的存檔）：放回原位，其他改動照存。
  const edited = structuredClone(state.character);
  delete edited.outfits.combat;
  edited.outfits.sleep.name = '睡衣二號';
  const saved = await store.updateCharacter(id, { baseRevision: state.character.revision, character: edited });
  assert.equal(saved.notice, 'MAIN_OUTFIT_KEPT');
  assert.deepEqual(Object.keys(saved.character.outfits), order, '放回原本的位置');
  assert.equal(saved.character.outfits.sleep.name, '睡衣二號', '其他改動照存');
  assert.equal(mainOutfitId(saved), 'combat');
  assert.ok(!saved.syncTargets.includes('character'));
  // 沒拿掉時不提示。
  assert.equal((await store.updateCharacter(id, { baseRevision: saved.character.revision, character: structuredClone(saved.character) })).notice, undefined);
  // AI 提案拿掉主要那套：一樣放回去。
  state = await store.getProject(id);
  const proposed = structuredClone(state.character);
  delete proposed.outfits.combat;
  const proposal = await store.saveProposal(id, { baseRevision: state.character.revision, character: proposed });
  state = await store.acceptProposal(id, proposal.id, { baseRevision: state.character.revision });
  assert.ok(state.character.outfits.combat, '提案拿掉的主要那套放回去');
  assert.equal(state.notice, 'MAIN_OUTFIT_KEPT', '套用提案也提示');
  // 直接改設定把正式立繪換成刪掉的套裝畫的圖：擋下來。
  const variant = await draw('sleep');
  state = await store.getProject(id);
  const withoutSleep = structuredClone(state.character);
  delete withoutSleep.outfits.sleep;
  state = await store.updateCharacter(id, { baseRevision: state.character.revision, character: withoutSleep });
  const swap = structuredClone(state.character);
  swap.adopted.character = variant.asset.id;
  await assert.rejects(store.updateCharacter(id, { baseRevision: state.character.revision, character: swap }), { code: 'OUTFIT_REMOVED' });
  assert.equal((await store.getProject(id)).character.adopted.character, main.id);
});

test('還沒有正式立繪時畫了新套裝並採用，再 Ctrl＋Z 退到新增那套之前：那套是正式立繪那套了，核心放回去', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-wardrobe-undo-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const created = await store.createProject({ name: '退回新增之前' });
  const before = structuredClone(created.character);
  const added = structuredClone(created.character);
  added.outfits.casual = { id: 'casual', name: '便服', equipped: [] };
  let state = await store.updateCharacter(created.id, { baseRevision: created.character.revision, character: added });
  const job = await store.createJob(created.id, { targetId: 'character', prompt: '立繪', kind: 'generate', outfitId: 'casual', baseRevision: state.character.revision });
  const { candidate } = await store.addAsset(created.id, { buffer: uniquePng(), mimeType: 'image/png', targetId: 'character', jobId: job.id });
  state = await store.acceptCandidate(created.id, candidate.id, { baseRevision: state.character.revision });
  assert.equal(mainOutfitId(state), 'casual');
  // 草稿退回加便服之前的樣子（adopted 照目前的）。
  const undone = { ...before, adopted: state.character.adopted, revision: state.character.revision };
  const saved = await store.updateCharacter(created.id, { baseRevision: state.character.revision, character: undone });
  assert.equal(saved.notice, 'MAIN_OUTFIT_KEPT');
  assert.ok(saved.character.outfits.casual);
  assert.equal(mainOutfitId(saved), 'casual');
});

test('刪掉套裝後，那套選著時畫的裝備圖照樣在角色庫提醒；把套裝放回去的共用規則', async (t) => {
  const { store, id, draw } = await withOutfits(t);
  let state = await store.getProject(id);
  const character = structuredClone(state.character);
  character.components.pjtop = { id: 'pjtop', name: '睡衣上衣', kind: 'garment', description: '條紋', designStatus: 'draft' };
  character.outfits.sleep.equipped.push({ id: 'wear-pj', componentId: 'pjtop', anchor: '上身', enabled: true });
  character.palette = [{ id: 'sw1', name: '藍', hex: '#3355AA' }];
  character.outfits.sleep.spec = { ...character.outfits.sleep.spec, colors: ['sw1'] };
  state = await store.updateCharacter(id, { baseRevision: state.character.revision, character });
  const part = await store.createJob(id, { targetId: 'pjtop', prompt: '畫上衣', kind: 'generate', outfitId: 'sleep', baseRevision: state.character.revision });
  await store.addAsset(id, { buffer: uniquePng(), mimeType: 'image/png', targetId: 'pjtop', jobId: part.id });
  await draw('sleep');
  const count = async () => (await store.listProjects()).find((item) => item.id === id).attentionCount;
  assert.equal(await count(), 2, '裝備圖＋睡衣的立繪');
  state = await store.getProject(id);
  const removed = structuredClone(state.character);
  const sleep = removed.outfits.sleep;
  delete removed.outfits.sleep;
  state = await store.updateCharacter(id, { baseRevision: state.character.revision, character: removed });
  assert.equal(await count(), 1, '裝備圖照樣提醒；刪掉那套的立繪不提醒');

  // 共用規則：從存檔紀錄找回最後的樣子，放回原位；之後才拿掉的裝備、色票不帶回來；已經在或滿了不動。
  const snapshot = removedOutfitSnapshot(state, 'sleep');
  assert.deepEqual(snapshot.outfit, sleep);
  assert.equal(snapshot.index, 1);
  assert.equal(removedOutfitSnapshot(state, 'combat'), null, '還在的套裝沒有快照');
  const later = structuredClone(state.character);
  delete later.components.pjtop;
  later.palette = [];
  later.outfits.combat.equipped = later.outfits.combat.equipped.filter((item) => item.componentId !== 'pjtop');
  assert.equal(restoreOutfit(later, 'sleep', snapshot.outfit, snapshot.index), true);
  assert.deepEqual(Object.keys(later.outfits), ['combat', 'sleep']);
  assert.deepEqual(later.outfits.sleep.equipped, []);
  assert.deepEqual(later.outfits.sleep.spec.colors, []);
  validateCharacter(later, state.assets.map((asset) => asset.id));
  assert.equal(restoreOutfit(later, 'sleep', snapshot.outfit, 0), false, '已經在就不動');
  const crowded = { outfits: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`o${index}`, { id: `o${index}`, name: '', equipped: [] }])), components: {}, palette: [] };
  assert.equal(restoreOutfit(crowded, 'sleep', snapshot.outfit), false, '滿 100 套不動');
});

test('正式立繪沒記穿搭（範例角色、匯入的圖）：主要那套是第一套，核心一樣不讓它被拿掉', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-wardrobe-nooutfit-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const created = await store.createProject({ name: '匯入的立繪' });
  let state = (await store.importMainImage(created.id, { buffer: uniquePng(), mimeType: 'image/png', name: '設定稿.png', baseRevision: created.character.revision })).project;
  assert.equal(state.assets.find((asset) => asset.id === state.character.adopted.character).outfitId, undefined);
  const character = structuredClone(state.character);
  character.outfits.casual = { id: 'casual', name: '便服', equipped: [] };
  state = await store.updateCharacter(created.id, { baseRevision: state.character.revision, character });
  assert.equal(mainOutfitId(state), 'combat');
  const removed = structuredClone(state.character);
  delete removed.outfits.combat;
  const saved = await store.updateCharacter(created.id, { baseRevision: state.character.revision, character: removed });
  assert.equal(saved.notice, 'MAIN_OUTFIT_KEPT');
  assert.deepEqual(Object.keys(saved.character.outfits), ['combat', 'casual']);
  assert.equal(mainOutfitId(saved), 'combat');
  assert.equal(outfitPortraitId(saved, 'casual'), null, '便服的衣櫃不會被正式立繪佔走');
});
