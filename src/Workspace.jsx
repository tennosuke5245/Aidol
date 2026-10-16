import { ArrowCounterClockwise, ArrowClockwise, CaretLeft, Check, CircleNotch, ClockCounterClockwise, DotsThree, DownloadSimple, IdentificationCard, Images, Robot, SlidersHorizontal, Smiley, Translate, Trash, WarningCircle } from '@phosphor-icons/react';
import { expressionName } from './Expressions';
import { LanguageOptions, Mark } from './ui';
import { useT } from './i18n';
import { useDraft } from './useDraft';
import { CanvasView } from './CanvasView';
import { Creator } from './creator/Creator';
import { mainOutfitId } from '../shared/wardrobe.mjs';
import { outfitStepName } from './api';

// 角色工作台：同一份自動存檔的草稿，切換「畫布」（看關係）與「捏角色」（改外觀、畫圖）。
export function Workspace({ studio, project, outfitId, onOutfit, app, mode }) {
  // 畫布上一律是正式立繪：已經有正式立繪時，裝備、穿戴狀態都看主要那套（其他套在捏角色的衣櫃裡改）。
  const canvasOutfit = project.character.adopted?.character ? mainOutfitId(project) : outfitId;
  const t = useT();
  const d = useDraft(studio, project);
  const saveLabel = { saved: <><Check size={13} weight="bold" />{t('workspace.save.saved')}</>, pending: <><CircleNotch size={13} className="spin" />{t('workspace.save.saving')}</>, saving: <><CircleNotch size={13} className="spin" />{t('workspace.save.saving')}</>, error: <><WarningCircle size={13} weight="bold" />{t('workspace.save.error')}</> }[d.saveState];
  const imageCount = project.assets.filter(asset => asset.role === 'design').length;
  const closeMenu = event => { event.currentTarget.closest('details').open = false; };
  // 全自動：跑著的時候按鈕上顯示正在做什麼。
  const autopilot = project.autopilot;
  const autopilotRunning = autopilot?.status === 'running';
  const stepName = step => (step.view === 'expression' ? t('expressions.stepName', { name: expressionName(project, step.expression) }) : step.view === 'outfit' ? outfitStepName(project, step.outfitId) : t(`canvas.views.view.${step.view}`));
  const autopilotLabel = autopilotRunning ? (autopilot.step?.kind === 'draw' ? t(autopilot.step.phase === 'reviewing' ? 'workspace.autopilotReviewing' : 'workspace.autopilotDrawing', { view: stepName(autopilot.step) }) : t('workspace.autopilotRunning')) : t('workspace.autopilot');
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
        <button type="button" className={`top-btn ${autopilotRunning ? 'is-live' : ''}`} aria-label={autopilotLabel} title={t('workspace.autopilotTitle')} onClick={() => app.openDrawer('autopilot')}>{autopilotRunning ? <CircleNotch size={17} className="spin" /> : <Robot size={17} />}<span className="top-btn-label">{autopilotLabel}</span></button>
        <button type="button" className="top-btn" aria-label={t('expressions.button')} title={t('expressions.buttonTitle')} onClick={() => app.openDrawer('expressions')}><Smiley size={17} /><span className="top-btn-label">{t('expressions.button')}</span></button>
        <button type="button" className="top-btn" aria-label={imageCount > 0 ? t('workspace.galleryCount', { count: imageCount }) : t('workspace.gallery')} title={t('workspace.gallery')} onClick={app.goGallery}><Images size={17} /><span className="top-btn-label">{t('workspace.gallery')}</span>{imageCount > 0 && <span className="top-count num">{imageCount}</span>}</button>
        <details className="menu">
          <summary className="icon-btn" aria-label={t('workspace.more')}><DotsThree size={22} weight="bold" /></summary>
          <div className="menu-panel">
            <button type="button" onClick={event => { closeMenu(event); app.openDrawer('history'); }}><ClockCounterClockwise size={16} />{t('workspace.menu.history')}</button>
            <button type="button" onClick={event => { closeMenu(event); app.openSheet(); }}><IdentificationCard size={16} />{t('sheet.menu')}</button>
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
        : <CanvasView studio={studio} project={project} outfitId={canvasOutfit} app={app} d={d} />}
    </div>
  </div>;
}
