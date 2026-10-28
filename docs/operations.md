# 运维、备份与恢复

本文只覆盖本机运维。所有命令在仓库根目录执行，且使用同一个 Windows 用户。

## 一眼看状态

```powershell
secrets-broker status
```

输出包含 broker URL、token 存储、本地缓存、最后备份、本地 sidecar（4319）等关键状态；本地 sidecar 没启动时显示 `local service: not running`，不会报错退出。`broker login` 是 CLI 自己的登录态，与桌面端 token 独立；桌面已登录时 CLI 仍可能是 `not logged in`。

```powershell
Invoke-RestMethod http://127.0.0.1:4319/healthz
```

`items`/`revision` 是本地缓存条数/版本，`stale`/`error` 表示拉取是否正常。

## 备份

- 默认目录：`%USERPROFILE%\secrets-broker-backups`
- 每次是一个时间戳子目录，里面是加密后的 device key、cache、local tokens；`backup.json` 是元数据。
- 根目录的 `last-backup.json` 记录最近一次成功/失败；`secrets-broker status` 会读它。
- 默认保留 14 份；计划任务 `SecretsBrokerLocalBackup` 每天 03:30 运行。
- 手动备份：

```powershell
secrets-broker backup
secrets-broker backup --out D:\somewhere
```

- 计划任务只做副本，不解密、不把明文写盘。备份目录不要放进云盘同步。

## 恢复

恢复会用备份覆盖本机状态；先确认桌面端已退出，并先做一次新备份。

```powershell
secrets-broker restore --from "$env:USERPROFILE\secrets-broker-backups\<时间戳>"
```

目标已存在时需显式 `--force`。恢复后重新打开桌面端；同一个 Windows 用户才能解开 DPAPI/Keychain 保护的 device key 和 local token。

## 故障排查

| 现象 | 先看 |
| --- | --- |
| 桌面端显示本地服务未运行 | `Invoke-RestMethod http://127.0.0.1:4319/healthz`；看 4319 是否被占用 |
| 本地 agent 401/403 | `secrets-broker audit --limit 20`；重新生成该 agent 的本地 token |
| 审批没有弹窗 | 桌面端是否在运行；Windows 通知是否被专注助手/系统设置拦住 |
| 备份没有更新 | `secrets-broker status` 的 `last backup`；计划任务 `SecretsBrokerLocalBackup` 是否 Ready；`last-backup.json` 是否记录失败 |
| Web Push 没收到 | 浏览器通知权限、service worker 是否注册；重新订阅后再点“测试推送” |
| 更新提示 403/429 | 客户端会回退到 release 页面解析；仍失败时手动打开 Releases |

## 发布与更新

- 安装包是 unsigned；Windows 可能提示“未知发布者”，这是当前已知限制。
- 桌面端“检查更新”只打开下载页，不静默安装；下载后手动运行 MSI。
- 发布前跑 `npm run release:check`，确认版本号、测试和 MSI 产物一致。

## 自动检查

```powershell
npm run test:backup
npm run test:backup-scheduler
npm run test:cli
```

恢复演练使用临时目录，不会碰真实状态。
