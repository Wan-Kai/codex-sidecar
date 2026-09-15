import { spawn, execFile } from 'node:child_process';
import { mkdir, open, readFile, writeFile, unlink, stat, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));
const defaultStateDir = join(homedir(), 'Library', 'Application Support', 'Codex IQ Card');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const { version: currentVersion } = JSON.parse(await readFile(new URL('package.json', import.meta.url), 'utf8'));

/** 核对路径和唯一进程标记后才承认 PID 归属，避免向复用 PID 的其他程序发信号。 */
export async function ownedProcess(record, loaderPath) {
  if (!Number.isInteger(record?.pid) || record.pid <= 0 || !/^[a-f\d-]{36}$/.test(record?.token || '')) return false;
  try {
    const { stdout } = await exec('/bin/ps', ['-ww', '-p', String(record.pid), '-o', 'command=']);
    return stdout.includes(loaderPath) && stdout.includes(`--owner=${record.token}`);
  } catch { return false; }
}

async function readRecord(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

/** 短时启动锁仅串行化创建进程；崩溃留下的锁在确认原启动进程消失后清理。 */
async function acquireStartLock(stateDir) {
  const path = join(stateDir, 'start.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.close();
      return () => unlink(path).catch(() => {});
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await readRecord(path);
      // 刚创建但尚未写入的锁属于正在启动的实例，不将它当成过期文件删除。
      if (!Number.isInteger(owner?.pid) || owner.pid <= 0) throw new Error('启动锁未就绪，请稍后再试');
      try { process.kill(owner.pid, 0); }
      catch (failure) {
        if (failure.code === 'ESRCH') { await unlink(path).catch(() => {}); continue; }
        throw failure;
      }
      throw new Error('启动正在进行，请稍后再试');
    }
  }
  throw new Error('无法取得启动锁');
}

/**
 * 将原有加载器置于独立进程会话，并将输出重定向到日志；终端退出不再影响它。
 * 同版本复用进程；新版本在启动锁内停止旧加载器再启动，用户无需手动 Stop。
 * 只重启外置加载器，已挂载卡片继续完成请求；新加载器会等待卡片收尾后更新界面。
 * PID 文件用于去重、版本识别和停止，不注册登录项。测试可提供隔离路径与版本。
 */
export async function startBackground({ stateDir = defaultStateDir, loaderPath = join(directory, 'load.mjs'), version = currentVersion } = {}) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const release = await acquireStartLock(stateDir);
  try {
    const recordPath = join(stateDir, 'process.json');
    const existing = await readRecord(recordPath);
    const running = await ownedProcess(existing, loaderPath);
    if (running && existing.version === version) return { ...existing, alreadyRunning: true, upgraded: false };
    // 老版本记录没有 version，也按升级处理；锁内完成停止和创建，避免两个入口并发替换。
    if (running) await stopBackground({ stateDir, loaderPath });
    const logPath = join(stateDir, 'loader.log');
    try { if ((await stat(logPath)).size > 512 * 1024) await rename(logPath, join(stateDir, 'loader.previous.log')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const log = await open(logPath, 'a', 0o600);
    const token = randomUUID();
    let child;
    try {
      child = spawn(process.execPath, [loaderPath, '--managed', `--owner=${token}`], {
        cwd: dirname(loaderPath), detached: true, stdio: ['ignore', log.fd, log.fd]
      });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      const record = { pid: child.pid, token, version, loaderPath, logPath, startedAt: new Date().toISOString() };
      await writeFile(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
      // 等待 Node 进入脚本；启动即崩溃时把错误留给启动入口显示，而不是报成功。
      await sleep(150);
      if (!await ownedProcess(record, loaderPath)) throw new Error(`后台加载器未保持运行，请查看 ${logPath}`);
      return { ...record, alreadyRunning: false, upgraded: running };
    } catch (error) { child?.kill('SIGTERM'); throw error; }
    finally { await log.close(); }
  } finally { await release(); }
}

/**
 * 停止本入口拥有的加载器，确认进程退出后才返回，随后重新启动才能载入新文件。
 * 允许进行中的 CDP 调用自行结束；超时提示重试，不强杀进程或终止 Codex / 模型任务。
 */
export async function stopBackground({ stateDir = defaultStateDir, loaderPath = join(directory, 'load.mjs') } = {}) {
  const recordPath = join(stateDir, 'process.json');
  const record = await readRecord(recordPath);
  if (!await ownedProcess(record, loaderPath)) return false;
  try { process.kill(record.pid, 'SIGTERM'); }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  const deadline = Date.now() + 15000;
  // 先等旧进程真正退出，避免用户紧接着启动时误复用正在停止的实例。
  while (await ownedProcess(record, loaderPath)) {
    if (Date.now() >= deadline) throw new Error('后台加载器仍在退出，请稍后重新执行停止，再启动新版入口。');
    await sleep(200);
  }
  return true;
}

/**
 * 从常见安装位置读取应用元数据，只接受 Codex 的 bundle ID，不按文件名猜测应用身份。
 * 显式指定路径时不回退到另一份安装；失败须让用户修正配置，避免启动非预期应用。
 * 返回 bundle 路径和真实可执行文件路径，供启动与运行状态检查共用。
 */
export async function resolveCodexApp({ appPath = process.env.CODEX_APP_PATH, candidates = [
  '/Applications/Codex.app', '/Applications/ChatGPT.app',
  join(homedir(), 'Applications', 'Codex.app'), join(homedir(), 'Applications', 'ChatGPT.app')
] } = {}) {
  if (appPath && !isAbsolute(appPath)) throw new Error('CODEX_APP_PATH 必须是应用的绝对路径');
  for (const candidate of appPath ? [appPath] : candidates) {
    try {
      const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(candidate, 'Contents', 'Info.plist')]);
      const info = JSON.parse(stdout);
      if (info.CFBundleIdentifier !== 'com.openai.codex') throw new Error('应用标识不是 com.openai.codex');
      const executable = info.CFBundleExecutable;
      // 可执行文件名必须留在包内；不允许元数据中的路径跳出 Contents/MacOS。
      if (typeof executable !== 'string' || !executable || /[/\\\x00-\x1f]/.test(executable) || ['.', '..'].includes(executable)) throw new Error('应用可执行文件名无效');
      const executablePath = join(candidate, 'Contents', 'MacOS', executable);
      if (!(await stat(executablePath)).isFile()) throw new Error('应用可执行文件不存在');
      return { appPath: candidate, executablePath };
    } catch (error) {
      if (appPath) throw new Error(`无法使用 CODEX_APP_PATH 指定的应用：${error.message}`);
    }
  }
  throw new Error('未找到 Codex。请安装到 Applications，或用 CODEX_APP_PATH 指定应用绝对路径。');
}

/** 用户双击入口时才启动应用；先核对应用身份，运行中的 Codex 缺少端口时提示自行退出。 */
async function ensureCodex() {
  const { appPath, executablePath } = await resolveCodexApp();
  let running = false;
  const pattern = '^' + executablePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([[:space:]]|$)';
  try { await exec('/usr/bin/pgrep', ['-f', pattern]); running = true; } catch { /* 未运行时由 open 启动。 */ }
  if (running) {
    try {
      const response = await fetch('http://127.0.0.1:9222/json/list', { signal: AbortSignal.timeout(1500), redirect: 'error' });
      const { isCodexPage } = await import('./load.mjs');
      if (!response.ok || !(await response.json()).some(isCodexPage)) throw new Error('端口不可用');
    } catch { throw new Error('Codex 已运行，但注入入口尚不可用。请先用 ⌘Q 完全退出 Codex，再打开“CodeX 注入版”。'); }
    await exec('/usr/bin/open', ['-a', appPath]);
  } else {
    await exec('/usr/bin/open', ['-a', appPath, '--args', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222']);
  }
}

/** 命令入口与 .app 复用同一启动路径；不产生需要常驻的终端窗口。 */
export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'stop') {
    console.log(await stopBackground() ? '后台加载器已停止，可以打开新版入口。已挂载卡片保留至重新加载。' : '后台加载器未运行。');
    return;
  }
  if (args[0] === 'status') {
    const record = await readRecord(join(defaultStateDir, 'process.json'));
    console.log(await ownedProcess(record, join(directory, 'load.mjs')) ? `运行中，日志：${record.logPath}` : '未运行');
    return;
  }
  await ensureCodex();
  const state = await startBackground();
  console.log(`${state.alreadyRunning ? '后台加载器已在运行' : state.upgraded ? '后台加载器已更新' : '后台加载器已启动'}，可以关闭终端。日志：${state.logPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
