import { useEffect, useRef, useState } from 'react';
import { X, CircleNotch, Sparkle, UploadSimple, FileCode, Crosshair, ClockCounterClockwise, Trash } from '@phosphor-icons/react';
import { clone, dateLabel, errorText } from './api';
import { getLocale, isSource, t, useT } from './i18n';
import { legacyHistory } from './history-legacy';
import { stringify as yamlStringify } from 'yaml';
import { Mark } from './ui';

export function Busy({ children }) { useT(); return <span className="busy-label"><CircleNotch className="spin" size={16} />{children ?? t('panels.busy')}</span>; }
export function Empty({ title, children }) { return <div className="empty-state"><Sparkle size={28} weight="light" /><h3>{title}</h3><p>{children}</p></div>; }

export function Modal({ title, subtitle, children, onClose, wide }) {
  useT();
  const box = useRef(null);
  const closeAction = useRef(onClose);
  closeAction.current = onClose;
  useEffect(() => {
    const prior = document.activeElement; box.current?.focus();
    const handle = event => {
      if (event.key === 'Escape') closeAction.current();
      if (event.key === 'Tab') {
        const items = [...box.current.querySelectorAll('button:not(:disabled),a[href],input,textarea,select,[tabindex="0"]')];
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); prior?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'modal-wide' : ''}`} ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}><header className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-btn" aria-label={t('panels.closeDialog')} onClick={onClose}><X size={20} /></button></header>{children}</section></div>;
}

// 選圖區：選好之後直接顯示預覽，點預覽可以換一張（也可以把圖拖進來）；取消選擇時保留原本那張。
function ImagePick({ file, onChange, label, iconSize = 26 }) {
  useT();
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) { setUrl(null); return undefined; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return <label className={`upload-area ${url ? 'has-preview' : ''}`}>
    {url ? <img className="upload-preview" src={url} alt={t('panels.image.previewAlt', { name: file.name })} draggable="false" /> : <UploadSimple size={iconSize} />}
    <strong>{file ? file.name : label}</strong>
    <span>{file ? t('panels.image.replaceHint') : t('panels.image.formats')}</span>
    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const picked = event.target.files?.[0]; if (picked) onChange(picked); }} />
  </label>;
}

export function NewCharacterForm({ busy, onCreate }) {
  useT();
  const [name, setName] = useState(''), [brief, setBrief] = useState(''), [file, setFile] = useState(null), [role, setRole] = useState('identity');
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); if (name.trim()) onCreate({ name: name.trim(), brief: brief.trim(), file, role }); }}>
    <label className="field"><span>{t('panels.newCharacter.name')}</span><input autoFocus required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder={t('panels.newCharacter.namePlaceholder')} /></label>
    <label className="field"><span>{t('panels.newCharacter.brief')}</span><textarea rows={3} maxLength={12000} value={brief} onChange={event => setBrief(event.target.value)} placeholder={t('panels.newCharacter.briefPlaceholder')} /></label>
    <ImagePick file={file} onChange={setFile} label={t('panels.newCharacter.reference')} iconSize={24} />
    {file && <label className="field"><span>{t('panels.newCharacter.useFor')}</span><select value={role} onChange={event => setRole(event.target.value)}><option value="identity">{t('panels.newCharacter.role.identity')}</option><option value="style">{t('panels.newCharacter.role.style')}</option><option value="color">{t('panels.newCharacter.role.color')}</option><option value="clothing">{t('panels.newCharacter.role.clothing')}</option></select></label>}
    <p className="hint">{brief.trim() ? t('panels.newCharacter.hintWithBrief') : t('panels.newCharacter.hintEmpty')}</p>
    <button className="btn btn-primary btn-lg" disabled={busy || !name.trim()}>{busy ? <Busy>{t('panels.newCharacter.creating')}</Busy> : <><Sparkle size={16} weight="fill" />{t('panels.newCharacter.submit')}</>}</button>
  </form>;
}

export function PartForm({ part, busy, onSave }) {
  useT();
  const [value, setValue] = useState(part ? clone(part) : { name: '', kind: 'accessory', description: '' });
  const field = key => ({ value: value[key] || '', onChange: event => setValue({ ...value, [key]: event.target.value }) });
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); if (value.name.trim()) onSave(value); }}>
    <div className="form-row">
      <label className="field"><span>{t('panels.part.name')}</span><input autoFocus required maxLength={160} {...field('name')} placeholder={t('panels.part.namePlaceholder')} /></label>
      {!part && <label className="field"><span>{t('panels.part.kind')}</span><select {...field('kind')}>{['accessory', 'garment', 'footwear', 'hair', 'weapon', 'body', 'other'].map(kind => <option key={kind} value={kind}>{t(`panels.part.kinds.${kind}`)}</option>)}</select></label>}
    </div>
    <label className="field"><span>{t('panels.part.description')}</span><textarea rows={4} maxLength={12000} {...field('description')} placeholder={t('panels.part.descriptionPlaceholder')} /></label>
    <button className="btn btn-primary btn-lg" disabled={busy || !value.name.trim()}>{busy ? <Busy /> : part ? t('panels.part.save') : t('panels.part.add')}</button>
  </form>;
}

export function ReferenceForm({ busy, onUpload }) {
  useT();
  const [file, setFile] = useState(null), [role, setRole] = useState('style'), [focus, setFocus] = useState(() => t('panels.reference.focusDefault'));
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); onUpload(file, role, focus.split(getLocale() === 'ja' ? /[,，、]/ : /[,，]/).map(item => item.trim()).filter(Boolean)); }}>
    <ImagePick file={file} onChange={setFile} label={t('panels.reference.choose')} />
    <label className="field"><span>{t('panels.reference.role')}</span><select value={role} onChange={event => setRole(event.target.value)}>{['style', 'identity', 'color', 'clothing', 'material', 'composition'].map(item => <option key={item} value={item}>{t(`panels.reference.roles.${item}`)}</option>)}</select></label>
    <label className="field"><span>{t('panels.reference.focus')}</span><input value={focus} onChange={event => setFocus(event.target.value)} placeholder={t('panels.reference.focusPlaceholder')} /></label>
    <p className="hint">{t('panels.reference.hint')}</p>
    <button className="btn btn-primary btn-lg" disabled={busy || !file}>{busy ? <Busy /> : t('panels.reference.add')}</button>
  </form>;
}

export function SettingsPanel({ project, status, busy, onYaml, onInstall, onRefresh }) {
  useT();
  const [baseRevision] = useState(project.character.revision);
  const [tab, setTab] = useState('yaml');
  const [yaml, setYaml] = useState(() => yamlStringify(project.character));
  return <div className="form-stack">
    <div className="tabs" role="tablist" aria-label={t('panels.settings.tabs')}><button type="button" role="tab" aria-selected={tab === 'yaml'} onClick={() => setTab('yaml')}>{t('panels.settings.yamlTab')}</button><button type="button" role="tab" aria-selected={tab === 'codex'} onClick={() => setTab('codex')}>{t('panels.settings.codexTab')}</button></div>
    {tab === 'yaml' && <div className="form-stack"><p className="hint">{t('panels.settings.yamlHint')}</p><textarea className="yaml-editor" aria-label={t('panels.settings.yamlLabel')} spellCheck={false} value={yaml} onChange={event => setYaml(event.target.value)} /><button type="button" className="btn btn-primary btn-lg" disabled={busy || !yaml} onClick={() => onYaml(yaml, baseRevision)}>{busy ? <Busy /> : t('panels.settings.yamlSave', { version: baseRevision + 1 })}</button></div>}
    {tab === 'codex' && <div className="form-stack">
      <div className="integration-card"><Mark size={28} /><div><strong>{t('panels.settings.cliTitle')}</strong><p>{status?.available ? `${status.version} · ${status.authenticated ? t('panels.settings.signedIn') : t('panels.settings.notSignedIn')}` : status?.error ? errorText(status.code || 'CODEX_UNAVAILABLE', status.error) : t('panels.settings.checking')}</p>{status?.planType && <span className="tag">{status.planType}</span>}</div></div>
      <button type="button" className="btn btn-secondary" onClick={onRefresh}>{t('panels.settings.recheck')}</button>
      <div className="integration-card"><FileCode size={26} /><div><strong>{t('panels.settings.skillTitle')}</strong><p>{status?.skill?.installed ? t('panels.settings.skillInstalled') : t('panels.settings.skillNotInstalled')}</p></div></div>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={onInstall}>{busy ? <Busy /> : status?.skill?.installed ? t('panels.settings.skillUpdate') : t('panels.settings.skillInstall')}</button>
      <div className="notice">{t('panels.settings.notice')}</div>
    </div>}
  </div>;
}

function historyMessage(entry) {
  if (isSource()) return entry.message;
  let key = entry.messageKey, params = entry.messageParams || {};
  if (!key) for (const [pattern, legacyKey, read] of legacyHistory) {
    const match = pattern.exec(entry.message || '');
    if (match) { key = legacyKey; params = read ? read(match) : {}; break; }
  }
  if (!key) return entry.message;
  if (key === 'partAdopted' && !['front', 'full', 'back', 'detail'].includes(params.view)) key = 'partAdoptedPlain';
  return t(`history.${key}`, { ...params, ...(params.view ? { view: t(`history.view.${params.view}`, { defaultValue: '' }) } : {}), defaultValue: entry.message });
}

export function HistoryList({ project, busy, onRestore }) {
  useT();
  return <ol className="history-list">{[...project.history].reverse().map(entry => <li key={entry.id} className="history-item">
    <span className="history-dot" aria-hidden="true" />
    <div><strong>{historyMessage(entry)}</strong><small>{dateLabel(entry.createdAt)}{t('common.gap')}{t('panels.history.saveNumber', { revision: entry.revision })}</small></div>
    <button type="button" className="btn btn-text" disabled={busy || entry.revision === project.character.revision} onClick={() => onRestore(entry)}>{entry.revision === project.character.revision ? t('panels.history.current') : <><ClockCounterClockwise size={13} />{t('panels.history.restore')}</>}</button>
  </li>)}</ol>;
}

// 刪除角色的確認：說清楚會移到資源回收區、可以復原；還有工作在畫時多提醒一句。
export function DeleteCharacterConfirm({ name, imageCount = 0, drawing = false, busy, onCancel, onConfirm }) {
  useT();
  return <div className="form-stack">
    <p>{imageCount ? t('app.delete.body', { name, count: imageCount }) : t('app.delete.bodyNoImages', { name })}</p>
    {drawing && <div className="notice error">{t('app.delete.drawing')}</div>}
    <div className="modal-actions">
      <button type="button" className="btn btn-secondary" onClick={onCancel}>{t('app.delete.cancel')}</button>
      <button type="button" className="btn btn-secondary btn-danger" disabled={busy} onClick={onConfirm}>{busy ? <Busy /> : <><Trash size={16} />{t('app.delete.confirm')}</>}</button>
    </div>
  </div>;
}

// 資源回收區：每個刪除的角色可以復原；永久刪除要再按一次確認（真的刪掉檔案，無法復原）。
export function TrashList({ items, busy, onRestore, onPurge }) {
  useT();
  const [confirming, setConfirming] = useState(null);
  if (!items.length) return <p className="hint">{t('app.trash.empty')}</p>;
  return <ol className="history-list trash-list">{items.map(item => <li key={item.trashId} className="history-item">
    <span className="history-dot" aria-hidden="true" />
    <div><strong>{item.name}</strong><small>{item.deletedAt ? dateLabel(item.deletedAt) : ''}{item.imageCount ? `${t('common.gap')}${t('app.trash.images', { count: item.imageCount })}` : ''}</small></div>
    <div className="trash-actions">
      <button type="button" className="btn btn-text" disabled={busy} onClick={() => onRestore(item)}><ClockCounterClockwise size={13} />{t('app.trash.restore')}</button>
      {confirming === item.trashId
        ? <button type="button" className="btn btn-text btn-danger" disabled={busy} onClick={() => { setConfirming(null); onPurge(item); }}>{t('app.trash.purgeConfirm')}</button>
        : <button type="button" className="btn btn-text btn-danger" disabled={busy} onClick={() => setConfirming(item.trashId)}><Trash size={13} />{t('app.trash.purge')}</button>}
    </div>
  </li>)}</ol>;
}

