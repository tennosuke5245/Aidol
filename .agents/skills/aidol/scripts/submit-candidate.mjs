import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = {};
for (let index = 2; index < process.argv.length; index += 2) args[process.argv[index].replace(/^--/, '')] = process.argv[index + 1];

const loopback = url => {
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('回收位置必須是本機 AIDOL。');
  return url;
};

// 回報真實進度：started（開始產圖）、finished（全部完成）、failed（失敗，附 --message）。
async function report(handoff) {
  const url = loopback(new URL(handoff.progressUrl || handoff.submitUrl.replace(/\/submit$/, '/progress')));
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${handoff.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ event: args.event, ...(args.message ? { message: args.message } : {}) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `進度回報失敗（${response.status}）。`);
  process.stdout.write(`${JSON.stringify({ jobId: handoff.jobId, event: args.event, status: result.status })}\n`);
}

async function submit() {
  if (!args.job) throw new Error('請提供 --job 交接檔。');
  const handoff = JSON.parse(await readFile(args.job, 'utf8'));
  if (args.event) return report(handoff);
  if (!args.image) throw new Error('請提供 --image 產圖結果，或用 --event 回報進度。');
  const url = loopback(new URL(handoff.submitUrl));
  const data = await readFile(args.image);
  const hash = createHash('sha256').update(data).digest('hex');
  const manifest = {
    schemaVersion: 1, jobId: handoff.jobId, outfitId: handoff.outfitId, source: 'codex-app', threadId: args.thread || process.env.CODEX_THREAD_ID || null,
    outputs: [{ name: args.name || path.basename(args.image), view: args.view || handoff.outputView || 'front', sha256: hash }],
  };
  const form = new FormData();
  form.set('manifest', JSON.stringify(manifest));
  form.append('images', new Blob([data]), path.basename(args.image));
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${handoff.token}` }, body: form });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || `回收失敗（${response.status}）。`);
  process.stdout.write(`${JSON.stringify({ jobId: handoff.jobId, candidates: result.candidates, duplicate: result.duplicate || false })}\n`);
}

submit().catch(error => { process.stderr.write(`AIDOL：${error.message}\n`); process.exitCode = 1; });
