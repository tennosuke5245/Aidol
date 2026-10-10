import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, Check, Crosshair, ArrowClockwise, X, Sparkle, SquareSplitHorizontal, UploadSimple } from '@phosphor-icons/react';
import { candidateComparison, jobPresentation, jobProgress } from '../shared/agent-workspace.mjs';
import { dateLabel, targetLabel } from './api';
import { StatusPill } from './ui';
import { Busy, Modal } from './Panels';
import { L } from './lib-i18n';
import { sharedText, useT } from './i18n';

const filters = ['all', 'main', 'gear'];
const viewNames = new Set(['front', 'full', 'back', 'detail']);

// 回傳 gallery.adopted 底下的 key（正式立繪、設計圖或某個視角的設計圖）；文字在畫面上依目前語言取。
function adoptedFor(project, asset) {
  if (project.character.adopted?.[asset.targetId] === asset.id) return asset.targetId === 'character' ? 'main' : 'design';
  const part = project.character.components?.[asset.targetId];
  if (part && Object.values(part.views || {}).includes(asset.id)) return viewNames.has(asset.view) ? asset.view : 'design';
  return null;
}

// 圖鑑：這個角色畫過的所有圖。點開可以放大、和目前的比較、設為正式、局部修改或再畫一次。
export function Gallery({ project, busy, onBack, onAdopt, onPreview, onSummon, onRedraw, onRefine, onImport }) {
  const t = useT();
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const items = useMemo(() => project.assets.filter(asset => asset.role === 'design')
    .map(asset => ({ asset, candidate: project.candidates.find(item => item.assetId === asset.id), adopted: adoptedFor(project, asset) }))
    .map(item => ({ ...item, job: item.candidate && project.jobs.find(job => job.id === item.candidate.jobId) }))
    .sort((a, b) => (Date.parse(b.asset.createdAt || b.candidate?.createdAt) || 0) - (Date.parse(a.asset.createdAt || a.candidate?.createdAt) || 0)), [project]);
  const visible = items.filter(item => filter === 'all' || (filter === 'main' ? item.asset.targetId === 'character' : item.asset.targetId !== 'character'));
  // 還沒有圖回來的繪製都列在這裡（包含用較早設定準備的），不讓任何一次嘗試無聲消失。
  const live = project.jobs.map(job => ({ job, view: jobPresentation(project, job, job.outfitId), progress: jobProgress(project, job) }))
    .filter(({ job, view, progress }) => !progress.returned && !['accepted', 'cancelled'].includes(job.status) && view.action !== 'none')
    .sort((a, b) => Number(b.view.needsAttention || b.job.status === 'running') - Number(a.view.needsAttention || a.job.status === 'running') || (Date.parse(b.job.updatedAt || b.job.createdAt) || 0) - (Date.parse(a.job.updatedAt || a.job.createdAt) || 0));
  const open = items.find(item => item.asset.id === openId);
  const file = useRef(null), importJob = useRef(null);

  return <main className="gallery">
    <header className="game-top">
      <button type="button" className="top-back" onClick={onBack}><CaretLeft size={16} weight="bold" />{t('gallery.back')}</button>
      <div className="top-title"><h1 className="display">{t('gallery.title')}</h1><span className="top-sub num">{t('gallery.count', { count: items.length })}</span></div>
      <div className="tabs" role="tablist" aria-label={t('gallery.filterLabel')}>{filters.map(id => <button type="button" role="tab" key={id} aria-selected={filter === id} onClick={() => setFilter(id)}>{t(`gallery.filter.${id}`)}</button>)}</div>
    </header>
    <div className="gallery-body">
      {live.length > 0 && <section className="gallery-live" aria-label={t('gallery.live.label')}>{live.map(({ job, view }) => <article key={job.id} className={`live-card tone-${view.tone}`}>
        <div><StatusPill tone={view.tone} running={job.status === 'running'}>{job.status === 'failed' ? t('gallery.live.failed') : view.olderSettings && view.action === 'handoff' ? t('gallery.live.notSent') : view.action === 'handoff' ? t('gallery.live.pressSend') : sharedText(view.labelKey, view.labelParams, view.label)}</StatusPill>{view.olderSettings && <span className="shot-note">{t('gallery.olderSettings')}</span>}<p>{targetLabel(project, job.targetId)}{t('common.gap')}{job.prompt.length > 48 ? `${job.prompt.slice(0, 48)}…` : job.prompt}</p></div>
        <div className="live-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSummon(job.id)}>{t('gallery.live.view')}</button>
          <button type="button" className="btn btn-quiet btn-sm" title={t('gallery.live.importTitle')} onClick={() => { importJob.current = job; file.current?.click(); }}><UploadSimple size={14} />{t('gallery.live.import')}</button>
        </div>
      </article>)}</section>}
      <input ref={file} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" tabIndex={-1} aria-label={t('gallery.live.importInput')} onChange={event => { const picked = event.target.files?.[0]; event.target.value = ''; if (picked && importJob.current) onImport(importJob.current, picked); }} />
      {visible.length ? <div className="gallery-grid">{visible.map(({ asset, candidate, adopted }) => <Shot key={asset.id} asset={asset} label={asset.targetId === 'character' ? t('common.mainIllustration') : targetLabel(project, asset.targetId)} onOpen={() => setOpenId(asset.id)}
        status={adopted ? <StatusPill tone="success">{t(`gallery.adopted.${adopted}`)}</StatusPill> : candidate?.olderSettings ? <span className="shot-note">{t('gallery.olderSettings')}</span> : null} adopted={Boolean(adopted)} />)}</div> : <div className="empty-state"><Sparkle size={30} weight="light" /><h3>{t('gallery.empty.title')}</h3><p>{t('gallery.empty.body')}</p></div>}
    </div>
    {open && <Lightbox project={project} item={open} busy={busy} onClose={() => setOpenId(null)} onAdopt={onAdopt} onPreview={onPreview} onRedraw={onRedraw} onRefine={onRefine} />}
  </main>;
}

// 圖鑑的一張圖：載入後量出比例，讓同一列的圖等高、不留黑邊。
function Shot({ asset, label, status, adopted, onOpen }) {
  const [ratio, setRatio] = useState(0.8);
  const measure = event => {
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
    if (width && height) setRatio(Math.min(2.4, Math.max(0.45, width / height)));
  };
  return <button type="button" className={`shot ${adopted ? 'is-adopted' : ''}`} style={{ '--ratio': ratio }} onClick={onOpen}>
    <span className="shot-art"><img src={asset.url} alt="" loading="lazy" onLoad={measure} /></span>
    <span className="shot-meta"><b>{label}</b>{status}</span>
  </button>;
}

function Lightbox({ project, item, busy, onClose, onAdopt, onRedraw, onRefine }) {
  const t = useT();
  const { asset, candidate, adopted, job } = item;
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [refine, setRefine] = useState(false);
  const comparison = candidate ? candidateComparison(project, candidate) : null;
  const current = comparison?.current && comparison.current.id !== asset.id ? comparison.current : null;
  const isMain = asset.targetId === 'character';
  useEffect(() => {
    const handle = event => { if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label={t('gallery.lightbox.label')}>
    <button type="button" className="lightbox-close icon-btn" aria-label={t('ui.close')} onClick={onClose}><X size={20} /></button>
    <div className="lightbox-stage">
      {compare && current ? <div className="compare-wipe">
        <img src={asset.url} alt={t('gallery.compare.this')} draggable="false" />
        <div className="compare-top" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}><img src={current.url} alt={t('gallery.compare.current')} draggable="false" /></div>
        <div className="compare-line" style={{ left: `${split}%` }} />
        <span className="compare-tag left">{t('gallery.compare.current')}</span><span className="compare-tag right">{t('gallery.compare.this')}</span>
        <input className="compare-range" type="range" min="0" max="100" value={split} aria-label={t('gallery.compare.split')} onChange={event => setSplit(Number(event.target.value))} />
      </div> : <img className="lightbox-img" src={asset.url} alt="" />}
    </div>
    <aside className="lightbox-side">
      <h2 className="display">{isMain ? t('common.mainIllustration') : targetLabel(project, asset.targetId)}</h2>
      <p className="muted">{dateLabel(asset.createdAt || candidate?.createdAt || Date.now())}{asset.view && !isMain ? `${t('common.gap')}${viewNames.has(asset.view) ? t(`gallery.view.${asset.view}`) : ''}` : ''}</p>
      {adopted && <StatusPill tone="success">{t(`gallery.adopted.${adopted}`)}</StatusPill>}
      {job?.prompt && <div className="lightbox-prompt"><span>{t('gallery.lightbox.request')}</span><p>{job.prompt}</p></div>}
      {candidate?.olderSettings && <p className="hint">{t('gallery.lightbox.olderHint')}</p>}
      <div className="lightbox-actions">
        {candidate && !adopted && <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => onAdopt(candidate)}>{busy ? <Busy /> : <><Check size={17} weight="bold" />{isMain ? t('gallery.lightbox.adoptMain') : t('gallery.lightbox.adoptPart')}</>}</button>}
        {current && <button type="button" className="btn btn-secondary btn-block" aria-pressed={compare} onClick={() => setCompare(value => !value)}><SquareSplitHorizontal size={16} />{compare ? t('gallery.compare.stop') : t('gallery.compare.start')}</button>}
        {adopted && <button type="button" className="btn btn-secondary btn-block" onClick={() => setRefine(true)}><Crosshair size={16} />{t('gallery.lightbox.refine')}</button>}
        {job && <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={() => onRedraw(job)}><ArrowClockwise size={16} />{t('gallery.lightbox.redraw')}</button>}
      </div>
    </aside>
    {refine && <RefineModal asset={asset} busy={busy} onClose={() => setRefine(false)} onSubmit={async options => { const done = await onRefine(asset, options); if (done) { setRefine(false); onClose(); } }} />}
  </div>;
}

function RefineModal({ asset, busy, onClose, onSubmit }) {
  const t = useT();
  const [region, setRegion] = useState(null);
  const [note, setNote] = useState('');
  const [count, setCount] = useState(1);
  const box = useRef(null), start = useRef(null);
  const point = event => { const rect = box.current.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
  const move = event => { if (!start.current) return; const end = point(event); setRegion({ x: Math.min(start.current.x, end.x), y: Math.min(start.current.y, end.y), width: Math.abs(end.x - start.current.x), height: Math.abs(end.y - start.current.y) }); };
  const ready = note.trim() && (!region || (region.width > 0.01 && region.height > 0.01));
  return <Modal title={t('gallery.refine.title')} subtitle={t('gallery.refine.subtitle')} onClose={onClose} wide>
    <div className="refine-layout">
      <div className="region-stage"><div className="region-image" ref={box} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); start.current = point(event); setRegion(null); }} onPointerMove={move} onPointerUp={event => { move(event); start.current = null; }}>
        <img src={asset.url} alt={t('gallery.refine.imageAlt')} draggable="false" />
        {region && <span className="region-box" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />}
      </div></div>
      <form className="form-stack" onSubmit={event => { event.preventDefault(); if (ready) onSubmit({ note, region: region && region.width > 0.01 ? region : null, variants: count }); }}>
        <label className="field"><span>{t('gallery.refine.note')}</span><textarea autoFocus rows={5} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder={t('gallery.refine.notePlaceholder')} /></label>
        <div className="field"><span>{t('gallery.refine.count')}</span><div className="count-seg" role="group">{L.variantCounts.map(value => <button type="button" key={value} aria-pressed={count === value} onClick={() => setCount(value)}>×{value}</button>)}</div></div>
        {region && <button type="button" className="btn btn-text" onClick={() => setRegion(null)}>{t('gallery.refine.clear')}</button>}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !ready}>{busy ? <Busy>{t('gallery.refine.preparing')}</Busy> : <><Sparkle size={16} weight="fill" />{t('gallery.refine.submit')}</>}</button>
      </form>
    </div>
  </Modal>;
}
