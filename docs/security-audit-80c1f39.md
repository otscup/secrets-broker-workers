# Secrets Broker 安全审计报告

- **审计基线**：`80c1f39`（2026-11-02，工作区干净）
- **审计范围**：Cloudflare Worker 与 Web 控制台、OAuth/OIDC、认证与授权、加密与数据层、CLI、桌面端（Tauri）、浏览器扩展、DSH 插件、CI/供应链
- **审计方式**：只读源码审计 + 现有 Miniflare 测试 + 本地 PoC 复现；未修改任何源码，未接触生产环境或真实密钥
- **结论**：**1 个严重、5 个高危、11 个中危、8 个低危/加固项**。最优先修复登录页/配对页反射型 XSS、多账户免审批越权、v2 明文接口缺少二次验证。

---

## 1. 风险总览

| ID | 级别 | 问题 | 主要位置 |
|---|---|---|---|
| C-1 | **严重** | `/login?next=` 反射型 XSS，可窃取管理员口令/TOTP | `src/index.js:27,1506,4244-4265,4400-4410` |
| H-1 | 高 | `/pair?code=` 反射型 XSS（已登录可触发） | `src/index.js:4290-4305,8152-8159` |
| H-2 | 高 | 免审批策略按名称全局生效且缺少 `accountId`，可跨账户读明文 | `src/index.js:1862,5224,3094-3097,3911,1461-1492` |
| H-3 | 高 | v2 解锁/明文列表不要求 TOTP，且解锁无限流 | `src/index.js:8213-8224,8306-8310,8043-8051` |
| H-4 | 高 | 桌面端允许官方 Web 源调用本地特权命令，且 CSP 为空 | `desktop/src-tauri/capabilities/default.json:6-15`、`tauri.conf.json:10,22-24` |
| H-5 | 高 | macOS/Linux 上私钥/本地令牌明文落盘，与文档“DPAPI 加密”不符 | `cli/store.mjs:39-48`、`cli/vault.mjs:42-46`、`cli/localauth.mjs:68-75` |
| M-1 | 中 | 只读/静音 Agent 仍可发起写入审批 | `src/index.js:7605-7632,2265-2273,3880` |
| M-2 | 中 | 撤销能力/删除 Agent 不取消在途 fill 任务，兑换不复核授权 | `src/index.js:5946-6005,6114-6134,5650-5712` |
| M-3 | 中 | fill 任务可被任意执行器领取并改写 `executorId`（跨执行器任务劫持） | `src/index.js:469-490,3168,5668` |
| M-4 | 中 | Bitwarden type 1 密文不校验 MAC，MAC 失败被吞为空串 | `src/crypto.js:74-83,125-135` |
| M-5 | 中 | 管理 Cookie `SameSite=None` + Origin 可选校验，存在 CSRF 缺口 | `src/index.js:834,1279-1293` |
| M-6 | 中 | 已登录访问 `/login?next=https://...` 形成开放重定向 | `src/index.js:4403` |
| M-7 | 中 | v2 解锁、OAuth register/token、`/mcp`、插件端点缺少限流；OAuth code 单次使用非原子 | `src/index.js:7204-7215,7362-7405,8213` |
| M-8 | 中 | `http_request` 的 `HTTP_ALLOW_METHODS/PATHS/PORTS` 配置未实现 | `src/index.js:7579,7897-7931` |
| M-9 | 中 | 供应链：锁文件指向镜像源、Actions 未固定 SHA、`npm install`、工作流权限偏大 | `package-lock.json`、`.github/workflows/security.yml`、`desktop.yml` |
| M-10 | 中 | CLI OAuth `state` 不校验、审批链接可跨域自动打开、materialize 信任服务端路径 | `cli/oauth.mjs:104`、`cli/approval.mjs:54-69`、`cli/materialize.mjs:63` |
| M-11 | 中 | KDF 强度接近平台/实现下限：信封 100k、管理员口令 50k | `src/envelope.js:16`、`src/index.js:1117-1120` |
| L-1 | 低 | 解封信封时信任存储中的 PBKDF2 迭代数，可被用于 CPU DoS | `src/envelope.js:89` |
| L-2 | 低 | SSRF IPv6 覆盖不全，fetch 前无 DNS 解析后校验 | `src/index.js:7935-7956` |
| L-3 | 低 | 通知正文拼接 Agent 可影响的条目名，存在标记/链接注入 | `src/index.js:2658-2740` |
| L-4 | 低 | `/approve` 用 GET 执行状态变更，审批签名与 Cookie 共用密钥 | `src/index.js:7106-7117` |
| L-5 | 低 | v2 条目查询不按账户隔离（单库单 DEK 的架构选择） | `src/index.js:1599-1607`、`src/vault2.js:79-90` |
| L-6 | 低 | 深链 URL 前缀校验可被 `https://evil.com` 或 `127.0.0.1.evil.com` 绕过 | `desktop/src-tauri/src/deep_link.rs:32` |
| L-7 | 低 | 扩展允许 `http://` 远程地址，执行器密钥明文存 `chrome.storage.local` | `extension/options.js:21,24` |
| L-8 | 低 | 密钥经 argv 传递（`put --value`、`rekey --password`、`pair --cookie`） | `cli/index.mjs:336,550,574-580` |

---

## 2. 关键发现详情

### C-1 登录页反射型 XSS（严重）

**证据链**

- 路由把原始 `next` 直接交给页面：`src/index.js:4400-4410`
- `standaloneLoginPage` 先经 `safeNext`，再用 `JSON.stringify` 嵌入 `<script>`：`src/index.js:4244-4265`
- `safeNext` 只校验“以 `/` 开头、非 `//`”，允许 `<`、`>`、`</script>`：`src/index.js:1506-1509`
- CSP 允许内联脚本与事件处理器，且允许任意 https 图片外带：`src/index.js:27`

**本地 PoC（Miniflare，真实路由）**

```
login status: 200
login raw </script> payload present: true
csp: ... img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; ...
```

请求 `/login?next=/%3C/SCRIPT%3E%3CIMG%20SRC=X%20ONERROR=...%3E` 即可闭合脚本标签并执行事件处理器。攻击者可以向未登录管理员投递该链接，脚本在登录表单所在页面执行，可读取/篡改口令与 TOTP 输入，并通过 `img-src https:` 外带；无需任何账号。

**修复**

- 引入统一的 `jsonForScript(v)`：`JSON.stringify(v).replace(/</g,'\\u003c')`，并处理 U+2028/U+2029；所有 `<script>` 内的服务端插值统一使用。
- `safeNext` 改为严格白名单路径：拒绝 `< > " ' \`、控制字符、反斜杠、`//`，只允许站内绝对路径。
- 用 nonce/hash 替代 `script-src 'unsafe-inline'`；至少移除事件处理器依赖。
- 增加回归测试：`/login?next=` 与 `/pair?code=` 注入 `<` 后，响应脚本块中不得出现原始 `<`。

### H-1 配对页反射型 XSS（高危）

`/pair` 把 `code` 仅做 `toUpperCase()` 后放入 `<script>`：`src/index.js:8152-8159`、`4290-4305`。PoC 确认响应包含原始 `</SCRIPT>`。虽然 `toUpperCase()` 会破坏普通 JS 标识符，但可用数字实体构造忽略大小写的 `alert(1)`；且 `img-src https:` 足以外带。该页要求管理会话，攻击者需诱导已登录管理员点击链接。

**修复**：路由层把 `code` 限制为 `[A-Z0-9]{4,16}` 并拒绝其他字符；同时使用 `jsonForScript`。

### H-2 免审批策略跨账户越权（高危，多账户部署）

**证据链**

- 创建条目写入免审批时只写 `{ noApproval: true }`，不带账户：`src/index.js:1862`、`5224`
- 策略接口写入时带 `accountId`，说明账户字段本应存在：`src/index.js:5414`
- 读路径在 `policyAccount` 为空时跳过账户比较，随后免审批分支直接放行，且绕过 web/api 分类限制：`src/index.js:3094-3097`
- Agent 读取只按“名称 + scope”，不校验策略账户：`src/index.js:3911`
- 账户切换清理逻辑只清理能力/授权，不清 `policies`：`src/index.js:1461-1492`

**利用路径**

1. 账户 A 中把名为 `AWS` 的条目设为免审批；
2. 管理员切到账户 B（登录仅更新 `settings.vaultEmail`）；
3. 绑定账户 B、allow 含 `AWS` 的 Agent 请求 `get_secret("AWS")`；
4. 缺失 `policyAccount` 跳过账户校验，免审批分支放行；即使 B 的 `AWS` 是 web 登录条目，也返回明文。

**修复**

- 三处写入统一补 `accountId`（取自当前会话/`settings.vaultEmail`）。
- `plaintextReadAllowed` 中 `policyAccount` 缺失即拒绝；存在时必须等于当前账户。
- `3911` 的免审批分支增加策略账户与 Agent 账户相等判断。
- 账户切换/清理时同步清理 `policies` 中跨账户条目；补一条多账户 + 同名 + web 条目的回归测试。

### H-3 v2 明文接口缺少二次验证与限流（高危）

- `/api/secret/reveal` 明确调用 `secondFactorWall`：`src/index.js:8043-8051`
- `/api/v2/items?plain=1` 仅需管理 Cookie + 缓存 DEK 即返回整库明文：`src/index.js:8306-8310`
- `/api/v2/unlock` 无 TOTP、无失败计数/限流：`src/index.js:8213-8224`
- 现有测试 `P7 plain=1 gives the panel decrypted names`、`P8 ... refuses unauthenticated` 证明该路径只校验 Cookie

**影响**：在 DEK 缓存窗口内（默认 1h，可由设备 PUT 延长至 12h），窃取 Cookie 即可全量拖库，绕过管理员在其他位置刻意设置的 TOTP 门槛。

**修复**：`/api/v2/unlock` 与 `plain=1` 复用 `secondFactorWall`；unlock 按 IP/账户限流；或把 `plain=1` 限制为本地面板来源并加 CSRF token。

### H-4 桌面端向远端 Web 源开放本地特权命令（高危）

- 能力文件允许 `https://sb.otscup.com/**` 调用 `connect_local_agents`、`connect_server`、`open_update_page`：`desktop/src-tauri/capabilities/default.json:6-15`
- `withGlobalTauri: true`、`csp: null`：`desktop/src-tauri/tauri.conf.json:10,22-24`
- 页面直接 `invoke('connect_local_agents')`

**影响**：官方站点一旦被 XSS/供应链攻破，攻击脚本可在用户桌面上下文调用本地命令，把 sidecar 写入本机所有 MCP 客户端配置，并把服务器地址改为攻击者控制的地址，形成本机 vault 读取入口。

**修复**：远端源只保留无特权命令；本地特权命令仅对本地 UI 开放并加原生确认框；恢复 CSP；对 `connect_server` 的地址做域名确认。

### H-5 macOS/Linux 私钥与令牌明文落盘（高危）

- `protectSecret` 仅实现 Windows DPAPI；其他平台直接返回 false：`cli/store.mjs:39-48`
- `vault.mjs` 在保护失败时仍把 `privateJwk` 写回 `device.json`：`cli/vault.mjs:42-46`
- 本地 Agent token 同样在非 Windows 上明文写入 `local-agents.json`：`cli/localauth.mjs:68-75`
- `SECURITY.md` 表述为 DPAPI 加密，未限定平台

**影响**：同一用户下的任意进程/恶意 npm 脚本可读取私钥，解密全部密文，包括离线 `vault.db`。文件为 0600 只能防其他用户，不能防同用户恶意进程。

**修复**：为 macOS 补 Keychain（`security add-generic-password`）、Linux 补 `secret-tool`；无 OS 存储时拒绝保存并明确报错；同步修正文档。

### M-1 只读/静音 Agent 可发起写入审批（中危）

`put_secret` 只校验 scope 与账户，不校验 `agent.write === true`、`agent.muted`：`src/index.js:7605-7632`。控制台的写入口 `/agent/items/save` 有写校验，形成不一致。`decidePending` 的写票据路径也未复核写权限：`src/index.js:2265-2273`。

**影响**：只读 OAuth/静态 Agent 可生成“写入”待审批；操作员在控制台/Telegram 批准后即可覆盖 scope 内的现有密钥。批准页若不提示“该 Agent 无写权限”，社会工程成功率较高。

**修复**：创建与消费写票据时都要求 `write === true` 且 `!muted`；批准时再次校验。

### M-2 撤销授权不取消在途 fill 任务（中危）

- `/api/action-grants/revoke`：`src/index.js:5946-6005`
- `/api/agents/delete`：`src/index.js:6114-6134`
- 对照 `/api/grants/revoke` 会调用 `cancelTasksFor`：`src/index.js:6358`
- `redeem` 只检查任务状态/执行器/账户/origin，不复核当前能力：`src/index.js:5650-5712`

**影响**：管理员撤销 fill 授权后，执行器仍可在 `authorized` TTL（约 10 分钟）内领取并兑换用户名/口令；撤销“已生效”不彻底。

**修复**：两处撤销后调用 `cancelTasksFor(agentName)`；`redeem` 前用当前状态重跑 `authorizeSecretAction`。

### M-3 fill 任务可被任意执行器领取（中危）

`/fill/task/claim` 只筛 `state === 'authorized'`，不比对 `executorId`，随后把 `executorId` 覆盖为领取者：`src/index.js:469-490`。任务凭据的 HMAC 绑定原始执行器（`3168`），而兑换按覆盖后的 `task.executorId` 复核（`5668`）。

**影响**：任一已注册执行器可“抢走”其他执行器的任务；由于 HMAC 已不匹配，任务通常无法再兑换，形成跨执行器任务劫持/拒绝服务，并可能让合法执行器误报失败。原审计中“可兑换明文”的推断不成立，已按代码复核降级。

**修复**：claim 过滤 `task.executorId === executorId`，且不覆盖原字段。

### M-4 type 1 密文不校验 MAC（中危）

`src/crypto.js:74-83` 只对 type 2 校验 HMAC；type 0/1/4 直接 AES-CBC 解密。Bitwarden type 1 是 `AesCbc128_HmacSha256`，`parts[2]` 被忽略。`decryptFieldWithFallback` 把 MAC 失败吞成空串：`src/crypto.js:125-135`。

**影响**：能改写 D1 密文的一方（DB 被写、导入路径）可对 type 1 行做 CBC 位翻转而不被拒；MAC 失败静默为空会掩盖篡改。

**修复**：type 1 校验 `HMAC-SHA256(macKey, cipher)`；type 0/4 仅允许显式迁移路径；MAC 失败应报错而非返回空串。

### M-5 CSRF 缺口（中危）

- Cookie 属性 `SameSite=None`：`src/index.js:834`（`SECURITY.md` 却写 `SameSite=Lax`）
- `adminAuthorized` 仅在请求携带 Origin 时才校验：`src/index.js:1279-1293`
- 现有 PoC 的 `Set-Cookie` 确认 `SameSite=None`

**影响**：跨站请求会携带管理 Cookie；对不发送 Origin 的客户端/旧浏览器/嵌入 WebView，状态变更端点（设置、建 Agent、审批决策）可被跨站触发。现代浏览器通常会发送 Origin，因此不是无条件可利用，但纵深防御不足。

**修复**：`__Host-` 前缀 + `SameSite=Lax`（OAuth 流程确有跨站需求时单独设计）；状态变更要求 `Origin` 或 `Sec-Fetch-Site ∈ {same-origin, none}`；高风险操作加 CSRF token。

### M-6 登录后开放重定向（中危）

已登录访问 `/login?next=https://evil.com` 时直接 `new URL(nextTarget, url)` 302 外跳：`src/index.js:4403`，未经过 `safeNext`。可用于钓鱼或配合 OAuth 同意页。

**修复**：跳转前统一 `safeNext(nextTarget)`。

### M-7 限流与 OAuth code 单次使用（中危）

- `/oauth/register` 无节流，可灌满 100 客户端上限：`src/index.js:7204-7215`
- `/oauth/token`、`/mcp` 未认证路径、插件端点缺少失败限流
- 授权码校验与删除在可重试的 `updateState` 中，非原子：`src/index.js:7362-7405`
- `/api/v2/unlock` 无限流（与 H-3 合并修复）

**影响**：注册/登录 DoS、放大扫描；并发兑换可能各铸一枚 24h token，破坏“单次使用”语义（需同时持有 code + PKCE verifier，危害有限）。

**修复**：按 IP/客户端限流；在 Durable Object 内原子 take/delete code 后再验 PKCE；code 哈希存储。

### M-8 `http_request` 安全配置未实现（中危）

工具描述宣称支持 `HTTP_ALLOW_METHODS`、`HTTP_ALLOW_PATHS`、`HTTP_ALLOWED_PORTS`：`src/index.js:7579`。实际代码中 `allowPaths` 为空数组且 `port` 计算后未使用，方法只校验长度：`src/index.js:7897-7931`；全仓库未读取这些环境变量。

缓解事实：条目级 `usePolicy` 仍会限制方法/路径前缀（测试 A6/A7 通过），`HTTP_ALLOWED_HOSTS` 也确实生效。因此这不是“任意 SSRF”，而是“运维以为设置了额外限制、实际没有”。

**修复**：实现端口/方法/路径的 env 与条目策略取交集，或删除描述中的死配置。

### M-9 供应链与 CI（中危）

- `package-lock.json` 138 个 `resolved` 全部指向 `registry.npmmirror.com`（有 integrity，但源可信度低于官方）
- `security.yml` 无 `permissions`，使用 `npm install`（不锁 lockfile），Actions 用可变 tag
- `desktop.yml` 全流程 `contents: write`，MSI/EXE 未做代码签名，仅提供 SHA256

**修复**：切回 `registry.npmjs.org`；`npm ci`；Actions 固定 SHA；最小权限；发布产物签名。

### M-10 CLI 登录/审批/materialize（中危）

- `oauth.mjs` 生成 `state` 但回调不校验：`cli/oauth.mjs:104`
- 审批链接只要求路径以 `/approve` 结尾且有 `id/sig`，任意主机都会被自动打开：`cli/approval.mjs:54-69`
- `materialize` 使用服务端返回的 `job.path` 而非用户指定路径：`cli/materialize.mjs:63`
- 本地 Agent token 被写入 `~/.claude.json` 等配置，并留下 `.bak`：`cli/agents.mjs:432,455`

**修复**：校验 state（常量时间）；审批链接只允许 `brokerUrl` 同源；materialize 强制路径等于用户请求路径，拒绝父目录/符号链接；配置文件 0600 且不保留含令牌的备份。

### M-11 KDF 强度（中危）

`envelope.js:16` 使用 PBKDF2-SHA256 100,000 次（注释称受 Workers 上限约束）；`index.js:1117-1120` 管理员口令仅 50,000 次。两者都低于 OWASP 600k 建议；D1 泄漏后信封/管理 hash 可离线爆破。

**修复**：管理员 hash 提升到平台上限 100k；信封保持平台上限并记录版本，未来平台支持时升级；对高价值部署增加口令熵要求和登录锁定。

---

## 3. 已正确实施的控制

以下控制经代码复核，未发现可利用绕过：

1. **管理会话**：v2 Cookie 为 `HMAC(id + expires)`，并强校验服务端 `adminSessions` 记录与过期（`src/index.js:846-852`）；按 id 撤销与登出会删除记录。
2. **OAuth 2.1 主流程**：强制 PKCE S256、`client_id`/`redirect_uri` 精确匹配、token 只存 SHA-256（`src/index.js:7287-7288,7375-7386`）；注册仅允许 https/环回 http 且拒绝 fragment。
3. **OIDC**：alg 白名单、JWKS 的 `kid/use/key_ops/alg/crv` 过滤、拒绝 `none`、精确 `iss/aud/azp/exp/nbf/nonce`、签名 Cookie + 一次性 state（`src/oidc.js:71-131`、`src/index.js:5072-5110`）。
4. **D1**：全部 `prepare(...).bind(...)` 参数化，未发现拼接 SQL；ciphers 读写按 `user_id` 限定。
5. **任务凭据**：HMAC 覆盖 taskId/executor/account/agent/cipher/origin/action/policyRevision/nonce/expiry，DO 内一次性核销（`src/index.js:3168-3206,370-386`）。
6. **插件/执行器**：未配置即拒绝、常量时间比较、写操作要求解锁并按账户绑定（`src/index.js:1301-1305,4561-4567`）。
7. **SSRF 基线**：`HTTP_ALLOWED_HOSTS`、私网 IPv4/IPv6 判定、`redirect: 'manual'`、危险头黑名单、响应密钥擦除（`src/index.js:7935-7956`）；残余缺口见 L-2。
8. **客户端数据保护**：token 文件 0600，`cache.mjs` 仅存密文，`guard` 拦截含 vault 值的提交，`scan` 仅输出掩码。
9. **CSP 其他指令**：`frame-ancestors 'none'`、`base-uri 'none'`、`object-src 'none'`。

---

## 4. 测试与工具结果

| 项目 | 结果 |
|---|---|
| `npm ci` | 成功，177 包 |
| `node --check`（全部跟踪的 `.js/.mjs`） | 全部通过 |
| `npm audit` | 0 个已知漏洞（均为开发依赖） |
| `test:permissions` | 10/10 |
| `test:actions` | **8/9，A9 失败且可复现** |
| `test:approval` | 7/7 |
| `test:account-scope` | 12/12 |
| `test:fill-task` | 20/20 |
| `test:v2-api` | 25/25 |
| `test:session` | 5/5 |
| `test:oauth-consent` | 10/10 |
| XSS PoC（Miniflare） | `/login` 与 `/pair` 均返回原始 `</SCRIPT>`；Cookie 为 `SameSite=None` |

**A9 说明**：`shadowAudit` 只在新旧决策不同时记录，测试种子同时给了 legacy grant 与 noApproval，二者都为 allow，因此计数为 0。这更像“测试期望过期”而非已确认漏洞，但说明影子审计的回归用例需要重新校准，不能长期保留红灯。

**测试覆盖缺口**：没有针对 `/login?next=`、`/pair?code=` 的注入回归；没有“多账户 + 同名条目 + 免审批”的组合测试；没有 v2 TOTP/限流测试；没有“撤销后兑换在途任务”测试；没有“非签发执行器 claim”测试；没有 type 1 MAC 篡改测试。

---

## 5. 修复优先级

**P0（立即）**

1. C-1 / H-1：统一 `jsonForScript`，严格化 `safeNext` 与 `code` 白名单，补充 XSS 回归测试。
2. H-2：三处免审批写入补 `accountId`；缺失账户即拒绝；`3911` 增加账户相等；账户切换清理策略。
3. H-3：v2 unlock/plain 接入 `secondFactorWall`，unlock 加限流。
4. H-4：移除远端源的特权命令授权，恢复 CSP，本地特权操作加确认。
5. H-5：补 macOS Keychain / Linux secret-tool，失败即拒绝保存。

**P1（本周）**

6. M-1：写审批链路全链路校验 `write && !muted`。
7. M-2：撤销能力/删除 Agent 时 `cancelTasksFor`，兑换前复核授权。
8. M-3：claim 比对 `executorId`，不覆盖原字段。
9. M-4：type 1 校验 MAC，MAC 失败报错。
10. M-5 / M-6：Cookie 与 Origin 策略收紧，重定向统一走 `safeNext`。
11. M-7：register/token/mcp/v2 unlock 限流；code 原子消费。
12. M-10：CLI state 校验、审批链接同源、materialize 路径绑定。

**P2（迭代）**

13. M-8 / M-11：实现或删除死配置；提升管理员 KDF 至平台上限。
14. M-9：切换官方 registry、`npm ci`、固定 Action SHA、最小权限、产物签名。
15. L-1 至 L-8：按表逐项加固；为 L-2 增加 DNS 解析后私网校验。

---

## 6. 审计限制

- 未对生产部署、真实 Cloudflare 账户、通知渠道、桌面安装包做动态测试。
- 未做依赖 CVE 深度分析（仅 `npm audit`）与第三方托管/域名接管评估。
- 未对 R2/邮件/Telegram 等外部集成做端到端攻防。
- 多账户利用链（H-2）基于代码路径推导，未在本地构造双账户 D1 数据复现；建议修复时同步补测试。
- 本报告只反映 `80c1f39` 基线，后续提交需重新审计。
