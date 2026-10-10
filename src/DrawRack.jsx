import { useMemo } from 'react';
import { jobPresentation, jobProgress } from '../shared/agent-workspace.mjs';
import { targetLabel } from './api';
import { sharedText, t, useT } from './i18n';

// 新圖最先，其次繪製中、等你送出，失敗放最後。
const sessionRank = ({ job, view }) => (view.action === 'review' ? 0 : job.status === 'running' ? 1 : job.status === 'failed' ? 3 : 2);

function sessionLabel(job, view) {
  const label = sharedText(view.labelKey, view.labelParams, view.label);
  if (view.action === 'review' || job.status === 'running') return label;
  if (job.status === 'failed') return t('canvas.status.failed');
  if (view.action === 'handoff') return t('canvas.status.sendInCodex');
  return label;
}

// 繪製進度架：任何一次繪製都不會無聲消失，點一下回到翻牌畫面。
export function DrawRack({ project, onOpen, limit = 3 }) {
  const t = useT();
  const sessions = useMemo(() => [...project.jobs]
    .sort((a, b) => (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0))
    .map(job => ({ job, view: jobPresentation(project, job, job.outfitId), progress: jobProgress(project, job) }))
    .filter(({ job, view, progress }) => view.needsAttention || progress.generating || job.status === 'running')
    .sort((a, b) => sessionRank(a) - sessionRank(b))
    .slice(0, limit), [project, limit]);
  if (!sessions.length) return null;
  return <div className="rack" aria-label={t('canvas.rack.label')}>{sessions.map(({ job, view, progress }) => {
    const shots = project.candidates.filter(item => item.jobId === job.id).slice(-3).map(item => project.assets.find(asset => asset.id === item.assetId)).filter(Boolean);
    return <button type="button" key={job.id} className={`rack-item tone-${view.tone}`} onClick={() => onOpen(job.id)}>
      <span className="rack-cards">{shots.length ? shots.map(asset => <img key={asset.id} src={asset.url} alt="" />) : Array.from({ length: Math.min(3, progress.expected) }, (_, i) => <i key={i} />)}</span>
      <span className="rack-copy"><b>{sessionLabel(job, view)}</b><small>{targetLabel(project, job.targetId)}</small></span>
    </button>;
  })}</div>;
}
