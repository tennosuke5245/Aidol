import { useEffect, useMemo, useRef, useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { getLocale, useT } from './i18n';
import { L } from './lib-i18n';
import { Busy, Modal } from './Panels';
import { readPreference, writePreference } from './drafts';
import { buildSheet, safeFileName, sheetAvailability, SHEET_SECTIONS } from '../shared/model-sheet.mjs';
import { allViews } from '../shared/domain.mjs';
import { downloadCanvas, renderSheet } from './sheet/renderSheet';

// 設定資料集（2026-10-14 起）：把角色排成一張長圖交給客戶。勾要放的區塊、改標題，右邊即時預覽，下載 PNG。
// 圖在瀏覽器裡排（本機核心的同源圖），不上傳、不呼叫 AI。
export function ModelSheet({ project, onClose, notify }) {
  const t = useT();
  const character = project.character;
  const locale = getLocale();
  const available = useMemo(() => sheetAvailability(project, L), [project, locale]);
  const [sections, setSections] = useState(() => {
    const saved = readPreference('sheet-sections', SHEET_SECTIONS);
    return new Set(Array.isArray(saved) ? saved.filter(id => SHEET_SECTIONS.includes(id)) : SHEET_SECTIONS);
  });
  const [title, setTitle] = useState(character.name);
  const [subtitle, setSubtitle] = useState(() => (character.persona?.traits || []).filter(Boolean).join(t('sheet.separator')));
  const [theme, setTheme] = useState(() => (readPreference('sheet-theme', 'light') === 'dark' ? 'dark' : 'light'));
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const preview = useRef(null);
  const latest = useRef(null);
  const images = useRef(new Map());

  const labels = useMemo(() => ({
    separator: t('sheet.separator'), metaSeparator: t('sheet.metaSeparator'),
    profileTitle: t('sheet.section.profile'), turnaroundTitle: t('sheet.section.turnaround'), expressionsTitle: t('sheet.section.expressions'),
    outfitsTitle: t('sheet.section.outfits'), gearTitle: t('sheet.section.gear'), paletteTitle: t('sheet.section.palette'), notesTitle: t('sheet.notes'),
    species: t('sheet.field.species'), body: t('sheet.field.body'), skin: t('sheet.field.skin'), hair: t('sheet.field.hair'), eyes: t('sheet.field.eyes'), face: t('sheet.field.face'),
    locks: t('sheet.locks'), staleSuffix: t('sheet.stale'), mainBadge: t('creator.wardrobe.main'), untitledOutfit: t('creator.outfit.untitled'),
    heterochromia: (right, left) => t('sheet.heterochromia', { right, left }),
    noteHeading: (noteTitle, view) => t('sheet.noteHeading', { title: noteTitle, view }),
    featureColor: color => t('sheet.featureColor', { color }),
    views: Object.fromEntries(allViews.map(view => [view, t(`canvas.views.view.${view}`)])),
  }), [t, locale]);

  // 內容沒變就是同一份（背景有工作在跑時，畫面每幾秒拿到新的專案資料，內容一樣就不重排大圖）。
  const specText = useMemo(() => JSON.stringify({
    ...buildSheet(project, { sections: [...sections], title, subtitle }, L, labels),
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date()),
  }), [project, sections, title, subtitle, labels, locale]);
  const spec = useMemo(() => JSON.parse(specText), [specText]);

  // 改了選項就重排預覽（打字時等一下再排，不要每個字都重畫一張大圖）。
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setRendering(true); setFailed(false);
      try {
        const canvas = await renderSheet(spec, { theme, cache: images.current });
        if (cancelled) return;
        latest.current = { canvas, spec, theme };
        preview.current?.replaceChildren(canvas);
        setScale(Number(canvas.dataset.scale) || 1);
      } catch { if (!cancelled) setFailed(true); }
      finally { if (!cancelled) setRendering(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [spec, theme]);

  const toggle = id => setSections(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    writePreference('sheet-sections', [...next]);
    return next;
  });
  const pickTheme = value => { setTheme(value); writePreference('sheet-theme', value); };

  async function download() {
    setDownloading(true);
    try {
      const current = latest.current?.spec === spec && latest.current.theme === theme ? latest.current.canvas : await renderSheet(spec, { theme, cache: images.current });
      await downloadCanvas(current, t('sheet.fileName', { name: safeFileName(title || character.name) }));
      notify?.(t('sheet.downloaded'));
    } catch { notify?.(t('sheet.failed'), true); }
    finally { setDownloading(false); }
  }

  const empty = !spec.sections.length;
  return <Modal title={t('sheet.title')} subtitle={t('sheet.subtitle')} className="modal-full sheet-modal" onClose={onClose}>
    <div className="sheet-body">
      <aside className="sheet-options">
        <label className="field"><span>{t('sheet.titleLabel')}</span><input value={title} maxLength={80} onChange={event => setTitle(event.target.value)} /></label>
        <label className="field"><span>{t('sheet.subtitleLabel')}</span><input value={subtitle} maxLength={160} placeholder={t('sheet.subtitlePlaceholder')} onChange={event => setSubtitle(event.target.value)} /></label>
        <fieldset className="sheet-sections">
          <legend>{t('sheet.include')}</legend>
          {SHEET_SECTIONS.map(id => {
            const count = available[id];
            return <label key={id} className={`sheet-section${count ? '' : ' is-empty'}`}>
              <input type="checkbox" checked={Boolean(count) && sections.has(id)} disabled={!count} onChange={() => toggle(id)} />
              <span><b>{t(`sheet.section.${id}`)}</b><small>{!count ? t(`sheet.empty.${id}`) : id === 'portrait' || id === 'profile' ? t(`sheet.ready.${id}`) : t(`sheet.count.${id}`, { count })}</small></span>
            </label>;
          })}
        </fieldset>
        <div className="field"><span>{t('sheet.theme')}</span><div className="count-seg" role="group" aria-label={t('sheet.theme')}>
          {['light', 'dark'].map(value => <button type="button" key={value} aria-pressed={theme === value} onClick={() => pickTheme(value)}>{t(`sheet.themes.${value}`)}</button>)}
        </div></div>
        <button type="button" className="btn btn-primary btn-lg btn-block" disabled={downloading || empty} onClick={download}>{downloading ? <Busy>{t('sheet.downloading')}</Busy> : <><DownloadSimple size={17} weight="bold" />{t('sheet.download')}</>}</button>
        {scale < 1 && !empty && <p className="hint sheet-scaled">{t('sheet.scaled', { percent: Math.round(scale * 100) })}</p>}
        <p className="hint">{t('sheet.hint')}</p>
      </aside>
      <div className="sheet-preview-wrap" aria-busy={rendering}>
        {rendering && !empty && <div className="sheet-status"><span><Busy>{t('sheet.rendering')}</Busy></span></div>}
        {failed && !empty && <p className="sheet-failed" role="alert">{t('sheet.failed')}</p>}
        {empty ? <p className="hint sheet-empty">{t('sheet.nothing')}</p> : <div className={`sheet-preview${rendering || failed ? ' is-stale' : ''}`} ref={preview} role="img" aria-label={t('sheet.previewLabel', { name: title || character.name })} />}
      </div>
    </div>
  </Modal>;
}
