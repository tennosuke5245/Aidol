import { readFile, writeFile, mkdir, cp, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import multer from 'multer';
import { CodexClient, codexVersion } from './codex/client.mjs';
import { characterYaml, parseCharacterYaml, characterSchema, DomainError } from '../shared/domain.mjs';
import { skillSource, skillStatus, installSkill } from '../scripts/install-skill.mjs';

const route = handler => (request, response, next) => Promise.resolve(handler(request, response)).catch(next);
const writeJson = async (file, value) => {
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, file);
};
const jsonIfExists = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };

function imageMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new DomainError('回收檔案必須是 PNG、JPEG 或 WebP 圖片。', 400, 'INVALID_IMAGE');
}

export function buildHandoffUrl(workspace, prompt) {
  const params = new URLSearchParams({ path: path.resolve(workspace), prompt });
  return `codex://new?${params.toString()}`;
}

async function verifyHandoff(store, id, jobId, request) {
  const handoff = await jsonIfExists(path.join(store.jobDir(id, jobId), 'handoff.json'), null);
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  if (!handoff || supplied.length !== handoff.token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(handoff.token))) throw new DomainError('工作回收憑證不符合，請重新從工作台交接。', 403, 'INVALID_HANDOFF');
  return handoff;
}

export function registerCodexRoutes(app, store, { client = new CodexClient(), version = codexVersion } = {}) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 4, fieldSize: 200000 } });
  const locks = new Map();
  const lock = async (key, callback) => {
    const previous = locks.get(key) || Promise.resolve();
    const result = previous.catch(() => {}).then(callback);
    locks.set(key, result);
    try { return await result; } finally { if (locks.get(key) === result) locks.delete(key); }
  };

  app.get('/api/codex/status', route(async (_request, response) => {
    const skill = await skillStatus();
    try {
      const cliVersion = await version(); await client.start();
      const [auth, catalog] = await Promise.all([client.request('account/read', { refreshToken: false }), client.request('model/list', { limit: 100, includeHidden: false })]);
      response.json({ available: true, version: cliVersion, authenticated: Boolean(auth.account), accountType: auth.account?.type || null, planType: auth.account?.planType || null, models: catalog.data,
        capabilities: { textDraft: true, imageGeneration: false, appImageHandoff: true }, skill });
    } catch {
      response.json({ available: false, authenticated: false, version: null, models: [], capabilities: { textDraft: false, imageGeneration: false, appImageHandoff: true }, skill, error: '未能連線至本機 Codex CLI。請確認 Codex 已安裝並登入；AIDOL 不會變更登入。' });
    }
  }));

  app.get('/api/codex/models', route(async (_request, response) => {
    await client.start(); const result = await client.request('model/list', { limit: 100, includeHidden: false }); response.json(result);
  }));
  app.post('/api/codex/skill/install', route(async (_request, response) => response.json(await installSkill())));

  app.post('/api/projects/:id/chat', route(async (request, response) => {
    const message = request.body.message;
    if (typeof message !== 'string' || !message.trim() || message.length > 12000) throw new DomainError('請輸入 1 至 12000 字的角色設計要求。', 400, 'INVALID_MESSAGE');
    const project = await store.getProject(request.params.id);
    const baseRevision = project.character.revision;
    const prompt = [
      '你是 AIDOL 的角色設計協作者。依使用者需求，提出完整人物 YAML 草案；只回應 JSON 中的 yaml 與 summary。',
      '保留角色 id、schema_version、revision 與所有既有 asset ID。使用繁體中文，保持穩定部件 ID。',
      '資料鍵名依 schema 保留；使用者可見的人設、繪風名稱與描述、部件名稱與描述，必須使用自然繁體中文敘述角色或美術設計。不要在這些內容提及 schema、identity、components、YAML 欄位、資料結構或工程實作；使用者明確要求的角色名稱或服裝文字則照原意保留。',
      '沒有明確要求的設定保持原樣；待決內容以描述註明。配件移除只改穿搭 equipped，不刪除配件物件。',
      '每張繪風參考的用途與角色身份參考分開。不得修改檔案、執行指令或生成圖片。',
      `資料 schema：\n${JSON.stringify(characterSchema)}`,
      `目前已採用設定（revision ${baseRevision}）：\n${characterYaml(project.character)}`,
      `可引用的素材 ID：${project.assets.map(asset => asset.id).join(', ') || '無'}`,
      `使用者本次要求：\n${message}`,
    ].join('\n\n');
    const result = await client.freshTurn({
      cwd: store.projectDir(project.id), prompt, model: request.body.model,
      outputSchema: { type: 'object', additionalProperties: false, properties: { yaml: { type: 'string' }, summary: { type: 'string' } }, required: ['yaml', 'summary'] },
    });
    let output;
    try { output = JSON.parse(result.text); } catch { throw new DomainError('Codex 已回應，但沒有傳回有效的描述格式；原設定仍保留。', 422, 'INVALID_CODEX_OUTPUT'); }
    const character = parseCharacterYaml(output.yaml, project.assets.map(asset => asset.id));
    const draft = await store.saveProposal(project.id, { baseRevision, character, source: 'codex', threadId: result.threadId, summary: output.summary });
    response.json({ threadId: result.threadId, turnId: result.turnId, draft, yaml: output.yaml, text: output.summary });
  }));

  // 自動拆解裝備：Codex 讀正式立繪，列出可單獨設計的裝備與在圖上的位置。在背景執行，畫面以輪詢看狀態。
  const partKinds = ['garment', 'footwear', 'accessory', 'weapon', 'other'];
  const decompositionSchema = {
    type: 'object', additionalProperties: false, required: ['parts', 'summary'],
    properties: {
      summary: { type: 'string' },
      parts: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'name', 'kind', 'description', 'anchor', 'bbox', 'existingId'],
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string', enum: partKinds }, description: { type: 'string' }, anchor: { type: 'string' }, existingId: { type: 'string' },
          bbox: { type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'], properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } } },
        },
      } },
    },
  };
  const friendly = (error) => /逾時|timeout/i.test(error?.message || '') ? 'Codex 讀圖逾時，請稍後再試一次。'
    : /ENOENT|spawn|連線|connect/i.test(error?.message || '') ? '需要已安裝並登入的 Codex CLI 才能自動拆解裝備；也可以在畫布上手動新增。'
    : error instanceof DomainError ? error.message : `拆解沒有完成：${String(error?.message || '未知原因').slice(0, 200)}`;
  async function decompose(id, { assetId, auto = false } = {}) {
    const started = await store.startDecomposition(id, { assetId, auto });
    if (started.skipped) return started;
    const { project, asset, path: imagePath } = started;
    const existing = Object.values(project.character.components).map((part) => `${part.id}：${part.name}（${part.kind}）`).join('\n') || '無';
    const prompt = [
      `你是 AIDOL 的角色設計助理。附圖是角色「${project.character.name}」目前的正式立繪。`,
      '找出圖中可以單獨設計的裝備與配件（例如外套、上衣、褲子或裙子、鞋子、髮飾、耳環、項鍊、手套、包包、腰帶、武器）。不要列身體部位、臉或頭髮本身（髮飾可以）。',
      '每件回傳：id（英文小寫與底線的穩定代號，例如 black_hooded_jacket）、name（繁體中文名稱）、kind（garment 衣物、footwear 鞋、accessory 配件或飾品或包包或髮飾、weapon 武器、other）、description（一到兩句繁體中文外觀描述：顏色、材質、細節）、anchor（穿戴位置，例如「上身」「腰間」「左耳」「腳」）、bbox（這件在圖中的位置框，以圖片寬高為 1：x、y 是左上角，width、height 是寬高）、existingId（和下方已有裝備是同一件時填它的 id，否則空字串）。',
      '如果是多視角設定稿（同一角色出現多次），只框選最大、最完整的正面全身那一個。最多 10 件，從頭到腳排序。summary 用一句繁體中文說明拆出了什麼。',
      `已有的裝備：\n${existing}`,
    ].join('\n\n');
    (async () => {
      try {
        const result = await client.freshTurn({ cwd: store.projectDir(id), prompt, images: [imagePath], outputSchema: decompositionSchema, timeoutMs: 240000 });
        let output;
        try { output = JSON.parse(result.text); } catch { throw new DomainError('Codex 有回覆，但格式不正確；可以再試一次。', 422, 'INVALID_CODEX_OUTPUT'); }
        await store.finishDecomposition(id, { assetId: asset.id, parts: output.parts, summary: output.summary, threadId: result.threadId });
      } catch (error) {
        await store.failDecomposition(id, { assetId: asset.id, message: friendly(error) }).catch(() => {});
      }
    })();
    return started;
  }
  app.post('/api/projects/:id/decompose', route(async (request, response) => {
    const started = await decompose(request.params.id, { assetId: request.body?.assetId });
    response.json(started.project);
  }));

  app.post('/api/projects/:id/jobs/:jobId/handoff', route(async (request, response) => {
    const { id, jobId } = request.params;
    const job = await store.getJob(id, jobId);
    if (['cancelled', 'accepted'].includes(job.status)) throw new DomainError('此工作已結束，請建立新的精修工作。', 409, 'JOB_ENDED');
    const workspace = store.projectDir(id);
    const directory = store.jobDir(id, jobId);
    await mkdir(path.join(workspace, '.agents', 'skills'), { recursive: true });
    await cp(skillSource(), path.join(workspace, '.agents', 'skills', 'aidol'), { recursive: true });
    await writeJson(path.join(workspace, 'character.schema.json'), characterSchema);
    const old = await jsonIfExists(path.join(directory, 'handoff.json'), null);
    const origin = `http://127.0.0.1:${request.socket.localPort}`;
    const submitUrl = `${origin}/api/projects/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}/submit`;
    await writeJson(path.join(directory, 'handoff.json'), {
      schemaVersion: 1, projectId: id, jobId, baseRevision: job.baseRevision, outputView: job.outputView || 'front', outfitId: job.outfitId || null, variants: job.variants || 1,
      submitUrl, progressUrl: `${origin}/api/projects/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}/progress`, token: old?.token || randomBytes(32).toString('hex'),
      inputPath: path.join(directory, 'input.yaml'), instructionsPath: path.join(directory, 'instructions.md'),
    });
    // 貼進 Codex 的交接訊息只寫「畫什麼、資料在哪」：工作資料夾用相對於工作區的路徑，
    // 回報與回收規則在 AIDOL skill、細節在 instructions.md，不在這裡重複（太長會把 Codex 輸入框塞爆）。
    const project = await store.getProject(id);
    const target = job.targetId === 'character' ? '立繪' : project.character.components?.[job.targetId]?.name || job.targetId;
    const count = (job.variants || 1) > 1 ? `，畫 ${job.variants} 張` : '';
    const styled = (job.context?.styleReferences || []).some((reference) => reference.role === 'style');
    const prompt = [
      `$aidol 請完成 AIDOL 工作：${project.character.name || project.name}・${target}${count}。`,
      `工作資料夾：${path.relative(workspace, directory)}（先讀 instructions.md；input.yaml 與 handoff.json 也在這裡）`,
      ...(styled ? ['這次附了繪風參考，畫法以它為準。'] : []),
    ].join('\n');
    const url = buildHandoffUrl(workspace, prompt);
    const keep = ['running', 'review'].includes(job.status);
    const updated = await store.updateJob(id, jobId, { ...(keep ? {} : { status: 'handed_off' }), handoff: { workspace, url, submitUrl, progressUrl: `${submitUrl.replace(/\/submit$/, '')}/progress`, createdAt: new Date().toISOString() } });
    response.json({ url, prompt, workspace, submitUrl, job: updated });
  }));

  app.post('/api/projects/:id/jobs/:jobId/submit', upload.array('images', 4), route(async (request, response) => {
    const { id, jobId } = request.params;
    await lock(`${id}/${jobId}`, async () => {
      const job = await store.getJob(id, jobId);
      const directory = store.jobDir(id, jobId);
      await verifyHandoff(store, id, jobId, request);
      // 使用者先採用了其中一張時，其餘還在畫的圖仍要能回來；畫完（finished）後才關閉。
      const stillDrawing = Boolean(job.progress?.startedAt && !job.progress?.finishedAt);
      if (job.status === 'cancelled' || (job.status === 'accepted' && !stillDrawing)) throw new DomainError('此工作已結束，無法回收新候選。', 409, 'JOB_ENDED');
      let manifest;
      try { manifest = JSON.parse(request.body.manifest); } catch { throw new DomainError('成果清單不是有效的 JSON。', 400, 'INVALID_MANIFEST'); }
      if (manifest.schemaVersion !== 1 || manifest.jobId !== jobId || manifest.source !== 'codex-app' || !Array.isArray(manifest.outputs) || !request.files?.length || request.files.length !== manifest.outputs.length) throw new DomainError('成果清單與本次工作或圖片數量不符。', 400, 'INVALID_MANIFEST');
      if (manifest.outfitId !== undefined && manifest.outfitId !== (job.outfitId || null)) throw new DomainError('成果引用的穿搭與本次工作不符。', 400, 'INVALID_MANIFEST');
      if ((manifest.threadId !== undefined && manifest.threadId !== null && (typeof manifest.threadId !== 'string' || manifest.threadId.length > 120)) || manifest.outputs.some(output => !output || typeof output !== 'object' || (output.name !== undefined && (typeof output.name !== 'string' || output.name.length > 250)) || (output.view !== undefined && (typeof output.view !== 'string' || output.view.length > 100)))) throw new DomainError('成果的名稱、視角或工作階段格式不正確。', 400, 'INVALID_MANIFEST');
      const prepared = request.files.map((file, index) => {
        const hash = createHash('sha256').update(file.buffer).digest('hex');
        if (manifest.outputs[index].sha256 && manifest.outputs[index].sha256 !== hash) throw new DomainError('圖片雜湊與成果清單不符。', 400, 'HASH_MISMATCH');
        return { file, hash, metadata: manifest.outputs[index], mimeType: imageMime(file.buffer) };
      });
      const recordPath = path.join(directory, 'submissions.json');
      const submissions = await jsonIfExists(recordPath, {});
      const candidates = []; let allDuplicate = true;
      for (const output of prepared) {
        if (submissions[output.hash]) {
          const current = await store.getProject(id);
          candidates.push(current.candidates.find(candidate => candidate.id === submissions[output.hash].candidate.id) || submissions[output.hash].candidate);
          continue;
        }
        const result = await store.addAsset(id, { buffer: output.file.buffer, name: output.metadata.name || output.file.originalname, mimeType: output.mimeType, role: 'design', targetId: job.targetId, jobId, view: output.metadata.view || job.outputView || 'front' });
        const candidate = result.candidate;
        submissions[output.hash] = { assetId: result.asset.id, candidate, source: 'codex-app', threadId: manifest.threadId || null, receivedAt: new Date().toISOString() };
        await writeJson(recordPath, submissions);
        candidates.push(candidate); allDuplicate = false;
      }
      await store.updateJob(id, jobId, { ...(job.status === 'accepted' ? {} : { status: 'review' }), source: 'codex-app', threadId: manifest.threadId || job.threadId || null });
      response.json({ candidates, duplicate: allDuplicate, jobId });
    });
  }));
  app.post('/api/projects/:id/jobs/:jobId/progress', route(async (request, response) => {
    const { id, jobId } = request.params;
    await lock(`${id}/${jobId}`, async () => {
      await store.getJob(id, jobId);
      await verifyHandoff(store, id, jobId, request);
      const job = await store.recordProgress(id, jobId, { event: request.body?.event, message: request.body?.message });
      response.json({ jobId, status: job.status, progress: job.progress || null });
    });
  }));
  return { close: () => client.close(), decompose };
}
