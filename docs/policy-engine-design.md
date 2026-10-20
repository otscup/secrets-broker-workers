# Policy Engine — 统一授权层设计

状态：**设计稿，未实施**。基线 `bd531f4`。本文只描述架构，不改现有权限模型。

## 1. 为什么需要

当前授权是**隐式拼装**的：

| 位置 | 现有判断 |
|---|---|
| `agentInScope()` | allow / groups / allowAll |
| `agentAccess()` | scope + `policies.noApproval` + `activeGrant` |
| `/agent/items/save` | `agent.write` + 两次 `agentInScope` |
| `http_request` | `HTTP_ALLOW_METHODS/PATHS/ALLOWED_HOSTS` 环境变量 |
| `/api/*` | 管理员 Cookie |

散落在 5 处，语义不统一。已知后果：**share 授权隐含免审批**、**写权限与读权限共用 scope**、**明文读取与代理使用没有区分**。

## 2. 模型

### 2.1 五元组

```
Decision = Policy(Subject, Resource, Action, Target, Context)
```

```ts
// Subject：谁在请求
type Subject =
  | { kind: 'admin'; sessionId: string }
  | { kind: 'agent'; agentId: string; tokenHash: string }
  | { kind: 'oauth'; clientId: string; agentId: string };

// Resource：被操作的对象，优先用稳定 ID
type Resource = {
  itemId: string;        // NodeWarden ciphers.id（稳定，改名不变）
  itemName: string;      // 仅展示/兼容
  group: string;
  account: string;       // vault email
};

// Action：动作语义
type Action =
  | 'secret.read'      // 返回明文
  | 'secret.use'       // broker 代执行，模型不见明文
  | 'secret.create'
  | 'secret.update'
  | 'secret.delete'
  | 'secret.approve'
  | 'policy.manage';

// Target：代理执行的目标（仅 secret.use 使用）
type Target = {
  host: string;          // 精确 host
  methods: string[];     // ['GET'] / ['POST'] ...
  pathPrefixes: string[];// ['/repos/otscup/']
  ports: string[];       // ['443']
};

// Context：运行时状态
type Context = {
  approval: 'none' | 'pending' | 'approved';
  grantId?: string;
  expiresAt?: number;
  maxReads?: number;
  reads?: number;
  sessionUnlocked: boolean;
};
```

### 2.2 能力（Capability）

不直接用 allow/groups 判断，而是**显式能力项**：

```ts
type Capability = {
  id: string;
  subject: { kind: 'agent' | 'oauth'; id: string };
  resource: { kind: 'item'; itemId: string } | { kind: 'group'; group: string };
  actions: Action[];            // ['secret.read'] 或 ['secret.use']
  target?: Target;              // 仅 secret.use
  approval: 'required' | 'preapproved';
  limits?: { expiresAt?: number; maxUses?: number };
  createdAt: string;
  createdBy: 'admin';
};
```

**关键约束**：

1. `secret.read` 与 `secret.use` 是不同 action，**不互相蕴含**。
2. `secret.update` / `create` / `delete` **不蕴含** `secret.read`。
3. `preapproved` 只对**单条 capability** 生效，不是全局 `noApproval`。
4. 能力绑定 `itemId`；名称只做兼容匹配。

## 3. 判定流程

```
请求
 │
 ├─ 1. 认证：Resolve Subject（admin cookie / agent token / oauth token）
 │     失败 → 401
 │
 ├─ 2. 加载 Resource（按 itemId 优先，回落 name）
 │     不存在 → 404
 │
 ├─ 3. 收集候选 Capability（subject + resource + action）
 │     无候选 → 403（默认拒绝）
 │
 ├─ 4. 合并：任一 capability 允许即通过；显式 deny 优先
 │
 ├─ 5. Context 校验
 │     ├─ sessionUnlocked? 否 → 423
 │     ├─ 过期 / 超 maxUses → 403
 │     ├─ approval=required 且无有效 approval → pending 流程
 │     └─ secret.use 时校验 Target(host/method/path/port)
 │
 ├─ 6. 原子消费（DO transaction）
 │     └─ 读-检查-写在同一 DO 事务内完成
 │
 └─ 7. 执行 + 审计（记录 capabilityId、itemId、action、decision）
```

### 默认拒绝原则

```ts
if (capabilities.length === 0) return DENY;
```

现有 `allowAll=true` 迁移为**显式的 `resource:{kind:'*'}` capability**，而不是空 scope 的隐式通配。UI 上显示为「全部条目」但底层仍是 capability，可审计、可撤销。

## 4. 与现有实现的兼容迁移

不能静默放大权限，分三步：

### 阶段 A：影子模式（不改行为）

- 新 Policy Engine 只**计算** decision，与旧判断结果对比；
- 差异写入 `audit.event = 'policy.shadow-mismatch'`；
- 不拦截请求。
- 目标：在真实流量上验证迁移映射正确。

### 阶段 B：能力生成（一次性迁移）

将现有状态翻译成 capabilities：

| 现有 | capability |
|---|---|
| `agent.allow: ['name']` | `resource:{kind:'item', itemId}` + `actions:['secret.read']` |
| `agent.groups: ['g']` | `resource:{kind:'group', group:'g'}` + `actions:['secret.read']` |
| `agent.allowAll: true` | `resource:{kind:'*'}` + `actions:['secret.read']` |
| `agent.write: true` | **新增** `actions:['secret.create','secret.update','secret.delete']`，**不含 read** |
| `grant` (share) | `approval:'preapproved'` + `limits` |
| `grant` (once/24h/…) | `approval:'approved'` + `expiresAt/maxUses` |
| `policies.noApproval` | 逐条转为 `preapproved` capability |

迁移脚本必须**只读现有状态、写入 capabilities**，并在切换前导出快照。

### 阶段 C：切换与回滚

- 环境开关 `POLICY_ENGINE=shadow|enforce`；
- `enforce` 后旧字段保留 30 天只读，便于回滚；
- 任何 `agent.write=true` 但无写 capability 的 Agent，在切换时**只生成写能力、不自动生成读能力**。

### 不扩大权限的保证

- `allowAll` → `{kind:'*'}` 仅 `secret.read`，不附带 write；
- `write=true` 只生成 `secret.create/update/delete`，不生成 `secret.read`；
- 现有 `noApproval` 仅转成对应 item 的 `preapproved`，不扩散到分组。

## 5. 信任边界

| 组件 | 信任级别 | 说明 |
|---|---|---|
| 浏览器 | 半可信 | 持有解锁后的会话密钥；XSS 可导致泄露 |
| Worker | 可信 | 持有 `SESSION_KEK`，可解密 |
| Durable Object | 可信 | 原子状态、授权消费、审计缓冲 |
| NodeWarden D1 | 可信存储 | 密文；broker 有读写权限 |
| OAuth IdP | 有限信任 | 校验 iss/aud/签名/sub/nonce |
| Agent / MCP Client | **不可信** | 所有输入必须校验；不得自报权限 |
| 通知渠道 | 不可信传输 | 仅承载签名链接，不承载明文 |

Policy Engine 只部署在 Worker 内，**不把判定委托给 Agent**。所有权限字段来自管理员写入的状态，Agent 提交的 `allow/allowAll/write/noApproval` 一律丢弃。

## 6. 数据结构落地

```ts
// DO state 新增
state.capabilities: Record<string, Capability>;
state.policyVersion: 2;
```

索引：`capabilitiesBySubject[subjectKey] = capabilityId[]`，避免每次全表扫描。

## 7. 风险与优先级

| 风险 | 现状 | Policy Engine 后 |
|---|---|---|
| share 隐含免审批 | 存在 | 拆成 `preapproved` capability，可单独撤销 |
| write 与 read 混淆 | write 不隐含 read，但共用 scope | 不同 action，显式分离 |
| 名称绑定 | grant 按 name | 绑定 itemId |
| HTTP 目标过宽 | 全局环境变量 | 每 capability 独立 Target |
| 无默认拒绝 | 新 Agent 已默认拒绝 | 统一 DENY |
| 审计粒度 | event + name | + capabilityId + itemId + action |

## 8. 分阶段实施计划

| 阶段 | 内容 | 风险 | 预估 |
|---|---|---|---|
| P0 | shadow 模式 + 迁移映射测试 | 低 | 1-2 天 |
| P1 | capability 生成脚本 + 快照/回滚 | 中 | 2-3 天 |
| P2 | enforce `secret.read` / `secret.use` | 中 | 3-5 天 |
| P3 | 写操作 capability | 中 | 2-3 天 |
| P4 | 每凭据 Target 策略 UI | 低 | 2 天 |
| P5 | 移除旧字段 | 高 | 需单独评审 |

## 9. 是否需要整体重构

**不需要推倒重来。** 现有分层（Worker / DO / D1 / MCP）是正确的，问题集中在**授权语义没有统一抽象**。

建议：保留 `agentAccess` 作为兼容入口，内部改为调用 Policy Engine；`agentInScope` 降级为迁移辅助函数。这样可以在不改变外部 API 的前提下逐步替换。

## 10. 下一步三件事

1. **影子模式**：实现 `evaluatePolicy()` 与旧逻辑对比，跑真实流量差异。
2. **itemId 绑定**：把 grant/capability 从 name 迁移到 `ciphers.id`，解决改名绕过。
3. **per-credential Target**：把 `HTTP_ALLOW_*` 环境变量降级为默认值，优先读 capability 的 Target。
