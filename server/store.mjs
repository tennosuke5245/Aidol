import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { ZipArchive } from 'archiver';
import { DomainError, idPattern, outputViews, viewLabels, turnaroundViews, allViews, extraViews, turnaroundLabels, viewSpecs, isAngleView, validateCharacter, parseCharacterYaml, characterYaml, newCharacter, demoCharacter } from '../shared/domain.mjs';
import { isOutfitVariant, mainOutfitId, outfitPortraitId, outfitRemoved, restoreOutfit } from '../shared/wardrobe.mjs';
import { EXPRESSION_LIMIT, customExpressionKey, expressionFront, expressionInfo, expressionList, expressionStale, framingReference } from '../shared/expressions.mjs';
import { validateCanvasAnnotationInput, canvasAnnotationDefaults } from '../shared/canvas-annotations.mjs';
import { compileBrief } from '../shared/prompt-compiler.mjs';
import { canonChanges } from '../shared/canon.mjs';
import { FRONT_SPEC, FRONT_SPEC_BODY, TURNAROUND_SPEC, normalizeViewBoxes, viewNotesText, bodyRect, toBodyPoint, toImagePoint, NOTE_LIMIT, NOTE_TEXT_MAX, NOTE_TITLE_MAX } from '../shared/turnaround.mjs';

const referenceRoleLabels = { style: '繪風參考', identity: '角色特徵參考', color: '配色參考', clothing: '服裝結構參考', material: '材質參考', composition: '構圖參考' };
import { looksChanged, mergeCharacter } from '../shared/character-diff.mjs';
import { jobPresentation, workspaceSummary } from '../shared/agent-workspace.mjs';
import { framings, variantCounts, expressionPresets } from '../shared/libraries.mjs';

// 從圖來的版本（採用、改成正式立繪、拆解裝備、匯入正式三視圖）：不是使用者改設定，畫好的圖「用較早的設定畫的」不看這些。
// 還沒送出的繪製比較嚴：採用、匯入換了它要附的圖，只有拆解裝備不算（參考圖凍結在準備的那一刻）。
const imageSteps = new Set(['sheetAdopted', 'partAdopted', 'decomposeAdded', 'decomposeMoved', 'sheetImported']);
const decomposeSteps = new Set(['decomposeAdded', 'decomposeMoved']);
const swapSteps = new Set(['sheetAdopted', 'partAdopted', 'sheetImported']);
const forImages = { skip: imageSteps, counts: new Set() };
const forJobs = { skip: decomposeSteps, counts: swapSteps, swaps: true };
// 2026-10-09 以前的存檔紀錄沒有 messageKey，照固定句型認出是哪一種（和 src/history-legacy.js 同一套）。
const legacySteps = [[/^採用角色設定稿候選$/, 'sheetAdopted'], [/^採用.+?(正面主圖|完整主圖|背面|細節)候選$/, 'partAdopted'], [/^AI 拆解裝備：新增 \d+ 件$/, 'decomposeAdded'], [/^AI 拆解裝備：更新位置$/, 'decomposeMoved'], [/^匯入正式三視圖$/, 'sheetImported']];
// 畫面狀態的名稱：種類（小寫英文與 -）或「種類:代號」。
const uiStateKey = /^[a-z][a-z0-9-]{0,40}(?::[A-Za-z0-9_.-]{1,120})?$/;
const stepKey = (entry) => entry.messageKey || legacySteps.find(([pattern]) => pattern.test(entry.message || ''))?.[1] || null;
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
const drawModes = ['aidol', 'codex-app'];
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
    // 正在背景找三視圖的角色（核心重開後就不在這裡，畫面會看到「中斷了，可以再試一次」）。
    this.detectingViews = new Set();
    // 「AIDOL 直接畫」正在畫的工作、Design QA 正在審的工作、正在跑的全自動（核心重開後就不在這裡）。
    this.drawingJobs = new Set();
    this.reviewingJobs = new Set();
    this.autopilots = new Set();
    this.lookSteps = new Map(); // 「這一版有沒有改到長相」（_olderSettings 用）
    this.uiStateQueue = Promise.resolve(); // 畫面狀態一次寫一個（拖節點時會連續送）
    this.folderReleaser = null;
    this.moveAttempts = 6; // 資料夾被佔用時，一輪搬移最多試幾次（約兩秒）。
    this.ready = null;
  }

  projectDir(id) { return path.join(this.dataDir, 'projects', validId(id)); }
  jobDir(projectId, jobId) { return path.join(this.projectDir(projectId), 'jobs', validId(jobId)); }

  // 這台電腦的介面偏好（目前只有語言）。桌面版每次啟動的本機網址 port 都不同，瀏覽器的儲存會跟著換，
  // 所以語言要記在資料資料夾裡，換 port 也記得。
  // 還沒選過語言、但已經有自己建立的角色：是語系功能之前的安裝，那時介面只有繁中，預設維持繁中（inferred）。
  // 偏好只認得的欄位：locale（介面語言）、drawWith（畫圖方式：aidol＝AIDOL 直接畫、codex-app＝交給 Codex App）。
  async _savedPreferences() {
    const saved = await fs.readFile(path.join(this.dataDir, 'preferences.json'), 'utf8').then(JSON.parse, () => ({}));
    return { ...(preferenceLocales.includes(saved?.locale) ? { locale: saved.locale } : {}), ...(drawModes.includes(saved?.drawWith) ? { drawWith: saved.drawWith } : {}) };
  }
  async getPreferences() {
    const saved = await this._savedPreferences();
    if (saved.locale) return saved;
    const folders = await fs.readdir(path.join(this.dataDir, 'projects'), { withFileTypes: true }).catch(() => []);
    const ownProjects = folders.some((folder) => folder.isDirectory() && folder.name !== 'rin' && new RegExp(idPattern).test(folder.name));
    return ownProjects ? { ...saved, locale: 'zh-TW', inferred: true } : saved;
  }
  async savePreferences(input = {}) {
    const hasLocale = input.locale !== undefined;
    const hasDraw = input.drawWith !== undefined;
    if (!hasDraw && !preferenceLocales.includes(input.locale)) throw new DomainError('不支援這個介面語言。', 422, 'INVALID_LOCALE');
    if (hasLocale && !preferenceLocales.includes(input.locale)) throw new DomainError('不支援這個介面語言。', 422, 'INVALID_LOCALE');
    if (hasDraw && !drawModes.includes(input.drawWith)) throw new DomainError('不支援這種畫圖方式。', 422, 'INVALID_DRAW_MODE');
    const next = { ...(await this._savedPreferences()), ...(hasLocale ? { locale: input.locale } : {}), ...(hasDraw ? { drawWith: input.drawWith } : {}) };
    await fs.mkdir(this.dataDir, { recursive: true });
    await atomic(path.join(this.dataDir, 'preferences.json'), JSON.stringify(next, null, 2));
    return next;
  }

  // 畫面狀態（2026-10-14 起）：畫布節點位置、並排看的參考線、捏角色的偏好、上次打開的角色。
  // 桌面版每次啟動的連接埠不同，瀏覽器儲存跟著網址走、每次都會不見，所以存在資料夾裡的 ui-state.json（不進角色版本）。
  // 名稱：「種類」或「種類:代號」（例如 pref:variants、layout:<角色 ID>）；值是 JSON，null＝刪掉。
  _uiStatePath() { return path.join(this.dataDir, 'ui-state.json'); }
  // 讀不到、或檔案壞了（例如寫到一半斷電）：當成空的，下次存的時候重寫一份完整的，不會從此再也存不了。
  async _readUiState() {
    const saved = await fs.readFile(this._uiStatePath(), 'utf8').then((text) => { try { return JSON.parse(text); } catch { return null; } }, () => null);
    const values = saved?.values;
    return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  }
  async getUiState() { await this.init(); return { values: await this._readUiState() }; }
  async updateUiState(input = {}, { prune } = {}) {
    await this.init();
    const changes = input?.values;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new DomainError('畫面狀態的格式不正確。', 422, 'INVALID_UI_STATE');
    const entries = Object.entries(changes);
    if (entries.length > 200) throw new DomainError('一次改的畫面狀態太多。', 422, 'INVALID_UI_STATE');
    for (const [key, value] of entries) {
      if (!uiStateKey.test(key)) throw new DomainError('畫面狀態的名稱不正確。', 422, 'INVALID_UI_STATE');
      if (value !== null && JSON.stringify(value).length > 64 * 1024) throw new DomainError('畫面狀態太大。', 413, 'UI_STATE_TOO_LARGE');
    }
    const run = this.uiStateQueue.then(async () => {
      const values = await this._readUiState();
      for (const [key, value] of entries) { if (value === null) delete values[key]; else values[key] = value; }
      if (prune) for (const key of Object.keys(values)) if (prune(key)) delete values[key];
      const text = JSON.stringify({ version: 1, values });
      if (text.length > 2 * 1024 * 1024) throw new DomainError('畫面狀態太大。', 413, 'UI_STATE_TOO_LARGE');
      await fs.mkdir(this.dataDir, { recursive: true });
      await atomic(this._uiStatePath(), text);
      return { updated: entries.length };
    });
    this.uiStateQueue = run.catch(() => {});
    return run;
  }

  // 刪除角色＝把整個角色資料夾移到 <資料夾>/trash/，不直接刪檔：刪除後可以馬上復原，也能從角色選單的「資源回收區」找回。
  // 刪除、復原都在角色鎖裡做；其他會寫進角色資料夾的地方也要先確認角色還在（withProjectFolder），免得刪除時留下半個資料夾。
  trashDir(trashId) { return path.join(this.dataDir, 'trash', validTrashId(trashId)); }
  async withProjectFolder(id, action) {
    return this._withProject(id, async () => { await this._read(id); return action(this.projectDir(id)); });
  }
  markDecomposing(id, running) { if (running) this.decomposing.add(id); else this.decomposing.delete(id); }
  markDrawing(jobId, running) { if (running) this.drawingJobs.add(jobId); else this.drawingJobs.delete(jobId); }
  markReviewing(jobId, running) { if (running) this.reviewingJobs.add(jobId); else this.reviewingJobs.delete(jobId); }
  markAutopilot(id, running) { if (running) this.autopilots.add(id); else this.autopilots.delete(id); }
  // 全自動的狀態（project.json 的 autopilot，不進版本）：updater 拿到目前的狀態，回傳新的狀態。
  async saveAutopilot(id, updater) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      state.autopilot = updater(state.autopilot ? clone(state.autopilot) : null);
      await this._saveMetadata(state);
      return this._public(state);
    });
  }
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
      for (const key of this.lookSteps.keys()) if (key.startsWith(`${id}:`)) this.lookSteps.delete(key);
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
    // 這個角色已經完全不在了（沒有復原回去、資源回收區也沒有別份）：它的畫面狀態（節點位置、參考線）一起清掉。
    // 清不掉也不影響刪除本身（檔案已經刪了）。
    try {
      const others = await fs.readdir(path.join(this.dataDir, 'trash')).catch(() => []);
      const elsewhere = await exists(path.join(this.projectDir(info.id), 'project.json')) || others.some((name) => name.startsWith(`${info.id}--`));
      if (!elsewhere) await this.updateUiState({ values: {} }, { prune: (key) => key.endsWith(`:${info.id}`) });
    } catch { /* 留著幾筆用不到的節點位置沒關係 */ }
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
    if (result.views?.status === 'detecting' && !this.detectingViews.has(state.id)) result.views = { ...result.views, status: 'failed', error: '找三視圖中斷了（核心重新啟動過），可以再試一次。', errorCode: 'VIEWS_INTERRUPTED' };
    // 「AIDOL 直接畫」與 Design QA 在核心裡跑：核心重開過，紀錄上還在跑的其實已經停了。
    result.jobs = result.jobs.map((job) => {
      let shown = job;
      // 畫到一半（可能已經回來幾張、工作已是 review）時核心重開：補上結束時間，畫面才不會一直停在「繪製中」。
      if (job.runner === 'auto' && job.progress?.startedAt && !job.progress.finishedAt && !this.drawingJobs.has(job.id)) {
        const failure = { at: job.updatedAt || job.createdAt, message: '畫圖中斷了（核心重新啟動過），可以再畫一次。', code: 'DRAW_INTERRUPTED' };
        shown = job.status === 'running' ? { ...shown, status: 'failed', failure } : { ...shown, progress: { ...job.progress, finishedAt: failure.at }, failure };
      }
      if (job.review?.status === 'running' && !this.reviewingJobs.has(job.id)) shown = { ...shown, review: { ...job.review, status: 'failed', error: 'Design QA 中斷了（核心重新啟動過），可以再審一次。', errorCode: 'REVIEW_INTERRUPTED' } };
      return shown;
    });
    if (result.autopilot?.status === 'running' && !this.autopilots.has(state.id)) result.autopilot = { ...result.autopilot, status: 'interrupted' };
    // 2026-10-07 起畫好的圖不論用哪一版設定都可採用；olderSettings 只是提示「用較早設定畫的」：
    // 2026-10-14 起只有之後真的改過會影響長相的設定才算（採用、拆解裝備多存的版本不算）。
    const imageLook = this._lastLookRevision(state, forImages), jobLook = this._lastLookRevision(state, forJobs);
    result.candidates = result.candidates.map((candidate) => ({ ...candidate, olderSettings: this._olderSettings(state, candidate.baseRevision, imageLook) }));
    // 已經有圖回來的工作照畫好的圖的規則；還沒送出的照比較嚴的規則。
    result.jobs = result.jobs.map((job) => ({ ...job, olderSettings: this._olderSettings(state, job.baseRevision, ['review', 'accepted'].includes(job.status) ? imageLook : jobLook) }));
    // 標註存的是人物範圍裡的位置；畫面要的是在目前那張角度圖上的位置。
    if (result.viewNotes) result.viewNotes = result.viewNotes.map((note) => ({ ...note, ...toImagePoint(note, bodyRect(result.views, note.view)) }));
    result.proposals = result.proposals.map((proposal) => ({ ...proposal, olderSettings: proposal.baseRevision !== state.character.revision }));
    return result;
  }

  // 最後一次「改到長相」的版本（存檔紀錄缺了版本也算）：比這一版早的都是用較早的設定畫的。
  // 從最新的存檔往回找到第一個就停；每一版的判斷記在記憶體裡（存檔紀錄只會往後加，不會改）。
  // skip：不算的那幾種版本；counts：一定算的（還沒送出的繪製：換了正式立繪就是舊的）。
  // swaps：正式立繪這類採用的圖換過也算（恢復存檔、改 YAML 換了正式立繪，不一定是採用那一步）。
  _lastLookRevision(state, { skip, counts, swaps = false }) {
    const history = state.history || [];
    const current = state.character.revision;
    if (!history.length || history.at(-1).revision !== current) return current;
    for (let index = history.length - 1; index > 0; index -= 1) {
      const entry = history[index], previous = history[index - 1];
      if (entry.revision !== previous.revision + 1) return entry.revision;
      const step = stepKey(entry);
      if (counts.has(step)) return entry.revision;
      if (swaps && JSON.stringify(entry.character?.adopted || {}) !== JSON.stringify(previous.character?.adopted || {})) return entry.revision;
      if (skip.has(step)) continue;
      const key = `${state.id}:${entry.id}`;
      if (!this.lookSteps.has(key)) this.lookSteps.set(key, looksChanged(previous.character, entry.character));
      if (this.lookSteps.get(key)) return entry.revision;
    }
    return history[0].revision > 1 ? history[0].revision : 0;
  }

  // 從那一版到現在，使用者有沒有改過會影響長相的設定（lastLook：_lastLookRevision 的結果）。
  _olderSettings(state, baseRevision, lastLook = this._lastLookRevision(state, forImages)) {
    if (!Number.isInteger(baseRevision) || baseRevision === state.character.revision) return false;
    return baseRevision > state.character.revision || baseRevision < lastLook;
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

  // mainOutfit：正式立繪那套（衣裝差分）：只有這套改了才算正式立繪要重畫；改別套只影響衣櫃裡那套的立繪。
  _changedTargets(before, after, mainOutfit = null) {
    const changed = new Set();
    if (JSON.stringify(before.identity) !== JSON.stringify(after.identity) || JSON.stringify(before.style) !== JSON.stringify(after.style)) Object.keys(after.adopted).forEach((target) => changed.add(target));
    const outfits = (character) => JSON.stringify(mainOutfit ? character.outfits?.[mainOutfit] ?? null : character.outfits);
    if (outfits(before) !== outfits(after)) changed.add('character');
    // 裝備改了：正式立繪那套有穿（改之前或之後）才算正式立繪要重畫；只有別套穿的，只影響那套的立繪。
    const wornByMain = (character, partId) => !mainOutfit || Boolean(character.outfits?.[mainOutfit]?.equipped?.some((item) => item.componentId === partId && item.enabled));
    // 裁切位置與草案狀態只是整理資訊，不代表外觀改了。
    const looks = (component) => component && JSON.stringify({ ...component, crop: undefined, designStatus: undefined });
    for (const [id, component] of Object.entries(after.components)) {
      if (looks(before.components[id]) !== looks(component)) { changed.add(id); if (wornByMain(before, id) || wornByMain(after, id)) changed.add('character'); }
    }
    for (const id of Object.keys(before.components)) if (!after.components[id] && wornByMain(before, id)) changed.add('character');
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
      // 套裝刪掉了的工作也要看（裝備的圖不分穿搭，照樣等你挑；那套的立繪工作已經當成結束，不會列出來）。
      const outfitIds = [...new Set([...Object.keys(character.outfits), ...project.jobs.map((job) => job.outfitId).filter((outfitId) => typeof outfitId === 'string' && outfitId)])];
      const attention = outfitIds.flatMap((outfitId) => workspaceSummary(project, outfitId).attentionJobs.map((job) => {
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
      if (asset.targetId !== target || ['reference', 'view'].includes(asset.role)) throw new DomainError('採用稿必須是相同部位的設計圖片。', 422, 'ASSET_TARGET_MISMATCH');
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
      // 直接改設定換正式立繪（例如 YAML）：照已經刪掉的套裝畫的那張也不行（和採用候選同一條規則）。
      const main = character.adopted.character;
      const mainOutfit = main && main !== state.character.adopted.character ? state.assets.find((item) => item.id === main)?.outfitId : null;
      if (mainOutfit && !Object.hasOwn(character.outfits, mainOutfit)) throw new DomainError('這套穿搭已經刪掉了，這張不能採用。要用的話，先在圖鑑放大這張，按「復原套裝」。', 409, 'OUTFIT_REMOVED');
      const kept = this._keepMainOutfit(state, character);
      state.syncTargets = [...new Set([...state.syncTargets, ...this._changedTargets(state.character, character, state.character.adopted.character ? mainOutfitId(state) : null)])].filter((target) => character.adopted[target]);
      state.character = { ...character, schema_version: 2, revision: state.character.revision + 1 };
      state.name = character.name;
      this._history(state, '更新人物設定', 'settingsUpdated');
      await this._save(state);
      // notice：這次存檔核心自己改了什麼（畫面提示一次，不存進角色）。
      return kept ? { ...this._public(state), notice: 'MAIN_OUTFIT_KEPT' } : this._public(state);
    });
  }

  // 正式立繪那套不能刪：這次存檔（Ctrl＋Z 退到新增那套之前、重做、AI 提案、YAML）拿掉了它，就照原本的放回原位。
  // 不然正式立繪的衣服對不上任何一套，三視圖、表情集、全自動都會照錯的那套畫。這次同時換了正式立繪時照這次的。
  // 「主要那套」和畫面一樣用 mainOutfitId（正式立繪沒記穿搭時是第一套，例如範例角色、匯入的圖）。
  _keepMainOutfit(state, character) {
    const main = state.character.adopted.character;
    const outfitId = main ? mainOutfitId(state) : null;
    if (!outfitId || character.adopted.character !== main || Object.hasOwn(character.outfits, outfitId)) return false;
    if (!restoreOutfit(character, outfitId, state.character.outfits[outfitId], Object.keys(state.character.outfits).indexOf(outfitId))) return false;
    validateCharacter(character, state.assets.map((asset) => asset.id));
    return true;
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
      const kept = this._keepMainOutfit(state, character);
      state.syncTargets = [...new Set([...state.syncTargets, ...this._changedTargets(state.character, character, state.character.adopted.character ? mainOutfitId(state) : null)])].filter((target) => character.adopted[target]);
      state.character = { ...character, schema_version: 2, revision: baseRevision + 1 };
      state.name = character.name;
      proposal.status = 'accepted';
      proposal.acceptedAt = now();
      this._history(state, '採用人物設定提案', 'proposalAccepted');
      await this._save(state);
      return kept ? { ...this._public(state), notice: 'MAIN_OUTFIT_KEPT' } : this._public(state);
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
      if (!asset || asset.targetId !== 'character' || asset.role !== 'design' || asset.view !== 'front') throw new DomainError('要先有正式立繪，才能拆解裝備。', 409, 'NO_PORTRAIT');
      const current = state.decomposition;
      if (current?.status === 'running' && current.assetId === asset.id && Date.now() - Date.parse(current.startedAt) < 10 * 60 * 1000) return { project: this._public(state), asset, path: await this._assetPath(id, asset), skipped: true };
      state.decomposition = { status: 'running', assetId: asset.id, auto: Boolean(auto), startedAt: now() };
      await this._saveMetadata(state);
      return { project: this._public(state), asset, path: await this._assetPath(id, asset) };
    });
  }

  async finishDecomposition(id, { assetId, parts = [], views = [], summary = '', threadId = null } = {}) {
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
      // 三視圖：AI 找到兩個以上的角度才拆（只有一個人就不是三視圖）。同一張圖已經拆好（自動或手動調過）就不重拆。
      // 只有一個人、AI 說是正面，而且這張是用全身取景畫的（全身、正面全身）：直接當正面，接著就能補畫其他角度，不用再按「當正面」。
      const boxes = normalizeViewBoxes(views);
      const candidate = state.candidates.find((item) => item.assetId === assetId);
      const sourceJob = candidate && state.jobs.find((job) => job.id === candidate.jobId);
      const singleFront = boxes.length === 1 && boxes[0].view === 'front' && ['full', 'frontView'].includes(sourceJob?.framing);
      // 已經在拆或拆好（例如分開畫的正面，採用時就直接拆了）就不動。
      if (!(state.views?.assetId === assetId && ['boxes', 'done'].includes(state.views.status))) {
        // 正面全身的規格是素色背景，整張當正面；一般全身可能有背景，照 AI 的框（四周多留一點）裁。
        const pad = (box) => { const x = Math.max(0, box.x - 0.03), y = Math.max(0, box.y - 0.03); return { view: 'front', x, y, width: Math.min(1, box.x + box.width + 0.03) - x, height: Math.min(1, box.y + box.height + 0.03) - y }; };
        state.views = singleFront ? { ...this._frontOnlyViews(assetId), ...(sourceJob.framing === 'full' ? { boxes: [pad(boxes[0])] } : {}), updatedAt: finishedAt } : { assetId, status: boxes.length >= 2 ? 'boxes' : 'none', boxes, items: {}, updatedAt: finishedAt };
      }
      if (added || updated) await this._save(state); else await this._saveMetadata(state);
      return this._public(state);
    });
  }

  // 三視圖拆好的三張：畫面依 AI 給的位置（或使用者手動調的框）裁好 PNG 送回來，這裡存成新的圖片（不覆寫原圖）。
  // 只接受目前正式三視圖的裁切；期間換了正式圖就不存（避免拿舊圖的裁切蓋到新圖上）。
  // manual：使用者在「調整裁切」裡框的；boxes 是那些框，下次打開調整時從這裡開始。
  async saveViews(id, { assetId, manual = false, boxes, items = [] } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      if (!assetId || assetId !== state.character.adopted.character) throw new DomainError('正式三視圖已經換過了，這次的裁切沒有存。', 409, 'VIEWS_STALE');
      // 自動拆分只做一次（例如同時開著兩個視窗）；要重拆請用手動調整。
      if (!manual && state.views?.assetId === assetId && state.views.status === 'done') return this._public(state);
      const unit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
      const box = (value) => value && typeof value === 'object' && ['x', 'y', 'width', 'height'].every((key) => unit(value[key])) && value.width > 0 && value.height > 0 && value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001;
      // frame：裁好的圖對應到原圖的範圍；左右補了背景色時會超出圖片一點。
      const frame = (value) => value && typeof value === 'object' && ['x', 'y', 'width', 'height'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key])) && value.x >= -1 && value.y >= -1 && value.width > 0 && value.height > 0 && value.x + value.width <= 2 && value.y + value.height <= 2;
      const seen = new Set();
      if (!Array.isArray(items) || !items.length || items.length > turnaroundViews.length) throw new DomainError('三視圖的裁切資料不正確。', 422, 'INVALID_VIEWS');
      for (const item of items) {
        if (!turnaroundViews.includes(item?.view) || seen.has(item.view) || !box(item.crop) || (item.figure !== undefined && !box(item.figure)) || (item.frame !== undefined && !frame(item.frame))) throw new DomainError('三視圖的裁切資料不正確。', 422, 'INVALID_VIEWS');
        if (!Buffer.isBuffer(item.buffer) || !item.buffer.length || item.buffer.length > 25 * 1024 * 1024 || imageMime(item.buffer) !== 'image/png') throw new DomainError('三視圖的裁切圖必須是 PNG。', 422, 'INVALID_IMAGE');
        seen.add(item.view);
      }
      const createdAt = now();
      const saved = {};
      const written = [];
      try {
        for (const item of items) {
          const viewAssetId = uid('view');
          const filePath = path.join(this.projectDir(id), 'assets', `${viewAssetId}.png`);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, item.buffer, { flag: 'wx' });
          written.push(filePath);
          state.assets.push({ id: viewAssetId, url: `/api/projects/${id}/assets/${viewAssetId}`, name: turnaroundLabels[item.view], targetId: 'character', role: 'view', view: item.view, fromAssetId: assetId, createdAt, mimeType: 'image/png', sha256: createHash('sha256').update(item.buffer).digest('hex') });
          const pick = (value) => value && { x: value.x, y: value.y, width: value.width, height: value.height };
          saved[item.view] = { assetId: viewAssetId, crop: pick(item.crop), ...(item.frame ? { frame: pick(item.frame) } : {}), ...(item.figure ? { figure: pick(item.figure) } : {}) };
        }
        // 手動調整時，使用者拿掉的角度就不留；自動拆分沿用同一張圖已經拆好的其他角度。
        const same = state.views?.assetId === assetId;
        // 手動重裁時留下的重畫角度改回交回來的原圖，畫面會照新的大小再調一次。
      const keep = same ? Object.fromEntries(Object.entries(state.views.items || {}).filter(([, item]) => !manual || item.redrawn).map(([view, item]) => [view, manual && item.redrawn ? { assetId: item.sourceAssetId, sourceAssetId: item.sourceAssetId, redrawn: true } : item])) : {};
        const manualBoxes = manual ? normalizeViewBoxes(boxes) : [];
        // 重新裁切後，同一張三視圖舊的裁切圖就用不到了（可以隨時從原圖再裁），從角色裡移除，不讓它們一直累積。
        const nextItems = { ...keep, ...saved };
        const inUse = new Set(Object.values(nextItems).map((item) => item.assetId));
        const replaced = same ? Object.values(state.views.items || {}).map((item) => item.assetId).filter((viewId) => !inUse.has(viewId)) : [];
        const replacedAssets = state.assets.filter((asset) => replaced.includes(asset.id) && asset.role === 'view' && !this._usedByOpenJobs(state, asset.id));
        state.assets = state.assets.filter((asset) => !replacedAssets.includes(asset));
        state.views = { assetId, status: 'done', boxes: manualBoxes.length ? manualBoxes : same ? state.views.boxes || [] : [], items: nextItems, ...(same && state.views.extra?.length ? { extra: state.views.extra } : {}), manual: Boolean(manual || (same && state.views.manual)), updatedAt: createdAt };
        await this._saveMetadata(state);
        for (const asset of replacedAssets) await fs.rm(await this._assetPath(id, asset), { force: true }).catch(() => {});
      } catch (error) {
        // 寫到一半失敗：剛寫的圖檔不留在資料夾裡。
        for (const filePath of written) await fs.rm(filePath, { force: true }).catch(() => {});
        throw error;
      }
      return this._public(state);
    });
  }

  // 重畫的角度採用後，畫面把它調成和其他兩張一樣的大小、身高與腳底位置，存成新的圖（交回來的原圖留在圖鑑）。
  async saveNormalizedView(id, { view, sourceAssetId, buffer } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const views = state.views;
      const item = views?.items?.[view];
      if (!(views?.status === 'done' && views.assetId === state.character.adopted.character) || !item?.redrawn || item.sourceAssetId !== sourceAssetId) throw new DomainError('三視圖已經換過了，這次的調整沒有存。', 409, 'VIEWS_STALE');
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 25 * 1024 * 1024 || imageMime(buffer) !== 'image/png') throw new DomainError('三視圖的裁切圖必須是 PNG。', 422, 'INVALID_IMAGE');
      if (item.assetId !== item.sourceAssetId) return this._public(state);
      const viewAssetId = uid('view');
      const filePath = path.join(this.projectDir(id), 'assets', `${viewAssetId}.png`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer, { flag: 'wx' });
      try {
        state.assets.push({ id: viewAssetId, url: `/api/projects/${id}/assets/${viewAssetId}`, name: turnaroundLabels[view], targetId: 'character', role: 'view', view, fromAssetId: sourceAssetId, createdAt: now(), mimeType: 'image/png', sha256: createHash('sha256').update(buffer).digest('hex') });
        views.items = { ...views.items, [view]: { assetId: viewAssetId, sourceAssetId, redrawn: true, normalized: true } };
        views.updatedAt = now();
        await this._saveMetadata(state);
      } catch (error) {
        await fs.rm(filePath, { force: true }).catch(() => {});
        throw error;
      }
      return this._public(state);
    });
  }

  // 已經有三視圖（或任何一張正式圖）：不用畫，直接當正式立繪。來源是上傳的圖，或角色已有的參考圖（例如建立時附上的定稿）；
  // 都另存一份新的設計圖，原圖不動。採用後和畫好的一樣會自動拆解、找三視圖。
  async importMainImage(id, { buffer, mimeType, name = '匯入的三視圖', fromAssetId, outfitId, baseRevision } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._cas(state, baseRevision);
      let content = buffer, label = name;
      if (fromAssetId) {
        const source = state.assets.find((item) => item.id === fromAssetId);
        if (!source || source.role !== 'reference') throw new DomainError('找不到這張參考圖。', 404, 'ASSET_NOT_FOUND');
        content = await fs.readFile(await this._assetPath(id, source));
        label = source.name;
      }
      if (!Buffer.isBuffer(content) || !content.length || content.length > 25 * 1024 * 1024) throw new DomainError('圖片不可為空，且必須小於 25 MB。', 422, 'INVALID_IMAGE_SIZE');
      const actualMime = imageMime(content);
      if (!actualMime || (mimeType && !fromAssetId && actualMime !== mimeType)) throw new DomainError('請提供 PNG、JPEG、WebP 或 GIF 圖片，檔案內容須與格式相符。', 422, 'INVALID_IMAGE');
      if (typeof label !== 'string' || label.length > 250) throw new DomainError('圖片名稱過長。', 422, 'ASSET_NAME_TOO_LONG');
      if (outfitId !== undefined && (typeof outfitId !== 'string' || !Object.hasOwn(state.character.outfits, outfitId))) throw new DomainError('找不到這次指定的穿搭。', 422, 'UNKNOWN_OUTFIT');
      const assetId = uid('asset');
      const filePath = path.join(this.projectDir(id), 'assets', `${assetId}${mimeExtensions[actualMime]}`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, { flag: 'wx' });
      try {
        const asset = { id: assetId, url: `/api/projects/${id}/assets/${assetId}`, name: label.trim() || '圖片', targetId: 'character', role: 'design', view: 'front', version: state.assets.filter((item) => item.targetId === 'character' && item.role === 'design' && item.view === 'front').length + 1, createdAt: now(), mimeType: actualMime, sha256: createHash('sha256').update(content).digest('hex'), imported: true, ...(outfitId ? { outfitId } : {}) };
        state.assets.push(asset);
        const previousMain = state.character.adopted.character;
        state.character.adopted.character = assetId;
        this._keepDisplacedMain(state, previousMain);
        state.syncTargets = state.syncTargets.filter((target) => target !== 'character');
        this._validateUpdate(state, { character: state.character });
        state.character.revision += 1;
        this._history(state, '匯入正式三視圖', 'sheetImported');
        await this._save(state);
        return { project: this._public(state), asset: clone(asset) };
      } catch (error) {
        await fs.rm(filePath, { force: true }).catch(() => {});
        throw error;
      }
    });
  }

  // 還沒結束的工作附了這張圖（例如已經交給 Codex、還沒畫完）：先留著，免得它讀不到要照著畫的圖。
  _usedByOpenJobs(state, assetId) {
    return state.jobs.some((job) => !['accepted', 'cancelled'].includes(job.status) && (job.context?.referenceAssets || []).some((asset) => asset.id === assetId));
  }

  _frontOnlyViews(assetId) {
    return { assetId, status: 'boxes', boxes: [{ view: 'front', x: 0, y: 0, width: 1, height: 1 }], items: {}, single: true, updatedAt: now() };
  }

  // ── 加角度 ──
  // 三視圖以外的角度（斜前方、斜後方、另一側）：先放一個空位，之後照正面畫。只有拆好正面才能加。
  async addExtraView(id, { view } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      if (!extraViews.includes(view)) throw new DomainError('不支援這個角度。', 422, 'INVALID_OUTPUT_VIEW');
      const views = state.views;
      if (!(views?.status === 'done' && views.assetId === state.character.adopted.character && views.items?.front)) throw new DomainError('要先有拆好的正面，才能畫側面或背面。', 409, 'VIEWS_NOT_READY');
      if (!(views.extra || []).includes(view)) views.extra = allViews.filter((item) => item === view || (views.extra || []).includes(item));
      views.updatedAt = now();
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  // 拿掉加的角度：空位、畫好的那張與標在上面的標註都從三視圖拿掉（交回來的原圖留在圖鑑）。三視圖的基本三個角度不能拿掉。
  async removeExtraView(id, view) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      if (!extraViews.includes(view)) throw new DomainError('不支援這個角度。', 422, 'INVALID_OUTPUT_VIEW');
      const views = state.views;
      if (!views) return this._public(state);
      const item = views.items?.[view];
      const removed = item && item.assetId !== item.sourceAssetId ? state.assets.find((asset) => asset.id === item.assetId && asset.role === 'view' && !this._usedByOpenJobs(state, asset.id)) : null;
      views.extra = (views.extra || []).filter((item) => item !== view);
      if (item) { const { [view]: _, ...rest } = views.items; views.items = rest; }
      // 標在這個角度上的標註一起拿掉（畫面上確認時會先說有幾個）。
      state.viewNotes = (state.viewNotes || []).filter((note) => note.view !== view);
      if (removed) state.assets = state.assets.filter((asset) => asset !== removed);
      views.updatedAt = now();
      await this._saveMetadata(state);
      if (removed) await fs.rm(await this._assetPath(id, removed), { force: true }).catch(() => {});
      return this._public(state);
    });
  }

  // ── 衣櫃 ──
  // 某套穿搭的一張立繪要換成正式立繪：原本的正式立繪放進它那套的衣櫃（不會不見），這套的衣櫃空出來。
  _moveMainToWardrobe(state, outfitId) {
    const items = { ...(state.wardrobe?.items || {}) };
    const previousOutfit = mainOutfitId(state);
    delete items[outfitId];
    if (previousOutfit && previousOutfit !== outfitId && state.character.adopted.character) items[previousOutfit] = { assetId: state.character.adopted.character, at: now() };
    state.wardrobe = { ...(state.wardrobe || {}), items };
  }

  // 正式立繪換掉了（恢復存檔等）：被換下來的那張如果是另一套穿搭的，而那套衣櫃是空的，就放回去。
  _keepDisplacedMain(state, previousMain) {
    const current = state.character.adopted.character;
    if (!previousMain || previousMain === current) return;
    const asset = state.assets.find((item) => item.id === previousMain);
    if (!asset?.outfitId || !isOutfitVariant(state, asset.outfitId) || outfitPortraitId(state, asset.outfitId)) return;
    state.wardrobe = { ...(state.wardrobe || {}), items: { ...(state.wardrobe?.items || {}), [asset.outfitId]: { assetId: previousMain, at: now() } } };
  }

  // 把另一套穿搭現在的立繪設成正式立繪（衣櫃裡的「改成正式立繪」；匯入的立繪沒有候選也可以）。
  async promoteOutfit(id, outfitId, { baseRevision } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._cas(state, baseRevision);
      if (!isOutfitVariant(state, outfitId)) throw new DomainError('這套穿搭已經是正式立繪那套，或找不到這套穿搭。', 409, 'OUTFIT_NOT_VARIANT');
      const assetId = outfitPortraitId(state, outfitId);
      if (!assetId) throw new DomainError('這套穿搭還沒有立繪。', 409, 'OUTFIT_NO_PORTRAIT');
      this._moveMainToWardrobe(state, outfitId);
      state.character.adopted.character = assetId;
      state.syncTargets = state.syncTargets.filter((target) => target !== 'character');
      this._validateUpdate(state, { character: state.character });
      state.character.revision += 1;
      this._history(state, '採用角色設定稿候選', 'sheetAdopted');
      await this._save(state);
      return this._public(state);
    });
  }

  // ── 表情集 ──
  // preset：加一個預設表情；name（＋note）：加一個自訂表情。已經在表情集裡的不重複加。
  // restore：復原剛拿掉的表情（畫面上的「復原」）：{ key, index, custom: { name, note }, item }，
  // 放回原本的位置；畫好的那張還在而且是這個表情的，就一起放回去。
  async addExpression(id, { preset, name, note, restore } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const list = expressionList(state.expressions);
      let key;
      let at = list.length;
      const custom = { ...(state.expressions?.custom || {}) };
      const items = { ...(state.expressions?.items || {}) };
      const text = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
      const customEntry = (rawName, rawNote) => {
        const label = text(rawName), detail = text(rawNote);
        if (!label || label.length > 40 || detail.length > 300) throw new DomainError('自訂表情要有 1 至 40 字的名稱，說明最多 300 字。', 422, 'INVALID_EXPRESSION');
        return { name: label, ...(detail ? { note: detail } : {}) };
      };
      if (restore !== undefined) {
        key = restore?.key;
        const isPreset = expressionPresets.some((item) => item.id === key);
        if (typeof key !== 'string' || !(isPreset || customExpressionKey.test(key))) throw new DomainError('沒有這個表情。', 422, 'UNKNOWN_EXPRESSION');
        if (list.includes(key)) return this._public(state);
        if (!isPreset) custom[key] = customEntry(restore.custom?.name, restore.custom?.note);
        if (Number.isInteger(restore.index)) at = Math.max(0, Math.min(list.length, restore.index));
        const item = restore.item;
        const asset = typeof item?.assetId === 'string' && state.assets.find((entry) => entry.id === item.assetId && entry.view === 'expression' && entry.expression === key);
        if (asset) items[key] = { assetId: asset.id, sourceAssetId: typeof item.sourceAssetId === 'string' ? item.sourceAssetId : null, sourceMain: typeof item.sourceMain === 'string' ? item.sourceMain : null, at: typeof item.at === 'string' ? item.at : now() };
      } else if (preset !== undefined) {
        if (!expressionPresets.some((item) => item.id === preset)) throw new DomainError('沒有這個表情。', 422, 'UNKNOWN_EXPRESSION');
        key = preset;
      } else {
        key = `custom-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
        custom[key] = customEntry(name, note);
      }
      if (list.includes(key)) return this._public(state);
      if (list.length >= EXPRESSION_LIMIT) throw new DomainError(`表情集最多 ${EXPRESSION_LIMIT} 個表情。`, 422, 'EXPRESSION_LIMIT');
      state.expressions = { ...(state.expressions || {}), list: [...list.slice(0, at), key, ...list.slice(at)], custom, items };
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  // 從表情集拿掉：畫好的那張留在圖鑑（不刪檔）。
  async removeExpression(id, key) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const list = expressionList(state.expressions);
      if (!list.includes(key)) return this._public(state);
      const { [key]: _item, ...items } = state.expressions?.items || {};
      const { [key]: _custom, ...custom } = state.expressions?.custom || {};
      state.expressions = { ...(state.expressions || {}), list: list.filter((item) => item !== key), items, custom };
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  // ── 設計標註 ──
  // 畫面送來的是那張角度圖上的位置（x、y：0–1）；存成人物範圍裡的相對位置（bx、by），重新裁切後仍標在同一個部位。
  // 說明的換行收成一個空白：交給 AI 時每個標註是一行。只能標在已經有圖的角度上。
  _note(state, input, existing) {
    const note = { ...(existing || {}) };
    const unit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    const view = input.view ?? note.view;
    if (!allViews.includes(view)) throw new DomainError('標註的位置不正確。', 422, 'INVALID_NOTE');
    if (input.x !== undefined || input.y !== undefined || !existing || view !== note.view) {
      if (!unit(input.x) || !unit(input.y) || !state.views?.items?.[view]) throw new DomainError('標註的位置不正確。', 422, 'INVALID_NOTE');
      Object.assign(note, toBodyPoint({ x: input.x, y: input.y }, bodyRect(state.views, view)));
    }
    const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
    const title = input.title !== undefined ? clean(input.title) : note.title || '';
    const text = input.text !== undefined ? clean(input.text) : note.text || '';
    if (!text || text.length > NOTE_TEXT_MAX || title.length > NOTE_TITLE_MAX) throw new DomainError(`標註要寫說明（${NOTE_TEXT_MAX} 字以內），名稱 ${NOTE_TITLE_MAX} 字以內。`, 422, 'INVALID_NOTE');
    return { id: note.id, view, bx: note.bx, by: note.by, title, text, createdAt: note.createdAt, updatedAt: now() };
  }

  async createViewNote(id, input = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      state.viewNotes = state.viewNotes || [];
      if (state.viewNotes.length >= NOTE_LIMIT) throw new DomainError(`標註最多 ${NOTE_LIMIT} 個。`, 422, 'TOO_MANY_NOTES');
      const createdAt = now();
      state.viewNotes.push(this._note(state, { view: input.view, x: input.x, y: input.y, title: input.title ?? '', text: input.text ?? '' }, { id: uid('note'), createdAt }));
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  async updateViewNote(id, noteId, patch = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const index = (state.viewNotes || []).findIndex((note) => note.id === noteId);
      if (index === -1) throw new DomainError('找不到這個標註。', 404, 'NOTE_NOT_FOUND');
      const allowed = Object.fromEntries(['view', 'x', 'y', 'title', 'text'].filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]));
      state.viewNotes[index] = this._note(state, allowed, state.viewNotes[index]);
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  async deleteViewNote(id, noteId) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const before = (state.viewNotes || []).length;
      state.viewNotes = (state.viewNotes || []).filter((note) => note.id !== noteId);
      if (state.viewNotes.length === before) throw new DomainError('找不到這個標註。', 404, 'NOTE_NOT_FOUND');
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  // 舊角色只有一張立繪：把整張當正面，之後補畫側面、背面。
  async useMainAsFront(id) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const asset = state.assets.find((item) => item.id === state.character.adopted.character);
      if (!asset || asset.targetId !== 'character' || asset.role !== 'design') throw new DomainError('要先有正式立繪。', 409, 'NO_PORTRAIT');
      state.views = this._frontOnlyViews(asset.id);
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  // 找出正式圖上的正面／側面／背面：給舊角色或功能加入前就採用的圖用（新的三視圖在拆解裝備時就一起找了）。
  // 在背景執行，狀態記在 project.json 的 views，畫面以輪詢看結果。
  async startViewDetection(id) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const asset = state.assets.find((item) => item.id === state.character.adopted.character);
      if (!asset || asset.targetId !== 'character' || asset.role !== 'design') throw new DomainError('要先有正式立繪，才能拆出三視圖。', 409, 'NO_PORTRAIT');
      const current = state.views;
      if (current?.status === 'detecting' && current.assetId === asset.id && this.detectingViews.has(id)) return { project: this._public(state), asset, path: await this._assetPath(id, asset), skipped: true };
      const startedAt = now();
      state.views = { assetId: asset.id, status: 'detecting', boxes: [], items: {}, startedAt, updatedAt: startedAt };
      await this._saveMetadata(state);
      this.detectingViews.add(id);
      return { project: this._public(state), asset, path: await this._assetPath(id, asset) };
    });
  }

  markDetectingViews(id, running) { if (running) this.detectingViews.add(id); else this.detectingViews.delete(id); }

  async finishViewDetection(id, { assetId, views = [] } = {}) {
    return this._withProject(id, async () => {
      this.detectingViews.delete(id);
      const state = await this._read(id);
      if (state.views?.status !== 'detecting' || state.views.assetId !== assetId) return this._public(state);
      const boxes = normalizeViewBoxes(views);
      state.views = { assetId, status: boxes.length >= 2 ? 'boxes' : 'none', boxes, items: {}, updatedAt: now() };
      await this._saveMetadata(state);
      return this._public(state);
    });
  }

  async failViewDetection(id, { assetId, message, code } = {}) {
    return this._withProject(id, async () => {
      this.detectingViews.delete(id);
      const state = await this._read(id);
      if (state.views?.status !== 'detecting' || state.views.assetId !== assetId) return this._public(state);
      state.views = { ...state.views, status: 'failed', error: String(message || '沒有找到三視圖。').slice(0, 500), ...(typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? { errorCode: code } : {}), updatedAt: now() };
      await this._saveMetadata(state);
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

  async createJob(id, { targetId = 'character', prompt, kind = 'refine', region, baseRevision, outfitId, outputView = 'front', directionId, variants = 1, framing, expression }) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._cas(state, baseRevision);
      this._target(state, targetId);
      if (targetId === 'character' ? !(allViews.includes(outputView) || outputView === 'expression') : !outputViews.includes(outputView)) throw new DomainError(targetId === 'character' ? '角色工作只接受 front（整張）、三視圖的一個角度（side、back、frontQuarter、backQuarter、otherSide），或表情集的一個表情（expression）。' : '輸出視角必須是 front、full、back 或 detail。', 422, 'INVALID_OUTPUT_VIEW');
      // 畫（或重畫）三視圖的單一角度（側面、背面或加的角度）：要先有拆好的正面，設計照正面與其他已確認的角度畫。
      // 不附這個角度原本的那張（多半就是畫壞了才重畫，附了 AI 會照抄），也不附整張正式圖（三視圖裡有畫壞的那個角度）。
      const viewRedraw = targetId === 'character' && isAngleView(outputView);
      const views = state.views;
      if (viewRedraw && !(views?.status === 'done' && views.assetId === state.character.adopted.character && views.items?.front)) throw new DomainError('要先有拆好的正面，才能畫側面或背面。', 409, 'VIEWS_NOT_READY');
      const viewRedo = viewRedraw && Boolean(views.items?.[outputView]);
      const otherViews = viewRedraw ? Object.entries(views.items).filter(([view]) => view !== outputView).map(([view, item]) => ({ view, assetId: item.assetId })) : [];
      // 表情集：照正面（定稿）畫胸像表情。附上已經畫好的一個表情當「取景參考」，整套才對得齊；
      // 重畫時不附這個表情原本的那張（多半就是畫壞了才重畫，附了 AI 會照抄）。
      const expressionJob = targetId === 'character' && outputView === 'expression';
      const expressionData = expressionJob ? expressionInfo(state.expressions, expression) : null;
      if (expressionJob && (!expressionData || !expressionList(state.expressions).includes(expression))) throw new DomainError('找不到這個表情，請先把它加進表情集。', 422, 'UNKNOWN_EXPRESSION');
      const expressionSource = expressionJob ? expressionFront(state) : null;
      if (expressionJob && !expressionSource) throw new DomainError('要先有正式立繪，才能畫表情。', 409, 'EXPRESSION_NEEDS_FRONT');
      const framingAsset = expressionJob ? framingReference(state, expression) : null;
      const expressionRedo = expressionJob && Boolean(state.expressions?.items?.[expression]?.assetId);
      const outfitIds = Object.keys(state.character.outfits);
      if (outfitId !== undefined && (typeof outfitId !== 'string' || !Object.hasOwn(state.character.outfits, outfitId))) throw new DomainError('找不到這次工作指定的穿搭。', 422, 'UNKNOWN_OUTFIT');
      // 三視圖的角度與表情集跟著正式立繪：一律用主要那套穿搭（畫面上選了別套也一樣，不然說明會叫 AI 換衣服）。
      const followsMain = (viewRedraw || expressionJob) && Boolean(state.character.adopted.character);
      if (outfitId === undefined && outfitIds.length > 1 && !followsMain) throw new DomainError('角色有多套穿搭，請明確選擇這次工作使用的穿搭。', 422, 'MISSING_OUTFIT');
      const selectedOutfitId = followsMain ? mainOutfitId(state) : outfitId ?? outfitIds[0] ?? null;
      const selectedOutfit = selectedOutfitId ? clone(state.character.outfits[selectedOutfitId]) : null;
      // 衣裝差分：已經有正式立繪、這次畫的是另一套穿搭：照正式立繪的臉、髮型、身形畫同一個角色，只換成這套的衣服；採用後放進衣櫃。
      const outfitVariant = targetId === 'character' && !viewRedraw && !expressionJob && isOutfitVariant(state, selectedOutfitId);
      // 局部修改另一套穿搭的立繪：要附上那張（選區以它為準）；重畫則不附（免得照抄）。
      const variantPortrait = outfitVariant && kind === 'refine' ? outfitPortraitId(state, selectedOutfitId) : null;
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
      const referenceIds = new Set([...(expressionJob ? [expressionSource, framingAsset] : viewRedraw ? otherViews.map((item) => item.assetId) : [state.character.adopted.character, state.character.adopted[targetId], variantPortrait]), ...(expressionJob ? [] : [...equippedAssets, ...viewAssets]), ...state.character.style.references.map((reference) => reference.assetId)].filter(Boolean));
      const referenceAssets = await Promise.all(state.assets.filter((asset) => referenceIds.has(asset.id)).map(async (asset) => ({ ...asset, path: await this._assetPath(id, asset), sha256: await fs.readFile(await this._assetPath(id, asset)).then((content) => createHash('sha256').update(content).digest('hex'), () => null) })));
      if (referenceAssets.some((asset) => !asset.sha256)) throw new DomainError('這次工作使用的參考圖片尚未就緒，請待素材完成後再建立工作。', 409, 'MISSING_REFERENCE');
      const outfitInstruction = selectedOutfit ? `本次穿搭：${selectedOutfit.name}（ID：${selectedOutfit.id}）。只依這套穿搭的 enabled=true 裝備生成整體；其他穿搭僅供背景參考，不得合併穿戴。${targetId !== 'character' && !selectedOutfit.equipped.some((item) => item.componentId === targetId && item.enabled) ? '目標部件目前未穿戴：本次僅設計部件，不自動加入穿搭。' : ''}` : '目前尚未設定穿搭；請設計角色草案，不得將未知服裝宣稱為已確認。';
      const viewLabel = turnaroundLabels[outputView];
      const expressionInstruction = expressionJob ? `本次輸出：表情集的「${expressionData.label}」（expression：${expression}）。胸像：頭頂到胸口、正面面向觀看者、淺灰素色背景、只有一個人，不加文字或邊框。表情：${expressionData.brief}${expressionData.prompt ? `（${expressionData.prompt}）` : ''}。設計完全照附上的正面（定稿），髮型、五官、服裝、配色與配件都不改，只改表情。${framingAsset ? '取景（頭的大小、位置、裁切）和「取景參考」那張一樣，整套表情才對得齊；表情不要照它。' : '這是表情集的第一張：頭頂上方留一點空間、裁在胸口，之後的表情都照這張的取景。'}${expressionRedo ? (expressionStale(state, expression) ? `正式立繪換過了，照新的正面重畫「${expressionData.label}」；沒有附上原本那張（那是舊的設計）。` : `原本的「${expressionData.label}」有問題，這次重畫；沒有附上原本那張，不要沿用它的畫法或錯誤。`) : ''}設定裡的神情（mood）是角色平常的樣子，這張的表情以「${expressionData.label}」為準。採用後放進表情集，不取代正式立繪。回收時的 view 必須是 expression。` : '';
      const viewInstruction = expressionJob ? expressionInstruction : viewRedraw ? `本次輸出：三視圖的「${viewLabel}」（view：${outputView}）。只畫一個全身的${viewLabel}。${viewSpecs[outputView]}設計完全照附上的正面（定稿）${otherViews.length > 1 ? '與已確認的其他角度' : ''}，髮型、五官、服裝、配色、配件與頭身比例都不改，身高和正面一樣；中性 A 字站姿、正交視角、淺灰素色背景，不加文字或其他人物。${viewRedo ? `原本的${viewLabel}有問題，這次重畫；沒有附上原本那張，不要沿用它的畫法或錯誤。` : ''}採用後放進三視圖的${viewLabel}，不取代正式立繪。回收時的 view 必須是 ${outputView}。`
        : targetId === 'character' && framing === 'frontView' ? `本次輸出：正面全身（view：front）。${outfitVariant ? `${FRONT_SPEC_BODY}服裝與配件要畫清楚。` : FRONT_SPEC}回收時的 view 必須是 front。`
        : targetId === 'character' && framing === 'turnaround' ? `本次輸出：三視圖（view：front）。${TURNAROUND_SPEC}回收時的 view 必須是 front。` : `本次輸出視角：${viewLabels[outputView]}（view：${outputView}）。${targetId === 'character' ? '輸出完整角色設定稿，可在同一稿內呈現前後視角。' : ['back', 'detail'].includes(outputView) ? '這份候選採用後只保存對應視角，不取代部件主圖。' : '這份候選採用後會更新部件主圖。'}回收時的 view 必須與本次輸出視角相同。`;
      const outfitLine = outfitVariant ? `這是穿搭「${selectedOutfit.name}」的立繪：照正式立繪畫同一個角色，臉、五官、髮型、髮色、膚色、身形與比例都不改，只換成這套穿搭的衣服與配件。採用後放在這套穿搭，不取代正式立繪。` : '';
      // 設計標註：設計師在角度圖上標的重點（例如尾巴從哪裡長出來），畫角色的任何圖都附上。
      const noteInstruction = targetId === 'character' ? viewNotesText(state) : '';
      // 重畫單一角度時，正式三視圖就是這次的定稿。
      const hasCanon = viewRedraw || expressionJob || state.character.style.references.some((reference) => reference.canon && referenceIds.has(reference.assetId));
      const compiled = compileBrief(state.character, { directionId, outfitId: selectedOutfitId, framing, canon: hasCanon, expression: expressionJob, outfitVariant });
      // 表情集：幾張之間只有表情的細節不同，取景要和取景參考一樣（整套才對得齊）。
      const variantInstruction = variants > 1 ? (expressionJob
        ? `本次請產生 ${variants} 張候選，彼此只在表情的細節上可有變化（例如嘴型、眉毛、眼神），取景、設計與鎖定特徵都要一樣；每張分別提交為待審候選。`
        : `本次請產生 ${variants} 張候選，彼此在構圖或細節上可有變化，但都必須符合同一份設定與鎖定特徵；每張分別提交為待審候選。`) : '';
      const yaml = `${[outfitInstruction, viewInstruction, outfitLine, noteInstruction].filter(Boolean).flatMap((instruction) => instruction.split(/\r?\n/).map((line) => `# ${line}`)).join('\n')}\n${characterYaml(state.character)}`;
      const snapshotPath = path.join(this.jobDir(id, jobId), 'input.yaml');
      const instructionsPath = path.join(this.jobDir(id, jobId), 'instructions.md');
      // 每張固定輸入都標出用途：繪風參考管「畫法」，正式立繪與裝備圖只管「長相與服裝」，避免舊圖的畫法蓋掉新的繪風參考。
      const styleReferences = state.character.style.references.filter((reference) => referenceIds.has(reference.assetId)).map((reference) => ({ id: reference.id, assetId: reference.assetId, role: reference.role, focus: reference.focus || [], ...(reference.canon ? { canon: true } : {}), name: state.assets.find((asset) => asset.id === reference.assetId)?.name || reference.assetId }));
      const drawingStyle = styleReferences.filter((reference) => reference.role === 'style');
      const focusText = (reference) => reference.focus.join('、') || '整體感覺';
      const partName = (partId) => state.character.components[partId]?.name || partId;
      const inputRole = (asset) => {
        const reference = styleReferences.find((item) => item.assetId === asset.id);
        // 重畫單一角度：正式三視圖排第一當定稿；原本的定稿是畫三視圖之前的設計，只在三視圖看不清楚時參考。
        // 表情集：正面是定稿，已經畫好的表情只管取景；原本的定稿只在正面看不清楚時參考。
        if (expressionJob && asset.id === expressionSource) return { order: -2, label: '定稿（正面）：照這張畫表情。髮型、五官、服裝、配色、配件都以它為準，不得變更' };
        if (expressionJob && asset.id === framingAsset) return { order: -1, label: '取景參考（已確認的表情）：頭的大小、位置、裁切和背景照這張；表情不要照它' };
        if (expressionJob && reference?.canon) return { order: 0, label: '原本的定稿：設計以正面為準，這張只在正面看不清楚時參考' };
        const otherView = viewRedraw && otherViews.find((item) => item.assetId === asset.id);
        if (otherView?.view === 'front') return { order: -2, label: `定稿（正面）：照這張畫${viewLabel}。髮型、五官、服裝、配色、配件與頭身比例都以它為準，不得變更` };
        if (otherView) return { order: -1, label: `已確認的${turnaroundLabels[otherView.view]}：同一個角色，設計和它一致` };
        if (viewRedraw && reference?.canon) return { order: 0, label: '原本的定稿：設計以正面為準，這張只在正面看不清楚時參考' };
        // 另一套穿搭：正式立繪與定稿只管長相，衣服不要照它們。
        if (variantPortrait && asset.id === variantPortrait) return { order: -2, label: `這套穿搭「${selectedOutfit.name}」目前的立繪：這次照這張局部修改，選區以這張為準；沒提到的地方不要動` };
        if (outfitVariant && asset.id === state.character.adopted.character) return { order: -1, label: '正式立繪（主要那套穿搭）：照它畫同一個角色，臉、五官、髮型、髮色、膚色、身形與比例都以它為準；衣服不要照它，換成這次的穿搭' };
        if (outfitVariant && reference?.canon) return { order: 0, label: '定稿：臉、五官、髮型與身形照它；衣服不要照它，換成這次的穿搭' };
        if (reference?.canon) return { order: -1, label: `定稿：照這張畫。髮型、五官、服裝、配色、配件與頭身比例都以它為準，不得變更${reference.role === 'style' ? '；畫法也以它為準' : ''}` };
        if (reference) return { order: 0, label: `${referenceRoleLabels[reference.role] || '參考圖'}：要參考它的「${focusText(reference)}」${reference.role === 'style' ? '，這次的畫法以它為準' : ''}` };
        // 補畫三視圖（舊角色已經有一張立繪）：照這張的設計畫成三視圖，不重新設計。
        if (asset.id === state.character.adopted.character && targetId === 'character' && framing === 'turnaround' && !hasCanon) return { order: 1, label: `目前的正式立繪：三視圖照這張的設計畫，髮型、五官、服裝與配色不改（設定有改的地方以 input.yaml 為準）${drawingStyle.length ? '，畫法不要沿用它' : ''}` };
        if (asset.id === state.character.adopted.character) return { order: 1, label: `目前的正式立繪：只用來確認角色長相、髮型、服裝與配色${drawingStyle.length ? '，不要沿用它的畫法' : ''}` };
        if (targetId !== 'character' && asset.id === state.character.adopted[targetId]) return { order: 2, label: `「${partName(targetId)}」目前的設計圖` };
        return { order: 3, label: `「${partName(asset.targetId)}」的${viewLabels[asset.view] || '設計圖'}：服裝結構與細節${drawingStyle.length ? '，不要沿用它的畫法' : ''}` };
      };
      const labeledInputs = referenceAssets.map((asset) => ({ asset, ...inputRole(asset) })).sort((a, b) => a.order - b.order);
      const styleLine = drawingStyle.length ? `繪風參考：${drawingStyle.map((reference) => `${reference.name}（${focusText(reference)}）`).join('、')}。畫法以繪風參考為準；${outfitVariant ? '正式立繪只用來確認長相（衣服照這次的穿搭，不要照它）' : '正式立繪與裝備圖只用來確認長相與服裝'}。` : '';
      const handoffPrompt = `請使用 AIDOL 工作資料進行角色設計。\n專案：${state.character.name}\n工作：${jobId}\n目標：${targetId}\n基礎版本：${baseRevision}\n${outfitInstruction}\n${viewInstruction}\n${outfitLine ? `${outfitLine}\n` : ''}${noteInstruction ? `${noteInstruction}\n` : ''}${variantInstruction ? `${variantInstruction}\n` : ''}${compiled.direction ? `畫風方向：${compiled.direction.id} · ${compiled.direction.name}\n` : ''}${styleLine ? `${styleLine}\n` : ''}${hasCanon ? (expressionJob ? '有定稿：設計照定稿，只改表情。\n' : outfitVariant ? '有定稿：長相照定稿，衣服換成這次的穿搭。\n' : '有定稿：設計照定稿，只改這次要的視角、姿勢與排版。\n') : ''}本次要求：${prompt.trim()}\n人物快照：${snapshotPath}\n操作說明：${instructionsPath}\n使用新的工作階段；先讀取設定與參考圖。完成後提交圖片為待審候選，不可覆寫目前採用稿。`;
      // 定稿：設計照定稿，只改這次要的視角、姿勢與排版；定稿之後才改的外觀設定列成例外。
      const canonList = hasCanon && !viewRedraw && !expressionJob ? canonChanges(state.history, state.character, { outfitId: selectedOutfitId, variant: outfitVariant }) : [];
      const canonLine = hasCanon ? [
        expressionJob ? '以「定稿（正面）」為準，禁止變更任何設定：髮型、五官、服裝、配色與配件都要和定稿一樣；只改表情與取景（胸像）。長相以定稿圖為準，input.yaml 與下面的文字設定只補充定稿上看不到的部分。'
          : outfitVariant ? `以「定稿」為準的是角色本身：臉、五官、髮型、膚色、身形與比例都要和定稿一樣；衣服與配件照這次的穿搭「${selectedOutfit.name}」（下面 DNA 的穿搭段，以及 input.yaml 的 outfits.${selectedOutfitId}），不要照定稿或正式立繪的衣服。`
          : '以「定稿」為準，禁止變更任何設定：髮型、五官、服裝、配色、配件與頭身比例都要和定稿一樣；只改變本次要求的視角、姿勢與排版。長相以定稿圖為準，input.yaml 與下面的文字設定只補充定稿上看不到的部分（例如背面）。',
        canonList.length ? `${outfitVariant ? '除了以下改動，長相照定稿' : '除了以下改動，其他全部照定稿'}：\n${canonList.map((change) => `- ${change.label}：${change.from} → ${change.to}`).join('\n')}` : '',
        drawingStyle.length ? '畫法（線條、上色、陰影）以「繪風參考」為準；設計照定稿。' : '',
      ].filter(Boolean).join('\n') : '';
      const keepLine = canonLine ? `${canonLine}\n` : drawingStyle.length
        ? (outfitVariant ? '角色的長相、髮型與髮色依 input.yaml 和上面的正式立繪保持一致；衣服照這次的穿搭設定，不要照正式立繪的衣服；' : '角色的長相、髮型、服裝與配色依 input.yaml 和上面的角色、裝備圖保持一致；') + '畫法（線條、上色、陰影、五官與人物的畫法）以「繪風參考」為準，不要沿用目前正式立繪或裝備圖的畫法。要換畫法時請重新畫整張，不要拿舊畫法的圖做局部修改；之後若要再修正（例如頭身），也要再附上繪風參考。下方「畫風方向」只補充繪風參考沒有涵蓋的部分，兩者衝突時以繪風參考為準。'
        : '依據 input.yaml 保持角色辨識特徵與繪風，只依本次要求修改。';
      // 交接訊息只寫工作資料夾，回報與回收的規則寫在這裡（同時也在 AIDOL skill）。
      const reportSection = `## 回報與回收\n\n- 回收憑證是同資料夾的 handoff.json（不要顯示 token）；用 AIDOL skill 的 submit-candidate helper 提交。\n- 開始產圖前回報 \`--event started\`；本次共 ${variants} 張，每張完成就提交；全部完成回報 \`--event finished\`，失敗回報 \`--event failed --message "原因"\`。\n- 沒有圖像工具時說明限制並保留工作；不得用文字或示意圖冒充產圖；不覆寫、不採用目前的正式稿。`;
      const instructions = `# AIDOL 精修工作\n\n${handoffPrompt}\n\n## 固定輸入\n\n${labeledInputs.map(({ asset, label }) => `- ${label}｜${asset.name}: ${asset.path} (${asset.sha256 || '檔案尚未可用'})`).join('\n')}\n\n${region ? `選區（0 至 1）：${JSON.stringify(region)}\n\n` : ''}${keepLine}${hasCanon ? (outfitVariant ? '衣服照這次的穿搭設定設計；角色本身（臉、髮型、身形）不得改變。' : '定稿上看不到的部分依文字設定補上，維持同一設計語言；不得新增定稿沒有的配件、花紋或裝飾。') : '尚未指定的結構先提出設計，不得宣稱已確認。'}\n${compiled.empty ? '' : `\n${compiled.text}\n`}`;
      await fs.mkdir(this.jobDir(id, jobId), { recursive: true });
      await fs.writeFile(snapshotPath, yaml, { flag: 'wx' });
      await fs.writeFile(instructionsPath, `${instructions.trimEnd()}\n\n${reportSection}\n`, { flag: 'wx' });
      const job = { id: jobId, targetId, outputView, ...(viewRedraw ? { sheetAssetId: state.views.assetId, ...(viewRedo ? { viewRedo: true } : {}) } : {}), ...(expressionJob ? { expression, expressionLabel: expressionData.label, expressionSource, expressionMain: state.character.adopted.character, ...(expressionRedo ? { expressionRedo: true } : {}) } : {}), ...(outfitVariant ? { outfitVariant: true, outfitMain: state.character.adopted.character } : {}), outfitId: selectedOutfitId, prompt: prompt.trim(), kind, ...(region ? { region: clone(region) } : {}), variants, ...(compiled.direction ? { directionId: compiled.direction.id } : {}), ...(framing ? { framing } : {}), baseRevision, status: 'prepared', createdAt: now(), context: { yaml, selectedOutfit, referenceAssets, styleReferences, snapshotPath, instructionsPath, ...(compiled.empty ? {} : { compiled: compiled.text, compiledPrompt: compiled.prompt }) }, handoffPrompt };
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
      const forbidden = ['id', 'targetId', 'outfitId', 'outputView', 'sheetAssetId', 'viewRedo', 'expression', 'expressionLabel', 'expressionSource', 'expressionMain', 'expressionRedo', 'prompt', 'kind', 'region', 'variants', 'directionId', 'framing', 'baseRevision', 'createdAt', 'context'];
      if (forbidden.some((key) => Object.hasOwn(patch, key))) throw new DomainError('不可變更工作的固定輸入。');
      // 已經收掉的工作不能再改回別的狀態（例如交給 Codex 的途中剛好被按了「不畫了」）。
      if (job.status === 'cancelled' && Object.hasOwn(patch, 'status') && patch.status !== 'cancelled') throw new DomainError('此工作已結束，請建立新的工作。', 409, 'JOB_ENDED');
      Object.assign(job, clone(patch), { updatedAt: now() });
      await this._save(state);
      return clone(job);
    });
  }

  // 「不畫了」（2026-10-14 起）：還沒送出、等你送出、或失敗了的繪製可以收掉（工作當成結束，圖鑑與畫布不再列出）。
  // 正在畫、Design QA 正在審、已經有圖等你挑、全自動正在處理的那張不行。
  async cancelJob(id, jobId) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job) throw new DomainError('找不到這次設計工作。', 404, 'JOB_NOT_FOUND');
      if (['cancelled', 'accepted'].includes(job.status)) throw new DomainError('這次繪製已經結束了。', 409, 'JOB_ENDED');
      // AIDOL 直接畫、但核心重開過（畫面顯示「中斷了」）：其實已經沒在畫，可以收掉。
      const interrupted = job.runner === 'auto' && !this.drawingJobs.has(jobId);
      if (this.drawingJobs.has(jobId) || (!interrupted && (job.status === 'running' || (job.progress?.startedAt && !job.progress?.finishedAt)))) throw new DomainError('這次正在畫，先按「停下」。', 409, 'JOB_DRAWING');
      if (this.reviewingJobs.has(jobId)) throw new DomainError('Design QA 正在審這批圖，等它審完。', 409, 'REVIEW_RUNNING');
      // 只擋現在這一輪全自動的工作（之前幾輪失敗、沒送出的照樣可以收）。
      if (job.autopilotId && this.autopilots.has(id) && state.autopilot?.id === job.autopilotId) throw new DomainError('全自動正在處理這張；要停的話先停下全自動。', 409, 'AUTOPILOT_JOB');
      if (state.candidates.some((candidate) => candidate.jobId === jobId && candidate.status === 'pending')) throw new DomainError('這次已經有圖等你挑了。', 409, 'JOB_HAS_IMAGES');
      Object.assign(job, { status: 'cancelled', cancelledAt: now(), updatedAt: now() });
      await this._save(state);
      return this._public(state);
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
      // 已經「不畫了」的工作不再收圖（不然會被改回「等你挑」）。
      if (job?.status === 'cancelled') throw new DomainError('此工作已結束，無法回收新候選。', 409, 'JOB_ENDED');
      const assetView = view ?? job?.outputView ?? 'front';
      // 角色的圖平常只有正面（整張）；側面、背面只能是「重畫三視圖單一角度」工作交回來的候選。
      if (targetId === 'character' ? assetView !== 'front' && !(job && (allViews.includes(assetView) || assetView === 'expression')) : !outputViews.includes(assetView)) throw new DomainError('圖片視角不符合角色或部件的允許範圍。', 422, 'INVALID_OUTPUT_VIEW');
      if (job && assetView !== (job.outputView || 'front')) throw new DomainError('候選視角與本次工作不同，請依照工作的輸出視角匯入。', 422, 'ASSET_VIEW_MISMATCH');
      const assetId = uid('asset');
      const filePath = path.join(this.projectDir(id), 'assets', `${assetId}${mimeExtensions[actualMime]}`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer, { flag: 'wx' });
      const asset = { id: assetId, url: `/api/projects/${id}/assets/${assetId}`, name: name.trim() || '圖片', targetId, role, view: assetView, version: state.assets.filter((item) => item.targetId === targetId && item.role === role && item.view === assetView).length + 1, createdAt: now(), mimeType: actualMime, sha256: createHash('sha256').update(buffer).digest('hex') };
      if (job?.outfitId) asset.outfitId = job.outfitId;
      if (assetView === 'expression' && job?.expression) asset.expression = job.expression;
      state.assets.push(asset);
      let candidate;
      if (job) {
        candidate = { id: uid('candidate'), assetId, jobId, targetId, view: assetView, ...(job.outfitId ? { outfitId: job.outfitId } : {}), ...(assetView === 'expression' && job.expression ? { expression: job.expression } : {}), baseRevision: job.baseRevision, status: 'pending', createdAt: now() };
        state.candidates.push(candidate);
        if (job.status !== 'accepted') job.status = 'review';
        job.updatedAt = now();
      }
      if (role === 'reference' && !job) await this._saveMetadata(state);
      else await this._save(state);
      return { asset: clone(asset), ...(candidate ? { candidate: { ...candidate, olderSettings: this._olderSettings(state, candidate.baseRevision) } } : {}), project: this._public(state) };
    });
  }

  // 由 AIDOL Skill 經回收憑證回報的真實進度；不推測、不補假百分比。
  // code 只有核心自己呼叫時會帶（例如「AIDOL 直接畫」的額度用完），介面依 code 換成使用者的語言。
  async recordProgress(id, jobId, { event, message, code, resetsAt } = {}) {
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
        job.failure = { at, ...(note ? { message: note } : {}), ...(typeof code === 'string' ? { code } : {}), ...(Number.isFinite(resetsAt) ? { resetsAt } : {}) };
        job.progress.finishedAt = at;
        if (!['review', 'accepted'].includes(job.status)) job.status = 'failed';
      }
      job.updatedAt = at;
      await this._saveMetadata(state);
      return clone(job);
    });
  }

  // 指定圖片在本機的完整路徑（Design QA 看候選圖用）；順序照 assetIds。
  async assetFiles(id, assetIds) {
    const state = await this.getProject(id);
    return Promise.all(assetIds.map(async (assetId) => {
      const asset = state.assets.find((item) => item.id === assetId);
      if (!asset) throw new DomainError('找不到這張圖片。', 404, 'ASSET_NOT_FOUND');
      return this._assetPath(id, asset);
    }));
  }

  // 定稿圖在本機的完整路徑（讓 Codex 照圖填設定用）。
  async canonImages(id) {
    const state = await this.getProject(id);
    const ids = new Set(state.character.style.references.filter((reference) => reference.canon).map((reference) => reference.assetId));
    return Promise.all(state.assets.filter((asset) => ids.has(asset.id)).map((asset) => this._assetPath(id, asset)));
  }

  async readAsset(id, assetId) {
    const state = await this.getProject(id);
    const asset = state.assets.find((item) => item.id === validId(assetId));
    if (!asset) throw new DomainError('找不到這張本機圖片。', 404, 'ASSET_NOT_FOUND');
    return { asset, buffer: await fs.readFile(await this._assetPath(id, asset)) };
  }

  // by：誰採用的。全自動模式由 Design QA 代為採用時是 'design-qa'（畫面標出來，使用者之後可以換回別張）。
  // asMain：另一套穿搭的立繪改成正式立繪（原本的正式立繪放進它那套的衣櫃）。
  async acceptCandidate(id, candidateId, { baseRevision, by, asMain = false } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      this._cas(state, baseRevision);
      const candidate = state.candidates.find((item) => item.id === candidateId);
      if (!candidate) throw new DomainError('找不到這張候選稿。', 404, 'CANDIDATE_NOT_FOUND');
      // 用較早設定畫的圖照樣可以採用；先前採用過的圖也能換回來。
      if (!['pending', 'accepted'].includes(candidate.status)) throw new DomainError('這張圖目前不能採用。', 409, 'CANDIDATE_CLOSED');
      this._target(state, candidate.targetId);
      const asset = state.assets.find((item) => item.id === candidate.assetId);
      // 表情：只放進表情集，不動正式立繪與角色設定（不進版本）。照舊的正面畫的也可以採用，畫面會提醒可以重畫。
      if (candidate.targetId === 'character' && asset.view === 'expression') {
        const job = state.jobs.find((item) => item.id === candidate.jobId);
        const key = asset.expression || job?.expression;
        // 拿掉的表情（預設的也一樣）不會因為採用又跑回來；要用的話先在表情集加回去。
        if (!expressionList(state.expressions).includes(key) || !expressionInfo(state.expressions, key)) throw new DomainError('這個表情已經從表情集拿掉了，這張沒有放進表情集。', 409, 'EXPRESSION_REMOVED');
        state.expressions = { ...(state.expressions || {}), items: { ...(state.expressions?.items || {}), [key]: { assetId: asset.id, sourceAssetId: job?.expressionSource || null, sourceMain: job?.expressionMain || null, at: now() } } };
        candidate.status = 'accepted';
        candidate.acceptedAt = now();
        if (by === 'design-qa') candidate.acceptedBy = 'design-qa'; else delete candidate.acceptedBy;
        if (job) job.status = 'accepted';
        await this._saveMetadata(state);
        return this._public(state);
      }
      // 重畫的側面／背面：只換掉三視圖裡那個角度，不動正式三視圖與角色設定（視角不進版本）。
      if (candidate.targetId === 'character' && asset.view !== 'front') {
        const views = state.views;
        const job = state.jobs.find((item) => item.id === candidate.jobId);
        // 重畫時照的那張三視圖已經換掉了：這張是照舊設計畫的，不放進新的三視圖。
        if (!(views?.status === 'done' && views.assetId === state.character.adopted.character) || (job?.sheetAssetId && job.sheetAssetId !== views.assetId)) throw new DomainError('正式三視圖已經換過了，這張沒有放進三視圖。', 409, 'VIEWS_STALE');
        const previous = views.items?.[asset.view];
        const old = previous && state.assets.find((item) => item.id === previous.assetId && item.role === 'view' && !this._usedByOpenJobs(state, item.id));
        if (old) state.assets = state.assets.filter((item) => item !== old);
        views.items = { ...(views.items || {}), [asset.view]: { assetId: asset.id, sourceAssetId: asset.id, redrawn: true } };
        if (extraViews.includes(asset.view) && !(views.extra || []).includes(asset.view)) views.extra = allViews.filter((item) => item === asset.view || (views.extra || []).includes(item));
        views.updatedAt = now();
        candidate.status = 'accepted';
        candidate.acceptedAt = now();
        if (by === 'design-qa') candidate.acceptedBy = 'design-qa'; else delete candidate.acceptedBy;
        state.jobs.find((job) => job.id === candidate.jobId).status = 'accepted';
        await this._saveMetadata(state);
        if (old) await fs.rm(await this._assetPath(id, old), { force: true }).catch(() => {});
        return this._public(state);
      }
      // 衣裝差分：另一套穿搭畫的立繪只放進衣櫃（那套的立繪），不換正式立繪、不進版本。
      const portraitOutfit = candidate.targetId === 'character' ? candidate.outfitId || state.jobs.find((item) => item.id === candidate.jobId)?.outfitId || null : null;
      // 那套穿搭已經刪掉了：衣服對不上任何一套，不放進衣櫃、也不當正式立繪（改成正式立繪也一樣）。復原那套之後就可以採用。
      if (outfitRemoved(state, portraitOutfit)) throw new DomainError('這套穿搭已經刪掉了，這張不能採用。要用的話，先在圖鑑放大這張，按「復原套裝」。', 409, 'OUTFIT_REMOVED');
      if (candidate.targetId === 'character' && isOutfitVariant(state, portraitOutfit)) {
        const items = { ...(state.wardrobe?.items || {}) };
        if (!asMain) {
          items[portraitOutfit] = { assetId: asset.id, at: now() };
          state.wardrobe = { ...(state.wardrobe || {}), items };
          candidate.status = 'accepted';
          candidate.acceptedAt = now();
          if (by === 'design-qa') candidate.acceptedBy = 'design-qa'; else delete candidate.acceptedBy;
          const job = state.jobs.find((item) => item.id === candidate.jobId);
          if (job) job.status = 'accepted';
          await this._saveMetadata(state);
          return this._public(state);
        }
        // 改成正式立繪：原本的正式立繪放進它那套的衣櫃，這套的衣櫃空出來（這張就是正式立繪了）。
        this._moveMainToWardrobe(state, portraitOutfit);
      }
      const primary = ['front', 'full'].includes(asset.view);
      const previousMain = state.character.adopted.character;
      if (primary) state.character.adopted[candidate.targetId] = candidate.assetId;
      if (primary && candidate.targetId === 'character') this._keepDisplacedMain(state, previousMain);
      if (candidate.targetId !== 'character') {
        const component = state.character.components[candidate.targetId];
        component.views = { ...(component.views || {}), [asset.view]: candidate.assetId };
        if (primary) { component.assetId = candidate.assetId; component.designStatus = 'confirmed'; }
        else if (!state.character.adopted[candidate.targetId]) component.designStatus = 'proposed';
        if (state.character.adopted.character) state.syncTargets = [...new Set([...state.syncTargets, 'character'])];
      }
      if (primary) state.syncTargets = state.syncTargets.filter((target) => target !== candidate.targetId);
      // 分開畫的正面全身：整張就是正面，採用後直接拆（不用等 AI 找角度），接著就能補畫側面、背面。
      if (candidate.targetId === 'character' && state.jobs.find((job) => job.id === candidate.jobId)?.framing === 'frontView') state.views = this._frontOnlyViews(candidate.assetId);
      this._validateUpdate(state, { character: state.character });
      state.character.revision += 1;
      candidate.status = 'accepted';
      candidate.acceptedAt = now();
      if (by === 'design-qa') candidate.acceptedBy = 'design-qa'; else delete candidate.acceptedBy;
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
      const previousMain = state.character.adopted.character;
      state.character = { ...character, revision: baseRevision + 1 };
      this._keepDisplacedMain(state, previousMain);
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
    // 三視圖拆好的各個角度另外放一份 views/front.png、side.png、back.png（和加的角度），方便直接拿去用（例如轉 3D）。
    if (state.views?.status === 'done' && state.views.assetId === state.character.adopted.character) {
      for (const [view, item] of Object.entries(state.views.items || {})) {
        const viewAsset = state.assets.find((asset) => asset.id === item.assetId);
        const viewPath = viewAsset && await this._assetPath(id, viewAsset);
        if (viewPath && await exists(viewPath)) archive.file(viewPath, { name: `views/${view}${path.extname(viewPath) || '.png'}` });
      }
    }
    // 表情集另外放一份 expressions/01-neutral.png…（照表情集的順序），和名稱清單。
    const expressionItems = expressionList(state.expressions).map((key, index) => ({ key, index, item: state.expressions?.items?.[key], info: expressionInfo(state.expressions, key) })).filter((entry) => entry.item?.assetId && entry.info);
    const expressionLines = [];
    for (const { key, index, item, info } of expressionItems) {
      const expressionAsset = state.assets.find((asset) => asset.id === item.assetId);
      const expressionPath = expressionAsset && await this._assetPath(id, expressionAsset);
      if (!expressionPath || !(await exists(expressionPath))) continue;
      const file = `${String(index + 1).padStart(2, '0')}-${key}${path.extname(expressionPath) || '.png'}`;
      archive.file(expressionPath, { name: `expressions/${file}` });
      expressionLines.push(`- ${file}：${scrub(info.label)}`);
    }
    if (expressionLines.length) archive.append(`# 表情集\n\n${expressionLines.join('\n')}\n`, { name: 'expressions/expressions.md' });
    // 衣櫃：每套穿搭的立繪另外放一份 outfits/01-<穿搭代號>.png（主要那套就是正式立繪），和名稱清單。
    const outfitLines = [];
    for (const [index, outfitId] of Object.keys(state.character.outfits).entries()) {
      const portraitId = outfitPortraitId(state, outfitId);
      const portraitAsset = portraitId && state.assets.find((asset) => asset.id === portraitId);
      const portraitPath = portraitAsset && await this._assetPath(id, portraitAsset);
      if (!portraitPath || !(await exists(portraitPath))) continue;
      const file = `${String(index + 1).padStart(2, '0')}-${outfitId}${path.extname(portraitPath) || '.png'}`;
      archive.file(portraitPath, { name: `outfits/${file}` });
      outfitLines.push(`- ${file}：${scrub(state.character.outfits[outfitId].name)}${outfitId === mainOutfitId(state) ? '（主要）' : ''}`);
    }
    if (outfitLines.length) archive.append(`# 衣櫃\n\n${outfitLines.join('\n')}\n`, { name: 'outfits/outfits.md' });
    // 設計標註另外放一份文字，和角度圖一起交給別人看。
    if ((state.viewNotes || []).length) archive.append(`# 設計標註\n\n${viewNotesText(state).split('\n').slice(1).join('\n')}\n`, { name: 'views/notes.md' });
    const packed = await Promise.all(state.jobs.map((job) => this._portableJob(id, job, exportedPaths, scrub)));
    manifest.jobs = packed.map(({ job }) => job);
    manifest.proposals = state.proposals.map((proposal) => (typeof proposal.summary === 'string' ? { ...proposal, summary: scrub(proposal.summary) } : proposal));
    if (state.views?.error) manifest.views = { ...state.views, error: scrub(state.views.error) };
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
