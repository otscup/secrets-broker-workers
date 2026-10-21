# 把密钥交给 AI Agent，却不把密钥交出去

**Secrets Broker — 一个跑在 Cloudflare Workers 上的密钥网关**

> 仓库：`otscup/secrets-broker-workers` ｜ 部署形态：1 个 Worker + 1 个 Durable Object + 0 个新数据库

---

## 一、我们想解决什么问题

过去两年，几乎每个团队都接了 AI Agent。但把一个能读文件、能跑命令的 Agent 接入生产系统时，密钥这件事几乎总是靠「能用就行」糊过去的。

**痛点 1：密钥一旦进了 Agent 的上下文，就等于公开了。**

你把 API Key 写进 `.env`、写进 system prompt、写进 Agent 的配置文件。它会进入对话历史、进入日志、进入向量库、被复制到本地缓存。模型上下文窗口是「可回放的」——你以为删掉了，但它可能已经在某次请求里被完整发送过。

**痛点 2：权限是「有或没有」，不是「能做什么」。**

传统方案给 Agent 一把万能钥匙。Agent 只想查一次天气，却能读到全部 300 个条目。你想限制它读某个条目吗？做不到——除非你为每个 Agent 建一个账号，而那在自动化场景里不现实。

**痛点 3：出了事查不出来。**

密钥被读走了，审计日志里只有一条「2024-03-15 某 Agent 读了某条目」。哪个 Agent？在哪个 IP？读了什么？是主动读的，还是被提示词注入诱导读的？

**痛点 4：审批是个摆设。**

很多方案有「人工审批」按钮，但 Agent 卡在那等你点。你自己写的脚本不会点。

**痛点 5：贵。**

密码管理器通常需要长期运行的服务器、常驻数据库、备份运维。个人开发者或小团队根本不想维护这套东西。

---

## 二、我们的答案：让密钥「可被使用」而非「可被看到」

Secrets Broker 的核心思路只有一句：

> **Agent 永远拿不到密钥明文。密钥只在网关内部被解密和使用，用完即弃。**

这不是「把密钥藏起来」，而是**改变密钥的交付形态**。Agent 拿到的是一次性的「能力」（capability），不是密钥本身。

### 架构：三个组成部分

```
┌─────────────┐   MCP / HTTP    ┌──────────────────┐   签名请求    ┌──────────────┐
│  AI Agent   │ ───────────────▶ │  Secrets Broker  │ ────────────▶ │  NodeWarden  │
│ (无密钥)    │                  │  (Worker + DO)    │               │  (D1 密文)   │
└─────────────┘                  └──────────────────┘               └──────────────┘
                                      ▲
                                      │ 浏览器端解锁（主密码不出本机）
                                   ┌──┴──┐
                                   │ 人  │
                                   └─────┘
```

- **浏览器端完成 KDF**：主密码在浏览器里派生密钥，**Worker 永远收不到主密码**
- **Durable Object 存会话**：解锁会话用服务器侧密钥（KEK）包装后存放
- **D1 保持只读加密**：Broker 读的是 NodeWarden 的密文，用会话密钥在 Worker 内解密
- **Agent 侧零改造**：标准 MCP 协议，Agent 只会「调用工具」

---

## 三、密码安全：具体怎么做的

这一节是本文的重点。以下每一条都对应代码中的实际实现，不是设计意图。

### 3.1 主密码永不离开浏览器

解锁流程完全在浏览器侧完成：

```javascript
// src/ui.js —— 全部发生在浏览器里
const masterKey = await pbkdf2(password, String(info.email).toLowerCase(), info.kdfIterations)
const encKey = await hkdf(masterKey, 'enc', 32)
const macKey = await hkdf(masterKey, 'mac', 32)
// 只把派生出的会话密钥发给 Worker
await api('/api/unlock', { method: 'POST', body: JSON.stringify({
  symEncKey: b64(userKey.slice(0, 32)),
  symMacKey: b64(userKey.slice(32, 64)),
  ttl: '24h',
}) })
// 立刻清空输入框
$('master-password').value = ''
```

**要点**：

- PBKDF2-HMAC-SHA256，迭代次数取自服务端返回的 `kdfIterations`（与 Bitwarden 一致）
- HKDF 派生 `enc` / `mac` 两把子密钥，info 字符串做域分离
- Worker 收到的是**会话密钥**，不是主密码，也不是 masterKey
- 密码框在请求发出后立即清空
- 全程使用 WebCrypto `crypto.subtle`，无自定义密码学实现

### 3.2 会话密钥用服务器 KEK 二次包装

会话密钥不能裸存。Broker 用 `SESSION_KEK`（Worker secret，32 字节）作为密钥，对会话记录做包装后写入 Durable Object：

```javascript
// 包装：KEK 加密会话明文
await putSession(env, session)
// 取出：KEK 解密
const plain = await unwrapWithKek(payload.session.wrapped, await kekBytes(env))
```

这样即使 Durable Object 的存储被读走，攻击者拿到的也只是密文，还需要 `SESSION_KEK` 才能解开——而 KEK 只存在于 Worker 的 secret 环境变量里。

**会话 TTL 可配置**：永久 / 7 天 / 24 小时 / 1 小时。锁定（`/api/lock`）会立即删除服务端会话记录。

### 3.3 管理会话：签名 + 服务端可撤销

管理后台的 cookie 不是一个自包含 token，而是**签名 + 服务端记录**的组合：

```javascript
// 签名密钥由 SESSION_KEK 派生，与会话包装密钥隔离
const cookieKey = await cookieKey(env)   // SHA-256('cookie:' + SESSION_KEK)
// payload: v2.<sessionId>.<expires>.<hmac>
```

这带来两个传统自包含 token 做不到的能力：

1. **单点登出**：删除服务端 `adminSessions[id]` 即可立即失效该会话
2. **可观测**：记录 `ip`、`user-agent`、`lastSeen`，支持「查看并踢掉所有设备」

签名比较使用**常数时间算法**，避免时序侧信道：

```javascript
export function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}
```

### 3.4 Agent 身份：令牌只存哈希

Agent 的 Bearer Token **明文只在创建时显示一次**，服务端只保存 SHA-256 哈希：

```javascript
const hash = await sha256Base64(token)
// 比对时对哈希做常数时间比较
if (!constantTimeEqual(encoder.encode(agent.hash), encoder.encode(hash))) continue
```

数据库泄露不会直接导致 Agent 令牌可用（哈希不可逆），且比对过程不泄漏时序信息。

### 3.5 细粒度能力模型（capability）

这是整个系统的核心安全抽象。Agent 不持有「能读这个库」的令牌，而是持有**针对特定条目、特定动作**的能力：

```javascript
// 能力键：主体 × 条目 × 动作
function capabilityKey(subjectId, itemId, action) { return subjectId + '\u0000' + itemId + '\u0000' + action }
```

两个动作严格区分：

| 动作 | 含义 | 额外要求 |
|---|---|---|
| `secret.read` | 读取条目的值 | 需该条目的能力 |
| `secret.use` | **代持凭证发起外部请求** | 需能力 **+ 该条目的 use 策略 + 目标域名在策略白名单内** |

关键规则（代码中明确注释）：

- `secret.use` **绝不会**从旧的 allowlist/allowAll 隐式推导，必须显式授权
- `noApproval`（免审批）**本身不是授权来源**，必须有对应的 actionGrant 背书
- 能力一旦存在，其裁决就是**终局**：已过期、已撤销、次数用尽，都不允许回退到旧路径
- 跨账户访问算**硬拒绝**，不会掉进审批队列

```javascript
// 有能力但不可用 = 终局拒绝，不给任何回退机会
const capabilityDecisive = Boolean(cap) && (reason !== 'capability')
if (capabilityDecisive) { ok = false; ... }
```

### 3.6 消费是原子的

能力的次数限制和撤销在**执行时刻**原子消费，不是在检查时刻：

```javascript
// Durable Object 事务内完成 consume
const result = await consumeCapability(env, key, accountId, action)
```

这避免了「检查通过 → 并发多读一次」的竞态。

### 3.7 通知里的审批链接：签名 + 一次性

Telegram / ntfy / Gotify / wxpush 推送里带的「仅本次/24 小时/永久」按钮，是**带签名的免登录链接**：

```javascript
// 签名绑定 id + decision + exp，任何一环被改即失效
const signature = await hmacToken(await cookieKey(env), id + ':' + decision + ':' + exp)
// 校验时同样用常数时间比较
if (!constantTimeEqual(encoder.encode(expected), encoder.encode(signature)))
  return new Response('签名无效', { status: 400 })
```

这让审批真正可用：**不需要登录，点一下就批准**。同时链接天然有有效期，且可被服务端判为「已处理」后失效。

### 3.8 审计日志不记录敏感值

审计条目只记录**元数据**：

```javascript
// 从不记录：值、用户名、TOTP、请求体、请求头
addAudit(env, { event: 'policy.shadow-mismatch', action, agent: agentName, name: itemName, ... })
```

**设计原则**：审计日志要能回答「谁在什么时候读了什么」，但不能自己变成新的密钥泄露面。

### 3.9 HTTP 层的防护

```javascript
'content-security-policy': "default-src 'self'; img-src 'self' data: https:; " +
  "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
'x-frame-options': 'DENY'
'x-content-type-options': 'nosniff'
'referrer-policy': 'no-referrer'
```

- **`frame-ancestors 'none'`** 阻止被任意站点嵌入（点击劫持）
- **`object-src 'none'`**、**`base-uri 'none'`** 阻断插件注入与 base 标签劫持
- 未使用任何外部 CDN，脚本同源，`connect-src 'self'` 限制外联

管理接口另有 **Origin 同源校验**（`adminAuthorized`），防止跨站请求伪造。

### 3.10 并发写入的正确性

多请求并发修改同一份状态时，「读取—修改—写回」会静默丢失他人的改动。本项目用**版本号 + CAS 重试**解决：

```javascript
async function updateState(env, mutate) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const loaded = await loadStateVersioned(env)      // 带版本号读
    const result = await mutate(loaded.state)
    const saved = await saveStateCas(env, loaded.state, loaded.version)  // 版本不匹配则失败
    if (saved?.ok) return result
    await new Promise((resolve) => setTimeout(resolve, 5 + attempt * 10))
  }
  throw new Error('state write conflict: too many concurrent updates')
}
```

而 OAuth 客户端注册、提醒标记这类**旁路写入**，走的是事务内的逐键原子写，不会覆盖其他字段。

---

## 四、功能一览

### 面向人的部分

- **保险库管理**：条目增删改查、分组、导入导出、Bitwarden 文件夹过滤
- **多账户**：在多个 NodeWarden 用户间切换
- **免审批策略**：给特定条目免审批（**仍留审计**）
- **授权管理**：授权时长（1h/24h/7d/永久）、读取次数上限、撤销、直接分享给 Agent
- **审计与看板**：KPI、趋势图、Agent 占比、条目排行、最近活动
- **OIDC 单点登录**：可选，用外部 IdP 登录后台
- **到期提醒**：授权 5/3/1 天到期、Agent 长期闲置，站内滚动通知 + 多渠道推送
- **通知模板可编辑**：审批与提醒的文案在设置页改，保存即生效
- **Agent Live Globe**：真实访问事件的全球态势，每条请求一条航迹，按 Agent 着色并标注国家码

### 面向 Agent 的部分

- **MCP 协议**：`get_secret` / `get_credential` / `http_request` / `list_credential_requests`
- **Bearer Token**：可按 Agent 轮换、设置过期时间
- **权限范围**：条目白名单、分组范围、`secret.use` 白名单目标域名、写权限开关
- **动态注册**：标准 OAuth 2.1 + PKCE，无需手动配置

---

## 五、和其他方案的区别

| | 传统密码管理器 + Agent 插件 | 云端 KMS / Secret Manager | **Secrets Broker** |
|---|---|---|---|
| Agent 是否看到明文 | 看到 | 看到（需拉取） | **永远看不到** |
| 权限粒度 | 账号级 | 密钥级 | **主体 × 条目 × 动作** |
| 撤销生效时间 | 需轮换密钥 | 需轮换密钥 | **立即**（服务端删记录） |
| 免登录审批 | 无 | 需 IAM | **签名链接，点即批** |
| 部署成本 | 常驻服务器 + DB | 云托管 | **1 Worker + 1 DO** |
| 新增数据库 | — | — | **0 个** |

与云端 KMS 的差别值得展开：KMS 保护的是「密钥的存储」，但 Agent 要用密钥就必然得拿到明文。Broker 保护的是「密钥的**交付路径**」——Agent 永远只拿到一次性能力。

---

## 六、代价与边界

诚实地说，这个方案有明确的边界：

1. **Broker 是单点**。它持有解密后的会话密钥，必须高可用。需要多区域就用 Workers 的 Durable Object 跨区复制，但同一时刻仍然是单实例。
2. **需要有人解锁**。这是刻意的设计——没有活跃的解锁会话，Agent 读不到任何东西。自动化场景需要给服务账号开长期会话。
3. **`secret.use` 之后的事，管不了**。Agent 拿到凭证后自己去请求别的服务，那段流量 Broker 看不见。Broker 只能保证「**通过我发起的请求**」符合策略。
4. **审计元数据仍可能被滥用**。虽然不记录值，但条目名和 Agent 名会进日志。
5. **`secret.use` 的目标白名单需要人工维护**。新域名要显式加，不会自动放行。

---

## 七、当前状态

- 60 个测试文件，48 个测试套件全部通过
- 91 次提交
- 功能仍在演进，欢迎 issue 和 PR

**快速开始**（本地）：

```bash
git clone https://github.com/otscup/secrets-broker-workers
cd secrets-broker-workers
npm install
npx wrangler dev
```

---

## 八、写在最后

我们做这个项目，不是因为觉得 Agent 一定会失控。

是因为**当前所有方案都默认「信任这个 Agent」**。而当 Agent 数量从 1 变成 50，当它们从内部工具变成会读外部网页的 Agent，这个默认就站不住了。

安全的目标不是「相信它不会做坏事」，而是**「它做不了坏事」**——把限制从「它应该守规矩」变成「它没有那个能力」。

这才是把密钥交给 AI Agent 的前提条件。

---

*仓库：`github.com/otscup/secrets-broker-workers`*
相关项目：Docker/Node 参考实现 `secrets-broker` ｜ MCP Skill `secrets-broker-skill`