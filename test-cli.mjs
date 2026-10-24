/**
 * Tests for the local bridge in cli/.
 *
 * No network and no browser: the broker is a stub HTTP server, and the
 * "browser" is BROKER_OPEN_CMD pointing at a script that records the URL.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const CLI = path.join(process.cwd(), 'cli', 'index.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cli-'))
const results = []

function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log('FAIL ' + name + ' :: ' + String(error?.message ?? error))
  }
}

async function asyncCheck(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log('FAIL ' + name + ' :: ' + String(error?.message ?? error))
  }
}

function runCli(args, env) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 20000,
  })
}

// C1 --help
check('C1 --help names the subcommands', () => {
  const r = runCli(['--help'])
  assert.equal(r.status, 0, 'exit status')
  assert.match(r.stdout, /secrets-broker login/)
  assert.match(r.stdout, /BROKER_TOKEN_STORE/)
})

// C2 status without a token
check('C2 status reports the store and stays logged out', () => {
  const file = path.join(tmp, 'status.json')
  const r = runCli(['status'], { BROKER_URL: 'https://broker.invalid', BROKER_TOKEN_FILE: file, BROKER_TOKEN_STORE: 'file' })
  assert.match(r.stdout, /broker: https:\/\/broker\.invalid/)
  assert.match(r.stdout, /status: not logged in/)
  assert.equal(r.status, 1, 'exit status is 1 when not logged in')
})

// C3 only signed approval links are picked up
await asyncCheck('C3 approvalUrls keeps signed links only', async () => {
  const { approvalUrls } = await import('./cli/approval.mjs')
  const signed = 'https://sb.otscup.com/approve?id=p_1&d=once&exp=1700000000000&sig=abc123'
  const text = `pending approval: ${signed}\nalso https://example.com/login and https://sb.otscup.com/approve?id=x (no signature)`
  const urls = approvalUrls(text)
  assert.deepEqual(urls, [signed])
  assert.deepEqual(approvalUrls(`${signed} ${signed}`), [signed], 'deduplicated')
  assert.deepEqual(approvalUrls(''), [])
  assert.deepEqual(approvalUrls(undefined), [])
})

// C4 the token cache round-trips and stays private
await asyncCheck('C4 token cache round-trip', async () => {
  const file = path.join(tmp, 'record.json')
  process.env.BROKER_TOKEN_FILE = file
  process.env.BROKER_TOKEN_STORE = 'file'
  delete process.env.BROKER_TOKEN
  const store = await import('./cli/store.mjs')
  store.saveToken('tok-live-1', 3600, 'https://broker.invalid')
  assert.equal(store.loadToken(), 'tok-live-1')
  if (process.platform !== 'win32') {
    const mode = fs.statSync(file).mode & 0o777
    assert.equal(mode, 0o600, 'token file must not be readable by others')
  }
  store.saveRecord({ access_token: 'tok-old', expiresAt: Date.now() - 1000 })
  assert.equal(store.loadToken(), '', 'expired token is not returned')
  store.clearRecord()
  assert.equal(fs.existsSync(file), false, 'logout removes the file')
})

// C5 the stdio bridge forwards JSON-RPC and keeps the client's ids
await asyncCheck('C5 bridge forwards initialize and tools/list', async () => {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const message = JSON.parse(body)
      seen.push({ auth: req.headers.authorization, method: message.method })
      const result =
        message.method === 'tools/list'
          ? { tools: [{ name: 'request_fill' }, { name: 'get_secret' }] }
          : { serverInfo: { name: 'stub' }, protocolVersion: '2025-06-18' }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`

  const child = spawn(process.execPath, [CLI], {
    env: { ...process.env, BROKER_URL: url, BROKER_TOKEN: 'static-1', BROKER_NO_BROWSER: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (chunk) => (out += chunk))
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize', params: {} }) + '\n')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} }) + '\n')
  child.stdin.end()

  await new Promise((resolve) => child.on('exit', resolve))
  server.close()

  const lines = out.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines.length, 2, 'one response per request: ' + out)
  assert.equal(lines[0].id, 7)
  assert.equal(lines[0].result.serverInfo.name, 'stub')
  assert.equal(lines[1].id, 8)
  assert.deepEqual(lines[1].result.tools.map((tool) => tool.name), ['request_fill', 'get_secret'])
  assert.deepEqual(seen.map((entry) => entry.auth), ['Bearer static-1', 'Bearer static-1'])
})

// C6 a pending approval opens the human's browser
await asyncCheck('C6 approval link is handed to the opener', async () => {
  const recordFile = path.join(tmp, 'opened.txt')
  const openerFile = path.join(tmp, 'opener.mjs')
  fs.writeFileSync(openerFile, `import fs from 'node:fs'\nfs.appendFileSync(${JSON.stringify(recordFile)}, process.argv[2] + '\\n')\n`)

  const signed = 'http://127.0.0.1:1/approve?id=p_9&d=24h&exp=1700000000000&sig=deadbeef'
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 9,
          result: { content: [{ type: 'text', text: 'pending approval: ' + signed }] },
        }),
      )
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  const child = spawn(process.execPath, [CLI], {
    env: {
      ...process.env,
      BROKER_URL: `http://127.0.0.1:${server.address().port}`,
      BROKER_TOKEN: 'static-1',
      BROKER_OPEN_CMD: process.execPath,
      BROKER_OPEN_ARGS: openerFile,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_secret', arguments: { name: 'x' } } }) + '\n')
  child.stdin.end()
  await new Promise((resolve) => child.on('exit', resolve))
  server.close()

  const opened = await (async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (fs.existsSync(recordFile)) return fs.readFileSync(recordFile, 'utf8').trim()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return ''
  })()
  assert.equal(opened, signed, 'opener should receive the signed approval URL')
})

fs.rmSync(tmp, { recursive: true, force: true })
const failed = results.filter((entry) => !entry.ok)
console.log(`==== cli bridge ${results.length - failed.length}/${results.length} passed ====`)
process.exit(failed.length ? 1 : 0)
