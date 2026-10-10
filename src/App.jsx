import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';
import { useStudio } from './useStudio';
import { CharacterSelect } from './CharacterSelect';
import { Workspace } from './Workspace';
import { Gallery } from './Gallery';
import { Summon } from './Summon';
import { ImagePreview } from './ImagePreview';
import { Busy, DeleteCharacterConfirm, HistoryList, Modal, NewCharacterForm, SettingsPanel, TrashList } from './Panels';
import { Drawer, Lockup } from './ui';
import { api, messageOf, targetLabel } from './api';
import { t, useLocale } from './i18n';

// 預設的繪製要求用使用者目前的語言寫（Codex 讀得懂各種語言）。
function defaultPrompt(character, targetId, view = 'front') {
  if (targetId === 'character') return t('app.prompt.character', { name: character.name });
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
  const [modal, setModal] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [chatPending, setChatPending] = useState(false);
  useEffect(() => { if (!studio.loading && studio.rememberedId) setView({ name: 'workspace' }); }, [studio.loading, studio.rememberedId]);
  useEffect(() => { if (project && !project.character.outfits[outfitId]) setOutfitId(Object.keys(project.character.outfits)[0] || null); }, [project, outfitId]);
  useEffect(() => { document.documentElement.removeAttribute('data-theme'); }, []);

  const preview = useCallback((asset, title) => setModal({ type: 'preview', asset, title }), []);
  const openProject = id => run(async () => { await studio.openProject(id); setSummonId(null); setMode('canvas'); setView({ name: 'workspace' }); });
  const openJob = (projectId, jobId) => run(async () => { if (project?.id !== projectId) await studio.openProject(projectId); setView({ name: 'workspace' }); setSummonId(jobId); });

  // 開始繪製：建立工作 → 準備交接 → 開好 Codex 新對話 → 打開翻牌畫面。
  const draw = ({ targetId = 'character', note = '', variants = 1, framing, view: outputView = 'front', baseRevision, outfitId: chosen, region, kind = 'generate', prompt }) => run(async () => {
    const character = project.character;
    const text = prompt || note.trim() || defaultPrompt(character, targetId, outputView);
    const { job } = await studio.generate({
      targetId, outfitId: chosen || outfitId, outputView: targetId === 'character' ? 'front' : outputView, kind, prompt: text, variants,
      ...(targetId === 'character' && framing ? { framing } : {}), ...(region ? { region } : {}), ...(baseRevision ? { baseRevision } : {}),
    });
    setSummonId(job.id);
    return job;
  });

  const app = {
    goSelect: () => { studio.refreshProjects(); setSummonId(null); setView({ name: 'select' }); },
    goGallery: () => setView({ name: 'gallery' }),
    goCanvas: () => { setMode('canvas'); setView({ name: 'workspace' }); },
    goCreator: () => { setMode('creator'); setView({ name: 'workspace' }); },
    decompose: () => run(() => studio.decompose()),
    openSummon: setSummonId,
    openDrawer: setDrawer,
    preview,
    draw,
    chatPending,
    sendChat: async text => {
      setChatPending(true);
      try { return await studio.sendChat(text); }
      catch (error) { notify(t('app.chatFailed', { message: messageOf(error) }), true); return undefined; }
      finally { setChatPending(false); }
    },
    applyProposal: (id, { thenDraw, baseRevision } = {}) => run(async () => {
      const accepted = await studio.acceptProposal(id, baseRevision);
      notify(t('app.proposalApplied'));
      if (thenDraw) {
        const { job } = await studio.generate({ targetId: 'character', outfitId: Object.keys(accepted.character.outfits)[0], outputView: 'front', kind: 'generate', prompt: defaultPrompt(accepted.character, 'character'), variants: 2, framing: 'sheet', baseRevision: accepted.character.revision });
        setSummonId(job.id);
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

  async function createCharacter({ name, brief, file, role }) {
    const created = await run(() => studio.createProject({ name, brief, file, role }));
    if (!created) return;
    setModal(null); setOutfitId(Object.keys(created.character.outfits)[0]); setMode('creator'); setView({ name: 'workspace' });
    try { localStorage.setItem('aidol-pref-category', JSON.stringify('persona')); } catch {}
    if (brief) {
      notify(t('app.writingFromBrief'));
      app.sendChat(`${t('app.briefRequest', { name })}\n${brief}`);
    }
  }

  // 設為正式立繪後回到畫布：核心會自動拆解裝備，畫布上會長出配件節點並連線。
  const adopt = candidate => run(async () => {
    const result = await studio.acceptCandidate(candidate);
    if (result && candidate.targetId === 'character' && view.name === 'workspace') { setSummonId(null); setMode('canvas'); }
    return result;
  });
  const reopen = jobId => run(() => studio.handoff(jobId));
  const copyPrompt = jobId => run(async () => { const result = await studio.handoff(jobId, { open: false }); await studio.copy(result.prompt); });
  const redraw = job => draw({ targetId: job.targetId, view: job.outputView, variants: job.variants || 1, framing: job.framing, prompt: job.prompt });
  const refine = (asset, { note, region, variants }) => draw({ targetId: asset.targetId, view: asset.targetId === 'character' ? 'front' : asset.view || 'front', variants, region, kind: 'refine', prompt: note.trim() });

  if (studio.loading) return <div className="loading-screen"><Lockup height={44} /><Busy>{t('app.opening')}</Busy></div>;
  if (studio.fatal) return <div className="loading-screen"><WarningCircle size={36} /><h2 className="display">{t('app.notConnected')}</h2><p>{studio.fatal}</p><button type="button" className="btn btn-primary btn-lg" onClick={studio.initialize}>{t('app.reconnect')}</button></div>;

  const name = view.name !== 'select' && project ? view.name : 'select';
  return <div className="app">
    {name === 'select' && <CharacterSelect projects={projects} onOpen={openProject} onOpenJob={openJob} onNew={() => setModal({ type: 'new' })} onDelete={item => setModal({ type: 'delete', target: { id: item.id, name: item.name, imageCount: item.imageCount, drawing: item.drawingCount > 0 } })} trashCount={studio.trash.length} onTrash={() => { studio.refreshTrash(); setDrawer('trash'); }} />}
    {name === 'workspace' && <Workspace key={project.id} studio={studio} project={project} outfitId={outfitId} onOutfit={setOutfitId} app={app} mode={mode} />}
    {name === 'gallery' && <Gallery project={project} busy={busy} onBack={() => setView({ name: 'workspace' })} onAdopt={adopt} onPreview={preview} onSummon={setSummonId} onRedraw={redraw} onRefine={refine} onImport={(job, file) => run(() => studio.importCandidate(job, file))} />}

    {summonId && project && name !== 'select' && <Summon project={project} jobId={summonId} busy={busy} onClose={() => setSummonId(null)} onAdopt={adopt} onReopen={reopen} onCopy={copyPrompt} onPreview={preview} onGallery={() => { setSummonId(null); setView({ name: 'gallery' }); }} />}

    {modal?.type === 'new' && <Modal title={t('app.newCharacter.title')} subtitle={t('app.newCharacter.subtitle')} onClose={() => setModal(null)}><NewCharacterForm busy={busy} onCreate={createCharacter} /></Modal>}
    {modal?.type === 'delete' && <Modal title={t('app.delete.title')} onClose={() => setModal(null)}><DeleteCharacterConfirm {...modal.target} busy={busy} onCancel={() => setModal(null)} onConfirm={() => deleteCharacter(modal.target)} /></Modal>}
    {modal?.type === 'preview' && <Modal title={modal.title || targetLabel(project, modal.asset.targetId)} wide onClose={() => setModal(null)}><ImagePreview asset={modal.asset} title={modal.title} /></Modal>}
    {drawer === 'settings' && project && <Drawer title={t('app.settingsTitle')} onClose={() => setDrawer(null)}><SettingsPanel project={project} status={studio.status} busy={busy} onRefresh={studio.refreshStatus}
      onInstall={() => run(async () => { await api('/codex/skill/install', { method: 'POST', body: {} }); await studio.refreshStatus(); notify(t('app.skillInstalled')); })}
      onYaml={(yaml, base) => run(async () => { studio.updateProject(await api(`/projects/${project.id}/character`, { method: 'PUT', body: { baseRevision: base, yaml } })); studio.refreshProjects(); setDrawer(null); notify(t('app.yamlSaved')); })} /></Drawer>}
    {drawer === 'trash' && <Drawer title={t('app.trash.title')} onClose={() => setDrawer(null)}><p className="hint">{t('app.trash.hint')}</p><TrashList items={studio.trash} busy={busy}
      onRestore={item => run(async () => { await studio.restoreProject(item.trashId); notify(t('app.delete.restored', { name: item.name })); })}
      onPurge={item => run(async () => { await studio.purgeTrash(item.trashId); notify(t('app.trash.purged', { name: item.name })); })} /></Drawer>}
    {drawer === 'history' && project && <Drawer title={t('app.history.title')} onClose={() => setDrawer(null)}><p className="hint">{t('app.history.hint')}</p><HistoryList project={project} busy={busy} onRestore={entry => run(async () => { await studio.restore(entry.id); setDrawer(null); notify(t('app.history.restored')); })} /></Drawer>}

    {studio.toast && <div className={`toast ${studio.toast.error ? 'is-error' : ''}`} role={studio.toast.error ? 'alert' : 'status'} key={studio.toast.key}>{studio.toast.error ? <WarningCircle size={18} weight="fill" /> : <CheckCircle size={18} weight="fill" />}<span>{studio.toast.message}</span>{studio.toast.action && <button type="button" className="btn btn-text toast-action" onClick={() => { const { action } = studio.toast; studio.setToast(null); action.run(); }}>{studio.toast.action.label}</button>}<button type="button" className="icon-btn" aria-label={t('app.closeToast')} onClick={() => studio.setToast(null)}><X size={14} /></button></div>}
  </div>;
}
