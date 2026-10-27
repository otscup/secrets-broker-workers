# Desktop M2: pairing handoff and local sidecar

Release: `0.2.3` (`Secrets Broker_0.2.3_x64_en-US.msi`)

- `secrets-broker pair --url <broker>` opens `secrets-broker://pair?...`; the
  desktop app receives it, shows its window, and opens the normal approval page.
  The HTTP URL is still printed as a fallback.
- The desktop starts the sidecar only after `device.json` exists, and stops it
  when that file disappears. Revoking a device deletes `device.json`,
  `device-key.dpapi`, and the local ciphertext cache on the next 401.
- The packaged app now prefers its own `resources/sidecar` over the developer
  checkout, so an installed build cannot accidentally run the source tree.
- DPAPI temp files fall back to `BROKER_HOME/tmp` when the system temp directory
  is not writable.

Verification:

- `npm run test:security:short` — ALL SUITES PASSED.
- `cargo test --lib` — 5/5.
- Installed app with a mocked paired device: `/healthz` returned
  `{\"ok\":true,\"items\":0,\"revision\":1,\"stale\":false}`.
- Mock revocation returned 401; `device.json`, `device-key.dpapi`, and `vault.db`
  were removed, and the sidecar process stopped.

Known limits: the Windows Hello gate (M3), HUD/fill (M4), and signing/updater
(M5) are not in this build. The app is still a shell around the existing console
UI; the M2 check here is the tray/sidecar lifecycle, not a native vault UI.
