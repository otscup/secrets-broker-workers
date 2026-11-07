// Unlock now tags pre-account rows with the account that just unlocked them.
// The dangerous case is a row sealed under a different key: tagging it would
// hide it from its real owner. This proves the claim only touches rows the
// current key opens, leaves everything else untouched, and is idempotent.
import { newDek, sealItem, openItem } from './src/envelope.js'
import { vault2ClaimLegacyRows } from './src/vault2.js'
import { makeReporter } from './test-support/broker-harness.mjs'

const { pass, fail, finish } = makeReporter()
const ACCOUNT = 'agent@example.com'

function makeDb(rows) {
  const meta = { revision: 10 }
  return {
    rows,
    prepare(sql) {
      return {
        params: [],
        bind(...params) { this.params = params; return this },
        async all() {
          if (/^SELECT id, ciphertext FROM vault_items/.test(sql)) {
            const after = this.params[0]
            const page = rows
              .filter((row) => row.id > after && row.accountId === null)
              .sort((a, b) => (a.id > b.id ? 1 : -1))
              .slice(0, 40)
              .map((row) => ({ id: row.id, ciphertext: row.ciphertext }))
            return { results: page }
          }
          throw new Error('unexpected all: ' + sql)
        },
        async first() {
          if (/FROM vault_items WHERE account_id IS NULL/.test(sql)) {
            return { left: rows.filter((row) => row.accountId === null).length }
          }
          if (/^UPDATE meta SET value/.test(sql)) {
            meta.revision += 1
            return { value: meta.revision }
          }
          throw new Error('unexpected first: ' + sql)
        },
        async run() {
          if (/^UPDATE vault_items SET account_id = \?/.test(sql)) {
            const [account, revision, updatedAt, id] = this.params
            const row = rows.find((entry) => entry.id === id && entry.accountId === null)
            if (row) Object.assign(row, { accountId: account, revision, updatedAt })
            return { success: true }
          }
          throw new Error('unexpected run: ' + sql)
        },
      }
    },
    async batch(statements) {
      for (const statement of statements) await statement.run()
      return []
    },
  }
}

const dek = await newDek()
const otherDek = await newDek()
const rows = [
  { id: 'item-01', accountId: null, ciphertext: await sealItem(dek, 'item-01', { name: 'one', secret: 's1' }) },
  { id: 'item-02', accountId: null, ciphertext: await sealItem(dek, 'item-02', { name: 'two', secret: 's2' }) },
  { id: 'item-03', accountId: null, ciphertext: await sealItem(otherDek, 'item-03', { name: 'three', secret: 's3' }) },
  { id: 'item-04', accountId: ACCOUNT, ciphertext: await sealItem(dek, 'item-04', { name: 'four', secret: 's4' }) },
]
const env = { VAULT_DB: makeDb(rows) }

{
  const none = await vault2ClaimLegacyRows(env, { dek, account: '' })
  if (none === null && rows.every((row) => row.id === 'item-04' ? row.accountId === ACCOUNT : row.accountId === null)) {
    pass('C1 an empty account claims nothing')
  } else {
    fail('C1 empty account', JSON.stringify(rows.map((row) => row.accountId)))
  }
}

{
  const before = { 'item-01': rows[0].ciphertext, 'item-02': rows[1].ciphertext }
  const result = await vault2ClaimLegacyRows(env, { dek, account: ACCOUNT })
  const tagged = rows.filter((row) => row.accountId === ACCOUNT).map((row) => row.id)
  if (result.tagged === 2 && result.skipped === 1 && result.remaining === 1
    && tagged.join(',') === 'item-01,item-02,item-04') {
    pass('C2 only rows the current key opens are tagged, the rest stay unowned')
  } else {
    fail('C2 claim result', JSON.stringify(result) + ' tagged=' + tagged.join(','))
  }
  if (rows[0].ciphertext === before['item-01'] && rows[1].ciphertext === before['item-02']) {
    pass('C3 claiming a tag does not rewrite the ciphertext')
  } else {
    fail('C3 ciphertext changed')
  }
  if (await openItem(dek, 'item-01', rows[0].ciphertext).then((payload) => payload.name === 'one', () => false)) {
    pass('C4 a claimed row still opens with the key the readers use')
  } else {
    fail('C4 claimed row unreadable')
  }
}

{
  const again = await vault2ClaimLegacyRows(env, { dek, account: ACCOUNT })
  if (again.tagged === 0 && again.skipped === 1 && again.remaining === 1) {
    pass('C5 a second unlock is a no-op (idempotent)')
  } else {
    fail('C5 second run', JSON.stringify(again))
  }
}

finish()
