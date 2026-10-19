export const uiHtml = String.raw`<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Secrets Broker · Workers</title>
<style>
:root{--bg:#f4f7fb;--card:#fff;--line:#e3e9f2;--text:#152033;--muted:#6b7890;--ok:#0f9d8a;--warn:#f2994a;--btn:#eef1f6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:28px 22px}
header{display:flex;align-items:center;gap:12px;margin-bottom:18px}h1{font-size:19px;margin:0}
.badge{background:#e8f7f4;color:#0b7d6d;border-radius:999px;padding:2px 9px;font-size:11px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin-bottom:16px;box-shadow:0 8px 24px rgba(20,40,80,.04)}
h2{font-size:14px;margin:0 0 6px}.muted{color:var(--muted);font-size:12px}
label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
input,select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;font:inherit;outline:none}
input:focus,select:focus{border-color:var(--ok)}
button{border:0;border-radius:10px;padding:10px 14px;font:inherit;cursor:pointer;background:var(--btn);color:var(--text)}
button.primary{background:var(--ok);color:#fff}button.danger{background:#fdecec;color:#c0392b}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.row>*{flex:1;min-width:160px}.row button{flex:0 0 auto}
.hidden{display:none!important}.status{min-height:20px;font-size:12px;color:var(--muted);margin-top:10px}
.error{color:#c0392b}.ok{color:var(--ok)}
ul{list-style:none;margin:10px 0 0;padding:0}li{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}li:last-child{border-bottom:0}
li .name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
li .type{color:var(--muted);font-size:11px}
.secret{background:#0f172a;color:#d1fae5;border-radius:10px;padding:12px;margin-top:10px;word-break:break-all;font-family:ui-monospace,monospace;font-size:12px}
footer{color:var(--muted);font-size:11px;margin-top:20px;text-align:center}
</style></head><body><div class="wrap">
<header><h1>Secrets Broker</h1><span class="badge">Cloudflare Workers</span><span class="muted" style="margin-left:auto" id="who"></span><button id="lock" class="hidden danger">锁定</button></header>

<div id="login-card" class="card hidden">
  <h2>管理登录</h2><div class="muted">登录后才能解锁 vault。</div>
  <label>管理密码</label><input id="admin-password" type="password" autocomplete="current-password">
  <div style="margin-top:12px"><button class="primary" id="login">登录</button></div>
  <div class="status" id="login-status"></div>
</div>

<div id="unlock-card" class="card hidden">
  <h2>解锁 vault</h2>
  <div class="muted">主密码只在本浏览器中做 PBKDF2/HKDF，服务器只收到派生出的会话密钥，不会收到主密码。</div>
  <label>主密码</label><input id="master-password" type="password" autocomplete="current-password">
  <label>解锁有效期</label><select id="ttl"><option value="permanent">永久（可手动锁定）</option><option value="604800">7 天</option><option value="86400">24 小时</option><option value="3600">1 小时</option></select>
  <div class="row" style="margin-top:12px"><button class="primary" id="unlock">解锁</button><button id="lock2">锁定</button></div>
  <div class="status" id="unlock-status"></div>
</div>

<div id="vault-card" class="card hidden">
  <h2>密钥列表</h2><div class="muted" id="vault-meta">会话已解锁</div>
  <div class="row" style="margin-top:8px"><input id="filter" placeholder="搜索条目…"><button id="refresh">刷新</button></div>
  <ul id="items"></ul>
  <div id="secret-box" class="hidden"><div class="secret" id="secret-value"></div><div style="margin-top:8px"><button id="copy">复制</button></div></div>
  <div class="status" id="vault-status"></div>
</div>
<footer>Workers PoC · 浏览器 KDF · Durable Object 会话 · D1 只读</footer>
</div>
<script>
const $ = (id) => document.getElementById(id)
const enc = new TextEncoder(), dec = new TextDecoder()
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const cat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out }
async function hmac(keyBytes, data) { const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', key, data)) }
async function pbkdf2(password, salt, iterations) { const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256)) }
async function hkdf(prk, info, length) { const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const infoBytes = enc.encode(info); const out = new Uint8Array(length); let prev = new Uint8Array(0), offset = 0, counter = 1; while (offset < length) { const input = new Uint8Array(prev.length + infoBytes.length + 1); input.set(prev); input.set(infoBytes, prev.length); input[input.length - 1] = counter; prev = new Uint8Array(await crypto.subtle.sign('HMAC', key, input)); const n = Math.min(prev.length, length - offset); out.set(prev.slice(0, n), offset); offset += n; counter += 1 } return out }
async function decryptBw(text, encKey, macKey) { const dot = text.indexOf('.'); const type = Number(text.slice(0, dot)); const parts = text.slice(dot + 1).split('|'); const iv = unb64(parts[0]), ct = unb64(parts[1]); if (type === 2) { const expected = await hmac(macKey, cat(iv, ct)); const mac = unb64(parts[2]); if (!expected.every((b, i) => b === mac[i])) throw new Error('MAC 校验失败') } const key = await crypto.subtle.importKey('raw', encKey, { name: 'AES-CBC' }, false, ['decrypt']); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct)) }
async function api(path, options = {}) { const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status)); return body }
let state = { unlocked: false, items: [] }
function setStatus(id, text, cls = '') { const el = $(id); if (!el) return; el.textContent = text; el.className = 'status ' + cls }
function show(id, visible) { $(id).classList.toggle('hidden', !visible) }
async function boot() {
  try { const me = await api('/api/me'); $('who').textContent = me.email || ''; show('login-card', false); await afterLogin() }
  catch { show('login-card', true); show('unlock-card', false); show('vault-card', false) }
}
async function afterLogin() {
  try { const me = await api('/api/me'); $('who').textContent = me.email || ''; show('login-card', false); show('lock', true); if (me.unlocked) { state.unlocked = true; show('unlock-card', false); show('vault-card', true); await loadItems() } else { show('unlock-card', true); show('vault-card', false) } }
  catch { show('login-card', true) }
}
$('login').onclick = async () => { const password = $('admin-password').value; if (!password) return; try { setStatus('login-status', '登录中…'); await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) }); $('admin-password').value = ''; await afterLogin() } catch (error) { setStatus('login-status', error.message, 'error') } }
$('unlock').onclick = async () => {
  const password = $('master-password').value; if (!password) return
  setStatus('unlock-status', '正在浏览器本地派生密钥…（约 0.3–1 秒）')
  try {
    const info = await api('/api/bootstrap')
    if (info.kdfType !== 0) throw new Error('暂不支持 Argon2 KDF（当前 kdfType=' + info.kdfType + '）')
    const masterKey = await pbkdf2(password, String(info.email).toLowerCase(), info.kdfIterations)
    const encKey = await hkdf(masterKey, 'enc', 32), macKey = await hkdf(masterKey, 'mac', 32)
    const userKey = await decryptBw(info.profileKey, encKey, macKey)
    if (userKey.length < 64) throw new Error('user key 长度异常')
    const symEncKey = b64(userKey.slice(0, 32)), symMacKey = b64(userKey.slice(32, 64))
    setStatus('unlock-status', '正在建立会话…')
    const result = await api('/api/unlock', { method: 'POST', body: JSON.stringify({ symEncKey, symMacKey, ttl: $('ttl').value }) })
    state.unlocked = true; $('master-password').value = ''; setStatus('unlock-status', result.permanent ? '已永久解锁' : '已解锁', 'ok'); show('unlock-card', false); show('vault-card', true); await loadItems()
  } catch (error) { setStatus('unlock-status', error.message, 'error') }
}
async function lock() { try { await api('/api/lock', { method: 'POST' }); } catch {} state.unlocked = false; show('vault-card', false); show('unlock-card', true); show('lock', false); setStatus('unlock-status', '已锁定', 'ok') }
$('lock').onclick = lock; $('lock2').onclick = lock
$('refresh').onclick = () => loadItems()
$('filter').oninput = () => renderItems()
async function loadItems() { setStatus('vault-status', '加载中…'); try { const data = await api('/api/ciphers'); state.items = data.items || []; renderItems(); setStatus('vault-status', '共 ' + state.items.length + ' 个条目') } catch (error) { setStatus('vault-status', error.message, 'error') } }
function renderItems() {
  const query = $('filter').value.trim().toLowerCase(); const list = state.items.filter((item) => !query || item.name.toLowerCase().includes(query) || String(item.url || '').toLowerCase().includes(query))
  $('items').innerHTML = list.map((item) => '<li><span class="name">' + escapeHtml(item.name) + '</span><span class="type">' + (item.url ? escapeHtml(item.url) : 'type ' + item.type) + '</span><button data-name="' + escapeHtml(item.name) + '">读取</button></li>').join('') || '<li class="muted">没有条目</li>'
  $('items').querySelectorAll('button[data-name]').forEach((button) => { button.onclick = () => reveal(button.dataset.name) })
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
async function reveal(name) { try { setStatus('vault-status', '读取中…'); const data = await api('/secret?name=' + encodeURIComponent(name)); $('secret-value').textContent = data.value || '(空)'; show('secret-box', true); setStatus('vault-status', '已读取：' + name) } catch (error) { setStatus('vault-status', error.message, 'error') } }
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('secret-value').textContent); setStatus('vault-status', '已复制', 'ok') } catch { setStatus('vault-status', '复制失败', 'error') } }
boot()
</script></body></html>`
