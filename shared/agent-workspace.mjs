const handoffStates = new Set(['prepared', 'queued', 'handed_off']);
const viewLabels = { front: '正面主圖', full: '完整主圖', back: '背面稿', detail: '細節稿' };

export function hasCharacterSetup(project) {
  if (!project?.character) return false;
  const character = project.character;
  return character.revision > 1 || Object.keys(character.components || {}).length > 0
    || Boolean(character.adopted?.character)
    || (project.proposals || []).some(proposal => proposal.status === 'accepted')
    || (project.jobs || []).some(job => job.targetId === 'character');
}

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
export function olderSettings(project, item) {
  return Number.isInteger(item?.baseRevision) && item.baseRevision !== project.character.revision;
}

function validCandidate(project, job, candidate, outfitId) {
  return candidate.jobId === job.id && candidate.status === 'pending'
    && candidate.targetId === job.targetId
    && candidateView(project, candidate) === (job.outputView || 'front')
    && candidateOutfit(candidate, job) === (job.outfitId || null)
    && candidateOutfit(candidate, job) === (outfitId || null);
}

function presentation(label, tone, action, actionLabel, candidate = null, needsAttention = false, older = false) {
  return { label, tone, action, actionLabel, candidate, needsAttention, olderSettings: older };
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
  if (job.status === 'cancelled') return presentation('已結束', 'neutral', 'none', '', null, false, older);
  const { returned, expected, generating, adopted } = jobProgress(project, job);
  if (job.status === 'accepted' || adopted > 0) {
    const candidate = recent((project.candidates || []).filter(item => item.jobId === job.id && item.status === 'accepted'))[0] || null;
    return presentation(generating ? '已採用，還在畫' : '已採用', 'success', 'view', '查看', candidate, false, older);
  }
  const valid = recent((project.candidates || []).filter(item => validCandidate(project, job, item, outfitId)));
  if (valid.length) return presentation(generating && returned < expected ? `新圖 ${valid.length}，還在畫` : `新圖 ${valid.length}`, 'amber', 'review', '挑一張', valid[0], true, older);
  if (job.status === 'review') return presentation('沒有新圖', 'neutral', 'new', '再畫一次', null, false, older);

  const scoped = (job.outfitId || null) === (outfitId || null);
  if (job.status === 'running') return presentation(expected > 1 ? `繪製中 ${returned}／${expected}` : '繪製中', 'blue', 'wait', '在 Codex 查看', null, false, older);
  if (job.status === 'failed') return presentation('失敗', 'error', 'handoff', '再試一次', null, scoped && !older, older);
  // 用較早設定準備、但從沒送出的工作不再催促；按「開始繪製」會用目前設定重新準備。
  if (handoffStates.has(job.status)) return older
    ? presentation('未送出', 'neutral', 'handoff', '仍要送出', null, false, true)
    : presentation('等你送出', 'blue', 'handoff', '在 Codex 開啟', null, scoped, false);
  return presentation('狀態待確認', 'neutral', 'none', '', null, false, older);
}

export function workspaceSummary(project, outfitId) {
  const jobs = (project.jobs || []).filter(job => (job.outfitId || null) === (outfitId || null));
  const jobsById = new Map(jobs.map(job => [job.id, job]));
  const reviewCandidates = recent((project.candidates || []).filter(candidate => {
    const job = jobsById.get(candidate.jobId);
    if (!job || job.status === 'cancelled' || candidateOutfit(candidate, job) !== (outfitId || null)) return false;
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
  const currentId = part && ['back', 'detail'].includes(view) ? part.views?.[view] : project.character.adopted?.[targetId];
  let current = project.assets?.find(item => item.id === currentId) || null;
  if (current && (current.targetId !== targetId || current.role === 'reference')) current = null;
  if (targetId === 'character' && current) {
    const currentOutfit = current.outfitId || Object.keys(project.character.outfits || {})[0] || null;
    if (!outfitId || currentOutfit !== outfitId || current.view !== 'front') current = null;
  } else if (current && (['back', 'detail'].includes(view) ? current.view !== view : !['front', 'full'].includes(current.view))) current = null;
  return { asset, current, outfitId, outfitName: project.character.outfits?.[outfitId]?.name || '未指定穿搭', view, viewLabel: viewLabels[view] || '未確認視角' };
}
