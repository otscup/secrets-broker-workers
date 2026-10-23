# Browser extension (no Docker)

The extension is the same fill executor as the container, hosted by the browser
you already use. Nothing else to install: no Docker, no second machine, no
Playwright download. It runs only while that browser runs.

Use it when you want to fill logins on sites **you** can reach from your own
machine — which includes a homelab console on `192.168.x.x` that a cloud Worker
can never reach.

## Install (Chrome / Edge, unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → select this `extension/` directory.
3. The extension's **设置** page opens; fill it in (next section).

Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on** →
pick `extension/manifest.json`. Firefox drops unpacked add-ons on restart unless
you sign them; the Chromium path is the smoother one.

## Configure

You need an executor id and secret. In the broker console, while logged in and
with the vault unlocked, register one:

```bash
curl -X POST https://sb.example.com/api/fill/executors/register \
  -b cookies.txt -H 'content-type: application/json' \
  -d '{"executorId":"browser"}'
# -> {"ok":true,"executorId":"browser","secret":"..."}
```

Put the broker URL, `browser`, and the secret into the extension's settings and
press **测试连接**. It should say "连接正常，当前没有待填任务".

## Make a credential fillable

In the console, on the **密钥** page:

1. open the item's ⋮ menu and set its type to **web**;
2. list the origins it may be filled into, e.g. `https://nas.lan:5001`;
3. on the **Agents** page, grant that Agent the item and the `secret.fill` action.

Then an Agent calling `secret.fill` produces a task, and the extension fills it.

## What happens

```
Agent ──secret.fill──▶ Worker   (policy, approval, vault unlock)
                       └─ one-shot task + task credential
Extension ──claim──▶ Worker     (alarm, every ~6s)
Extension ◀──taskId, origin, credential
Extension ──redeem─▶ Worker
Extension ◀──username, password, totp   (this task only)
Extension: open a tab at the exact origin
Extension: fill the form, submit
Extension ──report──▶ Worker    (completed / failed)
Extension: leave the tab for you, keep nothing
```

The Agent receives a status, never the value.

## What it refuses, on purpose

- **A different origin.** The tab's final URL is checked before filling, after
  submitting, and on any navigation. Mismatch fails the task.
- **TOTP.** A 30-second code cannot be carried across an unknown login page, and
  guessing which field takes it is how a login gets submitted with the code in
  the password box. The task reports `filled-without-totp`.
- **A captcha.** It reports `captcha` and stops.
- **Storing the value.** The credential lives in a local variable for one task.
  Nothing is written to `chrome.storage`, and no log line contains it.

## Difference from the Bitwarden extension

| | Bitwarden | This |
|---|---|---|
| who triggers | you click | an Agent asks |
| vault access | your master password | executor secret + broker session |
| runs when | browser open | browser open **and** 启用左开 |
| filling | the tab you are on | a tab it opens, at the authorised origin |

It is closer to a service account than to a password manager: unattended, and
triggered by software. Pause it from the toolbar popup whenever you do not want
it to accept work.

## Limits worth knowing

- Chromium limits an unpacked extension's background worker; the poll uses
  `chrome.alarms` at ~6s, so a task may wait a few seconds. That is the design,
  not a bug.
- The extension cannot fill a site that needs a captcha or a second page you have
  to navigate yourself. Those report failed, honestly.
- It talks to the broker over CORS, so the broker must be reachable from your
  browser and the extension's credentials must be valid. Only `/api/fill/task*`
  answers CORS; every admin route stays same-origin on purpose.
