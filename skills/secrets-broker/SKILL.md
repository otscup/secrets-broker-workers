---
name: secrets-broker
description: Retrieve API keys, passwords and other credentials from the self-hosted Secrets Broker over MCP. Use this skill whenever a task needs a secret, token, password, database URL or API key. Never ask the user for the secret itself; use MCP with OAuth 2.1 (or an agent Bearer token) and let the broker handle approval.
---

# Secrets Broker

Use the self-hosted **Secrets Broker** as the only source of credentials. Do not
ask the user to paste secrets into the chat and do not put secrets in prompts,
logs or commit messages.

## Endpoint

```text
MCP:  https://sb.otscup.com/mcp
OAuth discovery:
  https://sb.otscup.com/.well-known/oauth-protected-resource
  https://sb.otscup.com/.well-known/oauth-authorization-server
```

The broker supports:

- **OAuth 2.1** (preferred): dynamic client registration, PKCE S256, browser
  consent, then a Bearer access token. MCP clients that support remote OAuth
  should discover these endpoints automatically.
- **Static agent token**: create a dedicated Agent in the broker UI
  (Agents → create) and configure `Authorization: Bearer <token>` for clients
  that do not support OAuth.

OAuth access is bound to the vault account that was active when the token was
issued. Do not try to use an agent token against a different vault account.

## Tools

- `list_secrets` — list item names/URLs only; no values.
- `request_access` — request approval for one item by name. May return an
  approval URL.
- `get_secret` — return the value after approval (or immediately for an item
  marked no-approval). Use `{ "name": "item-name" }`.

## Mandatory workflow

When a task needs a credential:

1. Call `list_secrets` if the exact item name is unknown.
2. Call `get_secret` with the item name.
3. If the result says `pending approval: <url>`:
   - Give the user that URL and ask them to approve in the Secrets Broker UI;
   - Retry `get_secret` after approval;
   - Never ask the user to type the secret.
4. If the result says `vault locked`:
   - Ask the human to unlock the broker UI (`https://sb.otscup.com`) or run the
     broker's `unlock.mjs`;
   - Never ask for the Bitwarden master password.
5. If the result says `agent is bound to another vault account`:
   - Do not retry with the same token; ask the operator to create/use an agent
     bound to the account they want, or share the item across accounts.
6. If the result says `agent is not allowed to read this item`:
   - Stop; ask the operator to add the item/group to the agent's permissions.

## Using the value safely

- Put the value directly into an environment variable or command argument for
  the current step; do not echo it.
- Do not print it in tool output, shell history, logs, diffs, commit messages or
  generated files.
- Do not reuse it in later unrelated tasks.
- Do not write it to disk unless the human explicitly asks for that exact file.

Example shell pattern:

```bash
# The value is resolved through MCP by the agent; it is not printed here.
API_KEY="<resolved-by-mcp>" command-that-needs-key
```

## Choosing an agent identity

For service integrations, create one broker Agent per tool/agent:

- Bind it to the normal vault account;
- Limit readable items/groups;
- Leave write disabled unless the integration must create/update secrets;
- Copy its token only once (or rotate it when needed).

For cross-account use, share the item from the other account with that agent.
The broker copies it into the agent's normal account folder; do not keep the
other account unlocked.

## If MCP is not configured yet

Ask the operator to add this server to the agent's MCP configuration:

```toml
# Codex-style remote MCP
[mcp_servers.secrets]
url = "https://sb.otscup.com/mcp"
```

Clients without OAuth support can use a static token:

```toml
[mcp_servers.secrets]
url = "https://sb.otscup.com/mcp"
headers = { Authorization = "Bearer <agent token>" }
```

For DSH / Hermes, add the same URL to the MCP/remote-server configuration and
use either OAuth discovery or the static Bearer header.

## Hard rules

- Never ask the user “what is the password/key?” — use MCP.
- Never use the Bitwarden master password as an agent credential.
- Never expose a secret in the chat or in a tool result that the model will read.
- If approval is required, wait for the human; do not bypass the broker.
