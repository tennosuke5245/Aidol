import { useState } from 'react';
import { Smiley, ArrowRight, Trash } from '@phosphor-icons/react';
import { formatList, useT } from '../i18n';
import { L } from '../lib-i18n';
import { optionArt } from '../optionArt';
import { Section, StepSlider, Tile, Toggle } from '../ui';
import { ColorField } from '../ColorPicker';
import { resolveColor } from '../../shared/colors.mjs';
import { EyePreview } from './EyePreview';
import { expressionList } from '../../shared/expressions.mjs';
import { mainOutfitId } from '../../shared/wardrobe.mjs';
import { outfitOf, setDna, setDnaList } from './helpers';
import { Wardrobe } from './Wardrobe';

// 中性人台的選項圖（只有對應部位不同）；圖還沒放進來時只顯示文字。
function OptionImage({ group, id }) {
  const src = optionArt(group, id);
  return src ? <img src={src} alt="" draggable="false" /> : null;
}

// 多選的小標籤（髮型細節、臉部特徵…）。
function MultiChips({ list, values = [], onToggle, label }) {
  return <div className="chip-row" role="group" aria-label={label}>{list.map(option => <button type="button" key={option.id} className="chip" aria-pressed={values.includes(option.id)} onClick={() => onToggle(option.id)}>{option.label}</button>)}</div>;
}
// 單選的小標籤；再點一次選中的那個就取消（回到未設定）。
function PickChips({ list, value, onPick, label }) {
  return <div className="chip-row" role="group" aria-label={label}>{list.map(option => <button type="button" key={option.id} className="chip" aria-pressed={value === option.id} onClick={() => onPick(value === option.id ? undefined : option.id)}>{option.label}</button>)}</div>;
}
const toggled = (values = [], id) => (values.includes(id) ? values.filter(item => item !== id) : [...values, id]);

export function BodyPanel({ draft, edit, outfitId }) {
  const t = useT();
  const body = draft.dna?.body || {};
  const set = (key, value, group = `body-${key}`) => edit(next => setDna(next, 'body', key, value), { area: 'body', group });
  return <div className="panel-stack">
    <StepSlider label={t('creator.body.age')} options={L.ages} value={body.age} onChange={value => set('age', value)} />
    <StepSlider label={t('creator.body.headRatio')} options={L.headRatios} value={body.headRatio} onChange={value => set('headRatio', value)} />
    <StepSlider label={t('creator.body.height')} options={L.heights} value={body.height} onChange={value => set('height', value)} />
    <Section title={t('creator.body.build')}>
      <div className="tile-grid tile-grid-3 tile-tall">{L.builds.map(option => <Tile key={option.id} label={option.label} selected={body.build === option.id} onClick={() => set('build', option.id)}>
        <OptionImage group="build" id={option.id} />
      </Tile>)}</div>
    </Section>
    <Section title={t('creator.body.skin')}>
      <ColorField label={t('creator.body.skin')} options={L.skinTones} value={body.skin} size={34} palette={draft.palette || []} nameOf={hex => resolveColor(hex, L.skinTones, L, { nearest: true }).label} onChange={value => set('skin', value ?? undefined, 'body-skin')} />
    </Section>
  </div>;
}

export function HairPanel({ draft, edit, outfitId }) {
  const t = useT();
  const [tag, setTag] = useState('all');
  const hair = draft.dna?.hair || {};
  const palette = draft.palette || [];
  const set = (key, value, group) => edit(next => setDna(next, 'hair', key, value), { area: 'hair', group });
  const styles = L.hairStyles.filter(style => tag === 'all' || style.tags.includes(tag));
  // 挑染：先選方式（無／挑染／內層／漸層／雙色），再選顏色。舊資料沒寫方式的就是「挑染」。
  const dye = hair.accent ? hair.accentStyle || 'streak' : 'none';
  const pickDye = id => edit(next => {
    if (id === 'none') { setDna(next, 'hair', 'accent', null); setDna(next, 'hair', 'accentStyle', undefined); return; }
    if (!next.dna?.hair?.accent) setDna(next, 'hair', 'accent', hair.color === 'lavender' ? 'pink' : 'lavender');
    setDna(next, 'hair', 'accentStyle', id);
  }, { area: 'hair' });
  return <div className="panel-stack">
    <div className="chip-row" role="group" aria-label={t('creator.hair.tags')}>{[{ id: 'all', label: t('creator.hair.all') }, ...L.hairTags].map(item => <button type="button" key={item.id} className="chip" aria-pressed={tag === item.id} onClick={() => setTag(item.id)}>{item.label}</button>)}</div>
    <div className="tile-grid tile-grid-3">{styles.map(style => <Tile key={style.id} label={style.label} selected={hair.style === style.id}
      onClick={() => edit(next => { setDna(next, 'hair', 'style', style.id); Object.entries(style.defaults).forEach(([key, value]) => setDna(next, 'hair', key, value)); }, { area: 'hair' })}>
      <OptionImage group="hair" id={style.id} />
    </Tile>)}</div>
    <Section title={t('creator.hair.color')}><ColorField label={t('creator.hair.color')} options={L.hairColors} value={hair.color} size={34} palette={palette} onChange={value => set('color', value ?? undefined, 'hair-color')} /></Section>
    <Section title={t('creator.hair.accent')}>
      <div className="chip-row" role="group" aria-label={t('creator.hair.dyeStyle')}>{[{ id: 'none', label: t('creator.hair.noDye') }, ...L.hairDyeStyles].map(option => <button type="button" key={option.id} className="chip" aria-pressed={dye === option.id} onClick={() => pickDye(option.id)}>{option.label}</button>)}</div>
      {dye !== 'none' && <ColorField label={t('creator.hair.accentColor')} options={L.hairColors} value={hair.accent} size={28} palette={palette} onChange={value => set('accent', value, 'hair-accent')} />}
    </Section>
    <StepSlider label={t('creator.hair.length')} options={L.hairLengths} value={hair.length} onChange={value => set('length', value, 'hair-length')} />
    <StepSlider label={t('creator.hair.volume')} options={L.hairVolumes} value={hair.volume} onChange={value => set('volume', value, 'hair-volume')} />
    <Section title={t('creator.hair.bangs')}>
      <div className="tile-grid tile-grid-3">{L.hairBangs.map(option => <Tile key={option.id} label={option.label} selected={hair.bangs === option.id} onClick={() => set('bangs', option.id)}>
        <OptionImage group="bangs" id={option.id} />
      </Tile>)}</div>
    </Section>
    <Section title={t('creator.hair.texture')}><div className="chip-row">{L.hairTextures.map(option => <button type="button" key={option.id} className="chip" aria-pressed={hair.texture === option.id} onClick={() => set('texture', option.id)}>{option.label}</button>)}</div></Section>
    <Section title={t('creator.hair.extras')} aside={<span className="sec-note">{t('creator.multiNote')}</span>}>
      <MultiChips label={t('creator.hair.extras')} list={L.hairExtras} values={hair.extras} onToggle={id => edit(next => setDnaList(next, 'hair', 'extras', toggled(next.dna?.hair?.extras, id)), { area: 'hair' })} />
    </Section>
  </div>;
}

// 表情集的入口：畫好的表情縮圖，點了打開表情集（照正面畫胸像表情）。
function ExpressionTeaser({ project, onOpen }) {
  const t = useT();
  const list = expressionList(project.expressions);
  const drawn = list.map(key => project.expressions?.items?.[key]?.assetId).filter(Boolean).map(id => project.assets.find(asset => asset.id === id)).filter(Boolean);
  return <Section title={t('expressions.faceSection')} aside={<span className="sec-note">{t('expressions.progress', { done: drawn.length, total: list.length })}</span>}>
    <button type="button" className="expr-teaser" onClick={onOpen}>
      <span className="expr-teaser-art">{drawn.length ? drawn.slice(0, 6).map(asset => <img key={asset.id} src={asset.url} alt="" />) : <Smiley size={24} weight="light" />}</span>
      <span className="expr-teaser-copy"><b>{t('expressions.open')}</b><small>{t('expressions.faceHint')}</small></span>
      <ArrowRight size={16} />
    </button>
  </Section>;
}

export function FacePanel({ draft, edit, outfitId, project, onOpenExpressions }) {
  const t = useT();
  const [eye, setEye] = useState('left');
  const face = draft.dna?.face || {};
  const set = (key, value, group) => edit(next => setDna(next, 'face', key, value), { area: 'face', group });
  const faces = (list, key, group, columns, shape = '') => <div className={`tile-grid tile-grid-${columns} ${shape}`}>{list.map(option => <Tile key={option.id} label={option.label} selected={face[key] === option.id} onClick={() => set(key, option.id)}>
    <OptionImage group={group} id={option.id} />
  </Tile>)}</div>;
  // 異色瞳：eyeColor 是角色的右眼、eyeColorLeft 是左眼。打開時左眼先換一個不同的顏色，接著改的是左眼。
  const hetero = Boolean(face.eyeColorLeft);
  const editing = hetero ? eye : 'both';
  const hexOf = value => resolveColor(value, L.eyeColors)?.hex || '#6B4A38';
  const setHetero = on => {
    edit(next => {
      if (!on) { setDna(next, 'face', 'eyeColorLeft', undefined); return; }
      const right = next.dna?.face?.eyeColor || 'amber';
      setDna(next, 'face', 'eyeColor', right);
      setDna(next, 'face', 'eyeColorLeft', right === 'blue' ? 'amber' : 'blue');
    }, { area: 'face' });
    if (on) setEye('left');
  };
  const eyeValue = editing === 'left' ? face.eyeColorLeft : face.eyeColor;
  const setEyeColor = value => set(editing === 'left' ? 'eyeColorLeft' : 'eyeColor', value ?? undefined, `eye-${editing}`);
  return <div className="panel-stack">
    <Section title={t('creator.face.mood')}>{faces(L.moods, 'mood', 'mood', 4)}</Section>
    <Section title={t('creator.face.eyeShape')}>{faces(L.eyeShapes, 'eyeShape', 'eye', 3, 'tile-face')}</Section>
    <Section title={t('creator.face.brows')}>{faces(L.brows, 'brows', 'brow', 3, 'tile-face')}</Section>
    <Section title={t('creator.face.eyeColor')} aside={<label className="toggle-line"><Toggle checked={hetero} label={t('creator.face.hetero')} onChange={setHetero} /><span>{t('creator.face.hetero')}</span></label>}>
      <EyePreview shape={face.eyeShape} pupil={face.pupil} right={hexOf(face.eyeColor || face.eyeColorLeft)} left={hexOf(face.eyeColorLeft || face.eyeColor)} hetero={hetero} selected={eye} onSelect={setEye} />
      {hetero && <p className="hint">{t('creator.face.heteroHint', { eye: t(eye === 'right' ? 'creator.face.rightEye' : 'creator.face.leftEye') })}</p>}
      <ColorField label={hetero ? t(eye === 'right' ? 'creator.face.rightEye' : 'creator.face.leftEye') : t('creator.face.eyeColor')} options={L.eyeColors} value={eyeValue} size={34} palette={draft.palette || []} onChange={setEyeColor} />
    </Section>
    <Section title={t('creator.face.pupil')}><PickChips label={t('creator.face.pupil')} list={L.pupils} value={face.pupil} onPick={value => set('pupil', value)} /></Section>
    <Section title={t('creator.face.shape')}><PickChips label={t('creator.face.shape')} list={L.faceShapes} value={face.shape} onPick={value => set('shape', value)} /></Section>
    <Section title={t('creator.face.marks')} aside={<span className="sec-note">{t('creator.multiNote')}</span>}>
      <MultiChips label={t('creator.face.marks')} list={L.faceMarks} values={face.marks} onToggle={id => edit(next => setDnaList(next, 'face', 'marks', toggled(next.dna?.face?.marks, id)), { area: 'face' })} />
    </Section>
    {project && onOpenExpressions && <ExpressionTeaser project={project} onOpen={onOpenExpressions} />}
  </div>;
}

export function OutfitPanel({ draft, edit, project, outfitId, onOutfit, onGoColors, hasPortrait, onDelete, onDrawWardrobe, canAuto, busy }) {
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
    <Wardrobe draft={draft} project={project} outfitId={outfitId} onOutfit={onOutfit} edit={edit} onDrawAll={onDrawWardrobe} canAuto={canAuto} busy={busy} />
    <div className="outfit-name-row">
      <label className="field"><span>{t('creator.outfit.name')}</span><input value={outfit.name} maxLength={160} onChange={event => { const value = event.target.value; edit(next => { outfitOf(next, outfitId).name = value; }, { group: 'outfit-name' }); }} /></label>
      {onDelete && Object.keys(draft.outfits || {}).length > 1 && <button type="button" className="btn btn-danger" aria-disabled={hasPortrait && outfit.id === mainOutfitId(project) ? true : undefined} onClick={() => onDelete(outfit.id)}><Trash size={15} />{t('creator.wardrobe.delete')}</button>}
    </div>
    <Section title={t('creator.outfit.scene')}>
      <div className="chip-row">
        <button type="button" className="chip" aria-pressed={!spec.scene} onClick={() => edit(next => { const target = outfitOf(next, outfitId); const { scene: _scene, ...rest } = target.spec || {}; target.spec = rest; }, { area: 'outfit' })}>{t('creator.outfit.sceneNone')}</button>
        {L.outfitScenes.map(scene => <button type="button" key={scene.id} className="chip" aria-pressed={spec.scene === scene.id} onClick={() => setSpec('scene', scene.id)}>{scene.label}</button>)}
      </div>
    </Section>
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
