// The worker's version, mirrored from package.json "version".
//
// The obvious alternative — importing ../package.json — works when wrangler
// bundles for deploy but not in the Miniflare suites: their module loader only
// supports ESModule/CommonJS/CompiledWasm/Text/Data rules, so a JSON import
// fails with ERR_MODULE_RULE before any test runs. This file is therefore the
// runtime copy, and test-version-endpoint.mjs fails the build if it drifts from
// package.json. Bump package.json, then run:
//
//   npm run sync:version
export const NAME = "secrets-broker-workers"
export const VERSION = "0.9.2"
