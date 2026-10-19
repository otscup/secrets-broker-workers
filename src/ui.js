export const uiHtml = String.raw`<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Secrets Broker · Cloudflare Workers</title>
<style>
:root{--bg:#f3f6fb;--card:#fff;--line:#e3e9f2;--text:#152033;--muted:#6b7890;--ok:#0f9d8a;--warn:#f2994a;--danger:#c0392b;--btn:#eef1f6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:22px 24px 40px}
header{display:flex;align-items:center;gap:14px;margin-bottom:18px;flex-wrap:wrap}
h1{font-size:20px;margin:0;letter-spacing:-.2px}
.badge{background:#e8f7f4;color:#0b7d6d;border-radius:999px;padding:2px 9px;font-size:11px}
nav{display:flex;gap:2px;margin-left:12px;flex-wrap:wrap}
nav button{border:0;background:transparent;color:var(--muted);border-radius:9px;padding:7px 13px;font:inherit;font-size:13px;cursor:pointer}
nav button.active{background:#fff;color:var(--text);box-shadow:0 2px 8px rgba(20,40,80,.07)}
.user{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}
.user-wrap{position:relative;margin-left:auto}
.avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#5b6cff,#0f9d8a);color:#fff;display:grid;place-items:center;font-size:11px;border:0;cursor:pointer}
.theme-switch{display:flex;gap:2px;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:2px;margin-left:auto}
.theme-switch button{border:0;background:transparent;border-radius:7px;padding:4px 7px;font-size:13px;cursor:pointer;opacity:.65}
.theme-switch button.on{background:var(--btn);opacity:1}
.account-menu{position:absolute;right:0;top:38px;z-index:30;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px;min-width:160px;box-shadow:0 12px 30px rgba(15,23,42,.16)}
.account-menu button{display:block;width:100%;text-align:left;background:transparent;border-radius:8px;padding:8px 10px;font-size:13px}
.account-menu button:hover{background:var(--btn)}
html[data-theme="dark"]{--bg:#0b1220;--card:#111a2b;--line:#24324a;--text:#e6edf7;--muted:#8fa1bd;--btn:#1b2940;--ok:#20b8a6}
html[data-theme="dark"] body{background:var(--bg);color:var(--text)}
html[data-theme="dark"] .kpi,html[data-theme="dark"] .seg,html[data-theme="dark"] input,html[data-theme="dark"] select,html[data-theme="dark"] .account-menu,html[data-theme="dark"] .donut-center{background:var(--card);color:var(--text)}
html[data-theme="dark"] nav button.active{background:#1b2940;color:var(--text)}
html[data-theme="dark"] tbody tr:hover td{background:#172338}
html[data-theme="dark"] .modal{background:rgba(0,0,0,.6)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin-bottom:14px;box-shadow:0 8px 24px rgba(20,40,80,.04)}
h2{font-size:14px;margin:0 0 5px}.hint{color:var(--muted);font-size:12px}
label.field{display:block;font-size:12px;color:var(--muted);margin:9px 0 4px}
input,select{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:#fff;font:inherit;outline:none}
input:focus,select:focus{border-color:var(--ok)}
button{border:0;border-radius:10px;padding:9px 13px;font:inherit;cursor:pointer;background:var(--btn);color:var(--text)}
button.primary{background:var(--ok);color:#fff}button.danger{background:#fdecec;color:var(--danger)}button.small{padding:5px 9px;font-size:12px}
.row{display:flex;gap:9px;flex-wrap:wrap;align-items:end}.row>*{flex:1;min-width:140px}.row button{flex:0 0 auto}
.hidden{display:none!important}.status{min-height:18px;font-size:12px;color:var(--muted);margin-top:8px}.error{color:var(--danger)}.ok{color:var(--ok)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px}.kpi .label{color:var(--muted);font-size:12px}.kpi .value{font-size:25px;font-weight:650;margin-top:2px}.kpi .sub{font-size:11px;color:var(--muted)}
.kpi.warn .value{color:var(--warn)}
.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap}.spacer{flex:1}
.seg{background:#fff;border:1px solid var(--line);border-radius:10px;padding:3px;display:flex;gap:2px}.seg button{background:transparent;color:var(--muted);padding:5px 10px;font-size:12px;border-radius:7px}.seg button.on{background:var(--ok);color:#fff}
.grid2{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(260px,1fr);gap:14px;align-items:start}
table{width:100%;border-collapse:collapse;font-size:12.5px}th{color:var(--muted);font-weight:500;text-align:left;padding:8px;border-bottom:1px solid var(--line);white-space:nowrap}td{padding:8px;border-bottom:1px solid #f0f3f8;vertical-align:middle}tr:last-child td{border-bottom:0}tbody tr:hover td{background:#f8fafc}
.table-wrap{overflow-x:auto;max-width:100%}
.pill{display:inline-block;background:#eef7f5;color:#0b7d6d;border-radius:999px;padding:1px 8px;font-size:11px}.pill.off{background:#f3f4f6;color:var(--muted)}
.donut-wrap{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.donut{width:140px;height:140px;border-radius:50%;position:relative;flex:0 0 auto}.donut-center{position:absolute;inset:25px;background:#fff;border-radius:50%;display:grid;place-items:center;font-weight:650;font-size:17px}
.legend{font-size:12px}.legend div{display:flex;justify-content:space-between;gap:18px;margin:5px 0}.dot{display:inline-block;width:8px;height:8px;border-radius:99px;margin-right:6px}
.recent .rowline{display:flex;gap:8px;padding:7px 0;border-bottom:1px solid #f0f3f8;font-size:12px}.recent .rowline:last-child{border-bottom:0}.recent .ev{color:var(--muted);white-space:nowrap}
ul.items{list-style:none;margin:0;padding:0}ul.items li{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f0f3f8}ul.items li:last-child{border-bottom:0}ul.items .name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}ul.items .type{color:var(--muted);font-size:11px}
.secret{background:#0f172a;color:#d1fae5;border-radius:10px;padding:12px;margin-top:8px;word-break:break-all;font-family:ui-monospace,monospace;font-size:12px}
.modal{position:fixed;inset:0;background:rgba(15,23,42,.4);display:grid;place-items:center;padding:20px;z-index:20}.modal .card{max-width:620px;width:100%;margin:0}.modal .secret{max-height:120px;overflow:auto}
@media(max-width:860px){.kpis{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}}@media(max-width:620px){.user .email{display:none}}
</style></head><body><div class="wrap">
<header><h1>Secrets Broker</h1><span class="badge">Cloudflare Workers</span>
<nav id="nav"><button data-view="overview" class="active">概览</button><button data-view="items">密钥</button><button data-view="agents">Agents</button><button data-view="grants">授权</button><button data-view="logs">日志</button></nav>
<span class="theme-switch" id="theme-switch"><button data-theme-mode="light" title="白天">☀️</button><button data-theme-mode="dark" title="夜间">🌙</button><button data-theme-mode="auto" title="跟随系统">💻</button></span>
<div class="user-wrap"><span class="user"><span class="email" id="who"></span><button id="avatar" class="avatar" title="账户">SB</button></span>
<div id="account-menu" class="account-menu hidden"><button data-view="profile">个人资料</button><button data-view="settings">通知设置</button><button id="account-logout" class="danger">退出登录</button></div></div>
<button id="lock" class="hidden danger">锁定</button></header>

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
    <div id="kpis" class="kpis"></div>
    <div class="grid2">
      <div class="card"><h2>读取趋势</h2><div class="hint" style="margin-bottom:6px">按时间聚合 · 悬停查看数值</div><div id="chart-box"></div></div>
      <div class="card"><h2>Agent 读取占比</h2><div class="hint" style="margin-bottom:6px">按 agent 聚合</div><div id="donut-box" class="donut-wrap"></div></div>
    </div>
    <div class="card"><h2>条目读取排行</h2><div class="hint" style="margin-bottom:6px">按被读取次数排序</div><div id="top-box" class="table-wrap"></div></div>
    <div class="card"><h2>最近活动</h2><div id="recent-box" class="recent"></div></div>
  </section>

  <section id="view-items" class="view hidden"><div class="card"><h2>密钥条目</h2><div class="hint">来自 NodeWarden D1（只读），这里可以设置免审批策略和读取。</div><div class="row" style="margin-top:10px"><input id="item-filter" placeholder="搜索名称或网址…"><button id="items-refresh">刷新</button></div><div id="items-box" class="table-wrap" style="margin-top:10px"></div><div id="item-status" class="status"></div></div></section>

  <section id="view-agents" class="view hidden">
    <div class="card"><h2>新增 Agent</h2><div class="hint">token 只显示一次；创建后请保存。</div>
      <div class="row" style="margin-top:10px"><input id="agent-name" placeholder="名称，如 dsh"><input id="agent-alias" placeholder="显示名（可选）"><input id="agent-allow" placeholder="可读条目，逗号分隔，留空=全部"><label class="chk" style="flex:0 0 auto;min-width:auto"><input type="checkbox" id="agent-write"> 允许写入</label><button class="primary" id="agent-create">创建</button></div><div class="status" id="agent-status"></div><div id="new-token" class="hidden"><div class="secret" id="new-token-value"></div><div style="margin-top:8px"><button id="copy-token">复制 token</button></div></div>
    </div>
    <div class="card"><h2>Agents</h2><div id="agents-box" class="table-wrap"></div></div>
  </section>

  <section id="view-grants" class="view hidden">
    <div class="card"><h2>待批准请求</h2><div class="hint">点按钮即授权；同 Docker 版的 once/1h/24h/7d/永久。</div><div id="pending-box" class="table-wrap" style="margin-top:10px"></div></div>
    <div class="card"><h2>有效授权</h2><div id="grants-box" class="table-wrap"></div></div>
  </section>

  <section id="view-logs" class="view hidden"><div class="card"><h2>审计日志</h2><div class="hint">最近 500 条，数据在 Durable Object 中。</div><div id="logs-box" class="table-wrap" style="margin-top:10px"></div></div></section>

  <section id="view-profile" class="view hidden">
    <div class="card"><h2>个人资料</h2><div class="hint">用于页面显示；OIDC 登录会同步姓名/邮箱/头像。</div>
      <label class="field">名字</label><input id="profile-name" placeholder="你的名字">
      <label class="field">邮箱</label><input id="profile-email" placeholder="you@example.com">
      <label class="field">头像 URL</label><input id="profile-avatar" placeholder="https://...">
      <div class="row" style="margin-top:10px"><button class="primary" id="profile-save">保存资料</button></div><div class="status" id="profile-status"></div>
    </div>
    <div class="card"><h2>登录与账号绑定</h2><div class="hint">OIDC（xid）登录会作为管理登录方式；配置后可直接点下方按钮。</div><div id="oidc-box" style="margin-top:10px"></div><div class="status" id="oidc-status"></div></div>
    <div class="card"><h2>修改密码</h2><div class="hint" id="password-source"></div><label class="field">当前密码</label><input id="current-password" type="password" autocomplete="current-password"><label class="field">新密码（至少 8 位）</label><input id="new-password" type="password" autocomplete="new-password"><div style="margin-top:10px"><button class="primary" id="password-save">修改密码</button></div><div class="status" id="password-status"></div></div>
    <div class="card"><h2>两步验证（TOTP）</h2><div id="totp-status" class="hint"></div><div id="totp-setup-box" class="hidden"><div class="hint">用验证器扫码/手动输入下面的密钥，然后输入 6 位验证码启用。</div><div class="secret" id="totp-secret"></div><label class="field">验证码</label><input id="totp-enable-code" inputmode="numeric" placeholder="6 位验证码"><div style="margin-top:10px"><button class="primary" id="totp-enable">启用两步验证</button></div></div><div class="row" style="margin-top:10px"><button id="totp-setup">生成/重新生成密钥</button><button class="danger hidden" id="totp-disable">关闭两步验证</button></div><div class="status" id="totp-message"></div></div>
  </section>

  <section id="view-settings" class="view hidden">
    <div class="card"><h2>通知渠道</h2><div class="hint">待批准请求会推送到这里。留空的 token 表示保留原值。</div>
      <div class="grid2" style="margin-top:10px">
        <div><h2 style="font-size:13px">Telegram</h2><label class="field">Bot Token</label><input id="tg-token" type="password" placeholder="留空保留原值"><label class="field">Chat ID</label><input id="tg-chat" placeholder="例如 123456789"><div class="hint" id="tg-status"></div></div>
        <div><h2 style="font-size:13px">ntfy</h2><label class="field">服务器 URL</label><input id="ntfy-url" placeholder="https://ntfy.example.com"><label class="field">Topic</label><input id="ntfy-topic" placeholder="secrets-broker-xxxx"><div class="hint" id="ntfy-status"></div></div>
        <div><h2 style="font-size:13px">Gotify</h2><label class="field">服务器 URL</label><input id="gotify-url" placeholder="https://gotify.example.com"><label class="field">App Token</label><input id="gotify-token" type="password" placeholder="留空保留原值"><div class="hint" id="gotify-status"></div></div>
        <div><h2 style="font-size:13px">wxpush</h2><label class="field">URL</label><input id="wxpush-url" placeholder="https://wxpush.example.com/wxsend"><label class="field">Token</label><input id="wxpush-token" type="password" placeholder="留空保留原值"><div class="hint" id="wxpush-status"></div></div>
      </div>
      <div style="margin-top:12px"><button class="primary" id="settings-save">保存通知设置</button></div><div class="status" id="settings-status"></div>
    </div>
    <div class="card"><h2>OIDC / xid 登录</h2><div class="hint">这里填的配置会保存到 Durable Object，不需要重新部署；留空的 secret 表示保留原值。</div>
      <label class="field">Issuer</label><input id="oidc-issuer" placeholder="https://auth.example.com">
      <label class="field">Client ID</label><input id="oidc-client-id" placeholder="client_xxx">
      <label class="field">Client Secret（public client 可留空）</label><input id="oidc-client-secret" type="password" placeholder="留空保留原值">
      <label class="field">Redirect URI</label><input id="oidc-redirect" placeholder="https://your-worker/oidc/callback">
      <label class="field">Scope</label><input id="oidc-scope" placeholder="openid profile email">
      <div class="hint" id="oidc-config-status" style="margin-top:8px"></div>
    </div>
    <div class="card"><h2>浏览器通知</h2><div class="hint" id="browser-notify-status"></div><div style="margin-top:10px"><button id="enable-browser-notify">启用浏览器通知</button><button id="test-browser-notify">发送测试通知</button></div></div>
    <div class="card"><h2>MCP 接入</h2><div class="hint">HTTP MCP 地址（用 Agent Bearer token）：</div><div class="secret" id="mcp-url"></div><div class="hint" style="margin-top:8px">工具：list_secrets / request_access / get_secret。Codex、Hermes 可直接配置 HTTP MCP。</div></div>
  </section>
</section>
<div class="hint" style="text-align:center;margin-top:18px">Workers PoC · 浏览器 KDF · Durable Object 会话 · D1 只读 · 免费版可用</div>
</div>
<div id="modal" class="modal hidden"><div class="card"><h2 id="modal-title"></h2><div id="modal-body"></div><div style="margin-top:12px"><button id="modal-close">关闭</button></div></div></div>
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
let app = { me: null, data: { agents: [], policies: {}, grants: [], pending: [], audit: [] }, items: [], stats: null, range: '24h', token: '' }
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const status = (id, text, cls = '') => { const el = $(id); if (el) { el.textContent = text; el.className = 'status ' + cls } }
function show(id, visible) { $(id).classList.toggle('hidden', !visible) }
function toast(text, error = false) { status('item-status', text, error ? 'error' : 'ok') }

async function boot() { try { app.me = await api('/api/me'); show('login-card', false); $('who').textContent = app.me.email || ''; $('avatar').textContent = (app.me.email || 'SB').slice(0, 2).toUpperCase(); show('lock', true); if (app.me.unlocked) { show('dashboard', true); show('unlock-card', false); await loadAll() } else { show('dashboard', false); show('unlock-card', true) } } catch { show('login-card', true); show('dashboard', false); show('unlock-card', false); loadOidcLogin() } }
async function loadOidcLogin() { try { const data = await api('/api/oidc/status'); if (data.enabled) $('login-oidc').innerHTML = '<a href="/oidc/login"><button class="primary">使用 OIDC（xid）登录</button></a><span class="hint" style="margin-left:8px">' + esc(data.issuer) + '</span>'; else $('login-oidc').innerHTML = '<span class="hint">未配置 OIDC</span>' } catch {} }
$('login').onclick = async () => { try { status('login-status', '登录中…'); await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('admin-password').value, code: $('totp-code').value }) }); $('admin-password').value = ''; $('totp-code').value = ''; show('totp-row', false); await boot() } catch (error) { if (error.status === 401 && error.data?.totpRequired) { show('totp-row', true); status('login-status', error.data.error || '请输入两步验证码', 'error') } else status('login-status', error.message, 'error') } }
$('avatar').onclick = (event) => { event.stopPropagation(); show('account-menu', $('account-menu').classList.contains('hidden')) }
document.addEventListener('click', (event) => { if (!$('account-menu').classList.contains('hidden') && !event.target.closest('#account-menu') && !event.target.closest('#avatar')) show('account-menu', false) })
$('account-logout').onclick = async () => { try { await api('/api/logout', { method: 'POST' }) } catch {} location.reload() }
document.querySelectorAll('#account-menu [data-view]').forEach((button) => { button.onclick = () => { show('account-menu', false); document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', false)); document.querySelectorAll('.view').forEach((section) => section.classList.toggle('hidden', section.id !== 'view-' + button.dataset.view)); if (button.dataset.view === 'settings') loadSettings(); if (button.dataset.view === 'profile') loadProfile() } })
function applyTheme(mode) { const next = mode || localStorage.getItem('theme') || 'auto'; const effective = next === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (next === 'dark' ? 'dark' : 'light'); document.documentElement.dataset.theme = effective; localStorage.setItem('theme', next); document.querySelectorAll('#theme-switch button').forEach((button) => button.classList.toggle('on', button.dataset.themeMode === next)) }
document.querySelectorAll('#theme-switch button').forEach((button) => { button.onclick = () => applyTheme(button.dataset.themeMode) })
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
async function lock() { try { await api('/api/lock', { method: 'POST' }) } catch {} show('dashboard', false); show('unlock-card', true); status('unlock-status', '已锁定', 'ok') }
$('lock').onclick = lock; $('lock2').onclick = lock
document.querySelectorAll('#nav button').forEach((button) => { button.onclick = () => { const view = button.dataset.view; document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b === button)); document.querySelectorAll('.view').forEach((section) => section.classList.toggle('hidden', section.id !== 'view-' + view)); if (view === 'settings') loadSettings(); if (view === 'profile') loadProfile() } })
document.querySelectorAll('#range-row button').forEach((button) => { button.onclick = () => { app.range = button.dataset.range; document.querySelectorAll('#range-row button').forEach((b) => b.classList.toggle('on', b === button)); loadStats() } })
$('items-refresh').onclick = loadItems; $('item-filter').oninput = renderItems; $('agent-create').onclick = createAgent; $('settings-save').onclick = saveSettings; $('profile-save').onclick = saveProfile; $('password-save').onclick = changePassword; $('totp-setup').onclick = setup2fa; $('totp-enable').onclick = enable2fa; $('totp-disable').onclick = disable2fa; $('enable-browser-notify').onclick = enableBrowserNotifications; $('test-browser-notify').onclick = () => showBrowserNotification('测试通知', '浏览器通知工作正常')
$('mcp-url').textContent = location.origin + '/mcp'
$('copy-token').onclick = async () => { try { await navigator.clipboard.writeText(app.token); toast('已复制 token') } catch { toast('复制失败', true) } }
$('modal-close').onclick = () => show('modal', false)
$('items-box').addEventListener('click', async (event) => { const menu = event.target.closest('[data-item-menu]'); if (menu) { openItemMenu(menu.dataset.itemMenu); return } const toggle = event.target.closest('[data-policy]'); if (toggle) { const item = app.items.find((entry) => entry.name === toggle.dataset.policy); if (!item) return; try { await api('/api/policies', { method: 'POST', body: JSON.stringify({ name: item.name, noApproval: !item.noApproval }) }); await loadItems(); toast('已更新免审批策略') } catch (error) { toast(error.message, true) } return } const read = event.target.closest('[data-read]'); if (read) reveal(read.dataset.read) })
$('agents-box').addEventListener('click', (event) => { const menu = event.target.closest('[data-agent-menu]'); if (menu) openAgentMenu(menu.dataset.agentMenu) })
$('pending-box').addEventListener('click', async (event) => { const button = event.target.closest('[data-decide]'); if (!button) return; try { await api('/api/pending/decide', { method: 'POST', body: JSON.stringify({ id: button.dataset.id, decision: button.dataset.decide }) }); await Promise.all([loadState(), loadStats(), loadItems()]); toast('已处理') } catch (error) { toast(error.message, true) } })
$('grants-box').addEventListener('click', (event) => { const menu = event.target.closest('[data-grant-menu]'); if (menu) openGrantMenu(menu.dataset.agent, menu.dataset.name) })

async function loadAll() { await Promise.all([loadState(), loadItems(), loadStats()]); startPendingPolling(); updateBrowserNotifyStatus() }
let pendingTimer = null
let knownPending = new Set()
let pendingInitialized = false
function updateBrowserNotifyStatus() { const el = $('browser-notify-status'); if (!el) return; el.textContent = typeof Notification === 'undefined' ? '此浏览器不支持通知' : '当前权限：' + Notification.permission }
function showBrowserNotification(title, body, tag) { if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return; try { const notification = new Notification(title, { body, tag }); notification.onclick = () => { window.focus(); document.querySelector('#nav [data-view=grants]').click(); notification.close() } } catch {} }
async function enableBrowserNotifications() { if (typeof Notification === 'undefined') return status('settings-status', '此浏览器不支持通知', 'error'); const permission = await Notification.requestPermission(); updateBrowserNotifyStatus(); if (permission === 'granted') { status('settings-status', '浏览器通知已启用', 'ok'); startPendingPolling() } else status('settings-status', '未获得通知权限', 'error') }
async function checkPendingNotifications() {
  try {
    const data = await api('/api/state'); const ids = new Set((data.pending || []).map((entry) => entry.id))
    if (pendingInitialized) {
      for (const entry of data.pending || []) if (!knownPending.has(entry.id)) showBrowserNotification('Secrets Broker 授权请求', (entry.agent || 'Agent') + ' 请求读取「' + entry.name + '」', entry.id)
    }
    knownPending = ids; pendingInitialized = true
  } catch {}
}
function startPendingPolling() { updateBrowserNotifyStatus(); if (pendingTimer) return; checkPendingNotifications(); pendingTimer = setInterval(checkPendingNotifications, 15000) }
async function loadState() { try { app.data = await api('/api/state'); renderAgents(); renderPending(); renderGrants(); renderRecent(); renderLogs() } catch (error) { if (error.status === 423) { show('dashboard', false); show('unlock-card', true) } } }
async function loadItems() { status('item-status', '加载中…'); try { app.items = (await api('/api/items')).items || []; renderItems(); status('item-status', '共 ' + app.items.length + ' 个条目') } catch (error) { if (error.status === 423) { show('dashboard', false); show('unlock-card', true) } else status('item-status', error.message, 'error') } }
async function loadStats() { try { app.stats = await api('/api/stats?range=' + app.range); renderStats() } catch {} }
async function loadSettings() {
  try {
    const data = await api('/api/settings'); const n = data.notifications || {}
    $('tg-chat').value = n.telegram?.chatId || ''
    $('tg-status').textContent = n.telegram?.configured ? '已配置（token 已保存）' : '未配置'
    $('ntfy-url').value = n.ntfy?.url || ''; $('ntfy-topic').value = n.ntfy?.topic || ''
    $('ntfy-status').textContent = n.ntfy?.configured ? '已配置' : '未配置'
    $('gotify-url').value = n.gotify?.url || ''
    $('gotify-status').textContent = n.gotify?.configured ? '已配置（token 已保存）' : '未配置'
    $('wxpush-url').value = n.wxpush?.url || ''
    $('wxpush-status').textContent = n.wxpush?.configured ? '已配置（token 已保存）' : '未配置'
    const oidc = data.oidc || {}
    $('oidc-issuer').value = oidc.issuer || ''; $('oidc-client-id').value = oidc.clientId || ''; $('oidc-redirect').value = oidc.redirectUri || ''; $('oidc-scope').value = oidc.scope || ''
    $('oidc-config-status').textContent = oidc.configured ? '已配置' + (oidc.secretConfigured ? '（client secret 已保存）' : '') : '未配置'
    $('mcp-url').textContent = location.origin + '/mcp'
  } catch (error) { status('settings-status', error.message, 'error') }
}
async function saveSettings() {
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ notifications: {
      telegram: { botToken: $('tg-token').value, chatId: $('tg-chat').value },
      ntfy: { url: $('ntfy-url').value, topic: $('ntfy-topic').value },
      gotify: { url: $('gotify-url').value, token: $('gotify-token').value },
      wxpush: { url: $('wxpush-url').value, token: $('wxpush-token').value },
    }, oidc: {
      issuer: $('oidc-issuer').value, clientId: $('oidc-client-id').value, clientSecret: $('oidc-client-secret').value,
      redirectUri: $('oidc-redirect').value, scope: $('oidc-scope').value,
    } }) })
    $('tg-token').value = ''; $('gotify-token').value = ''; $('wxpush-token').value = ''; $('oidc-client-secret').value = ''
    status('settings-status', '已保存', 'ok'); await loadSettings()
  } catch (error) { status('settings-status', error.message, 'error') }
}
function renderStats() {
  const stats = app.stats || { totalReads: 0, activeAgents: 0, pending: 0, activeGrants: 0, buckets: [], topItems: [], topAgents: [] }
  const cards = [{ l: '读取次数', v: stats.totalReads, sub: '当前区间' }, { l: '活跃 Agent', v: stats.activeAgents, sub: '有读取记录' }, { l: '待批准', v: stats.pending, sub: '需要处理', warn: stats.pending > 0 }, { l: '有效授权', v: stats.activeGrants, sub: '含免审批' }]
  $('kpis').innerHTML = cards.map((card) => '<div class="kpi' + (card.warn ? ' warn' : '') + '"><div class="label">' + card.l + '</div><div class="value">' + card.v + '</div><div class="sub">' + card.sub + '</div></div>').join('')
  const buckets = stats.buckets || []; const max = Math.max(1, ...buckets.map((b) => b.count)); const W = 600, H = 180, px = 38, py = 18, iw = W - 2 * px, ih = H - 2 * py; const slot = buckets.length ? iw / buckets.length : 0; const barW = Math.max(2, Math.min(26, slot * 0.58))
  let grid = ''; for (let g = 0; g <= 4; g++) { const y = py + ih * g / 4; grid += '<line x1="' + px + '" y1="' + y + '" x2="' + (W - px) + '" y2="' + y + '" stroke="currentColor" stroke-opacity=".1"/><text x="4" y="' + (y + 3) + '" fill="currentColor" font-size="9" opacity=".5">' + Math.round(max * (4 - g) / 4) + '</text>' }
  const bars = buckets.map((bucket, index) => { const h = bucket.count / max * ih; const x = px + index * slot + (slot - barW) / 2; const y = H - py - h; return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(h, 0.6).toFixed(1) + '" rx="2" fill="#0f9d8a" opacity="' + (bucket.count ? 0.95 : 0.22) + '"><title>' + esc(bucket.label) + '：' + bucket.count + ' 次</title></rect>' }).join('')
  const labels = buckets.map((bucket, index) => index % Math.max(1, Math.ceil(buckets.length / 6)) === 0 ? '<text x="' + (px + index * slot + slot / 2).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" fill="currentColor" font-size="9" opacity=".55">' + esc(bucket.label) + '</text>' : '').join('')
  $('chart-box').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '">' + grid + bars + labels + '</svg>'
  const agents = stats.topAgents || []; const totalAgents = agents.reduce((sum, agent) => sum + agent.count, 0); const colors = ['#0f9d8a', '#5b6cff', '#f2994a', '#b6c2d9', '#a78bfa', '#14b8a6']; let cursor = 0; const gradient = agents.map((agent, index) => { const from = cursor; cursor += agent.count / Math.max(1, totalAgents) * 360; return colors[index % colors.length] + ' ' + from.toFixed(1) + 'deg ' + cursor.toFixed(1) + 'deg' }); if (!gradient.length) gradient.push('var(--btn) 0deg 360deg')
  $('donut-box').innerHTML = '<div class="donut" style="background:conic-gradient(' + gradient.join(',') + ')"><div class="donut-center">' + totalAgents + '</div></div><div class="legend">' + agents.map((agent, index) => '<div><span><span class="dot" style="background:' + colors[index % colors.length] + '"></span>' + esc(agent.name) + '</span><b>' + Math.round(agent.count / Math.max(1, totalAgents) * 100) + '%</b></div>').join('') + '</div>'
  const top = stats.topItems || []; const totalTop = top.reduce((sum, item) => sum + item.count, 0) || 1; const maxTop = Math.max(1, ...top.map((item) => item.count))
  $('top-box').innerHTML = top.length ? '<table><tr><th>#</th><th>条目</th><th>读取</th><th>占比</th><th>趋势</th></tr>' + top.map((item, index) => '<tr><td>' + (index + 1) + '</td><td><b>' + esc(item.name) + '</b></td><td>' + item.count + '</td><td>' + Math.round(item.count / totalTop * 100) + '%</td><td><span style="display:inline-block;height:6px;width:90px;background:#eef1f6;border-radius:99px;overflow:hidden"><i style="display:block;height:100%;width:' + Math.round(item.count / maxTop * 100) + '%;background:#0f9d8a"></i></span></td></tr>').join('') + '</table>' : '<div class="hint">该区间暂无读取记录</div>'
  $('updated').textContent = '最后更新 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })
}
function renderItems() {
  const query = ($('item-filter')?.value || '').trim().toLowerCase(); const items = (app.items || []).filter((item) => !query || item.name.toLowerCase().includes(query) || String(item.url || '').toLowerCase().includes(query) || String(item.group || '').toLowerCase().includes(query))
  $('items-box').innerHTML = items.length ? '<table><tr><th>名称</th><th>分组</th><th>网址</th><th>类型</th><th>免审批</th><th>操作</th></tr>' + items.map((item) => '<tr><td><b>' + esc(item.name) + '</b></td><td class="hint">' + esc(item.group || '') + '</td><td class="hint">' + esc(item.url || '') + '</td><td>' + item.type + '</td><td><button class="small ' + (item.noApproval ? 'primary' : '') + '" data-policy="' + esc(item.name) + '">' + (item.noApproval ? '免审批' : '需审批') + '</button></td><td><button class="small" data-read="' + esc(item.name) + '">读取</button> <button class="small" data-item-menu="' + esc(item.name) + '" title="更多">⋮</button></td></tr>').join('') + '</table>' : '<div class="hint">没有条目</div>'
}
function renderAgents() {
  const agents = app.data.agents || []
  $('agents-box').innerHTML = agents.length ? '<table><tr><th>Agent</th><th>显示名</th><th>可读范围</th><th>写入</th><th>操作</th></tr>' + agents.map((agent) => '<tr><td><b>' + esc(agent.name) + '</b></td><td>' + esc(agent.alias || '') + '</td><td class="hint">' + esc(agent.allow && agent.allow.length ? agent.allow.join(', ') : (agent.groups && agent.groups.length ? '分组：' + agent.groups.join(', ') : '全部')) + '</td><td>' + (agent.write ? '开' : '关') + '</td><td><button class="small" data-agent-menu="' + esc(agent.name) + '" title="更多">⋮</button></td></tr>').join('') + '</table>' : '<div class="hint">还没有 Agent</div>'
}
function renderPending() {
  const pending = app.data.pending || []
  $('pending-box').innerHTML = pending.length ? '<table><tr><th>Agent</th><th>条目</th><th>时间</th><th>授权</th></tr>' + pending.map((request) => '<tr><td>' + esc(request.agent) + '</td><td><b>' + esc(request.name) + '</b></td><td>' + esc(new Date(request.createdAt).toLocaleTimeString('zh-CN', { hour12: false })) + '</td><td>' + [['once', '仅本次'], ['1h', '1 小时'], ['24h', '24 小时'], ['7d', '7 天'], ['always', '永久']].map((mode) => '<button class="small primary" data-decide="' + mode[0] + '" data-id="' + esc(request.id) + '">' + mode[1] + '</button>').join('') + '<button class="small danger" data-decide="deny" data-id="' + esc(request.id) + '">拒绝</button></td></tr>').join('') + '</table>' : '<div class="hint">暂无待批准请求</div>'
}
function renderGrants() {
  const grants = (app.data.grants || []).filter((grant) => !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > Date.now()))
  $('grants-box').innerHTML = grants.length ? '<table><tr><th>Agent</th><th>条目</th><th>模式</th><th>到期</th><th>读取</th><th>操作</th></tr>' + grants.map((grant) => '<tr><td>' + esc(grant.agent) + '</td><td><b>' + esc(grant.name) + '</b></td><td>' + esc(grant.mode) + '</td><td>' + (grant.expiresAt ? new Date(grant.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '永久') + '</td><td>' + (grant.reads ?? 0) + (grant.maxReads ? ' / ' + grant.maxReads : '') + '</td><td><button class="small" data-grant-menu data-agent="' + esc(grant.agent) + '" data-name="' + esc(grant.name) + '" title="更多">⋮</button></td></tr>').join('') + '</table>' : '<div class="hint">暂无有效授权</div>'
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
async function reveal(name) { try { const data = await api('/secret?name=' + encodeURIComponent(name)); $('modal-title').textContent = '读取 ' + name; $('modal-body').innerHTML = '<div class="hint">仅用于人工查看；Agent 应通过 /secret 或 MCP 获取。</div><div class="secret">' + esc(data.value || '(空)') + '</div>'; show('modal', true) } catch (error) { toast(error.message, true) } }
function openModal(title, body) { $('modal-title').textContent = title; $('modal-body').innerHTML = body; show('modal', true) }
function openItemMenu(name) {
  const item = app.items.find((entry) => entry.name === name); if (!item) return
  const agents = app.data.agents || []
  openModal('条目「' + name + '」', '<label class="field">名称</label><input id="mi-name" value="' + esc(item.name) + '"><label class="field">分组</label><input id="mi-group" value="' + esc(item.group || '') + '" placeholder="例如 blog/prod"><label class="field">网址</label><input id="mi-url" value="' + esc(item.url || '') + '"><label class="field">备注（留空不改）</label><input id="mi-notes" placeholder="新的备注"><label class="field">新密钥值（留空不改）</label><input id="mi-value" type="password" placeholder="留空保留原值"><label class="chk" style="margin-top:8px"><input type="checkbox" id="mi-noapproval" ' + (item.noApproval ? 'checked' : '') + '> 免审批（自动读取，仍记录）</label><div class="row" style="margin-top:14px"><button class="primary" id="mi-save">保存修改</button><button id="mi-share">分享</button><button class="danger" id="mi-delete">删除</button></div><div style="border-top:1px solid var(--line);margin-top:14px;padding-top:10px"><div class="hint">分享给 Agent（直接生成授权）</div><label class="field">Agent（可多选）</label><select id="mi-share-agent" multiple size="3">' + agents.map((agent) => '<option value="' + esc(agent.name) + '">' + esc(agent.alias || agent.name) + '</option>').join('') + '</select><label class="field">时长</label><select id="mi-share-seconds"><option value="3600">1 小时</option><option value="86400">24 小时</option><option value="604800">7 天</option><option value="2592000">30 天</option><option value="0">永久</option></select><label class="field">最多读取次数（留空不限）</label><input id="mi-share-reads" type="number" min="1"></div>')
  $('mi-save').onclick = async () => { try { await api('/api/items/update', { method: 'POST', body: JSON.stringify({ name: item.name, newName: $('mi-name').value.trim(), group: $('mi-group').value.trim(), url: $('mi-url').value.trim(), notes: $('mi-notes').value.trim() ? $('mi-notes').value : undefined, value: $('mi-value').value, noApproval: $('mi-noapproval').checked }) }); show('modal', false); await Promise.all([loadItems(), loadState()]); toast('已保存') } catch (error) { toast(error.message, true) } }
  $('mi-delete').onclick = async () => { if (!confirm('删除条目「' + item.name + '」？')) return; try { await api('/api/items/delete', { method: 'POST', body: JSON.stringify({ name: item.name }) }); show('modal', false); await Promise.all([loadItems(), loadState()]); toast('已删除') } catch (error) { toast(error.message, true) } }
  $('mi-share').onclick = async () => { const agents = [...$('mi-share-agent').selectedOptions].map((option) => option.value); if (!agents.length) return toast('至少选择一个 Agent', true); try { await api('/api/grants/share', { method: 'POST', body: JSON.stringify({ name: $('mi-name').value.trim() || item.name, agents, seconds: Number($('mi-share-seconds').value), maxReads: $('mi-share-reads').value || null }) }); show('modal', false); await loadState(); toast('已分享') } catch (error) { toast(error.message, true) } }
}
function openAgentMenu(name) {
  const agent = app.data.agents.find((entry) => entry.name === name); if (!agent) return
  openModal('Agent「' + name + '」', '<label class="field">显示名</label><input id="ma-alias" value="' + esc(agent.alias || '') + '"><label class="field">可读条目（逗号分隔，留空=全部）</label><input id="ma-allow" value="' + esc((agent.allow || []).join(', ')) + '"><label class="field">可读分组（逗号分隔，留空=不限）</label><input id="ma-groups" value="' + esc((agent.groups || []).join(', ')) + '"><label class="chk" style="margin-top:8px"><input type="checkbox" id="ma-write" ' + (agent.write ? 'checked' : '') + '> 允许写入</label><div class="row" style="margin-top:14px"><button class="primary" id="ma-save">保存权限</button><button id="ma-copy">复制 token</button><button id="ma-rotate">轮换 token</button><button class="danger" id="ma-delete">删除</button></div><div class="secret hidden" id="ma-token"></div>')
  $('ma-save').onclick = async () => { try { await api('/api/agents/update', { method: 'POST', body: JSON.stringify({ name, alias: $('ma-alias').value.trim(), allow: $('ma-allow').value.split(',').map((v) => v.trim()).filter(Boolean), groups: $('ma-groups').value.split(',').map((v) => v.trim()).filter(Boolean), write: $('ma-write').checked }) }); show('modal', false); await loadState(); toast('权限已保存') } catch (error) { toast(error.message, true) } }
  $('ma-copy').onclick = async () => { try { const data = await api('/api/agents/token', { method: 'POST', body: JSON.stringify({ name }) }); $('ma-token').textContent = data.token; $('ma-token').classList.remove('hidden'); await navigator.clipboard.writeText(data.token); toast('token 已复制') } catch (error) { toast(error.message, true) } }
  $('ma-rotate').onclick = async () => { if (!confirm('轮换 ' + name + ' 的 token？旧 token 会立即失效。')) return; try { const data = await api('/api/agents/rotate', { method: 'POST', body: JSON.stringify({ name }) }); $('ma-token').textContent = data.token; $('ma-token').classList.remove('hidden'); await navigator.clipboard.writeText(data.token); await loadState(); toast('已轮换并复制新 token') } catch (error) { toast(error.message, true) } }
  $('ma-delete').onclick = async () => { if (!confirm('删除 Agent ' + name + '？')) return; try { await api('/api/agents/delete', { method: 'POST', body: JSON.stringify({ name }) }); show('modal', false); await loadState(); toast('已删除') } catch (error) { toast(error.message, true) } }
}
function openGrantMenu(agent, name) {
  const grant = (app.data.grants || []).find((entry) => entry.agent === agent && entry.name === name); if (!grant) return
  const seconds = !grant.expiresAt ? 0 : Math.max(0, Math.round((grant.expiresAt - Date.now()) / 1000))
  const nearest = !grant.expiresAt ? 0 : ([3600, 86400, 604800, 2592000].find((value) => seconds <= value) || 0)
  openModal('授权「' + agent + ' → ' + name + '」', '<label class="field">时长</label><select id="mg-seconds"><option value="3600" ' + (nearest === 3600 ? 'selected' : '') + '>1 小时</option><option value="86400" ' + (nearest === 86400 ? 'selected' : '') + '>24 小时</option><option value="604800" ' + (nearest === 604800 ? 'selected' : '') + '>7 天</option><option value="2592000" ' + (nearest === 2592000 ? 'selected' : '') + '>30 天</option><option value="0" ' + (nearest === 0 ? 'selected' : '') + '>永久</option></select><label class="field">最多读取次数（留空不限）</label><input id="mg-max" type="number" min="1" value="' + (grant.maxReads ?? '') + '"><div class="row" style="margin-top:14px"><button class="primary" id="mg-save">保存授权</button><button class="danger" id="mg-revoke">撤销</button><button class="danger" id="mg-delete">删除记录</button></div>')
  $('mg-save').onclick = async () => { try { await api('/api/grants/update', { method: 'POST', body: JSON.stringify({ agent, name, seconds: Number($('mg-seconds').value), maxReads: $('mg-max').value || null }) }); show('modal', false); await loadState(); toast('已更新授权') } catch (error) { toast(error.message, true) } }
  $('mg-revoke').onclick = async () => { try { await api('/api/grants/revoke', { method: 'POST', body: JSON.stringify({ agent, name }) }); show('modal', false); await loadState(); toast('已撤销') } catch (error) { toast(error.message, true) } }
  $('mg-delete').onclick = async () => { if (!confirm('删除这条授权记录？')) return; try { await api('/api/grants/delete', { method: 'POST', body: JSON.stringify({ agent, name }) }); show('modal', false); await loadState(); toast('已删除') } catch (error) { toast(error.message, true) } }
}
async function loadProfile() {
  try {
    const data = await api('/api/profile'); const profile = data.profile || {}
    $('profile-name').value = profile.name || ''; $('profile-email').value = profile.email || profile.oidcEmail || ''; $('profile-avatar').value = profile.avatarUrl || ''
    const oidc = data.oidcEnabled ? '<div class="hint">OIDC issuer：<code>' + esc(data.oidcIssuer) + '</code>' + (profile.oidcSub ? '<br>已绑定：<code>' + esc(profile.oidcEmail || profile.oidcSub) + '</code>' : '<br>尚未绑定，点击登录即可绑定') + '</div><div style="margin-top:10px"><a href="/oidc/login"><button class="primary">使用 OIDC（xid）登录 / 绑定</button></a></div>' : '<div class="hint">未配置 OIDC。设置 OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET 后重启即可。</div>'
    $('oidc-box').innerHTML = oidc
    await loadSecurity()
  } catch (error) { status('profile-status', error.message, 'error') }
}
async function saveProfile() { try { await api('/api/profile', { method: 'POST', body: JSON.stringify({ name: $('profile-name').value, email: $('profile-email').value, avatarUrl: $('profile-avatar').value }) }); status('profile-status', '已保存', 'ok'); $('who').textContent = $('profile-email').value; } catch (error) { status('profile-status', error.message, 'error') } }
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
async function createAgent() { try { const name = $('agent-name').value.trim(); if (!name) return status('agent-status', '请输入名称', 'error'); const allow = $('agent-allow').value.split(',').map((value) => value.trim()).filter(Boolean); const result = await api('/api/agents/create', { method: 'POST', body: JSON.stringify({ name, alias: $('agent-alias').value.trim(), allow, write: $('agent-write').checked }) }); app.token = result.token; $('new-token-value').textContent = result.token; show('new-token', true); $('agent-name').value = ''; $('agent-alias').value = ''; $('agent-allow').value = ''; $('agent-write').checked = false; status('agent-status', '已创建，token 只显示一次', 'ok'); await loadState() } catch (error) { status('agent-status', error.message, 'error') } }
boot()
</script></body></html>`
