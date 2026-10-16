import { isAngleView } from './domain.mjs';
import { expressionList } from './expressions.mjs';
import { outfitPortraitId, removedOutfitJob } from './wardrobe.mjs';
const handoffStates = new Set(['prepared', 'queued', 'handed_off']);
const viewLabels = { front: '正面主圖', full: '完整主圖', back: '背面稿', detail: '細節稿', side: '側面稿', frontQuarter: '斜前方稿', backQuarter: '斜後方稿', otherSide: '另一側稿', expression: '表情' };
// 狀態與按鈕文字的繁中原文（server 與舊程式直接用 label／actionLabel）。
// 前端用 labelKey／actionKey（job.status.*、job.action.*）查 locales/<語言>/shared.json 換成目前語言。
export const jobStatusText = {
  ended: () => '已結束', adopted: () => '已採用', adoptedStillDrawing: () => '已採用，還在畫',
  newImages: ({ count }) => `新圖 ${count}`, newImagesStillDrawing: ({ count }) => `新圖 ${count}，還在畫`, noNewImages: () => '沒有新圖',
  drawing: () => '繪製中', drawingProgress: ({ returned, expected }) => `繪製中 ${returned}／${expected}`,
  failed: () => '失敗', notSent: () => '沒送出', waitingToSend: () => '等你送出', unknown: () => '狀態待確認',
};
export const jobActionText = { view: '查看', pick: '挑一張', drawAgain: '再畫一次', viewInCodex: '在 Codex 查看', openInCodex: '在 Codex 開啟', tryAgain: '再試一次', sendAnyway: '仍要送出' };
export const comparisonText = { noOutfit: '未指定穿搭', view: { ...viewLabels, unknown: '未確認視角' } };

export function hasCharacterSetup(project) {
  if (!project?.character) return false;
  const character = project.character;
  return character.revision > 1 || Object.keys(character.components || {}).length > 0
    || Boolean(character.adopted?.character)
    || (project.proposals || []).some(proposal => proposal.status === 'accepted')
    || (project.jobs || []).some(job => job.targetId === 'character');
}

// 表情已經從表情集拿掉：那個表情的工作當成結束，還沒挑的圖不再提醒（按「復原」放回來後又會出現）。
const removedExpression = (project, job) => job?.outputView === 'expression' && !expressionList(project?.expressions).includes(job.expression);
// 拿掉的表情、刪掉的套裝：照它們畫的工作都當成結束。
const removedTarget = (project, job) => removedExpression(project, job) || removedOutfitJob(project, job);

function recent(items) {
  return items.map((item, index) => ({ item, index, time: Date.parse(item.updatedAt || item.createdAt) || 0 }))
    .sort((a, b) => b.time - a.time || b.index - a.index)
    .map(({ item }) => item);
}

function candidateView(project, candidate) {
  return candidate.view || project.assets?.find(asset => asset.id === candidate.assetId)?.view || 'front';
}

function candidateOutfit(candidate, job) {
  return candidate.outfitId || job?.outfitId || null;
}

// 2026-10-07 起：畫好的圖不論是用哪一版設定畫的都可以採用；版本只作為資訊顯示。
// 核心給的 olderSettings（2026-10-14 起只看之後有沒有改到長相）優先；沒有時照版本號比。
export function olderSettings(project, item) {
  if (typeof item?.olderSettings === 'boolean') return item.olderSettings;
  return Number.isInteger(item?.baseRevision) && item.baseRevision !== project.character.revision;
}

// 「不畫了」（2026-10-14 起）：還沒送出、等你送出或失敗的繪製可以收掉。正在畫、已經有圖、已結束、
// 全自動正在處理的那張不行（核心也會擋；核心重開後「中斷了」的直接畫算失敗，可以收）。
export function canCancelJob(project, job) {
  if (!job || ['cancelled', 'accepted', 'review', 'running'].includes(job.status)) return false;
  if (job.autopilotId && project.autopilot?.status === 'running' && project.autopilot.id === job.autopilotId) return false;
  if (job.status === 'failed') return true;
  return handoffStates.has(job.status) && !(job.progress?.startedAt && !job.progress?.finishedAt);
}

function validCandidate(project, job, candidate, outfitId) {
  return candidate.jobId === job.id && candidate.status === 'pending'
    && candidate.targetId === job.targetId
    && candidateView(project, candidate) === (job.outputView || 'front')
    && candidateOutfit(candidate, job) === (job.outfitId || null)
    && candidateOutfit(candidate, job) === (outfitId || null);
}

function presentation(status, params, tone, action, actionKey, candidate = null, needsAttention = false, older = false) {
  return {
    label: jobStatusText[status](params), labelKey: `job.status.${status}`, labelParams: params, tone, action,
    actionLabel: actionKey ? jobActionText[actionKey] : '', actionKey: actionKey ? `job.action.${actionKey}` : '', candidate, needsAttention, olderSettings: older,
  };
}

// 這份工作實際已回傳幾張、預計幾張；只依資料計算，不推測進度。
export function jobProgress(project, job) {
  const mine = (project.candidates || []).filter(item => item.jobId === job.id);
  const returned = mine.length;
  const expected = job.variants || 1;
  const generating = Boolean(job.progress?.startedAt && !job.progress?.finishedAt && !['cancelled', 'failed'].includes(job.status));
  return { returned, expected, generating, pending: mine.filter(item => item.status === 'pending').length, adopted: mine.filter(item => item.status === 'accepted').length };
}

export function jobPresentation(project, job, outfitId = job.outfitId) {
  const older = olderSettings(project, job);
  if (job.status === 'cancelled' || removedTarget(project, job)) return presentation('ended', {}, 'neutral', 'none', '', null, false, older);
  const { returned, expected, generating, adopted } = jobProgress(project, job);
  if (job.status === 'accepted' || adopted > 0) {
    const candidate = recent((project.candidates || []).filter(item => item.jobId === job.id && item.status === 'accepted'))[0] || null;
    return presentation(generating ? 'adoptedStillDrawing' : 'adopted', {}, 'success', 'view', 'view', candidate, false, older);
  }
  const valid = recent((project.candidates || []).filter(item => validCandidate(project, job, item, outfitId)));
  if (valid.length) return presentation(generating && returned < expected ? 'newImagesStillDrawing' : 'newImages', { count: valid.length }, 'amber', 'review', 'pick', valid[0], true, older);
  if (job.status === 'review') return presentation('noNewImages', {}, 'neutral', 'new', 'drawAgain', null, false, older);

  const scoped = (job.outfitId || null) === (outfitId || null);
  if (job.status === 'running') return presentation(expected > 1 ? 'drawingProgress' : 'drawing', expected > 1 ? { returned, expected } : {}, 'blue', 'wait', 'viewInCodex', null, false, older);
  if (job.status === 'failed') return presentation('failed', {}, 'error', 'handoff', 'tryAgain', null, scoped && !older, older);
  // 用較早設定準備、但從沒送出的工作不再催促；按「開始繪製」會用目前設定重新準備。
  if (handoffStates.has(job.status)) return older
    ? presentation('notSent', {}, 'neutral', 'handoff', 'sendAnyway', null, false, true)
    : presentation('waitingToSend', {}, 'blue', 'handoff', 'openInCodex', null, scoped, false);
  return presentation('unknown', {}, 'neutral', 'none', '', null, false, older);
}

export function workspaceSummary(project, outfitId) {
  const jobs = (project.jobs || []).filter(job => (job.outfitId || null) === (outfitId || null));
  const jobsById = new Map(jobs.map(job => [job.id, job]));
  const reviewCandidates = recent((project.candidates || []).filter(candidate => {
    const job = jobsById.get(candidate.jobId);
    if (!job || job.status === 'cancelled' || removedTarget(project, job) || candidateOutfit(candidate, job) !== (outfitId || null)) return false;
    return jobProgress(project, job).adopted === 0 && job.status !== 'accepted' && validCandidate(project, job, candidate, outfitId);
  }));
  const pendingProposals = recent((project.proposals || []).filter(proposal => proposal.status === 'pending'));
  const orderedJobs = recent(jobs);
  const presented = new Map(orderedJobs.map(job => [job.id, jobPresentation(project, job, outfitId)]));
  const attentionJobs = orderedJobs.filter(job => presented.get(job.id).needsAttention)
    .sort((a, b) => Number(presented.get(b.id).action === 'review') - Number(presented.get(a.id).action === 'review'));
  const attentionIds = new Set(attentionJobs.map(job => job.id));
  const historyJobs = orderedJobs.filter(job => !attentionIds.has(job.id));
  return { reviewCandidates, pendingProposals, attentionJobs, historyJobs, attentionCount: attentionJobs.length + pendingProposals.length };
}

export function candidateComparison(project, candidate) {
  const job = project.jobs?.find(item => item.id === candidate.jobId);
  const asset = project.assets?.find(item => item.id === candidate.assetId) || null;
  const outfitId = candidate.outfitId || job?.outfitId || null;
  const view = candidate.view || asset?.view || job?.outputView || 'front';
  const targetId = candidate.targetId || job?.targetId || asset?.targetId;
  const part = targetId !== 'character' ? project.character.components?.[targetId] : null;
  // 角色的側面／背面是重畫三視圖單一角度：拿三視圖裡現在那一張來比。
  const sheetView = targetId === 'character' && isAngleView(view);
  const sheetItem = sheetView && project.views?.status === 'done' && project.views.assetId === project.character.adopted?.character ? project.views.items?.[view] : null;
  // 表情：拿表情集裡這個表情現在那一張來比（還沒有就不比）。
  const expressionView = targetId === 'character' && view === 'expression';
  const expressionKey = expressionView ? candidate.expression || asset?.expression || job?.expression : null;
  // 角色的整張立繪：拿這套穿搭現在的立繪來比（主要那套是正式立繪，其他套是衣櫃裡那張）。
  const characterFront = targetId === 'character' && !sheetView && !expressionView;
  const currentId = expressionView ? project.expressions?.items?.[expressionKey]?.assetId
    : sheetView ? sheetItem?.assetId : characterFront ? outfitPortraitId(project, outfitId) : part && ['back', 'detail'].includes(view) ? part.views?.[view] : project.character.adopted?.[targetId];
  let current = project.assets?.find(item => item.id === currentId) || null;
  if (current && (current.targetId !== targetId || current.role === 'reference')) current = null;
  // 三視圖裡的角度、表情集都不分穿搭，不用再比對。
  if (expressionView) { if (current && current.view !== 'expression') current = null; }
  else if (characterFront) { if (current && current.view !== 'front') current = null; }
  else if (!sheetView && current && (['back', 'detail'].includes(view) ? current.view !== view : !['front', 'full'].includes(current.view))) current = null;
  const outfitName = project.character.outfits?.[outfitId]?.name;
  const viewKey = viewLabels[view] ? view : 'unknown';
  return { asset, current, outfitId, outfitName: outfitName || comparisonText.noOutfit, outfitKey: outfitName ? '' : 'comparison.noOutfit', view, viewLabel: comparisonText.view[viewKey], viewKey: `comparison.view.${viewKey}` };
}
