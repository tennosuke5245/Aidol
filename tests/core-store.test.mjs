import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { ProjectStore, portableTextScrubber } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
import { registerCodexRoutes } from '../server/integrations.mjs';
import { characterYaml, parseCharacterYaml, newCharacter } from '../shared/domain.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRncAAAAASUVORK5CYII=', 'base64');

async function setup(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-test-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: false }).init();
  const project = await store.createProject({ name: '測試角色', brief: '沉著的信使' });
  return { dataDir, store, project };
}

function entries(zip) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'ZIP 應有完整結尾');
  const count = zip.readUInt16LE(end + 10);
  let central = zip.readUInt32LE(end + 16);
  const result = {};
  for (let index = 0; index < count; index++) {
    assert.equal(zip.readUInt32LE(central), 0x02014b50);
    const method = zip.readUInt16LE(central + 10);
    const size = zip.readUInt32LE(central + 20);
    const nameLength = zip.readUInt16LE(central + 28);
    const extraLength = zip.readUInt16LE(central + 30);
    const commentLength = zip.readUInt16LE(central + 32);
    const local = zip.readUInt32LE(central + 42);
    const name = zip.toString('utf8', central + 46, central + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const compressed = zip.subarray(start, start + size);
    result[name] = method === 8 ? inflateRawSync(compressed) : compressed;
    central += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

test('YAML 嚴格驗證、未知參照與重複欄位', () => {
  const character = newCharacter('example', '角色');
  assert.deepEqual(parseCharacterYaml(characterYaml(character), []), character);
  character.outfits.combat.equipped.push({ id: 'missing-worn', componentId: 'missing', anchor: '胸前', enabled: true });
  assert.throws(() => parseCharacterYaml(characterYaml(character), []), { code: 'UNKNOWN_COMPONENT' });
  assert.throws(() => parseCharacterYaml('name: 一\nname: 二'), { code: 'INVALID_YAML' });
  character.outfits.combat.equipped = [];
  character.style.references.push({ id: 'reference-one', assetId: 'absent', role: 'style', focus: ['線稿'] });
  assert.throws(() => parseCharacterYaml(characterYaml(character), []), { code: 'UNKNOWN_ASSET' });
});

test('角色草案只保存使用者描述；YAML 是權威來源且重開保留', async (t) => {
  const { store, project, dataDir } = await setup(t);
  assert.equal(project.character.persona.description, '沉著的信使');
  assert.deepEqual(project.character.components, {});
  assert.equal(project.assets.length, 0);
  const yaml = await fs.readFile(path.join(store.projectDir(project.id), 'character.yaml'), 'utf8');
  assert.equal(parseCharacterYaml(yaml).id, project.id);
  const reopened = await new ProjectStore({ dataDir, demo: false }).init();
  assert.equal((await reopened.getProject(project.id)).character.name, '測試角色');
});

test('並行修改只有一個通過 CAS；衝突不覆寫資料', async (t) => {
  const { store, project } = await setup(t);
  const first = structuredClone(project.character);
  const second = structuredClone(project.character);
  first.name = '版本一'; second.name = '版本二';
  const outcomes = await Promise.allSettled([
    store.updateCharacter(project.id, { baseRevision: 1, character: first }),
    store.updateCharacter(project.id, { baseRevision: 1, character: second }),
  ]);
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((item) => item.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal((await store.getProject(project.id)).character.revision, 2);
});

test('候選不跨部件工作、不覆寫圖檔；用較早設定畫的圖照樣可以採用', async (t) => {
  const { store, project } = await setup(t);
  const character = structuredClone(project.character);
  character.components.coat = { id: 'coat', name: '外套', kind: 'garment', description: '深藍外套', designStatus: 'draft' };
  const updated = await store.updateCharacter(project.id, { baseRevision: 1, character });
  const job = await store.createJob(project.id, { targetId: 'coat', prompt: '收窄袖口', kind: 'refine', baseRevision: 2 });
  await assert.rejects(store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'character', jobId: job.id }), { code: 'JOB_TARGET_MISMATCH' });
  const first = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'coat', jobId: job.id });
  const second = await store.addAsset(project.id, { buffer: png, mimeType: 'image/png', targetId: 'coat', jobId: job.id });
  assert.notEqual(first.asset.id, second.asset.id);
  assert.deepEqual((await store.readAsset(project.id, first.asset.id)).buffer, png);
  assert.equal((await store.getProject(project.id)).character.adopted.coat, undefined);
  const newer = structuredClone(updated.character);
  newer.persona.description = '新的背景描述';
  await store.updateCharacter(project.id, { baseRevision: 2, character: newer });
  const persisted = await store.getProject(project.id);
  assert.equal(persisted.candidates[0].status, 'pending', '設定改版不把畫好的圖鎖住');
  assert.equal(persisted.candidates[0].olderSettings, true);
  assert.equal(job.context.yaml, await fs.readFile(job.context.snapshotPath, 'utf8'));
  assert.equal(parseCharacterYaml(job.context.yaml).revision, 2);
  await assert.rejects(store.acceptCandidate(project.id, first.candidate.id, { baseRevision: 2 }), { code: 'REVISION_CONFLICT' });
  const adopted = await store.acceptCandidate(project.id, first.candidate.id, { baseRevision: 3 });
  assert.equal(adopted.character.revision, 4);
  assert.equal(adopted.character.adopted.coat, first.asset.id);
  assert.equal(adopted.character.persona.description, '新的背景描述', '採用圖不改動之後的文字設定');
  const swapped = await store.acceptCandidate(project.id, second.candidate.id, { baseRevision: 4 });
  assert.equal(swapped.character.adopted.coat, second.asset.id);
  const back = await store.acceptCandidate(project.id, first.candidate.id, { baseRevision: 5 });
  assert.equal(back.character.adopted.coat, first.asset.id, '採用過的圖可以再換回來');
});

test('AI 提案寫好後設定又改過，套用時只合併提案改的欄位', async (t) => {
  const { store, project } = await setup(t);
  const draft = await store.saveProposal(project.id, { baseRevision: 1, source: 'codex', summary: '補上個性', character: { ...structuredClone(project.character), persona: { ...project.character.persona, description: 'AI 寫的故事', traits: ['冷靜'] } } });
  const mine = structuredClone(project.character);
  mine.identity = { ...(mine.identity || {}), hair: '使用者改的銀髮' };
  await store.updateCharacter(project.id, { baseRevision: 1, character: mine });
  const merged = await store.acceptProposal(project.id, draft.id, { baseRevision: 2 });
  assert.equal(merged.character.revision, 3);
  assert.equal(merged.character.persona.description, 'AI 寫的故事');
  assert.deepEqual(merged.character.persona.traits, ['冷靜']);
  assert.equal(merged.character.identity.hair, '使用者改的銀髮', '不蓋掉使用者之後的修改');
  assert.equal(merged.proposals.find(item => item.id === draft.id).status, 'accepted');
  await assert.rejects(store.acceptProposal(project.id, draft.id, { baseRevision: 3 }), { code: 'PROPOSAL_CLOSED' });
});

test('採用部件提示整體待同步；歷史恢復不刪圖片或倒退revision', async (t) => {
  const { store, project } = await setup(t);
  const character = structuredClone(project.character);
  character.components.coat = { id: 'coat', name: '外套', kind: 'garment', description: '外套', designStatus: 'draft' };
  await store.updateCharacter(project.id, { baseRevision: 1, character });
  const bodyJob = await store.createJob(project.id, { targetId: 'character', prompt: '整體', baseRevision: 2 });
  const body = await store.addAsset(project.id, { buffer: png, targetId: 'character', jobId: bodyJob.id });
  await store.acceptCandidate(project.id, body.candidate.id, { baseRevision: 2 });
  const coatJob = await store.createJob(project.id, { targetId: 'coat', prompt: '外套', baseRevision: 3 });
  const coat = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: coatJob.id });
  const accepted = await store.acceptCandidate(project.id, coat.candidate.id, { baseRevision: 3 });
  assert.equal(accepted.character.adopted.coat, coat.asset.id);
  assert.deepEqual(accepted.syncTargets, ['character']);
  const restored = await store.restore(project.id, { baseRevision: 4, historyId: accepted.history[2].id });
  assert.equal(restored.character.revision, 5);
  assert.equal(restored.character.adopted.coat, undefined);
  assert.equal(restored.assets.length, 2);
  assert.deepEqual((await store.readAsset(project.id, coat.asset.id)).buffer, png);
});

test('配件停用保留物件；提案採用經過驗證與CAS', async (t) => {
  const { store, project } = await setup(t);
  const character = structuredClone(project.character);
  character.components.clip = { id: 'clip', name: '髮夾', kind: 'accessory', description: '月牙髮夾', designStatus: 'proposed' };
  character.outfits.combat.equipped.push({ id: 'clip-left', componentId: 'clip', anchor: '左瀏海', enabled: true });
  const proposal = await store.saveProposal(project.id, { baseRevision: 1, character });
  assert.equal((await store.getProject(project.id)).character.components.clip, undefined);
  const accepted = await store.acceptProposal(project.id, proposal.id, { baseRevision: 1 });
  accepted.character.outfits.combat.equipped[0].enabled = false;
  const removed = await store.updateCharacter(project.id, { baseRevision: 2, character: accepted.character });
  assert.equal(removed.character.components.clip.name, '髮夾');
  assert.equal(removed.character.outfits.combat.equipped[0].enabled, false);
});

test('拒絕路徑穿越、偽造圖片與變更工作固定輸入', async (t) => {
  const { store, project } = await setup(t);
  await assert.rejects(store.getProject('../outside'), { code: 'INVALID_ID' });
  await assert.rejects(store.addAsset(project.id, { buffer: Buffer.from('<script>bad</script>'), mimeType: 'image/png' }), { code: 'INVALID_IMAGE' });
  const job = await store.createJob(project.id, { prompt: '測試', baseRevision: 1 });
  await assert.rejects(store.updateJob(project.id, job.id, { baseRevision: 10 }), { code: 'INVALID_INPUT' });
  await assert.rejects(store.createJob(project.id, { prompt: '測試', baseRevision: 1, region: { x: 0.9, y: 0, width: 0.5, height: 1 } }), { code: 'INVALID_INPUT' });
});

test('設計包含權威YAML、人設、固定工作輸入與不可覆寫圖片', async (t) => {
  const { store, project } = await setup(t);
  const job = await store.createJob(project.id, { prompt: '產生設定稿', baseRevision: 1 });
  const result = await store.addAsset(project.id, { buffer: png, jobId: job.id });
  const exported = await store.exportProject(project.id);
  const files = entries(exported.buffer);
  assert.equal(parseCharacterYaml(files['character.yaml'].toString()).id, project.id);
  assert.match(files['character.md'].toString(), /沉著的信使/);
  assert.equal(parseCharacterYaml(files[`jobs/${job.id}/input.yaml`].toString()).revision, 1);
  assert.deepEqual(files[`images/${result.asset.id}.png`], png);
  const manifest = JSON.parse(files['manifest.json']);
  assert.equal(manifest.candidates[0].status, 'pending');
});

test('HTTP 匯出另帶有版本的自由畫布與可攜圖片，保留 YAML／工作分離且不攜帶真實交接憑證', async t => {
  const { project, dataDir } = await setup(t);
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: registerCodexRoutes });
  try {
    const store = running.store;
    const { asset } = await store.addAsset(project.id, { buffer: png, name: '自由畫布參考圖', role: 'reference' });
    const job = await store.createJob(project.id, { baseRevision: 1, prompt: '只依正式人設出圖', kind: 'generate' });
    await store.createCanvasAnnotation(project.id, { kind: 'note', text: '便利貼僅供設計討論', tone: 'rose', position: { x: -50, y: 120.5 } });
    await store.createCanvasAnnotation(project.id, { kind: 'text', text: '這段自由說明不加入人物描述', tone: 'neutral', position: { x: 320, y: -60 } });
    await store.createCanvasAnnotation(project.id, { kind: 'reference', assetId: asset.id, title: '自由參考卡', description: '保留圖片與位置，尚未指定為繪風', position: { x: 580, y: 40 } });
    const handedOff = await fetch(`${running.url}/api/projects/${project.id}/jobs/${job.id}/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(handedOff.status, 200);
    const credentials = JSON.parse(await fs.readFile(path.join(store.jobDir(project.id, job.id), 'handoff.json'), 'utf8'));
    assert.match(credentials.token, /^[a-f0-9]{64}$/);
    const response = await fetch(`${running.url}/api/projects/${project.id}/export`);
    assert.equal(response.status, 200);
    const files = entries(Buffer.from(await response.arrayBuffer()));
    const canvas = JSON.parse(files['canvas.json']);
    const saved = await store.getProject(project.id);
    assert.equal(canvas.schemaVersion, 1);
    assert.equal(canvas.projectId, project.id);
    assert.ok(Number.isFinite(Date.parse(canvas.exportedAt)));
    assert.deepEqual(canvas.annotations, saved.canvasAnnotations);
    assert.equal(canvas.assets.length, 1);
    assert.equal(canvas.assets[0].id, asset.id);
    assert.equal(canvas.assets[0].sha256, asset.sha256);
    assert.deepEqual(files[canvas.assets[0].exportedPath], png, '圖卡的 portable path 對應真正圖片位元組');
    assert.equal(canvas.assets[0].url, undefined, '自由畫布不依賴原本的 localhost 圖片網址');
    const manifest = JSON.parse(files['manifest.json']);
    assert.equal(manifest.canvasFile, 'canvas.json');
    assert.equal(manifest.assets.find(item => item.id === asset.id).exportedPath, canvas.assets[0].exportedPath);
    assert.deepEqual(manifest.canvasAnnotations, canvas.annotations);
    assert.equal(files[`jobs/${job.id}/handoff.json`], undefined);
    for (const content of Object.values(files)) assert.ok(!content.includes(credentials.token), 'ZIP 不包含正式 handoff token');
    assert.doesNotMatch(files['character.yaml'].toString(), /便利貼僅供設計討論|這段自由說明|自由參考卡|canvasAnnotations/);
    assert.equal(parseCharacterYaml(files['character.yaml'].toString()).revision, 1);
    assert.equal(files[`jobs/${job.id}/input.yaml`].toString(), job.context.yaml);
    assert.deepEqual(JSON.parse(files[`jobs/${job.id}/job.json`]).context.referenceAssets, [], '自由圖卡不加入工作參考');
  } finally { await running.close(); }
});

test('匯出的設計包不帶本機絕對路徑與本機網址，工作內的路徑改成包內相對路徑', async t => {
  const { project, dataDir } = await setup(t);
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: registerCodexRoutes });
  try {
    const store = running.store;
    const first = await store.createJob(project.id, { baseRevision: 1, prompt: '先畫正式立繪', kind: 'generate' });
    const drawn = await store.addAsset(project.id, { buffer: png, jobId: first.id });
    const accepted = await store.acceptCandidate(project.id, drawn.candidate.id, { baseRevision: 1 });
    // 繪風參考圖的名稱是 Codex 或檔案總管給的，可能就是一條本機路徑
    const style = await store.addAsset(project.id, { buffer: png, name: path.join(os.homedir(), 'Desktop', 'ref.png'), role: 'reference' });
    const character = structuredClone(accepted.character);
    character.style.references.push({ id: 'style-ref', assetId: style.asset.id, role: 'style', focus: ['線稿'] });
    await store.updateCharacter(project.id, { baseRevision: 2, character });
    const job = await store.createJob(project.id, { baseRevision: 3, prompt: '換一件外套', kind: 'refine' });
    assert.ok(job.context.referenceAssets.length > 1 && path.isAbsolute(job.context.referenceAssets[0].path), '本機工作仍用絕對路徑讀參考圖');
    assert.equal(job.context.styleReferences[0].name, path.join(os.homedir(), 'Desktop', 'ref.png'));
    const handedOff = await fetch(`${running.url}/api/projects/${project.id}/jobs/${job.id}/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(handedOff.status, 200);
    const { submitUrl, url: codexUrl } = (await store.getJob(project.id, job.id)).handoff;
    const credentials = JSON.parse(await fs.readFile(path.join(store.jobDir(project.id, job.id), 'handoff.json'), 'utf8'));
    // Codex 回報的失敗訊息：帶著 token、家目錄、工作資料夾、回報網址與 codex 連結
    await store.recordProgress(project.id, job.id, { event: 'failed', message: `token ${credentials.token}；圖存在 ${path.join(os.homedir(), '.codex', 'out.png')} 與 ${store.jobDir(project.id, job.id)}；回報到 ${submitUrl} 失敗；${codexUrl}` });
    const response = await fetch(`${running.url}/api/projects/${project.id}/export`);
    const files = entries(Buffer.from(await response.arrayBuffer()));
    const message = JSON.parse(files[`jobs/${job.id}/job.json`]).failure.message;
    assert.equal(message, `token [token]；圖存在 ${path.join('~', '.codex', 'out.png')} 與 ${path.join('jobs', job.id)}；回報到 [local-url] 失敗；[codex-link]`, '訊息只存前 500 字，codex 連結放最後');
    const locals = [dataDir, await fs.realpath(dataDir), ...(os.homedir().length > 3 ? [os.homedir()] : [])];
    const forms = [...new Set(locals)].flatMap(dir => [dir, JSON.stringify(dir).slice(1, -1), encodeURIComponent(dir), dir.replaceAll('\\', '/')]);
    for (const [name, content] of Object.entries(files)) {
      if (name.startsWith('images/')) continue;
      const text = content.toString();
      for (const form of forms) assert.ok(!text.includes(form), `${name} 不可包含本機路徑 ${form}`);
      assert.ok(!text.includes(credentials.token), `${name} 不可包含交接 token`);
      assert.doesNotMatch(text, /[A-Za-z]:\\\\|\b(?:127\.0\.0\.1|localhost):\d+|codex:\/\//, `${name} 不可包含磁碟路徑、本機網址或 Codex 連結`);
    }
    const exportedJob = JSON.parse(files[`jobs/${job.id}/job.json`]);
    const manifest = JSON.parse(files['manifest.json']);
    assert.equal(exportedJob.context.snapshotPath, `jobs/${job.id}/input.yaml`);
    assert.equal(exportedJob.context.instructionsPath, `jobs/${job.id}/instructions.md`);
    for (const pathInPack of [exportedJob.context.snapshotPath, exportedJob.context.instructionsPath]) assert.ok(files[pathInPack], `${pathInPack} 在包裡找得到`);
    for (const reference of exportedJob.context.referenceAssets) {
      assert.equal(reference.path, manifest.assets.find(item => item.id === reference.id).exportedPath, '參考圖指向包內圖片');
      assert.deepEqual(files[reference.path], png);
      assert.match(files[exportedJob.context.instructionsPath].toString(), new RegExp(`: ${reference.path} \\(`), '工作說明裡的參考圖也指向包內圖片');
    }
    assert.equal(exportedJob.context.styleReferences[0].name, path.join('~', 'Desktop', 'ref.png'), '繪風參考的名稱也清過');
    assert.deepEqual(Object.keys(exportedJob.handoff), ['createdAt'], '交接只留時間，不帶工作區、連結與回報網址');
    assert.match(exportedJob.handoffPrompt, new RegExp(`jobs/${job.id}/input\\.yaml`));
    assert.deepEqual(manifest.jobs.find(item => item.id === job.id), exportedJob, 'manifest 與 job.json 用同一份清理後的工作');
    const local = await store.getJob(project.id, job.id);
    assert.ok(path.isAbsolute(local.context.snapshotPath) && local.handoff.workspace, '匯出不改動本機存檔');
  } finally { await running.close(); }
});

test('匯出清理認得本機路徑的各種寫法，也不誤改一般網址與相似的資料夾名', () => {
  // 假的電腦路徑用 join 組出來，原始碼裡不出現字面路徑（check:oss 會擋）
  const win = (...parts) => parts.join('\\');
  const posix = (...parts) => parts.join('/');
  const home = win('C:', 'Users', 'John Smith');
  const projectDir = win('D:', 'dev', 'aidol', '.aidol', 'projects', 'p1');
  const scrub = portableTextScrubber({ folders: [projectDir, win('D:', 'dev', 'aidol', '.aidol'), posix('', 'x', '.aidol')], home, secrets: ['a'.repeat(64)] });
  const cases = [
    [win('d:', 'dev', 'aidol', '.aidol', 'projects', 'p1', 'jobs', 'j'), win('jobs', 'j')],
    [projectDir.replaceAll('\\', '\\\\') + '\\\\jobs', 'jobs'],
    [posix('/mnt', 'd', 'dev', 'aidol', '.aidol', 'projects', 'p1', 'jobs'), 'jobs'],
    [win('c:', 'Users', 'John Smith', 'Pictures', 'x.png'), win('~', 'Pictures', 'x.png')],
    [home.replaceAll('\\', '\\\\') + '\\\\x.png', '~\\\\x.png'],
    [posix('/mnt', 'c', 'Users', 'John Smith', 'x.png'), '~/x.png'],
    [posix('', 'c', 'Users', 'bob', 'x.png'), '~/x.png'],
    [posix('/mnt', 'c', 'Users', 'bob', 'x.png'), '~/x.png'],
    ['file://localhost' + posix('', 'Users', 'bob', 'x.png'), '~/x.png'],
    [['', 'Users', 'bob', 'x.png'].join('%2F'), '~%2Fx.png'],
    [posix('', 'home', 'alice', 'out.png'), '~/out.png'],
    ['http://127.0.0.1:37445/api/projects/p1/jobs/j/progress 失敗', '[local-url] 失敗'],
    ['codex://new?path=%2Ftmp%2Fx&prompt=hi', '[codex-link]'],
    [`token ${'a'.repeat(64)}`, 'token [token]'],
    ['https://example.com/rootkit 與 https://example.com/home/dashboard', 'https://example.com/rootkit 與 https://example.com/home/dashboard'],
    [posix('', 'x', '.aidol-old', 'y'), posix('', 'x', '.aidol-old', 'y')],
    [posix('', 'x', '.aidol', 'y'), 'y'],
    // %20 與整段 URL 編碼的寫法
    ['file:///' + posix('C:', 'Users', 'John%20Smith', 'Pictures', 'x.png'), 'file:///~/Pictures/x.png'],
    [encodeURIComponent(win('C:', 'Users', 'John Smith', 'AppData', 'x')), '~%5CAppData%5Cx'],
    ['file:///' + posix('C:', 'Users', 'Jane%20Doe', 'x.png'), '~/x.png'],
    // 沒寫 http 的本機位址、WSL 網路路徑、macOS 外接磁碟、/var/home
    ['127.0.0.1:37445/api/x 失敗', '[local-url] 失敗'],
    [win('', '', 'wsl.localhost', 'Ubuntu', 'home', 'bob', 'x.png'), '~\\x.png'],
    [posix('', 'Volumes', 'Macintosh HD', 'Users', 'bob', 'x.png'), '~/x.png'],
    [posix('', 'var', 'home', 'bob', 'x.png'), '~/x.png'],
  ];
  for (const [input, expected] of cases) assert.equal(scrub(input), expected, input);
  // 邊界認得中日文字
  const cjk = portableTextScrubber({ folders: [posix('', 'data', '角色')], home: posix('', 'home', '小明') });
  assert.equal(cjk(posix('', 'data', '角色備份', 'x')), posix('', 'data', '角色備份', 'x'));
  assert.equal(cjk(posix('', 'data', '角色', 'x')), 'x');
  assert.equal(cjk(posix('', 'home', '小明', 'x')), '~/x');
});

test('資料夾搬過家後匯出：工作路徑仍是包內路徑，舊位置也不會帶出去', async (t) => {
  const { store, project } = await setup(t);
  const job = await store.createJob(project.id, { prompt: '搬家前建立的工作', baseRevision: 1 });
  // 模擬整個資料夾從別台電腦搬過來：存檔裡記的仍是舊位置
  const oldProject = path.join(path.parse(os.tmpdir()).root, 'old-machine', 'aidol-data', 'projects', project.id);
  const metadataFile = path.join(store.projectDir(project.id), 'project.json');
  const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
  const saved = metadata.jobs.find((item) => item.id === job.id);
  const moved = (file) => path.join(oldProject, path.relative(store.projectDir(project.id), file));
  saved.handoffPrompt = saved.handoffPrompt.split(saved.context.snapshotPath).join(moved(saved.context.snapshotPath)).split(saved.context.instructionsPath).join(moved(saved.context.instructionsPath));
  saved.context.snapshotPath = moved(saved.context.snapshotPath);
  saved.context.instructionsPath = moved(saved.context.instructionsPath);
  saved.failure = { at: saved.createdAt, message: `讀不到 ${path.join(oldProject, 'assets', 'x.png')}` };
  await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2));
  const files = entries((await store.exportProject(project.id)).buffer);
  const exported = JSON.parse(files[`jobs/${job.id}/job.json`]);
  assert.equal(exported.context.snapshotPath, `jobs/${job.id}/input.yaml`);
  assert.equal(exported.context.instructionsPath, `jobs/${job.id}/instructions.md`);
  assert.equal(exported.failure.message, `讀不到 ${path.join('assets', 'x.png')}`);
  for (const [name, content] of Object.entries(files)) if (!name.startsWith('images/')) assert.ok(!content.toString().includes('old-machine'), `${name} 不帶舊位置`);
});

test('中斷於transaction journal後重開會完成一致寫入', async (t) => {
  const { store, project, dataDir } = await setup(t);
  const next = structuredClone(project);
  next.character.name = '恢復後角色';
  next.name = next.character.name;
  next.character.revision = 2;
  await fs.writeFile(path.join(store.projectDir(project.id), 'pending.json'), JSON.stringify(next));
  const reopened = await new ProjectStore({ dataDir, demo: false }).init();
  const recovered = await reopened.getProject(project.id);
  assert.equal(recovered.character.name, '恢復後角色');
  assert.equal(recovered.character.revision, 2);
  await assert.rejects(fs.access(path.join(store.projectDir(project.id), 'pending.json')));
});

test('範例圖片晚到仍可凍結，來源後續變更不影響採用稿與工作快照', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-demo-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const assetDir = path.join(dataDir, 'source-images');
  await fs.mkdir(assetDir);
  const store = await new ProjectStore({ dataDir, assetDir }).init();
  assert.equal((await store.getProject('rin')).assets[0].url, '/assets/rin-sheet.png');
  await fs.writeFile(path.join(assetDir, 'rin-sheet.png'), png);
  await fs.writeFile(path.join(assetDir, 'rin-hair.png'), png);
  await fs.writeFile(path.join(assetDir, 'rin-clasp.png'), png);
  await fs.writeFile(path.join(assetDir, 'rin-coat.png'), png);
  await fs.writeFile(path.join(assetDir, 'rin-pants.png'), png);
  await fs.writeFile(path.join(assetDir, 'rin-boots.png'), png);
  const hydrated = await store.getProject('rin');
  assert.equal(hydrated.assets[0].url, '/api/projects/rin/assets/demo-rin-sheet');
  await fs.writeFile(path.join(assetDir, 'rin-sheet.png'), Buffer.from('來源已改變'));
  assert.deepEqual((await store.readAsset('rin', 'demo-rin-sheet')).buffer, png);
  const job = await store.createJob('rin', { targetId: 'character', prompt: '保留目前設定稿', baseRevision: 1 });
  assert.deepEqual(await fs.readFile(job.context.referenceAssets.find((asset) => asset.id === 'demo-rin-sheet').path), png);
});

test('多套穿搭工作必須明確選擇，固定選中穿搭及enabled部件參考', async (t) => {
  const { store, project } = await setup(t);
  const character = structuredClone(project.character);
  character.components.coat = { id: 'coat', name: '外套', kind: 'garment', description: '外套', designStatus: 'draft' };
  character.outfits.combat.equipped = [{ id: 'coat-worn', componentId: 'coat', anchor: '軀幹', enabled: true }];
  await store.updateCharacter(project.id, { baseRevision: 1, character });
  const coatJob = await store.createJob(project.id, { targetId: 'coat', prompt: '建立外套', baseRevision: 2 });
  const coat = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: coatJob.id });
  const adopted = await store.acceptCandidate(project.id, coat.candidate.id, { baseRevision: 2 });
  adopted.character.outfits.casual = { id: 'casual', name: '休閒\n穿搭', equipped: [{ id: 'coat-unused', componentId: 'coat', anchor: '軀幹', enabled: false }] };
  await store.updateCharacter(project.id, { baseRevision: 3, character: adopted.character });
  await assert.rejects(store.createJob(project.id, { prompt: '全身稿', baseRevision: 4 }), { code: 'MISSING_OUTFIT' });
  await assert.rejects(store.createJob(project.id, { prompt: '全身稿', baseRevision: 4, outfitId: 'absent' }), { code: 'UNKNOWN_OUTFIT' });
  const casual = await store.createJob(project.id, { prompt: '休閒全身稿', baseRevision: 4, outfitId: 'casual' });
  assert.equal(casual.outfitId, 'casual');
  assert.equal(casual.context.selectedOutfit.equipped[0].enabled, false);
  assert.equal(casual.context.referenceAssets.some((asset) => asset.id === coat.asset.id), false);
  assert.match(casual.context.yaml, /其他穿搭僅供背景參考/);
  assert.equal(parseCharacterYaml(casual.context.yaml).revision, 4);
  const combat = await store.createJob(project.id, { prompt: '戰鬥全身稿', baseRevision: 4, outfitId: 'combat' });
  assert.ok(combat.context.referenceAssets.some((asset) => asset.id === coat.asset.id));
  const output = await store.addAsset(project.id, { buffer: png, jobId: casual.id });
  assert.equal(output.asset.outfitId, 'casual');
  assert.equal(output.candidate.outfitId, 'casual');
  await assert.rejects(store.updateJob(project.id, casual.id, { outfitId: 'combat' }), { code: 'INVALID_INPUT' });
});

test('描述保存不可使主圖/視角與採用稿分歧；尚未採用的草案仍可引用素材', async (t) => {
  const { store, project } = await setup(t);
  const character = structuredClone(project.character);
  character.components.coat = { id: 'coat', name: '外套', kind: 'garment', description: '外套', designStatus: 'draft' };
  await store.updateCharacter(project.id, { baseRevision: 1, character });
  const job = await store.createJob(project.id, { targetId: 'coat', prompt: '建立外套', baseRevision: 2 });
  const first = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: job.id });
  const second = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: job.id });
  const draft = (await store.getProject(project.id)).character;
  draft.components.coat.assetId = first.asset.id;
  draft.components.coat.views = { front: first.asset.id };
  await store.updateCharacter(project.id, { baseRevision: 2, character: draft });
  const fresh = await store.createJob(project.id, { targetId: 'coat', prompt: '確認外套', baseRevision: 3 });
  const freshOutput = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: fresh.id });
  const accepted = await store.acceptCandidate(project.id, freshOutput.candidate.id, { baseRevision: 3 });
  assert.equal(accepted.character.components.coat.views.front, freshOutput.asset.id);
  const staleComponent = structuredClone(accepted.character);
  staleComponent.components.coat.assetId = second.asset.id;
  await assert.rejects(store.updateCharacter(project.id, { baseRevision: 4, character: staleComponent }), { code: 'ADOPTED_ASSET_MISMATCH' });
  const staleView = structuredClone(accepted.character);
  staleView.components.coat.views.front = first.asset.id;
  await assert.rejects(store.updateCharacter(project.id, { baseRevision: 4, character: staleView }), { code: 'ADOPTED_ASSET_MISMATCH' });
  assert.equal((await store.getProject(project.id)).character.revision, 4);
});

test('先採用細節仍無主圖；後續正面與背面分別保存且新工作帶入全部視角', async (t) => {
  const { store, project } = await setup(t);
  const character = structuredClone(project.character);
  character.components.coat = { id: 'coat', name: '外套', kind: 'garment', description: '深藍外套', designStatus: 'proposed' };
  character.outfits.combat.equipped = [{ id: 'coat-worn', componentId: 'coat', anchor: '軀幹', enabled: true }];
  await store.updateCharacter(project.id, { baseRevision: 1, character });
  const bodyJob = await store.createJob(project.id, { prompt: '整體角色', baseRevision: 2 });
  const body = await store.addAsset(project.id, { buffer: png, jobId: bodyJob.id });
  await store.acceptCandidate(project.id, body.candidate.id, { baseRevision: 2 });

  const detailJob = await store.createJob(project.id, { targetId: 'coat', prompt: '袖口特寫', kind: 'expand', outputView: 'detail', baseRevision: 3 });
  assert.equal(detailJob.outputView, 'detail');
  assert.match(detailJob.context.yaml, /view：detail/);
  assert.match(await fs.readFile(detailJob.context.instructionsPath, 'utf8'), /只保存對應視角，不取代部件主圖/);
  await assert.rejects(store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: detailJob.id, view: 'front' }), { code: 'ASSET_VIEW_MISMATCH' });
  const detail = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: detailJob.id });
  assert.equal(detail.asset.view, 'detail');
  assert.equal(detail.candidate.view, 'detail');
  const detailAccepted = await store.acceptCandidate(project.id, detail.candidate.id, { baseRevision: 3 });
  assert.equal(detailAccepted.character.adopted.coat, undefined);
  assert.equal(detailAccepted.character.components.coat.assetId, undefined);
  assert.equal(detailAccepted.character.components.coat.designStatus, 'proposed');
  assert.equal(detailAccepted.character.components.coat.views.detail, detail.asset.id);
  assert.ok(detailAccepted.syncTargets.includes('character'));

  const frontJob = await store.createJob(project.id, { targetId: 'coat', prompt: '整件外套正面', outputView: 'front', baseRevision: 4 });
  assert.ok(frontJob.context.referenceAssets.some((asset) => asset.id === detail.asset.id));
  const front = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: frontJob.id });
  const frontAccepted = await store.acceptCandidate(project.id, front.candidate.id, { baseRevision: 4 });
  assert.equal(frontAccepted.character.adopted.coat, front.asset.id);
  assert.equal(frontAccepted.character.components.coat.assetId, front.asset.id);
  assert.equal(frontAccepted.character.components.coat.designStatus, 'confirmed');
  assert.equal(frontAccepted.character.components.coat.views.detail, detail.asset.id);

  const backJob = await store.createJob(project.id, { targetId: 'coat', prompt: '外套背面', outputView: 'back', baseRevision: 5 });
  const back = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: backJob.id });
  const backAccepted = await store.acceptCandidate(project.id, back.candidate.id, { baseRevision: 5 });
  assert.equal(backAccepted.character.adopted.coat, front.asset.id);
  assert.equal(backAccepted.character.components.coat.assetId, front.asset.id);
  assert.deepEqual(backAccepted.character.components.coat.views, { detail: detail.asset.id, front: front.asset.id, back: back.asset.id });
  assert.equal(backAccepted.character.revision, 6);
  assert.match(backAccepted.history.at(-1).message, /外套背面/);
  const wholeJob = await store.createJob(project.id, { prompt: '依已確認外套重新同步角色', baseRevision: 6 });
  for (const asset of [detail.asset, front.asset, back.asset]) assert.ok(wholeJob.context.referenceAssets.some((item) => item.id === asset.id));
  const exported = entries((await store.exportProject(project.id)).buffer);
  for (const asset of [detail.asset, front.asset, back.asset]) assert.deepEqual(exported[`images/${asset.id}.png`], png);
  const saved = parseCharacterYaml(exported['character.yaml'].toString());
  assert.equal(saved.adopted.coat, front.asset.id);
  assert.equal(saved.components.coat.views.back, back.asset.id);
});

test('細節採用不解除過期主圖提示；完整主圖採用才更新並解除', async (t) => {
  const { store, project } = await setup(t);
  const character = structuredClone(project.character);
  character.components.coat = { id: 'coat', name: '外套', kind: 'garment', description: '外套', designStatus: 'draft' };
  await store.updateCharacter(project.id, { baseRevision: 1, character });
  const frontJob = await store.createJob(project.id, { targetId: 'coat', prompt: '外套正面', baseRevision: 2 });
  const front = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: frontJob.id });
  const accepted = await store.acceptCandidate(project.id, front.candidate.id, { baseRevision: 2 });
  accepted.character.identity.hair = '銀白短髮';
  const updated = await store.updateCharacter(project.id, { baseRevision: 3, character: accepted.character });
  assert.ok(updated.syncTargets.includes('coat'));
  const detailJob = await store.createJob(project.id, { targetId: 'coat', prompt: '更新袖口細節', outputView: 'detail', baseRevision: 4 });
  const detail = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: detailJob.id });
  const detailAccepted = await store.acceptCandidate(project.id, detail.candidate.id, { baseRevision: 4 });
  assert.ok(detailAccepted.syncTargets.includes('coat'));
  assert.equal(detailAccepted.character.adopted.coat, front.asset.id);
  const fullJob = await store.createJob(project.id, { targetId: 'coat', prompt: '更新整件外套', outputView: 'full', baseRevision: 5 });
  const full = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: fullJob.id });
  const fullAccepted = await store.acceptCandidate(project.id, full.candidate.id, { baseRevision: 5 });
  assert.equal(fullAccepted.character.adopted.coat, full.asset.id);
  assert.equal(fullAccepted.character.components.coat.views.front, front.asset.id);
  assert.equal(fullAccepted.character.components.coat.views.full, full.asset.id);
  assert.equal(fullAccepted.syncTargets.includes('coat'), false);
});

test('拒絕不合法工作視角與以背面冒充主圖的YAML', async (t) => {
  const { store, project } = await setup(t);
  await assert.rejects(store.createJob(project.id, { prompt: '角色背面', outputView: 'back', baseRevision: 1 }), { code: 'INVALID_OUTPUT_VIEW' });
  const character = structuredClone(project.character);
  character.components.coat = { id: 'coat', name: '外套', kind: 'garment', description: '', designStatus: 'proposed' };
  await store.updateCharacter(project.id, { baseRevision: 1, character });
  await assert.rejects(store.createJob(project.id, { targetId: 'coat', prompt: '未知視角', outputView: 'sideways', baseRevision: 2 }), { code: 'INVALID_OUTPUT_VIEW' });
  const job = await store.createJob(project.id, { targetId: 'coat', prompt: '背面', outputView: 'back', baseRevision: 2 });
  await assert.rejects(store.updateJob(project.id, job.id, { outputView: 'front' }), { code: 'INVALID_INPUT' });
  const back = await store.addAsset(project.id, { buffer: png, targetId: 'coat', jobId: job.id });
  const bad = (await store.getProject(project.id)).character;
  bad.adopted.coat = back.asset.id;
  await assert.rejects(store.updateCharacter(project.id, { baseRevision: 2, character: bad }), { code: 'INVALID_PRIMARY_VIEW' });
  delete bad.adopted.coat;
  bad.components.coat.views = { front: back.asset.id };
  await assert.rejects(store.updateCharacter(project.id, { baseRevision: 2, character: bad }), { code: 'VIEW_ASSET_MISMATCH' });
  assert.equal((await store.getProject(project.id)).character.revision, 2);
});

test('刪除角色：整個資料夾移到資源回收區，可以復原；刪光後不再冒出範例角色', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-delete-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: true }).init();
  const project = await store.createProject({ name: '要刪的角色', brief: '' });
  await store.addAsset(project.id, { buffer: png, name: '參考', role: 'reference' });
  const removed = await store.deleteProject(project.id);
  assert.equal(removed.name, '要刪的角色');
  assert.match(removed.trashId, new RegExp(`^${project.id}--\\d{14}-[0-9a-f]{8}$`));
  await assert.rejects(store.getProject(project.id), { code: 'PROJECT_NOT_FOUND' });
  assert.ok(!(await store.listProjects()).some(item => item.id === project.id), '角色選單不再列出');
  const moved = path.join(dataDir, 'trash', removed.trashId);
  assert.ok((await fs.readdir(path.join(moved, 'assets'))).length === 1, '圖片跟著搬到資源回收區，沒有刪掉');
  assert.equal(JSON.parse(await fs.readFile(path.join(moved, 'deleted.json'), 'utf8')).id, project.id);
  await assert.rejects(store.deleteProject(project.id), { code: 'PROJECT_NOT_FOUND' });
  await assert.rejects(store.deleteProject('../outside'), { code: 'INVALID_ID' });
  await assert.rejects(store.restoreProject('../../etc'), { code: 'INVALID_TRASH_ID' });

  const restored = await store.restoreProject(removed.trashId);
  assert.equal(restored.id, project.id);
  assert.equal(restored.assets.length, 1, '復原後圖片還在');
  await assert.rejects(fs.access(path.join(dataDir, 'projects', project.id, 'deleted.json')));
  await assert.rejects(store.restoreProject(removed.trashId), { code: 'TRASH_NOT_FOUND' }, '同一份不能復原兩次');

  // 原位置已經有同 ID 的資料夾時不覆蓋
  const again = await store.deleteProject(project.id);
  await fs.cp(path.join(dataDir, 'trash', again.trashId), path.join(dataDir, 'projects', project.id), { recursive: true });
  await assert.rejects(store.restoreProject(again.trashId), { code: 'PROJECT_EXISTS' });
  await fs.rm(path.join(dataDir, 'projects', project.id), { recursive: true });
  assert.equal((await store.restoreProject(again.trashId)).id, project.id);

  for (const item of await store.listProjects()) await store.deleteProject(item.id);
  const reopened = await new ProjectStore({ dataDir, demo: true }).init();
  assert.deepEqual(await reopened.listProjects(), [], '角色刪光後重開，不會再建立範例角色');
});

test('HTTP 刪除角色只接受本機網址', async (t) => {
  const { project, dataDir } = await setup(t);
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false });
  try {
    const blocked = await fetch(`${running.url}/api/projects/${project.id}`, { method: 'DELETE', headers: { Origin: 'https://evil.example' } });
    assert.equal(blocked.status, 403);
    assert.equal((await fetch(`${running.url}/api/projects/${project.id}`)).status, 200, '外部網站刪不掉');
    const removed = await (await fetch(`${running.url}/api/projects/${project.id}`, { method: 'DELETE' })).json();
    assert.equal(removed.id, project.id);
    assert.equal((await fetch(`${running.url}/api/projects/${project.id}`)).status, 404);
    const restored = await fetch(`${running.url}/api/trash/${removed.trashId}/restore`, { method: 'POST' });
    assert.equal(restored.status, 200);
    assert.equal((await fetch(`${running.url}/api/projects/${project.id}`)).status, 200);
  } finally { await running.close(); }
});

test('刪除角色的邊界：半個資料夾不拖垮角色選單、復原能排除殘留、刪除紀錄不見也能復原、範例圖片不會把角色建回來', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-delete-edge-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: true }).init();
  const keep = await store.createProject({ name: '留下的角色', brief: '' });
  const gone = await store.createProject({ name: '刪掉的角色', brief: '' });
  const removed = await store.deleteProject(gone.id);

  // 刪除時剛好有東西寫進角色資料夾，只留下半個資料夾
  await fs.mkdir(path.join(dataDir, 'projects', gone.id, '.agents'), { recursive: true });
  const ids = (await store.listProjects()).map(item => item.id);
  assert.ok(ids.includes(keep.id) && !ids.includes(gone.id), '角色選單照常列出其他角色');
  const restored = await store.restoreProject(removed.trashId);
  assert.equal(restored.id, gone.id, '原位置只有半個資料夾時，先移開再復原');
  assert.ok((await fs.readdir(path.join(dataDir, 'trash'))).some(name => name.endsWith('-partial')), '殘留的半個資料夾移到資源回收區旁，沒有刪');

  // 資料夾名稱和角色 ID 對不上（手動把資源回收區的資料夾搬回來）：略過，不出現打不開的角色卡
  const again = await store.deleteProject(gone.id);
  await fs.cp(path.join(dataDir, 'trash', again.trashId), path.join(dataDir, 'projects', again.trashId), { recursive: true });
  assert.ok(!(await store.listProjects()).some(item => item.id === gone.id));
  await fs.rm(path.join(dataDir, 'projects', again.trashId), { recursive: true });

  // 刪除紀錄被改過：不認；刪除紀錄不見：用 project.json 認得
  const marker = path.join(dataDir, 'trash', again.trashId, 'deleted.json');
  await fs.writeFile(marker, JSON.stringify({ id: keep.id, name: '假的' }));
  await assert.rejects(store.restoreProject(again.trashId), { code: 'TRASH_NOT_FOUND' });
  await fs.rm(marker);
  assert.deepEqual((await store.listTrash()).map(item => item.trashId), [again.trashId]);
  assert.equal((await store.restoreProject(again.trashId)).id, gone.id);

  // 範例角色被刪除後，讀它的圖片不會把資料夾建回來
  const rin = (await store.listProjects()).find(item => item.id === 'rin');
  assert.ok(rin, '全新安裝有範例角色');
  await store.deleteProject('rin');
  await assert.rejects(store.readAsset('rin', 'demo-rin-sheet'), { code: 'PROJECT_NOT_FOUND' });
  await assert.rejects(fs.access(path.join(dataDir, 'projects', 'rin')));

  // 永久刪除只刪資源回收區裡的那一份
  const rinTrash = (await store.listTrash()).find(item => item.id === 'rin');
  await store.purgeTrash(rinTrash.trashId);
  assert.ok(!(await store.listTrash()).some(item => item.id === 'rin'));
  await assert.rejects(store.purgeTrash(rinTrash.trashId), { code: 'TRASH_NOT_FOUND' });
  await assert.rejects(store.purgeTrash('../projects'), { code: 'INVALID_TRASH_ID' });
});

test('刪除時背景拆解還沒結束：復原後標成中斷，可以再拆一次；匯出與刪除同時發生不會卡住', async (t) => {
  const { store, project } = await setup(t);
  const job = await store.createJob(project.id, { prompt: '立繪', baseRevision: 1 });
  const drawn = await store.addAsset(project.id, { buffer: png, jobId: job.id });
  await store.acceptCandidate(project.id, drawn.candidate.id, { baseRevision: 1 });
  await store.startDecomposition(project.id, {});
  const removed = await store.deleteProject(project.id);
  await assert.rejects(store.finishDecomposition(project.id, { assetId: drawn.asset.id, parts: [] }), { code: 'PROJECT_NOT_FOUND' });
  const restored = await store.restoreProject(removed.trashId);
  assert.equal(restored.decomposition.status, 'failed');
  assert.equal(restored.decomposition.errorCode, 'DECOMPOSE_INTERRUPTED');

  const [exported, deleted] = await Promise.allSettled([store.exportProject(project.id), store.deleteProject(project.id)]);
  assert.equal(exported.status, 'fulfilled', '匯出先完成');
  assert.ok(exported.value.buffer.length > 0);
  assert.equal(deleted.status, 'fulfilled', '刪除等匯出完成後才搬');
  await assert.rejects(store.exportProject(project.id), { code: 'PROJECT_NOT_FOUND' });
});

test('角色刪除後才送來的交接請求：回報找不到，不會把角色資料夾建回來', async (t) => {
  const { project, dataDir } = await setup(t);
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: registerCodexRoutes });
  try {
    const job = await running.store.createJob(project.id, { baseRevision: 1, prompt: '立繪', kind: 'generate' });
    await running.store.deleteProject(project.id);
    const handoff = await fetch(`${running.url}/api/projects/${project.id}/jobs/${job.id}/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(handoff.status, 404);
    await assert.rejects(fs.access(path.join(dataDir, 'projects', project.id)), '沒有留下半個資料夾');
    assert.equal((await fetch(`${running.url}/api/projects`)).status, 200, '角色選單照常');
    const trash = await (await fetch(`${running.url}/api/trash`)).json();
    assert.deepEqual(trash.map(item => item.id), [project.id]);
  } finally { await running.close(); }
});
