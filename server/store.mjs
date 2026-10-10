import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { ZipArchive } from 'archiver';
import { DomainError, idPattern, outputViews, viewLabels, validateCharacter, parseCharacterYaml, characterYaml, newCharacter, demoCharacter } from '../shared/domain.mjs';
import { validateCanvasAnnotationInput, canvasAnnotationDefaults } from '../shared/canvas-annotations.mjs';
import { compileBrief } from '../shared/prompt-compiler.mjs';

const referenceRoleLabels = { style: '繪風參考', identity: '角色特徵參考', color: '配色參考', clothing: '服裝結構參考', material: '材質參考', composition: '構圖參考' };
import { mergeCharacter } from '../shared/character-diff.mjs';
import { jobPresentation, workspaceSummary } from '../shared/agent-workspace.mjs';
import { framings, variantCounts } from '../shared/libraries.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => structuredClone(value);
// 角色選單上最先顯示：新圖 → 繪製中 → 等你送出 → 失敗。
// 還在畫（或等 Codex 回報）的工作：刪除角色前要提醒。
const isDrawing = (job) => ['running', 'handed_off'].includes(job.status) || Boolean(job.progress?.startedAt && !job.progress?.finishedAt);
const attentionRank = (item) => ({ review: 0, wait: 1, handoff: item.tone === 'error' ? 3 : 2 })[item.action] ?? 4;
const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${randomUUID()}`;
const exists = async (file) => fs.access(file).then(() => true, () => false);
const trashIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}--[0-9]{14}-[0-9a-f]{8}$/;
const validTrashId = (trashId) => {
  if (typeof trashId !== 'string' || !trashIdPattern.test(trashId)) throw new DomainError('資源回收區的識別碼格式不正確。', 400, 'INVALID_TRASH_ID');
  return trashId;
};
// 資料夾被開著（當工作位置、或裡面有檔案開著）時 Windows 不准搬。說清楚是誰卡住，不要只顯示系統錯誤：
// AIDOL 自己的背景 Codex 會先被請求放開（見 _moveFolder）；它正在忙就請使用者等它做完，否則就是其他程式。
const lockedCodes = ['EBUSY', 'EPERM', 'EACCES'];
const folderBusy = (error, { codexBusy = false } = {}) => {
  if (codexBusy && lockedCodes.includes(error?.code)) return new DomainError('AIDOL 的 Codex 還在工作中（例如聊天或拆解裝備），暫時沒辦法讓它放開角色資料夾。等它完成後再試一次。', 409, 'PROJECT_BUSY_CODEX');
  return [...lockedCodes, 'EXDEV'].includes(error?.code) ? new DomainError('角色資料夾被其他程式開著，所以搬不動（不是 AIDOL 自己）。請關閉 Codex App、檔案總管或編輯器後再試一次。', 409, 'PROJECT_BUSY') : error;
};
const validId = (id) => {
  if (typeof id !== 'string' || !new RegExp(idPattern).test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new DomainError('識別碼格式不正確。', 400, 'INVALID_ID');
  return id;
};
// 介面語言：繁體中文（原文）、English、日本語；不提供簡體中文。
const preferenceLocales = ['zh-TW', 'en', 'ja'];
const mimeExtensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
// ── 匯出設計包的清理（2026-10-09）──
// 設計包會被帶出電腦分享。已知的路徑欄位直接改寫成包內路徑；Codex 寫的自由文字
// （失敗訊息、拆解與提案摘要、圖片名稱、工作說明）再清掉本機資料夾、家目錄、本機網址與交接 token。
// 使用者自己寫的角色內容不動，manifest 才會和 character.yaml 一致。
const SEP = String.raw`(?:[\\/]|%2[Ff]|%5[Cc])`;
// 路徑裡的空白也可能寫成 %20；邊界判斷認得中日文字，資料夾「角色」不會吃掉「角色備份」。
const SPACE = '(?: |%20)';
const NOT_BEFORE = String.raw`(?<![\p{L}\p{N}_.~-])`;
const NOT_AFTER = String.raw`(?![\p{L}\p{N}_.-])`;
// 以分隔符號開頭的寫法只從連續分隔符號的第一個開始比對，一長串 //// 不會拖慢（避免 O(n²)）。
const SEP_START = String.raw`(?<![\\/])`;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pathPart = (part) => escapeRegExp(part).replaceAll(' ', SPACE);
const endsWithSep = new RegExp(`${SEP}$`);
const trailingSeps = new RegExp(`${SEP}+$`);
// 一個資料夾的各種寫法：\ 或 /、JSON 跳脫的 \\、%2F／%5C／%3A、大小寫、WSL 的 /mnt/c/…、Git Bash 的 /c/…。
// 前後都要是路徑邊界：資料夾 ab 不會吃掉 abc 或 ab-old。
const folderPattern = (dir) => {
  const parts = String(dir || '').split(/[\\/]+/).filter(Boolean);
  const drive = /^([A-Za-z]):$/.exec(parts[0] || '');
  if (!parts.length || (drive && parts.length < 2)) return null;
  const head = drive ? `(?:${drive[1]}(?::|%3[Aa])|${SEP_START}${SEP}+mnt${SEP}+${drive[1]}|${SEP_START}${SEP}+${drive[1]})` : `${SEP_START}${SEP}+${pathPart(parts[0])}`;
  const rest = parts.slice(1).map((part) => `${SEP}+${pathPart(part)}`).join('');
  return new RegExp(`${NOT_BEFORE}${head}${rest}(?:${SEP}+|${NOT_AFTER})`, 'giu');
};
// 別的帳號的家目錄（Windows、WSL、Git Bash、macOS 含外接磁碟、Linux、file://）一律換成 ~。
// 帳號名稱含空白時只認得 %20 的寫法；這台電腦自己的家目錄由 folderPattern 完整比對。
const homePrefixes = [
  `${SEP}+mnt${SEP}+[A-Za-z]`,
  `${SEP}+[A-Za-z](?=${SEP}+(?:Users|home)${SEP})`,
  String.raw`${SEP}{2}wsl(?:\.localhost|\$)${SEP}+[^\\/\s"'<>]+`,
  String.raw`${SEP}+Volumes${SEP}+[^\\/"'<>]+?`,
  `${SEP}+var`,
].join('|');
const DRIVE = '[A-Za-z](?::|%3[Aa])';
const homeStart = String.raw`file:${SEP}{2,3}(?:localhost)?(?:${DRIVE})?|${DRIVE}|${SEP_START}(?:${homePrefixes})?`;
const otherHomes = new RegExp(String.raw`${NOT_BEFORE}(?:${homeStart})${SEP}+(?:Users|home)${SEP}+(?:[^\\/\s"'<>%]|%20)+`, 'giu');
// 本機網址：有 http(s)/ws(s) 開頭的整段換掉；沒寫開頭的要有 port 才算（127.0.0.1:4318/…）。
// 網址只吃到 ASCII 可見字元為止，後面接的中文不會被吃掉。
const LOCAL_HOST = String.raw`(?:127(?:\.\d{1,3}){3}|localhost|0\.0\.0\.0|\[::1\]|[\w-]+\.local)`;
const localUrls = new RegExp(String.raw`(?:\b(?:https?|wss?):\/\/${LOCAL_HOST}(?::\d+)?|(?<![\w.-])${LOCAL_HOST}:\d+)[!#-&(-;=?-~]*`, 'gi');
const codexLinks = /\bcodex:\/\/[!#-&(-;=?-~]*/gi;
export function portableTextScrubber({ folders = [], home = os.homedir(), secrets = [] } = {}) {
  const steps = [];
  for (const secret of new Set(secrets)) if (typeof secret === 'string' && secret.length >= 16) steps.push((text) => text.split(secret).join('[token]'));
  steps.push((text) => text.replace(codexLinks, '[codex-link]').replace(localUrls, '[local-url]'));
  // 較深的資料夾先換：專案資料夾 → 資料資料夾 → 家目錄
  for (const folder of [...new Set(folders.filter((item) => typeof item === 'string' && item))].sort((a, b) => b.length - a.length)) {
    const pattern = folderPattern(folder);
    if (pattern) steps.push((text) => text.replace(pattern, (match) => (endsWithSep.test(match) ? '' : '.')));
  }
  const homePattern = typeof home === 'string' && home.length > 3 ? folderPattern(home) : null;
  if (homePattern) steps.push((text) => text.replace(homePattern, (match) => `~${match.match(trailingSeps)?.[0] || ''}`));
  steps.push((text) => text.replace(otherHomes, '~'));
  return (text) => (typeof text === 'string' ? steps.reduce((value, step) => step(value), text) : text);
}

export function imageMime(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}

// Windows 上資料夾裡有檔案正被讀取（例如圖片正在送給瀏覽器）時，搬移會暫時失敗；稍等再試幾次。
async function renameWithRetry(from, to, attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    try { return await fs.rename(from, to); }
    catch (error) {
      if (attempt >= attempts || !lockedCodes.includes(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

async function atomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, { flag: 'wx' });
  await fs.rename(temporary, file);
}

export class ProjectStore {
  constructor({ dataDir = process.env.AIDOL_DATA_DIR || path.join(root, '.aidol'), assetDir = process.env.AIDOL_ASSET_DIR || path.join(process.env.AIDOL_PUBLIC_DIR || path.join(root, 'public'), 'assets'), demo = true } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.assetDir = path.resolve(assetDir);
    this.demo = demo;
    this.locks = new Map();
    this.decomposing = new Set();
    this.folderReleaser = null;
    this.moveAttempts = 6; // 資料夾被佔用時，一輪搬移最多試幾次（約兩秒）。
    this.ready = null;
  }

  projectDir(id) { return path.join(this.dataDir, 'projects', validId(id)); }
  jobDir(projectId, jobId) { return path.join(this.projectDir(projectId), 'jobs', validId(jobId)); }

  // 這台電腦的介面偏好（目前只有語言）。桌面版每次啟動的本機網址 port 都不同，瀏覽器的儲存會跟著換，
  // 所以語言要記在資料資料夾裡，換 port 也記得。
  // 還沒選過語言、但已經有自己建立的角色：是語系功能之前的安裝，那時介面只有繁中，預設維持繁中（inferred）。
  async getPreferences() {
    const saved = await fs.readFile(path.join(this.dataDir, 'preferences.json'), 'utf8').then(JSON.parse, () => ({}));
    if (preferenceLocales.includes(saved?.locale)) return { locale: saved.locale };
    const folders = await fs.readdir(path.join(this.dataDir, 'projects'), { withFileTypes: true }).catch(() => []);
    const ownProjects = folders.some((folder) => folder.isDirectory() && folder.name !== 'rin' && new RegExp(idPattern).test(folder.name));
    return ownProjects ? { locale: 'zh-TW', inferred: true } : {};
  }
  async savePreferences(input = {}) {
    if (!preferenceLocales.includes(input.locale)) throw new DomainError('不支援這個介面語言。', 422, 'INVALID_LOCALE');
    await fs.mkdir(this.dataDir, { recursive: true });
    await atomic(path.join(this.dataDir, 'preferences.json'), JSON.stringify({ locale: input.locale }, null, 2));
    return { locale: input.locale };
  }

  // 刪除角色＝把整個角色資料夾移到 <資料夾>/trash/，不直接刪檔：刪除後可以馬上復原，也能從角色選單的「資源回收區」找回。
  // 刪除、復原都在角色鎖裡做；其他會寫進角色資料夾的地方也要先確認角色還在（withProjectFolder），免得刪除時留下半個資料夾。
  trashDir(trashId) { return path.join(this.dataDir, 'trash', validTrashId(trashId)); }
  async withProjectFolder(id, action) {
    return this._withProject(id, async () => { await this._read(id); return action(this.projectDir(id)); });
  }
  markDecomposing(id, running) { if (running) this.decomposing.add(id); else this.decomposing.delete(id); }
  // 背景 Codex 的整合登記：資料夾搬不動時呼叫，回傳 'released'（放開了）、'busy'（正在忙）或 'none'（沒在跑）。
  setFolderReleaser(release) { this.folderReleaser = release; }
  async _moveFolder(from, to) {
    try { return await renameWithRetry(from, to, this.moveAttempts); }
    catch (error) {
      if (!lockedCodes.includes(error?.code) || !this.folderReleaser) throw folderBusy(error);
      const released = await Promise.resolve().then(() => this.folderReleaser()).catch(() => 'none');
      if (released !== 'released') throw folderBusy(error, { codexBusy: released === 'busy' });
      return renameWithRetry(from, to, this.moveAttempts).catch((again) => { throw folderBusy(again); });
    }
  }
  async deleteProject(id) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const deletedAt = now();
      const trashId = `${id}--${deletedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
      // 先寫刪除紀錄再搬：搬移中途出事時，資源回收區裡的資料夾一定認得出是哪個角色。
      const marker = path.join(this.projectDir(id), 'deleted.json');
      await atomic(marker, JSON.stringify({ id, name: state.name, deletedAt }, null, 2));
      await fs.mkdir(path.join(this.dataDir, 'trash'), { recursive: true });
      try { await this._moveFolder(this.projectDir(id), this.trashDir(trashId)); }
      catch (error) { await fs.rm(marker, { force: true }); throw error; }
      return { id, name: state.name, trashId, deletedAt };
    });
  }
  async _trashInfo(trashId) {
    const source = this.trashDir(trashId);
    const prefix = trashId.slice(0, trashId.lastIndexOf('--'));
    const marker = await fs.readFile(path.join(source, 'deleted.json'), 'utf8').then(JSON.parse, () => null);
    const metadata = await fs.readFile(path.join(source, 'project.json'), 'utf8').then(JSON.parse, () => null);
    // 角色 ID 以資料夾名稱與 project.json 為準，刪除紀錄只補名稱與時間；對不上就不認。
    if (!metadata || metadata.id !== prefix || (marker && marker.id !== prefix)) return null;
    return { trashId, id: prefix, name: marker?.name || metadata.name || prefix, deletedAt: marker?.deletedAt || null, imageCount: (metadata.assets || []).filter((asset) => asset.role === 'design').length };
  }
  async listTrash() {
    await this.init();
    const entries = await fs.readdir(path.join(this.dataDir, 'trash'), { withFileTypes: true }).catch(() => []);
    const items = await Promise.all(entries.filter((entry) => entry.isDirectory() && trashIdPattern.test(entry.name)).map((entry) => this._trashInfo(entry.name)));
    return items.filter(Boolean).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  }
  async restoreProject(trashId) {
    const info = await this._trashInfo(validTrashId(trashId));
    if (!info) throw new DomainError('資源回收區裡找不到這個角色。', 404, 'TRASH_NOT_FOUND');
    return this._withProject(info.id, async () => {
      const target = this.projectDir(info.id);
      if (await exists(target)) {
        // 原位置只剩不完整的資料夾（沒有 project.json，例如刪除時剛好有東西寫入）：先移到資源回收區旁邊，再復原。
        if (await exists(path.join(target, 'project.json'))) throw new DomainError('已經有同一個 ID 的角色，無法復原到原位置。', 409, 'PROJECT_EXISTS');
        await this._moveFolder(target, path.join(this.dataDir, 'trash', `${info.id}--${now().replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}-partial`));
      }
      await this._moveFolder(this.trashDir(trashId), target);
      await fs.rm(path.join(target, 'deleted.json'), { force: true });
      const state = await this._read(info.id);
      // 刪除期間背景拆解的結果寫不回來；復原時如果沒有還在跑的拆解，就標成中斷，讓使用者可以再拆一次。
      if (state.decomposition?.status === 'running' && !this.decomposing.has(info.id)) {
        state.decomposition = { ...state.decomposition, status: 'failed', finishedAt: now(), error: '角色被刪除時拆解中斷，可以再拆一次。', errorCode: 'DECOMPOSE_INTERRUPTED' };
        await this._saveMetadata(state);
      }
      return this._public(state);
    });
  }
  async purgeTrash(trashId) {
    const info = await this._trashInfo(validTrashId(trashId));
    if (!info) throw new DomainError('資源回收區裡找不到這個角色。', 404, 'TRASH_NOT_FOUND');
    await fs.rm(this.trashDir(trashId), { recursive: true, force: true });
    return { trashId, id: info.id, name: info.name };
  }

  async init() {
    if (!this.ready) this.ready = this._init();
    await this.ready;
    return this;
  }

  async _init() {
    await fs.mkdir(path.join(this.dataDir, 'projects'), { recursive: true });
    const folders = await fs.readdir(path.join(this.dataDir, 'projects'), { withFileTypes: true });
    for (const folder of folders.filter((entry) => entry.isDirectory() && new RegExp(idPattern).test(entry.name))) await this._recover(folder.name);
    // 範例角色只在全新安裝時建立；角色都刪光（資源回收區裡有東西）時不再冒出來。
    const trashed = await fs.readdir(path.join(this.dataDir, 'trash')).then((entries) => entries.some((name) => /--[0-9]{14}-[0-9a-f]{8}/.test(name)), () => false);
    if (this.demo && !trashed && !folders.some((entry) => entry.isDirectory())) {
      const createdAt = now();
      const character = demoCharacter();
      const assets = ['sheet', 'hair', 'coat', 'pants', 'boots', 'clasp'].map((part) => ({
        id: `demo-rin-${part}`, url: `/assets/rin-${part}.png`, name: part === 'sheet' ? '凜・角色設定稿' : character.components[part].name,
        targetId: part === 'sheet' ? 'character' : part, role: 'design', view: 'front', version: 1, createdAt,
        source: 'demo', sourceFile: `rin-${part}.png`,
      }));
      const state = { id: 'rin', name: '凜', createdAt, updatedAt: createdAt, character, assets, jobs: [], candidates: [], proposals: [], history: [], syncTargets: [], canvasAnnotations: [] };
      this._history(state, '建立範例角色', 'demoCreated');
      await this._save(state);
    }
  }

  async _withProject(id, action) {
    await this.init();
    validId(id);
    const previous = this.locks.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(action);
    this.locks.set(id, task);
    try { return await task; }
    finally { if (this.locks.get(id) === task) this.locks.delete(id); }
  }

  async _recover(id) {
    const pending = path.join(this.projectDir(id), 'pending.json');
    if (!(await exists(pending))) return;
    const state = JSON.parse(await fs.readFile(pending, 'utf8'));
    await this._writeState(state);
    await fs.unlink(pending);
  }

  async _writeState(state) {
    const { character, ...metadata } = state;
    await atomic(path.join(this.projectDir(state.id), 'character.yaml'), characterYaml(character));
    await atomic(path.join(this.projectDir(state.id), 'project.json'), JSON.stringify(metadata, null, 2));
  }

  async _save(state) {
    state.updatedAt = now();
    const pending = path.join(this.projectDir(state.id), 'pending.json');
    await atomic(pending, JSON.stringify(state));
    await this._writeState(state);
    await fs.unlink(pending);
  }

  async _saveMetadata(state) {
    state.updatedAt = now();
    const { character, ...metadata } = state;
    await atomic(path.join(this.projectDir(state.id), 'project.json'), JSON.stringify(metadata, null, 2));
  }

  async _read(id) {
    await this._recover(id);
    const metadataFile = path.join(this.projectDir(id), 'project.json');
    if (!(await exists(metadataFile))) throw new DomainError('找不到這個角色專案。', 404, 'PROJECT_NOT_FOUND');
    const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
    const character = parseCharacterYaml(await fs.readFile(path.join(this.projectDir(id), 'character.yaml'), 'utf8'), metadata.assets.map((asset) => asset.id));
    const state = { ...metadata, character, proposals: metadata.proposals || [], syncTargets: metadata.syncTargets || [], canvasAnnotations: metadata.canvasAnnotations || [] };
    let hydrated = false;
    for (const asset of state.assets.filter((item) => item.source === 'demo')) {
      const assetPath = await this._assetPath(id, asset);
      if (await exists(assetPath)) {
        const url = `/api/projects/${id}/assets/${asset.id}`;
        if (asset.url !== url || !asset.sha256) {
          const content = await fs.readFile(assetPath);
          asset.url = url;
          asset.mimeType = 'image/png';
          asset.sha256 = createHash('sha256').update(content).digest('hex');
          hydrated = true;
        }
      }
    }
    if (hydrated) await this._save(state);
    return state;
  }

  _public(state) {
    const result = clone(state);
    // 2026-10-07 起畫好的圖不論用哪一版設定都可採用；olderSettings 只是提示「用較早設定畫的」。
    result.candidates = result.candidates.map((candidate) => ({ ...candidate, olderSettings: candidate.baseRevision !== state.character.revision }));
    result.proposals = result.proposals.map((proposal) => ({ ...proposal, olderSettings: proposal.baseRevision !== state.character.revision }));
    return result;
  }

  _cas(state, baseRevision) {
    if (!Number.isInteger(baseRevision)) throw new DomainError('請提供人物的基礎版本。', 422, 'MISSING_REVISION');
    if (baseRevision !== state.character.revision) throw new DomainError('角色已經更新，請重新載入後再操作。', 409, 'REVISION_CONFLICT', { currentRevision: state.character.revision, baseRevision });
  }

  // message 是繁中原文；messageKey／messageParams 讓介面換成使用者的語言（前端 locales/<語言>/history.json）。
  _history(state, message, messageKey, messageParams) {
    state.history.push({ id: uid('history'), revision: state.character.revision, createdAt: now(), message, ...(messageKey ? { messageKey, ...(messageParams ? { messageParams } : {}) } : {}), character: clone(state.character), syncTargets: [...state.syncTargets] });
  }

  _target(state, targetId) {
    if (targetId !== 'character' && !Object.hasOwn(state.character.components, targetId)) throw new DomainError('找不到指定的角色部件。', 422, 'UNKNOWN_COMPONENT');
  }

  _changedTargets(before, after) {
    const changed = new Set();
    if (JSON.stringify(before.identity) !== JSON.stringify(after.identity) || JSON.stringify(before.style) !== JSON.stringify(after.style)) Object.keys(after.adopted).forEach((target) => changed.add(target));
    if (JSON.stringify(before.outfits) !== JSON.stringify(after.outfits)) changed.add('character');
    // 裁切位置與草案狀態只是整理資訊，不代表外觀改了。
    const looks = (component) => component && JSON.stringify({ ...component, crop: undefined, designStatus: undefined });
    for (const [id, component] of Object.entries(after.components)) {
      if (looks(before.components[id]) !== looks(component)) { changed.add(id); changed.add('character'); }
    }
    for (const id of Object.keys(before.components)) if (!after.components[id]) changed.add('character');
    return [...changed].filter((target) => after.adopted[target]);
  }

  async listProjects() {
    await this.init();
    const folders = await fs.readdir(path.join(this.dataDir, 'projects'), { withFileTypes: true });
    // 一個資料夾讀不到（剛被刪除、只剩半個資料夾）不能讓整個角色選單打不開；資料夾名稱和角色 ID 對不上的也略過。
    const settled = await Promise.allSettled(folders.filter((folder) => folder.isDirectory() && new RegExp(idPattern).test(folder.name)).map(async (folder) => ({ folder: folder.name, project: await this.getProject(folder.name) })));
    const projects = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') { if (result.value.project.id === result.value.folder) projects.push(result.value.project); continue; }
      if (result.reason?.code !== 'PROJECT_NOT_FOUND') throw result.reason;
    }
    return projects.map((project) => {
      const { id, name, createdAt, updatedAt, character, assets } = project;
      const assetUrl = (assetId) => assets.find((asset) => asset.id === assetId)?.url || null;
      // 角色庫的「等你處理」：依每份工作自己的穿搭判斷，只列有證據的下一步。
      const attention = Object.keys(character.outfits).flatMap((outfitId) => workspaceSummary(project, outfitId).attentionJobs.map((job) => {
        const view = jobPresentation(project, job, outfitId);
        const targetName = job.targetId === 'character' ? '立繪' : character.components[job.targetId]?.name || '部件';
        return { jobId: job.id, targetId: job.targetId, targetName, label: view.label, labelKey: view.labelKey, labelParams: view.labelParams, tone: view.tone, action: view.action, createdAt: job.createdAt, thumbnailUrl: assetUrl(view.candidate?.assetId) || assetUrl(character.adopted[job.targetId]) || assetUrl(character.adopted.character) };
      }));
      const proposals = project.proposals.filter((proposal) => proposal.status === 'pending').length;
      return {
        id, name, createdAt, updatedAt, revision: character.revision,
        thumbnailUrl: assetUrl(character.adopted.character),
        persona: (character.persona.description || '').slice(0, 120), traits: character.persona.traits.slice(0, 6),
        componentCount: Object.keys(character.components).length, outfitCount: Object.keys(character.outfits).length,
        imageCount: assets.filter((asset) => asset.role === 'design').length, drawingCount: project.jobs.filter(isDrawing).length + (project.decomposition?.status === 'running' ? 1 : 0),
        attention: attention.sort((a, b) => attentionRank(a) - attentionRank(b) || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).slice(0, 6),
        attentionCount: attention.length + proposals, pendingProposals: proposals,
      };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createProject({ name, brief = '' } = {}) {
    if (typeof name !== 'string' || !name.trim() || name.length > 160) throw new DomainError('請輸入 1 至 160 字的角色名稱。', 422, 'INVALID_NAME');
    if (typeof brief !== 'string' || brief.length > 12000) throw new DomainError('角色簡介長度不可超過 12000 字。', 422, 'BRIEF_TOO_LONG');
    const id = uid('character');
    return this._withProject(id, async () => {
      const createdAt = now();
      const state = { id, name: name.trim(), createdAt, updatedAt: createdAt, character: newCharacter(id, name.trim(), brief), assets: [], jobs: [], candidates: [], proposals: [], history: [], syncTargets: [], canvasAnnotations: [] };
      this._history(state, '建立角色草案', 'draftCreated');
      await this._save(state);
      return this._public(state);
    });
  }

  async getProject(id) { return this._withProject(id, async () => this._public(await this._read(id))); }
  async getYaml(id) { return characterYaml((await this.getProject(id)).character); }

  async listCanvasAnnotations(id) { return (await this.getProject(id)).canvasAnnotations; }

  async createCanvasAnnotation(id, input) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const fields = validateCanvasAnnotationInput(input, { assetIds: state.assets.map(asset => asset.id) });
      const createdAt = now();
      const annotation = { ...canvasAnnotationDefaults(fields), id: uid('annotation'), createdAt, updatedAt: createdAt };
      state.canvasAnnotations.push(annotation);
      await this._saveMetadata(state);
      return { annotation: clone(annotation), project: this._public(state) };
    });
  }

  async updateCanvasAnnotation(id, annotationId, input) {
    return this._withProject(id, async () => {
      validId(annotationId);
      const state = await this._read(id);
      const annotation = state.canvasAnnotations.find(item => item.id === annotationId);
      if (!annotation) throw new DomainError('找不到這張畫布註記。', 404, 'CANVAS_ANNOTATION_NOT_FOUND');
      const fields = validateCanvasAnnotationInput(input, { kind: annotation.kind, patch: true, assetIds: state.assets.map(asset => asset.id) });
      Object.assign(annotation, fields, { updatedAt: now() });
      await this._saveMetadata(state);
      return { annotation: clone(annotation), project: this._public(state) };
    });
  }

  async deleteCanvasAnnotation(id, annotationId) {
    return this._withProject(id, async () => {
      validId(annotationId);
      const state = await this._read(id);
      const index = state.canvasAnnotations.findIndex(item => item.id === annotationId);
      if (index < 0) throw new DomainError('找不到這張畫布註記。', 404, 'CANVAS_ANNOTATION_NOT_FOUND');
      state.canvasAnnotations.splice(index, 1);
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  _validateUpdate(state, input) {
    const character = input.yaml !== undefined ? parseCharacterYaml(input.yaml, state.assets.map((asset) => asset.id)) : validateCharacter(clone(input.character), state.assets.map((asset) => asset.id));
    if (character.id !== state.character.id) throw new DomainError('人物 ID 不可變更。', 422, 'IMMUTABLE_CHARACTER_ID');
    if (character.revision !== state.character.revision) throw new DomainError('YAML 的 revision 必須與目前版本相同；版本由系統更新。', 409, 'REVISION_CONFLICT', { currentRevision: state.character.revision });
    for (const [target, assetId] of Object.entries(character.adopted)) {
      const asset = state.assets.find((item) => item.id === assetId);
      if (asset.targetId !== target || asset.role === 'reference') throw new DomainError('採用稿必須是相同部位的設計圖片。', 422, 'ASSET_TARGET_MISMATCH');
      if (target === 'character' ? asset.view !== 'front' : !['front', 'full'].includes(asset.view)) throw new DomainError('角色及部件主圖不可使用背面或細節稿；請保存到對應視角。', 422, 'INVALID_PRIMARY_VIEW');
    }
    for (const component of Object.values(character.components)) {
      for (const assetId of [component.assetId, ...Object.values(component.views || {})].filter(Boolean)) {
        const asset = state.assets.find((item) => item.id === assetId);
        if (asset.targetId !== component.id || asset.role !== 'design') throw new DomainError('部件圖稿必須屬於相同部件。', 422, 'ASSET_TARGET_MISMATCH');
      }
      if (component.assetId && !['front', 'full'].includes(state.assets.find((asset) => asset.id === component.assetId).view)) throw new DomainError('部件主圖只能使用正面或完整稿，背面與細節請保存到 views。', 422, 'INVALID_PRIMARY_VIEW');
      for (const [view, assetId] of Object.entries(component.views || {})) {
        if (state.assets.find((asset) => asset.id === assetId).view !== view) throw new DomainError('部件視角引用必須與圖片的視角相同。', 422, 'VIEW_ASSET_MISMATCH');
      }
      const adoptedId = character.adopted[component.id];
      if (adoptedId) {
        const adoptedAsset = state.assets.find((asset) => asset.id === adoptedId);
        if ((component.assetId && component.assetId !== adoptedId) || (component.views?.[adoptedAsset.view] && component.views[adoptedAsset.view] !== adoptedId)) throw new DomainError('部件主圖與對應視角必須和目前採用稿一致。請重新載入後再修改描述。', 422, 'ADOPTED_ASSET_MISMATCH');
      }
    }
    return character;
  }

  async updateCharacter(id, input) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._cas(state, input.baseRevision);
      const character = this._validateUpdate(state, input);
      state.syncTargets = [...new Set([...state.syncTargets, ...this._changedTargets(state.character, character)])].filter((target) => character.adopted[target]);
      state.character = { ...character, schema_version: 2, revision: state.character.revision + 1 };
      state.name = character.name;
      this._history(state, '更新人物設定', 'settingsUpdated');
      await this._save(state);
      return this._public(state);
    });
  }

  async saveProposal(id, input) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._cas(state, input.baseRevision);
      const character = this._validateUpdate(state, input);
      const proposal = { id: uid('proposal'), baseRevision: input.baseRevision, character, status: 'pending', createdAt: now(), source: input.source || 'agent', ...(input.summary ? { summary: String(input.summary).slice(0, 12000) } : {}), ...(input.threadId ? { threadId: input.threadId } : {}), ...(input.sourceJobId ? { sourceJobId: input.sourceJobId } : {}) };
      state.proposals.push(proposal);
      await this._save(state);
      return proposal;
    });
  }

  async acceptProposal(id, proposalId, { baseRevision }) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._cas(state, baseRevision);
      const proposal = state.proposals.find((item) => item.id === proposalId);
      if (!proposal) throw new DomainError('找不到這份人物設定提案。', 404, 'PROPOSAL_NOT_FOUND');
      if (proposal.status !== 'pending') throw new DomainError('這份提案已經處理過了。', 409, 'PROPOSAL_CLOSED');
      // 提案寫好後設定又改過時，只把提案真正改動的地方合併到目前設定，不蓋掉使用者之後的修改。
      let proposed = proposal.character;
      if (proposal.baseRevision !== state.character.revision) {
        const base = [...state.history].reverse().find((entry) => entry.revision === proposal.baseRevision)?.character;
        if (!base) throw new DomainError('找不到這份提案依據的設定版本，請重新請 AI 提案。', 409, 'STALE_PROPOSAL');
        proposed = mergeCharacter(base, proposal.character, state.character);
      }
      const character = this._validateUpdate(state, { character: { ...proposed, adopted: state.character.adopted, revision: state.character.revision } });
      state.syncTargets = [...new Set([...state.syncTargets, ...this._changedTargets(state.character, character)])].filter((target) => character.adopted[target]);
      state.character = { ...character, schema_version: 2, revision: baseRevision + 1 };
      state.name = character.name;
      proposal.status = 'accepted';
      proposal.acceptedAt = now();
      this._history(state, '採用人物設定提案', 'proposalAccepted');
      await this._save(state);
      return this._public(state);
    });
  }

  async dismissProposal(id, proposalId) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const proposal = state.proposals.find((item) => item.id === proposalId);
      if (!proposal) throw new DomainError('找不到這份人物設定提案。', 404, 'PROPOSAL_NOT_FOUND');
      if (proposal.status === 'pending') { proposal.status = 'dismissed'; proposal.dismissedAt = now(); }
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  // ── 自動拆解裝備 ──
  // 立繪採用後，由 Codex 讀圖列出裝備；狀態記在 project.json，結果以「提案」裝備加入角色並接上套裝。
  async startDecomposition(id, { assetId, auto = false } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const asset = state.assets.find((item) => item.id === (assetId || state.character.adopted.character));
      if (!asset || asset.targetId !== 'character' || asset.role !== 'design') throw new DomainError('要先有正式立繪，才能拆解裝備。', 409, 'NO_PORTRAIT');
      const current = state.decomposition;
      if (current?.status === 'running' && current.assetId === asset.id && Date.now() - Date.parse(current.startedAt) < 10 * 60 * 1000) return { project: this._public(state), asset, path: await this._assetPath(id, asset), skipped: true };
      state.decomposition = { status: 'running', assetId: asset.id, auto: Boolean(auto), startedAt: now() };
      await this._saveMetadata(state);
      return { project: this._public(state), asset, path: await this._assetPath(id, asset) };
    });
  }

  async finishDecomposition(id, { assetId, parts = [], summary = '', threadId = null } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      // 期間又換了立繪、重新拆解時，舊結果不套用。
      if (state.decomposition?.status !== 'running' || state.decomposition.assetId !== assetId) return this._public(state);
      const asset = state.assets.find((item) => item.id === assetId);
      const character = clone(state.character);
      const outfitId = asset?.outfitId && character.outfits[asset.outfitId] ? asset.outfitId : Object.keys(character.outfits)[0];
      const outfit = character.outfits[outfitId];
      const kinds = new Set(['body', 'hair', 'garment', 'accessory', 'weapon', 'footwear', 'other']);
      const clamp = (value) => Math.min(1, Math.max(0, Number(value) || 0));
      const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[^a-z0-9]+/, '').replace(/[_-]+$/, '').slice(0, 60);
      let added = 0; let updated = 0;
      for (const part of (Array.isArray(parts) ? parts : []).slice(0, 12)) {
        const name = String(part?.name || '').trim().slice(0, 160);
        if (!name) continue;
        const box = part.bbox || {};
        const x = clamp(box.x); const y = clamp(box.y);
        const width = Math.min(clamp(box.width), 1 - x); const height = Math.min(clamp(box.height), 1 - y);
        const crop = width > 0.01 && height > 0.01 ? { assetId, x, y, width, height } : null;
        const existing = (part.existingId && character.components[part.existingId]) || Object.values(character.components).find((item) => item.name.trim() === name);
        if (existing) {
          if (crop) existing.crop = crop;
          if (!existing.description && part.description) existing.description = String(part.description).slice(0, 2000);
          updated += 1;
          continue;
        }
        let partId = slug(part.id) || 'part';
        if (partId === 'character') partId = 'part_character';
        for (let n = 2; character.components[partId]; n += 1) partId = `${slug(part.id) || 'part'}_${n}`.slice(0, 79);
        character.components[partId] = { id: partId, name, kind: kinds.has(part.kind) ? part.kind : 'other', description: String(part.description || '').slice(0, 2000), designStatus: 'proposed', ...(crop ? { crop } : {}) };
        if (outfit && !outfit.equipped.some((item) => item.componentId === partId)) outfit.equipped.push({ id: uid('wear'), componentId: partId, anchor: String(part.anchor || '身上').slice(0, 200), enabled: true });
        added += 1;
      }
      const finishedAt = now();
      if (added || updated) {
        const validated = this._validateUpdate(state, { character });
        state.character = { ...validated, schema_version: 2, revision: state.character.revision + 1 };
        this._history(state, added ? `AI 拆解裝備：新增 ${added} 件` : 'AI 拆解裝備：更新位置', added ? 'decomposeAdded' : 'decomposeMoved', added ? { count: added } : undefined);
      }
      state.decomposition = { status: 'done', assetId, auto: state.decomposition.auto, startedAt: state.decomposition.startedAt, finishedAt, added, updated, summary: String(summary || '').slice(0, 500), ...(threadId ? { threadId } : {}) };
      if (added || updated) await this._save(state); else await this._saveMetadata(state);
      return this._public(state);
    });
  }

  async failDecomposition(id, { assetId, message, code, detail } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      if (state.decomposition?.assetId !== assetId || state.decomposition.status !== 'running') return this._public(state);
      state.decomposition = { ...state.decomposition, status: 'failed', finishedAt: now(), error: String(message || '拆解沒有完成。').slice(0, 500), ...(typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? { errorCode: code } : {}), ...(typeof detail === 'string' && detail ? { errorDetail: detail.slice(0, 200) } : {}) };
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  async _assetPath(projectId, asset) {
    if (asset.source === 'demo') {
      const destination = path.join(this.projectDir(projectId), 'assets', `${validId(asset.id)}.png`);
      if (!(await exists(destination))) {
        const source = path.join(this.assetDir, path.basename(asset.sourceFile));
        if (await exists(source)) {
          // 只建 assets 這一層：角色資料夾不在（剛被刪除）就不要把它建回來。
          await fs.mkdir(path.dirname(destination)).catch((error) => {
            if (error.code === 'ENOENT') throw new DomainError('找不到這個角色專案。', 404, 'PROJECT_NOT_FOUND');
            if (error.code !== 'EEXIST') throw error;
          });
          await fs.copyFile(source, destination, constants.COPYFILE_EXCL).catch((error) => { if (error.code !== 'EEXIST') throw error; });
        }
      }
      return destination;
    }
    return path.join(this.projectDir(projectId), 'assets', `${validId(asset.id)}${mimeExtensions[asset.mimeType]}`);
  }

  async createJob(id, { targetId = 'character', prompt, kind = 'refine', region, baseRevision, outfitId, outputView = 'front', directionId, variants = 1, framing }) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._cas(state, baseRevision);
      this._target(state, targetId);
      if (!outputViews.includes(outputView) || (targetId === 'character' && outputView !== 'front')) throw new DomainError(targetId === 'character' ? '角色整體工作只接受 front，完整設定稿內可以包含前後視角。' : '輸出視角必須是 front、full、back 或 detail。', 422, 'INVALID_OUTPUT_VIEW');
      const outfitIds = Object.keys(state.character.outfits);
      if (outfitId !== undefined && (typeof outfitId !== 'string' || !Object.hasOwn(state.character.outfits, outfitId))) throw new DomainError('找不到這次工作指定的穿搭。', 422, 'UNKNOWN_OUTFIT');
      if (outfitId === undefined && outfitIds.length > 1) throw new DomainError('角色有多套穿搭，請明確選擇這次工作使用的穿搭。', 422, 'MISSING_OUTFIT');
      const selectedOutfitId = outfitId ?? outfitIds[0] ?? null;
      const selectedOutfit = selectedOutfitId ? clone(state.character.outfits[selectedOutfitId]) : null;
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000) throw new DomainError('請輸入本次設計要求，長度不可超過 12000 字。', 422, 'INVALID_PROMPT');
      if (!['generate', 'refine', 'expand', 'sync'].includes(kind)) throw new DomainError('不支援這種設計工作。', 422, 'UNSUPPORTED_JOB_KIND');
      if (!variantCounts.includes(variants)) throw new DomainError(`一次可產生 ${variantCounts.join('、')} 張候選。`, 422, 'INVALID_VARIANTS');
      if (directionId !== undefined && directionId !== null && !Object.hasOwn(state.character.style.directions || {}, directionId)) throw new DomainError('找不到這次指定的畫風方向。', 422, 'UNKNOWN_DIRECTION');
      if (framing !== undefined && framing !== null && !framings.some((item) => item.id === framing)) throw new DomainError('不支援這種取景。', 422, 'INVALID_FRAMING');
      if (region !== undefined && region !== null) {
        if (typeof region !== 'object' || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(region[key]) && region[key] >= 0 && region[key] <= 1) || region.width <= 0 || region.height <= 0 || region.x + region.width > 1.000001 || region.y + region.height > 1.000001) throw new DomainError('選區必須是圖片內的正規化範圍。');
      }
      const jobId = uid('job');
      const equippedAssets = (selectedOutfit?.equipped || []).filter((item) => item.enabled).map((item) => state.character.adopted[item.componentId]);
      const relatedPartIds = new Set([...(targetId !== 'character' ? [targetId] : []), ...(selectedOutfit?.equipped || []).filter((item) => item.enabled).map((item) => item.componentId)]);
      const viewAssets = [...relatedPartIds].flatMap((partId) => Object.values(state.character.components[partId]?.views || {}));
      const referenceIds = new Set([state.character.adopted.character, state.character.adopted[targetId], ...equippedAssets, ...viewAssets, ...state.character.style.references.map((reference) => reference.assetId)].filter(Boolean));
      const referenceAssets = await Promise.all(state.assets.filter((asset) => referenceIds.has(asset.id)).map(async (asset) => ({ ...asset, path: await this._assetPath(id, asset), sha256: await fs.readFile(await this._assetPath(id, asset)).then((content) => createHash('sha256').update(content).digest('hex'), () => null) })));
      if (referenceAssets.some((asset) => !asset.sha256)) throw new DomainError('這次工作使用的參考圖片尚未就緒，請待素材完成後再建立工作。', 409, 'MISSING_REFERENCE');
      const outfitInstruction = selectedOutfit ? `本次穿搭：${selectedOutfit.name}（ID：${selectedOutfit.id}）。只依這套穿搭的 enabled=true 裝備生成整體；其他穿搭僅供背景參考，不得合併穿戴。${targetId !== 'character' && !selectedOutfit.equipped.some((item) => item.componentId === targetId && item.enabled) ? '目標部件目前未穿戴：本次僅設計部件，不自動加入穿搭。' : ''}` : '目前尚未設定穿搭；請設計角色草案，不得將未知服裝宣稱為已確認。';
      const viewInstruction = `本次輸出視角：${viewLabels[outputView]}（view：${outputView}）。${targetId === 'character' ? '輸出完整角色設定稿，可在同一稿內呈現前後視角。' : ['back', 'detail'].includes(outputView) ? '這份候選採用後只保存對應視角，不取代部件主圖。' : '這份候選採用後會更新部件主圖。'}回收時的 view 必須與本次輸出視角相同。`;
      const compiled = compileBrief(state.character, { directionId, outfitId: selectedOutfitId, framing });
      const variantInstruction = variants > 1 ? `本次請產生 ${variants} 張候選，彼此在構圖或細節上可有變化，但都必須符合同一份設定與鎖定特徵；每張分別提交為待審候選。` : '';
      const yaml = `${[outfitInstruction, viewInstruction].flatMap((instruction) => instruction.split(/\r?\n/).map((line) => `# ${line}`)).join('\n')}\n${characterYaml(state.character)}`;
      const snapshotPath = path.join(this.jobDir(id, jobId), 'input.yaml');
      const instructionsPath = path.join(this.jobDir(id, jobId), 'instructions.md');
      // 每張固定輸入都標出用途：繪風參考管「畫法」，正式立繪與裝備圖只管「長相與服裝」，避免舊圖的畫法蓋掉新的繪風參考。
      const styleReferences = state.character.style.references.filter((reference) => referenceIds.has(reference.assetId)).map((reference) => ({ id: reference.id, assetId: reference.assetId, role: reference.role, focus: reference.focus || [], name: state.assets.find((asset) => asset.id === reference.assetId)?.name || reference.assetId }));
      const drawingStyle = styleReferences.filter((reference) => reference.role === 'style');
      const focusText = (reference) => reference.focus.join('、') || '整體感覺';
      const partName = (partId) => state.character.components[partId]?.name || partId;
      const inputRole = (asset) => {
        const reference = styleReferences.find((item) => item.assetId === asset.id);
        if (reference) return { order: 0, label: `${referenceRoleLabels[reference.role] || '參考圖'}：要參考它的「${focusText(reference)}」${reference.role === 'style' ? '，這次的畫法以它為準' : ''}` };
        if (asset.id === state.character.adopted.character) return { order: 1, label: `目前的正式立繪：只用來確認角色長相、髮型、服裝與配色${drawingStyle.length ? '，不要沿用它的畫法' : ''}` };
        if (targetId !== 'character' && asset.id === state.character.adopted[targetId]) return { order: 2, label: `「${partName(targetId)}」目前的設計圖` };
        return { order: 3, label: `「${partName(asset.targetId)}」的${viewLabels[asset.view] || '設計圖'}：服裝結構與細節${drawingStyle.length ? '，不要沿用它的畫法' : ''}` };
      };
      const labeledInputs = referenceAssets.map((asset) => ({ asset, ...inputRole(asset) })).sort((a, b) => a.order - b.order);
      const styleLine = drawingStyle.length ? `繪風參考：${drawingStyle.map((reference) => `${reference.name}（${focusText(reference)}）`).join('、')}。畫法以繪風參考為準；正式立繪與裝備圖只用來確認長相與服裝。` : '';
      const handoffPrompt = `請使用 AIDOL 工作資料進行角色設計。\n專案：${state.character.name}\n工作：${jobId}\n目標：${targetId}\n基礎版本：${baseRevision}\n${outfitInstruction}\n${viewInstruction}\n${variantInstruction ? `${variantInstruction}\n` : ''}${compiled.direction ? `畫風方向：${compiled.direction.id} · ${compiled.direction.name}\n` : ''}${styleLine ? `${styleLine}\n` : ''}本次要求：${prompt.trim()}\n人物快照：${snapshotPath}\n操作說明：${instructionsPath}\n使用新的工作階段；先讀取設定與參考圖。完成後提交圖片為待審候選，不可覆寫目前採用稿。`;
      const keepLine = drawingStyle.length
        ? '角色的長相、髮型、服裝與配色依 input.yaml 和上面的角色、裝備圖保持一致；畫法（線條、上色、陰影、五官與人物的畫法）以「繪風參考」為準，不要沿用目前正式立繪或裝備圖的畫法。要換畫法時請重新畫整張，不要拿舊畫法的圖做局部修改；之後若要再修正（例如頭身），也要再附上繪風參考。下方「畫風方向」只補充繪風參考沒有涵蓋的部分，兩者衝突時以繪風參考為準。'
        : '依據 input.yaml 保持角色辨識特徵與繪風，只依本次要求修改。';
      // 交接訊息只寫工作資料夾，回報與回收的規則寫在這裡（同時也在 AIDOL skill）。
      const reportSection = `## 回報與回收\n\n- 回收憑證是同資料夾的 handoff.json（不要顯示 token）；用 AIDOL skill 的 submit-candidate helper 提交。\n- 開始產圖前回報 \`--event started\`；本次共 ${variants} 張，每張完成就提交；全部完成回報 \`--event finished\`，失敗回報 \`--event failed --message "原因"\`。\n- 沒有圖像工具時說明限制並保留工作；不得用文字或示意圖冒充產圖；不覆寫、不採用目前的正式稿。`;
      const instructions = `# AIDOL 精修工作\n\n${handoffPrompt}\n\n## 固定輸入\n\n${labeledInputs.map(({ asset, label }) => `- ${label}｜${asset.name}: ${asset.path} (${asset.sha256 || '檔案尚未可用'})`).join('\n')}\n\n${region ? `選區（0 至 1）：${JSON.stringify(region)}\n\n` : ''}${keepLine}尚未指定的結構先提出設計，不得宣稱已確認。\n${compiled.empty ? '' : `\n${compiled.text}\n`}`;
      await fs.mkdir(this.jobDir(id, jobId), { recursive: true });
      await fs.writeFile(snapshotPath, yaml, { flag: 'wx' });
      await fs.writeFile(instructionsPath, `${instructions.trimEnd()}\n\n${reportSection}\n`, { flag: 'wx' });
      const job = { id: jobId, targetId, outputView, outfitId: selectedOutfitId, prompt: prompt.trim(), kind, ...(region ? { region: clone(region) } : {}), variants, ...(compiled.direction ? { directionId: compiled.direction.id } : {}), ...(framing ? { framing } : {}), baseRevision, status: 'prepared', createdAt: now(), context: { yaml, selectedOutfit, referenceAssets, styleReferences, snapshotPath, instructionsPath, ...(compiled.empty ? {} : { compiled: compiled.text, compiledPrompt: compiled.prompt }) }, handoffPrompt };
      state.jobs.push(job);
      await this._save(state);
      return clone(job);
    });
  }

  async listJobs(id) { return (await this.getProject(id)).jobs; }
  async getJob(id, jobId) {
    const job = (await this.getProject(id)).jobs.find((item) => item.id === jobId);
    if (!job) throw new DomainError('找不到這次設計工作。', 404, 'JOB_NOT_FOUND');
    return job;
  }

  async updateJob(id, jobId, patch) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job) throw new DomainError('找不到這次設計工作。', 404, 'JOB_NOT_FOUND');
      const forbidden = ['id', 'targetId', 'outfitId', 'outputView', 'prompt', 'kind', 'region', 'variants', 'directionId', 'framing', 'baseRevision', 'createdAt', 'context'];
      if (forbidden.some((key) => Object.hasOwn(patch, key))) throw new DomainError('不可變更工作的固定輸入。');
      Object.assign(job, clone(patch), { updatedAt: now() });
      await this._save(state);
      return clone(job);
    });
  }

  async addAsset(id, { buffer, name = '圖片', mimeType, role = 'design', targetId = 'character', jobId, view }) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._target(state, targetId);
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 25 * 1024 * 1024) throw new DomainError('圖片不可為空，且必須小於 25 MB。', 422, 'INVALID_IMAGE_SIZE');
      const actualMime = imageMime(buffer);
      if (!actualMime || (mimeType && actualMime !== mimeType)) throw new DomainError('請提供 PNG、JPEG、WebP 或 GIF 圖片，檔案內容須與格式相符。', 422, 'INVALID_IMAGE');
      if (!['design', 'reference'].includes(role)) throw new DomainError('圖片用途必須是 design 或 reference。', 422, 'INVALID_ASSET_ROLE');
      if (typeof name !== 'string' || name.length > 250) throw new DomainError('圖片名稱過長。', 422, 'ASSET_NAME_TOO_LONG');
      const job = jobId ? state.jobs.find((item) => item.id === jobId) : null;
      if (jobId && !job) throw new DomainError('找不到這次設計工作。', 404, 'JOB_NOT_FOUND');
      if (job && (job.targetId !== targetId || role !== 'design')) throw new DomainError('候選圖片必須與指定工作的部件及用途一致。', 422, 'JOB_TARGET_MISMATCH');
      const assetView = view ?? job?.outputView ?? 'front';
      if (!outputViews.includes(assetView) || (targetId === 'character' && assetView !== 'front')) throw new DomainError('圖片視角不符合角色或部件的允許範圍。', 422, 'INVALID_OUTPUT_VIEW');
      if (job && assetView !== (job.outputView || 'front')) throw new DomainError('候選視角與本次工作不同，請依照工作的輸出視角匯入。', 422, 'ASSET_VIEW_MISMATCH');
      const assetId = uid('asset');
      const filePath = path.join(this.projectDir(id), 'assets', `${assetId}${mimeExtensions[actualMime]}`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer, { flag: 'wx' });
      const asset = { id: assetId, url: `/api/projects/${id}/assets/${assetId}`, name: name.trim() || '圖片', targetId, role, view: assetView, version: state.assets.filter((item) => item.targetId === targetId && item.role === role && item.view === assetView).length + 1, createdAt: now(), mimeType: actualMime, sha256: createHash('sha256').update(buffer).digest('hex') };
      if (job?.outfitId) asset.outfitId = job.outfitId;
      state.assets.push(asset);
      let candidate;
      if (job) {
        candidate = { id: uid('candidate'), assetId, jobId, targetId, view: assetView, ...(job.outfitId ? { outfitId: job.outfitId } : {}), baseRevision: job.baseRevision, status: 'pending', createdAt: now() };
        state.candidates.push(candidate);
        if (job.status !== 'accepted') job.status = 'review';
        job.updatedAt = now();
      }
      if (role === 'reference' && !job) await this._saveMetadata(state);
      else await this._save(state);
      return { asset: clone(asset), ...(candidate ? { candidate: { ...candidate, olderSettings: candidate.baseRevision !== state.character.revision } } : {}), project: this._public(state) };
    });
  }

  // 由 AIDOL Skill 經回收憑證回報的真實進度；不推測、不補假百分比。
  async recordProgress(id, jobId, { event, message } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job) throw new DomainError('找不到這次設計工作。', 404, 'JOB_NOT_FOUND');
      // 已採用其中一張時，其餘幾張可能還在畫：繼續記錄進度，但不改變「已採用」。
      if (job.status === 'cancelled') throw new DomainError('此工作已結束。', 409, 'JOB_ENDED');
      if (!['started', 'finished', 'failed'].includes(event)) throw new DomainError('進度事件必須是 started、finished 或 failed。', 400, 'INVALID_PROGRESS');
      const at = now();
      const note = typeof message === 'string' ? message.slice(0, 500) : undefined;
      job.progress = { ...(job.progress || {}) };
      if (event === 'started') {
        job.progress.startedAt = at;
        delete job.progress.finishedAt;
        delete job.failure;
        if (['prepared', 'queued', 'handed_off', 'failed'].includes(job.status)) job.status = 'running';
      } else if (event === 'finished') {
        job.progress.finishedAt = at;
        if (job.status === 'running') job.status = state.candidates.some((candidate) => candidate.jobId === job.id) ? 'review' : 'handed_off';
      } else {
        job.failure = { at, ...(note ? { message: note } : {}) };
        job.progress.finishedAt = at;
        if (!['review', 'accepted'].includes(job.status)) job.status = 'failed';
      }
      job.updatedAt = at;
      await this._saveMetadata(state);
      return clone(job);
    });
  }

  async readAsset(id, assetId) {
    const state = await this.getProject(id);
    const asset = state.assets.find((item) => item.id === validId(assetId));
    if (!asset) throw new DomainError('找不到這張本機圖片。', 404, 'ASSET_NOT_FOUND');
    return { asset, buffer: await fs.readFile(await this._assetPath(id, asset)) };
  }

  async acceptCandidate(id, candidateId, { baseRevision }) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._cas(state, baseRevision);
      const candidate = state.candidates.find((item) => item.id === candidateId);
      if (!candidate) throw new DomainError('找不到這張候選稿。', 404, 'CANDIDATE_NOT_FOUND');
      // 用較早設定畫的圖照樣可以採用；先前採用過的圖也能換回來。
      if (!['pending', 'accepted'].includes(candidate.status)) throw new DomainError('這張圖目前不能採用。', 409, 'CANDIDATE_CLOSED');
      this._target(state, candidate.targetId);
      const asset = state.assets.find((item) => item.id === candidate.assetId);
      const primary = ['front', 'full'].includes(asset.view);
      if (primary) state.character.adopted[candidate.targetId] = candidate.assetId;
      if (candidate.targetId !== 'character') {
        const component = state.character.components[candidate.targetId];
        component.views = { ...(component.views || {}), [asset.view]: candidate.assetId };
        if (primary) { component.assetId = candidate.assetId; component.designStatus = 'confirmed'; }
        else if (!state.character.adopted[candidate.targetId]) component.designStatus = 'proposed';
        if (state.character.adopted.character) state.syncTargets = [...new Set([...state.syncTargets, 'character'])];
      }
      if (primary) state.syncTargets = state.syncTargets.filter((target) => target !== candidate.targetId);
      this._validateUpdate(state, { character: state.character });
      state.character.revision += 1;
      candidate.status = 'accepted';
      candidate.acceptedAt = now();
      state.jobs.find((job) => job.id === candidate.jobId).status = 'accepted';
      this._history(state, `採用${candidate.targetId === 'character' ? '角色設定稿' : `${state.character.components[candidate.targetId].name}${viewLabels[asset.view]}`}候選`, candidate.targetId === 'character' ? 'sheetAdopted' : 'partAdopted', candidate.targetId === 'character' ? undefined : { name: state.character.components[candidate.targetId].name, view: asset.view });
      await this._save(state);
      return this._public(state);
    });
  }

  async restore(id, { historyId, baseRevision }) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._cas(state, baseRevision);
      const history = state.history.find((item) => item.id === historyId);
      if (!history) throw new DomainError('找不到這個歷史版本。', 404, 'HISTORY_NOT_FOUND');
      const character = clone(history.character);
      character.revision = baseRevision;
      this._validateUpdate(state, { character });
      state.character = { ...character, revision: baseRevision + 1 };
      state.name = character.name;
      state.syncTargets = [...history.syncTargets].filter((target) => character.adopted[target]);
      this._history(state, `恢復第 ${history.revision} 版設定`, 'restored', { revision: history.revision });
      await this._save(state);
      return this._public(state);
    });
  }

  // 匯出在角色鎖裡做：匯出途中角色不會被刪除或搬走。
  async exportProject(id) {
    return this._withProject(id, async () => this._exportProject(id, this._public(await this._read(id))));
  }
  async _exportProject(id, state) {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks = [];
    const completed = new Promise((resolve, reject) => {
      archive.on('data', (chunk) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      archive.on('warning', reject);
    });
    archive.append(characterYaml(state.character), { name: 'character.yaml' });
    const lines = [`# ${state.character.name}`, '', state.character.persona.description, '', '## 辨識特徵', '', ...Object.entries(state.character.identity).map(([key, value]) => `- ${key}：${value}`), '', '## 繪風', '', state.character.style.description, '', '## 部件', '', ...Object.values(state.character.components).map((component) => `- ${component.name}：${component.description}`), '', '## 同步狀態', '', state.syncTargets.length ? `待同步：${state.syncTargets.join('、')}` : '目前採用稿已同步。'];
    archive.append(lines.join('\n'), { name: 'character.md' });
    const scrub = await this._exportScrubber(id, state);
    const manifest = { ...state, assets: [], canvasFile: 'canvas.json', exportedAt: now() };
    const exportedPaths = new Map();
    for (const asset of state.assets) {
      const assetPath = await this._assetPath(id, asset);
      const available = await exists(assetPath);
      const exportedPath = `images/${asset.id}${asset.source === 'demo' ? '.png' : mimeExtensions[asset.mimeType]}`;
      manifest.assets.push({ ...asset, name: scrub(asset.name), ...(available ? { exportedPath } : { missing: true }) });
      if (available) { archive.file(assetPath, { name: exportedPath }); exportedPaths.set(asset.id, exportedPath); }
    }
    const packed = await Promise.all(state.jobs.map((job) => this._portableJob(id, job, exportedPaths, scrub)));
    manifest.jobs = packed.map(({ job }) => job);
    manifest.proposals = state.proposals.map((proposal) => (typeof proposal.summary === 'string' ? { ...proposal, summary: scrub(proposal.summary) } : proposal));
    if (state.decomposition) manifest.decomposition = { ...state.decomposition, ...Object.fromEntries(['error', 'summary'].filter((key) => typeof state.decomposition[key] === 'string').map((key) => [key, scrub(state.decomposition[key])])) };
    const canvasAssetIds = new Set(state.canvasAnnotations.filter(annotation => annotation.kind === 'reference').map(annotation => annotation.assetId));
    const canvas = {
      schemaVersion: 1, projectId: state.id, exportedAt: manifest.exportedAt,
      annotations: state.canvasAnnotations,
      assets: manifest.assets.filter(asset => canvasAssetIds.has(asset.id)).map(({ id, name, mimeType, sha256, exportedPath, missing }) => ({ id, name, mimeType, sha256, ...(exportedPath ? { exportedPath } : { missing: Boolean(missing) }) })),
    };
    archive.append(JSON.stringify(canvas, null, 2), { name: 'canvas.json' });
    for (const { job, instructions } of packed) {
      archive.append(job.context.yaml, { name: `jobs/${job.id}/input.yaml` });
      if (instructions !== null) archive.append(instructions, { name: `jobs/${job.id}/instructions.md` });
      archive.append(JSON.stringify(job, null, 2), { name: `jobs/${job.id}/job.json` });
    }
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    // 打包出錯時 completed 會先失敗、finalize 可能永遠不結束：兩個一起等，任一個失敗就回報。
    const [, buffer] = await Promise.all([archive.finalize(), completed]);
    return { buffer, name: `${state.id}-design-pack.zip` };
  }

  // 要清掉的本機資料夾：目前的專案與資料資料夾，加上工作裡記下的舊位置（資料夾搬過家時）；
  // 交接 token 只在 handoff.json，萬一 Codex 把它寫進訊息也一併遮掉。
  async _exportScrubber(projectId, state) {
    const folders = [this.projectDir(projectId), this.dataDir];
    const secrets = [];
    for (const job of state.jobs) {
      const snapshot = job.context?.snapshotPath;
      const oldProject = typeof snapshot === 'string' ? /^(.*?)[\\/]+jobs[\\/]+[^\\/]+[\\/]+input\.yaml$/.exec(snapshot)?.[1] : null;
      for (const dir of [oldProject, job.handoff?.workspace]) if (typeof dir === 'string' && dir) folders.push(dir, dir.replace(/[\\/]+projects[\\/]+[^\\/]+[\\/]*$/, ''));
      const handoff = await fs.readFile(path.join(this.jobDir(projectId, job.id), 'handoff.json'), 'utf8').then(JSON.parse, () => null);
      if (typeof handoff?.token === 'string') secrets.push(handoff.token);
    }
    return portableTextScrubber({ folders, secrets });
  }

  // 匯出用的工作副本（本機存檔不變）：快照與說明改成包內路徑、參考圖指向包內 images/，
  // 交接只留時間（工作區、codex:// 連結與本機回報網址都不帶出去），Codex 寫的文字清過再放。
  // 說明檔只從這個工作自己的資料夾讀，不跟著存檔裡記的路徑走。
  async _portableJob(projectId, job, exportedPaths, scrub) {
    const portable = clone(job);
    const context = portable.context || (portable.context = {});
    const pack = { snapshot: `jobs/${job.id}/input.yaml`, instructions: `jobs/${job.id}/instructions.md` };
    const rawInstructions = await fs.readFile(path.join(this.jobDir(projectId, job.id), 'instructions.md'), 'utf8').catch(() => null);
    const swaps = [[context.snapshotPath, pack.snapshot], [context.instructionsPath, rawInstructions === null ? '(instructions.md not exported)' : pack.instructions], ...(context.referenceAssets || []).map((asset) => [asset.path, exportedPaths.get(asset.id) || '(missing image)'])]
      .filter(([local]) => typeof local === 'string' && local).sort((a, b) => b[0].length - a[0].length);
    const portableText = (text) => scrub(swaps.reduce((value, [local, packed]) => value.split(local).join(packed), text));
    const instructions = rawInstructions === null ? null : portableText(rawInstructions);
    context.snapshotPath = pack.snapshot;
    if (instructions !== null) context.instructionsPath = pack.instructions; else delete context.instructionsPath;
    if (Array.isArray(context.referenceAssets)) {
      context.referenceAssets = context.referenceAssets.map(({ path: _local, ...asset }) => ({ ...asset, name: scrub(asset.name), ...(exportedPaths.has(asset.id) ? { path: exportedPaths.get(asset.id) } : { missing: true }) }));
    }
    if (Array.isArray(context.styleReferences)) context.styleReferences = context.styleReferences.map((reference) => ({ ...reference, name: scrub(reference.name) }));
    if (typeof portable.handoffPrompt === 'string') portable.handoffPrompt = portableText(portable.handoffPrompt);
    if (typeof portable.failure?.message === 'string') portable.failure.message = scrub(portable.failure.message);
    if (portable.handoff) portable.handoff = portable.handoff.createdAt ? { createdAt: portable.handoff.createdAt } : {};
    return { job: portable, instructions };
  }
}
