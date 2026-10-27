# Secrets Broker desktop

M0 of `docs/tauri-desktop-plan.md`: a Tauri v2 window that opens the existing
console HTML offline. The window does not yet start a sidecar; pairing, tray and
Windows Hello are M1+.

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
