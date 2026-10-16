// 設定資料集（2026-10-14 起）：放什麼、順序、文字由 shared/model-sheet.mjs 決定，這裡直接驗內容（畫布繪製在畫面測試看）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../shared/libraries.mjs';
import { buildSheet, profileRows, safeFileName, sheetAvailability, SHEET_SECTIONS } from '../shared/model-sheet.mjs';

const labels = {
  separator: '、', metaSeparator: '・', profileTitle: '設定', turnaroundTitle: '三視圖', expressionsTitle: '表情集', outfitsTitle: '衣櫃', gearTitle: '裝備', paletteTitle: '配色表', notesTitle: '設計標註',
  species: '種族', body: '身形', skin: '膚色', hair: '頭髮', eyes: '眼睛', face: '臉', locks: '一定要保留', staleSuffix: '（舊設計）', mainBadge: '主要', untitledOutfit: '未命名套裝',
  heterochromia: (right, left) => `右眼${right}、左眼${left}`, noteHeading: (title, view) => `${title}（${view}）`, featureColor: (color) => `特徵色${color}`,
  views: { front: '正面', side: '側面', back: '背面', frontQuarter: '斜前方', backQuarter: '斜後方', otherSide: '另一側' },
};

const asset = (id, extra = {}) => ({ id, url: `/api/projects/p/assets/${id}`, role: 'design', view: 'front', targetId: 'character', ...extra });
function sample() {
  return {
    id: 'p',
    character: {
      name: '汐', persona: { description: '在軌道城市之間送信的冷靜少女。', traits: ['沉著', '守信'] },
      locks: ['銀白短髮', '星環別針在左胸'],
      dna: {
        species: { kind: 'cat', ears: 'cat', tail: 'cat', horns: 'none', wings: 'none', extras: [], color: '#2B2B33' },
        body: { age: 'teen', headRatio: 'h6', height: 'short', build: 'slim', skin: '#F2D5C4' },
        hair: { style: 'layered', color: 'silver', accent: '#4AA3DF', accentStyle: 'inner', extras: ['ahoge'] },
        face: { eyeColor: 'amber', eyeColorLeft: 'teal', pupil: 'slit', shape: 'oval', marks: ['mole'] },
      },
      palette: [{ id: 'sw1', name: '霧白', hex: '#f4f1ea', use: 'primary' }, { id: 'sw2', name: '軌道藍', hex: '#2B3A67' }],
      components: {
        hair: { id: 'hair', name: '銀白短髮', kind: 'hair', description: '', designStatus: 'confirmed', assetId: 'part-hair' },
        coat: { id: 'coat', name: '信使外套', kind: 'garment', description: '深藍短外套，衣襬落在上臀。', designStatus: 'confirmed', assetId: 'part-coat' },
        belt: { id: 'belt', name: '工具腰帶', kind: 'accessory', description: '', designStatus: 'draft', crop: { assetId: 'main', x: 0.3, y: 0.5, width: 0.2, height: 0.1 } },
        pin: { id: 'pin', name: '星環別針', kind: 'accessory', description: '缺口朝右上。', designStatus: 'draft' },
      },
      outfits: { combat: { id: 'combat', name: '主要穿搭', equipped: [] }, sleep: { id: 'sleep', name: '睡衣', equipped: [] }, school: { id: 'school', name: '制服', equipped: [] } },
      adopted: { character: 'main' },
    },
    assets: [asset('main', { outfitId: 'combat' }), asset('front-crop', { role: 'view' }), asset('side-crop', { role: 'view', view: 'side' }), asset('back-crop', { role: 'view', view: 'back' }),
      asset('joy', { view: 'expression' }), asset('anger', { view: 'expression' }), asset('sleep-1', { outfitId: 'sleep' }), asset('part-hair', { targetId: 'hair' }), asset('part-coat', { targetId: 'coat' })],
    views: { status: 'done', assetId: 'main', items: { front: { assetId: 'front-crop' }, side: { assetId: 'side-crop' }, back: { assetId: 'back-crop' } } },
    viewNotes: [{ id: 'n1', view: 'front', x: 0.4, y: 0.3, title: '別針', text: '在左胸' }, { id: 'n2', view: 'otherSide', x: 0.5, y: 0.5, title: '不顯示', text: '' }, { id: 'n3', view: 'side', x: 0.6, y: 0.7, title: '', text: '尾巴從腰後長出來' }],
    expressions: { list: ['neutral', 'joy', 'anger'], items: { joy: { assetId: 'joy', sourceMain: 'main' }, anger: { assetId: 'anger', sourceMain: 'old-main' } } },
    wardrobe: { items: { sleep: { assetId: 'sleep-1' } } },
  };
}

test('設定資料集：每個區塊有沒有內容可放', () => {
  const project = sample();
  assert.deepEqual(sheetAvailability(project), { portrait: 1, profile: 1, turnaround: 3, expressions: 2, outfits: 2, gear: 3, palette: 2 });
  // 三視圖只有正面、或不是照目前的正式立繪拆的：不放（和正式立繪重複／舊的）。
  const onlyFront = sample();
  onlyFront.views.items = { front: { assetId: 'front-crop' } };
  assert.equal(sheetAvailability(onlyFront).turnaround, 0);
  const stale = sample();
  stale.views.assetId = 'old-main';
  assert.equal(sheetAvailability(stale).turnaround, 0);
  // 衣櫃只有主要那套有圖：不放。
  const single = sample();
  single.wardrobe = { items: {} };
  assert.equal(sheetAvailability(single).outfits, 0);
  // 還沒有正式立繪：沒有立繪、沒有衣櫃，設定照樣可以放。
  const fresh = sample();
  fresh.character.adopted = {};
  const counts = sheetAvailability(fresh);
  assert.equal(counts.portrait, 0);
  assert.equal(counts.profile, 1);
  assert.equal(counts.outfits, 0);
  // 什麼都還沒設定的新角色：設定區沒東西可寫，不能勾（不會只印一個空標題）。
  assert.equal(sheetAvailability({ id: 'n', character: { name: '新角色', persona: { description: '', traits: [] }, locks: [], dna: { species: { kind: 'human', ears: 'human' } } }, assets: [] }).profile, 0);
  // 表情的名稱查不到（已經不在這套表情裡）：不放。
  const orphan = sample();
  orphan.expressions.list.push('custom-gone');
  orphan.expressions.items['custom-gone'] = { assetId: 'joy' };
  assert.equal(sheetAvailability(orphan).expressions, 2);
});

test('設定資料集：區塊順序、標題、三視圖的標註編號、表情的舊設計、衣櫃的主要那套、裝備的圖、配色表', () => {
  const sheet = buildSheet(sample(), {}, lib, labels);
  assert.equal(sheet.title, '汐');
  assert.equal(sheet.subtitle, '沉著、守信', '副標預設是個性');
  assert.deepEqual(sheet.sections.map((section) => section.id), ['overview', 'turnaround', 'expressions', 'outfits', 'gear', 'palette']);
  const [overview, turnaround, expressions, outfits, gear, palette] = sheet.sections;
  assert.equal(overview.image.url, '/api/projects/p/assets/main');
  assert.deepEqual(overview.profile.locks, ['銀白短髮', '星環別針在左胸']);
  assert.deepEqual(turnaround.items.map((item) => item.label), ['正面', '側面', '背面']);
  assert.deepEqual(turnaround.items[0].pins, [{ number: 1, x: 0.4, y: 0.3 }]);
  assert.deepEqual(turnaround.items[1].pins, [{ number: 3, x: 0.6, y: 0.7 }], '編號照全部標註的順序（和並排看一樣）');
  assert.deepEqual(turnaround.notes, [{ number: 1, heading: '別針（正面）', text: '在左胸' }, { number: 3, heading: '側面', text: '尾巴從腰後長出來' }], '不在圖上的角度的標註不列');
  assert.deepEqual(expressions.items.map((item) => item.label), ['開心', '生氣（舊設計）']);
  assert.deepEqual(outfits.items.map((item) => [item.label, item.badge]), [['主要穿搭', '主要'], ['睡衣', '']], '沒有立繪的套裝不放');
  assert.deepEqual(gear.items.map((item) => [item.label, Boolean(item.url), Boolean(item.crop)]), [['信使外套', true, false], ['工具腰帶', true, true], ['星環別針', false, false]], '頭髮不算裝備；沒設計圖時從立繪裁一塊');
  assert.equal(gear.items[1].url, '/api/projects/p/assets/main');
  const reordered = sample();
  reordered.character.components = { pin: reordered.character.components.pin, coat: reordered.character.components.coat };
  assert.deepEqual(buildSheet(reordered, { sections: ['gear'] }, lib, labels).sections[0].items.map((item) => item.label), ['信使外套', '星環別針'], '只有文字的排在有圖的後面');
  assert.deepEqual(palette.items, [{ name: '霧白', hex: '#F4F1EA', meta: '主色・#F4F1EA' }, { name: '軌道藍', hex: '#2B3A67', meta: '#2B3A67' }]);
});

test('設定資料集：只勾部分區塊、自訂標題副標；沒勾正式立繪時設定照樣放', () => {
  const sheet = buildSheet(sample(), { sections: ['profile', 'palette'], title: '  汐・委託用  ', subtitle: '' }, lib, labels);
  assert.equal(sheet.title, '汐・委託用');
  assert.equal(sheet.subtitle, '');
  assert.deepEqual(sheet.sections.map((section) => section.id), ['overview', 'palette']);
  assert.equal(sheet.sections[0].image, null);
  assert.ok(sheet.sections[0].profile);
  assert.deepEqual(buildSheet(sample(), { sections: ['portrait'] }, lib, labels).sections.map((section) => [section.id, Boolean(section.profile)]), [['overview', false]]);
  assert.deepEqual(buildSheet(sample(), { sections: [] }, lib, labels).sections, []);
  assert.deepEqual(SHEET_SECTIONS, ['portrait', 'profile', 'turnaround', 'expressions', 'outfits', 'gear', 'palette']);
});

test('設定資料集的設定文字：種族、身形、自訂色的名字、異色瞳；沒設定的欄位不列', () => {
  const rows = Object.fromEntries(profileRows(sample().character, lib, labels).map((row) => [row.label, row.value]));
  assert.match(rows['種族'], /^貓耳族、/);
  assert.ok(rows['身形'].split('、').length >= 3);
  assert.ok(rows['膚色'] && !rows['膚色'].startsWith('#'), '自訂膚色用名字');
  assert.match(rows['頭髮'], /內層/, '挑染方式');
  assert.match(rows['眼睛'], /^右眼.+、左眼.+/, '異色瞳寫清楚左右');
  assert.match(rows['種族'], /特徵色/, '特徵色');
  const plain = profileRows({ name: 'x', dna: { species: { kind: 'human' } } }, lib, labels);
  assert.deepEqual(plain, [], '人類、沒填的欄位都不列');
  // 選人類但加了翅膀、光環：照樣列（和交給 AI 的一樣，不看種族）；沒選種族只有耳朵尾巴也列。
  const winged = profileRows({ name: 'x', dna: { species: { kind: 'human', ears: 'human', wings: 'feather', extras: ['halo'] } } }, lib, labels);
  assert.deepEqual(winged, [{ label: '種族', value: '羽翼、光環' }]);
  assert.deepEqual(profileRows({ name: 'x', dna: { species: { ears: 'cat', tail: 'cat' } } }, lib, labels), [{ label: '種族', value: '貓耳、貓尾' }]);
  // 挑染方式沒記（舊資料）：當挑染。
  const legacy = profileRows({ name: 'x', dna: { hair: { style: 'layered', color: 'silver', accent: '#4AA3DF' } } }, lib, labels);
  assert.match(legacy[0].value, /挑染/);
  // 只有左眼選了色：當兩眼同色，不寫成「右眼、左眼青」。
  const leftOnly = profileRows({ name: 'x', dna: { face: { eyeColorLeft: 'teal' } } }, lib, labels);
  assert.equal(leftOnly.length, 1);
  assert.doesNotMatch(leftOnly[0].value, /右眼/);
  assert.deepEqual(profileRows({ name: 'x', identity: { hair: '黑色長髮' } }, lib, labels), [{ label: '頭髮', value: '黑色長髮' }], '舊角色只有文字描述也列出來');
});

test('下載檔名：Windows 不允許的字元換掉，太長截斷', () => {
  assert.equal(safeFileName('凜：設定/草稿?'), '凜：設定_草稿_', '全形冒號可以用');
  assert.equal(safeFileName('a:b*c'), 'a_b_c');
  assert.equal(safeFileName('   '), 'AIDOL');
  assert.equal(safeFileName('a'.repeat(200)).length, 80);
  // 照字截斷：表情符號不會被切成半個。
  const emoji = safeFileName(`${'a'.repeat(79)}\u{1F431}xyz`);
  assert.equal(Array.from(emoji).length, 80);
  assert.ok(emoji.endsWith('\u{1F431}'));
});
