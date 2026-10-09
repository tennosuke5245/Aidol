import test from 'node:test';
import assert from 'node:assert/strict';
import { jobPresentation, jobProgress, workspaceSummary, candidateComparison, hasCharacterSetup } from '../shared/agent-workspace.mjs';

function fixture() {
  return {
    id: 'test', character: { revision: 3, components: { coat: { views: {} } }, adopted: {}, outfits: { casual: { name: '休閒穿搭' }, combat: { name: '戰鬥穿搭' } } },
    assets: [], jobs: [], candidates: [], proposals: [],
  };
}
function job(id, overrides = {}) {
  return { id, targetId: 'character', outfitId: 'casual', outputView: 'front', baseRevision: 3, status: 'prepared', createdAt: '2026-10-02T00:00:00Z', ...overrides };
}
function candidate(id, jobId, overrides = {}) {
  return { id, jobId, assetId: `asset-${id}`, targetId: 'character', outfitId: 'casual', view: 'front', baseRevision: 3, status: 'pending', createdAt: '2026-10-02T00:00:00Z', ...overrides };
}

test('人設採用與首圖進程不以拆件數量推斷，零部件仍能繼續出圖', () => {
  const project = fixture();
  project.character.components = {};
  project.character.revision = 1;
  assert.equal(hasCharacterSetup(null), false);
  assert.equal(hasCharacterSetup(project), false);
  project.proposals.push({ status: 'pending' });
  assert.equal(hasCharacterSetup(project), false, '尚未採用的提案不能冒充正式人設');
  project.proposals[0].status = 'accepted';
  assert.equal(hasCharacterSetup(project), true);
  project.proposals = [];
  project.jobs.push(job('first', { baseRevision: 1, status: 'handed_off' }));
  assert.equal(hasCharacterSetup(project), true, '既有首圖工作不能退回重新輸入人設');
  project.jobs = [];
  project.character.revision = 2;
  assert.equal(hasCharacterSetup(project), true, '已保存的人設可先出整體稿，再拆部件');
});

test('已採用與已結束工作不再催促；用較早設定畫的只標示版本', () => {
  const project = fixture();
  const accepted = job('accepted', { status: 'accepted', baseRevision: 2 });
  const oldCandidate = candidate('accepted', 'accepted', { status: 'accepted', baseRevision: 2 });
  project.jobs.push(accepted, job('cancelled', { status: 'cancelled', baseRevision: 2 }));
  project.candidates.push(oldCandidate);
  assert.deepEqual(jobPresentation(project, accepted), { label: '已採用', tone: 'success', action: 'view', actionLabel: '查看', candidate: oldCandidate, needsAttention: false, olderSettings: true });
  assert.equal(jobPresentation(project, project.jobs[1]).action, 'none');
  assert.equal(jobPresentation(project, project.jobs[1]).label, '已結束');
  const summary = workspaceSummary(project, 'casual');
  assert.equal(summary.attentionCount, 0);
  assert.equal(summary.historyJobs.length, 2);
});

test('有效候選優先直接審閱，查詢不修改 review 工作或新增交接', () => {
  const project = fixture(), work = job('review', { status: 'review' });
  project.jobs.push(work);
  const first = candidate('first', work.id), newest = candidate('newest', work.id, { createdAt: '2026-10-02T00:01:00Z' });
  project.candidates.push(first, newest);
  const before = structuredClone(project);
  const result = jobPresentation(project, work);
  assert.equal(result.action, 'review');
  assert.equal(result.label, '新圖 2');
  assert.equal(result.candidate, newest);
  assert.equal(result.needsAttention, true);
  const summary = workspaceSummary(project, 'casual');
  assert.equal(summary.reviewCandidates.length, 2);
  assert.equal(summary.attentionJobs.length, 1);
  assert.equal(summary.attentionCount, 1, '同一工作有多張候選不能重複計算待辦');
  assert.deepEqual(project, before);
});

test('畫好的圖不因設定改版被鎖住；沒送出的舊工作不再催促', () => {
  const project = fixture();
  const drawn = job('drawn', { status: 'review', baseRevision: 2 });
  const unsent = job('unsent', { status: 'handed_off', baseRevision: 2 });
  const missing = job('missing', { status: 'review' });
  project.jobs.push(drawn, unsent, missing);
  project.candidates.push(candidate('drawn', drawn.id, { baseRevision: 2 }));
  const result = jobPresentation(project, drawn);
  assert.equal(result.label, '新圖 1');
  assert.equal(result.action, 'review');
  assert.equal(result.olderSettings, true);
  assert.equal(result.needsAttention, true);
  const old = jobPresentation(project, unsent);
  assert.equal(old.label, '未送出');
  assert.equal(old.needsAttention, false);
  assert.equal(jobPresentation(project, missing).label, '沒有新圖');
  assert.equal(jobPresentation(project, missing).action, 'new');
  assert.equal(jobPresentation(project, missing).needsAttention, false);
  const summary = workspaceSummary(project, 'casual');
  assert.deepEqual(summary.attentionJobs.map(item => item.id), ['drawn']);
  assert.deepEqual(summary.reviewCandidates.map(item => item.id), ['drawn']);
});

test('候選必須符合工作目標、視角、穿搭，才可成為挑選主操作', () => {
  for (const invalid of [{ targetId: 'coat' }, { view: 'back' }, { outfitId: 'combat' }, { jobId: 'other' }]) {
    const project = fixture(), work = job('review', { status: 'review' });
    project.jobs.push(work);
    project.candidates.push(candidate('wrong', work.id, invalid));
    assert.equal(jobPresentation(project, work).action, 'new', JSON.stringify(invalid));
    assert.equal(work.status, 'review');
  }
});

test('交接狀態只描述準備程度，未知狀態不推測執行或進度', () => {
  const project = fixture();
  for (const status of ['prepared', 'queued']) {
    const result = jobPresentation(project, job(status, { status }));
    assert.equal(result.label, '等你送出');
    assert.equal(result.action, 'handoff');
    assert.equal(result.tone, 'blue');
    assert.equal(result.needsAttention, true);
  }
  const handedOff = jobPresentation(project, job('handoff', { status: 'handed_off' }));
  assert.equal(handedOff.label, '等你送出');
  assert.equal(handedOff.action, 'handoff');
  const unknown = jobPresentation(project, job('unknown', { status: 'running_without_event' }));
  assert.equal(unknown.label, '狀態待確認');
  assert.equal(unknown.action, 'none');
  assert.equal(unknown.needsAttention, false);
});

test('摘要只計同穿搭，挑圖排最先，其餘按時間反序，提案不分版本都算待辦', () => {
  const project = fixture();
  project.jobs.push(
    job('prepared', { createdAt: '2026-10-02T00:02:00Z' }),
    job('review', { status: 'review', createdAt: '2026-10-02T00:01:00Z' }),
    job('handoff', { status: 'handed_off', createdAt: '2026-10-02T00:03:00Z' }),
    job('other', { outfitId: 'combat', status: 'review' }),
    job('old', { baseRevision: 2 }),
  );
  project.candidates.push(candidate('review', 'review'), candidate('other', 'other', { outfitId: 'combat' }));
  project.proposals.push(
    { id: 'current', status: 'pending', baseRevision: 3 },
    { id: 'old', status: 'pending', baseRevision: 2 },
    { id: 'accepted', status: 'accepted', baseRevision: 3 },
  );
  const summary = workspaceSummary(project, 'casual');
  assert.deepEqual(summary.attentionJobs.map(item => item.id), ['review', 'handoff', 'prepared']);
  assert.deepEqual(summary.historyJobs.map(item => item.id), ['old']);
  assert.deepEqual(summary.reviewCandidates.map(item => item.id), ['review']);
  assert.deepEqual(summary.pendingProposals.map(item => item.id).sort(), ['current', 'old']);
  assert.equal(summary.attentionCount, 5);
  assert.equal(workspaceSummary(project, 'combat').attentionCount, 3, '人物設定提案不依穿搭分割');
});

test('採用其中一張後，同一輪其餘的圖留在圖鑑、不再催促', () => {
  const project = fixture(), work = job('pair', { status: 'accepted', variants: 2 });
  project.jobs.push(work);
  project.candidates.push(candidate('picked', work.id, { status: 'accepted' }), candidate('spare', work.id));
  assert.equal(jobPresentation(project, work).label, '已採用');
  assert.equal(workspaceSummary(project, 'casual').attentionCount, 0);
  assert.deepEqual(workspaceSummary(project, 'casual').reviewCandidates, []);
  work.progress = { startedAt: '2026-10-07T00:00:00Z' };
  assert.equal(jobPresentation(project, work).label, '已採用，還在畫');
});

test('角色候選比較只讀候選的穿搭來源，其他穿搭母稿不能冒充目前稿', () => {
  const project = fixture();
  project.jobs.push(job('combat', { outfitId: 'combat' }));
  project.character.adopted.character = 'current';
  project.assets.push(
    { id: 'current', targetId: 'character', role: 'design', view: 'front', outfitId: 'casual' },
    { id: 'asset-new', targetId: 'character', role: 'design', view: 'front', outfitId: 'combat' },
  );
  const result = candidateComparison(project, candidate('new', 'combat', { outfitId: undefined }));
  assert.equal(result.outfitId, 'combat');
  assert.equal(result.outfitName, '戰鬥穿搭');
  assert.equal(result.asset.id, 'asset-new');
  assert.equal(result.current, null);
  project.assets[0].outfitId = 'combat';
  assert.equal(candidateComparison(project, candidate('new', 'combat', { outfitId: undefined })).current.id, 'current');
});

test('候選指定穿搭優先工作穿搭，無穿搭來源不比較不明角色稿', () => {
  const project = fixture();
  project.jobs.push(job('work', { outfitId: 'combat' }));
  project.character.adopted.character = 'current';
  project.assets.push({ id: 'current', targetId: 'character', role: 'design', view: 'front', outfitId: 'casual' });
  assert.equal(candidateComparison(project, candidate('new', 'work')).current.id, 'current');
  assert.equal(candidateComparison(project, candidate('missing', 'missing', { outfitId: undefined })).current, null);
});

test('部件背面與細節使用各自 views，部件主圖可跨穿搭重用且不修改引用', () => {
  const project = fixture();
  project.character.adopted.coat = 'front';
  project.character.components.coat.views = { back: 'back', detail: 'detail' };
  project.assets.push(...['front', 'back', 'detail'].map(view => ({ id: view, targetId: 'coat', role: 'design', view, outfitId: 'casual' })));
  const before = structuredClone(project);
  for (const view of ['front', 'back', 'detail']) {
    const result = candidateComparison(project, candidate('new', 'missing', { targetId: 'coat', outfitId: 'combat', view }));
    assert.equal(result.current.id, view);
    assert.equal(result.view, view);
    assert.equal(result.outfitName, '戰鬥穿搭');
  }
  assert.equal(candidateComparison(project, candidate('new', 'missing', { targetId: 'coat', view: 'detail' })).viewLabel, '細節稿');
  assert.deepEqual(project, before);
});

test('空專案摘要不建立占位工作或假候選', () => {
  assert.deepEqual(workspaceSummary(fixture(), 'casual'), { reviewCandidates: [], pendingProposals: [], attentionJobs: [], historyJobs: [], attentionCount: 0 });
});

test('只有 Skill 回報開始才顯示繪製中；張數依實際回傳的圖計算', () => {
  const project = fixture();
  const waiting = job('waiting', { status: 'handed_off', variants: 4 });
  const running = job('running', { status: 'running', variants: 4, progress: { startedAt: '2026-10-06T00:00:00Z' } });
  const partial = job('partial', { status: 'review', variants: 4, progress: { startedAt: '2026-10-06T00:00:00Z' } });
  const failed = job('failed', { status: 'failed', failure: { at: '2026-10-06T00:01:00Z', message: '沒有圖像工具' } });
  project.jobs.push(waiting, running, partial, failed);
  project.candidates.push(candidate('partial-1', partial.id));
  assert.equal(jobPresentation(project, waiting).label, '等你送出');
  assert.equal(jobPresentation(project, waiting).action, 'handoff');
  const live = jobPresentation(project, running);
  assert.equal(live.label, '繪製中 0／4');
  assert.equal(live.action, 'wait');
  assert.equal(live.needsAttention, false);
  assert.deepEqual(jobProgress(project, running), { returned: 0, expected: 4, generating: true, pending: 0, adopted: 0 });
  const mixed = jobPresentation(project, partial);
  assert.equal(mixed.label, '新圖 1，還在畫');
  assert.equal(mixed.action, 'review');
  const broken = jobPresentation(project, failed);
  assert.equal(broken.label, '失敗');
  assert.equal(broken.action, 'handoff');
  assert.equal(broken.needsAttention, true);
});
