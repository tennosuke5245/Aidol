export class ApiError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}
export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || '無法連線到本機服務。', response.status, data.details);
  return data;
}
export const clone = value => structuredClone(value);
export function assetFor(project, targetId, outfitId, view = 'front') {
  if (!project) return;
  const assetId = targetId !== 'character' && view !== 'front' ? project.character.components[targetId]?.views?.[view] : project.character.adopted[targetId];
  const asset = project.assets.find(item => item.id === assetId);
  if (targetId === 'character' && outfitId && asset && (asset.outfitId || Object.keys(project.character.outfits)[0]) !== outfitId) return;
  return asset;
}
export const dateLabel = date => new Date(date).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const targetLabel = (project, id) => id === 'character' ? '立繪' : project?.character.components[id]?.name || [...(project?.history || [])].reverse().find(entry => entry.character.components[id])?.character.components[id]?.name || '歷史部件';
