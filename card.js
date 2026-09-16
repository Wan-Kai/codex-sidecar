(function () {
  'use strict';
  if (window.__codexIQCard) return;
  const { createBridge, Runner, DETECT_PROMPT, selectableEfforts, usageReset, UsageReader } = window.CodexIQCore;
  const { resetView } = window.CodexIQReset;
  const rpc = createBridge(window);
  const host = document.createElement('codex-iq-card');
  host.id = 'codex-iq-card';
  host.style.cssText = 'display:block;flex-shrink:0;min-width:0;margin:6px 8px;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{font-family:inherit;color:var(--text-default,#292929);font-size:12px;line-height:1.5;color-scheme:light dark}
    *{box-sizing:border-box}[hidden]{display:none!important}
    /* 收紧侧栏占用时优先减少留白和装饰；正文保持 12px，选择器和操作按钮保持 30px 高。 */
    .card{background:var(--surface-primary,#fff);border:1px solid var(--border-default,#dededb);border-radius:12px;padding:10px;max-height:min(480px,calc(100vh - 144px));overflow-y:auto;scrollbar-width:thin}
    button,select{font:inherit;color:inherit}button{cursor:pointer;border:0;background:none;border-radius:7px}button:disabled,select:disabled{cursor:default;opacity:.5}
    button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #7b8b9e;outline-offset:2px}button:hover:not(:disabled){background:var(--surface-secondary,#f1f1ee)}
    header{display:flex;align-items:center;gap:7px;min-height:24px}svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}
    .brand-mark{display:grid;place-items:center;width:24px;height:24px;flex:none;border-radius:7px;background:var(--surface-secondary,#f1f2ef);color:var(--text-default,#3c4841)}.brand-mark svg{width:16px;height:16px}
    strong{font-size:12px;font-weight:600;white-space:nowrap}.status{margin-left:auto;font-size:11px;color:var(--text-secondary,#80807c);white-space:nowrap;display:flex;gap:5px;align-items:center}
    .status:before{content:'';width:5px;height:5px;background:currentColor;border-radius:50%}.status[data-state=normal]{color:#27815e}.status[data-state=abnormal]{color:#b87526}.status[data-state=error]{color:#b75b50}
    #toggle{padding:4px;width:24px;height:24px;display:grid;place-items:center}#toggle[aria-expanded=true] svg{transform:rotate(180deg)}
    .config{--config-hover:var(--surface-secondary,#f1f1ee);display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:2px 0;text-align:left;margin-top:8px;color:var(--text-secondary,#777770);font-size:12px}
    /* 用外扩背景增加文字四周留白，不改按钮盒模型，保持文字与上下内容的位置。 */
    #config:is(:hover,:focus-visible):not(:disabled){background:var(--config-hover);box-shadow:0 0 0 4px var(--config-hover)}
    @media(prefers-color-scheme:dark){.config{--config-hover:var(--surface-secondary,#373737)}}
    #config-model{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#config-effort{flex:none;font-size:11px}
    #settings{display:grid;gap:6px;margin-top:10px}label{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:8px;font-size:11px;color:var(--text-secondary,#777770)}
    select{width:100%;min-width:0;height:30px;padding:4px 8px;border:1px solid var(--border-default,#dededb);border-radius:8px;background:var(--surface-primary,#fff);font-size:12px;color:var(--text-default,#292929)}
    /* 使用浏览器的可定制原生选择器：保留键盘、焦点与 change 行为，浮层不被卡片滚动区域裁切。
       旧内核不支持时保留原生菜单；不引入第二套选中状态或手工定位逻辑。 */
    @supports(appearance:base-select){
      :host{--iq-picker-bg:#fff;--iq-picker-border:#dededb;--iq-option-hover:#f4f5f2;--iq-option-selected:#edf2ed;--iq-option-ink:#354b3d;--iq-focus:#a1afa5}
      select,select::picker(select){appearance:base-select}
      select{display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer;padding:4px 9px;outline:none}
      select:hover:not(:disabled){border-color:var(--iq-focus)}
      select:open{border-color:var(--iq-focus);box-shadow:0 0 0 2px color-mix(in srgb,var(--iq-focus) 12%,transparent)}
      select:focus-visible{outline:2px solid var(--iq-focus);outline-offset:2px}
      select::picker-icon{content:'';width:7px;height:7px;flex:none;margin-left:auto;margin-right:2px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg);opacity:.65}
      select:open::picker-icon{transform:translateY(2px) rotate(225deg)}
      select::picker(select){min-inline-size:anchor-size(self-inline);max-inline-size:calc(100vw - 24px);max-block-size:min(248px,calc(100vh - 24px));margin-block:6px;padding:4px;border:1px solid var(--iq-picker-border);border-radius:10px;background:var(--iq-picker-bg);color:inherit;font:inherit;box-shadow:0 10px 28px #0000001a,0 2px 6px #00000008;overflow-y:auto;scrollbar-width:thin}
      option{display:flex;align-items:center;gap:10px;min-height:30px;margin:0;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;line-height:18px;overflow-wrap:anywhere}
      option+option{margin-top:2px}
      option:checked{background:var(--iq-option-selected);color:var(--iq-option-ink);font-weight:550}
      option:hover,option:focus{background:var(--iq-option-hover);outline:none}
      option:checked:hover,option:checked:focus{background:var(--iq-option-selected)}
      option:focus-visible{outline:1px solid var(--iq-focus);outline-offset:-1px}
      option::checkmark{content:'✓';order:1;flex:none;margin-left:auto;font-size:13px;font-weight:600;color:var(--iq-option-ink)}
      @media(prefers-color-scheme:dark){:host{--iq-picker-bg:#292c29;--iq-picker-border:#454b45;--iq-option-hover:#343a34;--iq-option-selected:#364439;--iq-option-ink:#d3e5d5;--iq-focus:#809786}}
    }
    .result{margin-top:10px}#info{margin:0;color:var(--text-default,#292929);font-size:12px;overflow-wrap:anywhere;max-height:78px;overflow-y:auto}
    .actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}.actions button{display:flex;align-items:center;justify-content:center;gap:5px;min-height:30px;padding:4px 7px;white-space:nowrap;font-size:12px;border-radius:8px}.actions svg{width:14px;height:14px}
    #recover{border:1px solid var(--border-default,#dededb)}#detect{color:var(--surface-primary,#fff);background:var(--text-default,#292929)}#detect:hover:not(:disabled){opacity:.85;background:var(--text-default,#292929)}
    #cleanup{margin-top:9px;text-decoration:underline;padding:0;font-size:11px;overflow-wrap:anywhere;text-align:left}
    details{margin-top:10px;border-top:1px solid var(--border-default,#dededb);padding-top:8px}summary{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:var(--text-secondary,#777770);list-style:none;min-height:18px}summary::-webkit-details-marker{display:none}summary svg{width:12px;height:12px}details[open] summary svg{transform:rotate(90deg)}
    .answer{font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;max-height:132px;overflow-y:auto;margin:12px 0}.rule{font-size:11px;line-height:1.65;color:var(--text-secondary,#777770);margin:8px 0}.rule-label{font-weight:600}
    @media(prefers-color-scheme:dark){.brand-mark{background:var(--surface-secondary,#343b36);color:var(--text-default,#cbd8cf)}}
    @media(prefers-color-scheme:dark){:host{color:var(--text-default,#e5e5e2)}.card{background:var(--surface-primary,#252525);border-color:var(--border-default,#42423f)}select{color:var(--text-default,#e5e5e2);background:var(--surface-primary,#252525);border-color:var(--border-default,#42423f)}#info{color:var(--text-default,#e5e5e2)}#recover{border-color:var(--border-default,#42423f)}#detect{background:var(--text-default,#e5e5e2);color:var(--surface-primary,#252525)}button:hover:not(:disabled){background:var(--surface-secondary,#373737)}}
    .quota{position:relative;padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid var(--border-default,#dededb)}
    .quota-row+.quota-row{margin-top:10px}.quota-top{display:flex;align-items:center;gap:5px;min-height:22px;color:var(--text-secondary,#777770);font-size:11px}.quota-row:first-child .quota-top{padding-right:23px}
    .quota-value{margin-left:auto;font-size:12px;font-weight:550;font-variant-numeric:tabular-nums;color:var(--text-default,#292929)}
    #quota-refresh{position:absolute;right:-3px;top:0;padding:3px;width:22px;height:22px;display:grid;place-items:center}#quota-refresh svg{width:13px;height:13px}
    .quota-track{height:4px;background:var(--surface-secondary,#eeefeb);border-radius:3px;overflow:hidden;margin-top:6px}.quota-fill{height:100%;background:#698171;border-radius:inherit}
    .quota-reset{display:flex;align-items:center;gap:5px;width:100%;text-align:left;font-size:11px;color:var(--text-secondary,#777770);padding:0;margin-top:6px;min-height:18px}.quota-reset:disabled{opacity:1}
    .quota-reset svg{width:12px;height:12px}.quota-reset .reset-more{margin-left:auto;opacity:.6;width:10px}.quota-reset[aria-expanded=true] .reset-more{transform:rotate(90deg)}
    .quota-date{font-size:10px;color:var(--text-secondary,#777770);margin:3px 0 0 17px}.quota-note{font-size:11px;color:var(--text-secondary,#777770);margin:4px 0 0}
    .quota-row[data-low=true] .quota-value{color:#ab6c26}.quota-row[data-low=true] .quota-fill{background:#b78644}

    /* 将账号倒计时与 Tibo 消息放在同一组，用短间距替代分割线；保留 24px 点击高度。 */
    .tibo{margin-top:3px}
    .tibo-toggle{display:flex;align-items:center;gap:6px;width:100%;min-height:24px;padding:2px 0;text-align:left;font-size:11px;color:var(--text-secondary,#777770)}
    .tibo-toggle>.tibo-icon{width:13px;height:13px;opacity:.8}.tibo-label{white-space:nowrap}.tibo-state{margin-left:auto;white-space:nowrap;color:var(--text-secondary,#777770);font-weight:450}.tibo-toggle .tibo-chevron{width:10px;height:10px;opacity:.6}.tibo-toggle[aria-expanded=true] .tibo-chevron{transform:rotate(90deg)}
    .tibo[data-state=announced] .tibo-state{color:#496e8a}.tibo[data-state=confirmed] .tibo-state{color:#27815e}.tibo[data-state=error] .tibo-state{color:#a77335}
    .tibo-time{font-size:11px;font-weight:550;margin:0 0 2px 19px;color:var(--text-default,#292929);font-variant-numeric:tabular-nums}
    .tibo-detail{padding:6px 0 1px 19px;font-size:10px;line-height:1.7;color:var(--text-secondary,#777770)}.tibo-detail p{margin:0 0 5px;overflow-wrap:anywhere}.tibo-checked{opacity:.85}.tibo-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px}.tibo-source{display:inline-flex;gap:4px;align-items:center;color:inherit;text-decoration:none;border-radius:3px}.tibo-source:hover{text-decoration:underline}.tibo-source:focus-visible{outline:2px solid #7b8b9e;outline-offset:3px}.tibo-source svg{width:10px;height:10px}
    @media(prefers-color-scheme:dark){.tibo-time{color:var(--text-default,#e5e5e2)}.tibo[data-state=announced] .tibo-state{color:#92b6d0}.tibo[data-state=confirmed] .tibo-state{color:#82bda3}.tibo[data-state=error] .tibo-state{color:#cfa773}}

  </style>
  <section class="card" aria-label="智商检测卡片" aria-busy="false">
    <section id="quota" class="quota" aria-label="账号额度" aria-busy="true"><button id="quota-refresh" aria-label="刷新额度与 Tibo 重置" title="刷新额度与 Tibo 重置"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 8a6 6 0 1 1 0 5M4 4v4h4"/></svg></button><div id="quota-rows"></div><section id="tibo" class="tibo" aria-label="Tibo 重置消息"><button id="tibo-toggle" class="tibo-toggle" aria-expanded="false" aria-controls="tibo-detail"><svg class="tibo-icon" aria-hidden="true" viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M5 2v3m6-3v3M2.5 7h11M5.5 10h2"/></svg><span class="tibo-label">Tibo 重置</span><span id="tibo-state" class="tibo-state" role="status"></span><svg class="tibo-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></svg></button><p id="tibo-time" class="tibo-time" hidden></p><div id="tibo-detail" class="tibo-detail" hidden><p id="tibo-description" class="tibo-description"></p><p id="tibo-checked" class="tibo-checked"></p><div class="tibo-footer"><a class="tibo-source" href="https://aihot.news/codex-reset" target="_blank" rel="noopener noreferrer">来源：AIHOT<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3l-7 7"/></svg></a><a id="tibo-original" class="tibo-source" target="_blank" rel="noopener noreferrer" hidden>原帖 ↗</a></div></div></section></section>
    <header><span class="brand-mark"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg></span><strong>智商检测</strong><span id="status" class="status" role="status">连接中</span><button id="toggle" title="模型设置" aria-label="展开模型设置" aria-expanded="false" aria-controls="settings"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m6 8 4 4 4-4"/></svg></button></header>
    <button id="config" class="config" aria-label="修改模型和推理强度"><span id="config-model">读取可用模型…</span><span id="config-effort"></span></button>
    <div id="settings" hidden><label>模型<select id="model" aria-label="模型"></select></label><label>推理强度<select id="effort" aria-label="推理强度"></select></label></div>
    <div id="result" class="result" hidden><p id="info" role="status" hidden></p></div>
    <div class="actions"><button id="recover" disabled><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 8a6 6 0 1 1 0 5M4 4v4h4"/></svg><span id="recover-label">恢复智商</span></button><button id="detect" disabled><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7 4 8 6-8 6z"/></svg><span id="detect-label">检测</span></button></div><button id="cleanup" hidden>检查并收尾</button>
    <details id="details" hidden><summary><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></svg><span>回答与判定依据</span></summary><div class="answer" id="answer"></div><p class="rule" id="evidence"></p><p class="rule">按回答中确认的 Gemini 版本判定：3 系列及以上正常，包括仅回答 3 或 3.；2 系列及以下异常。有歧义则不判定。恢复完成后需复测。</p><p class="rule rule-label">检测问题</p><p id="question" class="rule"></p><p id="task" class="rule"></p></details>
  </section>`;
  const $ = id => root.getElementById(id);
  $('question').textContent = DETECT_PROMPT;
  // 文案逐项对齐安装版 Codex zh-CN 的 composer.mode.local.reasoning.* 标签。
  const effortLabels = { none: '无', minimal: '极低', low: '轻度', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: 'Ultra' };
  const labels = { normal: '正常', abnormal: '异常', unknown: '无法判定', error: '请求失败', recovered: '待复测' };
  let models = [], ready = false, expanded = false, disposed = false, accountEpoch = 0;
  let last = null, recovery = null, message = '', config = { model: '', effort: '' };
  let runner, quotaTimer = null;
  let resetState = { status: 'loading', snapshot: null }, resetRefreshRequested = false, resetReceivedAt = Date.now();
  const quotaExpanded = new Set();
  const usage = new UsageReader(rpc, renderQuota);
  runner = new Runner(rpc, { storage: window.localStorage, locks: navigator.locks, getContext: () => accountEpoch, onChange: () => render() });
  if (runner.job) config = { model: runner.job.model, effort: runner.job.effort };

  /** 统一渲染状态；恢复不会覆盖上次检测，只有新的检测回答能更新正常/异常。 */
  function render() {
    if (!runner) return;
    const job = runner.job, busy = runner.busy;
    const result = job?.result ?? recovery?.result ?? last?.result;
    const locked = busy || !!job || !ready;
    root.querySelector('.card').setAttribute('aria-busy', String(busy));
    $('model').disabled = locked; $('effort').disabled = locked;
    $('recover').disabled = locked; $('detect').disabled = locked;
    $('detect-label').textContent = busy && job?.kind === 'detect' ? '检测中…' : last || recovery ? '复测' : '检测';
    $('recover-label').textContent = busy && job?.kind === 'recover' ? '执行中…' : '恢复智商';
    $('status').textContent = busy ? job?.stage === 'archiving' ? '归档中' : '请求中' : job ? '待收尾' : message ? '需检查' : result ? labels[result.status] : ready ? '待检测' : '连接中';
    $('status').dataset.state = busy || job || message ? 'idle' : result?.status || 'idle';
    const model = models.find(m => m.model === config.model);
    $('config-model').textContent = model?.displayName || model?.model || '读取可用模型…';
    $('config-effort').textContent = model ? effortLabels[config.effort] || config.effort : '';
    $('config').title = `${$('config-model').textContent} · ${$('config-effort').textContent}`;
    // 配置展开时隐藏摘要，避免同一型号出现两遍且把按钮挤到下一行。
    $('config').hidden = expanded;
    $('toggle').setAttribute('aria-expanded', String(expanded));
    $('toggle').setAttribute('aria-label', expanded ? '收起模型设置' : '展开模型设置');
    $('settings').hidden = !expanded;
    // 成功检测仅在标题旁显示结论；正文区域留给进行中、失败及恢复后的必要提示。
    $('info').textContent = message || (job ? job.result ? '回答已收到，等待归档' : `独立任务${job.threadId ? '已创建' : '创建中'}，结束后自动归档` : result && !['normal', 'abnormal'].includes(result.status) ? result.detail : '');
    $('info').hidden = !$('info').textContent;
    $('result').hidden = $('info').hidden;
    const record = job?.result ? job : recovery ?? last;
    $('cleanup').hidden = busy || (!job && ready);
    $('cleanup').textContent = job ? job.threadId ? job.stage === 'archiveFailed' ? '重试归档' : '检查并收尾' : '已核对任务列表，清除本地等待' : '重新连接';
    $('answer').textContent = record?.result?.text || '';
    $('evidence').textContent = record?.result?.version ? `识别版本：${record.result.version}` : record?.result?.reason || '';
    $('evidence').hidden = !$('evidence').textContent;
    $('details').hidden = !record?.result;
    $('task').textContent = record?.threadId ? `任务 ID：${record.threadId}` : '';
  }

  /**
   * 按额度自身结果渲染窗口和共用刷新入口；Tibo 失败不能阻塞额度操作。
   * 无入参；只更新 DOM，无返回值，时间戳明确属于额度查询。
   */
  function renderQuota() {
    if (disposed) return;
    const { status, windows, updatedAt } = usage.state;
    $('quota-refresh').disabled = status === 'loading';
    $('quota').setAttribute('aria-busy', String(status === 'loading'));
    $('quota-refresh').title = updatedAt ? `刷新额度与 Tibo 重置 · 额度上次更新 ${new Date(updatedAt).toLocaleTimeString('zh-CN')}` : '刷新额度与 Tibo 重置';
    if (!windows.length) {
      const row = document.createElement('div');
      row.className = 'quota-row';
      row.innerHTML = '<div class="quota-top"><span>账号额度</span><span class="quota-value"></span></div><p class="quota-note"></p>';
      row.querySelector('.quota-value').textContent = status === 'loading' ? '读取中…' : status === 'error' ? '暂时无法读取' : '暂无额度信息';
      row.querySelector('.quota-note').textContent = status === 'error' ? '点击右上角重试' : status === 'empty' ? '当前账号未返回 Codex 额度' : '';
      row.querySelector('.quota-note').hidden = status === 'loading';
      $('quota-rows').replaceChildren(row); return;
    }
    $('quota-rows').replaceChildren(...windows.map(value => {
      const row = document.createElement('div'), reset = usageReset(value.resetsAt);
      row.className = 'quota-row'; row.dataset.low = String(value.remaining <= 10);
      // 模板结构固定；显示值只来自本地规范化函数，服务端字符串不作为 HTML 插入。
      row.innerHTML = '<div class="quota-top"><span class="quota-label"></span><span class="quota-value"></span></div><div class="quota-track" role="meter" aria-valuemin="0" aria-valuemax="100"><div class="quota-fill"></div></div><button class="quota-reset"><svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2 1.5"/></svg><span></span><svg class="reset-more" aria-hidden="true" viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></svg></button><p class="quota-date" hidden></p>';
      row.querySelector('.quota-label').textContent = value.label;
      row.querySelector('.quota-value').textContent = `剩余 ${value.remaining}%`;
      const track = row.querySelector('.quota-track');
      track.setAttribute('aria-label', `${value.label}剩余比例`); track.setAttribute('aria-valuenow', String(value.remaining));
      row.querySelector('.quota-fill').style.width = `${value.remaining}%`;
      const button = row.querySelector('.quota-reset'), date = row.querySelector('.quota-date');
      date.id = `quota-date-${value.key}`; date.textContent = reset.absolute;
      date.hidden = !reset.absolute || !quotaExpanded.has(value.key);
      button.disabled = !reset.absolute; button.title = reset.absolute;
      button.querySelector('span').textContent = reset.relative;
      button.querySelector('.reset-more').hidden = !reset.absolute;
      button.setAttribute('aria-expanded', String(!date.hidden)); button.setAttribute('aria-controls', date.id);
      button.onclick = () => {
        date.hidden = !date.hidden;
        if (date.hidden) quotaExpanded.delete(value.key); else quotaExpanded.add(value.key);
        button.setAttribute('aria-expanded', String(!date.hidden));
      };
      return row;
    }));
  }

  /**
   * 所有额度读取都由此联动公共消息，先登记意图，再独立读取额度，不等待外部站点。
   * 无入参；返回额度读取 Promise。进行中的额度请求复用，不重复登记 Tibo 请求。
   */
  function refreshUsageAndReset() {
    if (disposed) return Promise.resolve();
    if (!usage.request) resetRefreshRequested = true;
    return usage.refresh();
  }

  /**
   * 高频额度通知合并为一次联合刷新；执行时仍需可见，避免切到后台后留下无效请求。
   * 无入参和返回值；只登记一秒定时器，读取结果由各自状态入口更新。
   */
  function queueUsageRefresh() {
    if (disposed || document.hidden || quotaTimer) return;
    quotaTimer = setTimeout(() => { quotaTimer = null; refreshVisibleUsage(); }, 1000);
  }

  /**
   * 定时、通知或回到前台时同时更新额度和重置消息；后台页面不发起周期查询。
   * 无入参和返回值；两项请求独立完成，避免一项失败影响另一项。
   */
  function refreshVisibleUsage() {
    if (!document.hidden && !disposed) refreshUsageAndReset();
  }

  /** 模型和档位来自当前应用的实时目录，不补造不可用选项。 */
  function fillOptions() {
    $('model').replaceChildren(...models.map(m => new Option(m.displayName || m.model, m.model)));
    $('model').value = config.model;
    const model = models.find(m => m.model === config.model);
    const efforts = selectableEfforts(model);
    // 默认档位也必须属于过滤后的菜单，避免目录默认值让 Ultra 重新进入新请求。
    if (!efforts.some(e => e.reasoningEffort === config.effort)) config.effort = efforts.some(e => e.reasoningEffort === 'medium') ? 'medium' : efforts.find(e => e.reasoningEffort === model?.defaultReasoningEffort)?.reasoningEffort || efforts[0]?.reasoningEffort || '';
    $('effort').replaceChildren(...efforts.map(e => new Option(effortLabels[e.reasoningEffort] || e.reasoningEffort, e.reasoningEffort)));
    $('effort').value = config.effort;
  }

  /** 连接失败可重试；账号变化后清空旧结果，避免把旧账号结果显示在新账号上。 */
  async function connect() {
    const epoch = accountEpoch;
    ready = false; message = ''; render();
    try {
      let cursor = null, list = [];
      do {
        const page = await rpc.request('model/list', { includeHidden: false, limit: 100, cursor });
        list.push(...page.data); cursor = page.nextCursor;
      } while (cursor);
      if (epoch !== accountEpoch || disposed) return;
      models = list.filter(m => !m.hidden && selectableEfforts(m).length);
      if (!models.length) throw new Error('当前账号没有可选模型');
      config.model = models.find(m => m.model === config.model)?.model || models.find(m => m.model === 'gpt-6-astra')?.model || models.find(m => m.isDefault)?.model || models[0].model;
      config.effort ||= 'medium'; fillOptions(); ready = true;
      if (runner.job) message = '有上次未完成收尾的任务，请检查并归档';
    } catch (error) { message = error.message; }
    render();
  }

  /** 展示前同时检查原任务归属与本次操作期间的账号变化；归属未知的历史记录只收尾。 */
  async function perform(kind, resume = false) {
    const epoch = accountEpoch;
    message = '';
    try {
      const completed = resume ? await runner.resume() : await runner.run(kind, { ...config });
      if (!completed.belongsToCurrentContext || epoch !== accountEpoch) { message = '原任务已归档，请为当前账号重新检测'; return; }
      if (completed.kind === 'recover') recovery = completed;
      else { last = completed; recovery = null; }
    } catch (error) { message = error.message; }
    finally { render(); queueUsageRefresh(); }
  }

  /**
   * 展示加载器传入的公开快照；查询随额度触发，但结果与错误独立呈现。
   * 无入参和返回值；同步中隐藏旧预告，避免把等待同步误报成接口错误。
   */
  function renderReset() {
    if (disposed) return;
    // 超过同步宽限期只表示等待后台消息，不能当作接口读取失败或重置正在执行。
    // 收到下一次快照后自动恢复数据源状态；核验时间是否过期仍由 resetView 判断。
    const disconnected = resetReceivedAt && Date.now() - resetReceivedAt > 45000;
    const view = resetView(disconnected ? { ...resetState, status: 'syncing' } : resetState);
    $('tibo').dataset.state = view.status;
    $('tibo-state').textContent = view.label;
    $('tibo-time').textContent = view.time; $('tibo-time').hidden = !view.time;
    $('tibo-description').textContent = view.description;
    $('tibo-checked').textContent = view.checked;
    $('tibo-original').hidden = !view.source;
    if (view.source) $('tibo-original').href = view.source; else $('tibo-original').removeAttribute('href');
  }

  /** 展开仅改变辅助说明；已知的预计时间始终展示在主行下方。 */
  function toggleResetDetails() {
    $('tibo-detail').hidden = !$('tibo-detail').hidden;
    $('tibo-toggle').setAttribute('aria-expanded', String(!$('tibo-detail').hidden));
  }

  $('toggle').onclick = $('config').onclick = () => { expanded = !expanded; render(); };
  $('model').onchange = () => { config.model = $('model').value; fillOptions(); last = recovery = null; message = ''; render(); };
  $('effort').onchange = () => { config.effort = $('effort').value; last = recovery = null; message = ''; render(); };
  $('detect').onclick = () => perform('detect');
  $('recover').onclick = () => perform('recover');
  /** 清理也通过 Runner 的互斥入口；界面不能直接删除另一窗口的任务记录。 */
  $('cleanup').onclick = async () => {
    if (!runner.job) { connect(); return; }
    if (!runner.job.threadId) {
      try { await runner.discard(); message = '本地等待已清除；未确认的任务需在列表手动归档'; }
      catch (error) { message = error.message; }
      render(); return;
    }
    await perform(runner.job.kind, true);
  };
  $('quota-refresh').onclick = refreshUsageAndReset;
  $('tibo-toggle').onclick = toggleResetDetails;
  const resetInterval = setInterval(renderReset, 15000);
  const quotaInterval = setInterval(refreshVisibleUsage, 60000);
  document.addEventListener('visibilitychange', refreshVisibleUsage);
  const unsubscribe = rpc.subscribe(method => {
    if (method === 'account/updated' || method === 'account/login/completed') {
      accountEpoch++; last = recovery = null;
      clearTimeout(quotaTimer); quotaTimer = null; quotaExpanded.clear();
      usage.clear(); refreshUsageAndReset(); connect();
    } else if (method === 'account/rateLimits/updated') queueUsageRefresh();
  });

  /** 使用已核对的底部容器；它自身的 ResizeObserver 会为滚动列表预留新增高度。 */
  function mount() {
    if (disposed || host.isConnected) return;
    const candidates = [...document.querySelectorAll('.sidebar-navigation > div > div.absolute.inset-x-0.bottom-0')]
      .filter(node => node.querySelector('.h-toolbar button.sidebar-item'));
    const footer = candidates.find(node => node.getBoundingClientRect().width > 180);
    if (!footer) return;
    footer.prepend(host);
  }
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued || host.isConnected) return;
    queued = true; requestAnimationFrame(() => { queued = false; mount(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__codexIQCard = {
    version: '1.1.15',
    /** 既有加载器推送公共消息，不在页面请求第三方站点或接触账号凭据。 */
    updateReset(state) { if (!disposed) { resetState = state; resetReceivedAt = Date.now(); renderReset(); } },
    /**
     * 加载器逐轮消费额度查询登记的公共消息刷新意图，多窗口请求在后台合并。
     * 无入参；返回是否需要刷新并清空标记，避免同一次额度查询重复触发。
     */
    takeResetRefresh() { const requested = resetRefreshRequested; resetRefreshRequested = false; return requested; },
    get mounted() { return host.isConnected; },
    get pending() { return !!runner.job; },
    /** 进行中的任务需要先收尾；避免卸载后失去归档能力。 */
    dispose() {
      if (runner.busy || runner.job) throw new Error('请先完成任务收尾，再卸载卡片');
      disposed = true; clearInterval(resetInterval); clearInterval(quotaInterval); clearTimeout(quotaTimer);
      document.removeEventListener('visibilitychange', refreshVisibleUsage); usage.clear();
      observer.disconnect(); unsubscribe(); rpc.dispose(); host.remove();
      delete window.__codexIQCard;
    }
  };
  mount(); connect(); refreshUsageAndReset(); render(); renderReset();
})();
