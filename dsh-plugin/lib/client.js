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

    const NS = "secretsBroker";
    const inject = ["slots", "locale"];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-secrets-broker: dictionaries");
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
