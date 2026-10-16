import { useEffect, useRef } from 'react';
import { ArrowSquareOut, Copy, X, Images, ArrowClockwise, ArrowCounterClockwise, Check, MagnifyingGlassPlus, Stop, SealCheck, ListChecks, PaintBrush, Prohibit } from '@phosphor-icons/react';
import { canCancelJob, jobProgress } from '../shared/agent-workspace.mjs';
import { targetLabel, errorText, viewTargetLabel } from './api';
import { Mark } from './ui';
import { Busy } from './Panels';
import { formatDate, formatList, isSource, useT } from './i18n';
import { isAngleView } from '../shared/domain.mjs';
import { isOutfitVariant, outfitRemoved, removedOutfitSnapshot } from '../shared/wardrobe.mjs';

// 繪製畫面：引導到 Codex 按送出 → 真實回報「繪製中」→ 每回來一張翻開一張 → 選一張。
// 卡片數量就是這次要畫的張數；沒有回報之前不顯示任何進度。
const referenceRoles = new Set(['style', 'identity', 'color', 'clothing', 'material', 'composition']);

function phaseOf(job, progress) {
  if (job.status === 'failed' && !progress.returned) return 'failed';
  if (progress.generating || job.status === 'running') return 'drawing';
  if (progress.returned > 0) return 'done';
  return 'waiting';
}

// direct：AIDOL 直接畫（核心叫 Codex 畫，不用到 Codex App 按送出）。onDraw 直接畫這個工作、onStop 停下、onReview 請 Design QA 挑。
// onCancel：「不畫了」（還沒送出、等你送出或失敗時）。
export function Summon({ project, jobId, busy, canDrawDirect = false, canReview = false, onClose, onAdopt, onReopen, onCopy, onPreview, onGallery, onDraw, onStop, onReview, onRestoreOutfit, onCancel }) {
  const t = useT();
  const job = project.jobs.find(item => item.id === jobId);
  // 每張卡第一次出現時決定翻牌延遲，之後固定不變，重繪時不會重播。
  const delays = useRef(new Map());
  const box = useRef(null);
  // 打開時鍵盤焦點移到這個畫面（Tab 在畫面裡繞），關掉後回到原本的按鈕。
  useEffect(() => {
    const prior = document.activeElement;
    box.current?.focus();
    return () => { if (prior?.isConnected) prior.focus?.(); };
  }, []);
  useEffect(() => {
    const handle = event => {
      if (event.defaultPrevented || document.querySelector('.modal-backdrop')) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab' && box.current) {
        // 看得到的才算（關閉鈕是 position: fixed，offsetParent 會是 null，不能用它判斷）。
        const items = [...box.current.querySelectorAll('button:not(:disabled),a[href],input,textarea,select,summary,[tabindex="0"]')].filter(item => item.getClientRects().length > 0);
        const first = items[0], last = items.at(-1);
        if (!box.current.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);
  if (!job) return null;
  const progress = jobProgress(project, job);
  const phase = phaseOf(job, progress);
  const direct = job.runner === 'auto';
  const review = job.review;
  const scoreOf = candidateId => review?.status === 'done' ? review.candidates?.find(entry => entry.candidateId === candidateId) : null;
  const candidates = project.candidates.filter(item => item.jobId === job.id).sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
  const slots = Math.max(progress.expected, candidates.length);
  const firstPass = delays.current.size === 0;
  // 重畫三視圖的單一角度：當成「三視圖的側面」這個目標來挑，採用後只換掉那一張。
  const viewJob = job.targetId === 'character' && isAngleView(job.outputView);
  // 表情：採用後只放進表情集那一格（不換正式立繪）。
  const expressionJob = job.targetId === 'character' && job.outputView === 'expression';
  // 另一套穿搭的立繪：採用後放進衣櫃（那套的立繪），不換正式立繪。
  const outfitJob = job.targetId === 'character' && !viewJob && !expressionJob && isOutfitVariant(project, job.outfitId);
  // 照已經刪掉的套裝畫的：這些圖不能採用（核心會擋；在這裡復原那套之後就可以），不再送出、也不請 Design QA 挑。
  // 舊資料裡這批可能有現在的正式立繪（正式立繪那套不在了）：那張照樣標「已採用」，標題也照正式立繪說。
  const holdsMain = project.candidates.some(item => item.jobId === job.id && item.assetId === project.character.adopted?.character);
  const goneOutfit = job.targetId === 'character' && !viewJob && !expressionJob && outfitRemoved(project, job.outfitId);
  const goneSnapshot = goneOutfit ? removedOutfitSnapshot(project, job.outfitId) : null;
  const isMain = job.targetId === 'character' && !viewJob && !expressionJob && !outfitJob && !goneOutfit;
  const target = viewJob || expressionJob || outfitJob || goneOutfit ? viewTargetLabel(project, job.targetId, job.outputView, job.expression, job.outfitId) : targetLabel(project, job.targetId);
  // 這份工作建立時固定下來的角色描述（中文部分）；英文提示留給 agent，不在這裡顯示。
  // compileBrief 的第一個標題一定是「結構化角色 DNA」，換成較短的介面標題。
  // 「這次帶給 AI 的內容」：繁中顯示中文段；其他語言顯示同一份內容裡給 AI 的英文段（沒有時才退回中文段）。
  const [briefZh, briefEn] = (job.context?.compiled || '').split('\n## English brief');
  const brief = (!isSource() && briefEn?.trim() ? briefEn : (briefZh || '').replace(/^## .*$/m, t('summon.prompt.briefHeading'))).replace(/^## /gm, '').trim();
  // 這次一起交給 AI 的圖，以及各自的用途（繪風參考管畫法，立繪與裝備圖管長相）。
  const styleRefs = job.context?.styleReferences || project.character.style.references || [];
  const inputs = (job.context?.referenceAssets || []).map(asset => {
    const reference = styleRefs.find(item => item.assetId === asset.id);
    // 三視圖的裁切圖（畫側面、背面時附的）：正面是照著畫的那張，其他是已確認的角度。
    if (asset.role === 'view') return { id: asset.id, label: asset.view === 'front' ? t('summon.reference.viewFront') : t('summon.reference.view', { view: t(`canvas.views.view.${asset.view}`) }), url: project.assets.find(item => item.id === asset.id)?.url, rank: asset.view === 'front' ? 3 : 2 };
    if (asset.view === 'expression') return { id: asset.id, label: t('summon.reference.expressionFraming'), url: project.assets.find(item => item.id === asset.id)?.url, rank: 2 };
    if (expressionJob && asset.id === job.expressionSource) return { id: asset.id, label: t('summon.reference.viewFront'), url: project.assets.find(item => item.id === asset.id)?.url, rank: 3 };
    const label = reference?.canon ? t('summon.reference.canon') : reference ? t('summon.reference.label', { role: t(referenceRoles.has(reference.role) ? `summon.reference.role.${reference.role}` : 'summon.reference.role.other'), focus: formatList(reference.focus || []) || t('summon.reference.overall') })
      : asset.targetId === 'character' ? t('summon.reference.main') : t('summon.reference.partDesign', { name: targetLabel(project, asset.targetId) });
    return { id: asset.id, label, url: project.assets.find(item => item.id === asset.id)?.url, rank: reference?.canon ? 2 : reference?.role === 'style' ? 1 : 0 };
  }).sort((a, b) => b.rank - a.rank);
  // 正式引用：立繪看 adopted.character；裝備的正面看 assetId，背面／細節看 views。
  const part = job.targetId === 'character' ? null : project.character.components[job.targetId];
  const adoptedId = expressionJob ? project.expressions?.items?.[job.expression]?.assetId : outfitJob ? project.wardrobe?.items?.[job.outfitId]?.assetId : viewJob ? project.views?.items?.[job.outputView]?.sourceAssetId : isMain || goneOutfit ? project.character.adopted.character : ['back', 'detail'].includes(job.outputView) ? part?.views?.[job.outputView] : part?.assetId;
  const anyAdopted = candidates.some(candidate => candidate.assetId === adoptedId);
  // 重畫時照的三視圖已經換掉：這些圖不能放進新的三視圖（留在圖鑑）。
  const staleView = viewJob && Boolean(job.sheetAssetId) && job.sheetAssetId !== project.views?.assetId;
  const copy = {
    waiting: { title: t('summon.waiting.title'), sub: t('summon.waiting.sub') },
    drawing: { title: t('summon.drawing.title', { returned: progress.returned, expected: progress.expected }), sub: direct ? t('summon.direct.drawingSub') : t('summon.drawing.sub') },
    done: anyAdopted ? { title: isMain ? t('summon.adopted.titleMain') : t('summon.adopted.titlePart', { name: target }), sub: t('summon.adopted.sub') }
      : { title: isMain ? t('summon.pick.titleMain') : t('summon.pick.titlePart', { name: target }), sub: progress.generating ? t('summon.pick.subDrawing') : t('summon.pick.sub') },
    failed: { title: t('summon.failed.title'), sub: job.failure?.code === 'DRAW_USAGE_LIMIT' && Number.isFinite(job.failure.resetsAt) ? t('summon.direct.usageLimit', { time: formatDate(job.failure.resetsAt * 1000) }) : job.failure?.code ? errorText(job.failure.code, job.failure.message) : job.failure?.message ? t('summon.failed.reported', { message: job.failure.message }) : t('summon.failed.sub') },
  }[phase];
  // 套裝刪掉了：還沒送出的不用送、畫到一半的可以停下、畫好的不能採用（都留在圖鑑）；失敗的照樣說原因，只是不再試。
  if (goneOutfit && phase !== 'failed') Object.assign(copy, phase === 'waiting' ? { title: t('summon.outfitRemovedTitle'), sub: t('summon.outfitRemovedWaiting') } : phase === 'drawing' ? { sub: t('summon.outfitRemovedDrawing') } : { title: holdsMain ? t('summon.adopted.titleMain') : t('summon.outfitRemovedTitle'), sub: t('summon.outfitRemoved') });

  // 不畫了：還沒送出、等你送出或失敗的（全自動正在處理的、已結束的不給；核心也會擋）。
  const cancellable = onCancel && (phase === 'waiting' || phase === 'failed') && canCancelJob(project, job);
  return <div className={`summon phase-${phase} ${expressionJob ? 'is-bust' : ''}`} role="dialog" aria-modal="true" aria-label={copy.title} ref={box} tabIndex={-1}>
    <button type="button" className="summon-close icon-btn" aria-label={t('summon.close')} onClick={onClose}><X size={20} /></button>
    <header className="summon-head">
      <span className="summon-target">{target}</span>
      <h2 className="display">{copy.title}</h2>
      <p>{copy.sub}</p>
      {review?.status === 'running' && <p className="summon-qa"><Busy>{t('summon.qa.running')}</Busy></p>}
      {review?.status === 'done' && <p className="summon-qa"><ListChecks size={15} />{review.pick ? t('summon.qa.picked', { summary: review.summary }) : t('summon.qa.none', { summary: review.summary })}</p>}
      {review?.status === 'failed' && <p className="summon-qa is-error">{errorText(review.errorCode, review.error)}</p>}
    </header>
    <div className="summon-cards" style={{ '--count': slots }}>
      {Array.from({ length: slots }, (_, index) => {
        const candidate = candidates[index];
        const asset = candidate && project.assets.find(item => item.id === candidate.assetId);
        if (candidate && !delays.current.has(candidate.id)) delays.current.set(candidate.id, firstPass ? index * 160 : 0);
        const adopted = asset && asset.id === adoptedId;
        const score = candidate && scoreOf(candidate.id);
        const picked = score && review.pick === candidate.id;
        return <div key={index} className={`summon-card ${candidate ? 'is-revealed' : ''} ${adopted ? 'is-adopted' : ''}`} style={{ '--delay': `${candidate ? delays.current.get(candidate.id) : 0}ms` }}>
          <div className="card-inner">
            <div className="card-back"><Mark size={46} /><span>{phase === 'waiting' ? (goneOutfit ? t('summon.card.outfitRemoved') : t('summon.card.waiting')) : phase === 'failed' ? t('summon.card.failed') : t('summon.card.drawing')}</span></div>
            <div className="card-front">
              {asset && <button type="button" className="card-img" onClick={() => onPreview(asset, t('summon.card.previewTitle', { target, number: index + 1 }))} aria-label={t('summon.card.zoom', { number: index + 1 })}><img src={asset.url} alt={t('summon.card.alt', { number: index + 1 })} /><span className="card-zoom"><MagnifyingGlassPlus size={16} /></span>
                {score && <span className={`qa-badge ${picked ? 'is-pick' : score.pass ? '' : 'is-fail'}`}>{picked && <SealCheck size={13} weight="fill" />}{picked ? t('summon.qa.pickBadge') : score.pass ? t('summon.qa.passBadge') : t('summon.qa.failBadge')}<span className="num">{t('summon.qa.score', { total: score.total })}</span></span>}</button>}
              <div className="card-foot">
                {score?.issues?.length > 0 && <small className="card-note card-issues" title={score.issues.join('\n')}>{score.issues.slice(0, 2).join(t('summon.qa.issueSep'))}</small>}
                {adopted ? <span className="card-picked"><Check size={14} weight="bold" />{candidate?.acceptedBy === 'design-qa' ? t('summon.card.pickedByQa') : isMain ? t('summon.card.pickedMain') : t('summon.card.picked')}</span>
                  : candidate && (staleView ? <small className="card-note">{t('summon.card.staleView')}</small> : goneOutfit ? <small className="card-note">{t('summon.card.outfitRemoved')}</small> : <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAdopt(candidate)}>{isMain ? t('summon.card.adoptMain') : t('summon.card.adopt')}</button>)}
                {candidate?.olderSettings && !adopted && !goneOutfit && <small className="card-note">{t('summon.card.older')}</small>}
              </div>
            </div>
          </div>
        </div>;
      })}
    </div>
    <footer className="summon-foot">
      {phase === 'waiting' && !goneOutfit && <><button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => onReopen(job.id)}>{busy ? <Busy>{t('summon.opening')}</Busy> : <><ArrowSquareOut size={17} />{t('summon.reopen')}</>}</button><button type="button" className="btn btn-secondary btn-lg" disabled={busy} onClick={() => onCopy(job.id)}><Copy size={16} />{t('summon.copyPrompt')}</button>
        {canDrawDirect && onDraw && <button type="button" className="btn btn-secondary btn-lg" disabled={busy} onClick={() => onDraw(job.id)}><PaintBrush size={16} />{t('summon.direct.switch')}</button>}</>}
      {phase === 'failed' && !goneOutfit && (direct && canDrawDirect && onDraw
        ? <><button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => onDraw(job.id)}><ArrowClockwise size={17} />{t('summon.direct.again')}</button><button type="button" className="btn btn-secondary btn-lg" disabled={busy} onClick={() => onReopen(job.id)}><ArrowSquareOut size={16} />{t('summon.direct.useCodexApp')}</button></>
        : <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => onReopen(job.id)}><ArrowClockwise size={17} />{t('summon.tryAgain')}</button>)}
      {phase === 'drawing' && (direct
        ? <button type="button" className="btn btn-secondary btn-lg" disabled={busy || !onStop} onClick={() => onStop(job.id)}><Stop size={16} />{t('summon.direct.stop')}</button>
        : !goneOutfit && <button type="button" className="btn btn-secondary btn-lg" onClick={() => onReopen(job.id)}><ArrowSquareOut size={16} />{t('summon.progressInCodex')}</button>)}
      {goneSnapshot && onRestoreOutfit && <button type="button" className="btn btn-secondary btn-lg" disabled={busy} onClick={() => onRestoreOutfit(job.outfitId)}><ArrowCounterClockwise size={16} />{t('creator.wardrobe.restore', { name: goneSnapshot.outfit.name || t('creator.outfit.untitled') })}</button>}
      {phase === 'done' && !progress.generating && onReview && !goneOutfit && candidates.length > 0 && review?.status !== 'running' && review?.status !== 'done' && <button type="button" className="btn btn-secondary btn-lg" disabled={busy || !canReview} title={canReview ? undefined : t('summon.qa.needsCodex')} onClick={() => onReview(job.id)}><ListChecks size={17} />{t('summon.qa.ask')}</button>}
      {cancellable && <button type="button" className="btn btn-quiet btn-lg" disabled={busy} onClick={() => onCancel(job.id)}><Prohibit size={16} />{t('summon.cancel')}</button>}
      <button type="button" className="btn btn-quiet btn-lg" onClick={onClose}>{phase === 'done' && anyAdopted ? t('summon.close') : t('summon.closeForNow')}</button>
      {phase === 'done' && <button type="button" className="btn btn-quiet btn-lg" onClick={onGallery}><Images size={17} />{t('summon.openGallery')}</button>}
    </footer>
    <details className="summon-prompt"><summary>{t('summon.prompt.summary')}</summary><p>{job.prompt}</p>
      {inputs.length > 0 && <ul className="summon-inputs" aria-label={t('summon.prompt.inputs')}>{inputs.map(item => <li key={item.id} className={item.rank === 2 ? 'is-canon' : item.rank === 1 ? 'is-style' : ''}>{item.url && <img src={item.url} alt="" />}<span>{item.label}</span></li>)}</ul>}
      {brief && <p className="summon-brief">{brief}</p>}</details>
  </div>;
}
