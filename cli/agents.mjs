/**
 * Finding the agents that are already on this machine.
 *
 * Two jobs, both boring on purpose:
 *
 *   detect   read-only. Look for the config files the agents actually use, and
 *            say whether each one already knows about this broker.
 *   connect  write the smallest possible change: one entry that tells the agent
 *            to run the local bridge. Never a token, never a secret, always a
 *            backup, and nothing happens without --apply.
 *
 * The adapter list is the product here, not the code. Every entry is a path and
 * a shape; adding a new agent should be one object, not a new branch somewhere.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MARKER_START = '# >>> secrets-broker'
export const MARKER_END = '# <<< secrets-broker'
export const ENTRY_NAME = 'secrets-broker'
export const LOCAL_ENTRY_NAME = 'secrets-broker-local'
export const LOCAL_URL = 'http://127.0.0.1:4319/mcp'
// What the written entry actually runs. The package is still `private`, so
// `npx -y <name>` answers 404 and an agent pointed at it would fail to start --
// which is exactly what the first user of `agents connect --apply` hit. Point
// the entry at this checkout's own entry point instead: it exists on the machine
// running the command, so it runs with no publish step.
export const CLI_ENTRY = fileURLToPath(new URL('./index.mjs', import.meta.url))

const isJson = (kind) => kind === 'json'

// Real paths, so the printed table can be pasted into a file manager.
const join = (...parts) => path.join(...parts.filter(Boolean))

/**
 * Strip // and slash-star comments plus trailing commas.
 *
 * VS Code's mcp.json and several others are written in JSONC, and a strict
 * JSON.parse makes them look unconfigured — the most expensive kind of wrong
 * answer here, because it invites a second entry.
 */
export function parseLoose(text) {
  let out = ''
  let inString = false
  let quote = ''
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) inString = false
      continue
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; out += ch; continue }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 1
      continue
    }
    out += ch
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'))
}

export function hasComment(text) {
  return /(^|[^:])\/\//.test(text) || /\/\*/.test(text)
}

/** Every place worth looking, with the shape of what lives there. */
export function adapters({
  home = os.homedir(),
  appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  dshHome = process.env.DSH_HOME || join(home, '.dsh'),
  dshProfile = process.env.DSH_PROFILE || 'desktop',
} = {}) {
  const has = (file) => Boolean(file && fs.existsSync(file))
  return [
    {
      id: 'codex',
      name: 'Codex CLI',
      kind: 'toml',
      file: join(home, '.codex', 'config.toml'),
      table: 'mcp_servers',
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      kind: 'json',
      file: process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : join(appData, 'Claude', 'claude_desktop_config.json'),
      key: 'mcpServers',
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      kind: 'json',
      file: join(home, '.claude.json'),
      key: 'mcpServers',
    },
    {
      id: 'vscode',
      name: 'VS Code',
      kind: 'json',
      file: process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
        : join(appData, 'Code', 'User', 'mcp.json'),
      key: 'servers',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      kind: 'json',
      file: process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Cursor', 'User', 'mcp.json')
        : join(appData, 'Cursor', 'User', 'mcp.json'),
      key: 'mcpServers',
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      kind: 'json',
      file: process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Windsurf', 'User', 'mcp.json')
        : join(appData, 'Windsurf', 'User', 'mcp.json'),
      key: 'mcpServers',
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      kind: 'json',
      file: join(home, '.gemini', 'settings.json'),
      key: 'mcpServers',
    },
    {
      id: 'pi',
      name: 'Pi Agent',
      kind: 'json',
      file: join(home, '.pi', 'agent', 'mcp.json'),
      key: 'mcpServers',
    },
    {
      id: 'dsh',
      name: 'DeepSeek Harness',
      kind: 'dsh',
      file: join(dshHome, 'profiles', dshProfile, 'cordis.patch.yml'),
    },
  ].map((adapter) => ({ ...adapter, exists: has(adapter.file), looksLike: has(adapter.file) }))
}

/** Does this agent already point at a broker? Cheap textual test, no parsing. */
export function mentionsBroker(text) {
  return /secrets-broker|sb\.otscup\.com|\/mcp\b/.test(String(text ?? ''))
}

function findJsonEntry(parsed, key) {
  const block = parsed && typeof parsed === 'object' ? parsed[key] : null
  if (!block || typeof block !== 'object') return null
  for (const [name, value] of Object.entries(block)) {
    if (name === ENTRY_NAME) return { name, value }
    const blob = JSON.stringify(value ?? {})
    if (/secrets-broker|\/mcp"?/.test(blob)) return { name, value }
  }
  return null
}

function findTomlEntry(text, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('^\\s*\\[' + escaped + '\\.([A-Za-z0-9_.-]+)\\]', 'gm')
  let match
  while ((match = re.exec(text))) {
    const name = match[1]
    const start = match.index
    const nextHeader = text.slice(start + match[0].length).search(/^\s*\[/m)
    const block = nextHeader < 0 ? text.slice(start) : text.slice(start, start + match[0].length + nextHeader)
    if (name === ENTRY_NAME || /secrets-broker|\/mcp\b/.test(block)) return { name, block }
  }
  return null
}

/** Read one adapter and report what is on disk. Never writes. */
export function inspect(adapter) {
  const report = {
    id: adapter.id,
    name: adapter.name,
    kind: adapter.kind,
    file: adapter.file,
    present: false,
    configured: false,
    entry: null,
    error: '',
  }
  if (!adapter.exists) return report
  report.present = true
  let text = ''
  try {
    text = fs.readFileSync(adapter.file, 'utf8')
  } catch (error) {
    report.error = error.message
    return report
  }
  if (!text.trim()) return report
  if (adapter.kind === 'dsh') {
    const found = new RegExp('^\\s*serverName:\\s*' + LOCAL_ENTRY_NAME + '\\s*$', 'm').test(text)
    report.configured = found
    report.entry = found ? LOCAL_ENTRY_NAME : null
    return report
  }
  try {
    if (isJson(adapter.kind)) {
      const parsed = parseLoose(text)
      const found = findJsonEntry(parsed, adapter.key)
      report.configured = Boolean(found)
      report.entry = found ? found.name : null
    } else {
      const found = findTomlEntry(text, adapter.table)
      report.configured = Boolean(found)
      report.entry = found ? found.name : null
    }
  } catch (error) {
    // Unparsable is not "not configured": say so instead of offering to add a
    // second entry to a file we cannot read.
    report.error = 'parse: ' + error.message
    report.configured = mentionsBroker(text)
    report.entry = report.configured ? '?' : null
  }
  return report
}

export function detect(options = {}) {
  return adapters(options).map(inspect)
}

/** The exact object an agent needs. No token: the bridge does its own login. */
export function entryFor(brokerUrl) {
  return {
    command: process.execPath,
    args: [CLI_ENTRY],
    env: { BROKER_URL: brokerUrl },
  }
}

/** The desktop sidecar speaks HTTP MCP on loopback; no token to hand out. */
export function localEntryFor() {
  return { url: LOCAL_URL }
}

export function tomlBlock(brokerUrl) {
  return [
    MARKER_START,
    '[mcp_servers.' + ENTRY_NAME + ']',
    'command = ' + JSON.stringify(process.execPath),
    'args = [' + JSON.stringify(CLI_ENTRY) + ']',
    '',
    '[mcp_servers.' + ENTRY_NAME + '.env]',
    'BROKER_URL = "' + brokerUrl + '"',
    MARKER_END,
    '',
  ].join('\n')
}

export function tomlLocalBlock() {
  return [
    '# >>> secrets-broker-local',
    '[mcp_servers.' + LOCAL_ENTRY_NAME + ']',
    'url = "' + LOCAL_URL + '"',
    '# <<< secrets-broker-local',
    '',
  ].join('\n')
}

/** DSH composes its MCP servers from cordis.patch.yml, not a JSON config. */
export function dshLocalBlock() {
  return [
    '# >>> secrets-broker-local',
    '- insert:',
    '    - id: secrets-broker-local',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: ' + LOCAL_ENTRY_NAME,
    '        transport: streamable-http',
    '        url: "' + LOCAL_URL + '"',
    '# <<< secrets-broker-local',
    '',
  ].join('\n')
}

/**
 * Add the entry to a JSON document by text, not by re-serialising.
 *
 * Re-serialising loses comments and key order, which is the difference between
 * "the agent still starts" and a support ticket. So: find the servers object,
 * and splice one member in right after its opening brace.
 */
function jsonWithEntry(text, key, name, entry) {
  const needle = new RegExp('"' + key + '"\\s*:\\s*\\{')
  const match = needle.exec(text)
  if (!match) {
    // No block yet ("{}" or a config that never had one): open it at the root,
    // right after the first brace, and leave everything else where it was.
    const root = text.indexOf('{')
    if (root < 0) return null
    const body = JSON.stringify(entry, null, 2).split('\n').join('\n    ')
    const rest = text.slice(root + 1).replace(/^\s+/, '')
    const separator = rest.startsWith('}') ? '' : ',\n'
    return text.slice(0, root + 1) + '\n  "' + key + '": {\n    "' + name + '": ' + body + '\n  }' + separator + (rest.startsWith('}') ? '\n' : '') + rest
  }
  const open = match.index + match[0].length - 1
  const after = text.slice(open + 1)
  const indentMatch = /\n([ \t]+)"/.exec(after)
  const indent = indentMatch ? indentMatch[1] : '    '
  const body = JSON.stringify(entry, null, 2).split('\n').join('\n' + indent)
  // "mcpServers": {} is legal and common; a comma after the only member is not,
  // and Claude Desktop parses this file strictly, so it would stop starting.
  const empty = after.replace(/^\s+/, '').startsWith('}')
  const separator = (empty ? '' : ',') + (empty ? '\n' + indent.slice(0, Math.max(0, indent.length - 2)) : '')
  return text.slice(0, open + 1) + '\n' + indent + '"' + name + '": ' + body + separator + after
}

/** Build the change without touching disk. Returns null when nothing to do. */
export function plan(adapter, brokerUrl) {
  const report = inspect(adapter)
  if (!report.present) return { ...report, action: 'skip', reason: 'file not found', content: '' }
  if (adapter.kind === 'dsh') return { ...report, action: 'skip', reason: 'local entry only; use --local', content: '' }
  if (report.configured) return { ...report, action: 'skip', reason: 'already configured', content: '' }
  if (report.error) return { ...report, action: 'skip', reason: report.error, content: '' }
  const text = fs.readFileSync(adapter.file, 'utf8')
  const original = text.trim() ? text : ''
  if (isJson(adapter.kind)) {
    const entry = entryFor(brokerUrl)
    if (!original) {
      const content = JSON.stringify({ [adapter.key]: { [ENTRY_NAME]: entry } }, null, 2) + '\n'
      return { ...report, action: 'create', content }
    }
    const updated = jsonWithEntry(original, adapter.key, ENTRY_NAME, entry)
    if (!updated) return { ...report, action: 'skip', reason: 'no "' + adapter.key + '" block to add to', content: '' }
    return { ...report, action: 'update', content: updated }
  }
  const block = tomlBlock(brokerUrl)
  const content = original ? original.replace(/\s*$/, '\n\n') + block : block
  return { ...report, action: original ? 'update' : 'create', content }
}

/**
 * Add a second, explicitly local entry without disturbing an existing remote
 * one. Clients that already know a broker get both; switching is the user's job.
 */
export function planLocal(adapter) {
  const report = inspect(adapter)
  if (!report.present) return { ...report, action: 'skip', reason: 'file not found', content: '' }
  if (report.error) return { ...report, action: 'skip', reason: report.error, content: '' }
  const text = fs.readFileSync(adapter.file, 'utf8')
  if (adapter.kind === 'dsh') {
    if (report.configured) return { ...report, action: 'skip', reason: 'already configured', content: '' }
    const block = dshLocalBlock()
    const content = text.trim() === '[]' ? block : text.replace(/\s*$/, '\n\n') + block
    return { ...report, action: text.trim() ? 'update' : 'create', content }
  }
  if (isJson(adapter.kind)) {
    let parsed
    try {
      parsed = parseLoose(text.trim() ? text : '{}')
    } catch (error) {
      return { ...report, action: 'skip', reason: 'parse: ' + error.message, content: '' }
    }
    if (parsed?.[adapter.key]?.[LOCAL_ENTRY_NAME]) {
      return { ...report, configured: true, action: 'skip', reason: 'already configured', content: '' }
    }
    const entry = localEntryFor()
    if (!text.trim()) {
      return { ...report, action: 'create', content: JSON.stringify({ [adapter.key]: { [LOCAL_ENTRY_NAME]: entry } }, null, 2) + '\n' }
    }
    const updated = jsonWithEntry(text, adapter.key, LOCAL_ENTRY_NAME, entry)
    if (!updated) return { ...report, action: 'skip', reason: 'no "' + adapter.key + '" block to add to', content: '' }
    return { ...report, action: 'update', content: updated }
  }
  if (new RegExp('^\\s*\\[' + adapter.table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.' + LOCAL_ENTRY_NAME + '\\]', 'm').test(text)) {
    return { ...report, configured: true, action: 'skip', reason: 'already configured', content: '' }
  }
  const block = tomlLocalBlock()
  const content = text.trim() ? text.replace(/\s*$/, '\n\n') + block : block
  return { ...report, action: text.trim() ? 'update' : 'create', content }
}

export function applyPlan(planResult) {
  if (!planResult || (planResult.action !== 'create' && planResult.action !== 'update')) return planResult
  const file = planResult.file
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.secrets-broker.bak')
  const tmp = file + '.secrets-broker.tmp'
  fs.writeFileSync(tmp, planResult.content, 'utf8')
  fs.renameSync(tmp, file)
  return planResult
}
