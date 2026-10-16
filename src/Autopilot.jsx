import { useEffect, useState } from 'react';
import { Check, CircleNotch, WarningCircle, Stop, Play, ArrowRight, Smiley, TShirt } from '@phosphor-icons/react';
import { useT, formatDate } from './i18n';
import { errorText, outfitStepName } from './api';
import { Busy } from './Panels';
import { AUTOPILOT_VIEWS, AUTOPILOT_DEFAULT } from '../shared/autopilot.mjs';
import { variantCounts } from '../shared/libraries.mjs';
import { expressionList, expressionsToDraw, nextExpression } from '../shared/expressions.mjs';
import { expressionName } from './Expressions';
import { isOutfitVariant, nextOutfit, outfitPortraitId, outfitsToDraw } from '../shared/wardrobe.mjs';

// 全自動（2026-10-13 起）：AIDOL 用你的 Codex 畫正面全身，Design QA 每批挑一張代為採用，
// 再照正面一個一個畫勾選的角度。進度、Design QA 的理由與每一步的工作都在這裡看得到。
const endedStates = new Set(['done', 'stopped', 'paused', 'needs-you', 'failed', 'interrupted']);

// 表情集那一列：全部畫完、正在畫其中一個、或還沒輪到。
function expressionsState(project, autopilot, onlyFaces) {
  const list = expressionList(project.expressions);
  const drawn = list.filter(key => project.expressions?.items?.[key]?.assetId);
  const latest = drawn.length ? project.expressions.items[drawn.at(-1)].assetId : null;
  if (!nextExpression(project)) return { state: 'done', assetId: latest, drawn: drawn.length, total: list.length };
  const step = autopilot?.status === 'running' ? autopilot.step : null;
  if (step?.kind === 'draw' && step.view === 'expression') return { state: 'current', phase: step.phase, attempt: step.attempt, jobId: step.jobId, expression: step.expression, drawn: drawn.length, total: list.length };
  // 只畫表情時，等畫面裁好正面、等 AI 找角度也顯示在這一列。
  if (onlyFaces && step?.kind === 'wait') return { state: 'current', phase: step.reason === 'split' ? 'split' : 'detecting', drawn: drawn.length, total: list.length };
  return { state: 'pending', drawn: drawn.length, total: list.length };
}

// 衣櫃那一列（2026-10-14 起）：另一套穿搭都有立繪了、正在畫其中一套、或還沒輪到。
function outfitsState(project, autopilot) {
  // 還沒有正式立繪：畫好正面之後，除了畫正面用的那套，其他都要畫。
  if (!project.character.adopted?.character) return { state: 'pending', drawn: 0, total: Math.max(0, Object.keys(project.character.outfits || {}).length - 1) };
  const variants = Object.keys(project.character.outfits || {}).filter(id => isOutfitVariant(project, id));
  const drawn = variants.filter(id => outfitPortraitId(project, id));
  const latest = drawn.length ? outfitPortraitId(project, drawn.at(-1)) : null;
  if (!nextOutfit(project)) return { state: 'done', assetId: latest, drawn: drawn.length, total: variants.length };
  const step = autopilot?.status === 'running' ? autopilot.step : null;
  if (step?.kind === 'draw' && step.view === 'outfit') return { state: 'current', phase: step.phase, attempt: step.attempt, jobId: step.jobId, outfitId: step.outfitId, drawn: drawn.length, total: variants.length };
  return { state: 'pending', drawn: drawn.length, total: variants.length };
}

function stepState(project, autopilot, view) {
  const views = project.views;
  const ready = views?.assetId && views.assetId === project.character.adopted.character;
  const item = ready && views.items?.[view];
  if (item && (view !== 'front' || views.status === 'done')) return { state: 'done', assetId: item.assetId };
  if (autopilot?.status !== 'running') return { state: 'pending' };
  const step = autopilot.step;
  if (step?.kind === 'draw' && step.view === view) return { state: 'current', phase: step.phase, attempt: step.attempt, jobId: step.jobId };
  if (step?.kind === 'wait' && view === 'front') return { state: 'current', phase: step.reason === 'split' ? 'split' : 'detecting' };
  return { state: 'pending' };
}

export function AutopilotPanel({ project, busy, loadAccess, onStart, onStop, onOpenJob, onOpenExpressions, onOpenWardrobe }) {
  const t = useT();
  const autopilot = project.autopilot;
  const running = autopilot?.status === 'running';
  const [views, setViews] = useState(() => autopilot?.config?.views || [...AUTOPILOT_DEFAULT.views]);
  const [variants, setVariants] = useState(() => autopilot?.config?.variants || AUTOPILOT_DEFAULT.variants);
  const [expressions, setExpressions] = useState(() => autopilot?.config?.expressions ?? AUTOPILOT_DEFAULT.expressions);
  const [outfits, setOutfits] = useState(() => autopilot?.config?.outfits ?? AUTOPILOT_DEFAULT.outfits);
  const [access, setAccess] = useState(null);
  useEffect(() => { let alive = true; loadAccess().then(result => alive && setAccess(result), () => alive && setAccess({ ok: false, code: 'CODEX_UNAVAILABLE' })); return () => { alive = false; }; }, [loadAccess]);
  const shownViews = running ? autopilot.config.views : views;
  const shownExpressions = running ? Boolean(autopilot.config.expressions) : expressions;
  const shownOutfits = running ? Boolean(autopilot.config.outfits) : outfits;
  // 只畫表情集、衣櫃而且已經有正式立繪：照它畫，不用正面那一步。跑的時候照開始時記下的（跑到一半有了立繪也不會變）。
  const onlyFaces = running && typeof autopilot.facesOnly === 'boolean' ? autopilot.facesOnly : Boolean(project.character.adopted.character) && (shownExpressions || shownOutfits) && !shownViews.length;
  // 衣櫃要畫幾套：還沒有立繪的另一套穿搭（還沒有正式立繪時，畫好正面後除了主要那套都要畫）。
  const outfitsLeft = project.character.adopted.character ? outfitsToDraw(project).length : Math.max(0, Object.keys(project.character.outfits || {}).length - 1);
  // 會先重畫正面（現在的立繪還沒拆成正面）：換了立繪之後，表情都要照新的重畫。
  const redrawsFront = !onlyFaces && Boolean(project.character.adopted.character) && !(project.views?.status === 'done' && project.views.assetId === project.character.adopted.character);
  // 表情集要畫幾個：還沒畫的加上舊設計的（都畫好了的話，勾著也不會再畫）。
  const facesToDraw = redrawsFront ? expressionList(project.expressions).length : expressionsToDraw(project).length;
  const steps = onlyFaces ? [] : ['front', ...AUTOPILOT_VIEWS.filter(view => shownViews.includes(view))];
  const assetUrl = id => project.assets.find(asset => asset.id === id)?.url;
  const label = (view, expression, outfitId) => (view === 'expression' ? t('expressions.stepName', { name: expressionName(project, expression) }) : view === 'outfit' ? outfitStepName(project, outfitId) : t(`canvas.views.view.${view}`));
  const faces = shownExpressions ? expressionsState(project, autopilot, onlyFaces) : null;
  const wardrobe = shownOutfits ? outfitsState(project, autopilot) : null;
  // 這一輪只畫了表情集、衣櫃：畫完的說明照畫了什麼寫。
  const extrasText = config => (config?.expressions && config?.outfits ? 'Extras' : config?.outfits ? 'Outfits' : 'Faces');
  const toggle = view => setViews(current => (current.includes(view) ? current.filter(item => item !== view) : [...current, view]));
  const resumable = autopilot && endedStates.has(autopilot.status) && autopilot.status !== 'done';
  // 上一次只畫表情時，「全部畫完」的說明改成到表情集看結果。
  const outcome = autopilot && !running && {
    done: { tone: 'done', text: t((autopilot.facesOnly ?? (autopilot.config?.expressions && !autopilot.config.views?.length)) ? `autopilot.outcome.done${extrasText(autopilot.config)}` : 'autopilot.outcome.done') },
    stopped: { tone: 'muted', text: t('autopilot.outcome.stopped') },
    interrupted: { tone: 'warn', text: t('autopilot.outcome.interrupted') },
    'needs-you': { tone: 'warn', text: autopilot.reason && autopilot.reason !== 'AUTOPILOT_GAVE_UP' ? t(`autopilot.reason.${autopilot.reason}`, { defaultValue: t('autopilot.outcome.paused') }) : t('autopilot.outcome.needsYou', { view: label(autopilot.view || 'front', autopilot.expression, autopilot.outfitId) }) },
    paused: { tone: 'warn', text: autopilot.reason ? t(`autopilot.reason.${autopilot.reason}`, { defaultValue: t('autopilot.outcome.paused') }) : t('autopilot.outcome.paused') },
    failed: { tone: 'warn', text: errorText(autopilot.errorCode, autopilot.error) },
  }[autopilot.status];
  const log = [...(autopilot?.log || [])].reverse().slice(0, 10);

  return <div className="autopilot form-stack">
    <p className="hint">{t(onlyFaces ? `autopilot.intro${extrasText({ expressions: shownExpressions, outfits: shownOutfits })}` : 'autopilot.intro')}</p>
    {!running && redrawsFront && <div className="notice">{t('autopilot.redrawsFront')}</div>}
    <ol className="autopilot-steps" aria-label={t('autopilot.stepsLabel')}>
      {steps.map(view => {
        const step = stepState(project, autopilot, view);
        return <li key={view} className={`autopilot-step is-${step.state}`}>
          <span className="autopilot-thumb">{step.state === 'done' && assetUrl(step.assetId) ? <img src={assetUrl(step.assetId)} alt="" /> : step.state === 'current' ? <CircleNotch size={16} className="spin" /> : null}</span>
          <span className="autopilot-step-copy">
            <b>{label(view)}</b>
            <small>{step.state === 'done' ? <><Check size={12} weight="bold" />{t('autopilot.step.done')}</>
              : step.state === 'current' ? t(`autopilot.phase.${step.phase || 'drawing'}`, { attempt: step.attempt || 1 })
                : t('autopilot.step.pending')}</small>
          </span>
          {step.state === 'current' && step.jobId && <button type="button" className="btn btn-text btn-sm" onClick={() => onOpenJob(step.jobId)}>{t('autopilot.watch')}<ArrowRight size={13} /></button>}
        </li>;
      })}
      {faces && <li className={`autopilot-step is-${faces.state}`}>
        <span className="autopilot-thumb">{faces.state === 'current' ? <CircleNotch size={16} className="spin" /> : faces.assetId && assetUrl(faces.assetId) ? <img src={assetUrl(faces.assetId)} alt="" /> : <Smiley size={18} />}</span>
        <span className="autopilot-step-copy">
          <b>{t('autopilot.step.expressions', { done: faces.drawn, total: faces.total })}</b>
          <small>{faces.state === 'done' ? <><Check size={12} weight="bold" />{t('autopilot.step.done')}</>
            : faces.state === 'current' ? (faces.expression ? t('autopilot.step.expressionPhase', { name: label('expression', faces.expression), phase: t(`autopilot.phase.${faces.phase || 'drawing'}`, { attempt: faces.attempt || 1 }) }) : t(`autopilot.phase.${faces.phase}`))
              : t('autopilot.step.pending')}</small>
        </span>
        {faces.state === 'current' && faces.jobId && <button type="button" className="btn btn-text btn-sm" onClick={() => onOpenJob(faces.jobId)}>{t('autopilot.watch')}<ArrowRight size={13} /></button>}
      </li>}
      {wardrobe && <li className={`autopilot-step is-${wardrobe.state}`}>
        <span className="autopilot-thumb">{wardrobe.state === 'current' ? <CircleNotch size={16} className="spin" /> : wardrobe.assetId && assetUrl(wardrobe.assetId) ? <img src={assetUrl(wardrobe.assetId)} alt="" /> : <TShirt size={18} />}</span>
        <span className="autopilot-step-copy">
          <b>{t('autopilot.step.outfits', { done: wardrobe.drawn, total: wardrobe.total })}</b>
          <small>{wardrobe.state === 'done' ? <><Check size={12} weight="bold" />{t('autopilot.step.done')}</>
            : wardrobe.state === 'current' ? t('autopilot.step.expressionPhase', { name: label('outfit', null, wardrobe.outfitId), phase: t(`autopilot.phase.${wardrobe.phase || 'drawing'}`, { attempt: wardrobe.attempt || 1 }) })
              : t('autopilot.step.pending')}</small>
        </span>
        {wardrobe.state === 'current' && wardrobe.jobId && <button type="button" className="btn btn-text btn-sm" onClick={() => onOpenJob(wardrobe.jobId)}>{t('autopilot.watch')}<ArrowRight size={13} /></button>}
      </li>}
    </ol>

    {outcome && <div className={`autopilot-outcome is-${outcome.tone}`} role="status">{outcome.tone === 'done' ? <Check size={16} weight="bold" /> : <WarningCircle size={16} weight="bold" />}<span className="autopilot-outcome-copy"><span>{outcome.text}</span>
      {autopilot.config?.expressions && onOpenExpressions && <button type="button" className="btn btn-text btn-sm" onClick={onOpenExpressions}>{t('expressions.open')}<ArrowRight size={13} /></button>}
      {autopilot.config?.outfits && onOpenWardrobe && <button type="button" className="btn btn-text btn-sm" onClick={onOpenWardrobe}>{t('autopilot.openWardrobe')}<ArrowRight size={13} /></button>}</span></div>}

    {running
      ? <button type="button" className="btn btn-secondary btn-lg" disabled={busy} onClick={onStop}><Stop size={16} />{t('autopilot.stop')}</button>
      : <>
        <fieldset className="autopilot-field">
          <legend>{t('autopilot.form.views')}</legend>
          <div className="chip-row">
            <span className={`chip is-fixed ${onlyFaces ? 'is-skipped' : ''}`} title={onlyFaces ? t('autopilot.form.facesOnly') : t('autopilot.form.frontAlways')}>{!onlyFaces && <Check size={12} weight="bold" />}{label('front')}</span>
            {AUTOPILOT_VIEWS.map(view => <button key={view} type="button" className="chip" aria-pressed={views.includes(view)} onClick={() => toggle(view)}>{views.includes(view) && <Check size={12} weight="bold" />}{label(view)}</button>)}
          </div>
          {onlyFaces && <small className="hint">{t('autopilot.form.facesOnly')}</small>}
        </fieldset>
        <fieldset className="autopilot-field">
          <legend>{t('autopilot.form.expressions')}</legend>
          <div className="chip-row">
            <button type="button" className="chip" aria-pressed={expressions} onClick={() => setExpressions(value => !value)}>{expressions ? <Check size={12} weight="bold" /> : <Smiley size={13} />}{facesToDraw ? t('autopilot.form.expressionsChip', { count: facesToDraw }) : t('autopilot.form.expressionsDone')}</button>
          </div>
          <small className="hint">{t('autopilot.form.expressionsHint')}</small>
        </fieldset>
        <fieldset className="autopilot-field">
          <legend>{t('autopilot.form.outfits')}</legend>
          <div className="chip-row">
            <button type="button" className="chip" aria-pressed={outfits} onClick={() => setOutfits(value => !value)}>{outfits ? <Check size={12} weight="bold" /> : <TShirt size={13} />}{outfitsLeft ? t('autopilot.form.outfitsChip', { count: outfitsLeft }) : t('autopilot.form.outfitsDone')}</button>
          </div>
          <small className="hint">{t('autopilot.form.outfitsHint')}</small>
        </fieldset>
        <fieldset className="autopilot-field">
          <legend>{t('autopilot.form.variants')}</legend>
          <div className="count-seg" role="group" aria-label={t('autopilot.form.variants')}>
            {variantCounts.map(count => <button key={count} type="button" aria-pressed={variants === count} onClick={() => setVariants(count)}>×{count}</button>)}
          </div>
          <small className="hint">{t('autopilot.form.variantsHint')}</small>
        </fieldset>
        <div className="notice">{t('autopilot.notice')}</div>
        {access && !access.ok && <div className="notice error" role="alert">{errorText(access.code)}</div>}
        <button type="button" className="btn btn-primary btn-lg" disabled={busy || !access?.ok} onClick={() => onStart({ views, variants, expressions, outfits })}>{busy ? <Busy /> : <><Play size={16} weight="fill" />{resumable ? t('autopilot.resume') : t('autopilot.start')}</>}</button>
        {!access && <small className="hint"><Busy>{t('autopilot.checking')}</Busy></small>}
      </>}

    {log.length > 0 && <section className="autopilot-log" aria-label={t('autopilot.logLabel')}>
      <h3>{t('autopilot.logLabel')}</h3>
      <ul>
        {log.map((entry, index) => <li key={`${entry.at}-${index}`}>
          <time dateTime={entry.at}>{formatDate(entry.at, { hour: '2-digit', minute: '2-digit' })}</time>
          <span>{t(`autopilot.log.${entry.code}`, { view: entry.view ? label(entry.view, entry.expression, entry.outfitId) : '', attempt: entry.attempt || 1, reason: entry.reason ? t(`autopilot.waitReason.${entry.reason}`, { defaultValue: '' }) : '', defaultValue: entry.code })}</span>
          {entry.jobId && <button type="button" className="btn btn-text btn-sm" onClick={() => onOpenJob(entry.jobId)}>{t('autopilot.open')}</button>}
        </li>)}
      </ul>
    </section>}
  </div>;
}
