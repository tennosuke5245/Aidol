import YAML from 'yaml';
import Ajv from 'ajv';
import { ages, headRatios, builds, heights, hairStyles, hairLengths, hairVolumes, hairBangs, hairTextures, hairColors, moods, eyeShapes, brows, eyeColors, outfitStyles, silhouettes, layerOptions, detailOptions, paletteUses, mixerKeys, defaultMixer, ids } from './libraries.mjs';

export class DomainError extends Error {
  constructor(message, status = 422, code = 'INVALID_INPUT', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const idPattern = '^(?!(?:__proto__|constructor|prototype)$)[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$';
export const outputViews = ['front', 'full', 'back', 'detail'];
export const viewLabels = { front: '正面主圖', full: '完整主圖', back: '背面', detail: '細節' };
const id = { type: 'string', pattern: idPattern };
const text = { type: 'string', maxLength: 12000 };
const strings = { type: 'array', items: text, maxItems: 100 };
const choice = list => ({ enum: ids(list) });
const label = { type: 'string', minLength: 1, maxLength: 160 };
const unit = { type: 'number', minimum: 0, maximum: 1 };
const mixer = { type: 'object', additionalProperties: false, required: mixerKeys, properties: Object.fromEntries(mixerKeys.map(key => [key, { type: 'integer', minimum: 0, maximum: 4 }])) };
// 2.0 起的結構化角色 DNA；全部選填，舊的 schema_version 1 檔案不需改寫即可讀取。
const dna = {
  type: 'object', additionalProperties: false,
  properties: {
    body: { type: 'object', additionalProperties: false, properties: { age: choice(ages), headRatio: choice(headRatios), build: choice(builds), height: choice(heights) } },
    hair: { type: 'object', additionalProperties: false, properties: { style: choice(hairStyles), length: choice(hairLengths), volume: choice(hairVolumes), bangs: choice(hairBangs), texture: choice(hairTextures), color: choice(hairColors), accent: { anyOf: [choice(hairColors), { type: 'null' }] } } },
    face: { type: 'object', additionalProperties: false, properties: { mood: choice(moods), eyeShape: choice(eyeShapes), brows: choice(brows), eyeColor: choice(eyeColors) } },
    notes: text,
  },
};
const palette = { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'hex'], properties: { id, name: { type: 'string', minLength: 1, maxLength: 40 }, hex: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, use: choice(paletteUses) } } };
const outfitSpec = { type: 'object', additionalProperties: false, properties: { style: choice(outfitStyles), silhouette: choice(silhouettes), layers: choice(layerOptions), detail: choice(detailOptions), colors: { type: 'array', maxItems: 6, items: id } } };

export const characterSchema = {
  $id: 'https://aidol.local/schema/character-v1',
  type: 'object', additionalProperties: false,
  required: ['schema_version', 'id', 'name', 'revision', 'persona', 'identity', 'style', 'components', 'outfits', 'adopted'],
  properties: {
    schema_version: { enum: [1, 2] }, id, name: { type: 'string', minLength: 1, maxLength: 160 },
    revision: { type: 'integer', minimum: 1 },
    persona: { type: 'object', additionalProperties: false, required: ['description', 'traits'], properties: { description: text, traits: strings } },
    identity: { type: 'object', additionalProperties: text, properties: { hair: text, eyes: text } },
    dna, palette,
    locks: { type: 'array', maxItems: 12, items: label },
    style: {
      type: 'object', additionalProperties: false, required: ['id', 'name', 'description', 'references'],
      properties: {
        id, name: text, description: text,
        directions: { type: 'object', maxProperties: 6, propertyNames: id, additionalProperties: { type: 'object', additionalProperties: false, required: ['id', 'name', 'mixer'], properties: { id, name: { type: 'string', minLength: 1, maxLength: 40 }, mixer } } },
        activeDirection: id,
        references: { type: 'array', maxItems: 100, items: {
          type: 'object', additionalProperties: false, required: ['id', 'assetId', 'role', 'focus'],
          properties: { id, assetId: id, role: { enum: ['style', 'identity', 'color', 'clothing', 'composition', 'material'] }, focus: strings },
        } },
      },
    },
    components: { type: 'object', maxProperties: 100, propertyNames: id, additionalProperties: {
      type: 'object', additionalProperties: false, required: ['id', 'name', 'kind', 'description', 'designStatus'],
      properties: {
        id, name: { type: 'string', minLength: 1, maxLength: 160 }, kind: { enum: ['body', 'hair', 'garment', 'accessory', 'weapon', 'footwear', 'other'] },
        description: text, designStatus: { enum: ['draft', 'proposed', 'confirmed'] }, assetId: id,
        views: { type: 'object', propertyNames: { enum: outputViews }, additionalProperties: id },
        // 自動拆解裝備時記下這件在立繪上的位置（0–1 比例），畫布用它裁出縮圖、拉出關聯線。
        crop: { type: 'object', additionalProperties: false, required: ['assetId', 'x', 'y', 'width', 'height'], properties: { assetId: id, x: unit, y: unit, width: unit, height: unit } },
      },
    } },
    outfits: { type: 'object', maxProperties: 100, propertyNames: id, additionalProperties: {
      type: 'object', additionalProperties: false, required: ['id', 'name', 'equipped'],
      properties: { id, name: text, spec: outfitSpec, equipped: { type: 'array', maxItems: 100, items: {
        type: 'object', additionalProperties: false, required: ['id', 'componentId', 'anchor', 'enabled'],
        properties: { id, componentId: id, anchor: text, enabled: { type: 'boolean' } },
      } } },
    } },
    adopted: { type: 'object', propertyNames: id, additionalProperties: id },
  },
};

const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(characterSchema);

export function validateCharacter(character, assetIds) {
  if (!validateSchema(character)) {
    throw new DomainError('人物描述格式不正確，請檢查必要欄位與資料型別。', 422, 'INVALID_CHARACTER', validateSchema.errors.map((error) => ({ path: error.instancePath || '/', message: error.message, field: error.params.missingProperty })));
  }
  const knownAssets = assetIds ? new Set(assetIds) : null;
  const requireAsset = (assetId, location) => {
    if (knownAssets && !knownAssets.has(assetId)) throw new DomainError(`${location} 引用了不存在的圖片：${assetId}`, 422, 'UNKNOWN_ASSET');
  };
  const references = new Set();
  for (const reference of character.style.references) {
    if (references.has(reference.id)) throw new DomainError('繪風參考的 ID 不可重複。');
    references.add(reference.id);
    requireAsset(reference.assetId, '繪風參考');
  }
  for (const [key, component] of Object.entries(character.components)) {
    if (key === 'character' || key !== component.id) throw new DomainError('部件鍵名必須與部件 ID 相同，且不可使用 character。');
    if (component.assetId) requireAsset(component.assetId, component.name);
    if (component.crop) requireAsset(component.crop.assetId, component.name);
    for (const assetId of Object.values(component.views || {})) requireAsset(assetId, component.name);
  }
  for (const [key, outfit] of Object.entries(character.outfits)) {
    if (key !== outfit.id) throw new DomainError('穿搭鍵名必須與穿搭 ID 相同。');
    const slots = new Set();
    for (const equipped of outfit.equipped) {
      if (slots.has(equipped.id)) throw new DomainError('同一套穿搭中的裝備 ID 不可重複。');
      slots.add(equipped.id);
      if (!Object.hasOwn(character.components, equipped.componentId)) throw new DomainError(`穿搭引用了不存在的部件：${equipped.componentId}`, 422, 'UNKNOWN_COMPONENT');
    }
  }
  const directions = character.style.directions || {};
  for (const [key, direction] of Object.entries(directions)) if (key !== direction.id) throw new DomainError('畫風方向的鍵名必須與方向 ID 相同。');
  if (character.style.activeDirection && !Object.hasOwn(directions, character.style.activeDirection)) throw new DomainError('目前畫風方向不存在。', 422, 'UNKNOWN_DIRECTION');
  const swatches = new Set();
  for (const swatch of character.palette || []) {
    if (swatches.has(swatch.id)) throw new DomainError('色票 ID 不可重複。');
    swatches.add(swatch.id);
  }
  for (const outfit of Object.values(character.outfits)) {
    for (const color of outfit.spec?.colors || []) if (!swatches.has(color)) throw new DomainError(`穿搭配色引用了不存在的色票：${color}`, 422, 'UNKNOWN_SWATCH');
  }
  for (const [target, assetId] of Object.entries(character.adopted)) {
    if (target !== 'character' && !Object.hasOwn(character.components, target)) throw new DomainError(`採用稿引用了不存在的部件：${target}`, 422, 'UNKNOWN_COMPONENT');
    requireAsset(assetId, '採用稿');
  }
  return character;
}

export function parseCharacterYaml(source, assetIds) {
  if (typeof source !== 'string' || source.length > 500000) throw new DomainError('YAML 必須是小於 500 KB 的文字。');
  let parsed;
  try {
    const document = YAML.parseDocument(source, { uniqueKeys: true });
    if (document.errors.length) throw document.errors[0];
    parsed = document.toJS({ maxAliasCount: 20 });
  } catch {
    throw new DomainError('YAML 無法解析，請檢查縮排、重複欄位或引用。', 422, 'INVALID_YAML');
  }
  return validateCharacter(parsed, assetIds);
}

export function characterYaml(character) {
  return YAML.stringify(character, { lineWidth: 0 });
}

export function newCharacter(id, name, brief = '') {
  return {
    schema_version: 2, id, name, revision: 1,
    persona: { description: brief, traits: [] }, identity: { hair: '', eyes: '' },
    style: { id: 'default', name: '待設定繪風', description: '', references: [], directions: { A: { id: 'A', name: '日常動畫', mixer: defaultMixer() } }, activeDirection: 'A' },
    components: {}, outfits: { combat: { id: 'combat', name: '主要穿搭', equipped: [] } }, adopted: {},
  };
}

export function demoCharacter() {
  const character = newCharacter('rin', '凜', '在軌道城市之間送件的信使。沉著、敏銳，重視承諾。');
  character.persona.traits = ['沉著', '敏銳', '守信'];
  character.identity = { hair: '銀白短髮', eyes: '琥珀金色', silhouette: '俐落、輕盈的機能服輪廓' };
  character.style = { id: 'cel-anime', name: '日式賽璐珞', description: '乾淨細線稿、賽璐珞陰影、深藍與青綠配色；服裝結構清楚。', references: [
    { id: 'rin-linework-example', assetId: 'demo-rin-hair', role: 'style', focus: ['線條', '陰影'] },
    { id: 'rin-material-example', assetId: 'demo-rin-clasp', role: 'material', focus: ['金屬', '配色'] },
  ], directions: {
    A: { id: 'A', name: '輕渲染', mixer: { composition: 1, detail: 1, hairDetail: 2, rendering: 1, background: 0, accessories: 1, saturation: 2, value: 2, contrast: 2 } },
    B: { id: 'B', name: '標準', mixer: { composition: 2, detail: 2, hairDetail: 2, rendering: 2, background: 1, accessories: 2, saturation: 2, value: 2, contrast: 2 } },
  }, activeDirection: 'A' };
  character.dna = {
    body: { age: 'youngAdult', headRatio: '7.5', build: 'slim', height: 'tall' },
    hair: { style: 'layered', length: 'short', volume: 'natural', bangs: 'side', texture: 'soft', color: 'silver', accent: null },
    face: { mood: 'cool', eyeShape: 'sharp', brows: 'straight', eyeColor: 'amber' },
  };
  character.palette = [
    { id: 'silver', name: '銀白', hex: '#D8DAE0', use: 'hair' },
    { id: 'amber', name: '琥珀', hex: '#C28A3E', use: 'eyes' },
    { id: 'navy', name: '深藍', hex: '#2C3446', use: 'primary' },
    { id: 'teal', name: '青綠', hex: '#3D8A84', use: 'secondary' },
    { id: 'brass', name: '黃銅', hex: '#B38B4D', use: 'metal' },
    { id: 'ink', name: '墨', hex: '#1F1F23', use: 'accent' },
  ];
  character.locks = ['銀白短髮', '琥珀金色眼睛', '黃銅月牙扣具'];
  const definitions = [
    ['hair', '髮型', 'hair', '銀白短髮與側邊短束。'],
    ['coat', '機能外套', 'garment', '深藍機能外套，帶青綠滾邊與非對稱扣具。'],
    ['pants', '長褲', 'garment', '深色修身長褲，便於移動。'],
    ['boots', '短靴', 'footwear', '深藍短靴與青綠細節。'],
    ['clasp', '胸前扣具', 'accessory', '黃銅月牙扣具，作為信使的辨識配件。'],
  ];
  for (const [id, name, kind, description] of definitions) {
    character.components[id] = { id, name, kind, description, designStatus: 'confirmed', assetId: `demo-rin-${id}` };
    character.adopted[id] = `demo-rin-${id}`;
  }
  character.outfits.combat.spec = { style: 'traveler', silhouette: 'balanced', layers: 'layered', detail: 'functional', colors: ['navy', 'teal', 'brass'] };
  character.outfits.combat.equipped = definitions.map(([id]) => ({ id: `${id}-worn`, componentId: id, anchor: ({ hair: '頭部', coat: '軀幹', pants: '下半身', boots: '雙腳', clasp: '外套胸前' })[id], enabled: true }));
  character.adopted.character = 'demo-rin-sheet';
  return character;
}
