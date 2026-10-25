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
      const usage = state.usage;
      if (usage && usage.ok !== false) {
        const agents = Array.isArray(usage.agents) ? usage.agents : [];
        const caps = Array.isArray(usage.capabilities) ? usage.capabilities : [];
        children.push(react.createElement("p", { style: s.title }, "谁在用我的密钥（最近 " + (usage.windowHours || 24) + " 小时）"));
        if (usage.requireClassification === true) {
          children.push(react.createElement("p", { style: s.meta }, "未分类的凭据已禁止 Agent 读取明文。"));
        }
        if (agents.length === 0) {
          children.push(react.createElement("p", { style: s.intro }, "这段时间没有读取记录。"));
        } else {
          const rows = agents.map((agent) => react.createElement("div", { key: agent.agent, style: s.card },
            react.createElement("p", { style: s.title }, agent.agent + " · " + agent.reads + " 次读取" + (agent.denied ? " · " + agent.denied + " 次被拒" : "")),
            react.createElement("p", { style: s.meta }, Object.entries(agent.items || {}).map(([name, count]) => name + " ×" + count).join("，") + (agent.lastAt ? " · 最近 " + new Date(agent.lastAt).toLocaleString() : ""))
          ));
          children.push(...rows);
        }
        if (caps.length) {
          const list = caps.map((cap) => react.createElement("p", { key: cap.agent + cap.name + cap.action, style: s.meta },
            cap.agent + " → " + cap.name + " · " + cap.action + (cap.usesLeft == null ? " · 不限次数" : " · 剩余 " + cap.usesLeft + "/" + cap.maxUses) + (cap.expiresAt ? " · 到期 " + new Date(cap.expiresAt).toLocaleString() : " · 永久")));
          children.push(react.createElement("p", { style: s.title }, "当前有效授权"), ...list);
        }
      }
      return react.createElement("div", { style: s.wrap }, ...children);
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
      let busy = false;
      let queued = false;
      let firstLoad = true;
      let showEmpty = false;
      // Tabs, so the popup is useful when nothing is waiting: the queue is one
      // tab, "recent activity" and "add a key" are the others.
      let tab = 'queue';
      const styleButton = "border:1px solid #d8e0ec;background:#fff;color:#152033;border-radius:6px;padding:5px 8px;font:12px system-ui;cursor:pointer";
      const stylePrimary = "border:0;background:#0f9d8a;color:#fff;border-radius:6px;padding:6px 9px;font:12px system-ui;cursor:pointer";
      const styleDanger = "border:1px solid #e3b4b0;background:#fff;color:#c0392b;border-radius:6px;padding:5px 8px;font:12px system-ui;cursor:pointer";
      const styleInput = "width:100%;box-sizing:border-box;border:1px solid #d8e0ec;border-radius:6px;padding:6px;margin:3px 0;font:12px system-ui";
      const mk = (tag, text, style) => { const el = document.createElement(tag); if (text) el.textContent = text; if (style) el.style.cssText = style; return el; };
      const remove = () => { if (overlay) { overlay.remove(); overlay = null } };
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
        launcher.textContent = '🔐';
        launcher.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147482999;width:40px;height:40px;border-radius:13px;border:1px solid #d8e0ec;background:#fff;color:#152033;font-size:18px;cursor:pointer;box-shadow:0 8px 22px rgba(15,23,42,.12);transition:transform .18s ease,box-shadow .18s ease';
        launcher.onmouseenter = () => { launcher.style.transform = 'translateY(-2px) scale(1.04)'; launcher.style.boxShadow = '0 12px 28px rgba(15,23,42,.2)' };
        launcher.onmouseleave = () => { launcher.style.transform = ''; launcher.style.boxShadow = '0 8px 22px rgba(15,23,42,.12)' };
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
        if (dot) { dot.textContent = String(count); return }
        const pill = document.createElement('span');
        pill.id = 'secrets-broker-badge';
        pill.textContent = String(count);
        pill.style.cssText = 'position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;border-radius:9px;background:#e05252;color:#fff;font:10px/16px system-ui;text-align:center;padding:0 4px';
        launcher.style.position = 'fixed';
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
            overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;right:18px;bottom:68px;z-index:2147483000;width:min(390px,calc(100vw - 24px));max-height:min(74vh,640px);overflow:auto;background:#fff;color:#152033;border:1px solid #d8e0ec;border-radius:14px;box-shadow:0 16px 50px rgba(15,23,42,.25);padding:14px;font:13px/1.5 system-ui;animation:sb-in .16s ease-out';
            document.body.appendChild(overlay);
            // A one-line entrance, so the panel does not just snap into place.
            const style = document.createElement('style');
            style.textContent = '@keyframes sb-in{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}@keyframes sb-flash{0%{background:#e8f7f4}100%{background:transparent}}';
            overlay.appendChild(style);
          }
          // Collect the nodes, then append them in one pass. No fragment, no
          // repeated reflow, and a minimal DOM stub can drive this too.
          const out = [];

          const head = mk('div', '', 'display:flex;align-items:center;gap:8px;margin-bottom:8px');
          head.appendChild(mk('b', 'Secrets Broker', 'font-size:14px;flex:1'));
          for (const [id, label] of [['queue', '待办'], ['activity', '动态'], ['add', '添加']]) {
            const chip = mk('button', label, 'border:1px solid ' + (tab === id ? '#0f9d8a' : '#d8e0ec') + ';background:' + (tab === id ? '#e8f7f4' : '#fff') + ';color:' + (tab === id ? '#0b7d6d' : '#6b7890') + ';border-radius:999px;padding:3px 9px;font:11.5px system-ui;cursor:pointer');
            chip.onclick = () => { tab = id; showEmpty = true; load(true) };
            head.appendChild(chip);
          }
          // This must not be named `close`: a const here shadows the close()
          // function above, so the handler called the button itself, recursively.
          // That recursion is what made the × take seconds to dismiss.
          const closeButton = mk('button', '×', 'border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#6b7890');
          closeButton.onclick = () => close();
          head.appendChild(closeButton);
          out.push(head);

          if (tab === 'queue') {
            if (empty) out.push(mk('div', '没有待审批或待补充的请求。', 'font-size:12px;color:#6b7890;padding:6px 0'));
            for (const entry of pending) {
              const card = mk('div', '', 'border:1px solid #e3e9f2;border-radius:10px;padding:9px;margin:8px 0');
              card.appendChild(mk('div', (entry.agent || 'Agent') + ' → ' + (entry.name || ''), 'font-weight:600;margin-bottom:6px'));
              const row = mk('div', '', 'display:flex;gap:6px;flex-wrap:wrap');
              for (const [decision, label, style] of [['once', '本次', stylePrimary], ['24h', '24h', styleButton], ['always', '永久', styleButton], ['deny', '拒绝', styleDanger]]) {
                const button = mk('button', label, style);
                button.onclick = async () => {
                  button.disabled = true;
                  try {
                    await fetch('/api/secrets-broker/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: entry.id, decision }) });
                    card.style.animation = 'sb-flash .5s ease';
                    setTimeout(load, 350);
                  } catch { button.disabled = false }
                };
                row.appendChild(button);
              }
              card.appendChild(row);
              out.push(card);
            }
            for (const entry of requests) {
              const draft = drafts.get(entry.id) || {};
              const card = mk('div', '', 'border:1px solid #cfe8e2;background:#f5fbf9;border-radius:10px;padding:9px;margin:8px 0');
              card.appendChild(mk('div', '需要补充：' + (entry.name || ''), 'font-weight:600;margin-bottom:6px'));
              if (entry.description) card.appendChild(mk('div', entry.description, 'font-size:11px;color:#6b7890;margin-bottom:6px'));
              const nameInput = mk('input'); nameInput.value = draft.name ?? entry.name ?? ''; nameInput.placeholder = '名称'; nameInput.style.cssText = styleInput;
              const userInput = mk('input'); userInput.value = draft.username ?? ''; userInput.placeholder = '用户名（可选）'; userInput.style.cssText = styleInput;
              const valueInput = mk('input'); valueInput.value = draft.value ?? ''; valueInput.type = 'password'; valueInput.placeholder = '密钥'; valueInput.style.cssText = styleInput;
              const updateDraft = () => drafts.set(entry.id, { name: nameInput.value, username: userInput.value, value: valueInput.value });
              nameInput.oninput = updateDraft; userInput.oninput = updateDraft; valueInput.oninput = updateDraft;
              const save = mk('button', '保存并授权', stylePrimary); save.style.width = '100%'; save.style.marginTop = '4px';
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
              card.append(nameInput, userInput, valueInput, save);
              // Optional: the operator may not have this key at all. Cancelling
              // removes the request, so the prompt stops coming back.
              const skip = mk('button', '取消（不填了）', styleButton); skip.style.width = '100%'; skip.style.marginTop = '4px';
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
              card.appendChild(skip);
              out.push(card);
            }
            const caps = Array.isArray(usageResponse && usageResponse.capabilities) ? usageResponse.capabilities : [];
            if (caps.length) {
              const card = mk('div', '', 'border:1px solid #e3e9f2;background:#fbfcfe;border-radius:10px;padding:9px;margin:8px 0');
              card.appendChild(mk('div', 'Agent 权限（只读）', 'font-weight:600;margin-bottom:4px'));
              const byAgent = new Map();
              for (const cap of caps) { const list = byAgent.get(cap.agent) || []; list.push(cap); byAgent.set(cap.agent, list) }
              for (const [agent, list] of byAgent) {
                card.appendChild(mk('div', agent, 'font-size:12px;font-weight:600;margin-top:5px'));
                for (const cap of list) {
                  const left = cap.usesLeft == null ? '不限次数' : '剩余 ' + cap.usesLeft + '/' + cap.maxUses;
                  const until = cap.expiresAt ? '到期 ' + new Date(cap.expiresAt).toLocaleString() : '永久';
                  card.appendChild(mk('div', '· ' + (cap.name || '') + ' · ' + (cap.action || '') + ' · ' + left + ' · ' + until, 'font-size:11px;color:#6b7890'));
                }
              }
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

          overlay.innerHTML = '';
          for (const node of out) overlay.appendChild(node);
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
