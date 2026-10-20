// /capability/ensure authority tests: the DO must derive a capability from
// persisted state and must never accept a caller-built capability object.
//
// Calls the REAL Durable Object endpoint under Miniflare/workerd.
import { Miniflare } from 'miniflare'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 41).toString('base64')
const AGENT = 'ens-agent'
const ITEM_ID = 'item-ens'
const ITEM = 'ens-item'
const ACCT = 'vault@example.invalid'
const CK = AGENT + '\u0000' + ITEM_ID + '\u0000secret.read'
const UK = AGENT + '\u0000' + ITEM_ID + '\u0000secret.use'
const GK = AGENT + '\u0000' + ITEM

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK },
  bindings: { SESSION_KEK: KEK },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('ensure'))
const putState = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const ensure = (body) => stub.fetch('https://state/capability/ensure', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
const consume = (key, action = 'secret.read') => stub.fetch('https://state/capability/consume', { method: 'POST', body: JSON.stringify({ key, accountId: ACCT, action }) }).then((r) => r.json())

const EXP_FUTURE = Date.now() + 3600e3
function base(extra = {}) {
  return {
    agents: { [AGENT]: { hash: '', allow: [], groups: [], allowAll: false, write: false, legacy: true, account: ACCT } },
    policies: {}, pending: {}, audit: [], settings: { notifications: {} },
    itemGroups: {}, actionGrants: {}, usePolicies: {}, capabilities: {}, itemIds: { [ITEM]: ITEM_ID },
    grants: {}, ...extra,
  }
}
const legacyGrant = (extra = {}) => ({ agent: AGENT, name: ITEM, mode: 'share', createdAt: '2024-01-01', expiresAt: EXP_FUTURE, reads: 2, maxReads: 5, revokedAt: null, account: ACCT, itemId: ITEM_ID, ...extra })

// E1: authority derived from the legacy grant, not from the caller
{
  await putState(base({ grants: { [GK]: legacyGrant() } }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM,
    // attacker-supplied expansion attempts, must be ignored entirely
    capability: { id: CK, subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', expiresAt: null, maxUses: null, usedCount: 0 } })
  const cap = (await getState()).capabilities[CK]
  if (r.ok && cap && cap.expiresAt === EXP_FUTURE && cap.maxUses === 5 && cap.usedCount === 2) pass('E1 derived expiresAt/maxUses/usedCount from grant (client object ignored)')
  else fail('E1', JSON.stringify({ r, cap }))
}
// E2: caller cannot widen expiry to permanent
{
  await putState(base({ grants: { [GK]: legacyGrant() } }))
  await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM, expiresAt: null })
  const cap = (await getState()).capabilities[CK]
  if (cap && cap.expiresAt === EXP_FUTURE) pass('E2 expiresAt cannot be widened to permanent')
  else fail('E2', JSON.stringify(cap))
}
// E3: caller cannot widen maxUses
{
  await putState(base({ grants: { [GK]: legacyGrant() } }))
  await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM, maxUses: null })
  const cap = (await getState()).capabilities[CK]
  if (cap && cap.maxUses === 5) pass('E3 maxUses cannot be widened')
  else fail('E3', JSON.stringify(cap))
}
// E4: caller cannot reset usedCount
{
  await putState(base({ grants: { [GK]: legacyGrant() } }))
  await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM, usedCount: 0 })
  const cap = (await getState()).capabilities[CK]
  if (cap && cap.usedCount === 2) pass('E4 usedCount cannot be reset')
  else fail('E4', JSON.stringify(cap))
}
// E5: secret.use cannot be migrated from a legacy grant
{
  await putState(base({ grants: { [GK]: legacyGrant() } }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.use', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (!r.ok && r.reason === 'action-not-migratable' && !st.capabilities[UK]) pass('E5 secret.use never migrated from legacy grant')
  else fail('E5', JSON.stringify({ r, uc: !!st.capabilities[UK] }))
}
// E6: cross-account cannot be smuggled via accountId
{
  await putState(base({ grants: { [GK]: legacyGrant() } }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: 'other@example.invalid', legacyName: ITEM })
  const st = await getState()
  if (!r.ok && !st.capabilities[CK]) pass('E6 cross-account migration rejected')
  else fail('E6', JSON.stringify({ r, cap: st.capabilities[CK] }))
}
// E7: revoked legacy grant refused
{
  await putState(base({ grants: { [GK]: legacyGrant({ revokedAt: new Date().toISOString() }) } }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (!r.ok && r.reason === 'legacy-revoked' && !st.capabilities[CK] && !st.grants[GK].migratedToCapability) pass('E7 revoked grant refused, no capability, no mark')
  else fail('E7', JSON.stringify({ r, cap: !!st.capabilities[CK], mark: st.grants[GK].migratedToCapability }))
}
// E8: expired legacy grant refused
{
  await putState(base({ grants: { [GK]: legacyGrant({ expiresAt: Date.now() - 1000 }) } }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (!r.ok && r.reason === 'legacy-expired' && !st.capabilities[CK]) pass('E8 expired grant refused')
  else fail('E8', JSON.stringify({ r, cap: !!st.capabilities[CK] }))
}
// E9: exhausted legacy grant refused
{
  await putState(base({ grants: { [GK]: legacyGrant({ reads: 5, maxReads: 5 }) } }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (!r.ok && r.reason === 'legacy-exhausted' && !st.capabilities[CK]) pass('E9 exhausted grant refused')
  else fail('E9', JSON.stringify({ r, cap: !!st.capabilities[CK] }))
}
// E10: already-migrated grant cannot produce a second capability
{
  await putState(base({ grants: { [GK]: legacyGrant({ migratedToCapability: CK }) } }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (!r.ok && r.reason === 'legacy-already-migrated' && !st.capabilities[CK]) pass('E10 already-migrated grant refused')
  else fail('E10', JSON.stringify({ r, cap: !!st.capabilities[CK] }))
}
// E11: noApproval alone (no grant, no actionGrant) must NOT mint a capability
{
  await putState(base({ policies: { [ITEM]: { noApproval: true } } }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  // noApproval without a grant hits the actionGrant requirement first; either
  // refusal reason is correct â€?what matters is that nothing is created.
  if (!r.ok && ['no-legacy-source', 'no-action-grant'].includes(r.reason) && !st.capabilities[CK]) pass('E11 noApproval alone yields no capability')
  else fail('E11', JSON.stringify({ r, cap: !!st.capabilities[CK] }))
}
// E12: noApproval + actionGrant mints a BOUNDED capability (24h / 1 use)
{
  await putState(base({
    policies: { [ITEM]: { noApproval: true } },
    actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: 'g', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.read'], legacy: false, createdAt: '2024-01-01' } },
  }))
  const before = Date.now()
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const cap = (await getState()).capabilities[CK]
  const bounded = cap && cap.maxUses === 1 && cap.expiresAt != null && cap.expiresAt <= before + 86400e3 + 5000 && cap.expiresAt > before
  if (r.ok && bounded) pass('E12 noApproval+actionGrant mints 24h/1-use capability (bounded)')
  else fail('E12', JSON.stringify({ r, cap }))
}
// E13: noApproval + actionGrant that lacks secret.read is refused
{
  await putState(base({
    policies: { [ITEM]: { noApproval: true } },
    actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: 'g', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.use'], legacy: false, createdAt: '2024-01-01' } },
  }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  if (!r.ok && r.reason === 'action-grant-mismatch') pass('E13 actionGrant without secret.read refused')
  else fail('E13', JSON.stringify(r))
}
// E14: existing revoked capability is never overwritten by ensure
{
  await putState(base({
    grants: { [GK]: legacyGrant() },
    capabilities: { [CK]: { id: CK, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', expiresAt: null, maxUses: null, usedCount: 9, revokedAt: new Date().toISOString(), revokedBy: 'admin', approvalId: null, policyVersion: 1 } },
  }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const cap = (await getState()).capabilities[CK]
  if (r.ok && r.existed === true && cap.revokedAt && cap.usedCount === 9) pass('E14 revoked capability not overwritten')
  else fail('E14', JSON.stringify({ r, cap }))
}
// E15: existing exhausted tombstone not overwritten
{
  await putState(base({
    grants: { [GK]: legacyGrant() },
    capabilities: { [CK]: { id: CK, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', expiresAt: null, maxUses: 1, usedCount: 1, exhaustedAt: new Date().toISOString(), revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 } },
  }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const cap = (await getState()).capabilities[CK]
  if (r.ok && r.existed === true && cap.usedCount === 1 && cap.exhaustedAt) pass('E15 exhausted tombstone not overwritten')
  else fail('E15', JSON.stringify({ r, cap }))
}
// E16: 20-way concurrent ensure creates exactly one capability
{
  await putState(base({ grants: { [GK]: legacyGrant() } }))
  const out = await Promise.all(Array.from({ length: 20 }, () => ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })))
  const created = out.filter((r) => r.ok && r.existed === false).length
  const st = await getState()
  if (created === 1 && Object.keys(st.capabilities).length === 1) pass('E16 20-way concurrent ensure: exactly 1 creates')
  else fail('E16', JSON.stringify({ created, caps: Object.keys(st.capabilities).length }))
}
// E17: 20-way ensure+consume never exceeds maxUses
{
  await putState(base({ grants: { [GK]: legacyGrant({ reads: 0, maxReads: 2 }) } }))
  const out = await Promise.all(Array.from({ length: 20 }, async () => {
    const e = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
    if (!e.ok) return { ensured: false }
    return consume(CK)
  }))
  const consumed = out.filter((r) => r.ok).length
  const cap = (await getState()).capabilities[CK]
  if (consumed === 2 && cap.usedCount === 2) pass('E17 20-way ensure+consume: exactly maxUses=2 consumed')
  else fail('E17', JSON.stringify({ consumed, used: cap && cap.usedCount }))
}
// E18: revoke racing ensure cannot resurrect the grant
{
  await putState(base({ grants: { [GK]: legacyGrant() } }))
  const [r1, r2] = await Promise.all([
    ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM }),
    (async () => {
      const st = await getState()
      if (st.grants[GK]) st.grants[GK].revokedAt = new Date().toISOString()
      await putState(st)
      return { ok: true }
    })(),
  ])
  const st = await getState()
  const cap = st.capabilities[CK]
  // Either ensure won (capability exists, grant marked) or revoke won (no cap).
  // The forbidden outcome is a capability created from an already-revoked grant.
  const grantRevoked = Boolean(st.grants[GK] && st.grants[GK].revokedAt)
  const badState = grantRevoked && cap && !st.grants[GK].migratedToCapability
  if (!badState) pass('E18 revoke/ensure race: no capability from a revoked grant')
  else fail('E18', JSON.stringify({ r1, grantRevoked, cap }))
}
// E19: missing itemId / unknown source refused, nothing written
{
  await putState(base({}))
  const r1 = await ensure({ subjectId: AGENT, itemId: '', action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const r2 = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'root', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (!r1.ok && !r2.ok && Object.keys(st.capabilities || {}).length === 0) pass('E19 invalid identifiers refused, nothing written')
  else fail('E19', JSON.stringify({ r1, r2 }))
}

// E20: actionGrant(secret.read) exists but noApproval is false/unset ->
// ensure must NOT auto-mint a capability; the request must still require a
// human approval (pending), never an automatic grant.
{
  await putState(base({
    // no legacy grant; policy exists but explicitly no noApproval
    policies: {},
    actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: 'g', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.read'], legacy: false, createdAt: '2024-01-01' } },
  }))
  const r1 = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st1 = await getState()
  const rejectedWhenUnset = !r1.ok && !st1.capabilities[CK]

  // Same again with noApproval explicitly false.
  await putState(base({
    policies: { [ITEM]: { noApproval: false } },
    actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: 'g', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.read'], legacy: false, createdAt: '2024-01-01' } },
  }))
  const r2 = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st2 = await getState()
  const rejectedWhenFalse = !r2.ok && !st2.capabilities[CK]

  if (rejectedWhenUnset && rejectedWhenFalse) pass('E20 actionGrant without noApproval: ensure refuses, no capability auto-minted')
  else fail('E20', JSON.stringify({ r1, r2, c1: st1.capabilities[CK], c2: st2.capabilities[CK] }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== ensure authority ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
