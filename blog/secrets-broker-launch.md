---
title: 我给 AI Agent 做了一个自托管密钥库：Secrets Broker
description: 让 Agent 通过审批读取 Bitwarden 里的密钥，而不是把 API key 复制到 prompt、.env 和每个客户端里。
date: 2026-10-20
tags: AI, Agent, 安全, Bitwarden, Cloudflare Workers, 自托管
---

# 我给 AI Agent 做了一个自托管密钥库：Secrets Broker

AI Agent 越能干，越容易遇到同一个问题：**密钥放哪？**

把 API key 贴进 prompt，它会出现在会话记录里；写进 `.env`，每个项目、每台机器都要复制一份；交给某个客户端，这个客户端就成了新的秘密保管员。更麻烦的是，你很难回答：**谁在什么时候读了哪个密钥？**

Secrets Broker 就是为这个问题做的。

## 它是什么

一个自托管的 **Agent 密钥代理**。密钥仍然放在你熟悉的 Bitwarden 兼容 vault 里（NodeWarden / Vaultwarden / Bitwarden），broker 只给 Agent 暴露很窄的 API 和 MCP 接口：

- 每个 Agent 独立 token；
- 默认人工审批；
- 支持一次、1 小时、24 小时、7 天、永久授权；
- 记录每次读取、授权、撤销；
- 常用条目可以设免审批，但仍然审计。

核心理念一句话：

> **模型不需要看到密钥本身。**

Agent 发起请求 → 你在网页 / Telegram / ntfy / Gotify / Webhook 里点同意 → Agent 拿到值。

## 两个版本

项目现在有两个实现：

### Docker / Node 版
适合 NAS、家庭服务器、已有 Docker 的环境。用 Node 服务 + Bitwarden CLI，功能最全，支持本地 `exec_with_secrets`。

### Cloudflare Workers 版
适合不想维护 NAS、Docker 和隧道的场景：

- 直接读 NodeWarden 的 D1；
- 浏览器端完成 PBKDF2/HKDF，主密码不离开浏览器；
- Durable Object 保存会话；
- 免费计划可用；
- 支持 MCP OAuth 2.1、Agent token、文件夹隔离、跨账户复制。

两个版本共享同一套模型：静态加密、运行时解密、审批、审计。

## 界面

首页是概览：读取次数、活跃 Agent、待审批、有效授权。每个卡片都能点开看明细。

![Secrets Broker 首页](https://raw.githubusercontent.com/otscup/secrets-broker-workers/main/blog/secrets-broker-home.png)

密钥页可以管理条目、分享给 Agent、批量分享、查看创建人和使用记录。授权页能看到每个 Agent 读了多少次、什么时候到期、最近使用时间。

## 给 Agent 用

Agent 通过 MCP 连接：

```text
https://sb.otscup.com/mcp
```

支持 OAuth 2.1 动态注册 + PKCE，也支持 Agent token。连接时 MCP 会直接下发指令：

> 用 broker 取密钥，不要问用户要密码；需要审批就展示链接并重试。

为了方便只支持 stdio MCP 的客户端，项目还带了一个桥接器：本地 stdio → OAuth 登录 → 远端 MCP。

## 连接器：Broker 里没有的密钥

Agent 可以调用 `request_credential` 创建一个一次性连接链接。你打开链接，填入它需要的 API key，broker 会保存到 vault 并授权给这个 Agent。这样 Agent 不需要把密钥贴进对话，也不需要提前把所有密钥都准备好。

## 安全边界

需要说清楚：**broker 是一个可信解密客户端**。

- D1 里存的是密文；
- 会话密钥在 Durable Object 里用 `SESSION_KEK` 包裹；
- 只有在解锁后，Worker 才在内存里解密；
- 用 `get_secret` 时，网页和 MCP 拿到的都是解密后的值。

所以“网页能看到、MCP 看不到”对 `get_secret` 是不成立的。如果 Agent 要使用密钥，它最终必须拿到值，或者让 broker 代它执行请求。

更安全的方式是 `http_request`：Agent 只说“用哪个密钥请求哪个 URL”，broker 在服务端注入密钥并返回响应，**密钥不进入模型上下文**。这才是真正接近“模型不需要看到密钥”的用法，也是我建议 Agent 优先调用的工具。

连接器则解决了另一个问题：Broker 里本来没有的密钥，可以在一次性链接里填入，broker 保存后自动授权，不需要把值贴进对话。

## 项目地址

- Docker / Node 版：<https://github.com/otscup/secrets-broker>
- Cloudflare Workers 版：<https://github.com/otscup/secrets-broker-workers>
- Agent Skill / stdio 桥接器：<https://github.com/otscup/secrets-broker-skill>

项目使用 AGPL-3.0。

## 最后

Secrets Broker 不是要让 Agent 更“自由”，而是让它在使用密钥时**有边界、有记录、可撤销**。

如果你也在给 Agent 接各种 API，欢迎试试，或者告诉我你最想要的下一个能力。
