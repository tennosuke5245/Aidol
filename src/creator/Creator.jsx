import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassPlus, Sparkle, UserCircle, PersonSimple, Eye, TShirt, Palette, Backpack, PaintBrushBroad, WarningCircle } from '@phosphor-icons/react';
import * as L from '../../shared/libraries.mjs';
import { appearanceLines, compileBrief } from '../../shared/prompt-compiler.mjs';
import { assetFor } from '../api';
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

const categories = [
  { id: 'persona', label: '角色', Icon: UserCircle, hint: '名字、個性和故事。不知道怎麼寫，就交給 AI。' },
  { id: 'body', label: '身形', Icon: PersonSimple, hint: '年齡、頭身和體型。' },
  { id: 'hair', label: '髮型', Icon: HairGlyph, hint: '點一下就換上，顏色在下面。' },
  { id: 'face', label: '五官', Icon: Eye, hint: '神情、眼型、眉毛和眼睛的顏色。' },
  { id: 'outfit', label: '服裝', Icon: TShirt, hint: '選風格，再從角色的色票挑顏色。' },
  { id: 'color', label: '色彩', Icon: Palette, hint: '角色專屬的顏色，服裝與配件都從這裡挑。' },
  { id: 'gear', label: '裝備', Icon: Backpack, hint: '每件裝備可以穿脫，也能單獨畫出設計圖。' },
  { id: 'style', label: '畫風', Icon: PaintBrushBroad, hint: '轉動旋鈕，調整畫面的感覺。' },
];

// 捏角色：左邊選分類、右邊挑選項，中間是正式立繪（還沒有時是中性人台）。
export function Creator({ studio, project, outfitId, onOutfit, app, d }) {
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
        outfitOf(next, outfitId)?.equipped.push({ id: uid('wear'), componentId: id, anchor: value.anchor || kindLabels[value.kind] || '身上', enabled: true });
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
    <nav className="rail" aria-label="捏角色分類">
      {categories.map(item => <button type="button" key={item.id} className="rail-item" aria-pressed={item.id === current.id} onClick={() => setCategory(item.id)}>
        <span className="rail-icon"><item.Icon size={22} weight={item.id === current.id ? 'fill' : 'regular'} /></span>
        <span className="rail-label">{item.label}</span>
        {item.id === 'persona' && pendingProposal && <span className="rail-badge" aria-label="AI 寫好了" />}
      </button>)}
    </nav>

    <main className="stage" aria-label="角色">
      <div className="stage-figure">
        {portrait ? <button type="button" className="stage-portrait" onClick={() => app.preview(portrait, `${draft.name}・正式立繪`)} aria-label="放大正式立繪">
          <img src={portrait.url} alt={`${draft.name}的正式立繪`} />
          <span className="stage-zoom"><MagnifyingGlassPlus size={17} /></span>
        </button> : <div className="stage-placeholder">{figureArt && <img src={figureArt} alt="" />}</div>}
        <p className="stage-caption">{portrait
          ? appearanceChanged ? <><WarningCircle size={14} weight="bold" color="var(--gold)" /><b>外觀設定在這張立繪之後改過</b>按「開始繪製」用新設定重畫</> : <><b>正式立繪</b>點一下放大；在右邊調整外觀後，按「開始繪製」畫新的一張</>
          : <><b>還沒有正式立繪</b>先在右邊挑外觀，再按「畫第一張立繪」</>}</p>
      </div>

      <DrawRack project={project} onOpen={app.openSummon} />

      <form className="drawbar" onSubmit={event => { event.preventDefault(); draw(); }}>
        <input className="drawbar-note" value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder={hasPortrait ? '這次想畫什麼？例如：帥氣的站姿、拿著信件（可不填）' : '想要的感覺？例如：站在雨中的城市（可不填）'} aria-label="這次想畫什麼" />
        <div className="drawbar-row">
          <label className="drawbar-select"><span className="sr-only">取景</span><select value={framing} onChange={event => setFraming(event.target.value)}>{L.framings.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <div className="count-seg" role="group" aria-label="一次畫幾張">{L.variantCounts.map(count => <button type="button" key={count} aria-pressed={variants === count} onClick={() => setVariants(count)}>×{count}</button>)}</div>
          <button type="submit" className="draw-btn" disabled={drawing}>{drawing ? <Busy>準備中…</Busy> : <><Sparkle size={17} weight="fill" />{hasPortrait ? '開始繪製' : '畫第一張立繪'}</>}</button>
        </div>
      </form>
    </main>

    <aside className="panel" aria-label={current.label}>
      <header className="panel-head"><h2 className="display">{current.label}</h2><p>{current.hint}</p></header>
      <div className="panel-body" key={current.id}>{panel}</div>
    </aside>

    {modal?.type === 'gear' && <Modal title={modal.part ? `編輯「${modal.part.name}」` : '新增裝備'} subtitle={modal.part ? null : '先寫下名字和樣子，之後可以單獨畫出設計圖。'} onClose={() => setModal(null)}>
      <PartForm part={modal.part} onSave={saveGear} />
    </Modal>}
    {modal?.type === 'reference' && <Modal title="加入參考圖" subtitle="說明要參考它的哪裡，之後繪製都會帶上。" onClose={() => setModal(null)}>
      <ReferenceForm busy={studio.busy} onUpload={addReference} />
    </Modal>}
    {modal?.type === 'draw-part' && <DrawPartModal part={modal.part} portraitId={portrait?.id} busy={drawing} onClose={() => setModal(null)} onDraw={async options => { const done = await draw({ ...options, targetId: modal.part.id }); if (done) setModal(null); }} />}
  </div>;
}

function DrawPartModal({ part, portraitId, busy, onClose, onDraw }) {
  const [note, setNote] = useState('');
  const [view, setView] = useState('front');
  const [count, setCount] = useState(1);
  // 拆解時記下的位置框：照著目前的立繪畫時，告訴 AI 這件在圖上的哪裡。
  const region = part.crop && part.crop.assetId === portraitId ? { x: part.crop.x, y: part.crop.y, width: part.crop.width, height: part.crop.height } : undefined;
  return <Modal title={`繪製「${part.name}」`} subtitle="照著正式立繪，單獨畫出這件裝備的設計圖。" onClose={onClose}>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); onDraw({ note, view, variants: count, region }); }}>
      <label className="field"><span>這次想畫什麼？（可不填）</span><textarea rows={3} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder={part.description || '例如：材質改成黃銅，邊緣磨舊一點'} /></label>
      <div className="field"><span>畫哪一面</span><div className="tabs" role="group">{[['front', '正面'], ['back', '背面'], ['detail', '細節']].map(([id, label]) => <button type="button" key={id} aria-selected={view === id} onClick={() => setView(id)}>{label}</button>)}</div></div>
      <div className="field"><span>張數</span><div className="count-seg" role="group">{L.variantCounts.map(value => <button type="button" key={value} aria-pressed={count === value} onClick={() => setCount(value)}>×{value}</button>)}</div></div>
      <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? <Busy>準備中…</Busy> : <><Sparkle size={16} weight="fill" />開始繪製</>}</button>
    </form>
  </Modal>;
}
