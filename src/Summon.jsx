import { useEffect, useRef } from 'react';
import { ArrowSquareOut, Copy, X, Images, ArrowClockwise, Check, MagnifyingGlassPlus } from '@phosphor-icons/react';
import { jobProgress } from '../shared/agent-workspace.mjs';
import { targetLabel } from './api';
import { Mark } from './ui';
import { Busy } from './Panels';

// 繪製畫面：引導到 Codex 按送出 → 真實回報「繪製中」→ 每回來一張翻開一張 → 選一張。
// 卡片數量就是這次要畫的張數；沒有回報之前不顯示任何進度。
const referenceRoles = { style: '繪風參考', identity: '角色特徵參考', color: '配色參考', clothing: '服裝結構參考', material: '材質參考', composition: '構圖參考' };

function phaseOf(job, progress) {
  if (job.status === 'failed' && !progress.returned) return 'failed';
  if (progress.generating || job.status === 'running') return 'drawing';
  if (progress.returned > 0) return 'done';
  return 'waiting';
}

export function Summon({ project, jobId, busy, onClose, onAdopt, onReopen, onCopy, onPreview, onGallery }) {
  const job = project.jobs.find(item => item.id === jobId);
  // 每張卡第一次出現時決定翻牌延遲，之後固定不變，重繪時不會重播。
  const delays = useRef(new Map());
  useEffect(() => {
    const handle = event => { if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);
  if (!job) return null;
  const progress = jobProgress(project, job);
  const phase = phaseOf(job, progress);
  const candidates = project.candidates.filter(item => item.jobId === job.id).sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
  const slots = Math.max(progress.expected, candidates.length);
  const firstPass = delays.current.size === 0;
  const isMain = job.targetId === 'character';
  const target = targetLabel(project, job.targetId);
  // 這份工作建立時固定下來的角色描述（中文部分）；英文提示留給 agent，不在這裡顯示。
  const brief = (job.context?.compiled || '').split('\n## English brief')[0].replace(/^## 結構化角色 DNA.*$/m, '角色描述').replace(/^## /gm, '').trim();
  // 這次一起交給 AI 的圖，以及各自的用途（繪風參考管畫法，立繪與裝備圖管長相）。
  const styleRefs = job.context?.styleReferences || project.character.style.references || [];
  const inputs = (job.context?.referenceAssets || []).map(asset => {
    const reference = styleRefs.find(item => item.assetId === asset.id);
    const label = reference ? `${referenceRoles[reference.role] || '參考圖'}：${(reference.focus || []).join('、') || '整體感覺'}`
      : asset.targetId === 'character' ? '正式立繪（長相與服裝）' : `${targetLabel(project, asset.targetId)}的設計圖`;
    return { id: asset.id, label, url: project.assets.find(item => item.id === asset.id)?.url, style: reference?.role === 'style' };
  }).sort((a, b) => Number(b.style) - Number(a.style));
  // 正式引用：立繪看 adopted.character；裝備的正面看 assetId，背面／細節看 views。
  const part = isMain ? null : project.character.components[job.targetId];
  const adoptedId = isMain ? project.character.adopted.character : ['back', 'detail'].includes(job.outputView) ? part?.views?.[job.outputView] : part?.assetId;
  const anyAdopted = candidates.some(candidate => candidate.assetId === adoptedId);
  const copy = {
    waiting: { title: '到 Codex 按送出', sub: 'Codex 已經開好新對話，提示也填好了。按下送出，這裡就會開始翻牌。' },
    drawing: { title: `繪製中 ${progress.returned}／${progress.expected}`, sub: '畫好一張就翻開一張，不用等全部畫完。' },
    done: anyAdopted ? { title: isMain ? '已設為正式立繪' : `已設為「${target}」的設計圖`, sub: '其他的都留在圖鑑，之後隨時可以換。' }
      : { title: isMain ? '選一張當正式立繪' : `選一張當「${target}」的設計圖`, sub: progress.generating ? '還有幾張在畫，可以先挑。' : '其他的會留在圖鑑，之後也能換。' },
    failed: { title: '這次沒畫成', sub: job.failure?.message ? `Codex 回報：${job.failure.message}` : 'Codex 回報失敗。要求與設定都還在，可以再試一次。' },
  }[phase];

  return <div className={`summon phase-${phase}`} role="dialog" aria-modal="true" aria-label={copy.title}>
    <button type="button" className="summon-close icon-btn" aria-label="收起來" onClick={onClose}><X size={20} /></button>
    <header className="summon-head">
      <span className="summon-target">{target}</span>
      <h2 className="display">{copy.title}</h2>
      <p>{copy.sub}</p>
    </header>
    <div className="summon-cards" style={{ '--count': slots }}>
      {Array.from({ length: slots }, (_, index) => {
        const candidate = candidates[index];
        const asset = candidate && project.assets.find(item => item.id === candidate.assetId);
        if (candidate && !delays.current.has(candidate.id)) delays.current.set(candidate.id, firstPass ? index * 160 : 0);
        const adopted = asset && asset.id === adoptedId;
        return <div key={index} className={`summon-card ${candidate ? 'is-revealed' : ''} ${adopted ? 'is-adopted' : ''}`} style={{ '--delay': `${candidate ? delays.current.get(candidate.id) : 0}ms` }}>
          <div className="card-inner">
            <div className="card-back"><Mark size={46} /><span>{phase === 'waiting' ? '等待送出' : phase === 'failed' ? '沒有畫出' : '繪製中'}</span></div>
            <div className="card-front">
              {asset && <button type="button" className="card-img" onClick={() => onPreview(asset, `${target}・第 ${index + 1} 張`)} aria-label={`放大第 ${index + 1} 張`}><img src={asset.url} alt={`第 ${index + 1} 張`} /><span className="card-zoom"><MagnifyingGlassPlus size={16} /></span></button>}
              <div className="card-foot">
                {adopted ? <span className="card-picked"><Check size={14} weight="bold" />{isMain ? '正式立繪' : '已採用'}</span>
                  : candidate && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAdopt(candidate)}>{isMain ? '設為立繪' : '採用這張'}</button>}
                {candidate?.olderSettings && !adopted && <small className="card-note">用較早的設定畫的</small>}
              </div>
            </div>
          </div>
        </div>;
      })}
    </div>
    <footer className="summon-foot">
      {phase === 'waiting' && <><button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => onReopen(job.id)}>{busy ? <Busy>開啟中…</Busy> : <><ArrowSquareOut size={17} />重新開啟 Codex</>}</button><button type="button" className="btn btn-secondary btn-lg" disabled={busy} onClick={() => onCopy(job.id)}><Copy size={16} />複製提示</button></>}
      {phase === 'failed' && <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => onReopen(job.id)}><ArrowClockwise size={17} />再試一次</button>}
      {phase === 'drawing' && <button type="button" className="btn btn-secondary btn-lg" onClick={() => onReopen(job.id)}><ArrowSquareOut size={16} />到 Codex 看進度</button>}
      <button type="button" className="btn btn-quiet btn-lg" onClick={onClose}>{phase === 'done' && anyAdopted ? '收起來' : '先收起來'}</button>
      {phase === 'done' && <button type="button" className="btn btn-quiet btn-lg" onClick={onGallery}><Images size={17} />打開圖鑑</button>}
    </footer>
    <details className="summon-prompt"><summary>這次帶給 AI 的內容</summary><p>{job.prompt}</p>
      {inputs.length > 0 && <ul className="summon-inputs" aria-label="一起交給 AI 的圖">{inputs.map(item => <li key={item.id} className={item.style ? 'is-style' : ''}>{item.url && <img src={item.url} alt="" />}<span>{item.label}</span></li>)}</ul>}
      {brief && <p className="summon-brief">{brief}</p>}</details>
  </div>;
}
