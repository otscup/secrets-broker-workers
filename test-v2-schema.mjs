// The v2 schema, exercised on a real D1 so the SQL is not just plausible.
// What matters here: the revision counter moves atomically, a reader can ask for
// "everything after N", a deletion is a tombstone, and only two keyring kinds and
// two item kinds can exist at all.
import { Miniflare } from 'miniflare'
import { readFileSync } from 'node:fs'

const schema = readFileSync('migrations/0001_v2_start.sql', 'utf8')
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  d1Databases: { VAULT_DB: 'v2-schema-test' },
  compatibilityDate: '2024-10-01',
})
await mf.ready
const db = await mf.getD1Database('VAULT_DB')

// S1: the file applies in one go, as it will when it is piped into wrangler.
{
  // D1 executes what it is given statement by statement, and a comment line is
  // not one: drop the comments, then split on the semicolons.
  const sql = schema.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    await db.prepare(statement).run()
  }
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  const names = (tables.results || []).map((row) => row.name)
  const wanted = ['audit_v2', 'devices', 'keyrings', 'meta', 'vault_items']
  if (wanted.every((name) => names.includes(name))) pass('S1 the migration creates every v2 table')
  else fail('S1', JSON.stringify(names))
}

// S2: the counter is the single ordering authority; two writes never share it.
{
  const first = await db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision' RETURNING value").first()
  const second = await db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision' RETURNING value").first()
  const ok = Number(first.value) === 1 && Number(second.value) === 2
  if (ok) pass('S2 the revision counter returns a fresh number per write')
  else fail('S2', JSON.stringify({ first, second }))
}

// S3: a reader asks for what it has not seen.
{
  const insert = "INSERT INTO vault_items (id, kind, ciphertext, revision, created_at, updated_at, deleted_at) VALUES (?, 'api', 'v2.x.y', ?, ?, ?, NULL)"
  await db.prepare(insert).bind('a', 3, 't', 't').run()
  await db.prepare(insert).bind('b', 4, 't', 't').run()
  await db.prepare(insert).bind('c', 5, 't', 't').run()
  const since = await db.prepare('SELECT id, revision FROM vault_items WHERE revision > ? ORDER BY revision').bind(3).all()
  const ids = (since.results || []).map((row) => row.id)
  if (ids.join(',') === 'b,c') pass('S3 pulling since a revision returns only the newer rows')
  else fail('S3', JSON.stringify(ids))
}

// S4: deleting is a tombstone the peer can see, so a deletion propagates.
{
  await db.prepare("UPDATE vault_items SET deleted_at = '2026-10-26T00:00:00Z', revision = 6 WHERE id = 'b'").run()
  const row = await db.prepare("SELECT id, deleted_at FROM vault_items WHERE revision > 5").first()
  const ok = row && row.id === 'b' && row.deleted_at
  if (ok) pass('S4 a deletion travels as a tombstone row')
  else fail('S4', JSON.stringify(row))
}

// S5: a keyring can only be a password or a device — no third way in.
{
  const rejected = await db.prepare("INSERT INTO keyrings (id, kind, envelope, created_at, updated_at) VALUES ('k1', 'token', '{}', 't', 't')").run()
    .then(() => false).catch(() => true)
  const accepted = await db.prepare("INSERT INTO keyrings (id, kind, envelope, created_at, updated_at) VALUES ('k2', 'device', '{}', 't', 't')").run()
    .then(() => true).catch(() => false)
  if (rejected && accepted) pass('S5 only password and device keyrings can be stored')
  else fail('S5', JSON.stringify({ rejected, accepted }))
}

// S6: an item can only be api or web, so the read rules never see a stranger.
{
  const rejected = await db.prepare("INSERT INTO vault_items (id, kind, ciphertext, revision, created_at, updated_at) VALUES ('x', 'other', 'c', 7, 't', 't')").run()
    .then(() => false).catch(() => true)
  if (rejected) pass('S6 item kinds are constrained to api and web')
  else fail('S6', 'an unknown kind was accepted')
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== v2 schema ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
