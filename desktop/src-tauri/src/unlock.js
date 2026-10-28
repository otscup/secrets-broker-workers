// Runs inside the desktop WebView on every remote page load. The browser
// console already has the password form; this puts the same Vault password in
// front of the user before the dashboard is usable, without adding a second
// login system.
(() => {
  if (!/^https?:$/.test(location.protocol) || window.__sbUnlockInstalled) return;
  window.__sbUnlockInstalled = true;

  let busy = false;
  let dismissed = false;

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    return body;
  };

  const remove = () => {
    const node = document.getElementById('sb-app-unlock');
    if (node) node.remove();
  };

  const show = (vault) => {
    if (dismissed || document.getElementById('sb-app-unlock')) return;
    const initialized = Boolean(vault && vault.initialized);
    const root = document.createElement('div');
    root.id = 'sb-app-unlock';
    root.innerHTML = `
      <div style="position:fixed;inset:0;z-index:2147483647;background:rgba(8,12,18,.72);display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif">
        <form id="sb-app-unlock-form" style="width:min(420px,100%);background:#fff;color:#17202a;border-radius:16px;padding:26px;box-shadow:0 24px 70px rgba(0,0,0,.35)">
          <div style="font-size:20px;font-weight:700">解锁 Secrets Broker</div>
          <div style="margin-top:8px;color:#667085;font-size:13px;line-height:1.6">输入 Vault 主密码。${initialized ? '密码只在本机派生，服务器只收到会话密钥。' : '第一次使用会创建 Vault 2.0，密码至少 12 位。'}</div>
          <label for="sb-app-unlock-password" style="display:block;margin-top:20px;font-size:13px;font-weight:600">Vault 主密码</label>
          <input id="sb-app-unlock-password" type="password" autocomplete="current-password" autofocus style="width:100%;box-sizing:border-box;margin-top:8px;padding:12px 13px;border:1px solid #d0d5dd;border-radius:10px;font-size:15px;outline:none">
          <div id="sb-app-unlock-error" style="min-height:20px;margin-top:10px;color:#d92d20;font-size:12px;line-height:1.5"></div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button id="sb-app-unlock-submit" type="submit" style="flex:1;padding:11px 14px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;cursor:pointer">${initialized ? '解锁' : '初始化并解锁'}</button>
            <button id="sb-app-unlock-later" type="button" style="padding:11px 14px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;color:#344054;font-size:14px;cursor:pointer">稍后</button>
          </div>
        </form>
      </div>`;
    (document.body || document.documentElement).appendChild(root);

    const form = document.getElementById('sb-app-unlock-form');
    const input = document.getElementById('sb-app-unlock-password');
    const submit = document.getElementById('sb-app-unlock-submit');
    const error = document.getElementById('sb-app-unlock-error');
    document.getElementById('sb-app-unlock-later').onclick = () => {
      dismissed = true;
      remove();
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      const password = input.value;
      if (!password) {
        error.textContent = '请输入 Vault 主密码';
        return;
      }
      if (!initialized && password.length < 12) {
        error.textContent = '首次设置的主密码至少 12 位';
        return;
      }
      busy = true;
      submit.disabled = true;
      error.textContent = '';
      try {
        if (!initialized) await api('/api/v2/init', { method: 'POST', body: JSON.stringify({ password }) });
        await api('/api/v2/unlock', { method: 'POST', body: JSON.stringify({ password }) });
        location.reload();
      } catch (failure) {
        error.textContent = failure.message || String(failure);
        submit.disabled = false;
        busy = false;
      }
    };
    setTimeout(() => input.focus(), 0);
  };

  let settled = false;
  const check = async () => {
    if (busy || dismissed || settled || document.getElementById('sb-app-unlock')) return;
    let me;
    try {
      me = await api('/api/me');
    } catch {
      settled = true; // login page: leave the normal login alone
      return;
    }
    if (!me || me.unlocked) {
      settled = true;
      return;
    }
    let vault = null;
    try {
      vault = await api('/api/v2/status');
    } catch {
      return; // keep the page's own retry path instead of guessing "not initialized"
    }
    show(vault);
  };

  // Desktop-only shortcut: write the local sidecar into every agent config
  // already on this machine. The web build never sees __TAURI__, so it stays hidden.
  const installAgentButton = () => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke || document.getElementById('sb-agent-connect')) return;
    const button = document.createElement('button');
    button.id = 'sb-agent-connect';
    button.type = 'button';
    button.textContent = '接入本机 Agent';
    button.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;padding:9px 13px;border:1px solid #cfd8e3;border-radius:999px;background:#fff;color:#344054;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.16);cursor:pointer';
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = '接入中…';
      try {
        const result = await invoke('connect_local_agents');
        button.textContent = '已接入本机 Agent';
        const toast = document.createElement('div');
        toast.setAttribute('role', 'status');
        toast.textContent = String(result || '已接入本机 Agent');
        toast.style.cssText = 'position:fixed;right:18px;bottom:64px;z-index:2147483647;max-width:340px;padding:12px 14px;border-radius:10px;background:#101828;color:#fff;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.28);white-space:pre-wrap';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 9000);
      } catch (error) {
        button.textContent = '接入失败，重试';
        button.disabled = false;
        const toast = document.createElement('div');
        toast.setAttribute('role', 'alert');
        toast.textContent = String(error);
        toast.style.cssText = 'position:fixed;right:18px;bottom:64px;z-index:2147483647;max-width:340px;padding:12px 14px;border-radius:10px;background:#b42318;color:#fff;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.28);white-space:pre-wrap';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 9000);
      }
    };
    (document.body || document.documentElement).appendChild(button);
  };

  setTimeout(check, 600);
  setInterval(check, 30000);
  setTimeout(installAgentButton, 900);
})();
