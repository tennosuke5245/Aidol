import { formatList, useT } from '../i18n';
import { L } from '../lib-i18n';
import { Section, Tile } from '../ui';
import { ColorField, colorLabel } from '../ColorPicker';

// 種族（2026-10-13 起）：點一個種族就套用它的耳朵、角、尾巴、翅膀與特徵，再往下細調。
// 特徵色只有一個：沒設定時，耳朵與尾巴跟髮色。
const slots = [['ears', 'earTypes', 'human'], ['horns', 'hornTypes', 'none'], ['tail', 'tailTypes', 'none'], ['wings', 'wingTypes', 'none']];
// 特徵色的快速選項（值就是 #RRGGBB；名稱由程式依顏色自動取）。
const featureColors = ['#2B2B33', '#F4F1EA', '#C9CED8', '#D8B25C', '#A8423A', '#7A5A43', '#5C6F9E', '#6E8F6A'];

export function presetFeatures(kind) {
  if (!kind?.preset) return [];
  const labels = slots.map(([key, list, empty]) => (kind.preset[key] && kind.preset[key] !== empty ? L.findOption(L[list], kind.preset[key])?.label : null));
  return [...labels, ...(kind.preset.extras || []).map(id => L.findOption(L.speciesExtras, id)?.label)].filter(Boolean);
}

export function SpeciesPanel({ draft, edit }) {
  const t = useT();
  const species = draft.dna?.species || {};
  const change = (mutate, group) => edit(next => { next.dna ||= {}; next.dna.species = { ...(next.dna.species || {}) }; mutate(next.dna.species); }, { area: 'species', group });
  const pickKind = kind => change(target => {
    target.kind = kind.id;
    if (!kind.preset) return;
    const { extras, ...features } = kind.preset;
    Object.assign(target, features);
    if (extras.length) target.extras = [...extras]; else delete target.extras;
  });
  const setSlot = (key, id) => change(target => { target[key] = id; });
  const toggleExtra = id => change(target => {
    const list = target.extras || [];
    const next = list.includes(id) ? list.filter(item => item !== id) : [...list, id];
    if (next.length) target.extras = next; else delete target.extras;
  });
  const hint = kind => (kind.id === 'human' ? t('creator.species.humanHint') : kind.id === 'other' ? t('creator.species.otherHint') : formatList(presetFeatures(kind)));
  const colorOptions = featureColors.map(hex => ({ id: hex, hex, label: `${colorLabel(hex)} ${hex}` }));
  return <div className="panel-stack">
    <div className="tile-grid tile-grid-3 tile-text species-grid">{L.speciesKinds.map(kind => <Tile key={kind.id} label={kind.label} sub={hint(kind)} selected={species.kind === kind.id} onClick={() => pickKind(kind)} />)}</div>
    {slots.map(([key, list, empty]) => <Section key={key} title={t(`creator.species.${key}`)}>
      <div className="chip-row">{L[list].map(option => <button type="button" key={option.id} className="chip" aria-pressed={(species[key] || empty) === option.id} onClick={() => setSlot(key, option.id)}>{option.label}</button>)}</div>
    </Section>)}
    <Section title={t('creator.species.extras')} aside={<span className="sec-note">{t('creator.species.extrasNote')}</span>}>
      <div className="chip-row">{L.speciesExtras.map(option => <button type="button" key={option.id} className="chip" aria-pressed={(species.extras || []).includes(option.id)} onClick={() => toggleExtra(option.id)}>{option.label}</button>)}</div>
    </Section>
    <Section title={t('creator.species.color')} aside={<span className="sec-note">{t('creator.species.colorNote')}</span>}>
      <ColorField label={t('creator.species.color')} options={colorOptions} value={species.color || null} allowNone noneLabel={t('creator.species.colorFollow')} size={30} palette={draft.palette || []}
        onChange={value => change(target => { if (value) target.color = value; else delete target.color; }, 'species-color')} />
    </Section>
  </div>;
}
