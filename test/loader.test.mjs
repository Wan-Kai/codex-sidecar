import { test } from 'node:test';
import assert from 'node:assert/strict';
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

/** 运行一轮真实 main/apply，网络完全替换；失效目标必须不影响下一窗口的挂载或移除。 */
async function checkTargetIsolation(remove) {
  const visited = [], expressions = [];
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, setTimeout, log: console.log };
  const listeners = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]));
  globalThis.fetch = async url => new Response(JSON.stringify(url.endsWith('/json/list') ? [
    { type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/bad' },
    { type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/healthy' }
  ] : { schemaVersion: 1, timezone: 'Asia/Shanghai', checkedAt: new Date().toISOString(), events: [] }));
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
  if (remove) assert.match(error?.message || '', /1.*窗口.*失败/);
  else assert.equal(error, undefined);
}

test('首个 CDP 窗口失效时仍给健康窗口注入并同步公共快照', () => checkTargetIsolation(false));
test('移除时尽力处理全部窗口，再报告部分失败，不能误报全部移除', () => checkTargetIsolation(true));
