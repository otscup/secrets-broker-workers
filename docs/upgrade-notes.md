# 升级说明：审计导出与审计查询的四处破坏性变更

适用版本：审计服务端过滤 + 条件导出上线的那一次部署。
影响对象：**不经过控制台**、直接调用 `/api/audit` 的脚本、cron、CI、下载器。

四处变更都会立刻影响调用方，前两处最容易"静默出错"而不是报错，请先扫一遍。

---

## 1. 导出：`GET /api/audit?format=csv` → `POST /api/audit`

**旧写法**（直接下载，无二次验证）

```powershell
Invoke-WebRequest -Uri "https://sb.example.com/api/audit?format=csv" `
  -Headers @{ Cookie = "__Host-broker_admin=<SESSION>" } -OutFile audit.csv
```

**现在的行为**：GET 返回 **428**，响应体是机器可读的：

```json
{
  "error": "confirmation_required",
  "code": "audit_export_post_only",
  "message": "审计导出已改为 POST + 二次验证：GET 不再返回 CSV。…",
  "next_step": "POST /api/audit with {\"format\":\"csv\",\"confirmPassword\":\"<password or TOTP>\"}",
  "docs": "docs/upgrade-notes.md"
}
```

**新写法**

```powershell
Invoke-RestMethod -Method Post -Uri "https://sb.example.com/api/audit" `
  -Headers @{ Cookie = "__Host-broker_admin=<SESSION>" } `
  -ContentType 'application/json' `
  -Body '{"format":"csv","agent":"d1","from":"2026-10-01","to":"2026-11-04","confirmPassword":"<主密码或 TOTP>"}' `
  -OutFile "secrets-broker-audit-<range>-<stamp>.csv"
```

- `confirmPassword` 或 `confirmCode`（开了 TOTP 时）**必须给**，和"条目导出"同一套二次验证；不要以为"只是日志"就放宽。
- 筛选条件与 JSON 查询完全一致，导出就是"当前筛选"。

> 侧信道提醒：`next_step` 而不是 401，是为了让调用方能区分"要换方法"和"登录失效"。

## 2. JSON：`entries` 不再是全量，默认一页 200 条

**旧语义**：`GET /api/audit` 返回的 `entries` 是整个日志数组。
**新语义**：`entries` 是当前页；还有 `total`、`hasMore`、`firstPage`、`page`、`pageCount`、`offset`、`limit`。

```json
{
  "entries": [ ... ],
  "total": 1732,
  "offset": 0,
  "limit": 200,
  "hasMore": true,
  "firstPage": true,
  "page": 1,
  "pageCount": 9,
  "masked": false
}
```

响应头同时带 `x-audit-total` / `x-audit-has-more` / `x-audit-page-size` / `x-audit-offset`，不解析 body 的调用方也能判断"没取完"。

**旧写法 → 新写法**

```powershell
# 旧：一次拿全量，然后在本地过滤
$all = (Invoke-RestMethod ".../api/audit").entries | Where-Object { $_.agent -eq 'd1' }
```

```powershell
# 新：条件交给服务端，循环翻页
$offset = 0
$pages = @()
do {
  $r = Invoke-RestMethod ".../api/audit?agent=d1&limit=500&offset=$offset"
  $pages += $r.entries
  $offset += $r.limit
} while ($r.hasMore)
```

支持的过滤参数：`item`、`agent`、`event`（组名，如 `read`/`grant`/`risk`）、`q`（模糊匹配）、`from`、`to`（日期只写 `YYYY-MM-DD` 时上界含整日）、`limit`（≤500）、`offset`。

## 3. CSV 文件名带范围与时间戳

**旧**：`secrets-broker-audit.csv`
**新**：`secrets-broker-audit-<range>-<YYYYMMDD-HHmmss>.csv`，例如 `secrets-broker-audit-2026-10-01_2026-11-04-20261104-093012.csv`

按固定文件名轮询/覆盖的脚本需要改成取 `Content-Disposition` 或自行拼名。

## 4. 锁定态导出的首行是注释

未解锁时导出的条目名是脱敏的，文件第一行固定为：

```
# 因未解锁，条目名称已脱敏（本文件由锁定态控制台导出）
```

把 CSV 当"第一行必是表头"解析的脚本会错列。解析前跳过以 `#` 开头的行。

---

## 5. 审计存储迁到 D1（非破坏性）

审计条目不再写进 Durable Object 的状态文档，而是逐条写入 `VAULT_DB` 的 `audit_v2` 表：

- `/api/audit` 的 `total` / `hasMore` / 分页以 D1 为准，**不再有 500 条上限**（第 2 节的字段与响应头保持不变）。
- `/api/state` 里的 `audit` 只是最近 500 条，供控制台首屏与提醒使用；要完整历史请走 `/api/audit`。
- 旧部署里 `state.audit` 存量的条目会在第一次打开控制台或查询审计时自动搬进 `audit_v2`，搬完立即清空；不会重复写入。
- 审计写失败只记日志，不再让已消费额度的 `secret.read` 变成 500。

## 附：另外两个新增的机器可读字段（非破坏性）

- `request_access` 在 `outside_scope` / `not-in-scope` / `no-grant` 时返回 `next_step`（人话的补救动作）与 `docs`。只渲染 `code` 的第三方客户端也能据此提示管理员去「Agents → 权限矩阵」加入可申请范围。
- 控制台新增 `rotateReminderDays`（默认 180）与 `expiryBlocksReads`（默认 `false`）。后者只有显式打开才会让到期条目的 `secret.read` 被拒绝，默认只提醒、不改变任何授权判定。

## 6. OAuth 同意页：写入、时长与准入（对客户端可见的变化）

同意页现在一次决定「连接 + 可读范围 + 是否明文 + 是否写入 + 有效期」。对直接对接 OAuth 的客户端有以下可见变化：

- **可申请写入**：`/.well-known/oauth-protected-resource` 与授权服务器的 `scopes_supported` 增加 `secrets.write`。只有客户端在 `scope` 里申请 **且** 管理员在同意页勾选「同时允许写入」时，token 才带 `secrets.write`；否则服务端会把该 scope 裁掉，`put_secret` 返回 `this agent is not allowed to write`。
- **有效期真的生效**：`grant_hours` 同时约束 admission 与 token。access token 仍按 24 小时封顶（`expires_in: 86400`）；`grant_hours > 24` 时额外返回 `refresh_token`，可用 `grant_type=refresh_token` 换新 access token（刷新会轮换 refresh token，旧值立即失效，且总时长不会超过同意时选定的窗口）。
- **同意即准入**：换取 token 时直接写入一条 `approved` 的连接准入记录（按 `agent + 账号` 识别，不再用 IP）。首个 MCP 调用不会再弹第二次「连接审批」。同一 agent 再次授权会替换旧记录，而不是叠加。
- **按调用判定范围**：批准后不再逐条目预写 capability / 写入票，读和写在发生时按准入记录判定，因此授权之后新增的条目（`scope.all`）也能直接用；此前"批了全部但新条目仍要逐次申请"的问题即由此消除。

对自己的脚本：读取 `state.capabilities` / `state.writeTickets` 来判断"某条目是否已授权"的做法不再成立，请改看 `/api/connections` 或 `connection` 准入记录，或直接调用工具观察 `not_found` / 拒绝文案。

## 7. `/api/lock` 会清除本会话所有 Vault 2.0 密钥槽（0.7.3 起，行为收紧，有意为之）

调用 `/api/lock` 现在会删除该会话的全部 v2 密钥槽（含 `plainOk` 明文确认位），以及控制台 helper 使用的 account 镜像槽。锁定后同一个 cookie 再请求 `/api/v2/items?plain=1` 返回 **423**，`/api/me` 的 `unlocked` 为 `false`，刷新页面也保持未解锁；要继续使用必须重新输入主密码解锁。

以前只删除 v1 会话，v2 的 DEK 缓存仍然存活，所以"锁定"后刷新看起来还是已解锁，明文读取也继续可用。依赖"锁定但保持 v2 解锁"的脚本需要改成：锁定后重新走一次 `/api/v2/unlock`。

## 8. 本地侧车与远端工具的策略/文案对齐（行为收紧，非破坏性）

本地 `/mcp` 的 `http_request` 现在也读同一组可选环境变量：`HTTP_ALLOW_METHODS`、`HTTP_ALLOWED_HOSTS`、`HTTP_ALLOWED_PORTS`、`HTTP_ALLOW_PATHS`。它们只能 **在条目存储的 https URL 之上再收窄**（取交集），不会放宽本地原有的"目标必须落在条目 URL 的 host/port/path 内"这一条；两者同时满足才放行。远端继续是"按条目 use 策略 + 可选同名环境变量"。

- 本地与远端现在返回同样的固定文案：`invalid method (max 16 chars)`、`target method is not allowed by HTTP_ALLOW_METHODS`、`target host is not allowed by HTTP_ALLOWED_HOSTS`、`target port is not allowed by HTTP_ALLOWED_PORTS`、`target path is not allowed`、`upstream request failed`、`upstream request timed out (15s)`；非幂等请求超时追加"可能已在远端执行，重试前先核对"。
- 上游返回的原始错误文本不再回传给 agent（可能包含内部主机名或注入头部的回显），只进审计。
- 本地 `put_secret` 的拒绝文案与 daemon 闸门统一（`reasonCode: local-write-disabled`），明确"这是策略拒绝，不是名字写错"；批准/拒绝/超时/限流也带 `reasonCode`（`local-approval-*`）。
- 设备 `canWrite` 的隐式默认统一为 **只读**：配对的函数默认、D1 列默认、读设备行时的缺省值现在一致。CLI cookie 配对与浏览器里批准设备码这两条明确授予写入的路径显式传 `canWrite: true`，因此现有配对方式的能力不变；只有"忘了传字段"的第三方调用会从可写变成只读。
