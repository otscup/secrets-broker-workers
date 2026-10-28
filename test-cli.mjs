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
  assert.match(r.stdout, /broker login: not logged in/)
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

// C8 materialised credentials are written create-only, 0600
const NL = String.fromCharCode(10)
await asyncCheck('C8 write secrets without replacing an existing key', async () => {
  const { writeSecretToFile, KeyExistsError } = await import('./cli/write.mjs')
  const dir = fs.mkdtempSync(path.join(tmp, 'mat-'))
  const target = path.join(dir, 'app.env')

  const first = writeSecretToFile({ path: target, key: 'OPENAI_API_KEY', value: 'sk-live-1' })
  assert.equal(first.created, true)
  assert.equal(fs.readFileSync(target, 'utf8'), 'OPENAI_API_KEY=sk-live-1' + NL)
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600, 'file is 0600')

  const second = writeSecretToFile({ path: target, key: 'OTHER_KEY', value: 'plain' })
  assert.equal(second.created, false)
  assert.equal(fs.readFileSync(target, 'utf8'), 'OPENAI_API_KEY=sk-live-1' + NL + 'OTHER_KEY=plain' + NL)

  let refused = false
  try {
    writeSecretToFile({ path: target, key: 'OPENAI_API_KEY', value: 'sk-live-2' })
  } catch (error) {
    refused = error instanceof KeyExistsError
  }
  assert.ok(refused, 'an existing key is never overwritten')
  assert.ok(fs.readFileSync(target, 'utf8').includes('sk-live-1'))

  // Values that would break the file are quoted, so one line stays one line.
  const quoted = writeSecretToFile({ path: target, key: 'QUOTED', value: 'has space # and "quotes"' })
  assert.ok(quoted)
  assert.equal(fs.readFileSync(target, 'utf8').split(NL).filter(Boolean).length, 3)
})

// C7 the login flow stores a token it obtained with PKCE
await asyncCheck('C7 login completes against a stub authorization server', async () => {
  const file = path.join(tmp, 'oauth.json')
  let verifierSeen = ''
  let base = ''
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, base)
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ authorization_endpoint: base + '/oauth/authorize', token_endpoint: base + '/oauth/token' }))
      return
    }
    if (url.pathname === '/oauth/register') {
      req.resume()
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ client_id: 'mcp_stub' }))
      return
    }
    if (url.pathname === '/oauth/authorize') {
      const redirect = new URL(url.searchParams.get('redirect_uri'))
      redirect.searchParams.set('code', 'code-1')
      redirect.searchParams.set('state', url.searchParams.get('state'))
      res.writeHead(302, { location: redirect.toString() })
      res.end()
      return
    }
    if (url.pathname === '/oauth/token') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const form = new URLSearchParams(body)
        verifierSeen = form.get('code_verifier') || ''
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ access_token: 'tok-from-oauth', expires_in: 3600 }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`

  process.env.BROKER_TOKEN_FILE = file
  process.env.BROKER_TOKEN_STORE = 'file'
  delete process.env.BROKER_TOKEN
  const { login } = await import('./cli/oauth.mjs')
  const store = await import('./cli/store.mjs')

  // Stand in for the browser: follow the consent redirect back to loopback.
  const result = await login(base, {
    open: (authUrl) => {
      void (async () => {
        const authorize = await fetch(authUrl, { redirect: 'manual' })
        await fetch(new URL(authorize.headers.get('location')))
      })()
      return true
    },
  })
  server.close()

  assert.equal(result.token, 'tok-from-oauth')
  assert.equal(store.loadToken(), 'tok-from-oauth', 'token is persisted after login')
  assert.ok(verifierSeen.length > 20, 'code_verifier is sent on exchange')
})

// C9 sync --dry-run compares two brokers and writes to neither
await asyncCheck('C9 sync previews the difference and writes nothing', async () => {
  // spawnSync would block this process's event loop, and the stubs below live
  // in it, so the child's fetch would never be answered.
  const runAsync = (args, env) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
  const makeBroker = async (items) => {
    const writes = []
    const server = http.createServer((req, res) => {
      writes.push(req.method + ' ' + req.url)
      if (req.url === '/sync/pull') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, account: 'vault@example.invalid', count: items.length, items }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'nope' }))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { url: 'http://127.0.0.1:' + server.address().port, server, writes }
  }

  const row = (id, body, updatedAt, deletedAt = null) => ({
    id, type: 1, folderId: null, name: 'enc-' + body, notes: null, data: '2.iv|ct|mac-' + body, key: null,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt, deletedAt, archivedAt: null,
  })

  // same id on both sides, one newer copy, one local-only item, one remote-only
  // item, and one tombstone only the remote knows about.
  const local = await makeBroker([
    row('aaaa1111', 'shared', '2026-10-02T00:00:00.000Z'),
    row('bbbb2222', 'local-only', '2026-10-03T00:00:00.000Z'),
    row('cccc3333', 'older', '2026-10-01T00:00:00.000Z'),
    row('ffff6666', 'live-then-deleted', '2026-10-01T00:00:00.000Z'),
  ])
  const remote = await makeBroker([
    row('aaaa1111', 'shared', '2026-10-02T00:00:00.000Z'),
    row('cccc3333', 'newer', '2026-10-05T00:00:00.000Z'),
    row('dddd4444', 'remote-only', '2026-10-04T00:00:00.000Z'),
    row('eeee5555', 'tombstone-only', '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
    row('ffff6666', 'tombstone-wins', '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z'),
  ])

  try {
    const r = await runAsync(['sync', '--remote', remote.url, '--json'], { BROKER_URL: local.url, BROKER_TOKEN: 'tok' })
    assert.equal(r.status, 0, 'exit status: ' + r.stderr)
    const summary = JSON.parse(r.stdout)
    assert.equal(summary.push, 1, 'local-only goes up')
    assert.equal(summary.pull, 2, 'remote-only + remote-newer come down')
    assert.equal(summary.delete, 1, 'the newer tombstone asks to delete the local copy')
    assert.equal(summary.equal, 1, 'identical ciphertext is not a change')

    const text = await runAsync(['sync', '--remote', remote.url], { BROKER_URL: local.url, BROKER_TOKEN: 'tok' })
    assert.equal(text.status, 0, 'exit status: ' + text.stderr)
    assert.match(text.stdout, /只读预览/)
    assert.match(text.stdout, /将上传/)

    // The only requests either side saw are reads: three runs, three GETs, no
    // POST/PUT/DELETE anywhere.
    assert.ok(local.writes.length >= 2, 'both brokers were asked: ' + local.writes.length)
    assert.deepEqual([...new Set(local.writes)], ['GET /sync/pull'])
    assert.deepEqual([...new Set(remote.writes)], ['GET /sync/pull'])

    const refused = await runAsync(['sync', '--remote', remote.url, '--apply'], { BROKER_URL: local.url, BROKER_TOKEN: 'tok' })
    assert.equal(refused.status, 2, '--apply is refused while stage 1 is read-only')
    assert.match(refused.stderr, /read-only/)
  } finally {
    local.server.close()
    remote.server.close()
  }
})

// C10 a value-taking option does not become the positional argument
await asyncCheck('C10 option values are not read as positionals', async () => {
  const { positionals } = await import('./cli/index.mjs')
  assert.deepEqual(positionals(['materialize', '--path', '.env', 'my-secret']), ['materialize', 'my-secret'])
  assert.deepEqual(positionals(['--path', '.env', 'materialize', 'my-secret', '--key', 'K']), ['materialize', 'my-secret'])
  assert.deepEqual(positionals(['agents', 'connect', '--id', 'codex', '--apply']), ['agents', 'connect'])
  assert.deepEqual(positionals(['sync', '--remote', 'https://broker.invalid', '--json']), ['sync'])
  assert.deepEqual(positionals(['materialize', '-p', '.env', '-k', 'K']), ['materialize'])
})

fs.rmSync(tmp, { recursive: true, force: true })
const failed = results.filter((entry) => !entry.ok)
console.log(`==== cli bridge ${results.length - failed.length}/${results.length} passed ====`)
process.exit(failed.length ? 1 : 0)
