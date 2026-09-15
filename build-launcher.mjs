import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * 生成复用启动脚本的 AppleScript 应用入口，不启动 Codex。
 * 编译时记录当前 Node 和脚本路径，编译后配置图标、重签并刷新登记。
 * --no-shortcut 仅构建应用，供 CI 和已有桌面入口的开发者验证，避免触碰桌面。
 * Finder 无法正确显示本机软链接的继承图标，因此入口使用原生替身；任何步骤失败均报错。
 */
function buildLauncher() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--no-shortcut')) throw new Error('支持的构建选项：--no-shortcut');
  const directory = dirname(fileURLToPath(import.meta.url));
  const { version } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const app = join(directory, 'CodeX 注入版.app');
  const plist = join(app, 'Contents', 'Info.plist');
  // 仅更改可见名称，保留原 bundle ID，让系统继续识别为同一个辅助入口。
  const bundleId = 'local.codex.iq-launcher';
  if (existsSync(app)) {
    const id = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist], { encoding: 'utf8' }).trim();
    if (id !== bundleId) throw new Error('同名应用不属于本项目，未覆盖');
  }
  // Finder 不继承交互终端的 PATH；记录构建时实际使用的 Node，兼容 Homebrew 和版本管理器。
  // 两层分别按 shell 与 AppleScript 规则转义，目录中含空格、引号或 $ 也不会被执行。
  const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  const prefix = process.env.CODEX_APP_PATH ? `CODEX_APP_PATH=${shellQuote(process.env.CODEX_APP_PATH)} ` : '';
  const command = prefix + [process.execPath, join(directory, 'background.mjs'), 'start'].map(shellQuote).join(' ');
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const source = `-- 用户双击时复用后台启动流程；异常才显示说明，不创建终端窗口。\non run\n  try\n    do shell script "${escaped}"\n  on error errorMessage\n    display dialog errorMessage with title "CodeX 注入版" buttons {"好"} default button 1 with icon caution\n  end try\nend run\n`;
  const sourcePath = join(directory, 'launcher.applescript');
  writeFileSync(sourcePath, source);
  execFileSync('/usr/bin/osacompile', ['-o', app, sourcePath]);
  execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', bundleId, plist]);
  execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleName', '-string', 'CodeX 注入版', plist]);
  execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleDisplayName', '-string', 'CodeX 注入版', plist]);
  execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleShortVersionString', '-string', version, plist]);
  execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleVersion', '-string', version, plist]);
  execFileSync('/usr/bin/plutil', ['-replace', 'LSUIElement', '-bool', 'true', plist]);
  // 改名沿用原应用身份，但图标使用新资源名，避免 Finder 复用旧脉冲图标缓存。
  rmSync(join(app, 'Contents', 'Resources', 'CodexIQ.icns'), { force: true });
  copyFileSync(join(directory, 'assets', 'CodeXInjected.icns'), join(app, 'Contents', 'Resources', 'CodeXInjected.icns'));
  execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleIconFile', '-string', 'CodeXInjected', plist]);
  // osacompile 还会留下 CFBundleIconName=applet，它优先选择 Assets.car 的模板图标。
  // 本项目交付 ICNS，因此移除资产目录选择项；只替换 IconFile 会导致系统仍显示浅色卷轴。
  const iconMetadata = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  if (Object.hasOwn(iconMetadata, 'CFBundleIconName')) {
    execFileSync('/usr/bin/plutil', ['-remove', 'CFBundleIconName', plist]);
  }
  // 编译产物需要在元数据修改后重签自身；不触碰 Codex 的安装包或签名。
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
  // 原路径重建会命中旧图标缓存；只刷新自己的应用登记，不重启 Finder 或 Dock。
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', app]);
  const refreshedAt = new Date();
  utimesSync(app, refreshedAt, refreshedAt);
  if (!args.includes('--no-shortcut')) {
    execFileSync('/usr/bin/swift', [join(directory, 'build-shortcut.swift'), app, join(homedir(), 'Desktop', 'CodeX 注入版.app'), join(directory, 'assets', 'CodeXInjected.icns')], { stdio: 'pipe' });
  }
  console.log(app);
}
buildLauncher();
