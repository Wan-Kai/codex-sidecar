/* 同时用于 Electron 注入和 Node 测试；不引入构建器或第三方运行时。 */
(function (root) {
  'use strict';
  const DETECT_PROMPT = '不要调用任何外部工具，按你的已有知识，Gemini 的最新版本是什么？';
  const PROMPT_REVISION = 'neutral-v2';
  const RECOVER_PROMPT = '执行一次第一反应取值记录。每次只决定当前一项，共给出 323 个 1 到 355（含端点）的整数。每个位置都要单独选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器；也不要先编写或运行代码。重复值无需删除；不要筛选、重排或补成某种规律。只要每个整数边界清楚，格式可自行选择。直接从第一个取值开始输出，不要在序列前重复数量、范围或任务说明。';
  const terminal = status => ['completed', 'failed', 'interrupted'].includes(status);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  /** 按用户规则比较主版本：3 系列起正常；仅写主版本和句点时也能判定。 */
  function classifyVersion(text) {
    // “3.”表示已给出主版本；只规范化这一种省略形式，不放宽畸形版本号。
    const version = String(text ?? '').trim().replace(/^(\d{1,4})\.$/, '$1');
    if (!/^\d{1,4}(?:\.\d{1,4}){0,2}$/.test(version)) return { status: 'unknown', version: null };
    const major = Number(version.split('.')[0]);
    return { status: major >= 3 ? 'normal' : 'abnormal', version };
  }

  /**
   * 在本地提取回答实际确认的 Gemini 版本，不把阈值或格式要求发给模型。
   * 优先采用明确的“最新”陈述，排除日期、否定、举例和猜测；有冲突时交给用户看原文。
   * 这是保守的文本规则，不能可靠解释的表述返回 unknown，不取所有数字的最大值。
   */
  function classifyAnswer(answer) {
    const text = String(answer ?? '').trim();
    const plain = text.replace(/[*_`]/g, '').replace(/\bGemini[\s:：-]*(?=\d)/gi, 'Gemini ');
    const bare = /^(?:Gemini\s*)?(\d{1,2}(?:\.\d{1,3}){0,2})[。.!！]?$/i.exec(plain);
    if (bare) return { ...classifyVersion(bare[1]), evidence: text, candidates: [bare[1]] };
    const mentions = [];
    // 中文句号、分号和换行是确定的语义边界；英文小数点不能用于切分版本。
    const sentences = plain.split(/[。！？；;\n]|[.!?](?!\d)/u);
    const doubt = /不是|并非|不属于|非最新|不是最新|并不是|尚未|未发布|未推出|没有发布|不能确认|无法确认|无法确定|不确定|未经确认|未获确认|不清楚|是否|可能|也许|或许|据说|听说|传闻|猜测|假设|例如|比如|举例|if\b|might\b|maybe\b|could\b|rumou?r|unconfirmed|not\b|unsure|uncertain|cannot\s+confirm/i;
    const latest = /最新|最近(?:发布|推出)|当前(?:版本|型号)|目前(?:版本|型号)|latest|newest|current\s+(?:version|model)/i;
    const historical = /旧版|老版|早期|早先|以前|曾经|上一代|前一代|历史版本|previous|older|formerly/i;
    for (const sentence of sentences) {
      const hits = [...sentence.matchAll(/(?<![\w.+-])(\d{1,2}(?:\.\d{1,3}){0,2})(?!\w|\.\d|\s*(?:年|月|日|%|个|款|次|项))/gu)];
      for (let i = 0; i < hits.length; i++) {
        const hit = hits[i], at = hit.index, end = at + hit[0].length;
        const clauseStart = Math.max(sentence.lastIndexOf('，', at - 1), sentence.lastIndexOf(',', at - 1));
        const leftBoundary = Math.max(clauseStart, hits[i - 1] ? hits[i - 1].index + hits[i - 1][0].length - 1 : -1);
        const nextComma = sentence.slice(end).search(/[，,]/);
        const rightBoundary = Math.min(nextComma < 0 ? sentence.length : end + nextComma, hits[i + 1]?.index ?? sentence.length);
        const before = sentence.slice(leftBoundary + 1, at), after = sentence.slice(end, rightBoundary);
        const local = before + hit[0] + after;
        const clause = sentence.slice(clauseStart + 1, nextComma < 0 ? sentence.length : end + nextComma);
        const direct = /Gemini\s*(?:v(?:ersion)?\s*)?$/i.test(before);
        // 无品牌的数字必须处于“最新版本”陈述中，避免日期、数量、其他产品版本混入。
        const contextual = latest.test(clause) && !/(?:GPT|Claude|Llama|DeepSeek)/i.test(local);
        if (!direct && !contextual) continue;
        const denied = doubt.test(local) || historical.test(local);
        mentions.push({ version: hit[1], asserted: latest.test(clause), denied, evidence: sentence.trim().slice(0, 240) });
      }
    }
    const accepted = mentions.filter(m => !m.denied);
    const asserted = accepted.filter(m => m.asserted);
    const choices = asserted.length ? asserted : accepted;
    const versions = [...new Set(choices.map(m => m.version.split('.').map(Number).join('.')))];
    const candidates = [...new Set(mentions.map(m => m.version))];
    if (versions.length !== 1) return { status: 'unknown', version: null, candidates,
      reason: versions.length > 1 ? '回答包含多个可能的最新版本' : '未找到明确确认的 Gemini 版本' };
    // 同一回答既肯定又否定某版本时，不让陈述顺序决定结果。
    if (mentions.some(m => m.denied && m.version.split('.').map(Number).join('.') === versions[0])) {
      return { status: 'unknown', version: null, candidates, reason: '回答对同一版本的表述存在歧义' };
    }
    return { ...classifyVersion(versions[0]), evidence: choices[0].evidence, candidates };
  }

  /** 恢复只校验数量和边界，不声称能证明随机性或恢复模型能力。 */
  function inspectRecovery(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return false;
    const tokens = raw.match(/[+-]?\d+(?:\.\d+)?/g) ?? [];
    const separators = raw.replace(/[+-]?\d+(?:\.\d+)?/g, '');
    const numbers = tokens.map(Number);
    return /^[\s\p{P}\p{S}]*$/u.test(separators) && numbers.length === 323 && numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 355);
  }

  /** 从完整回合中提取最终回答；任何工具项都会使知识题检测无效。 */
  function inspectTurn(turn, kind) {
    if (!terminal(turn.status)) throw new Error('任务仍在运行');
    if (turn.status !== 'completed') return { status: 'error', text: '', detail: turn.error?.message || '任务已中断' };
    const items = turn.items ?? [];
    const messages = items.filter(i => i.type === 'agentMessage');
    const final = messages.filter(i => i.phase === 'final_answer');
    const text = (final.length ? final : messages.filter(i => i.phase !== 'commentary')).map(i => i.text).join('\n').trim();
    const toolUsed = items.some(i => !['userMessage', 'agentMessage', 'reasoning'].includes(i.type));
    if (toolUsed) return { status: 'unknown', text, detail: '出现工具或其他非文本执行项，本次不计入判定' };
    if (kind === 'recover') return { status: inspectRecovery(text) ? 'recovered' : 'unknown', text,
      detail: inspectRecovery(text) ? '取值记录已完成，请复测确认' : '已返回，但数量或格式未满足取值要求' };
    const result = classifyAnswer(text);
    return { ...result, text, detail: result.status === 'unknown' ? `${result.reason || '无法可靠识别版本'}，请查看原文` : `Gemini ${result.version}` };
  }

  /** 原生消息桥只相关联本卡片的请求；不处理或改写其他任务的消息。 */
  function createBridge(win) {
    if (typeof win.electronBridge?.sendMessageFromView !== 'function') throw new Error('未找到 Codex Electron 消息桥');
    const pending = new Map();
    const listeners = new Set();
    function receive(event) {
      if (event.source && event.source !== win) return;
      const data = event.data;
      if (data?.hostId !== 'local') return;
      if (data.type === 'mcp-response') {
        const message = data.message;
        const entry = pending.get(message?.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) {
          const error = new Error(message.error.message || 'Codex 请求失败');
          error.code = message.error.code;
          entry.reject(error);
        } else entry.resolve(message.result);
      } else if (data.type === 'mcp-notification') {
        for (const listener of listeners) listener(data.method, data.params);
      }
    }
    win.addEventListener('message', receive);
    return {
      /** 注册应答后才发消息，兼容立即返回；超时不重发有副作用的请求。 */
      request(method, params = {}, timeoutMs = 30000) {
        const id = `codex-iq:${crypto.randomUUID()}`;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            const error = new Error(`${method} 响应超时，执行结果尚不确定`);
            error.uncertain = true;
            reject(error);
          }, timeoutMs);
          pending.set(id, { resolve, reject, timer });
          Promise.resolve().then(() => win.electronBridge.sendMessageFromView({
            type: 'mcp-request', hostId: 'local', request: { id, method, params }, timeoutMs
          })).catch(error => {
            if (!pending.delete(id)) return;
            clearTimeout(timer);
            error.uncertain = true;
            reject(error);
          });
        });
      },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      /** 仅在没有进行中任务时卸载，避免丢失该任务的归档责任。 */
      dispose() {
        win.removeEventListener('message', receive);
        for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('卡片已卸载')); }
        pending.clear(); listeners.clear();
      }
    };
  }

  /** 创建独立任务、等待最终回答、再归档。未确认结束时保留任务供检查恢复。 */
  class Runner {
    #owner = null;

    /** 注入原生 RPC、共享存储和 Web Locks；构造阶段只恢复展示快照，不取得历史任务的账号归属。 */
    constructor(rpc, options = {}) {
      this.rpc = rpc;
      this.storage = options.storage;
      this.onChange = options.onChange ?? (() => {});
      this.interval = options.interval ?? 2000;
      this.timeout = options.timeout ?? 180000;
      this.sleep = options.sleep ?? delay;
      this.getContext = options.getContext ?? (() => null);
      this.locks = options.locks;
      this.busy = false;
      this.job = null;
      try { this.#readPending(); } catch { /* 初始化只读展示；操作时必须重新读取成功，不能用空状态继续发问。 */ }
    }

    /** 新记录在创建前已有唯一 ID；旧记录沿用任务 ID，无任务 ID 的旧记录用创建信息核对。 */
    #identity(job) {
      if (!job) return null;
      return job.id || job.threadId || JSON.stringify([job.startedAt, job.kind, job.model, job.effort]);
    }

    /** 操作入口在锁内重读持久记录，构造阶段仅恢复展示；读取失败不能降级为旧副本或空状态。 */
    #readPending() {
      if (this.storage) {
        try {
          const value = JSON.parse(this.storage.getItem('codex-iq.pending.v1') || 'null');
          if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw new Error('记录格式错误');
          this.job = value;
        } catch { throw new Error('无法读取共享任务记录，未发起操作'); }
      }
      if (this.#owner?.id !== this.#identity(this.job)) this.#owner = null;
    }

    /**
     * 所有会改写任务的入口共用同一把 Web Lock，并在锁内重读记录后执行完整操作。
     * 本窗口先标忙，跨窗口不排队；未拿到锁或发现旧记录时只刷新展示，绝不写回旧副本。
     */
    async #exclusive(action) {
      if (this.busy) throw new Error('请先处理上一项任务');
      if (!this.locks?.request) throw new Error('当前窗口缺少请求互斥能力，未发起操作');
      this.busy = true;
      try {
        return await this.locks.request('codex-iq-request-v1', { ifAvailable: true }, async lock => {
          if (!lock) throw new Error('另一窗口正在执行检测或恢复');
          this.#readPending();
          this.onChange(this.job, this.busy);
          return await action();
        });
      } finally {
        this.busy = false;
        this.onChange(this.job, this.busy);
      }
    }

    /** 先保存已创建的任务 ID 再通知界面，页面重载后可继续收尾。 */
    #save() {
      try {
        if (this.job) this.storage?.setItem('codex-iq.pending.v1', JSON.stringify(this.job));
        else this.storage?.removeItem('codex-iq.pending.v1');
      } catch { /* 存储受限时当前页面仍能完成收尾；界面不依赖缓存显示成功。 */ }
      this.onChange(this.job, this.busy);
    }

    /** 每次点击冻结配置；取得锁并确认没有待收尾任务后，才创建独立任务和发送问题。 */
    async run(kind, config) {
      config = { ...config };
      return this.#exclusive(async () => {
        if (this.job) throw new Error('请先处理上一项任务');
        if (!['detect', 'recover'].includes(kind) || !config.model || !config.effort) throw new Error('请选择模型和思考程度');
        const context = this.getContext();
        this.job = { id: crypto.randomUUID(), kind, ...config, promptRevision: PROMPT_REVISION, stage: 'creating', startedAt: Date.now(), threadId: null, turnId: null, result: null };
        // 账号代次只存在当前页面内存中；重载或其他窗口接手的任务不推断账号归属。
        this.#owner = { id: this.job.id, context };
        this.#save();
        try {
          const started = await this.rpc.request('thread/start', {
            model: config.model, allowProviderModelFallback: false, ephemeral: false,
            projectId: null, historyMode: 'legacy', environments: [], dynamicTools: [],
            approvalPolicy: 'never', sandbox: 'read-only'
          });
          this.job.threadId = started.thread.id;
          this.job.stage = 'starting';
          this.#save();
          if (started.model !== config.model) throw new Error(`实际配置模型为 ${started.model}，与所选模型不符`);
          // 命名失败不重复创建任务；它不影响模型请求和归档。
          try { await this.rpc.request('thread/name/set', { threadId: this.job.threadId, name: `${kind === 'detect' ? '智商检测' : '恢复智商'} · ${config.model} · ${config.effort}` }); } catch { /* 标题不是执行前置条件。 */ }
          if (context !== this.getContext()) throw new Error('账号已切换，未发送模型请求，请处理已创建的空任务');
          const response = await this.rpc.request('turn/start', {
            threadId: this.job.threadId, model: config.model, effort: config.effort, environments: [],
            input: [{ type: 'text', text: kind === 'detect' ? DETECT_PROMPT : RECOVER_PROMPT, text_elements: [] }]
          });
          this.job.turnId = response.turn.id;
          this.job.stage = 'running';
          this.#save();
          return await this.#finish();
        } catch (error) {
          // turn/start 超时可能已启动模型；保留 ID，下次只查询，不重复发问。
          if (this.job) {
            this.job.error = error.message;
            if (!['archiveFailed', 'archiving'].includes(this.job.stage)) this.job.stage = error.uncertain ? 'uncertain' : 'needsCheck';
            if (!this.job.threadId && !error.uncertain) this.job = null;
          }
          throw error;
        } finally { this.#save(); }
      });
    }

    /** 轮询完整回合避免漏掉快速完成的事件；只有终态能进入归档步骤。 */
    async #finish() {
      const deadline = Date.now() + this.timeout;
      while (Date.now() < deadline) {
        const { thread } = await this.rpc.request('thread/read', { threadId: this.job.threadId, includeTurns: true });
        const turn = this.job.turnId ? thread.turns.find(t => t.id === this.job.turnId) : thread.turns.at(-1);
        if (turn) this.job.turnId = turn.id;
        if (turn && terminal(turn.status)) {
          if (turn.itemsView && turn.itemsView !== 'full') throw new Error('任务回答未完整加载，不能可靠判定');
          this.job.result = inspectTurn(turn, this.job.kind);
          this.job.stage = 'archiving';
          this.#save();
          return await this.#archive();
        }
        await this.sleep(this.interval);
      }
      this.job.stage = 'needsCheck';
      throw new Error('等待超过 3 分钟；任务已保留，点击“检查并收尾”继续等待');
    }

    /** 归档前应用当前阈值；失败保留答案和 ID，重试不会再次调用模型。 */
    async #archive() {
      // 包括旧版“归档失败”的记录：只收尾，不能把带答案示例的旧回答标成新版正常。
      if (this.job.kind === 'detect' && this.job.promptRevision !== PROMPT_REVISION) {
        this.job.result = { status: 'unknown', text: this.job.result?.text || '', detail: '这是旧问题的回答，请用新版问题重新检测' };
      } else if (this.job.kind === 'detect' && ['normal', 'abnormal'].includes(this.job.result?.status)) {
        // 升级后收尾可能读到旧阈值的结论；仅重算已确认版本，保留工具无效等 unknown 状态。
        this.job.result = { ...this.job.result, ...classifyVersion(this.job.result.version) };
      }
      const completed = { ...this.job };
      try { await this.rpc.request('thread/archive', { threadId: completed.threadId }); }
      catch (error) { this.job.stage = 'archiveFailed'; this.job.error = error.message; this.#save(); throw error; }
      const belongsToCurrentContext = this.#owner?.id === this.#identity(completed) && this.#owner?.context === this.getContext();
      this.job = null;
      this.#owner = null;
      this.#save();
      return { ...completed, stage: 'completed', archived: true, belongsToCurrentContext, elapsedMs: Date.now() - completed.startedAt };
    }

    /** 页面重载或超时后只检查原任务，绝不重发原始提示词。 */
    async resume() {
      const expected = this.#identity(this.job);
      return this.#exclusive(async () => {
        if (expected !== this.#identity(this.job)) throw new Error('待收尾任务已变化，请查看更新后的记录');
        if (!this.job?.threadId) throw new Error('没有可检查的任务 ID；请在任务列表核对不确定的创建请求');
        try {
          // 已确认终态的任务仅重试归档。
          if (['archiveFailed', 'archiving'].includes(this.job.stage) && this.job.result) return await this.#archive();
          const { thread } = await this.rpc.request('thread/read', { threadId: this.job.threadId, includeTurns: true });
          if (!thread.turns.length && this.job.stage === 'needsCheck') {
            this.job.result = { status: 'error', text: '', detail: this.job.error || '模型请求未启动' };
            return await this.#archive();
          }
          return await this.#finish();
        } finally { this.#save(); }
      });
    }

    /** 用户核对任务列表后可清除无 ID 的等待记录；锁内核对身份，不能代替其他任务的归档。 */
    async discard() {
      const expected = this.#identity(this.job);
      return this.#exclusive(async () => {
        if (expected !== this.#identity(this.job)) throw new Error('待收尾任务已变化，请查看更新后的记录');
        if (!this.job || this.job.threadId) throw new Error('该记录包含任务 ID，请先检查并归档');
        this.job = null;
        this.#owner = null;
        this.#save();
      });
    }
  }
  /**
   * 只提取 Codex 账号额度，避免把 Spark 等独立桶显示为通用额度。
   * 按实际窗口时长命名；缺失用量不当作 0%，缺失重置时间不推算。
   */
  function usageWindows(response) {
    const buckets = response?.rateLimitsByLimitId;
    const bucket = buckets && typeof buckets === 'object' ? buckets.codex : response?.rateLimits;
    if (!bucket || bucket.limitId && bucket.limitId !== 'codex') return [];
    return ['primary', 'secondary'].flatMap(key => {
      const value = bucket[key];
      if (!value || typeof value.usedPercent !== 'number' || !Number.isFinite(value.usedPercent)) return [];
      const minutes = Number.isFinite(value.windowDurationMins) && value.windowDurationMins > 0 ? value.windowDurationMins : null;
      const label = minutes === 10080 ? '本周额度' : minutes === 300 ? '5 小时额度' : minutes ? `${minutes >= 1440 && minutes % 1440 === 0 ? minutes / 1440 + ' 天' : minutes >= 60 && minutes % 60 === 0 ? minutes / 60 + ' 小时' : minutes + ' 分钟'}额度` : '额度';
      const resetsAt = typeof value.resetsAt === 'number' && value.resetsAt > 0 && Number.isFinite(new Date(value.resetsAt * 1000).getTime()) ? value.resetsAt : null;
      return [{ key, label, minutes, remaining: Math.min(100, Math.max(0, 100 - value.usedPercent)), resetsAt }];
    }).sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0));
  }

  /** 重置时间来自服务端；倒计时结束也不推断额度已恢复，更不执行额度重置。 */
  function usageReset(resetsAt, now = Date.now()) {
    if (!Number.isFinite(resetsAt) || resetsAt <= 0) return { relative: '重置时间暂不可用', absolute: '' };
    const date = new Date(resetsAt * 1000);
    if (!Number.isFinite(date.getTime())) return { relative: '重置时间暂不可用', absolute: '' };
    const absolute = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date) + ' · 北京时间';
    const milliseconds = date.getTime() - now;
    const hours = Math.floor(milliseconds / 3600000), days = Math.floor(hours / 24);
    const relative = milliseconds <= 0 ? '等待额度更新' : days ? `${days} 天${hours % 24 ? ' ' + hours % 24 + ' 小时' : ''}后重置` : hours ? `${hours} 小时后重置` : milliseconds >= 60000 ? `${Math.floor(milliseconds / 60000)} 分钟后重置` : '不到 1 分钟后重置';
    return { relative, absolute };
  }

  /**
   * 管理额度读取的独立状态：重复刷新合并；账号切换或卸载后丢弃旧响应。
   * 只保留显示所需窗口，不缓存账号信息、积分或重置凭证；失败不影响检测请求。
   */
  class UsageReader {
    constructor(rpc, onChange = () => {}) {
      this.rpc = rpc; this.onChange = onChange; this.revision = 0; this.request = null;
      this.state = { status: 'loading', windows: [], updatedAt: null };
    }
    /** 账号变化时先作废在途响应，再清空显示；下一次刷新可立即为新账号发起。 */
    clear() {
      this.revision++; this.request = null;
      this.state = { status: 'loading', windows: [], updatedAt: null }; this.onChange();
    }
    /** 完整快照替代稀疏通知，避免自行合并时把缺失窗口误清空；不请求重置凭证详情。 */
    refresh() {
      if (this.request) return this.request;
      const revision = this.revision;
      this.state = { ...this.state, status: 'loading' }; this.onChange();
      this.request = Promise.resolve().then(() => this.rpc.request('account/rateLimits/read', { excludeResetCreditDetails: true })).then(response => {
        if (revision !== this.revision) return;
        const windows = usageWindows(response);
        this.state = { status: windows.length ? 'ready' : 'empty', windows, updatedAt: Date.now() };
      }).catch(() => {
        if (revision === this.revision) this.state = { status: 'error', windows: [], updatedAt: null };
      }).finally(() => {
        if (revision === this.revision) { this.request = null; this.onChange(); }
      });
      return this.request;
    }
  }

  /** GPT-6 按用户确认的五档展示；接口中的 Ultra 不代表常规菜单已启用。
   * 仅过滤该模型的额外档位，不补造接口未提供的选项，也不改变其他模型目录。
   */
  function selectableEfforts(model) {
    return (model?.supportedReasoningEfforts ?? []).filter(({ reasoningEffort }) => model.model !== 'gpt-6-astra' || reasoningEffort !== 'ultra');
  }

  const api = { DETECT_PROMPT, RECOVER_PROMPT, PROMPT_REVISION, classifyVersion, classifyAnswer, inspectRecovery, inspectTurn, createBridge, Runner, selectableEfforts, usageWindows, usageReset, UsageReader };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CodexIQCore = api;
})(globalThis);
