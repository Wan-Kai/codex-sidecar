import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, lstatSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const mac = process.platform === 'darwin';
let directory, binary, source, icon;

/** 编译真实替身生成器并使用临时应用副本；验证只改临时文件，不触碰桌面或启动 Codex。 */
before(() => {
  if (!mac) return;
  directory = mkdtempSync(join(tmpdir(), 'codex-shortcut-test-'));
  binary = join(directory, 'build-shortcut');
  source = join(directory, 'CodeX 空格应用.app');
  icon = join(project, 'assets/CodeXInjected.icns');
  cpSync(join(project, 'CodeX 注入版.app'), source, { recursive: true });
  execFileSync('/usr/bin/swiftc', [join(project, 'build-shortcut.swift'), '-o', binary]);
});
after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function build(destination, image = icon) {
  return spawnSync(binary, [source, destination, image], { encoding: 'utf8' });
}

/** 同时检查原生替身、独立图标标记与系统解析；仅能读取正确 ICNS 不足以覆盖本次桌面故障。 */
function verify(destination) {
  assert.equal(lstatSync(destination).isSymbolicLink(), false);
  const info = execFileSync('/usr/bin/xattr', ['-px', 'com.apple.FinderInfo', destination], { encoding: 'utf8' }).replace(/\s/g, '');
  assert.ok(Buffer.from(info, 'hex').readUInt16BE(8) & 0x0400, '必须有独立的 Finder 图标标记');
  const resolved = execFileSync('/usr/bin/swift', ['-', destination], { input: 'import Foundation\nlet file = URL(fileURLWithPath: CommandLine.arguments[1])\nprint(try file.resourceValues(forKeys: [.isAliasFileKey]).isAliasFile == true)\nprint(try URL(resolvingAliasFileAt: file, options: [.withoutUI, .withoutMounting]).path)\n', encoding: 'utf8' }).trim().split('\n');
  assert.equal(resolved[0], 'true');
  // macOS 临时目录的 /var 实际指向 /private/var；比较解析后的目标，避免把同一文件误判为其他应用。
  assert.equal(resolved[1], realpathSync(source));
}

test('桌面入口创建为带独立图标的原生替身，并指向正确应用', { skip: !mac }, () => {
  const destination = join(directory, '新入口.app');
  const result = build(destination); assert.equal(result.status, 0, result.stderr);
  verify(destination);
});

test('旧软链接迁移及原生替身重复更新均不修改签名应用本体', { skip: !mac }, () => {
  const destination = join(directory, '旧入口.app');
  symlinkSync(source, destination);
  for (let i = 0; i < 2; i++) {
    const result = build(destination); assert.equal(result.status, 0, result.stderr);
    verify(destination);
  }
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', source]);
});

test('同名普通文件、目录和指向其他位置的链接不会被覆盖', { skip: !mac }, () => {
  const ordinary = join(directory, '普通文件.app'), folder = join(directory, '目录.app'), unrelated = join(directory, '其他链接.app');
  writeFileSync(ordinary, '用户文件'); mkdirSync(folder); symlinkSync(ordinary, unrelated);
  for (const destination of [ordinary, folder, unrelated]) assert.equal(build(destination).status, 1);
  assert.equal(readFileSync(ordinary, 'utf8'), '用户文件');
  assert.equal(lstatSync(folder).isDirectory(), true);
  assert.equal(readlinkSync(unrelated), ordinary);
});

test('缺失图标时保留已有入口，不留下不完整替身', { skip: !mac }, () => {
  const destination = join(directory, '失败后保留.app');
  symlinkSync(source, destination);
  assert.equal(build(destination, join(directory, 'missing.icns')).status, 1);
  assert.equal(readlinkSync(destination), source);
});
