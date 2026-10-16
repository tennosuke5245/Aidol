import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, Check, Crosshair, ArrowClockwise, ArrowCounterClockwise, X, Sparkle, SquareSplitHorizontal, UploadSimple, Crown, DownloadSimple, IdentificationCard, Prohibit, ClockCounterClockwise } from '@phosphor-icons/react';
import { candidateComparison, canCancelJob, jobPresentation, jobProgress } from '../shared/agent-workspace.mjs';
import { dateLabel, targetLabel, viewTargetLabel } from './api';
import { StatusPill } from './ui';
import { Busy, Modal } from './Panels';
import { L } from './lib-i18n';
import { sharedText, useT } from './i18n';
import { isAngleView } from '../shared/domain.mjs';
import { isOutfitVariant, mainOutfitId, outfitRemoved, removedOutfitSnapshot } from '../shared/wardrobe.mjs';
import { safeFileName } from '../shared/model-sheet.mjs';

const filters = ['all', 'main', 'expression', 'gear'];
// 篩選用的分類：裝備、表情（表情集的胸像）、其他角色圖（立繪、三視圖）。
const kindOf = asset => (asset.targetId !== 'character' ? 'gear' : asset.view === 'expression' ? 'expression' : 'main');
const viewNames = new Set(['front', 'full', 'back', 'detail']);

// 回傳 gallery.adopted 底下的 key（正式立繪、設計圖或某個視角的設計圖）；文字在畫面上依目前語言取。
function adoptedFor(project, asset) {
  if (project.character.adopted?.[asset.targetId] === asset.id) return asset.targetId === 'character' ? 'main' : 'design';
  // 重畫後放進三視圖的側面／背面。
  if (asset.targetId === 'character' && isAngleView(asset.view) && project.views?.items?.[asset.view]?.sourceAssetId === asset.id) return `sheet${asset.view[0].toUpperCase()}${asset.view.slice(1)}`;
  // 放進表情集的表情。
  if (asset.targetId === 'character' && asset.view === 'expression' && project.expressions?.items?.[asset.expression]?.assetId === asset.id) return 'expression';
  // 衣櫃裡另一套穿搭的立繪。
  if (asset.targetId === 'character' && asset.view === 'front' && project.wardrobe?.items?.[asset.outfitId]?.assetId === asset.id && isOutfitVariant(project, asset.outfitId)) return 'outfit';
  const part = project.character.components?.[asset.targetId];
  if (part && Object.values(part.views || {}).includes(asset.id)) return viewNames.has(asset.view) ? asset.view : 'design';
  return null;
}

// 圖鑑：這個角色畫過的所有圖。點開可以放大、和目前的比較、設為正式、局部修改或再畫一次。
export function Gallery({ project, busy, onBack, onAdopt, onAdoptMain, onPromote, onPreview, onSummon, onRedraw, onRefine, onRestoreOutfit, onSheet, onImport, onCancelJob }) {
  const t = useT();
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  // 以前當過正式立繪的圖（存檔紀錄裡的正式立繪）：標「以前的正式立繪」，和沒採用過的候選分得出來。
  const formerMains = useMemo(() => new Set((project.history || []).map(entry => entry.character?.adopted?.character).filter(Boolean)), [project.history]);
  const items = useMemo(() => project.assets.filter(asset => asset.role === 'design')
    .map(asset => { const adopted = adoptedFor(project, asset); return { asset, candidate: project.candidates.find(item => item.assetId === asset.id), adopted, former: !adopted && formerMains.has(asset.id) }; })
    .map(item => ({ ...item, job: item.candidate && project.jobs.find(job => job.id === item.candidate.jobId) }))
    .sort((a, b) => (Date.parse(b.asset.createdAt || b.candidate?.createdAt) || 0) - (Date.parse(a.asset.createdAt || a.candidate?.createdAt) || 0)), [project, formerMains]);
  const visible = items.filter(item => filter === 'all' || kindOf(item.asset) === filter);
  // 有畫過表情才顯示「表情」分頁。
  const shownFilters = filters.filter(id => id !== 'expression' || filter === id || items.some(item => kindOf(item.asset) === 'expression'));
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
      <div className="tabs" role="tablist" aria-label={t('gallery.filterLabel')}>{shownFilters.map(id => <button type="button" role="tab" key={id} aria-selected={filter === id} onClick={() => setFilter(id)}>{t(`gallery.filter.${id}`)}</button>)}</div>
      {onSheet && <nav className="top-actions"><button type="button" className="top-btn" title={t('sheet.openTitle')} onClick={onSheet}><IdentificationCard size={17} /><span className="top-btn-label">{t('sheet.open')}</span></button></nav>}
    </header>
    <div className="gallery-body">
      {live.length > 0 && <section className="gallery-live" aria-label={t('gallery.live.label')}>{live.map(({ job, view }) => <article key={job.id} className={`live-card tone-${view.tone}`}>
        <div><StatusPill tone={view.tone} running={job.status === 'running'}>{job.status === 'failed' ? t('gallery.live.failed') : view.olderSettings && view.action === 'handoff' ? t('gallery.live.notSent') : view.action === 'handoff' ? t('gallery.live.waiting') : sharedText(view.labelKey, view.labelParams, view.label)}</StatusPill>{view.olderSettings && <span className="shot-note">{t('gallery.olderSettings')}</span>}<p>{viewTargetLabel(project, job.targetId, job.outputView, job.expression, job.outfitId)}{t('common.gap')}{job.prompt.length > 48 ? `${job.prompt.slice(0, 48)}…` : job.prompt}</p></div>
        <div className="live-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSummon(job.id)}>{t('gallery.live.view')}</button>
          <button type="button" className="btn btn-quiet btn-sm" title={t('gallery.live.importTitle')} onClick={() => { importJob.current = job; file.current?.click(); }}><UploadSimple size={14} />{t('gallery.live.import')}</button>
          {onCancelJob && canCancelJob(project, job) && <button type="button" className="btn btn-quiet btn-sm" disabled={busy} title={t('gallery.live.cancelTitle')} onClick={() => onCancelJob(job.id)}><Prohibit size={14} />{t('gallery.live.cancel')}</button>}
        </div>
      </article>)}</section>}
      <input ref={file} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" tabIndex={-1} aria-label={t('gallery.live.importInput')} onChange={event => { const picked = event.target.files?.[0]; event.target.value = ''; if (picked && importJob.current) onImport(importJob.current, picked); }} />
      {visible.length ? <div className="gallery-grid">{visible.map(({ asset, candidate, adopted, former }) => <Shot key={asset.id} asset={asset} label={adopted === 'main' ? t('common.mainIllustration') : viewTargetLabel(project, asset.targetId, asset.view, asset.expression, asset.outfitId)} onOpen={() => setOpenId(asset.id)}
        status={adopted ? <StatusPill tone="success">{t(`gallery.adopted.${adopted}`)}</StatusPill> : former ? <StatusPill tone="neutral" icon={ClockCounterClockwise}>{t('gallery.formerMain')}</StatusPill> : candidate?.olderSettings ? <span className="shot-note">{t('gallery.olderSettings')}</span> : null} adopted={Boolean(adopted)} />)}</div> : <div className="empty-state"><Sparkle size={30} weight="light" />{items.length ? <><h3>{t('gallery.empty.filteredTitle')}</h3><p>{t('gallery.empty.filteredBody', { all: t('gallery.filter.all') })}</p></> : <><h3>{t('gallery.empty.title')}</h3><p>{t('gallery.empty.body')}</p></>}</div>}
    </div>
    {open && <Lightbox project={project} item={open} busy={busy} onClose={() => setOpenId(null)} onAdopt={onAdopt} onAdoptMain={onAdoptMain} onPromote={onPromote} onPreview={onPreview} onRedraw={onRedraw} onRefine={onRefine} onRestoreOutfit={onRestoreOutfit} />}
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

const pad = value => String(value).padStart(2, '0');
const stamp = value => { const date = new Date(value || Date.now()); return Number.isNaN(date.getTime()) ? 'image' : `${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`; };
const extensionOf = mime => ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[mime] || 'png';

function Lightbox({ project, item, busy, onClose, onAdopt, onAdoptMain, onPromote, onRedraw, onRefine, onRestoreOutfit }) {
  const t = useT();
  const { asset, candidate, adopted, former, job } = item;
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [refine, setRefine] = useState(false);
  const comparison = candidate ? candidateComparison(project, candidate) : null;
  const current = comparison?.current && comparison.current.id !== asset.id ? comparison.current : null;
  // 重畫的三視圖單一角度（側面／背面）：採用只換掉三視圖裡那一張，不是換正式立繪。
  const sheetView = asset.targetId === 'character' && isAngleView(asset.view) ? asset.view : null;
  // 表情：採用只放進表情集那一格。
  const expressionShot = asset.targetId === 'character' && asset.view === 'expression';
  const isMain = asset.targetId === 'character' && !sheetView && !expressionShot;
  // 另一套穿搭的立繪：採用是放進那套的衣櫃；也可以改成正式立繪（原本的放進它那套）。
  const outfitShot = isMain && isOutfitVariant(project, asset.outfitId);
  // 照已經刪掉的套裝畫的（正式立繪本身除外）：不能採用（核心會擋）、不給再畫一次；可以在這裡復原那套，之後就能採用。
  const shotOutfit = asset.outfitId || candidate?.outfitId || job?.outfitId;
  const goneOutfit = isMain && adopted !== 'main' && outfitRemoved(project, shotOutfit);
  const goneSnapshot = goneOutfit ? removedOutfitSnapshot(project, shotOutfit) : null;
  const outfitName = outfitShot ? project.character.outfits[asset.outfitId].name || t('creator.outfit.untitled') : '';
  const mainName = outfitShot ? project.character.outfits[mainOutfitId(project)]?.name || t('creator.outfit.untitled') : '';
  // 「改成正式立繪」：衣櫃裡現在那張（匯入的沒有候選也行），或還沒採用的候選。
  // 照舊的三視圖重畫的角度：三視圖已經換了，不能放進新的三視圖。
  const staleView = Boolean(sheetView && job?.sheetAssetId && job.sheetAssetId !== project.views?.assetId);
  const heading = sheetView ? t('summon.viewTarget', { view: t(`canvas.views.view.${sheetView}`) }) : expressionShot ? viewTargetLabel(project, 'character', 'expression', asset.expression) : outfitShot ? t('summon.outfitTarget', { name: outfitName }) : goneOutfit ? viewTargetLabel(project, 'character', 'front', null, shotOutfit) : isMain ? t('common.mainIllustration') : targetLabel(project, asset.targetId);
  // 下載：檔名是「角色_這張是什麼_日期時間」，交給客戶時看得懂、不會互相蓋掉。
  const fileName = `${safeFileName(project.character.name)}_${safeFileName(heading)}_${stamp(asset.createdAt || candidate?.createdAt)}.${extensionOf(asset.mimeType)}`;
  useEffect(() => {
    // 翻牌畫面開在燈箱上面時（從這裡按再畫一次），Esc 先關翻牌畫面。
    const handle = event => { if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('.modal-backdrop, .summon')) { event.preventDefault(); onClose(); } };
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
      <h2 className="display">{heading}</h2>
      <p className="muted">{dateLabel(asset.createdAt || candidate?.createdAt || Date.now())}{asset.view && !isMain && !sheetView && !expressionShot ? `${t('common.gap')}${viewNames.has(asset.view) ? t(`gallery.view.${asset.view}`) : ''}` : ''}</p>
      {adopted ? <StatusPill tone="success">{t(`gallery.adopted.${adopted}`)}</StatusPill> : former && <StatusPill tone="neutral" icon={ClockCounterClockwise}>{t('gallery.formerMain')}</StatusPill>}
      {job?.prompt && <div className="lightbox-prompt"><span>{t('gallery.lightbox.request')}</span><p>{job.prompt}</p></div>}
      {candidate?.olderSettings && !adopted && !goneOutfit && <p className="hint">{t('gallery.lightbox.olderHint')}</p>}
      <div className="lightbox-actions">
        {staleView && !adopted && <p className="hint">{t('gallery.lightbox.staleView')}</p>}
        {goneOutfit && <p className="hint">{t('gallery.lightbox.outfitRemoved')}</p>}
        {goneSnapshot && onRestoreOutfit && <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => onRestoreOutfit(shotOutfit)}><ArrowCounterClockwise size={16} />{t('creator.wardrobe.restore', { name: goneSnapshot.outfit.name || t('creator.outfit.untitled') })}</button>}
        {candidate && !adopted && !staleView && !goneOutfit && <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => onAdopt(candidate)}>{busy ? <Busy /> : <><Check size={17} weight="bold" />{sheetView ? t('gallery.lightbox.adoptView', { view: t(`canvas.views.view.${sheetView}`) }) : expressionShot ? t('gallery.lightbox.adoptExpression') : outfitShot ? t('gallery.lightbox.adoptOutfit', { name: outfitName }) : isMain ? t('gallery.lightbox.adoptMain') : t('gallery.lightbox.adoptPart')}</>}</button>}
        {outfitShot && (adopted === 'outfit' ? onPromote : candidate && onAdoptMain) && <>
          <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={() => (adopted === 'outfit' ? onPromote(asset.outfitId) : onAdoptMain(candidate))}><Crown size={16} />{t('gallery.lightbox.makeMain')}</button>
          <small className="hint">{t('gallery.lightbox.makeMainHint', { previous: mainName })}</small>
        </>}
        {current && <button type="button" className="btn btn-secondary btn-block" aria-pressed={compare} onClick={() => setCompare(value => !value)}><SquareSplitHorizontal size={16} />{compare ? t('gallery.compare.stop') : t('gallery.compare.start')}</button>}
        <a className="btn btn-secondary btn-block" href={asset.url} download={fileName}><DownloadSimple size={16} />{t('gallery.lightbox.download')}</a>
        {adopted && !sheetView && !expressionShot && <button type="button" className="btn btn-secondary btn-block" onClick={() => setRefine(true)}><Crosshair size={16} />{t('gallery.lightbox.refine')}</button>}
        {job && !goneOutfit && <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={() => onRedraw(job)}><ArrowClockwise size={16} />{t('gallery.lightbox.redraw')}</button>}
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
