// 介面語系的純函式部分（不依賴瀏覽器或 Vite，測試與檢查腳本也能用）。
// 繁體中文是原文；不提供簡體中文，所有中文環境都用繁體中文。
// 翻譯檔格式與 i18next 相容：巢狀 JSON、{{變數}}、複數用 key_one／key_other。
export const SOURCE_LOCALE = 'zh-TW';
export const LOCALES = [
  { id: 'zh-TW', label: '繁體中文', htmlLang: 'zh-Hant' },
  { id: 'en', label: 'English', htmlLang: 'en' },
  { id: 'ja', label: '日本語', htmlLang: 'ja' },
];
export const isLocale = (value) => LOCALES.some((locale) => locale.id === value);

// 依瀏覽器或系統的語言清單挑一個；都對不上時用英文。
export function matchLocale(tags = []) {
  for (const raw of tags) {
    const tag = String(raw || '').toLowerCase();
    if (tag.startsWith('zh')) return 'zh-TW';
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

export function lookup(tree, segments) {
  let node = tree;
  for (const segment of segments) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, segment)) return undefined;
    node = node[segment];
  }
  return node;
}

export const interpolate = (text, params = {}) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) => (params[name] ?? match));

// key 的第一段是命名空間（檔名），其餘用 . 分隔。找不到時退回繁中原文，再退回 defaultValue 或 key 本身。
export function translate(resources, locale, key, params = {}) {
  const [ns, ...path] = String(key).split('.');
  for (const lng of locale === SOURCE_LOCALE ? [locale] : [locale, SOURCE_LOCALE]) {
    const tree = resources[lng]?.[ns];
    if (!tree) continue;
    let value;
    if (typeof params.count === 'number' && path.length) {
      const rule = new Intl.PluralRules(lng).select(params.count);
      const last = path[path.length - 1];
      value = lookup(tree, [...path.slice(0, -1), `${last}_${rule}`]) ?? lookup(tree, [...path.slice(0, -1), `${last}_other`]);
    }
    value ??= lookup(tree, path);
    if (typeof value === 'string') return interpolate(value, params);
  }
  return params.defaultValue ?? key;
}

// 把 JSON 攤平成 key → 字串，給檢查腳本比對三語是否一致。
export function flatten(tree, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(tree || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(result, flatten(value, path));
    else result[path] = value;
  }
  return result;
}
