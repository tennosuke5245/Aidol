import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../server/store.mjs';
import { appearanceLines, compileBrief } from '../shared/prompt-compiler.mjs';
import { newCharacter } from '../shared/domain.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');

test('繪風參考：工作說明標出每張圖的用途，畫法以繪風參考為準，舊立繪只管長相', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-style-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const project = await store.createProject({ name: '繪風測試' });
  const first = await store.createJob(project.id, { targetId: 'character', prompt: '整體立繪', kind: 'generate', baseRevision: 1 });
  const { candidate } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: first.id, name: '舊畫法立繪' });
  const adopted = await store.acceptCandidate(project.id, candidate.id, { baseRevision: 1 });
  const { asset: reference } = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', role: 'reference', name: 'd1.jpg' });
  const character = structuredClone(adopted.character);
  character.style.references.push({ id: 'ref-style', assetId: reference.id, role: 'style', focus: ['線條、人物風格'] });
  const saved = await store.updateCharacter(project.id, { baseRevision: adopted.character.revision, character });
  const job = await store.createJob(project.id, { targetId: 'character', prompt: '照繪風參考重畫', kind: 'generate', baseRevision: saved.character.revision });
  const instructions = await fs.readFile(job.context.instructionsPath, 'utf8');
  assert.match(instructions, /- 繪風參考：要參考它的「線條、人物風格」，這次的畫法以它為準｜d1\.jpg/, '繪風參考排在最前面並標出用途');
  assert.match(instructions, /- 目前的正式立繪：只用來確認角色長相、髮型、服裝與配色，不要沿用它的畫法｜舊畫法立繪/);
  assert.match(instructions, /畫法（線條、上色、陰影、五官與人物的畫法）以「繪風參考」為準/);
  assert.match(instructions, /不要拿舊畫法的圖做局部修改/);
  assert.doesNotMatch(instructions, /依據 input\.yaml 保持角色辨識特徵與繪風/, '有繪風參考時不再要求沿用舊繪風');
  assert.doesNotMatch(job.context.compiledPrompt || '', /clean Japanese anime illustration/, '英文描述不再寫死通用動畫風');
  assert.match(job.handoffPrompt, /繪風參考：d1\.jpg（線條、人物風格）。畫法以繪風參考為準/);
  assert.deepEqual(job.context.styleReferences.map(item => [item.name, item.role, item.focus]), [['d1.jpg', 'style', ['線條、人物風格']]]);
  // 沒有繪風參考的角色維持原本的說法。
  const plain = await store.createProject({ name: '沒有參考' });
  const plainJob = await store.createJob(plain.id, { targetId: 'character', prompt: '整體立繪', kind: 'generate', baseRevision: 1 });
  assert.match(await fs.readFile(plainJob.context.instructionsPath, 'utf8'), /依據 input\.yaml 保持角色辨識特徵與繪風/);
});

test('外觀有沒有改過只看角色長相那幾行；加繪風參考或改標題不會被當成外觀改過', () => {
  const character = newCharacter('look', '外觀');
  character.dna = { body: { build: 'slim' }, hair: { style: 'bob', color: 'silver' }, face: { eyeShape: 'round' } };
  const before = compileBrief(character).text;
  const withStyle = structuredClone(character);
  withStyle.style.references = [{ id: 'ref', assetId: 'asset', role: 'style', focus: ['線條'] }];
  const after = compileBrief(withStyle).text;
  assert.notEqual(before, after, '整段描述因為繪風參考而不同');
  assert.equal(appearanceLines(after), appearanceLines(before), '但長相那幾行一樣');
  const oldHeading = before.replace('（AIDOL 編譯；角色長相以文字設定為準）', '（AIDOL 編譯；文字設定優先）');
  assert.equal(appearanceLines(oldHeading), appearanceLines(before), '舊工作的標題寫法也比得起來');
  const changed = structuredClone(character);
  changed.dna.hair.style = 'long-straight';
  assert.notEqual(appearanceLines(compileBrief(changed).text), appearanceLines(before), '改了髮型就算外觀改過');
});
