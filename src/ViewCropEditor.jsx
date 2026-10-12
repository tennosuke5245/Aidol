import { useEffect, useRef, useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { turnaroundViews } from '../shared/domain.mjs';
import { Busy } from './Panels';
import { useT } from './i18n';

// 調整三視圖裁切：整張三視圖上放好正面、側面、背面三個框，拖框移動、拉角落調大小（鍵盤：方向鍵移動、Shift＋方向鍵調大小）。
// 框住整個人就好：套用時會自動收緊到人物、三張用同樣大小並對齊腳底。原圖不變，裁出來的是新的圖。
const minWidth = 0.04, minHeight = 0.1, step = 0.005;
const defaults = { front: { x: 0.03, y: 0.04, width: 0.29, height: 0.92 }, side: { x: 0.355, y: 0.04, width: 0.29, height: 0.92 }, back: { x: 0.68, y: 0.04, width: 0.29, height: 0.92 } };
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const pick = box => ({ x: box.x, y: box.y, width: box.width, height: box.height });

// 重畫過的角度不放框：套用時不會被改回從三視圖裁（要改回來就自己勾）。
function initialBoxes(views) {
  const result = {};
  const redrawn = view => views?.items?.[view]?.redrawn;
  for (const box of views?.boxes || []) if (turnaroundViews.includes(box.view) && !redrawn(box.view)) result[box.view] = pick(box);
  for (const [view, item] of Object.entries(views?.items || {})) if (!result[view] && item?.figure && !item.redrawn) result[view] = pick(item.figure);
  return Object.keys(result).length || Object.values(views?.items || {}).some(item => item?.redrawn) ? result : { ...defaults };
}

export function ViewCropEditor({ asset, views, busy, onApply, onCancel }) {
  const t = useT();
  const [boxes, setBoxes] = useState(() => initialBoxes(views));
  const [ratio, setRatio] = useState(1.5);
  const [space, setSpace] = useState({ width: 760, height: 480 });
  const stage = useRef(null), frame = useRef(null), drag = useRef(null);
  // 圖的大小：寬度跟著對話框，高度最多佔畫面的一半多一點（手機上少一些），不留多餘的空白。
  useEffect(() => {
    const measure = width => setSpace({ width, height: Math.min(560, window.innerHeight * (window.innerWidth <= 640 ? 0.46 : 0.58)) });
    const observer = new ResizeObserver(entries => measure(entries[0].contentRect.width));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  const width = Math.max(120, Math.min(space.width, space.height * ratio)), height = width / ratio;
  const label = view => t(`canvas.views.view.${view}`);
  const chosen = turnaroundViews.filter(view => boxes[view]);
  const redrawn = turnaroundViews.filter(view => views?.items?.[view]?.redrawn);

  const toggle = view => setBoxes(current => {
    const next = { ...current };
    if (next[view]) delete next[view]; else next[view] = { ...defaults[view] };
    return next;
  });
  const resize = (box, mode, dx, dy) => {
    if (mode === 'move') return { ...box, x: clamp(box.x + dx, 0, 1 - box.width), y: clamp(box.y + dy, 0, 1 - box.height) };
    let { x, y, width: w, height: h } = box;
    if (mode.includes('w')) { const right = x + w; x = clamp(x + dx, 0, right - minWidth); w = right - x; }
    if (mode.includes('e')) w = clamp(w + dx, minWidth, 1 - x);
    if (mode.includes('n')) { const bottom = y + h; y = clamp(y + dy, 0, bottom - minHeight); h = bottom - y; }
    if (mode.includes('s')) h = clamp(h + dy, minHeight, 1 - y);
    return { x, y, width: w, height: h };
  };
  const start = (view, mode) => event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    frame.current.setPointerCapture(event.pointerId);
    drag.current = { view, mode, x: event.clientX, y: event.clientY, rect: frame.current.getBoundingClientRect(), box: boxes[view] };
  };
  const move = event => {
    const current = drag.current;
    if (!current) return;
    const dx = (event.clientX - current.x) / current.rect.width, dy = (event.clientY - current.y) / current.rect.height;
    setBoxes(value => ({ ...value, [current.view]: resize(current.box, current.mode, dx, dy) }));
  };
  const end = () => { drag.current = null; };
  const keys = view => event => {
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    setBoxes(value => ({ ...value, [view]: resize(value[view], event.shiftKey ? 'se' : 'move', delta[0], delta[1]) }));
  };

  return <div className="crop-editor">
    <p className="hint">{t('canvas.views.editor.tip')}{redrawn.length > 0 && ` ${t('canvas.views.editor.redrawnNote', { views: redrawn.map(label).join(t('canvas.separator')) })}`}</p>
    <div className="crop-editor-views" role="group" aria-label={t('canvas.views.editor.include')}>
      {turnaroundViews.map(view => <button type="button" key={view} className={`crop-chip is-${view}`} aria-pressed={Boolean(boxes[view])} onClick={() => toggle(view)}>{boxes[view] && <Check size={13} weight="bold" />}{label(view)}</button>)}
    </div>
    <div className="crop-editor-stage" ref={stage}>
      <div className="crop-editor-frame" ref={frame} style={{ width, height }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <img src={asset.url} alt="" draggable="false" onLoad={event => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight); }} />
        {chosen.map(view => { const box = boxes[view]; return <div key={view} className={`crop-box is-${view}`} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
          tabIndex={0} role="group" aria-label={t('canvas.views.editor.boxAria', { view: label(view) })} onPointerDown={start(view, 'move')} onKeyDown={keys(view)}>
          <span className="crop-box-label">{label(view)}</span>
          {['nw', 'ne', 'sw', 'se'].map(corner => <i key={corner} className={`crop-handle is-${corner}`} onPointerDown={start(view, corner)} />)}
        </div>; })}
      </div>
    </div>
    <div className="crop-editor-actions">
      <button type="button" className="btn btn-quiet" onClick={onCancel}>{t('canvas.cancel')}</button>
      <button type="button" className="btn btn-primary" disabled={busy || !chosen.length} onClick={() => onApply(chosen.map(view => ({ view, ...boxes[view] })))}>{busy ? <Busy>{t('canvas.views.editor.applying')}</Busy> : t('canvas.views.editor.apply')}</button>
    </div>
  </div>;
}
