export const uiHtml = String.raw`<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/x-icon" href="/favicon.ico?v=2">
<link rel="icon" type="image/png" sizes="192x192" href="/logo.png?v=2">
<link rel="apple-touch-icon" href="/logo.png?v=2">
<title>Secrets Broker · Cloudflare Workers</title>
<style>
:root{--bg:#f3f6fb;--card:#fff;--line:#e3e9f2;--text:#152033;--muted:#6b7890;--ok:#0f9d8a;--warn:#f2994a;--danger:#c0392b;--btn:#eef1f6;--ios-radius:20px;--ios-shadow:0 1px 2px rgba(20,40,80,.04),0 8px 24px rgba(20,40,80,.04)}
.card,.kpi{border-radius:var(--ios-radius);box-shadow:var(--ios-shadow)}
button{border-radius:10px}
input,select,textarea{border-radius:12px;background:#f8f9fc}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:22px 24px 40px}
header{display:flex;align-items:center;gap:14px;margin-bottom:18px;flex-wrap:wrap}
h1{font-size:20px;margin:0;letter-spacing:-.2px}
.badge{background:#e8f7f4;color:#0b7d6d;border-radius:999px;padding:2px 9px;font-size:11px}
nav{display:flex;gap:2px;margin-left:12px;flex-wrap:wrap}
nav button{border:0;background:transparent;color:var(--muted);border-radius:9px;padding:7px 13px;font:inherit;font-size:13px;cursor:pointer}
nav button.active{background:#fff;color:var(--text);box-shadow:0 2px 8px rgba(20,40,80,.07)}
.user{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}
.user-wrap{position:relative;margin-left:auto}
.avatar{width:30px;height:30px;border-radius:50%;background:var(--card);color:var(--text);display:grid;place-items:center;font-size:11px;font-weight:600;border:1px solid var(--line);padding:0;line-height:1;cursor:pointer;overflow:hidden;flex:0 0 auto}
.avatar img{display:block;width:100%;height:100%;object-fit:cover;border-radius:50%}
.theme-cycle{border:0;background:transparent;font-size:16px;line-height:1;padding:4px 6px;border-radius:8px;cursor:pointer;flex:0 0 auto;opacity:.7}
.theme-cycle:hover{background:var(--btn);opacity:1}
nav .icon-btn{width:30px;height:30px;margin-left:4px}
.user .email{display:none}
.user .who-name{display:inline;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.icon-btn{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;color:var(--muted);border:0;background:transparent;text-decoration:none}
.icon-btn:hover{color:var(--text);background:transparent}
.account-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:60;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px;min-width:160px;max-width:min(220px,calc(100vw - 24px));box-shadow:0 12px 30px rgba(15,23,42,.16)}
.account-menu button{display:block;width:100%;text-align:left;background:transparent;border-radius:8px;padding:8px 10px;font-size:13px}
.account-menu button:hover{background:var(--btn)}
html[data-theme="dark"]{--bg:#0b1220;--card:#111a2b;--line:#24324a;--text:#e6edf7;--muted:#8fa1bd;--btn:#1b2940;--ok:#20b8a6}
html[data-theme="dark"] .modal{background:rgba(0,0,0,.6)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin-bottom:14px;box-shadow:0 8px 24px rgba(20,40,80,.04)}
h2{font-size:14px;margin:0 0 5px}.hint{color:var(--muted);font-size:12px}
label.field{display:block;font-size:12px;color:var(--muted);margin:9px 0 4px}
input,select,textarea{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:#fff;font:inherit;outline:none;color:inherit}
input[type=checkbox]{width:auto;min-width:0;height:auto;flex:0 0 auto;padding:0;accent-color:var(--ok)}
.chk{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--text);min-width:0;margin:8px 0}
.row .chk{flex:0 0 auto;min-width:auto}
input:focus,select:focus,textarea:focus{border-color:var(--ok)}
button{border:0;border-radius:10px;padding:9px 13px;font:inherit;cursor:pointer;background:var(--btn);color:var(--text)}
button.primary{background:var(--ok);color:#fff}button.danger{background:#fdecec;color:var(--danger)}button.small{padding:5px 9px;font-size:12px;white-space:nowrap}
.notice-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;margin-bottom:12px;cursor:pointer;border:1px solid transparent;font-size:13px;overflow:hidden}
.notice-bar .notice-text{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.notice-bar .notice-count{flex:0 0 auto;font-size:12px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.06)}
.notice-bar .notice-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%}
.notice-bar[data-tone="red"]{background:#fdecec;border-color:#f5c2c2;color:#a12b2b}
.notice-bar[data-tone="red"] .notice-dot{background:var(--red)}
.notice-bar[data-tone="orange"]{background:#fff4e5;border-color:#f5d9ae;color:#8a5a00}
.notice-bar[data-tone="orange"] .notice-dot{background:#c2760b}
.notice-bar[data-tone="blue"]{background:#eef4ff;border-color:#cddcf7;color:#2b4f8a}
.notice-bar[data-tone="blue"] .notice-dot{background:#3f6ec4}
html[data-theme="dark"] .notice-bar[data-tone="red"]{background:color-mix(in srgb,var(--red) 18%,transparent);border-color:color-mix(in srgb,var(--red) 40%,transparent);color:#ffb4ad}
html[data-theme="dark"] .notice-bar[data-tone="orange"]{background:color-mix(in srgb,var(--orange) 18%,transparent);border-color:color-mix(in srgb,var(--orange) 40%,transparent);color:#ffd08a}
html[data-theme="dark"] .notice-bar[data-tone="blue"]{background:color-mix(in srgb,var(--blue) 18%,transparent);border-color:color-mix(in srgb,var(--blue) 40%,transparent);color:#a9c8ff}
.notice-bar .notice-more{background:none;border:0;font:inherit;color:inherit;cursor:pointer;padding:0 2px}
.health{display:flex;flex-direction:column;gap:2px}
.health-row{display:grid;grid-template-columns:52px 1fr auto;gap:2px var(--sp-2);align-items:center;background:none;border:0;border-top:1px solid var(--separator);padding:var(--sp-2) 0;font:inherit;color:inherit;text-align:left;cursor:pointer}
.health-row:first-child{border-top:0}
.health-bar{grid-column:1;grid-row:1/3;display:block;height:6px;border-radius:3px;background:var(--fill);overflow:hidden}
.health-bar i{display:block;height:100%;border-radius:3px;background:var(--blue)}
.health-bar i[data-tone="purple"]{background:var(--purple)}
.health-bar i[data-tone="orange"]{background:var(--orange)}
.health-bar i[data-tone="green"]{background:var(--green)}
.health-label{grid-column:2;grid-row:1;font-size:var(--text-body);font-weight:500}
.health-value{grid-column:3;grid-row:1;font-size:var(--text-headline);font-weight:600;font-variant-numeric:tabular-nums}
.health-hint{grid-column:2/4;grid-row:2;font-size:var(--text-caption);color:var(--label-2)}
@media(max-width:720px){.health-row{grid-template-columns:40px 1fr auto}}
.ov-clear{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) 0}
.ov-clear-mark{flex:0 0 auto;display:flex;width:34px;height:34px;align-items:center;justify-content:center;border-radius:50%;background:color-mix(in srgb,var(--green) var(--mix-badge),transparent);color:var(--green)}
.ov-clear-mark svg{width:22px;height:22px}
html[data-theme="dark"] .notice-bar[data-level="pending"]{background:color-mix(in srgb,var(--orange) 18%,transparent);border-color:color-mix(in srgb,var(--orange) 32%,transparent);color:var(--orange)}
html[data-theme="dark"] .notice-bar[data-level="critical"]{background:color-mix(in srgb,var(--red) 18%,transparent);border-color:color-mix(in srgb,var(--red) 32%,transparent);color:#FF8A80}
html[data-theme="dark"] .notice-bar .notice-count{background:rgba(255,255,255,.12)}
.notice-bar[data-level="pending"] .notice-dot{background:#c2760b}
.notice-bar[data-level="critical"]{background:#fdecec;border-color:#f5c2c2;color:#a12b2b}
.notice-bar[data-level="critical"] .notice-dot{background:var(--danger)}
.notice-bar[data-level="warning"]{background:#fff7e8;border-color:#f7e0b5;color:#8a5f00}
.notice-bar[data-level="warning"] .notice-dot{background:#d08a00}
.notice-bar[data-level="notice"]{background:#eef4ff;border-color:#cddcf7;color:#2b4f8a}
.notice-bar[data-level="notice"] .notice-dot{background:#3f6ec4}
.notice-bar .notice-more{flex:0 0 auto;font-size:12px;opacity:.75}
.globe-box{position:relative;height:210px;margin-top:8px;border-radius:12px;overflow:hidden;background:transparent;border:1px solid var(--line);touch-action:none}
.globe-pause{margin-left:4px;padding:2px 7px;font-size:11px;line-height:1.2}
.globe-expand{position:absolute;top:6px;right:6px;z-index:3;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:3px 8px;font-size:13px;line-height:1.2;cursor:pointer}
.globe-expand:hover{background:var(--btn)}
html[data-theme="dark"] .globe-box{background:transparent}
.globe-box.globe-full{position:fixed;inset:16px;z-index:60;height:auto;margin:0;border-radius:16px;box-shadow:0 24px 60px rgba(10,20,40,.35)}
.globe-box.globe-full canvas{cursor:grab}
.globe-big{position:fixed;inset:6%;z-index:80;background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 24px 70px rgba(8,16,32,.35);display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,320px);gap:0}
.globe-big-stage{min-width:0;position:relative;background:var(--bg)}
.globe-box-big{position:absolute;inset:0;height:100%;margin-top:0;border:0;border-radius:0;background:transparent}
.globe-big-side{min-width:0;display:flex;flex-direction:column;padding:16px;border-left:1px solid var(--line);background:var(--card);overflow:hidden}
.globe-big-side .danmu-feed{flex:1;max-height:none;overflow-y:auto}
.globe-big-close{position:absolute;top:12px;right:12px;z-index:5}
@media(max-width:900px){.globe-big{inset:4%;grid-template-columns:1fr;grid-template-rows:1fr auto}.globe-big-side{border-left:0;border-top:1px solid var(--line);max-height:42vh}.globe-box-big{position:relative;inset:auto;height:52vh}}
#globe-overlay{position:fixed;inset:0;z-index:80;display:none}
#globe-overlay.globe-overlay-on{display:block}
.danmu-title{font-size:12px;color:var(--muted);margin-bottom:6px}
.danmu-feed{max-height:180px;overflow:hidden;border:1px solid var(--line);border-radius:10px;padding:6px 10px;background:var(--btn);display:flex;flex-direction:column-reverse}
.danmu-row{display:flex;gap:8px;align-items:center;font-size:12px;padding:4px 0;border-bottom:1px dashed var(--line);white-space:nowrap;overflow:hidden}
.danmu-row:last-child{border-bottom:0}
.danmu-time{color:var(--muted);flex:0 0 auto;font-variant-numeric:tabular-nums}
.danmu-agent{flex:0 0 auto;max-width:96px;overflow:hidden;text-overflow:ellipsis}
.danmu-where{flex:0 0 auto;color:var(--muted)}
.danmu-act{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
.danmu-empty{font-size:12px;color:var(--muted);padding:6px 0}
.danmu-new{animation:danmuIn .45s ease-out}
@keyframes danmuIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.danmu-new{animation:none}}
.globe-box canvas{cursor:grab}
.globe-box canvas:active{cursor:grabbing}
.globe-empty{position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;padding:16px;pointer-events:none;color:var(--muted);font-size:12px;text-align:center;overflow-wrap:anywhere;word-break:break-word;overflow:hidden}
#globe-status{overflow-wrap:anywhere;word-break:break-word;font-size:11px;line-height:1.4;max-height:34px;overflow:hidden}
.globe-box canvas{display:block;max-width:100%}
@media(max-width:720px){
  .globe-box{height:200px}
  /* The account menu is anchored to the avatar and must never leave the screen. */
  .user-wrap{position:relative}
  .account-menu{position:fixed;left:12px;right:12px;top:auto;transform:none;min-width:0;max-width:none}
  /* Tables keep a usable width and scroll sideways like the items page. */
  .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
  .table-wrap table{min-width:560px}
  .grid3{grid-template-columns:1fr}
  .grid3>.card{height:260px}
  .grid3 .globe-box{min-height:150px}
  .grid3 .donut-wrap{min-height:150px}
  .agent-stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  .agent-stat{padding:8px}
  .agent-stat b{font-size:16px}
  .globe-big{inset:3%}
  .globe-big-side{max-height:38vh}
}
@media (prefers-reduced-motion: reduce){#globe-card .globe-box{scroll-behavior:auto}}
.agent-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))!important;grid-auto-flow:column;gap:10px;margin:10px 0;width:100%}
.agent-stats::after{content:none}
.agent-stat{background:var(--card);border:1px solid var(--line);border-radius:var(--ios-radius);box-shadow:var(--ios-shadow);padding:10px 14px;display:flex;flex-direction:column;justify-content:center;min-height:64px;min-width:0}
html[data-theme="dark"] .agent-stat{box-shadow:none;background:#151f31}
.agent-stat b{font-size:19px;line-height:1.1;display:block}
.agent-stat span{display:block;margin-top:2px;font-size:12px;color:var(--muted)}
.agent-stat i{display:block;margin-top:6px;font-size:11px;color:var(--muted);font-style:normal;opacity:.8}
@media(max-width:600px){.agent-stat{padding:8px 10px;min-height:64px}.agent-stat b{font-size:16px}.agent-stat span{font-size:10px}.agent-stat i{display:none}}
.agent-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px}
.agent-detail-grid>div{display:flex;flex-direction:column;gap:2px}
.agent-detail-grid span{font-size:11px;color:var(--muted)}
.agent-detail-grid b{font-size:13px;font-weight:500}
@media(max-width:420px){.agent-detail-grid{grid-template-columns:1fr}}
.row{display:flex;gap:9px;flex-wrap:wrap;align-items:end}.row>*{flex:1;min-width:140px}.row button{flex:0 0 auto}
.hidden{display:none!important}.status{min-height:18px;font-size:12px;color:var(--muted);margin-top:8px}.error{color:var(--danger)}.ok{color:var(--ok)}
/* A collapsible settings card: the heading row is the toggle, so a long
   settings page starts folded instead of being one wall of fields. */
.card.collapsible>.card-toggle{cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;margin:0 0 5px}
.card.collapsible>.card-toggle .card-caret{color:var(--muted);font-size:11px;transition:transform .15s;display:inline-block}
.card.collapsible.collapsed>.card-toggle .card-caret{transform:rotate(0)}
.card.collapsible:not(.collapsed)>.card-toggle .card-caret{transform:rotate(90deg)}
.card.collapsible.collapsed>.card-body{display:none}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px}.kpi[data-kpi]{cursor:pointer;transition:border-color .15s,transform .15s}.kpi[data-kpi]:hover{border-color:var(--accent);transform:translateY(-1px)}.kpi .label{color:var(--muted);font-size:12px}.kpi .value{font-size:25px;font-weight:650;margin-top:2px}.kpi .sub{font-size:11px;color:var(--muted)}
.kpi.warn .value{color:var(--warn)}
.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap}.spacer{flex:1}
.seg{background:#fff;border:1px solid var(--line);border-radius:10px;padding:3px;display:flex;gap:2px}.seg button{background:transparent;color:var(--muted);padding:5px 10px;font-size:12px;border-radius:7px}.seg button.on{background:var(--ok);color:#fff}
/* Two rows of two fixed-height panels. Nothing may grow with the data. */
.grid3{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);grid-template-rows:auto auto;gap:14px;align-items:start}
.grid3>.card{display:flex;flex-direction:column;min-width:0;height:300px;overflow:hidden}
.grid3>.card>h2{margin:0 0 4px;flex:0 0 auto}
.grid3 .trend-box{flex:1 1 auto;min-height:0;overflow:hidden}
.grid3 .globe-box{flex:1 1 auto;min-height:0;height:auto}
.grid3 .donut-wrap{flex:1 1 auto;min-height:0;height:auto;justify-content:center;align-content:center;overflow:hidden}
/* The ranking scrolls inside its box: fixed height, hidden scrollbar, wheel still works. */
.grid3 .rank-box{flex:1 1 auto;min-height:0;height:auto;overflow-y:scroll;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none}
.grid3 .rank-box::-webkit-scrollbar{width:0;height:0;display:none}
.grid3 .rank-box table{width:100%}@media(max-width:1000px){.grid3{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:12.5px}
.table-wrap table{min-width:520px}th{color:var(--muted);font-weight:500;text-align:left;padding:8px;border-bottom:1px solid var(--line);white-space:nowrap}td{padding:8px;border-bottom:1px solid var(--line);vertical-align:middle}td.actions{white-space:nowrap}td.actions button+button{margin-left:6px}th.nowrap{white-space:nowrap}tr:last-child td{border-bottom:0}tbody tr:hover td{background:#f8fafc}
.table-wrap{overflow-x:auto;max-width:100%}
/* Long lists scroll inside their card instead of stretching the page: about 13
   rows, then scroll. The bar is hidden because the row count is obvious and a
   visible bar on every table is noise; the wheel and touch still work. */
.scroll-list{max-height:620px;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none}
.scroll-list::-webkit-scrollbar{width:0;height:0;display:none}
/* Global search on the overview: grouped rows, each one a button that opens the
   page owning the hit. About 13 rows fit, then it scrolls; the bar is hidden
   like the other in-card lists. Height is fixed because this sits above the charts. */
.gs-box{max-height:400px;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none}
.gs-box::-webkit-scrollbar{width:0;height:0;display:none}
#global-search-results{border:1px solid var(--line);border-radius:12px;padding:6px 8px;margin-bottom:12px;background:var(--card)}
.gs-group-title{font-size:11px;color:var(--muted);margin:6px 2px 2px}
.gs-row{display:flex;gap:8px;align-items:center;width:100%;text-align:left;background:transparent;padding:6px 8px;border-radius:8px;font-size:12.5px}
.gs-row:hover,.gs-row:focus-visible{background:var(--btn)}
.gs-row b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-sub{color:var(--muted);font-size:11px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-more{font-size:11px;color:var(--muted);padding:2px 8px 4px}
.toolbar .gs-input{flex:0 1 280px;width:280px;min-width:0}
@media(max-width:720px){.toolbar .gs-input{flex:1 1 100%;width:100%}}
.pill{display:inline-block;background:#eef7f5;color:#0b7d6d;border-radius:999px;padding:1px 8px;font-size:11px;border:0;cursor:pointer}.pill:hover{background:#dff3ee}.pill.off{background:#f3f4f6;color:var(--muted)}
/* Item kind, right beside the name: green api, blue web, grey unclassified.
   The same three colours are used in the picker, so the label a credential gets
   is the colour the operator chose. */
.kind-tag{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;margin-left:6px;border:1px solid transparent;white-space:nowrap}
.kind-api{background:#e8f7f4;color:#0b7d6d;border-color:#bfe6dd}
.kind-web{background:#eaf1fd;color:#1f5fbf;border-color:#c6d9f7}
.kind-none{background:#fdecec;color:#c0392b;border-color:#f2c4c0}
html[data-theme="dark"] .kind-api{background:#0d3b36;color:#5fd8c4;border-color:#1c5c54}
html[data-theme="dark"] .kind-web{background:#152b4d;color:#7fb0f5;border-color:#26476f}
html[data-theme="dark"] .kind-none{background:#3b1d1d;color:#f08f86;border-color:#5c2a2a}
.link-button{display:inline-block;border-radius:10px;padding:9px 13px;text-decoration:none;font-size:14px}
.link-button.primary{background:var(--ok);color:#fff}
.donut-wrap{display:flex;gap:12px;align-items:flex-start;flex-wrap:nowrap;min-width:0;overflow:hidden}.donut-svg{position:relative;width:140px;height:140px;flex:0 0 auto;max-width:45%;align-self:flex-start}.donut-svg svg{width:140px;height:140px;transform:rotate(-90deg)}.donut-svg .donut-center{inset:31px}.donut-center{position:absolute;inset:25px;background:#fff;border-radius:50%;display:grid;place-items:center;font-weight:650;font-size:17px;text-align:center;padding:6px}.legend{font-size:12px}.legend div{display:flex;justify-content:space-between;gap:18px;margin:5px 0;cursor:pointer;border-radius:6px;padding:2px 4px}.legend div.active{background:var(--btn);font-weight:600}.dot{display:inline-block;width:8px;height:8px;border-radius:99px;margin-right:6px}
.legend{font-size:12px;flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;align-content:flex-start;overflow-y:auto;max-height:100%;scrollbar-width:none;-ms-overflow-style:none}.legend::-webkit-scrollbar{width:0;height:0;display:none}.legend div{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;cursor:pointer;border-radius:6px;padding:1px 4px;min-width:0;width:100%}.legend div span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.legend div b{flex:0 0 auto;font-weight:500}.dot{display:inline-block;width:8px;height:8px;border-radius:99px;margin-right:6px;flex:0 0 auto}.legend-pager{display:flex;gap:6px;justify-content:flex-end;align-items:center;margin-top:4px;font-size:11px;color:var(--muted)}.legend-pager button{border:1px solid var(--line);background:var(--card);border-radius:6px;padding:1px 7px;font-size:11px;cursor:pointer}
ul.items{list-style:none;margin:0;padding:0}ul.items li{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}ul.items li:last-child{border-bottom:0}ul.items .name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}ul.items .type{color:var(--muted);font-size:11px}
.secret{background:#0f172a;color:#d1fae5;border-radius:10px;padding:12px;margin-top:8px;word-break:break-all;font-family:ui-monospace,monospace;font-size:12px}
.modal{position:fixed;inset:0;background:rgba(15,23,42,.4);display:grid;place-items:center;padding:20px;z-index:20;overflow-y:auto}.modal .card{position:relative;max-width:620px;width:100%;margin:0;max-height:calc(100vh - 40px);overflow:hidden;display:flex;flex-direction:column;border-radius:20px}#modal-body{overflow-y:auto;min-height:0;flex:1 1 auto;padding-right:4px;scrollbar-width:thin;scrollbar-color:#cbd5e1 transparent}#modal-body::-webkit-scrollbar{width:8px}#modal-body::-webkit-scrollbar-track{background:transparent}#modal-body::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:99px;border:2px solid transparent;background-clip:padding-box}.modal-x{position:sticky;top:0;float:right;margin:-6px -6px 0 8px;border:0;background:transparent;font-size:20px;line-height:1;padding:2px 6px;cursor:pointer;color:var(--muted);z-index:2}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(12px);background:#152033;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:60;opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;max-width:calc(100vw - 32px);box-shadow:0 10px 30px rgba(15,23,42,.25)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.toast.error{background:#c0392b}
.chart-tip{position:fixed;z-index:70;pointer-events:none;background:#152033;color:#fff;border-radius:8px;padding:6px 9px;font-size:12px;line-height:1.4;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;box-shadow:0 8px 22px rgba(15,23,42,.25)}
.chart-tip.show{opacity:1;transform:translateY(0);animation:tipShake .22s ease}
@keyframes tipShake{0%,100%{margin-left:0}25%{margin-left:2px}75%{margin-left:-2px}}
.donut-seg{cursor:pointer;transition:stroke-width .15s,opacity .15s}.donut-seg:hover,.donut-seg.active{stroke-width:25;opacity:1!important}.modal .secret{max-height:120px;overflow:auto}
@media(max-width:860px){.kpis{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}}@media(max-width:620px){.user .email{display:none}}
@media(max-width:720px){.wrap{padding:14px 12px}header{gap:8px}h1{font-size:18px}nav{order:3;width:100%;overflow-x:auto;margin-left:0;padding-bottom:2px}nav button{flex:0 0 auto}.user-wrap{margin-left:0}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.card{padding:14px}.row>*{min-width:100%}.row button{width:100%}.modal{padding:8px}.modal .card{max-height:calc(100vh - 16px);padding:16px}.chart{overflow-x:auto}table{font-size:12px}th,td{padding:6px}}
/* ------------------------------------------------------------------
   iOS theme layer. Everything below is driven by the tokens at the top of
   this block; component rules never hardcode a colour, size or radius.
   Placed last so it wins over the older chrome rules above, which are being
   retired page by page (lists and the item sheet first).
   ------------------------------------------------------------------ */
:root{
  /* surfaces */
  --bg-grouped:#F2F2F7;--card:#FFFFFF;--card-2:#F2F2F7;--tabbar-bg:#F7F7F8;
  /* labels */
  --label:#000000;--label-2:rgba(60,60,67,.6);--label-3:rgba(60,60,67,.3);
  /* separators and fills */
  --separator:rgba(60,60,67,.29);--fill:rgba(120,120,128,.12);--fill-2:rgba(120,120,128,.08);
  /* system colours */
  --blue:#007AFF;--green:#34C759;--orange:#FF9500;--red:#FF3B30;--purple:#AF52DE;
  --mix-icon:14%;--mix-badge:15%;--mix-tint:12%;
  /* aliases kept so older rules keep resolving */
  --bg:var(--bg-grouped);--line:var(--separator);--text:var(--label);--muted:var(--label-2);
  --ok:var(--green);--warn:var(--orange);--danger:var(--red);--btn:var(--fill);--accent:var(--blue);
  --kpi-bg:var(--card);
  /* type */
  --font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  --text-title:22px;--lh-title:28px;--text-headline:17px;--lh-headline:22px;
  --text-body-lg:17px;--lh-body-lg:22px;--text-body:15px;--lh-body:20px;
  --text-sub:13px;--lh-sub:18px;--text-caption:12px;--lh-caption:16px;--text-tab:10px;
  /* space */
  --sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:20px;--sp-6:24px;--sp-7:32px;
  /* radius */
  --r-sm:4px;--r-md:8px;--r-lg:12px;--r-xl:16px;--ios-radius:var(--r-lg);--ios-shadow:0 1px 2px rgba(0,0,0,.04);
  /* structure + motion */
  --nav-h:44px;--row-h:52px;--tabbar-h:49px;
  --ease:cubic-bezier(.32,.72,0,1);--dur-push:.32s;--dur-sheet:.30s;--dur-fade:.20s;
}
html[data-theme="dark"]{
  --bg-grouped:#000000;--card:#1C1C1E;--card-2:#2C2C2E;--tabbar-bg:#161618;
  --label:#FFFFFF;--label-2:rgba(235,235,245,.6);--label-3:rgba(235,235,245,.3);
  --separator:rgba(84,84,88,.6);--fill:rgba(120,120,128,.32);--fill-2:rgba(120,120,128,.24);
  --blue:#0A84FF;--green:#30D158;--orange:#FF9F0A;--red:#FF453A;--purple:#BF5AF2;
  --mix-icon:26%;--mix-badge:24%;--mix-tint:20%;
  --kpi-bg:var(--card);--ios-shadow:none;
}
body{background:var(--bg-grouped);color:var(--label);font:var(--text-body)/var(--lh-body) var(--font-family);-webkit-font-smoothing:antialiased}
/* The legacy dark rules below are more specific (html[data-theme=dark] body),
   so the dark side of every surface has to be restated at the same weight. */
html[data-theme="dark"] body{background:var(--bg-grouped);color:var(--label)}
html[data-theme="dark"] .card,html[data-theme="dark"] .kpi,html[data-theme="dark"] .ios-card,html[data-theme="dark"] .account-menu,html[data-theme="dark"] .donut-center,html[data-theme="dark"] #global-search-results{background:var(--card);box-shadow:none}
html[data-theme="dark"] input,html[data-theme="dark"] select,html[data-theme="dark"] textarea{background:var(--fill-2);color:var(--label)}
html[data-theme="dark"] tbody tr:hover td{background:transparent}
html[data-theme="dark"] .seg{background:var(--fill)}
input[type=checkbox]{appearance:none;-webkit-appearance:none;width:22px;height:22px;border:1.5px solid var(--separator);border-radius:50%;background:transparent;min-height:0;padding:0;flex:0 0 auto;display:inline-grid;place-items:center;transition:background var(--dur-fade) var(--ease),border-color var(--dur-fade) var(--ease)}
input[type=checkbox]:checked{background:var(--blue);border-color:var(--blue)}
input[type=checkbox]:checked::after{content:"";width:6px;height:11px;border:2px solid #fff;border-top:0;border-left:0;transform:translateY(-1.5px) rotate(40deg)}
input[type=checkbox]:disabled{opacity:.4}
input[type=checkbox]:focus{box-shadow:none}
h1{font-size:var(--text-title);line-height:var(--lh-title);font-weight:700;letter-spacing:-.4px}
.badge{background:color-mix(in srgb,var(--blue) var(--mix-badge),transparent);color:var(--blue);font-size:var(--text-caption);padding:2px var(--sp-2);border-radius:999px}
nav{background:var(--fill);border-radius:9px;padding:2px;gap:2px;margin-left:var(--sp-2)}
nav button{padding:6px 14px;border-radius:7px;font-size:var(--text-sub);font-weight:500;color:var(--label)}
nav button.active{background:var(--card);color:var(--label);box-shadow:0 3px 8px rgba(0,0,0,.12)}
html[data-theme="dark"] nav button.active{background:#636366}
.theme-cycle,.icon-btn{color:var(--label-2);border-radius:var(--r-md)}
.theme-cycle:hover,.icon-btn:hover{background:var(--fill)}
.avatar{background:var(--fill);border:0;color:var(--label)}
.account-menu{background:var(--card);border:0;border-radius:var(--r-lg);box-shadow:0 12px 32px rgba(0,0,0,.24);padding:var(--sp-1)}
.account-menu button{font-size:var(--text-body);padding:10px 12px;border-radius:var(--r-md)}
.account-menu button:hover{background:var(--fill)}
.card{background:var(--card);border:0;border-radius:var(--r-lg);box-shadow:var(--ios-shadow);padding:var(--sp-4) var(--sp-4);margin-bottom:var(--sp-4)}
.card>h2,h2{font-size:var(--text-headline);line-height:var(--lh-headline);font-weight:600;margin:0 0 var(--sp-1);letter-spacing:-.2px}
.hint{color:var(--label-2);font-size:var(--text-sub);line-height:var(--lh-sub)}
label.field{font-size:var(--text-sub);color:var(--label-2);margin:var(--sp-3) 0 var(--sp-1)}
input,select,textarea{background:var(--fill-2);border:0;border-radius:var(--r-md);padding:10px 12px;min-height:var(--nav-h);font-size:var(--text-body-lg);color:var(--label)}
input::placeholder,textarea::placeholder{color:var(--label-3)}
input:focus,select:focus,textarea:focus{border:0;box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 40%,transparent);outline:none}
button{border-radius:var(--r-md);padding:10px 16px;font-size:var(--text-body-lg);font-weight:500;background:var(--fill);color:var(--label);transition:opacity var(--dur-fade) var(--ease),transform var(--dur-fade) var(--ease)}
button:active{opacity:.6}
button.primary{background:var(--blue);color:#fff}
button.danger{background:color-mix(in srgb,var(--red) var(--mix-badge),transparent);color:var(--red)}
button.small{padding:6px 12px;font-size:var(--text-sub);border-radius:var(--r-md)}
.link-button{border-radius:var(--r-md);font-size:var(--text-body-lg);padding:10px 16px}
.link-button.primary{background:var(--blue);color:#fff}
.seg{background:var(--fill);border:0;border-radius:9px;padding:2px;gap:2px}
/* The globe time range shares its row with the pause button; without this
   the track grows past the card edge on a 393pt phone. */
#globe-range{display:flex;align-items:center;gap:2px;flex:0 1 auto;min-width:0}
#globe-range button{flex:0 0 auto;width:auto;min-width:0;padding:6px 10px}
.seg button{background:transparent;color:var(--label);padding:6px 12px;font-size:var(--text-sub);border-radius:7px;font-weight:500}
.seg button.on{background:var(--card);color:var(--label);box-shadow:0 3px 8px rgba(0,0,0,.12)}
html[data-theme="dark"] .seg button.on{background:#636366}
/* The globe's time range is text on the card in both themes: the dark track
   turned it into a grey block that competed with the globe. */
html[data-theme="dark"] .seg--vert{background:transparent}
html[data-theme="dark"] .globe-side .globe-pause{background:transparent;border:0}
table{font-size:var(--text-body);border-collapse:separate;border-spacing:0}
th{font-size:var(--text-sub);font-weight:400;color:var(--label-2);padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--separator)}
td{padding:var(--sp-3);border-bottom:1px solid var(--separator);font-size:var(--text-body)}
tr:last-child td{border-bottom:0}
tbody tr:hover td{background:transparent}
tbody tr:active td{background:var(--fill-2)}
.pill{background:color-mix(in srgb,var(--green) var(--mix-badge),transparent);color:var(--green);font-size:var(--text-caption);padding:2px var(--sp-2);border-radius:999px}
.pill:hover{filter:brightness(.96)}
.pill.off{background:var(--fill);color:var(--label-2)}
.kind-tag{border:0;border-radius:999px;padding:2px var(--sp-2);font-size:var(--text-caption);margin-left:var(--sp-2)}
.kind-api{background:color-mix(in srgb,var(--green) var(--mix-badge),transparent);color:var(--green)}
.kind-web{background:color-mix(in srgb,var(--blue) var(--mix-badge),transparent);color:var(--blue)}
.kind-none{background:color-mix(in srgb,var(--orange) var(--mix-badge),transparent);color:var(--orange)}
html[data-theme="dark"] .kind-api,html[data-theme="dark"] .kind-web,html[data-theme="dark"] .kind-none{border:0}
.kpis{gap:var(--sp-3);margin-bottom:var(--sp-4)}
.kpi{background:var(--kpi-bg);border:0;border-radius:var(--r-lg);padding:var(--sp-3) var(--sp-4)}
.kpi .label{font-size:var(--text-sub);color:var(--label-2)}
.kpi .value{font-size:26px;font-weight:700;letter-spacing:-.6px;margin-top:2px}
.kpi .sub{font-size:var(--text-caption);color:var(--label-2)}
.kpi[data-kpi]:hover{border-color:transparent;background:var(--fill-2)}
.agent-stat{background:var(--card);border:0;border-radius:var(--r-lg);box-shadow:var(--ios-shadow)}
.agent-stat b{font-size:19px;font-weight:700}
.agent-stat span{font-size:var(--text-sub);color:var(--label-2)}
.secret{background:var(--fill-2);color:var(--label);border-radius:var(--r-md);font-size:var(--text-sub)}
.modal{background:rgba(0,0,0,.4);padding:var(--sp-5);z-index:80;display:flex;align-items:center;justify-content:center}
.modal .card{max-width:620px;border-radius:var(--r-xl);padding:var(--sp-4) var(--sp-4) var(--sp-5);box-shadow:0 24px 60px rgba(0,0,0,.28)}
#modal-body{border-radius:var(--r-lg)}
.modal .card .hint{font-size:var(--text-caption)}
.modal .table-wrap table{min-width:0}
.modal .table-wrap th,.modal .table-wrap td{padding:var(--sp-2);font-size:var(--text-sub)}
.modal-x{position:absolute;top:var(--sp-3);right:var(--sp-3);width:32px;height:32px;display:grid;place-items:center;background:var(--fill);color:var(--label-2);border-radius:999px;font-size:17px;line-height:1;padding:0;margin:0;float:none;z-index:3}
.modal .card{padding-top:var(--sp-5)}
.modal .card>h2{padding-right:44px}
.toast{background:rgba(28,28,30,.92);color:#fff;border-radius:999px;padding:12px 18px;font-size:var(--text-body);box-shadow:0 10px 30px rgba(0,0,0,.28);transition:opacity var(--dur-fade) var(--ease),transform var(--dur-fade) var(--ease)}
.toast.error{background:var(--red)}
.chart-tip{background:rgba(28,28,30,.92);border-radius:var(--r-md);font-size:var(--text-caption);box-shadow:0 8px 22px rgba(0,0,0,.28)}
.status{font-size:var(--text-sub);color:var(--label-2)}
.error{color:var(--red)}.ok{color:var(--green)}
ul.items li{border-bottom:1px solid var(--separator);padding:12px 0}
ul.items .name{font-weight:600;font-size:var(--text-body-lg)}
ul.items .type{font-size:var(--text-caption);color:var(--label-2)}
.gs-row{border-radius:var(--r-md);font-size:var(--text-body)}
.gs-row:hover,.gs-row:focus-visible{background:var(--fill-2)}
.gs-group-title{font-size:var(--text-caption);color:var(--label-2);text-transform:none}
#global-search-results{background:var(--card);border:0;border-radius:var(--r-lg);padding:var(--sp-2)}
@media(max-width:720px){
  body{padding-bottom:calc(var(--tabbar-h) + 14px + env(safe-area-inset-bottom))}
  nav{position:fixed;left:0;right:0;bottom:0;z-index:50;order:0;width:auto;margin:0;padding:6px var(--sp-2) calc(6px + env(safe-area-inset-bottom));display:flex;justify-content:space-around;gap:0;border-radius:0;min-height:var(--tabbar-h);background:var(--tabbar-bg);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border-top:1px solid var(--separator);overflow:visible}
  nav button,nav .icon-btn{flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:var(--nav-h);padding:2px 0;font-size:var(--text-tab);font-weight:500;color:var(--label-2);background:transparent !important;box-shadow:none !important;border-radius:0}
  nav button.active{color:var(--blue);background:transparent !important;box-shadow:none !important}
  .wrap{padding:var(--sp-3) var(--sp-4) calc(var(--sp-5) + env(safe-area-inset-bottom))}
  header{gap:var(--sp-2);margin-bottom:var(--sp-3)}
  h1{font-size:26px;line-height:32px}
  .card{padding:var(--sp-3) var(--sp-3);border-radius:var(--r-lg);margin-bottom:var(--sp-3)}
  .modal{display:flex;align-items:flex-end;justify-content:stretch;padding:0;overflow:hidden}
  .modal .card{max-width:none;width:100%;max-height:92vh;border-radius:var(--r-xl) var(--r-xl) 0 0;padding:var(--sp-4) var(--sp-4) calc(var(--sp-5) + env(safe-area-inset-bottom));box-shadow:0 -8px 40px rgba(0,0,0,.28)}
  .toast{bottom:calc(var(--tabbar-h) + var(--sp-4))}
  .kpi .value{font-size:22px}
  td{padding:var(--sp-2) var(--sp-2)}
  th{padding:6px var(--sp-2)}
}
@media (prefers-reduced-motion: reduce){
  button,.toast,nav button{transition-duration:1ms}
}
/* iOS grouped list used by the credentials page. */
.ios-group{margin-top:var(--sp-4);--ios-lead:0px}
.ios-group.selecting{--ios-lead:34px}
.ios-group:not(.selecting) .ios-check{display:none}
.ios-group-head{display:flex;align-items:center;gap:var(--sp-2);padding:0 var(--sp-4) var(--sp-2);color:var(--label-2);font-size:var(--text-sub)}
.ios-card{background:var(--card);border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--ios-shadow)}
.ios-row{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) var(--sp-3);min-height:var(--row-h);position:relative}
.ios-row+.ios-row::before{content:"";position:absolute;left:calc(var(--sp-3) + var(--ios-lead) + 36px + var(--sp-3));right:0;top:0;height:1px;background:var(--separator)}
.ios-row:active{background:var(--fill-2)}
.ios-check{width:20px;height:20px;flex:0 0 auto;accent-color:var(--blue);min-height:0}
.ios-ico{width:36px;height:36px;border-radius:var(--r-md);display:grid;place-items:center;flex:0 0 auto}
.ios-ico[data-kind=api]{background:color-mix(in srgb,var(--blue) var(--mix-icon),transparent);color:var(--blue)}
.ios-ico[data-kind=web]{background:color-mix(in srgb,var(--purple) var(--mix-icon),transparent);color:var(--purple)}
.ios-ico[data-kind=none]{background:color-mix(in srgb,var(--orange) var(--mix-icon),transparent);color:var(--orange)}
.ios-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;cursor:pointer;padding:var(--sp-1) 0;border-radius:var(--r-md)}
.ios-main:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.ios-title{font-size:var(--text-body-lg);line-height:var(--lh-body-lg);font-weight:500;display:flex;align-items:center;min-width:0;gap:var(--sp-1)}
.ios-title b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ios-title .kind-tag{margin-left:0;flex:0 0 auto}
.ios-sub{font-size:var(--text-sub);line-height:var(--lh-sub);color:var(--label-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ios-trail{display:flex;align-items:center;gap:var(--sp-1);flex:0 0 auto}
.ios-pill{font-size:var(--text-caption);padding:4px 10px;border-radius:999px;background:var(--fill);color:var(--label-2);min-height:28px;font-weight:500}
.ios-pill.on{background:color-mix(in srgb,var(--green) var(--mix-badge),transparent);color:var(--green)}
.ios-pill.web{background:color-mix(in srgb,var(--purple) var(--mix-badge),transparent);color:var(--purple)}
.ios-sub .ios-expired{color:var(--red);font-weight:500}
/* A share target list has to be tappable one row at a time; a native
   multiple select on a phone is a tiny scroll box where a tap replaces the
   selection instead of adding to it. */
.pick-list{border:1px solid var(--separator);border-radius:var(--r-md);overflow:hidden;margin-bottom:var(--sp-3)}
.pick-row{display:flex;align-items:center;gap:var(--sp-3);min-height:var(--row-h);padding:0 var(--sp-3);font-size:var(--text-body-lg);color:var(--label)}
.pick-row+.pick-row{border-top:1px solid var(--separator)}
.pick-row .ios-check{flex:0 0 auto}
.ios-pill.none{background:color-mix(in srgb,var(--orange) var(--mix-badge),transparent);color:var(--orange)}
.ios-pill.ok,.ios-pill.warn{background:color-mix(in srgb,var(--green) var(--mix-badge),transparent);color:var(--green)}
.ios-pill.warn{background:color-mix(in srgb,var(--orange) var(--mix-badge),transparent);color:var(--orange)}
.ios-pill.bad{background:color-mix(in srgb,var(--red) var(--mix-badge),transparent);color:var(--red)}
button.ios-pill{border:0;cursor:pointer;min-width:0}
.ios-pill.plain{color:var(--blue)}
.ios-title .ios-name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ios-flag{font-size:var(--text-caption);padding:2px 8px;border-radius:999px}
.ios-flag.bad{background:color-mix(in srgb,var(--red) var(--mix-badge),transparent);color:var(--red)}
.ios-flag.warn{background:color-mix(in srgb,var(--orange) var(--mix-badge),transparent);color:var(--orange)}
.ios-row--stack{align-items:flex-start}
.ios-row--log{align-items:flex-start;min-height:0;padding-top:var(--sp-2);padding-bottom:var(--sp-2)}
.ios-log-time{font-size:var(--text-caption);color:var(--label-3);font-variant-numeric:tabular-nums}
.ios-log-text{font-size:var(--text-body);line-height:var(--lh-body);color:var(--label)}
.ios-log-text.bad{color:var(--red)}
.ios-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:var(--sp-2)}
.ios-chip{font-size:var(--text-sub);padding:7px 12px;border-radius:var(--r-md);background:var(--fill);color:var(--blue);border:0;min-height:34px;font-weight:500}
.ios-chip.danger{color:var(--red)}
.ios-actions .ios-chip:first-child{background:var(--blue);color:#fff}
.ios-more{width:44px;height:44px;display:grid;place-items:center;background:transparent;color:var(--label-3);font-size:18px;padding:0;border-radius:var(--r-md)}
.ios-more:hover{background:var(--fill-2);color:var(--label-2)}
/* A segmented control is text-only on desktop; the tab bar below 720px
   is the place where a UITabBarItem needs its glyph. */
nav button svg{display:none;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
nav button{display:inline-flex;align-items:center;gap:6px}
.page{position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;background:var(--bg-grouped);transform:translateX(100%);transition:transform var(--dur-push) var(--ease);will-change:transform}
.page.in{transform:translateX(0)}
.page-nav{flex:0 0 auto;height:var(--nav-h);display:flex;align-items:center;gap:var(--sp-2);padding:0 var(--sp-3);background:var(--nav-bg);border-bottom:1px solid var(--separator);position:relative}
.page-title{flex:1 1 auto;min-width:0;text-align:center;font-size:var(--text-headline);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.page-back,.page-action{display:flex;align-items:center;gap:2px;background:none;border:0;color:var(--blue);font-size:var(--text-body-lg);padding:0;min-height:44px;min-width:44px}
.page-back svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.page-action{justify-content:flex-end}
.page-close{display:none;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;border:0;border-radius:50%;background:var(--fill);color:var(--label-2);padding:0}
.page-close svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
.page-body{flex:1 1 auto;min-height:0;overflow-y:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:var(--sp-3)}
.page-body>.card{max-width:680px;margin:0 auto}
body.page-open{overflow:hidden}
/* Wide screens: the detail stops covering the list and becomes the right-hand
   column, the way a UISplitViewController .doubleColumn behaves on iPad. The
   DOM does not move — the page just stops being full-width and the wrap gets
   padded by the same amount, so the list stays where the eye left it. */
@media (min-width:1000px){
  body.page-open{overflow:auto}
  body.page-open #item-page{left:auto;right:0;width:min(680px,54vw);border-left:1px solid var(--separator);box-shadow:-1px 0 30px rgba(0,0,0,.07)}
  body.page-open .page-back{visibility:hidden;pointer-events:none}
  body.page-open #item-page-close{display:flex}
  body.page-open .wrap{max-width:none;padding-right:calc(min(680px,54vw) + var(--sp-3))}
  /* The list column is narrower than the full page: the search field gets its
     own row and the five actions split the next one evenly, instead of the
     140px minimum wrapping them into three ragged lines. */
  body.page-open #view-items .row{display:flex;flex-wrap:wrap;gap:var(--sp-2);align-items:center}
  body.page-open #view-items .row>input{flex:1 1 100%;min-width:0}
  body.page-open #view-items .row>#item-filter{flex:0 0 auto}
  body.page-open #view-items .row>button{min-width:0;padding:0 var(--sp-2);font-size:var(--text-body)}
  /* The row the pane is showing gets the same tint a selected list row has. */
  .ios-row.current{background:color-mix(in srgb, var(--blue) var(--mix-tint), transparent)}
}
.kv{display:flex;align-items:baseline;gap:var(--sp-3);padding:11px 0;border-bottom:1px solid var(--separator);font-size:var(--text-body-lg)}
.kv:last-child{border-bottom:0}
.kv>span{color:var(--label-2);flex:0 0 auto}
.kv>b{margin-left:auto;font-weight:400;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kv a{color:var(--blue);text-decoration:none}
.card.edit-only{display:none}
/* Rows that behave like a grouped settings list: a label on the left, the
   control on the right, one hairline between them. */
.ios-field{display:flex;align-items:center;gap:var(--sp-3);min-height:var(--row-h);padding:0 var(--sp-4);border-bottom:1px solid var(--separator)}
.ios-field:last-child{border-bottom:0}
.card>.ios-field{margin:0 calc(-1 * var(--sp-4))}
.ios-head{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-2)}
.ios-field>label{flex:1 1 auto;min-width:0;font-size:var(--text-body-lg);color:var(--label)}
.ios-field>label small{display:block;font-size:var(--text-sub);line-height:var(--lh-sub);color:var(--label-2);margin-top:1px}
.ios-field>select,.ios-field>input[type="date"]{flex:0 1 auto;max-width:60%;text-align:right;background:transparent;border:0;padding:0;font-size:var(--text-body-lg);color:var(--label-2);appearance:none}
/* The dark theme paints every select through its own rule, which outranks
   the row rule and wipes the chevron; restate both here. */
html[data-theme="dark"] .ios-field>select,html[data-theme="dark"] .ios-field>input[type="date"]{background-color:transparent;border:0;color:var(--blue)}
html[data-theme="dark"] .ios-field>select{background-repeat:no-repeat;background-position:right center;background-size:9px 9px;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238e8e93' stroke-width='2.6' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")}
.ios-field>select{color:var(--blue);padding-right:18px;background-repeat:no-repeat;background-position:right center;background-size:9px 9px;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2.6' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")}
.ios-field--stack{display:block;padding-top:var(--sp-3);padding-bottom:var(--sp-3)}
.ios-field--stack textarea{width:100%;margin-top:var(--sp-2);min-height:74px}
/* A checkbox dressed as a UISwitch: 51x31 track, 27pt knob, green when on. */
input.ios-switch{appearance:none;-webkit-appearance:none;flex:0 0 auto;width:51px;height:31px;min-width:51px;border:0;border-radius:16px;background:var(--fill-2);position:relative;transition:background var(--dur-fade) var(--ease);cursor:pointer;margin:0;padding:0}
input.ios-switch::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;border:0;box-shadow:0 2px 5px rgba(0,0,0,.22);transform:none;transition:transform var(--dur-fade) var(--ease)}
input.ios-switch:checked{background:var(--green);border-color:var(--green)}
input.ios-switch:checked::after{transform:translateX(20px);border:0}
/* Buttons inside the detail pane are full-width actions, not toolbar chips. */
.page .row>button{flex:1 1 auto;min-width:0;min-height:44px;border-radius:var(--r-md);font-size:var(--text-body-lg);font-weight:500}
.page .row>button.primary{background:var(--blue);color:#fff}
.page .row>button.danger{background:color-mix(in srgb,var(--red) var(--mix-badge),var(--card));color:var(--red)}
html[data-theme="dark"] .page .row>button.danger{background:color-mix(in srgb,var(--red) 16%,var(--card))}
.page .row>button:not(.primary):not(.danger){background:var(--fill);color:var(--label)}
.page[data-editing="true"] .card.edit-only{display:block}
.hdr-actions{margin-left:auto;display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;justify-content:flex-end}
.hdr-actions .small{font-size:var(--text-sub);padding:6px 12px}
.theme-cycle{width:36px;height:36px;display:grid;place-items:center;font-size:16px;background:transparent}
@media(max-width:720px){
  header{flex-wrap:nowrap;align-items:center}
  header h1{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  h1{font-size:22px;line-height:28px}
  header .badge{display:none}
  .hdr-actions{gap:var(--sp-1)}
  .hdr-actions #ai-help,.hdr-actions .icon-btn,.hdr-actions #page-refresh{display:none}
  .hdr-actions .small{font-size:var(--text-caption);padding:6px 10px;min-height:36px}
}
#view-items .row{align-items:center}
#view-items .row>button{flex:0 0 auto;min-width:0}
#view-items .row>#item-filter{flex:1 1 240px}
@media(max-width:720px){.hdr-actions .who-name,.user .who-name{display:none}}
@media(max-width:720px){
  nav button{flex-direction:column;gap:3px;font-size:var(--text-tab);line-height:1;padding:6px 2px}
  nav button svg{display:block;width:26px;height:26px;stroke-width:1.7}
  #globe-range{flex:1 1 100%;justify-content:space-between}
  #view-agents .row>select,#view-logs .row>select{width:auto;flex:1 1 0;min-width:0}
  #view-logs .row>input{flex:1 1 100%}
  #view-logs .row>button{flex:1 1 100%}
  /* Let the trend card hug its chart instead of leaving a 100px hole. */
  .grid3>.card{height:auto}
  .grid3 .trend-box{flex:0 0 auto}
  /* Only the trail of a list row is too tight for a second pill; the detail
     pane has the width to keep its own actions. */
  .ios-trail .ios-pill.plain{display:none}
  #view-items .row{gap:6px}
  #view-items .row button{width:auto;flex:0 0 auto;padding:8px 11px;font-size:var(--text-body);min-height:38px}
  #view-items .row>*{min-width:0}
  #view-items .row input#item-filter{flex:1 1 100%;width:100%}
  .ios-flag{display:none}
  .ios-row{padding:var(--sp-2);gap:var(--sp-2)}
  .ios-row+.ios-row::before{left:calc(var(--sp-2) + var(--ios-lead) + 36px + var(--sp-2))}
  .ios-title{font-size:var(--text-body)}
}
/* Overview: a headline, then widgets, then the work that needs a decision. */
.ov-head{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--sp-3);flex-wrap:wrap;margin-bottom:var(--sp-3)}
.ov-title{margin:0;font-size:34px;line-height:41px;letter-spacing:.37px}
.ov-sub{margin-top:2px;font-size:var(--text-sub);color:var(--label-2)}
#updated{margin-top:2px;font-size:var(--text-caption);color:var(--label-3)}
.ov-controls{display:flex;align-items:center;justify-content:flex-end;gap:var(--sp-2);flex:1 1 260px;margin-bottom:var(--sp-3)}
.ov-search{margin:0;flex:1 1 180px;max-width:320px;min-width:0}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-2)}
.trend-nav{display:flex;align-items:center;gap:2px;flex:0 0 auto}
.trend-arrow{width:28px;height:28px;min-height:0;padding:0;border:0;border-radius:50%;background:var(--fill);color:var(--label-2);font-size:15px;line-height:1;display:grid;place-items:center;cursor:pointer}
.trend-arrow:hover{color:var(--label)}
.trend-count{font-size:11px;color:var(--label-3);font-variant-numeric:tabular-nums;min-width:22px;text-align:center}
.heat{display:grid;grid-template-columns:44px repeat(24,minmax(0,1fr));gap:3px;align-items:center}
.heat__corner{grid-column:1}
.heat__hour{font-size:10px;color:var(--label-3);text-align:center;font-variant-numeric:tabular-nums}
.heat__day{font-size:12px;color:var(--label-2);padding-right:6px;text-align:right}
.heat__cell{height:auto;min-height:14px;aspect-ratio:1;border-radius:4px;background:var(--fill);display:grid;place-items:center;font-size:10px;color:#fff;font-weight:600}
.heat__legend{display:flex;align-items:center;gap:5px;margin-top:10px;font-size:11px;color:var(--label-2)}
.heat__legend i{width:12px;height:12px;border-radius:3px;display:block}
.heat__total{margin-left:auto}
.aa-pick{width:34px;padding-right:0}
.aa-pick .ios-check{display:inline-grid;vertical-align:middle}
.health-item{display:flex;flex-direction:column}
.health-row .health-chev{grid-column:4;grid-row:1/3;color:var(--label-3);font-size:15px;transition:transform .2s var(--ease)}
.health-row.open .health-chev{transform:rotate(90deg)}
.health-row{grid-template-columns:52px 1fr auto 14px}
.health{max-height:198px;overflow-y:auto;gap:0}
.health-row{box-sizing:border-box;display:flex;align-items:center;gap:var(--sp-2);min-height:36px;padding:3px 0;grid-template-columns:none}
.health-bar{flex:0 0 40px;height:5px;grid-column:auto;grid-row:auto}
.health-label{flex:0 0 auto;grid-column:auto;grid-row:auto;font-size:var(--text-body)}
.health-hint{flex:1 1 auto;grid-column:auto;grid-row:auto;font-size:var(--text-caption);color:var(--label-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.health-value{flex:0 0 auto;margin-left:auto;grid-column:auto;grid-row:auto;font-size:var(--text-body-lg);font-variant-numeric:tabular-nums}
.health-row .health-chev{grid-column:auto;grid-row:auto;flex:0 0 12px}
.health-cred{padding:5px 0 5px 48px}
.health-more{padding:5px 0 5px 48px}
.health-list{display:flex;flex-direction:column;padding:0 0 var(--sp-2) 0}
.health-cred{display:flex;align-items:baseline;gap:var(--sp-2);background:none;border:0;border-top:1px solid var(--separator);padding:6px 0 6px 52px;font:inherit;font-size:var(--text-sub);color:inherit;text-align:left;cursor:pointer}
.health-cred:hover{color:var(--blue)}
.health-cred b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.health-cred span{color:var(--label-2);font-size:var(--text-caption);flex:0 0 auto;margin-left:auto}
.health-more{padding:6px 0 6px 52px;font-size:var(--text-caption);color:var(--label-2)}
@media(max-width:720px){.health-row{grid-template-columns:40px 1fr auto 12px}}
.ask{position:fixed;left:0;right:0;bottom:0;z-index:120;display:flex;flex-direction:column;gap:var(--sp-3);padding:var(--sp-4) var(--sp-4) calc(var(--sp-4) + env(safe-area-inset-bottom));background:var(--card);border-top:1px solid var(--separator);box-shadow:0 -8px 32px rgba(0,0,0,.18);animation:ask-in .22s var(--ease)}
@keyframes ask-in{from{transform:translateY(100%)}to{transform:translateY(0)}}
.ask__text{font-size:var(--text-body);color:var(--label);line-height:1.4}
.ask__row{display:flex;gap:var(--sp-2)}
.ask__row button{flex:1 1 0;min-height:44px;border-radius:var(--r-md);border:0;font-size:var(--text-body);font-weight:500;background:var(--fill);color:var(--label)}
.ask__row button.ask__yes{background:var(--red);color:#fff}
@media(min-width:721px){.ask{left:50%;right:auto;bottom:24px;transform:translateX(-50%);width:420px;border:1px solid var(--separator);border-radius:var(--r-lg);box-shadow:0 12px 40px rgba(0,0,0,.22);animation:none}}
@media(max-width:720px){.ask{bottom:calc(var(--tabbar-h) + env(safe-area-inset-bottom))}}

.ov-actions{margin-bottom:var(--sp-3)}
.ov-actions:empty{display:none}
.ov-action{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3)}
.ov-action>div{min-width:0}
.ov-action button{flex:0 0 auto;white-space:nowrap}
.ov-pair{margin-bottom:var(--sp-3)}
@media(min-width:1280px){.wrap{max-width:1240px}}
/* Both dashboard rows have to clear the fold on a laptop, which is what this
   grid exists to prevent: at 150px/196px the second row ended 6px low at
   1536x864. Measured in Chrome, not estimated. */
#globe-card .globe-box{height:150px}
/* In the dashboard the globe grows into whatever height the row already has,
   instead of setting that height and pushing the row past the fold. */
.dash #globe-card{display:flex;flex-direction:column;min-height:0}
.globe-split{display:flex;align-items:center;gap:var(--sp-3);flex:1 1 auto;min-height:0;margin-top:var(--sp-2)}
.dash #globe-card .globe-split .globe-box{width:196px;height:140px;flex:0 0 auto;min-height:0;margin:0}
.globe-side{display:flex;flex-direction:column;justify-content:center;align-items:flex-end;gap:4px;min-width:0;flex:1 1 auto;height:140px}
.seg--vert{flex-direction:column;gap:2px;width:92px;max-width:100%;flex:0 0 auto;background:transparent;padding:0}
.seg--vert button{width:100%;min-width:0;min-height:24px;padding:2px 8px;font-size:var(--text-sub);line-height:18px;text-align:center}
.globe-side .globe-pause{width:92px;max-width:100%;margin:0;min-height:26px;padding:2px 8px;font-size:var(--text-sub);background:transparent;border:0;box-shadow:none;color:var(--label-2)}
.globe-side .globe-pause:hover{color:var(--label);background:transparent}
.dash #globe-card>#globe-status{margin:var(--sp-2) 0 0;font-size:11px;line-height:1.3}
.dash #globe-card .globe-box{flex:1 1 0;height:auto;min-height:0}
.dash #globe-card{overflow:hidden}
.dash .trend-box svg{height:130px}
.dash{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sp-3);align-items:stretch;margin-bottom:var(--sp-3)}
.dash>.card,.dash>.ov-actions{margin:0;min-width:0}
.dash>#ov-actions>.health{margin:auto 0}
.dash>#ov-actions .health-row:first-child{border-top:1px solid var(--separator)}
.dash>#ov-actions .health{padding-top:var(--sp-2)}
.dash>.card>#donut-box{margin:auto 0}
.dash>#globe-card .globe-split{margin:auto 0}
.dash #chart-box svg{display:block;width:100%;height:auto}
.dash>.ov-actions{display:flex;flex-direction:column;gap:var(--sp-2)}
.dash>.ov-actions>.card{flex:1 1 auto}
.dash .span2{grid-column:span 2}
.dash .span3{grid-column:span 3}
.dash .trend-box{height:auto}
/* The card shows five rows and scrolls the rest: the server sends the top 20,
   and the height is what five compact rows need, so the list fills the card
   without pushing the row below the fold. */
.dash .rank-box{max-height:206px;overflow:auto}
.dash .rank{gap:10px}
.dash #recent-box{max-height:260px;overflow-y:auto}
@media(max-width:900px){.dash{grid-template-columns:1fr}.dash .span2,.dash .span3{grid-column:auto}}
/* Restored: dbdacd6 dropped this rule but three wrappers still use the class,
   so the settings pairs and the overview pair silently stacked. */
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:stretch}
.kpi{background:var(--card);border-radius:var(--r-lg);padding:var(--sp-3) var(--sp-4);min-height:96px;display:flex;flex-direction:column;justify-content:space-between}
.kpi .value{font-size:34px;line-height:41px;font-weight:700;letter-spacing:-.41px}
.kpi .label{font-size:var(--text-sub);color:var(--label-2)}
.kpi .sub{font-size:var(--text-caption);color:var(--label-3)}
.kpi-spark{display:flex;align-items:flex-end;gap:2px;height:22px;margin:6px 0}
.kpi-spark i{flex:1 1 0;background:color-mix(in srgb,var(--blue) 55%,transparent);border-radius:2px;min-width:2px}
.rank{display:flex;flex-direction:column;gap:var(--sp-3)}
.rank__head{display:flex;justify-content:space-between;gap:var(--sp-3);font-size:var(--text-body)}
.rank__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rank__count{color:var(--label-2);font-variant-numeric:tabular-nums;flex:0 0 auto}
.rank__track{height:6px;border-radius:3px;background:var(--fill);margin-top:6px;overflow:hidden}
.rank__fill{height:100%;border-radius:3px;background:var(--blue)}
@media(max-width:720px){#globe-card .globe-box{height:160px;min-height:0}}
@media(max-width:720px){.ov-controls{flex:1 1 100%;flex-wrap:wrap;justify-content:flex-start}.ov-controls .seg{flex:1 1 100%}.ov-search{flex:1 1 100%;max-width:none}}
@media(max-width:720px){.kpis{gap:10px}.kpi{min-height:86px;padding:12px 14px}.kpi .value{font-size:28px;line-height:32px}.kpi .label{font-size:12px}.kpi .sub{font-size:11px}.kpi-spark{height:16px;margin:4px 0}}
</style></head><body><div class="wrap">
<header><img id="site-logo" src="/logo.png" alt="" style="width:30px;height:30px;border-radius:8px;object-fit:cover;cursor:pointer"><h1 id="site-title" style="cursor:pointer">Secrets Broker</h1><span class="badge">Cloudflare Workers</span>
<div class="hdr-actions">
<button id="theme-cycle" class="theme-cycle" title="切换主题：浅色 / 深色 / 跟随系统">☀️</button>
<button id="ai-help" class="small" title="用 AI 解释当前状态">问 AI</button>
<a class="icon-btn" href="https://github.com/otscup/secrets-broker-workers" target="_blank" rel="noreferrer" title="GitHub"><svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg></a>
<button id="page-refresh" class="small" title="刷新当前页面">刷新</button>
<div class="user-wrap"><span class="user"><span class="who-name" id="who"></span><button id="avatar" class="avatar" title="账户">SB</button></span>
<div id="account-menu" class="account-menu hidden"><button data-view="profile">个人资料</button><button data-view="settings">系统设置</button><button id="account-logout">退出登录</button><button id="lock" class="danger">锁定</button></div></div>
</div>
<nav id="nav"><button data-view="overview" class="active"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 4l8 7.5"/><path d="M6.5 10.5V20h11v-9.5"/></svg><span>概览</span></button><button data-view="items"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3.6"/><path d="M10.6 10.6 20 20"/><path d="M15.6 15.6l2-2"/><path d="M17.8 17.8l2-2"/></svg><span>密钥</span></button><button data-view="devices"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12" rx="1.6"/><path d="M9 20h6"/><path d="M12 16.5V20"/></svg><span>电脑</span></button><button data-view="agents"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.4" r="3"/><path d="M3.5 19c0-2.9 2.5-4.6 5.5-4.6s5.5 1.7 5.5 4.6"/><path d="M16.2 6.6a2.6 2.6 0 0 1 0 5"/><path d="M17.6 14.6c2 .6 3.4 2.2 3.4 4.4"/></svg><span>Agents</span></button><button data-view="grants"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6 5 6.4v5c0 4.3 2.9 7.4 7 8.9 4.1-1.5 7-4.6 7-8.9v-5z"/><path d="M9 12.1l2.1 2.1 4-4.4"/></svg><span>授权</span></button><button data-view="logs"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6.5h11"/><path d="M8.5 12h11"/><path d="M8.5 17.5h11"/><circle cx="4.6" cy="6.5" r="1.1"/><circle cx="4.6" cy="12" r="1.1"/><circle cx="4.6" cy="17.5" r="1.1"/></svg><span>日志</span></button></nav>
</header>

<section id="login-card" class="card hidden">
  <h2>管理登录</h2><div class="hint">管理登录密码（不是 Agent token，也不是 Vault 主密码）。</div>
  <label class="field">管理登录密码</label><input id="admin-password" type="password" autocomplete="current-password">
  <div id="totp-row" class="hidden"><label class="field">两步验证码</label><input id="totp-code" inputmode="numeric" placeholder="6 位验证码"></div>
  <div style="margin-top:12px"><button class="primary" id="login">登录</button></div><div class="status" id="login-status"></div><div id="login-oidc" style="margin-top:10px"></div>
</section>

<section id="unlock-card" class="card hidden">
  <h2>解锁 vault</h2><div class="hint">这是 Vault 主密码：初始化 Vault 时设置的密码，不是 NodeWarden/Bitwarden 登录密码，也不是上面的管理登录密码。主密码只在本机做 PBKDF2/HKDF，服务器只收到派生出的会话密钥。</div>
  <label class="field">Vault 主密码</label><input id="master-password" type="password" autocomplete="current-password">
  <label class="field">解锁有效期</label><select id="ttl"><option value="permanent">永久（可手动锁定）</option><option value="604800">7 天</option><option value="86400">24 小时</option><option value="3600">1 小时</option></select>
  <div class="row" style="margin-top:12px"><button class="primary" id="unlock">解锁</button><button id="lock2">锁定</button></div><div class="status" id="unlock-status"></div>
  <div class="row" style="margin-top:8px"><button id="init-v2">初始化 Vault 2.0（至少 12 位）</button></div>
</section>

<section id="dashboard" class="hidden">
  <section id="view-overview" class="view">
    <div class="ov-head"><div class="ov-titles"><h2 class="ov-title">概览</h2><div class="ov-sub" id="ov-sub"></div><span class="hint" id="updated"></span></div><div class="ov-controls"><div class="seg" id="range-row"><button data-range="24h" class="on">24 小时</button><button data-range="7d">7 天</button><button data-range="30d">30 天</button></div><input id="global-search" class="gs-input ov-search" placeholder="搜索 Agent、密钥、授权、日志…" autocomplete="off" aria-label="全局搜索"></div></div>
    <div id="global-search-results" class="gs-box hidden"></div>
    <div id="notice-bar" class="notice-bar hidden" role="button" tabindex="0" title="点击查看全部通知"></div>
    <div id="kpis" class="kpis"></div>
    <div class="dash">
      <div class="card span2"><div class="card-head"><h2 id="trend-title">读取趋势</h2><div class="trend-nav"><button class="trend-arrow" id="trend-prev" title="上一张" aria-label="上一张">‹</button><span class="trend-count" id="trend-count">1/2</span><button class="trend-arrow" id="trend-next" title="下一张" aria-label="下一张">›</button></div></div><div class="hint" id="trend-hint" style="margin-bottom:6px">按时间聚合 · 悬停查看数值</div><div id="chart-box" class="trend-box"></div><div id="heat-box" class="hidden"></div></div>
      <div class="card"><h2>条目读取排行</h2><div class="hint" style="margin-bottom:6px">按被读取次数排序</div><div id="top-box" class="rank-box"></div></div>
      <div id="ov-actions" class="card ov-actions"></div>
      <div class="card"><h2>Agent 读取占比</h2><div class="hint" style="margin-bottom:6px">按 agent 聚合 · 点击扇区查看</div><div id="donut-box" class="donut-wrap"></div></div>
      <div class="card" id="globe-card">
        <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
          <h2 style="margin:0">Agent Live Globe</h2>
          <span class="hint globe-note" title="IP 估算位置，不代表实际物理位置">IP 估算</span>
        </div>
        <div class="globe-split">
          <div id="globe-box" class="globe-box">
            <button class="small globe-expand" id="globe-full" title="放大地球">⤢</button>
            <div class="globe-empty" id="globe-empty"></div>
          </div>
          <div class="globe-side">
            <div class="seg seg--vert" id="globe-range"><button data-grange="1h">1h</button><button data-grange="24h" class="on">24h</button><button data-grange="7d">7d</button></div>
            <button class="globe-pause" id="globe-pause" title="暂停动画">⏸</button>
          </div>
        </div>
        <div class="hint" id="globe-status"></div>
      </div>
      <div class="card span3"><h2>最近活动</h2><div id="recent-box" class="recent"></div></div>
    <div id="chart-tip" class="chart-tip"></div>
    </div>
  </section>

  <section id="view-items" class="view hidden"><div class="card"><h2>密钥条目</h2><div class="hint">来自 NodeWarden D1（只读）。点条目打开详情，可改类型、明文读取、免审批和分享；勾选多条可批量操作。</div><div class="row" style="margin-top:10px"><input id="item-filter" placeholder="搜索名称、分组或网址…"><select id="item-sort" title="排序方式" style="flex:0 0 auto"><option value="name">按名称</option><option value="activity">按最近活动</option><option value="access">按授权数</option><option value="expiry">按到期时间</option></select><button id="items-refresh">刷新</button><button id="items-select">选择</button><button id="item-create">新增</button><button id="item-import">导入</button><button id="item-export">导出</button><input id="import-file" type="file" accept="application/json,.json" class="hidden"></div><div id="bulk-bar" class="row hidden" style="margin-top:8px;background:var(--btn);padding:8px;border-radius:10px"><span id="bulk-count" class="hint" style="flex:0 0 auto"></span><button id="bulk-share" class="primary">批量分享</button><button id="bulk-kind" title="把选中的凭据标记为 API Key 或网站登录">批量分类</button><button class="danger" id="bulk-delete">批量删除</button><button id="bulk-clear">清除选择</button></div><div id="items-box" class="table-wrap" style="margin-top:10px"></div><div id="item-status" class="status"></div></div>
    <div class="card" id="card-vault2"><div class="row" style="justify-content:space-between;align-items:center"><div><h2 style="margin:0">Vault 2.0</h2><div class="hint" style="margin-top:4px">零知识库放在独立数据库里，和上面这一列密文库互不影响。解锁后这里能读出条目名称，锁上就只剩状态。</div></div><span id="v2-badge" class="kind-tag kind-none" style="flex:0 0 auto">读取中…</span></div><div id="v2-status" class="hint" style="margin-top:10px"></div><div class="row" id="v2-unlock-row" style="margin-top:10px"><input id="v2-password" type="password" placeholder="Vault 2.0 主密码（至少 12 位）"><button id="v2-unlock" class="primary">解锁</button><button id="v2-lock">锁定</button><input id="v2-legacy-password" type="password" placeholder="旧主密码（仅导入用）" autocomplete="off"><button id="v2-import">从旧库导入</button><button id="v2-refresh">刷新</button></div><div class="hint" style="margin-top:8px">已配对的电脑、在线状态和撤销按钮都在「电脑」标签页。</div><div id="v2-box" class="table-wrap scroll-list hidden" style="margin-top:10px"></div><div id="v2-msg" class="status"></div></div>
<div class="card hidden" id="card-fill-policies" aria-hidden="true"><h2>已分类的凭据</h2><div class="hint">点列表里的 ⋮ 打开条目即可逐个设置，或勾选多个后点「批量分类」。标为 <b>api</b>（API Key）可按需允许 Agent 读取明文；标为 <b>web</b>（网站登录）只能被填充到指定网站，Agent 永远拿不到明文。未分类的凭据默认为拒绝读取。</div><div class="hint" id="fp-exec-note" style="margin-top:6px"></div><div id="fp-list" class="table-wrap scroll-list" style="margin-top:10px"></div></div>
    <div class="card" id="card-denied"><h2>被拦下的请求</h2><div class="hint">Agent 试图读取但没通过权限检查的条目。这里只是记录，没有放行任何东西；点「授权」才会真正放开。</div><div id="denied-list" class="table-wrap scroll-list" style="margin-top:10px"></div></div>
    
  </section>

  <section id="view-devices" class="view hidden"><div class="card"><div class="row" style="justify-content:space-between;align-items:center"><div><h2 style="margin:0">电脑</h2><div class="hint" style="margin-top:4px">每台跑过 secrets-broker pair 的机器都在这里。在线状态按最近 5 分钟内的拉取判断；撤销只停止后续拉取，已经拿到的钥匙要重加密才会失效。</div></div><button id="devices-refresh">刷新</button></div><div id="devices-status" class="hint" style="margin-top:10px"></div><div id="v2-devices" class="hidden" style="margin-top:10px"></div><div id="devices-msg" class="status"></div></div><div class="card"><h2>配对新电脑</h2><div class="hint">在另一台机器的终端（PowerShell / CMD，不是浏览器控制台）运行下面这条命令；它会把批准链接、配对码和公钥指纹打印在终端里，然后等待批准。没有全局 secrets-broker 命令时，在仓库根目录把它换成 node cli/index.mjs。</div><div class="secret" id="pair-command" style="margin-top:8px">secrets-broker pair --url …</div><div class="hint" style="margin-top:8px">打开终端给出的链接，核对公钥指纹一致后点批准。配对码五分钟后失效；批准后设备会出现在上面的列表里，可在这里切换只读/可写或撤销。</div></div></section>
  <section id="view-agents" class="view hidden">
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div><h2 style="margin:0">Agents 管理中心</h2><div class="hint" style="margin-top:4px">最近活动依据审计记录计算，不等同于实时在线状态。</div></div>
        <button class="primary" id="agent-new" style="flex:0 0 auto">新建 Agent</button>
      </div>
      <div class="agent-stats" id="agent-stats"></div>
      <div class="row" style="margin-top:12px;gap:8px">
        <input id="agent-search" placeholder="搜索名称、别名、备注…" style="flex:1;min-width:180px">
        <select id="agent-type-filter" style="flex:0 0 auto">
          <option value="">全部类型</option>
          <option value="oauth">OAuth</option>
          <option value="token">Token</option>
        </select>
        <select id="agent-sort" style="flex:0 0 auto">
          <option value="default">默认排序</option>
          <option value="expiry">按到期时间</option>
          <option value="activity">按最近活动</option>
          <option value="name">按名称</option>
          <option value="rights">按可读条数</option>
        </select>
      </div>
      <div id="agents-box" class="scroll-list" style="margin-top:var(--sp-3)"></div>
      <div class="status" id="agent-status"></div>
    </div>
  </section>

  <section id="view-grants" class="view hidden">
    <div class="card" id="transfers-card"><h2>待复制到其他账户</h2><div class="hint">主账户分享后先进入队列；切回目标账户并解锁后自动复制到指定文件夹并生成授权。</div><div id="transfers-box" class="table-wrap scroll-list" style="margin-top:10px"></div></div>
    <div class="card"><h2>待批准请求</h2><div class="hint">点按钮即授权；同 Docker 版的 once/1h/24h/7d/永久。</div><div id="pending-box" class="scroll-list" style="margin-top:10px"></div></div>
    <div class="card"><h2>有效授权</h2><div class="hint">过期的授权会显示「已过期」，点该行的时长即可延期；「选择」可以批量删除或按时长批量恢复。</div><div class="row" style="margin-top:8px"><button id="grants-select">选择</button></div><div id="grants-bulk" class="row hidden" style="margin-top:8px;background:var(--fill);padding:8px;border-radius:10px;flex-wrap:wrap"><span id="grants-bulk-count" class="hint" style="flex:0 0 auto"></span><select id="grants-bulk-seconds" title="恢复后的时长（从现在起算）" style="flex:0 0 auto"><option value="3600">1 小时</option><option value="86400">24 小时</option><option value="604800" selected>7 天</option><option value="2592000">30 天</option><option value="0">永久</option></select><button id="grants-bulk-restore" class="primary">批量恢复</button><button class="danger" id="grants-bulk-delete">批量删除</button><button id="grants-bulk-clear">清除选择</button></div><div id="grants-box" class="scroll-list" style="margin-top:10px"></div></div>
  </section>

  <section id="view-logs" class="view hidden"><div class="card"><h2>审计日志</h2><div class="hint">最近 500 条，数据在 Durable Object 中。</div>
    <div class="row" style="margin-top:12px;gap:8px">
      <select id="logs-item-filter" style="flex:0 0 auto"><option value="">全部条目</option></select>
      <select id="logs-agent-filter" style="flex:0 0 auto"><option value="">全部 Agent</option></select>
      <select id="logs-event-filter" style="flex:0 0 auto"><option value="">全部事件类型</option></select>
      <input id="logs-search" placeholder="搜索事件、Agent、条目、原因…" style="flex:1;min-width:180px">
      <button id="logs-reset" style="flex:0 0 auto">清空筛选</button>
    <button id="logs-export" style="flex:0 0 auto">导出 CSV</button>
    </div>
    <div class="hint" id="logs-count" style="margin-top:8px"></div>
    <div id="logs-box" class="scroll-list" style="margin-top:var(--sp-3)"></div>
  </div></section>

  <section id="view-profile" class="view hidden">
    <div class="card"><h2>个人资料</h2><div class="hint">用于页面显示；OIDC 登录会同步姓名/邮箱/头像。</div>
      <label class="field">名字</label><input id="profile-name" placeholder="你的名字">
      <label class="field">邮箱</label><input id="profile-email" placeholder="you@example.com">
      <label class="field">头像 URL</label><input id="profile-avatar" placeholder="https://...">
      <div class="row" style="margin-top:10px"><button class="primary" id="profile-save">保存资料</button></div><div class="status" id="profile-status"></div>
    </div>
    <div class="card"><h2>登录与账号绑定</h2><div class="hint">OIDC 登录会作为管理登录方式；配置后可直接点下方按钮。</div><div id="oidc-box" style="margin-top:10px"></div><div class="status" id="oidc-status"></div></div>
    <div class="card"><h2>修改密码</h2><div class="hint" id="password-source"></div><label class="field">当前密码</label><input id="current-password" type="password" autocomplete="current-password"><label class="field">新密码（至少 8 位）</label><input id="new-password" type="password" autocomplete="new-password"><div style="margin-top:10px"><button class="primary" id="password-save">修改密码</button></div><div class="status" id="password-status"></div></div>
    <div class="card"><h2>两步验证（TOTP）</h2><div id="totp-status" class="hint"></div><div id="totp-setup-box" class="hidden"><div class="hint">用验证器扫码/手动输入下面的密钥，然后输入 6 位验证码启用。</div><div class="secret" id="totp-secret"></div><label class="field">验证码</label><input id="totp-enable-code" inputmode="numeric" placeholder="6 位验证码"><div style="margin-top:10px"><button class="primary" id="totp-enable">启用两步验证</button></div></div><div class="row" style="margin-top:10px"><button id="totp-setup">生成/重新生成密钥</button><button class="danger hidden" id="totp-disable">关闭两步验证</button></div><div class="status" id="totp-message"></div></div>

    <div class="card"><h2>本地写入白名单</h2><p class="hint">允许「把某个条目写进本地文件」的目标路径，一行一个。以 <code>/</code> 结尾表示整个目录。</p><textarea id="mat-paths" rows="3" placeholder="/srv/app/secrets.env"></textarea><div class="row" style="margin-top:10px"><button class="primary" id="mat-save">保存白名单</button></div><div class="status" id="mat-status"></div></div>
    <div class="card"><h2>行为安全</h2><p class="hint">每一项的默认值都是最保守的答案。单独给某个 Agent 或某个条目配过权限的，以那条配置为准。</p>
      <div class="ios-field"><label>允许读取网页登录的明文<div class="hint">关闭时，网站密码只能被填充进指定站点，任何 Agent 都拿不到明文。</div></label><input type="checkbox" class="ios-switch" id="bs-web"></div>
      <div class="ios-field"><label>允许读取未分类条目的明文<div class="hint">关闭时，没有分类的凭据即使被授权也只返回拒绝。</div></label><input type="checkbox" class="ios-switch" id="bs-unclassified"></div>
      <div class="ios-field"><label>允许 Agent 代调任意主机<div class="hint">关闭时只能调条目里登记过的站点；开启后仍要逐次批准。</div></label><input type="checkbox" class="ios-switch" id="bs-target"></div>
      <div class="row" style="margin-top:10px"><button class="primary" id="bs-save">保存行为设置</button></div>
      <div class="status" id="bs-status"></div>
    </div>
    <div class="card"><h2>在线客户端与登录记录</h2><div class="hint">当前浏览器会话在解锁后保持在线；最近登录来自审计记录。</div><div id="sessions-box" style="margin-top:10px"></div><div id="login-history" style="margin-top:10px"></div></div>
  </section>

  <section id="view-settings" class="view hidden">
    <div class="card"><h2>站点</h2><label class="field">站点名称</label><input id="site-name" placeholder="Secrets Broker"><div class="hint">显示在左上角，点击可回首页。</div></div>
    <div class="card collapsible" id="card-ai"><h2 class="card-toggle" data-collapse="card-ai">AI 助手 <span class="card-caret">▾</span></h2>
      <div class="card-body">
      <div class="hint">用来自动解释「为什么这个 Agent 读不到」「哪条授权过期了」。它只读汇总信息（Agent、条目名、授权状态、日志），<b>永远拿不到密钥值、用户名或 TOTP</b>，也<b>不能修改任何东西</b>——所有修复仍由你在界面上点。</div>
      <label class="chk" style="margin-top:10px"><input type="checkbox" id="ai-enabled"> 启用 AI 助手</label>
      <div id="ai-custom-box">
        <label class="field">接口地址（Base URL）</label><input id="ai-endpoint" placeholder="https://api.openai.com/v1">
        <div class="hint">填到 <code>/v1</code> 即可，会自动加 <code>/chat/completions</code>；也可以直接填完整路径。</div>
        <label class="field">API Key</label><input id="ai-apikey" type="password" placeholder="留空保留原值；填 null 清空">
        <div class="hint" id="ai-key-status"></div>
        <label class="field">模型</label>
        <div class="row" style="gap:6px;margin-top:4px">
          <input id="ai-model" list="ai-model-list" placeholder="点「拉取模型」自动列出" style="flex:1;min-width:0">
          <button class="small" id="ai-model-fetch" style="flex:0 0 auto">拉取模型</button>
        </div>
        <datalist id="ai-model-list"></datalist>
        <div class="hint" id="ai-model-status">先填好地址和 key，点「拉取模型」会向该接口请求 GET /models。</div>
      </div>
      <label class="field">超时（毫秒）</label><input id="ai-timeout" type="number" min="5000" max="60000" value="25000">
      <div class="row" style="margin-top:12px"><button class="primary" id="ai-save">保存 AI 设置</button><button id="ai-test">测试</button></div>
      <div class="status" id="ai-status"></div>
      </div></div>
    <div class="card collapsible collapsed" id="card-notify-channels"><h2 class="card-toggle" data-collapse="card-notify-channels">通知渠道 <span class="card-caret">▸</span></h2><div class="hint">待批准请求会推送到这里。留空的 token 表示保留原值。关掉「启用此渠道」后，自动推送和「发送测试通知」都不会发到这个渠道。</div>
      <div class="card-body">
      <div class="grid2" style="margin-top:10px">
        <div><h2 style="font-size:13px">Telegram</h2><label class="chk"><input type="checkbox" id="tg-enabled"> 启用此渠道</label><label class="field">Bot Token</label><input id="tg-token" type="password" placeholder="留空保留原值"><label class="field">Chat ID</label><input id="tg-chat" placeholder="例如 123456789"><div class="hint" id="tg-status"></div></div>
        <div><h2 style="font-size:13px">ntfy</h2><label class="chk"><input type="checkbox" id="ntfy-enabled"> 启用此渠道</label><label class="field">服务器 URL</label><input id="ntfy-url" placeholder="https://ntfy.example.com"><label class="field">Topic</label><input id="ntfy-topic" placeholder="secrets-broker-xxxx"><div class="hint" id="ntfy-status"></div></div>
        <div><h2 style="font-size:13px">Gotify</h2><label class="chk"><input type="checkbox" id="gotify-enabled"> 启用此渠道</label><label class="field">服务器 URL</label><input id="gotify-url" placeholder="https://gotify.example.com"><label class="field">App Token</label><input id="gotify-token" type="password" placeholder="留空保留原值"><div class="hint" id="gotify-status"></div></div>
        <div><h2 style="font-size:13px">Webhook（通用 / 兼容 wxpush）</h2><label class="chk"><input type="checkbox" id="wxpush-enabled"> 启用此渠道</label><label class="field">URL</label><input id="wxpush-url" placeholder="https://example.com/webhook"><label class="field">Token</label><input id="wxpush-token" type="password" placeholder="留空保留原值"><label class="field">发送格式</label><select id="wxpush-format"><option value="form">表单（wxpush 兼容）</option><option value="json">JSON + Bearer Token</option></select><div class="hint" id="wxpush-status"></div></div>
      </div>
      <div style="margin-top:12px"><button class="primary" id="settings-save">保存通知设置</button><button id="notify-test" style="margin-left:8px">发送测试通知</button><button id="notify-test-approval" style="margin-left:8px">发送模拟授权通知</button></div><div class="status" id="settings-status"></div>
      </div>
    </div>
    <div class="card collapsible collapsed" id="card-notify-templates"><h2 class="card-toggle" data-collapse="card-notify-templates">通知模板 <span class="card-caret">▸</span></h2><div class="hint">四个渠道共用同一套审批模板，改完保存即生效、不用重新部署。占位符：审批用 {agent}、{name}、{time}、{origin}；提醒用 {lines}、{origin}。把某个字段清空并保存，即恢复内置默认文案。微信（wxpush）没有按钮，发送时会自动在正文后附上带签名的批准链接。</div>
      <div class="card-body">
      <h2 style="font-size:13px;margin-top:10px">授权审批通知</h2>
      <label class="field">标题</label><input id="tpl-ap-title">
      <label class="field">正文</label><textarea id="tpl-ap-body" rows="5" style="width:100%"></textarea>
      <div class="grid2">
        <div><label class="field">按钮 · 仅本次</label><input id="tpl-lb-once"></div>
        <div><label class="field">按钮 · 24 小时</label><input id="tpl-lb-24h"></div>
        <div><label class="field">按钮 · 拒绝</label><input id="tpl-lb-deny"></div>
        <div><label class="field">按钮 · 永久</label><input id="tpl-lb-always"></div>
      </div>
      <h2 style="font-size:13px;margin-top:12px">授权到期提醒</h2>
      <label class="field">标题</label><input id="tpl-rm-title">
      <label class="field">正文</label><textarea id="tpl-rm-body" rows="5" style="width:100%"></textarea>
      </div>
    </div>
    <div class="card"><h2>Bitwarden 文件夹</h2><div class="hint">只同步指定文件夹；留空表示全部。文件夹列表来自 NodeWarden folders。</div><div class="row" style="margin-top:8px"><select id="vault-folder" style="flex:1"><option value="">全部文件夹</option></select><button id="vault-folder-save" class="primary">保存文件夹</button></div><div class="hint" id="vault-folder-status" style="margin-top:8px"></div></div>
    <div class="card"><h2>Bitwarden 账户</h2><div class="hint">选择读取哪个 NodeWarden 用户；切换后会清除当前解锁会话，需要用该用户主密码重新解锁。</div><div class="row" style="margin-top:8px"><select id="vault-email" style="flex:1"></select><button id="vault-switch" class="primary">切换账户</button></div><div class="hint" id="vault-email-status" style="margin-top:8px"></div></div>
    <div class="card"><h2>OIDC 登录</h2><div class="hint">可以添加多个身份服务商。配置保存在 Durable Object，不需要重新部署；已保存的 client secret 不会回显，留空表示保留原值。</div>
      <div id="oidc-provider-list" style="margin-top:10px"></div>
      <div style="margin-top:12px"><button id="oidc-new">添加服务商</button></div>
      <div id="oidc-provider-form" class="hidden" style="margin-top:12px">
        <label class="field">ID（唯一，用于绑定和解绑）</label><input id="op-id" placeholder="corp">
        <label class="field">显示名称</label><input id="op-label" placeholder="公司账号">
        <label class="field">Issuer</label><input id="op-issuer" placeholder="https://auth.example.com">
        <label class="field">Client ID</label><input id="op-client-id" placeholder="client_xxx">
        <label class="field">Client Secret（public client 可留空）</label><input id="op-client-secret" type="password" placeholder="留空保留原值">
        <label class="field">Redirect URI</label><input id="op-redirect" placeholder="https://your-worker/oidc/callback">
        <label class="field">Scope</label><input id="op-scope" placeholder="openid profile email">
        <label class="field">Authorization Endpoint（高级，留空自动发现）</label><input id="op-authorization" placeholder="https://auth.example.com/authorize">
        <label class="field">Token Endpoint</label><input id="op-token" placeholder="https://auth.example.com/token">
        <label class="field">Userinfo Endpoint</label><input id="op-userinfo" placeholder="https://auth.example.com/userinfo">
        <label class="field">JWKS URI</label><input id="op-jwks" placeholder="https://auth.example.com/jwks">
        <label class="chk" style="display:block;margin-top:8px"><input type="checkbox" id="op-enabled" checked> 启用这个服务商</label>
        <div style="margin-top:10px"><button id="op-discover">从 Issuer 自动发现并填充</button><button id="op-probe">检测这个服务商</button><button class="primary" id="op-save" style="margin-left:8px">保存</button><button id="op-cancel" style="margin-left:8px">取消</button></div>
        <div class="hint" id="op-status" style="margin-top:8px"></div>
        <div id="op-probe-result" style="margin-top:8px"></div>
      </div>
    </div>
    <div class="card"><h2>浏览器通知</h2><div class="hint" id="browser-notify-status"></div><div class="hint" id="webpush-status"></div><div style="margin-top:10px"><button id="enable-browser-notify">启用浏览器通知</button><button id="test-browser-notify">发送测试通知</button><button id="enable-webpush">启用后台推送</button><button id="test-webpush">测试后台推送</button></div></div>
    <div class="card"><h2>MCP 接入</h2><div class="hint">HTTP MCP 地址（用 Agent Bearer token）：</div><div class="secret" id="mcp-url"></div><div class="hint" style="margin-top:8px">工具：list_secrets / request_access / get_secret。Codex、Hermes 可直接配置 HTTP MCP。</div></div>
  </section>
</section>

</div>
<div id="toast" class="toast"></div>
<section id="item-page" class="page hidden" aria-label="条目详情"><div class="page-nav"><button class="page-back" id="item-page-back" aria-label="返回"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>返回</button><div class="page-title" id="item-page-title"></div><button class="page-action" id="item-page-edit">编辑</button><button class="page-close" id="item-page-close" aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></div><div class="page-body" id="item-page-body"></div></section><div id="modal" class="modal hidden"><div class="card"><button class="modal-x" id="modal-close-x" title="关闭">×</button><h2 id="modal-title"></h2><div id="modal-body"></div><div style="margin-top:12px"><button id="modal-close">关闭</button></div></div></div>
<script>
const $ = (id) => document.getElementById(id)
const enc = new TextEncoder()
// Chunked: spreading a long Uint8Array into fromCharCode throws RangeError.
const b64 = (bytes) => { const view = new Uint8Array(bytes); let binary = ''; for (let offset = 0; offset < view.length; offset += 0x8000) binary += String.fromCharCode.apply(null, view.subarray(offset, offset + 0x8000)); return btoa(binary) }
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const cat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out }
async function hmac(keyBytes, data) { const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', key, data)) }
async function pbkdf2(password, salt, iterations) { const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256)) }
async function hkdf(prk, info, length) { const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const infoBytes = enc.encode(info); const out = new Uint8Array(length); let prev = new Uint8Array(0), offset = 0, counter = 1; while (offset < length) { const input = new Uint8Array(prev.length + infoBytes.length + 1); input.set(prev); input.set(infoBytes, prev.length); input[input.length - 1] = counter; prev = new Uint8Array(await crypto.subtle.sign('HMAC', key, input)); const n = Math.min(prev.length, length - offset); out.set(prev.slice(0, n), offset); offset += n; counter++ } return out }
async function decryptBw(text, encKey, macKey) { const dot = text.indexOf('.'); const type = Number(text.slice(0, dot)); const parts = text.slice(dot + 1).split('|'); const iv = unb64(parts[0]), ct = unb64(parts[1]); if (type === 2) { const expected = await hmac(macKey, cat(iv, ct)); const mac = unb64(parts[2]); if (!expected.every((b, i) => b === mac[i])) throw new Error('MAC 校验失败') } const key = await crypto.subtle.importKey('raw', encKey, { name: 'AES-CBC' }, false, ['decrypt']); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct)) }
// A bare "unauthorized" is useless: it means either the cookie expired or the
// page was loaded from a different host than it posts to, and the fix differs.
// Name which one, and what to do about it.
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    let message = body.error || ('HTTP ' + response.status)
    if (response.status === 401 && message === 'unauthorized') {
      message = '登录状态已失效，或页面域名与接口域名不一致。请重新登录；如果反复出现，确认地址栏是 ' + location.origin + '，而不是别名域名。'
    }
    const error = new Error(message)
    error.status = response.status
    error.data = body
    throw error
  }
  return body
}
let app = { me: null, data: { agents: [], policies: {}, grants: [], pending: [], audit: [] }, items: [], itemsLoaded: false, stats: null, range: '24h', token: '' }
const selectedItems = new Set()
// Selection is an explicit mode: iOS lists do not show checkboxes until you ask
// for them, and showing them all the time squeezed the name column.
let itemsSelecting = false
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const status = (id, text, cls = '') => { const el = $(id); if (el) { el.textContent = text; el.className = 'status ' + cls } }
function show(id, visible) { $(id).classList.toggle('hidden', !visible) }
let toastTimer = null
// confirm() is silently refused inside a sandboxed iframe or a webview without
// allow-modals: the click does nothing at all and the row stays. Ask in the page
// instead - a bar above the tab bar, resolved by whichever button is pressed.
function askYes(message, { yes = '删除', no = '取消' } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div')
    wrap.className = 'ask'
    wrap.innerHTML = '<div class="ask__text"></div><div class="ask__row"><button class="ask__no"></button><button class="ask__yes danger"></button></div>'
    wrap.querySelector('.ask__text').textContent = message
    wrap.querySelector('.ask__no').textContent = no
    wrap.querySelector('.ask__yes').textContent = yes
    const done = (answer) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(answer) }
    const onKey = (event) => { if (event.key === 'Escape') done(false) }
    wrap.querySelector('.ask__no').onclick = () => done(false)
    wrap.querySelector('.ask__yes').onclick = () => done(true)
    document.addEventListener('keydown', onKey)
    document.body.appendChild(wrap)
    wrap.querySelector('.ask__no').focus()
  })
}

function toast(text, error = false) {
  const el = $('toast')
  if (el) {
    el.textContent = text
    el.classList.toggle('error', Boolean(error))
    el.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200)
  }
  const statusEl = $('item-status')
  if (statusEl && !$('view-items').classList.contains('hidden')) status(statusEl.id, text, error ? 'error' : 'ok')
}

function renderAvatar(name, avatarUrl) { const el = $('avatar'); if (!el) return; el.textContent = String(name || 'SB').trim().slice(0, 2).toUpperCase(); // Initials are the default. A picture is only used when the profile names one,
  // so the header never shows the site logo twice.
  const url = avatarUrl; if (!url) return; const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; // Only swap the initials for a picture once one actually decoded: a URL that
  // answers 200 with an empty body would otherwise cover them with nothing.
  img.onload = () => { if (img.naturalWidth > 0) { el.textContent = ''; el.appendChild(img) } }; img.onerror = () => img.remove(); img.src = url }
async function boot() { try { app.me = await api('/api/me'); show('login-card', false); $('who').textContent = app.me.name || String(app.me.email || '').split('@')[0] || ''; $('site-title').textContent = app.me.siteName || 'Secrets Broker'; renderAvatar(app.me.name || app.me.email, app.me.avatarUrl); show('lock', true); if (app.me.unlocked) { show('dashboard', true); show('unlock-card', false); await loadAll(); if (new URLSearchParams(location.search).get('view') === 'profile') { document.querySelectorAll('.view').forEach((section) => section.classList.toggle('hidden', section.id !== 'view-profile')); document.querySelectorAll('#nav button').forEach((button) => button.classList.remove('active')); await loadProfile(); history.replaceState({}, '', '/') } } else { show('dashboard', false); show('unlock-card', true) } } catch { show('login-card', true); show('dashboard', false); show('unlock-card', false); loadOidcLogin() } }
$('page-refresh').onclick = refreshCurrent
$('site-title').onclick = () => { location.href = '/' }
$('site-logo').onclick = () => { location.href = '/' }
async function refreshCurrent() {
  const view = document.querySelector('.view:not(.hidden)')?.id?.replace('view-', '') || 'overview'
  try {
    if (view === 'overview') await Promise.all([loadState(), loadStats()])
    else if (view === 'items') await Promise.all([loadState(), loadItems()])
    else if (view === 'agents' || view === 'grants') await loadState()
    else if (view === 'logs') { await loadState(); renderLogs() }
    else if (view === 'profile') await Promise.all([loadProfile(), loadState()])
    else if (view === 'settings') await loadSettings()
    toast('已刷新')
  } catch (error) { toast(error.message, true) }
}
async function loadOidcLogin() {
  try {
    const data = await api('/api/oidc/status')
    if (!data.enabled) { $('login-oidc').innerHTML = '<span class="hint">未配置 OIDC</span>'; return }
    // One button per provider, so the operator picks the identity to use.
    const providers = data.providers || []
    const buttons = []
    for (const provider of providers) {
      const label = provider.label || provider.id
      buttons.push('<a href="/oidc/login?provider=' + encodeURIComponent(provider.id) + '" style="margin-right:8px"><button class="primary">使用 ' + esc(label) + ' 登录</button></a>')
    }
    $('login-oidc').innerHTML = buttons.join('')
  } catch {}
}
function when(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}
$('mat-save').onclick = async () => {
  try {
    const paths = $('mat-paths').value.split('\n').map((line) => line.trim()).filter(Boolean)
    status('mat-status', '保存中…')
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ materializePaths: paths }) })
    status('mat-status', '已保存 ' + paths.length + ' 条路径', 'ok')
  } catch (error) { status('mat-status', error.message, 'error') }
}
$('bs-save').onclick = async () => {
  try {
    status('bs-status', '保存中…')
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ webPlaintext: $('bs-web').checked, unclassifiedPlaintext: $('bs-unclassified').checked, useAnyTarget: $('bs-target').checked }) })
    status('bs-status', '已保存', 'ok')
  } catch (error) { status('bs-status', error.message, 'error') }
}
$('login').onclick = async () => { try { status('login-status', '登录中…'); await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('admin-password').value, code: $('totp-code').value }) }); $('admin-password').value = ''; $('totp-code').value = ''; show('totp-row', false); await boot() } catch (error) { if (error.status === 401 && error.data?.totpRequired) { show('totp-row', true); status('login-status', error.data.error || '请输入两步验证码', 'error') } else status('login-status', error.message, 'error') } }
$('avatar').onclick = (event) => { event.stopPropagation(); show('account-menu', $('account-menu').classList.contains('hidden')) }
document.addEventListener('click', (event) => { if (!$('account-menu').classList.contains('hidden') && !event.target.closest('#account-menu') && !event.target.closest('#avatar')) show('account-menu', false) })
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke-session]'); if (!button) return
  if (!(await askYes('强制下线这个客户端？'))) return
  try { await api('/api/sessions/revoke', { method: 'POST', body: JSON.stringify({ id: button.dataset.revokeSession }) }); await loadProfile(); toast('已下线') } catch (error) { toast(error.message, true) }
})
$('account-logout').onclick = async () => { try { await api('/api/logout', { method: 'POST' }) } catch {} location.reload() }
document.querySelectorAll('#account-menu [data-view]').forEach((button) => { button.onclick = () => { show('account-menu', false); document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', false)); document.querySelectorAll('.view').forEach((section) => section.classList.toggle('hidden', section.id !== 'view-' + button.dataset.view)); if (button.dataset.view === 'settings') loadSettings(); if (button.dataset.view === 'profile') loadProfile() } })
function applyTheme(mode) { const next = mode || localStorage.getItem('theme') || 'light'; const effective = next === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (next === 'dark' ? 'dark' : 'light'); document.documentElement.dataset.theme = effective; localStorage.setItem('theme', next); const button = $('theme-cycle'); if (button) { button.textContent = next === 'light' ? '☀️' : next === 'dark' ? '🌙' : '💻'; button.title = '当前：' + (next === 'light' ? '浅色' : next === 'dark' ? '深色' : '跟随系统') + '（点击切换）' } }
$('theme-cycle').onclick = () => { const current = localStorage.getItem('theme') || 'auto'; applyTheme(current === 'light' ? 'dark' : current === 'dark' ? 'auto' : 'light') }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((localStorage.getItem('theme') || 'auto') === 'auto') applyTheme('auto') })
applyTheme()
async function unlockV2(password) {
  await api('/api/v2/unlock', { method: 'POST', body: JSON.stringify({ password }) })
  $('master-password').value = ''
  status('unlock-status', '已解锁', 'ok')
  show('unlock-card', false); show('dashboard', true); await loadAll()
}
async function unlockLegacy(password, ttl = 'permanent') {
  const info = await api('/api/bootstrap')
  if (info.kdfType !== 0) throw new Error('这个账户使用 Argon2 KDF（常见于从 NodeWarden/Bitwarden 导入），当前控制台只支持 PBKDF2。')
  const masterKey = await pbkdf2(password, String(info.email).toLowerCase(), info.kdfIterations)
  const encKey = await hkdf(masterKey, 'enc', 32), macKey = await hkdf(masterKey, 'mac', 32)
  const userKey = await decryptBw(info.profileKey, encKey, macKey)
  await api('/api/unlock', { method: 'POST', body: JSON.stringify({ symEncKey: b64(userKey.slice(0, 32)), symMacKey: b64(userKey.slice(32, 64)), ttl }) })
}
$('unlock').onclick = async () => {
  const password = $('master-password').value; if (!password) return
  status('unlock-status', '正在浏览器本地派生密钥…（约 0.3–1 秒）')
  try {
    // Vault 2.0 has its own password envelope. If it is active, unlock it
    // directly instead of requiring the legacy NodeWarden KDF metadata.
    const v2 = await api('/api/v2/status').catch(() => null)
    if (v2?.initialized) return await unlockV2(password)
    await unlockLegacy(password, $('ttl').value)
    $('master-password').value = ''; status('unlock-status', '已解锁', 'ok'); show('unlock-card', false); show('dashboard', true); await loadAll()
  } catch (error) { status('unlock-status', error.message, 'error') }
}
$('init-v2').onclick = async () => {
  const password = $('master-password').value
  if (password.length < 12) return status('unlock-status', '初始化密码至少 12 位', 'error')
  if (!(await askYes('初始化 Vault 2.0？这会新建一套独立的数据密钥；旧 NodeWarden 条目不会自动迁移。'))) return
  try {
    await api('/api/v2/init', { method: 'POST', body: JSON.stringify({ password }) })
    await unlockV2(password)
  } catch (error) { status('unlock-status', error.message, 'error') }
}
api('/api/v2/status').then((v2) => { if (v2.initialized) $('init-v2').classList.add('hidden') }).catch(() => {})
async function lock() {
  const password = prompt('锁定后：当前 vault 会话会被清除，所有 Agent 立即无法读取；再次使用需要用该账户主密码重新解锁。\n\n请输入管理密码确认锁定：')
  if (password === null) return
  try {
    await api('/api/lock', { method: 'POST', body: JSON.stringify({ password }) })
    show('dashboard', false); show('unlock-card', true); status('unlock-status', '已锁定，需要重新解锁才能读取', 'ok')
  } catch (error) { toast(error.message, true) }
}
$('lock').onclick = lock; $('lock2').onclick = lock
document.querySelectorAll('#nav button').forEach((button) => { button.onclick = () => { const view = button.dataset.view; document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b === button)); document.querySelectorAll('.view').forEach((section) => section.classList.toggle('hidden', section.id !== 'view-' + view)); if (view === 'devices') loadVault2(false); if (view === 'settings') loadSettings(); if (view === 'profile') loadProfile() } })
document.querySelectorAll('#range-row button').forEach((button) => { button.onclick = () => { app.range = button.dataset.range; document.querySelectorAll('#range-row button').forEach((b) => b.classList.toggle('on', b === button)); loadStats() } })
// ── Global search ───────────────────────────────────────────────────────────
// One box on the overview searches every source the console already keeps in
// app, so no other page needs its own search field. Groups cap at 8 rows and
// the list at 60, so a one-letter query cannot build thousands of rows.
function globalSearch(query) {
  // '' includes '' would match every row, so the empty guard lives here and not
  // only in the caller. Same for the case fold, so any caller gets one behaviour.
  query = String(query ?? '').trim().toLowerCase()
  if (!query) return []
  const hit = (...values) => values.some((value) => String(value ?? '').toLowerCase().includes(query))
  const groups = []
  const add = (label, view, list) => { if (list.length) groups.push({ label, view, list }) }
  add('Agent', 'agents', (app.data.agents || []).filter((agent) => hit(agent.name, agent.alias, agent.note))
    .map((agent) => ({ title: agentDisplayName(agent), sub: agent.name, name: agent.name })))
  add('密钥', 'items', (app.items || []).filter((item) => hit(item.name, item.group, item.url))
    .map((item) => ({ title: item.name, sub: item.group || item.url || '', name: item.name })))
  add('授权', 'grants', (app.data.grants || []).filter((grant) => hit(agentLabel(grant.agent), grant.agent, grant.name))
    .map((grant) => ({ title: grant.name, sub: agentLabel(grant.agent) })))
  add('待审批', 'grants', (app.data.pending || []).filter((request) => hit(agentLabel(request.agent), request.agent, request.name))
    .map((request) => ({ title: request.name, sub: agentLabel(request.agent) })))
  add('日志', 'logs', (app.data.audit || []).filter((entry) => hit(entry.event, entry.agent, entry.name))
    .map((entry) => ({ title: describeEvent(entry) || entry.event, sub: [agentLabel(entry.agent), entry.name].filter(Boolean).join(' · ') })))
  add('被拦下的请求', 'grants', (app.data.deniedAttempts || []).filter((entry) => hit(entry.agent, entry.name))
    .map((entry) => ({ title: entry.name, sub: agentLabel(entry.agent) + (entry.reason ? ' · ' + entry.reason : '') })))
  return groups
}
function renderGlobalSearch() {
  const box = $('global-search-results')
  if (!box) return
  const input = $('global-search')
  const query = String((input && input.value) || '').trim().toLowerCase()
  if (!query) { box.innerHTML = ''; box.classList.add('hidden'); return }
  const groups = globalSearch(query)
  const html = []
  let left = 60
  for (const group of groups) {
    if (left <= 0) break
    const shown = group.list.slice(0, Math.min(8, left))
    left -= shown.length
    html.push('<div class="gs-group-title">' + esc(group.label) + ' · ' + group.list.length + '</div>')
    for (const row of shown) {
      html.push('<button class="gs-row" data-goto="' + esc(group.view) + '"' + (row.name ? ' data-name="' + esc(row.name) + '"' : '') + '><b>' + esc(row.title) + '</b>' + (row.sub ? ' <span class="gs-sub">' + esc(row.sub) + '</span>' : '') + '</button>')
    }
    if (group.list.length > shown.length) html.push('<div class="gs-more">还有 ' + (group.list.length - shown.length) + ' 条</div>')
  }
  box.innerHTML = html.length ? html.join('') : '<div class="hint">没有找到匹配「' + esc(query) + '」的内容</div>'
  box.classList.remove('hidden')
}
if ($('global-search')) {
  $('global-search').oninput = renderGlobalSearch
  $('global-search').onkeydown = (event) => { if (event.key === 'Escape') { event.target.value = ''; renderGlobalSearch() } }
}
// A row opens the page that owns the hit; the nav click keeps the active tab and
// the hidden-view toggling in one place instead of duplicating it here.
$('global-search-results').addEventListener('click', (event) => {
  const row = event.target.closest('[data-goto]')
  if (!row) return
  const view = row.dataset.goto
  const tab = document.querySelector('#nav [data-view=' + view + ']')
  if (tab) tab.click()
  if ($('item-sort')) $('item-sort').value = localStorage.getItem('sb-item-sort') || 'name'
  if (view === 'items') { const filter = $('item-filter'); if (filter) { filter.value = row.dataset.name || ''; renderItems() } }
  if (view === 'agents') openAgentDetail(row.dataset.name)
})
$('trend-prev').onclick = () => { trendFace = (trendFace + trendFaces.length - 1) % trendFaces.length; renderTrendFace() }
$('trend-next').onclick = () => { trendFace = (trendFace + 1) % trendFaces.length; renderTrendFace() }
$('items-refresh').onclick = loadItems; $('items-select').onclick = () => { itemsSelecting = !itemsSelecting; if (!itemsSelecting) selectedItems.clear(); $('items-select').textContent = itemsSelecting ? '完成' : '选择'; renderItems() }; $('item-filter').oninput = renderItems; $('item-sort').onchange = () => { localStorage.setItem('sb-item-sort', $('item-sort').value); renderItems() }; $('item-create').onclick = createItemMenu; $('item-import').onclick = () => $('import-file').click(); $('import-file').onchange = importItems; $('item-export').onclick = exportItems; $('bulk-share').onclick = openBulkShare; $('bulk-kind').onclick = openBulkKind; $('bulk-delete').onclick = bulkDelete; $('bulk-clear').onclick = () => { selectedItems.clear(); renderItems() }; $('settings-save').onclick = saveSettings; $('ai-save').onclick = saveAiSettings; $('ai-model-fetch').onclick = fetchCustomModels; $('ai-help').onclick = () => openAiHelp();; $('ai-test').onclick = async () => { try { status('ai-status', '测试中…'); const d = await api('/api/ai/ask', { method: 'POST', body: JSON.stringify({ question: '用一个句子说明你能看到什么，并列出当前最需要处理的一件事。' }) }); status('ai-status', d.ok ? ('可用（' + ('自建 API') + '）：' + d.text.slice(0, 120)) : ('不可用：' + (d.error || '')), d.ok ? 'ok' : 'error') } catch (e) { status('ai-status', e.message, 'error') } }; $('notify-test').onclick = testNotifications; $('notify-test-approval').onclick = () => testNotifications(true); $('oidc-new').onclick = () => showOidcProviderForm(); $('op-save').onclick = saveOidcProvider; $('op-cancel').onclick = () => $('oidc-provider-form').classList.add('hidden'); $('op-discover').onclick = discoverOidcProvider; $('op-probe').onclick = probeOidcProvider; $('profile-save').onclick = saveProfile; $('password-save').onclick = changePassword; $('totp-setup').onclick = setup2fa; $('totp-enable').onclick = enable2fa; $('totp-disable').onclick = disable2fa; $('enable-browser-notify').onclick = enableBrowserNotifications; $('enable-webpush').onclick = enableWebPush; $('test-webpush').onclick = testWebPush; $('test-browser-notify').onclick = () => showBrowserNotification('测试通知', '浏览器通知工作正常'); $('vault-switch').onclick = switchAccount; $('vault-folder-save').onclick = saveFolder
$('mcp-url').textContent = location.origin + '/mcp'
$('pair-command').textContent = 'secrets-broker pair --url ' + location.origin
$('v2-refresh').onclick = loadVault2
$('devices-refresh').onclick = () => loadVault2(false)
$('v2-devices').addEventListener('click', async (event) => {
  const write = event.target.closest('[data-v2-write]')
  if (write) {
    const on = write.dataset.write === '1'
    write.disabled = true
    try {
      await api('/api/v2/devices/' + encodeURIComponent(write.dataset.v2Write), { method: 'PATCH', body: JSON.stringify({ canWrite: !on }) })
      await loadVault2(false)
      $('devices-msg').textContent = on ? '已改为只读：这台设备不能再用 push 写入' : '已允许写入：这台设备可以 push 了'
    } catch (error) { $('devices-msg').textContent = error.message; write.disabled = false }
    return
  }
  const purge = event.target.closest('[data-v2-purge]')
  if (purge) {
    const name = purge.closest('[data-device]')?.querySelector('b')?.textContent || ''
    if (!confirm('删除设备「' + name + '」的记录？\n\n只对已撤销的设备可用，删掉后这条记录和它留下的钥匙信封都不再保留，无法恢复。')) return
    purge.disabled = true
    try {
      await api('/api/v2/devices/' + encodeURIComponent(purge.dataset.v2Purge) + '?purge=1', { method: 'DELETE' })
      await loadVault2(false)
      $('devices-msg').textContent = '已删除「' + name + '」的记录'
    } catch (error) { $('devices-msg').textContent = error.message; purge.disabled = false }
    return
  }
  const button = event.target.closest('[data-v2-revoke]')
  if (!button) return
  const name = button.closest('[data-device]')?.querySelector('b')?.textContent || ''
  if (!confirm('撤销设备「' + name + '」？\n\n撤销后它不能再拉取条目；它已经拿到的钥匙，只有跑一次重加密才会失效。')) return
  button.disabled = true
  try {
    await api('/api/v2/devices/' + encodeURIComponent(button.dataset.v2Revoke), { method: 'DELETE' })
    await loadVault2(false)
    $('devices-msg').textContent = '已撤销「' + name + '」'
  } catch (error) { $('devices-msg').textContent = error.message; button.disabled = false }
})
$('v2-unlock').onclick = async () => {
  const password = $('v2-password').value
  const initialising = $('v2-unlock').textContent === '初始化'
  if (!password) { $('v2-msg').textContent = '先输入主密码'; return }
  try {
    await api(initialising ? '/api/v2/init' : '/api/v2/unlock', { method: 'POST', body: JSON.stringify({ password }) })
    $('v2-password').value = ''
    await Promise.all([loadVault2(), loadItems()])
    $('v2-msg').textContent = initialising ? '已初始化并解锁' : '已解锁'
  } catch (error) { $('v2-msg').textContent = error.message }
}
$('v2-lock').onclick = async () => {
  try { await api('/api/v2/lock', { method: 'POST' }); await Promise.all([loadVault2(), loadItems()]) } catch (error) { $('v2-msg').textContent = error.message }
}
$('v2-import').onclick = async () => {
  const oldPassword = $('v2-legacy-password').value
  if (!oldPassword) { $('v2-msg').textContent = '先输入旧密文库的主密码'; return }
  if (!confirm('用旧主密码解锁一次旧密文库，把条目复制一份到 Vault 2.0？原来的密文库不会被动。')) return
  $('v2-msg').textContent = '正在解锁旧密文库并导入…'
  try {
    await unlockLegacy(oldPassword)
    const result = await api('/api/v2/import', { method: 'POST' })
    $('v2-legacy-password').value = ''
    await Promise.all([loadVault2(), loadItems()])
    $('v2-msg').textContent = '导入 ' + result.imported + ' 条，跳过 ' + result.skipped + ' 条（共 ' + result.total + ' 条）'
  } catch (error) { $('v2-msg').textContent = error.message }
}
// Collapsible settings cards. One delegated handler covers every card, so a
// new collapsible card needs no extra wiring.
document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-collapse]')
  if (!toggle) return
  const card = $(toggle.dataset.collapse)
  if (card) card.classList.toggle('collapsed')
})
const copyTokenBtn = $('copy-token'); if (copyTokenBtn) copyTokenBtn.onclick = async () => { try { await navigator.clipboard.writeText(app.token); toast('已复制 token') } catch { toast('复制失败', true) } }
$('modal-close').onclick = () => show('modal', false)
$('modal-body').addEventListener('click', (event) => { const grantEdit = event.target.closest('[data-item-grant]'); if (grantEdit) { openGrantMenu(grantEdit.dataset.agent, grantEdit.dataset.name); } })
$('modal-close-x').onclick = () => show('modal', false)
$('modal').addEventListener('click', (event) => { if (event.target === $('modal')) show('modal', false) })
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('modal').classList.contains('hidden')) show('modal', false) })
// 被拦下的请求 lives in its own card, not inside items-box, so the handler is
// bound to that table. Binding it to items-box was why 授权 and 忽略 did nothing.
$('denied-list').addEventListener('click', async (event) => {
  const allowDenied = event.target.closest('[data-allow-denied]')
  if (allowDenied) { openAllowDenied(allowDenied.dataset.agent, allowDenied.dataset.name, allowDenied.dataset.action); return }
  const allowPlaintext = event.target.closest('[data-allow-plaintext]')
  if (allowPlaintext) {
    const days = Number(allowPlaintext.dataset.days || 1)
    try {
      await api('/api/fill/read-policy', { method: 'POST', body: JSON.stringify({ item: allowPlaintext.dataset.name, allow: true, ttlDays: days }) })
      await refreshAll()
      toast('已允许读取明文 ' + days + ' 天')
    } catch (error) { toast(error.message, true) }
    return
  }
  const allowUse = event.target.closest('[data-allow-use]')
  if (allowUse) { openAllowUse(allowUse.dataset.agent, allowUse.dataset.name); return }
  const dismissDenied = event.target.closest('[data-dismiss-denied]')
  if (dismissDenied) {
    try {
      await api('/api/denied/dismiss', { method: 'POST', body: JSON.stringify({ agent: dismissDenied.dataset.agent, name: dismissDenied.dataset.name, action: dismissDenied.dataset.action }) })
      await refreshAll(); toast('已忽略')
    } catch (error) { toast(error.message, true) }
  }
})
$('items-box').addEventListener('click', async (event) => {
  const grantEdit = event.target.closest('[data-item-grant]'); if (grantEdit) { openGrantMenu(grantEdit.dataset.agent, grantEdit.dataset.name); return } const menu = event.target.closest('[data-item-menu]'); if (menu) { openItemMenu(menu.dataset.itemMenu); return } const toggle = event.target.closest('[data-policy]'); if (toggle) { const item = app.items.find((entry) => entry.name === toggle.dataset.policy); if (!item) return; try { await api('/api/policies', { method: 'POST', body: JSON.stringify({ name: item.name, noApproval: !item.noApproval }) }); await loadItems(); toast('已更新免审批策略') } catch (error) { toast(error.message, true) } return } const read = event.target.closest('[data-read]'); if (read) reveal(read.dataset.read) })
$('agents-box').addEventListener('click', (event) => {
  const extend = event.target.closest('[data-agent-extend]')
  if (extend) { event.stopPropagation(); openExtendMenu(extend.dataset.agentExtend); return }
  const menu = event.target.closest('[data-agent-menu]')
  if (menu) { event.stopPropagation(); openAgentMenu(menu.dataset.agentMenu); return }
  const row = event.target.closest('[data-agent-open]')
  if (row) openAgentDetail(row.dataset.agentOpen)
})
const noticeBar = $('notice-bar')
if (noticeBar) {
  noticeBar.onclick = openNoticeModal
  noticeBar.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openNoticeModal() } }
}
$('agent-new').onclick = openAgentCreate
$('agent-search').oninput = renderAgents
$('agent-type-filter').onchange = renderAgents
$('agent-sort').onchange = renderAgents
// Filters only re-render the log view; the rows are already in app.data.
$('logs-item-filter').onchange = renderLogs
$('logs-agent-filter').onchange = renderLogs
$('logs-event-filter').onchange = renderLogs
$('logs-search').oninput = renderLogs
$('logs-reset').onclick = () => { for (const id of ['logs-item-filter', 'logs-agent-filter', 'logs-event-filter', 'logs-search']) { const el = $(id); if (el) el.value = '' } renderLogs() }
// The server writes the CSV, so the file holds the whole stored trail instead of
// whatever 500 rows happen to be in memory.
const logsExport = $('logs-export'); if (logsExport) logsExport.onclick = () => { location.href = '/api/audit?format=csv' }
// A checkbox list of what actually exists, so the operator picks from real
// item and group names instead of guessing at comma-separated text. Rendered as
// a scrollable box that matches the modal's other fields.
function pickListHtml(id, options, selected, emptyHint) {
  if (!options.length) return '<div class="hint" style="margin:4px 0 8px">' + esc(emptyHint) + '</div>'
  const chosen = new Set(selected || [])
  const boxes = options.map((value) =>
    '<label class="chk pick-row" style="display:flex;width:100%;margin:2px 0"><input type="checkbox" class="' + id + '" value="' + esc(value) + '"' + (chosen.has(value) ? ' checked' : '') + '> ' + esc(value) + '</label>'
  ).join('')
  return '<div id="' + id + '-box" class="pick-box" style="max-height:150px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px 8px;margin:4px 0 8px">' + boxes + '</div>'
}
function pickListValues(id) {
  return [...document.querySelectorAll('.' + id + ':checked')].map((box) => box.value)
}
// The names and groups that exist right now, for the pickers. app.items is only
// populated by the 密钥 page, so an Agent dialog opened first would show an empty
// picker and silently save an empty allow list. Callers await ensureItems().
function knownItemNames() {
  return ((app.items || []).map((item) => item.name)).filter(Boolean).sort((a, b) => a.localeCompare(b))
}
function knownGroups() {
  const groups = new Set()
  for (const item of app.items || []) if (item.group) groups.add(item.group)
  return [...groups].sort((a, b) => a.localeCompare(b))
}
// Fetch the item list once, so a picker never renders from nothing.
async function ensureItems() {
  if ((app.items || []).length) return
  try { const result = await api('/api/items'); app.items = result.items || [] } catch {}
}

// Creation moved into a modal so it no longer pushes the list down.
async function openAgentCreate() {
  await ensureItems()
  openModal('新建 Agent', '<div class="hint">Token 只在创建后显示一次。</div>' +
    '<label class="field">名称</label><input id="ac-name" placeholder="如 dsh">' +
    '<label class="field">显示名（可选）</label><input id="ac-alias" placeholder="便于识别的名字">' +
    '<label class="field">备注（可选）</label><input id="ac-note" placeholder="用途说明">' +
    '<label class="field">可申请条目（勾选，不勾=无权限）</label>' + pickListHtml('ac-allow', knownItemNames(), [], '密钥库里还没有条目，先去「密钥」页新建。') +
    '<label class="field">可申请分组（勾选，不勾=不限）</label>' + pickListHtml('ac-groups', knownGroups(), [], '还没有任何分组。分组在新增条目时填写，或在条目菜单里改。') +
    '<label class="chk" style="margin-top:8px"><input type="checkbox" id="ac-allowall"> 允许全部条目</label>' +
    '<label class="chk" style="margin-top:8px"><input type="checkbox" id="ac-write"> 允许写入（可调 /agent/items/save）</label>' +
    '<div class="row" style="margin-top:14px"><button class="primary" id="ac-create">创建</button></div>' +
    '<div class="status" id="ac-status"></div><div class="secret hidden" id="ac-token"></div>')
  $('ac-create').onclick = async () => {
    const name = $('ac-name').value.trim()
    if (!name) return status('ac-status', '请输入名称', 'error')
    try {
      status('ac-status', '创建中…')
      const allow = pickListValues('ac-allow')
      const groups = pickListValues('ac-groups')
      const result = await api('/api/agents/create', { method: 'POST', body: JSON.stringify({ name, alias: $('ac-alias').value.trim(), note: $('ac-note').value.trim(), allow, groups, allowAll: $('ac-allowall').checked, write: $('ac-write').checked }) })
      $('ac-token').classList.remove('hidden')
      $('ac-token').textContent = result.token
      try { await navigator.clipboard.writeText(result.token); status('ac-status', '已创建，token 已复制到剪贴板', 'ok') } catch { status('ac-status', '已创建，请手动复制 token', 'ok') }
      await refreshAll()
    } catch (error) { status('ac-status', error.message, 'error') }
  }
}
// Detail view: 概况 / 权限 / 授权 / 活动. Read-only display plus the existing actions.
function openAgentDetail(name) {
  const agent = ((app.data && app.data.agents) || []).find((entry) => entry.name === name)
  if (!agent) return
  const last = lastActivityFor(name)
  const health = agentHealth(agent, last)
  const kind = agent.oauth ? 'OAuth Agent' : 'Token Agent'
  const scope = agent.allowAll ? '全部条目' : (agent.allow && agent.allow.length ? agent.allow.join(', ') : (agent.groups && agent.groups.length ? '分组：' + agent.groups.join(', ') : '无权限'))
  const expiry = typeof agent.expiresAt === 'number' ? new Date(agent.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '长期有效'
  const created = agent.createdAt ? new Date(agent.createdAt).toLocaleString('zh-CN', { hour12: false }) : '-'
  const recent = ((app.data && app.data.audit) || []).filter((entry) => entry.agent === name).slice(0, 5)
  const activityRows = recent.length ? recent.map((entry) => '<div class="hint">' + esc(new Date(entry.time).toLocaleString('zh-CN', { hour12: false })) + ' · ' + esc(entry.event || '') + (entry.name ? ' · ' + esc(entry.name) : '') + '</div>').join('') : '<div class="hint">暂无读取记录</div>'
  openModal(agentDisplayName(agent), '<div class="row" style="justify-content:space-between;align-items:center"><div><b>' + esc(agentDisplayName(agent)) + '</b><div class="hint">' + kind + (agentDisplayNote(agent) ? ' · ' + esc(agentDisplayNote(agent)) : '') + '</div></div><span class="agent-health ' + (health.level === 'ok' ? 'ok' : (health.level === 'warn' ? 'warn' : 'bad')) + '">' + esc(health.label) + '</span></div>' +
    '<div class="agent-detail-grid" style="margin-top:14px">' +
    '<div><span>账户</span><b>' + esc(agent.account || '-') + '</b></div>' +
    '<div><span>连接方式</span><b>' + (agent.oauth ? 'OAuth' : 'Token') + '</b></div>' +
    '<div><span>可申请范围</span><b>' + esc(scope) + '</b></div>' +
    '<div><span>写入权限</span><b>' + (agent.write ? '允许' : '不允许') + '</b></div>' +
    '<div><span>授权到期</span><b>' + esc(expiry) + '</b></div>' +
    '<div><span>最近读取记录</span><b>' + esc(relativeTime(last)) + '</b></div>' +
    '<div><span>创建时间</span><b>' + esc(created) + '</b></div>' +
    '</div>' +
    '<div style="margin-top:14px"><b>最近活动</b>' + activityRows + '</div>' +
    '<div class="row" style="margin-top:14px"><button class="primary" id="ad-extend">延长授权</button><button id="ad-edit">编辑配置</button><button id="ad-menu">更多操作</button></div>')
  $('ad-extend').onclick = () => openExtendMenu(name)
  $('ad-edit').onclick = () => openAgentMenu(name)
  $('ad-menu').onclick = () => openAgentMenu(name)
}
async function extendAgent(name, days) {
  try {
    const result = await api('/api/agents/extend', { method: 'POST', body: JSON.stringify({ name, days }) })
    show('modal', false)
    await refreshAll()
    toast(result.permanent ? '已设为永久' : '已延长到 ' + new Date(result.expiresAt).toLocaleString('zh-CN', { hour12: false }))
  } catch (error) { toast(error.message, true) }
}
function openExtendMenu(name) {
  const agent = (app.data.agents || []).find((entry) => entry.name === name)
  if (!agent) return
  const opts = [['1', '1 天'], ['7', '7 天'], ['30', '30 天'], ['90', '90 天'], ['365', '365 天'], ['permanent', '永久']]
  const now = typeof agent.expiresAt === 'number' ? new Date(agent.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '永久'
  openModal('延长授权 · ' + name, '<div class="hint">当前到期：' + now + (agent.oauth ? '（OAuth 连接）' : '') + '</div><div class="hint" style="margin-top:6px">从<strong>现在</strong>起算，重新计时。</div><div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px">' + opts.map(([value, label]) => '<button class="small" data-extend-days="' + value + '">' + label + '</button>').join('') + '</div>')
  document.querySelectorAll('[data-extend-days]').forEach((button) => {
    button.onclick = () => extendAgent(name, button.dataset.extendDays === 'permanent' ? 'permanent' : Number(button.dataset.extendDays))
  })
}
$('kpis').addEventListener('click', (event) => {
  const card = event.target.closest('[data-kpi]'); if (!card) return
  // 待审批 / 通知 is not a view: it opens the sheet that lists every reminder and
  // every waiting approval, each row acting on the thing it names.
  if (card.dataset.kpi === 'pending') { openNoticeModal(); return }
  openKpiModal(card.dataset.kpi)
})
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-kpi-decide]'); if (!button) return
  try { await api('/api/pending/decide', { method: 'POST', body: JSON.stringify({ id: button.dataset.id, decision: button.dataset.decision }) }); show('modal', false); await loadAll(); toast('已处理') } catch (error) { toast(error.message, true) }
})
$('pending-box').addEventListener('click', async (event) => { const button = event.target.closest('[data-decide]'); if (!button) return; try { await api('/api/pending/decide', { method: 'POST', body: JSON.stringify({ id: button.dataset.id, decision: button.dataset.decide }) }); await Promise.all([loadState(), loadStats(), loadItems()]); toast('已处理') } catch (error) { toast(error.message, true) } })
$('grants-box').addEventListener('click', (event) => {
  // While selecting, a tap on a row is a tick. It used to fall through to the
  // grant sheet, which also wiped the selection the user had just made.
  if (grantsSelecting) {
    if (event.target.closest('.grant-select')) return
    const row = event.target.closest('.ios-row')
    const box = row?.querySelector('.grant-select')
    if (!box) return
    box.checked = !box.checked
    box.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }
  const menu = event.target.closest('[data-grant-menu]')
  if (menu) openGrantMenu(menu.dataset.agent, menu.dataset.name)
})
// Bulk actions. 恢复 really restores: the server rebuilds the grant row and its
// read capability, which is what the single-row button always did.
$('grants-select').onclick = () => { grantsSelecting = !grantsSelecting; if (!grantsSelecting) selectedGrants.clear(); renderGrants() }
$('grants-box').addEventListener('change', (event) => {
  const box = event.target.closest('.grant-select')
  if (!box) return
  if (box.checked) selectedGrants.add(box.dataset.key)
  else selectedGrants.delete(box.dataset.key)
  syncGrantsBulk()
})
$('grants-bulk-clear').onclick = () => { selectedGrants.clear(); renderGrants() }
$('grants-bulk-delete').onclick = async () => {
  const keys = selectedGrantList()
  if (!keys.length) return toast('先勾选要删除的授权', true)
  if (!(await askYes('删除选中的 ' + keys.length + ' 条授权？被撤销的也会一起清掉。'))) return
  try {
    const result = await api('/api/grants/batch', { method: 'POST', body: JSON.stringify({ action: 'delete', keys }) })
    selectedGrants.clear(); await refreshAll(); toast('已删除 ' + result.changed + ' 条')
  } catch (error) { toast(error.message, true) }
}
$('grants-bulk-restore').onclick = async () => {
  const keys = selectedGrantList()
  if (!keys.length) return toast('先勾选要恢复的授权', true)
  const pick = $('grants-bulk-seconds')
  const seconds = Number(pick.value)
  if (!(await askYes('把选中的 ' + keys.length + ' 条授权恢复为「' + pick.selectedOptions[0].textContent + '」？读取次数会归零。'))) return
  try {
    const result = await api('/api/grants/batch', { method: 'POST', body: JSON.stringify({ action: 'restore', keys, seconds }) })
    selectedGrants.clear(); await refreshAll()
    toast('已恢复 ' + result.changed + ' 条' + (result.missing?.length ? '，' + result.missing.length + ' 条没找到' : ''))
  } catch (error) { toast(error.message, true) }
}
// "修改" on a classified credential opens that item's own editor.
$('fp-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-fp-edit]')
  if (button && button.dataset.fpEdit) openItemMenu(button.dataset.fpEdit)
})
// In-table actions for a legacy grant with no identity binding. The delete path
// uses /api/grants/delete, which is the same one every other row uses.
$('grants-box').addEventListener('click', async (event) => {
  const regrant = event.target.closest('[data-legacy-regrant]')
  if (regrant) {
    const agent = regrant.dataset.agent || ''
    const name = regrant.dataset.name || ''
    try {
      await api('/api/legacy/regrant', { method: 'POST', body: JSON.stringify({ agent, item: name, action: 'secret.read', duration: '7d' }) })
      toast('已重新授权 ' + name + '（7 天）')
      await refreshAll()
    } catch (error) { toast(error.message || '重新授权失败', true) }
    return
  }
  const remove = event.target.closest('[data-legacy-delete]')
  if (remove) {
    const agent = remove.dataset.agent || ''
    const name = remove.dataset.name || ''
    if (!(await askYes('删除 ' + agent + ' → ' + name + ' 这条旧授权？'))) return
    try {
      await api('/api/grants/delete', { method: 'POST', body: JSON.stringify({ agent, name }) })
      toast('已删除')
      await refreshAll()
    } catch (error) { toast(error.message || '删除失败', true) }
  }
})
async function loadAll() { await refreshAll(); startPendingPolling(); updateBrowserNotifyStatus(); if (/^#\/?(pending|grants)$/.test(location.hash)) { openNoticeModal(); history.replaceState({}, '', '/') } }
let pendingTimer = null
let knownPending = new Set()
let pendingInitialized = false
function updateBrowserNotifyStatus() { const el = $('browser-notify-status'); if (!el) return; el.textContent = typeof Notification === 'undefined' ? '此浏览器不支持通知' : '当前权限：' + Notification.permission }
function showBrowserNotification(title, body, tag) { if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return; try { const notification = new Notification(title, { body, tag }); notification.onclick = () => { window.focus(); document.querySelector('#nav [data-view=grants]').click(); notification.close() } } catch {} }
async function enableBrowserNotifications() { if (typeof Notification === 'undefined') return status('settings-status', '此浏览器不支持通知', 'error'); const permission = await Notification.requestPermission(); updateBrowserNotifyStatus(); if (permission === 'granted') { status('settings-status', '浏览器通知已启用', 'ok'); startPendingPolling() } else status('settings-status', '未获得通知权限', 'error') }
function b64urlBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), (char) => char.charCodeAt(0))
}
async function enableWebPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('此浏览器不支持后台推送')
    const registration = await navigator.serviceWorker.register('/sw.js')
    const permission = await Notification.requestPermission()
    updateBrowserNotifyStatus()
    if (permission !== 'granted') throw new Error('未获得通知权限')
    const { publicKey } = await api('/api/push/vapid')
    const existing = await registration.pushManager.getSubscription()
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlBytes(publicKey),
    })
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) })
    status('webpush-status', '后台推送已启用，关闭页面也能收到审批请求', 'ok')
  } catch (error) { status('webpush-status', error.message, 'error') }
}
async function testWebPush() {
  try {
    const result = await api('/api/push/test', { method: 'POST' })
    status('webpush-status', result.sent ? '已发送 ' + result.sent + ' 条后台推送' : '没有已订阅的浏览器', result.sent ? 'ok' : 'error')
  } catch (error) { status('webpush-status', error.message, 'error') }
}
async function checkPendingNotifications() {
  try {
    const data = await api('/api/state'); const pending = data.pending || []; const ids = new Set(pending.map((entry) => entry.id))
    if (pendingInitialized) {
      for (const entry of pending) if (!knownPending.has(entry.id)) showBrowserNotification('Secrets Broker 授权请求', (entry.agent || 'Agent') + ' 请求读取「' + entry.name + '」', entry.id)
    }
    knownPending = ids; pendingInitialized = true
    if (app.data) {
      // Re-render only what moved: rebuilding the log list every 15s would throw
      // away the operator's scroll position while they read it.
      const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
      const logsMoved = !same((data.audit || []).slice(0, 1), (app.data.audit || []).slice(0, 1)) || (data.audit || []).length !== (app.data.audit || []).length
      const agentsMoved = !same(data.agents, app.data.agents)
      app.data = data
      renderPending()
      if (agentsMoved) renderAgents()
      if (logsMoved) { renderRecent(); renderLogs() }
      if (!grantsSelecting) renderGrants()
    }
    await loadStats()
  } catch {}
}
function startPendingPolling() { updateBrowserNotifyStatus(); if (pendingTimer) return; checkPendingNotifications(); pendingTimer = setInterval(checkPendingNotifications, 15000) }
let globeBooted = false
async function loadState() { try { app.data = await api('/api/state'); renderNoticeBar(); if (!globeBooted) { globeBooted = true; try { initGlobe() } catch {} } renderAgents(); renderPending(); renderGrants(); renderFillPolicies(); renderTransfers(); renderRecent(); renderLogs(); if ((app.items || []).length) renderItems() } catch (error) { if (error.status === 423) { show('dashboard', false); show('unlock-card', true) } } }
async function loadItems() { status('item-status', '加载中…'); try { const result = await api('/api/items'); app.items = result.items || []; app.itemsLoaded = true; renderItems(); renderOverviewActions(); status('item-status', '共 ' + app.items.length + ' 个条目'); if (result.completedTransfers?.length) { toast('已自动复制：' + result.completedTransfers.join('、')); await loadState() } } catch (error) { if (error.status === 423) { show('dashboard', false); show('unlock-card', true) } else status('item-status', error.message, 'error') } }
async function loadStats() { try { app.stats = await api('/api/stats?range=' + app.range); renderStats() } catch {} }
// One operator action changes the logs, the counts and the item rows at once.
// Reloading them together is cheaper than making the operator press 刷新 to
// believe the action worked.
async function refreshAll() { await Promise.all([loadState(), loadItems(), loadStats(), loadVault2()]) }
// The OIDC providers. Each one is edited on its own; the client secret is
// never sent back, so the field starts empty and an empty value keeps the
// stored one.
// A blank form for a new provider. The id is free here, so it can be typed.
function showOidcProviderForm() {
  $('op-id').value = ''
  $('op-id').disabled = false
  $('op-label').value = ''
  $('op-issuer').value = ''
  $('op-client-id').value = ''
  $('op-client-secret').value = ''
  $('op-redirect').value = ''
  $('op-scope').value = 'openid profile email'
  $('op-authorization').value = ''
  $('op-token').value = ''
  $('op-userinfo').value = ''
  $('op-jwks').value = ''
  $('op-enabled').checked = true
  status('op-status', '')
  $('oidc-provider-form').classList.remove('hidden')
}

async function loadOidcProviders() {
  const list = $('oidc-provider-list')
  if (!list) return
  let data = { providers: [] }
  try { data = await api('/api/oidc/providers') } catch (error) { list.innerHTML = '<div class="hint">读取失败：' + esc(error.message) + '</div>'; return }
  const providers = data.providers || []
  if (!providers.length) {
    list.innerHTML = '<div class="hint">还没有配置身份服务商。点下面的「添加服务商」新建一个。</div>'
    return
  }
  const rows = []
  for (const provider of providers) {
    const name = provider.label || provider.id
    rows.push('<div class="row" style="justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)">')
    rows.push('<div><b>' + esc(name) + '</b> <span class="hint">' + esc(provider.id) + '</span><br><span class="hint">' + esc(provider.issuer || '') + (provider.clientId ? ' · ' + esc(provider.clientId) : '') + '</span>')
    if (provider.secretConfigured) rows.push(' <span class="hint">secret 已保存</span>')
    if (provider.enabled === false) rows.push(' <span class="hint">已停用</span>')
    rows.push('</div><div><button data-op-edit="' + esc(provider.id) + '">编辑</button><button data-op-del="' + esc(provider.id) + '" class="danger">删除</button></div>')
    rows.push('</div>')
  }
  list.innerHTML = rows.join('')
  for (const button of list.querySelectorAll('[data-op-edit]')) button.onclick = () => openOidcProvider(button.getAttribute('data-op-edit'), providers)
  for (const button of list.querySelectorAll('[data-op-del]')) button.onclick = () => deleteOidcProvider(button.getAttribute('data-op-del'))
}
function openOidcProvider(id, providers) {
  const provider = providers.find((entry) => entry.id === id) || { id: '', label: '' }
  $('op-id').value = provider.id || ''
  $('op-id').disabled = Boolean(provider.id)
  $('op-label').value = provider.label || ''
  $('op-issuer').value = provider.issuer || ''
  $('op-client-id').value = provider.clientId || ''
  $('op-client-secret').value = ''
  $('op-redirect').value = provider.redirectUri || ''
  $('op-scope').value = provider.scope || ''
  $('op-authorization').value = provider.authorizationEndpoint || ''
  $('op-token').value = provider.tokenEndpoint || ''
  $('op-userinfo').value = provider.userinfoEndpoint || ''
  $('op-jwks').value = provider.jwksUri || ''
  $('op-enabled').checked = provider.enabled !== false
  $('op-status').textContent = provider.secretConfigured ? '这个服务商已保存 client secret，留空表示保留原值。' : ''
  $('oidc-provider-form').classList.remove('hidden')
}
async function saveOidcProvider() {
  const id = $('op-id').value.trim()
  if (!id) { status('op-status', 'ID 必填', 'error'); return }
  const body = {
    id, label: $('op-label').value.trim(),
    issuer: $('op-issuer').value.trim(),
    clientId: $('op-client-id').value.trim(),
    clientSecret: $('op-client-secret').value,
    redirectUri: $('op-redirect').value.trim(),
    scope: $('op-scope').value.trim(),
    authorizationEndpoint: $('op-authorization').value.trim(),
    tokenEndpoint: $('op-token').value.trim(),
    userinfoEndpoint: $('op-userinfo').value.trim(),
    jwksUri: $('op-jwks').value.trim(),
    enabled: $('op-enabled').checked,
  }
  try {
    await api('/api/oidc/providers', { method: 'POST', body: JSON.stringify(body) })
    $('op-client-secret').value = ''
    $('oidc-provider-form').classList.add('hidden')
    await loadOidcProviders()
    status('op-status', '已保存', 'ok')
  } catch (error) { status('op-status', error.message, 'error') }
}
async function deleteOidcProvider(id) {
  if (!(await askYes('删除这个身份服务商？已绑定的账号也会一并解绑。'))) return
  try {
    await api('/api/oidc/providers', { method: 'DELETE', body: JSON.stringify({ id }) })
    await loadOidcProviders()
    toast('已删除')
  } catch (error) { toast(error.message, true) }
}
async function discoverOidcProvider() {
  const issuer = $('op-issuer').value.trim()
  if (!issuer) { status('op-status', '请先填 Issuer', 'error'); return }
  try {
    const data = await api('/api/oidc/discover?issuer=' + encodeURIComponent(issuer))
    if (data.authorizationEndpoint) $('op-authorization').value = data.authorizationEndpoint
    if (data.tokenEndpoint) $('op-token').value = data.tokenEndpoint
    if (data.userinfoEndpoint) $('op-userinfo').value = data.userinfoEndpoint
    if (data.jwksUri) $('op-jwks').value = data.jwksUri
    if (data.scope) $('op-scope').value = data.scope
    status('op-status', '已自动填充，保存后生效', 'ok')
  } catch (error) { status('op-status', error.message, 'error') }
}

// Probe a saved provider: discovery, its advertised id_token algorithms, and
// whether the authorization endpoint actually recognises this client id. A
// mis-registered client used to surface only as an error page at the provider.
async function probeOidcProvider() {
  const box = $('op-probe-result')
  if (!box) return
  const id = $('op-id').value.trim()
  if (!id) { status('op-status', '先填写并保存 ID，再检测', 'error'); return }
  box.innerHTML = '<div class="hint">检测中…</div>'
  try {
    const report = await api('/api/oidc/probe?provider=' + encodeURIComponent(id))
    const lines = []
    lines.push('<div class="hint">issuer：<code>' + esc(report.issuer) + '</code></div>')
    lines.push('<div class="hint">client id：<code>' + esc(report.clientId) + '</code></div>')
    lines.push('<div class="hint">redirect：<code>' + esc(report.redirectUri) + '</code></div>')
    lines.push('<div class="hint">client secret：' + (report.hasSecret ? '已保存' : '未配置（public client 可留空）') + '</div>')
    if (report.signingAlgs) lines.push('<div class="hint">id_token 签名算法：' + esc((report.signingAlgs || []).join(', ') || '未声明') + '</div>')
    if (report.problems && report.problems.length) {
      for (const problem of report.problems) {
        lines.push('<div class="hint" style="color:var(--danger)">✗ ' + esc(problem) + '</div>')
      }
    } else {
      lines.push('<div class="hint" style="color:var(--ok)">✓ 端点、client id 和签名算法都可用</div>')
    }
    box.innerHTML = lines.join('')
  } catch (error) {
    box.innerHTML = '<div class="hint" style="color:var(--danger)">检测失败：' + esc(error.message) + '</div>'
  }
}

async function loadSettings() {
  try {
    const data = await api('/api/settings'); const n = data.notifications || {}
    $('webpush-status').textContent = n.webpush?.subscriptions ? '已订阅 ' + n.webpush.subscriptions + ' 个浏览器后台推送' : '后台推送未启用'
    $('tg-chat').value = n.telegram?.chatId || ''
    $('tg-status').textContent = n.telegram?.configured ? '已配置（token 已保存）' : '未配置'
    $('ntfy-url').value = n.ntfy?.url || ''; $('ntfy-topic').value = n.ntfy?.topic || ''
    $('ntfy-status').textContent = n.ntfy?.configured ? '已配置' : '未配置'
    $('gotify-url').value = n.gotify?.url || ''
    $('gotify-status').textContent = n.gotify?.configured ? '已配置（token 已保存）' : '未配置'
    $('wxpush-url').value = n.wxpush?.url || ''; $('wxpush-format').value = n.wxpush?.format || 'form'
    $('wxpush-status').textContent = n.wxpush?.configured ? '已配置（token 已保存）' : '未配置'
    $('tg-enabled').checked = n.telegram?.enabled !== false; $('ntfy-enabled').checked = n.ntfy?.enabled !== false
    $('gotify-enabled').checked = n.gotify?.enabled !== false; $('wxpush-enabled').checked = n.wxpush?.enabled !== false
    const tpl = n.templates || {}; const tplAp = tpl.approval || {}; const tplLb = tplAp.labels || {}; const tplRm = tpl.reminder || {}
    $('tpl-ap-title').value = tplAp.title || ''; $('tpl-ap-body').value = tplAp.body || ''
    $('tpl-lb-once').value = tplLb.once || ''; $('tpl-lb-24h').value = tplLb['24h'] || ''; $('tpl-lb-deny').value = tplLb.deny || ''; $('tpl-lb-always').value = tplLb.always || ''
    $('tpl-rm-title').value = tplRm.title || ''; $('tpl-rm-body').value = tplRm.body || ''
    await loadOidcProviders()
    $('mcp-url').textContent = location.origin + '/mcp'
    $('vault-folder').value = data.vaultFolder || ''
    $('site-name').value = data.siteName || 'Secrets Broker'
    renderAiSettings(data.ai)
    try { const folders = (await api('/api/folders')).folders || []; $('vault-folder').innerHTML = '<option value="">全部文件夹</option>' + folders.map((folder) => '<option value="' + esc(folder.name) + '">' + esc(folder.name) + '</option>').join(''); $('vault-folder').value = data.vaultFolder || ''; $('vault-folder-status').textContent = data.vaultFolder ? '当前只读取：' + data.vaultFolder : '当前读取全部文件夹' } catch { $('vault-folder-status').textContent = '需要先解锁 vault 才能读取文件夹' }
    try { const accounts = (await api('/api/accounts')).accounts || []; $('vault-email').innerHTML = accounts.map((account) => '<option value="' + esc(account.email) + '">' + esc(account.email) + '</option>').join(''); $('vault-email').value = data.vaultEmail || accounts[0]?.email || ''; $('vault-email-status').textContent = '当前账户：' + ($('vault-email').value || '-') } catch { $('vault-email-status').textContent = '无法读取账户列表' }
  } catch (error) { status('settings-status', error.message, 'error') }
}
async function saveSettings() {
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ notifications: {
      telegram: { enabled: $('tg-enabled').checked, botToken: $('tg-token').value, chatId: $('tg-chat').value },
      ntfy: { enabled: $('ntfy-enabled').checked, url: $('ntfy-url').value, topic: $('ntfy-topic').value },
      gotify: { enabled: $('gotify-enabled').checked, url: $('gotify-url').value, token: $('gotify-token').value },
      wxpush: { enabled: $('wxpush-enabled').checked, url: $('wxpush-url').value, token: $('wxpush-token').value, format: $('wxpush-format').value },
      templates: {
        approval: { title: $('tpl-ap-title').value, body: $('tpl-ap-body').value, labels: { once: $('tpl-lb-once').value, '24h': $('tpl-lb-24h').value, deny: $('tpl-lb-deny').value, always: $('tpl-lb-always').value } },
        reminder: { title: $('tpl-rm-title').value, body: $('tpl-rm-body').value },
      },
  }, vaultFolder: $('vault-folder').value, siteName: $('site-name').value, vaultEmail: $('vault-email').value }) })
    $('site-title').textContent = $('site-name').value.trim() || 'Secrets Broker'
    status('settings-status', '已保存', 'ok'); await loadSettings()
  } catch (error) { status('settings-status', error.message, 'error') }
}
// AI settings live on the same endpoint but save separately, so retyping a model
// name cannot silently reset a notification template.
async function saveAiSettings() {
  try {
    status('ai-status', '保存中…')
    const key = $('ai-apikey').value.trim()
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ ai: {
      enabled: $('ai-enabled').checked,
      endpoint: $('ai-endpoint').value.trim(),
      model: $('ai-model').value.trim(),
      // The dropdown wins unless the free-text box has content, so a model that
      // is not in the catalogue can still be used.
      timeoutMs: Number($('ai-timeout').value) || 25000,
      // A blank field keeps the stored key; only a typed value replaces it.
      ...(key ? { apiKey: key } : {}),
    } }) })
    $('ai-apikey').value = ''
    status('ai-status', '已保存', 'ok')
    await loadSettings()
  } catch (error) { status('ai-status', error.message, 'error') }
}
function renderAiSettings(ai) {
  if (!ai) return
  $('ai-enabled').checked = ai.enabled !== false
  $('ai-endpoint').value = ai.endpoint || ''
  $('ai-model').value = ai.model || ''
  $('ai-timeout').value = ai.timeoutMs || 25000
  $('ai-key-status').textContent = ai.hasApiKey ? '已保存一个 key（留空则沿用）' : '还没有 key'
}
// Fetch the custom endpoint's own model list into the datalist, so the field
// suggests real ids instead of making the operator spell them.
async function fetchCustomModels() {
  try {
    status('ai-model-status', '拉取中…')
    // Send whatever is typed so it works before saving.
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ ai: {
      endpoint: $('ai-endpoint').value.trim(),
      ...($('ai-apikey').value.trim() ? { apiKey: $('ai-apikey').value.trim() } : {}),
    } }) }).catch(() => {})
    const data = await api('/api/ai/models?fetch=1')
    const list = $('ai-model-list')
    list.innerHTML = (data.custom.models || []).map((id) => '<option value="' + esc(id) + '"></option>').join('')
    if (data.custom.ok) {
      status('ai-model-status', '拉到 ' + data.custom.models.length + ' 个模型，点输入框可以看到列表', 'ok')
      if (!$('ai-model').value && data.custom.models.length) $('ai-model').value = data.custom.models[0]
    } else {
      status('ai-model-status', '拉取失败：' + (data.custom.reason || '未知原因'), 'error')
    }
  } catch (error) { status('ai-model-status', error.message, 'error') }
}
// The one place the console talks to the model. Read-only by construction: the
// broker only exposes /api/ai/ask, which answers questions and changes nothing.
// The assistant as a side panel, not a modal: you keep working behind it, which
// is the whole point of asking "why did that fail" while fixing it.
//
// Memory has two modes and the operator picks. Session mode keeps the thread in
// sessionStorage, so it survives a page reload but not a new login; durable mode
// asks the server to keep it. The panel never closes itself — not on a page
// action, not on a poll — so a half-written question is never lost.
const AI_THREAD_KEY = 'sb-ai-thread'
const AI_THREAD_PERSIST_KEY = 'sb-ai-thread-persist'

function aiThreadLoad() {
  try {
    const raw = sessionStorage.getItem(AI_THREAD_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
function aiThreadSave(history) {
  try { sessionStorage.setItem(AI_THREAD_KEY, JSON.stringify(history.slice(-20))) } catch {}
}
function aiThreadClear() {
  try { sessionStorage.removeItem(AI_THREAD_KEY) } catch {}
}

function openAiHelp(preset) {
  // Reuse the panel if it is already open, so clicking 问 AI again does not
  // discard the conversation.
  const existing = $('ai-panel')
  if (existing) {
    if (preset) { $('ai-question').value = preset; $('ai-question').focus() }
    return
  }
  const panel = document.createElement('aside')
  panel.id = 'ai-panel'
  panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:min(420px,100vw);z-index:40;background:var(--card,#fff);border-left:1px solid var(--line);box-shadow:-8px 0 30px rgba(15,23,42,.12);display:flex;flex-direction:column;padding:14px'
  panel.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
    + '<b style="flex:1;font-size:13.5px">问 AI</b>'
    + '<button class="small" id="ai-clear" title="清空对话">清空</button>'
    + '<button class="small" id="ai-panel-close" title="收起（对话会保留）">收起</button>'
    + '</div>'
    + '<div class="hint" style="margin-bottom:8px">只读：能看到 Agent、条目名、授权和日志，拿不到密钥值，也不能修改东西。可以在后面继续操作网页，面板不会自己收起。</div>'
    + '<div id="ai-chat" class="scroll-list" style="flex:1;min-height:0;overflow:auto;scrollbar-width:none;margin-bottom:8px"></div>'
    + '<input id="ai-question" placeholder="例如：为什么 Muse 读不到 tavily-api-key？" value="' + esc(preset || '') + '">'
    + '<div class="row" style="margin-top:8px;gap:6px"><button class="primary" id="ai-ask" style="flex:1">发送</button><button id="ai-insights">待处理项</button></div>'
    + '<div class="hint" id="ai-chat-status" style="min-height:16px;margin-top:6px"></div>'
  document.body.appendChild(panel)
  const chat = $('ai-chat')
  let history = aiThreadLoad()

  const bubble = (role, text) => {
    const node = document.createElement('div')
    node.style.cssText = 'border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:6px 0;font-size:12.5px;white-space:pre-wrap'
    node.style.background = role === 'user' ? 'var(--btn)' : 'transparent'
    node.textContent = (role === 'user' ? '你：' : 'AI：') + text
    chat.appendChild(node)
    chat.scrollTop = chat.scrollHeight
  }
  // Redraw what was remembered, so reopening or reloading does not lose it.
  for (const turn of history) if (turn.content) bubble(turn.role === 'user' ? 'user' : 'ai', turn.content)
  if (!history.length) bubble('ai', '可以问我：哪条授权过期了、为什么某个 Agent 读不到、需要先修什么。')

  const renderInsights = (insights) => {
    if (!insights || !insights.length) return
    for (const item of insights) {
      const node = document.createElement('div')
      node.style.cssText = 'border-left:3px solid ' + (item.level === 'warn' ? 'var(--warn,#f2994a)' : 'var(--ok,#0f9d8a)') + ';padding:4px 8px;margin:6px 0;font-size:12px'
      node.textContent = item.text
      chat.appendChild(node)
    }
    chat.scrollTop = chat.scrollHeight
  }

  $('ai-panel-close').onclick = () => { panel.remove() }
  $('ai-clear').onclick = () => { history = []; aiThreadClear(); chat.innerHTML = ''; bubble('ai', '已清空。') }
  $('ai-insights').onclick = async () => {
    try {
      const data = await api('/api/ai/insights')
      chat.innerHTML = ''
      renderInsights(data.insights)
      if (!(data.insights || []).length) chat.textContent = '没有发现需要处理的项。'
    } catch (error) { status('ai-chat-status', error.message, 'error') }
  }
  const ask = async () => {
    const question = $('ai-question').value.trim()
    if (!question) return status('ai-chat-status', '先写一个问题', 'error')
    bubble('user', question)
    $('ai-question').value = ''
    status('ai-chat-status', '思考中…')
    try {
      const data = await api('/api/ai/ask', { method: 'POST', body: JSON.stringify({ question, history: history.slice(-6) }) })
      if (!data.ok) {
        bubble('ai', '暂时回答不了：' + (data.error || '未知原因'))
        status('ai-chat-status', '')
        renderInsights(data.insights)
        return
      }
      bubble('ai', data.text)
      history.push({ role: 'user', content: question }, { role: 'assistant', content: data.text })
      aiThreadSave(history)
      status('ai-chat-status', '由 ' + (data.provider === 'workers-ai' ? 'Workers AI' : '自建 API') + ' 回答')
    } catch (error) { status('ai-chat-status', error.message, 'error') }
  }
  $('ai-ask').onclick = ask
  $('ai-question').addEventListener('keydown', (event) => { if (event.key === 'Enter') ask() })
  $('ai-question').focus()
}
async function testNotifications(simulate = false) {
  try {
    status('settings-status', simulate ? '发送模拟授权通知…' : '发送中…')
    const result = await api('/api/notify/test', { method: 'POST', body: JSON.stringify({ simulateApproval: simulate }) })
    status('settings-status', simulate ? '已发送模拟授权，检查 Telegram/ntfy 里的按钮' : '测试结果：' + JSON.stringify(result.results), 'ok')
    if (simulate) await loadState()
  } catch (error) { status('settings-status', error.message, 'error') }
}
function openKpiModal(kind) {
  const audit = app.data.audit || []
  if (kind === 'reads') {
    const reads = audit.filter((entry) => entry.event === 'secret.read').slice(0, 30)
    openModal('最近读取记录', reads.length ? '<div class="hint">当前加载的最近 ' + reads.length + ' 条读取记录</div><table><tr><th>时间</th><th>Agent</th><th>条目</th><th>方式</th></tr>' + reads.map((entry) => '<tr><td>' + esc(entry.time ? new Date(entry.time).toLocaleString('zh-CN', { hour12: false }) : '') + '</td><td>' + esc(agentLabel(entry.agent)) + '</td><td><code>' + esc(entry.name) + '</code></td><td>' + esc(entry.mode || entry.channel || '') + '</td></tr>').join('') + '</table>' : '<div class="hint">暂无读取记录</div>')
  } else if (kind === 'agents') {
    const counts = {}; for (const entry of audit) if (entry.event === 'secret.read' && entry.agent) counts[entry.agent] = (counts[entry.agent] || 0) + 1
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
    openModal('活跃 Agent', rows.length ? '<table><tr><th>Agent</th><th>读取次数</th></tr>' + rows.map(([name, count]) => '<tr><td>' + esc(agentLabel(name)) + '</td><td>' + count + '</td></tr>').join('') + '</table>' : '<div class="hint">暂无活跃 Agent</div>')
  } else if (kind === 'grants') {
    const now = Date.now(); const active = (app.data.grants || []).filter((grant) => !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now) && (!grant.maxReads || (grant.reads ?? 0) < grant.maxReads))
    openModal('有效授权', active.length ? '<table><tr><th>Agent</th><th>条目</th><th>到期</th><th>读取</th></tr>' + active.map((grant) => '<tr><td>' + esc(agentLabel(grant.agent)) + '</td><td><code>' + esc(grant.name) + '</code></td><td>' + (grant.expiresAt ? new Date(grant.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '永久') + '</td><td>' + (grant.reads ?? 0) + '/' + (grant.maxReads || '∞') + '</td></tr>').join('') + '</table>' : '<div class="hint">暂无有效授权</div>')
  } else {
    const pending = app.data.pending || []
    openModal('待审批 / 通知', pending.length ? pending.map((entry) => '<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px">'
      + pendingDetailHtml(entry)
      + '<div class="row" style="margin-top:8px"><button class="small primary" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="once">仅本次</button><button class="small" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="24h">24 小时</button><button class="small" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="always">永久</button><button class="small danger" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="deny">拒绝</button></div></div>').join('') : '<div class="hint">暂无待审批请求</div>')
  }
}
let legendPage = 0
const LEGEND_PER_PAGE = 8
/* The first screen answers one question: does anything need me right now? */
function renderOverviewActions() {
  const box = $('ov-actions'); if (!box) return
  const sub = $('ov-sub')
  if (sub) {
    const me = app.me || {}
    const bits = [me.email || '', me.unlocked ? '已解锁' : '未解锁', (app.items || []).length + ' 条密钥', ((app.data && app.data.agents) || []).length + ' 个 Agent']
    sub.textContent = bits.filter(Boolean).join(' · ')
  }
  box.innerHTML = '<h2>密钥健康</h2>' + healthRowsHtml()
  box.querySelectorAll('[data-health]').forEach((button) => {
    button.onclick = () => {
      const list = button.parentElement.querySelector('.health-list')
      if (!list) return
      const open = list.classList.toggle('hidden') === false
      button.setAttribute('aria-expanded', String(open))
      button.classList.toggle('open', open)
    }
  })
  box.querySelectorAll('[data-item-menu]').forEach((button) => { button.onclick = () => openItemMenu(button.dataset.itemMenu) })
}

// What the vault holds, as opposed to how often it was read: how many
// credentials an agent can hand over in plaintext, how many are unclassified,
// how many are about to stop working. Read counts already have a trend, a
// ranking and a donut; this is the dimension nobody could see.
function healthRowsHtml() {
  // Before /api/items answers there are no items to count, and every row would
  // read 0 with its all-clear hint ("都分类了", "全部需要批准") — a security card
  // claiming everything is fine because it has not looked yet.
  if (!app.itemsLoaded) return '<div class="hint">正在读取密钥…</div>'
  const items = app.items || []
  const data = app.data || {}
  const now = Date.now()
  const kinds = ((data.fillPolicies && data.fillPolicies.items) || []).reduce((map, entry) => {
    if (entry && entry.itemId) map[entry.itemId] = entry.kind || ''
    return map
  }, {})
  const policies = data.policies || {}
  // "可直接读取" means an Agent holds a live read grant for it, not "this is an
  // api credential". Counting the classification said 8 while 22 items were
  // readable, because a grant is what lets a value out.
  const readableIds = new Set()
  for (const action of (data.agentActions || [])) {
    if (action.action !== 'secret.read') continue
    if (action.expiresAt && action.expiresAt <= now) continue
    if (action.usesLeft === 0) continue
    if (action.itemId) readableIds.add(action.itemId)
  }
  for (const entry of ((data.fillPolicies && data.fillPolicies.items) || [])) {
    if (entry && entry.itemId && entry.plaintextRead) readableIds.add(entry.itemId)
  }
  let web = 0, api = 0, none = 0, noApproval = 0, soon = 0, past = 0
  for (const item of items) {
    const kind = kinds[item.id] || ''
    if (kind === 'web') web += 1
    else if (kind === 'api') api += 1
    else none += 1
    if ((policies[item.name] && policies[item.name].noApproval) || item.noApproval) noApproval += 1
    // expiresAt is a number, 0 means "no expiry"; Date.parse on a number is NaN.
    if (item.expiresAt > now) { if (item.expiresAt - now < 7 * 86400e3) soon += 1 }
    else if (item.expiresAt > 0) past += 1
  }
  const total = items.length || 1
  const bucketsOf = { readable: [], web: [], none: [], noApproval: [], expiry: [] }
  for (const item of items) {
    const kind = kinds[item.id] || ''
    if (readableIds.has(item.id)) bucketsOf.readable.push(item)
    // An API key was falling into 未分类 with everything unclassified, so the
    // expanded list disagreed with the counter above it.
    if (kind === 'web') bucketsOf.web.push(item)
    else if (kind !== 'api') bucketsOf.none.push(item)
    if ((policies[item.name] && policies[item.name].noApproval) || item.noApproval) bucketsOf.noApproval.push(item)
    if (item.expiresAt > now && item.expiresAt - now < 7 * 86400e3) bucketsOf.expiry.push(item)
  }
  // A row is a summary you can open: the credentials behind the number are one
  // tap away, in place, so checking "which ones are unclassified" does not throw
  // away the dashboard to go and look.
  const row = (key, label, value, hint, tone) => '<div class="health-item">'
    + '<button class="health-row" data-health="' + key + '" aria-expanded="false">'
    + '<span class="health-bar"><i style="width:' + Math.round((value / total) * 100) + '%" data-tone="' + tone + '"></i></span>'
    + '<span class="health-label">' + label + '</span>'
    + '<span class="health-value">' + value + '</span>'
    + '<span class="health-hint">' + hint + '</span>'
    + (value ? '<span class="health-chev">›</span>' : '')
    + '</button>'
    + (value ? '<div class="health-list hidden">' + bucketsOf[key].slice(0, 8).map((item) => '<button class="health-cred" data-item-menu="' + esc(item.name) + '">'
      + '<b>' + esc(item.name) + '</b><span>' + esc(item.group || '') + '</span></button>').join('')
      + (bucketsOf[key].length > 8 ? '<div class="health-more">还有 ' + (bucketsOf[key].length - 8) + ' 条</div>' : '')
      + '</div>' : '')
    + '</div>'
  return '<div class="health">'
    + row('readable', '可直接读取明文', bucketsOf.readable.length, bucketsOf.readable.length ? '有读取授权的条目，含免审批' : '没有任何读取授权', 'blue')
    + row('web', '只能填充', web, web ? '网页登录，值不出站' : '没有网页登录', 'purple')
    + row('none', '未分类', none, none ? '默认拒绝读取' : '都分类了', none ? 'orange' : 'green')
    + row('noApproval', '免审批', noApproval, noApproval ? 'Agent 读它不用问' : '全部需要批准', 'green')
    + row('expiry', '7 天内到期', soon + past, past ? past + ' 条已过期' : '近期没有到期', soon || past ? 'orange' : 'green')
    + '</div>'
}
// Week × hour, for the same reason the trend exists but at a scale a single
// day hides: "read a lot on Tuesday morning" is the pattern people act on.
function heatGridHtml() {
  const entries = (app.data && app.data.audit) || []
  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0))
  for (const entry of entries) {
    if (!/^secret\.(read|use|fill)/.test(String(entry.event || ''))) continue
    const at = new Date(entry.time)
    if (Number.isNaN(at.getTime())) continue
    const day = (at.getDay() + 6) % 7
    grid[day][at.getHours()] += 1
  }
  const max = Math.max(1, ...grid.flat())
  const head = '<div class="heat__corner"></div>' + grid[0].map((_, hour) => '<div class="heat__hour">' + (hour % 3 === 0 ? String(hour).padStart(2, '0') : '') + '</div>').join('')
  const rows = grid.map((row, day) => '<div class="heat__day">' + days[day] + '</div>' + row.map((count, hour) => {
    const level = count / max
    return '<div class="heat__cell" data-count="' + count + '"' + (count ? ' style="background:color-mix(in srgb,var(--blue) ' + Math.round(12 + level * 88) + '%,transparent)"' : '')
      + ' title="' + days[day] + ' ' + String(hour).padStart(2, '0') + ':00 · ' + count + ' 次">' + (count && level > 0.72 ? count : '') + '</div>'
  }).join('')).join('')
  const total = grid.flat().reduce((sum, n) => sum + n, 0)
  return '<div class="heat">' + head + rows + '</div>'
    + '<div class="heat__legend"><span>少</span>' + [12, 30, 50, 70, 100].map((a) => '<i style="background:color-mix(in srgb,var(--blue) ' + a + '%,transparent)"></i>').join('') + '<span>多</span><span class="heat__total">审计里的 ' + entries.length + ' 条记录 · 共 ' + total + ' 次读取</span></div>'
}

const trendFaces = [
  { id: 'chart', title: '读取趋势', hint: '按时间聚合 · 悬停查看数值' },
  { id: 'heat', title: '读取热力图', hint: '星期 × 小时 · 越深越频繁' },
]
let trendFace = 0

function renderTrendFace() {
  const face = trendFaces[trendFace]
  const title = $('trend-title')
  const hint = $('trend-hint')
  const count = $('trend-count')
  if (title) title.textContent = face.title
  if (hint) hint.textContent = face.hint
  if (count) count.textContent = (trendFace + 1) + '/' + trendFaces.length
  show('chart-box', face.id === 'chart')
  show('heat-box', face.id === 'heat')
  if (face.id === 'heat') { const box = $('heat-box'); if (box) box.innerHTML = heatGridHtml() }
}

function renderStats() {
  const stats = app.stats || { totalReads: 0, activeAgents: 0, pending: 0, activeGrants: 0, buckets: [], topItems: [], topAgents: [] }
  // The sheet lists approvals *and* authorization reminders, so the card has to
  // count both; counting only state.pending showed 0 while the sheet showed two
  // expiring grants.
  const noticeCount = ((app.data && app.data.pending) || []).length + ((app.data && app.data.reminders) || []).length
  const cards = [{ l: '读取次数', v: stats.totalReads, sub: '当前区间 · 点开查看', view: 'reads' }, { l: '活跃 Agent', v: stats.activeAgents, sub: '有读取记录', view: 'agents' }, { l: '待审批 / 通知', v: noticeCount, sub: '点开处理', warn: noticeCount > 0, view: 'pending' }, { l: '有效授权', v: stats.activeGrants, sub: '含免审批', view: 'grants' }]
  const spark = (() => { const b = (stats.buckets || []).slice(-12); const mx = Math.max(1, ...b.map((x) => x.count)); return b.length ? '<div class="kpi-spark">' + b.map((x) => '<i style="height:' + Math.max(2, Math.round(x.count / mx * 20)) + 'px"></i>').join('') + '</div>' : '' })()
  $('kpis').innerHTML = cards.map((card) => '<div class="kpi' + (card.warn ? ' warn' : '') + '" data-kpi="' + card.view + '"' + (card.event ? ' data-kpi-event="' + card.event + '"' : '') + '><div class="label">' + card.l + '</div><div class="value">' + card.v + '</div>' + (card.view === 'reads' ? spark : '') + '<div class="sub">' + card.sub + '</div></div>').join('')
  renderOverviewActions()
  const buckets = stats.buckets || []; const max = Math.max(1, ...buckets.map((b) => b.count)); const W = 600, H = 180, px = 38, py = 18, iw = W - 2 * px, ih = H - 2 * py; const slot = buckets.length ? iw / buckets.length : 0; const barW = Math.max(2, Math.min(26, slot * 0.58))
  let grid = ''; for (let g = 0; g <= 4; g++) { const y = py + ih * g / 4; grid += '<line x1="' + px + '" y1="' + y + '" x2="' + (W - px) + '" y2="' + y + '" stroke="currentColor" stroke-opacity=".06"/><text x="4" y="' + (y + 3) + '" fill="currentColor" font-size="9" opacity=".5">' + Math.round(max * (4 - g) / 4) + '</text>' }
  const bars = buckets.map((bucket, index) => { const h = bucket.count / max * ih; const x = px + index * slot + (slot - barW) / 2; const y = H - py - h; return '<rect data-chart data-label="' + esc(bucket.label) + '" data-count="' + bucket.count + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(h, 0.6).toFixed(1) + '" rx="3" fill="var(--blue)" opacity="' + (bucket.count ? 0.95 : 0.22) + '" style="cursor:pointer"/>' }).join('')
  const labels = buckets.map((bucket, index) => index % Math.max(1, Math.ceil(buckets.length / 6)) === 0 ? '<text x="' + (px + index * slot + slot / 2).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" fill="currentColor" font-size="9" opacity=".55">' + esc(bucket.label) + '</text>' : '').join('')
  $('chart-box').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '">' + grid + bars + labels + '</svg>'
  const tip = $('chart-tip')
  const showTip = (event, label, count) => { if (!tip) return; tip.textContent = label + ' · ' + count + ' 次'; tip.classList.add('show'); tip.style.left = Math.min(window.innerWidth - 160, event.clientX + 12) + 'px'; tip.style.top = Math.max(8, event.clientY - 34) + 'px' }
  const hideTip = () => { if (tip) tip.classList.remove('show') }
  $('chart-box').querySelectorAll('[data-chart]').forEach((bar) => { bar.addEventListener('mouseenter', (event) => showTip(event, bar.dataset.label, bar.dataset.count)); bar.addEventListener('mousemove', (event) => showTip(event, bar.dataset.label, bar.dataset.count)); bar.addEventListener('mouseleave', hideTip) })
  const agents = stats.topAgents || []; const totalAgents = agents.reduce((sum, agent) => sum + agent.count, 0); const colors = ['#0f9d8a', '#5b6cff', '#f2994a', '#b6c2d9', '#a78bfa', '#14b8a6']; const R = 54, CIRC = 2 * Math.PI * R; let offset = 0
  const segments = agents.map((agent, index) => { const length = CIRC * (agent.count / Math.max(1, totalAgents)); const dash = Math.max(0, length - 2); const segment = '<circle class="donut-seg" data-donut data-agent="' + esc(agent.name) + '" data-count="' + agent.count + '" data-percent="' + Math.round(agent.count / Math.max(1, totalAgents) * 100) + '" cx="75" cy="75" r="' + R + '" fill="none" stroke="' + colors[index % colors.length] + '" stroke-width="19" stroke-dasharray="' + dash.toFixed(2) + ' ' + (CIRC - dash).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '" opacity=".9"/>'; offset += length; return segment }).join('')
  const pageCount = Math.max(1, Math.ceil(agents.length / LEGEND_PER_PAGE))
  if (legendPage >= pageCount) legendPage = 0
  const pageAgents = agents.slice(legendPage * LEGEND_PER_PAGE, (legendPage + 1) * LEGEND_PER_PAGE)
  const offsetBase = legendPage * LEGEND_PER_PAGE
  const legendHtml = pageAgents.map((agent, index) => { const pct = Math.round(agent.count / Math.max(1, totalAgents) * 100); return '<div data-legend data-agent="' + esc(agent.name) + '" data-count="' + agent.count + '" data-percent="' + pct + '"><span><span class="dot" style="background:' + colors[(offsetBase + index) % colors.length] + '"></span>' + esc(agent.name) + '</span><b>' + pct + '%</b></div>' }).join('')
  const pager = agents.length > LEGEND_PER_PAGE ? '<div class="legend-pager"><button id="legend-prev">‹</button><span>' + (legendPage + 1) + '/' + pageCount + '</span><button id="legend-next">›</button></div>' : ''
  $('donut-box').innerHTML = '<div class="donut-svg"><svg viewBox="0 0 150 150">' + (segments || '<circle cx="75" cy="75" r="54" fill="none" stroke="var(--btn)" stroke-width="19"/>') + '</svg><div class="donut-center" id="donut-center">' + totalAgents + '</div></div><div style="flex:1;min-width:0;display:flex;flex-direction:column"><div class="legend">' + legendHtml + '</div>' + pager + '</div>'
  const donutCenter = $('donut-center')
  const selectDonut = (target) => {
    const agent = target?.dataset.agent; if (!agent) return
    const already = target.classList.contains('active')
    $('donut-box').querySelectorAll('[data-donut],[data-legend]').forEach((el) => el.classList.remove('active'))
    if (already) { donutCenter.textContent = totalAgents; return }
    $('donut-box').querySelectorAll('[data-donut],[data-legend]').forEach((el) => { if (el.dataset.agent === agent) el.classList.add('active') })
    donutCenter.textContent = agent + ' ' + target.dataset.percent + '%'
  }
  const prevBtn = $('legend-prev')
  const nextBtn = $('legend-next')
  if (prevBtn) prevBtn.onclick = () => { legendPage = Math.max(0, legendPage - 1); renderStats() }
  if (nextBtn) nextBtn.onclick = () => { legendPage = legendPage + 1; renderStats() }
  $('donut-box').querySelectorAll('[data-donut],[data-legend]').forEach((el) => { el.addEventListener('click', () => selectDonut(el)); el.addEventListener('mouseenter', (event) => { if (el.dataset.count) showTip(event, el.dataset.agent, el.dataset.count) }); el.addEventListener('mouseleave', hideTip) })
  // Five is what the card has room for; the server sends up to twenty.
  const top = (stats.topItems || []).slice(0, 20); const totalTop = top.reduce((sum, item) => sum + item.count, 0) || 1; const maxTop = Math.max(1, ...top.map((item) => item.count))
  $('top-box').innerHTML = top.length ? '<div class="rank">' + top.map((item, index) => { const pct = Math.max(4, Math.round(item.count / maxTop * 100)); return '<div class="rank__row"><div class="rank__head"><span class="rank__name">' + (index + 1) + '. ' + esc(item.name) + '</span><span class="rank__count">' + item.count + ' 次</span></div><div class="rank__track"><div class="rank__fill" style="width:' + pct + '%"></div></div></div>' }).join('') + '</div>' : '<div class="hint">这个区间还没有读取记录。</div>'
  renderTrendFace()
  $('updated').textContent = '最后更新 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })
}
// "How many Agents can use this" and "how many credentials can this Agent
// read" are the same fact seen from two sides: a live grant. Grants arrive in
// two shapes — capabilities in agentActions, and legacy rows in grants — and
// both say the same thing about the pair (subject, item).
function liveRight(entry, now = Date.now()) {
  if (!entry || entry.revokedAt) return false
  if (entry.expiresAt && entry.expiresAt <= now) return false
  if (entry.maxUses != null && (entry.usedCount ?? entry.reads ?? 0) >= entry.maxUses) return false
  return true
}
function readRightsByItem() {
  const map = new Map()
  const add = (name, subject) => { if (!name || !subject) return; if (!map.has(name)) map.set(name, new Set()); map.get(name).add(subject) }
  for (const action of (app.data && app.data.agentActions) || []) {
    if (action.action !== 'secret.read') continue
    if (!liveRight({ revokedAt: action.revokedAt, expiresAt: action.expiresAt, maxUses: action.maxUses, usedCount: action.usedCount, usesLeft: action.usesLeft })) continue
    if (action.usesLeft === 0) continue
    add(action.itemName, action.agent)
  }
  for (const grant of (app.data && app.data.grants) || []) {
    if (!liveRight(grant)) continue
    add(grant.name, grant.agent)
  }
  return map
}
// Vault 2.0 keeps its own database and its own lock: the console can be open
// against the cipher vault while this one is still closed, so it gets its own
// status line and its own password field.
// A device counts as在线 while it has been seen in the last five minutes: every
// authenticated pull stamps last_seen_at, so this is a real signal, not a guess.
function vault2DeviceState(device) {
  if (device.revokedAt) return { label: '已撤销', cls: 'kind-tag kind-none' }
  const seen = Date.parse(device.lastSeenAt || '')
  if (!Number.isNaN(seen) && Date.now() - seen < 5 * 60 * 1000) return { label: '在线', cls: 'kind-tag kind-api' }
  return { label: '离线', cls: 'kind-tag kind-none' }
}

function renderVault2Devices(devices) {
  const host = $('v2-devices')
  if (!host) return
  host.innerHTML = '<div class="ios-group">' + (devices.length
    ? devices.map((device) => {
      const state = vault2DeviceState(device)
      const seen = device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '从未连接'
      const made = device.createdAt ? new Date(device.createdAt).toLocaleDateString() : ''
      const actions = device.revokedAt
        ? '<button class="mini danger" data-v2-purge="' + esc(device.id) + '">删除</button>'
        : '<button class="mini" data-v2-write="' + esc(device.id) + '" data-write="' + (device.canWrite ? '1' : '0') + '">' + (device.canWrite ? '可写' : '只读') + '</button><button class="mini" data-v2-revoke="' + esc(device.id) + '">撤销</button>'
      return '<div class="ios-row" data-device="' + esc(device.id) + '"><div class="ios-main"><div class="ios-title"><b>' + esc(device.name) + '</b> <span class="' + state.cls + '">' + state.label + '</span>' + (device.canWrite ? ' <span class="kind-tag kind-api">可写</span>' : '') + '</div><div class="ios-sub">最近活动 ' + esc(seen) + (made ? ' · 配对于 ' + esc(made) : '') + '</div></div>' + actions + '</div>'
    }).join('')
    : '<div class="hint">还没有配对设备。在另一台机器上运行 secrets-broker pair，打开终端给出的链接批准，它就会出现在这里。</div>') + '</div>'
  host.classList.remove('hidden')
}

async function loadVault2(withItems = true) {
  const badge = $('v2-badge'); const line = $('v2-status'); const box = $('v2-box'); const msg = $('v2-msg')
  if (!badge) return
  msg.textContent = ''
  const devicesLine = $('devices-status'); const devicesMsg = $('devices-msg')
  if (devicesMsg) devicesMsg.textContent = ''
  try {
    const status = await api('/api/v2/status')
    const list = await api('/api/v2/devices').catch(() => ({ devices: [] }))
    const devices = (list.devices || [])
    const ready = status.initialized === true
    const initButton = $('init-v2')
    if (initButton) initButton.classList.toggle('hidden', ready)
    badge.textContent = ready ? (status.unlocked ? '已解锁' : '已锁定') : '未初始化'
    line.textContent = ready
      ? ('条目 ' + Number(status.items || 0) + ' 条 · revision ' + Number(status.revision || 0) + ' · 已配对设备 ' + devices.length + ' 台' + (status.unlocked && status.keyExpiresAt ? ' · 钥匙有效至 ' + new Date(status.keyExpiresAt).toLocaleTimeString() : ''))
      : '还没有初始化。输入一个至少 12 位的主密码，点「初始化」会新建一个空库；旧条目要初始化后用「从旧库导入」。'
    if (devicesLine) {
      const online = devices.filter((device) => !device.revokedAt && vault2DeviceState(device).label === '在线').length
      devicesLine.textContent = devices.length ? (devices.length + ' 台已配对 · ' + online + ' 台在线') : '还没有配对设备。'
    }
    $('v2-unlock').textContent = ready ? '解锁' : '初始化'
    renderVault2Devices(devices)
    if (!status.unlocked) { box.classList.add('hidden'); box.innerHTML = ''; return }
    if (!withItems) return
    const plain = await api('/api/v2/items?plain=1')
    const rows = (plain.items || []).filter((row) => !row.deletedAt)
    box.innerHTML = rows.length
      ? '<div class="ios-group">' + rows.slice(0, 200).map((row) => {
        const payload = row.payload || {}
        const fields = Object.keys(payload).filter((key) => key !== 'name').length
        return '<div class="ios-row"><div class="ios-main"><div class="ios-title"><b>' + esc(payload.name || row.id) + '</b></div><div class="ios-sub">' + esc(row.kind || 'unclassified') + ' · ' + fields + ' 个字段</div></div></div>'
      }).join('') + '</div>'
      : '<div class="hint">还没有条目。</div>'
    box.classList.remove('hidden')
  } catch (error) {
    msg.textContent = '读取失败：' + error.message
    if (devicesMsg) devicesMsg.textContent = '读取失败：' + error.message
  }
}

function renderItems() {
  const query = ($('item-filter')?.value || '').trim().toLowerCase(); const items = (app.items || []).filter((item) => !query || item.name.toLowerCase().includes(query) || String(item.url || '').toLowerCase().includes(query) || String(item.group || '').toLowerCase().includes(query))
  // Which items are already classified, by name, and with which kind. The
  // classified list is keyed by id, so map it back through the item rows.
  // Sorting is a view of the same list: by name, by the last time anything was
  // read, or by how many Agents hold a grant for it (the "who can touch this"
  // question that used to need opening every credential).
  const sortBy = String(($('item-sort') && $('item-sort').value) || localStorage.getItem('sb-item-sort') || 'name')
  const rights = readRightsByItem()
  const rightsOf = (item) => (rights.get(item.name) || new Set()).size
  const activityOf = (item) => { const at = Date.parse(item.lastActivityAt || ''); return Number.isNaN(at) ? 0 : at }
  items.sort((a, b) => {
    if (sortBy === 'activity') return activityOf(b) - activityOf(a) || String(a.name).localeCompare(String(b.name))
    if (sortBy === 'access') return rightsOf(b) - rightsOf(a) || String(a.name).localeCompare(String(b.name))
    if (sortBy === 'expiry') {
      const ae = typeof a.expiresAt === 'number' && a.expiresAt > 0 ? a.expiresAt : Infinity
      const be = typeof b.expiresAt === 'number' && b.expiresAt > 0 ? b.expiresAt : Infinity
      return ae - be || String(a.name).localeCompare(String(b.name))
    }
    return String(a.name).localeCompare(String(b.name))
  })
  const kindByName = new Map()
  for (const entry of fillPolicyState().items || []) {
    if (entry.itemName) kindByName.set(entry.itemName, entry.kind)
  }
  // The tooltip must name the switch that actually decides the read, which is
  // the unclassified-plaintext behaviour setting — requireClassification is
  // only consulted for a no-approval item, so it is not the answer here.
  const guarded = (app.data && app.data.unclassifiedPlaintext) !== true
  const kindTag = (kind) => {
    if (kind === 'api') return ' <span class="kind-tag kind-api" title="API Key：可按需允许 Agent 读取明文">api</span>'
    if (kind === 'web') return ' <span class="kind-tag kind-web" title="网站登录：只能被填充到指定网站，Agent 永远拿不到明文">web</span>'
    return ' <span class="kind-tag kind-none" title="' + (guarded ? '未分类：明文读取已被拒绝，请在条目里分类' : '未分类：Agent 可能读到明文，请在条目里分类') + '">' + (guarded ? '未分类 · 禁读' : '未分类 · 可读明文') + '</span>'
  }
  const ico = (kind) => { const paths = kind === 'web'
    ? '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/>'
    : kind === 'api'
      ? '<circle cx="8" cy="8" r="4"/><path d="M11 11l8 8M16 16l2-2M19 19l2-2"/>'
      : '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
    return '<span class="ios-ico " data-kind="' + (kind || 'none') + '"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg></span>' }
  // Grouped like an iOS settings list: classified credentials first, the ones that
  // still need a decision below. Unclassified items are the risky ones, so they get
  // their own group instead of being lost in one long table.
  const row = (item) => {
    const kind = kindByName.get(item.name)
    const when = item.lastActivityAt ? relativeTime(Date.parse(item.lastActivityAt)) : '无读取记录'
    const granted = rightsOf(item)
    const meta = [item.group, when, item.lastActor, granted ? granted + ' 个 Agent 可用' : ''].filter(Boolean).map((part) => esc(part)).join(' · ')
    // 0 means "no expiry" in state.secretExpiry, so a plain numeric test made
  // every credential without a date read as expired.
  const expired = typeof item.expiresAt === 'number' && item.expiresAt > 0 && item.expiresAt <= Date.now()
    // The pill is the approval state and nothing else: it used to read 已过期
    // whenever the credential expired, which hid the state the click changes and
    // made a successful toggle look like it did nothing. Expiry is a separate fact,
    // so it rides along in the subtitle instead.
    const approval = item.noApproval ? '免审批' : kind === 'web' ? '仅填充' : kind ? '需审批' : '未分类'
    const trail = '<button class="ios-pill ' + (item.noApproval ? 'on' : kind === 'web' ? 'web' : kind ? '' : 'none') + '" data-policy="' + esc(item.name) + '" title="点击切换：免审批读取 / 需要审批">'
      + esc(approval) + '</button>'
    return '<div class="ios-row">' +
      '<input type="checkbox" class="item-select ios-check" data-name="' + esc(item.name) + '" ' + (selectedItems.has(item.name) ? 'checked' : '') + ' title="选择">' +
      ico(kind) +
      '<div class="ios-main" data-item-menu="' + esc(item.name) + '" role="button" tabindex="0">' +
        '<div class="ios-title"><b>' + esc(item.name) + '</b>' + (kind === 'api' || kind === 'web' ? kindTag(kind) : '') + '</div>' +
        '<div class="ios-sub">' + meta + (expired ? ' · <span class="ios-expired">已过期</span>' : '') + '</div>' +
      '</div>' +
      '<div class="ios-trail">' + trail + '</div>' +
    '</div>'
  }
  const classified = items.filter((item) => kindByName.get(item.name) === 'api' || kindByName.get(item.name) === 'web')
  const unclassified = items.filter((item) => !classified.includes(item))
  const showChecks = itemsSelecting || selectedItems.size > 0
  const group = (title, list) => (list.length
    ? '<div class="ios-group' + (showChecks ? ' selecting' : '') + '"><div class="ios-group-head"><span>' + title + ' · ' + list.length + '</span></div><div class="ios-card">' + list.map(row).join('') + '</div></div>'
    : '')
  $('items-box').innerHTML = items.length ? group('已分类', classified) + group('未分类', unclassified) : '<div class="hint" style="margin-top:12px">没有条目</div>'
  $('items-box').querySelectorAll('.item-select').forEach((box) => { box.onchange = () => { if (box.checked) selectedItems.add(box.dataset.name); else selectedItems.delete(box.dataset.name); updateBulkBar() } })
  $('items-box').querySelectorAll('.ios-main').forEach((main) => { main.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openItemMenu(main.dataset.itemMenu) } } })
  updateBulkBar()
}
function updateBulkBar() { const bar = $('bulk-bar'); if (!bar) return; bar.classList.toggle('hidden', selectedItems.size === 0); $('bulk-count').textContent = '已选择 ' + selectedItems.size + ' 个条目' }
// null/undefined = permanent; past = expired; soon (<24h) flagged.
function expiryLabel(expiresAt) {
  if (typeof expiresAt !== 'number' || expiresAt <= 0) return '永久'
  const left = expiresAt - Date.now()
  if (left <= 0) return '<span style="color:var(--danger)">已过期</span>'
  const days = Math.floor(left / 86400e3)
  const hours = Math.floor((left % 86400e3) / 3600e3)
  const text = days > 0 ? days + ' 天' : hours + ' 小时'
  return left < 86400e3 ? '<span style="color:var(--danger)">' + text + '</span>' : text
}
// ── Agent Live Globe (P3/P4) ────────────────────────────────────────────────
// Loaded lazily and entirely optional: any failure hides the globe and leaves
// the rest of the console untouched.
const globe = { instance: null, loading: false, failed: false, range: '24h', cursor: 0, events: [], timer: null, paused: false, hidden: false, reduceMotion: false, operator: null, broker: null, showArcs: true, showOperator: true }
function globeVisible() {
  return !globe.hidden && !document.hidden && !globe.paused
}
function stopGlobePolling() {
  if (globe.timer) { clearInterval(globe.timer); globe.timer = null }
}
async function fetchGlobeEvents(reset) {
  const since = reset ? 0 : globe.cursor
  const response = await api('/api/geo/events?range=' + encodeURIComponent(globe.range) + '&sinceSeq=' + since + '&limit=300')
  if (!response.enabled) return { disabled: true, events: [] }
  globe.operator = response.operator || null
  globe.broker = response.broker || null
  if (reset) globe.events = []
  // De-duplicate by id so a retried poll cannot double-plot.
  const seen = new Set(globe.events.map((e) => e.id))
  for (const ev of response.events || []) if (!seen.has(ev.id)) { globe.events.push(ev); seen.add(ev.id) }
  globe.cursor = Math.max(globe.cursor, Number(response.cursor || 0))
  return { disabled: false, events: globe.events }
}
function renderGlobeStatus(count) {
  const box = $('globe-status')
  if (!box) return
  box.textContent = count ? '共 ' + count + ' 条真实访问记录 · 每 5 秒增量更新' : '暂无真实访问记录'
}
async function ensureGlobe() {
  if (globe.instance || globe.loading || globe.failed || globe.hidden) return globe.instance
  globe.loading = true
  try {
    const box = $('globe-box')
    if (!box) throw new Error('#globe-box missing')
    // Fail loudly and precisely: a zero-size container or an unsupported WebGL
    // context used to surface as a generic "component unavailable" message.
    if (!box.clientWidth || !box.clientHeight) throw new Error('globe container has no size (' + box.clientWidth + 'x' + box.clientHeight + ')')
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2') || probe.getContext('webgl')
    if (!gl) throw new Error('WebGL is unavailable in this browser')
    const mod = await import('/globe.js')
    if (typeof mod.mountGlobe !== 'function') throw new Error('globe module did not export mountGlobe')
    globe.instance = mod.mountGlobe(box, { reduceMotion: globe.reduceMotion })
    if (globe.paused) globe.instance.setPaused(true)
    return globe.instance
  } catch (error) {
    // Never let the globe break the console, but do surface why it failed so
    // the cause is diagnosable instead of being swallowed.
    globe.failed = true
    const detail = String((error && (error.message || error.reason)) || error || 'unknown')
    try { console.error('[globe] load failed:', error) } catch {}
    const box = $('globe-box')
    if (box) box.innerHTML = '<div class="globe-empty">地球组件不可用（不影响其他功能）<br><span style="font-size:11px;opacity:.7">' + esc(detail.slice(0, 160)) + '</span></div>'
    const st = $('globe-status')
    if (st) st.textContent = '地球加载失败：' + detail.slice(0, 120)
    return null
  } finally { globe.loading = false }
}
async function refreshGlobe(reset) {
  if (globe.hidden || globe.failed) return
  try {
    const result = await fetchGlobeEvents(reset)
    if (result.disabled) {
      const box = $('globe-box')
      if (box) box.innerHTML = '<div class="globe-empty">全球态势未启用</div>'
      const st = $('globe-status'); if (st) st.textContent = '功能开关 GEO_ENABLED 未开启'
      stopGlobePolling()
      return
    }
    const events = result.events || []
    const empty = $('globe-empty')
    // Keep the overlay empty and inert: a caption across the globe would block dragging,
    // and the status line below already reports the record count.
    if (empty) { empty.textContent = ''; empty.style.display = 'none' }
    renderGlobeStatus(events.length)
    // Initialise the globe even with no events so the earth itself is visible;
    // only the markers depend on data. Skipping this left the card showing the
    // placeholder forever on a quiet broker.
    const instance = await ensureGlobe()
    if (!instance) return
    instance.setPoints(events, globe.operator, { showArcs: globe.showArcs, showOperator: globe.showOperator, broker: globe.broker })
  } catch { /* polling is best-effort */ }
}
function syncGlobePolling() {
  stopGlobePolling()
  if (!globeVisible() || globe.failed) return
  refreshGlobe(false)
  // 5s incremental polling, paused whenever the page or globe is hidden.
  globe.timer = setInterval(() => { if (globeVisible()) refreshGlobe(false) }, 5000)
}
function toggleGlobeFullscreen() {
  const box = $('globe-box')
  const button = $('globe-full')
  if (!box) return
  const next = !box.classList.contains('globe-full')
  box.classList.toggle('globe-full', next)
  if (button) button.textContent = next ? '缩小' : '放大'
  // Let the container settle before measuring for the new viewport size.
  requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')) } catch {} })
}
// Live connection feed: only shown while there are fresh connections, and it
// scrolls like a danmaku stream. Each entry is a real captured event.
let danmuTimer = null
function stopDanmu() {
  if (danmuTimer) { clearInterval(danmuTimer); danmuTimer = null }
}
// Resolve the readable name for a captured event's agent. OAuth agents are
// stored as "oauth:<clientId>"; show the client name and drop the raw id so the
// feed stays readable.
function eventAgentName(ev) {
  const raw = String(ev.agent || '')
  if (!raw.startsWith('oauth:')) return raw
  const clientId = raw.slice(6)
  const client = ((app.data && app.data.oauthClients) || []).find((c) => c.clientId === clientId)
  return (client && client.clientName) || 'OAuth 客户端'
}
function danmuLine(ev) {
  const g = ev.geo || {}
  const cc = g.country ? String(g.country).toUpperCase() : ''
  const city = g.city ? String(g.city).split(',')[0] : ''
  const where = [city, cc].filter(Boolean).join(' · ') || '未知位置'
  const time = ev.at ? new Date(ev.at).toLocaleTimeString('zh-CN', { hour12: false }) : ''
  const color = ev.ok ? 'var(--ok,#0f9d8a)' : 'var(--danger)'
  return '<div class="danmu-row"><span class="danmu-time">' + esc(time) + '</span>' +
    '<b class="danmu-agent">' + esc(eventAgentName(ev)) + '</b>' +
    '<span class="danmu-where">' + esc(where) + '</span>' +
    '<span class="danmu-act">' + esc(ev.action || '') + '</span>' +
    '<span style="color:' + color + '">' + (ev.ok ? '成功' : '失败') + '</span></div>'
}
function renderDanmu() {
  const feed = $('globe-danmu')
  if (!feed) { stopDanmu(); return }
  const events = (globe.events || []).slice(-40)
  if (!events.length) {
    feed.innerHTML = '<div class="danmu-empty">暂无连接</div>'
    stopDanmu()
    return
  }
  feed.innerHTML = events.slice().reverse().map(danmuLine).join('')
  // Animate new arrivals in from the bottom.
  const first = feed.firstElementChild
  if (first) first.classList.add('danmu-new')
}
function startDanmu() {
  stopDanmu()
  renderDanmu()
  // Keep the feed live while the modal is open and the page is visible.
  danmuTimer = setInterval(() => { if (!document.hidden) renderDanmu() }, 3000)
}
function openGlobeModal() {
  const events = globe.events || []
  const op = globe.operator
  const opText = op && op.known ? (op.city || op.country || '未知') + ' (' + (op.country || '') + ')' : '未记录'
  const toggles = '<div class="row" style="gap:16px;margin:12px 0">' +
    '<label class="chk" style="flex:0 0 auto"><input type="checkbox" id="gl-arcs" ' + (globe.showArcs ? 'checked' : '') + '> 显示弧线</label>' +
    '<label class="chk" style="flex:0 0 auto"><input type="checkbox" id="gl-operator" ' + (globe.showOperator ? 'checked' : '') + '> 显示我的位置</label>' +
    '</div>'
  const rows = events.length ? events.slice().reverse().slice(0, 100).map((ev) => {
    const g = ev.geo || {}
    const where = g.known ? (g.city || '') + (g.city && g.country ? ', ' : '') + (g.country || '') : '未知位置'
    const when = ev.at ? new Date(ev.at).toLocaleString('zh-CN', { hour12: false }) : ''
    const color = ev.ok ? 'var(--accent,#0f9d8a)' : 'var(--danger)'
    return '<tr><td><b>' + esc(eventAgentName(ev)) + '</b> <span class="pill">' + (ev.kind === 'oauth' ? 'OAuth' : 'Token') + '</span></td>' +
      '<td class="hint">' + esc(where) + '</td>' +
      '<td class="hint">' + esc(ev.action || '') + '</td>' +
      '<td style="color:' + color + '">' + (ev.ok ? '成功' : '失败') + '</td>' +
      '<td class="hint">' + esc(when) + '</td></tr>'
  }).join('') : ''
  // Enlarged view: the globe itself grows on the left, the live feed streams
  // beside it. This is a bigger globe, not a table of connections.
  const body = '<div class="globe-big" id="globe-big">' +
    '<div class="globe-big-stage">' +
      '<div id="globe-big-box" class="globe-box globe-box-big"></div>' +
      '<button class="small globe-big-close" id="globe-big-close">关闭 ✕</button>' +
    '</div>' +
    '<div class="globe-big-side">' +
      '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px"><b>Agent Live Globe</b><span class="hint">放大视图</span></div>' +
      '<div class="hint">我的位置（IP 估算）：<b>' + esc(opText) + '</b></div>' +
      toggles +
      '<div class="danmu-title" style="margin-top:10px">实时连接<span class="hint" style="margin-left:6px">成功=已授权并完成 · 失败=权限不足或条目不存在（与位置无关）</span></div>' +
      '<div id="globe-danmu" class="danmu-feed"></div>' +
    '</div>' +
    '</div>'
  const host = $('globe-overlay') || (() => {
    const el = document.createElement('div')
    el.id = 'globe-overlay'
    document.body.appendChild(el)
    return el
  })()
  host.innerHTML = body
  host.classList.add('globe-overlay-on')
  mountBigGlobe()
  startDanmu()
  const closeBtn = $('globe-big-close')
  if (closeBtn) closeBtn.onclick = closeBigGlobe
  const arcsToggle = $('gl-arcs')
  if (arcsToggle) arcsToggle.onchange = () => { globe.showArcs = arcsToggle.checked; refreshGlobe(true); redrawBigGlobe() }
  const opToggle = $('gl-operator')
  if (opToggle) opToggle.onchange = () => { globe.showOperator = opToggle.checked; refreshGlobe(true); redrawBigGlobe() }
}
// The modal hosts a second, larger globe instance.
let bigGlobe = null
async function mountBigGlobe() {
  const box = $('globe-big-box')
  if (!box) return
  try {
    const mod = await import('/globe.js')
    bigGlobe = mod.mountGlobe(box, { reduceMotion: globe.reduceMotion })
    redrawBigGlobe()
  } catch (error) {
    box.innerHTML = '<div class="globe-empty">' + esc(String(error && error.message || error).slice(0, 120)) + '</div>'
  }
}
function redrawBigGlobe() {
  if (!bigGlobe) return
  try { bigGlobe.setPoints(globe.events || [], globe.operator, { showArcs: globe.showArcs, showOperator: globe.showOperator }) } catch {}
}
function disposeBigGlobe() {
  if (!bigGlobe) return
  try { bigGlobe.dispose() } catch {}
  bigGlobe = null
}
function closeBigGlobe() {
  disposeBigGlobe()
  stopDanmu()
  const host = $('globe-overlay')
  if (host) { host.innerHTML = ''; host.classList.remove('globe-overlay-on') }
}
function initGlobe() {
  if (!$('globe-box')) return
  globe.reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (globe.reduceMotion) { globe.paused = true; const b = $('globe-pause'); if (b) b.textContent = '继续' }
  const rangeRow = $('globe-range')
  if (rangeRow) rangeRow.onclick = (event) => {
    const button = event.target.closest('[data-grange]')
    if (!button) return
    rangeRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === button))
    globe.range = button.dataset.grange
    globe.cursor = 0
    refreshGlobe(true)
  }
  const pauseBtn = $('globe-pause')
  if (pauseBtn) pauseBtn.onclick = () => {
    globe.paused = !globe.paused
    pauseBtn.textContent = globe.paused ? '▶' : '⏸'
    pauseBtn.title = globe.paused ? '继续播放' : '暂停动画'
    if (globe.instance) globe.instance.setPaused(globe.paused)
    syncGlobePolling()
  }
  // The card is now compact: the corner icon opens the enlarged view, which
  // carries the full-size globe plus the live connection feed.
  const fullBtn = $('globe-full')
  if (fullBtn) fullBtn.onclick = () => openGlobeModal()
  const boxEl = $('globe-box')
  // Distinguish a click from a drag: only a press-and-release without movement
  // opens the enlarged view, so rotating the globe never pops a dialog.
  if (boxEl) {
    let downX = 0, downY = 0, downAt = 0
    boxEl.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; downAt = Date.now() })
    boxEl.addEventListener('pointerup', (e) => {
      if (e.target.tagName !== 'CANVAS') return
      const moved = Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4
      const quick = Date.now() - downAt < 600
      if (!moved && quick) openGlobeModal()
    })
  }
  document.addEventListener('visibilitychange', syncGlobePolling)
  // Keep the globe palette in step with the console theme.
  if (window.MutationObserver) {
    new MutationObserver(() => {
      if (!globe.instance) return
      try { globe.instance.setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light') } catch {}
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }
  refreshGlobe(true)
  syncGlobePolling()
}
// Home banner: pending approvals win, otherwise show authorization reminders.
// A single line scrolls through every outstanding item; clicking expands the
// full list in a modal.
let noticeIndex = 0
let noticeTimer = null
const NOTICE_READ_KEY = 'sb-notice-read-v1'
function noticeReadIds() {
  try { const saved = JSON.parse(localStorage.getItem(NOTICE_READ_KEY) || '[]'); return Array.isArray(saved) ? saved : [] } catch (error) { return [] }
}
function markNoticeRead(id) {
  const ids = noticeReadIds(); if (!ids.includes(id)) ids.push(id)
  try { localStorage.setItem(NOTICE_READ_KEY, JSON.stringify(ids.slice(-200))) } catch (error) { /* storage full or blocked: the bar just comes back */ }
}
function noticeItems() {
  const data = app.data || {}
  const pending = data.pending || []
  if (pending.length) {
    return pending.map((entry) => ({ id: 'pending:' + (entry.id || entry.name), tone: 'red', level: 'pending', text: '待审批：' + (entry.agent || 'Agent') + ' 请求读取「' + entry.name + '」', kind: 'pending', entry }))
  }
  // No approval waiting, but an authorization or a key may still be about to
  // lapse. These used to be dropped here, so the banner stayed blank while the
  // bell showed two notices.
  return (data.reminders || []).map((item) => ({
    id: 'reminder:' + item.kind + ':' + (item.agent || ''),
    tone: item.severity === 'critical' ? 'bad' : (item.severity === 'warning' ? 'warn' : 'plain'),
    level: item.severity === 'critical' ? 'critical' : (item.severity === 'warning' ? 'warning' : 'notice'),
    text: (item.kind && item.kind.indexOf('secret-') === 0 ? '密钥 ' : '') + (item.agent || '') + '：' + (item.message || ''),
    kind: item.kind,
    entry: item,
  }))
}
function renderNoticeBar() {
  const bar = $('notice-bar')
  if (!bar) return
  const read = noticeReadIds()
  const items = noticeItems().filter((item) => !read.includes(item.id))
  if (!items.length) { bar.classList.add('hidden'); bar.innerHTML = ''; if (noticeTimer) { clearInterval(noticeTimer); noticeTimer = null }; return }
  bar.classList.remove('hidden')
  const order = { pending: 0, critical: 1, warning: 2, notice: 3 }
  const top = items.slice().sort((a, b) => order[a.level] - order[b.level])[0]
  bar.dataset.level = top.level
  const render = () => {
    const item = items[noticeIndex % items.length]
    bar.dataset.level = item.level
    bar.dataset.tone = item.tone
    bar.innerHTML = '<span class="notice-dot"></span><span class="notice-text">' + esc(item.text) + '</span>' +
      '<span class="notice-count">' + items.length + '</span>' +
      '<button class="notice-more" data-notice-dismiss="' + esc(item.id) + '" title="标记这条为已读">已读</button>' +
      '<span class="notice-more">查看全部 ›</span>'
  }
  render()
  if (noticeTimer) clearInterval(noticeTimer)
  bar.querySelectorAll('[data-notice-dismiss]').forEach((button) => {
    button.onclick = (event) => {
      // Clicking 已读 must not also open the whole list behind it.
      event.stopPropagation()
      markNoticeRead(button.dataset.noticeDismiss)
      renderNoticeBar()
    }
  })
  if (items.length > 1) {
    noticeTimer = setInterval(() => { noticeIndex += 1; render() }, 4000)
  }
}
function openNoticeModal() {
  const pending = (app.data && app.data.pending) || []
  const reminders = (app.data && app.data.reminders) || []
  // The sheet is the only place reminders live now, so it must open even when
  // nothing is waiting for approval.
  if (!pending.length && !reminders.length) return

  const pendingBlock = pending.length ? pending.map((entry) => '<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px">'
    + pendingDetailHtml(entry)
    + '<div class="row" style="margin-top:8px"><button class="small primary" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="once">仅本次</button><button class="small" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="24h">24 小时</button><button class="small" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="always">永久</button><button class="small danger" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="deny">拒绝</button></div></div>').join('') : ''
  const reminderBlock = reminders.length ? reminders.map((item) => {
    const tone = item.severity === 'critical' ? 'bad' : (item.severity === 'warning' ? 'warn' : 'plain')
    const isSecret = Boolean(item.kind && item.kind.indexOf('secret-') === 0)
    return '<div class="ios-row ios-row--stack"><div class="ios-main"><div class="ios-title">'
      + '<span class="ios-name">' + esc((isSecret ? '密钥 ' : '') + (item.agent || '')) + '</span>'
      + '<span class="ios-pill ' + tone + '">' + esc(item.message || '') + '</span></div>'
      + '<div class="ios-sub">' + esc(item.kind === 'idle' ? '很久没有读取记录' : '到期后会拒绝，需要重新授权') + '</div>'
      + '<div class="ios-actions">'
      + (item.expiresAt && !isSecret ? '<button class="ios-chip" data-notice-extend="' + esc(item.agent || '') + '">延期</button>' : '')
      + (item.name ? '<button class="ios-chip" data-notice-open="' + esc(item.name) + '">查看凭据</button>' : '')
      + '</div></div></div>'
  }).join('') : ''
  const body = (pending.length ? '<div class="hint" style="margin-bottom:8px">有待审批请求时，仅显示待审批内容。</div>' + pendingBlock : '') +
    (!pending.length && reminders.length ? reminderBlock : '') +
    (!pending.length && !reminders.length ? '<div class="hint">暂无通知</div>' : '')
  openModal('待审批 / 通知', body)
  document.querySelectorAll('[data-notice-extend]').forEach((button) => {
    button.onclick = () => { show('modal', false); openExtendMenu(button.dataset.noticeExtend) }
  })
  document.querySelectorAll('[data-notice-open]').forEach((button) => {
    button.onclick = () => { show('modal', false); openItemMenu(button.dataset.noticeOpen) }
  })
}
// Last read opportunity per agent, derived from the audit trail the server
// already returns. This is "last recorded read", never a live-presence claim.
function lastActivityFor(agentName) {
  const audit = (app.data && app.data.audit) || []
  let latest = 0
  for (const entry of audit) {
    if (entry.agent !== agentName) continue
    const time = Date.parse(entry.time)
    if (Number.isFinite(time) && time > latest) latest = time
  }
  return latest
}
function relativeTime(ms) {
  if (!ms) return '无读取记录'
  const diff = Date.now() - ms
  if (diff < 60000) return '刚刚'
  if (diff < 3600e3) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前'
  return Math.floor(diff / 86400e3) + ' 天前'
}
// Health is a UI hint only: authorization still decides access.
function agentHealth(agent, lastActivity) {
  if (typeof agent.expiresAt === 'number' && agent.expiresAt <= Date.now()) {
    return { level: 'danger', label: '已过期', detail: '授权已过期，需重新延长' }
  }
  if (typeof agent.expiresAt === 'number' && agent.expiresAt - Date.now() < 3 * 86400e3) {
    return { level: 'warn', label: '即将到期', detail: expiryLabel(agent.expiresAt) + '后到期' }
  }
  if (!lastActivity || Date.now() - lastActivity > 7 * 86400e3) {
    return { level: 'warn', label: '需关注', detail: lastActivity ? relativeTime(lastActivity) + '无读取记录' : '从未有读取记录' }
  }
  return { level: 'ok', label: '正常', detail: lastActivity ? '最近 ' + relativeTime(lastActivity) + '有活动' : '待首次使用' }
}
function renderAgentStats(agents) {
  const box = $('agent-stats')
  if (!box) return
  let active = 0
  let attention = 0
  for (const agent of agents) {
    const last = lastActivityFor(agent.name)
    const health = agentHealth(agent, last)
    if (last && Date.now() - last < 7 * 86400e3) active += 1
    if (health.level !== 'ok') attention += 1
  }
  const cards = [
    { label: 'Agent 总数', value: agents.length },
    { label: '近期有活动', value: active, hint: '7 天内有读取记录' },
    { label: '需要关注', value: attention, hint: '过期、将到期或长期闲置' },
  ]
  box.innerHTML = cards.map((card) => '<div class="agent-stat"><b>' + card.value + '</b><span>' + esc(card.label) + '</span>' + (card.hint ? '<i>' + esc(card.hint) + '</i>' : '') + '</div>').join('')
}
// OAuth agents are keyed internally as "oauth:<clientId>". Operators should
// see the readable client name, with the raw id kept in the note.
function agentDisplayName(agent) {
  if (!agent) return ''
  if (agent.alias) return agent.alias
  if (agent.oauth && String(agent.name || '').startsWith('oauth:')) return agent.note || 'OAuth 客户端'
  return agent.name
}
function agentDisplayNote(agent) {
  if (!agent) return ''
  if (agent.alias && agent.oauth && String(agent.name || '').startsWith('oauth:')) return agent.note || ''
  return agent.note || ''
}
const IOS_PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6"></circle><path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6"></path></svg>'
// The all-clear mark on the work queue. Drawn, not typed, so it scales with the
// surrounding text and keeps the same stroke weight as the other icons.
const IOS_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.4l2.6 2.6L16 9.6"></path></svg>'
function renderAgents() {
  const all = (app.data && app.data.agents) || []
  renderAgentStats(all)
  const query = String(($('agent-search') && $('agent-search').value) || '').trim().toLowerCase()
  const typeFilter = String(($('agent-type-filter') && $('agent-type-filter').value) || '')
  const sortBy = String(($('agent-sort') && $('agent-sort').value) || 'default')
  let agents = all.filter((agent) => {
    if (typeFilter === 'oauth' && !agent.oauth) return false
    if (typeFilter === 'token' && agent.oauth) return false
    if (!query) return true
    return String(agent.name || '').toLowerCase().includes(query) || String(agent.alias || '').toLowerCase().includes(query) || String(agent.note || '').toLowerCase().includes(query)
  })
  if (sortBy === 'expiry') {
    agents = agents.slice().sort((a, b) => {
      const ae = typeof a.expiresAt === 'number' ? a.expiresAt : Infinity
      const be = typeof b.expiresAt === 'number' ? b.expiresAt : Infinity
      return ae - be
    })
  } else if (sortBy === 'activity') {
    agents = agents.slice().sort((a, b) => lastActivityFor(b.name) - lastActivityFor(a.name))
  } else if (sortBy === 'name') {
    agents = agents.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
  } else if (sortBy === 'rights') {
    // The other side of the same ledger: how many credentials this Agent can
    // read right now. allowAll means "everything in scope", so it counts the
    // items it could read rather than the grants it happens to have.
    const byItem = readRightsByItem()
    const readableBy = new Map()
    for (const [name, subjects] of byItem) for (const subject of subjects) readableBy.set(subject, (readableBy.get(subject) || 0) + 1)
    const apiItems = (app.items || []).filter((item) => (app.data && app.data.fillPolicies && app.data.fillPolicies.items || []).some((entry) => entry.itemName === item.name && entry.kind === 'api')).length
    const count = (agent) => (agent.allowAll === true ? Math.max(apiItems, readableBy.get(agent.name) || 0) : (readableBy.get(agent.name) || 0))
    agents = agents.slice().sort((a, b) => count(b) - count(a) || String(a.name).localeCompare(String(b.name)))
  }
  const box = $('agents-box')
  if (!box) return
  if (!agents.length) {
    box.innerHTML = '<div class="hint">' + (all.length ? '没有匹配的 Agent' : '还没有 Agent，点右上角「新建 Agent」创建') + '</div>'
    return
  }
  const rows = agents.map((agent) => {
    const last = lastActivityFor(agent.name)
    const health = agentHealth(agent, last)
    const kind = agent.oauth ? 'OAuth' : 'Token'
    const dotClass = health.level === 'ok' ? 'ok' : (health.level === 'warn' ? 'warn' : 'bad')
    const days = typeof agent.expiresAt === 'number' ? Math.max(0, Math.ceil((agent.expiresAt - Date.now()) / 86400e3)) + ' 天后到期' : '长期有效'
    return '<div class="ios-row" data-agent-open="' + esc(agent.name) + '">' +
      '<span class="ios-ico" data-kind="' + (agent.oauth ? 'oauth' : 'api') + '">' + IOS_PERSON + '</span>' +
      '<div class="ios-main"><div class="ios-title"><span class="ios-name">' + esc(agentDisplayName(agent)) + '</span>' +
      '<span class="ios-tag">' + kind + '</span></div>' +
      '<div class="ios-sub">' + (agentDisplayNote(agent) ? esc(agentDisplayNote(agent)) + ' · ' : '') + esc(health.detail) + '</div>' +
      '<div class="ios-sub">' + days + '</div></div>' +
      '<div class="ios-trail"><button class="ios-pill plain" data-agent-extend="' + esc(agent.name) + '" title="延长授权">延长</button>' +
      '<span class="ios-pill ' + dotClass + '">' + esc(health.label) + '</span></div></div>'
  }).join('')
  box.innerHTML = '<div class="ios-group"><div class="ios-group-head"><span>共 ' + agents.length + ' 个 Agent</span></div>' +
    '<div class="ios-card">' + rows + '</div></div>'
}
function renderPending() {
  const pending = app.data.pending || []
  const body = pending.map((request) => {
    const origin = pendingOriginLabel(request)
    const isFill = String(request.action || '') === 'secret.fill'
    const originLine = !origin ? '' : /^目标无效/.test(origin) ? origin : '目标 ' + origin
    // A write is one ticket, not a duration: the other chips would promise a
    // lifetime the approval cannot give.
    const chips = (String(request.action || '') === 'secret.write' ? [['once', '批准写入']] : [['once', '仅本次'], ['1h', '1 小时'], ['24h', '24 小时'], ['7d', '7 天'], ['always', '永久']])
      .map((mode) => '<button class="ios-chip" data-decide="' + mode[0] + '" data-id="' + esc(request.id) + '">' + mode[1] + '</button>').join('')
      + '<button class="ios-chip danger" data-decide="deny" data-id="' + esc(request.id) + '">拒绝</button>'
    return '<div class="ios-row ios-row--stack">' +
      '<span class="ios-ico" data-kind="' + (isFill ? 'web' : 'api') + '">' + IOS_PERSON + '</span>' +
      '<div class="ios-main"><div class="ios-title"><span class="ios-name">' + esc(request.agent) +
      '</span><span class="ios-tag">' + esc(pendingActionLabel(request)) + '</span></div>' +
      '<div class="ios-sub">条目 ' + esc(request.name) + '</div>' +
      (originLine ? '<div class="ios-sub">' + esc(originLine) + '</div>' : '') +
      '<div class="ios-sub">' + esc(new Date(request.createdAt).toLocaleTimeString('zh-CN', { hour12: false })) + '</div>' +
      '<div class="ios-actions">' + chips + '</div></div></div>'
  }).join('')
  $('pending-box').innerHTML = pending.length
    ? '<div class="ios-group"><div class="ios-group-head"><span>等待你决定 · ' + pending.length + '</span></div><div class="ios-card">' + body + '</div></div>'
    : '<div class="hint">暂无待批准请求</div>'
}

// -- Web fill policies --------------------------------------------------------
// A pending fill request shows the exact origin it targets, so the approver
// can tell the site apart instead of guessing from the item name.
// The pending detail is used by the notice bar and the KPI modal so an
// approver always sees the action and the exact target origin.
function pendingDetailHtml(entry) {
  const origin = pendingOriginLabel(entry)
  const isFill = String(entry.action || '') === 'secret.fill'
  const target = isFill
    ? (origin ? '<div><span class="hint">目标 origin</span><br><code>' + esc(origin) + '</code></div>'
      : '<div><b style="color:var(--danger)">目标无效（缺少 origin），无法批准</b></div>')
    : ''
  return '<div><b>' + esc(entry.agent || 'Agent') + '</b> 请求' + esc(pendingActionLabel(entry))
    + ' <code>' + esc(entry.name) + '</code></div>' + target
    + '<div class="hint">' + esc(entry.createdAt ? new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false }) : '') + '</div>'
}

// The web fill policy card. Every call goes through the admin API, which
// checks the admin cookie and the unlocked vault on the server.
// Show the stored policy for the item so the admin edits the real state.
// Per-item fill editor, rendered inside the item detail dialog so the operator
// never retypes a credential name. Returns the markup; wire() attaches handlers.
function fillEditorHtml(item) {
  const entry = (fillPolicyState().items || []).find((e) => e.itemName === item.name || e.itemId === item.id) || null
  const kind = entry ? entry.kind : ''
  const origins = entry ? (entry.origins || []).join('\n') : ''
  const actions = entry ? (entry.actions || []) : ['login']
  const read = Boolean(entry && entry.plaintextRead)
  return '<div class="card"><h2>网页填充与明文读取</h2>'
    + '<div class="hint">api = API Key，可按需允许 Agent 读取明文；web = 网站登录，只能被填充到指定网站，Agent 永远拿不到明文。未分类则保持旧版授权行为。</div>'
    + '<div class="ios-field"><label for="fe-kind">类型</label><select id="fe-kind">'
    + '<option value=""' + (kind === '' ? ' selected' : '') + '>未分类</option>'
    + '<option value="api"' + (kind === 'api' ? ' selected' : '') + '>API 密钥</option>'
    + '<option value="web"' + (kind === 'web' ? ' selected' : '') + '>网页登录</option></select></div>'
    + '<div id="fe-web" class="' + (kind === 'web' ? '' : 'hidden') + '">'
    + '<div class="ios-field ios-field--stack"><label for="fe-origins">允许填充的站点（每行一个）</label>'
    + '<textarea id="fe-origins" rows="3" placeholder="https://example.com&#10;192.168.1.10:8080">' + esc(origins) + '</textarea>'
    + '<div class="hint">只做精确匹配：example.com.evil.test、任意子域或其他端口都不会被放行。省略协议时按 https 处理；内网地址（127.x、10.x、192.168.x、172.16-31.x、localhost、*.lan）可以用 http，公网地址只允许 https。</div></div></div>'
    + '<div class="ios-field" id="fe-read-row"><label for="fe-read">允许 Agent 直接读取明文<small>仅 api；30 天后自动失效</small></label><input type="checkbox" class="ios-switch" id="fe-read"' + (read ? ' checked' : '') + '></div>'
    + '<div class="row" style="margin-top:var(--sp-3)"><button class="primary" id="fe-save">保存</button>' + (entry ? '<button class="danger" id="fe-clear">清除分类</button>' : '') + '</div>'
    + '<div class="status" id="fe-status"></div></div>'
}

function wireFillEditor(item) {
  const kind = $('fe-kind')
  if (!kind) return
  const sync = () => {
    const isWeb = kind.value === 'web'
    const web = $('fe-web')
    if (web) web.classList.toggle('hidden', !isWeb)
    const readRow = $('fe-read-row')
    if (readRow) readRow.style.display = isWeb ? 'none' : ''
  }
  kind.onchange = sync
  sync()
  $('fe-save').onclick = async () => {
    const value = kind.value
    if (!value) return status('fe-status', '请选择 api 或 web', true)
    try {
      if (value === 'web') {
        const origins = $('fe-origins').value.split('\n').map((line) => line.trim()).filter(Boolean)
        if (!origins.length) return status('fe-status', 'web 凭据至少需要一个 origin', true)
        await api('/api/fill/policy', { method: 'POST', body: JSON.stringify({ item: item.name, kind: 'web', origins, actions: ['login'] }) })
      } else {
        await api('/api/fill/policy', { method: 'POST', body: JSON.stringify({ item: item.name, kind: 'api' }) })
        await api('/api/fill/read-policy', { method: 'POST', body: JSON.stringify({ item: item.name, allow: $('fe-read').checked, ttlDays: 30 }) })
      }
      status('fe-status', '已保存', false)
      await refreshAll()
    } catch (error) { status('fe-status', error.message || '保存失败', true) }
  }
  const clear = $('fe-clear')
  if (clear) clear.onclick = async () => {
    if (!(await askYes('清除「' + item.name + '」的分类和相关授权？'))) return
    try {
      await api('/api/fill/policy/delete', { method: 'POST', body: JSON.stringify({ item: item.name }) })
      status('fe-status', '已清除', false)
      await refreshAll()
    } catch (error) { status('fe-status', error.message || '清除失败', true) }
  }
}

// Classify several credentials at once from the bulk bar. The kind is the only
// thing that makes sense in bulk; origins are per credential by nature.
function openBulkKind() {
  if (!selectedItems.size) return
  openModal('批量分类 ' + selectedItems.size + ' 个凭据', '<div class="hint">把选中的凭据标记为 api（API Key，可按需允许明文读取）或 web（网站登录，只能填充）。web 凭据还需要逐个填写允许的 origin。</div><label class="field">类型</label><select id="bk-kind"><option value="api">api（API Key）</option><option value="web">web（网站登录）</option></select><div class="row" style="margin-top:12px"><button class="primary" id="bk-save">应用</button></div><div class="status" id="bk-status"></div>')
  $('bk-save').onclick = async () => {
    const kind = $('bk-kind').value
    const names = [...selectedItems]
    let ok = 0
    const failed = []
    for (const name of names) {
      try {
        await api('/api/fill/policy', { method: 'POST', body: JSON.stringify({ item: name, kind, ...(kind === 'web' ? { origins: [], actions: ['login'] } : {}) }) })
        ok += 1
      } catch (error) {
        // A web credential needs at least one origin, so bulk web is expected to
        // fail per item; report it instead of pretending it worked.
        failed.push(name + ': ' + (error.message || '失败'))
      }
    }
    await refreshAll()
    show('modal', false)
    if (failed.length) toast('已分类 ' + ok + ' 个，' + failed.length + ' 个需要逐个设置（web 需要 origin）', true)
    else toast('已分类 ' + ok + ' 个')
  }
}

function pendingOriginLabel(entry) {
  const action = String(entry.action || '')
  // read has no site. fill and use both name one, and the approval binds it.
  if (action !== 'secret.fill' && action !== 'secret.use') return ''
  const origin = String(entry.targetOrigin || '').trim()
  if (!origin) return '目标无效（缺少 origin）'
  return origin
}
function pendingActionLabel(entry) {
  const labels = { 'secret.read': '读取明文', 'secret.use': '代持请求', 'secret.fill': '网页填充', 'secret.write': '写入密钥' }
  return labels[String(entry.action || '')] || String(entry.action || '未知')
}
function fillPolicyState() {
  return (app.data && app.data.fillPolicies) || { items: [], executionLayer: false }
}

// What the Agents were refused, with the reason and a one-click way to allow it.
// The refusals are recorded by the broker; this only displays them and offers
// the grant, so nothing is authorised without the operator clicking.
function renderDenied() {
  const box = $('denied-list')
  if (!box) return
  const rows = (app.data && app.data.deniedAttempts) || []
  if (!rows.length) { box.innerHTML = '<div class="hint">没有 Agent 被拦下的请求。</div>'; return }
  const actionLabel = { 'secret.read': '读取明文', 'secret.use': '代持调用（http_request）', 'secret.fill': '网页填充' }
  const kinds = (app.data && app.data.fillPolicies && app.data.fillPolicies.items) || []
  const kindOf = (name) => (kinds.find((k) => k.itemName === name) || {}).kind || ''
  // The row used to print the agent's identifier, which is the name the token
  // belongs to, not the name the operator gave it. Look the agent up and show
  // that instead; the identifier stays on the buttons, which post it back.
  const agents = (app.data && app.data.agents) || []
  const who = (name) => {
    const agent = agents.find((entry) => entry.name === name || entry.id === name)
    return (agent && agentDisplayName(agent)) || name || ''
  }
  const rowsHtml = rows.map((entry) => {
    const at = entry.lastAt ? new Date(entry.lastAt).toLocaleString('zh-CN', { hour12: false }) : '-'
    const kind = kindOf(entry.name)
    const kindTag = kind === 'api' ? '<span class="ios-tag">api</span>'
      : kind === 'web' ? '<span class="ios-tag">web</span>'
      : '<span class="ios-tag">未分类</span>'
    // A plaintext refusal is not a missing grant: the agent already has scope, it
    // is the item that still refuses to hand over a value. One chip opens it.
    const plaintextBtn = entry.plaintext
      ? '<button class="ios-chip" data-allow-plaintext data-name="' + esc(entry.name || '') + '" data-days="1" title="给这条凭据开 24 小时明文读取">允许明文 24h</button>'
      : ''
    const useBtn = entry.action === 'secret.use'
      ? ''
      : '<button class="ios-chip" data-allow-use data-agent="' + esc(entry.agent || '') + '" data-name="' + esc(entry.name || '') + '" title="只开代持调用，不给明文">http_request</button>'
    return '<div class="ios-row ios-row--stack">' +
      '<span class="ios-ico" data-kind="' + (kind === 'web' ? 'web' : kind === 'api' ? 'api' : 'none') + '">' + IOS_PERSON + '</span>' +
      '<div class="ios-main"><div class="ios-title"><span class="ios-name">' + esc(who(entry.agent)) + '</span>' + kindTag +
      '<span class="ios-pill bad">' + esc(actionLabel[entry.action] || entry.action || '') + '</span></div>' +
      '<div class="ios-sub">条目 ' + esc(entry.name || '') + '</div>' +
      '<div class="ios-sub">被拦原因 ' + esc(entry.reason || '') + ' · ' + (entry.count ?? 1) + ' 次 · ' + esc(at) + '</div>' +
      '<div class="ios-actions"><button class="ios-chip" data-allow-denied data-agent="' + esc(entry.agent || '') + '" data-name="' + esc(entry.name || '') + '" data-action="' + esc(entry.action || '') + '">授权</button>' +
      useBtn +
      plaintextBtn +
      '<button class="ios-chip danger" data-dismiss-denied data-agent="' + esc(entry.agent || '') + '" data-name="' + esc(entry.name || '') + '" data-action="' + esc(entry.action || '') + '">忽略</button></div></div></div>'
  }).join('')
  box.innerHTML = '<div class="hint" style="margin-bottom:var(--sp-3)">点「授权」只放开这一条；「http_request」给这个 Agent 开代持调用，仍然拿不到明文。</div>' +
    '<div class="ios-group"><div class="ios-card">' + rowsHtml + '</div></div>'
}
// Grant what was refused. secret.use needs a target policy before http_request
// can reach anything, so that dialog asks for it; secret.read asks for a window.
function openAllowDenied(agent, name, action) {
  const target = action === 'secret.use'
  const body = target
    ? '<div class="hint">让「' + esc(agent) + '」可以对「' + esc(name) + '」发起 http_request。密钥在 broker 服务端注入，Agent 拿不到明文值。</div>'
      + '<label class="field">允许的目标主机（每行一个，如 httpbin.org）</label><textarea id="ad-hosts" rows="2" style="width:100%" placeholder="httpbin.org"></textarea>'
      + '<label class="field">允许的方法</label><select id="ad-methods"><option value="GET,POST">GET + POST</option><option value="GET">仅 GET</option><option value="GET,POST,PUT,PATCH,DELETE">全部</option></select>'
      + '<label class="field">端口</label><input id="ad-ports" value="443" placeholder="443">'
    : '<div class="hint">让「' + esc(agent) + '」可以读取「' + esc(name) + '」的明文值。</div>'
      + '<label class="field">明文有效期</label><select id="ad-hours"><option value="1">1 小时</option><option value="24" selected>24 小时</option><option value="168">7 天</option><option value="720">30 天</option><option value="0">永久</option></select>'
      + '<div class="hint" style="margin-top:4px;color:var(--danger)">允许后该 Agent 能拿到这条凭据的真实值。确认这是你信任的 Agent。</div>'
  openModal('授权「' + agent + ' → ' + name + '」', body + '<div class="row" style="margin-top:12px"><button class="primary" id="ad-go">授权</button></div><div class="status" id="ad-status"></div>')
  $('ad-go').onclick = async () => {
    try {
      status('ad-status', '授权中…')
      if (target) {
        const hosts = $('ad-hosts').value.split('\n').map((v) => v.trim()).filter(Boolean)
        if (!hosts.length) return status('ad-status', '至少填一个目标主机', 'error')
        const methods = $('ad-methods').value.split(',').map((v) => v.trim()).filter(Boolean)
        const ports = $('ad-ports').value.split(',').map((v) => v.trim()).filter(Boolean)
        await api('/api/use-policy', { method: 'POST', body: JSON.stringify({ item: name, hosts, methods, ports }) })
      }
      const duration = target ? '1d' : ({ '1': '1d', '24': '1d', '168': '7d', '720': '30d', '0': 'permanent' })[$('ad-hours')?.value || '24']
      await api('/api/action-grants', { method: 'POST', body: JSON.stringify({ agent, item: name, actions: [action], terms: { [action]: { duration } } }) })
      if (!target && $('ad-hours')?.value && $('ad-hours').value !== '0') {
        await api('/api/fill/read-policy', { method: 'POST', body: JSON.stringify({ item: name, allow: true, ttlDays: Math.max(1, Math.round(Number($('ad-hours').value) / 24)) }) })
      }
      await api('/api/denied/dismiss', { method: 'POST', body: JSON.stringify({ agent, name, action }) })
      show('modal', false); await refreshAll(); toast('已授权：' + agent + ' → ' + name)
    } catch (error) { status('ad-status', error.message, 'error') }
  }
}

// Opening http_request for one Agent+item: a default target policy (any https
// host, GET/POST) and the use capability. The Agent still never sees the value;
// this only lets the broker inject it server-side. Kept one click because the
// alternative — a host list per credential — was the reason this stayed broken.
function openAllowUse(agent, name) {
  openModal('开 http_request「' + agent + ' → ' + name + '」',
    '<div class="hint">让「' + esc(agent) + '」可以用这条凭据发起 http_request。密钥由 broker 在服务端注入到请求头，只回传上游响应，<b>Agent 拿不到明文值</b>。</div>' +
    '<label class="field">允许的主机</label>' +
    '<select id="au-scope"><option value="any">任意 https 主机（最省事）</option><option value="pick">只允许指定主机</option></select>' +
    '<div id="au-hosts-box" class="hidden"><label class="field">主机（每行一个）</label><textarea id="au-hosts" rows="2" style="width:100%" placeholder="httpbin.org"></textarea></div>' +
    '<label class="field">允许的方法</label><select id="au-methods"><option value="GET,POST">GET + POST</option><option value="GET">仅 GET</option><option value="GET,POST,PUT,PATCH,DELETE">全部</option></select>' +
    '<div class="hint" style="margin-top:4px;color:var(--warn,#f2994a)">「任意主机」意味着这个 Agent 能把凭据发到任何 https 地址。只在完全信任该 Agent 时选它。</div>' +
    '<div class="row" style="margin-top:12px"><button class="primary" id="au-go">开启</button></div><div class="status" id="au-status"></div>')
  $('au-scope').onchange = () => $('au-hosts-box').classList.toggle('hidden', $('au-scope').value !== 'pick')
  $('au-go').onclick = async () => {
    try {
      status('au-status', '开启中…')
      const scope = $('au-scope').value
      const methods = $('au-methods').value.split(',').map((v) => v.trim()).filter(Boolean)
      let hosts
      if (scope === 'any') {
        // The target policy is a host allowlist, so "any" cannot be expressed as
        // a pattern. http_request still checks the host list, so an unrestricted
        // host set is written as the vault's own hosts plus nothing — instead we
        // take the explicit route and record '*' meaning "no host restriction".
        hosts = ['*']
      } else {
        hosts = $('au-hosts').value.split('\n').map((v) => v.trim()).filter(Boolean)
        if (!hosts.length) return status('au-status', '至少填一个主机', 'error')
      }
      await api('/api/use-policy', { method: 'POST', body: JSON.stringify({ item: name, hosts, methods, ports: ['443'], anyHost: scope === 'any' }) })
      await api('/api/action-grants', { method: 'POST', body: JSON.stringify({ agent, item: name, actions: ['secret.use'], terms: { 'secret.use': { duration: 'permanent' } } }) })
      await api('/api/denied/dismiss', { method: 'POST', body: JSON.stringify({ agent, name, action: 'secret.use' }) })
      show('modal', false); await refreshAll(); toast('已开启 http_request：' + agent + ' → ' + name)
    } catch (error) { status('au-status', error.message, 'error') }
  }
}

function renderFillPolicies() {
  const list = $('fp-list')
  if (!list) return
  renderDenied()
  const state = fillPolicyState()
  const note = $('fp-exec-note')
  if (note) {
    note.textContent = state.executionLayer
      ? '执行层已配置（凭据可被填充到网页）。'
      : '尚未配置真实浏览器执行层：填充请求无法完成实际网页登录，Agent 也不会拿到凭据明文。'
    note.style.color = state.executionLayer ? '' : 'var(--danger)'
  }
  if (!state.items.length) { list.innerHTML = '<div class="hint">还没有分类任何凭据。点列表里条目的 ⋮ 即可设置分类。</div>'; return }
  const rows = state.items.map((entry) => {
    const read = entry.plaintextRead
      ? (entry.plaintextReadExpiresAt && entry.plaintextReadExpiresAt < Date.now() ? '已过期' : '允许')
      : '拒绝'
    const origins = entry.origins.length ? entry.origins.map((o) => '<code>' + esc(o) + '</code>').join('<br>') : '-'
    return '<tr><td><b>' + esc(entry.itemName || entry.itemId) + '</b></td><td>' + esc(entry.kind) + '</td><td>' + origins + '</td><td>' + esc((entry.actions || []).join(', ') || '-') + '</td><td>' + read + '</td><td class="nowrap"><button class="small" data-fp-edit="' + esc(entry.itemName || '') + '">修改</button></td></tr>'
  }).join('')
  list.innerHTML = '<table><tr><th>凭据</th><th>类型</th><th>允许的 origin</th><th>动作</th><th>明文读取</th><th>操作</th></tr>' + rows + '</table>'
}

// Selection state for the bulk bar. Kept outside the render so a refresh in the
// background does not drop what the operator ticked.
let grantsSelecting = false
const selectedGrants = new Set()
function grantSelectionKey(agent, name) { return JSON.stringify([agent, name]) }
function selectedGrantList() { return [...selectedGrants].map((key) => { const [agent, name] = JSON.parse(key); return { agent, name } }) }
function syncGrantsBulk() {
  const bar = $('grants-bulk')
  if (bar) bar.classList.toggle('hidden', !grantsSelecting && !selectedGrants.size)
  const count = $('grants-bulk-count')
  if (count) count.textContent = '已选 ' + selectedGrants.size + ' 条'
  if ($('grants-select')) $('grants-select').textContent = grantsSelecting ? '完成' : '选择'
}
function renderGrants() {
  const grants = app.data.grants || []  // Legacy grants with no recorded identity binding are repaired here, in the
  // same table: there is no separate screen for them. They cannot be migrated
  // automatically because the name may now denote a different credential, so
  // they are marked and the operator re-grants or deletes them in place.
  const unbound = ((app.data && app.data.legacyUnbound) || []).filter((entry) => !grants.some((g) => g.agent === entry.agent && g.name === entry.name))
  // A short label for the remaining time, so the row reads at a glance.
  const remaining = (grant) => {
    if (grant.revokedAt) return '已撤销'
    if (!grant.expiresAt) return '永久'
    const ms = grant.expiresAt - Date.now()
    if (ms <= 0) return '已过期'
    const days = Math.ceil(ms / 86400e3)
    return days <= 1 ? Math.max(1, Math.ceil(ms / 3600e3)) + ' 小时' : days + ' 天'
  }
  const rows = grants.map((grant) => {
    const state = grant.revokedAt ? '已撤销' : (grant.expiresAt && grant.expiresAt <= Date.now() ? '已过期' : (grant.maxReads && (grant.reads ?? 0) >= grant.maxReads ? '次数用尽' : '生效中'))
    const bad = state !== '生效中'
    const reads = (grant.reads ?? 0) + (grant.maxReads ? ' / ' + grant.maxReads : '')
    const key = grantSelectionKey(grant.agent, grant.name)
    return '<div class="ios-row">' +
      (grantsSelecting ? '<input type="checkbox" class="ios-check grant-select" data-key="' + esc(key) + '"' + (selectedGrants.has(key) ? ' checked' : '') + '>' : '') +
      '<span class="ios-ico" data-kind="api">' + IOS_PERSON + '</span>' +
      '<div class="ios-main" data-grant-menu data-agent="' + esc(grant.agent) + '" data-name="' + esc(grant.name) + '" role="button" tabindex="0"><div class="ios-title"><span class="ios-name">' + esc(grant.name) + '</span>' +
      '<span class="ios-tag">' + esc(grant.mode) + '</span></div>' +
      '<div class="ios-sub">' + esc(agentLabel(grant.agent)) + ' · 已读 ' + reads + '</div></div>' +
      '<div class="ios-trail"><button class="ios-pill ' + (bad ? 'bad' : 'ok') + '" data-item-grant data-agent="' + esc(grant.agent) +
      '" data-name="' + esc(grant.name) + '" title="点击修改时长和读取次数">' + esc(remaining(grant)) + '</button>' +
      '<button class="ios-more" data-grant-menu data-agent="' + esc(grant.agent) + '" data-name="' + esc(grant.name) + '" title="更多">⋮</button></div></div>'
  }).join('')
  // An unbound legacy grant has no capability and no duration to show; its only
  // useful actions are re-grant (which binds it) and delete.
  const legacyRows = unbound.map((entry) =>
    '<div class="ios-row ios-row--stack">' +
    '<span class="ios-ico" data-kind="none">' + IOS_PERSON + '</span>' +
    '<div class="ios-main"><div class="ios-title"><span class="ios-name">' + esc(entry.name || '') + '</span>' +
    '<span class="ios-pill bad">需重新授权</span></div>' +
    '<div class="ios-sub">' + esc(entry.agent || '') + ' · ' + esc(entry.mode || '') + ' · 无身份绑定</div>' +
    '<div class="ios-actions">' +
    '<button class="ios-chip" data-legacy-regrant data-agent="' + esc(entry.agent || '') + '" data-name="' + esc(entry.name || '') + '">重新授权</button>' +
    '<button class="ios-chip danger" data-legacy-delete data-agent="' + esc(entry.agent || '') + '" data-name="' + esc(entry.name || '') + '">删除</button>' +
    '</div></div></div>'
  ).join('')
  const total = grants.length + unbound.length
  $('grants-box').innerHTML = total
    ?       '<div class="ios-group"><div class="ios-card">' + rows + legacyRows + '</div></div>'
    : '<div class="hint">暂无授权</div>'
  syncGrantsBulk()
}

function renderTransfers() {
  const transfers = app.data.transfers || []
  $('transfers-box').innerHTML = transfers.length ? '<div class="ios-group"><div class="ios-card">' + transfers.map((entry) =>
    '<div class="ios-row ios-row--stack">' +
    '<span class="ios-ico" data-kind="web">' + IOS_PERSON + '</span>' +
    '<div class="ios-main"><div class="ios-title"><span class="ios-name">' + esc(entry.name) + '</span>' +
    '<span class="ios-pill ' + (entry.error ? 'bad' : 'warn') + '">' + esc(entry.error ? '复制失败' : '等待解锁') + '</span></div>' +
    '<div class="ios-sub">' + esc(entry.agent || '') + ' · 目标文件夹 ' + esc(entry.folder || '默认') + '</div>' +
    '<div class="ios-sub">' + esc(entry.sourceAccount || '主账户') + ' → ' + esc(entry.targetAccount || '目标账户') + '</div>' +
    '</div></div>').join('') + '</div></div>' : '<div class="hint">没有待复制的条目</div>'
}
function who(label) { const agent = (app.data.agents || []).find((entry) => entry.name === label); return agent?.alias || label || '系统' }
// The reason codes are what the server writes; the operator needs the sentence.
const REASON_TEXT = {
  'no-grant': '还没有授权',
  'not-granted': '还没有授权',
  'plaintext': '没有读取明文的许可',
  'plaintext-off': '没有读取明文的许可',
  'web-credential-is-fill-only': '网页登录只能填充，不给明文',
  'unclassified-plaintext-off': '未分类条目默认不给明文',
  'account-mismatch': '条目不属于当前账户',
  'maxreads-exhausted': '授权次数已用完',
  'expired': '授权已过期',
  'origin-not-allowed': '目标站点不在允许列表',
  'item-id-unresolved': '找不到这个条目',
  'vault-locked': 'vault 已锁定',
  'no-origin': '请求里没有目标站点',
}
function reasonText(reason) {
  const key = String(reason || '')
  return REASON_TEXT[key] || (key ? key : '未说明原因')
}
function describe(entry) {
  const name = entry.name ? '「' + entry.name + '」' : ''; const agent = who(entry.agent); const mode = ({ once: '仅本次', '1h': '1 小时', '24h': '24 小时', '7d': '7 天', always: '永久', grant: '授权', 'no-approval': '免审批' })[entry.mode] || entry.mode || ''
  switch (entry.event) {
    case 'secret.read': return agent + ' 读取了 ' + name + (mode ? '（' + mode + '）' : '')
    case 'secret.read-noapproval': return agent + ' 免审批读取了 ' + name
    case 'request.create': return agent + ' 申请读取 ' + name
    case 'request.approve': return agent + ' 的 ' + name + ' 申请已批准' + (mode ? '（' + mode + '）' : '') + '，渠道：' + (entry.source === 'telegram' ? 'Telegram' : entry.source === 'ntfy' ? 'ntfy' : '网页')
    case 'request.deny': return agent + ' 的 ' + name + ' 申请被拒绝'
    case 'policy.update': return '免审批策略：' + name + ' → ' + (entry.noApproval ? '开启' : '关闭')
    case 'agent.create': return '新增 Agent ' + agent
    case 'agent.rotate': return '轮换 Agent ' + agent + ' 的 token'
    case 'agent.token-view': return '查看 Agent ' + agent + ' 的 token'
    case 'item.update': return '更新密钥 ' + name + (entry.oldName ? '（原名 ' + entry.oldName + '）' : '')
    case 'item.delete': return '删除密钥 ' + name
    case 'grant.share': return '分享 ' + name + ' 给 ' + (entry.agents ? entry.agents.join('、') : agent)
    case 'grant.update': return '修改 ' + agent + ' 对 ' + name + ' 的授权'
    case 'grant.restore': return '恢复/重新授权 ' + agent + ' 读取 ' + name
    case 'grant.delete': return '删除 ' + agent + ' 对 ' + name + ' 的授权记录'
    case 'profile.update': return '更新个人资料'
    case 'admin.oidc-login': return 'OIDC 登录' + (entry.email ? '（' + entry.email + '）' : '')
    case 'vault.oidc-unlock': return 'OIDC 自动解锁保险库' + (entry.email ? '（' + entry.email + '）' : '')
    case 'settings.update': return '更新系统设置'
    case 'agent.delete': return '删除 Agent ' + agent
    case 'vault.unlock': return '解锁了 vault' + (entry.ttl ? '（' + entry.ttl + '）' : '')
    case 'vault.lock': return '锁定了 vault'
    case 'admin.login': return '管理登录'
    case 'admin.login-fail': return '管理登录失败'
    case 'admin.origin-mismatch': return '跨站请求被拒绝（来源与本站不一致）'
    case 'access.denied': return agent + ' 想读 ' + name + ' 被拦下：' + reasonText(entry.reason)
    case 'secret.read-deny': return agent + ' 读取 ' + name + ' 被拒绝：' + reasonText(entry.reason)
    case 'secret.view': return '管理员查看 ' + name + ' 的明文（两步验证通过）'
    case 'secret.view-deny': return '查看 ' + name + ' 的明文被拒绝：' + reasonText(entry.reason)
    case 'items.export': return '导出全部明文（两步验证通过）'
    case 'materialize.request': return agent + ' 申请把 ' + name + ' 写进 ' + (entry.target && entry.target.path ? entry.target.path : '白名单文件')
    case 'materialize.approve': return '批准 ' + agent + ' 把 ' + name + ' 写进 ' + (entry.target && entry.target.path ? entry.target.path : '白名单文件')
    case 'materialize.deny': return '拒绝 ' + agent + ' 写入 ' + name
    case 'secret.materialize': return agent + ' 把 ' + name + ' 写进了 ' + (entry.path || '白名单文件')
    case 'grant.prune-foreign': return '清理了指向其他账户的旧授权（' + (entry.count || 0) + ' 条）'
    case 'grant.batch': return (entry.action === 'delete' ? '批量删除授权（' : '批量恢复授权（') + (entry.count || 0) + ' 条）'
    case 'secret.write': return agent + ' 写入了 ' + name
    case 'grant.revoke': return '撤销 ' + agent + ' 对 ' + name + ' 的授权'
    case 'grant.extend': return '延长 ' + agent + ' 对 ' + name + ' 的授权'
    case 'action-grant.revoke': return '批量撤销授权（' + (entry.items || 1) + ' 条）'
    case 'request.auto-approve': return agent + ' 的 ' + name + ' 申请按自动规则放行'
    case 'oauth.client-register': return '新应用注册了 OAuth 客户端'
    case 'oauth.client-trust': return '确认了一个 OAuth 应用的首次接入'
    case 'oauth.authorize': return '授权 OAuth 应用访问 ' + name + (entry.grantAll ? '（全部条目）' : '')
    case 'oauth.consent-deny': return 'OAuth 同意页的提交被拒绝：' + reasonText(entry.reason)
    case 'oauth.token-issue': return '签发 OAuth token'
    case 'oauth.token-deny': return 'OAuth token 请求被拒：' + reasonText(entry.reason)
    case 'fill.task.claim': return '填表执行器认领了 ' + name + ' 的填充任务'
    case 'fill.redeem': return '填充任务取走了 ' + name + ' 的凭据'
    case 'fill.redeem-deny': return '填充任务取凭据被拒：' + reasonText(entry.reason)
    default: return entry.event + (entry.agent ? ' · ' + agent : '') + (name ? ' ' + name : '')
  }
}
// Anything that cleared a guard rather than passing it is red: a no-approval
// read skipped every check, and a denial shows what was refused. Everything
// else stays neutral so the red still means something.
const RED_LOG_EVENTS = new Set(['secret.read-noapproval', 'access.denied', 'secret.read-deny', 'secret.write-deny', 'grant.revoke', 'fill.redeem-deny', 'credential.cancel', 'policy.shadow-mismatch', 'admin.login-fail'])
// Event names are dozens and change; the operator thinks in groups. A trailing
// .* matches a prefix (telegram.*, oauth.*, fill.*). 仅风险事件 reuses
// RED_LOG_EVENTS so red stays the one definition of "risk".
const LOG_EVENT_GROUPS = [
  { key: 'read', label: '读取与拒绝', match: ['secret.read', 'secret.read-deny', 'secret.read-noapproval'] },
  { key: 'blocked', label: '被拦下的请求', match: ['access.denied'] },
  { key: 'grant', label: '授权变更', match: ['grant.share', 'grant.revoke', 'grant.extend', 'request.approve', 'request.deny', 'request.auto-approve', 'request.create'] },
  { key: 'ai', label: 'AI 与 Telegram', match: ['ai.ask', 'telegram.*'] },
  { key: 'login', label: '登录与解锁', match: ['admin.login', 'admin.login-fail', 'admin.oidc-login', 'admin.origin-mismatch', 'vault.unlock', 'vault.lock', 'vault.oidc-unlock'] },
  { key: 'item', label: '条目与分类', match: ['item.create', 'item.update', 'item.delete', 'fill-policy.update', 'use-policy.update', 'plaintext-read-policy.update'] },
  { key: 'oauth', label: 'OAuth 与填充', match: ['oauth.*', 'fill.*'] },
  { key: 'risk', label: '仅风险事件', red: true, match: [] },
]

function renderRecent() {
  $('recent-box').innerHTML = (app.data.audit || []).slice(0, 8).map((entry) =>
    '<div class="ios-row ios-row--log"><div class="ios-main">' +
    '<div class="ios-log-time">' + esc(new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false })) + '</div>' +
    '<div class="ios-log-text' + (RED_LOG_EVENTS.has(String(entry.event || '')) ? ' bad' : '') + '">' + esc(describe(entry)) + '</div>' +
    '</div></div>').join('') || '<div class="hint">暂无活动</div>'
}
// Options are rebuilt from the audit rows on every render (the data can change
// under a refresh); the current choice is carried over by value.
function logEventInGroup(group, event) {
  if (group.red) return RED_LOG_EVENTS.has(event)
  return (group.match || []).some((kind) => (kind.endsWith('.*') ? event.startsWith(kind.slice(0, -1)) : event === kind))
}

function fillLogSelect(id, options, allLabel) {
  const select = $(id); if (!select) return
  const current = select.value
  select.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + options.map((option) => '<option value="' + esc(option.value) + '"' + (option.value === current ? ' selected' : '') + '>' + esc(option.label) + '</option>').join('')
}
function renderLogs() {
  const all = app.data.audit || []
  const names = [...new Set(all.map((entry) => entry.name).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
  const agents = [...new Set(all.map((entry) => entry.agent).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
  fillLogSelect('logs-item-filter', names.map((name) => ({ value: name, label: name })), '全部条目')
  fillLogSelect('logs-agent-filter', agents.map((name) => ({ value: name, label: agentLabel(name) })), '全部 Agent')
  fillLogSelect('logs-event-filter', LOG_EVENT_GROUPS.map((group) => ({ value: group.key, label: group.label })), '全部事件类型')
  const item = ($('logs-item-filter') || {}).value || ''
  const agent = ($('logs-agent-filter') || {}).value || ''
  const group = LOG_EVENT_GROUPS.find((entry) => entry.key === (($('logs-event-filter') || {}).value || ''))
  const query = String((($('logs-search') || {}).value || '') || '').trim().toLowerCase()
  const rows = all.filter((entry) => {
    if (item && entry.name !== item) return false
    if (agent && entry.agent !== agent) return false
    if (group && !logEventInGroup(group, String(entry.event || ''))) return false
    if (query && !['event', 'agent', 'name', 'reason'].some((key) => String(entry[key] ?? '').toLowerCase().includes(query))) return false
    return true
  })
  // The table stays capped at 200 rows, so the count reports what is actually drawn.
  const shown = rows.slice(0, 200)
  const count = $('logs-count'); if (count) count.textContent = '显示 ' + shown.length + ' / 共 ' + all.length + ' 条'
  $('logs-box').innerHTML = shown.length ? '<div class="ios-group"><div class="ios-card">' + shown.map((entry) => {
    const red = RED_LOG_EVENTS.has(String(entry.event || '')) || entry.noApproval === true || entry.severity === 'warn'
    return '<div class="ios-row ios-row--log"><div class="ios-main">' +
      '<div class="ios-log-time">' + esc(new Date(entry.time).toLocaleString('zh-CN', { hour12: false })) + '</div>' +
      '<div class="ios-log-text' + (red ? ' bad' : '') + '">' + esc(describe(entry)) + '</div>' +
      ([entry.agent, entry.name].filter(Boolean).length ? '<div class="ios-sub">' + esc([entry.agent, entry.name].filter(Boolean).join(' · ')) + '</div>' : '') +
      '</div></div>'
  }).join('') + '</div></div>' : '<div class="hint">' + (all.length ? '没有符合筛选条件的日志' : '暂无日志') + '</div>'
}
function createItemMenu() {
  openModal('新增密钥条目', '<label class="field">名称</label><input id="new-item-name" placeholder="例如 tavily-api-key"><label class="field">用户名（可选）</label><input id="new-item-username" placeholder="登录用户名"><label class="field">密钥值</label><input id="new-item-value" placeholder="要保存的密钥"><label class="field">TOTP Secret（可选）</label><input id="new-item-totp" placeholder="Base32 TOTP secret"><label class="field">网址（可选）</label><input id="new-item-url" placeholder="https://example.com"><label class="field">分组（可选）</label><input id="new-item-group" placeholder="例如 blog/prod"><label class="field">备注（可选）</label><input id="new-item-notes"><label class="field">类型</label><select id="new-item-kind"><option value="">未分类（暂不可读）</option><option value="api">api（API Key，可授权 Agent 读取）</option><option value="web">web（网站登录，只能填充）</option></select><div id="new-item-web" class="hidden"><label class="field">允许填充的 origin（每行一个）</label><textarea id="new-item-origins" rows="2" style="width:100%" placeholder="https://example.com"></textarea></div><label class="chk" style="margin-top:8px"><input type="checkbox" id="new-item-noapproval"> 免审批</label><div class="row" style="margin-top:12px"><button class="primary" id="new-item-save">创建</button></div><div class="status" id="new-item-status"></div>')
  // The web fields only mean something for a website login.
  $('new-item-kind').onchange = () => $('new-item-web').classList.toggle('hidden', $('new-item-kind').value !== 'web')
  $('new-item-save').onclick = async () => {
    const name = $('new-item-name').value.trim()
    if (!name) return status('new-item-status', '请填写名称', 'error')
    const kind = $('new-item-kind').value
    const origins = kind === 'web' ? $('new-item-origins').value.split('\n').map((line) => line.trim()).filter(Boolean) : []
    if (kind === 'web' && !origins.length) return status('new-item-status', 'web 类型至少填一个 origin', 'error')
    try {
      await api('/api/items/create', { method: 'POST', body: JSON.stringify({ name, username: $('new-item-username').value, value: $('new-item-value').value, totp: $('new-item-totp').value, url: $('new-item-url').value.trim(), group: $('new-item-group').value.trim(), notes: $('new-item-notes').value, noApproval: $('new-item-noapproval').checked }) })
      // Classify in the same step: the item was just created with a kind, so
      // making the operator reopen it to classify is a pointless round trip.
      if (kind) {
        await api('/api/fill/policy', { method: 'POST', body: JSON.stringify(kind === 'web' ? { item: name, kind, origins, actions: ['login'] } : { item: name, kind }) })
        if (kind === 'api') await api('/api/fill/read-policy', { method: 'POST', body: JSON.stringify({ item: name, allow: true, ttlDays: 30 }) })
      }
      show('modal', false); await Promise.all([loadItems(), loadState()]); toast(kind ? '已创建并分类为 ' + kind : '已创建（未分类，Agent 暂时读不到）')
    } catch (error) { status('new-item-status', error.message, 'error') }
  }
}
// The importer reads one shape: a JSON array of {name,value,...}, or the same
// under {items:[...]}. That is deliberately narrow: a Bitwarden CSV export has
// no encrypted payload we can map without the account keys, and a Bitwarden
// JSON export is encrypted. Anything else must be converted first, so the
// dialog says so rather than failing on an unreadable file.
function importItems(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  openImportDialog(file)
}
function openImportDialog(file) {
  openModal('导入密钥', '<div class="hint">当前文件：<code>' + esc(file.name) + '</code></div>' +
    '<div class="hint" style="margin-top:10px">支持两种 JSON：<br>' +
    '· <code>[{"name":"a","value":"b"}, …]</code><br>' +
    '· <code>{"items":[{"name":"a","value":"b"}, …]}</code><br>' +
    '每条可用字段：<code>name</code>（必填）、<code>value</code>、<code>username</code>、<code>url</code>、<code>notes</code>、<code>totp</code>、<code>group</code>、<code>noApproval</code>。</div>' +
    '<div class="hint" style="margin-top:10px;color:var(--danger)">不是这两种格式？Bitwarden 的加密 JSON、CSV 导出、1Password/KeePass 的导出都需要先转换，否则无法直接映射。</div>' +
    '<label class="field">导入后统一分类（可选）</label><select id="imp-kind"><option value="">保持未分类</option><option value="api">api（API Key）</option></select>' +
    '<div class="hint" style="margin-top:4px">web 类型需要逐个指定 origin，因此不能批量导入分类。</div>' +
    '<div class="row" style="margin-top:12px"><button class="primary" id="imp-go">开始导入</button></div><div class="status" id="imp-status"></div>')
  $('imp-go').onclick = async () => {
    try {
      status('imp-status', '读取文件…')
      const parsed = JSON.parse(await file.text())
      const items = Array.isArray(parsed) ? parsed : parsed.items
      if (!Array.isArray(items)) throw new Error('JSON 需要是 [{name,value,…}] 或 {items:[…]}')
      const kind = $('imp-kind').value
      status('imp-status', '导入 ' + items.length + ' 条…')
      const result = await api('/api/items/import', { method: 'POST', body: JSON.stringify({ items }) })
      let classified = 0
      if (kind === 'api') {
        // A batch of api credentials is the common case (a set of API keys), so
        // it is offered here instead of one modal per item.
        for (const name of result.created || []) {
          try { await api('/api/fill/policy', { method: 'POST', body: JSON.stringify({ item: name, kind: 'api' }) }); await api('/api/fill/read-policy', { method: 'POST', body: JSON.stringify({ item: name, allow: true, ttlDays: 30 }) }); classified++ } catch {}
        }
      }
      show('modal', false); await Promise.all([loadItems(), loadState()])
      toast('导入完成：新增 ' + (result.created?.length || 0) + '，跳过 ' + (result.skipped?.length || 0) + (classified ? '，已分类 ' + classified : ''))
      if (result.skipped?.length) console.warn('import skipped', result.skipped)
    } catch (error) { status('imp-status', '导入失败：' + error.message, 'error') }
  }
}
function openBulkShare() {
  const names = [...selectedItems]
  if (!names.length) return
  const agents = app.data.agents || []
  const single = names.length === 1
  const boxes = agents.map((agent) => {
    const checked = single ? (app.data.grants || []).some((grant) => !grant.revokedAt && grant.agent === agent.name && grant.name === names[0]) : names.every((name) => (app.data.grants || []).some((grant) => !grant.revokedAt && grant.agent === agent.name && grant.name === name))
    return '<label class="chk" style="display:flex;width:100%"><input type="checkbox" class="bulk-agent" value="' + esc(agent.name) + '" ' + (checked ? 'checked' : '') + '> ' + esc(agent.alias || agent.name) + (agent.oauth ? ' <span class="pill">OAuth</span>' : '') + '</label>'
  }).join('')
  openModal('批量分享 / 同步（' + names.length + ' 个条目）', '<div class="hint">勾选的 Agent 会获得这些条目；勾选“取消未勾选分享”后，未勾选 Agent 的现有分享会被撤销。</div><div style="max-height:220px;overflow:auto;margin-top:8px">' + (boxes || '<div class="hint">没有 Agent</div>') + '</div><label class="field">跨账户目标文件夹（跨账户时必填）</label><input id="bulk-folder" placeholder="例如 笔记"><label class="field">时长</label><select id="bulk-seconds"><option value="3600">1 小时</option><option value="86400">24 小时</option><option value="604800">7 天</option><option value="2592000">30 天</option><option value="0">永久</option></select><label class="field">最多读取次数（留空不限）</label><input id="bulk-reads" type="number" min="1"><label class="chk"><input type="checkbox" id="bulk-scope" checked> 同时把这些条目加入 Agent 的可申请范围</label><div class="hint" style="margin:2px 0 0 22px">分享本身只产生一次「授权」。Agent 还要在范围内才看得到这个条目，所以默认一起勾上；取消勾选就只授权、不改范围。</div><label class="chk"><input type="checkbox" id="bulk-revoke" ' + (single ? 'checked' : '') + '> 取消未勾选 Agent 的分享</label><div class="row" style="margin-top:12px"><button class="primary" id="bulk-confirm">确定</button></div>')
  $('bulk-confirm').onclick = async () => {
    const agentsSelected = [...document.querySelectorAll('.bulk-agent:checked')].map((box) => box.value)
    try {
      const result = await api('/api/grants/sync', { method: 'POST', body: JSON.stringify({ items: names, agents: agentsSelected, seconds: Number($('bulk-seconds').value), maxReads: $('bulk-reads').value || null, targetFolder: $('bulk-folder').value.trim(), revokeUnselected: $('bulk-revoke').checked, addToScope: $('bulk-scope').checked }) })
      show('modal', false); selectedItems.clear(); await Promise.all([loadState(), loadItems()])
      toast('分享 ' + (result.granted?.length || 0) + '，转移 ' + (result.queued?.length || 0) + '，取消 ' + (result.revoked?.length || 0) + (result.errors?.length ? '，失败 ' + result.errors.length : ''))
    } catch (error) { toast(error.message, true) }
  }
}
async function bulkDelete() {
  const names = [...selectedItems]
  if (!names.length) return
  if (!(await askYes('删除选中的 ' + names.length + ' 个条目？'))) return
  let deleted = 0
  for (const name of names) {
    try { await api('/api/items/delete', { method: 'POST', body: JSON.stringify({ name }) }); deleted++ } catch {}
  }
  selectedItems.clear(); await Promise.all([loadItems(), loadState()]); toast('已删除 ' + deleted + ' 个条目')
}
async function exportItems() {
  // The file holds every password in the vault, so the server asks for a code.
  // Ask here too, rather than letting the click fail with a 428.
  const code = prompt('导出文件包含全部明文。请输入 6 位验证码：')
  if (!code) return
  try {
    const data = await api('/api/items/export', { method: 'POST', body: JSON.stringify({ code }) }); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'secrets-export-' + new Date().toISOString().slice(0, 10) + '.json'; link.click(); URL.revokeObjectURL(link.href); toast('已导出（包含明文，请妥善保存）')
  } catch (error) { toast(error.status === 428 ? '先在「设置 → 安全」启用两步验证，导出才可用' : error.message, true) }
}
function openModal(title, body) { $('modal-title').textContent = title; $('modal-body').innerHTML = body; show('modal', true) }
function uaLabel(ua) {
  const text = String(ua || '')
  const browser = /Edg\/([\d.]+)/.test(text) ? 'Edge ' + text.match(/Edg\/([\d.]+)/)[1] : /Chrome\/([\d.]+)/.test(text) ? 'Chrome ' + text.match(/Chrome\/([\d.]+)/)[1] : /Firefox\/([\d.]+)/.test(text) ? 'Firefox ' + text.match(/Firefox\/([\d.]+)/)[1] : /Version\/([\d.]+).*Safari/.test(text) ? 'Safari ' + text.match(/Version\/([\d.]+)/)[1] : 'Unknown'
  const os = /Windows NT 10/.test(text) ? 'Windows' : /Mac OS X/.test(text) ? 'macOS' : /Android/.test(text) ? 'Android' : /iPhone|iPad/.test(text) ? 'iOS' : /Linux/.test(text) ? 'Linux' : ''
  return browser + (os ? ' · ' + os : '')
}
function agentLabel(name) { const agent = (app.data.agents || []).find((entry) => entry.name === name); return agent?.alias || agent?.name || name || '系统' }
function describeEvent(entry) {
  const map = {
    'secret.read': '读取密钥', 'secret.read-noapproval': '⚠ 免审批直接读取（跳过所有检查）',
    'access.denied': '⚠ 被拦下的读取请求', 'secret.read-deny': '拒绝读取明文',
    'grant.share': '分享授权', 'grant.approve': '批准授权', 'grant.revoke': '撤销授权',
    'transfer.complete': '跨账户复制完成', 'item.create': '创建条目', 'item.update': '修改条目',
    'vault.unlock': '解锁', 'secret.use': '代持请求', 'secret.fill': '网页填充',
    'use-policy.update': '修改使用策略', 'fill-policy.update': '修改分类',
  }
  return map[entry.event] || entry.event || ''
}
function itemInfoHtml(item) {
  const grants = (app.data.grants || []).filter((grant) => grant.name === item.name)
  const usage = (app.data.audit || []).filter((entry) => entry.name === item.name && ['secret.read', 'grant.share', 'grant.approve', 'transfer.complete', 'item.create', 'item.update'].includes(entry.event)).slice(0, 10)
  const durationLabel = (grant) => { if (!grant.expiresAt) return '永久'; const ms = grant.expiresAt - Date.now(); if (ms <= 0) return '已过期'; const days = Math.ceil(ms / 86400000); return days <= 1 ? Math.max(1, Math.ceil(ms / 3600000)) + ' 小时' : days + ' 天' }
  const grantRows = grants.length ? grants.map((grant) => '<div class="ios-field"><label>' + esc(agentLabel(grant.agent)) + '<small>' + esc(grant.mode || '授权') + ' · 已读 ' + (grant.reads || 0) + '/' + (grant.maxReads || '∞') + '</small></label><button class="ios-pill plain" data-item-grant data-agent="' + esc(grant.agent) + '" data-name="' + esc(grant.name) + '" title="点击修改时长和读取次数">' + esc(durationLabel(grant)) + '</button></div>').join('') : '<div class="ios-field"><label>当前没有分享给 Agent</label></div>'
  const usageRows = usage.length ? usage.map((entry) => '<div class="ios-row ios-row--log"><div class="ios-main"><div class="ios-log-text">' + esc(describeEvent(entry)) + '</div><div class="ios-sub">' + esc(entry.time ? new Date(entry.time).toLocaleString('zh-CN', { hour12: false }) : '') + ' · ' + esc(agentLabel(entry.agent)) + (entry.mode || entry.source ? ' · ' + esc(entry.mode || entry.source) : '') + '</div></div></div>').join('') : '<div class="ios-field"><label>暂无使用记录</label></div>'
  return '<div class="card"><div class="ios-head"><h2 style="margin:0">分享情况</h2><button class="ios-pill plain" id="mi-share-sync">分享 / 同步</button></div><div class="hint">创建：' + esc(item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) : '-') + ' · 创建人：' + esc(item.creator || '-') + '</div>' + grantRows + '<h2 style="margin-top:var(--sp-4)">最近使用</h2>' + usageRows + '</div>'
}
// The expiry field of the edit dialog. A secret without an expiry shows an
// empty date, and an empty date on save means no expiry.

function expiresField(item) {
  const stamp = item && item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0, 10) : ''
  return '<label class="field">有效期（留空表示不过期）</label><input id="mi-expires" type="date" value="' + esc(stamp) + '">'
}

// A pushed page instead of a dialog: the item detail is a place you navigate
// to and come back from, not a thing that floats over the list.
function openItemPage(title, html) {
  $('item-page-title').textContent = title
  $('item-page-body').innerHTML = html
  $('item-page-body').scrollTop = 0
  const page = $('item-page')
  page.dataset.editing = 'false'
  $('item-page-edit').textContent = '编辑'
  page.classList.remove('hidden')
  document.body.classList.add('page-open')
  // Mark the row this page belongs to, so a wide-screen split shows which
  // entry the right-hand column is describing.
  for (const row of document.querySelectorAll('.ios-row.current')) row.classList.remove('current')
  let host = null
  if (window.CSS && CSS.escape) host = document.querySelector('[data-item-menu="' + CSS.escape(title) + '"]')
  const current = host && host.closest('.ios-row')
  if (current) current.classList.add('current')
  requestAnimationFrame(() => page.classList.add('in'))
}
function closeItemPage() {
  const page = $('item-page')
  if (!page || page.classList.contains('hidden')) return
  page.classList.remove('in')
  document.body.classList.remove('page-open')
  setTimeout(() => { if (!page.classList.contains('in')) page.classList.add('hidden') }, 360)
}
$('item-page-back').onclick = closeItemPage
$('item-page-close').onclick = closeItemPage
$('item-page-edit').onclick = () => {
  const page = $('item-page')
  const next = page.dataset.editing !== 'true'
  page.dataset.editing = next ? 'true' : 'false'
  $('item-page-edit').textContent = next ? '完成' : '编辑'
  if (next) $('item-page-body').scrollTo({ top: $('item-page-body').scrollHeight, behavior: 'smooth' })
}
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeItemPage() })
// A stored password is the one thing in this panel worth a second factor: the
// cookie alone would otherwise be enough to empty the vault. So the button asks
// for a TOTP code, and an account without TOTP is told to enrol instead of being
// quietly handed the plaintext.
async function revealItemSecret(item) {
  let security
  try { security = await api('/api/security') } catch (error) { return toast(error.message, true) }
  if (!security.totpEnabled) {
    openModal('看明文需要两步验证',
      '<p class="hint">明文读取要过 6 位验证码。当前账户还没启用两步验证，先在「设置 → 安全」里生成密钥、用验证器扫一次。</p>' +
      '<div class="row"><button class="primary" id="rv-enrol" type="button">去设置里注册</button></div>')
    $('rv-enrol').onclick = () => {
      show('modal', false)
      const tab = document.querySelector('#nav [data-view=profile]')
      if (tab) tab.click()
      const box = $('totp-setup-box')
      if (box) box.scrollIntoView({ block: 'center' })
      toast('点「生成密钥」，再用验证器扫二维码')
    }
    return
  }
  openModal('查看 ' + item.name,
    '<label class="field">两步验证码</label>' +
    '<input id="rv-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">' +
    '<div class="hint" id="rv-status">6 位数字，30 秒一换</div>' +
    '<div class="row"><button class="primary" id="rv-go" type="button">查看明文</button></div>')
  $('rv-code').focus()
  const submit = async () => {
    const code = $('rv-code').value.replace(/\s+/g, '')
    if (!/^\d{6}$/.test(code)) return status('rv-status', '请输入 6 位数字', 'error')
    try {
      const data = await api('/api/secret/reveal', { method: 'POST', body: JSON.stringify({ name: item.name, code }) })
      $('modal-body').innerHTML = '<div class="kv"><span>用户名</span><b>' + esc(data.username || '未设置') + '</b></div>' +
        '<div class="kv"><span>密钥</span><b><code>' + esc(data.value || '') + '</code></b></div>' +
        (data.totp ? '<div class="kv"><span>验证码</span><b><code>' + esc(data.totp) + '</code></b></div>' : '') +
        '<div class="row"><button class="primary" id="rv-copy" type="button">复制密钥</button></div>'
      $('rv-copy').onclick = () => {
        if (navigator.clipboard) navigator.clipboard.writeText(data.value || '')
        toast('已复制')
      }
    } catch (error) { status('rv-status', error.message, 'error') }
  }
  $('rv-go').onclick = submit
  $('rv-code').onkeydown = (event) => { if (event.key === 'Enter') submit() }
}
function openItemMenu(name) {
  const item = app.items.find((entry) => entry.name === name); if (!item) return
  const agents = app.data.agents || []
  openItemPage(name, itemInfoHtml(item) + '<div class="card"><h2>凭据</h2>' +
        '<div class="kv"><span>用户名</span><b>' + esc(item.username || '未设置') + '</b></div>' +
    '<div class="kv"><span>密钥</span><b><button class="ios-pill plain" id="item-reveal" type="button">查看</button></b></div>' +
    '<div class="kv"><span>网址</span><b>' + (item.url ? '<a href="' + esc(item.url) + '" target="_blank" rel="noreferrer">' + esc(item.url) + '</a>' : '未设置') + '</b></div>' +
    '<div class="kv"><span>分组</span><b>' + esc(item.group || '未分组') + '</b></div>' +
    '<div class="kv"><span>有效期</span><b>' + expiryLabel(item.expiresAt) + '</b></div></div>' +
    fillEditorHtml(item) + '<div class="card edit-only"><label class="field">名称</label><input id="mi-name" value="' + esc(item.name) + '"><label class="field">用户名（留空不改）</label><input id="mi-username" value="' + esc(item.username || '') + '"><label class="field">TOTP Secret（留空不改）</label><input id="mi-totp" value="' + esc(item.totp || '') + '"><label class="field">分组</label><input id="mi-group" value="' + esc(item.group || '') + '" placeholder="例如 blog/prod"><label class="field">网址</label><input id="mi-url" value="' + esc(item.url || '') + '"><label class="field">备注（留空不改）</label><input id="mi-notes" placeholder="新的备注"><label class="field">新密钥值（留空不改）</label><input id="mi-value" type="password" placeholder="留空保留原值"><label class="chk" style="margin-top:8px"><input type="checkbox" id="mi-noapproval" ' + (item.noApproval ? 'checked' : '') + '> 免审批（自动读取，仍记录）</label><div class="row" style="margin-top:14px"><button class="primary" id="mi-save">保存修改</button><button id="mi-share">分享 / 跨账户复制</button><button class="danger" id="mi-delete">删除</button></div><div style="border-top:1px solid var(--line);margin-top:14px;padding-top:10px"><div class="hint">分享给 Agent（同账户直接授权；跨账户会先复制到目标账户文件夹，切回目标账户解锁后自动完成）</div><label class="field">分享给（可多选）</label><div class="pick-list">' + agents.map((agent) => '<label class="pick-row"><input type="checkbox" class="ios-check" data-share-agent value="' + esc(agent.name) + '"><span>' + esc(agentDisplayName(agent)) + '</span></label>').join('') + '</div><label class="field">跨账户目标文件夹（同账户可留空）</label><input id="mi-share-folder" placeholder="例如 笔记"><label class="field">时长</label><select id="mi-share-seconds"><option value="3600">1 小时</option><option value="86400">24 小时</option><option value="604800">7 天</option><option value="2592000">30 天</option><option value="0">永久</option></select><label class="field">最多读取次数（留空不限）</label><input id="mi-share-reads" type="number" min="1"></div>' + expiresField(item) + '</div>')
  $('item-reveal').onclick = () => revealItemSecret(item)
  $('mi-share-sync').onclick = () => { closeItemPage(); selectedItems.clear(); selectedItems.add(item.name); openBulkShare() }
  $('mi-save').onclick = async () => { try { await api('/api/items/update', { method: 'POST', body: JSON.stringify({ name: item.name, newName: $('mi-name').value.trim(), username: $('mi-username').value, totp: $('mi-totp').value, group: $('mi-group').value.trim(), url: $('mi-url').value.trim(), notes: $('mi-notes').value.trim() ? $('mi-notes').value : undefined, value: $('mi-value').value, noApproval: $('mi-noapproval').checked, expiresAt: $('mi-expires').value }) }); closeItemPage(); await Promise.all([loadItems(), loadState()]); toast('已保存') } catch (error) { toast(error.message, true) } }
  $('mi-delete').onclick = async () => { if (!(await askYes('删除条目「' + item.name + '」？'))) return; try { await api('/api/items/delete', { method: 'POST', body: JSON.stringify({ name: item.name }) }); closeItemPage(); await Promise.all([loadItems(), loadState()]); toast('已删除') } catch (error) { toast(error.message, true) } }
  wireFillEditor(item)
  $('mi-share').onclick = async () => { const agents = [...document.querySelectorAll('[data-share-agent]')].filter((box) => box.checked).map((box) => box.value); if (!agents.length) return toast('至少选择一个 Agent', true); try { const result = await api('/api/grants/share', { method: 'POST', body: JSON.stringify({ name: $('mi-name').value.trim() || item.name, agents, seconds: Number($('mi-share-seconds').value), maxReads: $('mi-share-reads').value || null, targetFolder: $('mi-share-folder').value.trim() }) }); closeItemPage(); await refreshAll(); if (result.queued?.length) toast('已加入跨账户复制队列，切回目标账户并解锁后自动复制'); else toast('已分享') } catch (error) { toast(error.message, true) } }
}
async function saveAgentFromModal(originalName) {
  try {
    const requested = $('ma-realname').value.trim() || originalName
    let currentName = originalName
    if (requested !== originalName) {
      const renamed = await api('/api/agents/rename', { method: 'POST', body: JSON.stringify({ name: originalName, newName: requested }) })
      currentName = renamed.name
    }
    await api('/api/agents/update', { method: 'POST', body: JSON.stringify({ name: currentName, alias: $('ma-alias').value.trim(), note: $('ma-note').value.trim(), allow: $('ma-allowall').checked ? [] : pickListValues('ma-allow'), groups: pickListValues('ma-groups'), allowAll: $('ma-allowall').checked, write: $('ma-write').checked, muted: $('ma-muted').checked, tools: [...document.querySelectorAll('[data-mcp-tool]')].filter((box) => box.checked).map((box) => box.value) }) })
    show('modal', false); await refreshAll(); toast('已保存 Agent')
  } catch (error) { toast(error.message, true) }
}
// What this Agent may DO, per item. Read, use and fill are separate grants: a
// readable credential is not a fillable one, and the fill grant had no way to be
// given from this dialog at all — you had to provoke a denial first.
function agentActionFields(agent) {
  const held = ((app.data && app.data.agentActions) || []).filter((entry) => entry.agent === agent.name)
  const actionLabel = { 'secret.read': '读取明文', 'secret.use': '代持调用（http_request）', 'secret.fill': '网页填充' }
  const rows = held.length
    ? held.map((entry) => '<tr><td class="aa-pick"><input type="checkbox" class="ios-check" data-aa-pick data-item-id="' + esc(entry.itemId) + '" data-action="' + esc(entry.action) + '" data-item="' + esc(entry.itemName) + '" aria-label="选择 ' + esc(entry.itemName) + '"></td>'
        + '<td><b>' + esc(entry.itemName) + '</b></td><td>' + esc(actionLabel[entry.action] || entry.action) + '</td>'
        + '<td class="hint">' + esc(entry.expiresAt ? new Date(entry.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '永久') + '</td>'
        + '<td><button class="small danger" data-revoke-action data-agent="' + esc(agent.name) + '" data-action="' + esc(entry.action) + '" data-item="' + esc(entry.itemName) + '">撤销</button></td></tr>').join('')
    : '<tr><td colspan="5" class="hint">还没有任何动作授权。范围只决定能申请，真正能读/能填还要在这里授权。</td></tr>'
  return '<div style="border-top:1px solid var(--line);margin-top:14px;padding-top:10px">'
    + '<b>动作授权</b>'
    + '<div class="hint" style="margin:4px 0 8px">读取明文、代持调用、网页填充是三件独立的事，要分别给。'
    + '<b>网页填充</b>需要条目先分类为 web 并填好站点，否则给了也填不了。</div>'
    + '<div class="table-wrap scroll-list" style="max-height:180px"><table><tr><th class="aa-pick"><input type="checkbox" class="ios-check" id="aa-all" aria-label="全选"></th><th>条目</th><th>动作</th><th>到期</th><th></th></tr>' + rows + '</table></div>'
    + (held.length ? '<div class="row" style="margin-top:8px;gap:8px;align-items:center"><button class="small danger" id="aa-revoke">撤销所选</button><span class="hint" id="aa-count">未选择</span></div>' : '')
    + '<div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">'
    + '<select id="aa-item" style="flex:1;min-width:140px">' + knownItemNames().map((name) => '<option value="' + esc(name) + '">' + esc(name) + '</option>').join('') + '</select>'
    + '<select id="aa-action" style="flex:0 0 auto"><option value="secret.read">读取明文</option><option value="secret.use">代持调用</option><option value="secret.fill">网页填充</option></select>'
    + '<select id="aa-days" style="flex:0 0 auto"><option value="1">1 天</option><option value="7">7 天</option><option value="30" selected>30 天</option><option value="permanent">永久</option></select>'
    + '<button class="small primary" id="aa-grant">授予</button></div>'
    + '<div class="status" id="aa-status"></div></div>'
}
// "Allow every item" already means every item, so the per-item picker has to
// show that. Leaving the boxes empty made an operator who ticked 全部条目 on the
// consent page read the empty list as "the grant was lost".
function agentPermAllow(agent) {
  return agent.allowAll === true ? knownItemNames() : (agent.allow || [])
}
// Per-agent MCP surface. Ticking nothing keeps the old behaviour (every tool),
// because an allowlist that starts empty would lock every existing agent out.
const MCP_TOOLS = [
  ['list_secrets', '列出条目'],
  ['request_access', '申请读取'],
  ['explain_access', '解释权限'],
  ['get_secret', '读明文'],
  ['get_credential', '读登录凭据'],
  ['request_fill', '请求网页填充'],
  ['materialize', '写入本地文件'],
  ['materialize_redeem', '兑换写入任务'],
  ['request_credential', '创建填写链接'],
  ['put_secret', '写入密钥（需审批）'],
  ['http_request', '代调 API'],
]
function mcpToolFields(agent) {
  const chosen = new Set(Array.isArray(agent.tools) ? agent.tools : [])
  const boxes = MCP_TOOLS.map(([name, label]) =>
    '<label class="chk pick-row" style="display:flex;width:100%;margin:2px 0"><input type="checkbox" class="ma-tool" data-mcp-tool value="' + name + '"' + (chosen.has(name) ? ' checked' : '') + '> ' + esc(label) + ' <code class="hint" style="margin-left:6px">' + name + '</code></label>'
  ).join('')
  return '<label class="field">MCP 工具权限（一个都不勾 = 允许全部，与之前一样）</label><div class="pick-box" style="max-height:170px;overflow:auto;border:1px solid var(--separator);border-radius:10px;padding:6px 8px;margin:4px 0 8px">' + boxes + '</div>'
}
function agentPermFields(agent) {
  return '<div class="hint" style="margin:2px 0 6px">这里的「可申请条目」只影响免审批和自动授权的范围；任何可见条目都可以申请，审批仍由人完成。它不等于已经拿到授权——分享/审批产生的是一次具体的<b>授权</b>，在「授权」页能看到。</div>'
    + '<label class="field">免审批范围（不勾也能申请，只是每次要人批）</label>' + pickListHtml('ma-allow', knownItemNames(), agentPermAllow(agent), '密钥库里还没有条目。')
    + '<label class="field">可申请分组（范围内按分组放行）</label>' + pickListHtml('ma-groups', knownGroups(), agent.groups || [], '还没有任何分组。')
    + mcpToolFields(agent)
    + agentActionFields(agent)
    + '<label class="chk" style="margin-top:8px"><input type="checkbox" id="ma-muted" ' + (agent.muted ? 'checked' : '') + '> 暂停这个 Agent 的读取和申请（管理员可恢复）</label>'
}
// Wire the action-grant controls that agentPermFields renders. Shared by the
// token and OAuth dialogs so both can grant read/use/fill from one place.
function wireAgentActions(agentName) {
  const grant = $('aa-grant')
  if (!grant) return
  grant.onclick = async () => {
    const item = $('aa-item').value
    const action = $('aa-action').value
    const days = $('aa-days').value
    if (!item) return status('aa-status', '没有可授权的条目', true)
    try {
      status('aa-status', '授权中…')
      // secret.fill only makes sense for a web credential with an origin; refuse
      // early with the reason instead of minting a grant that can never apply.
      if (action === 'secret.fill') {
        const fill = ((app.data && app.data.fillPolicies && app.data.fillPolicies.items) || []).find((entry) => entry.itemName === item)
        if (!fill || fill.kind !== 'web') return status('aa-status', '「' + item + '」不是 web 类型，先到「密钥」页把它设为 web 并填站点', true)
        if (!(fill.origins || []).length) return status('aa-status', '「' + item + '」还没填允许的站点', true)
      }
      const duration = days === 'permanent' ? 'permanent' : ({ '1': '1d', '7': '7d', '30': '30d' })[days] || '30d'
      await api('/api/action-grants', { method: 'POST', body: JSON.stringify({ agent: agentName, item, actions: [action], terms: { [action]: { duration } } }) })
      // Reading wants a plaintext policy too, or the grant still cannot read.
      if (action === 'secret.read') {
        await api('/api/fill/read-policy', { method: 'POST', body: JSON.stringify({ item, allow: true, ttlDays: days === 'permanent' ? 3650 : Number(days) }) }).catch(() => {})
      }
      await refreshAll()
      toast('已授权：' + agentName + ' → ' + item + '（' + action + '）')
      openAgentMenu(agentName)
    } catch (error) { status('aa-status', error.message, true) }
  }
  const picks = () => [...document.querySelectorAll('[data-aa-pick]')]
  const syncCount = () => {
    const count = picks().filter((box) => box.checked).length
    if ($('aa-count')) $('aa-count').textContent = count ? '已选 ' + count + ' 项' : '未选择'
    if ($('aa-all')) $('aa-all').checked = count > 0 && count === picks().length
  }
  if ($('aa-all')) $('aa-all').onchange = () => { const all = $('aa-all').checked; for (const box of picks()) box.checked = all; syncCount() }
  for (const box of picks()) box.onchange = syncCount
  if ($('aa-revoke')) {
    $('aa-revoke').onclick = async () => {
      const chosen = picks().filter((box) => box.checked)
      if (!chosen.length) return status('aa-status', '先勾选要撤销的授权', true)
      const targets = chosen.filter((box) => box.dataset.itemId).map((box) => ({ itemId: box.dataset.itemId, action: box.dataset.action }))
      if (!targets.length) return status('aa-status', '找不到条目 id，刷新页面后重试', true)
      if (!(await askYes('撤销「' + agentName + '」的 ' + targets.length + ' 项授权？'))) return
      try {
        const result = await api('/api/action-grants/revoke', { method: 'POST', body: JSON.stringify({ agent: agentName, targets }) })
        await refreshAll()
        toast('已撤销 ' + (result.count || targets.length) + ' 项')
        openAgentMenu(agentName)
      } catch (error) { status('aa-status', error.message, true) }
    }
  }
  syncCount()
  for (const button of document.querySelectorAll('[data-revoke-action]')) {
    button.onclick = async () => {
      const item = button.dataset.item
      const action = button.dataset.action
      if (!(await askYes('撤销「' + agentName + '」对「' + item + '」的「' + action + '」授权？'))) return
      try {
        const items = app.items || []
        const found = items.find((entry) => entry.name === item)
        const itemId = found && found.id ? found.id : ''
        if (!itemId) return status('aa-status', '找不到条目 id，刷新页面后重试', true)
        await api('/api/action-grants/revoke', { method: 'POST', body: JSON.stringify({ agent: agentName, itemId, action }) })
        await refreshAll()
        toast('已撤销')
        openAgentMenu(agentName)
      } catch (error) { status('aa-status', error.message, true) }
    }
  }
}
async function openAgentMenu(name) {
  await ensureItems()
  const agent = app.data.agents.find((entry) => entry.name === name); if (!agent) return
  if (agent.oauth) {
    openModal('OAuth Agent「' + name + '」', '<div class="hint">OAuth 动态注册产生的 Agent，绑定账户：<code>' + esc(agent.account || '-') + '</code>。可以修改名称、备注、权限和写入开关；撤销授权会删除 token。</div><label class="field">名称（标识）</label><input id="ma-realname" value="' + esc(agent.name) + '"><label class="field">显示名</label><input id="ma-alias" value="' + esc(agent.alias || '') + '"><label class="field">备注</label><input id="ma-note" value="' + esc(agent.note || '') + '">' + agentPermFields(agent) + '<label class="chk"><input type="checkbox" id="ma-allowall" ' + (agent.allowAll ? 'checked' : '') + '> 允许全部条目</label><label class="chk" style="margin-top:8px"><input type="checkbox" id="ma-write" ' + (agent.write ? 'checked' : '') + '> 允许写入（Agent 写 API /agent/items/save）</label><div class="row" style="margin-top:14px"><button class="primary" id="ma-save">保存</button><button class="danger" id="ma-oauth-revoke">撤销 OAuth 授权</button></div>')
    $('ma-save').onclick = () => saveAgentFromModal(name)
    wireAgentActions(name)
    $('ma-oauth-revoke').onclick = async () => { if (!(await askYes('撤销 ' + name + ' 的 OAuth token？'))) return; try { await api('/api/oauth/revoke', { method: 'POST', body: JSON.stringify({ agent: name }) }); show('modal', false); await refreshAll(); toast('已撤销') } catch (error) { toast(error.message, true) } }
    return
  }
  openModal('Agent「' + name + '」', '<div class="hint">绑定账户：<code>' + esc(agent.account || '未绑定（旧数据）') + '</code>。Agent 只能读取该账户；切换账户后旧 Agent 不会自动获得新账户权限。</div><label class="field">名称（标识）</label><input id="ma-realname" value="' + esc(agent.name) + '"><label class="field">显示名</label><input id="ma-alias" value="' + esc(agent.alias || '') + '"><label class="field">备注</label><input id="ma-note" value="' + esc(agent.note || '') + '">' + agentPermFields(agent) + '<label class="chk"><input type="checkbox" id="ma-allowall" ' + (agent.allowAll ? 'checked' : '') + '> 允许全部条目</label><label class="chk" style="margin-top:8px"><input type="checkbox" id="ma-write" ' + (agent.write ? 'checked' : '') + '> 允许写入（Agent 写 API /agent/items/save）</label><div class="row" style="margin-top:14px"><button class="primary" id="ma-save">保存权限</button><button id="ma-copy">复制 token</button><button id="ma-rotate">轮换 token</button><button id="ma-extend">延长授权</button><button class="danger" id="ma-delete">删除</button></div><div class="secret hidden" id="ma-token"></div>')
  $('ma-save').onclick = () => saveAgentFromModal(name)
  wireAgentActions(name)
  $('ma-extend').onclick = () => openExtendMenu(name)
  $('ma-copy').onclick = async () => { try { const data = await api('/api/agents/token', { method: 'POST', body: JSON.stringify({ name }) }); $('ma-token').textContent = data.token; $('ma-token').classList.remove('hidden'); await navigator.clipboard.writeText(data.token); toast('token 已复制') } catch (error) { toast(error.message, true) } }
  $('ma-rotate').onclick = async () => { if (!(await askYes('轮换 ' + name + ' 的 token？旧 token 会立即失效。'))) return; try { const data = await api('/api/agents/rotate', { method: 'POST', body: JSON.stringify({ name }) }); $('ma-token').textContent = data.token; $('ma-token').classList.remove('hidden'); await navigator.clipboard.writeText(data.token); await refreshAll(); toast('已轮换并复制新 token') } catch (error) { toast(error.message, true) } }
  $('ma-delete').onclick = async () => { if (!(await askYes('删除 Agent ' + name + '？'))) return; try { await api('/api/agents/delete', { method: 'POST', body: JSON.stringify({ name }) }); show('modal', false); await refreshAll(); toast('已删除') } catch (error) { toast(error.message, true) } }
}
function openGrantMenu(agent, name) {
  const grant = (app.data.grants || []).find((entry) => entry.agent === agent && entry.name === name); if (!grant) return
  const seconds = !grant.expiresAt ? 0 : Math.max(0, Math.round((grant.expiresAt - Date.now()) / 1000))
  const nearest = !grant.expiresAt ? 0 : ([3600, 86400, 604800, 2592000].find((value) => seconds <= value) || 0)
  const usage = (app.data.audit || []).filter((entry) => entry.agent === agent && entry.name === name).slice(0, 15)
  const usageHtml = '<div class="hint" style="margin-bottom:8px">创建：' + (grant.createdAt ? new Date(grant.createdAt).toLocaleString('zh-CN', { hour12: false }) : '-') + ' · 已读：' + (grant.reads ?? 0) + ' 次 · 到期：' + (grant.expiresAt ? new Date(grant.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '永久') + '</div><div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:12px"><b>使用记录</b>' + (usage.length ? '<table><tr><th>时间</th><th>动作</th><th>方式</th></tr>' + usage.map((entry) => '<tr><td>' + esc(entry.time ? new Date(entry.time).toLocaleString('zh-CN', { hour12: false }) : '') + '</td><td>' + esc(describeEvent(entry)) + '</td><td>' + esc(entry.mode || entry.source || '') + '</td></tr>').join('') + '</table>' : '<div class="hint">暂无记录</div>') + '</div>'
  openModal('授权「' + agent + ' → ' + name + '」', usageHtml + '<label class="field">时长</label><select id="mg-seconds"><option value="3600" ' + (nearest === 3600 ? 'selected' : '') + '>1 小时</option><option value="86400" ' + (nearest === 86400 ? 'selected' : '') + '>24 小时</option><option value="604800" ' + (nearest === 604800 ? 'selected' : '') + '>7 天</option><option value="2592000" ' + (nearest === 2592000 ? 'selected' : '') + '>30 天</option><option value="0" ' + (nearest === 0 ? 'selected' : '') + '>永久</option></select><label class="field">最多读取次数（留空不限）</label><input id="mg-max" type="number" min="1" value="' + (grant.maxReads ?? '') + '"><div class="row" style="margin-top:14px"><button class="primary" id="mg-save">保存授权</button>' + (grant.revokedAt || (grant.expiresAt && grant.expiresAt <= Date.now()) || (grant.maxReads && (grant.reads ?? 0) >= grant.maxReads) ? '<button id="mg-restore">恢复授权</button>' : '') + '<button class="danger" id="mg-revoke">撤销</button><button class="danger" id="mg-delete">删除记录</button></div>')
  $('mg-save').onclick = async () => { try { await api('/api/grants/update', { method: 'POST', body: JSON.stringify({ agent, name, seconds: Number($('mg-seconds').value), maxReads: $('mg-max').value || null }) }); show('modal', false); await refreshAll(); toast('已更新授权') } catch (error) { toast(error.message, true) } }
  if ($('mg-restore')) $('mg-restore').onclick = async () => { try { await api('/api/grants/restore', { method: 'POST', body: JSON.stringify({ agent, name, seconds: Number($('mg-seconds').value) }) }); show('modal', false); await refreshAll(); toast('已恢复授权') } catch (error) { toast(error.message, true) } }
  $('mg-revoke').onclick = async () => { try { await api('/api/grants/revoke', { method: 'POST', body: JSON.stringify({ agent, name }) }); show('modal', false); await refreshAll(); toast('已撤销') } catch (error) { toast(error.message, true) } }
  $('mg-delete').onclick = async () => { if (!(await askYes('删除这条授权记录？'))) return; try { await api('/api/grants/delete', { method: 'POST', body: JSON.stringify({ agent, name }) }); show('modal', false); await refreshAll(); toast('已删除') } catch (error) { toast(error.message, true) } }
}
async function loadProfile() {
  try {
    const data = await api('/api/profile'); const profile = data.profile || {}
    $('profile-name').value = profile.name || ''; $('profile-email').value = profile.email || profile.oidcEmail || ''; $('profile-avatar').value = profile.avatarUrl || ''
    const logins = (app.data.audit || []).filter((entry) => ['admin.login', 'admin.oidc-login', 'vault.unlock', 'admin.logout'].includes(entry.event)).slice(0, 12)
    $('login-history').innerHTML = '<div class="hint">当前在线：' + (app.me?.unlocked ? '本浏览器已解锁' : '本浏览器未解锁') + '</div>' + (logins.length ? '<table><tr><th>时间</th><th>事件</th><th>方式</th></tr>' + logins.map((entry) => '<tr><td>' + esc(entry.time ? new Date(entry.time).toLocaleString('zh-CN', { hour12: false }) : '') + '</td><td>' + esc(entry.event) + '</td><td>' + esc(entry.source || entry.channel || '') + '</td></tr>').join('') + '</table>' : '<div class="hint">暂无登录记录</div>')
    try {
      const data = await api('/api/sessions')
      const sessions = data.sessions || []
      $('sessions-box').innerHTML = sessions.length ? '<table><tr><th>客户端</th><th>IP</th><th>创建</th><th>最后活跃</th><th>操作</th></tr>' + sessions.map((session) => '<tr><td class="hint" title="' + esc(session.ua || '') + '">' + esc(uaLabel(session.ua)) + (session.current ? ' <b>(当前)</b>' : '') + '</td><td class="hint">' + esc(session.ip || '-') + '</td><td class="hint">' + esc(session.createdAt ? new Date(session.createdAt).toLocaleString('zh-CN', { hour12: false }) : '-') + '</td><td class="hint">' + esc(session.lastSeen ? new Date(session.lastSeen).toLocaleString('zh-CN', { hour12: false }) : '-') + '</td><td>' + (session.current ? '' : '<button class="small danger" data-revoke-session="' + esc(session.id) + '">下线</button>') + '</td></tr>').join('') + '</table>' : '<div class="hint">没有可管理的会话（旧版登录或服务端未记录）</div>'
    } catch {} 
    renderAvatar(profile.name || profile.oidcName || profile.email || profile.oidcEmail, profile.avatarUrl)
    $('who').textContent = profile.name || profile.oidcName || profile.email || profile.oidcEmail || $('who').textContent
    // Every provider is listed on its own, with its own bind and unbind.
    const providerRows = []
    for (const provider of data.oidcProviders || []) {
      const binding = data.oidcBindings ? data.oidcBindings[provider.id] : null
      providerRows.push('<div class="row" style="justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)">')
      providerRows.push('<div><b>' + esc(provider.label || provider.id) + '</b> <span class="hint">' + esc(provider.issuer || '') + '</span>')
      if (binding) providerRows.push('<br><span class="hint">已绑定：<code>' + esc(binding.email || binding.sub) + '</code></span>')
      providerRows.push('</div><div>')
      if (!binding) providerRows.push('<a class="link-button primary" href="/oidc/login?provider=' + encodeURIComponent(provider.id) + '&next=profile&prompt=login">绑定</a>')
      else providerRows.push('<button class="danger" data-oidc-unbind="' + esc(provider.id) + '">解绑</button>')
      providerRows.push('</div></div>')
    }
    const oidc = data.oidcEnabled
      ? '<div class="hint">可以绑定多个身份服务商，每个单独绑定、单独解绑。用主密码解锁一次保险库后，OIDC 登录会自动解锁；点「锁定」会撤销这个行为。旧版绑定没有记住所属账户，重新绑定一次即可启用。</div>' + (providerRows.join('') || '<div class="hint">还没有可用的身份服务商。</div>')
      : '<div class="hint">未配置 OIDC。先在「设置」里添加身份服务商。</div>'
    $('oidc-box').innerHTML = oidc
    for (const button of $('oidc-box').querySelectorAll('[data-oidc-unbind]')) button.onclick = async () => {
      const id = button.getAttribute('data-oidc-unbind')
      if (!(await askYes('解绑这个身份服务商？下次登录会重新绑定。'))) return
      try { await api('/api/profile/oidc/bindings', { method: 'DELETE', body: JSON.stringify({ id }) }); await loadProfile(); toast('已解绑') } catch (error) { status('oidc-status', error.message, 'error') }
    }
    await loadSecurity()
  } catch (error) { status('profile-status', error.message, 'error') }
}
async function saveProfile() { try { const name = $('profile-name').value.trim(); const email = $('profile-email').value.trim(); const avatarUrl = $('profile-avatar').value.trim(); await api('/api/profile', { method: 'POST', body: JSON.stringify({ name, email, avatarUrl }) }); status('profile-status', '已保存', 'ok'); $('who').textContent = name || email.split('@')[0] || $('who').textContent; renderAvatar(name || email, avatarUrl) } catch (error) { status('profile-status', error.message, 'error') } }
async function switchAccount() { const email = $('vault-email').value; if (!email) return; if (!(await askYes('切换到 ' + email + '？当前解锁会话会被清除，需要用该账户主密码重新解锁。'))) return; try { status('settings-status', '切换中…'); await api('/api/settings', { method: 'POST', body: JSON.stringify({ vaultEmail: email }) }); status('settings-status', '已切换，请重新解锁', 'ok'); await boot() } catch (error) { status('settings-status', error.message, 'error') } }
async function saveFolder() { const folder = $('vault-folder').value; try { status('vault-folder-status', '保存中…'); await api('/api/settings', { method: 'POST', body: JSON.stringify({ vaultFolder: folder }) }); status('vault-folder-status', folder ? '已保存，只读取：' + folder : '已保存，读取全部文件夹', 'ok'); await Promise.all([loadItems(), loadSettings()]) } catch (error) { status('vault-folder-status', error.message, 'error') } }
async function loadSecurity() {
  try {
    const data = await api('/api/security'); $('password-source').textContent = data.passwordSource === 'custom' ? '当前使用自定义密码（保存在 Durable Object）' : '当前使用环境变量 ADMIN_PASSWORD，修改后会保存自定义密码'
    $('totp-status').textContent = data.totpEnabled ? '已启用两步验证' : '未启用'
    $('totp-disable').classList.toggle('hidden', !data.totpEnabled)
    const settings = await api('/api/settings').catch(() => ({}))
    $('mat-paths').value = (settings.materializePaths ?? []).join('\n')
    $('bs-web').checked = settings.webPlaintext === true
    $('bs-unclassified').checked = settings.unclassifiedPlaintext === true
    $('bs-target').checked = settings.useAnyTarget === true
  } catch (error) { status('profile-status', error.message, 'error') }
}
async function changePassword() { try { await api('/api/security/password', { method: 'POST', body: JSON.stringify({ currentPassword: $('current-password').value, newPassword: $('new-password').value }) }); $('current-password').value = ''; $('new-password').value = ''; status('password-status', '密码已修改', 'ok'); await loadSecurity() } catch (error) { status('password-status', error.message, 'error') } }
async function setup2fa() { try { const data = await api('/api/2fa/setup', { method: 'POST' }); $('totp-secret').textContent = data.secret; $('totp-setup-box').classList.remove('hidden'); status('totp-message', '把密钥加入验证器后输入验证码', 'ok') } catch (error) { status('totp-message', error.message, 'error') } }
async function enable2fa() { try { await api('/api/2fa/enable', { method: 'POST', body: JSON.stringify({ code: $('totp-enable-code').value }) }); $('totp-setup-box').classList.add('hidden'); $('totp-enable-code').value = ''; status('totp-message', '两步验证已启用', 'ok'); await loadSecurity() } catch (error) { status('totp-message', error.message, 'error') } }
async function disable2fa() { const password = prompt('输入当前登录密码以关闭两步验证'); if (password === null) return; try { await api('/api/2fa/disable', { method: 'POST', body: JSON.stringify({ password }) }); status('totp-message', '两步验证已关闭', 'ok'); await loadSecurity() } catch (error) { status('totp-message', error.message, 'error') } }
// Replaced by the create modal (openAgentCreate). Kept as a thin alias so any
// stale inline handler still works.
async function createAgent() { openAgentCreate() }
boot()
</script></body></html>`
