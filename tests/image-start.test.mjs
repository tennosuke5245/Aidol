import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareFirstImage } from '../shared/image-start.mjs';

const project = () => ({ id: 'test', character: { name: '測試角色', revision: 2, adopted: {}, components: {}, outfits: { casual: {}, combat: {} } }, assets: [], candidates: [], jobs: [] });
function harness(data) {
  const calls = { create: [], handoff: [] };
  return { calls, options: { projectId: 'test', outfitId: 'casual', loadProject: async () => structuredClone(data), createJob: async (_id, value) => { calls.create.push(value); const job = { id: 'first', ...value, status: 'prepared' }; data.jobs.push(job); return job; }, handoffJob: async (_id, jobId) => { calls.handoff.push(jobId); return { job: data.jobs.find(job => job.id === jobId) }; } } };
}
test('first image uses the latest accepted revision and selected outfit', async () => {
  const data = project(); data.character.revision = 3;
  const h = harness(data); const result = await prepareFirstImage(h.options);
  assert.equal(result.state, 'handoff');
  assert.equal(h.calls.create[0].baseRevision, 3);
  assert.equal(h.calls.create[0].outfitId, 'casual');
  assert.equal(h.calls.create[0].kind, 'generate');
  assert.match(h.calls.create[0].prompt, /第一張角色設定稿/);
});
test('reopening first-image flow reuses the work instead of creating another', async () => {
  const h = harness(project()); await prepareFirstImage(h.options); await prepareFirstImage(h.options);
  assert.equal(h.calls.create.length, 1);
  assert.deepEqual(h.calls.handoff, ['first', 'first']);
});
test('returned candidate opens review without moving job back to handed off', async () => {
  const data = project(); data.jobs.push({ id: 'ready', targetId: 'character', outfitId: 'casual', outputView: 'front', baseRevision: 2, status: 'review' }); data.candidates.push({ id: 'candidate', jobId: 'ready', status: 'pending' });
  const h = harness(data); const result = await prepareFirstImage(h.options);
  assert.equal(result.state, 'review'); assert.equal(result.candidate.id, 'candidate');
  assert.equal(h.calls.create.length, 0); assert.equal(h.calls.handoff.length, 0);
});
test('older revision and other outfit jobs are not reused for a new image', async () => {
  const data = project(); data.jobs.push({ id: 'old', targetId: 'character', outfitId: 'casual', baseRevision: 1, status: 'handed_off' }, { id: 'other', targetId: 'character', outfitId: 'combat', baseRevision: 2, status: 'handed_off' });
  const h = harness(data); await prepareFirstImage(h.options); assert.equal(h.calls.create.length, 1);
});
test('adopted main image is retained and no new job starts', async () => {
  const data = project(); data.character.adopted.character = 'image'; data.assets.push({ id: 'image', outfitId: 'casual' });
  const h = harness(data); assert.equal((await prepareFirstImage(h.options)).state, 'adopted'); assert.equal(h.calls.create.length, 0);
});
test('image drawn with older settings still opens for picking instead of starting over', async () => {
  const data = project(); data.jobs.push({ id: 'drawn', targetId: 'character', outfitId: 'casual', outputView: 'front', baseRevision: 1, status: 'review' }); data.candidates.push({ id: 'kept', jobId: 'drawn', status: 'pending', baseRevision: 1 });
  const h = harness(data); const result = await prepareFirstImage(h.options);
  assert.equal(result.state, 'review'); assert.equal(result.candidate.id, 'kept');
  assert.equal(h.calls.create.length, 0);
});
