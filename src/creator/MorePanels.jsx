import { useRef, useState } from 'react';
import { Plus, Trash, Sparkle, PencilSimple, Image as ImageIcon, X, LockSimple, LockSimpleOpen, Check } from '@phosphor-icons/react';
import { assetFor } from '../api';
import { useT } from '../i18n';
import { L } from '../lib-i18n';
import { Busy } from '../Panels';
import { Knob, Section, Toggle } from '../ui';
import { ColorPicker, colorLabel } from '../ColorPicker';
import { extractPalette, resolveColor } from '../../shared/colors.mjs';
import { activeMixer, ensureDirection, kindLabels, outfitOf, roleLabels, uid } from './helpers';
import { Wardrobe } from './Wardrobe';

// 從圖片抓主色：在瀏覽器裡把圖縮小後分群（圖是本機核心給的同源圖，不上傳、不呼叫 AI）。
async function colorsOf(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const scale = Math.min(1, 200 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return extractPalette(context.getImageData(0, 0, width, height).data, width, height, { count: 6 });
}

function PaletteFromImage({ project, draft, palette, onAdd }) {
  const t = useT();
  const [source, setSource] = useState(null);
  const [state, setState] = useState({ status: 'idle', colors: [] });
  // 連續點兩張圖時，只顯示最後點的那張（先點的那張比較慢讀完也不蓋掉）。
  const latest = useRef(null);
  const sources = [project.character.adopted?.character, ...[...(draft.style.references || [])].sort((a, b) => Number(Boolean(b.canon)) - Number(Boolean(a.canon))).map(reference => reference.assetId)]
    .filter((id, index, list) => id && list.indexOf(id) === index).map(id => project.assets.find(asset => asset.id === id)).filter(Boolean).slice(0, 6);
  const have = new Set(palette.map(swatch => swatch.hex.toUpperCase()));
  async function pick(asset) {
    latest.current = asset.id;
    setSource(asset.id); setState({ status: 'loading', colors: [] });
    let next;
    try { const colors = await colorsOf(asset.url); next = { status: colors.length ? 'done' : 'none', colors }; } catch { next = { status: 'error', colors: [] }; }
    if (latest.current === asset.id) setState(next);
  }
  const fresh = state.colors.filter(color => !have.has(color.hex));
  if (!sources.length) return <p className="hint">{t('creator.palette.fromImageEmpty')}</p>;
  return <div className="from-image">
    <div className="from-image-sources" role="group" aria-label={t('creator.palette.fromImageSource')}>{sources.map(asset => <button type="button" key={asset.id} className="from-image-source" aria-pressed={source === asset.id} title={asset.name} onClick={() => pick(asset)}><img src={asset.url} alt={asset.name} /></button>)}</div>
    {state.status === 'loading' && <Busy>{t('creator.palette.fromImageLoading')}</Busy>}
    {state.status === 'error' && <p className="hint">{t('creator.palette.fromImageFailed')}</p>}
    {state.status === 'none' && <p className="hint">{t('creator.palette.fromImageNone')}</p>}
    {state.status === 'done' && <>
      <div className="from-image-colors">{state.colors.map(color => { const added = have.has(color.hex); return <button type="button" key={color.hex} className="color-pick" aria-pressed={added} disabled={added || palette.length >= 16} title={added ? t('creator.palette.fromImageAdded') : t('creator.palette.fromImageAdd')} onClick={() => onAdd([color.hex])}>
        <span className="color-pick-dot" style={{ background: color.hex }}>{added && <Check size={14} weight="bold" />}</span><small>{colorLabel(color.hex)}</small>
      </button>; })}</div>
      {fresh.length > 1 && palette.length < 16 && <button type="button" className="btn btn-quiet btn-sm" onClick={() => onAdd(fresh.map(color => color.hex))}><Plus size={14} />{t('creator.palette.fromImageAddAll', { count: Math.min(fresh.length, 16 - palette.length) })}</button>}
    </>}
    {state.status === 'idle' && <p className="hint">{t('creator.palette.fromImageHint')}</p>}
  </div>;
}

export function ColorPanel({ draft, edit, project }) {
  const t = useT();
  const [editing, setEditing] = useState(null);
  const palette = draft.palette || [];
  const set = (id, key, value, group) => edit(next => { const swatch = next.palette.find(item => item.id === id); if (swatch) swatch[key] = value; }, { area: 'outfit', group });
  // 帶入角色身上的顏色：髮色、挑染、眼色（異色瞳兩隻都帶）、膚色、種族特徵色；預設色和自訂色都可以。
  const dnaColors = character => {
    const dna = character.dna || {};
    return [
      [resolveColor(dna.hair?.color, L.hairColors, L), 'hair'], [resolveColor(dna.hair?.accent, L.hairColors, L), 'hair'],
      [resolveColor(dna.face?.eyeColor, L.eyeColors, L), 'eyes'], [resolveColor(dna.face?.eyeColorLeft, L.eyeColors, L), 'eyes'],
      [resolveColor(dna.body?.skin, L.skinTones, L, { nearest: true }), 'skin'], [resolveColor(dna.species?.color, [], L), undefined],
    ].filter(([color]) => color);
  };
  const fromDna = () => edit(next => {
    next.palette ||= [];
    for (const [color, use] of dnaColors(next)) {
      if (!next.palette.some(item => item.hex.toLowerCase() === color.hex.toLowerCase()) && next.palette.length < 16) next.palette.push({ id: uid(use || 'color'), name: color.label.slice(0, 40), hex: color.hex, ...(use ? { use } : {}) });
    }
  }, { area: 'outfit' });
  const addColors = hexes => edit(next => {
    next.palette ||= [];
    for (const hex of hexes) if (next.palette.length < 16 && !next.palette.some(item => item.hex.toUpperCase() === hex)) next.palette.push({ id: uid('color'), name: colorLabel(hex).slice(0, 40), hex });
  }, { area: 'outfit' });
  const canImport = dnaColors(draft).length > 0;
  return <div className="panel-stack">
    {palette.length ? <div className="palette-list">{palette.map(swatch => <div className="palette-item" key={swatch.id}>
      <div className="palette-row">
        <button type="button" id={`well-${swatch.id}`} className="color-well" title={t('creator.palette.changeColor')} aria-label={t('creator.palette.changeColor')} aria-expanded={editing === swatch.id} onClick={() => setEditing(current => (current === swatch.id ? null : swatch.id))}><span style={{ background: swatch.hex }} /></button>
        <input aria-label={t('creator.palette.name')} value={swatch.name} maxLength={40} onChange={event => set(swatch.id, 'name', event.target.value || t('creator.palette.untitled'), `name-${swatch.id}`)} />
        <select aria-label={t('creator.palette.use')} value={swatch.use || ''} onChange={event => set(swatch.id, 'use', event.target.value || undefined)}><option value="">{t('creator.palette.general')}</option>{L.paletteUses.map(use => <option key={use.id} value={use.id}>{use.label}</option>)}</select>
        <button type="button" className="icon-btn" aria-label={t('creator.palette.delete', { name: swatch.name })} onClick={() => edit(next => { next.palette = next.palette.filter(item => item.id !== swatch.id); Object.values(next.outfits).forEach(outfit => { if (outfit.spec?.colors) outfit.spec.colors = outfit.spec.colors.filter(id => id !== swatch.id); }); }, { area: 'outfit' })}><Trash size={16} /></button>
      </div>
      {editing === swatch.id && <ColorPicker value={swatch.hex} palette={palette.filter(item => item.id !== swatch.id)} onChange={hex => set(swatch.id, 'hex', hex, `hex-${swatch.id}`)} onDone={() => { setEditing(null); requestAnimationFrame(() => document.getElementById(`well-${swatch.id}`)?.focus()); }} />}
    </div>)}</div> : <p className="hint">{t('creator.palette.empty')}</p>}
    <div className="row-actions">
      <button type="button" className="btn btn-secondary" disabled={palette.length >= 16} onClick={() => edit(next => { next.palette = [...(next.palette || []), { id: uid('color'), name: t('creator.palette.defaultName', { number: palette.length + 1 }), hex: '#7C8DB5' }]; }, { area: 'outfit' })}><Plus size={15} />{t('creator.palette.add')}</button>
      <button type="button" className="btn btn-quiet" disabled={!canImport} title={canImport ? '' : t('creator.palette.importHint')} onClick={fromDna}>{t('creator.palette.import')}</button>
    </div>
    <Section title={t('creator.palette.fromImage')}>
      <PaletteFromImage project={project} draft={draft} palette={palette} onAdd={addColors} />
    </Section>
  </div>;
}

export function GearPanel({ draft, edit, project, outfitId, onOutfit, hasPortrait, onEditPart, onDrawPart, onPreview, onDrawWardrobe, canAuto, busy }) {
  const t = useT();
  const outfit = outfitOf(draft, outfitId);
  const parts = Object.values(draft.components || {});
  const wearing = part => outfit?.equipped.find(item => item.componentId === part.id);
  const toggle = (part, enabled) => edit(next => {
    const target = outfitOf(next, outfitId);
    const item = target.equipped.find(entry => entry.componentId === part.id);
    if (item) item.enabled = enabled; else target.equipped.push({ id: uid('wear'), componentId: part.id, anchor: kindLabels[part.kind] || t('creator.gear.defaultAnchor'), enabled });
  }, { area: 'outfit' });
  return <div className="panel-stack">
    <Wardrobe draft={draft} project={project} outfitId={outfitId} onOutfit={onOutfit} edit={edit} onDrawAll={onDrawWardrobe} canAuto={canAuto} busy={busy} />
    <div className="gear-grid">
      {parts.map(part => {
        const asset = assetFor(project, part.id);
        const on = Boolean(wearing(part)?.enabled);
        return <article key={part.id} className={`gear ${on ? '' : 'is-off'}`}>
          <button type="button" className="gear-art" onClick={() => (asset ? onPreview(asset, part.name) : onEditPart(part))} aria-label={asset ? t('creator.gear.zoom', { name: part.name }) : t('creator.gear.edit', { name: part.name })}>
            {asset ? <img src={asset.url} alt="" /> : <span className="gear-empty"><Sparkle size={22} weight="light" /><small>{t('creator.gear.noDesign')}</small></span>}
          </button>
          <div className="gear-info"><b>{part.name}</b><small>{kindLabels[part.kind] || kindLabels.other}</small></div>
          <div className="gear-actions">
            <label className="gear-wear"><Toggle checked={on} label={on ? t('creator.gear.takeOff') : t('creator.gear.putOn')} onChange={value => toggle(part, value)} /><span>{on ? t('creator.gear.worn') : t('creator.gear.notWorn')}</span></label>
            <button type="button" className="icon-btn" aria-label={t('creator.gear.edit', { name: part.name })} onClick={() => onEditPart(part)}><PencilSimple size={16} /></button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!hasPortrait} title={hasPortrait ? t('creator.gear.drawTitle') : t('creator.gear.needPortrait')} onClick={() => onDrawPart(part)}>{t('creator.gear.draw')}</button>
          </div>
        </article>;
      })}
      <button type="button" className="gear-add" onClick={() => onEditPart(null)}><Plus size={22} /><span>{t('creator.gear.add')}</span></button>
    </div>
    {!hasPortrait && parts.length > 0 && <p className="hint">{t('creator.gear.needPortraitHint')}</p>}
  </div>;
}

export function StylePanel({ draft, edit, project, onAddReference, onPreview }) {
  const t = useT();
  const mixer = activeMixer(draft);
  const setKnob = (key, value) => edit(next => { ensureDirection(next).mixer[key] = value; }, { area: 'style', group: `knob-${key}` });
  const preset = values => edit(next => { const direction = ensureDirection(next); direction.mixer = { ...values }; }, { area: 'style' });
  const matching = L.mixerPresets.find(item => L.mixerKeys.every(key => item.values[key] === mixer[key]))?.id;
  const references = (draft.style.references || []).map(reference => ({ reference, asset: project.assets.find(asset => asset.id === reference.assetId) })).filter(item => item.asset);
  // 每張參考圖左上角是定稿開關：鎖上＝設計照這張畫；打開＝只當參考。
  return <div className="panel-stack">
    <Section title={t('creator.style.presets')}>
      <div className="preset-row">{L.mixerPresets.map(item => <button type="button" key={item.id} className="preset-card" aria-pressed={matching === item.id} onClick={() => preset(item.values)}><b>{item.label}</b><small>{t(`creator.style.presetNotes.${item.id}`)}</small></button>)}</div>
    </Section>
    {L.mixerGroups.map(group => <Section key={group.id} title={t(`creator.style.groups.${group.id}`)}>
      <div className="knob-row">{L.mixerControls.filter(control => control.group === group.id).map(control => <Knob key={control.id} control={control} value={mixer[control.id] ?? 2} onChange={value => setKnob(control.id, value)} />)}</div>
    </Section>)}
    <Section title={t('creator.style.references')} aside={<button type="button" className="btn btn-text" onClick={onAddReference}><Plus size={14} />{t('creator.style.addReference')}</button>}>
      {references.length ? <div className="ref-grid">{references.map(({ reference, asset }) => { const label = reference.canon ? t('creator.style.canon') : roleLabels[reference.role] || t('creator.style.referenceFallback'); return <figure key={reference.id} className={`ref ${reference.canon ? 'is-canon' : ''}`}>
        <button type="button" onClick={() => onPreview(asset, label)}><img src={asset.url} alt={label} /></button>
        <button type="button" className="ref-lock" aria-pressed={Boolean(reference.canon)} title={reference.canon ? t('creator.style.canonOff') : t('creator.style.canonOn')} aria-label={reference.canon ? t('creator.style.canonOff') : t('creator.style.canonOn')} onClick={() => edit(next => { const item = next.style.references.find(entry => entry.id === reference.id); if (item.canon) delete item.canon; else item.canon = true; }, { area: 'style' })}>
          {reference.canon ? <><LockSimple size={12} weight="fill" />{t('creator.style.canonBadge')}</> : <LockSimpleOpen size={13} />}
        </button>
        <figcaption>{label}</figcaption>
        <button type="button" className="ref-remove" aria-label={t('creator.style.removeReference')} onClick={() => edit(next => { next.style.references = next.style.references.filter(item => item.id !== reference.id); })}><X size={12} weight="bold" /></button>
      </figure>; })}</div> : <button type="button" className="empty-drop" onClick={onAddReference}><ImageIcon size={22} /><span>{t('creator.style.referenceEmpty')}</span></button>}
    </Section>
  </div>;
}
