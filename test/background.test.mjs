import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startBackground, stopBackground, ownedProcess } from '../background.mjs';
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 使用真实的独立 Node 进程验证后台生命周期，替身不连接 Codex、不启用 CDP。 */
async function fixture(t, shutdownDelayMs = 0) {
  const stateDir = await mkdtemp(join(tmpdir(), 'codex-iq-background-test-'));
  const loaderPath = join(stateDir, 'loader-fixture.mjs');
  await writeFile(loaderPath, `console.log('fixture-ready'); const timer=setInterval(()=>{},1000); process.on('SIGTERM',()=>{setTimeout(()=>{clearInterval(timer); process.exit(0);},${shutdownDelayMs});});\n`);
  const options = { stateDir, loaderPath };
  t.after(async () => {
    await stopBackground(options);
    await sleep(200);
    await rm(stateDir, { recursive: true, force: true });
  });
  return options;
}

test('启动进程退出后后台仍存活，重复启动复用同一 PID，且日志不依赖终端', async t => {
  const options = await fixture(t);
  const source = `import {startBackground} from ${JSON.stringify(new URL('../background.mjs', import.meta.url).href)}; console.log(JSON.stringify(await startBackground(${JSON.stringify(options)})));`;
  // 若子进程继承 stdout 或未 unref，此父进程会挂住并触发超时。
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', source], { timeout: 5000 });
  const first = JSON.parse(stdout.trim());
  assert.equal(await ownedProcess(first, options.loaderPath), true);
  const again = await startBackground(options);
  assert.equal(again.alreadyRunning, true); assert.equal(again.pid, first.pid);
  assert.match(await readFile(first.logPath, 'utf8'), /fixture-ready/);
  assert.equal(await stopBackground(options), true);
  assert.equal(await ownedProcess(first, options.loaderPath), false);
});

test('停止等待旧进程完成退出，立即重新启动得到新实例', async t => {
  const options = await fixture(t, 500);
  const first = await startBackground(options);
  await stopBackground(options);
  assert.equal(await ownedProcess(first, options.loaderPath), false);
  const next = await startBackground(options);
  assert.equal(next.alreadyRunning, false);
  assert.notEqual(next.pid, first.pid);
});

test('再次打开新版入口自动替换旧加载器，同版本继续复用', async t => {
  const options = await fixture(t, 300);
  const first = await startBackground({ ...options, version: '1.1.3' });
  const updated = await startBackground({ ...options, version: '1.1.4' });
  assert.equal(updated.upgraded, true);
  assert.equal(updated.version, '1.1.4');
  assert.notEqual(updated.pid, first.pid);
  assert.equal(await ownedProcess(first, options.loaderPath), false);
  const again = await startBackground({ ...options, version: '1.1.4' });
  assert.equal(again.pid, updated.pid);
  assert.equal(again.alreadyRunning, true);
});

test('兼容旧的无版本进程记录，升级无需手动 Stop', async t => {
  const options = await fixture(t);
  const first = await startBackground(options);
  const recordPath = join(options.stateDir, 'process.json');
  const legacy = JSON.parse(await readFile(recordPath, 'utf8'));
  delete legacy.version;
  await writeFile(recordPath, JSON.stringify(legacy));
  const updated = await startBackground(options);
  assert.equal(updated.upgraded, true);
  assert.notEqual(updated.pid, first.pid);
  assert.equal(await ownedProcess(first, options.loaderPath), false);
});

test('同时启动最多只产生一个后台实例', async t => {
  const options = await fixture(t);
  const results = await Promise.allSettled([startBackground(options), startBackground(options)]);
  const succeeded = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  assert.ok(succeeded.length >= 1);
  assert.equal(new Set(succeeded.map(r => r.pid)).size, 1);
});

test('PID 归属不符时不停止其他进程', async t => {
  const options = await fixture(t);
  await writeFile(join(options.stateDir, 'process.json'), JSON.stringify({ pid: process.pid, token: '11111111-1111-4111-8111-111111111111' }));
  assert.equal(await stopBackground(options), false);
});
