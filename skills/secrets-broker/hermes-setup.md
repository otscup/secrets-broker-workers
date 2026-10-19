# Secrets Broker — Hermes / generic agent setup

1. Import `SKILL.md` as an instruction/skill.
2. Add a remote MCP server:
   - URL: `https://sb.otscup.com/mcp`
   - Auth: OAuth 2.1 discovery if supported; otherwise
     `Authorization: Bearer <agent token>`.
3. Create a dedicated agent in the broker UI and bind it to the normal vault
   account.
4. Do not ask the human for secret values or the Bitwarden master password.

Expected MCP tools:

- `list_secrets`
- `request_access`
- `get_secret`

If a tool returns `pending approval: <url>`, send that URL to the human and retry
after approval. If it returns `vault locked`, ask the human to unlock the broker;
do not ask for the master password.
