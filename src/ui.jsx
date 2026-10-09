import { useEffect, useRef, useState } from 'react';
import { Check, Clock, Sparkle, WarningCircle, CircleDashed, ArrowsClockwise, X } from '@phosphor-icons/react';
import { lockupMarkTransform, lockupViewBox, lockupWordTransform, markPath, markViewBox, wordmarkPath, wordmarkViewBox } from './brand';

// 品牌（v3）：金色「呆毛」標記＋ΛIDOL 字標；路徑由 scripts/build-brand.py 產生在 brand.js。
// 小尺寸時加一圈同色描邊，呆毛和髮尾才不會糊掉。
export function Mark({ size = 24, className = '', title }) {
  const stroke = size <= 24 ? 12 : size <= 32 ? 8 : 0;
  return <svg className={`mark ${className}`} viewBox={markViewBox} width={size} height={size} focusable="false" {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}>
    <path d={markPath} strokeWidth={stroke} strokeLinejoin="round" />
  </svg>;
}

export function Wordmark({ className = '' }) {
  return <svg className={`wordmark ${className}`} viewBox={wordmarkViewBox} role="img" aria-label="AIDOL" focusable="false"><path fillRule="evenodd" d={wordmarkPath} /></svg>;
}

// 橫式組合：標記與字標的相對大小、對齊都照品牌檔，height 決定整體大小。
export function Lockup({ height = 32, className = '' }) {
  return <svg className={`lockup ${className}`} viewBox={lockupViewBox} height={height} role="img" aria-label="AIDOL" focusable="false">
    <path className="lockup-mark" transform={lockupMarkTransform} d={markPath} />
    <path className="lockup-word" transform={lockupWordTransform} fillRule="evenodd" d={wordmarkPath} />
  </svg>;
}

const toneIcons = { success: Check, amber: Sparkle, blue: Clock, error: WarningCircle, neutral: CircleDashed };
// 狀態一律「圖示＋文字」，顏色只是補充。
export function StatusPill({ tone = 'neutral', children, running = false }) {
  const Icon = running ? ArrowsClockwise : toneIcons[tone] || CircleDashed;
  return <span className={`pill tone-${tone}`}><Icon size={12} weight="bold" className={running ? 'spin-slow' : ''} />{children}</span>;
}

// 區塊標題：菱形標記＋標題，右側可放補充或操作。
export function Section({ title, aside, children, className = '' }) {
  return <section className={`sec ${className}`}>
    <header className="sec-head"><h3><i aria-hidden="true" />{title}</h3>{aside && <div className="sec-aside">{aside}</div>}</header>
    {children}
  </section>;
}

// 選項格：大塊、可預覽、選中時有金色光框。
export function Tile({ selected, onClick, label, sub, children, className = '', disabled, title }) {
  return <button type="button" className={`tile ${className}`} aria-pressed={Boolean(selected)} onClick={onClick} disabled={disabled} title={title || label}>
    {children && <span className="tile-art">{children}</span>}
    <span className="tile-label">{label}</span>
    {sub && <span className="tile-sub">{sub}</span>}
    {selected && <span className="tile-mark" aria-hidden="true"><Check size={10} weight="bold" /></span>}
  </button>;
}

// 分段滑桿：有順序的選項（年齡、頭身、身高、長度）用拖的；左右鍵也可以。
export function StepSlider({ label, options, value, onChange, unsetLabel = '未設定' }) {
  const index = options.findIndex(option => option.id === value);
  const current = options[index];
  const fill = index < 0 ? 0 : (index / (options.length - 1)) * 100;
  return <div className={`step-slider ${index < 0 ? 'is-unset' : ''}`}>
    <div className="step-head"><span>{label}</span><b>{current?.label || unsetLabel}</b></div>
    <input type="range" min={0} max={options.length - 1} step={1} value={index < 0 ? Math.floor((options.length - 1) / 2) : index}
      aria-label={label} aria-valuetext={current?.label || unsetLabel} style={{ '--fill': `${fill}%` }}
      onChange={event => onChange(options[Number(event.target.value)].id)}
      onPointerDown={event => { if (index < 0) onChange(options[Number(event.currentTarget.value)].id); }} />
    <div className="step-ticks" aria-hidden="true">{options.map((option, i) => <button type="button" tabIndex={-1} key={option.id} className={i === index ? 'is-on' : ''} onClick={() => onChange(option.id)}>{option.short || option.label}</button>)}</div>
  </div>;
}

export function SwatchRow({ label, options, value, onChange, allowNone = false, size = 30 }) {
  return <div className="swatches" role="group" aria-label={label}>
    {allowNone && <button type="button" className="swatch swatch-none" aria-label="不使用" title="不使用" aria-pressed={!value} onClick={() => onChange(null)} style={{ width: size, height: size }}><span /></button>}
    {options.map(option => <button type="button" key={option.id} className="swatch" aria-label={option.label} title={option.label} aria-pressed={option.id === value} onClick={() => onChange(option.id)} style={{ width: size, height: size }}><span style={{ background: option.hex }} /></button>)}
  </div>;
}

export function Toggle({ checked, onChange, label, disabled }) {
  return <button type="button" role="switch" aria-checked={Boolean(checked)} aria-label={label} title={label} className="toggle" disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}

// 畫風轉盤：抓住旋鈕直接轉（指針跟著游標方向），放開時吸附到最近的刻度。
// 點旋鈕任何位置也會直接轉到那個方向；刻度點、滾輪、方向鍵、Home／End 都可以。
const MIN = -135, MAX = 135, STEP = 67.5;
const angleOf = value => MIN + value * STEP;
const clampAngle = (raw, previous) => {
  if (raw >= MIN && raw <= MAX) return raw;
  return Math.abs(raw - (previous ?? 0)) < 180 ? (raw > 0 ? MAX : MIN) : (previous > 0 ? MAX : MIN);
};
export function Knob({ control, value, onChange, size = 66, compare, compareLabel }) {
  const ref = useRef(null);
  const [dragAngle, setDragAngle] = useState(null);
  const last = useRef(value);
  last.current = value;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wheel = event => { event.preventDefault(); onChange(Math.max(0, Math.min(4, last.current + (event.deltaY < 0 ? 1 : -1)))); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [onChange]);
  const pointerAngle = (event, previous) => {
    const rect = ref.current.getBoundingClientRect();
    const raw = Math.atan2(event.clientX - (rect.left + rect.width / 2), (rect.top + rect.height / 2) - event.clientY) * 180 / Math.PI;
    return clampAngle(raw, previous);
  };
  const apply = angle => { const next = Math.round((angle - MIN) / STEP); if (next !== last.current) onChange(next); };
  const down = event => {
    event.preventDefault();
    ref.current.setPointerCapture(event.pointerId);
    ref.current.focus();
    const angle = pointerAngle(event, angleOf(value));
    setDragAngle(angle); apply(angle);
  };
  const move = event => { if (dragAngle === null) return; const angle = pointerAngle(event, dragAngle); setDragAngle(angle); apply(angle); };
  const up = () => setDragAngle(null);
  const key = event => {
    const map = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
    if (map[event.key]) { event.preventDefault(); onChange(Math.max(0, Math.min(4, value + map[event.key]))); }
    if (event.key === 'Home') { event.preventDefault(); onChange(0); }
    if (event.key === 'End') { event.preventDefault(); onChange(4); }
  };
  const shown = dragAngle ?? angleOf(value);
  const lit = shown - MIN;
  const differs = compare !== undefined && compare !== value;
  return <div className="knob-unit">
    <div className="knob-wrap" style={{ width: size + 22, height: size + 22 }}>
      {[0, 1, 2, 3, 4].map(step => {
        const a = (angleOf(step) * Math.PI) / 180, r = size / 2 + 8;
        return <button type="button" tabIndex={-1} key={step} className={`knob-tick ${step <= value ? 'is-lit' : ''}`} aria-label={`${control.label}：${control.steps[step]}`} title={control.steps[step]}
          style={{ left: `calc(50% + ${Math.sin(a) * r}px)`, top: `calc(50% - ${Math.cos(a) * r}px)` }} onClick={() => onChange(step)} />;
      })}
      <div ref={ref} className={`knob ${dragAngle !== null ? 'is-dragging' : ''}`} role="slider" tabIndex={0}
        aria-label={control.label} aria-valuemin={1} aria-valuemax={5} aria-valuenow={value + 1} aria-valuetext={control.steps[value]}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        style={{ width: size, height: size, '--lit': `${lit}deg` }}>
        <span className="knob-face" />
        <span className="knob-needle" style={{ transform: `rotate(${shown}deg)`, transition: dragAngle !== null ? 'none' : undefined }}><i /></span>
      </div>
    </div>
    <div className="knob-copy">
      <span className="knob-name">{control.label}</span>
      <span className="knob-value">{control.steps[value]}</span>
      {differs && <span className="knob-compare">{compareLabel}：{control.steps[compare]}</span>}
    </div>
  </div>;
}

export function Drawer({ title, onClose, children }) {
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement; box.current?.focus();
    const handle = event => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); prior?.focus?.(); };
  }, []);
  return <>
    <div className="drawer-backdrop" onClick={onClose} />
    <aside className="drawer" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}>
      <header className="drawer-head"><h2>{title}</h2><button type="button" className="icon-btn" aria-label="關閉" onClick={onClose}><X size={18} /></button></header>
      <div className="drawer-body">{children}</div>
    </aside>
  </>;
}
