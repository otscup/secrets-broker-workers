# Secrets Broker desktop

M1 of `docs/tauri-desktop-plan.md`: a Tauri v2 window that opens the existing
console HTML offline, starts the local sidecar, and keeps running in the tray.
Closing the window hides it; the tray menu shows the daemon status and can quit.
Pairing, offline vault and Windows Hello are M2+.

The sidecar uses the CLI's existing token store. Without a paired device token it
exits immediately, so the app stays usable offline but the tray reports
`未连接`; run `secrets-broker pair` online first.

## Build requirements

- Windows 10/11 with WebView2 Runtime
- Rust stable MSVC toolchain
- Visual Studio Build Tools with the C++ workload (linker + Windows SDK)

This machine currently uses a local Rust install:

```
CARGO_HOME=E:\DeepSeek workers\_toolchain\cargo
RUSTUP_HOME=E:\DeepSeek workers\_toolchain\rustup
```

## Commands

From the repo root:

```
npm run desktop:ui      # write desktop/ui from src/ui.js + assets
npm run desktop:dev     # Tauri dev window
npm run desktop:build   # MSI under desktop/src-tauri/target/release/bundle/msi
```

`desktop/ui` is generated and gitignored.
