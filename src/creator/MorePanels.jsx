import { Plus, Trash, Sparkle, PencilSimple, Image as ImageIcon, X } from '@phosphor-icons/react';
import * as L from '../../shared/libraries.mjs';
import { assetFor } from '../api';
import { Knob, Section, Toggle } from '../ui';
import { activeMixer, ensureDirection, kindLabels, outfitOf, roleLabels, uid } from './helpers';
import { OutfitTabs } from './LookPanels';

export function ColorPanel({ draft, edit }) {
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
      <label className="color-well" title="換顏色"><input type="color" value={swatch.hex} onChange={event => set(swatch.id, 'hex', event.target.value.toUpperCase(), `hex-${swatch.id}`)} /><span style={{ background: swatch.hex }} /></label>
      <input aria-label="顏色名稱" value={swatch.name} maxLength={40} onChange={event => set(swatch.id, 'name', event.target.value || '未命名', `name-${swatch.id}`)} />
      <select aria-label="用途" value={swatch.use || ''} onChange={event => set(swatch.id, 'use', event.target.value || undefined)}><option value="">一般</option>{L.paletteUses.map(use => <option key={use.id} value={use.id}>{use.label}</option>)}</select>
      <button type="button" className="icon-btn" aria-label={`刪除「${swatch.name}」`} onClick={() => edit(next => { next.palette = next.palette.filter(item => item.id !== swatch.id); Object.values(next.outfits).forEach(outfit => { if (outfit.spec?.colors) outfit.spec.colors = outfit.spec.colors.filter(id => id !== swatch.id); }); }, { area: 'outfit' })}><Trash size={16} /></button>
    </div>)}</div> : <p className="hint">還沒有顏色。角色專屬的 4–8 個顏色，服裝與配件都從這裡挑。</p>}
    <div className="row-actions">
      <button type="button" className="btn btn-secondary" disabled={palette.length >= 16} onClick={() => edit(next => { next.palette = [...(next.palette || []), { id: uid('color'), name: `顏色 ${palette.length + 1}`, hex: '#7C8DB5' }]; }, { area: 'outfit' })}><Plus size={15} />新增顏色</button>
      <button type="button" className="btn btn-quiet" disabled={!canImport} title={canImport ? '' : '先在「髮型」或「五官」選顏色'} onClick={fromDna}>從髮色和眼色帶入</button>
    </div>
  </div>;
}

export function GearPanel({ draft, edit, project, outfitId, onOutfit, hasPortrait, onEditPart, onDrawPart, onPreview }) {
  const outfit = outfitOf(draft, outfitId);
  const parts = Object.values(draft.components || {});
  const wearing = part => outfit?.equipped.find(item => item.componentId === part.id);
  const toggle = (part, enabled) => edit(next => {
    const target = outfitOf(next, outfitId);
    const item = target.equipped.find(entry => entry.componentId === part.id);
    if (item) item.enabled = enabled; else target.equipped.push({ id: uid('wear'), componentId: part.id, anchor: kindLabels[part.kind] || '身上', enabled });
  }, { area: 'outfit' });
  return <div className="panel-stack">
    <OutfitTabs draft={draft} outfitId={outfitId} onOutfit={onOutfit} edit={edit} />
    <div className="gear-grid">
      {parts.map(part => {
        const asset = assetFor(project, part.id);
        const on = Boolean(wearing(part)?.enabled);
        return <article key={part.id} className={`gear ${on ? '' : 'is-off'}`}>
          <button type="button" className="gear-art" onClick={() => (asset ? onPreview(asset, part.name) : onEditPart(part))} aria-label={asset ? `放大「${part.name}」` : `編輯「${part.name}」`}>
            {asset ? <img src={asset.url} alt="" /> : <span className="gear-empty"><Sparkle size={22} weight="light" /><small>還沒有設計圖</small></span>}
          </button>
          <div className="gear-info"><b>{part.name}</b><small>{kindLabels[part.kind] || '其他'}</small></div>
          <div className="gear-actions">
            <label className="gear-wear"><Toggle checked={on} label={on ? '脫下' : '穿上'} onChange={value => toggle(part, value)} /><span>{on ? '穿著' : '沒穿'}</span></label>
            <button type="button" className="icon-btn" aria-label={`編輯「${part.name}」`} onClick={() => onEditPart(part)}><PencilSimple size={16} /></button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!hasPortrait} title={hasPortrait ? '單獨畫出這件裝備的設計圖' : '先有正式立繪，才能單獨畫裝備'} onClick={() => onDrawPart(part)}>繪製</button>
          </div>
        </article>;
      })}
      <button type="button" className="gear-add" onClick={() => onEditPart(null)}><Plus size={22} /><span>新增裝備</span></button>
    </div>
    {!hasPortrait && parts.length > 0 && <p className="hint">先畫出正式立繪，裝備才能照著立繪單獨畫。</p>}
  </div>;
}

const presetNotes = { less: '線條乾淨、背景留白', casual: '電視動畫般的平衡', key: '細節豐富，適合宣傳圖' };

export function StylePanel({ draft, edit, project, onAddReference, onPreview }) {
  const mixer = activeMixer(draft);
  const setKnob = (key, value) => edit(next => { ensureDirection(next).mixer[key] = value; }, { area: 'style', group: `knob-${key}` });
  const preset = values => edit(next => { const direction = ensureDirection(next); direction.mixer = { ...values }; }, { area: 'style' });
  const matching = L.mixerPresets.find(item => L.mixerKeys.every(key => item.values[key] === mixer[key]))?.id;
  const references = (draft.style.references || []).map(reference => ({ reference, asset: project.assets.find(asset => asset.id === reference.assetId) })).filter(item => item.asset);
  return <div className="panel-stack">
    <Section title="快速套用">
      <div className="preset-row">{L.mixerPresets.map(item => <button type="button" key={item.id} className="preset-card" aria-pressed={matching === item.id} onClick={() => preset(item.values)}><b>{item.label}</b><small>{presetNotes[item.id]}</small></button>)}</div>
    </Section>
    {L.mixerGroups.map(group => <Section key={group.id} title={{ form: '造型', render: '畫面', color: '色調' }[group.id]}>
      <div className="knob-row">{L.mixerControls.filter(control => control.group === group.id).map(control => <Knob key={control.id} control={control} value={mixer[control.id] ?? 2} onChange={value => setKnob(control.id, value)} />)}</div>
    </Section>)}
    <Section title="參考圖" aside={<button type="button" className="btn btn-text" onClick={onAddReference}><Plus size={14} />加入</button>}>
      {references.length ? <div className="ref-grid">{references.map(({ reference, asset }) => <figure key={reference.id} className="ref">
        <button type="button" onClick={() => onPreview(asset, roleLabels[reference.role])}><img src={asset.url} alt={roleLabels[reference.role]} /></button>
        <figcaption>{roleLabels[reference.role] || '參考'}</figcaption>
        <button type="button" className="ref-remove" aria-label="移除這張參考" onClick={() => edit(next => { next.style.references = next.style.references.filter(item => item.id !== reference.id); })}><X size={12} weight="bold" /></button>
      </figure>)}</div> : <button type="button" className="empty-drop" onClick={onAddReference}><ImageIcon size={22} /><span>放一張參考圖，說明要參考它的哪裡（線條、配色、材質…）</span></button>}
    </Section>
  </div>;
}
