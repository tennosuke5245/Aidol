import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexClient } from '../server/codex/client.mjs';

function fakeServer() {
  const requests = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const reply = value => child.stdout.write(`${JSON.stringify(value)}\n`);
  let threads = 0;
  child.stdin = new Writable({ write(buffer, _encoding, callback) {
    const message = JSON.parse(buffer.toString()); requests.push(message);
    if (message.id) {
      let result = {};
      if (message.method === 'thread/start') result = { thread: { id: `fresh-${++threads}` } };
      if (message.method === 'turn/start') {
        result = { turn: { id: `turn-${threads}` } };
        // 模擬 turn event 比 RPC response 更快，不能漏掉完成事件。
        reply({ method: 'item/agentMessage/delta', params: { threadId: message.params.threadId, itemId: `item-${threads}`, delta: '草案' } });
        reply({ method: 'item/completed', params: { threadId: message.params.threadId, item: { id: `item-${threads}`, type: 'agentMessage', text: '完整草案' } } });
        reply({ method: 'turn/completed', params: { threadId: message.params.threadId, turn: { id: `turn-${threads}`, status: 'completed' } } });
      }
      reply({ id: message.id, result });
    }
    callback();
  } });
  child.kill = () => { child.stdout.end(); child.emit('exit', 0); };
  return { requests, child, spawnProcess: () => child };
}

test('每次角色修訂建立不同 thread，且完成事件不受回應先後影響', async () => {
  const fake = fakeServer(); const client = new CodexClient({ spawnProcess: fake.spawnProcess });
  try {
    const first = await client.freshTurn({ prompt: '新增髮夾' });
    const second = await client.freshTurn({ prompt: '移除腰包' });
    assert.notEqual(first.threadId, second.threadId);
    assert.equal(first.text, '完整草案');
    assert.equal(second.text, '完整草案');
    assert.equal(fake.requests.filter(x => x.method === 'initialize').length, 1);
    const starts = fake.requests.filter(x => x.method === 'thread/start');
    assert.equal(starts.length, 2);
    assert.ok(starts.every(x => x.params.sandbox === 'read-only' && x.params.approvalPolicy === 'never'));
    assert.ok(fake.requests.every(x => !['thread/resume', 'thread/fork'].includes(x.method)));
  } finally { client.close(); }
});

test('連線終止會釋放尚未完成要求', async () => {
  const fake = fakeServer(); const client = new CodexClient({ spawnProcess: fake.spawnProcess });
  await client.start();
  fake.child.stdin = new Writable({ write(_buffer, _encoding, callback) { callback(); } });
  const pending = client.request('account/read');
  fake.child.emit('exit', 1);
  await assert.rejects(pending, /連線已結束/);
  assert.equal(client.pending.size, 0);
  client.close();
});

test('讀圖工作把本機圖片以 localImage 附在同一個新 thread 的輸入裡', async () => {
  const fake = fakeServer(); const client = new CodexClient({ spawnProcess: fake.spawnProcess });
  try {
    await client.freshTurn({ prompt: '拆解裝備', images: ['/tmp/portrait.png'] });
    const turn = fake.requests.find(x => x.method === 'turn/start');
    assert.deepEqual(turn.params.input, [{ type: 'text', text: '拆解裝備' }, { type: 'localImage', path: '/tmp/portrait.png' }]);
    assert.equal(fake.requests.find(x => x.method === 'thread/start').params.sandbox, 'read-only');
  } finally { client.close(); }
});
