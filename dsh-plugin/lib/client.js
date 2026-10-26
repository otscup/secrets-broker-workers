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
  --sb-h-body: 470px;
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
/* The three tabs share one height, so switching never resizes the sheet. */
.sb-host > .sb-body { flex: 0 0 auto; height: var(--sb-h-body); }
.sb-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: var(--sb-sp-2); }
.sb-kpi { background: var(--sb-card); border-radius: var(--sb-r-card); padding: var(--sb-sp-3); box-shadow: var(--sb-shadow-card); display: flex; flex-direction: column; gap: 2px; }
.sb-kpi-label { display: flex; align-items: center; gap: 6px; font-size: var(--sb-fs-mini); color: var(--sb-label-2); }
.sb-kpi-dot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 auto; }
.sb-kpi-value { font-size: 22px; line-height: 26px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.sb-kpi-sub { font-size: var(--sb-fs-mini); color: var(--sb-label-3); }
.sb-chart { width: 100%; display: block; overflow: visible; }
.sb-chart-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sb-sp-2); }
.sb-heat { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; }
.sb-heat-cell { aspect-ratio: 1; border-radius: 3px; background: var(--sb-blue); }
.sb-heat-cell[data-level="0"] { background: var(--sb-fill); }
.sb-heat-cell[data-level="1"] { opacity: .28; }
.sb-heat-cell[data-level="2"] { opacity: .5; }
.sb-heat-cell[data-level="3"] { opacity: .72; }
.sb-heat-cell[data-level="4"] { opacity: .92; }
.sb-heat-axis { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; margin-top: 4px; font-size: 9px; color: var(--sb-label-3); }
.sb-heat-axis > span:not(:nth-child(4n+1)) { visibility: hidden; }
.sb-bars { display: flex; flex-direction: column; gap: 6px; }
.sb-bar-row { display: grid; grid-template-columns: 1fr 40px; gap: var(--sb-sp-2); align-items: center; font-size: var(--sb-fs-mini); }
.sb-bar-track { height: 8px; border-radius: 4px; background: var(--sb-fill); overflow: hidden; }
.sb-bar-fill { height: 100%; border-radius: 4px; background: var(--sb-blue); }
.sb-bar-name { color: var(--sb-label-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 3px; }
.sb-bar-count { text-align: right; color: var(--sb-label-2); font-variant-numeric: tabular-nums; }
.sb-legend { display: flex; flex-wrap: wrap; gap: var(--sb-sp-3); font-size: var(--sb-fs-mini); color: var(--sb-label-2); }
.sb-legend-item { display: inline-flex; align-items: center; gap: 6px; }
.sb-field { display: flex; flex-direction: column; gap: 4px; }
.sb-field > label { font-size: var(--sb-fs-mini); color: var(--sb-label-2); }
.sb-inline { display: flex; gap: var(--sb-sp-2); align-items: center; flex-wrap: wrap; }
.sb-note { margin: 0; font-size: var(--sb-fs-mini); color: var(--sb-label-3); }
.sb-section-title { margin: var(--sb-sp-1) 0 0; font-size: var(--sb-fs-cap); font-weight: 600; color: var(--sb-label-2); }
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

    // ---- charts --------------------------------------------------------
    // Plain SVG built from tokens: no library, no literal colour. Units are the
    // viewBox's, so the same markup scales to the panel or the settings page.
    const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    const PALETTE = ["var(--sb-blue)", "var(--sb-green)", "var(--sb-orange)", "var(--sb-red)"];
    const seriesOf = (usage) => (Array.isArray(usage && usage.series) ? usage.series : []);

    // r = 15.9155 makes the circumference 100, so a slice length is a percent.
    function donutMarkup(parts, caption) {
      const total = parts.reduce((sum, part) => sum + part.value, 0);
      let acc = 0;
      const arcs = [];
      for (const part of parts) {
        const len = total ? (part.value / total) * 100 : 0;
        if (len <= 0) continue;
        // A one-pixel gap between slices, halved on each side of the seam.
        const cut = Math.min(0.5, len / 4);
        arcs.push({ len: len - cut * 2, offset: 100 - acc + 25 - cut, color: part.color });
        acc += len;
      }
      const ring = arcs.length
        ? arcs.map((arc) => `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="${arc.color}" stroke-width="4" stroke-dasharray="${arc.len.toFixed(2)} ${(100 - arc.len).toFixed(2)}" stroke-dashoffset="${arc.offset.toFixed(2)}"/>`).join("")
        : `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--sb-fill)" stroke-width="4"/>`;
      return `<svg viewBox="0 0 42 42" width="92" height="92" aria-hidden="true">${ring}` +
        `<text x="21" y="20.6" text-anchor="middle" font-size="7" font-weight="600" fill="var(--sb-label)">${esc(total)}</text>` +
        `<text x="21" y="26.4" text-anchor="middle" font-size="3.2" fill="var(--sb-label-2)">${esc(caption)}</text></svg>`;
    }

    // Hourly reads (blue) stacked under denials (red).
    function trendMarkup(series, slots) {
      const data = series.slice(-slots);
      if (!data.length) return `<svg class="sb-chart" viewBox="0 0 1 100" height="72" aria-hidden="true"></svg>`;
      const max = Math.max(1, ...data.map((bucket) => (bucket.reads || 0) + (bucket.denied || 0)));
      const width = data.length;
      const bars = data.map((bucket, index) => {
        const reads = ((bucket.reads || 0) / max) * 96;
        const denied = ((bucket.denied || 0) / max) * 96;
        const x = index + 0.15;
        return `<rect x="${x.toFixed(2)}" y="${(100 - reads - denied).toFixed(2)}" width="0.7" height="${reads.toFixed(2)}" fill="var(--sb-blue)"/>` +
          (denied > 0 ? `<rect x="${x.toFixed(2)}" y="${(100 - denied).toFixed(2)}" width="0.7" height="${denied.toFixed(2)}" fill="var(--sb-red)"/>` : "");
      }).join("");
      return `<svg class="sb-chart" viewBox="0 0 ${width} 100" height="72" preserveAspectRatio="none" aria-hidden="true">` +
        `<line x1="0" y1="99.6" x2="${width}" y2="99.6" stroke="var(--sb-sep)" stroke-width="1" vector-effect="non-scaling-stroke"/>${bars}</svg>`;
    }

    // Seven rows of weekdays by twenty-four hours. Four steps, the way a calendar
    // heatmap does it: the ramp is by quartile of the busiest cell.
    function heatCells(series) {
      const cells = new Array(7 * 24).fill(0);
      for (const bucket of series) {
        const at = new Date(Number(bucket.t));
        if (Number.isNaN(at.getTime())) continue;
        cells[at.getDay() * 24 + at.getHours()] += (bucket.reads || 0) + (bucket.denied || 0);
      }
      const max = Math.max(1, ...cells);
      return cells.map((value) => (value === 0 ? 0 : value <= max * 0.25 ? 1 : value <= max * 0.5 ? 2 : value <= max * 0.75 ? 3 : 4));
    }

    function heatMarkup(series) {
      const cells = heatCells(series);
      const grid = cells.map((level) => `<span class="sb-heat-cell" data-level="${level}"></span>`).join("");
      const axis = Array.from({ length: 24 }, (_, hour) => `<span>${hour}</span>`).join("");
      return `<div class="sb-heat">${grid}</div><div class="sb-heat-axis">${axis}</div>`;
    }

    function barMarkup(rows) {
      const max = Math.max(1, ...rows.map((row) => row.value));
      return `<div class="sb-bars">` + rows.map((row) =>
        `<div class="sb-bar-row"><div><div class="sb-bar-name">${esc(row.name)}</div>` +
        `<div class="sb-bar-track"><div class="sb-bar-fill" style="width:${((row.value / max) * 100).toFixed(1)}%"></div></div></div>` +
        `<div class="sb-bar-count">${row.value}</div></div>`).join("") + `</div>`;
    }

    function View({ t }) {
      const [state, setState] = react.useState({ status: "loading", pending: [], requests: [], items: [], usage: null, config: null });
      const [form, setForm] = react.useState({ url: "", token: "" });
      const [note, setNote] = react.useState(null);
      const [busy, setBusy] = react.useState("");
      const load = () => {
        Promise.allSettled([
          fetch("/api/secrets-broker/pending").then((response) => response.json()),
          fetch("/api/secrets-broker/credential-requests").then((response) => response.json()),
          fetch("/api/secrets-broker/usage?hours=168").then((response) => response.json()),
          fetch("/api/secrets-broker/items").then((response) => response.json()),
          fetch("/api/secrets-broker/config").then((response) => response.json())
        ]).then(([pendingResult, requestResult, usageResult, itemResult, configResult]) => {
          const value = (result) => (result.status === "fulfilled" && result.value && result.value.ok !== false ? result.value : null);
          const pending = value(pendingResult);
          if (!pending) throw new Error((pendingResult.status === "fulfilled" && pendingResult.value && pendingResult.value.error) || "broker error");
          const config = value(configResult);
          setState({
            status: "ready",
            pending: Array.isArray(pending.pending) ? pending.pending : [],
            requests: Array.isArray(value(requestResult)?.requests) ? value(requestResult).requests : [],
            usage: value(usageResult),
            items: Array.isArray(value(itemResult)?.items) ? value(itemResult).items : [],
            config
          });
          if (config) setForm((current) => ({ ...current, url: current.url || config.url || "" }));
        }).catch((error) => setState({ status: "error", error: String(error.message || error), pending: [], requests: [], items: [] }));
      };
      react.useEffect(() => {
        ensureCss();
        load();
        const timer = setInterval(load, 15000);
        return () => clearInterval(timer);
      }, []);
      const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.json());
      const decide = (id, decision) => {
        post("/api/secrets-broker/decide", { id, decision }).then((payload) => {
          if (!payload || payload.ok === false) throw new Error((payload && payload.error) || "failed");
          setState((current) => ({ ...current, pending: current.pending.filter((entry) => entry.id !== id) }));
        }).catch((error) => setNote({ ok: false, text: String(error.message || error) }));
      };
      const run = (key, action) => {
        setBusy(key);
        setNote(null);
        action().catch((error) => setNote({ ok: false, text: String(error.message || error) })).finally(() => setBusy(""));
      };
      const testBroker = () => run("test", () => post("/api/secrets-broker/config/test", { url: form.url, token: form.token }).then((payload) => {
        if (!payload.ok) setNote({ ok: false, text: payload.error || "连接失败" });
        else setNote({ ok: true, text: "已连接 · " + payload.latencyMs + " ms · 待审批 " + (payload.pending ?? 0) + " 条" });
      }));
      const saveBroker = () => run("save", () => post("/api/secrets-broker/config/save", { url: form.url, token: form.token }).then((payload) => {
        if (!payload.ok) setNote({ ok: false, text: payload.error || "保存失败" });
        else { setNote({ ok: true, text: "已保存 · " + payload.url + " · " + payload.latencyMs + " ms" }); setForm((current) => ({ ...current, token: "" })); load(); }
      }));
      const removeItem = (name) => run("delete:" + name, () => post("/api/secrets-broker/items/delete", { name }).then((payload) => {
        if (payload.ok === false) setNote({ ok: false, text: payload.error || "删除失败" });
        else load();
      }));
      const usage = state.usage;
      const agents = Array.isArray(usage?.agents) ? usage.agents : [];
      const caps = Array.isArray(usage?.capabilities) ? usage.capabilities : [];
      const topItems = Array.isArray(usage?.items) ? usage.items.slice(0, 6) : [];
      const series = seriesOf(usage);
      const cell = (value, key) => react.createElement("td", { key }, value);
      const head = (...labels) => react.createElement("thead", null, react.createElement("tr", null, labels.map((label) => react.createElement("th", { key: label }, label))));
      const card = (key, className, ...kids) => react.createElement("div", { key, className: className || "sb-card" }, ...kids);
      const html = (key, className, markup) => react.createElement("div", { key, className, dangerouslySetInnerHTML: { __html: markup } });

      const children = [react.createElement("p", { style: s.intro, key: "intro" }, t("intro"))];

      // ---- connection: which broker this panel talks to ----------------
      const config = state.config;
      children.push(card("connect",
        react.createElement("div", { className: "sb-inline" },
          react.createElement("span", { className: "sb-section-title" }, "连接"),
          react.createElement("span", { className: "sb-chip" + (config?.tokenSet ? " sb-chip--green" : " sb-chip--red") }, config?.tokenSet ? "token 已配置 " + (config.tokenHint || "") : "未配置 token")
        ),
        react.createElement("div", { className: "sb-inline" },
          (config?.presets || []).map((preset) => react.createElement("button", {
            key: preset.id, type: "button", className: "sb-chip", style: { cursor: "pointer", border: 0 },
            onClick: () => setForm((current) => ({ ...current, url: preset.url }))
          }, preset.label))
        ),
        react.createElement("div", { className: "sb-field" },
          react.createElement("label", null, "Broker 地址"),
          react.createElement("input", { className: "sb-input", style: { marginBottom: 0 }, value: form.url, placeholder: "https://sb.otscup.com", onChange: (event) => setForm((current) => ({ ...current, url: event.target.value })) })
        ),
        react.createElement("div", { className: "sb-field" },
          react.createElement("label", null, "插件 token（留空则沿用已保存的）"),
          react.createElement("input", { className: "sb-input", style: { marginBottom: 0 }, type: "password", value: form.token, placeholder: config?.tokenHint || "x-broker-plugin-token", onChange: (event) => setForm((current) => ({ ...current, token: event.target.value })) })
        ),
        react.createElement("div", { className: "sb-inline" },
          react.createElement("button", { type: "button", className: "sb-btn", disabled: busy === "test", onClick: testBroker }, busy === "test" ? "测试中…" : "测试连接"),
          react.createElement("button", { type: "button", className: "sb-btn sb-btn--primary", disabled: busy === "save", onClick: saveBroker }, busy === "save" ? "保存中…" : "保存"),
          react.createElement("a", { className: "sb-btn", href: form.url || config?.url || "#", target: "_blank", rel: "noreferrer" }, "打开后台")
        ),
        note ? react.createElement("p", { className: "sb-note", style: note.ok ? { color: "var(--sb-green)" } : { color: "var(--sb-red)" } }, note.text) : null,
        react.createElement("p", { className: "sb-note" }, "换后端只改这里；Agent 用的 MCP 地址在各自的客户端配置里，不随这个改动。")
      ));

      // ---- KPI + charts -------------------------------------------------
      if (usage) {
        const kpi = (key, dot, label, value, sub) => react.createElement("div", { className: "sb-kpi", key },
          react.createElement("div", { className: "sb-kpi-label" }, react.createElement("span", { className: "sb-kpi-dot", style: { background: dot } }), label),
          react.createElement("div", { className: "sb-kpi-value" }, value),
          sub ? react.createElement("div", { className: "sb-kpi-sub" }, sub) : null
        );
        children.push(react.createElement("div", { className: "sb-kpis", key: "kpis" },
          kpi("reads", "var(--sb-blue)", "读取", String(usage.reads ?? 0), "最近 " + (usage.windowHours || 24) + " 小时"),
          kpi("denied", "var(--sb-red)", "被拒", String(usage.denied ?? 0), "同一窗口"),
          kpi("agents", "var(--sb-green)", "活跃 Agent", String(agents.length), "有读取记录"),
          kpi("items", "var(--sb-orange)", "条目", String(state.items.length), "vault 内")
        ));
        children.push(card("charts", "sb-card",
          react.createElement("div", { className: "sb-chart-head" },
            react.createElement("span", { className: "sb-section-title" }, "读取趋势（24 小时）"),
            react.createElement("span", { className: "sb-note" }, "蓝 读取 / 红 被拒")
          ),
          html("trend", "", trendMarkup(series, 24)),
          react.createElement("span", { className: "sb-section-title" }, "活跃热力（7 天 × 24 小时）"),
          html("heat", "", heatMarkup(series)),
          react.createElement("p", { className: "sb-note" }, "格子越亮读得越多；本地时间。")
        ));
        const donutParts = agents.slice(0, 4).map((agent, index) => ({ name: agent.agent, value: agent.reads || 0, color: PALETTE[index % PALETTE.length] }));
        if (donutParts.length) children.push(card("split", "sb-card",
          react.createElement("div", { className: "sb-inline", style: { alignItems: "flex-start", gap: "var(--sb-sp-4)" } },
            html("donut", "", donutMarkup(donutParts, "次读取")),
            react.createElement("div", { style: { flex: "1 1 160px", minWidth: 0 } },
              react.createElement("div", { className: "sb-legend" }, donutParts.map((part) => react.createElement("span", { key: part.name, className: "sb-legend-item" },
                react.createElement("span", { className: "sb-kpi-dot", style: { background: part.color } }), part.name + " · " + part.value))),
              topItems.length ? html("top", "", barMarkup(topItems.map((item) => ({ name: item.name, value: item.reads })))) : null
            )
          )
        ));
      }

      // ---- items: the management half that moved out of the popup ------
      children.push(card("items",
        react.createElement("div", { className: "sb-chart-head" },
          react.createElement("span", { className: "sb-section-title" }, "条目（" + state.items.length + "）"),
          react.createElement("span", { className: "sb-note" }, "删除会同时撤销相关授权")
        ),
        state.items.length
          ? react.createElement("table", { className: "sb-table" },
            head("名称", "分组", "网址", ""),
            react.createElement("tbody", null, state.items.slice(0, 40).map((item) => react.createElement("tr", { key: item.name },
              cell(item.name, "name"),
              cell(item.group || "—", "group"),
              cell(item.url || "—", "url"),
              react.createElement("td", { key: "del" }, react.createElement("button", {
                type: "button", className: "sb-btn sb-btn--danger", disabled: busy === "delete:" + item.name,
                onClick: () => removeItem(item.name)
              }, "删除"))
            ))))
          : react.createElement("p", { className: "sb-note" }, "vault 里还没有条目。")
      ));

      // ---- approvals ----------------------------------------------------
      if (state.status === "error") children.push(react.createElement("p", { style: s.intro, key: "err" }, t("error") + " " + (state.error || "")));
      children.push(card("pending",
        react.createElement("div", { className: "sb-chart-head" },
          react.createElement("span", { className: "sb-section-title" }, "待审批（" + state.pending.length + "）"),
          react.createElement("button", { type: "button", className: "sb-btn", onClick: load }, t("retry"))
        ),
        state.pending.length === 0 ? react.createElement("p", { className: "sb-note" }, t("empty")) : null,
        ...state.pending.map((entry) => {
          const actionLabel = { "secret.read": "读取明文", "secret.use": "代持调用", "secret.fill": "网页填充", "secret.materialize": "写入本地文件" }[entry.action] || entry.action || "";
          const targetLine = [actionLabel, entry.targetOrigin].filter(Boolean).join(" · ");
          return react.createElement("div", { key: entry.id, className: "sb-row", style: { flexDirection: "column", alignItems: "stretch", gap: "var(--sb-sp-1)", cursor: "default" } },
            react.createElement("div", { className: "sb-row-title" }, (entry.agent || "Agent") + " → " + (entry.name || "")),
            react.createElement("div", { className: "sb-row-sub" }, targetLine + (entry.createdAt ? " · " + new Date(entry.createdAt).toLocaleString() : "")),
            react.createElement("div", { className: "sb-actions", style: { marginTop: "var(--sb-sp-1)" } },
              react.createElement("button", { type: "button", className: "sb-btn sb-btn--primary", onClick: () => decide(entry.id, "once") }, t("approveOnce")),
              react.createElement("button", { type: "button", className: "sb-btn", onClick: () => decide(entry.id, "24h") }, t("approve24")),
              react.createElement("button", { type: "button", className: "sb-btn", onClick: () => decide(entry.id, "always") }, t("approveAlways")),
              react.createElement("button", { type: "button", className: "sb-btn sb-btn--danger", onClick: () => decide(entry.id, "deny") }, t("deny"))
            )
          );
        })
      ));

      if (state.requests.length) {
        children.push(card("requests",
          react.createElement("span", { className: "sb-section-title" }, "需要补充密钥"),
          ...state.requests.map((entry) => react.createElement("div", { key: entry.id, className: "sb-row", style: { cursor: "default" } },
            react.createElement("div", { className: "sb-row-main" },
              react.createElement("div", { className: "sb-row-title" }, entry.name || ""),
              react.createElement("div", { className: "sb-row-sub" }, (entry.agent || "Agent") + (entry.description ? " · " + entry.description : ""))
            ),
            react.createElement("a", { className: "sb-btn sb-btn--primary", href: (config?.url || "https://sb.otscup.com") + "/connect?id=" + encodeURIComponent(entry.id), target: "_blank", rel: "noreferrer" }, "填写")
          ))
        ));
      }

      // ---- who is using what -------------------------------------------
      if (usage) {
        children.push(card("agents",
          react.createElement("span", { className: "sb-section-title" }, "谁在用我的密钥（最近 " + (usage.windowHours || 24) + " 小时）"),
          usage.requireClassification === true ? react.createElement("p", { className: "sb-note" }, "未分类的凭据已禁止 Agent 读取明文。") : null,
          agents.length
            ? react.createElement("table", { className: "sb-table" },
              head("Agent", "读取", "被拒", "读过的条目", "最近"),
              react.createElement("tbody", null, agents.map((agent) => react.createElement("tr", { key: agent.agent },
                cell(agent.agent, "agent"),
                cell(String(agent.reads ?? 0), "reads"),
                cell(String(agent.denied ?? 0), "denied"),
                cell(Object.entries(agent.items || {}).map(([name, count]) => name + " ×" + count).join("，") || "—", "items"),
                cell(agent.lastAt ? new Date(agent.lastAt).toLocaleString() : "—", "last")
              ))))
            : react.createElement("p", { className: "sb-note" }, "这段时间没有读取记录。")
        ));
        if (caps.length) {
          children.push(card("caps",
            react.createElement("span", { className: "sb-section-title" }, "当前有效授权"),
            react.createElement("table", { className: "sb-table" },
              head("Agent", "条目", "动作", "剩余次数", "到期"),
              react.createElement("tbody", null, caps.map((cap) => react.createElement("tr", { key: cap.agent + cap.name + cap.action },
                cell(cap.agent, "agent"),
                cell(cap.name, "name"),
                cell(cap.action, "action"),
                cell(cap.usesLeft == null ? "不限" : cap.usesLeft + "/" + cap.maxUses, "uses"),
                cell(cap.expiresAt ? new Date(cap.expiresAt).toLocaleString() : "永久", "expires")
              ))))
          ));
        }
      }
      return react.createElement("div", { className: "sb-scope sb-view", key: "view" }, ...children);
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
          let pendingResponse, requestResponse, usageResponse, activityResponse;
          if (fromCache && last) {
            ({ pendingResponse, requestResponse, usageResponse, activityResponse } = last);
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
              ({ usageResponse, activityResponse } = last ?? { usageResponse: {}, activityResponse: { activity: [] } });
            } else {
              [usageResponse, activityResponse] = await Promise.all([
                fetch('/api/secrets-broker/usage?hours=1').then((r) => r.json()).catch(() => ({})),
                fetch('/api/secrets-broker/activity?limit=12').then((r) => r.json()).catch(() => ({ activity: [] })),
              ]);
            }
            last = { pendingResponse, requestResponse, usageResponse, activityResponse };
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
            // Agent permissions moved to the settings page: the popup answers
            // "what needs me now", it is not a management screen.
          }

          if (tab === 'activity') {
            const items = Array.isArray(activityResponse.activity) ? activityResponse.activity : [];
            if (!items.length) out.push(mk('div', '还没有活动记录。', 'font-size:var(--sb-fs-cap);color:var(--sb-label-2);padding:6px 0'));
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
              const row = mk('div', '', 'display:flex;gap:8px;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--sb-sep);font-size:var(--sb-fs-cap)');
              row.appendChild(mk('span', stamp, 'color:var(--sb-label-3);font:11px/1.4 ui-monospace,monospace;flex:0 0 auto'));
              row.appendChild(mk('span', eventLabel(entry.event), 'color:' + (entry.ok ? 'var(--sb-green)' : 'var(--sb-red)') + ';flex:0 0 auto'));
              row.appendChild(mk('span', who + ' ' + what, 'color:var(--sb-label-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
              out.push(row);
            }
          }

          if (tab === 'add') {
            out.push(mk('div', '存一个密钥。名称必填，值只在你和 broker 之间。', 'font-size:var(--sb-fs-cap);color:var(--sb-label-2);margin-bottom:6px'));
            // The kind decides what an Agent may do with the key, so it sits
            // first. It lives in `add` like `tab` does: every poll rebuilds the
            // form, and a reset chip would silently misclassify the next save.
            const kindRow = mk('div', '', 'display:flex;gap:6px;margin:2px 0 4px');
            for (const [value, label] of [['', '未分类'], ['api', 'API key'], ['web', '网站登录']]) {
              const chip = mk('button', label, 'border:1px solid ' + (add.kind === value ? 'var(--sb-blue)' : 'var(--sb-sep)') + ';background:' + (add.kind === value ? 'var(--sb-blue)' : 'var(--sb-card)') + ';color:' + (add.kind === value ? 'var(--sb-on-accent)' : 'var(--sb-label-2)') + ';border-radius:var(--sb-r-pill);padding:4px 10px;font:var(--sb-fs-cap) var(--sb-font);cursor:pointer');
              chip.onclick = () => { add.kind = value; load(true) };
              kindRow.appendChild(chip);
            }
            out.push(kindRow, mk('div', 'API key 可以授权给 Agent 读取；网站登录只回填到这些站点，永远读不到明文。', 'font-size:var(--sb-fs-mini);color:var(--sb-label-3);margin-bottom:6px'));
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
            const hint = mk('div', '', 'font-size:var(--sb-fs-mini);min-height:16px;margin-top:4px');
            const originsList = () => String(add.origins || '').split('\n').map((line) => line.trim()).filter(Boolean);
            const save = mk('button', '保存到 vault', stylePrimary); save.style.width = '100%'; save.style.marginTop = '6px';
            save.onclick = async () => {
              if (!nameInput.value.trim()) { hint.textContent = '名称必填'; hint.style.color = 'var(--sb-red)'; return }
              if (!valueInput.value) { hint.textContent = '密钥值必填'; hint.style.color = 'var(--sb-red)'; return }
              if (add.kind === 'web' && !originsList().length) { hint.textContent = '网站登录至少填一个站点'; hint.style.color = 'var(--sb-red)'; return }
              save.disabled = true;
              hint.textContent = '保存中…'; hint.style.color = 'var(--sb-label-2)';
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
                hint.style.color = 'var(--sb-green)';
                save.disabled = false;
              } catch (error) {
                hint.textContent = String(error.message || error);
                hint.style.color = 'var(--sb-red)';
                save.disabled = false;
              }
            };
            out.push(nameInput, userInput, valueInput, urlInput, noteInput, save, hint);
            // Deleting lives on the settings page, where the whole list is visible
            // with its group and URL. The popup only adds.
            out.push(mk('div', '条目在「设置 → 密钥授权」里管理，包括删除。', 'font-size:var(--sb-fs-mini);color:var(--sb-label-3);margin-top:8px'));
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
