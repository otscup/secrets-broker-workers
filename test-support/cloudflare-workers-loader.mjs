/**
 * Resolve/load hooks backing test-support/register.mjs.
 * See register.mjs for the rationale.
 */

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') {
    // Route the stub through a virtual child specifier that load() can
    // recognize. Anything unique works; no file is created.
    return { url: 'test-support:cloudflare-workers-stub', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'test-support:cloudflare-workers-stub') {
    const source = `export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Add a promise-chain mutex as storage.transaction() when the test
    // harness ctx does not provide one (single-process serialization).
    const storage = ctx && ctx.storage;
    if (storage && typeof storage.transaction !== 'function') {
      let chain = Promise.resolve();
      storage.transaction = (fn) => {
        const run = chain.then(() => fn(storage));
        // Keep the chain alive even if one transaction rejects.
        chain = run.catch(() => {});
        return run;
      };
    }
  }
}
`;
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
