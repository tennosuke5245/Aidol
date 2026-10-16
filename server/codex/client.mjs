import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const execute = promisify(execFile);
// 關掉 app-server。Windows 上連它開的子程序（指令、MCP 伺服器）一起結束，不留下還佔著資料夾的孤兒程序。
function stopProcess(child) {
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => { if (error) child.kill(); });
  } else child.kill();
}
const abortError = () => Object.assign(new Error('已停下。'), { name: 'AbortError', code: 'ABORTED' });
// 被訊號結束的程序 exitCode 仍是 null，要一起看 signalCode。
const exited = (child) => child.exitCode != null || child.signalCode != null;
export function codexCommand() {
  if (process.env.AIDOL_CODEX_BINARY) return process.env.AIDOL_CODEX_BINARY;
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const base = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const candidates = readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(base, entry.name, executable)).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      if (candidates.length) return candidates[0];
    } catch {}
  }
  return executable;
}

export async function codexVersion() {
  const { stdout } = await execute(codexCommand(), ['--version'], { windowsHide: true, timeout: 10000 });
  return stdout.trim();
}

// 一個 stdio 連線可以處理多個互相獨立的工作；工作絕不 resume 或 fork。
export class CodexClient extends EventEmitter {
  constructor({ cwd = process.cwd(), spawnProcess = spawn, terminate = stopProcess, requestTimeout = 25000 } = {}) {
    super();
    this.cwd = cwd;
    this.spawnProcess = spawnProcess;
    this.terminate = terminate;
    this.requestTimeout = requestTimeout;
    this.pending = new Map();
    this.sequence = 0;
    this.starting = null;
    this.activeTurns = 0;
  }

  get running() { return Boolean(this.child) && !exited(this.child) && !this.closing; }
  get busy() { return this.activeTurns > 0 || this.pending.size > 0; }

  // 讓 app-server 放開它碰過的資料夾：閒著就整個重開（下次要用時自動再連）；
  // 正在幫別的工作跑就不打斷，回報 busy。回傳 'none'（本來就沒在跑）、'released' 或 'busy'。
  async release({ waitMs = 2000 } = {}) {
    if (!this.running) return 'none';
    // 短暫的查詢（例如狀態、模型清單）等它回來就好；對話或拆解要等很久，不等。
    for (const until = Date.now() + waitMs; !this.activeTurns && this.pending.size && Date.now() < until;) await new Promise((resolve) => setTimeout(resolve, 50));
    if (this.busy) return 'busy';
    await this.close();
    return 'released';
  }

  async start() {
    if (this.starting) return this.starting;
    this.starting = this.#connect();
    try { await this.starting; } catch (error) { this.close(); throw error; }
  }

  async #connect() {
    this.closing = null;
    const child = this.spawnProcess(codexCommand(), ['app-server'], {
      cwd: this.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (Object.hasOwn(message, 'id') && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(message.error.message || 'Codex 要求失敗。'));
        else pending.resolve(message.result);
      } else if (message.method && Object.hasOwn(message, 'id')) {
        // 本整合僅讀取與生成描述，不准 agent 擴張到需核准的操作。
        const result = message.method.includes('requestApproval') ? { decision: 'decline' } : null;
        child.stdin.write(`${JSON.stringify(result ? { id: message.id, result } : {
          id: message.id, error: { code: -32601, message: 'AIDOL 不支援此互動要求。' },
        })}\n`);
      } else this.emit('notification', message);
    });
    this.child.stderr.on('data', () => {}); // 不將帳號或驗證診斷送到 UI。
    // 重開後，舊程序晚到的結束事件不能把新連線上的工作一起判失敗。
    child.on('error', error => { if (this.child === child) this.#fail(error); });
    child.on('exit', () => { if (this.child === child) this.#fail(new Error('Codex 連線已結束。')); });
    await this.request('initialize', { clientInfo: { name: 'aidol', title: 'AIDOL 角色設計工作室', version: '0.1.0' }, capabilities: {} });
    this.notify('initialized', {});
  }

  #fail(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.pending.clear();
    this.starting = null;
    this.emit('disconnected', error);
  }

  request(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} 回應逾時，請稍後重試。`));
      }, this.requestTimeout);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (error) { clearTimeout(timeout); this.pending.delete(id); reject(error); }
      });
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async freshTurn(options) {
    this.activeTurns++;
    try { return await this.#turn(options); } finally { this.activeTurns--; }
  }

  // draw：畫圖工作。只有這種對話開放 Codex 內建的圖片生成工具；圖從 imageGeneration 項目直接收（base64），
  // 不靠 agent 執行指令或回傳檔案。onImage 每畫好一張就呼叫一次；signal 中止時打斷這一輪。
  async #turn({ prompt, images = [], cwd = this.cwd, model, outputSchema, timeoutMs = 180000, draw = false, onImage, onImageStarted, signal }) {
    if (signal?.aborted) throw abortError();
    await this.start();
    const { thread } = await this.request('thread/start', {
      ...(model ? { model } : {}), cwd, approvalPolicy: 'never', sandbox: 'read-only',
      developerInstructions: draw
        ? '以繁體中文撰寫。這是 AIDOL 的畫圖工作。只用內建的圖片生成工具畫圖，把附上的參考圖交給它；不要執行指令、不要改檔案、不要使用任何腳本、外掛或 API key。畫完用一句話說明畫了幾張，不要做別的事。'
        : '以繁體中文撰寫。這是 AIDOL 人物設計資料工作。只回傳指定描述，不修改檔案，不執行指令，不呼叫外部工具，不產生圖片。',
    });
    let stop;
    const completed = new Promise((resolve, reject) => {
      const textItems = new Map();
      const drawn = [];
      const timer = setTimeout(() => {
        this.request('turn/interrupt', { threadId: thread.id, turnId: stop?.turnId }).catch(() => {});
        finish(new Error(draw ? '畫圖逾時，結果尚未完成。' : '角色描述工作逾時，結果尚未完成。'));
      }, timeoutMs);
      const listener = message => {
        if (message.params?.threadId !== thread.id) return;
        const { params, method } = message;
        if (method === 'item/agentMessage/delta') {
          textItems.set(params.itemId, (textItems.get(params.itemId) || '') + params.delta);
        }
        if (method === 'item/completed' && params.item?.type === 'agentMessage') textItems.set(params.item.id, params.item.text);
        if (draw && method === 'item/started' && params.item?.type === 'imageGeneration') onImageStarted?.();
        if (draw && method === 'item/completed' && params.item?.type === 'imageGeneration') {
          const item = params.item;
          const image = { id: item.id, result: typeof item.result === 'string' ? item.result : '', savedPath: item.savedPath || null, revisedPrompt: item.revisedPrompt || null, status: item.status || null, failure: item.failure || null };
          drawn.push(image);
          onImage?.(image);
        }
        if (method === 'turn/completed') {
          if (params.turn.status !== 'completed') finish(Object.assign(new Error(params.turn.error?.message || (draw ? '這次沒有畫完。' : '角色描述工作未完成。')), { images: drawn, turnError: params.turn.error || null }));
          else finish(null, [...textItems.values()].join('\n'), drawn);
        }
      };
      const disconnected = error => finish(error);
      const aborted = () => {
        this.request('turn/interrupt', { threadId: thread.id, turnId: stop?.turnId }).catch(() => {});
        finish(abortError());
      };
      const finish = (error, text, result = drawn) => {
        clearTimeout(timer); this.off('notification', listener); this.off('disconnected', disconnected); signal?.removeEventListener('abort', aborted);
        error ? reject(error) : resolve({ text, images: result });
      };
      stop = { finish };
      this.on('notification', listener); this.on('disconnected', disconnected); signal?.addEventListener('abort', aborted, { once: true });
      // thread/start 還沒回來時就按了停下：那時加的監聽不會再觸發，這裡直接當作停下。
      if (signal?.aborted) aborted();
    });
    completed.catch(() => {});
    // 已經停下就不開始這一輪（thread 開好了沒關係，不會花額度）。
    if (signal?.aborted) { stop.finish(abortError()); throw abortError(); }
    try {
      const { turn } = await this.request('turn/start', {
        // 圖片以本機路徑附上（app-server 的 localImage 輸入）：讀圖分析，或畫圖時當參考圖。
        threadId: thread.id, input: [{ type: 'text', text: prompt }, ...images.map((file) => ({ type: 'localImage', path: file }))],
        ...(outputSchema ? { outputSchema } : {}),
      });
      stop.turnId = turn.id;
      // 在 turn/start 回來之前就按了停下：那時還沒有 turn id，現在補打斷一次。
      if (signal?.aborted) this.request('turn/interrupt', { threadId: thread.id, turnId: turn.id }).catch(() => {});
      const { text, images: drawnImages } = await completed;
      return { threadId: thread.id, turnId: turn.id, text, ...(draw ? { images: drawnImages } : {}) };
    } catch (error) {
      stop.finish(error); completed.catch(() => {});
      if (error && typeof error === 'object') error.threadId ??= thread.id;
      throw error;
    }
  }

  close() {
    if (this.closing) return this.closing;
    this.lines?.close();
    this.starting = null;
    const child = this.child;
    if (!child || exited(child)) return Promise.resolve();
    this.closing = new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      this.terminate(child);
    });
    return this.closing;
  }
}
