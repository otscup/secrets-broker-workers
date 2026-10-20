# 混合凭据权限模型 — 第一阶段方案

基线：`bd531f4`。目标：旧 Agent 不破坏，新增 `secret.use` 与 `secret.read` 独立权限。

## 1. 现有链路（审查结论）

```
Agent Token / OAuth Token
        │
        ▼
resolveAgent()            # static agent 或 oauthToken → {name, agent}
        │
        ├── /secret          → agentAccess() → scope + noApproval/grant → 明文
        ├── MCP get_secret   → agentAccess() → 明文
        ├── MCP get_credential → agentAccess() → 明文(username/password/totp)
        ├── MCP http_request → agentAccess() → 明文用于注入 → 只回响应
        └── /agent/items/save → write + agentInScope ×2
```

关键事实：

- `agentAccess()` 同时承担 **scope 判断**、**审批**、**grant 消费**、**明文读取**，无法区分 read 与 use。
- `http_request` 复用 `agentAccess()`，所以能读就能用；且目标策略来自全局 `HTTP_ALLOW_*`。
- `get_credential` 与 `get_secret` 走同一授权。
- 新 Agent `allow=[]/allowAll=false` 已默认拒绝，但没有 action 维度。

## 2. 数据结构

```ts
// 新增：action capability，绑定稳定 itemId
state.actionGrants: Record<string, {
  id: string;                 // `${subjectId}\0${itemId}`
  subjectId: string;          // agent name 或 oauth:<clientId>
  accountId: string;          // vault email
  itemId: string;             // NodeWarden ciphers.id（稳定）
  itemName: string;           // 仅展示/诊断
  actions: ('secret.read' | 'secret.use')[];
  legacy: boolean;            // 由旧 allow/groups 迁移而来
  createdAt: string;
}>;

// 新增：每凭据 HTTP 目标策略（secret.use 专用）
state.usePolicies: Record<string, {
  itemId: string;
  hosts: string[];            // 精确 hostname
  methods: string[];          // ['GET','POST']
  pathPrefixes: string[];     // ['/repos/otscup/']
  ports: string[];            // ['443']
  updatedAt: string;
}>;

// 旧 Agent 标记
state.agents[name].legacy: boolean
state.oauthAgentProfiles[name].legacy: boolean
```

### 为什么同时保留 name 与 itemId

旧数据（grant、policy、pending）全是 name。第一阶段不迁移旧表，只新增 itemId 绑定；读取时通过 D1 解析 name → id，找不到 id 则拒绝 `secret.use`（安全侧）。

## 3. 统一授权入口

```ts
export async function authorizeSecretAction(env, {
  session, resolved, state, item, action, target
}): { ok: boolean; reason: string; legacy?: boolean }
```

判定顺序：

1. `subject` 是否绑定同一 `accountId`；
2. 查 `actionGrants[subject\0itemId]`；
3. `secret.read`：
   - capability 含 `secret.read` → allow；
   - 否则若 `agent.legacy === true` 且旧 `agentInScope` 通过 → allow（legacy 标记）；
   - 否则 deny。
4. `secret.use`：
   - capability **必须**含 `secret.use`；**不接受** legacy 回退；
   - 读取 `usePolicies[itemId]`，校验 host/method/path/port；
   - 无策略 → deny。
5. 返回 `{ ok, reason }`，不返回值。

`secret.use` 永远不隐含 `secret.read`；`secret.read` 也不授予 `secret.use`。

## 4. 兼容策略

| 对象 | 迁移 |
|---|---|
| 旧 Agent（无 `legacy` 字段） | 载入时置 `legacy=true`；保留 allow/groups/allowAll 的 **read** 能力 |
| 新 Agent | `legacy=false`，默认无 read/use |
| 旧 OAuth profile | 同上 |
| 新 OAuth profile | `legacy=false` |
| 旧 direct share grant | 保留原行为（read），并补一条 `actionGrants` 用于新模型展示 |
| `get_secret` / `/secret` | 走 `secret.read` |
| `get_credential` | 走 `secret.read`，审计标 `legacy:true`（路径保留） |
| `http_request` | 走 `secret.use`，需要 capability + usePolicy |
| `/agent/items/save` | 不变：write 不隐含 read |

**不自动扩大权限**：旧 Agent 不会因为迁移获得 `secret.use`；新 Agent 不会因为 `allowAll` 获得 `secret.read`（allowAll 仍只是旧 scope，仅对 legacy 生效）。

## 5. 每凭据目标策略

```json
POST /api/use-policies
{
  "item": "github-token",
  "hosts": ["api.github.com"],
  "methods": ["GET"],
  "pathPrefixes": ["/repos/otscup/"],
  "ports": ["443"]
}
```

`http_request` 校验：

- item 必须解析到 itemId；
- host 精确匹配；
- method ∈ methods；
- path 以任一 prefix 开头；
- port 在 ports 或 443；
- 不跟随重定向（已存在）；
- 不返回密钥。

全局 `HTTP_ALLOW_*` 降级为**运维兜底**，只在该 item 没有 usePolicy 时不再使用（第一阶段直接拒绝无策略的 use），避免全局放宽。

## 6. 影子模式

```
state.settings.shadowPolicy = true | false
env.POLICY_SHADOW = '1'
```

`authorizeSecretAction` 同时计算：

- `newDecision`（actionGrants）
- `legacyDecision`（旧 agentInScope + grant）

若不同，写审计：

```json
{ "event": "policy.shadow-mismatch", "action": "secret.read",
  "agent": "...", "itemId": "...", "new": "deny", "legacy": "allow" }
```

**不记录** value、username、totp、请求体、headers。

## 7. 影响文件

| 文件 | 变更 |
|---|---|
| `src/index.js` | 新增 actionGrants/usePolicies、authorizeSecretAction、legacy 迁移、http_request 改造、admin API |
| `test-mf-actions.mjs` | 新增：read/use 独立、默认拒绝、legacy、目标限制、越权、无明文泄漏 |
| `package.json` | `test:security` 增加新套件 |
| `docs/policy-engine-design.md` | 补充第一阶段落地说明 |
| `docs/security-audit-bd531f4.md` | 追加本阶段结果 |

## 8. 明确不做

- 不迁移旧 grant/policy 主键到 itemId（只新增并行结构）；
- 不改 NodeWarden schema；
- 不做 UI 大规模改版（提供 API，UI 后续接）；
- 不启用 enforce，默认 shadow 记录。

## 9. 实施结果

已实现并测试（`test-mf-actions.mjs`，9/9）：

| 用例 | 结果 |
|---|---|
| A1 无 grant 且非 legacy → secret.read 拒绝 | PASS |
| A2 legacy Agent 保留 secret.read，审计标 legacy | PASS |
| A3 仅有 secret.use → get_secret 拒绝 | PASS |
| A4 仅有 secret.read → http_request 拒绝 | PASS |
| A5 use grant 但 host 不在策略 → 拒绝 | PASS |
| A6 method 不在策略 → 拒绝 | PASS |
| A7 path 前缀不匹配 → 拒绝 | PASS |
| A8 合成明文永不进入 MCP 响应 | PASS |
| A9 shadow 记录差异且不含密钥 | PASS |

新增 admin API：

- `POST /api/use-policies` — 按条目设置 hosts/methods/pathPrefixes/ports
- `POST /api/action-grants` — 授予 secret.read / secret.use
- `POST /api/action-grants/revoke` — 撤销

行为变更：

- `http_request` 现在走 `secret.use`，需要 actionGrant + usePolicy；
  旧 Agent 不再自动获得 `secret.use`（这是有意的权限收紧）。
- `get_secret` / `get_credential` / `/secret` 走 `secret.read`。
- 全局 `HTTP_ALLOWED_HOSTS` 降级为可选交集限制，不再是唯一授权来源。

## 10. 后续（第二阶段）

- 旧数据迁移到 itemId；
- UI 接入 usePolicies；
- shadow 差异报表；
- 启用 enforce。

