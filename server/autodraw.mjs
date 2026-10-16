// 「AIDOL 直接畫」、Design QA 與全自動（2026-10-13 起）。
// 畫圖：核心用 app-server 開新的 Codex 對話，用 Codex 內建的圖片生成工具（算在使用者的 ChatGPT 方案額度），
// 從 imageGeneration 項目直接收圖存成這個工作的候選，不必到 Codex App 按送出、也不需要回收憑證。
// Design QA：另一個新對話（read-only、不畫圖）看工作說明、參考圖與候選，逐張打分挑一張。
// 全自動：畫正面 → QA → 代為採用 → 等畫面裁好正面 → 依序畫勾選的角度 → QA → 採用。
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DomainError, extraViews, turnaroundLabels } from '../shared/domain.mjs';
import { variantCounts } from '../shared/libraries.mjs';
import { imageMime } from './store.mjs';
import { autopilotConfig, nextAutopilotStep, autopilotPrompt, drawPrompt, reviewPrompt, reviewSchema, settleReview, stepKey, AUTOPILOT_LOG_LIMIT, AUTOPILOT_STEP_LIMIT } from '../shared/autopilot.mjs';
import { expressionFront, expressionInfo, expressionList } from '../shared/expressions.mjs';
import { isOutfitVariant, mainOutfitId, outfitRemoved } from '../shared/wardrobe.mjs';

const now = () => new Date().toISOString();
const sleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});
const aborted = (error) => error?.name === 'AbortError' || error?.code === 'ABORTED';
const DRAW_MS_PER_IMAGE = 6 * 60 * 1000;
// 等畫面裁切、等 AI 找角度：每 3 秒看一次，等超過 30 分鐘就停下（timing 只給測試用）。
const WAIT = { pollMs: 3000, limitMs: 30 * 60 * 1000 };

// 能不能直接畫：要用 ChatGPT 方案登入（不是 API key，API key 會變成另外計費），而且不是 Free 方案（官方說 Free 不能生圖）。
export async function codexDrawAccess(client) {
  try {
    await client.start();
    const auth = await client.request('account/read', { refreshToken: false });
    const account = auth?.account;
    if (!account) return { ok: false, code: 'DRAW_NEEDS_LOGIN' };
    if (account.type !== 'chatgpt') return { ok: false, code: 'DRAW_NEEDS_CHATGPT' };
    if (account.planType === 'free') return { ok: false, code: 'DRAW_PLAN_FREE' };
    return { ok: true, planType: account.planType || null };
  } catch {
    return { ok: false, code: 'CODEX_UNAVAILABLE' };
  }
}

const accessMessages = {
  DRAW_NEEDS_LOGIN: '要先在 Codex 用 ChatGPT 帳號登入，才能讓 AIDOL 直接畫。',
  DRAW_NEEDS_CHATGPT: 'Codex 目前用 API key 登入，畫圖會另外計費；AIDOL 只用 ChatGPT 方案的額度畫圖。請改用 ChatGPT 帳號登入，或改成交給 Codex App。',
  DRAW_PLAN_FREE: 'ChatGPT 免費方案不能用 Codex 畫圖。可以改成交給 Codex App，或升級方案。',
  CODEX_UNAVAILABLE: '未能連線至本機 Codex CLI。請確認 Codex 已安裝並登入。',
};

function usageLimitMessage(failure) {
  const at = Number.isFinite(failure?.resetsAt) ? new Date(failure.resetsAt * 1000) : null;
  return at ? `這次的 Codex 額度用完了，${at.toISOString()} 之後會恢復。` : '這次的 Codex 額度用完了，等額度恢復後再畫。';
}

export function registerAutoDraw(app, store, { client, workDir, decompose, access = () => codexDrawAccess(client), timing = {} }) {
  const wait = { ...WAIT, ...timing };
  let cached = null;
  const checkAccess = async ({ fresh = false } = {}) => {
    if (!fresh && cached && Date.now() - cached.at < 60000) return cached.value;
    const value = await access();
    cached = { at: Date.now(), value };
    return value;
  };
  const requireAccess = async () => {
    const result = await checkAccess({ fresh: true });
    if (!result.ok) throw new DomainError(accessMessages[result.code] || accessMessages.CODEX_UNAVAILABLE, 409, result.code);
    return result;
  };
  const jobWorkDir = async (name) => { const directory = path.join(workDir, name); await mkdir(directory, { recursive: true }); return directory; };
  const drawing = new Map(); // jobId → AbortController（一開始就先佔位，同時兩個請求不會畫兩次）
  // 核心要關了：停下背景工作，但不寫「已停下」，重開後畫面看到的是「中斷了」；close 會等背景工作都結束才回來。
  let closing = false;
  const pending = new Set();
  const track = (promise) => { pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; };

  // 畫一個工作。回傳 { job, done }：job 是開始畫之後的工作；done 在畫完（或失敗、停下）時結束，帶回收到幾張。
  async function startDraw(id, jobId, { signal } = {}) {
    if (drawing.has(jobId)) throw new DomainError('這個工作正在畫。', 409, 'DRAW_RUNNING');
    const controller = new AbortController();
    drawing.set(jobId, controller);
    const stopAll = () => controller.abort();
    const release = () => { drawing.delete(jobId); store.markDrawing(jobId, false); signal?.removeEventListener('abort', stopAll); };
    signal?.addEventListener('abort', stopAll, { once: true });
    if (signal?.aborted) controller.abort();
    let job; let started;
    try {
      job = await store.getJob(id, jobId);
      if (['cancelled', 'accepted'].includes(job.status)) throw new DomainError('此工作已結束，請建立新的工作。', 409, 'JOB_ENDED');
      if (job.status === 'review' && !job.failure) throw new DomainError('這個工作已經畫好了，要再畫請建立新的工作。', 409, 'DRAW_ALREADY_DONE');
      await requireAccess();
      if (controller.signal.aborted) throw new DomainError('已停下。', 409, 'DRAW_STOPPED');
      store.markDrawing(jobId, true);
      await store.updateJob(id, jobId, { runner: 'auto', source: 'codex-auto' });
      started = await store.recordProgress(id, jobId, { event: 'started' });
    } catch (error) {
      release();
      throw error;
    }
    const done = (async () => {
      const variants = job.variants || 1;
      const seen = new Set();
      let count = 0; let usageFailure = null; let queue = Promise.resolve(); let enough = false;
      const receive = async (image) => {
        if (count >= variants) return;
        if (image.failure) { if (image.failure.type === 'usageLimitExceeded') usageFailure = image.failure; return; }
        let buffer = image.result ? Buffer.from(image.result.trim(), 'base64') : null;
        if (!buffer?.length && image.savedPath) buffer = await readFile(image.savedPath).catch(() => null);
        if (!buffer?.length) return;
        let mimeType;
        try { mimeType = imageMime(buffer); } catch { return; }
        const hash = createHash('sha256').update(buffer).digest('hex');
        if (seen.has(hash)) return;
        seen.add(hash);
        await store.addAsset(id, { buffer, name: `AIDOL 直接畫 ${count + 1}`, mimeType, role: 'design', targetId: job.targetId, jobId, view: job.outputView || 'front' });
        count += 1;
        // 張數夠了就打斷這一輪：模型如果還想繼續畫，不讓它多花額度。
        if (count >= variants && !controller.signal.aborted) { enough = true; controller.abort(); }
      };
      const usageFromTurn = (error) => error?.turnError?.codexErrorInfo === 'usageLimitExceeded';
      try {
        const instructions = await readFile(job.context.instructionsPath, 'utf8');
        // 參考圖照工作說明「固定輸入」的順序附上（定稿、正面排最前面）。
        const references = [...(job.context.referenceAssets || [])].filter((asset) => asset.path).sort((a, b) => instructions.indexOf(a.path) - instructions.indexOf(b.path));
        const result = await client.freshTurn({
          draw: true, cwd: await jobWorkDir(jobId), prompt: drawPrompt(instructions, variants), images: references.map((asset) => asset.path),
          timeoutMs: Math.min(variants * DRAW_MS_PER_IMAGE, 25 * 60 * 1000), signal: controller.signal,
          onImage: (image) => { queue = queue.then(() => receive(image)).catch(() => {}); },
        });
        await queue;
        if (count > 0) {
          await store.updateJob(id, jobId, { threadId: result.threadId });
          await store.recordProgress(id, jobId, { event: 'finished' });
        } else if (usageFailure) {
          await store.recordProgress(id, jobId, { event: 'failed', message: usageLimitMessage(usageFailure), code: 'DRAW_USAGE_LIMIT', ...(Number.isFinite(usageFailure.resetsAt) ? { resetsAt: usageFailure.resetsAt } : {}) });
        } else {
          await store.recordProgress(id, jobId, { event: 'failed', message: String(result.text || '這次沒有畫出圖。').slice(0, 300), code: 'DRAW_NO_IMAGE' });
        }
      } catch (error) {
        await queue;
        if (closing) return { count, usageLimit: false, stopped: true };
        if (count > 0 && error?.threadId) await store.updateJob(id, jobId, { threadId: error.threadId }).catch(() => {});
        if (enough || (count > 0 && !aborted(error))) await store.recordProgress(id, jobId, { event: 'finished' }).catch(() => {});
        else if (count === 0 && (usageFailure || usageFromTurn(error))) await store.recordProgress(id, jobId, { event: 'failed', message: usageLimitMessage(usageFailure), code: 'DRAW_USAGE_LIMIT', ...(Number.isFinite(usageFailure?.resetsAt) ? { resetsAt: usageFailure.resetsAt } : {}) }).catch(() => {});
        else if (aborted(error)) await store.recordProgress(id, jobId, count > 0 ? { event: 'finished' } : { event: 'failed', message: '已停下。', code: 'DRAW_STOPPED' }).catch(() => {});
        else await store.recordProgress(id, jobId, { event: 'failed', message: `這次沒有畫完：${String(error?.message || '未知原因').slice(0, 200)}`, code: /逾時|timeout/i.test(error?.message || '') ? 'DRAW_TIMEOUT' : 'DRAW_FAILED' }).catch(() => {});
        if (count === 0 && usageFromTurn(error)) usageFailure ||= { type: 'usageLimitExceeded' };
      } finally {
        release();
      }
      return { count, usageLimit: Boolean(usageFailure) && count === 0, stopped: controller.signal.aborted && !enough };
    })();
    track(done);
    return { job: started, done };
  }

  // Design QA：審一個工作的候選。回傳 { done }：先標成「審查中」再開始；done 帶回整理好的結果
  // （pick 是過關而且最好的那張，都不過關時是 null）。
  async function startReview(id, jobId, { signal } = {}) {
    if (store.reviewingJobs.has(jobId)) throw new DomainError('Design QA 正在審這批圖。', 409, 'REVIEW_RUNNING');
    store.markReviewing(jobId, true);
    let project; let job; let candidates;
    try {
      project = await store.getProject(id);
      job = project.jobs.find((item) => item.id === jobId);
      if (!job) throw new DomainError('找不到這次設計工作。', 404, 'JOB_NOT_FOUND');
      candidates = project.candidates.filter((item) => item.jobId === jobId && ['pending', 'accepted'].includes(item.status));
      if (!candidates.length) throw new DomainError('這個工作還沒有可以審的圖。', 422, 'REVIEW_NO_CANDIDATES');
      await store.updateJob(id, jobId, { review: { status: 'running', startedAt: now() } });
    } catch (error) { store.markReviewing(jobId, false); throw error; }
    const done = (async () => {
      try {
        const instructions = await readFile(job.context.instructionsPath, 'utf8');
        const references = [...(job.context.referenceAssets || [])].filter((asset) => asset.path).sort((a, b) => instructions.indexOf(a.path) - instructions.indexOf(b.path))
          .map((asset) => ({ path: asset.path, label: asset.view === 'expression' ? '已確認的表情（取景參考）' : asset.role === 'view' ? `已確認的${turnaroundLabels[asset.view] || '角度'}` : asset.targetId === 'character' ? (job.outfitVariant && asset.id === job.outfitMain ? '正式立繪（主要那套穿搭：臉、髮型、身形照它，衣服不用一樣）' : job.outfitVariant && asset.role === 'design' && asset.outfitId === job.outfitId ? '這套穿搭目前的立繪（這次照它局部修改）' : '角色設定或正式立繪') : `「${project.character.components[asset.targetId]?.name || asset.targetId}」的設計圖` }));
        const files = await store.assetFiles(id, candidates.map((item) => item.assetId));
        const result = await client.freshTurn({
          cwd: await jobWorkDir(`review-${jobId}`), prompt: reviewPrompt({ instructions, references, candidates, view: job.outputView || 'front', ...(job.outputView === 'expression' ? { expression: expressionInfo(project.expressions, job.expression) || { label: job.expressionLabel } } : {}), ...(job.outfitVariant ? { outfit: { name: project.character.outfits?.[job.outfitId]?.name || job.outfitId } } : {}) }),
          images: [...references.map((item) => item.path), ...files], outputSchema: reviewSchema, timeoutMs: 240000, ...(signal ? { signal } : {}),
        });
        let output;
        try { output = JSON.parse(result.text); } catch { throw new DomainError('Design QA 有回覆，但格式不正確；可以再審一次。', 422, 'INVALID_CODEX_OUTPUT'); }
        const review = { status: 'done', at: now(), threadId: result.threadId, ...settleReview(output, candidates.map((item) => item.id)) };
        await store.updateJob(id, jobId, { review });
        return review;
      } catch (error) {
        if (closing) throw error;
        const failed = { status: 'failed', at: now(), error: aborted(error) ? '已停下。' : String(error?.message || '未知原因').slice(0, 200), errorCode: aborted(error) ? 'REVIEW_STOPPED' : error?.code || 'REVIEW_FAILED' };
        await store.updateJob(id, jobId, { review: failed }).catch(() => {});
        throw error;
      } finally {
        store.markReviewing(jobId, false);
      }
    })();
    track(done);
    return { done };
  }

  // ── 全自動 ──
  const runs = new Map(); // 角色 id → AbortController（一開始就先佔位）
  const log = (autopilot, code, params = {}) => ({ ...autopilot, updatedAt: now(), log: [...(autopilot.log || []), { at: now(), code, ...params }].slice(-AUTOPILOT_LOG_LIMIT) });
  const update = (id, patch, entry) => store.saveAutopilot(id, (autopilot) => {
    const next = { ...(autopilot || {}), ...patch, updatedAt: now() };
    return entry ? log(next, entry.code, entry.params) : next;
  });
  const REVIEW_TRIES = 2;

  async function createStepJob(id, config, step, redoNote, runId) {
    const project = await store.getProject(id);
    const outfitIds = Object.keys(project.character.outfits);
    // 已經有正式立繪：一律用主要那套（正面、三視圖、表情都跟正式立繪；用別套畫會變成衣櫃裡的另一張）。
    // 衣櫃（2026-10-14 起）：用那一套畫正面全身，採用後放進那套的衣櫃。
    const wardrobe = step.view === 'outfit';
    const outfitId = wardrobe ? step.outfitId : project.character.adopted.character ? mainOutfitId(project) : config.outfitId && outfitIds.includes(config.outfitId) ? config.outfitId : outfitIds[0];
    const view = wardrobe ? 'front' : step.view;
    const job = await store.createJob(id, {
      targetId: 'character', ...(outfitId ? { outfitId } : {}), outputView: view, kind: 'generate', variants: config.variants,
      ...(view === 'front' ? { framing: 'frontView' } : {}), ...(view === 'expression' ? { expression: step.expression } : {}), baseRevision: project.character.revision,
      prompt: autopilotPrompt(project.character, step.view, redoNote, view === 'expression' ? expressionInfo(project.expressions, step.expression) : null, wardrobe ? project.character.outfits[outfitId] : null),
    });
    return store.updateJob(id, job.id, { autopilotId: runId });
  }

  // 這一步目前是誰的：正面看正式立繪，其他角度看三視圖裡那一格，表情看表情集裡那一格，衣櫃看那套的衣櫃。用來判斷 QA 審圖時使用者是不是自己先挑了。
  const holder = (project, step) => (step.view === 'front' ? project.character.adopted.character || null
    : step.view === 'expression' ? project.expressions?.items?.[step.expression]?.assetId || null
      : step.view === 'outfit' ? project.wardrobe?.items?.[step.outfitId]?.assetId || null
        : project.views?.items?.[step.view]?.sourceAssetId || project.views?.items?.[step.view]?.assetId || null);

  // 上次停在「畫好了還沒審完」（QA 失敗、核心重開、按了停下）：先審那一批，不重畫。
  // 只認還對得上目前狀態的那一批：正面要是同一版設定畫的，角度要是照目前的三視圖畫的，表情要是照目前的正面畫的；對不上的就收起來（圖留在圖鑑）。
  async function unreviewedBatch(id, project, step) {
    const view = step.view;
    // 衣櫃的那批是「那一套的正面」：和正面那一步分開（正面不認衣櫃的批次，衣櫃只認那一套的）。
    const wardrobe = view === 'outfit';
    const batches = [...project.jobs].reverse().filter((job) => job.autopilotId && job.targetId === 'character' && (job.outputView || 'front') === (wardrobe ? 'front' : view)
      && (wardrobe ? job.outfitVariant && job.outfitId === step.outfitId : !job.outfitVariant) && (view !== 'expression' || job.expression === step.expression) && job.status === 'review'
      && job.progress?.finishedAt && job.review?.status !== 'done' && project.candidates.some((item) => item.jobId === job.id && item.status === 'pending'));
    const fits = (job) => (wardrobe ? job.outfitMain === project.character.adopted.character
      : view === 'front' ? job.baseRevision === project.character.revision
      : view === 'expression' ? (job.expressionMain ? job.expressionMain === project.character.adopted.character : Boolean(job.expressionSource) && job.expressionSource === expressionFront(project))
        : job.sheetAssetId && job.sheetAssetId === project.views?.assetId);
    for (const job of batches.filter((item) => !fits(item))) await store.updateJob(id, job.id, { status: 'cancelled', closedBy: 'autopilot-stale' }).catch(() => {});
    return batches.find(fits) || null;
  }

  // 這一批還能不能代為採用：表情從表情集拿掉了（removed）、畫的時候照的是已經換掉的正式立繪（stale），
  // 或還沒有正式立繪時畫正面用的那套穿搭被刪掉了（outfitRemoved；這批的圖不能採用，也不用請 Design QA 看）。
  // 衣櫃：那套刪掉了或變成主要那套（不能再放進衣櫃，採用會換掉正式立繪）就跳過；畫的時候照的正式立繪換了就重畫。
  const batchGone = (project, step, job) => (step.view === 'front' ? (outfitRemoved(project, job.outfitId) ? 'outfitRemoved' : null)
    : step.view === 'outfit' ? (!isOutfitVariant(project, step.outfitId) ? 'outfitSkipped' : job.outfitMain !== project.character.adopted.character ? 'stale' : null)
    : step.view !== 'expression' ? null
      : !expressionList(project.expressions).includes(step.expression) ? 'removed'
        : job.expressionMain && job.expressionMain !== project.character.adopted.character ? 'stale' : null);
  // 不能用的那批收起來（圖留在圖鑑）；stale 的下一輪會照新的立繪重畫，removed 的就跳過，outfitRemoved 的下一輪用還在的那套重畫。
  // 都不算重畫次數，也不留 QA 的修正說明（說的是不能用的那批）。
  async function dropBatch(id, job, gone, where) {
    if (gone === 'stale') await store.updateJob(id, job.id, { status: 'cancelled', closedBy: 'autopilot-stale' }).catch(() => {});
    await update(id, { step: null }, { code: { stale: 'staleBatch', removed: 'removed', outfitRemoved: 'outfitRemoved', outfitSkipped: 'outfitSkipped' }[gone], params: { ...where, jobId: job.id } });
  }

  async function runAutopilot(id, controller, runId) {
    const { signal } = controller;
    let steps = 0;
    // 一輪最多做幾件事：基本 60 件；勾了衣櫃，每套再多留（重畫次數＋1）件（套裝最多 100 套，不然畫到一半就會停下）。
    let stepLimit = AUTOPILOT_STEP_LIMIT;
    try {
      const first = await store.getProject(id);
      if (first.autopilot?.config?.outfits) stepLimit += Object.keys(first.character.outfits || {}).length * ((first.autopilot.config.maxRedraws ?? 2) + 1);
      while (!signal.aborted) {
        if (steps >= stepLimit) { await update(id, { status: 'paused', step: null, reason: 'AUTOPILOT_STEP_LIMIT' }, { code: 'paused', params: { reason: 'AUTOPILOT_STEP_LIMIT' } }); return; }
        const project = await store.getProject(id);
        const autopilot = project.autopilot;
        const config = autopilot.config;
        const step = nextAutopilotStep(project, config);
        if (step.kind === 'done') { await update(id, { status: 'done', step: null, finishedAt: now() }, { code: 'done' }); return; }
        if (step.kind === 'wait') {
          // 畫面裁切正面、AI 找角度：全自動做不到，等畫面或背景工作做完。等太久就停下，讓使用者回來按繼續。
          if (autopilot.step?.kind !== 'wait' || autopilot.step.reason !== step.reason) await update(id, { step: { ...step, since: now() } }, { code: 'waiting', params: { reason: step.reason } });
          const since = Date.parse((await store.getProject(id)).autopilot?.step?.since) || Date.now();
          if (Date.now() - since > wait.limitMs) { await update(id, { status: 'paused', step: null, reason: step.reason === 'split' ? 'AUTOPILOT_NEEDS_SCREEN' : 'AUTOPILOT_WAIT_TIMEOUT' }, { code: 'paused', params: { reason: step.reason } }); return; }
          await sleep(wait.pollMs, signal);
          continue;
        }
        steps += 1;
        // key：記重畫次數與修正說明用（表情是 expression:<代號>）；log 帶 view 與 expression 給畫面顯示。
        const key = stepKey(step);
        const where = step.view === 'expression' ? { view: 'expression', expression: step.expression } : step.view === 'outfit' ? { view: 'outfit', outfitId: step.outfitId } : { view: step.view };
        // 使用者在這一輪自己換上的正式圖還沒拆成正面：不要畫一張新的蓋掉它，停下來請使用者先在畫布上拆（或當正面）。
        if (key === 'front' && autopilot.userMain && project.character.adopted.character === autopilot.userMain) {
          await update(id, { status: 'needs-you', step: null, reason: 'AUTOPILOT_FRONT_NEEDS_SPLIT', view: 'front' }, { code: 'paused', params: { reason: 'AUTOPILOT_FRONT_NEEDS_SPLIT' } });
          return;
        }
        const attempts = autopilot.attempts?.[key] || 0;
        const before = holder(project, step);
        let job = await unreviewedBatch(id, project, step);
        if (!job) {
          if (attempts > config.maxRedraws) {
            await update(id, { status: 'needs-you', step: null, reason: 'AUTOPILOT_GAVE_UP', ...where }, { code: 'gaveUp', params: { ...where } });
            return;
          }
          // 加的角度（斜前方等）先放進角度那一排，畫面才看得到空位在畫。
          if (extraViews.includes(step.view) && !(project.views?.extra || []).includes(step.view)) await store.addExtraView(id, { view: step.view }).catch(() => {});
          if (signal.aborted) return;
          try { job = await createStepJob(id, config, step, autopilot.redoNotes?.[key] || '', runId); } catch (error) {
            // 剛好在這一刻使用者存了設定（捏角色會自動存檔）或刪了這套：重新看一次狀態再決定（不算重畫次數）。
            if (['REVISION_CONFLICT', 'UNKNOWN_OUTFIT'].includes(error?.code)) continue;
            throw error;
          }
          await update(id, { step: { kind: 'draw', ...where, jobId: job.id, phase: 'drawing', attempt: attempts + 1 } }, { code: 'drawing', params: { ...where, jobId: job.id, attempt: attempts + 1 } });
          let started;
          try { started = await startDraw(id, job.id, { signal }); } catch (error) {
            // 還沒開始畫就停下了：把剛建立的工作收起來，畫面不會留下一個「到 Codex 按送出」。
            if (signal.aborted || error?.code === 'DRAW_STOPPED') { await store.updateJob(id, job.id, { status: 'cancelled' }).catch(() => {}); if (!signal.aborted) await update(id, { status: 'stopped', step: null }, { code: 'stopped' }); return; }
            throw error;
          }
          const drawn = await started.done;
          if (signal.aborted) return;
          // 使用者在翻牌畫面按了這一批的「停下」：全自動也一起停下，不自己再畫一次。
          if (drawn.stopped) { await update(id, { status: 'stopped', step: null }, { code: 'stopped' }); return; }
          if (drawn.usageLimit) { await update(id, { status: 'paused', step: null, reason: 'DRAW_USAGE_LIMIT' }, { code: 'paused', params: { reason: 'DRAW_USAGE_LIMIT' } }); return; }
          if (!drawn.count) {
            await update(id, { attempts: { ...(autopilot.attempts || {}), [key]: attempts + 1 } }, { code: 'drawFailed', params: { ...where, jobId: job.id } });
            continue;
          }
        }
        // 畫的時候使用者拿掉了這個表情、換了正式立繪，或刪了這批的套裝：不用再請 Design QA 看。
        const goneBefore = batchGone(await store.getProject(id), step, job);
        if (goneBefore) { await dropBatch(id, job, goneBefore, where); continue; }
        await update(id, { step: { kind: 'draw', ...where, jobId: job.id, phase: 'reviewing', attempt: attempts + 1 } }, { code: 'reviewing', params: { ...where, jobId: job.id } });
        // QA 沒審完（逾時、格式不對）不算這批畫壞：同一批再審一次；還是不行就停下，不重畫（畫圖比較花額度）。
        let review = null;
        for (let tries = 0; tries < REVIEW_TRIES && !review && !signal.aborted; tries += 1) {
          try { review = await (await startReview(id, job.id, { signal })).done; } catch { /* 再試一次 */ }
        }
        if (signal.aborted) return;
        if (!review) { await update(id, { status: 'paused', step: null, reason: 'AUTOPILOT_REVIEW_FAILED', ...where }, { code: 'reviewFailed', params: { ...where, jobId: job.id } }); return; }
        // 審圖的時候使用者自己先挑了（這批裡有已採用的，或這個角度已經換了別張）：照使用者的，不蓋掉。
        const latest = await store.getProject(id);
        const userPicked = latest.candidates.some((item) => item.jobId === job.id && item.status === 'accepted') || holder(latest, step) !== before;
        if (userPicked) {
          await update(id, { step: null, redoNotes: { ...(autopilot.redoNotes || {}), [key]: '' }, ...(key === 'front' ? { userMain: latest.character.adopted.character || null } : {}) }, { code: 'userPicked', params: { ...where, jobId: job.id } });
          continue;
        }
        const goneAfter = batchGone(latest, step, job);
        if (goneAfter) { await dropBatch(id, job, goneAfter, where); continue; }
        if (!review.pick) {
          // 這批都沒過：要重畫時把這批收起來（圖留在圖鑑），畫面就不會一直提醒「新圖」；重畫幾次都不過就留著讓使用者看。
          const giveUp = attempts + 1 > config.maxRedraws;
          if (!giveUp) await store.updateJob(id, job.id, { status: 'cancelled', closedBy: 'design-qa' }).catch(() => {});
          await update(id, { attempts: { ...(autopilot.attempts || {}), [key]: attempts + 1 }, redoNotes: { ...(autopilot.redoNotes || {}), [key]: review.redoNote } }, giveUp ? null : { code: 'redraw', params: { ...where, jobId: job.id } });
          if (giveUp) { await update(id, { status: 'needs-you', step: null, reason: 'AUTOPILOT_GAVE_UP', ...where }, { code: 'gaveUp', params: { ...where, jobId: job.id } }); return; }
          continue;
        }
        let accepted;
        let base = latest;
        for (let tries = 0; !accepted; tries += 1) {
          try {
            accepted = await store.acceptCandidate(id, review.pick, { baseRevision: base.character.revision, by: 'design-qa' });
          } catch (error) {
            // 只是剛好有人存了設定（捏角色會自動存檔）：這批還能用（使用者沒自己挑、沒換掉）就照新的版本再採用一次。
            // 正面不重試：正面照的是畫的那一版設定，設定改了就照新的重畫。
            if (error?.code === 'REVISION_CONFLICT' && key !== 'front' && tries < 2) {
              const fresh = await store.getProject(id);
              const picked = fresh.candidates.some((item) => item.jobId === job.id && item.status === 'accepted') || holder(fresh, step) !== before;
              if (!picked && !batchGone(fresh, step, job)) { base = fresh; continue; }
            }
            // 剛好在這一刻使用者改了設定或換了圖：重新看一次狀態再決定。
            if (error?.code === 'EXPRESSION_REMOVED') { await update(id, { step: null }, { code: 'removed', params: { ...where, jobId: job.id } }); break; }
            // 畫的那套穿搭被刪掉了（還沒有正式立繪時畫的正面）：這批不採用，下一輪用還在的那套重畫。
            if (error?.code === 'OUTFIT_REMOVED') { await update(id, { step: null }, { code: step.view === 'outfit' ? 'outfitSkipped' : 'outfitRemoved', params: { ...where, jobId: job.id } }); break; }
            if (['REVISION_CONFLICT', 'VIEWS_STALE'].includes(error?.code)) { await update(id, { step: null }, { code: 'userPicked', params: { ...where, jobId: job.id } }); break; }
            throw error;
          }
        }
        if (!accepted) continue;
        await update(id, { step: null, redoNotes: { ...(autopilot.redoNotes || {}), [key]: '' } }, { code: 'adopted', params: { ...where, jobId: job.id, candidateId: review.pick } });
        // 正面採用後和手動採用一樣自動拆解裝備（背景跑；失敗不影響全自動）。
        if (key === 'front' && decompose) {
          const candidate = accepted.candidates.find((item) => item.id === review.pick);
          await decompose(id, { assetId: candidate?.assetId, auto: true }).catch(() => {});
        }
      }
    } catch (error) {
      if (!signal.aborted && !closing) await update(id, { status: 'failed', step: null, error: String(error?.message || '未知原因').slice(0, 200), errorCode: error?.code || 'AUTOPILOT_FAILED' }, { code: 'failed' }).catch(() => {});
    } finally {
      if (runs.get(id) === controller) runs.delete(id);
      store.markAutopilot(id, false);
      if (signal.aborted && !closing) await update(id, { status: 'stopped', step: null }, { code: 'stopped' }).catch(() => {});
    }
  }

  async function startAutopilot(id, input = {}) {
    if (runs.has(id)) throw new DomainError('全自動已經在跑了。', 409, 'AUTOPILOT_RUNNING');
    const controller = new AbortController();
    runs.set(id, controller);
    let result;
    const runId = randomUUID();
    try {
      const project = await store.getProject(id);
      const config = autopilotConfig(input, variantCounts);
      if (config.outfitId && !Object.hasOwn(project.character.outfits, config.outfitId)) throw new DomainError('找不到這次工作指定的穿搭。', 422, 'UNKNOWN_OUTFIT');
      await requireAccess();
      store.markAutopilot(id, true);
      // 繼續（上次停下、中斷或要你看）時沿用重畫的修正說明；重畫次數重新算。
      // facesOnly：這一輪只畫表情（有正式立繪、沒勾角度），畫面照這個顯示步驟，跑到一半也不會變。
      // facesOnly（2026-10-14 起也包含只畫衣櫃）：有正式立繪、沒勾角度，只畫表情集與衣櫃，不重畫正面。
      const facesOnly = Boolean((config.expressions || config.outfits) && !config.views.length && project.character.adopted.character);
      result = await update(id, { id: runId, status: 'running', startedAt: now(), finishedAt: null, config, facesOnly, attempts: {}, userMain: null, redoNotes: project.autopilot?.redoNotes || {}, step: null, reason: null, error: null, errorCode: null, view: null, expression: null, outfitId: null }, { code: 'started', params: { views: config.views, variants: config.variants, expressions: config.expressions, outfits: config.outfits } });
    } catch (error) {
      runs.delete(id); store.markAutopilot(id, false);
      throw error;
    }
    track(runAutopilot(id, controller, runId));
    return result;
  }

  function stopAutopilot(id) {
    const run = runs.get(id);
    if (!run) return false;
    run.abort();
    return true;
  }

  app.get('/api/codex/draw-access', async (_request, response, next) => {
    try { response.json(await checkAccess({ fresh: true })); } catch (error) { next(error); }
  });
  app.post('/api/projects/:id/jobs/:jobId/draw', async (request, response, next) => {
    try {
      const { job } = await startDraw(request.params.id, request.params.jobId);
      response.json(job);
    } catch (error) { next(error); }
  });
  app.post('/api/projects/:id/jobs/:jobId/draw/stop', async (request, response, next) => {
    try {
      const controller = drawing.get(request.params.jobId);
      if (controller) controller.abort();
      response.json({ stopped: Boolean(controller) });
    } catch (error) { next(error); }
  });
  app.post('/api/projects/:id/jobs/:jobId/review', async (request, response, next) => {
    try {
      const { id, jobId } = request.params;
      // 審查在背景跑（約半分鐘到兩分鐘），畫面用輪詢看結果。
      await startReview(id, jobId);
      response.json(await store.getProject(id));
    } catch (error) { next(error); }
  });
  app.post('/api/projects/:id/autopilot', async (request, response, next) => {
    try { response.json(await startAutopilot(request.params.id, request.body || {})); } catch (error) { next(error); }
  });
  app.post('/api/projects/:id/autopilot/stop', async (request, response, next) => {
    try {
      const stopped = stopAutopilot(request.params.id);
      const project = stopped ? await store.getProject(request.params.id) : await store.saveAutopilot(request.params.id, (autopilot) => (autopilot && ['running', 'interrupted'].includes(autopilot.status) ? { ...autopilot, status: 'stopped', step: null, updatedAt: now() } : autopilot));
      response.json(project);
    } catch (error) { next(error); }
  });

  return { startDraw, startReview, startAutopilot, stopAutopilot, checkAccess, close: async () => {
    closing = true;
    for (const run of runs.values()) run.abort();
    for (const controller of drawing.values()) controller.abort();
    await Promise.allSettled([...pending]);
  } };
}
