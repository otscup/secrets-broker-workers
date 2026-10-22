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
html[data-theme="dark"] .card,html[data-theme="dark"] .kpi{box-shadow:none;background:#151f31}
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
.avatar{width:30px;height:30px;border-radius:50%;background:var(--card);color:var(--text);display:grid;place-items:center;font-size:11px;border:1px solid var(--line);padding:0;line-height:0;cursor:pointer;overflow:hidden;flex:0 0 auto}
.avatar img{display:block;width:100%;height:100%;object-fit:cover;border-radius:50%}
.theme-switch{display:flex;gap:2px;background:transparent;border:0;padding:0;margin-left:auto}
.theme-cycle{border:0;background:transparent;font-size:16px;line-height:1;padding:4px 6px;border-radius:8px;cursor:pointer;flex:0 0 auto;opacity:.7}
.theme-cycle:hover{background:var(--btn);opacity:1}
nav .icon-btn{width:30px;height:30px;margin-left:4px}
.user .email{display:none}
.user .who-name{display:inline;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.icon-btn{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;color:var(--muted);border:0;background:transparent;text-decoration:none}
.icon-btn:hover{color:var(--text);background:transparent}
.theme-switch button{border:0;background:transparent;border-radius:7px;padding:4px 6px;font-size:13px;cursor:pointer;opacity:.45}
.theme-switch button.on{background:transparent;opacity:1}
.account-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:60;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px;min-width:160px;max-width:min(220px,calc(100vw - 24px));box-shadow:0 12px 30px rgba(15,23,42,.16)}
.account-menu button{display:block;width:100%;text-align:left;background:transparent;border-radius:8px;padding:8px 10px;font-size:13px}
.account-menu button:hover{background:var(--btn)}
html[data-theme="dark"]{--bg:#0b1220;--card:#111a2b;--line:#24324a;--text:#e6edf7;--muted:#8fa1bd;--btn:#1b2940;--ok:#20b8a6}
html[data-theme="dark"] body{background:var(--bg);color:var(--text)}
html[data-theme="dark"] .kpi,html[data-theme="dark"] .seg,html[data-theme="dark"] input,html[data-theme="dark"] select,html[data-theme="dark"] textarea,html[data-theme="dark"] .account-menu,html[data-theme="dark"] .donut-center{background:var(--card);color:var(--text)}
html[data-theme="dark"] nav button.active{background:#1b2940;color:var(--text)}
html[data-theme="dark"] tbody tr:hover td{background:#172338}
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
.notice-bar[data-level="pending"]{background:#fff4e5;border-color:#f5d9ae;color:#8a5a00}
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
.danmu-wrap{margin-top:14px}
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
.agent-row{cursor:pointer}
.agent-row:hover td{background:#f8fafc}
.agent-health{font-size:12px;padding:3px 8px;border-radius:999px}
.agent-health.ok{background:#e8f7f3;color:#0f9d8a}
.agent-health.warn{background:#fff4e5;color:#c2760b}
.agent-health.bad{background:#fdecec;color:var(--danger)}
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
.pill{display:inline-block;background:#eef7f5;color:#0b7d6d;border-radius:999px;padding:1px 8px;font-size:11px;border:0;cursor:pointer}.pill:hover{background:#dff3ee}.pill.off{background:#f3f4f6;color:var(--muted)}
.link-button{display:inline-block;border-radius:10px;padding:9px 13px;text-decoration:none;font-size:14px}
.link-button.primary{background:var(--ok);color:#fff}
.donut-wrap{display:flex;gap:12px;align-items:flex-start;flex-wrap:nowrap;min-width:0;overflow:hidden}.donut-svg{position:relative;width:140px;height:140px;flex:0 0 auto;max-width:45%;align-self:flex-start}.donut-svg svg{width:140px;height:140px;transform:rotate(-90deg)}.donut-svg .donut-center{inset:31px}.donut-center{position:absolute;inset:25px;background:#fff;border-radius:50%;display:grid;place-items:center;font-weight:650;font-size:17px;text-align:center;padding:6px}.legend{font-size:12px}.legend div{display:flex;justify-content:space-between;gap:18px;margin:5px 0;cursor:pointer;border-radius:6px;padding:2px 4px}.legend div.active{background:var(--btn);font-weight:600}.dot{display:inline-block;width:8px;height:8px;border-radius:99px;margin-right:6px}
.legend{font-size:12px;flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;align-content:flex-start;overflow-y:auto;max-height:100%;scrollbar-width:none;-ms-overflow-style:none}.legend::-webkit-scrollbar{width:0;height:0;display:none}.legend div{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;cursor:pointer;border-radius:6px;padding:1px 4px;min-width:0;width:100%}.legend div span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.legend div b{flex:0 0 auto;font-weight:500}.dot{display:inline-block;width:8px;height:8px;border-radius:99px;margin-right:6px;flex:0 0 auto}.legend-pager{display:flex;gap:6px;justify-content:flex-end;align-items:center;margin-top:4px;font-size:11px;color:var(--muted)}.legend-pager button{border:1px solid var(--line);background:var(--card);border-radius:6px;padding:1px 7px;font-size:11px;cursor:pointer}
.recent .rowline{display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--line);font-size:12px}.recent .rowline:last-child{border-bottom:0}.recent .ev{color:var(--muted);white-space:nowrap}
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
.card,.kpi{border-radius:20px!important;box-shadow:0 1px 2px rgba(20,40,80,.04),0 8px 24px rgba(20,40,80,.04)!important}
html[data-theme="dark"] .card,html[data-theme="dark"] .kpi{box-shadow:none!important;background:#151f31}
@media(max-width:860px){.kpis{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}}@media(max-width:620px){.user .email{display:none}}
@media(max-width:720px){.wrap{padding:14px 12px}header{gap:8px}h1{font-size:18px}nav{order:3;width:100%;overflow-x:auto;margin-left:0;padding-bottom:2px}nav button{flex:0 0 auto}.user-wrap{margin-left:0}.theme-switch{margin-left:auto}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.card{padding:14px}.row>*{min-width:100%}.row button{width:100%}.modal{padding:8px}.modal .card{max-height:calc(100vh - 16px);padding:16px}.chart{overflow-x:auto}table{font-size:12px}th,td{padding:6px}}
</style></head><body><div class="wrap">
<header><img id="site-logo" src="/logo.png" alt="" style="width:30px;height:30px;border-radius:8px;object-fit:cover;cursor:pointer"><h1 id="site-title" style="cursor:pointer">Secrets Broker</h1><span class="badge">Cloudflare Workers</span>
<button id="theme-cycle" class="theme-cycle" title="切换主题：浅色 / 深色 / 跟随系统">☀️</button>
<nav id="nav"><button data-view="overview" class="active">概览</button><button data-view="items">密钥</button><button data-view="agents">Agents</button><button data-view="grants">授权</button><button data-view="logs">日志</button><a class="icon-btn" href="https://github.com/otscup/secrets-broker-workers" target="_blank" rel="noreferrer" title="GitHub"><svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg></a></nav>
<button id="page-refresh" class="small" title="刷新当前页面">刷新</button>
<div class="user-wrap"><span class="user"><span class="who-name" id="who"></span><button id="avatar" class="avatar" title="账户">SB</button></span>
<div id="account-menu" class="account-menu hidden"><button data-view="profile">个人资料</button><button data-view="settings">系统设置</button><button id="account-logout">退出登录</button><button id="lock" class="danger">锁定</button></div></div>
</header>

<section id="login-card" class="card hidden">
  <h2>管理登录</h2><div class="hint">管理登录密码（不是 Agent token，也不是 Bitwarden 主密码）。</div>
  <label class="field">管理登录密码</label><input id="admin-password" type="password" autocomplete="current-password">
  <div id="totp-row" class="hidden"><label class="field">两步验证码</label><input id="totp-code" inputmode="numeric" placeholder="6 位验证码"></div>
  <div style="margin-top:12px"><button class="primary" id="login">登录</button></div><div class="status" id="login-status"></div><div id="login-oidc" style="margin-top:10px"></div>
</section>

<section id="unlock-card" class="card hidden">
  <h2>解锁 vault</h2><div class="hint">主密码只在本浏览器中做 PBKDF2/HKDF，服务器只收到派生出的会话密钥，不会收到主密码。</div>
  <label class="field">Bitwarden 主密码</label><input id="master-password" type="password" autocomplete="current-password">
  <label class="field">解锁有效期</label><select id="ttl"><option value="permanent">永久（可手动锁定）</option><option value="604800">7 天</option><option value="86400">24 小时</option><option value="3600">1 小时</option></select>
  <div class="row" style="margin-top:12px"><button class="primary" id="unlock">解锁</button><button id="lock2">锁定</button></div><div class="status" id="unlock-status"></div>
</section>

<section id="dashboard" class="hidden">
  <section id="view-overview" class="view">
    <div class="toolbar"><div class="seg" id="range-row"><button data-range="24h" class="on">24 小时</button><button data-range="7d">7 天</button><button data-range="30d">30 天</button></div><span class="spacer"></span><span class="hint" id="updated"></span></div>
    <div id="notice-bar" class="notice-bar hidden" role="button" tabindex="0" title="点击查看全部通知"></div>
    <div id="kpis" class="kpis"></div>
    <div class="grid3">
      <div class="card"><h2>读取趋势</h2><div class="hint" style="margin-bottom:6px">按时间聚合 · 悬停查看数值</div><div id="chart-box" class="trend-box"></div></div>
      <div class="card" id="globe-card">
        <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
          <h2 style="margin:0">Agent Live Globe</h2>
          <span class="hint globe-note" title="IP 估算位置，不代表实际物理位置">IP 估算</span>
        </div>
        <div id="globe-box" class="globe-box">
          <button class="small globe-expand" id="globe-full" title="放大地球">⤢</button>
          <div class="globe-empty" id="globe-empty"></div>
        </div>
        <div class="row" style="justify-content:space-between;align-items:center;margin-top:8px;gap:8px">
          <div class="seg" id="globe-range"><button data-grange="1h">1h</button><button data-grange="24h" class="on">24h</button><button data-grange="7d">7d</button><button class="small globe-pause" id="globe-pause" title="暂停动画">⏸</button></div>
        </div>
        <div class="hint" id="globe-status" style="margin-top:4px"></div>
      </div>
      <div class="card"><h2>条目读取排行</h2><div class="hint" style="margin-bottom:6px">按被读取次数排序</div><div id="top-box" class="table-wrap rank-box"></div></div>
      <div class="card"><h2>Agent 读取占比</h2><div class="hint" style="margin-bottom:6px">按 agent 聚合 · 点击扇区查看</div><div id="donut-box" class="donut-wrap"></div></div>    </div>
    <div id="chart-tip" class="chart-tip"></div>
    <div class="card"><h2>最近活动</h2><div id="recent-box" class="recent"></div></div>
  </section>

  <section id="view-items" class="view hidden"><div class="card"><h2>密钥条目</h2><div class="hint">来自 NodeWarden D1（只读），这里可以设置免审批策略和读取。</div><div class="row" style="margin-top:10px"><input id="item-filter" placeholder="搜索名称、分组或网址…"><button id="items-refresh">刷新</button><button id="item-create">新增</button><button id="item-import">导入</button><button id="item-export">导出</button><input id="import-file" type="file" accept="application/json,.json" class="hidden"></div><div id="bulk-bar" class="row hidden" style="margin-top:8px;background:var(--btn);padding:8px;border-radius:10px"><span id="bulk-count" class="hint" style="flex:0 0 auto"></span><button id="bulk-share" class="primary">批量分享</button><button id="bulk-kind" title="把选中的凭据标记为 API Key 或网站登录">批量分类</button><button class="danger" id="bulk-delete">批量删除</button><button id="bulk-clear">清除选择</button></div><div id="items-box" class="table-wrap" style="margin-top:10px"></div><div id="item-status" class="status"></div></div>
    <div class="card"><h2>已分类的凭据</h2><div class="hint">点列表里的 ⋮ 打开条目即可逐个设置，或勾选多个后点「批量分类」。标为 <b>api</b>（API Key）可按需允许 Agent 读取明文；标为 <b>web</b>（网站登录）只能被填充到指定网站，Agent 永远拿不到明文。<b>未分类的凭据保持旧版授权行为</b>，Agent 仍可能直接读到明文。</div><div class="hint" id="fp-exec-note" style="margin-top:6px"></div><div id="fp-list" class="table-wrap" style="margin-top:10px"></div></div>
    
  </section>

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
        </select>
      </div>
      <div id="agents-box" class="table-wrap" style="margin-top:10px"></div>
      <div class="status" id="agent-status"></div>
    </div>
  </section>

  <section id="view-grants" class="view hidden">
    <div class="card" id="transfers-card"><h2>待复制到其他账户</h2><div class="hint">主账户分享后先进入队列；切回目标账户并解锁后自动复制到指定文件夹并生成授权。</div><div id="transfers-box" class="table-wrap" style="margin-top:10px"></div></div>
    <div class="card"><h2>待批准请求</h2><div class="hint">点按钮即授权；同 Docker 版的 once/1h/24h/7d/永久。</div><div id="pending-box" class="table-wrap" style="margin-top:10px"></div></div>
    <div class="card"><h2>有效授权</h2><div class="hint">过期的授权会显示「已过期」，点该行的时长即可延期。</div><div id="grants-box" class="table-wrap"></div></div>
    <div class="card"><h2>OAuth 客户端</h2><div class="hint">每个连接（Muse、Codex、ChatGPT 等）在首次授权时会注册一个客户端。重复或失效的注册可以逐个撤销，撤销会同时清除它的 token。</div><div id="oauth-clients-box" class="table-wrap" style="margin-top:10px"></div></div>
  </section>

  <section id="view-logs" class="view hidden"><div class="card"><h2>审计日志</h2><div class="hint">最近 500 条，数据在 Durable Object 中。</div><div id="logs-box" class="table-wrap" style="margin-top:10px"></div></div></section>

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
    <div class="card"><h2>在线客户端与登录记录</h2><div class="hint">当前浏览器会话在解锁后保持在线；最近登录来自审计记录。</div><div id="sessions-box" style="margin-top:10px"></div><div id="login-history" style="margin-top:10px"></div></div>
  </section>

  <section id="view-settings" class="view hidden">
    <div class="card"><h2>站点</h2><label class="field">站点名称</label><input id="site-name" placeholder="Secrets Broker"><div class="hint">显示在左上角，点击可回首页。</div></div>
    <div class="card"><h2>明文读取策略</h2><div class="hint">未被分类的凭据，Agent 拿到授权后还能不能读到明文。<b>关掉这个开关等于放行</b>：任何没标成 api 或 web 的密钥都可以被 Agent 读取明文，这正是分类要解决的问题。</div><label class="chk" style="margin-top:10px"><input type="checkbox" id="require-classification"> 未分类的凭据拒绝明文读取（推荐开启）</label><div class="row" style="margin-top:10px"><button class="primary" id="require-classification-save">保存</button></div><div class="status" id="require-classification-status"></div></div>
    <div class="card collapsible collapsed" id="card-notify-channels"><h2 class="card-toggle" data-collapse="card-notify-channels">通知渠道 <span class="card-caret">▸</span></h2><div class="hint">待批准请求会推送到这里。留空的 token 表示保留原值。</div>
      <div class="card-body">
      <div class="grid2" style="margin-top:10px">
        <div><h2 style="font-size:13px">Telegram</h2><label class="field">Bot Token</label><input id="tg-token" type="password" placeholder="留空保留原值"><label class="field">Chat ID</label><input id="tg-chat" placeholder="例如 123456789"><div class="hint" id="tg-status"></div></div>
        <div><h2 style="font-size:13px">ntfy</h2><label class="field">服务器 URL</label><input id="ntfy-url" placeholder="https://ntfy.example.com"><label class="field">Topic</label><input id="ntfy-topic" placeholder="secrets-broker-xxxx"><div class="hint" id="ntfy-status"></div></div>
        <div><h2 style="font-size:13px">Gotify</h2><label class="field">服务器 URL</label><input id="gotify-url" placeholder="https://gotify.example.com"><label class="field">App Token</label><input id="gotify-token" type="password" placeholder="留空保留原值"><div class="hint" id="gotify-status"></div></div>
        <div><h2 style="font-size:13px">Webhook（通用 / 兼容 wxpush）</h2><label class="field">URL</label><input id="wxpush-url" placeholder="https://example.com/webhook"><label class="field">Token</label><input id="wxpush-token" type="password" placeholder="留空保留原值"><label class="field">发送格式</label><select id="wxpush-format"><option value="form">表单（wxpush 兼容）</option><option value="json">JSON + Bearer Token</option></select><div class="hint" id="wxpush-status"></div></div>
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
    <div class="card"><h2>浏览器通知</h2><div class="hint" id="browser-notify-status"></div><div style="margin-top:10px"><button id="enable-browser-notify">启用浏览器通知</button><button id="test-browser-notify">发送测试通知</button></div></div>
    <div class="card"><h2>MCP 接入</h2><div class="hint">HTTP MCP 地址（用 Agent Bearer token）：</div><div class="secret" id="mcp-url"></div><div class="hint" style="margin-top:8px">工具：list_secrets / request_access / get_secret。Codex、Hermes 可直接配置 HTTP MCP。</div></div>
  </section>
</section>

</div>
<div id="toast" class="toast"></div>
<div id="modal" class="modal hidden"><div class="card"><button class="modal-x" id="modal-close-x" title="关闭">×</button><h2 id="modal-title"></h2><div id="modal-body"></div><div style="margin-top:12px"><button id="modal-close">关闭</button></div></div></div>
<script>
const $ = (id) => document.getElementById(id)
const enc = new TextEncoder()
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const cat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out }
async function hmac(keyBytes, data) { const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', key, data)) }
async function pbkdf2(password, salt, iterations) { const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256)) }
async function hkdf(prk, info, length) { const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const infoBytes = enc.encode(info); const out = new Uint8Array(length); let prev = new Uint8Array(0), offset = 0, counter = 1; while (offset < length) { const input = new Uint8Array(prev.length + infoBytes.length + 1); input.set(prev); input.set(infoBytes, prev.length); input[input.length - 1] = counter; prev = new Uint8Array(await crypto.subtle.sign('HMAC', key, input)); const n = Math.min(prev.length, length - offset); out.set(prev.slice(0, n), offset); offset += n; counter++ } return out }
async function decryptBw(text, encKey, macKey) { const dot = text.indexOf('.'); const type = Number(text.slice(0, dot)); const parts = text.slice(dot + 1).split('|'); const iv = unb64(parts[0]), ct = unb64(parts[1]); if (type === 2) { const expected = await hmac(macKey, cat(iv, ct)); const mac = unb64(parts[2]); if (!expected.every((b, i) => b === mac[i])) throw new Error('MAC 校验失败') } const key = await crypto.subtle.importKey('raw', encKey, { name: 'AES-CBC' }, false, ['decrypt']); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct)) }
async function api(path, options = {}) { const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(body.error || ('HTTP ' + response.status)); error.status = response.status; error.data = body; throw error } return body }
const DEFAULT_LOGO = '/logo.png'
let app = { me: null, data: { agents: [], policies: {}, grants: [], pending: [], audit: [] }, items: [], stats: null, range: '24h', token: '' }
const selectedItems = new Set()
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const status = (id, text, cls = '') => { const el = $(id); if (el) { el.textContent = text; el.className = 'status ' + cls } }
function show(id, visible) { $(id).classList.toggle('hidden', !visible) }
let toastTimer = null
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

function renderAvatar(name, avatarUrl) { const el = $('avatar'); if (!el) return; const url = avatarUrl || DEFAULT_LOGO; if (url) { el.innerHTML = '<img src="' + esc(url) + '" alt="">'; el.firstChild.onerror = () => { el.textContent = String(name || 'SB').slice(0, 2).toUpperCase() } } else el.textContent = String(name || 'SB').slice(0, 2).toUpperCase() }
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
$('login').onclick = async () => { try { status('login-status', '登录中…'); await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('admin-password').value, code: $('totp-code').value }) }); $('admin-password').value = ''; $('totp-code').value = ''; show('totp-row', false); await boot() } catch (error) { if (error.status === 401 && error.data?.totpRequired) { show('totp-row', true); status('login-status', error.data.error || '请输入两步验证码', 'error') } else status('login-status', error.message, 'error') } }
$('avatar').onclick = (event) => { event.stopPropagation(); show('account-menu', $('account-menu').classList.contains('hidden')) }
document.addEventListener('click', (event) => { if (!$('account-menu').classList.contains('hidden') && !event.target.closest('#account-menu') && !event.target.closest('#avatar')) show('account-menu', false) })
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke-session]'); if (!button) return
  if (!confirm('强制下线这个客户端？')) return
  try { await api('/api/sessions/revoke', { method: 'POST', body: JSON.stringify({ id: button.dataset.revokeSession }) }); await loadProfile(); toast('已下线') } catch (error) { toast(error.message, true) }
})
$('account-logout').onclick = async () => { try { await api('/api/logout', { method: 'POST' }) } catch {} location.reload() }
document.querySelectorAll('#account-menu [data-view]').forEach((button) => { button.onclick = () => { show('account-menu', false); document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', false)); document.querySelectorAll('.view').forEach((section) => section.classList.toggle('hidden', section.id !== 'view-' + button.dataset.view)); if (button.dataset.view === 'settings') loadSettings(); if (button.dataset.view === 'profile') loadProfile() } })
function applyTheme(mode) { const next = mode || localStorage.getItem('theme') || 'light'; const effective = next === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (next === 'dark' ? 'dark' : 'light'); document.documentElement.dataset.theme = effective; localStorage.setItem('theme', next); const button = $('theme-cycle'); if (button) { button.textContent = next === 'light' ? '☀️' : next === 'dark' ? '🌙' : '💻'; button.title = '当前：' + (next === 'light' ? '浅色' : next === 'dark' ? '深色' : '跟随系统') + '（点击切换）' } }
$('theme-cycle').onclick = () => { const current = localStorage.getItem('theme') || 'auto'; applyTheme(current === 'light' ? 'dark' : current === 'dark' ? 'auto' : 'light') }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((localStorage.getItem('theme') || 'auto') === 'auto') applyTheme('auto') })
applyTheme()
$('unlock').onclick = async () => {
  const password = $('master-password').value; if (!password) return
  status('unlock-status', '正在浏览器本地派生密钥…（约 0.3–1 秒）')
  try {
    const info = await api('/api/bootstrap'); if (info.kdfType !== 0) throw new Error('暂不支持 Argon2 KDF')
    const masterKey = await pbkdf2(password, String(info.email).toLowerCase(), info.kdfIterations)
    const encKey = await hkdf(masterKey, 'enc', 32), macKey = await hkdf(masterKey, 'mac', 32)
    const userKey = await decryptBw(info.profileKey, encKey, macKey)
    await api('/api/unlock', { method: 'POST', body: JSON.stringify({ symEncKey: b64(userKey.slice(0, 32)), symMacKey: b64(userKey.slice(32, 64)), ttl: $('ttl').value }) })
    $('master-password').value = ''; status('unlock-status', '已解锁', 'ok'); show('unlock-card', false); show('dashboard', true); await loadAll()
  } catch (error) { status('unlock-status', error.message, 'error') }
}
async function lock() {
  const password = prompt('锁定后：当前 vault 会话会被清除，所有 Agent 立即无法读取；再次使用需要用该账户主密码重新解锁。\n\n请输入管理密码确认锁定：')
  if (password === null) return
  try {
    await api('/api/lock', { method: 'POST', body: JSON.stringify({ password }) })
    show('dashboard', false); show('unlock-card', true); status('unlock-status', '已锁定，需要重新解锁才能读取', 'ok')
  } catch (error) { toast(error.message, true) }
}
$('lock').onclick = lock; $('lock2').onclick = lock
document.querySelectorAll('#nav button').forEach((button) => { button.onclick = () => { const view = button.dataset.view; document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b === button)); document.querySelectorAll('.view').forEach((section) => section.classList.toggle('hidden', section.id !== 'view-' + view)); if (view === 'settings') loadSettings(); if (view === 'profile') loadProfile() } })
document.querySelectorAll('#range-row button').forEach((button) => { button.onclick = () => { app.range = button.dataset.range; document.querySelectorAll('#range-row button').forEach((b) => b.classList.toggle('on', b === button)); loadStats() } })
$('items-refresh').onclick = loadItems; $('item-filter').oninput = renderItems; $('item-create').onclick = createItemMenu; $('item-import').onclick = () => $('import-file').click(); $('import-file').onchange = importItems; $('item-export').onclick = exportItems; $('bulk-share').onclick = openBulkShare; $('bulk-kind').onclick = openBulkKind; $('bulk-delete').onclick = bulkDelete; $('bulk-clear').onclick = () => { selectedItems.clear(); renderItems() }; $('settings-save').onclick = saveSettings; $('require-classification-save').onclick = saveRequireClassification; $('notify-test').onclick = testNotifications; $('notify-test-approval').onclick = () => testNotifications(true); $('oidc-new').onclick = () => showOidcProviderForm(); $('op-save').onclick = saveOidcProvider; $('op-cancel').onclick = () => $('oidc-provider-form').classList.add('hidden'); $('op-discover').onclick = discoverOidcProvider; $('op-probe').onclick = probeOidcProvider; $('profile-save').onclick = saveProfile; $('password-save').onclick = changePassword; $('totp-setup').onclick = setup2fa; $('totp-enable').onclick = enable2fa; $('totp-disable').onclick = disable2fa; $('enable-browser-notify').onclick = enableBrowserNotifications; $('test-browser-notify').onclick = () => showBrowserNotification('测试通知', '浏览器通知工作正常'); $('vault-switch').onclick = switchAccount; $('vault-folder-save').onclick = saveFolder
$('mcp-url').textContent = location.origin + '/mcp'
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
$('items-box').addEventListener('click', async (event) => { const grantEdit = event.target.closest('[data-item-grant]'); if (grantEdit) { openGrantMenu(grantEdit.dataset.agent, grantEdit.dataset.name); return } const menu = event.target.closest('[data-item-menu]'); if (menu) { openItemMenu(menu.dataset.itemMenu); return } const toggle = event.target.closest('[data-policy]'); if (toggle) { const item = app.items.find((entry) => entry.name === toggle.dataset.policy); if (!item) return; try { await api('/api/policies', { method: 'POST', body: JSON.stringify({ name: item.name, noApproval: !item.noApproval }) }); await loadItems(); toast('已更新免审批策略') } catch (error) { toast(error.message, true) } return } const read = event.target.closest('[data-read]'); if (read) reveal(read.dataset.read) })
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
// Creation moved into a modal so it no longer pushes the list down.
function openAgentCreate() {
  openModal('新建 Agent', '<div class="hint">Token 只在创建后显示一次。</div>' +
    '<label class="field">名称</label><input id="ac-name" placeholder="如 dsh">' +
    '<label class="field">显示名（可选）</label><input id="ac-alias" placeholder="便于识别的名字">' +
    '<label class="field">备注（可选）</label><input id="ac-note" placeholder="用途说明">' +
    '<label class="field">可读条目（逗号分隔，留空=无权限）</label><input id="ac-allow" placeholder="item-a, item-b">' +
    '<label class="chk" style="margin-top:8px"><input type="checkbox" id="ac-allowall"> 允许全部条目</label>' +
    '<label class="chk" style="margin-top:8px"><input type="checkbox" id="ac-write"> 允许写入（可调 /agent/items/save）</label>' +
    '<div class="row" style="margin-top:14px"><button class="primary" id="ac-create">创建</button></div>' +
    '<div class="status" id="ac-status"></div><div class="secret hidden" id="ac-token"></div>')
  $('ac-create').onclick = async () => {
    const name = $('ac-name').value.trim()
    if (!name) return status('ac-status', '请输入名称', 'error')
    try {
      status('ac-status', '创建中…')
      const allow = $('ac-allow').value.split(',').map((value) => value.trim()).filter(Boolean)
      const result = await api('/api/agents/create', { method: 'POST', body: JSON.stringify({ name, alias: $('ac-alias').value.trim(), note: $('ac-note').value.trim(), allow, allowAll: $('ac-allowall').checked, write: $('ac-write').checked }) })
      $('ac-token').classList.remove('hidden')
      $('ac-token').textContent = result.token
      try { await navigator.clipboard.writeText(result.token); status('ac-status', '已创建，token 已复制到剪贴板', 'ok') } catch { status('ac-status', '已创建，请手动复制 token', 'ok') }
      await loadState()
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
    '<div><span>可读范围</span><b>' + esc(scope) + '</b></div>' +
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
    await loadState()
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
  openKpiModal(card.dataset.kpi)
})
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-kpi-decide]'); if (!button) return
  try { await api('/api/pending/decide', { method: 'POST', body: JSON.stringify({ id: button.dataset.id, decision: button.dataset.decision }) }); show('modal', false); await loadAll(); toast('已处理') } catch (error) { toast(error.message, true) }
})
$('pending-box').addEventListener('click', async (event) => { const button = event.target.closest('[data-decide]'); if (!button) return; try { await api('/api/pending/decide', { method: 'POST', body: JSON.stringify({ id: button.dataset.id, decision: button.dataset.decide }) }); await Promise.all([loadState(), loadStats(), loadItems()]); toast('已处理') } catch (error) { toast(error.message, true) } })
$('grants-box').addEventListener('click', (event) => { const menu = event.target.closest('[data-grant-menu]'); if (menu) openGrantMenu(menu.dataset.agent, menu.dataset.name) })
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
      await loadState()
    } catch (error) { toast(error.message || '重新授权失败', true) }
    return
  }
  const remove = event.target.closest('[data-legacy-delete]')
  if (remove) {
    const agent = remove.dataset.agent || ''
    const name = remove.dataset.name || ''
    if (!confirm('删除 ' + agent + ' → ' + name + ' 这条旧授权？')) return
    try {
      await api('/api/grants/delete', { method: 'POST', body: JSON.stringify({ agent, name }) })
      toast('已删除')
      await loadState()
    } catch (error) { toast(error.message || '删除失败', true) }
  }
})
$('oauth-clients-box').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-oauth-revoke]')
  if (!button) return
  const clientId = button.dataset.oauthRevoke
  if (!confirm('撤销这个 OAuth 客户端？它的 token 会立即失效，需要重新连接。')) return
  try {
    await api('/api/oauth/revoke', { method: 'POST', body: JSON.stringify({ clientId }) })
    await loadState()
    toast('已撤销')
  } catch (error) { toast(error.message, true) }
})

async function loadAll() { await Promise.all([loadState(), loadItems(), loadStats()]); startPendingPolling(); updateBrowserNotifyStatus() }
let pendingTimer = null
let knownPending = new Set()
let pendingInitialized = false
function updateBrowserNotifyStatus() { const el = $('browser-notify-status'); if (!el) return; el.textContent = typeof Notification === 'undefined' ? '此浏览器不支持通知' : '当前权限：' + Notification.permission }
function showBrowserNotification(title, body, tag) { if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return; try { const notification = new Notification(title, { body, tag }); notification.onclick = () => { window.focus(); document.querySelector('#nav [data-view=grants]').click(); notification.close() } } catch {} }
async function enableBrowserNotifications() { if (typeof Notification === 'undefined') return status('settings-status', '此浏览器不支持通知', 'error'); const permission = await Notification.requestPermission(); updateBrowserNotifyStatus(); if (permission === 'granted') { status('settings-status', '浏览器通知已启用', 'ok'); startPendingPolling() } else status('settings-status', '未获得通知权限', 'error') }
async function checkPendingNotifications() {
  try {
    const data = await api('/api/state'); const pending = data.pending || []; const ids = new Set(pending.map((entry) => entry.id))
    if (pendingInitialized) {
      for (const entry of pending) if (!knownPending.has(entry.id)) showBrowserNotification('Secrets Broker 授权请求', (entry.agent || 'Agent') + ' 请求读取「' + entry.name + '」', entry.id)
    }
    knownPending = ids; pendingInitialized = true
    if (app.data) app.data = data
    renderPending()
    if (app.stats) { app.stats.pending = pending.length; renderStats() }
  } catch {}
}
function startPendingPolling() { updateBrowserNotifyStatus(); if (pendingTimer) return; checkPendingNotifications(); pendingTimer = setInterval(checkPendingNotifications, 15000) }
let globeBooted = false
async function loadState() { try { app.data = await api('/api/state'); renderNoticeBar(); if (!globeBooted) { globeBooted = true; try { initGlobe() } catch {} } renderAgents(); renderPending(); renderGrants(); renderFillPolicies(); renderOauthClients(); renderTransfers(); renderRecent(); renderLogs(); if ((app.items || []).length) renderItems() } catch (error) { if (error.status === 423) { show('dashboard', false); show('unlock-card', true) } } }
async function loadItems() { status('item-status', '加载中…'); try { const result = await api('/api/items'); app.items = result.items || []; renderItems(); status('item-status', '共 ' + app.items.length + ' 个条目'); if (result.completedTransfers?.length) { toast('已自动复制：' + result.completedTransfers.join('、')); await loadState() } } catch (error) { if (error.status === 423) { show('dashboard', false); show('unlock-card', true) } else status('item-status', error.message, 'error') } }
async function loadStats() { try { app.stats = await api('/api/stats?range=' + app.range); renderStats() } catch {} }
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
  if (!confirm('删除这个身份服务商？已绑定的账号也会一并解绑。')) return
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
    $('tg-chat').value = n.telegram?.chatId || ''
    $('tg-status').textContent = n.telegram?.configured ? '已配置（token 已保存）' : '未配置'
    $('ntfy-url').value = n.ntfy?.url || ''; $('ntfy-topic').value = n.ntfy?.topic || ''
    $('ntfy-status').textContent = n.ntfy?.configured ? '已配置' : '未配置'
    $('gotify-url').value = n.gotify?.url || ''
    $('gotify-status').textContent = n.gotify?.configured ? '已配置（token 已保存）' : '未配置'
    $('wxpush-url').value = n.wxpush?.url || ''; $('wxpush-format').value = n.wxpush?.format || 'form'
    $('wxpush-status').textContent = n.wxpush?.configured ? '已配置（token 已保存）' : '未配置'
    const tpl = n.templates || {}; const tplAp = tpl.approval || {}; const tplLb = tplAp.labels || {}; const tplRm = tpl.reminder || {}
    $('tpl-ap-title').value = tplAp.title || ''; $('tpl-ap-body').value = tplAp.body || ''
    $('tpl-lb-once').value = tplLb.once || ''; $('tpl-lb-24h').value = tplLb['24h'] || ''; $('tpl-lb-deny').value = tplLb.deny || ''; $('tpl-lb-always').value = tplLb.always || ''
    $('tpl-rm-title').value = tplRm.title || ''; $('tpl-rm-body').value = tplRm.body || ''
    await loadOidcProviders()
    $('mcp-url').textContent = location.origin + '/mcp'
    $('vault-folder').value = data.vaultFolder || ''
    $('site-name').value = data.siteName || 'Secrets Broker'
    $('require-classification').checked = data.requireClassification !== false
    try { const folders = (await api('/api/folders')).folders || []; $('vault-folder').innerHTML = '<option value="">全部文件夹</option>' + folders.map((folder) => '<option value="' + esc(folder.name) + '">' + esc(folder.name) + '</option>').join(''); $('vault-folder').value = data.vaultFolder || ''; $('vault-folder-status').textContent = data.vaultFolder ? '当前只读取：' + data.vaultFolder : '当前读取全部文件夹' } catch { $('vault-folder-status').textContent = '需要先解锁 vault 才能读取文件夹' }
    try { const accounts = (await api('/api/accounts')).accounts || []; $('vault-email').innerHTML = accounts.map((account) => '<option value="' + esc(account.email) + '">' + esc(account.email) + '</option>').join(''); $('vault-email').value = data.vaultEmail || accounts[0]?.email || ''; $('vault-email-status').textContent = '当前账户：' + ($('vault-email').value || '-') } catch { $('vault-email-status').textContent = '无法读取账户列表' }
  } catch (error) { status('settings-status', error.message, 'error') }
}
async function saveSettings() {
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ notifications: {
      telegram: { botToken: $('tg-token').value, chatId: $('tg-chat').value },
      ntfy: { url: $('ntfy-url').value, topic: $('ntfy-topic').value },
      gotify: { url: $('gotify-url').value, token: $('gotify-token').value },
      wxpush: { url: $('wxpush-url').value, token: $('wxpush-token').value, format: $('wxpush-format').value },
      templates: {
        approval: { title: $('tpl-ap-title').value, body: $('tpl-ap-body').value, labels: { once: $('tpl-lb-once').value, '24h': $('tpl-lb-24h').value, deny: $('tpl-lb-deny').value, always: $('tpl-lb-always').value } },
        reminder: { title: $('tpl-rm-title').value, body: $('tpl-rm-body').value },
      },
  }, vaultFolder: $('vault-folder').value, siteName: $('site-name').value, vaultEmail: $('vault-email').value }) })
    $('site-title').textContent = $('site-name').value.trim() || 'Secrets Broker'
    status('settings-status', '已保存', 'ok'); await loadSettings()
  } catch (error) { status('settings-status', error.message, 'error') }
}
// A separate control, so changing it does not rewrite every notification
// channel's empty token field.
async function saveRequireClassification() {
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ requireClassification: $('require-classification').checked }) })
    status('require-classification-status', '已保存', 'ok')
  } catch (error) { status('require-classification-status', error.message, 'error') }
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
function renderStats() {
  const stats = app.stats || { totalReads: 0, activeAgents: 0, pending: 0, activeGrants: 0, buckets: [], topItems: [], topAgents: [] }
  const cards = [{ l: '读取次数', v: stats.totalReads, sub: '当前区间 · 点开查看', view: 'reads' }, { l: '活跃 Agent', v: stats.activeAgents, sub: '有读取记录', view: 'agents' }, { l: '待审批 / 通知', v: stats.pending, sub: '点开处理', warn: stats.pending > 0, view: 'pending' }, { l: '有效授权', v: stats.activeGrants, sub: '含免审批', view: 'grants' }]
  $('kpis').innerHTML = cards.map((card) => '<div class="kpi' + (card.warn ? ' warn' : '') + '" data-kpi="' + card.view + '"' + (card.event ? ' data-kpi-event="' + card.event + '"' : '') + '><div class="label">' + card.l + '</div><div class="value">' + card.v + '</div><div class="sub">' + card.sub + '</div></div>').join('')
  const buckets = stats.buckets || []; const max = Math.max(1, ...buckets.map((b) => b.count)); const W = 600, H = 180, px = 38, py = 18, iw = W - 2 * px, ih = H - 2 * py; const slot = buckets.length ? iw / buckets.length : 0; const barW = Math.max(2, Math.min(26, slot * 0.58))
  let grid = ''; for (let g = 0; g <= 4; g++) { const y = py + ih * g / 4; grid += '<line x1="' + px + '" y1="' + y + '" x2="' + (W - px) + '" y2="' + y + '" stroke="currentColor" stroke-opacity=".1"/><text x="4" y="' + (y + 3) + '" fill="currentColor" font-size="9" opacity=".5">' + Math.round(max * (4 - g) / 4) + '</text>' }
  const bars = buckets.map((bucket, index) => { const h = bucket.count / max * ih; const x = px + index * slot + (slot - barW) / 2; const y = H - py - h; return '<rect data-chart data-label="' + esc(bucket.label) + '" data-count="' + bucket.count + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(h, 0.6).toFixed(1) + '" rx="2" fill="#0f9d8a" opacity="' + (bucket.count ? 0.95 : 0.22) + '" style="cursor:pointer"/>' }).join('')
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
  const top = stats.topItems || []; const totalTop = top.reduce((sum, item) => sum + item.count, 0) || 1; const maxTop = Math.max(1, ...top.map((item) => item.count))
  $('top-box').innerHTML = top.length ? '<table><tr><th>#</th><th>条目</th><th>读取</th><th>占比</th><th>趋势</th></tr>' + top.map((item, index) => '<tr><td>' + (index + 1) + '</td><td><b>' + esc(item.name) + '</b></td><td>' + item.count + '</td><td>' + Math.round(item.count / totalTop * 100) + '%</td><td><span style="display:inline-block;height:6px;width:90px;background:#eef1f6;border-radius:99px;overflow:hidden"><i style="display:block;height:100%;width:' + Math.round(item.count / maxTop * 100) + '%;background:#0f9d8a"></i></span></td></tr>').join('') + '</table>' : '<div class="hint">该区间暂无读取记录</div>'
  $('updated').textContent = '最后更新 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })
}
function renderItems() {
  const query = ($('item-filter')?.value || '').trim().toLowerCase(); const items = (app.items || []).filter((item) => !query || item.name.toLowerCase().includes(query) || String(item.url || '').toLowerCase().includes(query) || String(item.group || '').toLowerCase().includes(query))
  // Which items are already classified, by name. The classified list is keyed
  // by id, so map it back through the item rows.
  const classified = new Set(((fillPolicyState().items) || []).map((entry) => entry.itemName).filter(Boolean))
  const guarded = (app.data && app.data.requireClassification) !== false
  $('items-box').innerHTML = items.length ? '<table><tr><th><input type="checkbox" id="select-all-items"></th><th>名称</th><th>最后活动</th><th>最后操作</th><th class="nowrap">免审批</th><th class="nowrap">有效期</th><th class="nowrap">操作</th></tr>' + items.map((item) => {
    const when = item.lastActivityAt ? relativeTime(Date.parse(item.lastActivityAt)) : '无记录'
    const who = item.lastActor || '-'
    // An unclassified credential is the one case where an agent may still read
    // plaintext, so it is flagged in red until someone labels it.
    const unclassified = !classified.has(item.name)
    const nameBadge = unclassified
      ? ' <span class="hint" style="color:var(--danger)" title="' + (guarded ? '未分类：明文读取已被拒绝，请在条目里分类' : '未分类：Agent 可能读到明文，请在条目里分类') + '">' + (guarded ? '未分类 · 禁读' : '未分类 · 可读明文') + '</span>'
      : ''
    return '<tr><td><input type="checkbox" class="item-select" data-name="' + esc(item.name) + '" ' + (selectedItems.has(item.name) ? 'checked' : '') + '></td>' +
      '<td><b>' + esc(item.name) + '</b>' + nameBadge + '</td>' +
      '<td class="hint">' + esc(when) + '</td>' +
      '<td class="hint">' + esc(who) + '</td>' +
      '<td class="nowrap"><button class="small ' + (item.noApproval ? 'primary' : '') + '" data-policy="' + esc(item.name) + '">' + (item.noApproval ? '免审批' : '需审批') + '</button></td>' +
      expiryBadge(item) +
      '<td class="actions"><button class="small" data-read="' + esc(item.name) + '">读取</button><button class="small" data-item-menu="' + esc(item.name) + '" title="更多">⋮</button></td></tr>'
  }).join('') + '</table>' : '<div class="hint">没有条目</div>'
  const all = $('select-all-items')
  if (all) all.onchange = () => { if (all.checked) items.forEach((item) => selectedItems.add(item.name)); else items.forEach((item) => selectedItems.delete(item.name)); renderItems() }
  $('items-box').querySelectorAll('.item-select').forEach((box) => { box.onchange = () => { if (box.checked) selectedItems.add(box.dataset.name); else selectedItems.delete(box.dataset.name); updateBulkBar(); const allBox = $('select-all-items'); if (allBox) allBox.checked = items.every((item) => selectedItems.has(item.name)) } })
  updateBulkBar()
}
function updateBulkBar() { const bar = $('bulk-bar'); if (!bar) return; bar.classList.toggle('hidden', selectedItems.size === 0); $('bulk-count').textContent = '已选择 ' + selectedItems.size + ' 个条目' }
// null/undefined = permanent; past = expired; soon (<24h) flagged.
function expiryLabel(expiresAt) {
  if (typeof expiresAt !== 'number') return '永久'
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
function noticeItems() {
  const data = app.data || {}
  const pending = data.pending || []
  if (pending.length) {
    return pending.map((entry) => ({ level: 'pending', text: '待审批：' + (entry.agent || 'Agent') + ' 请求读取「' + entry.name + '」', kind: 'pending', entry }))
  }
  return (data.reminders || []).map((item) => ({ level: item.severity, text: (item.kind && item.kind.indexOf('secret-') === 0 ? '密钥 ' : '') + (item.agent || '') + '：' + (item.message || ''), kind: item.kind, entry: item }))
}
function renderNoticeBar() {
  const bar = $('notice-bar')
  if (!bar) return
  const items = noticeItems()
  if (!items.length) { bar.classList.add('hidden'); bar.innerHTML = ''; if (noticeTimer) { clearInterval(noticeTimer); noticeTimer = null }; return }
  bar.classList.remove('hidden')
  const order = { pending: 0, critical: 1, warning: 2, notice: 3 }
  const top = items.slice().sort((a, b) => order[a.level] - order[b.level])[0]
  bar.dataset.level = top.level
  const render = () => {
    const item = items[noticeIndex % items.length]
    bar.dataset.level = item.level
    bar.innerHTML = '<span class="notice-dot"></span><span class="notice-text">' + esc(item.text) + '</span>' +
      '<span class="notice-count">' + items.length + '</span><span class="notice-more">查看全部 ›</span>'
  }
  render()
  if (noticeTimer) clearInterval(noticeTimer)
  if (items.length > 1) {
    noticeTimer = setInterval(() => { noticeIndex += 1; render() }, 4000)
  }
}
function openNoticeModal() {
  const items = noticeItems()
  if (!items.length) return
  const pending = (app.data && app.data.pending) || []
  const reminders = (app.data && app.data.reminders) || []

  const pendingBlock = pending.length ? pending.map((entry) => '<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px">'
    + pendingDetailHtml(entry)
    + '<div class="row" style="margin-top:8px"><button class="small primary" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="once">仅本次</button><button class="small" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="24h">24 小时</button><button class="small" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="always">永久</button><button class="small danger" data-kpi-decide data-id="' + esc(entry.id) + '" data-decision="deny">拒绝</button></div></div>').join('') : ''
  const reminderBlock = reminders.length ? reminders.map((item) => {
    const color = item.severity === 'critical' ? 'var(--danger)' : (item.severity === 'warning' ? '#c2760b' : '#2b4f8a')
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid var(--line);padding:8px 0"><div><b style="color:' + color + '">' + esc(item.agent || '') + '</b> <span class="pill">' + (item.oauth ? 'OAuth' : 'Token') + '</span><div class="hint" style="color:' + color + '">' + esc(item.message || '') + '</div></div><div class="nowrap"><button class="small" data-notice-extend="' + esc(item.agent) + '">延长</button></div></div>'
  }).join('') : ''
  const body = (pending.length ? '<div class="hint" style="margin-bottom:8px">有待审批请求时，仅显示待审批内容。</div>' + pendingBlock : '') +
    (!pending.length && reminders.length ? reminderBlock : '') +
    (!pending.length && !reminders.length ? '<div class="hint">暂无通知</div>' : '')
  openModal('待审批 / 通知', body)
  document.querySelectorAll('[data-notice-extend]').forEach((button) => {
    button.onclick = () => { show('modal', false); openExtendMenu(button.dataset.noticeExtend) }
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
    return '<tr class="agent-row" data-agent-open="' + esc(agent.name) + '">' +
      '<td><b>' + esc(agentDisplayName(agent)) + '</b> <span class="pill">' + kind + '</span>' +
      (agentDisplayNote(agent) ? '<br><span class="hint">' + esc(agentDisplayNote(agent)) + '</span>' : '') + '</td>' +
      '<td class="hint">' + esc(health.detail) + (typeof agent.expiresAt === 'number' ? ' · 剩余 ' + Math.max(0, Math.ceil((agent.expiresAt - Date.now()) / 86400e3)) + ' 天' : ' · 长期') + '</td>' +
      '<td class="nowrap"><span class="agent-health ' + dotClass + '">' + esc(health.label) + '</span></td>' +
      '<td class="nowrap">' + '<button class="small" data-agent-extend="' + esc(agent.name) + '" title="延长授权">延长</button>' +
      '<button class="small" data-agent-menu="' + esc(agent.name) + '" title="更多">⋮</button></td></tr>'
  }).join('')
  box.innerHTML = '<table><tr><th>Agent</th><th>最近活动 / 到期</th><th>状态</th><th>操作</th></tr>' + rows + '</table>'
}
function renderPending() {
  const pending = app.data.pending || []
  const head = '<table><tr><th>Agent</th><th>条目</th><th>动作</th><th>目标 origin</th><th>时间</th><th>授权</th></tr>'
  const body = pending.map((request) => {
    const origin = pendingOriginLabel(request)
    const isFill = String(request.action || '') === 'secret.fill'
    const originCell = isFill
      ? (origin ? '<code>' + esc(origin) + '</code>' : '<b style="color:var(--danger)">' + esc(origin) + '</b>')
      : '<span class="hint">-</span>'
    return '<tr><td>' + esc(request.agent) + '</td><td><b>' + esc(request.name) + '</b></td><td>'
      + esc(pendingActionLabel(request)) + '</td><td>' + originCell + '</td><td>'
      + esc(new Date(request.createdAt).toLocaleTimeString('zh-CN', { hour12: false })) + '</td><td>'
      + [['once', '仅本次'], ['1h', '1 小时'], ['24h', '24 小时'], ['7d', '7 天'], ['always', '永久']]
        .map((mode) => '<button class="small primary" data-decide="' + mode[0] + '" data-id="' + esc(request.id) + '">' + mode[1] + '</button>').join('')
      + '<button class="small danger" data-decide="deny" data-id="' + esc(request.id) + '">拒绝</button></td></tr>'
  }).join('')
  $('pending-box').innerHTML = pending.length ? head + body + '</table>' : '<div class="hint">暂无待批准请求</div>'
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
  return '<div style="border-top:1px solid var(--line);margin-top:14px;padding-top:10px">'
    + '<b>网页填充与明文读取</b>'
    + '<div class="hint" style="margin-top:4px">api = API Key，可按需允许 Agent 读取明文；web = 网站登录，只能被填充到指定网站，Agent 永远拿不到明文。未分类则保持旧版授权行为。</div>'
    + '<label class="field">类型</label><select id="fe-kind">'
    + '<option value=""' + (kind === '' ? ' selected' : '') + '>未分类（旧版行为）</option>'
    + '<option value="api"' + (kind === 'api' ? ' selected' : '') + '>api（API Key）</option>'
    + '<option value="web"' + (kind === 'web' ? ' selected' : '') + '>web（网站登录，只能填充）</option>'
    + '</select>'
    + '<div id="fe-web" class="' + (kind === 'web' ? '' : 'hidden') + '">'
    + '<label class="field">允许填充的 origin（每行一个，https://host 或 https://host:port）</label>'
    + '<textarea id="fe-origins" rows="3" style="width:100%" placeholder="https://example.com">' + esc(origins) + '</textarea>'
    + '<div class="hint">只做精确匹配：example.com.evil.test、任意子域或其他端口都不会被放行。</div></div>'
    + '<label class="chk" id="fe-read-row" style="margin-top:8px' + (kind === 'web' ? ';display:none' : '') + '"><input type="checkbox" id="fe-read"' + (read ? ' checked' : '') + '> 允许 Agent 直接读取明文（仅 api；30 天后自动失效）</label>'
    + '<div class="row" style="margin-top:10px"><button class="primary" id="fe-save">保存</button>' + (entry ? '<button class="danger" id="fe-clear">清除分类</button>' : '') + '</div>'
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
        if (!origins.length) return status('fe-status', 'web 凭据至少需要一个 https origin', true)
        await api('/api/fill/policy', { method: 'POST', body: JSON.stringify({ item: item.name, kind: 'web', origins, actions: ['login'] }) })
      } else {
        await api('/api/fill/policy', { method: 'POST', body: JSON.stringify({ item: item.name, kind: 'api' }) })
        await api('/api/fill/read-policy', { method: 'POST', body: JSON.stringify({ item: item.name, allow: $('fe-read').checked, ttlDays: 30 }) })
      }
      status('fe-status', '已保存', false)
      await loadState()
    } catch (error) { status('fe-status', error.message || '保存失败', true) }
  }
  const clear = $('fe-clear')
  if (clear) clear.onclick = async () => {
    if (!confirm('清除「' + item.name + '」的分类和相关授权？')) return
    try {
      await api('/api/fill/policy/delete', { method: 'POST', body: JSON.stringify({ item: item.name }) })
      status('fe-status', '已清除', false)
      await loadState()
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
    await loadState()
    show('modal', false)
    if (failed.length) toast('已分类 ' + ok + ' 个，' + failed.length + ' 个需要逐个设置（web 需要 origin）', true)
    else toast('已分类 ' + ok + ' 个')
  }
}

function pendingOriginLabel(entry) {
  if (String(entry.action || '') !== 'secret.fill') return ''
  const origin = String(entry.targetOrigin || '').trim()
  if (!origin) return '目标无效（缺少 origin）'
  return origin
}
function pendingActionLabel(entry) {
  const labels = { 'secret.read': '读取明文', 'secret.use': '代持请求', 'secret.fill': '网页填充' }
  return labels[String(entry.action || '')] || String(entry.action || '未知')
}
function fillPolicyState() {
  return (app.data && app.data.fillPolicies) || { items: [], executionLayer: false }
}

function renderFillPolicies() {
  const list = $('fp-list')
  if (!list) return
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

function renderGrants() {
  const grants = app.data.grants || []
  // Legacy grants with no recorded identity binding are repaired here, in the
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
    return '<tr><td>' + esc(grant.agent) + '</td><td><b>' + esc(grant.name) + '</b></td>'
      + '<td' + (bad ? ' style="color:var(--danger)"' : '') + '>' + esc(state) + '</td>'
      + '<td>' + esc(grant.mode) + '</td>'
      + '<td class="nowrap"><button class="pill" data-item-grant data-agent="' + esc(grant.agent) + '" data-name="' + esc(grant.name) + '" title="点击修改时长和读取次数">' + esc(remaining(grant)) + '</button></td>'
      + '<td>' + (grant.reads ?? 0) + (grant.maxReads ? ' / ' + grant.maxReads : '') + '</td>'
      + '<td><button class="small" data-grant-menu data-agent="' + esc(grant.agent) + '" data-name="' + esc(grant.name) + '" title="更多">⋮</button></td></tr>'
  }).join('')
  // An unbound legacy grant has no capability and no duration to show; its only
  // useful actions are re-grant (which binds it) and delete.
  const legacyRows = unbound.map((entry) =>
    '<tr><td>' + esc(entry.agent || '') + '</td><td><b>' + esc(entry.name || '') + '</b></td>'
    + '<td style="color:var(--danger)">需重新授权</td><td>' + esc(entry.mode || '') + '</td>'
    + '<td class="nowrap"><span class="hint">无绑定</span></td><td>-</td>'
    + '<td class="nowrap"><button class="small primary" data-legacy-regrant data-agent="' + esc(entry.agent || '') + '" data-name="' + esc(entry.name || '') + '">重新授权</button>'
    + '<button class="small danger" data-legacy-delete data-agent="' + esc(entry.agent || '') + '" data-name="' + esc(entry.name || '') + '" title="删除这条旧授权">删除</button></td></tr>'
  ).join('')
  const total = grants.length + unbound.length
  $('grants-box').innerHTML = total
    ? '<div class="hint">点「到期」那一列的时长即可延期或改读取次数。标为「需重新授权」的是凭据身份绑定之前建立的旧授权：Broker 无法证明这个名字今天仍指向同一个凭据，所以不会自动迁移，请重新授权或删除。</div>'
      + '<table><tr><th>Agent</th><th>条目</th><th>状态</th><th>模式</th><th>到期</th><th>读取</th><th>操作</th></tr>' + rows + legacyRows + '</table>'
    : '<div class="hint">暂无授权</div>'
}
function renderOauthClients() {
  const box = $('oauth-clients-box')
  if (!box) return
  const clients = (app.data && app.data.oauthClients) || []
  if (!clients.length) { box.innerHTML = '<div class="hint">还没有 OAuth 客户端注册</div>'; return }
  const rows = clients.map((client) => {
    const when = client.createdAt ? new Date(client.createdAt).toLocaleString('zh-CN', { hour12: false }) : '-'
    const tokenText = client.liveTokens > 0
      ? (client.expiresAt ? '有效 · 至 ' + new Date(client.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '有效 · 永久')
      : (client.tokens > 0 ? '已过期' : '无 token')
    return '<tr><td><b>' + esc(client.clientName || '未命名') + '</b></td>' +
      '<td class="hint"><code>' + esc(String(client.clientId || '').slice(0, 16)) + '…</code></td>' +
      '<td class="hint">' + esc(when) + '</td>' +
      '<td>' + esc(tokenText) + '</td>' +
      '<td class="nowrap"><button class="small danger" data-oauth-revoke="' + esc(client.clientId) + '">撤销</button></td></tr>'
  }).join('')
  box.innerHTML = '<table><tr><th>名称</th><th>客户端 ID</th><th>注册时间</th><th>Token</th><th>操作</th></tr>' + rows + '</table>'
}
function renderTransfers() {
  const transfers = app.data.transfers || []
  $('transfers-box').innerHTML = transfers.length ? '<table><tr><th>条目</th><th>Agent</th><th>来源 → 目标</th><th>目标文件夹</th><th>状态</th></tr>' + transfers.map((entry) => '<tr><td><b>' + esc(entry.name) + '</b></td><td>' + esc(entry.agent) + '</td><td class="hint">' + esc(entry.sourceAccount) + ' → ' + esc(entry.targetAccount) + '</td><td>' + esc(entry.folder || '(根目录)') + '</td><td class="hint">' + esc(entry.error ? '失败：' + entry.error : '等待目标账户解锁') + '</td></tr>').join('') + '</table>' : '<div class="hint">没有待复制条目</div>'
}
function who(label) { const agent = (app.data.agents || []).find((entry) => entry.name === label); return agent?.alias || label || '系统' }
function describe(entry) {
  const name = entry.name ? '「' + entry.name + '」' : ''; const agent = who(entry.agent); const mode = ({ once: '仅本次', '1h': '1 小时', '24h': '24 小时', '7d': '7 天', always: '永久', grant: '授权', 'no-approval': '免审批' })[entry.mode] || entry.mode || ''
  switch (entry.event) {
    case 'secret.read': return agent + ' 读取了 ' + name + (mode ? '（' + mode + '）' : '')
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
    case 'settings.update': return '更新系统设置'
    case 'agent.delete': return '删除 Agent ' + agent
    case 'vault.unlock': return '解锁了 vault' + (entry.ttl ? '（' + entry.ttl + '）' : '')
    case 'vault.lock': return '锁定了 vault'
    case 'admin.login': return '管理登录'
    case 'admin.login-fail': return '管理登录失败'
    default: return entry.event + (entry.agent ? ' · ' + agent : '') + (name ? ' ' + name : '')
  }
}
function renderRecent() { $('recent-box').innerHTML = (app.data.audit || []).slice(0, 8).map((entry) => '<div class="rowline"><span class="ev">' + esc(new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false })) + '</span><span>' + esc(describe(entry)) + '</span></div>').join('') || '<div class="hint">暂无活动</div>' }
function renderLogs() { $('logs-box').innerHTML = (app.data.audit || []).length ? '<table><tr><th>时间</th><th>描述</th><th>Agent</th><th>条目</th></tr>' + (app.data.audit || []).slice(0, 200).map((entry) => '<tr><td>' + esc(new Date(entry.time).toLocaleString('zh-CN', { hour12: false })) + '</td><td>' + esc(describe(entry)) + '</td><td>' + esc(entry.agent || '') + '</td><td>' + esc(entry.name || '') + '</td></tr>').join('') + '</table>' : '<div class="hint">暂无日志</div>' }
async function reveal(name) { try { const data = await api('/secret?name=' + encodeURIComponent(name)); $('modal-title').textContent = '读取 ' + name; $('modal-body').innerHTML = '<div class="hint">仅用于人工查看；Agent 应通过 /secret 或 MCP 获取。</div>' + (data.username ? '<label class="field">用户名</label><div class="secret">' + esc(data.username) + '</div>' : '') + '<label class="field">密钥</label><div class="secret">' + esc(data.value || '(空)') + '</div>' + (data.totp ? '<label class="field">TOTP Secret</label><div class="secret">' + esc(data.totp) + '</div>' : ''); show('modal', true) } catch (error) { toast(error.message, true) } }
function createItemMenu() {
  openModal('新增密钥条目', '<label class="field">名称</label><input id="new-item-name" placeholder="例如 tavily-api-key"><label class="field">用户名（可选）</label><input id="new-item-username" placeholder="登录用户名"><label class="field">密钥值</label><input id="new-item-value" placeholder="要保存的密钥"><label class="field">TOTP Secret（可选）</label><input id="new-item-totp" placeholder="Base32 TOTP secret"><label class="field">网址（可选）</label><input id="new-item-url" placeholder="https://example.com"><label class="field">分组（可选）</label><input id="new-item-group" placeholder="例如 blog/prod"><label class="field">备注（可选）</label><input id="new-item-notes"><label class="chk" style="margin-top:8px"><input type="checkbox" id="new-item-noapproval"> 免审批</label><div class="row" style="margin-top:12px"><button class="primary" id="new-item-save">创建</button></div>')
  $('new-item-save').onclick = async () => { try { await api('/api/items/create', { method: 'POST', body: JSON.stringify({ name: $('new-item-name').value.trim(), username: $('new-item-username').value, value: $('new-item-value').value, totp: $('new-item-totp').value, url: $('new-item-url').value.trim(), group: $('new-item-group').value.trim(), notes: $('new-item-notes').value, noApproval: $('new-item-noapproval').checked }) }); show('modal', false); await Promise.all([loadItems(), loadState()]); toast('已创建') } catch (error) { toast(error.message, true) } }
}
async function importItems(event) {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
  try {
    const text = await file.text(); const parsed = JSON.parse(text); const items = Array.isArray(parsed) ? parsed : parsed.items
    if (!Array.isArray(items)) throw new Error('JSON 需要是 [{name,value,...}] 或 {items:[...]}')
    const result = await api('/api/items/import', { method: 'POST', body: JSON.stringify({ items }) })
    await Promise.all([loadItems(), loadState()]); toast('导入完成：新增 ' + (result.created?.length || 0) + '，跳过 ' + (result.skipped?.length || 0))
  } catch (error) { toast('导入失败：' + error.message, true) }
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
  openModal('批量分享 / 同步（' + names.length + ' 个条目）', '<div class="hint">勾选的 Agent 会获得这些条目；勾选“取消未勾选分享”后，未勾选 Agent 的现有分享会被撤销。</div><div style="max-height:220px;overflow:auto;margin-top:8px">' + (boxes || '<div class="hint">没有 Agent</div>') + '</div><label class="field">跨账户目标文件夹（跨账户时必填）</label><input id="bulk-folder" placeholder="例如 笔记"><label class="field">时长</label><select id="bulk-seconds"><option value="3600">1 小时</option><option value="86400">24 小时</option><option value="604800">7 天</option><option value="2592000">30 天</option><option value="0">永久</option></select><label class="field">最多读取次数（留空不限）</label><input id="bulk-reads" type="number" min="1"><label class="chk"><input type="checkbox" id="bulk-revoke" ' + (single ? 'checked' : '') + '> 取消未勾选 Agent 的分享</label><div class="row" style="margin-top:12px"><button class="primary" id="bulk-confirm">确定</button></div>')
  $('bulk-confirm').onclick = async () => {
    const agentsSelected = [...document.querySelectorAll('.bulk-agent:checked')].map((box) => box.value)
    try {
      const result = await api('/api/grants/sync', { method: 'POST', body: JSON.stringify({ items: names, agents: agentsSelected, seconds: Number($('bulk-seconds').value), maxReads: $('bulk-reads').value || null, targetFolder: $('bulk-folder').value.trim(), revokeUnselected: $('bulk-revoke').checked }) })
      show('modal', false); selectedItems.clear(); await Promise.all([loadState(), loadItems()])
      toast('分享 ' + (result.granted?.length || 0) + '，转移 ' + (result.queued?.length || 0) + '，取消 ' + (result.revoked?.length || 0) + (result.errors?.length ? '，失败 ' + result.errors.length : ''))
    } catch (error) { toast(error.message, true) }
  }
}
async function bulkDelete() {
  const names = [...selectedItems]
  if (!names.length) return
  if (!confirm('删除选中的 ' + names.length + ' 个条目？')) return
  let deleted = 0
  for (const name of names) {
    try { await api('/api/items/delete', { method: 'POST', body: JSON.stringify({ name }) }); deleted++ } catch {}
  }
  selectedItems.clear(); await Promise.all([loadItems(), loadState()]); toast('已删除 ' + deleted + ' 个条目')
}
async function exportItems() {
  try {
    const data = await api('/api/items/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'secrets-export-' + new Date().toISOString().slice(0, 10) + '.json'; link.click(); URL.revokeObjectURL(link.href); toast('已导出（包含明文，请妥善保存）')
  } catch (error) { toast(error.message, true) }
}
function openModal(title, body) { $('modal-title').textContent = title; $('modal-body').innerHTML = body; show('modal', true) }
function uaLabel(ua) {
  const text = String(ua || '')
  const browser = /Edg\/([\d.]+)/.test(text) ? 'Edge ' + text.match(/Edg\/([\d.]+)/)[1] : /Chrome\/([\d.]+)/.test(text) ? 'Chrome ' + text.match(/Chrome\/([\d.]+)/)[1] : /Firefox\/([\d.]+)/.test(text) ? 'Firefox ' + text.match(/Firefox\/([\d.]+)/)[1] : /Version\/([\d.]+).*Safari/.test(text) ? 'Safari ' + text.match(/Version\/([\d.]+)/)[1] : 'Unknown'
  const os = /Windows NT 10/.test(text) ? 'Windows' : /Mac OS X/.test(text) ? 'macOS' : /Android/.test(text) ? 'Android' : /iPhone|iPad/.test(text) ? 'iOS' : /Linux/.test(text) ? 'Linux' : ''
  return browser + (os ? ' · ' + os : '')
}
function agentLabel(name) { const agent = (app.data.agents || []).find((entry) => entry.name === name); return agent?.alias || agent?.name || name || '系统' }
function describeEvent(entry) { return ({ 'secret.read': '读取密钥', 'grant.share': '分享授权', 'grant.approve': '批准授权', 'grant.revoke': '撤销授权', 'transfer.complete': '跨账户复制完成', 'item.create': '创建条目', 'item.update': '修改条目', 'vault.unlock': '解锁' })[entry.event] || entry.event || '' }
function itemInfoHtml(item) {
  const grants = (app.data.grants || []).filter((grant) => grant.name === item.name)
  const usage = (app.data.audit || []).filter((entry) => entry.name === item.name && ['secret.read', 'grant.share', 'grant.approve', 'transfer.complete', 'item.create', 'item.update'].includes(entry.event)).slice(0, 10)
  const durationLabel = (grant) => { if (!grant.expiresAt) return '永久'; const ms = grant.expiresAt - Date.now(); if (ms <= 0) return '已过期'; const days = Math.ceil(ms / 86400000); return days <= 1 ? Math.max(1, Math.ceil(ms / 3600000)) + ' 小时' : days + ' 天' }
  const rows = grants.length ? '<table><tr><th>Agent</th><th>方式</th><th>时长</th><th>读取</th></tr>' + grants.map((grant) => '<tr><td>' + esc(agentLabel(grant.agent)) + '</td><td>' + esc(grant.mode || '') + '</td><td><button class="pill" data-item-grant data-agent="' + esc(grant.agent) + '" data-name="' + esc(grant.name) + '" title="点击修改时长和读取次数">' + esc(durationLabel(grant)) + '</button></td><td>' + (grant.reads || 0) + '/' + (grant.maxReads || '∞') + '</td></tr>').join('') + '</table>' : '<div class="hint">当前没有分享给 Agent</div>'
  const usageRows = usage.length ? '<table><tr><th>时间</th><th>Agent</th><th>动作</th><th>方式</th></tr>' + usage.map((entry) => '<tr><td>' + esc(entry.time ? new Date(entry.time).toLocaleString('zh-CN', { hour12: false }) : '') + '</td><td>' + esc(agentLabel(entry.agent)) + '</td><td>' + esc(describeEvent(entry)) + '</td><td>' + esc(entry.mode || entry.source || '') + '</td></tr>').join('') + '</table>' : '<div class="hint">暂无使用记录</div>'
  return '<div class="hint" style="margin-bottom:8px">创建：' + esc(item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) : '-') + ' · 创建人：' + esc(item.creator || '-') + '</div><div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><b>分享情况</b><button class="small" id="mi-share-sync">分享 / 同步</button></div>' + rows + '<div style="margin-top:10px"><b>最近使用</b></div>' + usageRows + '</div>'
}
// The expiry field of the edit dialog. A secret without an expiry shows an
// empty date, and an empty date on save means no expiry.
// The expiry badge of an item. Every row needs the cell, so an item without an
// expiry renders an empty one instead of shifting the row's columns.
function expiryBadge(item) {
  if (!item || !item.expiresAt) return '<td class="nowrap"></td>'
  const days = Math.ceil((item.expiresAt - Date.now()) / 86400e3)
  const text = days <= 0 ? '已过期' : (days <= 1 ? '今天到期' : days + ' 天后到期')
  return '<td class="nowrap"><span class="hint" style="color:var(--danger)">' + esc(text) + '</span></td>'
}

function expiresField(item) {
  const stamp = item && item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0, 10) : ''
  return '<label class="field">有效期（留空表示不过期）</label><input id="mi-expires" type="date" value="' + esc(stamp) + '">'
}

function openItemMenu(name) {
  const item = app.items.find((entry) => entry.name === name); if (!item) return
  const agents = app.data.agents || []
  openModal('条目「' + name + '」', itemInfoHtml(item) + fillEditorHtml(item) + '<label class="field">名称</label><input id="mi-name" value="' + esc(item.name) + '"><label class="field">用户名（留空不改）</label><input id="mi-username" value="' + esc(item.username || '') + '"><label class="field">TOTP Secret（留空不改）</label><input id="mi-totp" value="' + esc(item.totp || '') + '"><label class="field">分组</label><input id="mi-group" value="' + esc(item.group || '') + '" placeholder="例如 blog/prod"><label class="field">网址</label><input id="mi-url" value="' + esc(item.url || '') + '"><label class="field">备注（留空不改）</label><input id="mi-notes" placeholder="新的备注"><label class="field">新密钥值（留空不改）</label><input id="mi-value" type="password" placeholder="留空保留原值"><label class="chk" style="margin-top:8px"><input type="checkbox" id="mi-noapproval" ' + (item.noApproval ? 'checked' : '') + '> 免审批（自动读取，仍记录）</label><div class="row" style="margin-top:14px"><button class="primary" id="mi-save">保存修改</button><button id="mi-share">分享</button><button class="danger" id="mi-delete">删除</button></div><div style="border-top:1px solid var(--line);margin-top:14px;padding-top:10px"><div class="hint">分享给 Agent（同账户直接授权；跨账户会先复制到目标账户文件夹，切回目标账户解锁后自动完成）</div><label class="field">Agent</label><select id="mi-share-agent" multiple size="3">' + agents.map((agent) => '<option value="' + esc(agent.name) + '">' + esc(agent.alias || agent.name) + '</option>').join('') + '</select><label class="field">跨账户目标文件夹（同账户可留空）</label><input id="mi-share-folder" placeholder="例如 笔记"><label class="field">时长</label><select id="mi-share-seconds"><option value="3600">1 小时</option><option value="86400">24 小时</option><option value="604800">7 天</option><option value="2592000">30 天</option><option value="0">永久</option></select><label class="field">最多读取次数（留空不限）</label><input id="mi-share-reads" type="number" min="1"></div>' + expiresField(item) + '</div>')
  $('mi-share-sync').onclick = () => { show('modal', false); selectedItems.clear(); selectedItems.add(item.name); openBulkShare() }
  $('mi-save').onclick = async () => { try { await api('/api/items/update', { method: 'POST', body: JSON.stringify({ name: item.name, newName: $('mi-name').value.trim(), username: $('mi-username').value, totp: $('mi-totp').value, group: $('mi-group').value.trim(), url: $('mi-url').value.trim(), notes: $('mi-notes').value.trim() ? $('mi-notes').value : undefined, value: $('mi-value').value, noApproval: $('mi-noapproval').checked, expiresAt: $('mi-expires').value }) }); show('modal', false); await Promise.all([loadItems(), loadState()]); toast('已保存') } catch (error) { toast(error.message, true) } }
  $('mi-delete').onclick = async () => { if (!confirm('删除条目「' + item.name + '」？')) return; try { await api('/api/items/delete', { method: 'POST', body: JSON.stringify({ name: item.name }) }); show('modal', false); await Promise.all([loadItems(), loadState()]); toast('已删除') } catch (error) { toast(error.message, true) } }
  wireFillEditor(item)
  $('mi-share').onclick = async () => { const agents = [...$('mi-share-agent').selectedOptions].map((option) => option.value); if (!agents.length) return toast('至少选择一个 Agent', true); try { const result = await api('/api/grants/share', { method: 'POST', body: JSON.stringify({ name: $('mi-name').value.trim() || item.name, agents, seconds: Number($('mi-share-seconds').value), maxReads: $('mi-share-reads').value || null, targetFolder: $('mi-share-folder').value.trim() }) }); show('modal', false); await loadState(); if (result.queued?.length) toast('已加入跨账户复制队列，切回目标账户并解锁后自动复制'); else toast('已分享') } catch (error) { toast(error.message, true) } }
}
async function saveAgentFromModal(originalName) {
  try {
    const requested = $('ma-realname').value.trim() || originalName
    let currentName = originalName
    if (requested !== originalName) {
      const renamed = await api('/api/agents/rename', { method: 'POST', body: JSON.stringify({ name: originalName, newName: requested }) })
      currentName = renamed.name
    }
    await api('/api/agents/update', { method: 'POST', body: JSON.stringify({ name: currentName, alias: $('ma-alias').value.trim(), note: $('ma-note').value.trim(), allow: $('ma-allow').value.split(',').map((v) => v.trim()).filter(Boolean), groups: $('ma-groups').value.split(',').map((v) => v.trim()).filter(Boolean), allowAll: $('ma-allowall').checked, write: $('ma-write').checked }) })
    show('modal', false); await loadState(); toast('已保存 Agent')
  } catch (error) { toast(error.message, true) }
}
function openAgentMenu(name) {
  const agent = app.data.agents.find((entry) => entry.name === name); if (!agent) return
  if (agent.oauth) {
    openModal('OAuth Agent「' + name + '」', '<div class="hint">OAuth 动态注册产生的 Agent，绑定账户：<code>' + esc(agent.account || '-') + '</code>。可以修改名称、备注、权限和写入开关；撤销授权会删除 token。</div><label class="field">名称（标识）</label><input id="ma-realname" value="' + esc(agent.name) + '"><label class="field">显示名</label><input id="ma-alias" value="' + esc(agent.alias || '') + '"><label class="field">备注</label><input id="ma-note" value="' + esc(agent.note || '') + '"><label class="field">可读条目（逗号分隔，留空=全部）</label><input id="ma-allow" value="' + esc((agent.allow || []).join(', ')) + '"><label class="field">可读分组（逗号分隔，留空=不限）</label><input id="ma-groups" value="' + esc((agent.groups || []).join(', ')) + '"><label class="chk"><input type="checkbox" id="ma-allowall" ' + (agent.allowAll ? 'checked' : '') + '> 允许全部条目</label><label class="chk" style="margin-top:8px"><input type="checkbox" id="ma-write" ' + (agent.write ? 'checked' : '') + '> 允许写入（Agent 写 API /agent/items/save）</label><div class="row" style="margin-top:14px"><button class="primary" id="ma-save">保存</button><button class="danger" id="ma-oauth-revoke">撤销 OAuth 授权</button></div>')
    $('ma-save').onclick = () => saveAgentFromModal(name)
    $('ma-oauth-revoke').onclick = async () => { if (!confirm('撤销 ' + name + ' 的 OAuth token？')) return; try { await api('/api/oauth/revoke', { method: 'POST', body: JSON.stringify({ agent: name }) }); show('modal', false); await loadState(); toast('已撤销') } catch (error) { toast(error.message, true) } }
    return
  }
  openModal('Agent「' + name + '」', '<div class="hint">绑定账户：<code>' + esc(agent.account || '未绑定（旧数据）') + '</code>。Agent 只能读取该账户；切换账户后旧 Agent 不会自动获得新账户权限。</div><label class="field">名称（标识）</label><input id="ma-realname" value="' + esc(agent.name) + '"><label class="field">显示名</label><input id="ma-alias" value="' + esc(agent.alias || '') + '"><label class="field">备注</label><input id="ma-note" value="' + esc(agent.note || '') + '"><label class="field">可读条目（逗号分隔，留空=全部）</label><input id="ma-allow" value="' + esc((agent.allow || []).join(', ')) + '"><label class="field">可读分组（逗号分隔，留空=不限）</label><input id="ma-groups" value="' + esc((agent.groups || []).join(', ')) + '"><label class="chk"><input type="checkbox" id="ma-allowall" ' + (agent.allowAll ? 'checked' : '') + '> 允许全部条目</label><label class="chk" style="margin-top:8px"><input type="checkbox" id="ma-write" ' + (agent.write ? 'checked' : '') + '> 允许写入（Agent 写 API /agent/items/save）</label><div class="row" style="margin-top:14px"><button class="primary" id="ma-save">保存权限</button><button id="ma-copy">复制 token</button><button id="ma-rotate">轮换 token</button><button class="danger" id="ma-delete">删除</button></div><div class="secret hidden" id="ma-token"></div>')
  $('ma-save').onclick = () => saveAgentFromModal(name)
  $('ma-copy').onclick = async () => { try { const data = await api('/api/agents/token', { method: 'POST', body: JSON.stringify({ name }) }); $('ma-token').textContent = data.token; $('ma-token').classList.remove('hidden'); await navigator.clipboard.writeText(data.token); toast('token 已复制') } catch (error) { toast(error.message, true) } }
  $('ma-rotate').onclick = async () => { if (!confirm('轮换 ' + name + ' 的 token？旧 token 会立即失效。')) return; try { const data = await api('/api/agents/rotate', { method: 'POST', body: JSON.stringify({ name }) }); $('ma-token').textContent = data.token; $('ma-token').classList.remove('hidden'); await navigator.clipboard.writeText(data.token); await loadState(); toast('已轮换并复制新 token') } catch (error) { toast(error.message, true) } }
  $('ma-delete').onclick = async () => { if (!confirm('删除 Agent ' + name + '？')) return; try { await api('/api/agents/delete', { method: 'POST', body: JSON.stringify({ name }) }); show('modal', false); await loadState(); toast('已删除') } catch (error) { toast(error.message, true) } }
}
function openGrantMenu(agent, name) {
  const grant = (app.data.grants || []).find((entry) => entry.agent === agent && entry.name === name); if (!grant) return
  const seconds = !grant.expiresAt ? 0 : Math.max(0, Math.round((grant.expiresAt - Date.now()) / 1000))
  const nearest = !grant.expiresAt ? 0 : ([3600, 86400, 604800, 2592000].find((value) => seconds <= value) || 0)
  const usage = (app.data.audit || []).filter((entry) => entry.agent === agent && entry.name === name).slice(0, 15)
  const usageHtml = '<div class="hint" style="margin-bottom:8px">创建：' + (grant.createdAt ? new Date(grant.createdAt).toLocaleString('zh-CN', { hour12: false }) : '-') + ' · 已读：' + (grant.reads ?? 0) + ' 次 · 到期：' + (grant.expiresAt ? new Date(grant.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '永久') + '</div><div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:12px"><b>使用记录</b>' + (usage.length ? '<table><tr><th>时间</th><th>动作</th><th>方式</th></tr>' + usage.map((entry) => '<tr><td>' + esc(entry.time ? new Date(entry.time).toLocaleString('zh-CN', { hour12: false }) : '') + '</td><td>' + esc(describeEvent(entry)) + '</td><td>' + esc(entry.mode || entry.source || '') + '</td></tr>').join('') + '</table>' : '<div class="hint">暂无记录</div>') + '</div>'
  openModal('授权「' + agent + ' → ' + name + '」', usageHtml + '<label class="field">时长</label><select id="mg-seconds"><option value="3600" ' + (nearest === 3600 ? 'selected' : '') + '>1 小时</option><option value="86400" ' + (nearest === 86400 ? 'selected' : '') + '>24 小时</option><option value="604800" ' + (nearest === 604800 ? 'selected' : '') + '>7 天</option><option value="2592000" ' + (nearest === 2592000 ? 'selected' : '') + '>30 天</option><option value="0" ' + (nearest === 0 ? 'selected' : '') + '>永久</option></select><label class="field">最多读取次数（留空不限）</label><input id="mg-max" type="number" min="1" value="' + (grant.maxReads ?? '') + '"><div class="row" style="margin-top:14px"><button class="primary" id="mg-save">保存授权</button>' + (grant.revokedAt || (grant.expiresAt && grant.expiresAt <= Date.now()) || (grant.maxReads && (grant.reads ?? 0) >= grant.maxReads) ? '<button id="mg-restore">恢复授权</button>' : '') + '<button class="danger" id="mg-revoke">撤销</button><button class="danger" id="mg-delete">删除记录</button></div>')
  $('mg-save').onclick = async () => { try { await api('/api/grants/update', { method: 'POST', body: JSON.stringify({ agent, name, seconds: Number($('mg-seconds').value), maxReads: $('mg-max').value || null }) }); show('modal', false); await loadState(); toast('已更新授权') } catch (error) { toast(error.message, true) } }
  if ($('mg-restore')) $('mg-restore').onclick = async () => { try { await api('/api/grants/restore', { method: 'POST', body: JSON.stringify({ agent, name }) }); show('modal', false); await loadState(); toast('已恢复授权') } catch (error) { toast(error.message, true) } }
  $('mg-revoke').onclick = async () => { try { await api('/api/grants/revoke', { method: 'POST', body: JSON.stringify({ agent, name }) }); show('modal', false); await loadState(); toast('已撤销') } catch (error) { toast(error.message, true) } }
  $('mg-delete').onclick = async () => { if (!confirm('删除这条授权记录？')) return; try { await api('/api/grants/delete', { method: 'POST', body: JSON.stringify({ agent, name }) }); show('modal', false); await loadState(); toast('已删除') } catch (error) { toast(error.message, true) } }
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
      ? '<div class="hint">可以绑定多个身份服务商，每个单独绑定、单独解绑。</div>' + (providerRows.join('') || '<div class="hint">还没有可用的身份服务商。</div>')
      : '<div class="hint">未配置 OIDC。先在「设置」里添加身份服务商。</div>'
    $('oidc-box').innerHTML = oidc
    for (const button of $('oidc-box').querySelectorAll('[data-oidc-unbind]')) button.onclick = async () => {
      const id = button.getAttribute('data-oidc-unbind')
      if (!confirm('解绑这个身份服务商？下次登录会重新绑定。')) return
      try { await api('/api/profile/oidc/bindings', { method: 'DELETE', body: JSON.stringify({ id }) }); await loadProfile(); toast('已解绑') } catch (error) { status('oidc-status', error.message, 'error') }
    }
    await loadSecurity()
  } catch (error) { status('profile-status', error.message, 'error') }
}
async function saveProfile() { try { const name = $('profile-name').value.trim(); const email = $('profile-email').value.trim(); const avatarUrl = $('profile-avatar').value.trim(); await api('/api/profile', { method: 'POST', body: JSON.stringify({ name, email, avatarUrl }) }); status('profile-status', '已保存', 'ok'); $('who').textContent = name || email.split('@')[0] || $('who').textContent; renderAvatar(name || email, avatarUrl) } catch (error) { status('profile-status', error.message, 'error') } }
async function switchAccount() { const email = $('vault-email').value; if (!email) return; if (!confirm('切换到 ' + email + '？当前解锁会话会被清除，需要用该账户主密码重新解锁。')) return; try { status('settings-status', '切换中…'); await api('/api/settings', { method: 'POST', body: JSON.stringify({ vaultEmail: email }) }); status('settings-status', '已切换，请重新解锁', 'ok'); await boot() } catch (error) { status('settings-status', error.message, 'error') } }
async function saveFolder() { const folder = $('vault-folder').value; try { status('vault-folder-status', '保存中…'); await api('/api/settings', { method: 'POST', body: JSON.stringify({ vaultFolder: folder }) }); status('vault-folder-status', folder ? '已保存，只读取：' + folder : '已保存，读取全部文件夹', 'ok'); await Promise.all([loadItems(), loadSettings()]) } catch (error) { status('vault-folder-status', error.message, 'error') } }
async function loadSecurity() {
  try {
    const data = await api('/api/security'); $('password-source').textContent = data.passwordSource === 'custom' ? '当前使用自定义密码（保存在 Durable Object）' : '当前使用环境变量 ADMIN_PASSWORD，修改后会保存自定义密码'
    $('totp-status').textContent = data.totpEnabled ? '已启用两步验证' : '未启用'
    $('totp-disable').classList.toggle('hidden', !data.totpEnabled)
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
