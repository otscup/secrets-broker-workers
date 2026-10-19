# Docker vs Workers parity

This table tracks the reference implementation (`secrets-broker/server.mjs`,
Docker) and the Cloudflare Workers port (`secrets-broker-workers`).

| Feature | Docker | Workers |
|---|---|---|
| Admin password login | ✅ | ✅ |
| Custom admin password | via env | ✅ stored in DO (PBKDF2) |
| TOTP login | ✅ | ✅ setup/enable/disable/login challenge tested |
| OIDC (xid) login/binding | ✅ | ✅ PKCE + dynamic client; full login needs the user's xid authentication |
| Browser KDF / no server-side PBKDF2 | n/a | ✅ browser + CLI (`unlock.mjs`) |
| Master password auto-unlock | ✅ encrypted file | ❌ permanent session instead |
| Vault unlock / lock | ✅ | ✅ |
| List/search items | ✅ | ✅ |
| Read item | ✅ | ✅ |
| Edit name/url/notes/value | ✅ via `bw` | ✅ direct D1 write with item-key encryption |
| Delete item | ✅ | ✅ soft delete in D1 |
| Groups / notes | ✅ broker config | ✅ broker state (`itemGroups`) |
| Share to agents | ✅ | ✅ multi-agent, duration, max reads |
| Per-item no-approval | ✅ | ✅ |
| Create item | ✅ | ✅ |
| Import / export (JSON) | ✅ local files | ✅ JSON import/export |
| Bitwarden folder sync setting | ✅ | ✅ folder filter (broker state) |
| Agent create/rename/rotate/delete | ✅ | ✅ |
| Copy agent token later | ✅ encrypted tokens | ✅ token wrapped with `SESSION_KEK` |
| Per-agent readable items/groups | ✅ | ✅ |
| Per-agent write flag | ✅ + write API | ✅ `/agent/items/save` |
| Pending approvals | ✅ | ✅ |
| Approve once/1h/24h/7d/permanent | ✅ | ✅ |
| Grant extend/revoke/delete | ✅ | ✅ |
| Grant max reads | ✅ | ✅ |
| Grant restore | ✅ | ✅ |
| Audit log | ✅ file | ✅ DO (last 500, not auto-cleared) |
| Dashboard KPIs/trend/top items | ✅ | ✅ |
| Theme (light/dark/auto) | ✅ | ✅ |
| Avatar account menu | ✅ | ✅ |
| Browser notifications | ✅ | ✅ permission + polling |
| OIDC settings UI + endpoint auto-discovery | env/settings | ✅ |
| Telegram / ntfy / Gotify / wxpush | ✅ | ✅ server-side send |
| Telegram inline approve buttons | ✅ | ⚠️ webhook + inline keyboard implemented; needs bot token to test |
| MCP HTTP Bearer | ✅ | ✅ `list_secrets` / `request_access` / `get_secret` |
| MCP OAuth 2.1 authorization server | ✅ | ✅ DCR + PKCE + consent + token |
| stdio MCP adapter | ✅ | ❌ Worker cannot spawn processes |
| DSH plugin / auto setup | ❌ (not yet) | ❌ |
| Import/export | ✅ | ✅ JSON |
| Health/status | ✅ | ✅ |

## Important notes

- Workers writes **directly to NodeWarden's D1**, encrypting the changed fields with the
  item key / user key. It does not use the Bitwarden HTTP API.
- Workers state lives in a Durable Object; it does **not** create a D1 database.
- Docker and Workers are separate deployments sharing the same NodeWarden vault.
  Changes made in one are visible to the other (they read the same D1).
- "OAuth" in this table means the **MCP OAuth 2.1 authorization server**. The
  Workers version currently uses a static Bearer token for MCP; OIDC login is separate.
