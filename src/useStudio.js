import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, assetFor, clone, messageOf } from './api';
import { mergeProjectSnapshot } from '../shared/project-snapshot.mjs';
import { prepareFirstImage } from '../shared/image-start.mjs';
import { t } from './i18n';

const liveStatuses = new Set(['handed_off', 'running', 'review']);

// 本機工作台的資料與操作。介面只透過這裡呼叫核心，維持版本 CAS、
// 人工採用與「每次修訂一個新工作」等既有保證。
export function useStudio() {
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [syncError, setSyncError] = useState('');
  const [rememberedId, setRememberedId] = useState(null);
  const runLock = useRef(false);
  const projectRef = useRef(null);
  const canvasWrites = useRef(Promise.resolve());
  const canvasUploads = useRef(new WeakMap());
  projectRef.current = project;

  // action：提示上的按鈕（例如刪除後的「復原」），有按鈕時多留幾秒。
  const notify = useCallback((message, error = false, action) => setToast({ message, error, action, key: Date.now() }), []);
  useEffect(() => { if (toast && !toast.error) { const timer = setTimeout(() => setToast(null), toast.action ? 12000 : 6000); return () => clearTimeout(timer); } }, [toast]);

  const updateProject = useCallback(next => setProject(current => mergeProjectSnapshot(current, next)), []);
  const refreshProjects = useCallback(async () => { const list = await api('/projects'); setProjects(list); return list; }, []);
  const refreshStatus = useCallback(async () => { try { setStatus(await api('/codex/status')); } catch (error) { setStatus({ available: false, error: error.message }); } }, []);
  const openProject = useCallback(async id => {
    const current = await api(`/projects/${id}`);
    setProject(current);
    try { localStorage.setItem('aidol-current-project', id); } catch {}
    return current;
  }, []);
  const refresh = useCallback(async (id = projectRef.current?.id) => {
    if (!id) return refreshProjects();
    const [current] = await Promise.all([api(`/projects/${id}`), refreshProjects()]);
    setProject(current);
    return current;
  }, [refreshProjects]);

  const initialize = useCallback(async () => {
    setLoading(true); setFatal('');
    try {
      const list = await refreshProjects();
      let remembered = null;
      try { remembered = localStorage.getItem('aidol-current-project'); } catch {}
      const first = list.find(item => item.id === remembered);
      if (first) { await openProject(first.id); setRememberedId(first.id); }
    } catch (error) { setFatal(error.message); }
    finally { setLoading(false); }
    refreshStatus();
  }, [refreshProjects, openProject, refreshStatus]);
  useEffect(() => { initialize(); }, [initialize]);

  // 只有在等你送出、繪製中或有新圖時才輪詢；繪製中更頻繁，翻牌才跟得上。失敗保留畫面並說明。
  const decomposing = project?.decomposition?.status === 'running';
  const liveKey = [...(project?.jobs.filter(job => liveStatuses.has(job.status) || (job.progress?.startedAt && !job.progress?.finishedAt)).map(job => `${job.id}:${job.status}`) || []), ...(decomposing ? ['decompose'] : [])].join('|');
  const drawing = decomposing || Boolean(project?.jobs.some(job => job.status === 'running' || job.status === 'handed_off' || (job.progress?.startedAt && !job.progress?.finishedAt)));
  useEffect(() => {
    if (!project || !liveKey) return;
    const timer = setInterval(async () => {
      try {
        const data = await api(`/projects/${project.id}`);
        setProject(current => current?.id === data.id && data.character.revision >= current.character.revision && data.updatedAt >= current.updatedAt ? data : current);
        setSyncError('');
      } catch (error) { setSyncError(error.message); }
    }, drawing ? 2000 : 5000);
    return () => clearInterval(timer);
  }, [project?.id, liveKey, drawing]);
  useEffect(() => { setSyncError(''); }, [project?.id]);

  const run = useCallback(async action => {
    if (runLock.current) return undefined;
    runLock.current = true; setBusy(true);
    try { return await action(); }
    catch (error) {
      notify(messageOf(error) + (Array.isArray(error?.details) ? ' ' + error.details.map(detail => `${detail.path}: ${detail.message}`).join(t('studio.detailSeparator')) : ''), true);
      if (error?.status === 409 && projectRef.current) await refresh(projectRef.current.id).catch(() => {});
      return undefined;
    } finally { runLock.current = false; setBusy(false); }
  }, [notify, refresh]);

  const saveCharacter = useCallback(async (character, message = t('studio.saved'), baseRevision = projectRef.current.character.revision) => {
    const result = await api(`/projects/${projectRef.current.id}/character`, { method: 'PUT', body: { baseRevision, character } });
    updateProject(result); refreshProjects(); if (message) notify(message);
    return result;
  }, [updateProject, refreshProjects, notify]);

  const openCodex = useCallback(async url => {
    if (!window.__TAURI_INTERNALS__) { const anchor = document.createElement('a'); anchor.href = url; anchor.click(); return; }
    const { invoke } = await import('@tauri-apps/api/core');
    // 桌面版：Rust 指令失敗時回傳的是一段英文診斷字串，換成使用者看得懂的說明，診斷放在括號裡方便回報。
    try { await invoke('open_codex', { url }); }
    catch (error) {
      const detail = typeof error === 'string' ? error : error?.message;
      throw new ApiError(t('errors.CODEX_OPEN_FAILED') + (detail ? ` (${detail})` : ''), 0, undefined, 'CODEX_OPEN_FAILED');
    }
  }, []);

  const handoff = useCallback(async (jobId, { open = true } = {}) => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/jobs/${jobId}/handoff`, { method: 'POST', body: {} });
    if (open) await openCodex(result.url);
    await refresh(current.id);
    return result;
  }, [openCodex, refresh]);

  // 建立一個新工作 → 準備交接 → 直接在 Codex 開新對話（仍需使用者按送出）。
  const freshRevision = useCallback(async () => (await api(`/projects/${projectRef.current.id}`)).character.revision, []);

  const generate = useCallback(async body => {
    const current = projectRef.current;
    const job = await api(`/projects/${current.id}/jobs`, { method: 'POST', body: { ...body, baseRevision: body.baseRevision ?? await freshRevision() } });
    const result = await handoff(job.id);
    return { job, handoff: result };
  }, [handoff, freshRevision]);

  const startFirstImage = useCallback(async ({ targetId = 'character', outfitId, options = {}, source } = {}) => {
    const base = source || projectRef.current;
    const imageTarget = targetId !== 'character' && !assetFor(base, 'character', outfitId) ? 'character' : targetId;
    const result = await prepareFirstImage({
      projectId: base.id, targetId: imageTarget, outfitId, options,
      loadProject: id => api(`/projects/${id}`),
      createJob: (id, body) => api(`/projects/${id}/jobs`, { method: 'POST', body }),
      handoffJob: (id, jobId) => api(`/projects/${id}/jobs/${jobId}/handoff`, { method: 'POST', body: {} }),
    });
    updateProject(result.project);
    if (result.state === 'handoff') await openCodex(result.handoff.url);
    refreshProjects();
    return result;
  }, [updateProject, openCodex, notify, refreshProjects]);

  const acceptCandidate = useCallback(async candidate => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/candidates/${candidate.id}/accept`, { method: 'POST', body: { baseRevision: await freshRevision() } });
    updateProject(result); refreshProjects();
    notify(candidate.targetId !== 'character' ? t('studio.adopted.part') : result.decomposition?.status === 'running' ? t('studio.adopted.mainDecomposing') : t('studio.adopted.main'));
    return result;
  }, [updateProject, refreshProjects, notify, freshRevision]);

  // 請 Codex 從正式立繪找出裝備，變成畫布上的節點（在背景進行，輪詢會帶回結果）。
  const decompose = useCallback(async () => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/decompose`, { method: 'POST', body: {} });
    updateProject(result);
    return result;
  }, [updateProject]);

  const importCandidate = useCallback(async (job, file) => {
    const current = projectRef.current;
    const data = new FormData();
    data.append('file', file); data.append('role', 'design'); data.append('targetId', job.targetId); data.append('jobId', job.id); data.append('view', job.outputView || 'front');
    const result = await api(`/projects/${current.id}/assets`, { method: 'POST', body: data });
    updateProject(result.project); notify(t('studio.imported'));
    return result;
  }, [updateProject, notify]);

  const sendChat = useCallback(async message => {
    const current = projectRef.current;
    const draft = await api(`/projects/${current.id}/chat`, { method: 'POST', body: { message } });
    await refresh(current.id);
    return draft;
  }, [refresh]);

  const acceptProposal = useCallback(async (proposalId, baseRevision) => {
    const current = projectRef.current;
    const accepted = await api(`/projects/${current.id}/proposals/${proposalId}/accept`, { method: 'POST', body: { baseRevision: baseRevision ?? await freshRevision() } });
    updateProject(accepted); refreshProjects();
    return accepted;
  }, [updateProject, refreshProjects, freshRevision]);

  const dismissProposal = useCallback(async proposalId => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/proposals/${proposalId}/dismiss`, { method: 'POST', body: {} });
    updateProject(result);
    return result;
  }, [updateProject]);

  const restore = useCallback(async historyId => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/restore`, { method: 'POST', body: { historyId, baseRevision: await freshRevision() } });
    updateProject(result); refreshProjects();
    return result;
  }, [updateProject, refreshProjects, freshRevision]);

  const uploadAsset = useCallback(async (projectId, file, role = 'reference') => {
    const body = new FormData(); body.append('file', file); body.append('role', role);
    return api(`/projects/${projectId}/assets`, { method: 'POST', body });
  }, []);

  const uploadReference = useCallback(async file => {
    const current = projectRef.current;
    const result = await uploadAsset(current.id, file, 'reference');
    updateProject(result.project);
    return result.asset;
  }, [updateProject]);

  const addReference = useCallback(async (file, role, focus) => {
    const current = projectRef.current;
    const result = await uploadAsset(current.id, file);
    const character = clone(result.project.character);
    character.style.references.push({ id: `ref-${crypto.randomUUID().slice(0, 8)}`, assetId: result.asset.id, role, focus });
    return saveCharacter(character, t('studio.referenceSaved'), result.project.character.revision);
  }, [uploadAsset, saveCharacter]);

  const createProject = useCallback(async ({ name, brief = '', file, role = 'identity' }) => {
    let created = await api('/projects', { method: 'POST', body: { name, brief } });
    if (file) {
      const uploaded = await uploadAsset(created.id, file);
      const character = clone(uploaded.project.character);
      character.style.references.push({ id: `ref-${crypto.randomUUID().slice(0, 8)}`, assetId: uploaded.asset.id, role, focus: role === 'style' ? [t('studio.defaultFocus.lines'), t('studio.defaultFocus.coloring')] : [t('studio.defaultFocus.look'), t('studio.defaultFocus.colors')] });
      created = await api(`/projects/${created.id}/character`, { method: 'PUT', body: { baseRevision: uploaded.project.character.revision, character } });
    }
    setProject(created);
    try { localStorage.setItem('aidol-current-project', created.id); } catch {}
    await refreshProjects();
    return created;
  }, [uploadAsset, refreshProjects]);

  // 畫布註記：依序寫入同一專案，保存回應須通過版本與時間防護。
  const writeCanvas = useCallback(action => {
    const projectId = projectRef.current.id;
    const request = canvasWrites.current.catch(() => {}).then(() => action(projectId));
    canvasWrites.current = request;
    return request;
  }, []);
  const createAnnotation = useCallback(input => writeCanvas(async id => {
    const result = await api(`/projects/${id}/canvas-annotations`, { method: 'POST', body: input });
    updateProject(result.project); return result;
  }), [writeCanvas, updateProject]);
  const updateAnnotation = useCallback((annotationId, patch) => writeCanvas(async id => {
    const result = await api(`/projects/${id}/canvas-annotations/${annotationId}`, { method: 'PATCH', body: patch });
    updateProject(result.project); return result;
  }), [writeCanvas, updateProject]);
  const deleteAnnotation = useCallback(annotationId => writeCanvas(async id => {
    const result = await api(`/projects/${id}/canvas-annotations/${annotationId}`, { method: 'DELETE' });
    updateProject(result); return result;
  }), [writeCanvas, updateProject]);
  const addCanvasReference = useCallback((file, position) => writeCanvas(async id => {
    const uploads = canvasUploads.current.get(file) || new Map();
    canvasUploads.current.set(file, uploads);
    let asset = uploads.get(id);
    if (!asset) {
      const uploaded = await uploadAsset(id, file);
      asset = uploaded.asset; uploads.set(id, asset); updateProject(uploaded.project);
    }
    const result = await api(`/projects/${id}/canvas-annotations`, { method: 'POST', body: { kind: 'reference', assetId: asset.id, title: file.name.replace(/\.[^.]+$/, '').slice(0, 160), description: '', position } });
    uploads.delete(id);
    updateProject(result.project); return result;
  }), [writeCanvas, uploadAsset, updateProject]);

  // 刪除角色：核心把整個角色移到資源回收區；回傳的 trashId 可以拿來復原。
  // 資源回收區：刪除的角色在這裡可以復原或永久刪除。
  const [trash, setTrash] = useState([]);
  const refreshTrash = useCallback(async () => { try { setTrash(await api('/trash')); } catch { /* 讀不到就先不顯示 */ } }, []);
  useEffect(() => { refreshTrash(); }, [refreshTrash]);
  const refreshLists = useCallback(async () => { await Promise.allSettled([refreshProjects(), refreshTrash()]); }, [refreshProjects, refreshTrash]);
  const deleteProject = useCallback(async id => {
    const removed = await api(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (projectRef.current?.id === id) setProject(null);
    try { if (localStorage.getItem('aidol-current-project') === id) localStorage.removeItem('aidol-current-project'); } catch {}
    await refreshLists();
    return removed;
  }, [refreshLists]);
  const restoreProject = useCallback(async trashId => {
    const restored = await api(`/trash/${encodeURIComponent(trashId)}/restore`, { method: 'POST' });
    await refreshLists();
    return restored;
  }, [refreshLists]);
  const purgeTrash = useCallback(async trashId => {
    const purged = await api(`/trash/${encodeURIComponent(trashId)}`, { method: 'DELETE' });
    await refreshLists();
    return purged;
  }, [refreshLists]);

  const copy = useCallback(async text => {
    try { await navigator.clipboard.writeText(text); notify(t('studio.copied')); } catch { notify(t('studio.clipboardFailed'), true); }
  }, [notify]);

  return {
    projects, project, status, loading, fatal, busy, toast, syncError, rememberedId,
    setToast, notify, run, initialize, refresh, refreshProjects, refreshStatus, openProject, updateProject,
    saveCharacter, generate, handoff, openCodex, startFirstImage, acceptCandidate, importCandidate, decompose,
    sendChat, acceptProposal, dismissProposal, uploadReference, restore, addReference, createProject,
    createAnnotation, updateAnnotation, deleteAnnotation, addCanvasReference, copy, deleteProject, restoreProject, purgeTrash, trash, refreshTrash,
  };
}
