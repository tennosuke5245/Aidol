import { useMemo, useState } from 'react';
import { Sparkle, Trash, X } from '@phosphor-icons/react';
import * as L from '../shared/libraries.mjs';
import { assetFor } from './api';
import { CharacterGraph, kindNames } from './CharacterGraph';
import { CropThumb } from './CropThumb';
import { DrawRack } from './DrawRack';
import { figureArt } from './optionArt';
import { Busy, Modal, PartForm } from './Panels';
import { Toggle } from './ui';
import { jobPresentation } from '../shared/agent-workspace.mjs';
import { kindLabels, outfitOf, uid } from './creator/helpers';

const views = [['front', '正面'], ['back', '背面'], ['detail', '細節']];

// 畫布：人物在中間，裝備在兩側自動連線。點人物進入捏角色；點裝備在右側看細節、畫設計圖。
export function CanvasView({ studio, project, outfitId, app, d }) {
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const shown = useMemo(() => ({ ...project, character: d.draft }), [project, d.draft]);
  const part = selected && d.draft.components[selected];
  const addPart = value => {
    const id = uid('part');
    d.edit(next => {
      next.components[id] = { id, name: value.name.trim(), kind: value.kind, description: value.description || '', designStatus: 'draft' };
      outfitOf(next, outfitId)?.equipped.push({ id: uid('wear'), componentId: id, anchor: kindLabels[value.kind] || '身上', enabled: true });
    });
    setAdding(false); setSelected(id);
  };
  return <div className="canvas-view">
    <CharacterGraph project={shown} outfitId={outfitId} selectedId={selected} onSelect={setSelected}
      onOpenCreator={app.goCreator} onDecompose={app.decompose} onAdd={() => setAdding(true)} onPreview={app.preview} placeholder={figureArt}
      onCreateAnnotation={studio.createAnnotation} onUpdateAnnotation={studio.updateAnnotation} onDeleteAnnotation={studio.deleteAnnotation} onAddCanvasReference={studio.addCanvasReference} />
    {!part && <DrawRack project={project} onOpen={app.openSummon} />}
    {part && <PartInspector key={part.id} project={project} draft={d.draft} edit={d.edit} outfitId={outfitId} part={part} app={app} onClose={() => setSelected(null)} />}
    {adding && <Modal title="新增裝備" subtitle="先寫下名字和樣子，之後可以單獨畫出設計圖。" onClose={() => setAdding(false)}><PartForm onSave={addPart} /></Modal>}
  </div>;
}

function PartInspector({ project, draft, edit, outfitId, part, app, onClose }) {
  const [view, setView] = useState('front');
  const [count, setCount] = useState(2);
  const [note, setNote] = useState('');
  const [drawing, setDrawing] = useState(false);
  const outfit = outfitOf(draft, outfitId);
  const slot = outfit?.equipped.find(item => item.componentId === part.id);
  const portrait = assetFor(project, 'character', outfitId);
  const design = assetFor(project, part.id);
  const cropAsset = part.crop && project.assets.find(asset => asset.id === part.crop.assetId);
  const shots = Object.fromEntries(views.map(([id]) => [id, id === 'front' ? design : assetFor(project, part.id, outfitId, id)]));
  const hasImages = project.assets.some(asset => asset.targetId === part.id && asset.role === 'design');
  const jobs = project.jobs.filter(job => job.targetId === part.id).map(job => ({ job, view: jobPresentation(project, job, job.outfitId) })).filter(item => item.view.needsAttention || item.job.status === 'running');
  const set = (mutate, group) => edit(next => mutate(next.components[part.id], next), { group });
  const setSlot = (mutate, group) => edit(next => {
    const target = outfitOf(next, outfitId);
    let item = target.equipped.find(entry => entry.componentId === part.id);
    if (!item) { item = { id: uid('wear'), componentId: part.id, anchor: kindLabels[part.kind] || '身上', enabled: true }; target.equipped.push(item); }
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
  return <aside className="inspector" aria-label={`裝備：${part.name}`}>
    <header className="inspector-head"><span>{part.designStatus === 'proposed' ? 'AI 從立繪拆出的裝備' : '裝備'}</span><button type="button" className="icon-btn" aria-label="關閉" onClick={onClose}><X size={18} /></button></header>
    <div className="inspector-body">
      <div className="inspector-art">
        {design ? <img src={design.url} alt={`${part.name}的設計圖`} />
          : cropAsset ? <CropThumb url={cropAsset.url} crop={part.crop} aspect={4 / 3} alt={`${part.name}在立繪上的位置`} />
            : <span className="part-icon"><Sparkle size={30} weight="light" /></span>}
      </div>
      {!design && <p className="inspector-note">{cropAsset ? '這是從正式立繪裁出的位置，還不是設計圖。畫一張設計圖，就能看清楚正面、背面和細節。' : '還沒有設計圖。寫下樣子後畫一張。'}</p>}
      {jobs.map(({ job, view: state }) => <button type="button" key={job.id} className={`rack-item tone-${state.tone}`} onClick={() => app.openSummon(job.id)}><span className="rack-copy"><b>{state.action === 'handoff' ? '到 Codex 按送出' : state.label}</b><small>點這裡看這次的圖</small></span></button>)}
      <label className="field"><span>名字</span><input value={part.name} maxLength={160} onChange={event => { const value = event.target.value; set(item => { item.name = value || item.name; }, `part-name-${part.id}`); }} /></label>
      <div className="form-row">
        <label className="field"><span>種類</span><select value={part.kind} onChange={event => { const value = event.target.value; set(item => { item.kind = value; }); }}>{Object.entries(kindNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="field"><span>穿戴位置</span><input value={slot?.anchor || ''} maxLength={200} placeholder="例如：腰間" onChange={event => { const value = event.target.value; setSlot(item => { item.anchor = value; }, `part-anchor-${part.id}`); }} /></label>
      </div>
      <label className="field"><span>長什麼樣子</span><textarea rows={3} maxLength={12000} value={part.description} placeholder="顏色、材質、細節" onChange={event => { const value = event.target.value; set(item => { item.description = value; }, `part-desc-${part.id}`); }} /></label>
      {(shots.back || shots.detail) && <div className="inspector-views">{views.map(([id, label]) => <figure key={id}>{shots[id] ? <button type="button" onClick={() => app.preview(shots[id], `${part.name}・${label}`)}><img src={shots[id].url} alt="" /></button> : <span className="is-missing">還沒畫</span>}<figcaption>{label}</figcaption></figure>)}</div>}
      <section className="inspector-draw" aria-label="畫設計圖">
        <div className="tabs" role="group" aria-label="畫哪一面">{views.map(([id, label]) => <button type="button" key={id} aria-selected={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
        <textarea rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder={part.description || '這次想畫什麼？（可不填）'} aria-label="這次想畫什麼" />
        <div className="drawbar-row">
          <div className="count-seg" role="group" aria-label="張數">{L.variantCounts.map(value => <button type="button" key={value} aria-pressed={count === value} onClick={() => setCount(value)}>×{value}</button>)}</div>
          <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={drawing || !portrait} title={portrait ? '' : '先有正式立繪，才能照著立繪畫裝備'} onClick={draw}>{drawing ? <Busy>準備中…</Busy> : <><Sparkle size={15} weight="fill" />畫設計圖</>}</button>
        </div>
        {!portrait && <p className="inspector-note">先在「捏角色」畫出正式立繪，裝備才能照著立繪單獨畫。</p>}
      </section>
    </div>
    <footer className="inspector-foot">
      <label><Toggle checked={Boolean(slot?.enabled)} label={slot?.enabled ? '脫下' : '穿上'} onChange={value => setSlot(item => { item.enabled = value; })} />{slot?.enabled ? '穿著' : '沒穿'}</label>
      <button type="button" className="btn btn-danger btn-sm" onClick={remove} title={hasImages ? '已經畫過圖的裝備會保留，只是脫下' : '從角色移除這件裝備'}><Trash size={14} />{hasImages ? '脫下' : '不要這件'}</button>
    </footer>
  </aside>;
}
