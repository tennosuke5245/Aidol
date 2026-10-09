import { useMemo, useState } from 'react';
import { LockSimple, MagicWand, Plus, X, Sparkle } from '@phosphor-icons/react';
import * as L from '../../shared/libraries.mjs';
import { describeChanges, mergeCharacter } from '../../shared/character-diff.mjs';
import { Section } from '../ui';
import { Busy } from '../Panels';

function ChipInput({ items, onAdd, onRemove, placeholder, icon, max }) {
  const [value, setValue] = useState('');
  const add = () => { const text = value.trim(); if (!text || items.includes(text) || items.length >= max) return; onAdd(text); setValue(''); };
  return <div className="chip-editor">
    {items.map(item => <span className="chip chip-solid" key={item}>{icon}{item}<button type="button" aria-label={`移除「${item}」`} onClick={() => onRemove(item)}><X size={11} weight="bold" /></button></span>)}
    {items.length < max && <input value={value} maxLength={160} placeholder={placeholder} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} onBlur={add} />}
  </div>;
}

export function PersonaPanel({ draft, edit, project, hasPortrait, asking, onAsk, onApply, onDismiss }) {
  const [ask, setAsk] = useState('');
  const proposal = [...(project.proposals || [])].reverse().find(item => item.status === 'pending');
  const preview = useMemo(() => {
    if (!proposal) return null;
    const base = [...(project.history || [])].reverse().find(entry => entry.revision === proposal.baseRevision)?.character;
    return base ? mergeCharacter(base, proposal.character, draft) : proposal.character;
  }, [proposal, project.history, draft]);
  const changes = useMemo(() => (preview ? describeChanges(draft, preview) : []), [preview, draft]);
  const [showAll, setShowAll] = useState(false);
  const locks = draft.locks || [];
  const hair = draft.dna?.hair || {}, face = draft.dna?.face || {};
  const suggestions = [
    hair.color && hair.style && `${L.findOption(L.hairColors, hair.color)?.label}${L.findOption(L.hairStyles, hair.style)?.label}`,
    face.eyeColor && `${L.findOption(L.eyeColors, face.eyeColor)?.label}色眼睛`,
    ...Object.values(draft.components || {}).filter(part => part.kind === 'accessory').map(part => part.name),
  ].filter(item => item && !locks.includes(item)).slice(0, 3);

  async function send() {
    if (asking || (!ask.trim() && draft.persona.description.trim().length < 2)) return;
    const result = await onAsk(ask.trim() || `依照目前的人設「${draft.persona.description}」，幫我補完這個角色的設定與外觀。`);
    if (result) setAsk('');
  }

  return <div className="panel-stack">
    {proposal && <div className="ai-card" role="region" aria-label="AI 的建議">
      <div className="ai-card-head"><Sparkle size={16} weight="fill" /><b>AI 寫好了</b><span>{changes.length} 項</span></div>
      {proposal.summary && <p className="ai-card-summary">{proposal.summary}</p>}
      <ul className="change-list">{(showAll ? changes : changes.slice(0, 6)).map((change, index) => <li key={index}><span>{change.label}</span><b>{change.to}</b></li>)}</ul>
      {changes.length > 6 && <button type="button" className="btn btn-text" onClick={() => setShowAll(value => !value)}>{showAll ? '收起' : `還有 ${changes.length - 6} 項`}</button>}
      <div className="ai-card-actions">
        {hasPortrait ? <button type="button" className="btn btn-primary" onClick={() => onApply(proposal.id, { thenDraw: false })}>全部套用</button>
          : <><button type="button" className="btn btn-primary" onClick={() => onApply(proposal.id, { thenDraw: true })}>套用並畫第一張</button><button type="button" className="btn btn-secondary" onClick={() => onApply(proposal.id, { thenDraw: false })}>只套用</button></>}
        <button type="button" className="btn btn-quiet" onClick={() => onDismiss(proposal.id)}>不要</button>
      </div>
    </div>}

    <label className="field"><span>名字</span><input value={draft.name} maxLength={160} onChange={event => { const value = event.target.value; edit(next => { next.name = value || next.name; }, { group: 'name' }); }} /></label>
    <label className="field"><span>人設與故事</span><textarea rows={5} maxLength={12000} value={draft.persona.description} placeholder="例如：在軌道城市之間送件的信使，沉著、守信。" onChange={event => { const value = event.target.value; edit(next => { next.persona.description = value; }, { group: 'story' }); }} /></label>

    <Section title="個性">
      <ChipInput items={draft.persona.traits} max={12} placeholder="輸入後按 Enter" onAdd={text => edit(next => { next.persona.traits.push(text); })} onRemove={text => edit(next => { next.persona.traits = next.persona.traits.filter(item => item !== text); })} />
    </Section>

    <Section title="一定要保留的特徵" aside={<span className="sec-note">每張圖都會帶上</span>}>
      <ChipInput items={locks} max={12} icon={<LockSimple size={12} weight="bold" />} placeholder="例如：銀白短髮" onAdd={text => edit(next => { next.locks = [...(next.locks || []), text]; })} onRemove={text => edit(next => { next.locks = (next.locks || []).filter(item => item !== text); })} />
      {suggestions.length > 0 && <div className="chip-row">{suggestions.map(item => <button type="button" className="chip" key={item} onClick={() => edit(next => { next.locks = [...(next.locks || []), item]; })}><Plus size={12} />{item}</button>)}</div>}
    </Section>

    <Section title="讓 AI 幫忙">
      <textarea rows={3} maxLength={4000} value={ask} disabled={asking} placeholder="想加什麼？例如：補完背景故事、給一個招牌配件。不填就依目前人設補完。" onChange={event => setAsk(event.target.value)} />
      <button type="button" className="btn btn-secondary btn-block" disabled={asking} onClick={send}>{asking ? <Busy>AI 正在寫，約半分鐘…</Busy> : <><MagicWand size={16} />讓 AI 補完設定</>}</button>
      <p className="hint">AI 寫好的內容會先列出來，你按「套用」才會改。</p>
    </Section>
  </div>;
}
