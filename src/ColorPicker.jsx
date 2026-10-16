import { useEffect, useRef, useState } from 'react';
import { Eyedropper, Plus } from '@phosphor-icons/react';
import { useT } from './i18n';
import { L } from './lib-i18n';
import { readPreference, writePreference } from './drafts';
import { colorName, hexToRgb, hsvToRgb, isHex, normalizeHex, rgbToHex, rgbToHsv } from '../shared/colors.mjs';

// 自訂顏色（2026-10-13 起）：每個顏色欄位都是「預設色＋自訂」。自訂打開調色盤：
// 色板拖曳、色相條、HEX、吸管（從畫面任何地方吸色）、角色色票、最近用過。改了立刻套用，Ctrl＋Z 可以復原。

// 目前語言的自動色名（例如「淺水藍」）。
export const colorLabel = hex => colorName(hex, L).label;

// 最近用過的顏色：只是這台電腦的便利功能，讀不到就是空的。
const RECENT = 'recent-colors';
export function readRecent() {
  const list = readPreference(RECENT, []);
  return Array.isArray(list) ? list.filter(isHex).slice(0, 8) : [];
}
export function rememberColor(hex) {
  const value = normalizeHex(hex);
  if (value) writePreference(RECENT, [value, ...readRecent().filter(item => item !== value)].slice(0, 8));
}

// 吸管：Chromium 系（Windows 桌面版、Chrome、Edge）才有。
export const canPickFromScreen = () => typeof window !== 'undefined' && 'EyeDropper' in window;
function fromScreenValue(value) {
  const hex = normalizeHex(value);
  if (hex) return hex;
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(value));
  return match ? rgbToHex({ r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }) : null;
}

const clamp = value => Math.min(1, Math.max(0, value));

export function ColorPicker({ value, onChange, onDone, palette = [] }) {
  const t = useT();
  const start = normalizeHex(value) || '#7C8DB5';
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(start)));
  const [text, setText] = useState(start);
  const [recent, setRecent] = useState(readRecent);
  const hsvRef = useRef(hsv);
  const sent = useRef(start);
  // 最近送出去、還在路上的顏色：外面傳回來的是這些就是自己的回音，不用同步（拖曳中才不會跳回上一格）。
  const echoes = useRef([start]);
  const touched = useRef(false);
  const frame = useRef(0);
  const pending = useRef(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const area = useRef(null);
  const box = useRef(null);
  const hex = rgbToHex(hsvToRgb(hsv));

  // 灰、黑、白沒有色相：換成這些顏色時保留原本的色相，色板不會突然跳到紅色。
  const keepHue = parsed => (parsed.s === 0 || parsed.v === 0 ? { ...parsed, h: hsvRef.current.h } : parsed);
  // 外面改了顏色（按了預設色、復原）才跟著換；自己剛送出去的回音不理。
  useEffect(() => {
    const next = normalizeHex(value);
    if (!next) return;
    if (next === sent.current) { echoes.current = [next]; return; }
    if (echoes.current.includes(next)) return;
    sent.current = next; echoes.current = [next];
    const parsed = keepHue(rgbToHsv(hexToRgb(next)));
    hsvRef.current = parsed; setHsv(parsed); setText(next);
  }, [value]);
  // 關掉調色盤時，還沒送出的最後一個顏色要送出去，不能丟掉。
  useEffect(() => () => { cancelAnimationFrame(frame.current); if (pending.current) changeRef.current(pending.current); }, []);

  // 拖曳時每一格畫面最多送一次。
  const emit = next => {
    hsvRef.current = next; setHsv(next);
    const nextHex = rgbToHex(hsvToRgb(next));
    setText(nextHex);
    if (nextHex === sent.current) return;
    sent.current = nextHex;
    echoes.current = [...echoes.current.slice(-15), nextHex];
    touched.current = true;
    pending.current = nextHex;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { const color = pending.current; pending.current = null; if (color) changeRef.current(color); });
  };
  const setHex = input => {
    const next = normalizeHex(input);
    if (!next) { setText(sent.current); return; }
    emit(keepHue(rgbToHsv(hexToRgb(next))));
  };
  // 有改過顏色才記進「最近用過」。
  const finish = () => { if (touched.current) { rememberColor(sent.current); setRecent(readRecent()); } onDone?.(); };

  const fromPointer = event => {
    const rect = area.current.getBoundingClientRect();
    emit({ ...hsvRef.current, s: clamp((event.clientX - rect.left) / rect.width), v: 1 - clamp((event.clientY - rect.top) / rect.height) });
  };
  const down = event => { event.preventDefault(); area.current.setPointerCapture(event.pointerId); area.current.focus(); fromPointer(event); };
  const move = event => { if (area.current.hasPointerCapture(event.pointerId)) fromPointer(event); };
  const key = event => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const map = { ArrowLeft: ['s', -step], ArrowRight: ['s', step], ArrowUp: ['v', step], ArrowDown: ['v', -step] };
    if (!map[event.key]) return;
    event.preventDefault();
    const [channel, delta] = map[event.key];
    emit({ ...hsvRef.current, [channel]: clamp(hsvRef.current[channel] + delta) });
  };
  async function pickScreen() {
    try {
      const result = await new window.EyeDropper().open();
      const picked = fromScreenValue(result?.sRGBHex);
      if (picked) setHex(picked);
    } catch { /* 按 Esc 取消吸色 */ }
  }

  const quick = (title, colors) => colors.length > 0 && <div className="cp-quick">
    <small>{title}</small>
    <div className="swatches">{colors.map(color => <button type="button" key={color} className="swatch" aria-label={`${colorLabel(color)} ${color}`} title={`${colorLabel(color)} ${color}`} aria-pressed={color === hex} onClick={() => setHex(color)} style={{ width: 24, height: 24 }}><span style={{ background: color }} /></button>)}</div>
  </div>;
  const paletteColors = [...new Set(palette.map(swatch => swatch.hex?.toUpperCase()).filter(isHex))];

  return <div className="color-picker" ref={box} role="group" aria-label={t('ui.color.picker')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); finish(); } }}>
    <div ref={area} className="cp-area" role="slider" tabIndex={0} aria-label={t('ui.color.area')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.v * 100)} aria-valuetext={`${colorLabel(hex)} ${hex}`}
      style={{ '--hue': `hsl(${Math.round(hsv.h)} 100% 50%)` }} onPointerDown={down} onPointerMove={move} onKeyDown={key}>
      <span className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
    </div>
    <input type="range" className="cp-hue" min={0} max={359} step={1} value={Math.round(hsv.h)} aria-label={t('ui.color.hue')} onChange={event => emit({ ...hsvRef.current, h: Number(event.target.value) })} />
    <div className="cp-row">
      <span className="cp-preview" style={{ background: hex }} aria-hidden="true" />
      <input className="cp-hex" value={text} maxLength={7} spellCheck={false} aria-label={t('ui.color.hex')}
        onChange={event => { setText(event.target.value); const next = normalizeHex(event.target.value); if (next && event.target.value.replace('#', '').length === 6) setHex(next); }}
        onBlur={() => setHex(text)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setHex(text); } }} />
      {canPickFromScreen() && <button type="button" className="icon-btn" title={t('ui.color.eyedropperHint')} aria-label={t('ui.color.eyedropper')} onClick={pickScreen}><Eyedropper size={17} /></button>}
      <span className="cp-name">{colorLabel(hex)}</span>
    </div>
    {quick(t('ui.color.palette'), paletteColors)}
    {quick(t('ui.color.recent'), recent.filter(color => !paletteColors.includes(color)))}
    <div className="cp-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={finish}>{t('ui.color.done')}</button></div>
  </div>;
}

// 顏色欄位：預設色一排＋「自訂」。value 是預設代號或 #RRGGBB；options 每個要有 id、label、hex。
// nameOf：自訂色的名稱（膚色用「最接近的預設膚色」，其他用自動色名）。
export function ColorField({ label, options = [], value, onChange, allowNone = false, noneLabel, size = 30, palette = [], nameOf = colorLabel }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  const preset = options.find(option => option.id === value);
  const custom = !preset && isHex(value) ? value.toUpperCase() : null;
  const current = custom || preset?.hex || null;
  const sizeStyle = { width: size, height: size };
  // 「自訂」只有一格：選了自訂色時這格就顯示那個顏色（不另外插一格，打開調色盤拖曳時版面才不會跳）。
  // 關掉調色盤後，焦點回到「自訂」按鈕（鍵盤使用者不會掉到頁首）。
  const done = () => { setOpen(false); requestAnimationFrame(() => toggle.current?.focus()); };
  return <div className="color-field">
    <div className="swatches" role="group" aria-label={label}>
      {allowNone && <button type="button" className="swatch swatch-none" aria-label={noneLabel || t('ui.none')} title={noneLabel || t('ui.none')} aria-pressed={!value} onClick={() => onChange(null)} style={sizeStyle}><span /></button>}
      {options.map(option => <button type="button" key={option.id} className="swatch" aria-label={option.label} title={option.label} aria-pressed={option.id === value} onClick={() => onChange(option.id)} style={sizeStyle}><span style={{ background: option.hex }} /></button>)}
      <button type="button" ref={toggle} className={`swatch swatch-custom${custom ? ' has-color' : ''}`} aria-pressed={Boolean(custom)} aria-expanded={open}
        aria-label={custom ? t('ui.color.customNamed', { name: nameOf(custom), hex: custom }) : t('ui.color.custom')} title={custom ? `${nameOf(custom)} ${custom}` : t('ui.color.customHint')}
        onClick={() => setOpen(shown => !shown)} style={sizeStyle}><span style={custom ? { '--custom': custom } : undefined}>{!custom && <Plus size={Math.max(12, Math.round(size * 0.42))} weight="bold" />}</span></button>
    </div>
    {custom && !open && <small className="color-caption">{t('ui.color.customNamed', { name: nameOf(custom), hex: custom })}</small>}
    {open && <ColorPicker value={current || '#7C8DB5'} palette={palette} onChange={onChange} onDone={done} />}
  </div>;
}
