# Secrets Broker — Cloudflare Workers

[English](README.md) | 简体中文

这是 Secrets Broker 的 **Cloudflare Workers 原生版本**：直接读取 NodeWarden
的 D1 密文，浏览器端完成主密码 KDF，Durable Object 保存会话，Agent 通过
MCP/OAuth 或 Agent token 读取密钥。

**无需任何配置即可试用：** <https://demo.otscup.com> —— 用真实界面连接虚拟
密文库。不需要 NodeWarden，没有任何真实凭据，自带 OIDC 身份提供者，整条流程
一分钟内就能点完。

它从 **NodeWarden 的 D1 数据库**读取 Bitwarden 兼容的 vault，只在浏览器/CLI
解锁会话有效期间于 Worker 内解密条目，并对外暴露一组范围很窄的 Agent API。

Docker/Node 版本（[otscup/secrets-broker](https://github.com/otscup/secrets-broker)）
仍然是参考实现；本项目是一个独立的、仅运行在 Workers 上的移植版本，因此
NodeWarden 升级不会影响它。

功能对比见 [docs/parity.md](docs/parity.md)，逐项对照 Docker 版本。

DSH 插件（在设置页内处理待审批）：[`dsh-plugin/`](dsh-plugin/)。

## 当前进度（可用 PoC）

- ✅ 1 个 Worker + 1 个 Durable Object；**0 个新增 D1 数据库**
- ✅ 只读访问 NodeWarden 的 D1（`ciphers`、`users`）
- ✅ 浏览器端 PBKDF2/HKDF/AES 解锁（主密码不会发送给 Worker）
- ✅ Durable Object 会话存储（由 `SESSION_KEK` 包裹）
- ✅ 解锁 TTL：永久 / 7 天 / 24 小时 / 1 小时
- ✅ 条目列表 + `/secret` 读取，使用每个 Agent 独立的 Bearer token
- ✅ 条目操作：编辑名称/网址/备注/值、分组、共享、删除（写回 NodeWarden D1）
- ✅ 新建条目、JSON 导入/导出、Bitwarden 文件夹筛选
- ✅ Agent 写入 API（`/agent/items/save`，需要该 Agent 开启写权限）
- ✅ Telegram 内联审批（webhook）；ntfy/Gotify/wxpush 带签名的免点击审批链接
- ✅ 在 NodeWarden 用户之间切换账号；OIDC 解绑；通知测试按钮
- ✅ Agent：新建 / 重命名 / 轮换 / 删除 / 复制 token；每个 Agent 的允许列表、分组范围和写权限
- ✅ 审批流程：仅本次 / 1 小时 / 24 小时 / 7 天 / 永久；界面上可查看待审批请求
- ✅ 授权操作：延长时长、设置最大读取次数、撤销、删除；直接共享给某个 Agent
- ✅ 条目级免审批策略（读取仍会审计）
- ✅ 审计日志与仪表盘：关键指标、趋势柱状图、Agent 占比、热门条目、最近活动
- ✅ 个人资料页 + OIDC（xid）登录/绑定，使用 PKCE
- ✅ 头像账号菜单、深色模式、修改密码、TOTP 两步验证
- ✅ HTTP MCP 端点（`/mcp`），提供工具：`list_secrets`、`request_access`、`get_secret`
- ✅ 通知设置：Telegram / ntfy / Gotify / wxpush（有待审批请求时发送）
- ✅ 无头 `unlock.mjs`
- ⬜ DSH 插件 / OAuth MCP 自动发现

## MCP

Worker 提供一个 JSON-RPC MCP 端点：

```
POST https://your-worker.example/mcp
Authorization: Bearer <agent token>
```

Worker 同时提供一个 MCP OAuth 2.1 授权服务器：

- `/.well-known/oauth-authorization-server`
- `/oauth/register`（动态客户端注册）
- `/oauth/authorize`（PKCE S256 + 用户同意）
- `/oauth/token`（authorization_code）

支持 OAuth 的 MCP 客户端可以自动发现并使用它；旧的静态 Bearer token 依然可用。

## Agent skill

仓库内附带一个可移植 skill：[`skills/secrets-broker`](skills/secrets-broker)。
它教会 Agent 自动使用 MCP 工具、绝不索要密钥原文、处理审批链接，并避免把凭据
打印出来。其中还包含 Codex 和 Hermes 的配置示例。

工具：

- `list_secrets` —— 条目名称/网址，不含具体值；
- `request_access` —— 创建审批请求并返回审批链接；
- `get_secret` —— 审批通过后返回值（需设置 `MCP_ALLOW_READ=1`）。

Codex/HTTP MCP 配置示例：

```toml
[mcp_servers.secrets]
url = "https://your-worker.example/mcp"
headers = { Authorization = "Bearer <agent token>" }
```

如果 Agent 需要先经过人工审批，先调用 `request_access`，在浏览器里批准，再调用
`get_secret`。把条目设为 **免审批** 即可跳过审批步骤。

## 为什么在浏览器端做 KDF

Bitwarden 默认 KDF 是 PBKDF2 600,000 次迭代。免费套餐的 Worker 跑不动
（已实测：`/api/kdf` 在 20 万次以上迭代时以错误 1101 失败）。由浏览器/CLI
完成一次 KDF；Worker 只做开销很小的条目解密（AES-CBC/HMAC，约 1ms）。这样
免费套餐的 CPU 配额对每次读取已经足够。

## 资源占用

| 资源 | 数量 | 说明 |
|---|---|---|
| Worker | 1 | 本项目 |
| Durable Object | 1 个命名空间 | SQLite 存储，不占 D1 配额 |
| D1 | **0 个新增** | 只读绑定到已有的 `nodewarden-db` |
| KV/R2 | 可选 | 非必需 |

## 凭据

这里有三种不同的密钥，不要混用：

| 密钥 | 位置 | 用途 |
|---|---|---|
| `ADMIN_PASSWORD` | 浏览器登录表单 | 管理 broker 界面；不是 Agent token |
| `AGENT_TOKEN` | `Authorization: Bearer ...` | 机器/Agent 调用 `/secret`；绝不在浏览器中使用 |
| Bitwarden 主密码 | 浏览器解锁表单 | 在本地派生密钥；从不发送给 Worker |

本地 PoC 将它们分别保存为 `workers-admin-login-password.txt`、
`workers-agent-bearer-token.txt`，Bitwarden 主密码保存在 `nas-master-password.txt`
（在本仓库之外）。

## 部署

1. 安装依赖并登录 Wrangler：

```bash
npm install
npx wrangler login
```

2. 复制 `wrangler.example.jsonc` 到 `wrangler.jsonc` 并填写：

- 你的 NodeWarden D1 对应的 `database_id`
- `services[0].service` 对应的 NodeWarden Worker 名称
- `VAULT_EMAIL`（Bitwarden 账号邮箱）

3. 设置密钥：

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put AGENT_TOKEN
openssl rand -base64 32 | npx wrangler secret put SESSION_KEK
```

4. 部署：

```bash
npx wrangler deploy
```

5. 打开 Worker 网址，用 `ADMIN_PASSWORD` 登录，再用 Bitwarden 主密码解锁。
   浏览器会在本地派生密钥。

### 无头解锁

```bash
BROKER_URL=https://your-worker.example \
ADMIN_PASSWORD=... \
MASTER_PASSWORD=... \
TTL=permanent \
node unlock.mjs
```

### Agent API

```bash
# 首次读取：返回 202 和一个待审批请求（条目为免审批时除外）
curl -H "Authorization: Bearer $AGENT_TOKEN" \
  "https://your-worker.example/secret?name=tavily-api-key"

# 在界面上批准之后（或把条目设为免审批之后）
curl -H "Authorization: Bearer $AGENT_TOKEN" \
  "https://your-worker.example/secret?name=tavily-api-key"
```

Agent 在 **Agents** 标签页中创建；token 只显示一次。
条目在 **密钥** 标签页里的 **免审批** 开关可以让读取立即返回，同时仍会记录审计
事件。

## 给凭据分类

每个凭据都会标记为 **api**、**web** 或未分类，就显示在名称旁边。这个标记决定
Agent 能对它做什么：

- **api** —— API Key。Agent 可以读取，但需要你先为这个条目单独放开明文读取
  （30 天后自动失效）。
- **web** —— 网站登录。只会被填充到你列出的 origin，Agent 永远拿不到明文。
- **未分类** —— 默认拒绝，所以在选之前什么都读不到。

选择器和名称旁边的标签用的是同一套颜色。可以在条目的 ⋮ 菜单里设置，也可以勾选
多个后批量分类，或者从 DSH 插件存密钥时直接选好。

origin 只做精确匹配：子域、其他端口和 `example.com.evil.test` 都不会匹配到
`example.com`。默认要求 `https`；只有不可能离开本地网络的地址
（`localhost`、`127.x`、`10.x`、`192.168.x`、`172.16-31.x`、`*.lan`、
`*.local`）可以用 `http`，因为家用设备的控制台通常没有证书。只写 `host:port`
时按 `https` 处理。

## OIDC（xid）登录

设置以下变量/密钥（或直接修改 `wrangler.jsonc`）：

```jsonc
"OIDC_ISSUER": "https://auth.example.com",
"OIDC_CLIENT_ID": "your-client-id",
"OIDC_REDIRECT_URI": "https://your-worker.example/oidc/callback"
```

Worker 使用 authorization code + PKCE。请在身份提供者处注册回调地址（xid 支持
动态客户端注册；使用 `token_endpoint_auth_method=none` 的公共客户端即可）。
登录之后，个人资料会保存 OIDC 的 subject/email/name；管理员登录既可以用密码，
也可以用 OIDC。

## 安全说明

- `SESSION_KEK` 在 Durable Object 存储中包裹会话密钥；轮换时需要在更换密钥后
  重新解锁。
- Worker 永远不会收到主密码，只会收到派生出的对称密钥。
- 管理员 cookie 使用由 `SESSION_KEK` 派生的密钥做 HMAC 签名，属性为 HttpOnly、
  Secure、SameSite=Lax。
- 生产环境请使用自定义域名 / Cloudflare Access；`*.workers.dev` 网址在部分网络
  中可能被屏蔽。
