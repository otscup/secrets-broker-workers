# Tauri desktop client plan

Status: plan only; no Rust toolchain on the current machine. The web app and the
CLI remain the supported clients until this plan ships.

## Goal

A small Windows tray app that uses the existing broker without adding a second
source of truth:

- shows whether the vault is locked, unlocked, or stale;
- unlocks with Windows Hello when the local copy is already paired;
- fills a login or copies a value without opening the full web console;
- can start the existing local daemon so agents keep working when the browser is
  closed.

Non-goals: a second vault database, a mobile client, a new server API, or
plaintext at rest. The desktop app reads the same D1 vault through the same
device token and the same envelope format.

## Shape

```
Tauri shell (Rust, WebView2)
  ├─ UI: existing static console, served from the app bundle
  ├─ sidecar: secrets-broker up --port 4319   (existing CLI)
  ├─ local vault: %APPDATA%\secrets-broker\vault.db + DPAPI-wrapped key
  └─ OS: tray, global shortcut, Windows Hello, autostart
```

The sidecar is the existing `secrets-broker` binary, not a reimplementation of
pull/decrypt. That keeps one envelope implementation and one set of tests. The
shell only owns lifecycle, the tray/HUD, and the Windows Hello gate.

The UI is the existing `src/ui.js` page served locally. It talks to the sidecar
on `127.0.0.1` and to the Worker for pairing/OIDC. No new remote endpoints.

## Milestones

| Milestone | Deliverable | Acceptance |
|---|---|---|
| M0 | Tauri v2 shell, WebView2, build pipeline | `cargo tauri build` produces an MSI; app opens the bundled UI offline |
| M1 | Sidecar lifecycle + tray | closing the window keeps the daemon; tray shows locked/unlocked/stale; one-click quit stops it |
| M2 | Pairing and device token | `secrets-broker pair` deep link opens the app; device appears in 电脑 tab; revoke removes local copy |
| M3 | Windows Hello unlock | after one password unlock, Hello unlocks the DPAPI key; failed/cancelled Hello never falls back to plaintext |
| M4 | HUD and fill | global shortcut opens a search box; selecting a web item sends a fill task to the existing executor; value never enters the HUD |
| M5 | Update and signing | signed MSI, updater checks the Worker-hosted manifest, rollback path documented |

M0–M2 are one shippable slice. M3 is the security-sensitive slice; do not ship
M4 before M3.

## Windows Hello

Use the WinRT `UserConsentVerifier` API through the `windows` crate, not a
Tauri biometric plugin (the maintained plugins target mobile). The command:

1. verifies the user is present with `UserConsentVerifier::RequestVerificationAsync`;
2. on `Verified`, unprotects the DPAPI-wrapped vault key;
3. passes the key to the sidecar over stdin or a one-shot local socket;
4. never writes the key to disk or logs.

The Hello prompt is a gate, not a second factor: the device token still has to be
valid and the server-side vault still has to be unlocked for remote reads. A
cancelled prompt returns locked.

## Security constraints

- Bind the sidecar to `127.0.0.1`; keep the existing `Origin`/`Host` refusal and
  add a per-launch random token between shell and sidecar.
- Do not put the master password, device token, or DEK in WebView localStorage.
- Keep the CLI's DPAPI store as the only key store; the Tauri shell must not add a
  second credential store.
- Deep links only carry a pairing code, never a token or password.
- Treat the MSI signing key as a release secret; an unsigned build is dev-only.

## Risks

- **No Rust toolchain here.** A developer machine with Rust, WebView2 and the
  Windows SDK is required before M0 can be estimated honestly.
- **Windows Hello API drift.** `UserConsentVerifier` needs a fallback message when
  the device has no PIN/Hello configured; it must not block password unlock.
- **Sidecar version skew.** The shell and CLI must be released together; pin the
  sidecar hash in the app manifest.
- **Code signing.** Without an Authenticode certificate, SmartScreen will warn;
  do not call the build production-ready until signed.
- **Two UIs.** Serving the existing page locally is deliberate; a native rewrite
  would duplicate every permission/approval screen.

## Test plan

- Rust unit tests for Hello result mapping, sidecar handshake, and tray state.
- Reuse the existing CLI/v2 suites against the sidecar binary.
- Tauri WebDriver smoke: launch, pair, lock, Hello cancel, quit.
- Manual: revoke the device while the app is open; the next pull must fail closed.
- Manual: pull once, disconnect the network, restart; the app shows the copy's
  age and marks it stale.

## Open decisions

1. Bundle the Node sidecar, or ship a signed single-file `secrets-broker.exe`?
   Bundling Node is larger but keeps one runtime; a single-file build needs the
   same `pull`/`guard` tests rerun.
2. Should the HUD support only `web` fill, or also copy an API key to the
   clipboard with a clear timer? Clipboard history makes the second option risky.
3. Is the tray app allowed to keep the vault unlocked after the Windows session
   locks? Default answer: no; clear the in-memory key on session lock.
