# 交接文档 — Secrets Broker Workers 混合权限阶段一

更新时间：2026-10-20
交接原因：当前会话上下文过长，转入新窗口继续。

## 一、仓库与基线

| 项 | 值 |
|---|---|
| 本地仓库 | `E:\DeepSeek workers\secrets-broker-workers` |
| GitHub | `https://github.com/otscup/secrets-broker-workers` |
| 分支 | `main` |
| 已推送基线 | `bd531f4`（远端 main） |
| 当前工作区 | **未提交**的混合权限阶段一改动（见 §三） |
| Worker 名称 | `secrets-broker-poc` |
| 线上域名 | `https://sb.otscup.com` |
| 最近部署版本 | `a94fc38a`（Cloudflare version ID，不是 Git commit） |

## 二、当前目标

混合凭据权限模型 **第一阶段**：在不破坏旧 Agent 的前提下，新增
`secret.use` 与 `secret.read` 两个独立权限。

已完成：

1. 统一授权入口 `authorizeSecretAction()`；
2. `actionGrants`（按 itemId 绑定）+ `usePolicies`（每条目 HTTP 目标）；
3. `http_request` 映射为 `secret.use`，不返回明文；
4. 旧 Agent 标记 `legacy`，保留 `secret.read`；
5. 影子模式 `policy.shadow-mismatch`（不含密钥）；
6. 三个管理 API：`/api/action-grants`、`/api/use-policies`、`/api/action-grants/revoke`。

## 三、工作区未提交改动

| 文件 | 内容 |
|---|---|
| `src/index.js` | 混合权限实现 + 复核修复（use 消费 grant、use 走审批、revoke 鉴权、rename 迁移、脱敏） |
| `test-mf-actions.mjs` | 9 项 read/use 独立性测试 |
| `test-mf-approval.mjs` | 7 项审批绕过测试 |
| `test-mf-admin-api.mjs` | 7 项管理 API 鉴权测试 |
| `test-mf-maxreads.mjs` | 5 项并发测试 |
| `test-mf-permissions.mjs` | 10 项权限矩阵 |
| `test-support/` | Node loader shim（已在 bd531f4） |
| `package.json` | test:security 聚合 8 套 |
| `.github/workflows/security.yml` | CI |
| `docs/hybrid-permissions-phase1.md` | 方案 + 实施结果 |
| `docs/hybrid-phase1-review.md` | 复核报告（4 个缺陷 + 风险） |
| `docs/policy-engine-design.md` | 完整 Policy Engine 设计 |
| `docs/security-audit-bd531f4.md` | 上一轮审计报告 |

## 四、测试状态

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

一键运行：`npm run test:security`

## 五、复核发现并已修复的缺陷

1. `secret.use` 不消费 grant → maxReads/expiry/revoke 对 use 失效；
2. `secret.use` 绕过审批 → actionGrant 直接执行；
3. `/api/action-grants/revoke` 缺管理员鉴权 + 无账户归属校验；
4. Agent 改名不迁移 `actionGrants` → 授权静默失联。

## 六、未解决风险（上线前必须处理）

| # | 风险 | 严重度 |
|---|---|---|
| R1 | 同名条目歧义（`findCipherRow` 取首个） | 中 |
| R2 | usePolicy 读取与执行的 TOCTOU | 低 |
| R3 | 响应 scrub 非完备（变换/分段回显） | 中 |
| R4 | DNS 重绑定（平台层） | 中 |
| R5 | 旧 Agent `http_request` 破坏性收紧 | 中 |
| R6 | actionGrant 无 expiresAt/maxUses | 中 |

**旧 Agent 兼容决策未定**：当前代码是方案 B（破坏性收紧）。
方案 A（`HYBRID_USE_LEGACY_COMPAT=1`）尚未实现。

## 七、GitHub 上传步骤

```powershell
cd "E:\DeepSeek workers\secrets-broker-workers"
git status
git add -A
git -c user.name=otscup -c user.email=otscup@users.noreply.github.com commit -m "Add hybrid secret.read/use permission model (phase 1)"
git push origin main
```

说明：

- `gh auth status` 已登录 `otscup`，`git push` 可用；
- 网络偶发 `Recv failure: Connection was reset`，重试 1-2 次即可；
- 不要提交 `wrangler.jsonc`、`.dev.vars`、`*.log`（已在 .gitignore）。

## 八、Cloudflare 部署步骤

前置凭证（已存在）：

- API token：`E:\dsh-home\.cloudflare\workers-d1-token.txt`
- Account ID：`f475b3dcf291c33ae82ab0b595f81958`

```powershell
cd "E:\DeepSeek workers\secrets-broker-workers"
$env:CLOUDFLARE_API_TOKEN = (Get-Content "E:\dsh-home\.cloudflare\workers-d1-token.txt" -Raw).Trim()
$env:CLOUDFLARE_ACCOUNT_ID = "f475b3dcf291c33ae82ab0b595f81958"
npx wrangler deploy
```

验证：

```powershell
curl.exe -4 -s -o NUL -w "%{http_code}`n" https://sb.otscup.com/login
```

注意：

- `wrangler.jsonc` 含 D1/DO/OIDC 绑定，已被 gitignore，仅在本地存在；
- 部署后版本 ID 会变，**不要**把版本 ID 当作 Git commit；
- 本次改动涉及权限行为变化，部署前必须先做 §六 的兼容决策。

## 九、凭证是否缺失

已确认存在：

- Cloudflare API token + Account ID（部署可用）；
- GitHub `gh` 登录（推送可用）；
- Worker 运行时 secrets（ADMIN_PASSWORD、AGENT_TOKEN、SESSION_KEK、DSH_PLUGIN_TOKEN）已在 Cloudflare 侧。

新窗口**不需要**重新创建这些。唯一缺的是：

- 若要用新窗口直接部署，需要能读取 `E:\dsh-home\.cloudflare\workers-d1-token.txt`；
- 若要跑真实凭据联调，需要管理员密码/TOTP（不要贴在聊天里）。

## 十、新窗口启动提示

> 读取 `secrets-broker-workers/HANDOFF.md` 和 `docs/hybrid-phase1-review.md`，
> 基线 `bd531f4` + 未提交混合权限改动；先决定旧 Agent 兼容方案 A/B，
> 再修 R1/R6，最后跑 `npm run test:security`。不要部署、不要提交，等我确认。

## 十一、下一步三件事

1. 决定旧 Agent 兼容方案（A 兼容开关 / B 破坏性收紧）；
2. 修复 R1（同名条目按 cipher id 选择）与 R6（actionGrant 过期/次数）；
3. 在 staging 跑 89 项测试 + 一条真实 `secret.use` 联调。
