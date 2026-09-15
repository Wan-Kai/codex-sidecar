const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usageWindows, usageReset, UsageReader } = require('../core.cjs');
const reset = 1789811622;
const week = { usedPercent: 36, windowDurationMins: 10080, resetsAt: reset };
const snapshot = primary => ({ rateLimitsByLimitId: { codex: { primary } } });

test('周额度可位于 primary；百分比是剩余值，按时长命名并展示两种窗口', () => {
  assert.deepEqual(usageWindows(snapshot(week)), [{ key: 'primary', label: '本周额度', minutes: 10080, remaining: 64, resetsAt: reset }]);
  const response = { rateLimitsByLimitId: { codex: { primary: { usedPercent: 100, windowDurationMins: 300 }, secondary: week } } };
  assert.deepEqual(usageWindows(response).map(x => [x.label, x.remaining]), [['本周额度', 64], ['5 小时额度', 0]]);
});

test('多桶只用 codex，旧接口不误用 Spark 或其他模型额度', () => {
  const other = { limitId: 'codex_bengalfox', primary: week };
  assert.deepEqual(usageWindows({ rateLimitsByLimitId: { codex_bengalfox: other }, rateLimits: other }), []);
  assert.deepEqual(usageWindows({ rateLimits: other }), []);
  assert.equal(usageWindows({ rateLimits: { primary: week } })[0].remaining, 64);
  assert.equal(usageWindows({ rateLimitsByLimitId: { codex: { primary: week } }, rateLimits: other })[0].remaining, 64);
});

test('缺失用量不变成百分比，未知重置与时长不推断，越界百分比限制范围', () => {
  for (const usedPercent of [null, undefined, '0', NaN, Infinity]) assert.deepEqual(usageWindows(snapshot({ usedPercent })), []);
  assert.deepEqual(usageWindows({}), []);
  assert.deepEqual(usageWindows(snapshot({ usedPercent: 0 })), [{ key: 'primary', label: '额度', minutes: null, remaining: 100, resetsAt: null }]);
  assert.equal(usageWindows(snapshot({ usedPercent: -20 }))[0].remaining, 100);
  assert.equal(usageWindows(snapshot({ usedPercent: 120 }))[0].remaining, 0);
});

test('倒计时与准确北京时间一致，到期显示等待更新而不假定恢复', () => {
  assert.equal(usageReset(reset, (reset - (4 * 24 + 7) * 3600) * 1000).relative, '4 天 7 小时后重置');
  assert.match(usageReset(reset).absolute, /9月19日.*17:53.*北京时间/);
  assert.equal(usageReset(reset, reset * 1000).relative, '等待额度更新');
  assert.equal(usageReset(reset, (reset - 30) * 1000).relative, '不到 1 分钟后重置');
  assert.equal(usageReset(reset, (reset - 300) * 1000).relative, '5 分钟后重置');
  assert.deepEqual(usageReset(null), { relative: '重置时间暂不可用', absolute: '' });
});

test('刷新使用现有只读 RPC，合并重复请求，不保留账号或重置凭证信息', async () => {
  let resolve, calls = [];
  const reader = new UsageReader({ request(method, params) { calls.push({ method, params }); return new Promise(r => { resolve = r; }); } });
  const first = reader.refresh(), second = reader.refresh();
  assert.equal(first, second);
  await Promise.resolve();
  assert.deepEqual(calls, [{ method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } }]);
  resolve({ ...snapshot(week), accountId: 'private', rateLimitResetCredits: { credits: ['private'] } });
  await first;
  assert.equal(reader.state.status, 'ready');
  assert.equal(reader.state.windows[0].remaining, 64);
  assert.equal(JSON.stringify(reader.state).includes('private'), false);
});

test('账号切换先清空，旧请求迟到的成功或失败均不能覆盖新账号', async () => {
  for (const lateFailure of [false, true]) {
    const requests = [];
    const reader = new UsageReader({ request() { return new Promise((resolve, reject) => requests.push({ resolve, reject })); } });
    const old = reader.refresh(); await Promise.resolve();
    reader.clear(); assert.deepEqual(reader.state.windows, []);
    const current = reader.refresh(); await Promise.resolve();
    requests[1].resolve(snapshot({ ...week, usedPercent: 80 })); await current;
    if (lateFailure) requests[0].reject(new Error('旧账号网络失败')); else requests[0].resolve(snapshot(week));
    await old;
    assert.equal(reader.state.status, 'ready'); assert.equal(reader.state.windows[0].remaining, 20);
  }
});

test('刷新失败清除旧额度，重试可恢复；卸载后丢弃回包', async () => {
  let fail = false;
  const reader = new UsageReader({ async request() { if (fail) throw new Error('网络错误'); return snapshot(week); } });
  await reader.refresh(); fail = true; await reader.refresh();
  assert.equal(reader.state.status, 'error'); assert.deepEqual(reader.state.windows, []);
  fail = false; await reader.refresh(); assert.equal(reader.state.status, 'ready');
  const pending = reader.refresh(); reader.clear(); await pending;
  assert.equal(reader.state.status, 'loading'); assert.deepEqual(reader.state.windows, []);
});
