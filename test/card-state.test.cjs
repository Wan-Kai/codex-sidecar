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
