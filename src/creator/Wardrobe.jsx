import { useState } from 'react';
import { Plus, Robot, TShirt } from '@phosphor-icons/react';
import { useT } from '../i18n';
import { L } from '../lib-i18n';
import { mainOutfitId, outfitPortrait, outfitsToDraw, OUTFIT_LIMIT } from '../../shared/wardrobe.mjs';
import { outfitOf, uid } from './helpers';

// 衣櫃（2026-10-13 起）：每套一張縮圖（主要那套是正式立繪，其他套是自己的立繪），點了切換舞台上的立繪。
// 新增套裝時先挑情境（便服、睡衣、制服…）一鍵套用；「照目前這套」沿用目前這套的裝備與風格。
// 情境開的新套裝只帶著頭髮、身體這類裝備（外套、鞋子這些衣服不會穿到睡衣上）。
const keepKinds = new Set(['hair', 'body']);

// onDrawAll（2026-10-14 起）：「全部畫完」交給全自動，照正式立繪一套一套畫還沒有立繪的穿搭；canAuto：畫圖方式是 AIDOL 直接畫。
export function Wardrobe({ draft, project, outfitId, onOutfit, edit, onDrawAll, canAuto = false, busy = false }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const outfits = Object.values(draft.outfits || {});
  const main = project?.character.adopted?.character ? mainOutfitId(project) : null;
  // 還沒有立繪的另一套（存好的設定；剛新增、還沒存的那套存好後就會算進來）。
  const left = project && main ? outfitsToDraw(project).length : 0;
  const running = project?.autopilot?.status === 'running';

  // 角色格式最多 100 套：滿了就不給新增（不然存檔會一直失敗）。
  const full = outfits.length >= OUTFIT_LIMIT;
  function add(scene) {
    if (full) return;
    const id = uid('outfit');
    edit(next => {
      const current = outfitOf(next, outfitId);
      const equipped = (current?.equipped || []).filter(item => !scene || keepKinds.has(next.components[item.componentId]?.kind));
      const style = scene?.style ? L.outfitStyles.find(item => item.id === scene.style) : null;
      const spec = scene ? { scene: scene.id, ...(style ? { style: style.id, ...style.defaults } : {}), ...(current?.spec?.colors?.length ? { colors: [...current.spec.colors] } : {}) } : current?.spec ? { ...current.spec } : null;
      next.outfits[id] = { id, name: scene ? scene.label : t('creator.outfit.defaultName', { number: outfits.length + 1 }), equipped: equipped.map(item => ({ ...item, id: uid('wear') })), ...(spec ? { spec } : {}) };
    }, { area: 'outfit' });
    onOutfit(id);
    setAdding(false);
  }

  return <div className="wardrobe">
    <div className="wardrobe-row" role="group" aria-label={t('creator.wardrobe.label')}>
      {outfits.map(outfit => {
        const portrait = project ? outfitPortrait(project, outfit.id) : null;
        const name = outfit.name || t('creator.outfit.untitled');
        return <button type="button" key={outfit.id} className="wardrobe-item" aria-pressed={outfit.id === outfitId} onClick={() => onOutfit(outfit.id)} title={name}>
          <span className="wardrobe-thumb">{portrait ? <img src={portrait.url} alt="" /> : <TShirt size={22} weight="light" />}{outfit.id === main && <span className="wardrobe-main">{t('creator.wardrobe.main')}</span>}</span>
          <span className="wardrobe-name">{name}</span>
        </button>;
      })}
      <button type="button" className="wardrobe-item wardrobe-add" aria-expanded={adding} disabled={full} title={full ? t('creator.wardrobe.full', { limit: OUTFIT_LIMIT }) : undefined} onClick={() => setAdding(value => !value)}>
        <span className="wardrobe-thumb"><Plus size={20} /></span>
        <span className="wardrobe-name">{t('creator.outfit.add')}</span>
      </button>
    </div>
    {onDrawAll && left > 0 && <div className="wardrobe-auto">
      <button type="button" className="btn btn-secondary btn-sm" disabled={!canAuto || running || busy} onClick={onDrawAll}><Robot size={15} />{t('creator.wardrobe.drawAll', { count: left })}</button>
      <small className="hint">{!canAuto ? t('creator.wardrobe.drawAllNeedsDirect') : running ? t('creator.wardrobe.drawAllRunning') : t('creator.wardrobe.drawAllHint')}</small>
    </div>}
    {adding && !full && <div className="wardrobe-scenes" role="group" aria-label={t('creator.wardrobe.scenes')}>
      <p className="hint">{t('creator.wardrobe.scenesHint')}</p>
      <div className="chip-row">
        {L.outfitScenes.map(scene => <button type="button" key={scene.id} className="chip" onClick={() => add(scene)}><Plus size={12} />{scene.label}</button>)}
        <button type="button" className="chip" onClick={() => add(null)}><Plus size={12} />{t('creator.wardrobe.blank')}</button>
      </div>
    </div>}
  </div>;
}
