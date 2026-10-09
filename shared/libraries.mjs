// AIDOL 角色 DNA 與畫風混音台的共用資料表。
// 來源：character-designer（Character Mixer）的結構、樣式庫與混音台，
// 2.0 起改為中性、可擴充的資料，前端與本機核心共用同一份。
// 每個選項：id、label（介面用繁中）、prompt（交給生圖的英文描述）。

export const ages = [
  { id: 'child', label: '兒童', prompt: 'child proportions' },
  { id: 'preteen', label: '少年少女', prompt: 'pre-teen proportions' },
  { id: 'teen', label: '青少年', prompt: 'teenage proportions' },
  { id: 'youngAdult', label: '青年', prompt: 'young-adult proportions' },
  { id: 'adult', label: '成人', prompt: 'adult proportions' },
  { id: 'elder', label: '年長', prompt: 'mature older-adult proportions' },
];

export const headRatios = [
  { id: '2.5', label: '2.5 頭身', short: 'Q', prompt: 'chibi 2.5-head proportion' },
  { id: '4', label: '4 頭身', short: '4', prompt: '4-head body proportion' },
  { id: '5.5', label: '5.5 頭身', short: '5.5', prompt: '5.5-head body proportion' },
  { id: '6.5', label: '6.5 頭身', short: '6.5', prompt: '6.5-head body proportion' },
  { id: '7.5', label: '7.5 頭身', short: '7.5', prompt: '7.5-head body proportion' },
  { id: '8', label: '8 頭身', short: '8', prompt: '8-head body proportion' },
];

export const builds = [
  { id: 'delicate', label: '纖細', prompt: 'delicate light build' },
  { id: 'slim', label: '纖瘦', prompt: 'slim build' },
  { id: 'average', label: '標準', prompt: 'average build' },
  { id: 'soft', label: '柔和', prompt: 'soft rounded build' },
  { id: 'athletic', label: '健壯', prompt: 'athletic build' },
  { id: 'sturdy', label: '厚實', prompt: 'broad sturdy build' },
];

export const heights = [
  { id: 'petite', label: '嬌小', short: 'XS', prompt: 'petite height impression' },
  { id: 'short', label: '偏矮', short: 'S', prompt: 'short stature' },
  { id: 'average', label: '中等', short: 'M', prompt: 'average height impression' },
  { id: 'tall', label: '高挑', short: 'L', prompt: 'tall slender silhouette' },
  { id: 'veryTall', label: '極高', short: 'XL', prompt: 'very tall silhouette' },
];

export const hairTags = [
  { id: 'soft', label: '柔和' },
  { id: 'cool', label: '帥氣' },
  { id: 'wild', label: '野性' },
  { id: 'prince', label: '王子' },
  { id: 'sporty', label: '運動' },
  { id: 'youthful', label: '稚氣' },
  { id: 'elegant', label: '優雅' },
];

// icon：48×48 線稿圖示的髮型輪廓（頭部圓心 24,28、半徑約 10.5）。
const hairIcons = {
  crop: 'M13 28c0-9 5-15 11-15s11 6 11 15c-2-4-5-6-8-6-3 2-7 3-10 2-2 1-3 2-4 4z',
  airy: 'M13 27c0-8 5-14 11-14s11 6 11 14l-2-3-2 3-2-4-2 4-2-4-2 4-2-4-2 4-2-3z',
  side: 'M13 29c-1-10 5-16 12-16 6 0 10 5 10 13-4-5-10-7-16-6-3 2-4 5-6 9z',
  layered: 'M12 31c-1-11 5-18 12-18s13 7 12 18l-3-4-1 5-3-6c-3 1-7 1-10-1l-2 5-2-5-3 6z',
  medium: 'M12 35c-2-13 4-22 12-22s14 9 12 22l-3-6v-6c-4-3-10-4-15-2-2 2-3 5-4 8z',
  long: 'M11 41c-2-16 3-28 13-28s15 12 13 28h-4l-1-14c-3-4-8-5-12-4-3 2-4 5-5 8l-1 10z',
  bob: 'M12 34c-2-12 4-21 12-21s14 9 12 21h-4v-8c-3-4-9-5-14-3-2 2-3 5-3 7v4z',
  ponytail: 'M13 28c0-9 5-15 11-15 5 0 8 2 10 6 3-1 6 1 7 5-2 5-1 10 1 15-4-2-6-6-6-10-1-1-1-2-2-3-3-1-7 0-10 2-3 0-7 2-11 0z',
  twin: 'M13 28c0-9 5-15 11-15s11 6 11 15c-2-4-5-6-8-6-3 2-7 3-10 2-2 1-3 2-4 4zM10 24c-4 4-5 11-3 18 3-3 4-8 4-13zM38 24c4 4 5 11 3 18-3-3-4-8-4-13z',
  spiky: 'M13 28l1-6-3-3 5-1 2-5 4 3 4-4 3 4 5-2v5l4 2-3 3 1 4c-3-4-7-6-11-6-4 0-8 2-12 6z',
};

export const hairStyles = [
  { id: 'soft-short', label: '柔軟短髮', prompt: 'soft short hairstyle', tags: ['soft'], icon: hairIcons.crop, defaults: { length: 'short', volume: 'natural', bangs: 'full', texture: 'soft' } },
  { id: 'airy-bangs', label: '空氣瀏海', prompt: 'short hair with airy see-through bangs', tags: ['soft'], icon: hairIcons.airy, defaults: { length: 'short', volume: 'natural', bangs: 'airy', texture: 'wispy' } },
  { id: 'side-part', label: '旁分', prompt: 'clean side-part hairstyle', tags: ['cool', 'soft'], icon: hairIcons.side, defaults: { length: 'short', volume: 'flat', bangs: 'side', texture: 'smooth' } },
  { id: 'sleepy-messy', label: '慵懶亂髮', prompt: 'sleepy, slightly messy short hair', tags: ['soft'], icon: hairIcons.crop, defaults: { length: 'short', volume: 'natural', bangs: 'full', texture: 'wispy' } },
  { id: 'fluffy-idol', label: '蓬鬆偶像', prompt: 'fluffy idol-style hair with soft volume', tags: ['soft', 'youthful'], icon: hairIcons.airy, defaults: { length: 'short', volume: 'fluffy', bangs: 'full', texture: 'soft' } },
  { id: 'round-soft', label: '圓潤短髮', prompt: 'rounded soft short hair with a youthful silhouette', tags: ['youthful', 'soft'], icon: hairIcons.crop, defaults: { length: 'short', volume: 'natural', bangs: 'full', texture: 'soft' } },
  { id: 'clean-student', label: '清爽學生', prompt: 'neat student haircut', tags: ['soft', 'youthful'], icon: hairIcons.side, defaults: { length: 'short', volume: 'flat', bangs: 'side', texture: 'smooth' } },
  { id: 'cool-straight', label: '冷調直髮', prompt: 'cool straight layered hair', tags: ['cool'], icon: hairIcons.medium, defaults: { length: 'medium', volume: 'flat', bangs: 'center', texture: 'smooth' } },
  { id: 'layered', label: '層次短髮', prompt: 'layered short hair with a side tuft', tags: ['cool', 'wild'], icon: hairIcons.layered, defaults: { length: 'short', volume: 'natural', bangs: 'side', texture: 'soft' } },
  { id: 'layered-wolf', label: '層次狼尾', prompt: 'layered wolf-cut hairstyle', tags: ['wild', 'cool'], icon: hairIcons.layered, defaults: { length: 'medium', volume: 'natural', bangs: 'center', texture: 'wispy' } },
  { id: 'gentle-prince', label: '王子中長', prompt: 'gentle princely medium-length hair', tags: ['prince', 'elegant'], icon: hairIcons.medium, defaults: { length: 'medium', volume: 'natural', bangs: 'side', texture: 'soft' } },
  { id: 'sporty-crop', label: '運動短髮', prompt: 'sporty cropped hair', tags: ['sporty', 'cool'], icon: hairIcons.spiky, defaults: { length: 'short', volume: 'flat', bangs: 'full', texture: 'spiky' } },
  { id: 'bob', label: '鮑伯頭', prompt: 'chin-length bob', tags: ['soft', 'elegant'], icon: hairIcons.bob, defaults: { length: 'medium', volume: 'natural', bangs: 'full', texture: 'smooth' } },
  { id: 'long-straight', label: '長直髮', prompt: 'long straight hair', tags: ['elegant', 'cool'], icon: hairIcons.long, defaults: { length: 'long', volume: 'flat', bangs: 'center', texture: 'smooth' } },
  { id: 'ponytail', label: '馬尾', prompt: 'high ponytail', tags: ['sporty', 'cool'], icon: hairIcons.ponytail, defaults: { length: 'long', volume: 'natural', bangs: 'side', texture: 'smooth' } },
  { id: 'twin-tails', label: '雙馬尾', prompt: 'twin tails', tags: ['youthful', 'soft'], icon: hairIcons.twin, defaults: { length: 'long', volume: 'natural', bangs: 'full', texture: 'soft' } },
];

export const hairLengths = [
  { id: 'short', label: '短', prompt: 'short hair length' },
  { id: 'medium', label: '中', prompt: 'medium hair length' },
  { id: 'long', label: '長', prompt: 'long hair length' },
];
export const hairVolumes = [
  { id: 'flat', label: '服貼', prompt: 'flat hair volume' },
  { id: 'natural', label: '自然', prompt: 'natural hair volume' },
  { id: 'fluffy', label: '蓬鬆', prompt: 'fluffy hair volume' },
];
export const hairBangs = [
  { id: 'center', label: '中分', prompt: 'center-parted bangs' },
  { id: 'side', label: '側分', prompt: 'side-swept bangs' },
  { id: 'full', label: '齊瀏海', prompt: 'full bangs' },
  { id: 'airy', label: '空氣', prompt: 'airy see-through bangs' },
  { id: 'none', label: '無', prompt: 'no bangs, forehead visible' },
];
export const hairTextures = [
  { id: 'smooth', label: '順直', prompt: 'smooth hair texture' },
  { id: 'soft', label: '柔軟', prompt: 'soft hair texture' },
  { id: 'spiky', label: '刺', prompt: 'spiky hair texture' },
  { id: 'wispy', label: '輕盈', prompt: 'wispy hair texture' },
  { id: 'wavy', label: '波浪', prompt: 'wavy hair texture' },
];

export const hairColors = [
  { id: 'black', label: '墨黑', hex: '#2F302F', prompt: 'ink-black hair' },
  { id: 'ash', label: '灰', hex: '#7A7771', prompt: 'ash-gray hair' },
  { id: 'brown', label: '可可', hex: '#6B4A38', prompt: 'cocoa-brown hair' },
  { id: 'blonde', label: '蜂蜜', hex: '#D5AD55', prompt: 'honey-blonde hair' },
  { id: 'silver', label: '銀白', hex: '#D8DAE0', prompt: 'silver-white hair' },
  { id: 'red', label: '赤褐', hex: '#A4513F', prompt: 'auburn-red hair' },
  { id: 'blue', label: '靛藍', hex: '#4C5F84', prompt: 'indigo-blue hair' },
  { id: 'lavender', label: '薰衣草', hex: '#8D7799', prompt: 'muted lavender hair' },
  { id: 'pink', label: '櫻粉', hex: '#D9A3AE', prompt: 'soft cherry-pink hair' },
  { id: 'moss', label: '苔綠', hex: '#6E7F5C', prompt: 'moss-green hair' },
];

export const moods = [
  { id: 'gentle', label: '溫和', prompt: 'gentle relaxed expression' },
  { id: 'sleepy', label: '慵懶', prompt: 'sleepy half-lidded expression' },
  { id: 'bright', label: '開朗', prompt: 'bright friendly expression' },
  { id: 'cool', label: '冷靜', prompt: 'cool composed expression' },
  { id: 'mischievous', label: '狡黠', prompt: 'subtle mischievous expression' },
  { id: 'serious', label: '嚴肅', prompt: 'quiet serious expression' },
  { id: 'shy', label: '害羞', prompt: 'shy, slightly flustered expression' },
  { id: 'fierce', label: '凌厲', prompt: 'fierce determined expression' },
];
export const eyeShapes = [
  { id: 'soft', label: '柔和', prompt: 'soft anime eye shape' },
  { id: 'round', label: '圓', prompt: 'round anime eye shape' },
  { id: 'sharp', label: '銳利', prompt: 'sharp anime eye shape' },
  { id: 'droopy', label: '下垂', prompt: 'droopy anime eye shape' },
  { id: 'narrow', label: '細長', prompt: 'narrow almond eye shape' },
];
export const brows = [
  { id: 'soft', label: '柔和', prompt: 'soft eyebrows' },
  { id: 'straight', label: '平直', prompt: 'straight relaxed eyebrows' },
  { id: 'arched', label: '上揚', prompt: 'arched eyebrows' },
];
export const eyeColors = [
  { id: 'brown', label: '可可', hex: '#6B4A38', prompt: 'warm brown eyes' },
  { id: 'amber', label: '琥珀', hex: '#C28A3E', prompt: 'amber eyes' },
  { id: 'green', label: '葉綠', hex: '#67805F', prompt: 'soft green eyes' },
  { id: 'teal', label: '青', hex: '#4B8887', prompt: 'teal eyes' },
  { id: 'blue', label: '天藍', hex: '#6684AD', prompt: 'clear blue eyes' },
  { id: 'gray', label: '石灰', hex: '#747A80', prompt: 'slate-gray eyes' },
  { id: 'violet', label: '紫', hex: '#7D6797', prompt: 'violet eyes' },
  { id: 'red', label: '赤', hex: '#A34E4B', prompt: 'crimson-red eyes' },
];

export const outfitStyles = [
  { id: 'soft-casual', hint: '柔軟上衣配直筒褲，乾淨日常', label: '日常休閒', prompt: 'simple contemporary casual outfit with a clean soft top and straight trousers', defaults: { silhouette: 'balanced', layers: 'single', detail: 'clean' } },
  { id: 'academy', hint: '現代學院制服，外套結構收斂', label: '學院制服', prompt: 'clean modern academy uniform with a restrained structured jacket', defaults: { silhouette: 'fitted', layers: 'layered', detail: 'clean' } },
  { id: 'street-layer', hint: '短外層疊穿的當代街頭感', label: '街頭層次', prompt: 'contemporary layered streetwear with a short outer layer', defaults: { silhouette: 'oversized', layers: 'layered', detail: 'statement' } },
  { id: 'traveler', hint: '實用旅行裝，配一件精簡機能外套', label: '旅行機能', prompt: 'practical travel outfit with a compact utility jacket', defaults: { silhouette: 'balanced', layers: 'layered', detail: 'functional' } },
  { id: 'workshop', hint: '捲袖工作服，加一片耐用圍裙', label: '工坊', prompt: 'practical workshop outfit with rolled sleeves and one durable apron panel', defaults: { silhouette: 'fitted', layers: 'layered', detail: 'functional' } },
  { id: 'formal', hint: '收斂的正式裝，長外套線條乾淨', label: '正式', prompt: 'restrained formal outfit with clean long jacket lines', defaults: { silhouette: 'fitted', layers: 'coat', detail: 'clean' } },
  { id: 'fantasy', hint: '奇幻冒險裝，層次裝備好辨識', label: '奇幻冒險', prompt: 'fantasy adventurer outfit with readable layered gear', defaults: { silhouette: 'balanced', layers: 'layered', detail: 'functional' } },
  { id: 'idol-stage', hint: '舞台服裝，只留一個招牌主題', label: '偶像舞台', prompt: 'idol stage costume with one clear signature motif', defaults: { silhouette: 'fitted', layers: 'layered', detail: 'statement' } },
];
export const silhouettes = [
  { id: 'fitted', label: '合身', prompt: 'fitted outfit silhouette' },
  { id: 'balanced', label: '平衡', prompt: 'balanced outfit silhouette' },
  { id: 'oversized', label: '寬鬆', prompt: 'oversized outfit silhouette' },
];
export const layerOptions = [
  { id: 'single', label: '單層', prompt: 'single-layer clothing construction' },
  { id: 'layered', label: '多層', prompt: 'restrained layered clothing construction' },
  { id: 'coat', label: '長外套', prompt: 'long outer-layer clothing construction' },
];
export const detailOptions = [
  { id: 'clean', label: '簡潔', prompt: 'clean minimal garment detailing' },
  { id: 'functional', label: '機能', prompt: 'functional garment details only where useful' },
  { id: 'statement', label: '重點', prompt: 'one clear statement garment detail' },
];

export const paletteUses = [
  { id: 'hair', label: '髮' },
  { id: 'eyes', label: '眼' },
  { id: 'skin', label: '膚' },
  { id: 'primary', label: '主色' },
  { id: 'secondary', label: '輔色' },
  { id: 'accent', label: '點綴' },
  { id: 'metal', label: '金屬' },
];

// 畫風混音台：九顆五段旋鈕，值為 0–4 的刻度。
export const mixerControls = [
  { id: 'composition', group: 'form', label: '構圖', en: 'Composition', steps: ['極簡', '簡潔', '平衡', '層次', '密集'], prompts: ['minimal single-focus composition', 'simple uncluttered composition', 'balanced composition', 'layered composition', 'dense multi-element composition'] },
  { id: 'detail', group: 'form', label: '細節', en: 'Detail', steps: ['大塊', '乾淨', '平衡', '細緻', '微細'], prompts: ['broad shapes with almost no micro detail', 'clean simplified detail', 'balanced detail density', 'fine selective detail', 'dense micro detail'] },
  { id: 'hairDetail', group: 'form', label: '髮束', en: 'Hair', steps: ['整塊', '分組', '平衡', '細束', '髮絲'], prompts: ['hair designed as a few large masses', 'hair grouped into large clean clumps', 'balanced hair clump detail', 'fine hair clumps with some flyaways', 'strand-level hair detail'] },
  { id: 'rendering', group: 'render', label: '渲染', en: 'Rendering', steps: ['平塗', '輕', '標準', '豐富', '厚塗'], prompts: ['flat anime coloring', 'light anime rendering with one primary shadow layer and restrained highlights', 'standard anime rendering', 'rich layered anime rendering', 'painterly high-density rendering'] },
  { id: 'background', group: 'render', label: '背景', en: 'Background', steps: ['留白', '暗示', '簡單', '場景', '豐富'], prompts: ['empty negative-space background', 'background only lightly implied', 'simple supporting background', 'complete scene background', 'rich environmental background'] },
  { id: 'accessories', group: 'render', label: '配件', en: 'Accessories', steps: ['無', '少', '平衡', '多', '華麗'], prompts: ['no decorative accessories', 'only one or two meaningful accessories', 'balanced accessory count', 'many accessories', 'ornate accessory-heavy design'] },
  { id: 'saturation', group: 'color', label: '飽和', en: 'Saturation', steps: ['沉穩', '柔和', '自然', '鮮明', '強烈'], prompts: ['muted color saturation', 'soft restrained saturation', 'natural saturation', 'vivid colors', 'punchy highly saturated accents'] },
  { id: 'value', group: 'color', label: '明度', en: 'Value', steps: ['暗', '低', '中', '亮', '透'], prompts: ['dark overall value structure', 'low-key value structure', 'mid-value balance', 'bright value structure', 'airy high-key value structure'] },
  { id: 'contrast', group: 'color', label: '對比', en: 'Contrast', steps: ['柔', '低', '平衡', '強', '圖像化'], prompts: ['soft tonal contrast', 'low contrast', 'balanced contrast', 'strong focal contrast', 'graphic high contrast'] },
];
export const mixerGroups = [
  { id: 'form', label: '形', en: 'Form' },
  { id: 'render', label: '繪', en: 'Render' },
  { id: 'color', label: '色', en: 'Color' },
];
export const mixerKeys = mixerControls.map(control => control.id);

export const mixerPresets = [
  { id: 'less', label: '少即是多', values: { composition: 1, detail: 1, hairDetail: 1, rendering: 1, background: 1, accessories: 1, saturation: 2, value: 2, contrast: 2 } },
  { id: 'casual', label: '日常動畫', values: { composition: 2, detail: 2, hairDetail: 2, rendering: 1, background: 2, accessories: 2, saturation: 2, value: 2, contrast: 2 } },
  { id: 'key', label: '主視覺', values: { composition: 3, detail: 3, hairDetail: 3, rendering: 3, background: 3, accessories: 3, saturation: 3, value: 2, contrast: 3 } },
];
export const defaultMixer = () => ({ ...mixerPresets[1].values });

// 生成時的取景（屬於這次工作，不屬於角色）。
export const framings = [
  { id: 'sheet', label: '設定稿', prompt: 'clean character design sheet layout' },
  { id: 'full', label: '全身', prompt: 'full-body character framing' },
  { id: 'threeQuarter', label: '七分身', prompt: 'three-quarter body framing' },
  { id: 'half', label: '半身', prompt: 'half-body character framing' },
  { id: 'closeup', label: '特寫', prompt: 'close-up portrait framing' },
];

export const variantCounts = [1, 2, 4];

export const ids = list => list.map(item => item.id);
export const findOption = (list, id) => list.find(item => item.id === id) || null;
