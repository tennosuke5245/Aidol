import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
import { registerCodexRoutes } from '../server/integrations.mjs';
import { newCharacter, validateCharacter } from '../shared/domain.mjs';
import { canonBaseline, canonChanges, canonReferences } from '../shared/canon.mjs';
import { firstImagePrompt } from '../shared/image-start.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');

async function storeWithCanon(t, { canon = true } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-canon-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const project = await store.createProject({ name: '定稿測試' });
  const { asset } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', role: 'reference', name: 'old-sheet.png' });
  const character = structuredClone((await store.getProject(project.id)).character);
  character.style.references.push({ id: 'ref-sheet', assetId: asset.id, role: 'identity', focus: ['外觀'], ...(canon ? { canon: true } : {}) });
  const saved = await store.updateCharacter(project.id, { baseRevision: character.revision, character });
  return { store, project: saved, asset };
}

test('定稿旗標：character.yaml 接受布林值，其他型別會被擋', () => {
  const character = newCharacter('canon-schema', '定稿');
  character.style.references.push({ id: 'ref', assetId: 'asset', role: 'identity', focus: [], canon: true });
  assert.equal(validateCharacter(structuredClone(character), ['asset']).style.references[0].canon, true);
  character.style.references[0].canon = 'yes';
  assert.throws(() => validateCharacter(character, ['asset']), { code: 'INVALID_CHARACTER' });
});

test('這次要改：只列定稿之後才改的外觀設定；定稿前的改動、人設與部件狀態不算，穿搭只看這次那套', () => {
  const v1 = newCharacter('canon-diff', '定稿');
  v1.dna = { hair: { color: 'black' } };
  const outfitId = Object.keys(v1.outfits)[0];
  const v2 = structuredClone(v1); v2.revision = 2;
  v2.style.references.push({ id: 'ref', assetId: 'asset', role: 'identity', focus: [], canon: true });
  const v3 = structuredClone(v2); v3.revision = 3;
  v3.dna.hair.color = 'silver';
  v3.persona.description = '改了故事';
  v3.outfits.other = { id: 'other', name: '便服', equipped: [] };
  const history = [v1, v2, v3].map((character) => ({ revision: character.revision, character }));
  assert.equal(canonBaseline(history, v3), v2, '定稿那一版是基準');
  const changes = canonChanges(history, v3, { outfitId });
  assert.deepEqual(changes.map((change) => change.areaKey), ['dna'], `只列外觀：${JSON.stringify(changes)}`);
  assert.match(`${changes[0].label}：${changes[0].from} → ${changes[0].to}`, /^髮色：\S*黑 → 銀/);
  assert.deepEqual(canonChanges(history, v2), [], '剛定稿時沒有要改的');
  // 取消定稿再重新定稿：基準從重新定稿那一版算起。
  const v4 = structuredClone(v3); v4.revision = 4; delete v4.style.references[0].canon;
  const v5 = structuredClone(v4); v5.revision = 5; v5.style.references[0].canon = true;
  assert.equal(canonBaseline([...history, { revision: 4, character: v4 }, { revision: 5, character: v5 }], v5), v5);
  assert.equal(canonReferences(v4).length, 0);
});

test('有定稿時，工作說明照使用者驗證過的寫法：定稿排第一、禁止變更設定、只改視角姿勢排版', async (t) => {
  const { store, project } = await storeWithCanon(t);
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫三視圖', kind: 'generate', baseRevision: project.character.revision });
  const instructions = await fs.readFile(job.context.instructionsPath, 'utf8');
  const inputs = instructions.split('## 固定輸入')[1];
  assert.match(inputs.trim().split('\n')[0], /^- 定稿：照這張畫。髮型、五官、服裝、配色、配件與頭身比例都以它為準，不得變更｜old-sheet\.png/);
  assert.match(instructions, /以「定稿」為準，禁止變更任何設定/);
  assert.match(instructions, /只改變本次要求的視角、姿勢與排版/);
  assert.match(instructions, /長相以定稿圖為準，input\.yaml 與下面的文字設定只補充定稿上看不到的部分/);
  assert.match(instructions, /不得新增定稿沒有的配件、花紋或裝飾/);
  assert.doesNotMatch(instructions, /尚未指定的結構先提出設計/, '有定稿時不再請 AI 自己補設計');
  assert.doesNotMatch(instructions, /除了以下改動/, '剛定稿時沒有例外');
  assert.match(job.handoffPrompt, /有定稿：設計照定稿/);
  assert.equal(job.context.styleReferences[0].canon, true);
});

test('定稿之後改了外觀：工作說明列成「除了以下改動，其他全部照定稿」', async (t) => {
  const { store, project } = await storeWithCanon(t);
  const character = structuredClone(project.character);
  character.dna = { ...(character.dna || {}), hair: { ...(character.dna?.hair || {}), color: 'silver' } };
  const saved = await store.updateCharacter(project.id, { baseRevision: character.revision, character });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '畫三視圖', kind: 'generate', baseRevision: saved.character.revision });
  const instructions = await fs.readFile(job.context.instructionsPath, 'utf8');
  assert.match(instructions, /除了以下改動，其他全部照定稿：\n- 髮色：.* → 銀/);
});

test('沒有定稿（只是參考）時，工作說明維持原本的說法', async (t) => {
  const { store, project } = await storeWithCanon(t, { canon: false });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '整體立繪', kind: 'generate', baseRevision: project.character.revision });
  const instructions = await fs.readFile(job.context.instructionsPath, 'utf8');
  assert.match(instructions, /- 角色特徵參考：要參考它的「外觀」｜old-sheet\.png/);
  assert.match(instructions, /尚未指定的結構先提出設計/);
  assert.match(instructions, /角色長相以文字設定為準/);
  assert.doesNotMatch(instructions, /照定稿|以「定稿」|定稿：|有定稿/);
  assert.equal(job.context.styleReferences[0].canon, undefined);
});

test('第一張圖的預設要求：有定稿時寫明照定稿、不改設計', () => {
  const character = newCharacter('canon-first', '羽');
  assert.doesNotMatch(firstImagePrompt(character), /照定稿/);
  character.style.references.push({ id: 'ref', assetId: 'asset', role: 'identity', focus: [], canon: true });
  assert.match(firstImagePrompt(character), /照定稿為「羽」.*不改髮型、五官、服裝與配色/);
});

test('交給 Codex App 的短提示也寫出「這次有定稿」', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-canon-http-'));
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client: { close() {} }, version: async () => 'test' }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const project = await running.store.createProject({ name: '定稿交接' });
  const { asset } = await running.store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', role: 'reference', name: 'sheet.png' });
  const character = structuredClone((await running.store.getProject(project.id)).character);
  character.style.references.push({ id: 'ref', assetId: asset.id, role: 'identity', focus: [], canon: true });
  const saved = await running.store.updateCharacter(project.id, { baseRevision: character.revision, character });
  const job = await running.store.createJob(project.id, { targetId: 'character', prompt: '畫三視圖', kind: 'generate', baseRevision: saved.character.revision });
  const response = await fetch(`${running.url}/api/projects/${project.id}/jobs/${job.id}/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200, await response.clone().text());
  assert.match((await response.json()).prompt, /這次有定稿：設計照定稿，不要改。/);
});
