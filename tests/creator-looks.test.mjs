// 捏角色強化（2026-10-13）：自訂色、膚色、異色瞳、瞳孔、臉型與臉部特徵、挑染方式、髮型細節、種族、骰子、從圖取色。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { demoCharacter, newCharacter, validateCharacter, parseCharacterYaml, characterYaml } from '../shared/domain.mjs';
import { compileBrief, dnaRows, hasDna, appearanceLines } from '../shared/prompt-compiler.mjs';
import { describeChanges, looksChanged, mergeCharacter } from '../shared/character-diff.mjs';
import { canonChanges } from '../shared/canon.mjs';
import { rollDice, diceCategories } from '../shared/randomize.mjs';
import * as L from '../shared/libraries.mjs';
import { colorName, normalizeHex, isHex, resolveColor, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb, extractPalette, backgroundMask } from '../shared/colors.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/compile-baseline-2026-10-13.json', import.meta.url), 'utf8'));
const seeded = (seed) => { let state = seed >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; };

test('舊角色編譯出來的描述和改版前一字不差（已畫好的立繪不會被誤判成外觀改過）', () => {
  const demo = demoCharacter();
  const accent = demoCharacter(); accent.dna.hair.accent = 'pink';
  const full = demoCharacter();
  full.dna = { body: { age: 'teen', headRatio: '5.5', build: 'soft', height: 'petite' }, hair: { style: 'twin-tails', length: 'long', volume: 'fluffy', bangs: 'full', texture: 'wavy', color: 'pink', accent: 'blue' }, face: { mood: 'shy', eyeShape: 'round', brows: 'arched', eyeColor: 'violet' }, notes: '補充' };
  const cases = [['demo|{}', demo, {}], ['demo|{"framing":"frontView"}', demo, { framing: 'frontView' }], ['full|{}', full, {}], ['full|{"canon":true,"outfitId":"combat","directionId":"B"}', full, { canon: true, outfitId: 'combat', directionId: 'B' }], ['accent|{}', accent, {}]];
  for (const [key, character, options] of cases) {
    const brief = compileBrief(character, options);
    assert.equal(brief.text, fixture[key].text, `${key} 的描述變了`);
    assert.equal(brief.prompt, fixture[key].prompt, `${key} 的英文描述變了`);
  }
  // 2026-10-14 起顏色欄位多帶 swatch（畫色塊用）；欄位名與前後的值不變。
  assert.deepEqual(describeChanges(demoCharacter(), full).map(({ swatch, fromSwatch, ...change }) => change), fixture.diff, '舊欄位的設定差異也不變');
});

test('自訂色的名稱：依色相、明暗、彩度組合；英文開頭大寫；換語言用傳入的清單', () => {
  const cases = { '#9FD3E6': ['淺水藍', 'light cyan'], '#FF0000': ['鮮紅', 'vivid red'], '#D8DAE0': ['白', 'white'], '#2F302F': ['深灰', 'dark gray'], '#B9A3E3': ['淺紫', 'light purple'], '#D9A3AE': ['淺粉紅', 'light pink'], '#8B4513': ['棕', 'brown'], '#D2B48C': ['淺棕', 'light brown'], '#808000': ['橄欖綠', 'olive'], '#000000': ['黑', 'black'], '#1E90FF': ['鮮藍', 'vivid blue'] };
  for (const [hex, [label, prompt]] of Object.entries(cases)) {
    const name = colorName(hex);
    assert.equal(name.label, label, hex);
    assert.equal(name.prompt, prompt, hex);
  }
  const english = { colorHues: L.colorHues.map((item) => ({ ...item, label: item.prompt })), colorTones: L.colorTones.map((item) => ({ ...item, label: item.prompt })) };
  assert.equal(colorName('#9FD3E6', english).label, 'Light cyan');
  assert.equal(colorName('#9FD3E6', english).prompt, 'light cyan', '英文描述永遠用樣式庫原文');
  assert.equal(colorName('#000000', english).label, 'Black');
});

test('HEX 正規化與色彩空間來回轉換', () => {
  assert.equal(normalizeHex(' abc'), '#AABBCC');
  assert.equal(normalizeHex('#a1B2c3'), '#A1B2C3');
  for (const bad of ['zzz', '#12345', '', null, 12, '#1234567']) assert.equal(normalizeHex(bad), null, String(bad));
  assert.equal(isHex('#a1b2c3'), true);
  assert.equal(isHex('a1b2c3'), false);
  const random = seeded(3);
  for (let index = 0; index < 400; index += 1) {
    const hex = rgbToHex({ r: random() * 255, g: random() * 255, b: random() * 255 });
    assert.equal(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex)))), hex, `HSV ${hex}`);
    assert.equal(rgbToHex(hslToRgb(rgbToHsl(hexToRgb(hex)))), hex, `HSL ${hex}`);
  }
  assert.deepEqual(resolveColor('amber', L.eyeColors), { id: 'amber', hex: '#C28A3E', label: '琥珀', prompt: 'amber eyes', custom: false });
  assert.equal(resolveColor('#9fd3e6', L.eyeColors).hex, '#9FD3E6');
  assert.equal(resolveColor('#9fd3e6', L.eyeColors).prompt, 'light cyan (#9FD3E6)');
  assert.equal(resolveColor('nope', L.eyeColors), null);
});

test('角色格式：顏色欄位收預設代號或 #RRGGBB；新欄位都是選填；不合法的擋下來', () => {
  const character = demoCharacter();
  Object.assign(character.dna.hair, { color: '#9fd3e6', accent: '#B9A3E3', accentStyle: 'ombre', extras: ['ahoge', 'braid'] });
  Object.assign(character.dna.face, { eyeColorLeft: '#3DA5D9', pupil: 'slit', shape: 'sharp', marks: ['mole', 'blush'] });
  character.dna.body.skin = 'tan';
  character.dna.species = { kind: 'fox', ears: 'fox', horns: 'none', tail: 'nineFox', wings: 'none', extras: ['fangs'], color: '#F2E6D0' };
  validateCharacter(character);
  assert.deepEqual(parseCharacterYaml(characterYaml(character)).dna, character.dna, 'YAML 存讀一圈不變');
  const bad = (mutate, why) => { const copy = structuredClone(character); mutate(copy); assert.throws(() => validateCharacter(copy), (error) => error.code === 'INVALID_CHARACTER', why); };
  bad((copy) => { copy.dna.hair.color = '#12345'; }, 'HEX 少一位');
  bad((copy) => { copy.dna.hair.color = 'crimson'; }, '不認識的代號');
  bad((copy) => { copy.dna.face.marks = ['mole', 'mole']; }, '複選不可重複');
  bad((copy) => { copy.dna.species.color = 'red'; }, '特徵色只能是 HEX');
  bad((copy) => { copy.dna.species.wings = 'jet'; }, '不認識的翅膀');
  bad((copy) => { copy.dna.body.skin = '#GGGGGG'; }, '不是十六進位');
  bad((copy) => { copy.dna.species.extra = 'x'; }, '種族不收多的欄位');
  const blank = newCharacter('blank', '空白');
  blank.dna = { face: { eyeColorLeft: null }, hair: { accent: null }, species: { color: null } };
  validateCharacter(blank);
});

test('新欄位的描述：自訂色寫名稱與 HEX、挑染方式、異色瞳寫清楚左右、種族放在第一段', () => {
  const character = demoCharacter();
  Object.assign(character.dna.hair, { color: '#9FD3E6', accent: '#B9A3E3', accentStyle: 'ombre', extras: ['ahoge'] });
  Object.assign(character.dna.face, { eyeColorLeft: '#3DA5D9', pupil: 'slit', shape: 'sharp', marks: ['mole'] });
  character.dna.body.skin = '#F0D0C0';
  character.dna.species = { kind: 'fox', ears: 'fox', tail: 'nineFox', extras: ['fangs'], color: '#F2E6D0' };
  const brief = compileBrief(character, { framing: 'frontView' });
  const lines = appearanceLines(brief.text).split('\n');
  assert.ok(lines[0].startsWith('- 種族：狐耳族・狐耳・九尾・虎牙・耳朵、尾巴是'), lines[0]);
  assert.ok(lines[0].endsWith('#F2E6D0'));
  assert.ok(lines[1].endsWith('膚色 #F0D0C0'), lines[1]);
  assert.ok(lines[2].includes('・淺水藍 #9FD3E6・髮尾漸層成淺紫 #B9A3E3・呆毛'), lines[2]);
  assert.ok(lines[3].includes('異色瞳（右眼琥珀、左眼水藍 #3DA5D9；以角色自己的左右為準，正面時右眼在畫面左邊）・豎瞳・尖下巴・淚痣'), lines[3]);
  assert.ok(brief.prompt.startsWith('kemonomimi (animal-eared human), large fox ears on top of the head, nine fluffy fox tails, small visible fangs, ears and tails colored pale orange (#F2E6D0), '), brief.prompt.slice(0, 220));
  assert.ok(brief.prompt.includes('light cyan hair (#9FD3E6), hair gradient fading into light purple (#B9A3E3) toward the tips, a single ahoge strand'));
  assert.ok(brief.prompt.includes("heterochromia: right eye amber, left eye cyan (#3DA5D9) (the character's own right and left; in a front view the right eye is on the viewer's left)"));
  assert.ok(brief.prompt.includes('skin tone (#F0D0C0)'));
  // 左右眼一樣的時候不寫異色瞳；只有左眼有值時當兩眼同色。
  character.dna.face.eyeColorLeft = 'amber';
  assert.ok(!compileBrief(character).text.includes('異色瞳'));
  delete character.dna.face.eyeColor; character.dna.face.eyeColorLeft = 'teal';
  assert.ok(compileBrief(character).prompt.includes('teal eyes'));
  // 人類、人耳、沒有角不寫；沒有特徵時特徵色也不寫。
  character.dna.species = { kind: 'human', ears: 'human', horns: 'none', tail: 'none', wings: 'none', color: '#000000' };
  assert.ok(!compileBrief(character).text.includes('種族'));
  // 摘要：髮色、眼色用色塊，文字不重複。
  const rows = dnaRows(character);
  assert.equal(rows[1].swatch, '#9FD3E6');
  assert.ok(!rows[1].value.includes('#9FD3E6'));
  const species = newCharacter('s', 's'); species.dna = { species: { kind: 'elf', ears: 'long' } };
  assert.equal(hasDna(species), true);
});

test('設定差異與定稿例外：自訂色寫名稱與 HEX、複選列出全部、種族列成外觀改動', () => {
  const before = demoCharacter();
  const after = structuredClone(before);
  after.dna.hair.color = '#9FD3E6';
  after.dna.face.eyeColorLeft = 'teal';
  after.dna.face.marks = ['mole', 'freckles'];
  after.dna.species = { kind: 'dragon', horns: 'dragon', color: '#A8423A' };
  const changes = describeChanges(before, after);
  const find = (label) => changes.find((change) => change.label === label);
  assert.deepEqual([find('髮色').from, find('髮色').to], ['銀白', '淺水藍 #9FD3E6']);
  assert.deepEqual([find('左眼顏色（異色瞳）').from, find('左眼顏色（異色瞳）').to], ['和右眼一樣', '青']);
  assert.deepEqual([find('臉部特徵').from, find('臉部特徵').to], ['無', '淚痣、雀斑']);
  assert.equal(find('種族').to, '龍人');
  assert.equal(find('角').to, '龍角');
  assert.equal(find('特徵色').to, '紅 #A8423A');
  const translated = describeChanges(before, after, { text: (key, params, source) => `[${key}]`, option: (list, id) => `${list}:${id}`, color: () => 'Light cyan', list: (items) => items.join(' + ') });
  assert.ok(translated.some((change) => change.label === '[diff.field.color]' && change.to === 'Light cyan #9FD3E6'));
  assert.ok(translated.some((change) => change.label === '[diff.field.faceMarks]' && change.to === 'faceMarks:mole + faceMarks:freckles'));
  // 定稿之後才加的種族要列給 AI。
  const canon = demoCharacter();
  canon.style.references[0].canon = true;
  const later = structuredClone(canon); later.revision = 2; later.dna.species = { kind: 'cat', ears: 'cat', tail: 'cat' };
  const list = canonChanges([{ revision: 1, character: canon }], later, { outfitId: 'combat' });
  assert.ok(list.some((change) => change.label === '耳朵' && change.to === '貓耳'), JSON.stringify(list));
  // 三方合併：提案只改了種族，使用者同時改了髮色，兩邊都留下。
  const base = demoCharacter();
  const theirs = structuredClone(base); theirs.dna.species = { kind: 'elf', ears: 'long' };
  const ours = structuredClone(base); ours.dna.hair.color = '#123456';
  const merged = mergeCharacter(base, theirs, ours);
  assert.deepEqual(merged.dna.species, { kind: 'elf', ears: 'long' });
  assert.equal(merged.dna.hair.color, '#123456');
});

test('骰子：只換目前這一頁；年齡不骰；結果都通過格式驗證', () => {
  const random = seeded(11);
  for (let index = 0; index < 200; index += 1) {
    const character = index % 2 ? demoCharacter() : newCharacter('x', 'x');
    for (const category of diceCategories) rollDice(character, category, { rng: random });
    validateCharacter(character);
    compileBrief(character);
  }
  const character = demoCharacter();
  const before = structuredClone(character);
  rollDice(character, 'body', { rng: seeded(5) });
  assert.equal(character.dna.body.age, before.dna.body.age, '年齡不骰');
  assert.deepEqual(character.dna.hair, before.dna.hair, '骰身形不動髮型');
  assert.deepEqual(character.persona, before.persona);
  assert.deepEqual(character.locks, before.locks);
  rollDice(character, 'outfit', { rng: seeded(9), outfitId: 'combat' });
  const colors = character.outfits.combat.spec.colors;
  assert.ok(colors.length >= 2 && colors.length <= 3 && new Set(colors).size === colors.length && colors.every((id) => character.palette.some((swatch) => swatch.id === id)));
  assert.equal(rollDice(character, 'persona'), false, '角色頁沒有骰子');
  const species = newCharacter('s', 's');
  rollDice(species, 'species', { rng: () => 0.99 });
  assert.equal(species.dna.species.kind, L.speciesKinds.filter((kind) => kind.preset && kind.id !== 'human').at(-1).id);
});

// 合成圖：淺灰漸層背景、黑色線條框住的紅色上衣與藍色褲子、膚色的臉；褲子貼到下緣（不能被當成背景）。
function synthetic({ transparent = false } = {}) {
  const width = 60, height = 90;
  const data = new Uint8ClampedArray(width * height * 4);
  const put = (x, y, [r, g, b], a = 255) => { const index = (y * width + x) * 4; data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = a; };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) put(x, y, transparent ? [0, 0, 0] : [214 - Math.round(y / 6), 213 - Math.round(y / 6), 213 - Math.round(y / 6)], transparent ? 0 : 255);
  const box = (x0, y0, x1, y1, color) => { for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) put(x, y, (x === x0 || x === x1 || y === y0) ? [20, 20, 24] : color); };
  box(22, 8, 38, 24, [240, 205, 190]);
  box(16, 25, 44, 55, [200, 40, 50]);
  box(18, 56, 42, 89, [40, 70, 160]);
  return { data, width, height };
}

test('從圖片取色：背景（含漸層、透明）排除，人物的主要顏色都抓到，貼邊的衣服不會被當背景', () => {
  for (const transparent of [false, true]) {
    const { data, width, height } = synthetic({ transparent });
    const mask = backgroundMask(data, width, height);
    const index = (x, y) => y * width + x;
    assert.equal(mask[index(2, 2)], 1, '角落是背景');
    assert.equal(mask[index(30, 80)], 0, '貼到下緣的褲子不是背景');
    const colors = extractPalette(data, width, height, { count: 6 });
    const near = (hex, target) => { const a = hexToRgb(hex), b = hexToRgb(target); return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) < 30; };
    for (const target of ['#C82832', '#2846A0', '#F0CDBE']) assert.ok(colors.some((color) => near(color.hex, target)), `${transparent ? '透明' : '漸層'}背景：要抓到 ${target}，實際 ${JSON.stringify(colors)}`);
    assert.ok(!colors.some((color) => near(color.hex, '#D0CFCF')), '背景色不能出現');
    assert.deepEqual(extractPalette(data, width, height, { count: 6 }), colors, '同一張圖每次結果一樣');
  }
  // 全部透明：沒有顏色。
  assert.deepEqual(extractPalette(new Uint8ClampedArray(4 * 4 * 4), 4, 4), []);
});

test('取色：胸像的衣服佔滿下緣與兩側下半也不會被當背景；頭髮貼到上緣也不會', () => {
  const width = 100, height = 150;
  const make = (transparent) => {
    const data = new Uint8ClampedArray(width * height * 4);
    const put = (x, y, [r, g, b], a = 255) => { const index = (y * width + x) * 4; data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = a; };
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) put(x, y, transparent ? [0, 0, 0] : [228 - Math.round(y / 10), 228 - Math.round(y / 10), 236 - Math.round(y / 10)], transparent ? 0 : 255);
    for (let y = 20; y < 70; y += 1) for (let x = 30; x < 70; x += 1) put(x, y, (x === 30 || x === 69 || y === 20) ? [20, 20, 24] : [240, 205, 190]);
    // 深藍外套：佔滿下緣，兩側從 y=80 一路貼到底。
    for (let y = 70; y < height; y += 1) for (let x = 0; x < width; x += 1) if (y >= 80 || (x > 15 && x < 85)) put(x, y, y === 70 || y === 80 ? [20, 20, 24] : [40, 52, 96]);
    return data;
  };
  for (const transparent of [false, true]) {
    const colors = extractPalette(make(transparent), width, height, { count: 6 });
    const near = (hex, target) => { const a = hexToRgb(hex), b = hexToRgb(target); return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) < 30; };
    assert.ok(colors.some((color) => near(color.hex, '#283460')), `外套要留著（${transparent ? '透明' : '漸層'}）：${JSON.stringify(colors)}`);
    assert.ok(colors.some((color) => near(color.hex, '#F0CDBE')), `臉要留著：${JSON.stringify(colors)}`);
    if (!transparent) assert.ok(!colors.some((color) => near(color.hex, '#E0E0E8')), `背景不能留著：${JSON.stringify(colors)}`);
  }
  // 頭髮貼到上緣、兩側不是同一個顏色：不去背景（寧可多留，不要把頭髮吃掉）。
  const data = new Uint8ClampedArray(40 * 40 * 4);
  for (let index = 0; index < 40 * 40; index += 1) { const x = index % 40; data.set(x < 20 ? [30, 30, 30, 255] : [200, 60, 60, 255], index * 4); }
  assert.equal(backgroundMask(data, 40, 40).reduce((sum, value) => sum + value, 0), 0);
});

test('審查修正：尖耳不上特徵色、九尾用複數、自訂膚色用最接近的膚色名、大小寫不同的 HEX 視為同色', () => {
  const elf = demoCharacter();
  elf.dna.species = { kind: 'elf', ears: 'long', color: '#A8423A' };
  assert.ok(!compileBrief(elf).text.includes('耳朵是'), compileBrief(elf).text);
  elf.dna.species.tail = 'nineFox';
  assert.ok(compileBrief(elf).prompt.includes('tails colored red (#A8423A)'), compileBrief(elf).prompt);
  const skin = demoCharacter(); skin.dna.body.skin = '#EAC4A8';
  assert.ok(compileBrief(skin).text.includes('自然膚色 #EAC4A8'));
  assert.ok(compileBrief(skin).prompt.includes('fair skin tone (#EAC4A8)'));
  skin.dna.body.skin = '#3060C0';
  assert.ok(compileBrief(skin).prompt.includes('blue skin tone (#3060C0)'), '離預設膚色很遠的（例如藍色皮膚）照顏色命名');
  const eyes = demoCharacter(); eyes.dna.face.eyeColor = '#3DA5D9'; eyes.dna.face.eyeColorLeft = '#3da5d9';
  assert.ok(!compileBrief(eyes).text.includes('異色瞳'));
  const lower = structuredClone(eyes); lower.dna.face.eyeColor = '#3da5d9';
  assert.deepEqual(describeChanges(eyes, lower), [], '只差大小寫不算改動');
});

test('審查修正：定稿後點「人類」不會多出假的改動；異色瞳時右眼寫成右眼', () => {
  const canon = demoCharacter();
  canon.style.references[0].canon = true;
  const human = structuredClone(canon); human.revision = 2;
  human.dna.species = { kind: 'human', ears: 'human', horns: 'none', tail: 'none', wings: 'none' };
  assert.deepEqual(canonChanges([{ revision: 1, character: canon }], human, { outfitId: 'combat' }), []);
  assert.equal(compileBrief(human).text, compileBrief(canon).text);
  const before = demoCharacter(); before.dna.face.eyeColorLeft = 'teal';
  const after = structuredClone(before); after.dna.face.eyeColor = 'red';
  assert.deepEqual(describeChanges(before, after).map((change) => [change.label, change.from, change.to]), [['右眼顏色（異色瞳）', '琥珀', '赤']]);
  const off = structuredClone(before); off.dna.face.eyeColorLeft = null;
  assert.deepEqual(describeChanges(before, off).map((change) => [change.label, change.from, change.to]), [['左眼顏色（異色瞳）', '青', '和右眼一樣']]);
});

test('looksChanged（2026-10-14）：改到長相才算；人設文字、名稱不算；穿戴位置、整個拿掉、裝備種類也算', () => {
  const base = demoCharacter('p');
  const edit = (mutate) => { const next = structuredClone(base); mutate(next); return next; };
  assert.equal(looksChanged(base, structuredClone(base)), false);
  assert.equal(looksChanged(base, edit((c) => { c.persona.description = '新故事'; c.name = '別名'; })), false, '人設文字、名稱不算');
  assert.equal(looksChanged(base, edit((c) => { c.dna.hair = { ...(c.dna.hair || {}), color: 'black' }; })), true, '髮色');
  assert.equal(looksChanged(base, edit((c) => { c.locks = [...(c.locks || []), '左耳戴耳環']; })), true, '一定要保留的特徵');
  const outfitId = Object.keys(base.outfits)[0];
  const worn = base.outfits[outfitId].equipped[0];
  assert.ok(worn, '範例角色的主要穿搭有穿戴');
  assert.equal(looksChanged(base, edit((c) => { c.outfits[outfitId].equipped[0].anchor = '左手'; })), true, '穿戴位置');
  assert.equal(looksChanged(base, edit((c) => { c.outfits[outfitId].equipped.shift(); })), true, '整個拿掉');
  assert.equal(looksChanged(base, edit((c) => { c.outfits[outfitId].equipped.reverse(); })), false, '只換順序不算');
  assert.equal(looksChanged(base, edit((c) => { c.components[worn.componentId].kind = 'other'; })), true, '裝備種類');
  assert.equal(looksChanged(base, edit((c) => { c.components[worn.componentId].designStatus = 'confirmed'; })), false, '裝備狀態不算');
});

test('AI 提案的改動看得懂（2026-10-14）：AI 自己取的外觀欄位給中文名、套裝配色顯示色票名字、個性接起來不會有「。、」', () => {
  const before = demoCharacter('p');
  const after = structuredClone(before);
  after.identity = { ...after.identity, appearance: '高挑的信使', signature: '星環別針', zzz: '其他' };
  after.persona.traits = ['沉著。', '守信。'];
  const outfitId = Object.keys(after.outfits)[0];
  after.palette = [...(after.palette || []), { id: 'orbit-navy', name: '軌道藍', hex: '#2B3A67' }];
  after.outfits[outfitId].spec = { ...(after.outfits[outfitId].spec || {}), colors: ['orbit-navy'] };
  const changes = describeChanges(before, after);
  const labels = changes.map(change => change.label);
  assert.ok(labels.includes('外觀描述') && labels.includes('招牌特徵') && labels.includes('其他外觀描述（zzz）'), labels.join('|'));
  assert.ok(!labels.some(label => /appearance|signature/.test(label)), '認得的欄位不顯示英文欄位名');
  assert.equal(changes.find(change => change.label === '個性').to, '沉著、守信');
  assert.match(changes.find(change => change.areaKey === 'outfits' && /配色/.test(change.label)).to, /軌道藍/);
  // constructor、__proto__ 這類欄位名不會查到物件內建的東西而壞掉；中日文的欄位名直接用。
  const odd = structuredClone(before);
  odd.identity = { ...odd.identity, constructor: '甲', ['__proto__']: '乙', 刺青: '左臂' };
  Object.defineProperty(odd.identity, '__proto__', { value: '乙', enumerable: true, configurable: true, writable: true });
  const oddLabels = describeChanges(before, odd).map(change => change.label);
  assert.ok(oddLabels.includes('其他外觀描述（constructor）') && oddLabels.includes('刺青'), oddLabels.join('|'));
  // 只差句尾標點：照原文列（不會出現「A → A」）；英文的句點、驚嘆號不動。
  const punct = structuredClone(before);
  punct.persona.traits = (before.persona.traits || []).map(trait => `${trait}。`);
  const trait = describeChanges(before, punct).find(change => change.label === '個性');
  assert.notEqual(trait.from, trait.to);
  const ascii = structuredClone(before);
  ascii.locks = ['A.I. 頭盔', 'GO!'];
  assert.match(describeChanges(before, ascii).find(change => change.areaKey === 'locks').to, /A\.I\. 頭盔；GO!/);
});
