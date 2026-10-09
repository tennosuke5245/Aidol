// 選項縮圖：每個選項各一張單獨生成的中性人台圖（透明背景、WebP）。
// 人台沒有長相，只有對應的部位不同（髮型只換頭髮、眼型只畫眼睛…），讓差別一眼就看得出來。
const files = import.meta.glob('./assets/options/**/*.webp', { eager: true, import: 'default' });

export function optionArt(group, id) {
  return files[`./assets/options/${group}/${id}.webp`] || null;
}

export const figureArt = files['./assets/options/figure.webp'] || null;
