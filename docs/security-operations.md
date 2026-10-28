# 安全运维：本地信任边界、Web Push 与 VAPID 轮换

本文记录当前安全模型和需要人工执行的轮换步骤。它不是合规认证。

## 威胁模型（当前版本）

| 资产 | 信任边界 | 主要风险 | 当前缓解 |
| --- | --- | --- | --- |
| Broker 中的 secret | 浏览器 → Worker → Durable Object | 账号被盗、会话被重放 | OIDC/session、Vault 主密码、审批、审计 |
| device token | 本机 DPAPI → Worker | 本机文件被复制、token 泄漏 | DPAPI、设备撤销、`secrets-broker forget` |
| local agent token | `%USERPROFILE%\.secrets-broker\local-agents.dpapi` → 本机 4319 | 同 Windows 用户的其他进程可读 4319 | 每 agent token、审批策略、速率限制；**不防同用户恶意进程** |
| 本地缓存/备份 | 本机文件 | 备份被复制 | 加密备份、DPAPI/Keychain、备份目录不进云盘 |
| Web Push 订阅 | 浏览器 push service → Worker | 通知内容泄漏、订阅被滥用 | 只发条目名/agent 名，不带 secret；VAPID 私钥只在 Worker secret |
| 桌面安装包 | GitHub Releases → 用户 | 未签名安装包被替换 | release 下载 URL 白名单；**没有代码签名，无法防篡改** |

明确接受的风险：

- 本地 4319 对同一 Windows 用户的其他进程没有进程级隔离；需要更强隔离时应改为按 agent 的独立 OS 账户或命名管道 + ACL。
- 安装包 unsigned；Windows SmartScreen 可能警告。证书到位前不宣称“可信安装”。

## Web Push 数据流

1. 浏览器用 `GET /api/push/vapid` 取公钥并 `pushManager.subscribe`。
2. 订阅 POST 到 `/api/push/subscribe`，服务端存 endpoint/keys。
3. `notifyPending` / `notifyDenied` 发送只含标题和简短正文的通知；正文不含 secret 值。
4. 404/410 的订阅会被删除；`/api/push/test` 只用于验证链路。

## VAPID 轮换

VAPID 公钥是浏览器订阅的一部分；**轮换公钥会让旧订阅全部失效**，用户需要重新订阅。只在私钥泄漏、丢失或计划性安全事件时轮换。

1. 生成新密钥对（在可信终端，不写入仓库）：

   ```powershell
   npx web-push generate-vapid-keys --json
   ```

2. 写入 Worker secrets：

   ```powershell
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler deploy
   ```

3. 让用户重新订阅：打开控制台 → 通知 → “启用 Web Push”（或刷新后重新授权）。旧的 push endpoint 会在发送时返回 404/410 并被清理。
4. 用 `/api/push/test` 验证；确认新通知到达。
5. 在变更记录里写轮换日期和原因；不要记录私钥。

快捷检查：

```powershell
Invoke-RestMethod https://sb.otscup.com/api/push/vapid
```

只应返回 `{ "publicKey": "..." }` 和 `enabled: true`，绝不返回私钥。

## 发布检查

- `npm run release:check` 必须通过。
- 0.2.23 起安装包仍未签名；发布说明必须保留“unsigned”提示。
- 本地 4319 的 token 文件权限依赖用户目录 ACL；不要把 `.secrets-broker` 放进同步盘。
