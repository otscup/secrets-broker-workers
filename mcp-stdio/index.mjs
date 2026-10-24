#!/usr/bin/env node
/**
 * Kept so an existing client config that points at this path keeps working.
 *
 * The bridge itself now lives in cli/ and is published as `secrets-broker`,
 * which adds keychain storage and the local approval window. Prefer:
 *
 *   npx -y @otscup/secrets-broker
 */
import { main } from '../cli/index.mjs'
import { log } from '../cli/approval.mjs'

main()
  .then((code) => {
    if (typeof code === 'number' && code !== 0) process.exit(code)
  })
  .catch((error) => {
    log('error:', String(error?.message ?? error))
    process.exit(1)
  })
