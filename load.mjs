import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import resetModule from './tibo.cjs';
const { ResetFeed } = resetModule;

/** 只接收本机 Codex 主页面，不向网页、登录页或内嵌浏览器注入。 */
export function isCodexPage(target) {
  if (target.type !== 'page') return false;
  try {
    const url = new URL(target.url);
    return (url.protocol === 'app:' && url.hostname === '-' && url.pathname === '/index.html') ||
      (url.protocol === 'file:' && /\/(?:ChatGPT|Codex)\.app\/Contents\/Resources\/app\.asar\/webview\/index\.html$/.test(decodeURIComponent(url.pathname)));
  } catch { return false; }
}

/** 调试端口只连接回环地址；拒绝调试目录返回的外部 WebSocket 地址。 */
export function localSocket(value, port) {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port) !== port || url.username || url.password) throw new Error('拒绝非本机调试连接');
  return url.href;
}

/** CDP 请求按 ID 对应响应；断线或超时立即失败，让外层在下一轮重连。 */
export class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    ws.addEventListener('close', () => {
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('调试连接关闭')); }
      this.pending.clear();
    });
  }
  call(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 超时`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
}

/**
 * 单次连接先确认原生桥，再加载本地代码并传入已解析的公共快照，最后取走一次重试意图。
 * 外部内容仅作为 JSON 数据传输；忙碌旧卡片仍按原规则延后升级，不中断模型任务。
 */
export async function apply(target, port, source, remove, version, resetState = null) {
  const ws = new WebSocket(localSocket(target.webSocketDebuggerUrl, port));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('调试连接超时')); }, 10000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('调试端口不可连接')); }, { once: true });
  });
  const cdp = new CDP(ws);
  try {
    const check = await cdp.call('Runtime.evaluate', { expression: 'typeof window.electronBridge?.sendMessageFromView === "function"', returnByValue: true });
    if (!check.result?.value) return '不是 Codex 主窗口，已跳过';
    const expression = remove
      ? 'window.__codexIQCard?.dispose(); "卡片已移除"'
      : `if (window.__codexIQCard && window.__codexIQCard.version !== ${JSON.stringify(version)} && !window.__codexIQCard.pending) window.__codexIQCard.dispose();\nif (!window.__codexIQCard) {\n${source}\n}\nwindow.__codexIQCard?.updateReset?.(${JSON.stringify(resetState)});\nJSON.stringify({version:window.__codexIQCard?.version,mounted:window.__codexIQCard?.mounted,pending:window.__codexIQCard?.pending,resetRefresh:window.__codexIQCard?.takeResetRefresh?.() ?? false})`;
    const response = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return String(response.result?.value);
  } finally { ws.close(); }
}

/** 后台模式在启动失败 45 秒、或曾连接后失联 15 秒退出，避免用户退出应用后空转。 */
export function managedExpired(startedAt, lastSeenAt, now = Date.now()) {
  return now - (lastSeenAt ?? startedAt) >= (lastSeenAt == null ? 45000 : 15000);
}

/**
 * 常驻加载器等待已有调试端口并维护一份公共重置快照，逐窗口同步展示及重试意图。
 * 没有 Codex 目标时不发起网络读取；不强行退出用户应用，也不修改安装包。
 */
export async function main(args = process.argv.slice(2)) {
  const remove = args.includes('--remove');
  const managed = args.includes('--managed');
  const portIndex = args.indexOf('--port');
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 9222;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口需为 1024–65535 的整数');
  const source = (await Promise.all(['core.cjs', 'tibo.cjs', 'card.js'].map(name => readFile(new URL(name, import.meta.url), 'utf8')))).join('\n');
  const { version } = JSON.parse(await readFile(new URL('package.json', import.meta.url), 'utf8'));
  const startedAt = Date.now();
  let lastSeenAt = null;
  let stopping = false, previous = '';
  const resets = new ResetFeed();
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  while (!stopping) {
    let status;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!response.ok) throw new Error(`调试端口返回 HTTP ${response.status}`);
      const targets = (await response.json()).filter(isCodexPage);
      if (!targets.length) throw new Error('未找到符合当前版本结构的 Codex 主页面');
      lastSeenAt = Date.now();
      // 主页面 CSP 不允许第三方连接；由已有 Node 进程匿名读取固定端点。
      // refresh 内部合并请求并限制为五分钟，慢请求不阻塞卡片挂载与模型任务。
      if (!remove) void resets.refresh();
      const values = [], failures = [];
      // 旧版卡片正在请求时不卸载；它完成收尾后，下一轮再替换为新版。
      for (const [index, target] of targets.entries()) {
        try {
          const value = await apply(target, port, source, remove, version, resets.state);
          values.push(value);
          if (!remove && value.startsWith('{') && JSON.parse(value).resetRefresh) void resets.refresh({ manual: true });
        } catch (error) {
          // 单个残留窗口失败不能跳过其他窗口；下一轮仍会重试该目标，无需新增并发队列。
          failures.push(error);
          values.push(`窗口 ${index + 1}：${error.message}`);
        }
      }
      status = values.join(' · ');
      if (remove) {
        console.log(status);
        // 尽力移除全部目标后仍保留失败退出码，避免向调用者误报已全部移除。
        if (failures.length) throw new AggregateError(failures, `${failures.length} 个窗口移除失败，请重试`);
        return;
      }
    } catch (error) { status = error.message; if (remove) throw error; }
    if (status !== previous) { console.log(status); previous = status; }
    if (managed && managedExpired(startedAt, lastSeenAt)) { console.log('Codex 未运行或调试入口失联，后台加载器退出。'); break; }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 2500));
  }
  console.log('加载器已停止；已加载的卡片保留至窗口刷新。');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
