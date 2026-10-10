#!/usr/bin/env node
// 語系檢查：
// 1. src/ 的程式（不含註解）不可再寫死中日文字；介面文字要放進 src/locales/<語言>/<命名空間>.json。
// 2. 繁中（原文）、英文、日文的 key 要一致；樣式庫、shared 模組、錯誤代碼的翻譯要齊全。
// 3. 程式裡用到的 t('命名空間.key') 都要找得到。
// 用法：bun run check:i18n   或   node scripts/check-i18n.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from 'esbuild'; // 隨 Vite 安裝，不另列相依

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (file) => path.relative(root, file).split(path.sep).join('/');
const problems = [];
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const file = path.join(dir, name);
  return statSync(file).isDirectory() ? walk(file) : [file];
});

const LOCALES = ['zh-TW', 'en', 'ja'];
const SOURCE = 'zh-TW';
// 語言選單上的語言名稱本來就要用該語言自己的寫法。
const allowed = new Set(['繁體中文', '日本語']);
// 比對舊資料用的繁中原文，不是介面文字。
const dataFiles = new Set(['src/history-legacy.js']);
const LETTERS = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff01-\uff60]+(?:[^\n"'`]*[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff01-\uff60])?/g;

// 1. 寫死的文字
const sourceFiles = walk(path.join(root, 'src')).filter((file) => /\.(jsx?|mjs)$/.test(file) && !rel(file).startsWith('src/locales/'));
const usedKeys = [];
for (const file of sourceFiles) {
  const code = readFileSync(file, 'utf8');
  let stripped;
  try {
    stripped = transformSync(code, { loader: file.endsWith('.jsx') ? 'jsx' : 'js', jsx: 'preserve', legalComments: 'none', format: 'esm', charset: 'utf8' }).code;
  } catch (error) {
    const reason = String(error.message || '').split('\n').find((line) => line.trim()) || '未知原因';
    if (/another platform/i.test(error.message || '')) {
      console.error('check-i18n：esbuild 是替別的作業系統安裝的（例如在 WSL 裡用 Windows 的 node_modules）；請在安裝相依的那個系統上執行，或重新 bun install。');
      process.exit(2);
    }
    problems.push(`${rel(file)}：無法解析（${reason}）`);
    continue;
  }
  if (!dataFiles.has(rel(file))) for (const match of stripped.matchAll(CJK)) if (!allowed.has(match[0]) && LETTERS.test(match[0])) problems.push(`${rel(file)}：寫死的文字「${match[0].slice(0, 40)}」`);
  // esbuild 輸出會把 'x' 改成 "x"，兩種引號都要認得。
  for (const match of stripped.matchAll(/\bt\(\s*(['"])([a-zA-Z][\w-]*\.[\w.-]+)\1/g)) usedKeys.push([rel(file), match[2]]);
}

// 2. 翻譯檔
const resources = {};
for (const locale of LOCALES) {
  resources[locale] = {};
  let names = [];
  try { names = readdirSync(path.join(root, 'src', 'locales', locale)); } catch { problems.push(`缺少 src/locales/${locale}/`); }
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    try { resources[locale][name.slice(0, -5)] = JSON.parse(readFileSync(path.join(root, 'src', 'locales', locale, name), 'utf8')); }
    catch (error) { problems.push(`src/locales/${locale}/${name}：JSON 格式錯誤（${error.message}）`); }
  }
}
const flatten = (tree, prefix = '') => Object.entries(tree || {}).flatMap(([key, value]) => {
  const at = prefix ? `${prefix}.${key}` : key;
  return value && typeof value === 'object' && !Array.isArray(value) ? flatten(value, at) : [[at, value]];
});
// 複數：英文用 _one／_other，中日文只有 _other；比對時把字尾拿掉。
const base = (key) => key.replace(/_(zero|one|two|few|many|other)$/, '');
const keysOf = (locale, ns) => new Set(flatten(resources[locale][ns]).map(([key]) => base(key)));
const namespaces = new Set(LOCALES.flatMap((locale) => Object.keys(resources[locale])));
for (const ns of namespaces) {
  // lib、shared 的繁中原文寫在 shared/ 程式裡；errors 的繁中多半由 server 提供，只有少數放在 JSON。
  const reference = resources[SOURCE][ns] && !['errors'].includes(ns) ? SOURCE : 'en';
  const expected = keysOf(reference, ns);
  for (const locale of LOCALES) {
    if (locale === SOURCE && reference !== SOURCE) continue;
    const actual = keysOf(locale, ns);
    for (const key of expected) if (!actual.has(key)) problems.push(`src/locales/${locale}/${ns}.json：缺少 ${key}`);
    for (const key of actual) if (!expected.has(key)) problems.push(`src/locales/${locale}/${ns}.json：多出 ${key}（${reference} 沒有）`);
  }
  for (const locale of LOCALES) {
    for (const [key, value] of flatten(resources[locale][ns])) {
      for (const text of Array.isArray(value) ? value : [value]) {
        if (typeof text === 'string' && !text.trim() && !(ns === 'common' && key === 'gap')) problems.push(`src/locales/${locale}/${ns}.json：${key} 是空字串`);
        if (locale === 'en' && typeof text === 'string' && /[\u3400-\u9fff]/.test(text)) problems.push(`src/locales/en/${ns}.json：${key} 還是中文`);
      }
    }
  }
}

// 樣式庫：每個清單的每個選項都要有英日名稱。
const libraries = await import(pathToFileURL(path.join(root, 'shared', 'libraries.mjs')).href);
for (const locale of LOCALES.filter((item) => item !== SOURCE)) {
  for (const [name, list] of Object.entries(libraries)) {
    if (!Array.isArray(list) || !list.some((item) => item && typeof item === 'object' && 'label' in item)) continue;
    for (const option of list) {
      const entry = resources[locale].lib?.[name]?.[option.id];
      const label = typeof entry === 'string' ? entry : entry?.label;
      if (!label) problems.push(`src/locales/${locale}/lib.json：缺少 ${name}.${option.id}（${option.label}）`);
      if (option.hint && !entry?.hint) problems.push(`src/locales/${locale}/lib.json：缺少 ${name}.${option.id}.hint`);
      if (option.steps && entry?.steps?.length !== option.steps.length) problems.push(`src/locales/${locale}/lib.json：${name}.${option.id}.steps 數量不對`);
    }
  }
}

// shared 模組用到的 key（狀態、設定差異、比較）都要有英日翻譯。
const sharedKeys = new Set();
const workspace = await import(pathToFileURL(path.join(root, 'shared', 'agent-workspace.mjs')).href);
for (const key of Object.keys(workspace.jobStatusText)) sharedKeys.add(`job.status.${key}`);
for (const key of Object.keys(workspace.jobActionText)) sharedKeys.add(`job.action.${key}`);
sharedKeys.add('comparison.noOutfit');
for (const key of Object.keys(workspace.comparisonText.view)) sharedKeys.add(`comparison.view.${key}`);
const diff = readFileSync(path.join(root, 'shared', 'character-diff.mjs'), 'utf8');
for (const match of diff.matchAll(/\bT\(\s*[`']([\w.${}]+)[`']/g)) if (!match[1].includes('${')) sharedKeys.add(`diff.${match[1]}`);
for (const field of ['hairStyle', 'outfitStyle', 'age', 'headRatio', 'build', 'height', 'length', 'volume', 'bangs', 'texture', 'color', 'accent', 'mood', 'eyeShape', 'brows', 'eyeColor', 'silhouette', 'layers', 'detail']) sharedKeys.add(`diff.field.${field}`);
for (const locale of LOCALES.filter((item) => item !== SOURCE)) {
  const have = keysOf(locale, 'shared');
  for (const key of sharedKeys) if (!have.has(key)) problems.push(`src/locales/${locale}/shared.json：缺少 ${key}`);
}

// 錯誤代碼：server 丟出的每個代碼都要有英日說明。
const errorCodes = new Set();
for (const file of [...walk(path.join(root, 'server')), ...walk(path.join(root, 'shared'))].filter((item) => item.endsWith('.mjs'))) {
  const code = readFileSync(file, 'utf8');
  for (const match of code.matchAll(/new DomainError\((?:[^()]|\([^()]*\))*?,\s*\d{3},\s*'([A-Z_]+)'/g)) errorCodes.add(match[1]);
  for (const match of code.matchAll(/code: '([A-Z_]+)'/g)) errorCodes.add(match[1]);
}
for (const locale of LOCALES.filter((item) => item !== SOURCE)) {
  for (const code of errorCodes) if (!resources[locale].errors?.[code]) problems.push(`src/locales/${locale}/errors.json：缺少 ${code}`);
}

// 用變數組出來的 key（`ns.前綴.${值}`）：每個前綴都要登記可能的值，每個值三種語言都要有翻譯。
// 新增這種寫法時，把前綴和它的值加進這張表。
const annotations = await import(pathToFileURL(path.join(root, 'shared', 'canvas-annotations.mjs')).href);
const views = ['front', 'full', 'back', 'detail'];
const roles = ['style', 'identity', 'color', 'clothing', 'material', 'composition'];
const historyKeys = ['demoCreated', 'draftCreated', 'settingsUpdated', 'proposalAccepted', 'decomposeAdded', 'decomposeMoved', 'sheetAdopted', 'partAdopted', 'partAdoptedPlain', 'restored'];
const dynamicKeys = {
  'app.prompt.view': views,
  'canvas.view': ['front', 'back', 'detail'],
  'canvas.annotation.kind': annotations.canvasAnnotationKinds,
  'canvas.annotation.edit': annotations.canvasAnnotationKinds,
  'canvas.annotation.remove': annotations.canvasAnnotationKinds,
  'canvas.annotation.tone': annotations.canvasAnnotationTones,
  'canvas.annotation.textAria': ['note', 'text'],
  'canvas.annotation.placeholder': ['note', 'text'],
  'canvas.annotation.emptyHint': ['note', 'text'],
  'creator.categories': ['persona', 'body', 'hair', 'face', 'outfit', 'color', 'gear', 'style'],
  'creator.hints': ['persona', 'body', 'hair', 'face', 'outfit', 'color', 'gear', 'style'],
  'creator.style.presetNotes': libraries.mixerPresets.map((preset) => preset.id),
  'creator.style.groups': libraries.mixerGroups.map((group) => group.id),
  'creator.style.roles': roles,
  'gallery.adopted': ['main', 'design', ...views],
  'gallery.view': views,
  'gallery.filter': ['all', 'main', 'gear'],
  'history': historyKeys,
  'history.view': views,
  'panels.part.kinds': ['accessory', 'garment', 'footwear', 'hair', 'weapon', 'body', 'other'],
  'panels.reference.roles': roles,
  'summon.reference.role': [...roles, 'other'],
};
const handledElsewhere = new Set(['shared', 'errors', 'lib']);
for (const file of sourceFiles) {
  const code = readFileSync(file, 'utf8');
  for (const match of code.matchAll(/`([a-zA-Z][\w-]*(?:\.[\w-]+)*)\.\$\{/g)) {
    const prefix = match[1];
    if (!namespaces.has(prefix.split('.')[0]) || handledElsewhere.has(prefix)) continue;
    if (!dynamicKeys[prefix]) problems.push(`${rel(file)}：用變數組出來的 key「${prefix}.\${…}」沒有登記在 check-i18n 的 dynamicKeys`);
  }
}
for (const [prefix, values] of Object.entries(dynamicKeys)) {
  const [ns, ...rest] = prefix.split('.');
  for (const value of values) {
    const key = [...rest, value].join('.');
    for (const locale of LOCALES) if (!keysOf(locale, ns).has(key)) problems.push(`src/locales/${locale}/${ns}.json：缺少用變數組出來的 ${key}`);
  }
}

// 3. 程式用到的 key
console.log(`check-i18n：程式用到 ${usedKeys.length} 個固定 key。`);
for (const [file, key] of usedKeys) {
  const [ns, ...rest] = key.split('.');
  const reference = resources[SOURCE][ns] ? SOURCE : 'en';
  if (!resources[reference][ns]) { problems.push(`${file}：t('${key}') 的命名空間 ${ns} 不存在`); continue; }
  if (!keysOf(reference, ns).has(base(rest.join('.')))) problems.push(`${file}：t('${key}') 找不到`);
}

if (problems.length) {
  console.error(`check-i18n：發現 ${problems.length} 個問題：\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-i18n：${sourceFiles.length} 個程式檔、${namespaces.size} 個命名空間 × ${LOCALES.length} 種語言，沒有發現問題。`);
