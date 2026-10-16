import { useCallback, useMemo, useRef, useState } from 'react';
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
import { TurnaroundViewer } from './TurnaroundViewer';
import { ViewCropEditor } from './ViewCropEditor';
import { jobPresentation } from '../shared/agent-workspace.mjs';
import { allViews } from '../shared/domain.mjs';
import { mainOutfitId } from '../shared/wardrobe.mjs';
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
  const [cropping, setCropping] = useState(false);
  const [drawingView, setDrawingView] = useState(null);
  const [viewing, setViewing] = useState(null);
  // 從畫圖對話框去編輯標註：寫到一半的內容先記著，關掉並排看後回到同一個對話框。
  const [drawDraft, setDrawDraft] = useState(null);
  const shown = useMemo(() => ({ ...project, character: d.draft }), [project, d.draft]);
  // 三視圖：舊角色請 AI 找角度、只有一個角度時補畫三視圖、框錯時手動調整裁切。
  const sheet = project.assets.find(asset => asset.id === project.character.adopted.character);
  const { run, detectViews, adjustViews, importMain, mainAsFront, addExtraView, removeExtraView, createViewNote, updateViewNote, deleteViewNote, notify } = studio;
  const draw = app.draw;
  const onDetectViews = useCallback(() => run(() => detectViews()), [run, detectViews]);
  const onDrawFront = useCallback(() => draw({ targetId: 'character', framing: 'frontView', variants: 2 }), [draw]);
  const onAsFront = useCallback(() => run(() => mainAsFront()), [run, mainAsFront]);
  const onAdjustViews = useCallback(() => setCropping(true), []);
  // 畫（或重畫）側面、背面：先問這次要注意或要修正什麼，再照正面畫；採用後只換掉那一張。
  const onDrawView = useCallback(view => setDrawingView(view), []);
  // 並排看：所有角度並排比對、加標註（點角度的圖打開，捲到那個角度）。
  const onOpenViews = useCallback(view => setViewing(view || 'front'), []);
  // 加角度：先放空位，接著直接問要畫什麼；拿掉加的角度（畫好的那張留在圖鑑）。
  const onAddView = useCallback(async view => { if (await run(() => addExtraView(view))) setDrawingView(view); }, [run, addExtraView]);
  const onRemoveView = useCallback(view => run(() => removeExtraView(view)), [run, removeExtraView]);
  // 已經有三視圖：上傳一張，或直接用建立時附的定稿，當作正式三視圖（接著自動拆）。
  const sheetInput = useRef(null);
  const onImportSheet = useCallback(() => sheetInput.current?.click(), []);
  const canonId = (d.draft.style.references || []).find(reference => reference.canon)?.assetId;
  // 畫布上一律是正式立繪：已經有正式立繪時，匯入的三視圖算主要那套穿搭。
  const sheetOutfit = project.character.adopted?.character ? mainOutfitId(project) : outfitId;
  const importSheet = useCallback(async source => { if (await run(() => importMain({ ...source, outfitId: sheetOutfit }))) notify(t('canvas.views.imported')); }, [run, importMain, sheetOutfit, notify, t]);
  const onUseCanon = useCallback(() => { if (canonId) importSheet({ fromAssetId: canonId }); }, [canonId, importSheet]);
  const applyCrop = async boxes => {
    const done = await run(() => adjustViews(boxes));
    if (done) { setCropping(false); notify(t('canvas.views.editor.done')); }
  };
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
      onCreateAnnotation={studio.createAnnotation} onUpdateAnnotation={studio.updateAnnotation} onDeleteAnnotation={studio.deleteAnnotation} onAddCanvasReference={studio.addCanvasReference}
      viewSplit={studio.viewSplit} onDetectViews={onDetectViews} onDrawFront={onDrawFront} onAdjustViews={onAdjustViews} onDrawView={onDrawView} onImportSheet={onImportSheet} onUseCanon={onUseCanon} onAsFront={onAsFront} onOpenViews={onOpenViews} onAddView={onAddView} onRemoveView={onRemoveView} />
    <input ref={sheetInput} className="sr-only" tabIndex={-1} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('canvas.views.slot.import')} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) importSheet({ file }); }} />
    {!part && <DrawRack project={project} onOpen={app.openSummon} />}
    {part && <PartInspector key={part.id} project={project} draft={d.draft} edit={d.edit} outfitId={outfitId} part={part} app={app} onClose={() => setSelected(null)} />}
    {adding && <Modal title={t('canvas.addPiece.title')} subtitle={t('canvas.addPiece.subtitle')} onClose={() => setAdding(false)}><PartForm onSave={addPart} /></Modal>}
    {drawingView && <ViewDrawDialog key={drawingView} project={project} view={drawingView} busy={studio.busy} initial={drawDraft?.view === drawingView ? drawDraft : null} onClose={() => { setDrawingView(null); setDrawDraft(null); }}
      onEditNotes={state => { setDrawDraft({ view: drawingView, ...state }); setDrawingView(null); setViewing(drawingView); }}
      onDraw={async options => { const job = await draw({ targetId: 'character', view: drawingView, ...options }); if (job) { setDrawingView(null); setDrawDraft(null); } }} />}
    {viewing && project.views?.status === 'done' && <TurnaroundViewer project={project} focus={viewing} busy={studio.busy} onClose={() => { setViewing(null); if (drawDraft) setDrawingView(drawDraft.view); }}
      onDraw={view => { setViewing(null); if (drawDraft?.view !== view) setDrawDraft(null); setDrawingView(view); }} onAdjust={() => { setViewing(null); setDrawDraft(null); setCropping(true); }} onRemove={onRemoveView}
      onCreateNote={input => run(() => createViewNote(input))} onUpdateNote={(id, patch) => run(() => updateViewNote(id, patch))} onDeleteNote={id => run(() => deleteViewNote(id))} />}
    {cropping && sheet && <Modal title={t('canvas.views.editor.title')} subtitle={t('canvas.views.editor.subtitle')} wide onClose={() => setCropping(false)}>
      <ViewCropEditor key={sheet.id} asset={sheet} views={project.views?.assetId === sheet.id ? project.views : null} busy={studio.busy} onCancel={() => setCropping(false)} onApply={applyCrop} />
    </Modal>}
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
  // 裝備的框選位置記在正式立繪上（畫布上一律顯示正式立繪）。
  const portrait = assetFor(project, 'character');
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
      const done = await app.draw({ targetId: part.id, view, variants: count, note, region, outfitId });
      if (done) setNote('');
    } finally { setDrawing(false); }
  }
  return <aside className="inspector" aria-label={t('canvas.inspector.aria', { name: part.name })}>
    <header className="inspector-head"><span>{part.designStatus === 'proposed' ? (part.crop ? t('canvas.inspector.proposed') : t('canvas.inspector.proposedText')) : t('canvas.inspector.piece')}</span><button type="button" className="icon-btn" aria-label={t('ui.close')} onClick={onClose}><X size={18} /></button></header>
    <div className="inspector-body">
      <div className="inspector-art">
        {design ? <img src={design.url} alt={t('canvas.part.designAlt', { name: part.name })} />
          : cropAsset ? <CropThumb url={cropAsset.url} crop={part.crop} aspect={4 / 3} alt={t('canvas.part.cropAlt', { name: part.name })} />
            : <span className="part-icon"><Sparkle size={30} weight="light" /></span>}
      </div>
      {!design && <p className="inspector-note">{cropAsset ? t('canvas.inspector.cropNote') : t('canvas.inspector.noDesign')}</p>}
      {jobs.map(({ job, view: state }) => <button type="button" key={job.id} className={`rack-item tone-${state.tone}`} onClick={() => app.openSummon(job.id)}><span className="rack-copy"><b>{state.action === 'handoff' && job.status !== 'failed' ? t('canvas.status.sendInCodex') : sharedText(state.labelKey, state.labelParams, state.label)}</b><small>{t('canvas.inspector.openJob')}</small></span></button>)}
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

// 畫（或重畫）三視圖的側面、背面：照正面畫。重畫時先問「哪裡要修」——原本那張不會交給 AI，免得照抄畫壞的地方。
function ViewDrawDialog({ project, view, busy, initial, onClose, onDraw, onEditNotes }) {
  const t = useT();
  const [note, setNote] = useState(initial?.note || '');
  const [count, setCount] = useState(initial?.count || 2);
  const items = project.views?.items || {};
  const redo = Boolean(items[view]);
  const label = t(`canvas.views.view.${view}`);
  const asset = id => id && project.assets.find(item => item.id === id);
  const front = asset(items.front?.assetId), current = asset(items[view]?.assetId);
  // 一起交給 AI 的：正面以外、已經確認的其他角度（不含這次要畫的這張）。
  const others = allViews.filter(other => other !== 'front' && other !== view).map(other => [other, asset(items[other]?.assetId)]).filter(([, item]) => item);
  const notes = project.viewNotes || [];
  return <Modal title={redo ? t('canvas.views.dialog.redrawTitle', { view: label }) : t('canvas.views.dialog.drawTitle', { view: label })} subtitle={redo ? t('canvas.views.dialog.redrawSubtitle', { view: label }) : t('canvas.views.dialog.drawSubtitle', { view: label })} onClose={onClose}>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); onDraw({ note, variants: count }); }}>
      <p className="view-dialog-spec">{t(`canvas.views.spec.${view}`)}</p>
      <div className="view-dialog-refs">
        {front && <figure><img src={front.url} alt="" /><figcaption>{t('canvas.views.dialog.follows')}</figcaption></figure>}
        {others.map(([other, item]) => <figure key={other}><img src={item.url} alt="" /><figcaption>{t('canvas.views.dialog.alsoSent', { view: t(`canvas.views.view.${other}`) })}</figcaption></figure>)}
        {current && <figure className="is-old"><img src={current.url} alt="" /><figcaption>{t('canvas.views.dialog.notSent', { view: label })}</figcaption></figure>}
      </div>
      <div className="view-dialog-notes">
        <span>{notes.length ? t('canvas.views.dialog.notesSent', { count: notes.length }) : t('canvas.views.dialog.noNotes')}</span>
        {notes.length > 0 && <ol>{notes.slice(0, 4).map((item, index) => <li key={item.id}><b>{index + 1}</b>{item.title ? `${item.title}${t('canvas.viewer.titleSep')}` : ''}{item.text}</li>)}{notes.length > 4 && <li className="is-more">{t('canvas.views.dialog.moreNotes', { count: notes.length - 4 })}</li>}</ol>}
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onEditNotes({ note, count })}>{notes.length ? t('canvas.views.dialog.editNotes') : t('canvas.views.dialog.addNotes')}</button>
      </div>
      <label className="field"><span>{redo ? t('canvas.views.dialog.fixLabel') : t('canvas.views.dialog.noteLabel')}</span><textarea rows={3} maxLength={2000} value={note} autoFocus onChange={event => setNote(event.target.value)} placeholder={redo ? t('canvas.views.dialog.fixPlaceholder') : t('canvas.views.dialog.notePlaceholder')} /></label>
      <div className="field"><span>{t('canvas.inspector.count')}</span><div className="count-seg" role="group">{L.variantCounts.map(value => <button type="button" key={value} aria-pressed={count === value} onClick={() => setCount(value)}>×{value}</button>)}</div></div>
      <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? <Busy>{t('canvas.inspector.preparing')}</Busy> : <><Sparkle size={16} weight="fill" />{redo ? t('canvas.views.redraw', { view: label }) : t('canvas.views.draw', { view: label })}</>}</button>
    </form>
  </Modal>;
}
