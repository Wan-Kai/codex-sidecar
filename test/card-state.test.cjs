const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const core = require('../core.cjs');
const reset = require('../tibo.cjs');

/** 最小 DOM 替身只承接界面写入；实际状态转换仍执行未经修改的完整 card.js。 */
class Element {
  constructor() { this.nodes = new Map(); this.style = {}; this.dataset = {}; this.hidden = false; this.isConnected = false; }
  querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Element()); return this.nodes.get(selector); }
  getElementById(id) { return this.querySelector(id); }
  attachShadow() { return this.shadow = new Element(); }
  setAttribute() {} removeAttribute() {} replaceChildren() {} remove() {}
}

/** 载入账号 A 的待归档回答，发出切账号通知，再点击正式界面的收尾按钮。
 * 模型目录、额度和归档均为内存 RPC；不创建 Codex 任务，也不连接宿主。
 */
async function reproduce() {
  const nodes = [];
  const document = { hidden: false, documentElement: new Element(), createElement() { const value = new Element(); nodes.push(value); return value; },
    querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {} };
  const values = new Map([['codex-iq.pending.v1', JSON.stringify({ kind: 'detect', model: 'gpt-6-astra', effort: 'medium',
    promptRevision: core.PROMPT_REVISION, threadId: 'account-A-thread', turnId: 'turn-A', stage: 'archiveFailed', startedAt: Date.now(),
    result: { status: 'normal', version: '3', text: 'Account A answer: Gemini 3' } })]]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let notification;
  const rpc = { subscribe(fn) { notification = fn; return () => {}; }, dispose() {}, async request(method) {
    if (method === 'model/list') return { data: [{ model: 'gpt-6-astra', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }] };
    if (method === 'account/rateLimits/read' || method === 'thread/archive') return {};
    throw new Error(`不允许未模拟的 RPC：${method}`);
  } };
  const window = { localStorage: storage, CodexIQCore: { ...core, createBridge: () => rpc }, CodexIQReset: reset };
  const sandbox = { window, document, navigator: { locks: { request: async (_, __, callback) => callback({}) } },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, Date, console };
  vm.runInNewContext(readFileSync(join(__dirname, '../card.js'), 'utf8'), sandbox);
  await new Promise(setImmediate);
  notification('account/updated');
  await new Promise(setImmediate);
  const root = nodes[0].shadow;
  root.getElementById('cleanup').onclick();
  await new Promise(setImmediate);
  const status = root.getElementById('status').textContent;
  const answer = root.getElementById('answer').textContent;
  assert.equal(status, '需检查');
  assert.equal(answer, '');
  assert.match(root.getElementById('info').textContent, /原任务已归档/);
}

test('切账号后点击正式收尾按钮，不把原账号的答案显示为当前结果', reproduce);

/** 用真实卡片入口和可控时钟重现后台静默，再验证新快照与接口失败各自恢复正确文案。 */
test('后台超过 45 秒未同步显示进行中，重新同步后恢复消息或真实读取错误', async () => {
  let clock = Date.now();
  const initial = clock, nodes = [], intervals = new Map();
  const document = { hidden: false, documentElement: new Element(), createElement() { const value = new Element(); nodes.push(value); return value; },
    querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {} };
  const window = { localStorage: { getItem: () => null }, CodexIQCore: { ...core, createBridge: () => ({
    subscribe: () => () => {}, dispose() {}, async request(method) {
      if (method === 'model/list') return { data: [{ model: 'gpt-6-astra', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }] };
      if (method === 'account/rateLimits/read') return {};
      throw new Error(`不允许未模拟的 RPC：${method}`);
    }
  }) }, CodexIQReset: reset };
  vm.runInNewContext(readFileSync(join(__dirname, '../card.js'), 'utf8'), {
    window, document, navigator: { locks: {} },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(),
    setTimeout: () => 1, clearTimeout() {}, setInterval(fn, ms) { intervals.set(ms, fn); return ms; }, clearInterval() {},
    Date: class extends Date { static now() { return clock; } }, console
  });
  await new Promise(setImmediate);
  const root = nodes[0].shadow;
  const ready = { status: 'ready', snapshot: { checkedAt: initial, events: [] } };
  window.__codexIQCard.updateReset(ready);
  clock += 45000; intervals.get(15000)();
  assert.equal(root.getElementById('tibo-state').textContent, '暂无新预告');
  clock++; intervals.get(15000)();
  assert.equal(root.getElementById('tibo-state').textContent, '进行中');
  assert.equal(root.getElementById('tibo').dataset.state, 'syncing');
  assert.equal(root.getElementById('tibo-description').textContent, '正在等待后台同步重置消息。');
  assert.equal(root.innerHTML.includes('id="tibo-retry"'), false);
  window.__codexIQCard.updateReset(ready);
  assert.equal(root.getElementById('tibo-state').textContent, '暂无新预告');
  window.__codexIQCard.updateReset({ ...ready, status: 'error' });
  assert.equal(root.getElementById('tibo-state').textContent, '暂时无法读取');
  assert.equal(root.getElementById('tibo').dataset.state, 'error');
});

/** 执行正式卡片的所有额度刷新入口，验证它们共用 Tibo 意图且不依赖任一接口成功。 */
test('额度首次、定时、可见、通知、账号与手动刷新均联动 Tibo，并合并进行中的请求', async () => {
  const nodes = [], intervals = new Map(), timers = new Map(), events = new Map();
  let notification, finishUsage, reads = 0;
  const document = { hidden: false, documentElement: new Element(), createElement() { const value = new Element(); nodes.push(value); return value; },
    querySelectorAll: () => [], addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  const rpc = { subscribe(fn) { notification = fn; return () => {}; }, dispose() {}, request(method) {
    if (method === 'model/list') return Promise.resolve({ data: [{ model: 'gpt-6-astra', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }] });
    assert.equal(method, 'account/rateLimits/read'); reads++;
    return new Promise((resolve, reject) => { finishUsage = fail => fail ? reject(new Error('额度不可用')) : resolve({}); });
  } };
  const window = { localStorage: { getItem: () => null }, CodexIQCore: { ...core, createBridge: () => rpc }, CodexIQReset: reset };
  vm.runInNewContext(readFileSync(join(__dirname, '../card.js'), 'utf8'), {
    window, document, navigator: { locks: {} }, Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(),
    setTimeout(fn, ms) { timers.set(ms, fn); return ms; }, clearTimeout: id => timers.delete(id),
    setInterval(fn, ms) { intervals.set(ms, fn); return ms; }, clearInterval: id => intervals.delete(id), Date, console
  });
  await new Promise(setImmediate);
  const card = window.__codexIQCard, root = nodes[0].shadow;
  assert.equal(reads, 1); assert.equal(card.takeResetRefresh(), true); assert.equal(card.takeResetRefresh(), false);
  assert.equal(root.innerHTML.includes('id="tibo-retry"'), false);
  // 同一次额度请求未完成时，不因定时器和点击叠加产生额外公共消息请求。
  intervals.get(60000)(); root.getElementById('quota-refresh').onclick();
  await new Promise(setImmediate);
  assert.equal(reads, 1); assert.equal(card.takeResetRefresh(), false);
  finishUsage(false); await new Promise(setImmediate);
  const triggers = [() => intervals.get(60000)(), () => events.get('visibilitychange')(),
    () => { notification('account/rateLimits/updated'); notification('account/rateLimits/updated'); timers.get(1000)(); },
    () => notification('account/updated'), () => root.getElementById('quota-refresh').onclick()];
  for (const trigger of triggers) {
    const before = reads;
    card.updateReset({ status: 'error', snapshot: null });
    trigger(); await new Promise(setImmediate);
    assert.equal(reads, before + 1); assert.equal(card.takeResetRefresh(), true); assert.equal(card.takeResetRefresh(), false);
    finishUsage(true); await new Promise(setImmediate);
    // 额度失败不能盖掉成功同步的 Tibo 消息，刷新入口也必须可重用。
    card.updateReset({ status: 'ready', snapshot: { checkedAt: Date.now(), events: [] } });
    assert.equal(root.getElementById('tibo-state').textContent, '暂无新预告');
    assert.equal(root.getElementById('quota-refresh').disabled, false);
  }
  const before = reads;
  document.hidden = true; intervals.get(60000)(); events.get('visibilitychange')(); notification('account/rateLimits/updated');
  await new Promise(setImmediate);
  assert.equal(reads, before); assert.equal(card.takeResetRefresh(), false);
});
