import assert from 'node:assert/strict'
import { scrubSecret } from './src/redact.js'

const value = 's3cr3t-value'
assert.equal(scrubSecret('prefix ' + value + ' suffix', value), 'prefix [REDACTED] suffix')
assert.equal(scrubSecret('Authorization: Bearer ' + value, value), 'Authorization: [REDACTED]')
assert.equal(scrubSecret('encoded=' + encodeURIComponent(value), value), 'encoded=[REDACTED]')
assert.equal(scrubSecret('base64=' + Buffer.from(value).toString('base64'), value), 'base64=[REDACTED]')
assert.equal(scrubSecret('unchanged', ''), 'unchanged')
assert.equal(scrubSecret(null, value), null)
console.log('redact: plain, header, URL, and base64 echoes are scrubbed')
