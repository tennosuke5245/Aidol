import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, Check, CircleNotch, Eye, PencilSimple, Trash, X } from '@phosphor-icons/react';

const toneNames = { gold: '米金', blue: '霧藍', rose: '灰粉', neutral: '石墨' };
const contentOf = annotation => annotation.kind === 'reference'
  ? { title: annotation.title || '', description: annotation.description || '' }
  : { text: annotation.text || '', tone: annotation.tone || 'gold' };
const sameContent = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function CanvasReferenceImage({ asset, title, onPreview }) {
  return asset ? <button type="button" className="annotation-preview nodrag nopan" onClick={() => onPreview?.(asset, title || asset.name || '畫布參考')} aria-label={`放大${title || asset.name || '參考圖片'}`}>
    <img src={asset.url} alt={title || asset.name || '參考圖片'} draggable="false" />
    <span className="annotation-preview-icon"><Eye size={17} /></span>
  </button> : <div className="annotation-image-missing">找不到參考圖片</div>;
}

export function CanvasFormalReferenceNode({ data, selected }) {
  return <article className={`canvas-formal-reference ${selected ? 'is-selected' : ''}`}>
    <CanvasReferenceImage asset={data.asset} title={data.title} onPreview={data.onPreview} />
    <div className="formal-reference-caption"><span>出圖參考</span><h3>{data.title}</h3><p>{data.description || '已設定為本次繪風參考'}</p></div>
  </article>;
}

export function CanvasAnnotationNode({ data, selected }) {
  const { annotation, asset, onUpdate, onDelete, onPreview } = data;
  const [draft, setDraft] = useState(() => contentOf(annotation));
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState(null);
  const saved = useRef(contentOf(annotation));
  const workingRef = useRef(false);
  const mounted = useRef(true);
  const editor = useRef(null);
  const content = contentOf(annotation);
  const contentSignature = JSON.stringify(content);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const previous = saved.current;
    saved.current = content;
    setDraft(current => sameContent(current, previous) ? content : current);
  }, [contentSignature]);
  useEffect(() => {
    if (data.editRequested) { setEditing(true); data.onEditRequestConsumed?.(); }
  }, [data.editRequested]);
  useEffect(() => {
    if (editing) { editor.current?.focus(); editor.current?.select?.(); }
  }, [editing]);

  const cancel = () => { if (workingRef.current) return; setDraft(saved.current); setEditing(false); setError(null); };
  async function save() {
    if (workingRef.current) return;
    if (sameContent(draft, saved.current)) { setEditing(false); setError(null); return; }
    workingRef.current = true; setWorking('save'); setError(null);
    try {
      const result = await onUpdate(annotation.id, draft);
      if (!mounted.current) return;
      saved.current = contentOf(result.annotation);
      setDraft(saved.current); setEditing(false);
    } catch (failure) {
      if (mounted.current) setError({ action: 'save', message: failure.message || '註記尚未保存，文字仍保留在這裡。' });
    } finally {
      workingRef.current = false;
      if (mounted.current) setWorking('');
    }
  }
  async function remove() {
    if (workingRef.current) return;
    workingRef.current = true; setWorking('delete'); setError(null);
    try { await onDelete(annotation.id); }
    catch (failure) { if (mounted.current) setError({ action: 'delete', message: failure.message || '尚未移除這張註記。' }); }
    finally { workingRef.current = false; if (mounted.current) setWorking(''); }
  }
  const startEditing = event => { event?.stopPropagation(); if (!workingRef.current) { setEditing(true); setError(null); } };
  const leaveEditor = event => {
    if (editing && !event.currentTarget.contains(event.relatedTarget) && !workingRef.current) save();
  };
  const reference = annotation.kind === 'reference';
  return <article className={`canvas-annotation annotation-${annotation.kind} tone-${reference ? 'neutral' : draft.tone} ${selected ? 'is-selected' : ''} ${editing ? 'is-editing' : ''}`} onDoubleClick={startEditing} onBlurCapture={leaveEditor}>
    <div className="annotation-card-heading"><span>{reference ? '畫布參考' : annotation.kind === 'note' ? '便利貼' : '說明'}</span><div className="annotation-card-controls nodrag nopan"><button type="button" aria-label={`編輯${reference ? '參考圖卡' : annotation.kind === 'note' ? '便利貼' : '說明'}`} title="編輯" disabled={Boolean(working)} onClick={startEditing}><PencilSimple size={15} /></button><button type="button" aria-label={`移除${reference ? '參考圖卡' : annotation.kind === 'note' ? '便利貼' : '說明'}`} title="移除這張卡片" disabled={Boolean(working)} onClick={remove}><Trash size={15} /></button></div></div>
    {reference && <CanvasReferenceImage asset={asset} title={draft.title} onPreview={onPreview} />}
    {editing ? <form className="annotation-editor nodrag nopan nowheel" onSubmit={event => { event.preventDefault(); save(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); cancel(); } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); } }}>
      {reference ? <><label>標題<input ref={editor} aria-label="參考圖卡標題" maxLength={160} value={draft.title} disabled={Boolean(working)} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} placeholder="這張圖的參考重點" /></label><label>說明<textarea aria-label="參考圖卡說明" rows={3} maxLength={12000} value={draft.description} disabled={Boolean(working)} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} placeholder="寫下想參考的細節" /></label></> : <textarea ref={editor} aria-label={annotation.kind === 'note' ? '便利貼文字' : '畫布說明文字'} rows={annotation.kind === 'note' ? 4 : 6} maxLength={12000} value={draft.text} disabled={Boolean(working)} onChange={event => setDraft(current => ({ ...current, text: event.target.value }))} placeholder={annotation.kind === 'note' ? '寫下一個想法…' : '補充設計說明…'} />}
      {!reference && <div className="annotation-tone-picker" role="group" aria-label="卡片色調">{Object.entries(toneNames).map(([tone, name]) => <button key={tone} type="button" className={`tone-swatch tone-swatch-${tone}`} aria-label={`${name}色調`} title={name} aria-pressed={draft.tone === tone} disabled={Boolean(working)} onClick={() => setDraft(current => ({ ...current, tone }))} />)}</div>}
      <div className="annotation-editor-actions"><button type="button" onClick={cancel} disabled={Boolean(working)}><X size={14} />取消</button><button type="submit" className="annotation-save" disabled={Boolean(working)}>{working === 'save' ? <><CircleNotch className="annotation-spinner" size={14} />保存中</> : <><Check size={14} />完成</>}</button></div>
    </form> : reference ? <div className="annotation-reference-caption nodrag nowheel"><h3>{draft.title || asset?.name || '未命名參考'}</h3>{draft.description && <p>{draft.description}</p>}</div> : <div className="annotation-content nodrag nowheel" tabIndex={0} aria-label={`${annotation.kind === 'note' ? '便利貼' : '說明'}：${draft.text || '尚未填寫'}`} onKeyDown={event => { if (event.key === 'Enter') startEditing(event); }}>{draft.text || <span className="annotation-placeholder">雙擊寫下{annotation.kind === 'note' ? '想法' : '說明'}</span>}</div>}
    {working === 'delete' && <div className="annotation-local-status" role="status"><CircleNotch className="annotation-spinner" size={13} />正在移除…</div>}
    {error && <div className="annotation-local-error nodrag nopan" role="alert"><p>{error.message}</p><small>{error.action === 'save' ? '文字尚未保存，草稿仍保留。' : '卡片仍保留在畫布。'}</small><button type="button" onClick={error.action === 'delete' ? remove : save}><ArrowClockwise size={13} />再試一次</button></div>}
    {data.positionStatus?.saving && <div className="annotation-local-status" role="status"><CircleNotch className="annotation-spinner" size={13} />正在保存位置…</div>}
    {data.positionStatus?.error && <div className="annotation-local-error nodrag nopan" role="alert"><p>位置尚未保存：{data.positionStatus.error}</p><button type="button" onClick={data.onRetryPosition}><ArrowClockwise size={13} />再試一次</button></div>}
  </article>;
}
