import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';
import { useStudio } from './useStudio';
import { CharacterSelect } from './CharacterSelect';
import { Workspace } from './Workspace';
import { Gallery } from './Gallery';
import { Summon } from './Summon';
import { AutopilotPanel } from './Autopilot';
import { ExpressionPanel, expressionName } from './Expressions';
import { ImagePreview } from './ImagePreview';
import { ModelSheet } from './ModelSheet';
import { Busy, DeleteCharacterConfirm, HistoryList, Modal, NewCharacterForm, SettingsPanel, TrashList } from './Panels';
import { Drawer, Lockup } from './ui';
import { api, messageOf, targetLabel } from './api';
import { t, useLocale } from './i18n';
import { isAngleView } from '../shared/domain.mjs';
import { expressionList } from '../shared/expressions.mjs';
import { isOutfitVariant, mainOutfitId, OUTFIT_LIMIT, removedOutfitSnapshot, restoreOutfit } from '../shared/wardrobe.mjs';
import { writePreference } from './drafts';

// 預設的繪製要求用使用者目前的語言寫（Codex 讀得懂各種語言）。
// 三視圖：有定稿照定稿；已經有正式立繪（補畫三視圖）照立繪的設計；都沒有就照設定畫。
// redo：這個角度已經有一張（重畫）。
function defaultPrompt(character, targetId, view = 'front', framing, redo = false, project = null, expression = null, outfitId = null) {
  const canon = (character.style?.references || []).some(reference => reference.canon);
  // 另一套穿搭：照正式立繪的臉、髮型、身形，只換衣服（採用後放進衣櫃）。
  if (targetId === 'character' && view === 'front' && project && isOutfitVariant(project, outfitId)) return t('app.prompt.outfit', { name: character.name, outfit: character.outfits[outfitId]?.name || t('creator.outfit.untitled') });
  // 畫三視圖的單一角度（側面或背面）：照正面畫。
  if (targetId === 'character' && isAngleView(view)) return t(redo ? 'app.prompt.redrawView' : 'app.prompt.drawView', { name: character.name, view: t(`canvas.views.view.${view}`) });
  if (targetId === 'character' && view === 'expression') return t('app.prompt.expression', { name: character.name, expression: expressionName(project, expression) });
  if (targetId === 'character' && framing === 'frontView') return t(canon ? 'app.prompt.frontCanon' : character.adopted?.character ? 'app.prompt.frontFromPortrait' : 'app.prompt.front', { name: character.name });
  if (targetId === 'character' && framing === 'turnaround') return t(canon ? 'app.prompt.turnaroundCanon' : character.adopted?.character ? 'app.prompt.turnaroundFromPortrait' : 'app.prompt.turnaround', { name: character.name });
  if (targetId === 'character') return canon ? t('app.prompt.characterCanon', { name: character.name }) : t('app.prompt.character', { name: character.name });
  const part = character.components[targetId];
  return t('app.prompt.part', { name: part?.name || t('app.prompt.partFallback'), view: t(`app.prompt.view.${view}`, { defaultValue: '' }), description: part?.description || '' }).trim();
}

export function App() {
  useLocale();
  const studio = useStudio();
  const { project, projects, busy, run, notify } = studio;
  const [view, setView] = useState({ name: 'select' });
  const [mode, setMode] = useState('canvas');
  const [outfitId, setOutfitId] = useState(null);
  const [summonId, setSummonId] = useState(null);
  // 要捏角色切到某一頁（例如全自動畫完衣櫃後「到服裝頁看」）：捏角色開著的話也會切過去。
  const [creatorFocus, setCreatorFocus] = useState(null);
  const [modal, setModal] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [chatPending, setChatPending] = useState(false);
  useEffect(() => { if (!studio.loading && studio.rememberedId) setView({ name: 'workspace' }); }, [studio.loading, studio.rememberedId]);
  // 沒選或選的套裝不在這個角色：選正式立繪那套（還沒有正式立繪就是第一套）。
  useEffect(() => { if (project && !project.character.outfits[outfitId]) setOutfitId(mainOutfitId(project)); }, [project, outfitId]);
  useEffect(() => { document.documentElement.removeAttribute('data-theme'); }, []);

  const preview = useCallback((asset, title) => setModal({ type: 'preview', asset, title }), []);
  // 打開角色：套裝從正式立繪那套開始（上一個角色選的套裝代號不帶過來）。
  const openProject = id => run(async () => { await studio.openProject(id); setOutfitId(null); setSummonId(null); setMode('canvas'); setView({ name: 'workspace' }); });
  const openJob = (projectId, jobId) => run(async () => { if (project?.id !== projectId) { await studio.openProject(projectId); setOutfitId(null); } else studio.rememberProject(projectId); setView({ name: 'workspace' }); setSummonId(jobId); });

  // 開始繪製：建立工作 → 準備交接 → 開好 Codex 新對話 → 打開翻牌畫面。
  const draw = ({ targetId = 'character', note = '', variants = 1, framing, view: outputView = 'front', baseRevision, outfitId: chosen, region, kind = 'generate', prompt, expression }) => run(async () => {
    const character = project.character;
    // 畫側面、背面、表情：固定的要求加上使用者這次寫的（重畫時是「要修正」）。
    const expressionJob = targetId === 'character' && outputView === 'expression';
    const viewJob = targetId === 'character' && (isAngleView(outputView) || expressionJob);
    const redo = viewJob && Boolean(expressionJob ? project.expressions?.items?.[expression] : project.views?.items?.[outputView]);
    const text = prompt || (viewJob ? [defaultPrompt(character, targetId, outputView, framing, redo, project, expression), note.trim() && t(redo ? 'app.prompt.viewFix' : 'app.prompt.viewNote', { note: note.trim() })].filter(Boolean).join('\n') : note.trim() || defaultPrompt(character, targetId, outputView, framing, false, project, null, chosen || outfitId));
    const { job } = await studio.generate({
      targetId, outfitId: chosen || outfitId, outputView: targetId === 'character' && !viewJob ? 'front' : outputView, kind, prompt: text, variants,
      ...(expressionJob ? { expression } : {}), ...(targetId === 'character' && framing && !viewJob ? { framing } : {}), ...(region ? { region } : {}), ...(baseRevision ? { baseRevision } : {}),
    });
    setSummonId(job.id);
    return job;
  });

  // drawWardrobe：衣櫃「全部畫完」（2026-10-14 起），交給全自動、只畫還沒有立繪的另一套穿搭；openWardrobe：到捏角色的服裝頁看衣櫃。
  const app = {
    goSelect: () => { studio.refreshProjects(); studio.forgetCurrentProject(); setSummonId(null); setView({ name: 'select' }); },
    drawWardrobe: variants => run(async () => { await studio.startAutopilot({ views: [], variants, expressions: false, outfits: true }); notify(t('autopilot.startedOutfits')); setDrawer('autopilot'); }),
    openWardrobe: () => { setDrawer(null); setMode('creator'); writePreference('category', 'outfit'); setCreatorFocus({ category: 'outfit', key: Date.now() }); setView({ name: 'workspace' }); },
    creatorFocus, clearCreatorFocus: () => setCreatorFocus(null),
    cancelJob: jobId => run(async () => {
      await studio.cancelJob(jobId);
      if (summonId === jobId) setSummonId(null);
      notify(t('app.jobCancelled'));
    }),
    goGallery: () => setView({ name: 'gallery' }),
    goCanvas: () => { setMode('canvas'); setView({ name: 'workspace' }); },
    goCreator: () => { setMode('creator'); setView({ name: 'workspace' }); },
    decompose: () => run(() => studio.decompose()),
    openSummon: setSummonId,
    openDrawer: setDrawer,
    openSheet: () => setModal({ type: 'sheet' }),
    preview,
    draw,
    chatPending,
    sendChat: async (text, options) => {
      setChatPending(true);
      try { return await studio.sendChat(text, options); }
      catch (error) { notify(t('app.chatFailed', { message: messageOf(error) }), true); return undefined; }
      finally { setChatPending(false); }
    },
    applyProposal: (id, { thenDraw, baseRevision } = {}) => run(async () => {
      const accepted = await studio.acceptProposal(id, baseRevision);
      notify(accepted.notice === 'MAIN_OUTFIT_KEPT' ? t('app.proposalAppliedKept') : t('app.proposalApplied'), accepted.notice === 'MAIN_OUTFIT_KEPT');
      if (thenDraw) {
        // 第一張畫三視圖（採用後自動拆成正面、側面、背面）。
        const framing = accepted.character.adopted?.character ? 'sheet' : 'frontView';
        // 已經有正式立繪：用主要那套畫（用別套會變成衣櫃裡的另一張）。
        // 提案已經套用了：接著畫失敗也照樣回傳（捏角色的「復原」才知道這次確實改了設定）。
        try {
          const { job } = await studio.generate({ targetId: 'character', outfitId: accepted.character.adopted?.character ? mainOutfitId(accepted) : Object.keys(accepted.character.outfits)[0], outputView: 'front', kind: 'generate', prompt: defaultPrompt(accepted.character, 'character', 'front', framing), variants: 2, framing, baseRevision: accepted.character.revision });
          setSummonId(job.id);
        } catch (error) { notify(messageOf(error), true); }
      }
      return accepted;
    }),
    dismissProposal: id => run(() => studio.dismissProposal(id)),
    askDelete: () => setModal({ type: 'delete', target: { id: project.id, name: project.character.name, imageCount: project.assets.filter(asset => asset.role === 'design').length, drawing: project.decomposition?.status === 'running' || project.jobs.some(job => ['running', 'handed_off'].includes(job.status) || (job.progress?.startedAt && !job.progress?.finishedAt)) } }),
  };

  // 刪除角色：移到資源回收區後回到角色選單，提示上有「復原」。
  const deleteCharacter = target => run(async () => {
    const removed = await studio.deleteProject(target.id);
    setModal(null); setSummonId(null); setView({ name: 'select' });
    // 提示上的「復原」不走 run 的鎖：其他操作進行中時按下也不會被吞掉。
    notify(t('app.delete.done', { name: removed.name }), false, {
      label: t('app.delete.undo'),
      run: async () => {
        try { await studio.restoreProject(removed.trashId); notify(t('app.delete.restored', { name: removed.name })); }
        catch (error) { notify(messageOf(error), true); }
      },
    });
  });

  async function createCharacter({ name, brief, file, role, canon }) {
    const created = await run(() => studio.createProject({ name, brief, file, role, canon }));
    if (!created) return;
    setModal(null); setOutfitId(Object.keys(created.character.outfits)[0]); setMode('creator'); setView({ name: 'workspace' });
    writePreference('category', 'persona');
    // 附了定稿：請 AI 照圖把外觀填進設定（和簡介一起送一次）。寫好的會先列出來，使用者按套用才改。
    if (canon && file) {
      notify(t('app.readingCanon'));
      app.sendChat([t('creator.persona.readCanonRequest'), brief ? `${t('app.briefRequest', { name })}\n${brief}` : ''].filter(Boolean).join('\n'), { readCanon: true });
    } else if (brief) {
      notify(t('app.writingFromBrief'));
      app.sendChat(`${t('app.briefRequest', { name })}\n${brief}`);
    }
  }

  // 設為正式立繪後回到畫布：核心會自動拆解裝備，畫布上會長出配件節點並連線。
  const adopt = candidate => run(async () => {
    // 另一套穿搭的立繪放進衣櫃：回到捏角色看那套（畫布上一律是正式立繪）。
    const candidateOutfit = candidate.outfitId || project.jobs.find(job => job.id === candidate.jobId)?.outfitId;
    const outfitShot = candidate.targetId === 'character' && (candidate.view || 'front') === 'front' && isOutfitVariant(project, candidateOutfit);
    const result = await studio.acceptCandidate(candidate);
    // 表情只放進表情集：關掉翻牌畫面回到原本的地方（從表情抽屜來的就回到抽屜），不切到畫布。
    if (result && candidate.targetId === 'character' && view.name === 'workspace') {
      setSummonId(null);
      if (outfitShot) { setOutfitId(candidateOutfit); setMode('creator'); }
      else if (candidate.view !== 'expression') setMode('canvas');
    }
    return result;
  });
  // 另一套穿搭的立繪改成正式立繪（圖鑑裡的按鈕）。
  const adoptAsMain = candidate => run(() => studio.acceptCandidate(candidate, { asMain: true }));
  const promoteOutfit = outfit => run(() => studio.promoteOutfit(outfit));
  const reopen = jobId => run(() => studio.handoff(jobId));
  const copyPrompt = jobId => run(async () => { const result = await studio.handoff(jobId, { open: false }); await studio.copy(result.prompt); });
  // 再畫一次、局部修改：用原本那張的穿搭（不是目前選的那套），正式立繪才不會被畫成另一套的衣櫃圖。
  // 那套已經不在了（舊資料、刪掉的套裝）：有正式立繪時用主要那套，不退回目前選的套裝（選到別套會畫成那套的衣櫃圖）。
  // 刪掉的套裝自己的立繪不會走到這裡（圖鑑、翻牌畫面不給再畫一次）。
  const knownOutfit = id => (id && project?.character.outfits[id] ? { outfitId: id } : project?.character.adopted?.character ? { outfitId: mainOutfitId(project) } : {});
  const redraw = job => draw({ targetId: job.targetId, view: job.outputView, variants: job.variants || 1, framing: job.framing, prompt: job.prompt, ...(job.expression ? { expression: job.expression } : {}), ...knownOutfit(job.outfitId) });
  // 正式立繪一律用主要那套（舊資料裡它畫的時候那套可能已經不在了，不能退回目前選的套裝）。
  const refine = (asset, { note, region, variants }) => draw({ targetId: asset.targetId, view: asset.view || 'front', variants, region, kind: 'refine', prompt: note.trim(), ...(asset.targetId !== 'character' ? {} : asset.id === project?.character.adopted?.character ? { outfitId: mainOutfitId(project) } : knownOutfit(asset.outfitId)) });
  // 圖鑑、翻牌畫面的「復原套裝」：把刪掉的套裝照存檔紀錄裡最後的樣子放回原位，那套的圖就能採用、衣櫃那張也回來。
  const restoreRemovedOutfit = outfitId => run(async () => {
    const latest = await api(`/projects/${project.id}`);
    const snapshot = removedOutfitSnapshot(latest, outfitId);
    if (!snapshot) return;
    const character = structuredClone(latest.character);
    if (!restoreOutfit(character, outfitId, snapshot.outfit, snapshot.index)) { notify(t('creator.wardrobe.full', { limit: OUTFIT_LIMIT }), true); return; }
    await studio.saveCharacter(character, t('creator.wardrobe.restored', { name: snapshot.outfit.name || t('creator.outfit.untitled') }), latest.character.revision);
  });
  // 從表情集拿掉一格：提示上有「復原」（放回原本的位置，畫好的那張也一起放回去）。
  const removeExpression = key => run(async () => {
    const expressions = project.expressions;
    const snapshot = { key, index: expressionList(expressions).indexOf(key), ...(expressions?.custom?.[key] ? { custom: expressions.custom[key] } : {}), ...(expressions?.items?.[key] ? { item: expressions.items[key] } : {}) };
    const name = expressionName(project, key);
    await studio.removeExpression(key);
    notify(t('expressions.removed', { name }), false, {
      label: t('expressions.undo'),
      run: async () => {
        try { await studio.addExpression({ restore: snapshot }); } catch (error) { notify(messageOf(error), true); }
      },
    });
  });

  if (studio.loading) return <div className="loading-screen"><Lockup height={44} /><Busy>{t('app.opening')}</Busy></div>;
  if (studio.fatal) return <div className="loading-screen"><WarningCircle size={36} /><h2 className="display">{t('app.notConnected')}</h2><p>{studio.fatal}</p><button type="button" className="btn btn-primary btn-lg" onClick={studio.initialize}>{t('app.reconnect')}</button></div>;

  const name = view.name !== 'select' && project ? view.name : 'select';
  // 翻牌畫面開著時先把抽屜收起來（不然抽屜會蓋住翻牌畫面）；關掉翻牌畫面後抽屜會回來。
  const summonOpen = Boolean(summonId && project && name !== 'select');
  const shownDrawer = summonOpen ? null : drawer;
  return <div className="app">
    {name === 'select' && <CharacterSelect projects={projects} onOpen={openProject} onOpenJob={openJob} onNew={() => setModal({ type: 'new' })} onDelete={item => setModal({ type: 'delete', target: { id: item.id, name: item.name, imageCount: item.imageCount, drawing: item.drawingCount > 0 } })} trashCount={studio.trash.length} onTrash={() => { studio.refreshTrash(); setDrawer('trash'); }} />}
    {name === 'workspace' && <Workspace key={project.id} studio={studio} project={project} outfitId={outfitId} onOutfit={setOutfitId} app={app} mode={mode} />}
    {name === 'gallery' && <Gallery project={project} busy={busy} onBack={() => setView({ name: 'workspace' })} onAdopt={adopt} onAdoptMain={adoptAsMain} onPromote={promoteOutfit} onPreview={preview} onSummon={setSummonId} onRedraw={redraw} onRefine={refine} onRestoreOutfit={restoreRemovedOutfit} onSheet={app.openSheet} onCancelJob={app.cancelJob} onImport={(job, file) => run(() => studio.importCandidate(job, file))} />}

    {summonOpen && <Summon project={project} jobId={summonId} busy={busy} onCancel={app.cancelJob} canDrawDirect={studio.canDrawDirect} canReview={Boolean(studio.status?.available)} onClose={() => setSummonId(null)} onAdopt={adopt} onReopen={reopen} onCopy={copyPrompt} onPreview={preview} onGallery={() => { setSummonId(null); setDrawer(null); setView({ name: 'gallery' }); }}
      onDraw={jobId => run(() => studio.drawJob(jobId))} onStop={jobId => run(() => studio.stopDraw(jobId))} onReview={jobId => run(() => studio.reviewJob(jobId))} onRestoreOutfit={restoreRemovedOutfit} />}

    {modal?.type === 'new' && <Modal title={t('app.newCharacter.title')} subtitle={t('app.newCharacter.subtitle')} onClose={() => setModal(null)}><NewCharacterForm busy={busy} onCreate={createCharacter} /></Modal>}
    {modal?.type === 'delete' && <Modal title={t('app.delete.title')} onClose={() => setModal(null)}><DeleteCharacterConfirm {...modal.target} busy={busy} onCancel={() => setModal(null)} onConfirm={() => deleteCharacter(modal.target)} /></Modal>}
    {modal?.type === 'preview' && <Modal title={modal.title || targetLabel(project, modal.asset.targetId)} wide onClose={() => setModal(null)}><ImagePreview asset={modal.asset} title={modal.title} /></Modal>}
    {modal?.type === 'sheet' && project && <ModelSheet project={project} notify={notify} onClose={() => setModal(null)} />}
    {shownDrawer === 'settings' && project && <Drawer title={t('app.settingsTitle')} onClose={() => setDrawer(null)}><SettingsPanel project={project} status={studio.status} busy={busy} onRefresh={studio.refreshStatus}
      drawWith={studio.drawWith} canDrawDirect={studio.canDrawDirect} onDrawWith={mode => run(() => studio.setDrawWith(mode))}
      onInstall={() => run(async () => { await api('/codex/skill/install', { method: 'POST', body: {} }); await studio.refreshStatus(); notify(t('app.skillInstalled')); })}
      onYaml={(yaml, base) => run(async () => { const { notice, ...saved } = await api(`/projects/${project.id}/character`, { method: 'PUT', body: { baseRevision: base, yaml } }); studio.updateProject(saved); studio.refreshProjects(); setDrawer(null); notify(notice === 'MAIN_OUTFIT_KEPT' ? t('app.yamlSavedKept') : t('app.yamlSaved'), notice === 'MAIN_OUTFIT_KEPT'); })} /></Drawer>}
    {shownDrawer === 'trash' && <Drawer title={t('app.trash.title')} onClose={() => setDrawer(null)}><p className="hint">{t('app.trash.hint')}</p><TrashList items={studio.trash} busy={busy}
      onRestore={item => run(async () => { await studio.restoreProject(item.trashId); notify(t('app.delete.restored', { name: item.name })); })}
      onPurge={item => run(async () => { await studio.purgeTrash(item.trashId); notify(t('app.trash.purged', { name: item.name })); })} /></Drawer>}
    {shownDrawer === 'autopilot' && project && <Drawer title={t('autopilot.title')} onClose={() => setDrawer(null)}><AutopilotPanel project={project} busy={busy} loadAccess={studio.drawAccess}
      onStart={config => run(async () => { await studio.startAutopilot({ ...config, ...(outfitId ? { outfitId } : {}) }); notify(t((config.expressions || config.outfits) && !config.views?.length && project.character.adopted.character ? (config.expressions && config.outfits ? 'autopilot.startedExtras' : config.outfits ? 'autopilot.startedOutfits' : 'autopilot.startedFaces') : 'autopilot.started')); })} onStop={() => run(() => studio.stopAutopilot())}
      onOpenJob={setSummonId} onOpenExpressions={() => setDrawer('expressions')} onOpenWardrobe={app.openWardrobe} /></Drawer>}
    {shownDrawer === 'expressions' && project && <Drawer title={t('expressions.title')} onClose={() => setDrawer(null)}><ExpressionPanel project={project} busy={busy} canAuto={studio.canDrawDirect}
      onDraw={({ expression, variants, note }) => draw({ targetId: 'character', view: 'expression', expression, variants, note })}
      onAdd={input => run(() => studio.addExpression(input))} onRemove={removeExpression}
      onOpenJob={setSummonId} onPreview={preview}
      onAutopilot={variants => run(async () => { await studio.startAutopilot({ views: [], variants, expressions: true, ...(outfitId ? { outfitId } : {}) }); notify(t('autopilot.startedFaces')); setDrawer('autopilot'); })} /></Drawer>}
    {shownDrawer === 'history' && project && <Drawer title={t('app.history.title')} onClose={() => setDrawer(null)}><p className="hint">{t('app.history.hint')}</p><HistoryList project={project} busy={busy} onRestore={entry => run(async () => { await studio.restore(entry.id); setDrawer(null); notify(t('app.history.restored')); })} /></Drawer>}

    {studio.toast && <div className={`toast ${studio.toast.error ? 'is-error' : ''}`} role={studio.toast.error ? 'alert' : 'status'} key={studio.toast.key}
      onMouseEnter={() => studio.setToastHeld(true)} onMouseLeave={() => studio.setToastHeld(false)} onFocus={() => studio.setToastHeld(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) studio.setToastHeld(false); }}>{studio.toast.error ? <WarningCircle size={18} weight="fill" /> : <CheckCircle size={18} weight="fill" />}<span>{studio.toast.message}</span>{studio.toast.action && <button type="button" className="btn btn-text toast-action" onClick={() => { const { action } = studio.toast; studio.setToast(null); action.run(); }}>{studio.toast.action.label}</button>}<button type="button" className="icon-btn" aria-label={t('app.closeToast')} onClick={() => studio.setToast(null)}><X size={14} /></button></div>}
  </div>;
}
