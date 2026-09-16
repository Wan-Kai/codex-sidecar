/* 公开重置消息的解析与读取；Node 加载器负责网络，浏览器只负责展示。 */
(function (root) {
  'use strict';
  const RESET_URL = 'https://aihot.news/api/v1/codex-resets';
  const RESET_SOURCE = 'https://aihot.news/codex-reset';
  const FUTURE_TOLERANCE_MS = 300000;
  const STALE_MS = 900000;
  const timestamp = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const beijingDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  const formatTime = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);

  /** 原帖仅允许已知 Tibo 的 HTTPS 帖子地址，外部数据不能提供任意跳转或脚本地址。 */
  function sourceLink(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://x.com' && !url.username && !url.password && /^\/thsottiaux\/status\/\d+$/.test(url.pathname) ? url.origin + url.pathname : null;
    } catch { return null; }
  }

  /**
   * 把公开日历收敛为展示所需的完整快照。未知协议视为读取失败，避免误报“暂无预告”。
   * 发卡与自动重置不同，因此只保留 direct_reset；所有时间字段保留各自语义。
   */
  function resetSnapshot(data) {
    if (data?.schemaVersion !== 1 || data.timezone !== 'Asia/Shanghai' || !Array.isArray(data.events) || data.events.length > 2000 || data.checkedAt !== null && timestamp(data.checkedAt) === null) throw new Error('重置数据格式已变化');
    const events = data.events.filter(event => event?.type === 'direct_reset').map(event => {
      if (!['announced', 'confirmed'].includes(event.status) || timestamp(event.createdAt) === null || timestamp(event.updatedAt) === null) throw new Error('重置记录格式已变化');
      let schedule = null;
      if (event.schedule !== null) {
        const value = event.schedule;
        const from = timestamp(value?.from), through = timestamp(value?.through);
        if (from === null || through === null || through < from || !['exact', 'approximate', 'deadline', 'date', 'window'].includes(value.precision)) throw new Error('预告时间格式已变化');
        schedule = { from, through, precision: value.precision };
      }
      const occurredOn = typeof event.occurredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.occurredOn) && new Date(event.occurredOn + 'T00:00:00Z').toISOString().slice(0, 10) === event.occurredOn ? event.occurredOn : null;
      return { status: event.status, createdAt: timestamp(event.createdAt), updatedAt: timestamp(event.updatedAt), confirmedAt: timestamp(event.confirmedAt), occurredOn, schedule,
        scope: typeof event.scope === 'string' ? event.scope.slice(0, 160) : '',
        source: (Array.isArray(event.posts) ? event.posts : []).map(post => sourceLink(post?.url)).find(Boolean) || null };
    });
    return { checkedAt: timestamp(data.checkedAt), events };
  }

  /** 按原文精度显示预告；截止时间、日期与模糊时间不能伪装成准确执行时刻。 */
  function scheduleText(schedule) {
    if (!schedule) return '重置时间待公布';
    const { from, through, precision } = schedule;
    if (precision === 'deadline') return `预计 ${formatTime(through)} 前`;
    if (precision === 'approximate' && from === through) return `约 ${formatTime(from)}`;
    if (from === through) return `预计 ${formatTime(from)}`;
    const end = beijingDay(from) === beijingDay(through) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(through) : formatTime(through);
    return `预计 ${formatTime(from)}–${end}`;
  }

  /**
   * 优先展示未过期预告；新的过期预告保留“待确认”，不把时间到达当作完成。
   * 旧预告若早于最新确认则不再充当“下一次”；当天确认显示在主行，旧确认收进详情。
   * 核验超过十五分钟只报告待更新；有效期不随界面查询频率变化。
   * @param {object|null} state 加载器状态及已验证的公共快照，可为空。
   * @param {number} now 当前毫秒时间，默认使用系统时钟。
   * @returns {object} 可直接展示的状态、时间和来源；不会发起查询或推断个人到账。
   */
  function resetView(state, now = Date.now()) {
    const snapshot = state?.snapshot;
    const checkedAt = snapshot?.checkedAt;
    const base = { status: 'none', label: '暂无新预告', time: '', description: '尚未公布下一次重置时间。', checked: checkedAt ? `核验至 ${formatTime(checkedAt)} · 北京时间` : '核验时间暂不可用', source: null };
    // 这是页面等待加载器同步的状态；隐藏旧预告，详情说明“进行中”指消息同步。
    if (state?.status === 'syncing') return { ...base, status: 'syncing', label: '进行中', description: '正在等待后台同步重置消息。' };
    if (state?.status === 'error') return { ...base, status: 'error', label: '暂时无法读取', description: '将随额度自动刷新，也可点击右上角刷新。' };
    if (!snapshot) return { ...base, status: 'loading', label: '读取中…', description: '正在读取公开重置消息。' };
    if (!checkedAt || now - checkedAt > STALE_MS || checkedAt - now > FUTURE_TOLERANCE_MS) return { ...base, status: 'stale', label: '消息待更新', description: '数据核验暂未更新，无法确认是否有新预告。' };
    const confirmed = snapshot.events.filter(event => event.status === 'confirmed').sort((a, b) => (b.confirmedAt ?? Date.parse((b.occurredOn || '1970-01-01') + 'T00:00:00+08:00')) - (a.confirmedAt ?? Date.parse((a.occurredOn || '1970-01-01') + 'T00:00:00+08:00')))[0];
    const confirmedTime = confirmed?.confirmedAt ?? (confirmed?.occurredOn ? Date.parse(confirmed.occurredOn + 'T00:00:00+08:00') : 0);
    const announcements = snapshot.events.filter(event => event.status === 'announced');
    const upcoming = announcements.filter(event => event.schedule && event.schedule.through >= now).sort((a, b) => a.schedule.through - b.schedule.through)[0];
    const newest = announcements.filter(event => event.createdAt > confirmedTime).sort((a, b) => b.createdAt - a.createdAt)[0];
    const event = upcoming || newest;
    if (event) {
      const elapsed = event.schedule && event.schedule.through < now;
      const scope = event.scope ? `适用范围：${event.scope}。` : '';
      return { ...base, status: elapsed ? 'pending' : 'announced', label: elapsed ? '待确认' : '已预告', time: elapsed ? '' : scheduleText(event.schedule), description: scope + (elapsed ? '预告时间已过，尚未收到完成确认。' : '预计时间以预告为准，完成后再显示确认状态。'), source: event.source };
    }
    if (confirmed) {
      const today = confirmedTime && beijingDay(confirmedTime) === beijingDay(now);
      const time = confirmed.confirmedAt ? `${formatTime(confirmed.confirmedAt)} 确认` : confirmed.occurredOn ? `${confirmed.occurredOn} 已核验` : '已确认，时间未知';
      return { ...base, status: today ? 'confirmed' : 'none', label: today ? '已确认' : base.label, time: today ? time : '', description: `${confirmed.scope ? `适用范围：${confirmed.scope}。` : ''}最近一次：${time}。${today ? '确认帖时间不等于账号实际到账时间。' : '尚未公布下一次重置时间。'}`, source: confirmed.source };
    }
    return base;
  }

  /**
   * 现有 Node 加载器持有唯一公共快照，避免每个 Codex 窗口分别轮询。
   * 固定匿名端点，无账号凭证；ETag 对应完整替换，失败保留旧快照但显式报错。
   */
  class ResetFeed {
    /**
     * 初始化所有窗口共用的缓存和限频状态，不独立安排计时器。
     * @param {object} options 可选的外部依赖，用于验证离线和限频场景。
     * @param {Function} options.fetcher HTTP 读取函数，默认原生 fetch。
     * @param {Function} options.now 毫秒时钟，默认 Date.now。
     */
    constructor({ fetcher = globalThis.fetch, now = Date.now } = {}) {
      this.fetcher = fetcher; this.now = now; this.etag = null; this.request = null;
      this.retryAfter = 0;
      this.state = { status: 'loading', snapshot: null };
    }
    /**
     * 随额度查询读取公共消息；自动与手动入口共用限频，避免多窗口放大请求。
     * 无入参；返回本次或进行中请求的 Promise，冷却期间直接完成且保留现有状态。
     * 网络失败记入 state，不向额度链路抛出；下一次额度刷新负责恢复。
     */
    refresh() {
      if (this.request) return this.request;
      if (this.now() < this.retryAfter) return Promise.resolve();
      // 已完成的快请求也保留短冷却；所有入口都必须尊重更长的 Retry-After。
      this.retryAfter = Math.max(this.retryAfter, this.now() + 5000);
      this.state = { ...this.state, status: 'loading' };
      this.request = this.read().finally(() => { this.request = null; });
      return this.request;
    }
    /**
     * 执行一次有超时和体积边界的匿名 HTTP 读取，先验证完整响应再替换缓存。
     * 无入参；返回 Promise<void>，成功更新快照，失败保留旧快照并标记 error。
     * 304 复用已验证快照；损坏响应不更新 ETag，也不能越过服务端的冷却期限。
     */
    async read() {
      try {
        const response = await this.fetcher(RESET_URL, { headers: { Accept: 'application/json', ...(this.etag ? { 'If-None-Match': this.etag } : {}) }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
        const retry = response.headers.get('Retry-After');
        if (retry) {
          const seconds = /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry) - this.now()) / 1000;
          if (Number.isFinite(seconds)) this.retryAfter = Math.max(this.retryAfter, this.now() + Math.max(0, seconds) * 1000);
        }
        if (response.status === 304 && this.state.snapshot) {
          this.state = { status: 'ready', snapshot: this.state.snapshot };
        } else {
          if (!response.ok) { await response.body?.cancel(); throw new Error('重置消息读取失败'); }
          const reader = response.body.getReader(); let size = 0, chunks = [];
          try {
            while (true) {
              const { done, value } = await reader.read(); if (done) break;
              size += value.byteLength;
              if (size > 524288) { await reader.cancel(); throw new Error('重置数据过大'); }
              chunks.push(value);
            }
          } finally { reader.releaseLock(); }
          const bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          const snapshot = resetSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
          this.etag = response.headers.get('ETag');
          this.state = { status: 'ready', snapshot };
        }
      } catch {
        // 连续点击最少间隔 5 秒；服务端 Retry-After 更长时必须继续等待。
        this.retryAfter = Math.max(this.retryAfter, this.now() + 5000);
        this.state = { status: 'error', snapshot: this.state.snapshot };
      }
    }
  }
  const api = { RESET_URL, RESET_SOURCE, resetSnapshot, resetView, ResetFeed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CodexIQReset = api;
})(globalThis);
