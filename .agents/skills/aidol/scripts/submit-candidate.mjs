import { readFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const args = {};
for (let index = 2; index < process.argv.length; index += 2) args[process.argv[index].replace(/^--/, '')] = process.argv[index + 1];

const loopback = url => {
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('回收位置必須是本機 AIDOL。');
  return url;
};

// 直接連本機 AIDOL，不用 fetch：Bun 的 fetch 會照 HTTP_PROXY 把請求連同憑證交給代理（NO_PROXY=localhost 也擋不住 127.0.0.1），
// Node 設了 NODE_USE_ENV_PROXY 也會。node:http 加上自己的 agent 不經過代理。
function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || 80, path: `${url.pathname}${url.search}`, method: 'POST', agent: false, headers: { ...headers, 'Content-Length': body.length } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let json = {};
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 沒有 JSON 就當空的 */ }
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, json });
      });
    });
    request.on('error', reject);
    request.setTimeout(120000, () => request.destroy(new Error('連線逾時。')));
    request.end(body);
  });
}
function multipart(fields, files) {
  const boundary = `----aidol${randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const [name, value] of fields) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const { name, filename, data } of files) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename.replace(/["\r\n]/g, '_')}"\r\nContent-Type: application/octet-stream\r\n\r\n`), data, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

// 回報真實進度：started（開始產圖）、finished（全部完成）、failed（失敗，附 --message）。
async function report(handoff) {
  const url = loopback(new URL(handoff.progressUrl || handoff.submitUrl.replace(/\/submit$/, '/progress')));
  const response = await post(url, { Authorization: `Bearer ${handoff.token}`, 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({ event: args.event, ...(args.message ? { message: args.message } : {}) })));
  const result = response.json;
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
  const form = multipart([['manifest', JSON.stringify(manifest)]], [{ name: 'images', filename: path.basename(args.image), data }]);
  const response = await post(url, { Authorization: `Bearer ${handoff.token}`, 'Content-Type': form.type }, form.body);
  const result = response.json;
  if (!response.ok) throw new Error(result.error || result.message || `回收失敗（${response.status}）。`);
  process.stdout.write(`${JSON.stringify({ jobId: handoff.jobId, candidates: result.candidates, duplicate: result.duplicate || false })}\n`);
}

submit().catch(error => { process.stderr.write(`AIDOL：${error.message}\n`); process.exitCode = 1; });
