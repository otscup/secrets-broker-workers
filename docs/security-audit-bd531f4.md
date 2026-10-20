# 安全架构审查报告 — 基线 bd531f4

日期：2026-10-20
基线：`otscup/secrets-broker-workers` `main` @ `bd531f4`
范围：阶段一修复 + 阶段三验证 + 阶段二设计
约束：未读取真实密钥、未修改生产数据、未部署、未推送。

---

## 0. 结论摘要

| 项目 | 结果 |
|---|---|
| 自动化测试 | **66/66 通过**（5 套） |
| 新增测试 | maxReads 并发 5 项、Agent 权限矩阵 10 项 |
| 新发现漏洞 | **0 个已验证漏洞** |
| 潜在风险 | 3 项（见 §4） |
| 架构改进 | Policy Engine 设计完成（§5） |
| 是否需要整体重构 | **不需要**（§6） |

阶段一没有发现必须改代码的确定性漏洞；阶段三补上了此前缺失的**并发**与**端到端权限**证据。

---

## 1. 实际修复结果与测试证据

### 1.1 `/grant/consume` 并发（阶段一第 1 项）

**复核结论**：`BrokerState` 是 Durable Object，`fetch` 在单线程事件循环内串行执行；`/grant/consume` 的「读 state → 校验 → 递增/删除 → 写 state」在单个 DO 请求内完成，中间没有 `await` 让出点（除 `storage.get/put`，而 DO 的存储操作不交错执行其他 fetch）。因此不存在两个请求同时读到 `reads=0` 的窗口。

**证据**（`test-mf-maxreads.mjs`，真实 workerd + SQLite DO）：

```
PASS  MR-T1 20-way concurrent maxReads=1: 1 ok, 19 refused, grant removed
PASS  MR-T2 20-way concurrent maxReads=3: exactly 3 ok, reads 1,2,3, grant removed
PASS  MR-T3 20 concurrent unlimited reads: 20 ok, reads=20 (no lost updates)
PASS  MR-T4 revoked/expired refused atomically
PASS  MR-T5 grant key is agent+item scoped; B cannot consume A grant
```

**判定**：已实现 + 已测试。无需改为 `storage.transaction()`；OIDC state 那条需要事务是因为它校验的是「是否已使用」的集合，且要清理 5000 条上限。

### 1.2 R6 Agent 写入权限（阶段一第 2 项）

**复核结论**：`/agent/items/save` 有 4 道判断：

1. `resolved.agent.write === true`
2. 原名 `inWriteScope(name)`
3. 目标名 `inWriteScope(newName, 目标分组)`
4. 分组变更时 `inWriteScope(targetForGroup, nextGroup)`

原名/目标名、原分组/目标分组是**双重判断**，不是只查一边。

**证据**（`test-mf-permissions.mjs`，端到端走真实路由）：

```
PASS  PM-T1 write=false blocked (403)
PASS  PM-T2 write=true + no scope blocked (default deny)
PASS  PM-T3 write=true + explicit allow passes scope check
PASS  PM-T4 explicit allow on A cannot write B
PASS  PM-T5 group-x agent cannot write group-y item
PASS  PM-T6 rename A->B blocked when B out of scope
PASS  PM-T7 move to group-y blocked for group-x agent
PASS  PM-T8 Agent cannot escalate allowAll/allow/write via save body
PASS  PM-T9 Agent cannot set global noApproval policy
PASS  PM-T10 allowAll without write flag still cannot write
```

**判定**：已实现 + 已测试。

### 1.3 TOCTOU（阶段一第 3 项）

**已识别的窗口**：

- `agentAccess` 先 `activeGrant(state)`，再 `consumeGrant()`，再 `readSecretFromRows()`。
- grant 已被 `consumeGrant` 原子消费后才解密，所以「过期/撤销/超次数」不会在消费后继续放行。
- **仍存在**：`agentInScope` 用 `state.itemGroups` 快照判断，若管理员在判断与解密之间把条目移出分组，本次读取仍会成功。窗口是单次请求内的毫秒级，且需要管理员并发操作。

**最小修复建议（未实施）**：`readSecretFromRows` 已按名称取行，可在解密前用该行的 `folder_id` 反查分组，二次校验 scope。不改 NodeWarden schema，只在读取路径加一次校验。

**判定**：潜在风险，非已验证漏洞。

### 1.4 明文返回入口一致性（阶段一第 4 项）

逐一核对：

| 入口 | 权限检查 |
|---|---|
| `/secret`（Agent） | `agentAccess` → scope + noApproval/grant + 原子消费 |
| `/secret`（管理员） | `adminAuthorized` |
| MCP `get_secret` | `agentAccess` |
| MCP `get_credential` | `agentAccess`（再读一次明文） |
| MCP `http_request` | `agentAccess` + 目标策略 |
| `/api/items` | `adminAuthorized`（列表不含 value） |
| `/api/items/export` | `adminAuthorized`（**含全部明文**） |
| `/connect/save` | `adminAuthorized` |

**发现**：`/api/items/export` 一次性导出全部条目明文，仅管理员可达。这是设计选择，但属于高风险出口，建议加二次确认 + 审计（当前有导出动作但无独立事件）。

**判定**：潜在风险（管理员面），非越权。

### 1.5 noApproval 修改入口（阶段一第 5 项）

写入点只有 4 处：

- `createCipher`：`fields.noApproval === true`（管理员 create/import 可达；Agent save 已白名单剔除）
- `/api/items/update`：`body.noApproval`（管理员）
- `/api/policies`：`body.noApproval`（管理员）
- `loadState`：旧数据迁移把 share grant 标 `noApproval`（代码内，非用户输入）

Agent 可达的 `/agent/items/save` 显式构造字段对象，**不含 noApproval**。PM-T9 已测试。

**判定**：已实现 + 已测试。

---

## 2. 阶段三：测试执行结果

```
test-oidc.mjs          ==== 26/26 passed ====
test-r1-r6.mjs         ==== 22/22 passed ====
test-mf-oidc.mjs       ==== miniflare 3/3 passed ====
test-mf-maxreads.mjs   ==== maxReads 5/5 passed ====
test-mf-permissions.mjs ==== permission matrix 10/10 passed ====
```

合计 **66/66**。

### 新增/变更文件

| 文件 | 作用 |
|---|---|
| `test-mf-maxreads.mjs` | 真实 DO 下 maxReads 并发、撤销/过期、agent+item 边界 |
| `test-mf-permissions.mjs` | 端到端写权限矩阵，含提权与 noApproval 注入 |
| `test-support/register.mjs` | 让直接 import `src/index.js` 的套件可在 Node 跑 |
| `test-support/cloudflare-workers-loader.mjs` | `cloudflare:workers` 的 loader stub |
| `.github/workflows/security.yml` | 5 套测试接入 CI |
| `package.json` | `npm run test:security` 聚合 |

> 说明：`test-mf-permissions.mjs` 用假 32 字节 key 构造 session，只为通过「vault locked」门；D1 只建 `users` 空表。所有拒绝断言发生在解密之前，没有读取任何真实密文。

---

## 3. 已验证 / 潜在风险 / 架构建议 三分

### 已验证（有测试证据）
- grant 并发消费不突破 maxReads
- 撤销/过期 grant 在校验点被拒
- Agent 写权限默认拒绝、双重 scope、改名/移动不越界
- Agent 不能自设 allowAll/allow/write/noApproval
- OIDC state 单次消费（R1 + Miniflare）
- OIDC JWT 签名/iss/aud/nonce 校验

### 潜在风险（未见利用路径，但存在条件）
1. **TOCTOU 分组移动**：判断与解密之间管理员移动条目，单次读取仍成功（§1.3）。
2. **`/api/items/export` 全量明文**：管理员面单点，缺二次确认与独立审计事件。
3. **http_request 目标策略是全局环境变量**：无法按凭据区分，运维误配会影响所有条目。

### 架构改进建议
- Policy Engine 统一授权语义（§5）
- grant 绑定 `itemId` 而非 name
- per-credential HTTP target

---

## 4. 剩余安全问题与严重程度

| # | 问题 | 严重度 | 状态 |
|---|---|---|---|
| 1 | 分组移动 TOCTOU | 低 | 潜在，需并发管理员操作 |
| 2 | export 全量明文 | 中 | 管理员面，建议二次确认 |
| 3 | HTTP target 全局配置 | 中 | 运维风险，非越权 |
| 4 | OIDC 依赖 userinfo 兜底 | 低 | 已有 ID Token 校验，userinfo 作二次确认 |
| 5 | 无第三方密码学审计 | 中 | 流程缺口 |

未发现「Agent 越权读取/写入」的已验证漏洞。

---

## 5. 新旧权限模型对照

| 维度 | 旧模型 | Policy Engine |
|---|---|---|
| 主体 | agent name / oauth client | Subject（admin/agent/oauth） |
| 资源 | 名称 + 分组 | itemId 优先，名称兼容 |
| 动作 | read / write 布尔 | secret.read / use / create / update / delete / approve |
| 明文 vs 代理 | 不区分 | 两种独立 action |
| 免审批 | 全局 item 策略 + share 隐含 | 单条 capability 的 `preapproved` |
| HTTP 目标 | 环境变量 | 每 capability 的 Target |
| 默认 | 空 scope = 全部 | 无 capability = 拒绝 |
| 审计 | event + name | + capabilityId + itemId + action |

详见 `docs/policy-engine-design.md`。

---

## 6. 是否需要整体重构

**不需要。** 现有分层（Worker / DO / D1 / MCP）职责清晰，问题集中在授权语义分散。

建议路径：保留 `agentAccess` 作为兼容入口，内部改调 Policy Engine；`agentInScope` 降级为迁移辅助。可在不改外部 API 的前提下渐进替换。

---

## 7. 下一阶段最值得做的三件事

1. **Policy Engine 影子模式**：`evaluatePolicy()` 与旧逻辑并行计算，差异写 `policy.shadow-mismatch` 审计，不拦截。用真实流量验证迁移映射。
2. **grant/capability 绑定 itemId**：解决改名后授权错位，也是 Policy Engine 的前置。
3. **per-credential HTTP Target**：把 `HTTP_ALLOW_*` 降级为默认值，优先读条目级策略，消除全局误配风险。

---

## 8. 执行边界声明

- 未读取或输出任何真实密钥。
- 未修改生产数据，未部署，未推送。
- 所有测试使用合成数据（假 token、假 KEK、空 D1 表）。
- 本报告区分「已实现 / 已验证 / 已测试」，未把静态分析结论当作漏洞修复证据。

审查到此停止，等待独立复核。
