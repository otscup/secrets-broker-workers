/**
 * Shared in-process harness for the regression suites that need the real
 * Worker + the real BrokerState class but cannot start workerd locally.
 *
 * It wires the module the same way test-r1-r6.mjs does (see register.mjs) and
 * replaces D1 with a small SQL recogniser. The recogniser only understands the
 * statements these suites assert on on purpose: an unhandled query returns an
 * empty result instead of silently passing a value.
 *
 * Run the suites with:
 *   node --import ./test-support/register.mjs test-audit-d1.mjs
 */
import worker, { BrokerState } from '../src/index.js'
import { wrapWithKek, cipherKeys, encryptStr } from '../src/crypto.js'

export const HARNESS = {
  KEK: Buffer.alloc(32, 7).toString('base64'),
  AUTH: 'harness-agent-token',
  ITEM: 'harness-item',
  ITEM_ID: 'item-harness',
  ACCT: 'vault@example.invalid',
  AGENT: 'harness-agent',
  PASSWORD: 'HARNESS_SECRET_VALUE',
  SESSION: {
    email: 'vault@example.invalid',
    symEncKey: Buffer.alloc(32, 1).toString('base64'),
    symMacKey: Buffer.alloc(32, 2).toString('base64'),
    expiresAt: 0,
  },
}

// A ciphers row shaped the way the legacy table stores it. The data payload is
// plain JSON here: decryptCipherRow reads it as a Bitwarden-style object, which
// is what the row-level decryption under test actually consumes.
export async function legacyCipherRow({ id = HARNESS.ITEM_ID, name = HARNESS.ITEM, username = 'alice', password = HARNESS.PASSWORD } = {}) {
  const { userEnc, userMac } = await cipherKeys({ key: null }, HARNESS.SESSION)
  return {
    id,
    user_id: 'u1',
    type: 1,
    folder_id: null,
    name: await encryptStr(name, userEnc, userMac),
    notes: '',
    data: JSON.stringify({ login: { username, password, totp: '', uris: [] }, fields: [] }),
    key: null,
  }
}

class FakeD1 {
  constructor({ auditRows = [], cipherRows = [], failAuditInsert = false, v2Initialized = false } = {}) {
    this.auditRows = auditRows
    this.cipherRows = cipherRows
    this.failAuditInsert = failAuditInsert
    // A suite that exercises the v2 write path needs the store to look
    // initialised: vault2Context refuses a vault whose keyrings/meta say it
    // never was. Off by default so the legacy suites keep their old shape.
    this.v2Initialized = v2Initialized
    // A batch that fails once, then succeeds, is how the migration retry is
    // proved without waiting for the stale-claim window.
    this.failNextBatch = false
    this.inserts = 0
    this.skippedInserts = 0
    this.batchCalls = 0
    this.cipherQueries = 0
    this.cipherRowsRead = 0
    this.executed = []
  }

  prepare(sql) {
    const self = this
    const statement = {
      sql,
      params: [],
      bind(...params) { this.params = params; return this },
      async first() {
        self.executed.push({ sql, params: this.params })
        if (/FROM users/.test(sql)) return { id: 'u1' }
        if (/COUNT\(\*\) AS live/.test(sql)) return { live: 0 }
        if (/COUNT\(\*\) AS n FROM audit_v2/.test(sql)) return { n: self.auditRows.length }
        if (self.v2Initialized && /FROM keyrings/.test(sql)) return { id: 'password' }
        if (/FROM meta/.test(sql) && /'revision'/.test(sql)) return { value: '1' }
        if (self.v2Initialized && /FROM meta/.test(sql) && /'source'/.test(sql)) return { value: 'v2' }
        return null
      },
      async all() {
        self.executed.push({ sql, params: this.params })
        if (/FROM audit_v2/.test(sql)) {
          let rows = self.auditRows.slice()
          if (/ORDER BY id DESC/.test(sql)) rows.reverse()
          if (/LIMIT \?/.test(sql)) {
            const nums = this.params.filter((value) => typeof value === 'number')
            const offset = nums.length >= 2 ? nums[nums.length - 1] : 0
            const limit = nums[nums.length - (nums.length >= 2 ? 2 : 1)]
            rows = limit < 0 ? rows.slice(offset) : rows.slice(offset, offset + limit)
          }
          return { results: rows.map((entry) => ({ detail: JSON.stringify(entry) })) }
        }
        if (/FROM ciphers/.test(sql)) {
          self.cipherQueries += 1
          const byId = /WHERE id = \?/.test(sql)
          const rows = byId ? self.cipherRows.filter((row) => row.id === this.params[0]) : self.cipherRows.slice()
          self.cipherRowsRead += rows.length
          return { results: rows }
        }
        if (/FROM keyrings/.test(sql)) return { results: [] }
        if (/FROM vault_items/.test(sql)) return { results: [] }
        return { results: [] }
      },
      async run() {
        self.executed.push({ sql, params: this.params })
        if (/INSERT INTO audit_v2/.test(sql)) {
          if (self.failAuditInsert) throw new Error('audit_v2 unavailable')
          const params = this.params
          // The legacy migration uses INSERT ... WHERE NOT EXISTS so a retry
          // after a partial batch cannot write the same line twice.
          const legacy = /WHERE NOT EXISTS/.test(sql)
          if (legacy) {
            const duplicate = self.auditRows.some((entry) => String(entry.time) === String(params[4])
              && String(entry.event ?? '') === String(params[5])
              && String(entry.name ?? '') === String(params[6] ?? '')
              && JSON.stringify(entry) === params[7])
            if (duplicate) { self.skippedInserts += 1; return { success: true } }
          }
          self.inserts += 1
          self.auditRows.push(JSON.parse(params[3]))
        }
        return { success: true }
      },
    }
    return statement
  }

  async batch(statements) {
    this.batchCalls += 1
    if (this.failNextBatch) {
      this.failNextBatch = false
      throw new Error('audit batch failed')
    }
    for (const statement of statements) await statement.run()
    return []
  }
}

function memoryCtx(store) {
  // register.mjs adds a promise-chain transaction() when the ctx has none, which
  // is the single-threaded execution model a Durable Object already has.
  return {
    storage: {
      get: async (key) => store[key] ?? null,
      put: async (key, value) => { store[key] = JSON.parse(JSON.stringify(value)) },
      // Durable Objects expose list({prefix}) and delete([...keys]); the v2 key
      // sweep and clear use both. Without them a lock only dropped the memory
      // copy and the durable slot resurrected on the next read.
      list: async ({ prefix = '' } = {}) => {
        const found = new Map()
        for (const [key, value] of Object.entries(store)) {
          if (key.startsWith(prefix)) found.set(key, JSON.parse(JSON.stringify(value)))
        }
        return found
      },
      delete: async (key) => {
        for (const name of Array.isArray(key) ? key : [key]) delete store[name]
      },
    },
  }
}

export function makeEnv({ vault = new FakeD1(), legacy = new FakeD1(), extra = {} } = {}) {
  const store = {}
  const ctx = memoryCtx(store)
  const env = {
    SESSION_KEK: HARNESS.KEK,
    ADMIN_PASSWORD: 'p',
    MCP_ALLOW_READ: '1',
    VAULT_EMAIL: '',
    VAULT_DB: vault,
    NODEWARDEN_DB: legacy,
    ...extra,
    _store: store,
    _vault: vault,
    _legacy: legacy,
  }
  const instance = new BrokerState(ctx, env)
  const stub = { fetch: (url, init) => instance.fetch(new Request(url, init)), _instance: instance }
  env.BROKER_STATE = { idFromName: () => 'global', get: () => stub, _instance: instance }
  return env
}

export { FakeD1 }

export async function tokenHash(token = HARNESS.AUTH) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Buffer.from(new Uint8Array(digest)).toString('base64')
}

export async function seedState(env, extra = {}) {
  const state = {
    agents: {
      [HARNESS.AGENT]: {
        hash: await tokenHash(), allow: [HARNESS.ITEM], groups: [], allowAll: false, write: false,
        legacy: true, account: HARNESS.ACCT, createdAt: '2024-01-01',
      },
    },
    oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
    policies: { [HARNESS.ITEM]: { noApproval: true } }, grants: {}, pending: {}, audit: [],
    itemGroups: {}, security: {},
    settings: { notifications: {}, vaultEmail: '', materializePaths: [] },
    capabilities: {}, actionGrants: {}, usePolicies: {},
    itemIds: { [HARNESS.ITEM]: HARNESS.ITEM_ID },
    credentialKinds: { [HARNESS.ITEM_ID]: 'api' },
    fillExecutors: {}, fillRateCounters: {}, adminSessions: {}, fillPolicies: {}, plaintextReadPolicies: {},
    ...extra,
  }
  // A later spread replaces a whole key; merge the settings the harness relies
  // on so a test can override one field without dropping the rest.
  if (extra.settings) state.settings = { notifications: {}, vaultEmail: '', materializePaths: [], ...extra.settings }
  await env.BROKER_STATE.get().fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
}

export async function putSession(env) {
  const wrapped = await wrapWithKek(new TextEncoder().encode(JSON.stringify(HARNESS.SESSION)), Buffer.from(HARNESS.KEK, 'base64'))
  await env.BROKER_STATE.get().fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
}

export function call(env, path, init = {}) {
  return worker.fetch(new Request('https://broker.test' + path, init), env, { waitUntil() {} })
}

export async function login(env) {
  const response = await call(env, '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'p' }),
  })
  return String(response.headers.get('set-cookie') || '').split(';')[0]
}

export async function mcpCall(env, tool, args = {}) {
  const response = await call(env, '/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + HARNESS.AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  })
  return { status: response.status, body: await response.json() }
}

export function mcpText(callResult) {
  return callResult.body?.result?.content?.[0]?.text ?? ''
}

export function doFetch(env, path, body = {}) {
  return env.BROKER_STATE.get().fetch('https://state' + path, { method: 'POST', body: JSON.stringify(body) }).then((response) => response.json())
}

export function makeReporter() {
  const results = []
  const pass = (name) => { results.push({ name, ok: true }); console.log('PASS  ' + name) }
  const fail = (name, detail) => { results.push({ name, ok: false, detail }); console.log('FAIL  ' + name + ' :: ' + detail) }
  const finish = () => {
    const ok = results.filter((entry) => entry.ok).length
    console.log('\n==== ' + ok + '/' + results.length + ' assertions passed ====')
    if (ok !== results.length) process.exit(1)
  }
  return { pass, fail, finish }
}
