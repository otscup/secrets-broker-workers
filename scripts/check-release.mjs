import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(process.argv[2] || process.cwd())
const read = (base, file) => fs.readFileSync(path.join(base, file), 'utf8')
const json = (base, file) => JSON.parse(read(base, file))
export function checkRelease(base = process.cwd()) {
  const tauri = json(base, 'desktop/src-tauri/tauri.conf.json')
  const cargo = read(base, 'desktop/src-tauri/Cargo.toml')
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  if (!tauri.version || !cargoVersion || tauri.version !== cargoVersion) {
    throw new Error(`desktop version mismatch: tauri=${tauri.version || '?'} cargo=${cargoVersion || '?'}`)
  }
  const msiDir = path.join(base, 'desktop/src-tauri/target/release/bundle/msi')
  const expected = `Secrets Broker_${tauri.version}_x64_en-US.msi`
  const msi = path.join(msiDir, expected)
  if (!fs.existsSync(msi)) throw new Error(`missing MSI for ${tauri.version}: ${msi}`)
  const exe = path.join(base, 'desktop/src-tauri/target/release/secrets-broker-desktop.exe')
  if (!fs.existsSync(exe)) throw new Error(`missing desktop executable: ${exe}`)
  return { version: tauri.version, msi, exe }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = checkRelease(root)
    console.log(`release ok: ${result.version}`)
    console.log(`msi: ${result.msi}`)
    console.log(`exe: ${result.exe}`)
  } catch (error) {
    console.error(`[release] ${error.message}`)
    process.exitCode = 1
  }
}
