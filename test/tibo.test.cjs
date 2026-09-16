const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resetSnapshot, resetView, ResetFeed, RESET_URL } = require('../tibo.cjs');
const now = Date.parse('2026-09-15T11:00:00+08:00');
const iso = value => new Date(value).toISOString();
const event = changes => ({ type: 'direct_reset', status: 'announced', createdAt: iso(now - 3600000), updatedAt: iso(now - 3600000), confirmedAt: null, occurredOn: null, schedule: null, scope: '', posts: [], ...changes });
const data = events => ({ schemaVersion: 1, timezone: 'Asia/Shanghai', checkedAt: iso(now), events });
const ready = events => ({ status: 'ready', snapshot: resetSnapshot(data(events)) });
const schedule = (from, through = from, precision = 'exact') => ({ from: iso(from), through: iso(through), precision });
const confirmation = time => event({ status: 'confirmed', createdAt: iso(time - 3600000), updatedAt: iso(time), confirmedAt: iso(time), schedule: schedule(time - 3600000) });
const response = (events, headers = {}) => new Response(JSON.stringify(data(events)), { headers });

test('未来预告按最早时间选取；全部时间使用北京时间，截止/范围不伪装成执行时间', () => {
  const events = [event({ schedule: schedule(now + 7200000) }), event({ schedule: schedule(now + 3600000, now + 5400000, 'window') })];
  assert.equal(resetView(ready(events), now).time, '预计 9月15日 12:00–12:30');
  assert.match(resetView(ready([event({ schedule: schedule(now + 3600000, now + 3600000, 'deadline') })]), now).time, /12:00 前/);
  assert.match(resetView(ready([event({ schedule: schedule(now + 3600000, now + 3600000, 'approximate') })]), now).time, /^约 /);
  assert.equal(resetView(ready([event()]), now).time, '重置时间待公布');
});

test('过期历史预告不作为下一次，新的过期预告只显示待确认', () => {
  const old = event({ createdAt: iso(now - 7 * 86400000), schedule: schedule(now - 7 * 86400000) });
  const history = confirmation(now - 3 * 86400000);
  const view = resetView(ready([old, history]), now);
  assert.equal(view.label, '暂无新预告'); assert.equal(view.time, ''); assert.match(view.description, /9月12日/);
  assert.equal(resetView(ready([event({ schedule: schedule(now - 1000) }), history]), now).label, '待确认');
});

test('当天确认显示已确认，翌日归入历史；确认后的 schedule 不能当未来重置', () => {
  const completed = confirmation(now - 1000);
  completed.schedule = schedule(now + 86400000);
  assert.equal(resetView(ready([completed]), now).label, '已确认');
  const nextDay = ready([completed]); nextDay.snapshot.checkedAt = now + 86400000;
  assert.equal(resetView(nextDay, now + 86400000).label, '暂无新预告');
  assert.match(resetView(ready([completed]), now).description, /不等于账号实际到账/);
});

test('发放重置卡不会显示为自动重置，未知时间不使用 updatedAt 冒充确认', () => {
  assert.equal(resetView(ready([event({ type: 'reset_credit', status: 'confirmed' })]), now).label, '暂无新预告');
  const unknown = resetView(ready([event({ status: 'confirmed' })]), now);
  assert.equal(unknown.time, ''); assert.match(unknown.description, /时间未知/);
  assert.equal(resetView(ready([event({ status: 'confirmed', occurredOn: '2026-09-15' })]), now).label, '已确认');
});

test('失效或缺少核验时间显示待更新，失败不能当作暂无预告', () => {
  const state = ready([]); state.snapshot.checkedAt = now - 900001;
  assert.equal(resetView(state, now).label, '消息待更新');
  state.snapshot.checkedAt = null;
  assert.equal(resetView(state, now).label, '消息待更新');
  assert.equal(resetView({ ...state, status: 'error' }, now).label, '暂时无法读取');
  assert.equal(resetView({ status: 'loading', snapshot: null }, now).label, '读取中…');
});

test('协议损坏显式失败；原帖仅接受 Tibo HTTPS 帖子，不传输无关外部字段', () => {
  for (const invalid of [{}, { ...data([]), schemaVersion: 2 }, data([event({ schedule: {} })])]) assert.throws(() => resetSnapshot(invalid));
  for (const url of ['javascript:alert(1)', 'https://x.com.evil/thsottiaux/status/1', 'https://x.com/other/status/1', 'https://u:p@x.com/thsottiaux/status/1']) assert.equal(resetSnapshot(data([event({ posts: [{ url }] })])).events[0].source, null);
  const snapshot = resetSnapshot({ ...data([event({ posts: [{ url: 'https://x.com/thsottiaux/status/123?tracking=1' }] })]), accountSecret: 'private' });
  assert.equal(snapshot.events[0].source, 'https://x.com/thsottiaux/status/123');
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
});

test('固定匿名端点、随每分钟额度刷新查询与并发合并，ETag 304 不伪造核验时间', async () => {
  let clock = now, resolve; const calls = [];
  const feed = new ResetFeed({ now: () => clock, fetcher(url, options) { calls.push({ url, options }); return new Promise(r => { resolve = r; }); } });
  const a = feed.refresh(), b = feed.refresh(); assert.equal(a, b); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, RESET_URL); assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.redirect, 'error');
  resolve(response([], { ETag: 'version-1' })); await a;
  await feed.refresh(); assert.equal(calls.length, 1);
  clock += 60000;
  const next = feed.refresh(); assert.equal(calls[1].options.headers['If-None-Match'], 'version-1');
  resolve(new Response(null, { status: 304 })); await next;
  assert.equal(feed.state.status, 'ready'); assert.equal(feed.state.snapshot.checkedAt, now);
});

test('完整快照替换撤回的预告，损坏响应不能更新 ETag，失败重试可恢复', async () => {
  let clock = now, mode = 'valid'; const headers = [];
  const feed = new ResetFeed({ now: () => clock, fetcher: async (_, options) => { headers.push(options.headers); return mode === 'invalid' ? new Response('{}', { headers: { ETag: 'bad' } }) : response(mode === 'valid' ? [event({ schedule: schedule(now + 3600000) })] : [], { ETag: mode }); } });
  await feed.refresh(); assert.equal(feed.state.snapshot.events.length, 1);
  clock += 60000; mode = 'invalid'; await feed.refresh();
  assert.equal(feed.state.status, 'error'); assert.equal(feed.etag, 'valid');
  clock += 5000; mode = 'empty'; await feed.refresh();
  assert.equal(headers.at(-1)['If-None-Match'], 'valid'); assert.equal(feed.state.snapshot.events.length, 0);
});

test('429 的 Retry-After 约束统一刷新；超时/离线保留失败且有短时冷却', async () => {
  let clock = now, calls = 0, fail = true;
  const feed = new ResetFeed({ now: () => clock, fetcher: async () => { calls++; return fail ? new Response(null, { status: 429, headers: { 'Retry-After': '120' } }) : response([]); } });
  await feed.refresh(); await feed.refresh(); assert.equal(calls, 1);
  clock += 119000; await feed.refresh(); assert.equal(calls, 1);
  clock += 1000; fail = false; await feed.refresh(); assert.equal(calls, 2); assert.equal(feed.state.status, 'ready');
  let offlineCalls = 0;
  const offline = new ResetFeed({ now: () => clock, fetcher: async () => { offlineCalls++; throw new Error('timeout'); } });
  await offline.refresh(); assert.equal(offline.state.status, 'error');
  clock += 4999; await offline.refresh(); assert.equal(offlineCalls, 1);
  clock += 1; await offline.refresh(); assert.equal(offlineCalls, 2);
});

test('超大响应与没有缓存的 304 均不显示为成功', async () => {
  for (const result of [new Response('x'.repeat(524289)), new Response(null, { status: 304 })]) {
    const feed = new ResetFeed({ fetcher: async () => result }); await feed.refresh(); assert.equal(feed.state.status, 'error');
  }
});
