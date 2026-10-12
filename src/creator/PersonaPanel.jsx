import { useMemo, useState } from 'react';
import { LockSimple, MagicWand, Plus, X, Sparkle } from '@phosphor-icons/react';
import { describeChanges, mergeCharacter } from '../../shared/character-diff.mjs';
import { getLocale, useT } from '../i18n';
import { diffText, L } from '../lib-i18n';
import { Section } from '../ui';
import { Busy } from '../Panels';


function ChipInput({ items, onAdd, onRemove, placeholder, icon, max }) {
  const t = useT();
  const [value, setValue] = useState('');
  const add = () => { const text = value.trim(); if (!text || items.includes(text) || items.length >= max) return; onAdd(text); setValue(''); };
  return <div className="chip-editor">
    {items.map(item => <span className="chip chip-solid" key={item}>{icon}{item}<button type="button" aria-label={t('creator.persona.remove', { name: item })} onClick={() => onRemove(item)}><X size={11} weight="bold" /></button></span>)}
    {items.length < max && <input value={value} maxLength={160} placeholder={placeholder} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} onBlur={add} />}
  </div>;
}

export function PersonaPanel({ draft, edit, project, hasPortrait, asking, onAsk, onApply, onDismiss }) {
  const t = useT();
  const locale = getLocale();
  const [ask, setAsk] = useState('');
  const proposal = [...(project.proposals || [])].reverse().find(item => item.status === 'pending');
  const preview = useMemo(() => {
    if (!proposal) return null;
    const base = [...(project.history || [])].reverse().find(entry => entry.revision === proposal.baseRevision)?.character;
    return base ? mergeCharacter(base, proposal.character, draft) : proposal.character;
  }, [proposal, project.history, draft]);
  const changes = useMemo(() => (preview ? describeChanges(draft, preview, diffText) : []), [preview, draft, locale]);
  const [showAll, setShowAll] = useState(false);
  const locks = draft.locks || [];
  const hair = draft.dna?.hair || {}, face = draft.dna?.face || {};
  const suggestions = [
    hair.color && hair.style && t('creator.persona.suggestHair', { color: L.findOption(L.hairColors, hair.color)?.label, style: L.findOption(L.hairStyles, hair.style)?.label.toLowerCase() }),
    face.eyeColor && t('creator.persona.suggestEyes', { color: L.findOption(L.eyeColors, face.eyeColor)?.label }),
    ...Object.values(draft.components || {}).filter(part => part.kind === 'accessory').map(part => part.name),
  ].filter(item => item && !locks.includes(item)).slice(0, 3);

  async function send() {
    if (asking || (!ask.trim() && draft.persona.description.trim().length < 2)) return;
    const result = await onAsk(ask.trim() || t('creator.persona.fillRequest', { profile: draft.persona.description }));
    if (result) setAsk('');
  }
  // 有定稿：請 AI 看定稿圖，把看得到的外觀填進設定（上面框裡有寫要求的話一起帶上）。
  const canon = (draft.style?.references || []).some(reference => reference.canon);
  async function readCanon() {
    if (asking) return;
    const result = await onAsk([t('creator.persona.readCanonRequest'), ask.trim()].filter(Boolean).join('\n'), { readCanon: true });
    if (result) setAsk('');
  }

  return <div className="panel-stack">
    {proposal && <div className="ai-card" role="region" aria-label={t('creator.persona.suggestion')}>
      <div className="ai-card-head"><Sparkle size={16} weight="fill" /><b>{t('creator.persona.aiReady')}</b><span>{t('creator.persona.changeCount', { count: changes.length })}</span></div>
      {proposal.summary && <p className="ai-card-summary">{proposal.summary}</p>}
      <ul className="change-list">{(showAll ? changes : changes.slice(0, 6)).map((change, index) => <li key={index}><span>{change.label}</span><b>{change.to}</b></li>)}</ul>
      {changes.length > 6 && <button type="button" className="btn btn-text" onClick={() => setShowAll(value => !value)}>{showAll ? t('creator.persona.showLess') : t('creator.persona.more', { count: changes.length - 6 })}</button>}
      <div className="ai-card-actions">
        {hasPortrait ? <button type="button" className="btn btn-primary" onClick={() => onApply(proposal.id, { thenDraw: false })}>{t('creator.persona.applyAll')}</button>
          : <><button type="button" className="btn btn-primary" onClick={() => onApply(proposal.id, { thenDraw: true })}>{t('creator.persona.applyAndDraw')}</button><button type="button" className="btn btn-secondary" onClick={() => onApply(proposal.id, { thenDraw: false })}>{t('creator.persona.applyOnly')}</button></>}
        <button type="button" className="btn btn-quiet" onClick={() => onDismiss(proposal.id)}>{t('creator.persona.dismiss')}</button>
      </div>
    </div>}

    <label className="field"><span>{t('creator.persona.name')}</span><input value={draft.name} maxLength={160} onChange={event => { const value = event.target.value; edit(next => { next.name = value || next.name; }, { group: 'name' }); }} /></label>
    <label className="field"><span>{t('creator.persona.story')}</span><textarea rows={5} maxLength={12000} value={draft.persona.description} placeholder={t('creator.persona.storyPlaceholder')} onChange={event => { const value = event.target.value; edit(next => { next.persona.description = value; }, { group: 'story' }); }} /></label>

    <Section title={t('creator.persona.traits')}>
      <ChipInput items={draft.persona.traits} max={12} placeholder={t('creator.persona.traitsPlaceholder')} onAdd={text => edit(next => { next.persona.traits.push(text); })} onRemove={text => edit(next => { next.persona.traits = next.persona.traits.filter(item => item !== text); })} />
    </Section>

    <Section title={t('creator.persona.locks')} aside={<span className="sec-note">{t('creator.persona.locksNote')}</span>}>
      <ChipInput items={locks} max={12} icon={<LockSimple size={12} weight="bold" />} placeholder={t('creator.persona.locksPlaceholder')} onAdd={text => edit(next => { next.locks = [...(next.locks || []), text]; })} onRemove={text => edit(next => { next.locks = (next.locks || []).filter(item => item !== text); })} />
      {suggestions.length > 0 && <div className="chip-row">{suggestions.map(item => <button type="button" className="chip" key={item} onClick={() => edit(next => { next.locks = [...(next.locks || []), item]; })}><Plus size={12} />{item}</button>)}</div>}
    </Section>

    <Section title={t('creator.persona.ask')}>
      <textarea rows={3} maxLength={4000} value={ask} disabled={asking} placeholder={t('creator.persona.askPlaceholder')} onChange={event => setAsk(event.target.value)} />
      <button type="button" className="btn btn-secondary btn-block" disabled={asking} onClick={send}>{asking ? <Busy>{t('creator.persona.asking')}</Busy> : <><MagicWand size={16} />{t('creator.persona.askButton')}</>}</button>
      {canon && !asking && <button type="button" className="btn btn-quiet btn-block" title={t('creator.persona.readCanonHint')} onClick={readCanon}><LockSimple size={15} />{t('creator.persona.readCanon')}</button>}
      <p className="hint">{t('creator.persona.askHint')}</p>
    </Section>
  </div>;
}
