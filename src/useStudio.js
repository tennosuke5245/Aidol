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
  const decomposing = project?.decomposition?.status === 'running' || project?.views?.status === 'detecting';
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
    notify(candidate.targetId !== 'character' ? t('studio.adopted.part') : candidate.view && candidate.view !== 'front' ? t('studio.adopted.view', { view: t(`canvas.views.view.${candidate.view}`) }) : result.decomposition?.status === 'running' ? t('studio.adopted.mainDecomposing') : t('studio.adopted.main'));
    return result;
  }, [updateProject, refreshProjects, notify, freshRevision]);

  // 請 Codex 從正式立繪找出裝備，變成畫布上的節點（在背景進行，輪詢會帶回結果）。
  const decompose = useCallback(async () => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/decompose`, { method: 'POST', body: {} });
    updateProject(result);
    return result;
  }, [updateProject]);

  // 三視圖：在畫面上依位置框把正式三視圖裁成三張 PNG，交給核心存成新的圖片（原圖不動）。
  // manual：使用者在「調整裁切」裡框的；boxes 一起存，下次調整從這裡開始。
  const saveViews = useCallback(async ({ boxes, manual = false }) => {
    const current = projectRef.current;
    const assetId = current.character.adopted.character;
    const sheet = current.assets.find(asset => asset.id === assetId);
    if (!sheet) throw new ApiError(t('errors.VIEWS_STALE'), 409, undefined, 'VIEWS_STALE');
    const { cropViews } = await import('./views-split');
    let pieces;
    try { pieces = await cropViews(sheet.url, boxes); } catch { throw new ApiError(t('errors.VIEWS_CROP_FAILED'), 0, undefined, 'VIEWS_CROP_FAILED'); }
    if (!pieces.length) throw new ApiError(t('errors.INVALID_VIEWS'), 422, undefined, 'INVALID_VIEWS');
    const body = new FormData();
    body.append('meta', JSON.stringify({ assetId, manual, boxes, items: pieces.map(({ view, crop, frame, figure }) => ({ view, crop, frame, figure })) }));
    for (const piece of pieces) body.append(piece.view, piece.blob, `${piece.view}.png`);
    const result = await api(`/projects/${current.id}/views`, { method: 'POST', body });
    updateProject(result);
    return result;
  }, [updateProject]);

  // 拆解（或找三視圖）找到兩個以上的角度時，自動裁成三張；同一份結果只自動試一次，失敗就讓使用者手動框。
  // 每個角色各記一份（切換角色時，另一個角色的結果不會蓋掉這個的）。
  const [viewSplits, setViewSplits] = useState({});
  const splitTried = useRef(new Set());
  const views = project?.views;
  const splitKey = views?.status === 'boxes' && views.assetId === project.character.adopted.character ? `${project.id}:${views.assetId}:${views.updatedAt}` : '';
  useEffect(() => {
    if (!splitKey || splitTried.current.has(splitKey)) return;
    splitTried.current.add(splitKey);
    setViewSplits(current => ({ ...current, [splitKey]: { running: true } }));
    saveViews({ boxes: projectRef.current.views.boxes })
      .then(() => setViewSplits(current => ({ ...current, [splitKey]: { running: false } })), error => setViewSplits(current => ({ ...current, [splitKey]: { running: false, error: messageOf(error) } })));
  }, [splitKey, saveViews]);
  const adjustViews = useCallback(async boxes => saveViews({ boxes, manual: true }), [saveViews]);

  // 重畫的側面／背面採用後：調成和其他張一樣的畫布大小、身高與腳底位置。每張只自動試一次，失敗就照交回來的原圖用。
  const normalizeTried = useRef(new Set());
  const rawView = views?.status === 'done' && views.assetId === project?.character.adopted.character ? Object.entries(views.items || {}).find(([, item]) => item.redrawn && item.assetId === item.sourceAssetId) : null;
  const normalizeKey = rawView ? `${project.id}:${rawView[0]}:${rawView[1].sourceAssetId}:${views.updatedAt}` : '';
  useEffect(() => {
    if (!normalizeKey || normalizeTried.current.has(normalizeKey)) return;
    normalizeTried.current.add(normalizeKey);
    const current = projectRef.current;
    const [view, item] = Object.entries(current.views.items).find(([, entry]) => entry.redrawn && entry.assetId === entry.sourceAssetId) || [];
    if (!item) return;
    (async () => {
      const { normalizeView, viewTarget } = await import('./views-split');
      const target = await viewTarget(current.views.items, current.assets);
      const source = current.assets.find(asset => asset.id === item.sourceAssetId);
      if (!target || !source) return;
      const body = new FormData();
      body.append('sourceAssetId', item.sourceAssetId);
      body.append('file', await normalizeView(source.url, target), `${view}.png`);
      updateProject(await api(`/projects/${current.id}/views/${view}/normalized`, { method: 'POST', body }));
    })().catch(() => { /* 調不了就照原圖用，畫面仍可看、可匯出 */ });
  }, [normalizeKey, updateProject]);

  // 已經有三視圖：上傳的圖（或已有的參考圖，例如定稿）直接當正式立繪；接著和採用時一樣自動拆解、找三視圖。
  const importMain = useCallback(async ({ file, fromAssetId, outfitId }) => {
    const current = projectRef.current;
    const body = new FormData();
    if (file) body.append('file', file); else body.append('fromAssetId', fromAssetId);
    if (outfitId) body.append('outfitId', outfitId);
    body.append('baseRevision', String(await freshRevision()));
    const result = await api(`/projects/${current.id}/import-main`, { method: 'POST', body });
    updateProject(result); refreshProjects();
    return result;
  }, [updateProject, refreshProjects, freshRevision]);

  // 舊角色只有一張立繪：把整張當正面，接著補畫側面、背面。
  const mainAsFront = useCallback(async () => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/views/front-only`, { method: 'POST', body: {} });
    updateProject(result);
    return result;
  }, [updateProject]);

  // 加角度（斜前方、斜後方、另一側）：先放空位，之後照正面畫；也可以拿掉。
  const addExtraView = useCallback(async view => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/views/extra`, { method: 'POST', body: { view } });
    updateProject(result);
    return result;
  }, [updateProject]);
  const removeExtraView = useCallback(async view => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/views/extra/${view}`, { method: 'DELETE' });
    updateProject(result);
    return result;
  }, [updateProject]);

  // 設計標註：標在角度圖上的重點（例如尾巴從哪裡長出來），之後畫角色的圖都會交給 AI。
  const createViewNote = useCallback(async input => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/view-notes`, { method: 'POST', body: input });
    updateProject(result);
    return result;
  }, [updateProject]);
  const updateViewNote = useCallback(async (noteId, patch) => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/view-notes/${noteId}`, { method: 'PATCH', body: patch });
    updateProject(result);
    return result;
  }, [updateProject]);
  const deleteViewNote = useCallback(async noteId => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/view-notes/${noteId}`, { method: 'DELETE' });
    updateProject(result);
    return result;
  }, [updateProject]);

  // 舊角色（或功能加入前就採用的圖）：請 Codex 找出圖上的正面、側面、背面；在背景執行，輪詢帶回結果。
  const detectViews = useCallback(async () => {
    const current = projectRef.current;
    const result = await api(`/projects/${current.id}/views/detect`, { method: 'POST', body: {} });
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

  // readCanon：把定稿圖一起交給 AI，照圖填外觀。
  const sendChat = useCallback(async (message, { readCanon = false } = {}) => {
    const current = projectRef.current;
    const draft = await api(`/projects/${current.id}/chat`, { method: 'POST', body: { message, ...(readCanon ? { readCanon: true } : {}) } });
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

  const addReference = useCallback(async (file, role, focus, canon = false) => {
    const current = projectRef.current;
    const result = await uploadAsset(current.id, file);
    const character = clone(result.project.character);
    character.style.references.push({ id: `ref-${crypto.randomUUID().slice(0, 8)}`, assetId: result.asset.id, role, focus, ...(canon ? { canon: true } : {}) });
    return saveCharacter(character, t('studio.referenceSaved'), result.project.character.revision);
  }, [uploadAsset, saveCharacter]);

  const createProject = useCallback(async ({ name, brief = '', file, role = 'identity', canon = false }) => {
    let created = await api('/projects', { method: 'POST', body: { name, brief } });
    if (file) {
      const uploaded = await uploadAsset(created.id, file);
      const character = clone(uploaded.project.character);
      character.style.references.push({ id: `ref-${crypto.randomUUID().slice(0, 8)}`, assetId: uploaded.asset.id, role, focus: role === 'style' ? [t('studio.defaultFocus.lines'), t('studio.defaultFocus.coloring')] : [t('studio.defaultFocus.look'), t('studio.defaultFocus.colors')], ...(canon ? { canon: true } : {}) });
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
    viewSplit: splitKey ? viewSplits[splitKey] || null : null, adjustViews, detectViews, importMain, mainAsFront, addExtraView, removeExtraView, createViewNote, updateViewNote, deleteViewNote,
    sendChat, acceptProposal, dismissProposal, uploadReference, restore, addReference, createProject,
    createAnnotation, updateAnnotation, deleteAnnotation, addCanvasReference, copy, deleteProject, restoreProject, purgeTrash, trash, refreshTrash,
  };
}
