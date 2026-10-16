import { useT } from '../i18n';
import { hexToRgb, rgbToHex } from '../../shared/colors.mjs';

// 眼睛預覽（2026-10-13 起）：兩隻眼睛的顏色、瞳孔與眼型即時變。純向量圖，不用選項圖。
// 畫面左邊是角色的右眼（正面看角色時左右相反）；異色瞳時點一隻眼睛，下面的顏色就改那一隻。
const scleras = {
  soft: 'M8 33 Q50 3 92 31 Q52 55 8 33 Z',
  round: 'M10 33 Q50 -3 90 33 Q50 61 10 33 Z',
  sharp: 'M8 37 Q44 7 94 21 Q58 51 8 37 Z',
  droopy: 'M8 25 Q48 3 92 39 Q52 57 8 25 Z',
  narrow: 'M6 33 Q50 13 94 31 Q50 47 6 33 Z',
};
// 上眼線：沿著眼白上緣的那條弧。
const lids = {
  soft: 'M8 33 Q50 3 92 31',
  round: 'M10 33 Q50 -3 90 33',
  sharp: 'M8 37 Q44 7 94 21',
  droopy: 'M8 25 Q48 3 92 39',
  narrow: 'M6 33 Q50 13 94 31',
};
const shade = (hex, amount) => { const { r, g, b } = hexToRgb(hex); return rgbToHex({ r: r * (1 - amount), g: g * (1 - amount), b: b * (1 - amount) }); };

function Pupil({ type, color }) {
  const fill = shade(color, 0.72);
  switch (type) {
    case 'slit': return <ellipse cx="50" cy="31" rx="2.6" ry="12.5" fill={fill} />;
    case 'star': return <path d="M50 21.5 L52.6 28.3 L59.8 28.6 L54.2 33.2 L56.1 40.2 L50 36.2 L43.9 40.2 L45.8 33.2 L40.2 28.6 L47.4 28.3 Z" fill={fill} />;
    case 'heart': return <path d="M50 39 C41 32 41.5 24.5 46 24 C48.3 23.8 49.5 25.3 50 26.7 C50.5 25.3 51.7 23.8 54 24 C58.5 24.5 59 32 50 39 Z" fill={fill} />;
    case 'cross': return <path d="M48 20 H52 V29 H61 V33 H52 V42 H48 V33 H39 V29 H48 Z" fill={fill} />;
    case 'ring': return <circle cx="50" cy="31" r="6.5" fill="none" stroke={fill} strokeWidth="3" />;
    default: return <circle cx="50" cy="31" r={type === 'hollow' ? 6 : 7} fill={fill} />;
  }
}

function Eye({ id, shape, pupil, color, mirror }) {
  const sclera = scleras[shape] || scleras.soft;
  const lid = lids[shape] || lids.soft;
  const hollow = pupil === 'hollow';
  return <svg className="eye-art" viewBox="0 0 100 62" aria-hidden="true">
    <defs>
      <clipPath id={`${id}-clip`}><path d={sclera} /></clipPath>
      <linearGradient id={`${id}-lid`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#000" stopOpacity={hollow ? 0.5 : 0.38} /><stop offset="0.55" stopColor="#000" stopOpacity="0" /></linearGradient>
    </defs>
    <g transform={mirror ? 'translate(100 0) scale(-1 1)' : undefined}>
      <path d={sclera} fill="#F4F2EE" />
      <g clipPath={`url(#${id}-clip)`}>
        <circle cx="50" cy="31" r="16.5" fill={color} stroke={shade(color, 0.45)} strokeWidth="2" />
        <Pupil type={pupil} color={color} />
        <rect x="0" y="0" width="100" height="62" fill={`url(#${id}-lid)`} />
        {!hollow && <><circle cx="56.5" cy="24.5" r="4.2" fill="#fff" /><circle cx="44" cy="37" r="1.9" fill="#fff" opacity=".85" /></>}
      </g>
      <path d={lid} fill="none" stroke="#1C1B26" strokeWidth="4.5" strokeLinecap="round" />
    </g>
  </svg>;
}

export function EyePreview({ shape, pupil, right, left, hetero, selected, onSelect }) {
  const t = useT();
  const eyes = [
    { side: 'right', color: right, mirror: true },
    { side: 'left', color: hetero ? left : right, mirror: false },
  ];
  if (!hetero) return <div className="eye-preview" aria-hidden="true">{eyes.map(eye => <Eye key={eye.side} id={`eye-${eye.side}`} shape={shape} pupil={pupil} color={eye.color} mirror={eye.mirror} />)}</div>;
  return <div className="eye-preview is-pick" role="radiogroup" aria-label={t('creator.face.whichEye')}>
    {eyes.map(eye => <button type="button" key={eye.side} role="radio" aria-checked={selected === eye.side} className="eye-pick" onClick={() => onSelect(eye.side)}>
      <Eye id={`eye-pick-${eye.side}`} shape={shape} pupil={pupil} color={eye.color} mirror={eye.mirror} />
      <span>{t(eye.side === 'right' ? 'creator.face.rightEye' : 'creator.face.leftEye')}</span>
    </button>)}
  </div>;
}
