// Approval policy matrix: once, 15 minutes, always-for-this-item, deny, and
// isolation between agents. This drives makeGate directly, so it needs no
// browser and no real vault.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeGate } from './cli/localauth.mjs'

process.env.BROKER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-policy-'))
process.env.BROKER_NO_BROWSER = '1'

let clock = 1_000_000
const gate = makeGate({ open: () => {}, timeoutMs: 1000, limit: 100, now: () => clock })
const ask = (agent, item) => gate.check(agent, { params: { name: 'get_secret', arguments: { name: item } } })
const pending = () => gate.pending()[0]
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : ' :: ' + detail))
}

try {
  // once: allowed once, then asks again.
  {
    const first = ask('once', 'x')
    gate.decide(pending().id, 'once')
    const allowed = await first
    const second = ask('once', 'x')
    const askedAgain = Boolean(pending())
    gate.decide(pending().id, 'deny')
    const denied = await second
    check('P1 once allows one read, then asks again', allowed.ok && askedAgain && !denied.ok)
  }

  // window: allowed inside 15 minutes, asks again after it expires.
  {
    clock = 1_000_000
    const first = ask('window', 'x')
    gate.decide(pending().id, 'window')
    await first
    clock += 14 * 60 * 1000
    const inside = await ask('window', 'x')
    clock += 2 * 60 * 1000
    const outside = ask('window', 'x')
    const askedAgain = Boolean(pending())
    gate.decide(pending().id, 'deny')
    const denied = await outside
    check('P2 15m window expires', inside.ok && askedAgain && !denied.ok)
  }

  // allow: this item is automatic, another item still asks.
  {
    const first = ask('allow', 'x')
    gate.decide(pending().id, 'allow')
    await first
    const same = await ask('allow', 'x')
    const other = ask('allow', 'y')
    const asked = Boolean(pending())
    gate.decide(pending().id, 'deny')
    const denied = await other
    check('P3 always allows one item only', same.ok && asked && !denied.ok)
  }

  // deny: no value and no policy change.
  {
    const request = ask('deny', 'x')
    gate.decide(pending().id, 'deny')
    const denied = await request
    const again = ask('deny', 'x')
    const askedAgain = Boolean(pending())
    gate.decide(pending().id, 'deny')
    await again
    check('P4 deny returns no value and grants nothing', !denied.ok && askedAgain)
  }

  // isolation: an allow for one agent does not unlock another agent.
  {
    const first = ask('agent-a', 'x')
    gate.decide(pending().id, 'allow')
    await first
    const other = ask('agent-b', 'x')
    const asked = Boolean(pending())
    gate.decide(pending().id, 'deny')
    const denied = await other
    check('P5 policies are isolated per agent', asked && !denied.ok)
  }

  // the audit log records decisions but never the item value.
  {
    const text = fs.readFileSync(path.join(process.env.BROKER_HOME, 'audit.jsonl'), 'utf8')
    check('P6 audit has no secret value', !text.includes('sk-') && text.includes('"decision":"deny"'))
  }
} finally {
  fs.rmSync(process.env.BROKER_HOME, { recursive: true, force: true })
}

const failed = results.filter((row) => !row.ok)
console.log('\n==== local policy ' + (results.length - failed.length) + '/' + results.length + ' passed ====')
process.exit(failed.length ? 1 : 0)
