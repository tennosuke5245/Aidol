import { useMemo, useState } from 'react';
import { Sparkle, Trash, X } from '@phosphor-icons/react';
import { assetFor } from './api';
import { CharacterGraph, kindNames } from './CharacterGraph';
import { CropThumb } from './CropThumb';
import { DrawRack } from './DrawRack';
import { sharedText, t, useT } from './i18n';
import { L } from './lib-i18n';
import { figureArt } from './optionArt';
import { Busy, Modal, PartForm } from './Panels';
import { Toggle } from './ui';
import { jobPresentation } from '../shared/agent-workspace.mjs';
import { outfitOf, uid } from './creator/helpers';

const views = ['front', 'back', 'detail'];
const viewLabel = id => t(`canvas.view.${id}`);
// 新裝備預設的穿戴位置：用種類名稱（和新增裝備表單的種類同一組文字），沒有時寫「身上」。
const defaultAnchor = kind => (kind && t(`panels.part.kinds.${kind}`, { defaultValue: '' })) || t('canvas.inspector.defaultAnchor');

// 畫布：人物在中間，裝備在兩側自動連線。點人物進入捏角色；點裝備在右側看細節、畫設計圖。
export function CanvasView({ studio, project, outfitId, app, d }) {
  const t = useT();
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const shown = useMemo(() => ({ ...project, character: d.draft }), [project, d.draft]);
  const part = selected && d.draft.components[selected];
  const addPart = value => {
    const id = uid('part');
    d.edit(next => {
      next.components[id] = { id, name: value.name.trim(), kind: value.kind, description: value.description || '', designStatus: 'draft' };
      outfitOf(next, outfitId)?.equipped.push({ id: uid('wear'), componentId: id, anchor: defaultAnchor(value.kind), enabled: true });
    });
    setAdding(false); setSelected(id);
  };
  return <div className="canvas-view">
    <CharacterGraph project={shown} outfitId={outfitId} selectedId={selected} onSelect={setSelected}
      onOpenCreator={app.goCreator} onDecompose={app.decompose} onAdd={() => setAdding(true)} onPreview={app.preview} placeholder={figureArt}
      onCreateAnnotation={studio.createAnnotation} onUpdateAnnotation={studio.updateAnnotation} onDeleteAnnotation={studio.deleteAnnotation} onAddCanvasReference={studio.addCanvasReference} />
    {!part && <DrawRack project={project} onOpen={app.openSummon} />}
    {part && <PartInspector key={part.id} project={project} draft={d.draft} edit={d.edit} outfitId={outfitId} part={part} app={app} onClose={() => setSelected(null)} />}
    {adding && <Modal title={t('canvas.addPiece.title')} subtitle={t('canvas.addPiece.subtitle')} onClose={() => setAdding(false)}><PartForm onSave={addPart} /></Modal>}
  </div>;
}

function PartInspector({ project, draft, edit, outfitId, part, app, onClose }) {
  const t = useT();
  const [view, setView] = useState('front');
  const [count, setCount] = useState(2);
  const [note, setNote] = useState('');
  const [drawing, setDrawing] = useState(false);
  const outfit = outfitOf(draft, outfitId);
  const slot = outfit?.equipped.find(item => item.componentId === part.id);
  const portrait = assetFor(project, 'character', outfitId);
  const design = assetFor(project, part.id);
  const cropAsset = part.crop && project.assets.find(asset => asset.id === part.crop.assetId);
  const shots = Object.fromEntries(views.map(id => [id, id === 'front' ? design : assetFor(project, part.id, outfitId, id)]));
  const hasImages = project.assets.some(asset => asset.targetId === part.id && asset.role === 'design');
  const jobs = project.jobs.filter(job => job.targetId === part.id).map(job => ({ job, view: jobPresentation(project, job, job.outfitId) })).filter(item => item.view.needsAttention || item.job.status === 'running');
  const set = (mutate, group) => edit(next => mutate(next.components[part.id], next), { group });
  const setSlot = (mutate, group) => edit(next => {
    const target = outfitOf(next, outfitId);
    let item = target.equipped.find(entry => entry.componentId === part.id);
    if (!item) { item = { id: uid('wear'), componentId: part.id, anchor: defaultAnchor(part.kind), enabled: true }; target.equipped.push(item); }
    mutate(item);
  }, { group });
  const remove = () => {
    if (hasImages) { setSlot(item => { item.enabled = false; }); return; }
    edit(next => { delete next.components[part.id]; Object.values(next.outfits).forEach(item => { item.equipped = item.equipped.filter(entry => entry.componentId !== part.id); }); });
    onClose();
  };
  async function draw() {
    setDrawing(true);
    try {
      const region = part.crop && portrait && part.crop.assetId === portrait.id ? { x: part.crop.x, y: part.crop.y, width: part.crop.width, height: part.crop.height } : undefined;
      const done = await app.draw({ targetId: part.id, view, variants: count, note, region });
      if (done) setNote('');
    } finally { setDrawing(false); }
  }
  return <aside className="inspector" aria-label={t('canvas.inspector.aria', { name: part.name })}>
    <header className="inspector-head"><span>{part.designStatus === 'proposed' ? t('canvas.inspector.proposed') : t('canvas.inspector.piece')}</span><button type="button" className="icon-btn" aria-label={t('ui.close')} onClick={onClose}><X size={18} /></button></header>
    <div className="inspector-body">
      <div className="inspector-art">
        {design ? <img src={design.url} alt={t('canvas.part.designAlt', { name: part.name })} />
          : cropAsset ? <CropThumb url={cropAsset.url} crop={part.crop} aspect={4 / 3} alt={t('canvas.part.cropAlt', { name: part.name })} />
            : <span className="part-icon"><Sparkle size={30} weight="light" /></span>}
      </div>
      {!design && <p className="inspector-note">{cropAsset ? t('canvas.inspector.cropNote') : t('canvas.inspector.noDesign')}</p>}
      {jobs.map(({ job, view: state }) => <button type="button" key={job.id} className={`rack-item tone-${state.tone}`} onClick={() => app.openSummon(job.id)}><span className="rack-copy"><b>{state.action === 'handoff' ? t('canvas.status.sendInCodex') : sharedText(state.labelKey, state.labelParams, state.label)}</b><small>{t('canvas.inspector.openJob')}</small></span></button>)}
      <label className="field"><span>{t('panels.part.name')}</span><input value={part.name} maxLength={160} onChange={event => { const value = event.target.value; set(item => { item.name = value || item.name; }, `part-name-${part.id}`); }} /></label>
      <div className="form-row">
        <label className="field"><span>{t('panels.part.kind')}</span><select value={part.kind} onChange={event => { const value = event.target.value; set(item => { item.kind = value; }); }}>{Object.entries(kindNames()).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="field"><span>{t('canvas.inspector.anchor')}</span><input value={slot?.anchor || ''} maxLength={200} placeholder={t('canvas.inspector.anchorPlaceholder')} onChange={event => { const value = event.target.value; setSlot(item => { item.anchor = value; }, `part-anchor-${part.id}`); }} /></label>
      </div>
      <label className="field"><span>{t('panels.part.description')}</span><textarea rows={3} maxLength={12000} value={part.description} placeholder={t('canvas.inspector.descriptionPlaceholder')} onChange={event => { const value = event.target.value; set(item => { item.description = value; }, `part-desc-${part.id}`); }} /></label>
      {(shots.back || shots.detail) && <div className="inspector-views">{views.map(id => <figure key={id}>{shots[id] ? <button type="button" onClick={() => app.preview(shots[id], t('canvas.inspector.previewTitle', { name: part.name, view: viewLabel(id) }))}><img src={shots[id].url} alt="" /></button> : <span className="is-missing">{t('canvas.status.notDrawn')}</span>}<figcaption>{viewLabel(id)}</figcaption></figure>)}</div>}
      <section className="inspector-draw" aria-label={t('canvas.inspector.draw')}>
        <div className="tabs" role="group" aria-label={t('canvas.inspector.whichView')}>{views.map(id => <button type="button" key={id} aria-selected={view === id} onClick={() => setView(id)}>{viewLabel(id)}</button>)}</div>
        <textarea rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder={part.description || t('canvas.inspector.notePlaceholder')} aria-label={t('canvas.inspector.noteAria')} />
        <div className="drawbar-row">
          <div className="count-seg" role="group" aria-label={t('canvas.inspector.count')}>{L.variantCounts.map(value => <button type="button" key={value} aria-pressed={count === value} onClick={() => setCount(value)}>×{value}</button>)}</div>
          <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={drawing || !portrait} title={portrait ? '' : t('canvas.inspector.needPortrait')} onClick={draw}>{drawing ? <Busy>{t('canvas.inspector.preparing')}</Busy> : <><Sparkle size={15} weight="fill" />{t('canvas.inspector.draw')}</>}</button>
        </div>
        {!portrait && <p className="inspector-note">{t('canvas.inspector.needPortraitNote')}</p>}
      </section>
    </div>
    <footer className="inspector-foot">
      <label><Toggle checked={Boolean(slot?.enabled)} label={slot?.enabled ? t('canvas.inspector.takeOff') : t('canvas.inspector.putOn')} onChange={value => setSlot(item => { item.enabled = value; })} />{slot?.enabled ? t('canvas.inspector.worn') : t('canvas.status.notWorn')}</label>
      <button type="button" className="btn btn-danger btn-sm" onClick={remove} title={hasImages ? t('canvas.inspector.removeKeepHint') : t('canvas.inspector.removeHint')}><Trash size={14} />{hasImages ? t('canvas.inspector.takeOff') : t('canvas.inspector.remove')}</button>
    </footer>
  </aside>;
}
