const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Runner, PROMPT_REVISION } = require('../core.cjs');
const key = 'codex-iq.pending.v1';
const config = { model: 'gpt-6-astra', effort: 'medium' };
const oldJob = () => ({ kind: 'detect', ...config, promptRevision: PROMPT_REVISION, threadId: 'old-thread', turnId: 'old-turn', stage: 'archiveFailed', startedAt: 1, result: { status: 'normal', version: '3', text: 'Gemini 3' } });

/** 模拟共享存储和不排队的 Web Locks；多个 Runner 必须通过同一把锁操作同一记录。 */
function environment(initial = null) {
  let value = initial && JSON.stringify(initial), held = false;
  return {
    storage: { getItem: () => value, setItem: (_, next) => { value = next; }, removeItem: () => { value = null; } },
    locks: { async request(_, options, action) {
      assert.equal(options.ifAvailable, true);
      if (held) return action(null);
      held = true;
      try { return await action({}); } finally { held = false; }
    } }
  };
}

/** 模型与归档边界均为内存响应，调用日志用来判定是否误发请求或误清理任务。 */
function bridge({ readError = false, archiveError = false } = {}) {
  const calls = [];
  return { calls, async request(method) {
    calls.push(method);
    if (method === 'thread/start') return { thread: { id: 'new-thread' }, model: config.model };
    if (method === 'thread/name/set') return {};
    if (method === 'turn/start') return { turn: { id: 'new-turn' } };
    if (method === 'thread/read') {
      if (readError) throw new Error('读取断网');
      return { thread: { turns: [{ id: 'new-turn', status: 'completed', items: [{ type: 'agentMessage', phase: 'final_answer', text: 'Gemini 3' }] }] } };
    }
    if (method === 'thread/archive') { if (archiveError) throw new Error('归档断网'); return {}; }
    throw new Error(`未模拟 ${method}`);
  } };
}

test('旧窗口收尾必须核对锁内新记录，不得覆盖或归档另一项任务', async () => {
  const env = environment(oldJob()), staleRpc = bridge();
  const stale = new Runner(staleRpc, env);
  await new Runner(bridge(), env).resume();
  await assert.rejects(new Runner(bridge({ readError: true }), env).run('detect', config), /读取断网/);
  const before = env.storage.getItem(key);
  await assert.rejects(stale.resume(), /任务已变化/);
  assert.equal(env.storage.getItem(key), before);
  assert.equal(stale.job.threadId, 'new-thread');
  assert.deepEqual(staleRpc.calls, []);
});

test('已被其他窗口归档的旧记录只刷新为空，不再次发归档请求', async () => {
  const env = environment(oldJob()), rpc = bridge();
  const stale = new Runner(rpc, env);
  await new Runner(bridge(), env).resume();
  await assert.rejects(stale.resume(), /任务已变化/);
  assert.equal(stale.job, null);
  assert.equal(env.storage.getItem(key), null);
  assert.deepEqual(rpc.calls, []);
});

test('清除未知创建记录也要互斥和身份核对，不能删除另一窗口的新任务', async () => {
  const env = environment({ ...oldJob(), threadId: null, turnId: null, result: null, stage: 'uncertain' });
  const stale = new Runner(bridge(), env);
  const owner = new Runner(bridge({ readError: true }), env);
  await owner.discard();
  await assert.rejects(owner.run('detect', config), /读取断网/);
  // 另一窗口已创建新任务；旧窗口所见的无 ID 创建记录不能授权删除它。
  const before = env.storage.getItem(key);
  await assert.rejects(stale.discard(), /任务已变化/);
  assert.equal(env.storage.getItem(key), before);
  await assert.rejects(stale.discard(), /任务 ID/);
});

test('跨窗口互斥覆盖全部请求流程，锁未获得时既不调用 RPC 也不写存储', async () => {
  const env = environment(), rpc = bridge();
  let release;
  const request = rpc.request.bind(rpc);
  rpc.request = method => method === 'thread/start' ? new Promise(resolve => { release = () => resolve({ thread: { id: 'new-thread' }, model: config.model }); }) : request(method);
  const first = new Runner(rpc, env).run('detect', config);
  const before = env.storage.getItem(key), secondRpc = bridge();
  await assert.rejects(new Runner(secondRpc, env).run('detect', config), /另一窗口/);
  assert.equal(env.storage.getItem(key), before);
  assert.deepEqual(secondRpc.calls, []);
  release(); await first;
});

test('结果归属跟随原任务：同账号重试保留，切账号和重载后的收尾不冒充当前结果', async () => {
  const env = environment(), rpc = bridge({ archiveError: true });
  let epoch = 0;
  const runner = new Runner(rpc, { ...env, getContext: () => epoch });
  await assert.rejects(runner.run('detect', config), /归档断网/);
  rpc.request = bridge().request;
  assert.equal((await runner.resume()).belongsToCurrentContext, true);
  rpc.request = bridge({ archiveError: true }).request;
  await assert.rejects(runner.run('detect', config), /归档断网/);
  epoch++;
  rpc.request = bridge().request;
  assert.equal((await runner.resume()).belongsToCurrentContext, false);
  env.storage.setItem(key, JSON.stringify(oldJob()));
  assert.equal((await new Runner(bridge(), { ...env, getContext: () => epoch }).resume()).belongsToCurrentContext, false);
});

test('无法读取共享状态或缺少互斥时不降级发起模型请求', async () => {
  const rpc = bridge(), env = environment();
  const runner = new Runner(rpc, env);
  env.storage.getItem = () => { throw new Error('blocked storage'); };
  await assert.rejects(runner.run('detect', config), /读取.*任务记录/);
  await assert.rejects(new Runner(rpc).run('detect', config), /互斥/);
  assert.deepEqual(rpc.calls, []);
});
