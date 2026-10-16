import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProjectStore } from './store.mjs';
import { DomainError } from '../shared/domain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export async function createApp({ dataDir, assetDir, demo = true, registerIntegrations, staticDir = process.env.AIDOL_CLIENT_DIR || process.env.AIDOL_STATIC_DIR } = {}) {
  const app = express();
  const store = new ProjectStore({ dataDir, assetDir, demo });
  await store.init();
  app.locals.store = store;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.get('host');
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/i.exec(host || '');
    if (!localHost || (localHost[2] && (Number(localHost[2]) < 1 || Number(localHost[2]) > 65535))) return next(new DomainError('本機工作台只接受 localhost 存取。', 403, 'HOST_NOT_ALLOWED'));
    const origin = req.get('origin');
    if (origin) {
      const permitted = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', `http://${req.get('host')}`, ...(process.env.AIDOL_ALLOWED_ORIGINS || '').split(',').filter(Boolean)]);
      if (!permitted.has(origin)) return next(new DomainError('這個網站無法存取本機角色資料。', 403, 'ORIGIN_NOT_ALLOWED'));
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 12 } });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'aidol', persistence: 'local' }));
  app.get('/api/projects', asyncRoute(async (_req, res) => res.json(await store.listProjects())));
  app.post('/api/projects', asyncRoute(async (req, res) => res.status(201).json(await store.createProject(req.body))));
  app.get('/api/projects/:id', asyncRoute(async (req, res) => res.json(await store.getProject(req.params.id))));
  app.get('/api/projects/:id/canvas-annotations', asyncRoute(async (req, res) => res.json(await store.listCanvasAnnotations(req.params.id))));
  app.post('/api/projects/:id/canvas-annotations', asyncRoute(async (req, res) => res.status(201).json(await store.createCanvasAnnotation(req.params.id, req.body))));
  app.patch('/api/projects/:id/canvas-annotations/:annotationId', asyncRoute(async (req, res) => res.json(await store.updateCanvasAnnotation(req.params.id, req.params.annotationId, req.body))));
  app.delete('/api/projects/:id/canvas-annotations/:annotationId', asyncRoute(async (req, res) => res.json(await store.deleteCanvasAnnotation(req.params.id, req.params.annotationId))));
  app.put('/api/projects/:id/character', asyncRoute(async (req, res) => res.json(await store.updateCharacter(req.params.id, req.body))));
  app.get('/api/projects/:id/yaml', asyncRoute(async (req, res) => res.type('text/yaml').send(await store.getYaml(req.params.id))));
  app.post('/api/projects/:id/jobs', asyncRoute(async (req, res) => res.status(201).json(await store.createJob(req.params.id, req.body))));
  app.get('/api/projects/:id/jobs', asyncRoute(async (req, res) => res.json(await store.listJobs(req.params.id))));
  app.get('/api/projects/:id/jobs/:jobId', asyncRoute(async (req, res) => res.json(await store.getJob(req.params.id, req.params.jobId))));
  app.post('/api/projects/:id/jobs/:jobId/cancel', asyncRoute(async (req, res) => res.json(await store.cancelJob(req.params.id, req.params.jobId))));
  app.post('/api/projects/:id/assets', upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) throw new DomainError('請選擇要匯入的圖片。', 422, 'IMAGE_REQUIRED');
    const { role, targetId, jobId, view } = req.body;
    res.status(201).json(await store.addAsset(req.params.id, { buffer: req.file.buffer, name: req.body.name || req.file.originalname, mimeType: req.file.mimetype, role, targetId, ...(jobId ? { jobId } : {}), view }));
  }));
  // 三視圖裁好的三張（PNG）：meta 是 JSON（assetId、manual、items[{ view, crop, figure }]），圖檔欄位名稱就是 view。
  const viewUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 3, fields: 4, fieldSize: 20000 } });
  app.post('/api/projects/:id/views', viewUpload.fields([{ name: 'front', maxCount: 1 }, { name: 'side', maxCount: 1 }, { name: 'back', maxCount: 1 }]), asyncRoute(async (req, res) => {
    let meta;
    try { meta = JSON.parse(req.body.meta || '{}'); } catch { throw new DomainError('三視圖的裁切資料不正確。', 422, 'INVALID_VIEWS'); }
    const items = (Array.isArray(meta.items) ? meta.items : []).map((item) => ({ ...item, buffer: req.files?.[item?.view]?.[0]?.buffer }));
    res.json(await store.saveViews(req.params.id, { assetId: meta.assetId, manual: Boolean(meta.manual), boxes: meta.boxes, items }));
  }));
  // 舊角色只有一張立繪：把整張當正面，之後補畫側面、背面。
  app.post('/api/projects/:id/views/front-only', asyncRoute(async (req, res) => res.json(await store.useMainAsFront(req.params.id))));
  app.post('/api/projects/:id/views/extra', asyncRoute(async (req, res) => res.json(await store.addExtraView(req.params.id, req.body || {}))));
  app.delete('/api/projects/:id/views/extra/:view', asyncRoute(async (req, res) => res.json(await store.removeExtraView(req.params.id, req.params.view))));
  // 表情集：加一個預設表情（preset）或自訂表情（name、note）；拿掉一個表情（畫好的圖留在圖鑑）。
  app.post('/api/projects/:id/expressions', asyncRoute(async (req, res) => res.json(await store.addExpression(req.params.id, req.body || {}))));
  app.delete('/api/projects/:id/expressions/:key', asyncRoute(async (req, res) => res.json(await store.removeExpression(req.params.id, req.params.key))));
  app.post('/api/projects/:id/view-notes', asyncRoute(async (req, res) => res.status(201).json(await store.createViewNote(req.params.id, req.body || {}))));
  app.patch('/api/projects/:id/view-notes/:noteId', asyncRoute(async (req, res) => res.json(await store.updateViewNote(req.params.id, req.params.noteId, req.body || {}))));
  app.delete('/api/projects/:id/view-notes/:noteId', asyncRoute(async (req, res) => res.json(await store.deleteViewNote(req.params.id, req.params.noteId))));
  // 重畫的角度調成和其他兩張一樣大小後送回來（PNG）。
  app.post('/api/projects/:id/views/:view/normalized', upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) throw new DomainError('請選擇要匯入的圖片。', 422, 'IMAGE_REQUIRED');
    res.json(await store.saveNormalizedView(req.params.id, { view: req.params.view, sourceAssetId: req.body.sourceAssetId, buffer: req.file.buffer }));
  }));
  // 已經有三視圖：上傳的圖（或已有的參考圖 fromAssetId）直接當正式立繪，接著和採用時一樣自動拆解、找三視圖。
  app.post('/api/projects/:id/import-main', upload.single('file'), asyncRoute(async (req, res) => {
    const { fromAssetId, outfitId } = req.body;
    if (!req.file && !fromAssetId) throw new DomainError('請選擇要匯入的圖片。', 422, 'IMAGE_REQUIRED');
    const { project, asset } = await store.importMainImage(req.params.id, { ...(req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype, name: req.file.originalname } : { fromAssetId }), ...(outfitId ? { outfitId } : {}), baseRevision: Number(req.body.baseRevision) });
    const decompose = req.app.locals.integrations?.decompose;
    if (decompose) {
      try { return res.json((await decompose(project.id, { assetId: asset.id, auto: true })).project); } catch { /* 沒有 Codex 或已在拆解：照常回傳 */ }
    }
    res.json(project);
  }));
  app.get('/api/projects/:id/assets/:assetId', asyncRoute(async (req, res) => {
    const { asset, buffer } = await store.readAsset(req.params.id, req.params.assetId);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(asset.mimeType).send(buffer);
  }));
  app.post('/api/projects/:id/candidates/:candidateId/accept', asyncRoute(async (req, res) => {
    const project = await store.acceptCandidate(req.params.id, req.params.candidateId, { baseRevision: req.body?.baseRevision, asMain: req.body?.asMain === true });
    // 正式立繪換上之後自動拆解裝備（需要 Codex）；拆解在背景跑，失敗不影響採用。
    const candidate = project.candidates.find((item) => item.id === req.params.candidateId);
    const asset = candidate && project.assets.find((item) => item.id === candidate.assetId);
    const decompose = req.app.locals.integrations?.decompose;
    if (decompose && candidate?.targetId === 'character' && asset?.view === 'front' && project.character.adopted.character === asset.id) {
      try { return res.json((await decompose(project.id, { assetId: asset.id, auto: true })).project); } catch { /* 沒有立繪或已在拆解：照常回傳採用結果 */ }
    }
    res.json(project);
  }));
  // 衣櫃：把另一套穿搭現在的立繪設成正式立繪（原本的放進它那套）；和採用正式立繪一樣接著拆裝備。
  app.post('/api/projects/:id/wardrobe/:outfitId/main', asyncRoute(async (req, res) => {
    const project = await store.promoteOutfit(req.params.id, req.params.outfitId, { baseRevision: req.body?.baseRevision });
    const decompose = req.app.locals.integrations?.decompose;
    if (decompose) {
      try { return res.json((await decompose(project.id, { assetId: project.character.adopted.character, auto: true })).project); } catch { /* 沒有 Codex 或已在拆解：照常回傳 */ }
    }
    res.json(project);
  }));
  app.delete('/api/projects/:id', asyncRoute(async (req, res) => res.json(await store.deleteProject(req.params.id))));
  app.get('/api/trash', asyncRoute(async (_req, res) => res.json(await store.listTrash())));
  app.post('/api/trash/:trashId/restore', asyncRoute(async (req, res) => res.json(await store.restoreProject(req.params.trashId))));
  app.delete('/api/trash/:trashId', asyncRoute(async (req, res) => res.json(await store.purgeTrash(req.params.trashId))));
  app.get('/api/preferences', asyncRoute(async (_req, res) => res.json(await store.getPreferences())));
  app.put('/api/preferences', asyncRoute(async (req, res) => res.json(await store.savePreferences(req.body))));
  app.get('/api/ui-state', asyncRoute(async (_req, res) => res.json(await store.getUiState())));
  app.patch('/api/ui-state', asyncRoute(async (req, res) => res.json(await store.updateUiState(req.body))));
  app.post('/api/projects/:id/proposals', asyncRoute(async (req, res) => res.status(201).json(await store.saveProposal(req.params.id, req.body))));
  app.post('/api/projects/:id/proposals/:proposalId/dismiss', asyncRoute(async (req, res) => res.json(await store.dismissProposal(req.params.id, req.params.proposalId))));
  app.post('/api/projects/:id/proposals/:proposalId/accept', asyncRoute(async (req, res) => res.json(await store.acceptProposal(req.params.id, req.params.proposalId, req.body))));
  app.post('/api/projects/:id/restore', asyncRoute(async (req, res) => res.json(await store.restore(req.params.id, req.body))));
  app.get('/api/projects/:id/export', asyncRoute(async (req, res) => {
    const { buffer, name } = await store.exportProject(req.params.id);
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.type('application/zip').send(buffer);
  }));

  if (registerIntegrations) app.locals.integrations = await registerIntegrations(app, store);

  app.use('/api', (_req, _res, next) => next(new DomainError('找不到這個操作。', 404, 'ROUTE_NOT_FOUND')));
  app.use('/assets', express.static(store.assetDir, { dotfiles: 'deny', index: false }));
  if (staticDir) {
    const resolvedStatic = path.resolve(staticDir);
    app.use(express.static(resolvedStatic, { dotfiles: 'deny', index: false }));
    app.get('/{*path}', (req, res, next) => {
      if (!req.accepts('html')) return next();
      res.sendFile(path.join(resolvedStatic, 'index.html'), (error) => { if (error) next(error); });
    });
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) return res.status(422).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '圖片必須小於 25 MB。' : '圖片上傳格式不正確。', code: error.code });
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 格式不正確。', code: 'INVALID_JSON' });
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: '請求內容過大。', code: 'REQUEST_TOO_LARGE' });
    const status = error instanceof DomainError ? error.status : (error?.status === 404 ? 404 : 500);
    res.status(status).json({ error: error instanceof DomainError ? error.message : status === 404 ? '找不到這個檔案。' : '本機工作台發生錯誤，請稍後重試。', code: error.code || 'INTERNAL_ERROR', ...(error instanceof DomainError && error.details ? { details: error.details } : {}) });
  });
  return app;
}

export async function startServer(options = {}) {
  const app = await createApp(options);
  const port = options.port ?? Number(process.env.AIDOL_PORT ?? 4318);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new DomainError('本機服務連接埠設定不正確。');
  // 連接埠被占用：Node 會發 EADDRINUSE；Bun 不發 error、而是 listen 完成但沒有位址。兩種都說清楚。
  const portBusy = () => new DomainError(`連接埠 ${port} 已經有別的程式在用（可能 AIDOL 已經開著）。關掉那個程式再開，或用環境變數 AIDOL_PORT 換一個連接埠。`, 409, 'PORT_IN_USE');
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, '127.0.0.1', () => resolve(instance));
    instance.on('error', (error) => reject(error?.code === 'EADDRINUSE' ? portBusy() : error));
  });
  const address = server.address();
  if (!address) { try { server.close(); } catch {} throw portBusy(); }
  const actualPort = address.port;
  const url = `http://127.0.0.1:${actualPort}`;
  if (options.announce !== false) process.stdout.write(`AIDOL_READY ${JSON.stringify({ type: 'ready', port: actualPort, url })}\n`);
  let closing;
  const close = () => closing ||= (async () => {
    await app.locals.integrations?.close?.();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  })();
  return { app, store: app.locals.store, server, port: actualPort, url, close };
}

if (!process.env.AIDOL_SKIP_HTTP_AUTOSTART && process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const integrationPath = path.join(root, 'server', 'integrations.mjs');
  const hasIntegration = await fs.access(integrationPath).then(() => true, () => false);
  const registerIntegrations = hasIntegration ? (await import(pathToFileURL(integrationPath).href)).registerCodexRoutes : undefined;
  const staticDir = process.env.AIDOL_CLIENT_DIR || process.env.AIDOL_STATIC_DIR || (await fs.access(path.join(root, 'dist', 'client', 'index.html')).then(() => path.join(root, 'dist', 'client'), () => undefined));
  let running;
  try { running = await startServer({ registerIntegrations, staticDir }); }
  catch (error) {
    // 看得懂的一行（不印程式堆疊）：最常見的是連接埠被占用。
    process.stderr.write(`AIDOL 沒有啟動：${error?.message || error}\n`);
    process.exit(1);
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await running.close(); process.exit(0); });
}
