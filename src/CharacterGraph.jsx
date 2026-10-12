import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, BaseEdge, EdgeLabelRenderer, Handle, Position, useReactFlow, useUpdateNodeInternals, ReactFlowProvider, applyNodeChanges } from '@xyflow/react';
import { Plus, Minus, CornersOut, Sparkle, EyeSlash, Crosshair, Cursor, Hand, Note, TextT, Image, CircleNotch, ArrowClockwise, Check, Clock, CircleDashed, MagnifyingGlassPlus, WarningCircle, Scissors, LockSimple, TShirt, Sneaker, Diamond, Sword, PersonSimple, Package, Crop, UsersThree, PaintBrush, PushPin, Columns, X } from '@phosphor-icons/react';
import { workspaceSummary } from '../shared/agent-workspace.mjs';
import { canonReferences } from '../shared/canon.mjs';
import { allViews, extraViews, turnaroundViews } from '../shared/domain.mjs';
import { heightDrift } from '../shared/turnaround.mjs';
import { assetFor, errorText } from './api';
import { CanvasAnnotationNode, CanvasFormalReferenceNode } from './CanvasAnnotationNodes';
import { mergeGraphNodes } from './canvas-node-state.mjs';
import { characterNodeSize, columnX, containBox, cropInFrame, layoutPorts, partNodeSize, placeParts, portraitBox, viewAddSize, viewNodeSize, viewPosition, viewRowOrigin, viewRowRect, viewRowWidth, viewSlotPosition, viewSlotSize } from './canvas-layout.mjs';
import { CropThumb } from './CropThumb';
import { getLocale, t, useT } from './i18n';
import '@xyflow/react/dist/style.css';

const statusIcons = { success: Check, amber: Sparkle, blue: Clock, neutral: CircleDashed, error: WarningCircle };
const kindIcons = { garment: TShirt, footwear: Sneaker, accessory: Diamond, weapon: Sword, hair: Sparkle, body: PersonSimple, other: Package };
export const kindNames = () => ({ garment: t('canvas.kind.garment'), footwear: t('canvas.kind.footwear'), accessory: t('canvas.kind.accessory'), weapon: t('canvas.kind.weapon'), hair: t('canvas.kind.hair'), body: t('canvas.kind.body'), other: t('canvas.kind.other') });
// 名稱、特徵等並列時的分隔符號（繁中、日文用「・」）。
const joinDot = items => items.filter(Boolean).join(t('canvas.separator'));

function NodeStatus({ status }) {
  const Icon = status.unworn ? EyeSlash : statusIcons[status.tone] || CircleDashed;
  return <span className={`node-status tone-${status.tone}`}><Icon size={12} weight="bold" className={status.running ? 'spin-slow' : ''} />{status.label}</span>;
}

// 人物節點：正式立繪（沒有時是預設人形）。點下去進入捏角色。
// 連到裝備的接點在節點的左右邊框上，高度對齊裝備在立繪上的位置；立繪上不放任何圓點。
// 選到一件裝備時，才在立繪上框出它的位置。
const CharacterNode = memo(function CharacterNode({ id, data, selected }) {
  const t = useT();
  const updateNodeInternals = useUpdateNodeInternals();
  const image = useRef(null);
  const [box, setBox] = useState(null);
  const measure = useCallback(() => {
    const element = image.current;
    if (!element || !element.naturalWidth) return;
    const inner = containBox(element.offsetWidth, element.offsetHeight, element.naturalWidth, element.naturalHeight);
    setBox({ x: element.offsetLeft + inner.x, y: element.offsetTop + inner.y, width: inner.width, height: inner.height });
  }, []);
  useEffect(() => { setBox(null); }, [data.asset?.id]);
  const ports = data.ports || [];
  const signature = ports.map(port => `${port.id}:${port.side}:${port.offset}`).join(',');
  useLayoutEffect(() => { updateNodeInternals(id); }, [id, signature, updateNodeInternals]);
  const crop = data.focusCrop;
  const region = crop && box ? { left: box.x + crop.x * box.width, top: box.y + crop.y * box.height, width: crop.width * box.width, height: crop.height * box.height } : null;
  const decomposition = data.decomposition;
  return <article className={`char-node ${selected ? 'is-selected' : ''} ${data.asset ? '' : 'is-empty'}`}>
    <button type="button" className="char-art nodrag" onClick={event => { event.stopPropagation(); data.onOpen(); }} aria-label={t('canvas.graph.character.open', { name: data.name })}>
      {data.asset ? <img ref={image} src={data.asset.url} alt={t('canvas.graph.character.portraitAlt', { name: data.name })} draggable="false" onLoad={measure} />
        : data.canonAsset ? <><img className="char-placeholder is-canon" src={data.canonAsset.url} alt={t('canvas.graph.character.canonAlt', { name: data.name })} draggable="false" /><span className="char-empty"><b>{t('canvas.graph.character.emptyTitle')}</b><small>{t('canvas.graph.character.canonEmptyHint')}</small></span></>
        : <><img className="char-placeholder" src={data.placeholder} alt="" draggable="false" /><span className="char-empty"><b>{t('canvas.graph.character.emptyTitle')}</b><small>{t('canvas.graph.character.emptyHint')}</small></span></>}
      {region && <i className="char-region" style={region} aria-hidden="true" />}
    </button>
    {data.asset && <button type="button" className="char-zoom icon-btn nodrag" aria-label={data.sheet ? t('canvas.graph.character.zoomSheet') : t('canvas.graph.character.zoom')} title={data.sheet ? t('canvas.graph.character.zoomSheet') : t('canvas.graph.character.zoomTitle')} onClick={event => { event.stopPropagation(); if (data.sheet) data.onPreview(data.sheet, t('canvas.graph.character.sheetPreview', { name: data.name })); else data.onPreview(data.asset, t('canvas.graph.character.previewTitle', { name: data.name })); }}><MagnifyingGlassPlus size={17} /></button>}
    <footer className="char-foot">
      <div className="char-id"><h2 className="display" title={data.name}>{data.name}</h2>{data.traits?.length > 0 && <p title={joinDot(data.traits)}>{joinDot(data.traits)}</p>}</div>
      <div className="char-row">
        <div className="char-states">
          {data.status && <NodeStatus status={data.status} />}
          {data.canon && <span className="node-status tone-canon" title={t('canvas.graph.character.canonHint')}><LockSimple size={12} weight="fill" />{t('canvas.graph.character.canon')}</span>}
          {decomposition?.status === 'running' && <span className="node-status tone-blue"><CircleNotch size={12} weight="bold" className="spin" />{t('canvas.graph.decompose.running')}</span>}
          {decomposition?.status === 'failed' && <button type="button" className="node-status tone-error nodrag" title={errorText(decomposition.errorCode || 'DECOMPOSE_FAILED', decomposition.error, decomposition.errorDetail)} onClick={event => { event.stopPropagation(); data.onDecompose(); }}><WarningCircle size={12} weight="bold" />{t('canvas.graph.decompose.failed')}</button>}
        </div>
        <div className="char-actions">
          {data.asset && decomposition?.status !== 'running' && <button type="button" className="btn btn-quiet btn-sm nodrag" title={t('canvas.graph.decompose.hint')} onClick={event => { event.stopPropagation(); data.onDecompose(); }}><Scissors size={14} />{t('canvas.graph.decompose.action')}</button>}
          <button type="button" className="btn btn-primary btn-sm nodrag" onClick={event => { event.stopPropagation(); data.onOpen(); }}>{t('canvas.graph.character.openCreator')}</button>
        </div>
      </div>
    </footer>
    {ports.map(port => <Handle key={port.id} id={`port-${port.id}`} type="source" position={port.side === 'left' ? Position.Left : Position.Right} style={{ top: port.offset }} />)}
    <Handle id="views" type="source" position={Position.Bottom} />
  </article>;
});

// 視角節點（三視圖的正面／側面／背面與加的角度）：排在人物下方一排。點圖打開「並排看」（所有角度並排比對、加標註）。
// 三張的人物高度差太多時，在圖上標出來（比例可能畫跑了）；有標註的角度在角落顯示標註數。
// 還沒有的角度放空位：照正面「畫X」；沒有正面（裁切時拿掉了、或 AI 只找到側面背面）就給「調整裁切」把正面框回來，因為其他角度都要照正面畫。
// 加的角度（斜前方、斜後方、另一側）還沒畫時可以直接拿掉；畫好的要到「並排看」裡拿掉（會再確認一次）。基本三個角度不行。
const ViewNode = memo(function ViewNode({ data }) {
  const t = useT();
  const label = t(`canvas.views.view.${data.view}`);
  const stop = action => event => { event.stopPropagation(); action(); };
  const remove = data.extra && <button type="button" className="icon-btn view-adjust nodrag" aria-label={t('canvas.views.remove', { view: label })} title={t('canvas.views.remove', { view: label })} onClick={stop(() => data.onRemove(data.view))}><X size={16} /></button>;
  return <article className={`view-node is-${data.state}${data.extra ? ' is-extra' : ''}`}>
    <Handle id="top" type="target" position={Position.Top} />
    {data.asset ? <button type="button" className="view-art nodrag" aria-label={t('canvas.views.open', { view: label })} onClick={stop(() => data.onOpen(data.view))}>
      <img src={data.asset.url} alt={t('canvas.views.alt', { name: data.name, view: label })} draggable="false" />
      {data.drift ? <span className="view-flag" title={t('canvas.views.driftHint')}><WarningCircle size={12} weight="bold" />{t(data.drift > 0 ? 'canvas.views.driftTaller' : 'canvas.views.driftShorter', { percent: Math.abs(data.drift) })}</span> : null}
      {data.notes ? <span className="view-notes-count" title={t('canvas.views.notesCount', { count: data.notes })}><PushPin size={12} weight="fill" />{data.notes}</span> : null}
      <span className="view-open-hint"><Columns size={13} />{t('canvas.views.openShort')}</span>
    </button> : data.state === 'missing' ? <div className="view-art is-missing">
      <PersonSimple size={28} weight="light" />
      <small>{data.view === 'front' ? t('canvas.views.missingFront') : data.canDraw ? t(data.extra ? `canvas.views.extraHint.${data.view}` : 'canvas.views.missingHint', { view: label }) : t('canvas.views.needFront')}</small>
      {data.view === 'front' ? <button type="button" className="btn btn-secondary btn-sm nodrag" onClick={stop(data.onAdjust)}>{t('canvas.views.adjust')}</button>
        : data.canDraw && <button type="button" className="btn btn-secondary btn-sm nodrag" onClick={stop(() => data.onDraw(data.view))}>{t('canvas.views.draw', { view: label })}</button>}
    </div> : <div className="view-art is-pending" role={data.state === 'error' ? 'alert' : 'status'}>
      {data.state === 'error' ? <><WarningCircle size={22} /><small title={data.error || ''}>{t('canvas.views.splitFailed')}</small><button type="button" className="btn btn-quiet btn-sm nodrag" onClick={stop(data.onAdjust)}>{t('canvas.views.manual')}</button></>
        : <><CircleNotch size={22} className="spin" /><small>{t('canvas.views.splitting')}</small></>}
    </div>}
    <footer className="view-foot">
      <b>{label}</b>
      <span className="view-actions">
        {data.state === 'done' && data.view !== 'front' && <button type="button" className="icon-btn view-adjust nodrag" aria-label={t('canvas.views.redraw', { view: label })} title={t('canvas.views.redrawHint', { view: label })} onClick={stop(() => data.onDraw(data.view))}><PaintBrush size={16} /></button>}
        {data.state === 'done' && data.cropped && <button type="button" className="icon-btn view-adjust nodrag" aria-label={t('canvas.views.adjust')} title={t('canvas.views.adjustHint')} onClick={stop(data.onAdjust)}><Crop size={16} /></button>}
        {data.state !== 'done' && remove}
      </span>
    </footer>
  </article>;
});

// 一排最後的「加角度」：斜前方、斜後方、另一側（左右不一樣的設計，另一側才看得到右邊的東西）。點了先選角度，接著照正面畫。
const ViewsAddNode = memo(function ViewsAddNode({ data }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return <article className={`views-add${open ? ' is-open' : ''}`}>
    <Handle id="top" type="target" position={Position.Top} />
    {open ? <div className="views-add-menu" role="group" aria-label={t('canvas.views.add')}>
      <b>{t('canvas.views.addWhich')}</b>
      {data.options.map(view => <button type="button" key={view} className="views-add-option nodrag" onClick={event => { event.stopPropagation(); setOpen(false); data.onAdd(view); }}>
        <span>{t(`canvas.views.view.${view}`)}</span><small>{t(`canvas.views.extraHint.${view}`)}</small>
      </button>)}
      <button type="button" className="btn btn-quiet btn-sm nodrag" onClick={event => { event.stopPropagation(); setOpen(false); }}>{t('canvas.cancel')}</button>
    </div> : <button type="button" className="views-add-button nodrag" onClick={event => { event.stopPropagation(); setOpen(true); }}>
      <Plus size={22} /><b>{t('canvas.views.add')}</b><small>{t('canvas.views.addHint')}</small>
    </button>}
  </article>;
});

// 還沒拆成三視圖時，人物下方的提示卡：
// 還沒有正式圖（畫正面／匯入三視圖／定稿就是三視圖）、舊角色（拆出三視圖、當正面）、剛採用正在看這張圖（拆裝備時順便看是不是正面或三視圖）、
// 正在找三視圖、只有一個角度（當正面）、沒找到（再試一次）。
// 金色實心按鈕留給人物節點的「捏角色」，這裡用次要按鈕。
const ViewsSlotNode = memo(function ViewsSlotNode({ data }) {
  const t = useT();
  const { state } = data;
  const busyState = state === 'detecting' || state === 'reading';
  const Icon = busyState ? CircleNotch : state === 'failed' ? WarningCircle : UsersThree;
  const actions = {
    empty: [[t('canvas.views.slot.drawFront'), data.onDrawFront], [t('canvas.views.slot.import'), data.onImport]],
    emptyCanon: [[t('canvas.views.slot.drawFront'), data.onDrawFront], [t('canvas.views.slot.useCanon'), data.onUseCanon]],
    offer: [[t('canvas.views.slot.offer'), data.onDetect], [t('canvas.views.slot.asFront'), data.onAsFront]],
    none: [[t('canvas.views.slot.asFront'), data.onAsFront], [t('canvas.views.slot.import'), data.onImport], [t('canvas.views.manual'), data.onAdjust]],
    failed: [[t('canvas.views.slot.retry'), data.onDetect], [t('canvas.views.manual'), data.onAdjust]],
  }[state] || [];
  return <article className={`views-slot is-${state}`} role={busyState ? 'status' : undefined}>
    <Handle id="top" type="target" position={Position.Top} />
    <span className="views-slot-icon"><Icon size={22} className={busyState ? 'spin' : ''} /></span>
    <div className="views-slot-copy">
      <b>{t(`canvas.views.slot.${state}Title`)}</b>
      <small>{state === 'failed' && data.error ? data.error : t(`canvas.views.slot.${state}Hint`)}</small>
      {actions.length > 0 && <div className="views-slot-actions">
        {actions.map(([label, action], index) => <button type="button" key={label} className={`btn ${index ? 'btn-quiet' : 'btn-secondary'} btn-sm nodrag`} disabled={data.busy} onClick={event => { event.stopPropagation(); action(); }}>{label}</button>)}
      </div>}
    </div>
  </article>;
});

// 裝備節點：有設計圖顯示設計圖；還沒畫的顯示從立繪裁出的位置；都沒有時顯示種類圖示。
const PartNode = memo(function PartNode({ data, selected }) {
  const t = useT();
  const Icon = kindIcons[data.kind] || Package;
  return <article className={`part-node ${selected ? 'is-selected' : ''} ${data.proposed ? 'is-proposed' : ''} ${data.disabled ? 'is-off' : ''} ${data.isNew ? 'is-new' : ''}`}>
    <div className="part-art">
      {data.asset ? <img src={data.asset.url} alt={t('canvas.part.designAlt', { name: data.name })} draggable="false" />
        : data.cropUrl ? <CropThumb url={data.cropUrl} crop={data.crop} aspect={partNodeSize.width / 176} alt={t('canvas.part.cropAlt', { name: data.name })} />
          : <span className="part-icon"><Icon size={34} weight="light" /></span>}
      {data.proposed && <span className="part-flag">{data.asset ? '' : data.cropUrl ? t('canvas.part.fromPortrait') : t('canvas.part.draft')}</span>}
    </div>
    <div className="part-caption">
      <b>{data.name}</b>
      <span className="part-sub">{joinDot([data.anchor, kindNames()[data.kind]])}</span>
      <NodeStatus status={data.status} />
    </div>
    <Handle id="left" type="target" position={Position.Left} />
    <Handle id="right" type="target" position={Position.Right} />
  </article>;
});

// 關聯線：每件裝備都用同一種線，從人物節點的邊框水平拉出一小段，再以平滑曲線接到裝備節點面向人物的那一側。
const LinkEdge = memo(function LinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, data = {} }) {
  const [hovered, setHovered] = useState(false);
  const direction = sourcePosition === Position.Left ? -1 : 1;
  const exit = sourceX + direction * 18;
  const pull = Math.max(36, Math.abs(targetX - exit) / 2);
  const path = `M ${sourceX},${sourceY} L ${exit},${sourceY} C ${exit + direction * pull},${sourceY} ${targetX - direction * pull},${targetY} ${targetX},${targetY}`;
  const state = `${data.focused ? ' is-focused' : ''}${data.muted && !data.focused ? ' is-muted' : ''}${hovered ? ' is-hovered' : ''}${data.isNew ? ' is-new' : ''}${data.dashed ? ' is-dashed' : ''}`;
  return <>
    <g className={`link-edge${state}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge id={id} path={path} interactionWidth={16} />
      <circle className="link-port" cx={sourceX} cy={sourceY} r={data.focused ? 3.5 : 2.5} />
    </g>
    {(data.focused || hovered || data.showLabel) && data.label && <EdgeLabelRenderer>
      <span className={`canvas-relationship-label nodrag nopan${data.focused ? ' is-focused' : ''}`} aria-hidden="true" style={{ transform: `translate(-50%, -50%) translate(${(exit + targetX) / 2}px, ${(sourceY + targetY) / 2}px)` }}>{data.label}</span>
    </EdgeLabelRenderer>}
  </>;
});

// 人物到視角節點的線：從人物下緣往下拉的平滑曲線（裝備的線是左右拉出，一眼分得出來）。
const ViewEdge = memo(function ViewEdge({ id, sourceX, sourceY, targetX, targetY, data = {} }) {
  const pull = Math.max(24, Math.abs(targetY - sourceY) / 2);
  const path = `M ${sourceX},${sourceY} C ${sourceX},${sourceY + pull} ${targetX},${targetY - pull} ${targetX},${targetY}`;
  return <g className={`link-edge view-edge${data.dashed ? ' is-dashed' : ''}`}><BaseEdge id={id} path={path} interactionWidth={12} /></g>;
});

const nodeTypes = { character: CharacterNode, part: PartNode, view: ViewNode, viewsAdd: ViewsAddNode, viewsSlot: ViewsSlotNode, annotation: CanvasAnnotationNode, formalReference: CanvasFormalReferenceNode };
const edgeTypes = { link: LinkEdge, view: ViewEdge };
// 找三視圖超過這麼久還沒回來，當成中斷（核心重開過），讓使用者可以再試一次。
const detectStaleMs = 10 * 60 * 1000;
const referenceTitle = role => ({ style: t('canvas.graph.reference.style'), identity: t('canvas.graph.reference.identity'), color: t('canvas.graph.reference.color'), clothing: t('canvas.graph.reference.clothing'), composition: t('canvas.graph.reference.composition'), material: t('canvas.graph.reference.material') })[role] || t('canvas.graph.reference.design');
// 放進畫面時下方多留工具列的高度，人物下方的三視圖不會被工具列蓋住。
const fitPadding = { top: 0.08, left: 0.1, right: 0.1, bottom: '96px' };
const motionDuration = duration => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
const annotationNodeId = id => `annotation:${id}`;
const characterOrigin = { x: 0, y: 0 };
// 正式參考圖預設放在右側裝備欄再外面一欄，避免一開始就和裝備重疊。
const referencePosition = (origin, index) => ({ x: columnX(origin, 'right', 2) + 24 + (index % 2) * 232, y: origin.y + Math.floor(index / 2) * 330 });

function nodeStatus(project, targetId, outfitId, summary, equipped) {
  const part = project.character.components[targetId];
  const asset = assetFor(project, targetId, outfitId);
  const fresh = summary.reviewCandidates.filter(candidate => candidate.targetId === targetId).length;
  const open = summary.attentionJobs.some(job => job.targetId === targetId && ['handed_off', 'prepared', 'queued'].includes(job.status));
  const running = (project.jobs || []).some(job => job.targetId === targetId && job.status === 'running' && (job.outfitId || null) === (outfitId || null));
  const failed = summary.attentionJobs.some(job => job.targetId === targetId && job.status === 'failed');
  const worn = !part || equipped.some(item => item.componentId === targetId && item.enabled);
  if (fresh) return { tone: 'amber', label: t('canvas.status.newImages', { count: fresh }) };
  if (running) return { tone: 'blue', label: t('canvas.status.drawing'), running: true };
  if (failed) return { tone: 'error', label: t('canvas.status.failed') };
  if (open) return { tone: 'blue', label: t('canvas.status.sendInCodex') };
  if (!worn) return { tone: 'neutral', label: t('canvas.status.notWorn'), unworn: true };
  if (project.syncTargets.includes(targetId) && asset) return { tone: 'amber', label: t('canvas.status.changed') };
  if (asset) return { tone: 'success', label: t('canvas.status.adopted') };
  if (targetId === 'character') return null;
  return { tone: 'neutral', label: t('canvas.status.notDrawn') };
}

function GraphCanvas({ project, outfitId, selectedId, onSelect, onOpenCreator, onDecompose, onAdd, onPreview, placeholder, onCreateAnnotation, onUpdateAnnotation, onDeleteAnnotation, onAddCanvasReference, viewSplit, onDetectViews, onDrawFront, onAdjustViews, onDrawView, onImportSheet, onUseCanon, onAsFront, onOpenViews, onAddView, onRemoveView }) {
  const t = useT();
  // 換語言時重建節點與關聯線上的文字。
  const locale = getLocale();
  const flow = useReactFlow();
  const [nodes, setNodes] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState('select');
  const [selectedCanvasId, setSelectedCanvasId] = useState(null);
  const [editRequestedId, setEditRequestedId] = useState(null);
  const [creation, setCreation] = useState(null);
  const [positionDrafts, setPositionDrafts] = useState({});
  const [freshParts, setFreshParts] = useState([]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const canvas = useRef(null);
  const referenceInput = useRef(null);
  const mounted = useRef(true);
  const positionDraftsRef = useRef({});
  const positionQueues = useRef(new Map());
  const requestId = useRef(0);
  const creationOffset = useRef(0);
  const knownParts = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // 每個節點的位置排好就記在本機（v3）：拖一個節點不會讓其他節點重排，離開再回來也一樣。
  const storageKey = `aidol-layout-v3-${project.id}`;
  const readSaved = useCallback(() => { try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; } }, [storageKey]);
  const writeSaved = useCallback(positions => { try { localStorage.setItem(storageKey, JSON.stringify(positions)); } catch {} }, [storageKey]);

  // 剛拆出來的裝備：淡入並畫出關聯線，讓人看到「從角色長出去」。
  const partIds = Object.keys(project.character.components).join('|');
  useEffect(() => {
    const ids = Object.keys(project.character.components);
    if (knownParts.current) {
      const added = ids.filter(item => !knownParts.current.has(item));
      if (added.length) { setFreshParts(added); setTimeout(() => mounted.current && setFreshParts([]), 1600); }
    }
    knownParts.current = new Set(ids);
  }, [partIds]);

  useEffect(() => {
    if (!selectedCanvasId) return;
    const exists = selectedCanvasId.startsWith('annotation:')
      ? (project.canvasAnnotations || []).some(item => annotationNodeId(item.id) === selectedCanvasId)
      : (project.character.style.references || []).some(item => `formal-reference:${item.id}` === selectedCanvasId);
    if (!exists) setSelectedCanvasId(null);
  }, [selectedCanvasId, project.canvasAnnotations, project.character.style.references]);
  const changePositionDraft = useCallback((id, draft) => {
    const next = { ...positionDraftsRef.current };
    if (draft) next[id] = draft; else delete next[id];
    positionDraftsRef.current = next;
    if (mounted.current) setPositionDrafts(next);
  }, []);
  const saveAnnotationPosition = useCallback((id, position) => {
    const sequence = ++requestId.current;
    changePositionDraft(id, { position, sequence, saving: true });
    const previous = positionQueues.current.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => onUpdateAnnotation(id, { position }));
    positionQueues.current.set(id, task);
    task.then(() => {
      if (positionDraftsRef.current[id]?.sequence === sequence) changePositionDraft(id, { position, sequence, saving: false, acknowledged: true });
    }, failure => {
      if (positionDraftsRef.current[id]?.sequence === sequence) changePositionDraft(id, { position, sequence, saving: false, error: failure.message || t('canvas.graph.positionRetry') });
    }).finally(() => { if (positionQueues.current.get(id) === task) positionQueues.current.delete(id); });
  }, [onUpdateAnnotation, changePositionDraft]);
  useEffect(() => {
    for (const annotation of project.canvasAnnotations || []) {
      const draft = positionDraftsRef.current[annotation.id];
      if (draft?.acknowledged && annotation.position.x === draft.position.x && annotation.position.y === draft.position.y) changePositionDraft(annotation.id, null);
    }
  }, [project.canvasAnnotations, positionDrafts, changePositionDraft]);
  useEffect(() => { setSelectedCanvasId(null); }, [selectedId]);

  const portrait = assetFor(project, 'character', outfitId);
  // 三視圖：正式圖拆好之後，人物節點顯示「正面」那張（整張三視圖用放大鈕看），下方一排是三個視角。
  const views = portrait && project.views?.assetId === portrait.id ? project.views : null;
  const viewItems = useMemo(() => (views?.status === 'done' ? views.items || {} : {}), [views]);
  const frontAsset = viewItems.front?.frame ? project.assets.find(asset => asset.id === viewItems.front.assetId) : null;
  const frontFrame = frontAsset ? viewItems.front.frame : null;
  const shown = frontAsset || portrait;
  // 人物節點上那張圖的原始尺寸：用來知道圖在人物節點裡實際佔哪一塊（橫式設定稿上下會留白）。
  const [portraitSize, setPortraitSize] = useState(null);
  useEffect(() => {
    if (!shown?.url) return undefined;
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => { if (!cancelled) setPortraitSize({ id: shown.id, width: probe.naturalWidth, height: probe.naturalHeight }); };
    probe.src = shown.url;
    return () => { cancelled = true; };
  }, [shown?.id, shown?.url]);
  // 三視圖還在拆：人物節點等一下會換成正面那張，新裝備的位置先不記下來，等換好再排。
  const sizeReady = (!shown || portraitSize?.id === shown.id) && views?.status !== 'boxes';
  const imageBox = useMemo(() => shown && portraitSize?.id === shown.id ? portraitBox(portraitSize.width, portraitSize.height) : null, [shown, portraitSize]);
  // 裝備的位置框記在整張正式圖上；人物節點顯示正面那張時，換算到正面圖上。
  const frameKey = frontFrame ? `${frontFrame.x},${frontFrame.y},${frontFrame.width},${frontFrame.height}` : '';
  const cropOf = useCallback(part => {
    if (!part?.crop || !portrait || part.crop.assetId !== portrait.id) return null;
    return frontFrame ? cropInFrame(part.crop, frontFrame) : part.crop;
  }, [portrait, frameKey]);
  // 人物下方那一排有哪些角度：拆好後是基本三個角度＋加的角度（照轉台順序）；拆分中是 AI 找到的那幾個。最後要不要放「加角度」。
  const viewRow = useMemo(() => {
    if (!views || !['done', 'boxes'].includes(views.status)) return null;
    const done = views.status === 'done';
    const list = done ? allViews.filter(view => turnaroundViews.includes(view) || (views.extra || []).includes(view) || viewItems[view]) : (views.boxes || []).map(box => box.view);
    const options = done && viewItems.front ? extraViews.filter(view => !list.includes(view)) : [];
    return { done, list, options, width: viewRowWidth(list.length, options.length > 0) };
  }, [views, viewItems]);
  // 排新裝備時要避開的其他節點（參考圖、便利貼、說明，以及拖過位置的角度那一排）。
  const obstaclesFor = useCallback((saved, origin) => [
    ...(saved['views-row'] && viewRow ? [viewRowRect(saved['views-row'], viewRow.width)] : []),
    ...(project.character.style.references || []).map((reference, index) => ({ ...(saved[`formal-reference:${reference.id}`] || referencePosition(origin, index)), width: 205, height: 300 })),
    ...(project.canvasAnnotations || []).map(annotation => ({ ...annotation.position, width: annotation.kind === 'note' ? 210 : 240, height: annotation.kind === 'reference' ? 450 : annotation.kind === 'text' ? 310 : 270 })),
  ], [project.character.style.references, project.canvasAnnotations, viewRow]);
  // 人物下方的三視圖：拆好（或拆分中）是一排視角節點；還沒拆時是一張提示卡。沒有正式圖就不顯示。
  // 這一排整排一起擺：拖其中一個，放開後整排跟著移過去（位置記在 views-row）；兩側裝備往下壓到時，預設位置往下讓開。
  const viewNodes = useCallback((saved, origin, obstacles) => {
    const draggable = tool !== 'pan';
    if (!portrait) {
      const state = canonReferences(project.character).length ? 'emptyCanon' : 'empty';
      return [{ id: 'views-slot', type: 'viewsSlot', position: saved['views-slot'] || viewSlotPosition(origin), style: { width: viewSlotSize.width }, draggable, selectable: false,
        data: { state, onDrawFront, onImport: onImportSheet, onUseCanon } }];
    }
    if (viewRow) {
      // 拆好之後三個角度都排出來：還沒有的是空格，可以照正面畫（分開畫的第一張只有正面）；加的角度排在轉台順序的位置。
      const { done, list, options, width } = viewRow;
      const drift = heightDrift(viewItems);
      const row = saved['views-row'] || viewRowOrigin(origin, width, obstacles);
      const notes = project.viewNotes || [];
      const nodes = list.map((view, index) => {
        const id = `view:${view}`, item = viewItems[view], position = viewPosition(row, index);
        return { id, type: 'view', position, style: { width: viewNodeSize.width, height: viewNodeSize.height }, draggable, selectable: false,
          data: { view, rowOffset: position.x - row.x, name: project.character.name, asset: item ? project.assets.find(asset => asset.id === item.assetId) : null, state: item ? 'done' : done ? 'missing' : viewSplit?.error ? 'error' : 'splitting', canDraw: Boolean(viewItems.front), cropped: Boolean(item?.crop), extra: extraViews.includes(view), notes: notes.filter(note => note.view === view).length, error: viewSplit?.error, drift: drift[view], onOpen: onOpenViews, onAdjust: onAdjustViews, onDraw: onDrawView, onRemove: onRemoveView } };
      });
      if (options.length) {
        const position = viewPosition(row, list.length);
        nodes.push({ id: 'views-add', type: 'viewsAdd', position, style: { width: viewAddSize.width, height: viewAddSize.height }, draggable, selectable: false, data: { rowOffset: position.x - row.x, options, onAdd: onAddView } });
      }
      return nodes;
    }
    const decomposing = project.decomposition?.status === 'running' && project.decomposition.assetId === portrait.id;
    const stale = views?.status === 'detecting' && Date.now() - Date.parse(views.startedAt) > detectStaleMs;
    // 剛採用、正在拆裝備：AI 順便看這張是正面全身還是三視圖（只有一個正面全身時會直接當正面）。
    const state = views?.status === 'detecting' && !stale ? 'detecting' : !views && decomposing ? 'reading' : views?.status === 'none' ? 'none' : views?.status === 'failed' || stale ? 'failed' : 'offer';
    return [{ id: 'views-slot', type: 'viewsSlot', position: saved['views-slot'] || viewSlotPosition(origin), style: { width: viewSlotSize.width }, draggable, selectable: false,
      data: { state, error: views?.status === 'failed' ? errorText(views.errorCode || 'VIEWS_DETECT_FAILED', views.error) : '', busy: decomposing, onDetect: onDetectViews, onAsFront, onImport: onImportSheet, onAdjust: onAdjustViews } }];
  }, [portrait, views, viewItems, viewRow, project.assets, project.character, project.decomposition, project.viewNotes, viewSplit, tool, onOpenViews, onAdjustViews, onDetectViews, onDrawFront, onDrawView, onAddView, onRemoveView, onImportSheet, onUseCanon, onAsFront]);
  const buildNodes = useCallback(() => {
    const saved = readSaved();
    const character = project.character;
    const equipped = character.outfits[outfitId]?.equipped || [];
    const summary = workspaceSummary(project, outfitId);
    const origin = saved.character || characterOrigin;
    const parts = Object.values(character.components);
    // 只替還沒有位置的裝備找空位；已經有位置的（排過或拖過）一律不動。
    const missing = parts.filter(part => !saved[part.id]);
    const placed = parts.filter(part => saved[part.id]).map(part => ({ id: part.id, ...saved[part.id], crop: cropOf(part) }));
    const auto = missing.length ? placeParts(origin, missing.map(part => ({ id: part.id, kind: part.kind, crop: cropOf(part) })), { placed, obstacles: obstaclesFor(saved, origin), imageBox }) : {};
    const focusId = selectedCanvasId ? null : selectedId;
    const nodes = [
      { id: 'character', type: 'character', position: origin, style: { width: characterNodeSize.width, height: characterNodeSize.height }, selected: false, draggable: tool !== 'pan',
        data: { name: character.name, traits: character.persona.traits, asset: shown, sheet: frontAsset ? portrait : null, placeholder, status: nodeStatus(project, 'character', outfitId, summary, equipped), decomposition: project.decomposition, canon: canonReferences(character).length > 0, canonAsset: portrait ? null : project.assets.find(asset => asset.id === canonReferences(character)[0]?.assetId), focusCrop: focusId ? cropOf(character.components[focusId]) : null, onOpen: onOpenCreator, onPreview, onDecompose } },
      ...parts.map(part => {
        const slot = equipped.find(item => item.componentId === part.id);
        const cropAsset = part.crop && project.assets.find(asset => asset.id === part.crop.assetId);
        return { id: part.id, type: 'part', selected: selectedId === part.id, position: saved[part.id] || auto[part.id], style: { width: partNodeSize.width, height: partNodeSize.height }, draggable: tool !== 'pan',
          data: { name: part.name, kind: part.kind, anchor: slot?.anchor, status: nodeStatus(project, part.id, outfitId, summary, equipped), asset: assetFor(project, part.id), crop: part.crop, cropUrl: cropAsset?.url, proposed: part.designStatus === 'proposed', disabled: !slot?.enabled, isNew: freshParts.includes(part.id) } };
      }),
      ...(character.style.references || []).map((reference, index) => {
        const id = `formal-reference:${reference.id}`;
        return { id, type: 'formalReference', selected: selectedCanvasId === id, position: saved[id] || referencePosition(origin, index), style: { width: 205 }, draggable: tool !== 'pan', data: { asset: project.assets.find(asset => asset.id === reference.assetId), title: reference.canon ? t('canvas.graph.reference.canon') : referenceTitle(reference.role), description: reference.canon ? t('canvas.graph.reference.canonHint') : joinDot(reference.focus), canon: Boolean(reference.canon), onPreview } };
      }),
      ...viewNodes(saved, origin, parts.flatMap(part => { const position = saved[part.id] || auto[part.id]; return position ? [{ ...position, ...partNodeSize }] : []; })),
      ...(project.canvasAnnotations || []).map(annotation => {
        const id = annotationNodeId(annotation.id), draft = positionDrafts[annotation.id];
        return { id, type: 'annotation', selected: selectedCanvasId === id, position: draft?.position || annotation.position, style: { width: annotation.kind === 'note' ? 210 : 240 }, draggable: tool !== 'pan', data: { annotation, asset: annotation.kind === 'reference' ? project.assets.find(asset => asset.id === annotation.assetId) : null, onUpdate: onUpdateAnnotation, onDelete: onDeleteAnnotation, onPreview, editRequested: editRequestedId === id, onEditRequestConsumed: () => setEditRequestedId(current => current === id ? null : current), positionStatus: draft, onRetryPosition: () => saveAnnotationPosition(annotation.id, positionDraftsRef.current[annotation.id]?.position || annotation.position) } };
      }),
    ];
    return { nodes, auto };
  }, [project, outfitId, portrait, shown, frontAsset, selectedId, onOpenCreator, onDecompose, onPreview, placeholder, readSaved, selectedCanvasId, editRequestedId, tool, positionDrafts, onUpdateAnnotation, onDeleteAnnotation, saveAnnotationPosition, freshParts, layoutVersion, cropOf, obstaclesFor, imageBox, viewNodes, locale]);
  useEffect(() => {
    const { nodes: built, auto } = buildNodes();
    // 圖片尺寸確定後才把新排的位置記下來，之後就固定。
    if (sizeReady && Object.keys(auto).length) writeSaved({ ...readSaved(), ...auto });
    const positions = new Map(built.map(node => [node.id, node.position]));
    setNodes(current => mergeGraphNodes(current, built).map(node => node.dragging || node.type === 'annotation' ? node : { ...node, position: positions.get(node.id) }));
  }, [buildNodes, readSaved, writeSaved, sizeReady]);

  // 第一次打開與裝備數量改變時，把整個關係圖放進畫面。
  const fitAll = useCallback(() => flow.fitView({ padding: fitPadding, duration: motionDuration(380), maxZoom: 1 }), [flow]);
  useEffect(() => {
    const timer = setTimeout(fitAll, 160);
    return () => clearTimeout(timer);
  }, [project.id, Object.keys(project.character.components).length, nodes.filter(node => node.type === 'view').length, fitAll]);

  const characterNode = nodes.find(node => node.id === 'character');
  // 接點跟著裝備節點目前的位置走：拖曳時即時換邊、上下順序不交錯。
  const ports = useMemo(() => {
    const parts = Object.values(project.character.components).flatMap(part => {
      const node = nodes.find(item => item.id === part.id);
      return node ? [{ id: part.id, x: node.position.x, y: node.position.y }] : [];
    });
    return layoutPorts(characterNode?.position || characterOrigin, parts);
  }, [nodes, project.character.components, characterNode?.position]);
  const portList = useMemo(() => Object.entries(ports).map(([id, port]) => ({ id, ...port })), [ports]);
  const renderedNodes = useMemo(() => nodes.map(node => node.id !== 'character' ? node : { ...node, data: { ...node.data, ports: portList } }), [nodes, portList]);
  const edges = useMemo(() => {
    const focusId = selectedCanvasId ? null : selectedId;
    return Object.values(project.character.components).flatMap(part => {
      const port = ports[part.id];
      if (!port) return [];
      const slot = project.character.outfits[outfitId]?.equipped.find(item => item.componentId === part.id);
      const worn = Boolean(slot?.enabled);
      const label = !worn ? t('canvas.status.notWorn') : slot?.anchor || (part.kind === 'accessory' ? t('canvas.graph.edge.accessory') : t('canvas.graph.edge.piece'));
      return [{ id: `edge-${part.id}`, source: 'character', sourceHandle: `port-${part.id}`, target: part.id, targetHandle: port.side === 'left' ? 'right' : 'left', type: 'link', ariaLabel: t('canvas.graph.edge.aria', { name: part.name, label }),
        data: { focused: focusId === part.id, muted: Boolean(focusId && focusId !== part.id), dashed: !worn, showLabel: !worn, label, isNew: freshParts.includes(part.id) } }];
    }).concat(nodes.filter(node => node.type === 'view' || node.type === 'viewsSlot').map(node => ({ id: `edge-${node.id}`, source: 'character', sourceHandle: 'views', target: node.id, targetHandle: 'top', type: 'view', selectable: false, focusable: false,
      data: { dashed: node.type === 'viewsSlot' || node.data.state !== 'done' } })));
  }, [project.character.components, project.character.outfits, outfitId, selectedId, selectedCanvasId, ports, freshParts, nodes, locale]);

  const changeNodes = changes => setNodes(current => applyNodeChanges(changes.filter(change => change.type !== 'select'), current));
  const savePositions = (_, node, dragged) => {
    const saved = readSaved();
    for (const item of dragged || [node]) {
      if (item.type === 'annotation') saveAnnotationPosition(item.data.annotation.id, item.position);
      // 視角那一排整排一起移：記下這一排的左上角，其他角度跟著排過去。
      else if (item.type === 'view' || item.type === 'viewsAdd') saved['views-row'] = { x: Math.round(item.position.x - item.data.rowOffset), y: Math.round(item.position.y) };
      else saved[item.id] = item.position;
    }
    writeSaved(saved);
    setLayoutVersion(value => value + 1);
  };
  // 整理：人物不動，所有裝備依立繪位置重新排到兩側（避開參考圖與便利貼），排好後同樣固定下來。
  const tidy = () => {
    const saved = readSaved();
    const origin = saved.character || characterOrigin;
    const parts = Object.values(project.character.components).map(part => ({ id: part.id, kind: part.kind, crop: cropOf(part) }));
    writeSaved({ ...saved, ...placeParts(origin, parts, { obstacles: obstaclesFor(saved, origin), imageBox }) });
    setLayoutVersion(value => value + 1);
    setTimeout(fitAll, 80);
  };
  const focusSelection = () => flow.fitView({ nodes: [{ id: selectedCanvasId || selectedId }], padding: 0.3, duration: motionDuration(300), maxZoom: 1.2 });
  // 打開裝備欄時，選到的裝備不能躲在裝備欄底下：需要時把畫布平移出來（寬螢幕在右側、手機在下方）。
  useEffect(() => {
    if (!selectedId) return;
    const timer = setTimeout(() => {
      const box = canvas.current?.getBoundingClientRect();
      const node = flow.getInternalNode?.(selectedId) || flow.getNode(selectedId);
      if (!box || !node) return;
      const { x, y, zoom } = flow.getViewport();
      const position = node.internals?.positionAbsolute || node.position;
      const width = (node.measured?.width || partNodeSize.width) * zoom, height = (node.measured?.height || partNodeSize.height) * zoom;
      const left = position.x * zoom + x, top = position.y * zoom + y;
      const narrow = box.width <= 900;
      const right = narrow ? box.width - 12 : box.width - 384, bottom = narrow ? box.height * 0.28 - 8 : box.height;
      let dx = 0, dy = 0;
      if (left + width > right - 16) dx = right - 16 - (left + width);
      if (left + dx < 16) dx = 16 - left;
      if (narrow && top + height > bottom) dy = bottom - (top + height);
      if (narrow && top + dy < 12) dy = 12 - top;
      if (dx || dy) flow.setViewport({ x: x + dx, y: y + dy, zoom }, { duration: motionDuration(260) });
    }, 80);
    return () => clearTimeout(timer);
  }, [selectedId, flow]);
  const newPosition = kind => {
    const bounds = canvas.current?.getBoundingClientRect();
    const center = bounds ? flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }) : { x: 620, y: 420 };
    const offset = (creationOffset.current++ % 5) * 20;
    const width = kind === 'note' ? 210 : 240;
    const height = kind === 'reference' ? 450 : kind === 'text' ? 310 : 270;
    return { x: center.x - width / 2 + offset, y: center.y - height / 2 + offset };
  };
  async function createCard(operation) {
    if (creation?.working) return;
    setCreation({ ...operation, working: true, error: null });
    try {
      const result = operation.file ? await onAddCanvasReference(operation.file, operation.position) : await onCreateAnnotation(operation.input);
      if (!mounted.current) return;
      const id = annotationNodeId(result.annotation.id);
      setSelectedCanvasId(id); setEditRequestedId(id); setTool('select'); setCreation(null);
    } catch (failure) {
      if (mounted.current) setCreation({ ...operation, working: false, error: failure.message || t('canvas.graph.create.error') });
    }
  }
  const addTextCard = kind => createCard({ input: { kind, text: '', tone: kind === 'text' ? 'neutral' : 'gold', position: newPosition(kind) } });
  const shortcuts = useRef({});
  shortcuts.current = { v: () => setTool('select'), h: () => setTool('pan'), n: () => onCreateAnnotation && !creation?.working && addTextCard('note') };
  useEffect(() => {
    const handle = event => {
      const target = event.target;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('[aria-modal="true"]')) return;
      const action = shortcuts.current[event.key.toLowerCase()];
      if (action) { event.preventDefault(); action(); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  return <div className={`graph-canvas ${tool === 'pan' ? 'is-panning' : ''} ${zoom < 0.5 ? 'is-far' : ''}`} ref={canvas}>
    <ReactFlow nodes={renderedNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={changeNodes} onNodeDragStop={savePositions}
      onNodeClick={(_, node) => { if (tool === 'pan') return; if (node.type === 'part') { setSelectedCanvasId(null); onSelect(node.id); } else if (!['character', 'view', 'viewsSlot'].includes(node.type)) setSelectedCanvasId(node.id); }}
      onPaneClick={() => { setSelectedCanvasId(null); if (tool !== 'pan') onSelect(null); }} onMove={(_, viewport) => setZoom(viewport.zoom)}
      fitView fitViewOptions={{ padding: fitPadding, maxZoom: 1 }} minZoom={0.15} maxZoom={1.8} panOnDrag={tool === 'pan' ? true : [1, 2]} zoomOnDoubleClick={false} nodesConnectable={false} deleteKeyCode={null} colorMode="dark" proOptions={{ hideAttribution: true }}>
      <Background gap={26} size={1.1} color="#262B47" />
    </ReactFlow>
    <input ref={referenceInput} className="sr-only" tabIndex={-1} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label={t('canvas.graph.toolbar.chooseReference')} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) createCard({ file, position: newPosition('reference') }); }} />
    {creation && <div className={`canvas-create-feedback ${creation.error ? 'has-error' : ''}`} role={creation.error ? 'alert' : 'status'}>{creation.working ? <><CircleNotch className="annotation-spinner" size={15} />{creation.file ? t('canvas.graph.create.addingReference') : creation.input.kind === 'note' ? t('canvas.graph.create.addingNote') : t('canvas.graph.create.addingText')}</> : <><span>{creation.error}</span><button type="button" onClick={() => createCard(creation)}><ArrowClockwise size={14} />{t('canvas.retry')}</button><button type="button" onClick={() => setCreation(null)}>{t('canvas.cancel')}</button></>}</div>}
    <div className="canvas-footer">
      <div className="canvas-toolbar" role="toolbar" aria-label={t('canvas.graph.toolbar.label')}>
        <button type="button" aria-label={t('canvas.graph.toolbar.select')} title={t('canvas.graph.toolbar.selectShortcut')} aria-pressed={tool === 'select'} onClick={() => setTool('select')}><Cursor size={18} /></button>
        <button type="button" aria-label={t('canvas.graph.toolbar.pan')} title={t('canvas.graph.toolbar.panShortcut')} aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}><Hand size={18} /></button>
        <span className="tool-divider" />
        <button type="button" className="tool-wide" title={t('canvas.graph.toolbar.addPieceHint')} onClick={onAdd}><Plus size={16} />{t('canvas.graph.toolbar.addPiece')}</button>
        <button type="button" aria-label={t('canvas.graph.toolbar.addNote')} title={t('canvas.graph.toolbar.noteShortcut')} disabled={Boolean(creation?.working) || !onCreateAnnotation} onClick={() => addTextCard('note')}><Note size={18} /></button>
        <button type="button" aria-label={t('canvas.graph.toolbar.addText')} title={t('canvas.annotation.kind.text')} disabled={Boolean(creation?.working) || !onCreateAnnotation} onClick={() => addTextCard('text')}><TextT size={18} /></button>
        <button type="button" aria-label={t('canvas.graph.toolbar.addReference')} title={t('canvas.graph.toolbar.reference')} disabled={Boolean(creation?.working) || !onAddCanvasReference} onClick={() => referenceInput.current?.click()}><Image size={18} /></button>
        <span className="tool-divider" />
        <button type="button" className="tool-step" aria-label={t('canvas.graph.toolbar.zoomOut')} onClick={() => flow.zoomOut({ duration: motionDuration(200) })}><Minus size={15} /></button>
        <span className="tool-zoom num">{Math.round(zoom * 100)}%</span>
        <button type="button" className="tool-step" aria-label={t('canvas.graph.toolbar.zoomIn')} onClick={() => flow.zoomIn({ duration: motionDuration(200) })}><Plus size={15} /></button>
        <button type="button" aria-label={t('canvas.graph.toolbar.focus')} title={t('canvas.graph.toolbar.focus')} disabled={!selectedId && !selectedCanvasId} onClick={focusSelection}><Crosshair size={17} /></button>
        <button type="button" aria-label={t('canvas.graph.toolbar.fitAll')} title={t('canvas.graph.toolbar.fitAll')} onClick={fitAll}><CornersOut size={17} /></button>
        <button type="button" className="tool-wide" title={t('canvas.graph.toolbar.tidyHint')} onClick={tidy}>{t('canvas.graph.toolbar.tidy')}</button>
      </div>
    </div>
  </div>;
}
export function CharacterGraph(props) { return <ReactFlowProvider><GraphCanvas {...props} /></ReactFlowProvider>; }
