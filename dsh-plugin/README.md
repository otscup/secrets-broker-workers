# DSH Secrets Broker plugin

Adds a **密钥授权 (Secrets Broker)** section to the DSH Web settings UI.

It lists pending approvals from the broker and lets you approve **once / 24h /
forever** or deny directly from DSH, without switching to the broker tab.

## How it works

- Host half (`lib/index.js`) exposes two same-origin routes:
  - `GET /api/secrets-broker/pending`
  - `POST /api/secrets-broker/decide`
- The host calls the broker using the `x-broker-plugin-token` header.
- The plugin token is read from:
  - `SECRETS_BROKER_PLUGIN_TOKEN`, or
  - `$DSH_HOME/secrets-broker/dsh-plugin-token.txt`, or
  - `~/secrets-broker/dsh-plugin-token.txt`, or
  - `E:\dsh-home\secrets-broker\dsh-plugin-token.txt`.
- The broker verifies the same token as the `DSH_PLUGIN_TOKEN` Worker secret.

## Install (local profile)

1. Put the plugin package in the DSH profile `node_modules`, or add its path to
   `dsh.profile.bundles`.
2. Add `dsh-secrets-broker` to `dsh.profile.bundles`.
3. Restart DSH Web.
4. Set the broker Worker secret:

```bash
wrangler secret put DSH_PLUGIN_TOKEN
```

and put the same token in the plugin token file.

## What it does not do

DSH's plugin API can approve/deny, but it does **not** automatically resume an
agent turn that has already ended. For auto-resume, the agent client needs a
session callback/plugin hook. This plugin removes the manual tab switch and
surfaces pending approvals inside DSH.
