// 樣式庫（髮型、體型、旋鈕…）的介面名稱。shared/libraries.mjs 只有繁中原文與給 AI 的英文 prompt；
// 其他語言的名稱在 locales/<語言>/lib.json，以「清單名.選項 id」對應。存檔只存 id，所以換語言不影響資料。
// 用法：import { L } from '../lib-i18n'，和 shared/libraries.mjs 一樣用 L.hairStyles；取值當下就是目前語言。
import * as base from '../shared/libraries.mjs';
import { getLocale, resource, SOURCE_LOCALE } from './i18n';

const localize = (name, list, table) => list.map((option) => {
  const entry = table?.[name]?.[option.id];
  if (!entry || !option || typeof option !== 'object') return option;
  if (typeof entry === 'string') return { ...option, label: entry };
  return { ...option, ...(entry.label ? { label: entry.label } : {}), ...(entry.hint ? { hint: entry.hint } : {}), ...(Array.isArray(entry.steps) ? { steps: entry.steps } : {}) };
});

const cache = new Map();
function libraryFor(locale) {
  if (locale === SOURCE_LOCALE) return base;
  if (!cache.has(locale)) {
    const table = resource('lib', locale);
    const localized = {};
    for (const [name, value] of Object.entries(base)) {
      localized[name] = Array.isArray(value) && value.some((item) => item && typeof item === 'object' && 'id' in item) ? localize(name, value, table) : value;
    }
    cache.set(locale, Object.freeze(localized));
  }
  return cache.get(locale);
}

export const L = new Proxy({}, {
  get: (_, key) => libraryFor(getLocale())[key],
  has: (_, key) => key in base,
  ownKeys: () => Reflect.ownKeys(base),
  getOwnPropertyDescriptor: (_, key) => ({ ...Reflect.getOwnPropertyDescriptor(base, key), value: libraryFor(getLocale())[key], configurable: true }),
});

// 用 id 找目前語言的名稱（例如設定差異裡的舊值、新值）。
export const optionLabel = (listName, id, fallback = '') => (id ? base.findOption(L[listName] || [], id)?.label || id : fallback);
