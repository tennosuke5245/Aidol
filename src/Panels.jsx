import { useEffect, useRef, useState } from 'react';
import { X, CircleNotch, Sparkle, UploadSimple, FileCode, Crosshair, ClockCounterClockwise } from '@phosphor-icons/react';
import { clone, dateLabel } from './api';
import { stringify as yamlStringify } from 'yaml';
import { Mark } from './ui';

export function Busy({ children = '處理中…' }) { return <span className="busy-label"><CircleNotch className="spin" size={16} />{children}</span>; }
export function Empty({ title, children }) { return <div className="empty-state"><Sparkle size={28} weight="light" /><h3>{title}</h3><p>{children}</p></div>; }

export function Modal({ title, subtitle, children, onClose, wide }) {
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
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'modal-wide' : ''}`} ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}><header className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-btn" aria-label="關閉視窗" onClick={onClose}><X size={20} /></button></header>{children}</section></div>;
}

// 選圖區：選好之後直接顯示預覽，點預覽可以換一張（也可以把圖拖進來）；取消選擇時保留原本那張。
function ImagePick({ file, onChange, label, iconSize = 26 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) { setUrl(null); return undefined; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return <label className={`upload-area ${url ? 'has-preview' : ''}`}>
    {url ? <img className="upload-preview" src={url} alt={`預覽：${file.name}`} draggable="false" /> : <UploadSimple size={iconSize} />}
    <strong>{file ? file.name : label}</strong>
    <span>{file ? '點一下或拖進另一張圖可以換掉' : 'PNG、JPEG 或 WebP，最大 25 MB；也可以把圖拖進來'}</span>
    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const picked = event.target.files?.[0]; if (picked) onChange(picked); }} />
  </label>;
}

export function NewCharacterForm({ busy, onCreate }) {
  const [name, setName] = useState(''), [brief, setBrief] = useState(''), [file, setFile] = useState(null), [role, setRole] = useState('identity');
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); if (name.trim()) onCreate({ name: name.trim(), brief: brief.trim(), file, role }); }}>
    <label className="field"><span>名字</span><input autoFocus required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="例如：羽" /></label>
    <label className="field"><span>一句話描述（可不填）</span><textarea rows={3} maxLength={12000} value={brief} onChange={event => setBrief(event.target.value)} placeholder="例如：十二歲的天才駭客，黑紅配色，嘴硬心軟。" /></label>
    <ImagePick file={file} onChange={setFile} label="參考圖（可不填）" iconSize={24} />
    {file && <label className="field"><span>這張圖要參考它的</span><select value={role} onChange={event => setRole(event.target.value)}><option value="identity">外觀與辨識特徵</option><option value="style">畫風（線條、上色）</option><option value="color">配色</option><option value="clothing">服裝結構</option></select></label>}
    <p className="hint">{brief.trim() ? '建立後 AI 會依這段描述寫好設定，你看過再套用。' : '建立後直接進「捏角色」，從外觀開始。'}</p>
    <button className="btn btn-primary btn-lg" disabled={busy || !name.trim()}>{busy ? <Busy>建立中…</Busy> : <><Sparkle size={16} weight="fill" />開始捏角色</>}</button>
  </form>;
}

export function PartForm({ part, busy, onSave }) {
  const [value, setValue] = useState(part ? clone(part) : { name: '', kind: 'accessory', description: '' });
  const field = key => ({ value: value[key] || '', onChange: event => setValue({ ...value, [key]: event.target.value }) });
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); if (value.name.trim()) onSave(value); }}>
    <div className="form-row">
      <label className="field"><span>名字</span><input autoFocus required maxLength={160} {...field('name')} placeholder="例如：月牙髮夾" /></label>
      {!part && <label className="field"><span>種類</span><select {...field('kind')}><option value="accessory">配件</option><option value="garment">服裝</option><option value="footwear">鞋靴</option><option value="hair">髮型</option><option value="weapon">武器</option><option value="body">身體特徵</option><option value="other">其他</option></select></label>}
    </div>
    <label className="field"><span>長什麼樣子</span><textarea rows={4} maxLength={12000} {...field('description')} placeholder="例如：黃銅月牙髮夾，沿用胸前扣具的材質。" /></label>
    <button className="btn btn-primary btn-lg" disabled={busy || !value.name.trim()}>{busy ? <Busy /> : part ? '儲存' : '加入裝備欄'}</button>
  </form>;
}

export function ReferenceForm({ busy, onUpload }) {
  const [file, setFile] = useState(null), [role, setRole] = useState('style'), [focus, setFocus] = useState('線條，陰影');
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); onUpload(file, role, focus.split(/[,，]/).map(item => item.trim()).filter(Boolean)); }}>
    <ImagePick file={file} onChange={setFile} label="選擇參考圖片" />
    <label className="field"><span>參考用途</span><select value={role} onChange={event => setRole(event.target.value)}><option value="style">繪風</option><option value="identity">辨識特徵</option><option value="color">配色</option><option value="clothing">服裝結構</option><option value="material">材質</option><option value="composition">構圖</option></select></label>
    <label className="field"><span>想參考的地方</span><input value={focus} onChange={event => setFocus(event.target.value)} placeholder="線條，陰影，金屬質感" /></label>
    <p className="hint">用途會跟著之後的每次繪製帶上。</p>
    <button className="btn btn-primary btn-lg" disabled={busy || !file}>{busy ? <Busy /> : '加入參考'}</button>
  </form>;
}

export function SettingsPanel({ project, status, busy, onYaml, onInstall, onRefresh }) {
  const [baseRevision] = useState(project.character.revision);
  const [tab, setTab] = useState('yaml');
  const [yaml, setYaml] = useState(() => yamlStringify(project.character));
  return <div className="form-stack">
    <div className="tabs" role="tablist" aria-label="設定分類"><button type="button" role="tab" aria-selected={tab === 'yaml'} onClick={() => setTab('yaml')}>原始設定檔</button><button type="button" role="tab" aria-selected={tab === 'codex'} onClick={() => setTab('codex')}>Codex 連線</button></div>
    {tab === 'yaml' && <div className="form-stack"><p className="hint">角色設定的原始檔。儲存時會檢查格式與圖片引用；平常在「捏角色」調整就好。</p><textarea className="yaml-editor" aria-label="人物 YAML 設定檔" spellCheck={false} value={yaml} onChange={event => setYaml(event.target.value)} /><button type="button" className="btn btn-primary btn-lg" disabled={busy || !yaml} onClick={() => onYaml(yaml, baseRevision)}>{busy ? <Busy /> : `驗證並儲存為 v${baseRevision + 1}`}</button></div>}
    {tab === 'codex' && <div className="form-stack">
      <div className="integration-card"><Mark size={28} /><div><strong>Codex CLI · 文字協作</strong><p>{status?.available ? `${status.version} · ${status.authenticated ? '已登入' : '尚未登入'}` : status?.error || '正在檢查連線…'}</p>{status?.planType && <span className="tag">{status.planType}</span>}</div></div>
      <button type="button" className="btn btn-secondary" onClick={onRefresh}>重新檢查連線</button>
      <div className="integration-card"><FileCode size={26} /><div><strong>AIDOL Skill · 產圖與回報</strong><p>{status?.skill?.installed ? '已安裝，新對話可使用 $aidol。' : '每次送出都會附上專案 Skill；也可以安裝到你的 Codex。'}</p></div></div>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={onInstall}>{busy ? <Busy /> : status?.skill?.installed ? '更新 AIDOL Skill' : '安裝到 Codex'}</button>
      <div className="notice">文字設定由 Codex CLI 協作；圖片在 Codex App 畫。AIDOL 會在 Codex 開好新對話，你按送出後，Skill 會回報進度並把圖送回來。不會改用另行計費的 Image API。</div>
    </div>}
  </div>;
}

export function HistoryList({ project, busy, onRestore }) {
  return <ol className="history-list">{[...project.history].reverse().map(entry => <li key={entry.id} className="history-item">
    <span className="history-dot" aria-hidden="true" />
    <div><strong>{entry.message}</strong><small>{dateLabel(entry.createdAt)}　第 {entry.revision} 次存檔</small></div>
    <button type="button" className="btn btn-text" disabled={busy || entry.revision === project.character.revision} onClick={() => onRestore(entry)}>{entry.revision === project.character.revision ? '目前' : <><ClockCounterClockwise size={13} />讀取這個存檔</>}</button>
  </li>)}</ol>;
}
