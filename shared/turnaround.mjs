// 三視圖：第一張圖畫成正面、側面、背面並排的一張圖，採用後自動找出三個人的位置並裁成三張。
import { turnaroundViews, turnaroundLabels } from './domain.mjs';

// 交給 Codex 的三視圖規格（業界慣例：正交、同比例、同一條地平線、A 字站姿、素色背景、彼此留空方便裁切）。
export const TURNAROUND_SPEC = '三視圖規格：同一張橫式圖（約 3:2），由左到右依序是正面、側面（臉朝畫面左）、背面三個全身，是同一個角色、同一套服裝；同一比例、同一條地平線，頭頂、眼睛、肩、腰、膝、腳底高度對齊；中性 A 字站姿、雙腳平行、手臂微微離開身體；正交視角、不要透視；淺灰素色背景；三個人之間留出明顯空白、不可重疊；不加文字、標籤、道具或其他分格。';

// 分開畫的第一張：只畫正面全身，之後照它一張張畫側面、背面。
export const FRONT_SPEC_BODY = '正面全身規格：直式（約 2:3），只畫一個人、正面全身；中性 A 字站姿、雙腳平行、手臂微微離開身體；正交視角、不要透視；淺灰素色背景；頭頂到腳底完整入鏡，上下都留一點空白；不加文字、標籤或道具。';
export const FRONT_SPEC = `${FRONT_SPEC_BODY}之後會照這張畫側面與背面，所以服裝與配件要畫清楚。`;

const clamp = (value) => Math.min(1, Math.max(0, Number(value) || 0));

// AI 回傳的視角位置框：只留正面／側面／背面各一個、夾在圖片範圍內、太小的不要，依正側背排序。
export function normalizeViewBoxes(views) {
  const result = new Map();
  for (const item of Array.isArray(views) ? views : []) {
    if (!turnaroundViews.includes(item?.view) || result.has(item.view)) continue;
    const box = item.bbox || item;
    const x = clamp(box.x); const y = clamp(box.y);
    const width = Math.min(clamp(box.width), 1 - x); const height = Math.min(clamp(box.height), 1 - y);
    if (width < 0.03 || height < 0.1) continue;
    result.set(item.view, { view: item.view, x, y, width, height });
  }
  return turnaroundViews.filter((view) => result.has(view)).map((view) => result.get(view));
}

// 比例檢查：三張裡的人物高度（裁切前量到的，0–1 比例）和正面差多少；超過 8% 就提醒可能畫跑了。
export const HEIGHT_TOLERANCE = 0.08;
export function heightDrift(items = {}) {
  const front = items.front?.figure?.height;
  if (!front) return {};
  return Object.fromEntries(Object.entries(items).filter(([view, item]) => view !== 'front' && item?.figure?.height).map(([view, item]) => {
    const drift = (item.figure.height - front) / front;
    return [view, Math.abs(drift) > HEIGHT_TOLERANCE ? Math.round(drift * 100) : 0];
  }).filter(([, percent]) => percent !== 0));
}

// ── 設計標註 ──
// 設計師在某個角度圖上點一個位置，寫這裡是什麼（例如「尾巴：從腰後正中間長出來」）。畫角色的任何圖都會附上，
// 位置換成文字（從頭頂往下幾成、畫面哪一邊、是角色的哪一邊），AI 換到別的角度時才知道要畫在哪裡。
export const NOTE_LIMIT = 40;
export const NOTE_TITLE_MAX = 40;
export const NOTE_TEXT_MAX = 500;

// 人物在那張角度圖上的範圍（0–1）：從三視圖裁出來的有量到；重畫的角度已經調成和正面一樣大，用正面的。
const figureIn = (item) => item?.figure && item?.frame ? { left: (item.figure.x - item.frame.x) / item.frame.width, top: (item.figure.y - item.frame.y) / item.frame.height, width: item.figure.width / item.frame.width, height: item.figure.height / item.frame.height } : null;
export function bodyRect(views, view) {
  return figureIn(views?.items?.[view]) || figureIn(views?.items?.front) || { left: 0.2, top: 0.04, width: 0.6, height: 0.92 };
}

// 標註的位置記成「人物範圍裡的相對位置」：bx、by 是 0 到 1（0 是人物的左邊／頭頂，1 是右邊／腳底，可以稍微超出，例如頭頂上的呆毛）。
// 重新裁切、重畫後調大小、換了正式圖，標註仍然在同一個部位；畫面上要顯示時，再換回那張圖上的位置。
const clampUnit = (value) => Math.min(1, Math.max(0, value));
export const toBodyPoint = (point, body) => ({ bx: Math.min(2, Math.max(-1, (point.x - body.left) / body.width)), by: Math.min(2, Math.max(-1, (point.y - body.top) / body.height)) });
export const toImagePoint = (note, body) => ({ x: clampUnit(body.left + note.bx * body.width), y: clampUnit(body.top + note.by * body.height) });

// 畫面左右對應到角色自己的哪一邊；側面類的角度另外寫「這個角度看到的是角色的哪半邊」，換到別的角度才不會左右畫反。
const ownSide = {
  front: { left: '角色的右邊', right: '角色的左邊' },
  back: { left: '角色的左邊', right: '角色的右邊' },
  side: { left: '身體前面', right: '身體後面' },
  otherSide: { left: '身體後面', right: '身體前面' },
};
const visibleHalf = { side: '左半邊', frontQuarter: '左半邊', backQuarter: '左半邊', otherSide: '右半邊' };
export function notePlaceText(note) {
  const down = Math.round(note.by * 20) * 5;
  const height = down < 0 ? '頭頂上方' : down > 100 ? '腳底下方' : `從頭頂往下約 ${down}% 的高度`;
  const offset = note.bx - 0.5;
  const screen = Math.abs(offset) < 0.12 ? 'center' : offset < 0 ? 'left' : 'right';
  const own = ownSide[note.view]?.[screen];
  const half = visibleHalf[note.view] ? `；這個角度看到的是角色的${visibleHalf[note.view]}` : '';
  return `${height}・${screen === 'center' ? '畫面中間' : screen === 'left' ? '畫面左邊' : '畫面右邊'}${own ? `（${own}）` : ''}${half}`;
}

export function viewNotesText(state) {
  const notes = state.viewNotes || [];
  if (!notes.length) return '';
  return `設計標註（設計師標在角度圖上的重點，每一條都要照做；畫別的角度時，照同一個部位換算到看得到的位置，看不到就不用畫）：\n${notes.map((note, index) => `${index + 1}. 〔${turnaroundLabels[note.view] || note.view}・${notePlaceText(note)}〕${note.title ? `${note.title}：` : ''}${note.text}`).join('\n')}`;
}
