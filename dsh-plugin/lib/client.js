window.__ModuleLoader__.load({
  id: "dsh-secrets-broker",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    const en = {
      nav: "Secrets Broker",
      intro: "Pending credential approvals from the self-hosted Secrets Broker.",
      empty: "No pending approvals.",
      loading: "Loading…",
      error: "Could not reach Secrets Broker.",
      retry: "Retry",
      open: "Open Secrets Broker",
      agent: "Agent",
      item: "Item",
      created: "Requested",
      approveOnce: "Approve once",
      approve24: "Approve 24h",
      approveAlways: "Approve forever",
      deny: "Deny",
      approved: "Approved",
      denied: "Denied"
    };
    const zh = {
      nav: "密钥授权",
      intro: "来自自托管 Secrets Broker 的待审批密钥请求。",
      empty: "暂无待审批请求。",
      loading: "加载中…",
      error: "无法连接 Secrets Broker。",
      retry: "重试",
      open: "打开 Secrets Broker",
      agent: "Agent",
      item: "条目",
      created: "请求时间",
      approveOnce: "本次",
      approve24: "24 小时",
      approveAlways: "永久",
      deny: "拒绝",
      approved: "已批准",
      denied: "已拒绝"
    };

    // Layout only. Every colour, size, radius and gap comes from the tokens in
    // SB_CSS, so the settings page and the sheet cannot drift apart.
    const s = {
      wrap: { display: "flex", flexDirection: "column", gap: "var(--sb-sp-4)", maxWidth: "760px" },
      intro: { margin: 0, color: "var(--sb-label-2)", fontSize: "var(--sb-fs-cap)" },
      row: { display: "flex", alignItems: "center", gap: "var(--sb-sp-2)", flexWrap: "wrap" },
      card: { background: "var(--sb-card)", borderRadius: "var(--sb-r-card)", padding: "var(--sb-sp-3) var(--sb-sp-4)", display: "flex", flexDirection: "column", gap: "var(--sb-sp-2)", boxShadow: "var(--sb-shadow-card)" },
      title: { margin: 0, fontSize: "var(--sb-fs-sub)", fontWeight: 600, color: "var(--sb-label)" },
      meta: { margin: 0, color: "var(--sb-label-2)", fontSize: "var(--sb-fs-cap)" },
      buttons: { display: "flex", gap: "var(--sb-sp-2)", flexWrap: "wrap", marginTop: "var(--sb-sp-1)" },
    };

    // ================= THEME TOKENS - the only place a colour, size, radius,
    // spacing or duration is spelled out. Components below reference tokens or
    // these class names; nothing else in this file may hard-code one.
    // Light and dark are both defined here: the sheet reads --sb-* variables, so
    // one CSS block covers both appearances.
    const SB_CSS = `
.sb-scope {
  --sb-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
  --sb-font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --sb-fs-body: 17px; --sb-fs-sub: 15px; --sb-fs-cap: 13px; --sb-fs-mini: 11px;
  --sb-lh-body: 22px; --sb-lh-sub: 20px; --sb-lh-cap: 18px;
  --sb-sp-1: 4px; --sb-sp-2: 8px; --sb-sp-3: 12px; --sb-sp-4: 16px; --sb-sp-5: 20px;
  --sb-r-small: 8px; --sb-r-card: 12px; --sb-r-sheet: 20px; --sb-r-pill: 999px;
  --sb-touch: 44px;
  --sb-ease: cubic-bezier(.32,.72,0,1);
  --sb-ease-back: cubic-bezier(.34,1.32,.64,1);
  --sb-dur: .3s;
  --sb-bg: #F2F2F7; --sb-card: #FFFFFF; --sb-elevated: #FFFFFF; --sb-fill: rgba(120,120,128,.12);
  --sb-label: #000000; --sb-label-2: rgba(60,60,67,.6); --sb-label-3: rgba(60,60,67,.3);
  --sb-sep: rgba(60,60,67,.18);
  --sb-blue: #007AFF; --sb-green: #34C759; --sb-red: #FF3B30; --sb-orange: #FF9500;
  --sb-on-accent: #FFFFFF;
  --sb-shadow-card: 0 1px 2px rgba(0,0,0,.05);
  --sb-shadow-sheet: 0 12px 40px rgba(0,0,0,.18);
  font-family: var(--sb-font); color: var(--sb-label);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .sb-scope {
    --sb-bg: #000000; --sb-card: #1C1C1E; --sb-elevated: #2C2C2E; --sb-fill: rgba(120,120,128,.32);
    --sb-label: #FFFFFF; --sb-label-2: rgba(235,235,245,.6); --sb-label-3: rgba(235,235,245,.3);
    --sb-sep: rgba(84,84,88,.6);
    --sb-blue: #0A84FF; --sb-green: #30D158; --sb-red: #FF453A; --sb-orange: #FF9F0A;
    --sb-shadow-card: 0 1px 2px rgba(0,0,0,.4);
    --sb-shadow-sheet: 0 12px 44px rgba(0,0,0,.6);
  }
}
html[data-theme="dark"] .sb-scope, html.dark .sb-scope, html[data-dsw-theme="dark"] .sb-scope,
html[data-theme="dark"] .sb-backdrop, html.dark .sb-backdrop {
  --sb-bg: #000000; --sb-card: #1C1C1E; --sb-elevated: #2C2C2E; --sb-fill: rgba(120,120,128,.32);
  --sb-label: #FFFFFF; --sb-label-2: rgba(235,235,245,.6); --sb-label-3: rgba(235,235,245,.3);
  --sb-sep: rgba(84,84,88,.6);
  --sb-blue: #0A84FF; --sb-green: #30D158; --sb-red: #FF453A; --sb-orange: #FF9F0A;
  --sb-shadow-sheet: 0 12px 44px rgba(0,0,0,.6);
}
.sb-launcher { position: fixed; right: var(--sb-sp-4); bottom: var(--sb-sp-4); z-index: 2147483001; width: var(--sb-touch); height: var(--sb-touch); display: grid; place-items: center; border: 0; border-radius: 14px; background: var(--sb-card); color: var(--sb-blue); font-size: 20px; cursor: pointer; box-shadow: var(--sb-shadow-sheet); transition: transform var(--sb-dur) var(--sb-ease-back), box-shadow var(--sb-dur) var(--sb-ease); }
.sb-launcher:hover { transform: translateY(-2px) scale(1.04); }
.sb-launcher:active { transform: scale(.96); box-shadow: inset 0 2px 6px rgba(0,0,0,.16); }
.sb-badge { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; border-radius: var(--sb-r-pill); background: var(--sb-red); color: #fff; font-size: var(--sb-fs-mini); line-height: 18px; text-align: center; padding: 0 var(--sb-sp-1); }
.sb-badge > span { display: block; animation: sb-roll var(--sb-dur) var(--sb-ease) both; }
.sb-backdrop { position: fixed; inset: 0; z-index: 2147482999; background: rgba(0,0,0,.28); backdrop-filter: blur(2px); animation: sb-fade var(--sb-dur) var(--sb-ease) both; }
.sb-sheet { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: min(400px, calc(100vw - 32px)); max-height: min(78vh, 660px); display: flex; flex-direction: column; overflow: hidden; background: var(--sb-bg); border-radius: var(--sb-r-sheet); box-shadow: var(--sb-shadow-sheet); transform-origin: bottom right; animation: sb-sheet-in var(--sb-dur) var(--sb-ease) both; }
.sb-nav { display: flex; align-items: center; gap: var(--sb-sp-2); padding: var(--sb-sp-3) var(--sb-sp-4); background: var(--sb-card); border-bottom: 1px solid var(--sb-sep); flex: 0 0 auto; }
.sb-nav-title { flex: 1; font-size: var(--sb-fs-body); font-weight: 600; line-height: var(--sb-lh-body); letter-spacing: -.01em; }
.sb-nav-sub { font-size: var(--sb-fs-cap); color: var(--sb-label-2); font-weight: 400; }
.sb-icon-btn { min-width: var(--sb-touch); min-height: var(--sb-touch); display: grid; place-items: center; border: 0; background: transparent; color: var(--sb-blue); font: inherit; font-size: var(--sb-fs-body); cursor: pointer; border-radius: var(--sb-r-small); transition: transform var(--sb-dur) var(--sb-ease-back), background var(--sb-dur) var(--sb-ease); }
.sb-icon-btn:active { transform: scale(.96); background: var(--sb-fill); }
.sb-seg { display: flex; gap: 2px; margin: var(--sb-sp-3) var(--sb-sp-4) var(--sb-sp-2); padding: 2px; background: var(--sb-fill); border-radius: var(--sb-r-small); flex: 0 0 auto; }
.sb-seg-btn { flex: 1; min-height: 32px; border: 0; background: transparent; color: var(--sb-label); font: inherit; font-size: var(--sb-fs-cap); border-radius: 6px; cursor: pointer; transition: background var(--sb-dur) var(--sb-ease), transform var(--sb-dur) var(--sb-ease-back); }
.sb-seg-btn[aria-selected="true"] { background: var(--sb-card); box-shadow: var(--sb-shadow-card); font-weight: 600; }
.sb-seg-btn:active { transform: scale(.97); }
.sb-body { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 0 var(--sb-sp-3) var(--sb-sp-4); }
.sb-group-head { padding: var(--sb-sp-3) var(--sb-sp-2) var(--sb-sp-1); font-size: var(--sb-fs-cap); color: var(--sb-label-2); text-transform: none; }
.sb-card { background: var(--sb-card); border-radius: var(--sb-r-card); box-shadow: var(--sb-shadow-card); margin-bottom: var(--sb-sp-2); overflow: hidden; }
.sb-row { display: flex; align-items: center; gap: var(--sb-sp-2); min-height: var(--sb-touch); padding: var(--sb-sp-3) var(--sb-sp-4); cursor: pointer; transition: background var(--sb-dur) var(--sb-ease), transform var(--sb-dur) var(--sb-ease-back); }
.sb-row + .sb-row { border-top: 1px solid var(--sb-sep); }
.sb-row:active { background: var(--sb-fill); transform: scale(.995); }
.sb-row-main { flex: 1; min-width: 0; }
.sb-row-title { font-size: var(--sb-fs-body); line-height: var(--sb-lh-body); font-weight: 600; letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-row-sub { font-size: var(--sb-fs-cap); line-height: var(--sb-lh-cap); color: var(--sb-label-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-chev { color: var(--sb-label-3); font-size: var(--sb-fs-sub); flex: 0 0 auto; }
.sb-btn { min-height: 32px; padding: 0 var(--sb-sp-3); border: 0; border-radius: var(--sb-r-pill); background: var(--sb-fill); color: var(--sb-label); font: inherit; font-size: var(--sb-fs-cap); cursor: pointer; transition: transform var(--sb-dur) var(--sb-ease-back), box-shadow var(--sb-dur) var(--sb-ease), opacity var(--sb-dur) var(--sb-ease); }
.sb-btn:active { transform: scale(.96); box-shadow: inset 0 2px 6px rgba(0,0,0,.16); }
.sb-btn[disabled] { opacity: .45; cursor: default; }
.sb-btn--primary { background: var(--sb-blue); color: var(--sb-on-accent); font-weight: 600; }
.sb-btn--danger { background: transparent; color: var(--sb-red); }
.sb-btn--wide { width: 100%; min-height: var(--sb-touch); font-size: var(--sb-fs-sub); }
.sb-actions { display: flex; gap: var(--sb-sp-2); flex-wrap: wrap; }
.sb-actions--split > .sb-btn { flex: 1 1 0; width: auto; }
.sb-table { width: 100%; border-collapse: collapse; font-size: var(--sb-fs-cap); }
.sb-table th { text-align: left; font-weight: 400; color: var(--sb-label-2); padding: var(--sb-sp-2) var(--sb-sp-3); border-bottom: 1px solid var(--sb-sep); font-size: var(--sb-fs-mini); }
.sb-table td { padding: var(--sb-sp-2) var(--sb-sp-3); border-bottom: 1px solid var(--sb-sep); color: var(--sb-label); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.sb-table tr:last-child td { border-bottom: 0; }
.sb-kv { display: flex; justify-content: space-between; gap: var(--sb-sp-3); padding: var(--sb-sp-2) var(--sb-sp-4); font-size: var(--sb-fs-sub); line-height: var(--sb-lh-sub); }
.sb-kv + .sb-kv { border-top: 1px solid var(--sb-sep); }
.sb-kv dt { color: var(--sb-label-2); }
.sb-kv dd { margin: 0; text-align: right; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-empty { padding: var(--sb-sp-5) var(--sb-sp-4); text-align: center; color: var(--sb-label-2); font-size: var(--sb-fs-sub); }
.sb-input { width: 100%; box-sizing: border-box; min-height: var(--sb-touch); padding: 0 var(--sb-sp-3); border: 1px solid var(--sb-sep); border-radius: var(--sb-r-small); background: var(--sb-card); color: var(--sb-label); font: inherit; font-size: var(--sb-fs-sub); margin-bottom: var(--sb-sp-2); }
.sb-input:focus { outline: 2px solid var(--sb-blue); outline-offset: -1px; }
.sb-page { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--sb-bg); transform: translateX(100%); transition: transform var(--sb-dur) var(--sb-ease); z-index: 2; }
.sb-page[data-in="true"] { transform: translateX(0); }
.sb-host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.sb-foot { flex: 0 0 auto; padding: var(--sb-sp-3) var(--sb-sp-4) var(--sb-sp-4); background: var(--sb-card); border-top: 1px solid var(--sb-sep); }
.sb-chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: var(--sb-r-pill); font-size: var(--sb-fs-mini); background: var(--sb-fill); color: var(--sb-label-2); }
.sb-chip--blue { background: rgba(0,122,255,.14); color: var(--sb-blue); }
.sb-chip--red { background: rgba(255,59,48,.14); color: var(--sb-red); }
.sb-chip--green { background: rgba(52,199,89,.16); color: var(--sb-green); }
.sb-roll { display: inline-block; overflow: hidden; height: 18px; line-height: 18px; }
.sb-roll > span { display: block; animation: sb-roll var(--sb-dur) var(--sb-ease) both; }
.sb-log { display: flex; align-items: baseline; gap: var(--sb-sp-2); padding: var(--sb-sp-2) var(--sb-sp-4); font-size: var(--sb-fs-cap); line-height: var(--sb-lh-cap); }
.sb-log + .sb-log { border-top: 1px solid var(--sb-sep); }
.sb-log-time { color: var(--sb-label-3); font-family: var(--sb-font-mono); font-size: var(--sb-fs-mini); flex: 0 0 auto; }
.sb-log-what { color: var(--sb-label-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-launcher svg { width: 22px; height: 22px; display: block; }
/* The settings section shares the sheet's tokens, so the panel and the page
   never drift apart. No colour here: the buttons and tables below set their
   own, and a colour on this wrapper would outrank them. */
.sb-view { display: flex; flex-direction: column; gap: var(--sb-sp-4); width: 100%; max-width: 760px; font-size: var(--sb-fs-sub); line-height: var(--sb-lh-sub); }
@keyframes sb-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes sb-sheet-in { from { opacity: 0; transform: translateY(18px) scale(.94); border-radius: 28px } to { opacity: 1; transform: none; border-radius: var(--sb-r-sheet) } }
@keyframes sb-roll { from { transform: translateY(60%); opacity: .2 } to { transform: translateY(0); opacity: 1 } }
@keyframes sb-flash { 0% { background: rgba(0,122,255,.14) } 100% { background: transparent } }
@media (prefers-reduced-motion: reduce) { .sb-scope *, .sb-sheet, .sb-page { animation: none !important; transition: none !important } }
`;
    function ensureCss() {
      if (document.getElementById('sb-theme')) return;
      const style = document.createElement('style');
      style.id = 'sb-theme';
      style.textContent = SB_CSS;
      document.head.appendChild(style);
    }

    // The lock the launcher shows: same stroke weight and corner treatment as
    // every other icon in the sheet, coloured by the current text colour.
    function lockGlyph() {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      for (const [name, value] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(name, value);
      const shackle = document.createElementNS(NS, 'path');
      shackle.setAttribute('d', 'M8.25 10.5V7.4a3.75 3.75 0 0 1 7.5 0v3.1');
      const body = document.createElementNS(NS, 'rect');
      for (const [name, value] of Object.entries({ x: '4.75', y: '10.5', width: '14.5', height: '9.25', rx: '2.75' })) body.setAttribute(name, value);
      svg.appendChild(shackle);
      svg.appendChild(body);
      return svg;
    }

    function View({ t }) {
      const [state, setState] = react.useState({ status: "loading", pending: [], requests: [] });
      const load = () => {
        setState((current) => ({ ...current, status: "loading" }));
        Promise.allSettled([
          fetch("/api/secrets-broker/pending").then((response) => response.json()),
          fetch("/api/secrets-broker/credential-requests").then((response) => response.json()),
          fetch("/api/secrets-broker/usage?hours=24").then((response) => response.json()).catch(() => ({}))
        ]).then(([pendingResult, requestResult, usageResult]) => {
          const pendingPayload = pendingResult.status === "fulfilled" ? pendingResult.value : null;
          if (!pendingPayload || pendingPayload.ok === false) throw new Error((pendingPayload && pendingPayload.error) || "broker error");
          const requestPayload = requestResult.status === "fulfilled" ? requestResult.value : null;
          const usagePayload = usageResult.status === "fulfilled" ? usageResult.value : {};
          setState({ status: "ready", pending: Array.isArray(pendingPayload.pending) ? pendingPayload.pending : [], requests: Array.isArray(requestPayload?.requests) ? requestPayload.requests : [], usage: usagePayload && usagePayload.ok === false ? null : usagePayload });
        }).catch((error) => setState({ status: "error", error: String(error.message || error), pending: [], requests: [] }));
      };
      react.useEffect(() => {
        ensureCss();
        load();
        const timer = setInterval(load, 15000);
        return () => clearInterval(timer);
      }, []);
      const decide = (id, decision) => {
        fetch("/api/secrets-broker/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, decision }) }).then((response) => response.json()).then((payload) => {
          if (!payload || payload.ok === false) throw new Error((payload && payload.error) || "failed");
          setState((current) => ({ ...current, pending: current.pending.filter((entry) => entry.id !== id) }));
        }).catch((error) => setState((current) => ({ ...current, status: "error", error: String(error.message || error) })));
      };
      const children = [
        react.createElement("p", { style: s.intro }, t("intro")),
        react.createElement("div", { style: s.row },
          react.createElement("a", { className: "sb-btn sb-btn--primary", href: "https://sb.otscup.com", target: "_blank", rel: "noreferrer" }, t("open")),
          react.createElement("button", { type: "button", className: "sb-btn", onClick: load }, t("retry"))
        )
      ];
      if (state.status === "loading") children.push(react.createElement("p", { style: s.intro }, t("loading")));
      if (state.status === "error") children.push(react.createElement("p", { style: s.intro }, t("error") + " " + (state.error || "")));
      if (state.status === "ready" && state.pending.length === 0) children.push(react.createElement("p", { style: s.intro }, t("empty")));
      for (const entry of state.pending) {
        // An approval is for one action against one target, so both belong on the
        // card: "read the value" and "use it against api.example.com" are not the
        // same request to agree to.
        const actionLabel = { "secret.read": "读取明文", "secret.use": "代持调用", "secret.fill": "网页填充", "secret.materialize": "写入本地文件" }[entry.action] || entry.action || "";
        const targetLine = [actionLabel, entry.targetOrigin].filter(Boolean).join(" · ");
        children.push(react.createElement("div", { key: entry.id, style: s.card },
          react.createElement("p", { style: s.title }, (entry.agent || "Agent") + " → " + (entry.name || "")),
          targetLine ? react.createElement("p", { style: s.meta }, targetLine) : null,
          react.createElement("p", { style: s.meta }, t("created") + ": " + (entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "")),
          react.createElement("div", { style: s.buttons },
            react.createElement("button", { type: "button", className: "sb-btn sb-btn--primary", onClick: () => decide(entry.id, "once") }, t("approveOnce")),
            react.createElement("button", { type: "button", className: "sb-btn", onClick: () => decide(entry.id, "24h") }, t("approve24")),
            react.createElement("button", { type: "button", className: "sb-btn", onClick: () => decide(entry.id, "always") }, t("approveAlways")),
            react.createElement("button", { type: "button", className: "sb-btn sb-btn--danger", onClick: () => decide(entry.id, "deny") }, t("deny"))
          )
        ));
      }
      for (const entry of state.requests || []) {
        children.push(react.createElement("div", { key: "req-" + entry.id, style: s.card },
          react.createElement("p", { style: s.title }, "需要补充密钥：" + (entry.name || "")),
          react.createElement("p", { style: s.meta }, (entry.agent || "Agent") + (entry.description ? " · " + entry.description : "")),
          react.createElement("div", { style: s.buttons },
            react.createElement("a", { className: "sb-btn sb-btn--primary", href: "https://sb.otscup.com/connect?id=" + encodeURIComponent(entry.id), target: "_blank", rel: "noreferrer" }, "打开连接器填写")
          )
        ));
      }
      const usage = state.usage;
      if (usage && usage.ok !== false) {
        const agents = Array.isArray(usage.agents) ? usage.agents : [];
        const caps = Array.isArray(usage.capabilities) ? usage.capabilities : [];
        const cell = (value, key) => react.createElement("td", { key }, value);
        const head = (...labels) => react.createElement("thead", null, react.createElement("tr", null, labels.map((label) => react.createElement("th", { key: label }, label))));
        children.push(react.createElement("p", { style: s.title }, "谁在用我的密钥（最近 " + (usage.windowHours || 24) + " 小时）"));
        if (usage.requireClassification === true) {
          children.push(react.createElement("p", { style: s.meta }, "未分类的凭据已禁止 Agent 读取明文。"));
        }
        if (agents.length === 0) {
          children.push(react.createElement("p", { style: s.intro }, "这段时间没有读取记录。"));
        } else {
          children.push(react.createElement("div", { style: s.card },
            react.createElement("table", { className: "sb-table" },
              head("Agent", "读取", "被拒", "读过的条目", "最近"),
              react.createElement("tbody", null, agents.map((agent) => react.createElement("tr", { key: agent.agent },
                cell(agent.agent, "agent"),
                cell(String(agent.reads ?? 0), "reads"),
                cell(String(agent.denied ?? 0), "denied"),
                cell(Object.entries(agent.items || {}).map(([name, count]) => name + " ×" + count).join("，") || "—", "items"),
                cell(agent.lastAt ? new Date(agent.lastAt).toLocaleString() : "—", "last")
              )))
            )
          ));
        }
        if (caps.length) {
          children.push(react.createElement("p", { style: s.title }, "当前有效授权"));
          children.push(react.createElement("div", { style: s.card },
            react.createElement("table", { className: "sb-table" },
              head("Agent", "条目", "动作", "剩余次数", "到期"),
              react.createElement("tbody", null, caps.map((cap) => react.createElement("tr", { key: cap.agent + cap.name + cap.action },
                cell(cap.agent, "agent"),
                cell(cap.name, "name"),
                cell(cap.action, "action"),
                cell(cap.usesLeft == null ? "不限" : cap.usesLeft + "/" + cap.maxUses, "uses"),
                cell(cap.expiresAt ? new Date(cap.expiresAt).toLocaleString() : "永久", "expires")
              )))
            )
          ));
        }
      }
      return react.createElement("div", { className: "sb-scope sb-view", style: s.wrap }, ...children);
    }

    function startPopup(ctx) {
      // One short label per audit event, so the activity list reads as sentences
      // instead of dotted identifiers.
      const eventLabel = (event) => ({
        'secret.read': '读取', 'secret.read-deny': '拒读', 'secret.write': '写入', 'secret.write-deny': '拒写',
        'grant.share': '授权', 'grant.revoke': '撤销', 'grant.adjust': '改授权', 'grant.delete': '删授权',
        'request.create': '申请', 'request.approve': '批准', 'request.deny': '拒绝',
        'credential.request': '求密钥', 'credential.connect': '已补密钥', 'credential.cancel': '取消求密钥',
        'item.create': '建条目', 'item.update': '改条目', 'item.delete': '删条目',
      })[event] || String(event || '').replace(/^[a-z]+\./, '');
      const dismissed = new Set();
      const drafts = new Map();
      // The add form is rebuilt on every poll, so what the operator typed and
      // the chosen category live outside it, the way `drafts` does.
      const add = { kind: '' };
      // Ids painted last, so closing marks them seen and the next poll does not
      // pop the panel the operator just dismissed straight back open.
      let seenIds = [];
      let overlay = null;
      // The sheet's scroll body and its backdrop live as long as the sheet does.
      let body = null;
      let backdropEl = null;
      let busy = false;
      let queued = false;
      let firstLoad = true;
      let showEmpty = false;
      // Tabs, so the popup is useful when nothing is waiting: the queue is one
      // tab, "recent activity" and "add a key" are the others.
      let tab = 'queue';
      ensureCss();
      // Class names, not style strings: the look lives in SB_CSS tokens only.
      const styleButton = "sb-btn";
      const stylePrimary = "sb-btn sb-btn--primary";
      const styleDanger = "sb-btn sb-btn--danger";
      // The remaining tabs set .style.cssText directly, so this one stays a
      // cssText - but every value in it is a token.
      const styleInput = "width:100%;box-sizing:border-box;min-height:var(--sb-touch);padding:0 var(--sb-sp-3);border:1px solid var(--sb-sep);border-radius:var(--sb-r-small);background:var(--sb-card);color:var(--sb-label);font:inherit;font-size:var(--sb-fs-sub);margin-bottom:var(--sb-sp-2)";
      // A bare class name goes to className; anything with a ; or : stays cssText.
      const mk = (tag, text, style) => { const el = document.createElement(tag); if (text) el.textContent = text; if (style) { if (/[;:]/.test(style)) el.style.cssText = style; else el.className = style } return el; };
      const cls = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el };
      const remove = () => {
        if (backdropEl) { backdropEl.remove(); backdropEl = null }
        if (overlay) { overlay.remove(); overlay = null; body = null }
        // The launcher steps aside while the sheet is up, so two floating
        // surfaces never stack in the same corner.
        const launcher = document.getElementById('secrets-broker-launcher');
        if (launcher) launcher.style.display = '';
      };
      // Closing counts what was on screen as seen, so the 15s poll does not
      // reopen the panel the operator just dismissed.
      const close = () => {
        if (!overlay) return;
        for (const id of seenIds) dismissed.add(id);
        showEmpty = false;
        remove();
        // Everything painted is now dismissed, so the badge goes too instead
        // of waiting up to 15s for the next poll to recount.
        badge(0);
      };
      // The launcher carries a badge so a wait is visible without opening it.
      const ensureLauncher = () => {
        if (document.getElementById('secrets-broker-launcher')) return;
        const launcher = document.createElement('button');
        launcher.id = 'secrets-broker-launcher';
        launcher.type = 'button';
        launcher.title = 'Secrets Broker';
        launcher.className = 'sb-launcher sb-scope';
        // A stroked lock at the sheet's icon weight, instead of an emoji whose
        // shape depends on the platform font.
        if (typeof document.createElementNS === 'function') launcher.appendChild(lockGlyph());
        else launcher.textContent = '🔐';
        launcher.onclick = () => {
          if (overlay) { close(); return }
          // A dismissal only silences the panel; opening it deliberately shows
          // everything again, so an accidental outside click cannot hide a
          // pending approval for the rest of the session.
          dismissed.clear();
          showEmpty = true;
          tab = 'queue';
          // Paint from the last payload at once, then refresh behind it. On the
          // very first open there is nothing cached, so only the refresh runs.
          if (last) load(true);
          load();
        };
        document.body.appendChild(launcher);
      };
      const badge = (count) => {
        const launcher = document.getElementById('secrets-broker-launcher');
        if (!launcher) return;
        const dot = document.getElementById('secrets-broker-badge');
        if (!count) { if (dot) dot.remove(); return }
        // Re-paint through .sb-roll so a changed number rolls in like a meter
        // instead of snapping, the way a counter should settle.
        if (dot) {
          if (dot.textContent === String(count)) return;
          dot.replaceChildren(cls('span', '', String(count)));
          return;
        }
        const pill = cls('span', 'sb-badge', String(count));
        pill.id = 'secrets-broker-badge';
        launcher.appendChild(pill);
      };
      // Last payload, so a tab click paints at once instead of waiting on the
      // network. Every tab used to refetch all five endpoints, ~1.2s per click.
      let last = null;
      const load = async (fromCache) => {
        if (fromCache && !last) return;
        if (!fromCache) {
          // A second click while a load is in flight used to be dropped silently;
          // remember it and run once more, so tabs respond to every click.
          if (busy) { queued = true; return }
          // Never rerender while the user is typing. Buttons also take focus, so
          // testing the tag — not merely "inside the popup" — is what keeps a tab
          // click from being swallowed until the next poll.
          const active = document.activeElement;
          if (overlay && active && overlay.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
          busy = true;
        }
        try {
          let pendingResponse, requestResponse, usageResponse, activityResponse, itemsResponse;
          if (fromCache && last) {
            ({ pendingResponse, requestResponse, usageResponse, activityResponse, itemsResponse } = last);
          } else {
            // A poll that only updates the badge needs the two queue endpoints
            // and nothing else. It used to pull all five every 15s, open or not,
            // and /items decrypts the whole vault: ~3.3s of broker work per tick
            // to keep one number current.
            const badgeOnly = !showEmpty && !overlay;
            [pendingResponse, requestResponse] = await Promise.all([
              fetch('/api/secrets-broker/pending').then((r) => r.json()).catch(() => ({ pending: [] })),
              fetch('/api/secrets-broker/credential-requests').then((r) => r.json()).catch(() => ({ requests: [] })),
            ]);
            if (badgeOnly) {
              ({ usageResponse, activityResponse, itemsResponse } = last ?? { usageResponse: {}, activityResponse: { activity: [] }, itemsResponse: {} });
            } else {
              [usageResponse, activityResponse, itemsResponse] = await Promise.all([
                fetch('/api/secrets-broker/usage?hours=1').then((r) => r.json()).catch(() => ({})),
                fetch('/api/secrets-broker/activity?limit=12').then((r) => r.json()).catch(() => ({ activity: [] })),
                fetch('/api/secrets-broker/items').then((r) => r.json()).catch(() => ({})),
              ]);
            }
            last = { pendingResponse, requestResponse, usageResponse, activityResponse, itemsResponse };
          }
          const pending = (pendingResponse.pending || []).filter((entry) => !dismissed.has(entry.id));
          const requests = (requestResponse.requests || []).filter((entry) => !dismissed.has(entry.id));
          const activity = Array.isArray(activityResponse.activity) ? activityResponse.activity : [];
          seenIds = pending.concat(requests).map((entry) => entry.id);
          badge(pending.length + requests.length);
          const empty = pending.length === 0 && requests.length === 0;
          // A request the operator ignored before a restart must not reopen the
          // panel on every load. First pass only badges; the panel opens when
          // the operator clicks, or when something new arrives later.
          if (firstLoad) { firstLoad = false; if (!showEmpty) return }
          if (empty && !showEmpty) { remove(); return }
          if (!overlay) {
            backdropEl = cls('div', 'sb-backdrop sb-scope');
            backdropEl.id = 'secrets-broker-backdrop';
            backdropEl.onclick = () => close();
            document.body.appendChild(backdropEl);
            overlay = cls('div', 'sb-sheet sb-scope');
            overlay.id = 'secrets-broker-sheet';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-label', 'Secrets Broker');
            document.body.appendChild(overlay);
            const launcherEl = document.getElementById('secrets-broker-launcher');
            if (launcherEl) launcherEl.style.display = 'none';
            const nav = cls('div', 'sb-nav');
            const titles = cls('div', 'sb-row-main');
            titles.appendChild(cls('div', 'sb-nav-title', 'Secrets Broker'));
            titles.appendChild(cls('div', 'sb-nav-sub', '密钥授权'));
            nav.appendChild(titles);
            // This must not be named `close`: a const here shadows the close()
            // function above, so the handler called the button itself, recursively.
            // That recursion is what made the × take seconds to dismiss.
            const closeButton = cls('button', 'sb-icon-btn', '×');
            closeButton.setAttribute('aria-label', '关闭');
            closeButton.onclick = () => close();
            nav.appendChild(closeButton);
            overlay.appendChild(nav);
            const seg = cls('div', 'sb-seg');
            seg.setAttribute('role', 'tablist');
            for (const [id, label] of [['queue', '待办'], ['activity', '动态'], ['add', '添加']]) {
              const chip = cls('button', 'sb-seg-btn', label);
              chip.dataset.tab = id;
              chip.setAttribute('role', 'tab');
              chip.onclick = () => { tab = id; showEmpty = true; load(true) };
              seg.appendChild(chip);
            }
            overlay.appendChild(seg);
            const host = cls('div', 'sb-host');
            body = cls('div', 'sb-body');
            host.appendChild(body);
            overlay.appendChild(host);
          }
          for (const chip of overlay.querySelectorAll('.sb-seg-btn')) chip.setAttribute('aria-selected', chip.dataset.tab === tab ? 'true' : 'false');
          // Collect the nodes, then append them in one pass. No fragment, no
          // repeated reflow, and a minimal DOM stub can drive this too.
          const out = [];

          if (tab === 'queue') {
            const actionLabel = { 'secret.read': '读取明文', 'secret.use': '代持调用', 'secret.fill': '网页填充', 'secret.materialize': '写入本地文件', 'secret.write': '写入密钥' };
            // Detail is a push page, not a dialog: the list stays underneath and
            // the next screen slides in from the right, the way iOS does it.
            const openDetail = (entry) => {
              const host = overlay.querySelector('.sb-host');
              if (!host || overlay.querySelector('.sb-page')) return;
              const page = cls('div', 'sb-page');
              const nav = cls('div', 'sb-nav');
              const back = cls('button', 'sb-icon-btn', '\u2039');
              back.setAttribute('aria-label', '返回');
              back.onclick = () => page.remove();
              nav.appendChild(back);
              const titles = cls('div', 'sb-row-main');
              titles.appendChild(cls('div', 'sb-nav-title', entry.name || '授权详情'));
              titles.appendChild(cls('div', 'sb-nav-sub', entry.agent || 'Agent'));
              nav.appendChild(titles);
              page.appendChild(nav);
              const pageBody = cls('div', 'sb-body');
              const group = cls('div', 'sb-card');
              const kv = (label, value) => {
                const row = cls('dl', 'sb-kv');
                row.appendChild(cls('dt', '', label));
                row.appendChild(cls('dd', '', value));
                group.appendChild(row);
              };
              kv('动作', actionLabel[entry.action] || entry.action || '—');
              if (entry.targetOrigin) kv('目标', entry.targetOrigin);
              kv('请求时间', entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '—');
              if (entry.reason) kv('理由', entry.reason);
              pageBody.appendChild(group);
              page.appendChild(pageBody);
              const foot = cls('div', 'sb-foot');
              const decideOn = (decision) => async (button) => {
                button.disabled = true;
                try {
                  await fetch('/api/secrets-broker/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: entry.id, decision }) });
                  page.remove();
                  load();
                } catch { button.disabled = false }
              };
              // One primary answer, then the two longer durations side by side,
              // so the page does not shout three equally blue buttons.
              const once = cls('button', 'sb-btn sb-btn--primary sb-btn--wide', '本次');
              once.onclick = () => decideOn('once')(once);
              const longer = cls('div', 'sb-actions sb-actions--split');
              longer.style.cssText = 'margin-top:var(--sb-sp-2)';
              for (const [decision, label] of [['24h', '24 小时'], ['always', '永久']]) {
                const button = cls('button', 'sb-btn sb-btn--wide', label);
                button.onclick = () => decideOn(decision)(button);
                longer.appendChild(button);
              }
              const deny = cls('button', 'sb-btn sb-btn--danger sb-btn--wide', '拒绝');
              deny.onclick = () => decideOn('deny')(deny);
              foot.replaceChildren(once, longer, deny);
              page.appendChild(foot);
              // The pushed page covers the sheet's own nav and tabs, the way a
              // navigation push replaces the whole screen on iOS.
              overlay.appendChild(page);
              requestAnimationFrame(() => page.setAttribute('data-in', 'true'));
            };
            if (!pending.length && !requests.length) out.push(cls('div', 'sb-empty', '没有待审批或待补充的请求。'));
            if (pending.length) {
              out.push(cls('div', 'sb-group-head', '待审批 · ' + pending.length));
              const card = cls('div', 'sb-card');
              for (const entry of pending) {
                const row = cls('div', 'sb-row');
                const main = cls('div', 'sb-row-main');
                main.appendChild(cls('div', 'sb-row-title', (entry.agent || 'Agent') + ' → ' + (entry.name || '')));
                const meta = [actionLabel[entry.action] || entry.action, entry.targetOrigin].filter(Boolean).join(' · ');
                main.appendChild(cls('div', 'sb-row-sub', meta || '批准后可读取'));
                row.appendChild(main);
                row.appendChild(cls('span', 'sb-chev', '\u203a'));
                row.onclick = () => openDetail(entry);
                card.appendChild(row);
              }
              out.push(card);
            }
            for (const entry of requests) {
              const draft = drafts.get(entry.id) || {};
              out.push(cls('div', 'sb-group-head', '需要补充 · ' + (entry.name || '')));
              const card = cls('div', 'sb-card');
              const pad = cls('div', '', '');
              pad.style.cssText = 'padding:var(--sb-sp-3) var(--sb-sp-4)';
              if (entry.description) pad.appendChild(cls('div', 'sb-row-sub', entry.description));
              const nameInput = mk('input', '', 'sb-input'); nameInput.value = draft.name ?? entry.name ?? ''; nameInput.placeholder = '名称';
              const userInput = mk('input', '', 'sb-input'); userInput.value = draft.username ?? ''; userInput.placeholder = '用户名（可选）';
              const valueInput = mk('input', '', 'sb-input'); valueInput.value = draft.value ?? ''; valueInput.type = 'password'; valueInput.placeholder = '密钥';
              const updateDraft = () => drafts.set(entry.id, { name: nameInput.value, username: userInput.value, value: valueInput.value });
              nameInput.oninput = updateDraft; userInput.oninput = updateDraft; valueInput.oninput = updateDraft;
              const save = cls('button', 'sb-btn sb-btn--primary sb-btn--wide', '保存并授权');
              save.onclick = async () => {
                if (!valueInput.value) return;
                save.disabled = true;
                try {
                  const response = await fetch('/api/secrets-broker/connect/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: entry.id, name: nameInput.value, username: userInput.value, value: valueInput.value, group: '' }) });
                  const payload = await response.json().catch(() => ({}));
                  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'save failed');
                  drafts.delete(entry.id);
                  load();
                } catch (error) { save.disabled = false; save.textContent = String(error.message || error) }
              };
              // Optional: the operator may not have this key at all. Cancelling
              // removes the request, so the prompt stops coming back.
              const skip = cls('button', 'sb-btn sb-btn--wide', '取消（不填了）');
              skip.style.cssText = 'margin-top:var(--sb-sp-2)';
              skip.onclick = async () => {
                skip.disabled = true;
                try {
                  const response = await fetch('/api/secrets-broker/credential-requests/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: entry.id }) });
                  const payload = await response.json().catch(() => ({}));
                  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'cancel failed');
                  drafts.delete(entry.id);
                  dismissed.add(entry.id);
                  load();
                } catch (error) { skip.disabled = false; skip.textContent = String(error.message || error) }
              };
              pad.append(nameInput, userInput, valueInput, save, skip);
              card.appendChild(pad);
              out.push(card);
            }
            const caps = Array.isArray(usageResponse && usageResponse.capabilities) ? usageResponse.capabilities : [];
            if (caps.length) {
              out.push(cls('div', 'sb-group-head', 'Agent 权限'));
              const card = cls('div', 'sb-card');
              const table = cls('table', 'sb-table');
              const thead = document.createElement('thead');
              const headerRow = document.createElement('tr');
              for (const label of ['条目', '动作', '剩余', '到期']) headerRow.appendChild(cls('th', '', label));
              thead.appendChild(headerRow);
              table.appendChild(thead);
              const tbody = document.createElement('tbody');
              for (const cap of caps) {
                const tr = document.createElement('tr');
                tr.appendChild(cls('td', '', cap.name || ''));
                tr.appendChild(cls('td', '', cap.action || ''));
                tr.appendChild(cls('td', '', cap.usesLeft == null ? '不限' : cap.usesLeft + '/' + cap.maxUses));
                tr.appendChild(cls('td', '', cap.expiresAt ? new Date(cap.expiresAt).toLocaleDateString() : '永久'));
                tbody.appendChild(tr);
              }
              table.appendChild(tbody);
              card.appendChild(table);
              out.push(card);
            }
          }

          if (tab === 'activity') {
            const items = Array.isArray(activityResponse.activity) ? activityResponse.activity : [];
            if (!items.length) out.push(mk('div', '还没有活动记录。', 'font-size:12px;color:#6b7890;padding:6px 0'));
            for (const entry of items) {
              // 12 rows of bare HH:MM:SS read as today even when they are from
              // yesterday, so a row that is not today carries its date.
              const when = entry.time ? new Date(entry.time) : null;
              const at = when ? when.toLocaleTimeString('zh-CN', { hour12: false }) : '';
              const stamp = when && when.toDateString() !== new Date().toDateString()
                ? (when.getMonth() + 1) + '/' + when.getDate() + ' ' + at
                : at;
              const who = entry.agent || '系统';
              const what = entry.name ? '「' + entry.name + '」' : '';
              const row = mk('div', '', 'display:flex;gap:8px;align-items:baseline;padding:5px 0;border-bottom:1px solid #f0f3f8;font-size:12px');
              row.appendChild(mk('span', stamp, 'color:#9aa6b8;font:11px/1.4 ui-monospace,monospace;flex:0 0 auto'));
              row.appendChild(mk('span', eventLabel(entry.event), 'color:' + (entry.ok ? '#0b7d6d' : '#c0392b') + ';flex:0 0 auto'));
              row.appendChild(mk('span', who + ' ' + what, 'color:#6b7890;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
              out.push(row);
            }
          }

          if (tab === 'add') {
            out.push(mk('div', '存一个密钥。名称必填，值只在你和 broker 之间。', 'font-size:11.5px;color:#6b7890;margin-bottom:6px'));
            // The kind decides what an Agent may do with the key, so it sits
            // first. It lives in `add` like `tab` does: every poll rebuilds the
            // form, and a reset chip would silently misclassify the next save.
            const kindRow = mk('div', '', 'display:flex;gap:6px;margin:2px 0 4px');
            for (const [value, label] of [['', '未分类'], ['api', 'API key'], ['web', '网站登录']]) {
              const chip = mk('button', label, 'border:1px solid ' + (add.kind === value ? '#0f9d8a' : '#d8e0ec') + ';background:' + (add.kind === value ? '#e8f7f4' : '#fff') + ';color:' + (add.kind === value ? '#0b7d6d' : '#6b7890') + ';border-radius:999px;padding:3px 9px;font:11.5px system-ui;cursor:pointer');
              chip.onclick = () => { add.kind = value; load(true) };
              kindRow.appendChild(chip);
            }
            out.push(kindRow, mk('div', 'API key 可以授权给 Agent 读取；网站登录只回填到这些站点，永远读不到明文。', 'font-size:11px;color:#9aa6b8;margin-bottom:6px'));
            const originsInput = mk('textarea');
            originsInput.placeholder = 'https://example.com，一行一个站点';
            originsInput.style.cssText = styleInput + ';height:52px;resize:vertical';
            originsInput.value = add.origins || '';
            originsInput.oninput = () => { add.origins = originsInput.value };
            // Only a website login is pinned to origins; an API key is not.
            if (add.kind === 'web') out.push(originsInput);
            const nameInput = mk('input'); nameInput.placeholder = '名称，例如 tavily-api-key'; nameInput.style.cssText = styleInput; nameInput.value = add.name || ''; nameInput.oninput = () => { add.name = nameInput.value };
            const userInput = mk('input'); userInput.placeholder = '用户名（可选）'; userInput.style.cssText = styleInput; userInput.value = add.username || ''; userInput.oninput = () => { add.username = userInput.value };
            const valueInput = mk('input'); valueInput.placeholder = '密钥值'; valueInput.type = 'password'; valueInput.style.cssText = styleInput; valueInput.value = add.value || ''; valueInput.oninput = () => { add.value = valueInput.value };
            const urlInput = mk('input'); urlInput.placeholder = '网址（可选）'; urlInput.style.cssText = styleInput; urlInput.value = add.url || ''; urlInput.oninput = () => { add.url = urlInput.value };
            const noteInput = mk('input'); noteInput.placeholder = '备注（可选）'; noteInput.style.cssText = styleInput; noteInput.value = add.notes || ''; noteInput.oninput = () => { add.notes = noteInput.value };
            const hint = mk('div', '', 'font-size:11px;min-height:16px;margin-top:4px');
            const originsList = () => String(add.origins || '').split('\n').map((line) => line.trim()).filter(Boolean);
            const save = mk('button', '保存到 vault', stylePrimary); save.style.width = '100%'; save.style.marginTop = '6px';
            save.onclick = async () => {
              if (!nameInput.value.trim()) { hint.textContent = '名称必填'; hint.style.color = '#c0392b'; return }
              if (!valueInput.value) { hint.textContent = '密钥值必填'; hint.style.color = '#c0392b'; return }
              if (add.kind === 'web' && !originsList().length) { hint.textContent = '网站登录至少填一个站点'; hint.style.color = '#c0392b'; return }
              save.disabled = true;
              hint.textContent = '保存中…'; hint.style.color = '#6b7890';
              try {
                const body = { name: nameInput.value.trim(), username: userInput.value, value: valueInput.value, url: urlInput.value.trim(), notes: noteInput.value, kind: add.kind };
                if (add.kind === 'web') body.origins = originsList();
                const response = await fetch('/api/secrets-broker/items/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || payload.ok === false) throw new Error(payload.error || 'save failed');
                // Clear the whole form, not just the value: a stale name next
                // to an empty value saves the wrong key on the next click.
                for (const input of [nameInput, userInput, valueInput, urlInput, noteInput, originsInput]) input.value = '';
                for (const key of ['name', 'username', 'value', 'url', 'notes', 'origins']) add[key] = '';
                hint.textContent = payload.updated ? '已更新 ' + payload.name : '已保存 ' + payload.name;
                hint.style.color = '#0b7d6d';
                save.disabled = false;
              } catch (error) {
                hint.textContent = String(error.message || error);
                hint.style.color = '#c0392b';
                save.disabled = false;
              }
            };
            out.push(nameInput, userInput, valueInput, urlInput, noteInput, save, hint);
            // A key stored by mistake is removed by clicking it, not by typing its
            // name back in — the operator may not remember the spelling.
            const stored = Array.isArray(itemsResponse && itemsResponse.items) ? itemsResponse.items : [];
            const list = mk('div', '', 'max-height:170px;overflow:auto;margin-top:10px;border-top:1px solid #eef1f6;padding-top:6px');
            list.appendChild(mk('div', '已存 ' + stored.length + ' 个，点名称右边的 × 删除', 'font-size:11px;color:#9aa6b8;margin-bottom:4px'));
            for (const item of stored) {
              const row = mk('div', '', 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px');
              const label = mk('span', (item.name || '') + (item.group ? ' · ' + item.group : ''), 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
              // Clicking the name fills the form, so an update needs no retyping.
              label.style.cursor = 'pointer';
              label.onclick = () => { nameInput.value = item.name || ''; urlInput.value = item.url || ''; nameInput.focus() };
              const kill = mk('button', '×', styleDanger);
              kill.title = '从 vault 删除 ' + (item.name || '');
              kill.onclick = async () => {
                if (!confirm('从 vault 删除「' + (item.name || '') + '」？')) return;
                kill.disabled = true;
                try {
                  const response = await fetch('/api/secrets-broker/items/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: item.name }) });
                  const payload = await response.json().catch(() => ({}));
                  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'delete failed');
                  row.remove();
                  hint.textContent = '已删除 ' + (item.name || '');
                  hint.style.color = '#0b7d6d';
                } catch (error) { kill.disabled = false; hint.textContent = String(error.message || error); hint.style.color = '#c0392b' }
              };
              row.append(label, kill);
              list.appendChild(row);
            }
            out.push(list);
          }

          // Replace the body in one pass: the sheet's nav and segmented control
          // stay put, so a poll repaint never re-animates the whole panel.
          if (body) body.replaceChildren(...out);
        } finally {
          // A cache paint must not clear a real load's in-flight flag.
          if (!fromCache) {
            busy = false;
            // A click that landed mid-load runs now instead of being lost.
            if (queued) { queued = false; load() }
          }
        }
      };
      const timer = setInterval(load, 15000);
      // Clicking the tab's own outside area — or pressing Escape — should close
      // the panel, which used to need the × or the launcher. One listener for
      // the popup's whole life: it no-ops when nothing is open, and cleanup
      // removes it so a plugin reload cannot stack duplicates.
      const onOutside = (event) => {
        if (!overlay) return;
        const target = event.target;
        if (overlay.contains(target)) return;
        const launcher = document.getElementById('secrets-broker-launcher');
        if (launcher && launcher.contains(target)) return;
        close();
      };
      const onKey = (event) => { if (event.key === 'Escape' && overlay) close() };
      // Capture phase, so the check runs before a button inside the panel
      // repaints it: afterwards the clicked node is detached and would look
      // like a click outside.
      document.addEventListener('click', onOutside, true);
      document.addEventListener('keydown', onKey, true);
      ensureLauncher();
      load();
      return () => {
        document.removeEventListener('click', onOutside, true);
        document.removeEventListener('keydown', onKey, true);
        clearInterval(timer);
        remove();
        const launcher = document.getElementById('secrets-broker-launcher');
        if (launcher) launcher.remove();
      };
    }


    const NS = "secretsBroker";
    const inject = ["slots", "locale"];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-secrets-broker: dictionaries");
      ctx.effect(() => startPopup(ctx), "ui-secrets-broker: popup");
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "secrets-broker",
        order: 13,
        label: () => t("nav"),
        locale: NS,
        inject: () => ({})
      }, (props) => react.createElement(View, Object.assign({}, props, { t })))), "ui-secrets-broker: section");
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
