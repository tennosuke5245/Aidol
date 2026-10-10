import { ArrowCounterClockwise, ArrowClockwise, CaretLeft, Check, CircleNotch, ClockCounterClockwise, DotsThree, DownloadSimple, Images, SlidersHorizontal, Translate, Trash, WarningCircle } from '@phosphor-icons/react';
import { LanguageOptions, Mark } from './ui';
import { useT } from './i18n';
import { useDraft } from './useDraft';
import { CanvasView } from './CanvasView';
import { Creator } from './creator/Creator';

// 角色工作台：同一份自動存檔的草稿，切換「畫布」（看關係）與「捏角色」（改外觀、畫圖）。
export function Workspace({ studio, project, outfitId, onOutfit, app, mode }) {
  const t = useT();
  const d = useDraft(studio, project);
  const saveLabel = { saved: <><Check size={13} weight="bold" />{t('workspace.save.saved')}</>, pending: <><CircleNotch size={13} className="spin" />{t('workspace.save.saving')}</>, saving: <><CircleNotch size={13} className="spin" />{t('workspace.save.saving')}</>, error: <><WarningCircle size={13} weight="bold" />{t('workspace.save.error')}</> }[d.saveState];
  const imageCount = project.assets.filter(asset => asset.role === 'design').length;
  const closeMenu = event => { event.currentTarget.closest('details').open = false; };
  return <div className="workspace">
    <header className="game-top">
      {mode === 'creator'
        ? <button type="button" className="top-back" onClick={app.goCanvas}><CaretLeft size={16} weight="bold" />{t('workspace.backToCanvas')}</button>
        : <button type="button" className="top-back" onClick={app.goSelect}><CaretLeft size={16} weight="bold" />{t('workspace.characters')}</button>}
      <div className="top-title"><Mark size={24} /><h1 className="display">{d.draft.name}</h1></div>
      <div className="top-save">
        <button type="button" className={`save-state is-${d.saveState}`} disabled={d.saveState !== 'error'} onClick={d.retry}>{saveLabel}</button>
        <button type="button" className="icon-btn" aria-label={t('workspace.undo')} title={t('workspace.undoShortcut')} disabled={!d.canUndo} onClick={d.undo}><ArrowCounterClockwise size={17} /></button>
        <button type="button" className="icon-btn" aria-label={t('workspace.redo')} title={t('workspace.redoShortcut')} disabled={!d.canRedo} onClick={d.redo}><ArrowClockwise size={17} /></button>
      </div>
      <div className="tabs top-modes" role="tablist" aria-label={t('workspace.view')}>
        <button type="button" role="tab" aria-selected={mode === 'canvas'} onClick={app.goCanvas}>{t('workspace.canvas')}</button>
        <button type="button" role="tab" aria-selected={mode === 'creator'} onClick={app.goCreator}>{t('workspace.creator')}</button>
      </div>
      <nav className="top-actions" aria-label={t('workspace.characterActions')}>
        <button type="button" className="top-btn" aria-label={imageCount > 0 ? t('workspace.galleryCount', { count: imageCount }) : t('workspace.gallery')} title={t('workspace.gallery')} onClick={app.goGallery}><Images size={17} /><span className="top-btn-label">{t('workspace.gallery')}</span>{imageCount > 0 && <span className="top-count num">{imageCount}</span>}</button>
        <details className="menu">
          <summary className="icon-btn" aria-label={t('workspace.more')}><DotsThree size={22} weight="bold" /></summary>
          <div className="menu-panel">
            <button type="button" onClick={event => { closeMenu(event); app.openDrawer('history'); }}><ClockCounterClockwise size={16} />{t('workspace.menu.history')}</button>
            <a href={`/api/projects/${project.id}/export`} onClick={closeMenu}><DownloadSimple size={16} />{t('workspace.menu.export')}</a>
            <button type="button" onClick={event => { closeMenu(event); app.openDrawer('settings'); }}><SlidersHorizontal size={16} />{t('workspace.menu.settings')}</button>
            <button type="button" className="is-danger" onClick={event => { closeMenu(event); app.askDelete(); }}><Trash size={16} />{t('workspace.menu.delete')}</button>
            <div className="menu-sep" role="separator" />
            <span className="menu-label" aria-hidden="true"><Translate size={13} />{t('ui.language')}</span>
            <LanguageOptions onPicked={closeMenu} />
          </div>
        </details>
      </nav>
    </header>
    <div className="workspace-body">
      {mode === 'creator'
        ? <Creator studio={studio} project={project} outfitId={outfitId} onOutfit={onOutfit} app={app} d={d} />
        : <CanvasView studio={studio} project={project} outfitId={outfitId} app={app} d={d} />}
    </div>
  </div>;
}
