import { Plus, Trash, Sparkle, PencilSimple, Image as ImageIcon, X } from '@phosphor-icons/react';
import { assetFor } from '../api';
import { useT } from '../i18n';
import { L } from '../lib-i18n';
import { Knob, Section, Toggle } from '../ui';
import { activeMixer, ensureDirection, kindLabels, outfitOf, roleLabels, uid } from './helpers';
import { OutfitTabs } from './LookPanels';

export function ColorPanel({ draft, edit }) {
  const t = useT();
  const palette = draft.palette || [];
  const set = (id, key, value, group) => edit(next => { const swatch = next.palette.find(item => item.id === id); if (swatch) swatch[key] = value; }, { area: 'outfit', group });
  const fromDna = () => edit(next => {
    next.palette ||= [];
    const add = (option, use) => { if (option && !next.palette.some(item => item.hex.toLowerCase() === option.hex.toLowerCase()) && next.palette.length < 16) next.palette.push({ id: uid(use), name: option.label, hex: option.hex, use }); };
    add(L.findOption(L.hairColors, next.dna?.hair?.color), 'hair');
    add(L.findOption(L.eyeColors, next.dna?.face?.eyeColor), 'eyes');
  }, { area: 'outfit' });
  const canImport = Boolean(draft.dna?.hair?.color || draft.dna?.face?.eyeColor);
  return <div className="panel-stack">
    {palette.length ? <div className="palette-list">{palette.map(swatch => <div className="palette-row" key={swatch.id}>
      <label className="color-well" title={t('creator.palette.changeColor')}><input type="color" value={swatch.hex} onChange={event => set(swatch.id, 'hex', event.target.value.toUpperCase(), `hex-${swatch.id}`)} /><span style={{ background: swatch.hex }} /></label>
      <input aria-label={t('creator.palette.name')} value={swatch.name} maxLength={40} onChange={event => set(swatch.id, 'name', event.target.value || t('creator.palette.untitled'), `name-${swatch.id}`)} />
      <select aria-label={t('creator.palette.use')} value={swatch.use || ''} onChange={event => set(swatch.id, 'use', event.target.value || undefined)}><option value="">{t('creator.palette.general')}</option>{L.paletteUses.map(use => <option key={use.id} value={use.id}>{use.label}</option>)}</select>
      <button type="button" className="icon-btn" aria-label={t('creator.palette.delete', { name: swatch.name })} onClick={() => edit(next => { next.palette = next.palette.filter(item => item.id !== swatch.id); Object.values(next.outfits).forEach(outfit => { if (outfit.spec?.colors) outfit.spec.colors = outfit.spec.colors.filter(id => id !== swatch.id); }); }, { area: 'outfit' })}><Trash size={16} /></button>
    </div>)}</div> : <p className="hint">{t('creator.palette.empty')}</p>}
    <div className="row-actions">
      <button type="button" className="btn btn-secondary" disabled={palette.length >= 16} onClick={() => edit(next => { next.palette = [...(next.palette || []), { id: uid('color'), name: t('creator.palette.defaultName', { number: palette.length + 1 }), hex: '#7C8DB5' }]; }, { area: 'outfit' })}><Plus size={15} />{t('creator.palette.add')}</button>
      <button type="button" className="btn btn-quiet" disabled={!canImport} title={canImport ? '' : t('creator.palette.importHint')} onClick={fromDna}>{t('creator.palette.import')}</button>
    </div>
  </div>;
}

export function GearPanel({ draft, edit, project, outfitId, onOutfit, hasPortrait, onEditPart, onDrawPart, onPreview }) {
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
    <OutfitTabs draft={draft} outfitId={outfitId} onOutfit={onOutfit} edit={edit} />
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
  return <div className="panel-stack">
    <Section title={t('creator.style.presets')}>
      <div className="preset-row">{L.mixerPresets.map(item => <button type="button" key={item.id} className="preset-card" aria-pressed={matching === item.id} onClick={() => preset(item.values)}><b>{item.label}</b><small>{t(`creator.style.presetNotes.${item.id}`)}</small></button>)}</div>
    </Section>
    {L.mixerGroups.map(group => <Section key={group.id} title={t(`creator.style.groups.${group.id}`)}>
      <div className="knob-row">{L.mixerControls.filter(control => control.group === group.id).map(control => <Knob key={control.id} control={control} value={mixer[control.id] ?? 2} onChange={value => setKnob(control.id, value)} />)}</div>
    </Section>)}
    <Section title={t('creator.style.references')} aside={<button type="button" className="btn btn-text" onClick={onAddReference}><Plus size={14} />{t('creator.style.addReference')}</button>}>
      {references.length ? <div className="ref-grid">{references.map(({ reference, asset }) => <figure key={reference.id} className="ref">
        <button type="button" onClick={() => onPreview(asset, roleLabels[reference.role])}><img src={asset.url} alt={roleLabels[reference.role]} /></button>
        <figcaption>{roleLabels[reference.role] || t('creator.style.referenceFallback')}</figcaption>
        <button type="button" className="ref-remove" aria-label={t('creator.style.removeReference')} onClick={() => edit(next => { next.style.references = next.style.references.filter(item => item.id !== reference.id); })}><X size={12} weight="bold" /></button>
      </figure>)}</div> : <button type="button" className="empty-drop" onClick={onAddReference}><ImageIcon size={22} /><span>{t('creator.style.referenceEmpty')}</span></button>}
    </Section>
  </div>;
}
