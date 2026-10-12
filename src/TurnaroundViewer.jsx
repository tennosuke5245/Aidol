import { useEffect, useRef, useState } from 'react';
import { Crop, PaintBrush, Plus, PushPin, Ruler, Trash, X } from '@phosphor-icons/react';
import { allViews, extraViews, turnaroundViews } from '../shared/domain.mjs';
import { bodyRect, NOTE_TEXT_MAX, NOTE_TITLE_MAX } from '../shared/turnaround.mjs';
import { Busy, Modal } from './Panels';
import { useT } from './i18n';

// 並排看：所有角度一樣高、腳底對齊排在一起，像設定資料的三面圖，方便比對比例和左右。
// - 頭頂、腳底兩條參考線（量正面的人物範圍）；可以再加參考線對眼睛、肩膀、腰，拖左邊的把手移動。參考線只記在這台電腦。
// - 標註：按「加標註」再點圖上的位置，寫這裡是什麼、要注意什麼（例如尾巴從哪裡長出來）。之後畫角色的任何圖都會交給 AI。
//   標註可以拖著移動；點一下編輯。
// - 每個角度底下可以畫／重畫、調整裁切，加的角度可以拿掉。
const guideKey = projectId => `aidol-guides-${projectId}`;
const clamp = value => Math.min(1, Math.max(0, value));
const readGuides = projectId => { try { const value = JSON.parse(localStorage.getItem(guideKey(projectId)) || '[]'); return Array.isArray(value) ? value.filter(item => typeof item?.y === 'number') : []; } catch { return []; } };

export function TurnaroundViewer({ project, focus, busy, onClose, onDraw, onAdjust, onRemove, onCreateNote, onUpdateNote, onDeleteNote }) {
  const t = useT();
  const views = project.views;
  const items = views?.items || {};
  const label = view => t(`canvas.views.view.${view}`);
  const list = allViews.filter(view => turnaroundViews.includes(view) || (views?.extra || []).includes(view) || items[view]);
  const asset = view => items[view] && project.assets.find(item => item.id === items[view].assetId);
  const notes = project.viewNotes || [];
  const body = bodyRect(views, 'front');
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [selected, setSelected] = useState(null);
  const [ratios, setRatios] = useState({});
  const [guides, setGuides] = useState(() => readGuides(project.id));
  const [dragPin, setDragPin] = useState(null);
  const [pending, setPending] = useState({});
  const [removing, setRemoving] = useState(null);
  const stage = useRef(null);
  const columns = useRef({});
  const dragRef = useRef(null);
  useEffect(() => { try { localStorage.setItem(guideKey(project.id), JSON.stringify(guides)); } catch {} }, [guides, project.id]);
  // 打開時捲到點的那個角度。
  useEffect(() => { columns.current[focus]?.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }, [focus]);
  const editing = draft || (selected && notes.find(note => note.id === selected)) || null;
  const numberOf = id => notes.findIndex(note => note.id === id) + 1;

  const pointIn = (event, element) => { const rect = element.getBoundingClientRect(); return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }; };
  const startDraft = (view, point) => { setSelected(null); setDraft({ view, ...point, title: '', text: '' }); setPlacing(false); };
  const place = (view, event) => { if (placing) startDraft(view, pointIn(event, event.currentTarget)); };
  // 移動標註：拖著移動，放開才存（存好之前先停在放開的位置）；點一下（或 Enter）是選取。鍵盤可以用方向鍵移動（Shift 一次多移一些）。
  const movePinTo = async (id, point) => {
    setPending(current => ({ ...current, [id]: point }));
    await onUpdateNote(id, point);
    setPending(current => { const { [id]: _, ...rest } = current; return rest; });
  };
  const startPin = (note, event) => {
    if (event.button !== 0) return;
    event.stopPropagation(); event.preventDefault();
    const box = event.currentTarget.parentElement;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: note.id, box, startX: event.clientX, startY: event.clientY, x: note.x, y: note.y, moved: false };
    setDragPin(dragRef.current);
  };
  const movePin = event => {
    const current = dragRef.current;
    if (!current) return;
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4;
    dragRef.current = { ...current, moved, ...(moved ? pointIn(event, current.box) : {}) };
    setDragPin(dragRef.current);
  };
  const endPin = event => {
    const current = dragRef.current;
    dragRef.current = null; setDragPin(null);
    if (!current?.moved) return;
    movePinTo(current.id, pointIn(event, current.box));
  };
  const nudgePin = (note, event) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const at = pending[note.id] || note;
    movePinTo(note.id, { x: clamp(at.x + delta[0]), y: clamp(at.y + delta[1]) });
  };
  const pinAt = note => (dragPin?.id === note.id ? { x: dragPin.x, y: dragPin.y } : pending[note.id] || note);

  // 參考線：拖左邊的把手上下移動。
  const startGuide = (id, event) => {
    event.preventDefault(); event.stopPropagation();
    const handle = event.currentTarget, ruler = handle.parentElement;
    handle.setPointerCapture(event.pointerId);
    const move = moveEvent => setGuides(current => current.map(guide => guide.id === id ? { ...guide, y: pointIn(moveEvent, ruler).y } : guide));
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  const addGuide = () => setGuides(current => [...current, { id: `guide-${Date.now()}`, y: 0.3 + (current.length % 4) * 0.1 }]);

  const save = async form => {
    const done = draft ? await onCreateNote({ view: draft.view, x: draft.x, y: draft.y, ...form }) : await onUpdateNote(selected, form);
    if (done) { setDraft(null); setSelected(null); }
  };
  const remove = async () => {
    if (draft) { setDraft(null); return; }
    if (await onDeleteNote(selected)) setSelected(null);
  };
  const lines = [{ id: 'top', y: body.top, fixed: true, name: t('canvas.viewer.headLine') }, { id: 'bottom', y: body.top + body.height, fixed: true, name: t('canvas.viewer.feetLine') }, ...guides];

  const actions = <>
    <button type="button" className={`btn btn-sm ${placing ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={placing} onClick={() => { setPlacing(value => !value); setDraft(null); setSelected(null); }}><PushPin size={15} />{placing ? t('canvas.viewer.placing') : t('canvas.viewer.addNote')}</button>
    <button type="button" className="btn btn-quiet btn-sm" onClick={addGuide}><Ruler size={15} />{t('canvas.viewer.addGuide')}</button>
    {guides.length > 0 && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setGuides([])}>{t('canvas.viewer.clearGuides')}</button>}
  </>;
  return <Modal title={t('canvas.viewer.title', { name: project.character.name })} subtitle={t('canvas.viewer.subtitle')} className="modal-full turnaround-viewer" actions={actions} onClose={onClose}>
    <div className="tv-body">
      <div className={`tv-stage${placing ? ' is-placing' : ''}`} ref={stage} onPointerMove={movePin} onPointerUp={endPin} onPointerCancel={() => { dragRef.current = null; setDragPin(null); }}>
        <div className="tv-ruler" aria-hidden="true">
          {lines.map(line => <span key={line.id} className={`tv-ruler-mark${line.fixed ? ' is-fixed' : ''}`} style={{ top: `${line.y * 100}%` }} onPointerDown={line.fixed ? undefined : event => startGuide(line.id, event)} onDoubleClick={line.fixed ? undefined : () => setGuides(current => current.filter(guide => guide.id !== line.id))} title={line.fixed ? line.name : t('canvas.viewer.guideHint')}>
            {line.fixed ? <small>{line.name}</small> : null}
          </span>)}
        </div>
        {list.map(view => {
          const image = asset(view);
          const extra = extraViews.includes(view);
          return <section key={view} className="tv-column" ref={element => { columns.current[view] = element; }} aria-label={label(view)}>
            <div className={`tv-art${image ? '' : ' is-missing'}`} style={{ aspectRatio: ratios[view] || (image ? undefined : 0.43) }} onClick={image ? event => place(view, event) : undefined}
              tabIndex={placing && image ? 0 : undefined} role={placing && image ? 'button' : undefined} aria-label={placing && image ? t('canvas.viewer.placeOn', { view: label(view) }) : undefined}
              onKeyDown={placing && image ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startDraft(view, { x: 0.5, y: 0.5 }); } } : undefined}>
              {image ? <img src={image.url} alt={t('canvas.views.alt', { name: project.character.name, view: label(view) })} draggable="false" onLoad={event => { const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalWidth && naturalHeight) setRatios(current => ({ ...current, [view]: naturalWidth / naturalHeight })); }} />
                : <span className="tv-missing">{t('canvas.views.notDrawn')}</span>}
              {lines.map(line => <i key={line.id} className={`tv-guide${line.fixed ? ' is-fixed' : ''}`} style={{ top: `${line.y * 100}%` }} />)}
              {image && notes.filter(note => note.view === view).map(note => { const at = pinAt(note); return <button type="button" key={note.id} className={`tv-pin${selected === note.id ? ' is-selected' : ''}`} style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }} aria-label={t('canvas.viewer.pinAria', { number: numberOf(note.id), title: note.title || note.text })} onPointerDown={event => startPin(note, event)} onKeyDown={event => nudgePin(note, event)} onClick={event => { event.stopPropagation(); setDraft(null); setSelected(note.id); }}>{numberOf(note.id)}</button>; })}
              {draft?.view === view && <span className="tv-pin is-draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}>{notes.length + 1}</span>}
            </div>
            <footer className="tv-foot">
              <b>{label(view)}</b>
              <span className="tv-actions">
                {view !== 'front' && items.front && <button type="button" className="btn btn-quiet btn-sm" onClick={() => onDraw(view)}><PaintBrush size={14} />{image ? t('canvas.views.redraw', { view: label(view) }) : t('canvas.views.draw', { view: label(view) })}</button>}
                {items[view]?.crop && <button type="button" className="icon-btn" aria-label={t('canvas.views.adjust')} title={t('canvas.views.adjustHint')} onClick={onAdjust}><Crop size={15} /></button>}
                {extra && (removing === view
                  ? <button type="button" className="btn btn-danger btn-sm" onClick={() => { setRemoving(null); onRemove(view); }}>{notes.some(note => note.view === view) ? t('canvas.viewer.removeConfirmNotes', { count: notes.filter(note => note.view === view).length }) : t('canvas.viewer.removeConfirm')}</button>
                  : <button type="button" className="icon-btn" aria-label={t('canvas.views.remove', { view: label(view) })} title={t('canvas.views.remove', { view: label(view) })} onClick={() => setRemoving(view)}><X size={15} /></button>)}
              </span>
            </footer>
          </section>;
        })}
      </div>
      <aside className="tv-panel" aria-label={t('canvas.viewer.notes')}>
        {editing ? <NoteForm key={draft ? `draft-${draft.view}-${draft.x}-${draft.y}` : editing.id} note={editing} number={draft ? notes.length + 1 : numberOf(editing.id)} viewLabel={label(editing.view)} busy={busy} isNew={Boolean(draft)} onSave={save} onRemove={remove} onCancel={() => { setDraft(null); setSelected(null); }} />
          : <>
            <h3>{t('canvas.viewer.notes')}</h3>
            <p className="tv-panel-hint">{placing ? t('canvas.viewer.placeHint') : t('canvas.viewer.notesHint')}</p>
            {notes.length ? <ol className="tv-notes">
              {notes.map((note, index) => <li key={note.id}><button type="button" onClick={() => { setDraft(null); setSelected(note.id); }}>
                <span className="tv-note-number">{index + 1}</span>
                <span className="tv-note-copy"><b>{note.title || label(note.view)}</b><small>{note.title ? `${label(note.view)}${t('canvas.separator')}` : ''}{note.text}</small></span>
              </button></li>)}
            </ol> : <p className="tv-empty">{t('canvas.viewer.empty')}</p>}
            {!placing && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlacing(true)}><Plus size={14} />{t('canvas.viewer.addNote')}</button>}
          </>}
      </aside>
    </div>
  </Modal>;
}

// 寫標註時按 Esc 只取消這個標註，不關掉並排看；刪除要再按一次確認。
function NoteForm({ note, number, viewLabel, busy, isNew, onSave, onRemove, onCancel }) {
  const t = useT();
  const [title, setTitle] = useState(note.title || '');
  const [text, setText] = useState(note.text || '');
  const [confirming, setConfirming] = useState(false);
  const valid = text.trim().length > 0;
  return <form className="tv-note-form" onKeyDown={event => { if (event.key === 'Escape') { event.nativeEvent.stopImmediatePropagation(); event.stopPropagation(); onCancel(); } }} onSubmit={event => { event.preventDefault(); if (valid) onSave({ title: title.trim(), text: text.trim() }); }}>
    <h3><span className="tv-note-number">{number}</span>{isNew ? t('canvas.viewer.newNote', { view: viewLabel }) : t('canvas.viewer.editNote', { view: viewLabel })}</h3>
    <label className="field"><span>{t('canvas.viewer.noteTitle')}</span><input value={title} maxLength={NOTE_TITLE_MAX} autoFocus placeholder={t('canvas.viewer.noteTitlePlaceholder')} onChange={event => setTitle(event.target.value)} /></label>
    <label className="field"><span>{t('canvas.viewer.noteText')}</span><textarea rows={4} maxLength={NOTE_TEXT_MAX} value={text} placeholder={t('canvas.viewer.noteTextPlaceholder')} onChange={event => setText(event.target.value)} /></label>
    <p className="tv-panel-hint">{t('canvas.viewer.noteSent')}</p>
    <div className="tv-form-actions">
      {isNew ? <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>{t('canvas.cancel')}</button>
        : confirming ? <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}><Trash size={14} />{t('canvas.viewer.deleteConfirm')}</button>
          : <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(true)}><Trash size={14} />{t('canvas.viewer.deleteNote')}</button>}
      {!isNew && <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>{t('canvas.viewer.back')}</button>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !valid}>{busy ? <Busy>{t('canvas.viewer.saving')}</Busy> : t('canvas.viewer.saveNote')}</button>
    </div>
  </form>;
}
