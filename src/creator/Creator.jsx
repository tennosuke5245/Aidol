import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassPlus, Sparkle, UserCircle, PersonSimple, Eye, TShirt, Palette, Backpack, PaintBrushBroad, WarningCircle, LockSimple } from '@phosphor-icons/react';
import { appearanceLines, compileBrief } from '../../shared/prompt-compiler.mjs';
import { canonChanges, canonReferences } from '../../shared/canon.mjs';
import { assetFor } from '../api';
import { getLocale, useT } from '../i18n';
import { diffText, L } from '../lib-i18n';
import { readPreference, writePreference } from '../drafts';
import { DrawRack } from '../DrawRack';
import { figureArt } from '../optionArt';
import { Busy, Modal, PartForm, ReferenceForm } from '../Panels';
import { PersonaPanel } from './PersonaPanel';
import { BodyPanel, FacePanel, HairPanel, OutfitPanel } from './LookPanels';
import { ColorPanel, GearPanel, StylePanel } from './MorePanels';
import { kindLabels, outfitOf, uid } from './helpers';

const hairIcon = L.hairStyles.find(style => style.id === 'layered')?.icon;
function HairGlyph({ size = 24 }) { return <svg width={size} height={size} viewBox="6 8 36 34" aria-hidden="true"><path d={hairIcon} fill="currentColor" opacity=".9" /><circle cx="24" cy="29" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>; }

// 名稱與說明在 creator.categories／creator.hints。
const categories = [
  { id: 'persona', Icon: UserCircle },
  { id: 'body', Icon: PersonSimple },
  { id: 'hair', Icon: HairGlyph },
  { id: 'face', Icon: Eye },
  { id: 'outfit', Icon: TShirt },
  { id: 'color', Icon: Palette },
  { id: 'gear', Icon: Backpack },
  { id: 'style', Icon: PaintBrushBroad },
];

// 捏角色：左邊選分類、右邊挑選項，中間是正式立繪（還沒有時是中性人台）。
export function Creator({ studio, project, outfitId, onOutfit, app, d }) {
  const t = useT();
  const draft = d.draft;
  const [category, setCategoryState] = useState(() => readPreference('category', 'persona'));
  const setCategory = id => { setCategoryState(id); writePreference('category', id); };
  const [note, setNote] = useState('');
  const [variants, setVariantsState] = useState(() => readPreference('variants', 2));
  const setVariants = value => { setVariantsState(value); writePreference('variants', value); };
  // 2026-10-12 起第一張預設畫正面全身，之後在畫布上一張張補畫側面、背面（一張畫三個人容易畫壞）。
  // 已經有正式立繪之後的繪製是另一個偏好（預設「全身」），不會不小心畫成 A 字站姿的正面、把三視圖換掉。
  const hasPortraitNow = Boolean(project.character.adopted?.character);
  const framingKey = hasPortraitNow ? 'framing-more-v3' : 'framing-first-v3';
  const [framingByKey, setFramingByKey] = useState(() => ({ 'framing-first-v3': readPreference('framing-first-v3', 'frontView'), 'framing-more-v3': readPreference('framing-more-v3', 'full') }));
  const framing = framingByKey[framingKey];
  const setFraming = value => { setFramingByKey(current => ({ ...current, [framingKey]: value })); writePreference(framingKey, value); };
  const [modal, setModal] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const outfit = outfitOf(draft, outfitId);
  const portrait = assetFor(project, 'character', outfit?.id);
  const hasPortrait = Boolean(project.character.adopted?.character);
  const pendingProposal = (project.proposals || []).some(item => item.status === 'pending');
  // 定稿：畫圖時設計照定稿；定稿之後才改的外觀設定會列出來，告訴你這次 AI 會照著改哪些地方。
  const canon = canonReferences(draft).length > 0;
  const canonAsset = canon ? project.assets.find(asset => asset.id === canonReferences(draft)[0].assetId) : null;
  const locale = getLocale();
  const canonList = useMemo(() => (canon ? canonChanges(project.history, draft, { outfitId: outfit?.id, tr: diffText }) : []), [canon, project.history, draft, outfit?.id, locale]);

  useEffect(() => { if (outfit && outfit.id !== outfitId) onOutfit(outfit.id); }, [outfit?.id, outfitId]);

  // 立繪畫好之後外觀設定又改過：比對當時交給 AI 的描述與現在的描述。
  const appearanceChanged = useMemo(() => {
    if (!portrait) return false;
    const candidate = project.candidates.find(item => item.assetId === portrait.id);
    const job = candidate && project.jobs.find(item => item.id === candidate.jobId);
    if (!job?.context?.compiled) return false;
    return appearanceLines(compileBrief(draft, { directionId: job.directionId, outfitId: job.outfitId, framing: job.framing }).text) !== appearanceLines(job.context.compiled);
  }, [portrait, project.candidates, project.jobs, draft]);

  async function draw(options = {}) {
    if (drawing) return;
    setDrawing(true);
    try {
      const saved = await d.flush();
      const done = await app.draw({ note, variants, framing, ...options, baseRevision: saved.revision, outfitId: outfit?.id });
      if (done && !options.targetId) setNote('');
      return done;
    } finally { setDrawing(false); }
  }

  function saveGear(value) {
    const isNew = !modal.part;
    d.edit(next => {
      if (isNew) {
        const id = uid('part');
        next.components[id] = { id, name: value.name.trim(), kind: value.kind, description: value.description || '', designStatus: 'draft' };
        outfitOf(next, outfitId)?.equipped.push({ id: uid('wear'), componentId: id, anchor: value.anchor || kindLabels[value.kind] || t('creator.gear.defaultAnchor'), enabled: true });
      } else {
        const part = next.components[modal.part.id];
        part.name = value.name.trim() || part.name; part.description = value.description || '';
      }
    }, { area: 'outfit' });
    setModal(null);
  }

  async function addReference(file, role, focus, canon = false) {
    const asset = await studio.run(() => studio.uploadReference(file));
    if (!asset) return;
    d.edit(next => { next.style.references.push({ id: uid('ref'), assetId: asset.id, role, focus, ...(canon ? { canon: true } : {}) }); }, { area: 'style' });
    setModal(null);
  }

  const panelProps = { draft, edit: d.edit, project, outfitId: outfit?.id, onOutfit, hasPortrait };
  const current = categories.find(item => item.id === category) || categories[0];
  const currentLabel = t(`creator.categories.${current.id}`);
  const panel = {
    persona: <PersonaPanel {...panelProps} asking={app.chatPending} onAsk={async (text, options) => { if (options?.readCanon) await d.flush(); return app.sendChat(text, options); }} onApply={async (id, options) => { const saved = await d.flush(); await app.applyProposal(id, { ...options, baseRevision: saved.revision }); }} onDismiss={app.dismissProposal} />,
    body: <BodyPanel {...panelProps} />,
    hair: <HairPanel {...panelProps} />,
    face: <FacePanel {...panelProps} />,
    outfit: <OutfitPanel {...panelProps} onGoColors={() => setCategory('color')} />,
    color: <ColorPanel {...panelProps} />,
    gear: <GearPanel {...panelProps} onEditPart={part => setModal({ type: 'gear', part })} onDrawPart={part => setModal({ type: 'draw-part', part })} onPreview={app.preview} />,
    style: <StylePanel {...panelProps} onAddReference={() => setModal({ type: 'reference' })} onPreview={app.preview} />,
  }[current.id];

  return <div className="creator">
    <nav className="rail" aria-label={t('creator.rail')}>
      {categories.map(item => <button type="button" key={item.id} className="rail-item" aria-pressed={item.id === current.id} onClick={() => setCategory(item.id)}>
        <span className="rail-icon"><item.Icon size={22} weight={item.id === current.id ? 'fill' : 'regular'} /></span>
        <span className="rail-label">{t(`creator.categories.${item.id}`)}</span>
        {item.id === 'persona' && pendingProposal && <span className="rail-badge" aria-label={t('creator.persona.aiReady')} />}
      </button>)}
    </nav>

    <main className="stage" aria-label={t('creator.stage.label')}>
      <div className="stage-figure">
        {portrait ? <button type="button" className="stage-portrait" onClick={() => app.preview(portrait, t('creator.stage.previewTitle', { name: draft.name }))} aria-label={t('creator.stage.zoom')}>
          <img src={portrait.url} alt={t('creator.stage.portraitAlt', { name: draft.name })} />
          <span className="stage-zoom"><MagnifyingGlassPlus size={17} /></span>
        </button> : canonAsset ? <button type="button" className="stage-portrait is-canon" onClick={() => app.preview(canonAsset, t('creator.style.canon'))} aria-label={t('creator.stage.zoom')}>
          <img src={canonAsset.url} alt={t('creator.stage.canonAlt', { name: draft.name })} />
          <span className="stage-zoom"><MagnifyingGlassPlus size={17} /></span>
        </button> : <div className="stage-placeholder">{figureArt && <img src={figureArt} alt="" />}</div>}
        <p className="stage-caption">{portrait
          ? appearanceChanged ? <><WarningCircle size={14} weight="bold" color="var(--gold)" /><b>{t('creator.stage.changedTitle')}</b>{t('creator.stage.changedHint')}</> : <><b>{t('creator.stage.portraitTitle')}</b>{t('creator.stage.portraitHint')}</>
          : canonAsset ? <><LockSimple size={14} weight="fill" /><b>{t('creator.stage.canonTitle')}</b>{t('creator.stage.canonHint')}</> : <><b>{t('creator.stage.emptyTitle')}</b>{t('creator.stage.emptyHint')}</>}</p>
      </div>

      <DrawRack project={project} onOpen={app.openSummon} />

      <form className="drawbar" onSubmit={event => { event.preventDefault(); draw(); }}>
        {!canon && !hasPortrait && ['frontView', 'turnaround'].includes(framing) && <div className="drawbar-canon" role="note"><span className="canon-note is-plain">{t(framing === 'frontView' ? 'creator.draw.frontNote' : 'creator.draw.turnaroundNote')}</span></div>}
        {canon && <div className="drawbar-canon" role="note">
          <span className="canon-note"><LockSimple size={14} weight="fill" aria-hidden="true" />{t('creator.draw.canon')}</span>
          {canonList.length > 0 && <span className="canon-changes"><b>{t('creator.draw.canonChanges')}</b>{canonList.slice(0, 3).map((change, index) => { const text = t('creator.draw.canonChange', { label: change.label, from: change.from, to: change.to }); return <span key={index} className="canon-chip" title={text}>{text}</span>; })}{canonList.length > 3 && <span className="canon-chip">{t('creator.draw.canonMore', { count: canonList.length - 3 })}</span>}</span>}
        </div>}
        <input className="drawbar-note" value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder={framing === 'frontView' ? t('creator.draw.notePlaceholderFront') : hasPortrait ? t('creator.draw.notePlaceholder') : t('creator.draw.notePlaceholderFirst')} aria-label={t('creator.draw.noteLabel')} />
        <div className="drawbar-row">
          <label className="drawbar-select"><span className="sr-only">{t('creator.draw.framing')}</span><select value={framing} onChange={event => setFraming(event.target.value)}>{L.framings.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <div className="count-seg" role="group" aria-label={t('creator.draw.count')}>{L.variantCounts.map(count => <button type="button" key={count} aria-pressed={variants === count} onClick={() => setVariants(count)}>×{count}</button>)}</div>
          <button type="submit" className="draw-btn" disabled={drawing}>{drawing ? <Busy>{t('creator.draw.preparing')}</Busy> : <><Sparkle size={17} weight="fill" />{hasPortrait ? t('creator.draw.start') : framing === 'frontView' ? t('creator.draw.firstFront') : framing === 'turnaround' ? t('creator.draw.firstTurnaround') : t('creator.draw.first')}</>}</button>
        </div>
      </form>
    </main>

    <aside className="panel" aria-label={currentLabel}>
      <header className="panel-head"><h2 className="display">{currentLabel}</h2><p>{t(`creator.hints.${current.id}`)}</p></header>
      <div className="panel-body" key={current.id}>{panel}</div>
    </aside>

    {modal?.type === 'gear' && <Modal title={modal.part ? t('creator.gear.edit', { name: modal.part.name }) : t('creator.gear.add')} subtitle={modal.part ? null : t('creator.gear.addSubtitle')} onClose={() => setModal(null)}>
      <PartForm part={modal.part} onSave={saveGear} />
    </Modal>}
    {modal?.type === 'reference' && <Modal title={t('creator.reference.add')} subtitle={t('creator.reference.addSubtitle')} onClose={() => setModal(null)}>
      <ReferenceForm busy={studio.busy} onUpload={addReference} />
    </Modal>}
    {modal?.type === 'draw-part' && <DrawPartModal part={modal.part} portraitId={portrait?.id} busy={drawing} onClose={() => setModal(null)} onDraw={async options => { const done = await draw({ ...options, targetId: modal.part.id }); if (done) setModal(null); }} />}
  </div>;
}

function DrawPartModal({ part, portraitId, busy, onClose, onDraw }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [view, setView] = useState('front');
  const [count, setCount] = useState(1);
  // 拆解時記下的位置框：照著目前的立繪畫時，告訴 AI 這件在圖上的哪裡。
  const region = part.crop && part.crop.assetId === portraitId ? { x: part.crop.x, y: part.crop.y, width: part.crop.width, height: part.crop.height } : undefined;
  return <Modal title={t('creator.drawPart.title', { name: part.name })} subtitle={t('creator.drawPart.subtitle')} onClose={onClose}>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); onDraw({ note, view, variants: count, region }); }}>
      <label className="field"><span>{t('creator.drawPart.note')}</span><textarea rows={3} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder={part.description || t('creator.drawPart.notePlaceholder')} /></label>
      <div className="field"><span>{t('creator.drawPart.view')}</span><div className="tabs" role="group">{[['front', t('creator.drawPart.views.front')], ['back', t('creator.drawPart.views.back')], ['detail', t('creator.drawPart.views.detail')]].map(([id, label]) => <button type="button" key={id} aria-selected={view === id} onClick={() => setView(id)}>{label}</button>)}</div></div>
      <div className="field"><span>{t('creator.drawPart.count')}</span><div className="count-seg" role="group">{L.variantCounts.map(value => <button type="button" key={value} aria-pressed={count === value} onClick={() => setCount(value)}>×{value}</button>)}</div></div>
      <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? <Busy>{t('creator.draw.preparing')}</Busy> : <><Sparkle size={16} weight="fill" />{t('creator.draw.start')}</>}</button>
    </form>
  </Modal>;
}
