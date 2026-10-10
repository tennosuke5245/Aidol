import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassPlus, Sparkle, UserCircle, PersonSimple, Eye, TShirt, Palette, Backpack, PaintBrushBroad, WarningCircle } from '@phosphor-icons/react';
import { appearanceLines, compileBrief } from '../../shared/prompt-compiler.mjs';
import { assetFor } from '../api';
import { useT } from '../i18n';
import { L } from '../lib-i18n';
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
  const [framing, setFramingState] = useState(() => readPreference('framing', 'sheet'));
  const setFraming = value => { setFramingState(value); writePreference('framing', value); };
  const [modal, setModal] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const outfit = outfitOf(draft, outfitId);
  const portrait = assetFor(project, 'character', outfit?.id);
  const hasPortrait = Boolean(project.character.adopted?.character);
  const pendingProposal = (project.proposals || []).some(item => item.status === 'pending');

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

  async function addReference(file, role, focus) {
    const asset = await studio.run(() => studio.uploadReference(file));
    if (!asset) return;
    d.edit(next => { next.style.references.push({ id: uid('ref'), assetId: asset.id, role, focus }); }, { area: 'style' });
    setModal(null);
  }

  const panelProps = { draft, edit: d.edit, project, outfitId: outfit?.id, onOutfit, hasPortrait };
  const current = categories.find(item => item.id === category) || categories[0];
  const currentLabel = t(`creator.categories.${current.id}`);
  const panel = {
    persona: <PersonaPanel {...panelProps} asking={app.chatPending} onAsk={app.sendChat} onApply={async (id, options) => { const saved = await d.flush(); await app.applyProposal(id, { ...options, baseRevision: saved.revision }); }} onDismiss={app.dismissProposal} />,
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
        </button> : <div className="stage-placeholder">{figureArt && <img src={figureArt} alt="" />}</div>}
        <p className="stage-caption">{portrait
          ? appearanceChanged ? <><WarningCircle size={14} weight="bold" color="var(--gold)" /><b>{t('creator.stage.changedTitle')}</b>{t('creator.stage.changedHint')}</> : <><b>{t('creator.stage.portraitTitle')}</b>{t('creator.stage.portraitHint')}</>
          : <><b>{t('creator.stage.emptyTitle')}</b>{t('creator.stage.emptyHint')}</>}</p>
      </div>

      <DrawRack project={project} onOpen={app.openSummon} />

      <form className="drawbar" onSubmit={event => { event.preventDefault(); draw(); }}>
        <input className="drawbar-note" value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder={hasPortrait ? t('creator.draw.notePlaceholder') : t('creator.draw.notePlaceholderFirst')} aria-label={t('creator.draw.noteLabel')} />
        <div className="drawbar-row">
          <label className="drawbar-select"><span className="sr-only">{t('creator.draw.framing')}</span><select value={framing} onChange={event => setFraming(event.target.value)}>{L.framings.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <div className="count-seg" role="group" aria-label={t('creator.draw.count')}>{L.variantCounts.map(count => <button type="button" key={count} aria-pressed={variants === count} onClick={() => setVariants(count)}>×{count}</button>)}</div>
          <button type="submit" className="draw-btn" disabled={drawing}>{drawing ? <Busy>{t('creator.draw.preparing')}</Busy> : <><Sparkle size={17} weight="fill" />{hasPortrait ? t('creator.draw.start') : t('creator.draw.first')}</>}</button>
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
