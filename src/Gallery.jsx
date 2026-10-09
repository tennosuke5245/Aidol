import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, Check, Crosshair, ArrowClockwise, X, Sparkle, SquareSplitHorizontal, UploadSimple } from '@phosphor-icons/react';
import { candidateComparison, jobPresentation, jobProgress } from '../shared/agent-workspace.mjs';
import { dateLabel, targetLabel } from './api';
import { StatusPill } from './ui';
import { Busy, Modal } from './Panels';
import * as L from '../shared/libraries.mjs';

const filters = [['all', '全部'], ['main', '立繪'], ['gear', '裝備']];
const viewNames = { front: '正面', full: '完整', back: '背面', detail: '細節' };

function adoptedFor(project, asset) {
  if (project.character.adopted?.[asset.targetId] === asset.id) return asset.targetId === 'character' ? '正式立繪' : '設計圖';
  const part = project.character.components?.[asset.targetId];
  if (part && Object.values(part.views || {}).includes(asset.id)) return `${viewNames[asset.view] || ''}設計圖`;
  return null;
}

// 圖鑑：這個角色畫過的所有圖。點開可以放大、和目前的比較、設為正式、局部修改或再畫一次。
export function Gallery({ project, busy, onBack, onAdopt, onPreview, onSummon, onRedraw, onRefine, onImport }) {
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
      <button type="button" className="top-back" onClick={onBack}><CaretLeft size={16} weight="bold" />回到角色</button>
      <div className="top-title"><h1 className="display">圖鑑</h1><span className="top-sub num">{items.length} 張</span></div>
      <div className="tabs" role="tablist" aria-label="篩選">{filters.map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    </header>
    <div className="gallery-body">
      {live.length > 0 && <section className="gallery-live" aria-label="還在進行的繪製">{live.map(({ job, view }) => <article key={job.id} className={`live-card tone-${view.tone}`}>
        <div><StatusPill tone={view.tone} running={job.status === 'running'}>{job.status === 'failed' ? '這次沒畫成' : view.olderSettings && view.action === 'handoff' ? '沒送出' : view.action === 'handoff' ? '到 Codex 按送出' : view.label}</StatusPill>{view.olderSettings && <span className="shot-note">較早的設定</span>}<p>{targetLabel(project, job.targetId)}　{job.prompt.length > 48 ? `${job.prompt.slice(0, 48)}…` : job.prompt}</p></div>
        <div className="live-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSummon(job.id)}>查看</button>
          <button type="button" className="btn btn-quiet btn-sm" title="從電腦選一張圖放進這次繪製" onClick={() => { importJob.current = job; file.current?.click(); }}><UploadSimple size={14} />手動放入</button>
        </div>
      </article>)}</section>}
      <input ref={file} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" tabIndex={-1} aria-label="選擇要放入的圖片" onChange={event => { const picked = event.target.files?.[0]; event.target.value = ''; if (picked && importJob.current) onImport(importJob.current, picked); }} />
      {visible.length ? <div className="gallery-grid">{visible.map(({ asset, candidate, adopted }) => <Shot key={asset.id} asset={asset} label={asset.targetId === 'character' ? '立繪' : targetLabel(project, asset.targetId)} onOpen={() => setOpenId(asset.id)}
        status={adopted ? <StatusPill tone="success">{adopted}</StatusPill> : candidate?.olderSettings ? <span className="shot-note">較早的設定</span> : null} adopted={Boolean(adopted)} />)}</div> : <div className="empty-state"><Sparkle size={30} weight="light" /><h3>還沒有圖</h3><p>到「捏角色」按「開始繪製」，畫好的圖都會收在這裡。</p></div>}
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
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label="圖片">
    <button type="button" className="lightbox-close icon-btn" aria-label="關閉" onClick={onClose}><X size={20} /></button>
    <div className="lightbox-stage">
      {compare && current ? <div className="compare-wipe">
        <img src={asset.url} alt="這張" draggable="false" />
        <div className="compare-top" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}><img src={current.url} alt="目前的" draggable="false" /></div>
        <div className="compare-line" style={{ left: `${split}%` }} />
        <span className="compare-tag left">目前的</span><span className="compare-tag right">這張</span>
        <input className="compare-range" type="range" min="0" max="100" value={split} aria-label="比較分割位置" onChange={event => setSplit(Number(event.target.value))} />
      </div> : <img className="lightbox-img" src={asset.url} alt="" />}
    </div>
    <aside className="lightbox-side">
      <h2 className="display">{isMain ? '立繪' : targetLabel(project, asset.targetId)}</h2>
      <p className="muted">{dateLabel(asset.createdAt || candidate?.createdAt || Date.now())}{asset.view && !isMain ? `　${viewNames[asset.view] || ''}` : ''}</p>
      {adopted && <StatusPill tone="success">{adopted}</StatusPill>}
      {job?.prompt && <div className="lightbox-prompt"><span>這次的要求</span><p>{job.prompt}</p></div>}
      {candidate?.olderSettings && <p className="hint">這張是用較早的設定畫的，照樣可以採用；採用不會改動目前的設定。</p>}
      <div className="lightbox-actions">
        {candidate && !adopted && <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => onAdopt(candidate)}>{busy ? <Busy>處理中…</Busy> : <><Check size={17} weight="bold" />{isMain ? '設為正式立繪' : '設為這件的設計圖'}</>}</button>}
        {current && <button type="button" className="btn btn-secondary btn-block" aria-pressed={compare} onClick={() => setCompare(value => !value)}><SquareSplitHorizontal size={16} />{compare ? '結束比較' : '和目前的比較'}</button>}
        {adopted && <button type="button" className="btn btn-secondary btn-block" onClick={() => setRefine(true)}><Crosshair size={16} />框選局部修改</button>}
        {job && <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={() => onRedraw(job)}><ArrowClockwise size={16} />用一樣的要求再畫</button>}
      </div>
    </aside>
    {refine && <RefineModal asset={asset} busy={busy} onClose={() => setRefine(false)} onSubmit={async options => { const done = await onRefine(asset, options); if (done) { setRefine(false); onClose(); } }} />}
  </div>;
}

function RefineModal({ asset, busy, onClose, onSubmit }) {
  const [region, setRegion] = useState(null);
  const [note, setNote] = useState('');
  const [count, setCount] = useState(1);
  const box = useRef(null), start = useRef(null);
  const point = event => { const rect = box.current.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
  const move = event => { if (!start.current) return; const end = point(event); setRegion({ x: Math.min(start.current.x, end.x), y: Math.min(start.current.y, end.y), width: Math.abs(end.x - start.current.x), height: Math.abs(end.y - start.current.y) }); };
  const ready = note.trim() && (!region || (region.width > 0.01 && region.height > 0.01));
  return <Modal title="局部修改" subtitle="在圖上拖曳框出要改的地方（不框就是整張），再寫要怎麼改。" onClose={onClose} wide>
    <div className="refine-layout">
      <div className="region-stage"><div className="region-image" ref={box} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); start.current = point(event); setRegion(null); }} onPointerMove={move} onPointerUp={event => { move(event); start.current = null; }}>
        <img src={asset.url} alt="要修改的圖" draggable="false" />
        {region && <span className="region-box" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />}
      </div></div>
      <form className="form-stack" onSubmit={event => { event.preventDefault(); if (ready) onSubmit({ note, region: region && region.width > 0.01 ? region : null, variants: count }); }}>
        <label className="field"><span>要怎麼改？</span><textarea autoFocus rows={5} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="例如：扣具改成月牙形，黃銅材質" /></label>
        <div className="field"><span>張數</span><div className="count-seg" role="group">{L.variantCounts.map(value => <button type="button" key={value} aria-pressed={count === value} onClick={() => setCount(value)}>×{value}</button>)}</div></div>
        {region && <button type="button" className="btn btn-text" onClick={() => setRegion(null)}>清除框選</button>}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !ready}>{busy ? <Busy>準備中…</Busy> : <><Sparkle size={16} weight="fill" />開始繪製</>}</button>
      </form>
    </div>
  </Modal>;
}
