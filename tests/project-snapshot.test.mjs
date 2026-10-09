import { describe, expect, test } from 'bun:test';
import { mergeProjectSnapshot } from '../shared/project-snapshot.mjs';

const snapshot = (id, revision, updatedAt, text = '') => ({ id, character: { revision }, updatedAt, canvasAnnotations: [{ id: 'note-1', text }] });

describe('並行角色與畫布保存的回應', () => {
  test('保留後到的新註記，較早的人物保存回應不會讓它消失', () => {
    const earlierCharacter = snapshot('rin', 6, '2026-10-02T03:00:00.000Z');
    const latestCanvas = snapshot('rin', 6, '2026-10-02T03:00:00.050Z', '保留辨識特徵');
    expect(mergeProjectSnapshot(latestCanvas, earlierCharacter)).toBe(latestCanvas);
  });
  test('切換角色後完成的註記保存不會跳回原角色', () => {
    const selected = snapshot('aki', 1, '2026-10-02T03:00:00.000Z');
    expect(mergeProjectSnapshot(selected, snapshot('rin', 5, '2026-10-02T03:00:01.000Z'))).toBe(selected);
  });
  test('同角色同版本的較新畫布回應會顯示，過舊角色版本不會替換目前設定', () => {
    const current = snapshot('rin', 6, '2026-10-02T03:00:00.000Z');
    const next = snapshot('rin', 6, '2026-10-02T03:00:01.000Z', '布料維持霧面');
    expect(mergeProjectSnapshot(current, next)).toBe(next);
    expect(mergeProjectSnapshot(next, snapshot('rin', 5, '2026-10-02T03:00:02.000Z'))).toBe(next);
  });
});
