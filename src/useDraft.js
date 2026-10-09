import { useCallback, useEffect, useRef, useState } from 'react';
import { api, clone } from './api';
import { mergeCharacter } from '../shared/character-diff.mjs';

// 角色草稿：改了就自動存檔（像遊戲一樣，不用按儲存），可以復原。
// 每次存檔都是一個新版本；別處改了設定（採用圖、AI 提案）時，
// 只把自己這邊的修改合併上去，不會互相蓋掉。
export function useDraft(studio, project) {
  // 只取穩定的函式；studio 物件本身每次 render 都是新的，不能放進相依清單。
  const { updateProject, notify } = studio;
  const [draft, setDraftState] = useState(project.character);
  const [saveState, setSaveState] = useState('saved');
  const [pulse, setPulse] = useState(null);
  const stacks = useRef({ undo: [], redo: [] });
  const [, bump] = useState(0);
  const draftRef = useRef(draft);
  const base = useRef(project.character);
  const dirty = useRef(false);
  const saving = useRef(null);
  const timer = useRef(null);
  const group = useRef(null);
  const pulses = useRef(0);
  const projectId = project.id;

  const setDraft = useCallback(next => { draftRef.current = next; setDraftState(next); }, []);

  // 外部改動（採用圖、套用 AI 提案、恢復存檔、輪詢更新）同步進來。
  useEffect(() => {
    const server = project.character;
    if (server === base.current) return;
    if (!dirty.current && !saving.current) { base.current = server; setDraft(server); return; }
    if (server.revision > base.current.revision) {
      const merged = mergeCharacter(base.current, draftRef.current, server);
      base.current = server; setDraft(merged);
    }
  }, [project.character, setDraft]);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current) return saving.current;
    if (!dirty.current) return null;
    dirty.current = false; setSaveState('saving');
    const run = (async () => {
      try {
        const character = { ...draftRef.current, revision: base.current.revision };
        const result = await api(`/projects/${projectId}/character`, { method: 'PUT', body: { baseRevision: base.current.revision, character } });
        base.current = result.character;
        updateProject(result);
        if (!dirty.current) setDraft(result.character);
        setSaveState(dirty.current ? 'pending' : 'saved');
        return result;
      } catch (error) {
        if (error.status === 409) {
          const latest = await api(`/projects/${projectId}`);
          const merged = mergeCharacter(base.current, draftRef.current, latest.character);
          base.current = latest.character; updateProject(latest); setDraft(merged);
          dirty.current = true; setSaveState('pending');
        } else {
          dirty.current = true; setSaveState('error');
          notify(`自動存檔失敗：${error.message}`, true);
        }
        return null;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = run;
    const result = await run;
    if (dirty.current) timer.current = setTimeout(() => save(), 400);
    return result;
  }, [projectId, updateProject, notify, setDraft]);

  // 開始繪製前：確保畫的是目前看到的設定。
  const flush = useCallback(async () => {
    for (let guard = 0; guard < 4 && (dirty.current || saving.current); guard += 1) {
      if (saving.current) await saving.current; else await save();
    }
    return base.current;
  }, [save]);

  const edit = useCallback((mutate, { area, group: key } = {}) => {
    const previous = draftRef.current;
    const next = clone(previous);
    mutate(next);
    const now = Date.now();
    const continues = key && group.current?.key === key && now - group.current.at < 700;
    group.current = key ? { key, at: now } : null;
    if (!continues) { stacks.current = { undo: [...stacks.current.undo, previous].slice(-40), redo: [] }; bump(value => value + 1); }
    setDraft(next);
    dirty.current = true; setSaveState('pending');
    if (area) { pulses.current += 1; setPulse({ area, key: pulses.current }); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(), 700);
  }, [save, setDraft]);

  const jump = useCallback(direction => {
    const stack = stacks.current;
    const from = direction === 'undo' ? stack.undo : stack.redo;
    if (!from.length) return;
    const target = from.at(-1);
    const current = draftRef.current;
    stacks.current = direction === 'undo'
      ? { undo: stack.undo.slice(0, -1), redo: [...stack.redo, current] }
      : { undo: [...stack.undo, current], redo: stack.redo.slice(0, -1) };
    group.current = null;
    setDraft({ ...target, revision: current.revision, adopted: current.adopted });
    dirty.current = true; setSaveState('pending'); bump(value => value + 1);
    clearTimeout(timer.current); timer.current = setTimeout(() => save(), 500);
  }, [save, setDraft]);

  useEffect(() => {
    const handle = event => {
      // 文字欄位裡的 Ctrl＋Z 交給瀏覽器；滑桿、旋鈕等控制項上則復原設定。
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || event.target.closest?.('input:not([type=range]):not([type=color]), textarea, [contenteditable]')) return;
      event.preventDefault(); jump(event.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [jump]);

  // 離開角色工作台時把還沒存的改動存掉。
  useEffect(() => () => { if (dirty.current) save(); }, [save]);

  return { draft, edit, saveState, retry: save, flush, pulse, canUndo: stacks.current.undo.length > 0, canRedo: stacks.current.redo.length > 0, undo: () => jump('undo'), redo: () => jump('redo') };
}
