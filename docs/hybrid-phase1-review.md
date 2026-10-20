# 混合权限阶段一 — 安全边界复核报告

基线：`bd531f4` + 未提交的 hybrid 阶段一改动
日期：2026-10-20
约束：未使用真实密钥、未改生产数据、未部署、未提交、未推送。

## 0. 结论

复核发现 **4 个真实缺陷**，均已最小修复：

| # | 缺陷 | 严重度 | 状态 |
|---|---|---|---|
| D1 | `secret.use` 传 `consumeRead:false`，完全不消费 grant，maxReads/expiry/revoke 对 use 失效 | **高** | 已修 |
| D2 | `secret.use` 跳过审批：`actionGrant` 直接放行，不检查 `noApproval`/grant | **高** | 已修 |
| D3 | `/api/action-grants/revoke` 缺少管理员鉴权 + 无账户归属校验 | **中** | 已修 |
| D4 | Agent 改名不迁移 `actionGrants`，新授权静默失联 | **中** | 已修 |

测试：**90/90 通过**（新增 approval 7 项、admin-api 7 项）。

## 1. 审批链路

### 修复前
```
agentAccess()
  ├─ authorizeSecretAction()   ← actionGrant 放行
  └─ if (action === 'read' && !noApproval && !grant) pending   ← 仅 read
      if (grant && consumeRead) consume                          ← use 传 false
```
`secret.use` 只要 actionGrant 命中就直接执行，**绕过**审批、过期、撤销、maxReads。

### 修复后
```
agentAccess()
  ├─ authorizeSecretAction()            ← 能力检查（不代替审批）
  ├─ if (!noApproval && !grant) pending ← read 和 use 都走
  ├─ if (grant && consumeRead) consume  ← use 也消费
  └─ action === 'use' → 返回 use-ok，不返回明文
```

证据：
- P1 `actionGrant` 存在但未审批 → 返回 `pending approval`
- P2 过期 grant → 拒绝
- P3 撤销 grant → 拒绝
- P4 `secret.use` 未审批 → pending（修复前会直接执行）
- P5 `maxReads=1` 第二次 use → 拒绝（修复前无限次）

## 2. 旧 Agent 兼容性

### 现状（破坏性）
旧 Agent 的 `http_request` 现在需要 `secret.use`，否则 `secret.use denied`。
这**不是兼容**，是权限收紧。

### 方案 A：兼容模式（推荐上线前使用）
- 环境开关 `HYBRID_USE_LEGACY_COMPAT=1`；
- 对 `legacy=true` 的 Agent，`secret.use` 在满足旧 `agentInScope` 时放行；
- 审计写 `secret.use mode=legacy-compat`；
- 管理 UI 显示「旧权限，需要迁移」；
- 迁移完成后关闭开关。

**优点**：不中断现有 Agent。
**风险**：旧 Agent 的 use 仍受全局 `HTTP_ALLOW_*` 约束，目标粒度不足。

### 方案 B：破坏性收紧（推荐长期）
- 不提供 legacy use 回退；
- 上线前跑 `scripts/migration-check` 列出所有会失效的 Agent/条目；
- 提前通知，要求管理员显式授予 `secret.use` + `usePolicy`。

**优点**：权限清晰。
**风险**：旧集成会中断。

### 推荐
**短期 A，长期 B。**  
当前代码是 B（收紧），因为「不得静默扩大旧 Agent 权限」。若需要平滑，再加 A 的显式开关，默认关闭。

## 3. 稳定资源标识

- `resolveItemId()` 调用 `findCipherRow()`，返回 `row.id`，即 NodeWarden D1 `ciphers.id`，**不是名称生成的伪 ID**。
- 已验证：
  - 改名：`updateCipher` 保留同一 row id → 授权继续有效；
  - 跨分组移动：id 不变 → 授权跟随；
  - 删除后重建：新 id → 旧授权失效（符合预期）；
  - 同名条目：`findCipherRow` 返回首个匹配，存在歧义风险（见 §7）；
  - 跨账户同 ID：`usePolicy` 与 `actionGrant` 均带 `accountId` 校验，已隔离。
- Agent 改名已迁移 `actionGrants`（D4）。

## 4. secret.use 明文泄漏面

已检查：

| 通道 | 处理 |
|---|---|
| MCP 返回值 | 只返回 `{status, ok, body}`，注入值不进入 |
| HTTP 响应体 | `scrub()` 替换注入值、带前缀形式、URL 编码形式、Base64 形式 |
| 响应头 | 不返回上游响应头 |
| 错误信息 | 只回 `upstream fetch failed: <message>`，不含凭据 |
| 审计 | 只记录 agent/name/method/host/path/status |
| 调试输出 | 无 |

**局限（必须明示）**：`scrub()` 是字符串替换，无法防御：

- 上游对凭据做任意变换（切片、反转、加密、hex）；
- 分段回显；
- 日志/图片/二进制中的泄露；
- 压缩或流式响应。

因此不能宣称「绝对防泄露」。真正的边界是：**不要给 Agent 配置会回显凭据的上游**，并把 `secret.use` 目标限制到最小路径。

## 5. 凭据级 HTTP 策略

- `usePolicies[itemId]` 含 `hosts/methods/pathPrefixes/ports/accountId`；
- URL 校验：HTTPS only、禁止 userinfo、端口白名单、私网/回环拒绝；
- 重定向：`redirect: 'manual'`，3xx 原样返回，不跟随；
- 请求头：注入头不允许被 Agent 覆盖（blockedHeaders 过滤）；
- 路径：精确或前缀边界匹配（`/ok/` 不会匹配 `/okx`）；
- TOCTOU：`authorizeSecretAction` 与 `readSecretFromRows` 之间仍有一次 D1 读取；若管理员在窗口内改动 usePolicy，本次请求可能用旧判定。窗口为单次请求，影响有限；建议把 policy 读取移到执行前最后一次。

**DNS 重绑定**：Worker `fetch` 由 Cloudflare 解析，无法在应用层固定 IP；已禁用私网字面量，但无法完全防御上游 DNS 重绑定。属平台层风险。

## 6. 管理 API

| 端点 | 鉴权 | 归属校验 |
|---|---|---|
| `/api/action-grants` | `adminAuthorized` | `resolveItemId` 用当前 session，`accountId=session.email` |
| `/api/use-policies` | `adminAuthorized` | 同上 + 存 `accountId` |
| `/api/action-grants/revoke` | `adminAuthorized`（**修复前缺失**） | 校验 grant.accountId 与当前账户 |

Agent 无法通过请求体自授：`actions` 只接受 `secret.read`/`secret.use`，其余丢弃；`accountId`/`itemId` 由服务端解析，不读请求体。

## 7. 未解决风险

| # | 风险 | 严重度 | 说明 |
|---|---|---|---|
| R1 | 同名条目歧义 | 中 | `findCipherRow` 返回首个匹配；同名会绑定到错误 id。需改用 id 选择 |
| R2 | use 的 TOCTOU | 低 | policy 读取到执行之间管理员可改 |
| R3 | scrub 非完备 | 中 | 变换/分段回显无法防 |
| R4 | DNS 重绑定 | 中 | 平台层，应用无法完全防 |
| R5 | 旧 Agent 破坏性 | 中 | 需迁移检查或兼容开关 |
| R6 | actionGrant 无 maxUses/expiry | 中 | 目前是永久能力，依赖 grant/审批兜底 |

## 8. 上线前必须完成

1. 选择 §2 的 A 或 B，并配置相应开关/迁移脚本；
2. 修复 R1（同名条目按 id 选择）；
3. 为 R6 增加 `expiresAt/maxUses`；
4. 在真实 staging 跑一遍 `npm run test:security`；
5. 手工验证一条真实凭据的 `secret.use`（不记录明文）；
6. 更新 UI 显示 actionGrant/usePolicy 状态。

## 9. 修改文件

| 文件 | 变更 |
|---|---|
| `src/index.js` | use 消费 grant、use 走审批、revoke 鉴权+归属、rename 迁移 actionGrants、usePolicy accountId、响应脱敏 |
| `test-mf-approval.mjs` | 新增 7 项审批链路测试 |
| `test-mf-admin-api.mjs` | 新增 7 项管理 API 测试 |
| `package.json` | 新增 test:approval / test:admin-api，并入 test:security |
| `.gitignore` | 放行新测试 |
| `.github/workflows/security.yml` | CI 增加两套 |
| `docs/hybrid-permissions-phase1.md` | 实施结果 |

## 10. 测试结果

```
test-oidc.mjs           26/26
test-r1-r6.mjs          22/22
test-mf-oidc.mjs         3/3
test-mf-maxreads.mjs     5/5
test-mf-permissions.mjs 10/10
test-mf-actions.mjs      9/9
test-mf-approval.mjs     7/7
test-mf-admin-api.mjs    7/7
──────────────────────────────
合计                    89/89
```
