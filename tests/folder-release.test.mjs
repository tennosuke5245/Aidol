import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CodexClient } from '../server/codex/client.mjs';
import { ProjectStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
import { registerCodexRoutes } from '../server/integrations.mjs';

// 假的 app-server：turn 要等測試呼叫 finishTurn 才完成，用來模擬「Codex 正在忙」。
function fakeAppServer() {
  const children = [];
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const reply = (value) => child.stdout.write(`${JSON.stringify(value)}\n`);
    child.turns = [];
    child.stdin = new Writable({ write(buffer, _encoding, callback) {
      const message = JSON.parse(buffer.toString());
      if (message.id) {
        let result = {};
        if (message.method === 'thread/start') result = { thread: { id: `thread-${children.length}-${child.turns.length}` } };
        if (message.method === 'turn/start') { result = { turn: { id: 'turn' } }; child.turns.push(message.params.threadId); }
        reply({ id: message.id, result });
      }
      callback();
    } });
    child.finishTurn = (threadId = child.turns.at(-1)) => {
      reply({ method: 'item/completed', params: { threadId, item: { id: 'item', type: 'agentMessage', text: '完成' } } });
      reply({ method: 'turn/completed', params: { threadId, turn: { id: 'turn', status: 'completed' } } });
    };
    child.exit = () => { if (child.exitCode !== null) return; child.exitCode = 0; child.stdout.end(); child.emit('exit', 0); };
    children.push(child);
    return child;
  };
  return { children, spawnProcess };
}
const waitFor = async (check) => { for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5)); assert.ok(check()); };

test('背景 Codex：沒在跑回報 none；有工作在跑不打斷（busy）；閒著就整個關掉（released）', async () => {
  const fake = fakeAppServer(); const stopped = [];
  const client = new CodexClient({ spawnProcess: fake.spawnProcess, terminate: (child) => { stopped.push(child); child.exit(); } });
  assert.equal(await client.release(), 'none');
  const turn = client.freshTurn({ prompt: '拆解裝備' });
  await waitFor(() => fake.children[0]?.turns.length === 1);
  assert.equal(await client.release({ waitMs: 0 }), 'busy');
  assert.equal(stopped.length, 0, '正在工作的 Codex 不可以被關掉');
  fake.children[0].finishTurn();
  assert.equal((await turn).text, '完成');
  assert.equal(await client.release(), 'released');
  assert.deepEqual(stopped, [fake.children[0]], '連同子程序一起結束（Windows 用 taskkill /T）');
  assert.equal(client.running, false);
  // 下次要用時自動再連一個新的。
  const next = client.freshTurn({ prompt: '再聊一次' });
  await waitFor(() => fake.children[1]?.turns.length === 1);
  fake.children[1].finishTurn();
  assert.equal((await next).text, '完成');
  await client.close();
});

test('背景 Codex 重開後，舊程序晚到的結束事件不會讓新連線上的工作失敗', async () => {
  const fake = fakeAppServer();
  const client = new CodexClient({ spawnProcess: fake.spawnProcess, terminate: () => {} });
  await client.start();
  const old = fake.children[0];
  const closing = client.close();
  const turn = client.freshTurn({ prompt: '新工作' });
  await waitFor(() => fake.children[1]?.turns.length === 1);
  old.exit();
  await closing;
  fake.children[1].finishTurn();
  assert.equal((await turn).text, '完成');
  client.terminate = (child) => child.exit();
  await client.close();
});

// 模擬 Windows：角色資料夾被開著時搬不動（EPERM），直到「佔著的程式」放開。
function lockFolders(t, isLocked) {
  const realRename = fs.rename.bind(fs);
  t.mock.method(fs, 'rename', async (from, to) => {
    if (isLocked(from)) throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}'`), { code: 'EPERM' });
    return realRename(from, to);
  });
}
async function tempStore(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-folder-release-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = new ProjectStore({ dataDir, demo: false });
  store.moveAttempts = 1;
  return store;
}

test('刪除角色搬不動：先請背景 Codex 放開再搬一次；它在忙或不是它，就說清楚是誰卡住', async (t) => {
  const store = await tempStore(t);
  const project = await store.createProject({ name: '被開著的角色' });
  const folder = store.projectDir(project.id);
  let held = true; const asked = [];
  lockFolders(t, (from) => held && path.resolve(from) === folder);

  await assert.rejects(store.deleteProject(project.id), { code: 'PROJECT_BUSY' }, '沒有背景 Codex：就是其他程式');
  store.setFolderReleaser(() => { asked.push('none'); return 'none'; });
  await assert.rejects(store.deleteProject(project.id), (error) => error.code === 'PROJECT_BUSY' && /其他程式/.test(error.message));
  store.setFolderReleaser(() => { asked.push('busy'); return 'busy'; });
  await assert.rejects(store.deleteProject(project.id), (error) => error.code === 'PROJECT_BUSY_CODEX' && /等它完成/.test(error.message));
  store.setFolderReleaser(() => { asked.push('throws'); throw new Error('關不掉'); });
  await assert.rejects(store.deleteProject(project.id), { code: 'PROJECT_BUSY' });
  // 每次失敗都原封不動：沒有留下刪除紀錄，角色照常打得開。
  await assert.rejects(fs.access(path.join(folder, 'deleted.json')));
  assert.equal((await store.getProject(project.id)).name, '被開著的角色');

  store.setFolderReleaser(() => { asked.push('released'); held = false; return 'released'; });
  const deleted = await store.deleteProject(project.id);
  assert.deepEqual(asked, ['none', 'busy', 'throws', 'released']);
  assert.deepEqual((await store.listTrash()).map((item) => item.trashId), [deleted.trashId]);

  // 復原也一樣：資源回收區裡的資料夾被開著時，先請 Codex 放開。
  const trashFolder = store.trashDir(deleted.trashId);
  held = true; asked.length = 0;
  lockFolders(t, (from) => held && path.resolve(from) === trashFolder);
  store.setFolderReleaser(() => { asked.push('released'); held = false; return 'released'; });
  const restored = await store.restoreProject(deleted.trashId);
  assert.equal(restored.id, project.id);
  assert.deepEqual(asked, ['released']);
});

test('放開之後還是搬不動：是其他程式開著，訊息不再叫使用者等 Codex', async (t) => {
  const store = await tempStore(t);
  const project = await store.createProject({ name: '檔案總管開著' });
  lockFolders(t, (from) => path.resolve(from) === store.projectDir(project.id));
  let asked = 0;
  store.setFolderReleaser(() => { asked++; return 'released'; });
  await assert.rejects(store.deleteProject(project.id), (error) => error.code === 'PROJECT_BUSY' && /不是 AIDOL 自己/.test(error.message));
  assert.equal(asked, 1, '只請 Codex 放開一次，不無限重開');
});

test('核心接上 Codex 整合後，刪除角色搬不動時會讓背景 Codex 放開', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-folder-release-http-'));
  let held = true; const releases = [];
  const client = { close() {}, async release() { releases.push('called'); held = false; return 'released'; } };
  const running = await startServer({ dataDir, demo: false, port: 0, announce: false, registerIntegrations: (app, store) => registerCodexRoutes(app, store, { client, version: async () => 'test' }) });
  t.after(async () => { await running.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  running.store.moveAttempts = 1;
  const project = await running.store.createProject({ name: '要刪的角色' });
  lockFolders(t, (from) => held && path.resolve(from) === running.store.projectDir(project.id));
  const response = await fetch(`${running.url}/api/projects/${project.id}`, { method: 'DELETE' });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(releases, ['called']);
  assert.equal((await running.store.listProjects()).some((item) => item.id === project.id), false);
});
