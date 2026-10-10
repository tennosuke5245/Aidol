import { useEffect, useRef } from 'react';
import { ArrowSquareOut, Copy, X, Images, ArrowClockwise, Check, MagnifyingGlassPlus } from '@phosphor-icons/react';
import { jobProgress } from '../shared/agent-workspace.mjs';
import { targetLabel } from './api';
import { Mark } from './ui';
import { Busy } from './Panels';
import { formatList, isSource, useT } from './i18n';

// 繪製畫面：引導到 Codex 按送出 → 真實回報「繪製中」→ 每回來一張翻開一張 → 選一張。
// 卡片數量就是這次要畫的張數；沒有回報之前不顯示任何進度。
const referenceRoles = new Set(['style', 'identity', 'color', 'clothing', 'material', 'composition']);

function phaseOf(job, progress) {
  if (job.status === 'failed' && !progress.returned) return 'failed';
  if (progress.generating || job.status === 'running') return 'drawing';
  if (progress.returned > 0) return 'done';
  return 'waiting';
}

export function Summon({ project, jobId, busy, onClose, onAdopt, onReopen, onCopy, onPreview, onGallery }) {
  const t = useT();
  const job = project.jobs.find(item => item.id === jobId);
  // 每張卡第一次出現時決定翻牌延遲，之後固定不變，重繪時不會重播。
  const delays = useRef(new Map());
  useEffect(() => {
    const handle = event => { if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);
  if (!job) return null;
  const progress = jobProgress(project, job);
  const phase = phaseOf(job, progress);
  const candidates = project.candidates.filter(item => item.jobId === job.id).sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
  const slots = Math.max(progress.expected, candidates.length);
  const firstPass = delays.current.size === 0;
  const isMain = job.targetId === 'character';
  const target = targetLabel(project, job.targetId);
  // 這份工作建立時固定下來的角色描述（中文部分）；英文提示留給 agent，不在這裡顯示。
  // compileBrief 的第一個標題一定是「結構化角色 DNA」，換成較短的介面標題。
  // 「這次帶給 AI 的內容」：繁中顯示中文段；其他語言顯示同一份內容裡給 AI 的英文段（沒有時才退回中文段）。
  const [briefZh, briefEn] = (job.context?.compiled || '').split('\n## English brief');
  const brief = (!isSource() && briefEn?.trim() ? briefEn : (briefZh || '').replace(/^## .*$/m, t('summon.prompt.briefHeading'))).replace(/^## /gm, '').trim();
  // 這次一起交給 AI 的圖，以及各自的用途（繪風參考管畫法，立繪與裝備圖管長相）。
  const styleRefs = job.context?.styleReferences || project.character.style.references || [];
  const inputs = (job.context?.referenceAssets || []).map(asset => {
    const reference = styleRefs.find(item => item.assetId === asset.id);
    const label = reference ? t('summon.reference.label', { role: t(referenceRoles.has(reference.role) ? `summon.reference.role.${reference.role}` : 'summon.reference.role.other'), focus: formatList(reference.focus || []) || t('summon.reference.overall') })
      : asset.targetId === 'character' ? t('summon.reference.main') : t('summon.reference.partDesign', { name: targetLabel(project, asset.targetId) });
    return { id: asset.id, label, url: project.assets.find(item => item.id === asset.id)?.url, style: reference?.role === 'style' };
  }).sort((a, b) => Number(b.style) - Number(a.style));
  // 正式引用：立繪看 adopted.character；裝備的正面看 assetId，背面／細節看 views。
  const part = isMain ? null : project.character.components[job.targetId];
  const adoptedId = isMain ? project.character.adopted.character : ['back', 'detail'].includes(job.outputView) ? part?.views?.[job.outputView] : part?.assetId;
  const anyAdopted = candidates.some(candidate => candidate.assetId === adoptedId);
  const copy = {
    waiting: { title: t('summon.waiting.title'), sub: t('summon.waiting.sub') },
    drawing: { title: t('summon.drawing.title', { returned: progress.returned, expected: progress.expected }), sub: t('summon.drawing.sub') },
    done: anyAdopted ? { title: isMain ? t('summon.adopted.titleMain') : t('summon.adopted.titlePart', { name: target }), sub: t('summon.adopted.sub') }
      : { title: isMain ? t('summon.pick.titleMain') : t('summon.pick.titlePart', { name: target }), sub: progress.generating ? t('summon.pick.subDrawing') : t('summon.pick.sub') },
    failed: { title: t('summon.failed.title'), sub: job.failure?.message ? t('summon.failed.reported', { message: job.failure.message }) : t('summon.failed.sub') },
  }[phase];

  return <div className={`summon phase-${phase}`} role="dialog" aria-modal="true" aria-label={copy.title}>
    <button type="button" className="summon-close icon-btn" aria-label={t('summon.close')} onClick={onClose}><X size={20} /></button>
    <header className="summon-head">
      <span className="summon-target">{target}</span>
      <h2 className="display">{copy.title}</h2>
      <p>{copy.sub}</p>
    </header>
    <div className="summon-cards" style={{ '--count': slots }}>
      {Array.from({ length: slots }, (_, index) => {
        const candidate = candidates[index];
        const asset = candidate && project.assets.find(item => item.id === candidate.assetId);
        if (candidate && !delays.current.has(candidate.id)) delays.current.set(candidate.id, firstPass ? index * 160 : 0);
        const adopted = asset && asset.id === adoptedId;
        return <div key={index} className={`summon-card ${candidate ? 'is-revealed' : ''} ${adopted ? 'is-adopted' : ''}`} style={{ '--delay': `${candidate ? delays.current.get(candidate.id) : 0}ms` }}>
          <div className="card-inner">
            <div className="card-back"><Mark size={46} /><span>{phase === 'waiting' ? t('summon.card.waiting') : phase === 'failed' ? t('summon.card.failed') : t('summon.card.drawing')}</span></div>
            <div className="card-front">
              {asset && <button type="button" className="card-img" onClick={() => onPreview(asset, t('summon.card.previewTitle', { target, number: index + 1 }))} aria-label={t('summon.card.zoom', { number: index + 1 })}><img src={asset.url} alt={t('summon.card.alt', { number: index + 1 })} /><span className="card-zoom"><MagnifyingGlassPlus size={16} /></span></button>}
              <div className="card-foot">
                {adopted ? <span className="card-picked"><Check size={14} weight="bold" />{isMain ? t('summon.card.pickedMain') : t('summon.card.picked')}</span>
                  : candidate && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAdopt(candidate)}>{isMain ? t('summon.card.adoptMain') : t('summon.card.adopt')}</button>}
                {candidate?.olderSettings && !adopted && <small className="card-note">{t('summon.card.older')}</small>}
              </div>
            </div>
          </div>
        </div>;
      })}
    </div>
    <footer className="summon-foot">
      {phase === 'waiting' && <><button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => onReopen(job.id)}>{busy ? <Busy>{t('summon.opening')}</Busy> : <><ArrowSquareOut size={17} />{t('summon.reopen')}</>}</button><button type="button" className="btn btn-secondary btn-lg" disabled={busy} onClick={() => onCopy(job.id)}><Copy size={16} />{t('summon.copyPrompt')}</button></>}
      {phase === 'failed' && <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => onReopen(job.id)}><ArrowClockwise size={17} />{t('summon.tryAgain')}</button>}
      {phase === 'drawing' && <button type="button" className="btn btn-secondary btn-lg" onClick={() => onReopen(job.id)}><ArrowSquareOut size={16} />{t('summon.progressInCodex')}</button>}
      <button type="button" className="btn btn-quiet btn-lg" onClick={onClose}>{phase === 'done' && anyAdopted ? t('summon.close') : t('summon.closeForNow')}</button>
      {phase === 'done' && <button type="button" className="btn btn-quiet btn-lg" onClick={onGallery}><Images size={17} />{t('summon.openGallery')}</button>}
    </footer>
    <details className="summon-prompt"><summary>{t('summon.prompt.summary')}</summary><p>{job.prompt}</p>
      {inputs.length > 0 && <ul className="summon-inputs" aria-label={t('summon.prompt.inputs')}>{inputs.map(item => <li key={item.id} className={item.style ? 'is-style' : ''}>{item.url && <img src={item.url} alt="" />}<span>{item.label}</span></li>)}</ul>}
      {brief && <p className="summon-brief">{brief}</p>}</details>
  </div>;
}
