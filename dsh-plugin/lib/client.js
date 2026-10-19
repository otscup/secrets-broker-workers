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

    const s = {
      wrap: { width: "100%", maxWidth: "760px", display: "flex", flexDirection: "column", gap: "14px" },
      intro: { margin: 0, color: "var(--dsw-alias-label-tertiary)", fontSize: "13px", lineHeight: "20px" },
      row: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
      link: { color: "var(--dsw-alias-state-success-primary, #0f9d8a)", fontSize: "13px", textDecoration: "none" },
      card: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", borderRadius: "10px", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" },
      title: { margin: 0, fontSize: "13.5px", fontWeight: 600 },
      meta: { margin: 0, color: "var(--dsw-alias-label-tertiary)", fontSize: "11.5px" },
      buttons: { display: "flex", gap: "6px", flexWrap: "wrap" },
      button: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", font: "inherit", borderRadius: "7px", padding: "5px 10px", cursor: "pointer", fontSize: "12px" },
      primary: { border: "0", background: "#0f9d8a", color: "#fff", font: "inherit", borderRadius: "7px", padding: "6px 11px", cursor: "pointer", fontSize: "12px" },
      danger: { border: "1px solid var(--dsw-alias-border-l2)", background: "transparent", color: "var(--dsw-alias-state-error-primary, #c0392b)", font: "inherit", borderRadius: "7px", padding: "5px 10px", cursor: "pointer", fontSize: "12px" }
    };

    function View({ t }) {
      const [state, setState] = react.useState({ status: "loading", pending: [], requests: [] });
      const load = () => {
        setState((current) => ({ ...current, status: "loading" }));
        Promise.allSettled([
          fetch("/api/secrets-broker/pending").then((response) => response.json()),
          fetch("/api/secrets-broker/credential-requests").then((response) => response.json())
        ]).then(([pendingResult, requestResult]) => {
          const pendingPayload = pendingResult.status === "fulfilled" ? pendingResult.value : null;
          if (!pendingPayload || pendingPayload.ok === false) throw new Error((pendingPayload && pendingPayload.error) || "broker error");
          const requestPayload = requestResult.status === "fulfilled" ? requestResult.value : null;
          setState({ status: "ready", pending: Array.isArray(pendingPayload.pending) ? pendingPayload.pending : [], requests: Array.isArray(requestPayload?.requests) ? requestPayload.requests : [] });
        }).catch((error) => setState({ status: "error", error: String(error.message || error), pending: [], requests: [] }));
      };
      react.useEffect(() => {
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
          react.createElement("a", { href: "https://sb.otscup.com", target: "_blank", rel: "noreferrer", style: s.link }, t("open")),
          react.createElement("button", { type: "button", style: s.button, onClick: load }, t("retry"))
        )
      ];
      if (state.status === "loading") children.push(react.createElement("p", { style: s.intro }, t("loading")));
      if (state.status === "error") children.push(react.createElement("p", { style: s.intro }, t("error") + " " + (state.error || "")));
      if (state.status === "ready" && state.pending.length === 0) children.push(react.createElement("p", { style: s.intro }, t("empty")));
      for (const entry of state.pending) {
        children.push(react.createElement("div", { key: entry.id, style: s.card },
          react.createElement("p", { style: s.title }, (entry.agent || "Agent") + " → " + (entry.name || "")),
          react.createElement("p", { style: s.meta }, t("created") + ": " + (entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "")),
          react.createElement("div", { style: s.buttons },
            react.createElement("button", { type: "button", style: s.primary, onClick: () => decide(entry.id, "once") }, t("approveOnce")),
            react.createElement("button", { type: "button", style: s.button, onClick: () => decide(entry.id, "24h") }, t("approve24")),
            react.createElement("button", { type: "button", style: s.button, onClick: () => decide(entry.id, "always") }, t("approveAlways")),
            react.createElement("button", { type: "button", style: s.danger, onClick: () => decide(entry.id, "deny") }, t("deny"))
          )
        ));
      }
      for (const entry of state.requests || []) {
        children.push(react.createElement("div", { key: "req-" + entry.id, style: s.card },
          react.createElement("p", { style: s.title }, "需要补充密钥：" + (entry.name || "")),
          react.createElement("p", { style: s.meta }, (entry.agent || "Agent") + (entry.description ? " · " + entry.description : "")),
          react.createElement("div", { style: s.buttons },
            react.createElement("a", { style: s.primary, href: "https://sb.otscup.com/connect?id=" + encodeURIComponent(entry.id), target: "_blank", rel: "noreferrer" }, "打开连接器填写")
          )
        ));
      }
      return react.createElement("div", { style: s.wrap }, ...children);
    }

    function startPopup(ctx) {
      const dismissed = new Set();
      let overlay = null;
      let busy = false;
      const styleButton = "border:1px solid #d8e0ec;background:#fff;color:#152033;border-radius:6px;padding:5px 8px;font:12px system-ui;cursor:pointer";
      const stylePrimary = "border:0;background:#0f9d8a;color:#fff;border-radius:6px;padding:6px 9px;font:12px system-ui;cursor:pointer";
      const styleDanger = "border:1px solid #e3b4b0;background:#fff;color:#c0392b;border-radius:6px;padding:5px 8px;font:12px system-ui;cursor:pointer";
      const mk = (tag, text, style) => { const el = document.createElement(tag); if (text) el.textContent = text; if (style) el.style.cssText = style; return el; };
      const remove = () => { if (overlay) { overlay.remove(); overlay = null } };
      const load = async () => {
        if (busy) return; busy = true;
        try {
          const [pendingResponse, requestResponse] = await Promise.all([
            fetch('/api/secrets-broker/pending').then((r) => r.json()).catch(() => ({ pending: [] })),
            fetch('/api/secrets-broker/credential-requests').then((r) => r.json()).catch(() => ({ requests: [] }))
          ]);
          const pending = (pendingResponse.pending || []).filter((entry) => !dismissed.has(entry.id));
          const requests = (requestResponse.requests || []).filter((entry) => !dismissed.has(entry.id));
          if (pending.length === 0 && requests.length === 0) { remove(); return }
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483000;width:min(380px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:#fff;color:#152033;border:1px solid #d8e0ec;border-radius:14px;box-shadow:0 16px 50px rgba(15,23,42,.25);padding:14px;font:13px/1.5 system-ui';
            document.body.appendChild(overlay);
          }
          overlay.innerHTML = '';
          const head = mk('div', '', 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px');
          head.appendChild(mk('b', 'Secrets Broker', 'font-size:14px'));
          const close = mk('button', '×', 'border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#6b7890');
          close.onclick = () => { for (const entry of pending) dismissed.add(entry.id); for (const entry of requests) dismissed.add(entry.id); remove() };
          head.appendChild(close); overlay.appendChild(head);
          for (const entry of pending) {
            const card = mk('div', '', 'border:1px solid #e3e9f2;border-radius:10px;padding:9px;margin:8px 0');
            card.appendChild(mk('div', (entry.agent || 'Agent') + ' → ' + (entry.name || ''), 'font-weight:600;margin-bottom:6px'));
            const row = mk('div', '', 'display:flex;gap:6px;flex-wrap:wrap');
            for (const [decision, label, style] of [['once', '本次', stylePrimary], ['24h', '24h', styleButton], ['always', '永久', styleButton], ['deny', '拒绝', styleDanger]]) {
              const button = mk('button', label, style);
              button.onclick = async () => { button.disabled = true; try { await fetch('/api/secrets-broker/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: entry.id, decision }) }); load() } catch {} };
              row.appendChild(button);
            }
            card.appendChild(row); overlay.appendChild(card);
          }
          for (const entry of requests) {
            const card = mk('div', '', 'border:1px solid #cfe8e2;background:#f5fbf9;border-radius:10px;padding:9px;margin:8px 0');
            card.appendChild(mk('div', '需要补充：' + (entry.name || ''), 'font-weight:600;margin-bottom:6px'));
            if (entry.description) card.appendChild(mk('div', entry.description, 'font-size:11px;color:#6b7890;margin-bottom:6px'));
            const nameInput = mk('input'); nameInput.value = entry.name || ''; nameInput.placeholder = '名称'; nameInput.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid #d8e0ec;border-radius:6px;padding:6px;margin:3px 0;font:12px system-ui';
            const userInput = mk('input'); userInput.placeholder = '用户名（可选）'; userInput.style.cssText = nameInput.style.cssText;
            const valueInput = mk('input'); valueInput.type = 'password'; valueInput.placeholder = '密钥'; valueInput.style.cssText = nameInput.style.cssText;
            const save = mk('button', '保存并授权', stylePrimary); save.style.width = '100%'; save.style.marginTop = '4px';
            save.onclick = async () => { if (!valueInput.value) return; save.disabled = true; try { const response = await fetch('/api/secrets-broker/connect/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: entry.id, name: nameInput.value, username: userInput.value, value: valueInput.value, group: '' }) }); const payload = await response.json().catch(() => ({})); if (!response.ok || payload.ok === false) throw new Error(payload.error || 'save failed'); load() } catch (error) { save.disabled = false; save.textContent = String(error.message || error) } };
            card.append(nameInput, userInput, valueInput, save); overlay.appendChild(card);
          }
        } finally { busy = false }
      };
      const timer = setInterval(load, 15000);
      load();
      return () => { clearInterval(timer); remove() };
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
