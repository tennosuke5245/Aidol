import { ArrowCounterClockwise, ArrowClockwise, CaretLeft, Check, CircleNotch, ClockCounterClockwise, DotsThree, DownloadSimple, Images, SlidersHorizontal, WarningCircle } from '@phosphor-icons/react';
import { Mark } from './ui';
import { useDraft } from './useDraft';
import { CanvasView } from './CanvasView';
import { Creator } from './creator/Creator';

// 角色工作台：同一份自動存檔的草稿，切換「畫布」（看關係）與「捏角色」（改外觀、畫圖）。
export function Workspace({ studio, project, outfitId, onOutfit, app, mode }) {
  const d = useDraft(studio, project);
  const saveLabel = { saved: <><Check size={13} weight="bold" />已自動存檔</>, pending: <><CircleNotch size={13} className="spin" />存檔中</>, saving: <><CircleNotch size={13} className="spin" />存檔中</>, error: <><WarningCircle size={13} weight="bold" />存檔失敗，點這裡重試</> }[d.saveState];
  const imageCount = project.assets.filter(asset => asset.role === 'design').length;
  const closeMenu = event => { event.currentTarget.closest('details').open = false; };
  return <div className="workspace">
    <header className="game-top">
      {mode === 'creator'
        ? <button type="button" className="top-back" onClick={app.goCanvas}><CaretLeft size={16} weight="bold" />回到畫布</button>
        : <button type="button" className="top-back" onClick={app.goSelect}><CaretLeft size={16} weight="bold" />角色選單</button>}
      <div className="top-title"><Mark size={24} /><h1 className="display">{d.draft.name}</h1></div>
      <div className="top-save">
        <button type="button" className={`save-state is-${d.saveState}`} disabled={d.saveState !== 'error'} onClick={d.retry}>{saveLabel}</button>
        <button type="button" className="icon-btn" aria-label="復原" title="復原（Ctrl＋Z）" disabled={!d.canUndo} onClick={d.undo}><ArrowCounterClockwise size={17} /></button>
        <button type="button" className="icon-btn" aria-label="重做" title="重做（Ctrl＋Shift＋Z）" disabled={!d.canRedo} onClick={d.redo}><ArrowClockwise size={17} /></button>
      </div>
      <div className="tabs top-modes" role="tablist" aria-label="檢視">
        <button type="button" role="tab" aria-selected={mode === 'canvas'} onClick={app.goCanvas}>畫布</button>
        <button type="button" role="tab" aria-selected={mode === 'creator'} onClick={app.goCreator}>捏角色</button>
      </div>
      <nav className="top-actions" aria-label="角色">
        <button type="button" className="top-btn" aria-label={imageCount > 0 ? `圖鑑，${imageCount} 張圖` : "圖鑑"} title="圖鑑" onClick={app.goGallery}><Images size={17} /><span className="top-btn-label">圖鑑</span>{imageCount > 0 && <span className="top-count num">{imageCount}</span>}</button>
        <details className="menu">
          <summary className="icon-btn" aria-label="更多"><DotsThree size={22} weight="bold" /></summary>
          <div className="menu-panel">
            <button type="button" onClick={event => { closeMenu(event); app.openDrawer('history'); }}><ClockCounterClockwise size={16} />存檔紀錄</button>
            <a href={`/api/projects/${project.id}/export`} onClick={closeMenu}><DownloadSimple size={16} />匯出角色資料（ZIP）</a>
            <button type="button" onClick={event => { closeMenu(event); app.openDrawer('settings'); }}><SlidersHorizontal size={16} />原始設定檔與 Codex 連線</button>
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
