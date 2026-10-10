import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, Check, CircleNotch, Eye, PencilSimple, Trash, X } from '@phosphor-icons/react';
import { useT } from './i18n';

const tones = ['gold', 'blue', 'rose', 'neutral'];
const contentOf = annotation => annotation.kind === 'reference'
  ? { title: annotation.title || '', description: annotation.description || '' }
  : { text: annotation.text || '', tone: annotation.tone || 'gold' };
const sameContent = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function CanvasReferenceImage({ asset, title, onPreview }) {
  const t = useT();
  return asset ? <button type="button" className="annotation-preview nodrag nopan" onClick={() => onPreview?.(asset, title || asset.name || t('canvas.annotation.kind.reference'))} aria-label={title || asset.name ? t('canvas.annotation.zoom', { name: title || asset.name }) : t('canvas.annotation.zoomImage')}>
    <img src={asset.url} alt={title || asset.name || t('canvas.annotation.image')} draggable="false" />
    <span className="annotation-preview-icon"><Eye size={17} /></span>
  </button> : <div className="annotation-image-missing">{t('canvas.annotation.imageMissing')}</div>;
}

export function CanvasFormalReferenceNode({ data, selected }) {
  const t = useT();
  return <article className={`canvas-formal-reference ${selected ? 'is-selected' : ''}`}>
    <CanvasReferenceImage asset={data.asset} title={data.title} onPreview={data.onPreview} />
    <div className="formal-reference-caption"><span>{t('canvas.formalReference.label')}</span><h3>{data.title}</h3><p>{data.description || t('canvas.formalReference.fallback')}</p></div>
  </article>;
}

export function CanvasAnnotationNode({ data, selected }) {
  const t = useT();
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
      if (mounted.current) setError({ action: 'save', message: failure.message || t('canvas.annotation.saveError') });
    } finally {
      workingRef.current = false;
      if (mounted.current) setWorking('');
    }
  }
  async function remove() {
    if (workingRef.current) return;
    workingRef.current = true; setWorking('delete'); setError(null);
    try { await onDelete(annotation.id); }
    catch (failure) { if (mounted.current) setError({ action: 'delete', message: failure.message || t('canvas.annotation.deleteError') }); }
    finally { workingRef.current = false; if (mounted.current) setWorking(''); }
  }
  const startEditing = event => { event?.stopPropagation(); if (!workingRef.current) { setEditing(true); setError(null); } };
  const leaveEditor = event => {
    if (editing && !event.currentTarget.contains(event.relatedTarget) && !workingRef.current) save();
  };
  const reference = annotation.kind === 'reference';
  const kind = reference ? 'reference' : annotation.kind === 'note' ? 'note' : 'text';
  return <article className={`canvas-annotation annotation-${annotation.kind} tone-${reference ? 'neutral' : draft.tone} ${selected ? 'is-selected' : ''} ${editing ? 'is-editing' : ''}`} onDoubleClick={startEditing} onBlurCapture={leaveEditor}>
    <div className="annotation-card-heading"><span>{t(`canvas.annotation.kind.${kind}`)}</span><div className="annotation-card-controls nodrag nopan"><button type="button" aria-label={t(`canvas.annotation.edit.${kind}`)} title={t('canvas.annotation.editTitle')} disabled={Boolean(working)} onClick={startEditing}><PencilSimple size={15} /></button><button type="button" aria-label={t(`canvas.annotation.remove.${kind}`)} title={t('canvas.annotation.removeTitle')} disabled={Boolean(working)} onClick={remove}><Trash size={15} /></button></div></div>
    {reference && <CanvasReferenceImage asset={asset} title={draft.title} onPreview={onPreview} />}
    {editing ? <form className="annotation-editor nodrag nopan nowheel" onSubmit={event => { event.preventDefault(); save(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); cancel(); } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); } }}>
      {reference ? <><label>{t('canvas.annotation.title')}<input ref={editor} aria-label={t('canvas.annotation.titleAria')} maxLength={160} value={draft.title} disabled={Boolean(working)} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} placeholder={t('canvas.annotation.titlePlaceholder')} /></label><label>{t('canvas.annotation.description')}<textarea aria-label={t('canvas.annotation.descriptionAria')} rows={3} maxLength={12000} value={draft.description} disabled={Boolean(working)} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} placeholder={t('canvas.annotation.descriptionPlaceholder')} /></label></> : <textarea ref={editor} aria-label={t(`canvas.annotation.textAria.${kind}`)} rows={annotation.kind === 'note' ? 4 : 6} maxLength={12000} value={draft.text} disabled={Boolean(working)} onChange={event => setDraft(current => ({ ...current, text: event.target.value }))} placeholder={t(`canvas.annotation.placeholder.${kind}`)} />}
      {!reference && <div className="annotation-tone-picker" role="group" aria-label={t('canvas.annotation.toneGroup')}>{tones.map(tone => <button key={tone} type="button" className={`tone-swatch tone-swatch-${tone}`} aria-label={t('canvas.annotation.toneAria', { name: t(`canvas.annotation.tone.${tone}`) })} title={t(`canvas.annotation.tone.${tone}`)} aria-pressed={draft.tone === tone} disabled={Boolean(working)} onClick={() => setDraft(current => ({ ...current, tone }))} />)}</div>}
      <div className="annotation-editor-actions"><button type="button" onClick={cancel} disabled={Boolean(working)}><X size={14} />{t('canvas.cancel')}</button><button type="submit" className="annotation-save" disabled={Boolean(working)}>{working === 'save' ? <><CircleNotch className="annotation-spinner" size={14} />{t('canvas.annotation.saving')}</> : <><Check size={14} />{t('canvas.annotation.done')}</>}</button></div>
    </form> : reference ? <div className="annotation-reference-caption nodrag nowheel"><h3>{draft.title || asset?.name || t('canvas.annotation.untitled')}</h3>{draft.description && <p>{draft.description}</p>}</div> : <div className="annotation-content nodrag nowheel" tabIndex={0} aria-label={t('canvas.annotation.contentAria', { kind: t(`canvas.annotation.kind.${kind}`), text: draft.text || t('canvas.annotation.empty') })} onKeyDown={event => { if (event.key === 'Enter') startEditing(event); }}>{draft.text || <span className="annotation-placeholder">{t(`canvas.annotation.emptyHint.${kind}`)}</span>}</div>}
    {working === 'delete' && <div className="annotation-local-status" role="status"><CircleNotch className="annotation-spinner" size={13} />{t('canvas.annotation.removing')}</div>}
    {error && <div className="annotation-local-error nodrag nopan" role="alert"><p>{error.message}</p><small>{error.action === 'save' ? t('canvas.annotation.saveErrorHint') : t('canvas.annotation.deleteErrorHint')}</small><button type="button" onClick={error.action === 'delete' ? remove : save}><ArrowClockwise size={13} />{t('canvas.retry')}</button></div>}
    {data.positionStatus?.saving && <div className="annotation-local-status" role="status"><CircleNotch className="annotation-spinner" size={13} />{t('canvas.annotation.savingPosition')}</div>}
    {data.positionStatus?.error && <div className="annotation-local-error nodrag nopan" role="alert"><p>{t('canvas.annotation.positionError', { error: data.positionStatus.error })}</p><button type="button" onClick={data.onRetryPosition}><ArrowClockwise size={13} />{t('canvas.retry')}</button></div>}
  </article>;
}
