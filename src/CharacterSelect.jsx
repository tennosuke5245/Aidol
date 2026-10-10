import { Plus, Trash } from '@phosphor-icons/react';
import { LanguageMenu, Lockup, StatusPill } from './ui';
import { sharedText, useT } from './i18n';
import { figureArt } from './optionArt';

// 角色選單：每位角色一張立繪卡；還沒有立繪的用中性人台代替。
export function CharacterSelect({ projects, onOpen, onOpenJob, onNew, onDelete, trashCount = 0, onTrash }) {
  const t = useT();
  return <main className="select-screen">
    <header className="select-top"><Lockup height={34} /><LanguageMenu /></header>
    <section className="select-body">
      <h1 className="display select-title">{t('workspace.select.title')}</h1>
      <div className="roster">
        {projects.map(item => {
          const first = item.attention?.[0];
          return <article key={item.id} className="roster-card">
            <button type="button" className="roster-open" onClick={() => onOpen(item.id)} aria-label={t('workspace.select.open', { name: item.name })} title={item.persona ? `${item.name}\n${item.persona}` : item.name}>
              <span className="roster-art">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : figureArt && <img className="is-placeholder" src={figureArt} alt="" />}</span>
              <span className="roster-caption">
                <span className="roster-name display">{item.name}</span>
                {item.persona && <span className="roster-persona">{item.persona}</span>}
              </span>
            </button>
            <button type="button" className="icon-btn roster-delete" aria-label={t('workspace.select.delete', { name: item.name })} title={t('workspace.select.delete', { name: item.name })} onClick={() => onDelete(item)}><Trash size={16} /></button>
            {first && <button type="button" className="roster-status" onClick={() => onOpenJob(item.id, first.jobId)}><StatusPill tone={first.tone}>{sharedText(first.labelKey, first.labelParams, first.label)}</StatusPill>{item.attentionCount > 1 && <span className="num">+{item.attentionCount - 1}</span>}</button>}
          </article>;
        })}
        <button type="button" className="roster-card roster-new" onClick={onNew}><span className="roster-plus"><Plus size={30} /></span><span className="display">{t('workspace.select.new')}</span></button>
      </div>
      {trashCount > 0 && <button type="button" className="btn btn-text select-trash" onClick={onTrash}><Trash size={15} />{t('workspace.select.trash', { count: trashCount })}</button>}
    </section>
  </main>;
}
