import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, BaseEdge, EdgeLabelRenderer, Handle, Position, useReactFlow, useUpdateNodeInternals, ReactFlowProvider, applyNodeChanges } from '@xyflow/react';
import { Plus, Minus, CornersOut, Sparkle, EyeSlash, Crosshair, Cursor, Hand, Note, TextT, Image, CircleNotch, ArrowClockwise, Check, Clock, CircleDashed, MagnifyingGlassPlus, WarningCircle, Scissors, TShirt, Sneaker, Diamond, Sword, PersonSimple, Package } from '@phosphor-icons/react';
import { workspaceSummary } from '../shared/agent-workspace.mjs';
import { assetFor } from './api';
import { CanvasAnnotationNode, CanvasFormalReferenceNode } from './CanvasAnnotationNodes';
import { mergeGraphNodes } from './canvas-node-state.mjs';
import { characterNodeSize, columnX, containBox, layoutPorts, partNodeSize, placeParts, portraitBox } from './canvas-layout.mjs';
import { CropThumb } from './CropThumb';
import '@xyflow/react/dist/style.css';

const statusIcons = { success: Check, amber: Sparkle, blue: Clock, neutral: CircleDashed, error: WarningCircle };
const kindIcons = { garment: TShirt, footwear: Sneaker, accessory: Diamond, weapon: Sword, hair: Sparkle, body: PersonSimple, other: Package };
export const kindNames = { garment: '衣物', footwear: '鞋', accessory: '配件', weapon: '武器', hair: '頭髮', body: '身體', other: '其他' };

function NodeStatus({ status }) {
  const Icon = status.unworn ? EyeSlash : statusIcons[status.tone] || CircleDashed;
  return <span className={`node-status tone-${status.tone}`}><Icon size={12} weight="bold" className={status.running ? 'spin-slow' : ''} />{status.label}</span>;
}

// 人物節點：正式立繪（沒有時是預設人形）。點下去進入捏角色。
// 連到裝備的接點在節點的左右邊框上，高度對齊裝備在立繪上的位置；立繪上不放任何圓點。
// 選到一件裝備時，才在立繪上框出它的位置。
const CharacterNode = memo(function CharacterNode({ id, data, selected }) {
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
    <button type="button" className="char-art nodrag" onClick={event => { event.stopPropagation(); data.onOpen(); }} aria-label={`打開「${data.name}」的捏角色`}>
      {data.asset ? <img ref={image} src={data.asset.url} alt={`${data.name}的正式立繪`} draggable="false" onLoad={measure} />
        : <><img className="char-placeholder" src={data.placeholder} alt="" draggable="false" /><span className="char-empty"><b>還沒有正式立繪</b><small>點這裡開始捏角色，畫好的第一張會放在這裡</small></span></>}
      {region && <i className="char-region" style={region} aria-hidden="true" />}
    </button>
    {data.asset && <button type="button" className="char-zoom icon-btn nodrag" aria-label="放大正式立繪" title="放大" onClick={event => { event.stopPropagation(); data.onPreview(data.asset, `${data.name}・正式立繪`); }}><MagnifyingGlassPlus size={17} /></button>}
    <footer className="char-foot">
      <div className="char-id"><h2 className="display" title={data.name}>{data.name}</h2>{data.traits?.length > 0 && <p title={data.traits.join('・')}>{data.traits.join('・')}</p>}</div>
      <div className="char-row">
        <div className="char-states">
          {data.status && <NodeStatus status={data.status} />}
          {decomposition?.status === 'running' && <span className="node-status tone-blue"><CircleNotch size={12} weight="bold" className="spin" />正在拆解裝備</span>}
          {decomposition?.status === 'failed' && <button type="button" className="node-status tone-error nodrag" title={decomposition.error} onClick={event => { event.stopPropagation(); data.onDecompose(); }}><WarningCircle size={12} weight="bold" />拆解沒完成・再試一次</button>}
        </div>
        <div className="char-actions">
          {data.asset && decomposition?.status !== 'running' && <button type="button" className="btn btn-quiet btn-sm nodrag" title="請 AI 從立繪找出裝備，變成畫布上的節點" onClick={event => { event.stopPropagation(); data.onDecompose(); }}><Scissors size={14} />拆解裝備</button>}
          <button type="button" className="btn btn-primary btn-sm nodrag" onClick={event => { event.stopPropagation(); data.onOpen(); }}>捏角色</button>
        </div>
      </div>
    </footer>
    {ports.map(port => <Handle key={port.id} id={`port-${port.id}`} type="source" position={port.side === 'left' ? Position.Left : Position.Right} style={{ top: port.offset }} />)}
  </article>;
});

// 裝備節點：有設計圖顯示設計圖；還沒畫的顯示從立繪裁出的位置；都沒有時顯示種類圖示。
const PartNode = memo(function PartNode({ data, selected }) {
  const Icon = kindIcons[data.kind] || Package;
  return <article className={`part-node ${selected ? 'is-selected' : ''} ${data.proposed ? 'is-proposed' : ''} ${data.disabled ? 'is-off' : ''} ${data.isNew ? 'is-new' : ''}`}>
    <div className="part-art">
      {data.asset ? <img src={data.asset.url} alt={`${data.name}的設計圖`} draggable="false" />
        : data.cropUrl ? <CropThumb url={data.cropUrl} crop={data.crop} aspect={partNodeSize.width / 176} alt={`${data.name}在立繪上的位置`} />
          : <span className="part-icon"><Icon size={34} weight="light" /></span>}
      {data.proposed && <span className="part-flag">{data.asset ? '' : data.cropUrl ? '從立繪拆出' : '草案'}</span>}
    </div>
    <div className="part-caption">
      <b>{data.name}</b>
      <span className="part-sub">{[data.anchor, kindNames[data.kind]].filter(Boolean).join('・')}</span>
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

const nodeTypes = { character: CharacterNode, part: PartNode, annotation: CanvasAnnotationNode, formalReference: CanvasFormalReferenceNode };
const edgeTypes = { link: LinkEdge };
const referenceRoles = { style: '繪風', identity: '角色特徵', color: '色彩', clothing: '服裝', composition: '構圖', material: '材質' };
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
  if (fresh) return { tone: 'amber', label: `新圖 ${fresh}` };
  if (running) return { tone: 'blue', label: '繪製中', running: true };
  if (failed) return { tone: 'error', label: '這次沒畫成' };
  if (open) return { tone: 'blue', label: '到 Codex 按送出' };
  if (!worn) return { tone: 'neutral', label: '沒穿', unworn: true };
  if (project.syncTargets.includes(targetId) && asset) return { tone: 'amber', label: '設定改過' };
  if (asset) return { tone: 'success', label: '已採用' };
  if (targetId === 'character') return null;
  return { tone: 'neutral', label: '還沒畫' };
}

function GraphCanvas({ project, outfitId, selectedId, onSelect, onOpenCreator, onDecompose, onAdd, onPreview, placeholder, onCreateAnnotation, onUpdateAnnotation, onDeleteAnnotation, onAddCanvasReference }) {
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
      if (positionDraftsRef.current[id]?.sequence === sequence) changePositionDraft(id, { position, sequence, saving: false, error: failure.message || '請重新連線後再試一次。' });
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
  // 立繪的原始尺寸：用來知道圖在人物節點裡實際佔哪一塊（橫式設定稿上下會留白）。
  const [portraitSize, setPortraitSize] = useState(null);
  useEffect(() => {
    if (!portrait?.url) return undefined;
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => { if (!cancelled) setPortraitSize({ id: portrait.id, width: probe.naturalWidth, height: probe.naturalHeight }); };
    probe.src = portrait.url;
    return () => { cancelled = true; };
  }, [portrait?.id, portrait?.url]);
  const sizeReady = !portrait || portraitSize?.id === portrait.id;
  const imageBox = useMemo(() => portrait && portraitSize?.id === portrait.id ? portraitBox(portraitSize.width, portraitSize.height) : null, [portrait, portraitSize]);
  const cropOf = useCallback(part => part?.crop && portrait && part.crop.assetId === portrait.id ? part.crop : null, [portrait]);
  // 排新裝備時要避開的其他節點（參考圖、便利貼、說明）。
  const obstaclesFor = useCallback((saved, origin) => [
    ...(project.character.style.references || []).map((reference, index) => ({ ...(saved[`formal-reference:${reference.id}`] || referencePosition(origin, index)), width: 205, height: 300 })),
    ...(project.canvasAnnotations || []).map(annotation => ({ ...annotation.position, width: annotation.kind === 'note' ? 210 : 240, height: annotation.kind === 'reference' ? 450 : annotation.kind === 'text' ? 310 : 270 })),
  ], [project.character.style.references, project.canvasAnnotations]);
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
        data: { name: character.name, traits: character.persona.traits, asset: portrait, placeholder, status: nodeStatus(project, 'character', outfitId, summary, equipped), decomposition: project.decomposition, focusCrop: focusId ? cropOf(character.components[focusId]) : null, onOpen: onOpenCreator, onPreview, onDecompose } },
      ...parts.map(part => {
        const slot = equipped.find(item => item.componentId === part.id);
        const cropAsset = part.crop && project.assets.find(asset => asset.id === part.crop.assetId);
        return { id: part.id, type: 'part', selected: selectedId === part.id, position: saved[part.id] || auto[part.id], style: { width: partNodeSize.width, height: partNodeSize.height }, draggable: tool !== 'pan',
          data: { name: part.name, kind: part.kind, anchor: slot?.anchor, status: nodeStatus(project, part.id, outfitId, summary, equipped), asset: assetFor(project, part.id), crop: part.crop, cropUrl: cropAsset?.url, proposed: part.designStatus === 'proposed', disabled: !slot?.enabled, isNew: freshParts.includes(part.id) } };
      }),
      ...(character.style.references || []).map((reference, index) => {
        const id = `formal-reference:${reference.id}`;
        return { id, type: 'formalReference', selected: selectedCanvasId === id, position: saved[id] || referencePosition(origin, index), style: { width: 205 }, draggable: tool !== 'pan', data: { asset: project.assets.find(asset => asset.id === reference.assetId), title: `${referenceRoles[reference.role] || '設計'}參考`, description: reference.focus.join('・'), onPreview } };
      }),
      ...(project.canvasAnnotations || []).map(annotation => {
        const id = annotationNodeId(annotation.id), draft = positionDrafts[annotation.id];
        return { id, type: 'annotation', selected: selectedCanvasId === id, position: draft?.position || annotation.position, style: { width: annotation.kind === 'note' ? 210 : 240 }, draggable: tool !== 'pan', data: { annotation, asset: annotation.kind === 'reference' ? project.assets.find(asset => asset.id === annotation.assetId) : null, onUpdate: onUpdateAnnotation, onDelete: onDeleteAnnotation, onPreview, editRequested: editRequestedId === id, onEditRequestConsumed: () => setEditRequestedId(current => current === id ? null : current), positionStatus: draft, onRetryPosition: () => saveAnnotationPosition(annotation.id, positionDraftsRef.current[annotation.id]?.position || annotation.position) } };
      }),
    ];
    return { nodes, auto };
  }, [project, outfitId, portrait, selectedId, onOpenCreator, onDecompose, onPreview, placeholder, readSaved, selectedCanvasId, editRequestedId, tool, positionDrafts, onUpdateAnnotation, onDeleteAnnotation, saveAnnotationPosition, freshParts, layoutVersion, cropOf, obstaclesFor, imageBox]);
  useEffect(() => {
    const { nodes: built, auto } = buildNodes();
    // 圖片尺寸確定後才把新排的位置記下來，之後就固定。
    if (sizeReady && Object.keys(auto).length) writeSaved({ ...readSaved(), ...auto });
    const positions = new Map(built.map(node => [node.id, node.position]));
    setNodes(current => mergeGraphNodes(current, built).map(node => node.dragging || node.type === 'annotation' ? node : { ...node, position: positions.get(node.id) }));
  }, [buildNodes, readSaved, writeSaved, sizeReady]);

  // 第一次打開與裝備數量改變時，把整個關係圖放進畫面。
  const fitAll = useCallback(() => flow.fitView({ padding: 0.14, duration: motionDuration(380), maxZoom: 1 }), [flow]);
  useEffect(() => {
    const timer = setTimeout(fitAll, 160);
    return () => clearTimeout(timer);
  }, [project.id, Object.keys(project.character.components).length, fitAll]);

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
      const label = !worn ? '沒穿' : slot?.anchor || (part.kind === 'accessory' ? '配件' : '裝備');
      return [{ id: `edge-${part.id}`, source: 'character', sourceHandle: `port-${part.id}`, target: part.id, targetHandle: port.side === 'left' ? 'right' : 'left', type: 'link', ariaLabel: `${part.name}：${label}`,
        data: { focused: focusId === part.id, muted: Boolean(focusId && focusId !== part.id), dashed: !worn, showLabel: !worn, label, isNew: freshParts.includes(part.id) } }];
    });
  }, [project.character.components, project.character.outfits, outfitId, selectedId, selectedCanvasId, ports, freshParts]);

  const changeNodes = changes => setNodes(current => applyNodeChanges(changes.filter(change => change.type !== 'select'), current));
  const savePositions = (_, node, dragged) => {
    const saved = readSaved();
    for (const item of dragged || [node]) {
      if (item.type === 'annotation') saveAnnotationPosition(item.data.annotation.id, item.position);
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
      if (mounted.current) setCreation({ ...operation, working: false, error: failure.message || '尚未加入畫布，請再試一次。' });
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
      onNodeClick={(_, node) => { if (tool === 'pan') return; if (node.type === 'part') { setSelectedCanvasId(null); onSelect(node.id); } else if (node.type !== 'character') setSelectedCanvasId(node.id); }}
      onPaneClick={() => { setSelectedCanvasId(null); if (tool !== 'pan') onSelect(null); }} onMove={(_, viewport) => setZoom(viewport.zoom)}
      fitView fitViewOptions={{ padding: 0.14, maxZoom: 1 }} minZoom={0.15} maxZoom={1.8} panOnDrag={tool === 'pan' ? true : [1, 2]} zoomOnDoubleClick={false} nodesConnectable={false} deleteKeyCode={null} colorMode="dark" proOptions={{ hideAttribution: true }}>
      <Background gap={26} size={1.1} color="#262B47" />
    </ReactFlow>
    <input ref={referenceInput} className="sr-only" tabIndex={-1} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="選擇畫布參考圖片" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) createCard({ file, position: newPosition('reference') }); }} />
    {creation && <div className={`canvas-create-feedback ${creation.error ? 'has-error' : ''}`} role={creation.error ? 'alert' : 'status'}>{creation.working ? <><CircleNotch className="annotation-spinner" size={15} />正在加入{creation.file ? '參考圖' : creation.input.kind === 'note' ? '便利貼' : '說明'}…</> : <><span>{creation.error}</span><button type="button" onClick={() => createCard(creation)}><ArrowClockwise size={14} />再試一次</button><button type="button" onClick={() => setCreation(null)}>取消</button></>}</div>}
    <div className="canvas-footer">
      <div className="canvas-toolbar" role="toolbar" aria-label="畫布工具">
        <button type="button" aria-label="選取工具" title="選取（V）" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><Cursor size={18} /></button>
        <button type="button" aria-label="平移工具" title="平移（H）" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}><Hand size={18} /></button>
        <span className="tool-divider" />
        <button type="button" className="tool-wide" title="新增一件裝備" onClick={onAdd}><Plus size={16} />裝備</button>
        <button type="button" aria-label="加入便利貼" title="便利貼（N）" disabled={Boolean(creation?.working) || !onCreateAnnotation} onClick={() => addTextCard('note')}><Note size={18} /></button>
        <button type="button" aria-label="加入說明" title="說明" disabled={Boolean(creation?.working) || !onCreateAnnotation} onClick={() => addTextCard('text')}><TextT size={18} /></button>
        <button type="button" aria-label="加入畫布參考圖" title="參考圖" disabled={Boolean(creation?.working) || !onAddCanvasReference} onClick={() => referenceInput.current?.click()}><Image size={18} /></button>
        <span className="tool-divider" />
        <button type="button" className="tool-step" aria-label="縮小畫布" onClick={() => flow.zoomOut({ duration: motionDuration(200) })}><Minus size={15} /></button>
        <span className="tool-zoom num">{Math.round(zoom * 100)}%</span>
        <button type="button" className="tool-step" aria-label="放大畫布" onClick={() => flow.zoomIn({ duration: motionDuration(200) })}><Plus size={15} /></button>
        <button type="button" aria-label="聚焦選取內容" title="聚焦選取內容" disabled={!selectedId && !selectedCanvasId} onClick={focusSelection}><Crosshair size={17} /></button>
        <button type="button" aria-label="顯示全部" title="顯示全部" onClick={fitAll}><CornersOut size={17} /></button>
        <button type="button" className="tool-wide" title="把裝備節點重新排回人物兩側" onClick={tidy}>整理</button>
      </div>
    </div>
  </div>;
}
export function CharacterGraph(props) { return <ReactFlowProvider><GraphCanvas {...props} /></ReactFlowProvider>; }
