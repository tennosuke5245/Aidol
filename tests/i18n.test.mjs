import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, SOURCE_LOCALE, matchLocale, translate } from '../src/i18n-core.js';
import { legacyHistory } from '../src/history-legacy.js';
import { jobPresentation, jobStatusText } from '../shared/agent-workspace.mjs';
import { describeChanges } from '../shared/character-diff.mjs';
import { newCharacter } from '../shared/domain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = {};
for (const locale of LOCALES.map(item => item.id)) {
  resources[locale] = {};
  for (const name of readdirSync(path.join(root, 'src', 'locales', locale)).filter(file => file.endsWith('.json'))) {
    resources[locale][name.slice(0, -5)] = JSON.parse(readFileSync(path.join(root, 'src', 'locales', locale, name), 'utf8'));
  }
}

test('依系統語言挑介面語言；所有中文都用繁體，沒有簡體中文', () => {
  assert.deepEqual(LOCALES.map(item => item.id), ['zh-TW', 'en', 'ja']);
  assert.equal(SOURCE_LOCALE, 'zh-TW');
  for (const tag of ['zh-TW', 'zh-Hant', 'zh-HK', 'zh-CN', 'zh-Hans', 'zh']) assert.equal(matchLocale([tag]), 'zh-TW', tag);
  assert.equal(matchLocale(['ja-JP']), 'ja');
  assert.equal(matchLocale(['en-GB']), 'en');
  assert.equal(matchLocale(['fr-FR', 'ja']), 'ja', '照順序找第一個支援的語言');
  assert.equal(matchLocale(['ko-KR']), 'en', '都不支援時用英文');
  assert.equal(matchLocale([]), 'en');
});

test('翻譯：變數、英文單複數、缺字時退回繁中原文', () => {
  assert.equal(translate(resources, 'en', 'workspace.galleryCount', { count: 1 }), 'Gallery, 1 image');
  assert.equal(translate(resources, 'en', 'workspace.galleryCount', { count: 3 }), 'Gallery, 3 images');
  assert.equal(translate(resources, 'ja', 'workspace.galleryCount', { count: 3 }), 'ギャラリー、3枚');
  assert.equal(translate(resources, 'zh-TW', 'workspace.galleryCount', { count: 3 }), '圖鑑，3 張圖');
  const partial = { 'zh-TW': { demo: { only: '只有原文' } }, en: { demo: {} } };
  assert.equal(translate(partial, 'en', 'demo.only'), '只有原文');
  assert.equal(translate(partial, 'en', 'demo.missing', { defaultValue: 'fallback' }), 'fallback');
  assert.equal(translate(partial, 'en', 'demo.missing'), 'demo.missing');
});

test('工作狀態：每個狀態與按鈕都有英日翻譯，server 仍拿到繁中', () => {
  for (const locale of ['en', 'ja']) for (const key of Object.keys(jobStatusText)) {
    assert.notEqual(translate(resources, locale, `shared.job.status.${key}`, { count: 2, returned: 1, expected: 2 }), `shared.job.status.${key}`, `${locale} ${key}`);
  }
  const project = { character: { revision: 1, outfits: {}, components: {} }, candidates: [], assets: [], jobs: [] };
  const view = jobPresentation(project, { id: 'j', status: 'running', variants: 4, baseRevision: 1, progress: { startedAt: '2026-10-09' } });
  assert.equal(view.label, '繪製中 0／4');
  assert.equal(translate(resources, 'en', `shared.${view.labelKey}`, view.labelParams), 'Drawing 0/4');
});

test('設定差異：預設繁中；傳入翻譯就換成目前語言', () => {
  const before = newCharacter('demo', '凜');
  const after = structuredClone(before);
  after.name = '朔';
  after.dna = { ...after.dna, hair: { ...(after.dna?.hair || {}), style: 'bob' } };
  const zh = describeChanges(before, after);
  assert.ok(zh.some(change => change.area === '人設' && change.label === '名稱'));
  assert.ok(zh.some(change => change.label === '髮型' && change.to === '鮑伯頭'));
  const text = (key, params, source) => translate(resources, 'en', `shared.${key}`, { ...params, defaultValue: source });
  const en = describeChanges(before, after, { text, option: (list, id) => resources.en.lib[list]?.[id] });
  assert.ok(en.some(change => change.area === 'Profile' && change.label === 'Name'));
  assert.ok(en.some(change => change.label === 'Hairstyle' && change.to === 'Bob'));
});

test('舊的存檔紀錄（只有繁中原文）也能對回翻譯', () => {
  const read = message => {
    for (const [pattern, key, params] of legacyHistory) { const match = pattern.exec(message); if (match) return [key, params ? params(match) : {}]; }
    return null;
  };
  assert.deepEqual(read('AI 拆解裝備：新增 3 件'), ['decomposeAdded', { count: 3 }]);
  assert.deepEqual(read('採用風衣背面候選'), ['partAdopted', { name: '風衣', view: 'back' }]);
  assert.deepEqual(read('恢復第 12 版設定'), ['restored', { revision: 12 }]);
  for (const [, key] of legacyHistory) for (const locale of ['en', 'ja']) assert.ok(resources[locale].history[key] || resources[locale].history[`${key}_other`], `${locale} history.${key}`);
});

test('介面語言記在本機核心：換 port 也記得；舊安裝（已有自己的角色）預設繁中', async (t) => {
  const { default: fs } = await import('node:fs/promises');
  const os = await import('node:os');
  const { ProjectStore } = await import('../server/store.mjs');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aidol-pref-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await new ProjectStore({ dataDir, demo: true }).init();
  assert.deepEqual(await store.getPreferences(), {}, '只有範例角色：還沒選過，照系統語言');
  await store.createProject({ name: '舊角色', brief: '' });
  assert.deepEqual(await store.getPreferences(), { locale: 'zh-TW', inferred: true }, '已有自己的角色：語系功能前的安裝，預設繁中');
  assert.deepEqual(await store.savePreferences({ locale: 'ja' }), { locale: 'ja' });
  assert.deepEqual(await new ProjectStore({ dataDir, demo: false }).getPreferences(), { locale: 'ja' }, '重開（換 port）後仍記得');
  await assert.rejects(store.savePreferences({ locale: 'zh-CN' }), { code: 'INVALID_LOCALE' }, '不提供簡體中文');
});
