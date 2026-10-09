import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';
import { useStudio } from './useStudio';
import { CharacterSelect } from './CharacterSelect';
import { Workspace } from './Workspace';
import { Gallery } from './Gallery';
import { Summon } from './Summon';
import { ImagePreview } from './ImagePreview';
import { Busy, HistoryList, Modal, NewCharacterForm, SettingsPanel } from './Panels';
import { Drawer, Lockup } from './ui';
import { api, targetLabel } from './api';

const viewWords = { front: '正面', back: '背面', detail: '細節', full: '完整' };
function defaultPrompt(character, targetId, view = 'front') {
  if (targetId === 'character') return `畫出「${character.name}」的整體立繪。依照目前的人設、外觀、套裝與畫風，鎖定的特徵每張都要保留。`;
  const part = character.components[targetId];
  return `照著目前的正式立繪，畫出「${part?.name || '裝備'}」的${viewWords[view] || ''}設計圖。${part?.description || ''}`;
}

export function App() {
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
      catch (error) { notify(`AI 沒有寫成：${error.message}`, true); return undefined; }
      finally { setChatPending(false); }
    },
    applyProposal: (id, { thenDraw, baseRevision } = {}) => run(async () => {
      const accepted = await studio.acceptProposal(id, baseRevision);
      notify('已套用 AI 寫的設定。');
      if (thenDraw) {
        const { job } = await studio.generate({ targetId: 'character', outfitId: Object.keys(accepted.character.outfits)[0], outputView: 'front', kind: 'generate', prompt: defaultPrompt(accepted.character, 'character'), variants: 2, framing: 'sheet', baseRevision: accepted.character.revision });
        setSummonId(job.id);
      }
      return accepted;
    }),
    dismissProposal: id => run(() => studio.dismissProposal(id)),
  };

  async function createCharacter({ name, brief, file, role }) {
    const created = await run(() => studio.createProject({ name, brief, file, role }));
    if (!created) return;
    setModal(null); setOutfitId(Object.keys(created.character.outfits)[0]); setMode('creator'); setView({ name: 'workspace' });
    try { localStorage.setItem('aidol-pref-category', JSON.stringify('persona')); } catch {}
    if (brief) {
      notify('AI 正在依你的描述寫設定，寫好會出現在「角色」。');
      app.sendChat(`請依這段描述，替角色「${name}」補完人設、角色 DNA（身形、髮型、五官）、色票、鎖定特徵與主要套裝：\n${brief}`);
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

  if (studio.loading) return <div className="loading-screen"><Lockup height={44} /><Busy>正在打開 AIDOL…</Busy></div>;
  if (studio.fatal) return <div className="loading-screen"><WarningCircle size={36} /><h2 className="display">還沒連上本機服務</h2><p>{studio.fatal}</p><button type="button" className="btn btn-primary btn-lg" onClick={studio.initialize}>重新連線</button></div>;

  const name = view.name !== 'select' && project ? view.name : 'select';
  return <div className="app">
    {name === 'select' && <CharacterSelect projects={projects} onOpen={openProject} onOpenJob={openJob} onNew={() => setModal({ type: 'new' })} />}
    {name === 'workspace' && <Workspace key={project.id} studio={studio} project={project} outfitId={outfitId} onOutfit={setOutfitId} app={app} mode={mode} />}
    {name === 'gallery' && <Gallery project={project} busy={busy} onBack={() => setView({ name: 'workspace' })} onAdopt={adopt} onPreview={preview} onSummon={setSummonId} onRedraw={redraw} onRefine={refine} onImport={(job, file) => run(() => studio.importCandidate(job, file))} />}

    {summonId && project && name !== 'select' && <Summon project={project} jobId={summonId} busy={busy} onClose={() => setSummonId(null)} onAdopt={adopt} onReopen={reopen} onCopy={copyPrompt} onPreview={preview} onGallery={() => { setSummonId(null); setView({ name: 'gallery' }); }} />}

    {modal?.type === 'new' && <Modal title="創造新角色" subtitle="先取個名字，其他都可以之後慢慢捏。" onClose={() => setModal(null)}><NewCharacterForm busy={busy} onCreate={createCharacter} /></Modal>}
    {modal?.type === 'preview' && <Modal title={modal.title || targetLabel(project, modal.asset.targetId)} wide onClose={() => setModal(null)}><ImagePreview asset={modal.asset} title={modal.title} /></Modal>}
    {drawer === 'settings' && project && <Drawer title="原始設定檔與 Codex 連線" onClose={() => setDrawer(null)}><SettingsPanel project={project} status={studio.status} busy={busy} onRefresh={studio.refreshStatus}
      onInstall={() => run(async () => { await api('/codex/skill/install', { method: 'POST', body: {} }); await studio.refreshStatus(); notify('AIDOL Skill 已安裝到 Codex。'); })}
      onYaml={(yaml, base) => run(async () => { studio.updateProject(await api(`/projects/${project.id}/character`, { method: 'PUT', body: { baseRevision: base, yaml } })); studio.refreshProjects(); setDrawer(null); notify('設定檔已通過檢查並儲存。'); })} /></Drawer>}
    {drawer === 'history' && project && <Drawer title="存檔紀錄" onClose={() => setDrawer(null)}><p className="hint">每次修改都會自動存檔。讀取舊存檔會再存成一個新的存檔，圖片與後面的紀錄都會保留。</p><HistoryList project={project} busy={busy} onRestore={entry => run(async () => { await studio.restore(entry.id); setDrawer(null); notify('已讀取這個存檔。'); })} /></Drawer>}

    {studio.toast && <div className={`toast ${studio.toast.error ? 'is-error' : ''}`} role={studio.toast.error ? 'alert' : 'status'} key={studio.toast.key}>{studio.toast.error ? <WarningCircle size={18} weight="fill" /> : <CheckCircle size={18} weight="fill" />}<span>{studio.toast.message}</span><button type="button" className="icon-btn" aria-label="關閉提示" onClick={() => studio.setToast(null)}><X size={14} /></button></div>}
  </div>;
}
