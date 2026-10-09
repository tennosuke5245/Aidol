import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const execute = promisify(execFile);
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
  constructor({ cwd = process.cwd(), spawnProcess = spawn, requestTimeout = 25000 } = {}) {
    super();
    this.cwd = cwd;
    this.spawnProcess = spawnProcess;
    this.requestTimeout = requestTimeout;
    this.pending = new Map();
    this.sequence = 0;
    this.starting = null;
  }

  async start() {
    if (this.starting) return this.starting;
    this.starting = this.#connect();
    try { await this.starting; } catch (error) { this.close(); throw error; }
  }

  async #connect() {
    this.closing = null;
    this.child = this.spawnProcess(codexCommand(), ['app-server'], {
      cwd: this.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
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
        this.child.stdin.write(`${JSON.stringify(result ? { id: message.id, result } : {
          id: message.id, error: { code: -32601, message: 'AIDOL 不支援此互動要求。' },
        })}\n`);
      } else this.emit('notification', message);
    });
    this.child.stderr.on('data', () => {}); // 不將帳號或驗證診斷送到 UI。
    this.child.on('error', error => this.#fail(error));
    this.child.on('exit', () => this.#fail(new Error('Codex 連線已結束。')));
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

  async freshTurn({ prompt, images = [], cwd = this.cwd, model, outputSchema, timeoutMs = 180000 }) {
    await this.start();
    const { thread } = await this.request('thread/start', {
      ...(model ? { model } : {}), cwd, approvalPolicy: 'never', sandbox: 'read-only',
      developerInstructions: '以繁體中文撰寫。這是 AIDOL 人物設計資料工作。只回傳指定描述，不修改檔案，不執行指令，不呼叫外部工具，不產生圖片。',
    });
    let stop;
    const completed = new Promise((resolve, reject) => {
      const textItems = new Map();
      const timer = setTimeout(() => {
        this.request('turn/interrupt', { threadId: thread.id, turnId: stop?.turnId }).catch(() => {});
        finish(new Error('角色描述工作逾時，結果尚未完成。'));
      }, timeoutMs);
      const listener = message => {
        if (message.params?.threadId !== thread.id) return;
        const { params, method } = message;
        if (method === 'item/agentMessage/delta') {
          textItems.set(params.itemId, (textItems.get(params.itemId) || '') + params.delta);
        }
        if (method === 'item/completed' && params.item?.type === 'agentMessage') textItems.set(params.item.id, params.item.text);
        if (method === 'turn/completed') {
          if (params.turn.status !== 'completed') finish(new Error(params.turn.error?.message || '角色描述工作未完成。'));
          else finish(null, [...textItems.values()].join('\n'));
        }
      };
      const disconnected = error => finish(error);
      const finish = (error, text) => {
        clearTimeout(timer); this.off('notification', listener); this.off('disconnected', disconnected);
        error ? reject(error) : resolve(text);
      };
      stop = { finish };
      this.on('notification', listener); this.on('disconnected', disconnected);
    });
    completed.catch(() => {});
    try {
      const { turn } = await this.request('turn/start', {
        // 圖片以本機路徑附上（app-server 的 localImage 輸入），只供讀圖分析。
        threadId: thread.id, input: [{ type: 'text', text: prompt }, ...images.map((file) => ({ type: 'localImage', path: file }))],
        ...(outputSchema ? { outputSchema } : {}),
      });
      stop.turnId = turn.id;
      const text = await completed;
      return { threadId: thread.id, turnId: turn.id, text };
    } catch (error) {
      stop.finish(error); completed.catch(() => {}); throw error;
    }
  }

  close() {
    if (this.closing) return this.closing;
    this.lines?.close();
    this.starting = null;
    const child = this.child;
    if (!child || child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve();
    this.closing = new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
    return this.closing;
  }
}
