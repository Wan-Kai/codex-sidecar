import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { isCodexPage, localSocket, managedExpired, main } from '../load.mjs';

test('加载器只允许已识别的本机 Codex 主页面', () => {
  assert.equal(isCodexPage({ type: 'page', url: 'app://-/index.html' }), true);
  assert.equal(isCodexPage({ type: 'page', url: 'file:///Applications/ChatGPT.app/Contents/Resources/app.asar/webview/index.html?initialRoute=x' }), true);
  assert.equal(isCodexPage({ type: 'page', url: 'file:///Applications/Codex.app/Contents/Resources/app.asar/webview/index.html' }), true);
  assert.equal(isCodexPage({ type: 'page', url: 'file:///Applications/Other.app/Contents/Resources/app.asar/webview/index.html' }), false);
  for (const url of ['https://chatgpt.com', 'http://127.0.0.1:8741/test.html', 'app://-/auth.html', 'app://other/index.html']) assert.equal(isCodexPage({ type: 'page', url }), false);
  assert.equal(isCodexPage({ type: 'iframe', url: 'app://-/index.html' }), false);
});

test('调试地址不可指向远端或其他端口', () => {
  assert.equal(localSocket('ws://127.0.0.1:9222/devtools/page/abc', 9222), 'ws://127.0.0.1:9222/devtools/page/abc');
  for (const url of ['ws://example.com:9222/x', 'ws://127.0.0.1:4444/x', 'wss://127.0.0.1:9222/x', 'ws://user:pass@localhost:9222/x']) assert.throws(() => localSocket(url, 9222));
});

test('后台启动宽限 45 秒，断开应用后宽限 15 秒；不会无限空转', () => {
  assert.equal(managedExpired(1000, null, 45999), false);
  assert.equal(managedExpired(1000, null, 46000), true);
  assert.equal(managedExpired(1000, 50000, 64999), false);
  assert.equal(managedExpired(1000, 50000, 65000), true);
});

/**
 * 运行一轮真实 main/apply，网络完全替换；失效目标不能影响下一窗口，心跳不能自行查询。
 * @param {boolean} remove 是否验证移除模式；否则验证挂载和快照同步。
 * @returns {Promise<void>} 断言通过后完成；隔离或刷新行为不符时抛出断言错误。
 */
async function checkTargetIsolation(remove) {
  const visited = [], expressions = [], feeds = [];
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, setTimeout, log: console.log };
  const listeners = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]));
  globalThis.fetch = async url => { if (!url.endsWith('/json/list')) feeds.push(url); return new Response(JSON.stringify(url.endsWith('/json/list') ? [
    { type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/bad' },
    { type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/healthy' }
  ] : { schemaVersion: 1, timezone: 'Asia/Shanghai', checkedAt: new Date().toISOString(), events: [] })); };
  globalThis.WebSocket = class extends EventTarget {
    constructor(url) { super(); this.url = url; visited.push(url); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(raw) {
      if (this.url.endsWith('/bad')) throw new Error('模拟第一个窗口已失效');
      const { id, params } = JSON.parse(raw); expressions.push(params.expression);
      const value = params.expression.startsWith('typeof ') ? true : remove ? '卡片已移除' : JSON.stringify({ mounted: true, resetRefresh: false });
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result: { result: { value } } }) })));
    }
    close() { this.dispatchEvent(new Event('close')); }
  };
  globalThis.setTimeout = (fn, ms, ...args) => ms === 2500 ? original.setTimeout(() => { process.emit('SIGTERM'); fn(...args); }, 0) : original.setTimeout(fn, ms, ...args);
  const logs = []; console.log = (...args) => logs.push(args.join(' '));
  let error;
  try { await main(remove ? ['--remove'] : ['--managed']); } catch (value) { error = value; }
  finally {
    globalThis.fetch = original.fetch; globalThis.WebSocket = original.WebSocket; globalThis.setTimeout = original.setTimeout; console.log = original.log;
    for (const [signal, previous] of listeners) for (const listener of process.listeners(signal)) if (!previous.includes(listener)) process.removeListener(signal, listener);
  }
  assert.deepEqual(visited, ['ws://127.0.0.1:9222/bad', 'ws://127.0.0.1:9222/healthy']);
  assert.ok(expressions.some(expression => remove ? expression.includes('dispose()') : expression.includes('updateReset')));
  assert.ok(logs.some(line => line.includes('模拟第一个窗口已失效')));
  assert.equal(feeds.length, 0, '没有额度刷新意图时，只同步快照，不独立查询 Tibo');
  if (remove) assert.match(error?.message || '', /1.*窗口.*失败/);
  else assert.equal(error, undefined);
}

test('首个 CDP 窗口失效时仍给健康窗口注入并同步公共快照', () => checkTargetIsolation(false));
test('移除时尽力处理全部窗口，再报告部分失败，不能误报全部移除', () => checkTargetIsolation(true));

/** 本地 VM 执行真正的 apply 表达式，验证额度意图经过加载器读取后能把新快照送回卡片。 */
test('额度刷新意图驱动公共请求，下轮送回快照；一分钟后能再次查询', async () => {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, setTimeout, now: Date.now, log: console.log };
  const listeners = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]));
  let round = 0, reads = 0, clock = original.now();
  const initial = clock, snapshots = [];
  const context = { window: { electronBridge: { sendMessageFromView() {} }, __codexIQCard: {
    version, mounted: true, pending: false,
    updateReset(state) { snapshots.push(state); }, takeResetRefresh() { return round === 1 || round === 3; }
  } } };
  Date.now = () => clock;
  globalThis.fetch = async url => {
    if (url.endsWith('/json/list')) {
      round++; if (round === 3) clock = initial + 60000;
      return Response.json([{ type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/test' }]);
    }
    assert.equal(url, 'https://aihot.news/api/v1/codex-resets'); reads++;
    return Response.json({ schemaVersion: 1, timezone: 'Asia/Shanghai', checkedAt: new Date(clock).toISOString(), events: [] });
  };
  globalThis.WebSocket = class extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(raw) {
      const { id, params } = JSON.parse(raw), value = vm.runInNewContext(params.expression, context);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result: { result: { value } } }) })));
    }
    close() { this.dispatchEvent(new Event('close')); }
  };
  globalThis.setTimeout = (fn, ms, ...args) => ms === 2500 ? original.setTimeout(() => { if (round === 4) process.emit('SIGTERM'); fn(...args); }, 0) : original.setTimeout(fn, ms, ...args);
  console.log = () => {};
  try { await main(['--managed']); }
  finally {
    globalThis.fetch = original.fetch; globalThis.WebSocket = original.WebSocket; globalThis.setTimeout = original.setTimeout;
    Date.now = original.now; console.log = original.log;
    for (const [signal, previous] of listeners) for (const listener of process.listeners(signal)) if (!previous.includes(listener)) process.removeListener(signal, listener);
  }
  assert.equal(reads, 2); assert.equal(snapshots.length, 4);
  assert.equal(snapshots[1].status, 'ready'); assert.equal(snapshots[1].snapshot.checkedAt, initial);
  assert.equal(snapshots[3].status, 'ready'); assert.equal(snapshots[3].snapshot.checkedAt, initial + 60000);
});
