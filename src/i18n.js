// 介面語系：繁體中文（原文）、English、日本語。選過的語言記在這台電腦的瀏覽器裡。
// 用法：元件裡 const t = useT(); 再 t('canvas.title')。元件外的函式直接 import { t }。
import { useSyncExternalStore } from 'react';
import { LOCALES, SOURCE_LOCALE, isLocale, matchLocale, translate } from './i18n-core.js';

export { LOCALES, SOURCE_LOCALE };

const STORAGE_KEY = 'aidol-locale';
const resources = {};
for (const [file, data] of Object.entries(import.meta.glob('./locales/*/*.json', { eager: true, import: 'default' }))) {
  const match = /locales\/([^/]+)\/([^/]+)\.json$/.exec(file);
  if (match) (resources[match[1]] ||= {})[match[2]] = data;
}

function initialLocale() {
  try { const saved = localStorage.getItem(STORAGE_KEY); if (isLocale(saved)) return saved; } catch { /* 無痕或封鎖儲存時照系統語言 */ }
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return matchLocale(languages);
}

let current = initialLocale();
const listeners = new Set();

function applyDocument() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.lang = LOCALES.find((locale) => locale.id === current)?.htmlLang || current;
  root.dataset.locale = current;
  document.title = translate(resources, current, 'app.documentTitle', { defaultValue: 'AIDOL' });
}
applyDocument();

export const getLocale = () => current;
export const isSource = () => current === SOURCE_LOCALE;
const persist = (locale) => fetch('/api/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale }) }).catch(() => {});
export function setLocale(next, { save = true } = {}) {
  if (!isLocale(next)) return;
  if (save) persist(next);
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* 存不了就只在這次有效 */ }
  applyDocument();
  for (const listener of listeners) listener();
}

// 啟動時讀本機核心記的語言。桌面版每次啟動網址的 port 不同，瀏覽器的儲存會是空的，要以核心記的為準。
// 核心還沒記過時，把這次決定的語言記下來（之前只有繁中介面的舊安裝，核心會回 zh-TW）。
export async function loadSavedLocale(timeout = 1500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const response = await fetch('/api/preferences', { signal: controller.signal });
    clearTimeout(timer);
    const saved = response.ok ? await response.json() : {};
    if (isLocale(saved.locale) && !saved.inferred) setLocale(saved.locale, { save: false });
    else setLocale(isLocale(saved.locale) ? saved.locale : current);
  } catch { /* 連不上核心時先用瀏覽器記的或系統語言 */ }
}
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

export const t = (key, params) => translate(resources, current, key, params);
export const resource = (namespace, locale = current) => resources[locale]?.[namespace];

// 讓元件在換語言時重畫。
export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, t, setLocale };
}
export function useT() {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}

// shared 模組的文字：繁中直接用 shared 裡寫好的原文；其他語言查 shared 命名空間，查不到時退回原文。
export const sharedText = (key, params, source) => (current === SOURCE_LOCALE || !key ? source : t(`shared.${key}`, { ...params, defaultValue: source }));

// 日期、清單依目前語言格式化。
export const formatDate = (date, options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) => new Date(date).toLocaleString(current, options);
// 分隔符號：一般用「、」（英文 , ）；內容本身可能含逗號時（鎖定特徵）用較強的「；」（英文 ; ）。
export const formatList = (items, separator = '、') => {
  const strong = separator === '；' || separator === ';';
  const joiner = current === 'en' ? (strong ? '; ' : ', ') : (strong ? '；' : '、');
  return items.filter((item) => item !== undefined && item !== null && item !== '').map(String).join(joiner);
};
