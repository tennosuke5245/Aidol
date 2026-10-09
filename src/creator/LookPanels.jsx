import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import * as L from '../../shared/libraries.mjs';
import { optionArt } from '../optionArt';
import { Section, StepSlider, SwatchRow, Tile } from '../ui';
import { outfitOf, setDna, uid } from './helpers';

// 中性人台的選項圖（只有對應部位不同）；圖還沒放進來時只顯示文字。
function OptionImage({ group, id }) {
  const src = optionArt(group, id);
  return src ? <img src={src} alt="" draggable="false" /> : null;
}

export function BodyPanel({ draft, edit, outfitId }) {
  const body = draft.dna?.body || {};
  const set = (key, value) => edit(next => setDna(next, 'body', key, value), { area: 'body', group: `body-${key}` });
  return <div className="panel-stack">
    <StepSlider label="年齡感" options={L.ages} value={body.age} onChange={value => set('age', value)} />
    <StepSlider label="頭身比" options={L.headRatios} value={body.headRatio} onChange={value => set('headRatio', value)} />
    <StepSlider label="身高" options={L.heights} value={body.height} onChange={value => set('height', value)} />
    <Section title="體型">
      <div className="tile-grid tile-grid-3 tile-tall">{L.builds.map(option => <Tile key={option.id} label={option.label} selected={body.build === option.id} onClick={() => set('build', option.id)}>
        <OptionImage group="build" id={option.id} />
      </Tile>)}</div>
    </Section>
  </div>;
}

export function HairPanel({ draft, edit, outfitId }) {
  const [tag, setTag] = useState('all');
  const hair = draft.dna?.hair || {};
  const set = (key, value, group) => edit(next => setDna(next, 'hair', key, value), { area: 'hair', group });
  const styles = L.hairStyles.filter(style => tag === 'all' || style.tags.includes(tag));
  return <div className="panel-stack">
    <div className="chip-row" role="group" aria-label="髮型分類">{[{ id: 'all', label: '全部' }, ...L.hairTags].map(item => <button type="button" key={item.id} className="chip" aria-pressed={tag === item.id} onClick={() => setTag(item.id)}>{item.label}</button>)}</div>
    <div className="tile-grid tile-grid-3">{styles.map(style => <Tile key={style.id} label={style.label} selected={hair.style === style.id}
      onClick={() => edit(next => { setDna(next, 'hair', 'style', style.id); Object.entries(style.defaults).forEach(([key, value]) => setDna(next, 'hair', key, value)); }, { area: 'hair' })}>
      <OptionImage group="hair" id={style.id} />
    </Tile>)}</div>
    <Section title="髮色"><SwatchRow label="髮色" options={L.hairColors} value={hair.color} size={34} onChange={value => set('color', value)} /></Section>
    <Section title="挑染"><SwatchRow label="挑染" options={L.hairColors} value={hair.accent} allowNone size={28} onChange={value => set('accent', value)} /></Section>
    <StepSlider label="長度" options={L.hairLengths} value={hair.length} onChange={value => set('length', value, 'hair-length')} />
    <StepSlider label="蓬度" options={L.hairVolumes} value={hair.volume} onChange={value => set('volume', value, 'hair-volume')} />
    <Section title="瀏海">
      <div className="tile-grid tile-grid-3">{L.hairBangs.map(option => <Tile key={option.id} label={option.label} selected={hair.bangs === option.id} onClick={() => set('bangs', option.id)}>
        <OptionImage group="bangs" id={option.id} />
      </Tile>)}</div>
    </Section>
    <Section title="髮質"><div className="chip-row">{L.hairTextures.map(option => <button type="button" key={option.id} className="chip" aria-pressed={hair.texture === option.id} onClick={() => set('texture', option.id)}>{option.label}</button>)}</div></Section>
  </div>;
}

export function FacePanel({ draft, edit, outfitId }) {
  const face = draft.dna?.face || {};
  const set = (key, value) => edit(next => setDna(next, 'face', key, value), { area: 'face' });
  const faces = (list, key, group, columns, shape = '') => <div className={`tile-grid tile-grid-${columns} ${shape}`}>{list.map(option => <Tile key={option.id} label={option.label} selected={face[key] === option.id} onClick={() => set(key, option.id)}>
    <OptionImage group={group} id={option.id} />
  </Tile>)}</div>;
  return <div className="panel-stack">
    <Section title="神情">{faces(L.moods, 'mood', 'mood', 4)}</Section>
    <Section title="眼型">{faces(L.eyeShapes, 'eyeShape', 'eye', 3, 'tile-face')}</Section>
    <Section title="眉毛">{faces(L.brows, 'brows', 'brow', 3, 'tile-face')}</Section>
    <Section title="眼睛顏色"><SwatchRow label="眼睛顏色" options={L.eyeColors} value={face.eyeColor} size={34} onChange={value => set('eyeColor', value)} /></Section>
  </div>;
}

export function OutfitTabs({ draft, outfitId, onOutfit, edit }) {
  const outfits = Object.values(draft.outfits || {});
  const add = () => {
    const id = uid('outfit');
    edit(next => { const current = outfitOf(next, outfitId); next.outfits[id] = { id, name: `套裝 ${outfits.length + 1}`, equipped: (current?.equipped || []).map(item => ({ ...item, id: uid('wear') })), ...(current?.spec ? { spec: { ...current.spec } } : {}) }; });
    onOutfit(id);
  };
  return <div className="outfit-tabs">
    {outfits.length > 1 && <div className="tabs" role="tablist" aria-label="套裝">{outfits.map(outfit => <button type="button" role="tab" key={outfit.id} aria-selected={outfit.id === outfitId} onClick={() => onOutfit(outfit.id)}>{outfit.name || '未命名套裝'}</button>)}</div>}
    <button type="button" className="btn btn-text" onClick={add}><Plus size={14} />新增套裝</button>
  </div>;
}

export function OutfitPanel({ draft, edit, outfitId, onOutfit, onGoColors }) {
  const outfit = outfitOf(draft, outfitId);
  if (!outfit) return <p className="hint">這個角色還沒有套裝。</p>;
  const spec = outfit.spec || {};
  const setSpec = (key, value) => edit(next => { const target = outfitOf(next, outfitId); target.spec = { ...(target.spec || {}), [key]: value }; }, { area: 'outfit' });
  const palette = draft.palette || [];
  const colors = spec.colors || [];
  const roles = ['外套／上衣', '內搭／下身', '點綴'];
  const toggleColor = id => edit(next => {
    const target = outfitOf(next, outfitId);
    const list = target.spec?.colors || [];
    target.spec = { ...(target.spec || {}), colors: list.includes(id) ? list.filter(item => item !== id) : [...list, id].slice(-3) };
  }, { area: 'outfit' });
  return <div className="panel-stack">
    <OutfitTabs draft={draft} outfitId={outfitId} onOutfit={onOutfit} edit={edit} />
    <label className="field"><span>套裝名稱</span><input value={outfit.name} maxLength={160} onChange={event => { const value = event.target.value; edit(next => { outfitOf(next, outfitId).name = value; }, { group: 'outfit-name' }); }} /></label>
    <Section title="風格">
      <div className="tile-grid tile-grid-3 tile-tall">{L.outfitStyles.map(style => <Tile key={style.id} label={style.label} title={`${style.label}：${style.hint}`} selected={spec.style === style.id}
        onClick={() => edit(next => { const target = outfitOf(next, outfitId); target.spec = { ...(target.spec || {}), style: style.id, ...style.defaults }; }, { area: 'outfit' })}>
        <OptionImage group="outfit" id={style.id} />
      </Tile>)}</div>
    </Section>
    <Section title="配色" aside={palette.length ? <span className="sec-note">依序：{roles.join('、')}</span> : null}>
      {palette.length ? <div className="color-picks">{palette.map(swatch => {
        const order = colors.indexOf(swatch.id);
        return <button type="button" key={swatch.id} className="color-pick" aria-pressed={order >= 0} onClick={() => toggleColor(swatch.id)} title={order >= 0 ? roles[order] : '加入配色'}>
          <span className="color-pick-dot" style={{ background: swatch.hex }}>{order >= 0 && <b>{order + 1}</b>}</span><small>{swatch.name}</small>
        </button>;
      })}</div> : <div className="empty-inline"><p>還沒有色票。先到「色彩」定下角色的顏色，再回來挑。</p><button type="button" className="btn btn-secondary" onClick={onGoColors}>去設定色彩</button></div>}
    </Section>
    <Section title="輪廓">
      <div className="tile-grid tile-grid-3 tile-tall">{L.silhouettes.map(option => <Tile key={option.id} label={option.label} selected={spec.silhouette === option.id} onClick={() => setSpec('silhouette', option.id)}>
        <OptionImage group="silhouette" id={option.id} />
      </Tile>)}</div>
    </Section>
    <Section title="層次">
      <div className="tile-grid tile-grid-3 tile-tall">{L.layerOptions.map(option => <Tile key={option.id} label={option.label} selected={spec.layers === option.id} onClick={() => setSpec('layers', option.id)}>
        <OptionImage group="layers" id={option.id} />
      </Tile>)}</div>
    </Section>
    <Section title="細節"><div className="chip-row">{L.detailOptions.map(option => <button type="button" key={option.id} className="chip" aria-pressed={spec.detail === option.id} onClick={() => setSpec('detail', option.id)}>{option.label}</button>)}</div></Section>
  </div>;
}
