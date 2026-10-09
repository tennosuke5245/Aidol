import { Plus } from '@phosphor-icons/react';
import { Lockup, StatusPill } from './ui';
import { figureArt } from './optionArt';

// 角色選單：每位角色一張立繪卡；還沒有立繪的用中性人台代替。
export function CharacterSelect({ projects, onOpen, onOpenJob, onNew }) {
  return <main className="select-screen">
    <header className="select-top"><Lockup height={34} /></header>
    <section className="select-body">
      <h1 className="display select-title">選擇角色</h1>
      <div className="roster">
        {projects.map(item => {
          const first = item.attention?.[0];
          return <article key={item.id} className="roster-card">
            <button type="button" className="roster-open" onClick={() => onOpen(item.id)} aria-label={`打開 ${item.name}`} title={item.persona ? `${item.name}\n${item.persona}` : item.name}>
              <span className="roster-art">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : figureArt && <img className="is-placeholder" src={figureArt} alt="" />}</span>
              <span className="roster-caption">
                <span className="roster-name display">{item.name}</span>
                {item.persona && <span className="roster-persona">{item.persona}</span>}
              </span>
            </button>
            {first && <button type="button" className="roster-status" onClick={() => onOpenJob(item.id, first.jobId)}><StatusPill tone={first.tone}>{first.label}</StatusPill>{item.attentionCount > 1 && <span className="num">+{item.attentionCount - 1}</span>}</button>}
          </article>;
        })}
        <button type="button" className="roster-card roster-new" onClick={onNew}><span className="roster-plus"><Plus size={30} /></span><span className="display">創造新角色</span></button>
      </div>
    </section>
  </main>;
}
