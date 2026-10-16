// 未送出的精修要求依「角色＋穿搭＋目標」各自保存在這台電腦的瀏覽器儲存。
// 這只是個人的便利功能：讀不到時回到預設，不影響正式設定或工作。
import { readUi, writeUi } from './ui-state';

const KEY = 'aidol-drafts-v1';
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { cache = {}; }
  return cache;
}

export function getDraft(key) { return load()[key] || null; }

export function setDraft(key, value) {
  const all = load();
  if (value) all[key] = value; else delete all[key];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
}

// 偏好（一次畫幾張、取景、設定資料集的區塊…）：2026-10-14 起存在本機核心（ui-state.js），桌面版重開也還在。
export function readPreference(name, fallback) { return readUi(`pref:${name}`, fallback); }
export function writePreference(name, value) { writeUi(`pref:${name}`, value); }
