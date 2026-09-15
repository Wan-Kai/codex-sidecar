import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCodexApp } from '../background.mjs';

const mac = process.platform === 'darwin';

/** 创建只含元数据的应用夹具，通过真实 plutil 验证路径识别，不调用 open 或启动宿主。 */
async function fixture(t, name, { id = 'com.openai.codex', executable = 'Codex', missingBinary = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sidecar-app-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appPath = join(root, name), contents = join(appPath, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${xml(id)}</string><key>CFBundleExecutable</key><string>${xml(executable)}</string></dict></plist>`);
  if (!missingBinary && !executable.includes('/')) await writeFile(join(contents, 'MacOS', executable), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return appPath;
}

test('常见应用名称与包含空格的安装路径按真实 bundle 标识识别', { skip: !mac }, async t => {
  for (const name of ['Codex.app', 'ChatGPT.app', '带 空格 Codex.app']) {
    const appPath = await fixture(t, name);
    assert.deepEqual(await resolveCodexApp({ appPath }), { appPath, executablePath: join(appPath, 'Contents', 'MacOS', 'Codex') });
  }
});

test('自动发现跳过同名其他应用并选中真正 Codex', { skip: !mac }, async t => {
  const unrelated = await fixture(t, 'ChatGPT.app', { id: 'com.openai.chat' });
  const valid = await fixture(t, 'Codex.app');
  assert.equal((await resolveCodexApp({ appPath: '', candidates: [unrelated, valid] })).appPath, valid);
});

test('显式指定错误应用时不回退启动其他安装', { skip: !mac }, async t => {
  const unrelated = await fixture(t, 'ChatGPT.app', { id: 'com.openai.chat' });
  const valid = await fixture(t, 'Codex.app');
  await assert.rejects(resolveCodexApp({ appPath: unrelated, candidates: [valid] }), /应用标识不是 com.openai.codex/);
});

test('拒绝相对路径、越界可执行文件和不完整安装', { skip: !mac }, async t => {
  await assert.rejects(resolveCodexApp({ appPath: './Codex.app' }), /绝对路径/);
  const traversal = await fixture(t, 'Codex.app', { executable: '../outside' });
  await assert.rejects(resolveCodexApp({ appPath: traversal }), /可执行文件名无效/);
  const incomplete = await fixture(t, 'Codex.app', { missingBinary: true });
  await assert.rejects(resolveCodexApp({ appPath: incomplete }), /无法使用 CODEX_APP_PATH/);
  await assert.rejects(resolveCodexApp({ appPath: '', candidates: [] }), /未找到 Codex/);
});
