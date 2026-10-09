const openStates = new Set(['prepared', 'queued', 'handed_off', 'running', 'failed', 'review']);

export function firstImagePrompt(character, targetId = 'character') {
  if (targetId !== 'character') {
    const part = character.components[targetId];
    return `依照目前完整人物設定與已採用角色稿，為「${part.name}」產生完整部件正面設計候選。${part.description || ''} 保留角色辨識特徵、穿搭關係與繪風，未知細節提出設計候選。`;
  }
  return `依照目前完整人物設定，為「${character.name}」產生第一張角色設定稿。呈現全身正面、背面與主要服裝辨識細節，維持人物年齡、外貌、個性、目前穿搭與指定繪風。尚待決定的外貌細節提出本次設計候選。先確立整體角色，再依採用稿逐一展開部件。`;
}

export function currentImageJob(project, targetId, outfitId, outputView = 'front') {
  const matches = job => job.targetId === targetId && job.outfitId === outfitId && (job.outputView || 'front') === outputView;
  const pending = job => project.candidates.some(item => item.jobId === job.id && item.status === 'pending');
  // 正在畫、或已經畫好還沒挑的工作，不論用哪一版設定都沿用（畫好的圖永遠可以採用）。
  const live = [...project.jobs].reverse().find(job => matches(job) && (job.status === 'running' || (job.status === 'review' && pending(job))));
  if (live) return live;
  // 還沒送出的工作只沿用目前設定版本的；較早版本的會用目前設定重新準備。
  return [...project.jobs].reverse().find(job => matches(job) && job.baseRevision === project.character.revision && openStates.has(job.status));
}

export function reviewCandidate(project, job) {
  return job && [...project.candidates].reverse().find(item => item.jobId === job.id && item.status === 'pending');
}

export async function prepareFirstImage({ projectId, targetId = 'character', outfitId, options = {}, loadProject, createJob, handoffJob }) {
  const project = await loadProject(projectId);
  const selectedOutfit = project.character.outfits[outfitId] ? outfitId : Object.keys(project.character.outfits)[0];
  if (!selectedOutfit) throw new Error('請先建立一套穿搭，再開始出圖。');
  const adopted = project.assets.find(asset => asset.id === project.character.adopted[targetId]);
  if (adopted && (targetId !== 'character' || (adopted.outfitId || Object.keys(project.character.outfits)[0]) === selectedOutfit)) return { state: 'adopted', project, asset: adopted, outfitId: selectedOutfit };
  const existing = currentImageJob(project, targetId, selectedOutfit);
  const candidate = reviewCandidate(project, existing);
  if (candidate) return { state: 'review', project, candidate, outfitId: selectedOutfit };
  // A review job may have no usable candidate after recovery. Keep it in review.
  if (existing?.status === 'review') return { state: 'jobs', project, outfitId: selectedOutfit };
  // Skill 已回報開始產圖：等待回傳，不重新交接、不退回等你送出。
  if (existing?.status === 'running') return { state: 'running', project, job: existing, outfitId: selectedOutfit };
  // options 只帶入這次工作的張數、畫風方向與取景；既有同版本工作仍優先沿用。
  const { variants, directionId, framing } = options;
  const job = existing || await createJob(project.id, { targetId, outfitId: selectedOutfit, outputView: 'front', kind: 'generate', baseRevision: project.character.revision, prompt: firstImagePrompt(project.character, targetId), ...(variants ? { variants } : {}), ...(directionId ? { directionId } : {}), ...(framing ? { framing } : {}) });
  const handoff = await handoffJob(project.id, job.id);
  return { state: 'handoff', project: await loadProject(project.id), handoff, outfitId: selectedOutfit };
}
