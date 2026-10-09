import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeGraphNodes } from '../src/canvas-node-state.mjs';

test('任務與註記資料刷新時保留圖稿拖曳位置與量測，同時接收新內容與選取', () => {
  const previous = [{ id: 'character', type: 'art', position: { x: 420, y: 90 }, measured: { width: 610, height: 965 }, data: { name: '先前角色' }, selected: true }];
  const next = [{ id: 'character', type: 'art', position: { x: 340, y: 42 }, style: { width: 610, height: 965 }, data: { name: '目前角色' }, selected: false }, { id: 'annotation:one', type: 'annotation', position: { x: 100, y: 200 }, style: { width: 260 }, data: { text: '新便利貼' } }];
  const merged = mergeGraphNodes(previous, next);
  assert.deepEqual(merged[0].position, { x: 420, y: 90 });
  assert.deepEqual(merged[0].measured, previous[0].measured);
  assert.equal(merged[0].selected, false);
  assert.equal(merged[0].data.name, '目前角色');
  assert.deepEqual(merged[1].position, { x: 100, y: 200 });
  assert.equal(merged[1].height, undefined, '註記高度由實際內容量測，不能套用圖稿高度');
  assert.deepEqual(previous[0].position, { x: 420, y: 90 }, '不修改原節點');
});

test('後端位置可更新註記，但刷新不得打斷正在拖曳的卡片；刪除的註記不留下占位', () => {
  const current = [
    { id: 'annotation:one', type: 'annotation', position: { x: 80, y: 90 }, measured: { width: 260, height: 180 } },
    { id: 'annotation:two', type: 'annotation', position: { x: 180, y: 190 }, dragging: true },
    { id: 'annotation:removed', type: 'annotation', position: { x: 1, y: 1 } },
    { id: 'formal-reference:ref', type: 'formalReference', position: { x: 1020, y: 50 } },
  ];
  const incoming = [
    { id: 'annotation:one', type: 'annotation', position: { x: 300, y: 400 }, style: { width: 260 } },
    { id: 'annotation:two', type: 'annotation', position: { x: 20, y: 30 } },
    { id: 'formal-reference:ref', type: 'formalReference', position: { x: 994, y: 52 } },
  ];
  const merged = mergeGraphNodes(current, incoming);
  assert.deepEqual(merged[0].position, { x: 300, y: 400 });
  assert.deepEqual(merged[0].measured, current[0].measured);
  assert.deepEqual(merged[1].position, { x: 180, y: 190 });
  assert.deepEqual(merged[2].position, { x: 1020, y: 50 });
  assert.equal(merged.some(node => node.id === 'annotation:removed'), false);
});
