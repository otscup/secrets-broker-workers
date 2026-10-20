/**
 * Node loader shim so security suites that import ./src/index.js directly
 * (e.g. test-r1-r6.mjs) can run under plain Node for a quick smoke check.
 *
 * It only stubs the `cloudflare:workers` import with a minimal
 * DurableObject base class. The base class does NOT change storage
 * semantics; it only adds a `transaction()` mutex when the caller's ctx
 * doesn't provide one — equivalent to the single-threaded execution the
 * suites already assume. Full-fidelity runs still go through
 * test-mf-oidc.mjs (workerd + real SQLite storage).
 *
 * Usage: node --import ./test-support/register.mjs test-r1-r6.mjs
 */
import { register } from 'node:module'

register(new URL('./cloudflare-workers-loader.mjs', import.meta.url))
