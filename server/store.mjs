import path from 'node:path';
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
const attentionRank = (item) => ({ review: 0, wait: 1, handoff: item.tone === 'error' ? 3 : 2 })[item.action] ?? 4;
const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${randomUUID()}`;
const exists = async (file) => fs.access(file).then(() => true, () => false);
const validId = (id) => {
  if (typeof id !== 'string' || !new RegExp(idPattern).test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new DomainError('識別碼格式不正確。', 400, 'INVALID_ID');
  return id;
};
const mimeExtensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

export function imageMime(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'image/gif';
  return null;
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
    this.ready = null;
  }

  projectDir(id) { return path.join(this.dataDir, 'projects', validId(id)); }
  jobDir(projectId, jobId) { return path.join(this.projectDir(projectId), 'jobs', validId(jobId)); }

  async init() {
    if (!this.ready) this.ready = this._init();
    await this.ready;
    return this;
  }

  async _init() {
    await fs.mkdir(path.join(this.dataDir, 'projects'), { recursive: true });
    const folders = await fs.readdir(path.join(this.dataDir, 'projects'), { withFileTypes: true });
    for (const folder of folders.filter((entry) => entry.isDirectory() && new RegExp(idPattern).test(entry.name))) await this._recover(folder.name);
    if (this.demo && !folders.some((entry) => entry.isDirectory())) {
      const createdAt = now();
      const character = demoCharacter();
      const assets = ['sheet', 'hair', 'coat', 'pants', 'boots', 'clasp'].map((part) => ({
        id: `demo-rin-${part}`, url: `/assets/rin-${part}.png`, name: part === 'sheet' ? '凜・角色設定稿' : character.components[part].name,
        targetId: part === 'sheet' ? 'character' : part, role: 'design', view: 'front', version: 1, createdAt,
        source: 'demo', sourceFile: `rin-${part}.png`,
      }));
      const state = { id: 'rin', name: '凜', createdAt, updatedAt: createdAt, character, assets, jobs: [], candidates: [], proposals: [], history: [], syncTargets: [], canvasAnnotations: [] };
      this._history(state, '建立範例角色');
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

  _history(state, message) {
    state.history.push({ id: uid('history'), revision: state.character.revision, createdAt: now(), message, character: clone(state.character), syncTargets: [...state.syncTargets] });
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
    const projects = await Promise.all(folders.filter((folder) => folder.isDirectory() && new RegExp(idPattern).test(folder.name)).map((folder) => this.getProject(folder.name)));
    return projects.map((project) => {
      const { id, name, createdAt, updatedAt, character, assets } = project;
      const assetUrl = (assetId) => assets.find((asset) => asset.id === assetId)?.url || null;
      // 角色庫的「等你處理」：依每份工作自己的穿搭判斷，只列有證據的下一步。
      const attention = Object.keys(character.outfits).flatMap((outfitId) => workspaceSummary(project, outfitId).attentionJobs.map((job) => {
        const view = jobPresentation(project, job, outfitId);
        const targetName = job.targetId === 'character' ? '立繪' : character.components[job.targetId]?.name || '部件';
        return { jobId: job.id, targetId: job.targetId, targetName, label: view.label, tone: view.tone, action: view.action, createdAt: job.createdAt, thumbnailUrl: assetUrl(view.candidate?.assetId) || assetUrl(character.adopted[job.targetId]) || assetUrl(character.adopted.character) };
      }));
      const proposals = project.proposals.filter((proposal) => proposal.status === 'pending').length;
      return {
        id, name, createdAt, updatedAt, revision: character.revision,
        thumbnailUrl: assetUrl(character.adopted.character),
        persona: (character.persona.description || '').slice(0, 120), traits: character.persona.traits.slice(0, 6),
        componentCount: Object.keys(character.components).length, outfitCount: Object.keys(character.outfits).length,
        attention: attention.sort((a, b) => attentionRank(a) - attentionRank(b) || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).slice(0, 6),
        attentionCount: attention.length + proposals, pendingProposals: proposals,
      };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createProject({ name, brief = '' } = {}) {
    if (typeof name !== 'string' || !name.trim() || name.length > 160) throw new DomainError('請輸入 1 至 160 字的角色名稱。');
    if (typeof brief !== 'string' || brief.length > 12000) throw new DomainError('角色簡介長度不可超過 12000 字。');
    const id = uid('character');
    return this._withProject(id, async () => {
      const createdAt = now();
      const state = { id, name: name.trim(), createdAt, updatedAt: createdAt, character: newCharacter(id, name.trim(), brief), assets: [], jobs: [], candidates: [], proposals: [], history: [], syncTargets: [], canvasAnnotations: [] };
      this._history(state, '建立角色草案');
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
    if (character.id !== state.character.id) throw new DomainError('人物 ID 不可變更。');
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
      this._history(state, '更新人物設定');
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
      this._history(state, '採用人物設定提案');
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
        this._history(state, added ? `AI 拆解裝備：新增 ${added} 件` : 'AI 拆解裝備：更新位置');
      }
      state.decomposition = { status: 'done', assetId, auto: state.decomposition.auto, startedAt: state.decomposition.startedAt, finishedAt, added, updated, summary: String(summary || '').slice(0, 500), ...(threadId ? { threadId } : {}) };
      if (added || updated) await this._save(state); else await this._saveMetadata(state);
      return this._public(state);
    });
  }

  async failDecomposition(id, { assetId, message } = {}) {
    return this._withProject(id, async () => {
      const state = await this._read(id);
      if (state.decomposition?.assetId !== assetId || state.decomposition.status !== 'running') return this._public(state);
      state.decomposition = { ...state.decomposition, status: 'failed', finishedAt: now(), error: String(message || '拆解沒有完成。').slice(0, 500) };
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
          await fs.mkdir(path.dirname(destination), { recursive: true });
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
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000) throw new DomainError('請輸入本次設計要求，長度不可超過 12000 字。');
      if (!['generate', 'refine', 'expand', 'sync'].includes(kind)) throw new DomainError('不支援這種設計工作。');
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
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 25 * 1024 * 1024) throw new DomainError('圖片不可為空，且必須小於 25 MB。');
      const actualMime = imageMime(buffer);
      if (!actualMime || (mimeType && actualMime !== mimeType)) throw new DomainError('請提供 PNG、JPEG、WebP 或 GIF 圖片，檔案內容須與格式相符。', 422, 'INVALID_IMAGE');
      if (!['design', 'reference'].includes(role)) throw new DomainError('圖片用途必須是 design 或 reference。');
      if (typeof name !== 'string' || name.length > 250) throw new DomainError('圖片名稱過長。');
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
      this._history(state, `採用${candidate.targetId === 'character' ? '角色設定稿' : `${state.character.components[candidate.targetId].name}${viewLabels[asset.view]}`}候選`);
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
      this._history(state, `恢復第 ${history.revision} 版設定`);
      await this._save(state);
      return this._public(state);
    });
  }

  async exportProject(id) {
    const state = await this.getProject(id);
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
    const manifest = { ...state, assets: [], canvasFile: 'canvas.json', exportedAt: now() };
    for (const asset of state.assets) {
      const assetPath = await this._assetPath(id, asset);
      const available = await exists(assetPath);
      const exportedPath = `images/${asset.id}${asset.source === 'demo' ? '.png' : mimeExtensions[asset.mimeType]}`;
      manifest.assets.push({ ...asset, ...(available ? { exportedPath } : { missing: true }) });
      if (available) archive.file(assetPath, { name: exportedPath });
    }
    const canvasAssetIds = new Set(state.canvasAnnotations.filter(annotation => annotation.kind === 'reference').map(annotation => annotation.assetId));
    const canvas = {
      schemaVersion: 1, projectId: state.id, exportedAt: manifest.exportedAt,
      annotations: state.canvasAnnotations,
      assets: manifest.assets.filter(asset => canvasAssetIds.has(asset.id)).map(({ id, name, mimeType, sha256, exportedPath, missing }) => ({ id, name, mimeType, sha256, ...(exportedPath ? { exportedPath } : { missing: Boolean(missing) }) })),
    };
    archive.append(JSON.stringify(canvas, null, 2), { name: 'canvas.json' });
    for (const job of state.jobs) {
      archive.append(job.context.yaml, { name: `jobs/${job.id}/input.yaml` });
      archive.append(JSON.stringify(job, null, 2), { name: `jobs/${job.id}/job.json` });
    }
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    await archive.finalize();
    return { buffer: await completed, name: `${state.id}-design-pack.zip` };
  }
}
