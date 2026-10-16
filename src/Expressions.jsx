import { useState } from 'react';
import { ArrowClockwise, ArrowRight, CircleNotch, DownloadSimple, PaintBrush, Plus, Robot, Smiley, WarningCircle, X } from '@phosphor-icons/react';
import { t, useT } from './i18n';
import { L } from './lib-i18n';
import { Busy } from './Panels';
import { readPreference, writePreference } from './drafts';
import { expressionFront, expressionInfo, expressionList, expressionStale, EXPRESSION_LIMIT } from '../shared/expressions.mjs';

// 表情集（2026-10-13 起）：照正式立繪的正面一個一個畫胸像表情，採用只放進表情集（不換正式立繪、不進版本）。
// 每格可以畫、重畫、看正在畫的那一批；「一般」先畫，決定取景。全部畫完交給全自動（Design QA 挑圖）。

// 拿掉的自訂表情查不到名稱：顯示「已拿掉」（全自動的經過、圖鑑裡會用到）。
export const expressionName = (project, key) => expressionInfo(project?.expressions, key, L)?.label || t('expressions.removedName');

// 這個表情最新的一批工作（還沒結束的）：繪製中、等你挑、或失敗。
function latestJob(project, key) {
  return [...project.jobs].reverse().find(job => job.outputView === 'expression' && job.expression === key) || null;
}
function stateOf(project, key) {
  const item = project.expressions?.items?.[key];
  const job = latestJob(project, key);
  const asset = item && project.assets.find(entry => entry.id === item.assetId);
  const drawing = job && (['running', 'handed_off'].includes(job.status) || (job.progress?.startedAt && !job.progress?.finishedAt));
  const pending = job && job.status === 'review' && project.candidates.some(candidate => candidate.jobId === job.id && candidate.status === 'pending') && !project.candidates.some(candidate => candidate.jobId === job.id && candidate.status === 'accepted');
  const failed = job && job.status === 'failed';
  return { asset, job, drawing, pending: pending && !drawing, failed: failed && !drawing, stale: expressionStale(project, key) };
}

// 把畫好的表情排成一張圖（附名稱）下載。圖是本機核心給的同源圖。
async function exportSheet(title, entries, fileName) {
  const images = await Promise.all(entries.map(async entry => { const image = new Image(); image.src = entry.url; await image.decode(); return { ...entry, image }; }));
  await document.fonts?.ready;
  const columns = Math.min(4, images.length);
  const rows = Math.ceil(images.length / columns);
  const cell = 360, gap = 24, labelHeight = 54, head = 96;
  const canvas = document.createElement('canvas');
  canvas.width = gap + columns * (cell + gap);
  canvas.height = head + rows * (cell + labelHeight + gap) + gap;
  const context = canvas.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  const uiFont = style.getPropertyValue('--font-ui').trim() || 'sans-serif';
  const displayFont = style.getPropertyValue('--font-display').trim() || 'serif';
  context.fillStyle = '#FBFAF7';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#2B2A33';
  context.font = `700 34px ${displayFont}`;
  context.textBaseline = 'middle';
  context.fillText(title, gap, head / 2 + 4);
  images.forEach(({ image, label }, index) => {
    const x = gap + (index % columns) * (cell + gap);
    const y = head + Math.floor(index / columns) * (cell + labelHeight + gap);
    context.fillStyle = '#ECEAE6';
    context.fillRect(x, y, cell, cell);
    const scale = Math.min(cell / image.naturalWidth, cell / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, x + (cell - width) / 2, y + (cell - height) / 2, width, height);
    context.fillStyle = '#2B2A33';
    context.font = `600 24px ${uiFont}`;
    context.textAlign = 'center';
    context.fillText(label, x + cell / 2, y + cell + labelHeight / 2 + 2, cell);
    context.textAlign = 'start';
  });
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function AddExpression({ project, busy, onAdd }) {
  const t = useT();
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const list = expressionList(project.expressions);
  const full = list.length >= EXPRESSION_LIMIT;
  const presets = L.expressionPresets.filter(preset => !list.includes(preset.id));
  return <section className="expr-add" aria-label={t('expressions.add')}>
    <h3>{t('expressions.add')}</h3>
    {full ? <p className="hint">{t('expressions.limit')}</p> : <>
      <div className="chip-row">
        {presets.map(preset => <button type="button" key={preset.id} className="chip" disabled={busy} onClick={() => onAdd({ preset: preset.id })}><Plus size={12} />{preset.label}</button>)}
        <button type="button" className="chip" aria-expanded={custom} onClick={() => setCustom(value => !value)}><Plus size={12} />{t('expressions.custom')}</button>
      </div>
      {custom && <form className="expr-custom" onSubmit={async event => { event.preventDefault(); if (!name.trim()) return; const done = await onAdd({ name: name.trim(), note: note.trim() }); if (done) { setName(''); setNote(''); setCustom(false); } }}>
        <label className="field"><span>{t('expressions.customName')}</span><input value={name} maxLength={40} placeholder={t('expressions.customNamePlaceholder')} onChange={event => setName(event.target.value)} /></label>
        <label className="field"><span>{t('expressions.customNote')}</span><input value={note} maxLength={300} placeholder={t('expressions.customNotePlaceholder')} onChange={event => setNote(event.target.value)} /></label>
        <button type="submit" className="btn btn-secondary" disabled={busy || !name.trim()}>{t('expressions.customAdd')}</button>
      </form>}
    </>}
  </section>;
}

export function ExpressionPanel({ project, busy, canAuto, onDraw, onAdd, onRemove, onOpenJob, onPreview, onAutopilot }) {
  const t = useT();
  // 一次畫幾張：記在這台電腦（從翻牌畫面回來時不會變回預設）。
  const [variants, setVariantsState] = useState(() => { const saved = readPreference('expression-variants', 2); return L.variantCounts.includes(saved) ? saved : 2; });
  const setVariants = count => { setVariantsState(count); writePreference('expression-variants', count); };
  const [redoing, setRedoing] = useState(null);
  const [note, setNote] = useState('');
  const [exporting, setExporting] = useState(false);
  const list = expressionList(project.expressions);
  const hasFront = Boolean(expressionFront(project));
  const states = Object.fromEntries(list.map(key => [key, stateOf(project, key)]));
  const done = list.filter(key => states[key].asset);
  // 要畫的：還沒畫的，加上照舊立繪畫的（舊設計）；全自動會照新的立繪一起畫好。
  const toDraw = list.filter(key => !states[key].asset || states[key].stale);
  const missing = list.length - done.length;
  const first = list.includes('neutral') && (!states.neutral?.asset || states.neutral.stale) ? 'neutral' : null;
  const running = project.autopilot?.status === 'running';
  const draw = (key, redoNote = '') => onDraw({ expression: key, variants, note: redoNote });

  async function exportImage() {
    setExporting(true);
    try {
      await exportSheet(t('expressions.sheetTitle', { name: project.character.name }), done.map(key => ({ label: expressionName(project, key), url: states[key].asset.url })), t('expressions.exportName', { name: project.character.name.replace(/[\\/:*?"<>|]/g, '_') }));
    } finally { setExporting(false); }
  }

  return <div className="expr form-stack">
    <p className="hint">{t('expressions.intro')}</p>
    {!hasFront && <div className="notice">{t('expressions.needFront')}</div>}
    <div className="expr-toolbar">
      <span className="expr-progress">{t('expressions.progress', { done: done.length, total: list.length })}</span>
      <div className="count-seg" role="group" aria-label={t('expressions.variants')} title={t('expressions.variants')}>
        {L.variantCounts.map(count => <button key={count} type="button" aria-pressed={variants === count} onClick={() => setVariants(count)}>×{count}</button>)}
      </div>
    </div>
    <ul className="expr-grid" aria-label={t('expressions.title')}>
      {list.map(key => {
        const name = expressionName(project, key);
        const info = expressionInfo(project.expressions, key, L);
        const state = states[key];
        return <li key={key} className={`expr-card ${state.asset ? 'is-done' : ''} ${state.drawing ? 'is-drawing' : ''}`}>
          <div className="expr-art">
            {state.asset ? <button type="button" className="expr-img" onClick={() => onPreview(state.asset, t('expressions.previewTitle', { name }))} aria-label={t('expressions.zoom', { name })}><img src={state.asset.url} alt={t('expressions.alt', { name })} /></button>
              : <span className="expr-empty" aria-hidden="true">{state.drawing ? <CircleNotch size={26} className="spin" /> : <Smiley size={30} weight="light" />}</span>}
            <button type="button" className="icon-btn expr-remove" disabled={busy} aria-label={t('expressions.remove', { name })} title={t('expressions.remove', { name })} onClick={() => onRemove(key)}><X size={13} weight="bold" /></button>
            {state.stale && <span className="expr-flag" title={t('expressions.staleHint')}><WarningCircle size={12} weight="bold" />{t('expressions.stale')}</span>}
          </div>
          <div className="expr-copy">
            <b title={info?.custom && info.note ? info.note : undefined}>{name}</b>
            {key === first && !state.drawing && <small>{t('expressions.first')}</small>}
          </div>
          <div className="expr-actions">
            {state.drawing ? <button type="button" className="btn btn-text btn-sm" onClick={() => onOpenJob(state.job.id)}>{t('expressions.drawing')}<ArrowRight size={13} /></button>
              : state.pending ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenJob(state.job.id)}>{t('expressions.pick')}</button>
                : state.asset ? <button type="button" className="btn btn-quiet btn-sm" disabled={busy || !hasFront || running} aria-expanded={redoing === key} onClick={() => { setRedoing(current => (current === key ? null : key)); setNote(''); }}><ArrowClockwise size={14} />{t('expressions.redraw')}</button>
                  : <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !hasFront || running} onClick={() => draw(key)}><PaintBrush size={14} />{state.failed ? t('expressions.again') : t('expressions.draw')}</button>}
          </div>
          {redoing === key && <form className="expr-redo" onSubmit={event => { event.preventDefault(); setRedoing(null); draw(key, note.trim()); }}>
            <input value={note} maxLength={500} autoFocus placeholder={t('expressions.redrawNote')} aria-label={t('expressions.redrawNote')} onChange={event => setNote(event.target.value)} />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>{t('expressions.redrawGo')}</button>
          </form>}
        </li>;
      })}
    </ul>
    <AddExpression project={project} busy={busy} onAdd={onAdd} />
    <div className="expr-foot">
      {toDraw.length > 0 && <>
        <button type="button" className="btn btn-primary btn-lg" disabled={busy || !hasFront || running || !canAuto} onClick={() => onAutopilot(variants)}><Robot size={17} />{t(missing ? 'expressions.all' : 'expressions.refreshAll', { count: toDraw.length })}</button>
        <small className="hint">{!canAuto ? t('expressions.allNeedsDirect') : toDraw.length > missing ? t('expressions.allHintStale') : t('expressions.allHint')}</small>
      </>}
      {done.length > 0 && <button type="button" className="btn btn-secondary" disabled={exporting} onClick={exportImage}>{exporting ? <Busy /> : <><DownloadSimple size={16} />{t('expressions.export')}</>}</button>}
    </div>
  </div>;
}
