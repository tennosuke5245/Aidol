import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { formatList, useT } from '../i18n';
import { L } from '../lib-i18n';
import { optionArt } from '../optionArt';
import { Section, StepSlider, SwatchRow, Tile } from '../ui';
import { outfitOf, setDna, uid } from './helpers';

// 中性人台的選項圖（只有對應部位不同）；圖還沒放進來時只顯示文字。
function OptionImage({ group, id }) {
  const src = optionArt(group, id);
  return src ? <img src={src} alt="" draggable="false" /> : null;
}

export function BodyPanel({ draft, edit, outfitId }) {
  const t = useT();
  const body = draft.dna?.body || {};
  const set = (key, value) => edit(next => setDna(next, 'body', key, value), { area: 'body', group: `body-${key}` });
  return <div className="panel-stack">
    <StepSlider label={t('creator.body.age')} options={L.ages} value={body.age} onChange={value => set('age', value)} />
    <StepSlider label={t('creator.body.headRatio')} options={L.headRatios} value={body.headRatio} onChange={value => set('headRatio', value)} />
    <StepSlider label={t('creator.body.height')} options={L.heights} value={body.height} onChange={value => set('height', value)} />
    <Section title={t('creator.body.build')}>
      <div className="tile-grid tile-grid-3 tile-tall">{L.builds.map(option => <Tile key={option.id} label={option.label} selected={body.build === option.id} onClick={() => set('build', option.id)}>
        <OptionImage group="build" id={option.id} />
      </Tile>)}</div>
    </Section>
  </div>;
}

export function HairPanel({ draft, edit, outfitId }) {
  const t = useT();
  const [tag, setTag] = useState('all');
  const hair = draft.dna?.hair || {};
  const set = (key, value, group) => edit(next => setDna(next, 'hair', key, value), { area: 'hair', group });
  const styles = L.hairStyles.filter(style => tag === 'all' || style.tags.includes(tag));
  return <div className="panel-stack">
    <div className="chip-row" role="group" aria-label={t('creator.hair.tags')}>{[{ id: 'all', label: t('creator.hair.all') }, ...L.hairTags].map(item => <button type="button" key={item.id} className="chip" aria-pressed={tag === item.id} onClick={() => setTag(item.id)}>{item.label}</button>)}</div>
    <div className="tile-grid tile-grid-3">{styles.map(style => <Tile key={style.id} label={style.label} selected={hair.style === style.id}
      onClick={() => edit(next => { setDna(next, 'hair', 'style', style.id); Object.entries(style.defaults).forEach(([key, value]) => setDna(next, 'hair', key, value)); }, { area: 'hair' })}>
      <OptionImage group="hair" id={style.id} />
    </Tile>)}</div>
    <Section title={t('creator.hair.color')}><SwatchRow label={t('creator.hair.color')} options={L.hairColors} value={hair.color} size={34} onChange={value => set('color', value)} /></Section>
    <Section title={t('creator.hair.accent')}><SwatchRow label={t('creator.hair.accent')} options={L.hairColors} value={hair.accent} allowNone size={28} onChange={value => set('accent', value)} /></Section>
    <StepSlider label={t('creator.hair.length')} options={L.hairLengths} value={hair.length} onChange={value => set('length', value, 'hair-length')} />
    <StepSlider label={t('creator.hair.volume')} options={L.hairVolumes} value={hair.volume} onChange={value => set('volume', value, 'hair-volume')} />
    <Section title={t('creator.hair.bangs')}>
      <div className="tile-grid tile-grid-3">{L.hairBangs.map(option => <Tile key={option.id} label={option.label} selected={hair.bangs === option.id} onClick={() => set('bangs', option.id)}>
        <OptionImage group="bangs" id={option.id} />
      </Tile>)}</div>
    </Section>
    <Section title={t('creator.hair.texture')}><div className="chip-row">{L.hairTextures.map(option => <button type="button" key={option.id} className="chip" aria-pressed={hair.texture === option.id} onClick={() => set('texture', option.id)}>{option.label}</button>)}</div></Section>
  </div>;
}

export function FacePanel({ draft, edit, outfitId }) {
  const t = useT();
  const face = draft.dna?.face || {};
  const set = (key, value) => edit(next => setDna(next, 'face', key, value), { area: 'face' });
  const faces = (list, key, group, columns, shape = '') => <div className={`tile-grid tile-grid-${columns} ${shape}`}>{list.map(option => <Tile key={option.id} label={option.label} selected={face[key] === option.id} onClick={() => set(key, option.id)}>
    <OptionImage group={group} id={option.id} />
  </Tile>)}</div>;
  return <div className="panel-stack">
    <Section title={t('creator.face.mood')}>{faces(L.moods, 'mood', 'mood', 4)}</Section>
    <Section title={t('creator.face.eyeShape')}>{faces(L.eyeShapes, 'eyeShape', 'eye', 3, 'tile-face')}</Section>
    <Section title={t('creator.face.brows')}>{faces(L.brows, 'brows', 'brow', 3, 'tile-face')}</Section>
    <Section title={t('creator.face.eyeColor')}><SwatchRow label={t('creator.face.eyeColor')} options={L.eyeColors} value={face.eyeColor} size={34} onChange={value => set('eyeColor', value)} /></Section>
  </div>;
}

export function OutfitTabs({ draft, outfitId, onOutfit, edit }) {
  const t = useT();
  const outfits = Object.values(draft.outfits || {});
  const add = () => {
    const id = uid('outfit');
    edit(next => { const current = outfitOf(next, outfitId); next.outfits[id] = { id, name: t('creator.outfit.defaultName', { number: outfits.length + 1 }), equipped: (current?.equipped || []).map(item => ({ ...item, id: uid('wear') })), ...(current?.spec ? { spec: { ...current.spec } } : {}) }; });
    onOutfit(id);
  };
  return <div className="outfit-tabs">
    {outfits.length > 1 && <div className="tabs" role="tablist" aria-label={t('creator.outfit.tabs')}>{outfits.map(outfit => <button type="button" role="tab" key={outfit.id} aria-selected={outfit.id === outfitId} onClick={() => onOutfit(outfit.id)}>{outfit.name || t('creator.outfit.untitled')}</button>)}</div>}
    <button type="button" className="btn btn-text" onClick={add}><Plus size={14} />{t('creator.outfit.add')}</button>
  </div>;
}

export function OutfitPanel({ draft, edit, outfitId, onOutfit, onGoColors }) {
  const t = useT();
  const outfit = outfitOf(draft, outfitId);
  if (!outfit) return <p className="hint">{t('creator.outfit.none')}</p>;
  const spec = outfit.spec || {};
  const setSpec = (key, value) => edit(next => { const target = outfitOf(next, outfitId); target.spec = { ...(target.spec || {}), [key]: value }; }, { area: 'outfit' });
  const palette = draft.palette || [];
  const colors = spec.colors || [];
  const roles = [t('creator.outfit.roles.outer'), t('creator.outfit.roles.inner'), t('creator.outfit.roles.accent')];
  const toggleColor = id => edit(next => {
    const target = outfitOf(next, outfitId);
    const list = target.spec?.colors || [];
    target.spec = { ...(target.spec || {}), colors: list.includes(id) ? list.filter(item => item !== id) : [...list, id].slice(-3) };
  }, { area: 'outfit' });
  return <div className="panel-stack">
    <OutfitTabs draft={draft} outfitId={outfitId} onOutfit={onOutfit} edit={edit} />
    <label className="field"><span>{t('creator.outfit.name')}</span><input value={outfit.name} maxLength={160} onChange={event => { const value = event.target.value; edit(next => { outfitOf(next, outfitId).name = value; }, { group: 'outfit-name' }); }} /></label>
    <Section title={t('creator.outfit.style')}>
      <div className="tile-grid tile-grid-3 tile-tall">{L.outfitStyles.map(style => <Tile key={style.id} label={style.label} title={t('creator.outfit.styleTitle', { label: style.label, hint: style.hint })} selected={spec.style === style.id}
        onClick={() => edit(next => { const target = outfitOf(next, outfitId); target.spec = { ...(target.spec || {}), style: style.id, ...style.defaults }; }, { area: 'outfit' })}>
        <OptionImage group="outfit" id={style.id} />
      </Tile>)}</div>
    </Section>
    <Section title={t('creator.outfit.colors')} aside={palette.length ? <span className="sec-note">{t('creator.outfit.colorOrder', { roles: formatList(roles) })}</span> : null}>
      {palette.length ? <div className="color-picks">{palette.map(swatch => {
        const order = colors.indexOf(swatch.id);
        return <button type="button" key={swatch.id} className="color-pick" aria-pressed={order >= 0} onClick={() => toggleColor(swatch.id)} title={order >= 0 ? roles[order] : t('creator.outfit.addColor')}>
          <span className="color-pick-dot" style={{ background: swatch.hex }}>{order >= 0 && <b>{order + 1}</b>}</span><small>{swatch.name}</small>
        </button>;
      })}</div> : <div className="empty-inline"><p>{t('creator.outfit.noPalette')}</p><button type="button" className="btn btn-secondary" onClick={onGoColors}>{t('creator.outfit.goPalette')}</button></div>}
    </Section>
    <Section title={t('creator.outfit.silhouette')}>
      <div className="tile-grid tile-grid-3 tile-tall">{L.silhouettes.map(option => <Tile key={option.id} label={option.label} selected={spec.silhouette === option.id} onClick={() => setSpec('silhouette', option.id)}>
        <OptionImage group="silhouette" id={option.id} />
      </Tile>)}</div>
    </Section>
    <Section title={t('creator.outfit.layers')}>
      <div className="tile-grid tile-grid-3 tile-tall">{L.layerOptions.map(option => <Tile key={option.id} label={option.label} selected={spec.layers === option.id} onClick={() => setSpec('layers', option.id)}>
        <OptionImage group="layers" id={option.id} />
      </Tile>)}</div>
    </Section>
    <Section title={t('creator.outfit.detail')}><div className="chip-row">{L.detailOptions.map(option => <button type="button" key={option.id} className="chip" aria-pressed={spec.detail === option.id} onClick={() => setSpec('detail', option.id)}>{option.label}</button>)}</div></Section>
  </div>;
}
