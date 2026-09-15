const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyVersion, classifyAnswer, inspectTurn, inspectRecovery, createBridge, Runner, DETECT_PROMPT, RECOVER_PROMPT, selectableEfforts } = require('../core.cjs');
/** 单窗口协议测试使用立即取得的锁；跨窗口互斥由 runner-state 测试和 Chrome 检查覆盖。 */
const locks = { request: async (_, __, action) => action({}) };
const config = { model: 'gpt-6-astra', effort: 'medium' };

test('GPT-6 只展示五档，不把目录中的 Ultra 当作常规选项', () => {
  const supportedReasoningEfforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(reasoningEffort => ({ reasoningEffort }));
  assert.deepEqual(selectableEfforts({ model: 'gpt-6-astra', supportedReasoningEfforts }).map(e => e.reasoningEffort), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(selectableEfforts({ model: 'gpt-5.6-sol', supportedReasoningEfforts }).length, 6);
  assert.equal(supportedReasoningEfforts.length, 6);
  assert.deepEqual(selectableEfforts({ model: 'gpt-6-astra', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }), [{ reasoningEffort: 'medium' }]);
});
const finalTurn = text => ({ id: 'turn-1', status: 'completed', items: [{ id: 'a', type: 'agentMessage', phase: 'final_answer', text }] });
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

/** 模拟协议边界而非页面状态；调用日志可验证不重复发问和归档顺序。 */
function fixture(options = {}) {
  const calls = [];
  let archiveFailures = options.archiveFailures ?? 0;
  let reads = 0;
  const rpc = { async request(method, params) {
    calls.push({ method, params });
    switch (method) {
      case 'thread/start': return { thread: { id: 'thread-1' }, model: options.model ?? config.model };
      case 'thread/name/set': return {};
      case 'turn/start':
        if (options.startError) throw options.startError;
        return { turn: { id: 'turn-1', status: 'inProgress', items: [] } };
      case 'thread/read':
        reads++;
        if (options.readError && reads === 1) throw new Error('连接断开');
        return { thread: { turns: reads <= (options.runningReads ?? 0) ? [{ id: 'turn-1', status: 'inProgress', items: [] }] : [options.turn ?? finalTurn('3.1')] } };
      case 'thread/archive': if (archiveFailures-- > 0) throw new Error('归档失败'); return {};
      default: throw new Error(`Unexpected ${method}`);
    }
  } };
  const storage = memory();
  const runner = new Runner(rpc, { locks, storage, interval: 0 });
  return { rpc, runner, calls, storage };
}

test('按主版本判定：3 系列含 3. 正常，2 系列异常', () => {
  for (const value of ['3', '3.', ' 3. \n', '3.0', '3.0.0', '3.1', ' 3.1\n', '3.10', '3.1.1', '4', '10.0']) assert.equal(classifyVersion(value).status, 'normal', value);
  for (const value of ['2', '2.', '2.0', '2.5', '2.99', '2.99.99', '0.9']) assert.equal(classifyVersion(value).status, 'abnormal', value);
  for (const value of ['', 'Gemini 3.1', '3.1 或 3.0', '3.1\n3.2', '3.1.', '3..', '-3.1', 'NaN', '3.1-pro']) assert.equal(classifyVersion(value).status, 'unknown', value);
  assert.equal(classifyVersion('3. ').version, '3');
});

test('主版本省略小版本、自然语言和 Markdown 沿用同一判定', () => {
  for (const text of ['3', '3. ', 'Gemini 3.', '**Gemini 3**', '按我已有知识，Gemini 的最新版本是 Gemini 3.0。', '最新可确认的是 Gemini 3 系列。']) {
    assert.equal(classifyAnswer(text).status, 'normal', text);
  }
  for (const text of ['2', '2. ', 'Gemini 2.', '**Gemini 2.0**', '按我已有知识，Gemini 的最新版本是 Gemini 2.5。']) {
    assert.equal(classifyAnswer(text).status, 'abnormal', text);
  }
});

test('新规则贯穿独立请求与归档，工具项仍使 3. 回答无效', async () => {
  for (const [text, status] of [['3. ', 'normal'], ['Gemini 3.0', 'normal'], ['Gemini 2.5', 'abnormal']]) {
    const { runner, calls } = fixture({ turn: finalTurn(text) });
    const record = await runner.run('detect', config);
    assert.equal(record.result.status, status, text);
    assert.equal(record.result.text, text.trim());
    assert.equal(record.archived, true);
    assert.equal(calls.filter(c => c.method === 'turn/start').length, 1);
  }
  const turn = finalTurn('3.');
  turn.items.push({ type: 'webSearch', id: 'tool' });
  assert.equal(inspectTurn(turn, 'detect').status, 'unknown');
});

test('只判定最终回答，工具调用使检测无效', () => {
  const turn = finalTurn('3.1');
  turn.items.unshift({ type: 'agentMessage', phase: 'commentary', text: '我来想想' });
  assert.equal(inspectTurn(turn, 'detect').status, 'normal');
  turn.items.push({ type: 'webSearch', id: 'tool' });
  assert.equal(inspectTurn(turn, 'detect').status, 'unknown');
});

test('恢复校验数量、边界，不把完成当成检测正常', () => {
  const valid = Array(323).fill('355').join(', ');
  assert.equal(inspectRecovery(valid), true);
  assert.equal(inspectRecovery(Array(323).fill('18').join(' | ')), true);
  for (const invalid of [Array(322).fill('1').join(' '), valid.replace('355', '356'), valid.replace('355', '-1'), valid.replace('355', '1.5')]) assert.equal(inspectRecovery(invalid), false);
  assert.equal(inspectTurn(finalTurn(valid), 'recover').status, 'recovered');
});

test('独立创建→指定模型和思考→完整回答→归档；运行中不归档', async () => {
  const { runner, calls } = fixture({ runningReads: 2 });
  const record = await runner.run('detect', config);
  assert.equal(record.result.status, 'normal'); assert.equal(record.archived, true);
  assert.equal(runner.job, null);
  assert.deepEqual(calls.map(c => c.method), ['thread/start', 'thread/name/set', 'turn/start', 'thread/read', 'thread/read', 'thread/read', 'thread/archive']);
  const input = calls.find(c => c.method === 'turn/start').params;
  assert.equal(input.model, config.model); assert.equal(input.effort, 'medium');
  assert.equal(input.input[0].text, DETECT_PROMPT);
  assert.equal(DETECT_PROMPT, '不要调用任何外部工具，按你的已有知识，Gemini 的最新版本是什么？');
  assert.equal(input.input.length, 1);
  assert.equal(calls.find(c => c.method === 'thread/start').params.developerInstructions, undefined);
  assert.equal(input.outputSchema, undefined);
});

test('用户实测原文提取 2.5，不把日期或重复的 Pro / Flash 型号当作新版本', () => {
  const text = '按我已有知识，Gemini 最新可确认的是 **Gemini 2.5 系列**，包括 2.5 Pro 和 2.5 Flash。但我无法确认截至 2026 年 9 月是否已有更新版本；按你的要求，我没有调用外部工具。';
  const result = classifyAnswer(text);
  assert.equal(result.version, '2.5'); assert.equal(result.status, 'abnormal');
  assert.match(result.evidence, /最新可确认/);
});

test('自然语言、Markdown 和不带空格的型号可识别', () => {
  for (const text of ['Gemini 3.1', 'Gemini3.1', '**Gemini 3.1**', '我所知道的 Gemini 最新版本是 3.1。', '最新是 Gemini 3.10 Pro。', 'The latest Gemini version is 3.1.', 'Gemini：3.1']) {
    assert.equal(classifyAnswer(text).status, 'normal', text);
  }
});

test('不选择举例、否定、猜测或旧版中的较大数字', () => {
  for (const text of [
    '不是 Gemini 3.1，而是 Gemini 2.5。',
    '我最新能确认的是 Gemini 2.5。Gemini 3.1 是否发布，我无法确认。',
    '比如 Gemini 3.1 只是一个例子。最新版本是 Gemini 2.5。',
    'Gemini 3.1 尚未发布，目前最新是 Gemini 2.5。',
    'Gemini 最新是 2.5，Claude 最新是 3.5。'
  ]) assert.equal(classifyAnswer(text).version, '2.5', text);
});

test('多个冲突版本或没有明确版本时不猜测', () => {
  for (const text of ['最新可能是 Gemini 3.1。', '最新是 Gemini 2.5 或 Gemini 3.1。', '最新是 Gemini 2.5。最新是 Gemini 3.1。', '我无法确定 Gemini 的最新版本。', '我的知识截止到 2026 年 9 月。', '例如 Gemini 3.1。']) assert.equal(classifyAnswer(text).status, 'unknown', text);
});

test('旧提示的未完成任务可以归档，但不能算作新版正常结果', async () => {
  const { rpc, storage, calls } = fixture();
  storage.setItem('codex-iq.pending.v1', JSON.stringify({ kind: 'detect', ...config, threadId: 'thread-1', turnId: 'turn-1', stage: 'running', startedAt: Date.now() }));
  const record = await new Runner(rpc, { storage, locks }).resume();
  assert.equal(record.result.status, 'unknown'); assert.equal(record.archived, true);
  assert.equal(calls.some(c => c.method === 'turn/start'), false);
});

test('旧提示已经得到正常结果但归档失败时，收尾也必须使旧结论失效', async () => {
  const { rpc, storage, calls } = fixture();
  storage.setItem('codex-iq.pending.v1', JSON.stringify({ kind: 'detect', ...config, threadId: 'thread-1', turnId: 'turn-1', stage: 'archiveFailed', startedAt: Date.now(), result: { status: 'normal', version: '3.1', text: '3.1' } }));
  const record = await new Runner(rpc, { locks, storage }).resume();
  assert.equal(record.result.status, 'unknown');
  assert.equal(record.archived, true);
  assert.deepEqual(calls.map(c => c.method), ['thread/archive']);
});

test('升级后收尾按新阈值重算已确认版本，不改变工具无效结果', async () => {
  for (const [result, expected] of [
    [{ status: 'abnormal', version: '3.0', text: 'Gemini 3.0' }, 'normal'],
    [{ status: 'abnormal', version: '2.5', text: 'Gemini 2.5' }, 'abnormal'],
    [{ status: 'unknown', text: 'Gemini 3.0', detail: '出现工具执行项' }, 'unknown']
  ]) {
    const { rpc, storage, calls } = fixture();
    storage.setItem('codex-iq.pending.v1', JSON.stringify({ kind: 'detect', ...config, promptRevision: 'neutral-v2', threadId: 'thread-1', turnId: 'turn-1', stage: 'archiveFailed', startedAt: Date.now(), result }));
    const record = await new Runner(rpc, { locks, storage }).resume();
    assert.equal(record.result.status, expected);
    assert.equal(record.result.text, result.text);
    assert.equal(record.archived, true);
    assert.deepEqual(calls.map(c => c.method), ['thread/archive']);
  }
});

test('恢复发送用户的完整提示词给同一模型和思考档位', async () => {
  const { runner, calls } = fixture({ turn: finalTurn(Array(323).fill('155').join(' ')) });
  const record = await runner.run('recover', config);
  const input = calls.find(c => c.method === 'turn/start').params;
  assert.equal(input.input[0].text, RECOVER_PROMPT);
  assert.equal(input.model, config.model); assert.equal(input.effort, config.effort);
  assert.equal(record.result.status, 'recovered');
});

test('双击只能发起一次模型请求', async () => {
  const { runner, calls } = fixture();
  const first = runner.run('detect', config);
  await assert.rejects(runner.run('recover', config), /上一项任务/);
  await first;
  assert.equal(calls.filter(c => c.method === 'thread/start').length, 1);
});

test('另一个窗口留下的待收尾任务阻止新建', async () => {
  const { rpc, storage } = fixture();
  const second = new Runner(rpc, { locks, storage });
  storage.setItem('codex-iq.pending.v1', JSON.stringify({ threadId: 'other-window', stage: 'running' }));
  await assert.rejects(second.run('detect', config), /上一项任务/);
});

test('创建与发问之间切换账号时，不再发送提示词', async () => {
  const { rpc, calls } = fixture();
  let epoch = 0;
  const request = rpc.request;
  rpc.request = async (method, params) => { const result = await request(method, params); if (method === 'thread/name/set') epoch++; return result; };
  const runner = new Runner(rpc, { locks, getContext: () => epoch });
  await assert.rejects(runner.run('detect', config), /账号已切换/);
  assert.equal(calls.some(call => call.method === 'turn/start'), false);
});

test('归档失败保留回答，页面重载后仅重试归档', async () => {
  const { runner, rpc, storage, calls } = fixture({ archiveFailures: 1 });
  await assert.rejects(runner.run('detect', config), /归档失败/);
  assert.equal(runner.job.stage, 'archiveFailed');
  assert.equal(runner.job.result.version, '3.1');
  const restored = new Runner(rpc, { locks, storage });
  const record = await restored.resume();
  assert.equal(record.archived, true);
  assert.equal(calls.filter(c => c.method === 'turn/start').length, 1);
  assert.equal(calls.filter(c => c.method === 'thread/read').length, 1);
});

test('网络故障保留任务，不把失败当模型异常；恢复查询不重发', async () => {
  const { runner, calls } = fixture({ readError: true });
  await assert.rejects(runner.run('detect', config), /连接断开/);
  assert.equal(calls.some(c => c.method === 'thread/archive'), false);
  assert.equal((await runner.resume()).result.status, 'normal');
  assert.equal(calls.filter(c => c.method === 'turn/start').length, 1);
});

test('模型请求超时但已执行时，通过原任务 ID 找回答案', async () => {
  const error = Object.assign(new Error('turn/start 超时'), { uncertain: true });
  const { runner, calls } = fixture({ startError: error });
  await assert.rejects(runner.run('detect', config), /超时/);
  assert.equal(runner.job.stage, 'uncertain');
  assert.equal((await runner.resume()).result.status, 'normal');
  assert.equal(calls.filter(c => c.method === 'turn/start').length, 1);
});

test('模型回退不执行检测；失败回合完成后仍归档', async () => {
  const wrong = fixture({ model: 'other' });
  await assert.rejects(wrong.runner.run('detect', config), /模型不符/);
  assert.equal(wrong.calls.some(c => c.method === 'turn/start'), false);
  const failed = fixture({ turn: { ...finalTurn(''), status: 'failed', error: { message: '额度不足' } } });
  const record = await failed.runner.run('detect', config);
  assert.equal(record.result.status, 'error'); assert.equal(record.archived, true);
});

test('消息桥忽略其他 host 和 request ID，处理正常及错误响应', async () => {
  const win = new EventTarget();
  let sent;
  win.electronBridge = { async sendMessageFromView(data) { sent = data; } };
  const bridge = createBridge(win);
  const request = bridge.request('model/list', {});
  await Promise.resolve();
  assert.equal(sent.type, 'mcp-request');
  win.dispatchEvent(new MessageEvent('message', { data: { type: 'mcp-response', hostId: 'remote', message: { id: sent.request.id, result: 'wrong' } } }));
  win.dispatchEvent(new MessageEvent('message', { data: { type: 'mcp-response', hostId: 'local', message: { id: 'unrelated', result: 'wrong' } } }));
  win.dispatchEvent(new MessageEvent('message', { data: { type: 'mcp-response', hostId: 'local', message: { id: sent.request.id, result: { data: [] } } } }));
  assert.deepEqual(await request, { data: [] });
  const second = bridge.request('thread/start', {});
  await Promise.resolve();
  win.dispatchEvent(new MessageEvent('message', { data: { type: 'mcp-response', hostId: 'local', message: { id: sent.request.id, error: { code: -1, message: '失败' } } } }));
  await assert.rejects(second, /失败/); bridge.dispose();
});
