// 畫面狀態（2026-10-14 起存在本機核心）：畫布節點位置、並排看的參考線、捏角色的偏好、上次打開的角色。
// 桌面版每次啟動核心的連接埠都不同，瀏覽器儲存是照網址分的，存在瀏覽器裡每次開都會不見；
// 所以改存核心（資料夾裡的 ui-state.json），瀏覽器儲存只當備份。打開畫面前先讀一次（main.jsx），
// 之後讀是同步的；寫入先改記憶體，稍等一下再一起送給核心（拖節點這類連續的改動只送最後一次）。
// 名稱：pref:<偏好>、layout:<角色 ID>、guides:<角色 ID>、last-project。
let values = {};
const pending = new Map();
let timer = null;
let inflight = null;

// 和核心的檢查一樣：名稱格式、單一值大小。不合格的只留在這次的記憶體裡，不送（送了整批都會被退回）。
const KEY = /^[a-z][a-z0-9-]{0,40}(?::[A-Za-z0-9_.-]{1,120})?$/;
const BATCH = 150;
const sendable = (key, value) => KEY.test(key) && key !== '__proto__' && (value === null || JSON.stringify(value).length <= 60 * 1024);

// 舊版存在瀏覽器裡的名稱（同一個網址開過的）：核心讀得到、而且還沒搬過時，帶過去一次。
const legacy = [
  [/^aidol-pref-(.+)$/, (name) => `pref:${name}`, true],
  [/^aidol-layout-v3-(.+)$/, (id) => `layout:${id}`, true],
  [/^aidol-guides-(.+)$/, (id) => `guides:${id}`, true],
  [/^aidol-current-project$/, () => 'last-project', false],
];
const MIGRATED = 'aidol-ui-migrated';
const localKey = (key) => `aidol-ui-${key}`;

function readLocal(key) {
  try { const value = localStorage.getItem(localKey(key)); return value === null ? undefined : JSON.parse(value); } catch { return undefined; }
}
function writeLocal(key, value) {
  try { if (value === null || value === undefined) localStorage.removeItem(localKey(key)); else localStorage.setItem(localKey(key), JSON.stringify(value)); } catch { /* 存不了就只存核心 */ }
}

async function send(changes, { keepalive = false, timeout = 8000 } = {}) {
  const controller = new AbortController();
  const stop = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch('/api/ui-state', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: changes }), keepalive, signal: controller.signal });
    return response.status;
  } finally { clearTimeout(stop); }
}

// 搬家只做一次：成功送到核心後記一筆（之後使用者刪掉的設定不會又被舊的帶回來）。
async function migrate() {
  let keys = [];
  try { if (localStorage.getItem(MIGRATED)) return; keys = Object.keys(localStorage); } catch { return; }
  const found = {};
  for (const name of keys) {
    for (const [pattern, toKey, json] of legacy) {
      const match = pattern.exec(name);
      if (!match) continue;
      const key = toKey(match[1]);
      if (Object.hasOwn(values, key)) break;
      let value;
      try { const raw = localStorage.getItem(name); value = json ? JSON.parse(raw) : raw; } catch { break; }
      // 空的參考線（舊版每次打開並排看都會寫一筆）不帶。
      if (value === null || value === undefined || (Array.isArray(value) && !value.length) || !sendable(key, value)) break;
      found[key] = value;
      break;
    }
  }
  const entries = Object.entries(found);
  let ok = true;
  for (let index = 0; index < entries.length; index += BATCH) {
    try { const status = await send(Object.fromEntries(entries.slice(index, index + BATCH)), { timeout: 3000 }); ok &&= status >= 200 && status < 300; } catch { ok = false; }
  }
  for (const [key, value] of entries) if (!Object.hasOwn(values, key)) values[key] = value;
  if (ok) try { localStorage.setItem(MIGRATED, '1'); } catch { /* 下次再搬一次也只是補核心沒有的 */ }
}

export async function loadUiState(timeout = 1500) {
  let loaded = false;
  try {
    const controller = new AbortController();
    const stop = setTimeout(() => controller.abort(), timeout);
    const response = await fetch('/api/ui-state', { signal: controller.signal });
    clearTimeout(stop);
    if (response.ok) { const data = await response.json(); values = data?.values && typeof data.values === 'object' && !Array.isArray(data.values) ? data.values : {}; loaded = true; }
  } catch { /* 核心連不上或太慢：先用這台電腦瀏覽器裡的備份 */ }
  if (!loaded) {
    values = {};
    try { for (const name of Object.keys(localStorage)) if (name.startsWith('aidol-ui-') && name !== MIGRATED) { const key = name.slice('aidol-ui-'.length); const value = readLocal(key); if (value !== undefined) values[key] = value; } } catch { /* 讀不到就是空的 */ }
    return;
  }
  await migrate();
}

export function readUi(key, fallback) {
  return Object.hasOwn(values, key) ? values[key] : fallback;
}

// value 是 null／undefined：刪掉。soon：馬上送（例如上次打開的角色，關掉視窗前一定要送到）。
export function writeUi(key, value, { soon = false } = {}) {
  const next = value === undefined ? null : value;
  if (next === null) delete values[key]; else values[key] = next;
  writeLocal(key, next);
  if (!sendable(key, next)) return;
  pending.set(key, next);
  if (soon) flushUiState(); else schedule();
}

function schedule() { clearTimeout(timer); timer = setTimeout(() => flushUiState(), 400); }

// 一次只送一批（前一批還沒回來就等它）：前一批失敗重送時，不會蓋掉之後改的。
// 送不出去（核心剛好重開）就留著，下次有改動時一起送；核心退回（格式不對）就不再送那批。
export async function flushUiState({ keepalive = false } = {}) {
  clearTimeout(timer);
  while (inflight) await inflight;
  if (!pending.size) return;
  const changes = Object.fromEntries([...pending].slice(0, BATCH));
  for (const key of Object.keys(changes)) pending.delete(key);
  inflight = (async () => {
    try {
      const status = await send(changes, { keepalive });
      if (status >= 500) throw new Error(String(status));
    } catch {
      for (const [key, value] of Object.entries(changes)) if (!pending.has(key)) pending.set(key, value);
    }
  })();
  try { await inflight; } finally { inflight = null; }
  if (pending.size) schedule();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { flushUiState({ keepalive: true }); });
  // 桌面版關視窗時不一定有 pagehide：畫面被藏起來（切走、最小化、要關掉）就先送。
  document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUiState({ keepalive: true }); });
}
