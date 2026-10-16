// 畫面狀態（2026-10-14 起存在本機核心）：src/ui-state.js 的讀寫、舊版瀏覽器儲存的搬家、送不出去時留著下次送。
import test from 'node:test';
import assert from 'node:assert/strict';

function storage(initial) {
  const target = {};
  const methods = {
    getItem: (key) => (Object.hasOwn(target, key) ? target[key] : null),
    setItem: (key, value) => { target[key] = String(value); },
    removeItem: (key) => { delete target[key]; },
  };
  for (const [name, fn] of Object.entries(methods)) Object.defineProperty(target, name, { value: fn, enumerable: false });
  for (const [key, value] of Object.entries(initial)) target[key] = value;
  return target;
}

// 假的核心：記住收到的 PATCH，GET 回傳目前的值。
function fakeCore(initial = {}) {
  const core = { values: { ...initial }, patches: [], down: false, hold: null };
  core.fetch = async (url, options = {}) => {
    if (core.down) throw new Error('core restarting');
    if (!options.method) return { ok: true, status: 200, json: async () => ({ values: structuredClone(core.values) }) };
    if (core.hold) await core.hold;
    const changes = JSON.parse(options.body).values;
    core.patches.push(changes);
    for (const [key, value] of Object.entries(changes)) { if (value === null) delete core.values[key]; else core.values[key] = value; }
    return { ok: true, status: 200, json: async () => ({ updated: Object.keys(changes).length }) };
  };
  return core;
}

// bun test 把所有測試檔放在同一個程序裡跑：換掉的 fetch、localStorage 用完要還原，不然別的測試會打到假的 fetch。
function stubGlobals(t) {
  const original = { fetch: globalThis.fetch, localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage') };
  t.after(() => {
    globalThis.fetch = original.fetch;
    if (original.localStorage) Object.defineProperty(globalThis, 'localStorage', original.localStorage); else delete globalThis.localStorage;
  });
}
let instance = 0;
const fresh = () => import(`../src/ui-state.js?instance=${++instance}`);

test('畫面狀態：舊的瀏覽器儲存搬到核心一次（核心有的不蓋、空的參考線不帶）；之後刪掉的不會又被帶回來', async (t) => {
  stubGlobals(t);
  globalThis.localStorage = storage({ 'aidol-pref-variants': '3', 'aidol-layout-v3-rin': '{"a":{"x":1,"y":2}}', 'aidol-current-project': 'rin', 'aidol-pref-category': '"hair"', 'aidol-guides-rin': '[]', 'other-app': '1' });
  const core = fakeCore({ 'pref:category': 'face' });
  globalThis.fetch = core.fetch;
  let ui = await fresh();
  await ui.loadUiState();
  assert.equal(ui.readUi('pref:category'), 'face', '核心已經有的不被舊的蓋掉');
  assert.equal(ui.readUi('pref:variants'), 3);
  assert.deepEqual(ui.readUi('layout:rin'), { a: { x: 1, y: 2 } });
  assert.equal(ui.readUi('last-project'), 'rin');
  assert.equal(ui.readUi('guides:rin', 'none'), 'none', '空的參考線不帶');
  assert.deepEqual(core.patches, [{ 'pref:variants': 3, 'layout:rin': { a: { x: 1, y: 2 } }, 'last-project': 'rin' }]);
  // 回到角色選單（刪掉上次的角色）→ 下次打開：舊的瀏覽器儲存還在，但已經搬過，不會又帶回來。
  ui.writeUi('last-project', null, { soon: true });
  await ui.flushUiState();
  ui = await fresh();
  await ui.loadUiState();
  assert.equal(ui.readUi('last-project', null), null);
  assert.equal(core.patches.length, 2);
});

test('畫面狀態：連續改只送最後一次；名稱不合格、太大的不送（不讓整批被退回）；送不出去留著下次送；一次只送一批', async (t) => {
  stubGlobals(t);
  globalThis.localStorage = storage({ 'aidol-ui-migrated': '1' });
  const core = fakeCore();
  globalThis.fetch = core.fetch;
  const ui = await fresh();
  await ui.loadUiState();
  ui.writeUi('pref:variants', 1);
  ui.writeUi('pref:variants', 2);
  ui.writeUi('Bad Key', 1);
  ui.writeUi('pref:huge', 'x'.repeat(70 * 1024));
  await ui.flushUiState();
  assert.deepEqual(core.patches.at(-1), { 'pref:variants': 2 });
  assert.equal(ui.readUi('pref:huge').length, 70 * 1024, '太大的只留在這次的記憶體裡');
  core.down = true;
  ui.writeUi('pref:x', 1);
  await ui.flushUiState();
  core.down = false;
  ui.writeUi('pref:y', 2);
  await ui.flushUiState();
  assert.deepEqual(core.patches.at(-1), { 'pref:x': 1, 'pref:y': 2 }, '送不出去的留著下次一起送');
  assert.equal(localStorage.getItem('aidol-ui-pref:y'), '2', '瀏覽器裡留一份備份');
  // 前一批還沒回來時又改了同一個：等前一批回來才送下一批，後改的不會被前一批蓋掉。
  let release;
  core.hold = new Promise((resolve) => { release = resolve; });
  ui.writeUi('layout:rin', { a: 1 });
  const first = ui.flushUiState();
  ui.writeUi('layout:rin', { a: 2 });
  const second = ui.flushUiState();
  core.hold = null;
  release();
  await Promise.all([first, second]);
  assert.deepEqual(core.values['layout:rin'], { a: 2 });
});

test('畫面狀態：核心連不上時用瀏覽器裡的備份，不搬家', async (t) => {
  stubGlobals(t);
  globalThis.localStorage = storage({ 'aidol-ui-pref:variants': '4', 'aidol-pref-variants': '2' });
  const core = fakeCore();
  core.down = true;
  globalThis.fetch = core.fetch;
  const ui = await fresh();
  await ui.loadUiState();
  assert.equal(ui.readUi('pref:variants'), 4);
  assert.equal(core.patches.length, 0);
  assert.equal(localStorage.getItem('aidol-ui-migrated'), null);
});
