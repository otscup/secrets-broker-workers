const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SRC = process.cwd()
// A unique directory per run avoids clashing with an earlier run that still
// holds files open, which Windows refuses to delete.
// One shared mirror per machine: the node_modules copy is expensive and does
// not change between runs, so it is created once and reused.
const RUN = path.join(os.tmpdir ? os.tmpdir() : require('node:os').tmpdir(), 'sb-test-run-shared')

function mirror() {
  // The node_modules copy is the expensive part, so it happens once. The
  // sources are refreshed on every run.
  const fresh = !fs.existsSync(path.join(RUN, 'node_modules', 'ws'))
  if (fresh) {
    // Windows may refuse to delete a tree that is still open. The contents
    // are overwritten below, so a failed clean is not fatal.
    try { fs.rmSync(RUN, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) } catch {}
  }
  fs.mkdirSync(RUN, { recursive: true })
  const copy = (rel) => {
    const from = path.join(SRC, rel)
    const to = path.join(RUN, rel)
    if (!fs.existsSync(from)) return
    fs.cpSync(from, to, { recursive: true, force: true, filter: (p) => !/node_modules|[\\/]\.git$|[\\/]\.wrangler/.test(p) })
  }
  copy('src')
  copy('public')
  copy('docs')
  copy('test-support')
  copy('migrations')
  copy('cli')
  copy('package.json')
  copy('package-lock.json')
  for (const name of fs.readdirSync(SRC)) {
    if (/^(test-.*\.mjs|.*\.html|.*\.sql)$/.test(name)) {
      fs.copyFileSync(path.join(SRC, name), path.join(RUN, name))
    }
  }
  if (fresh) fs.cpSync(path.join(SRC, 'node_modules'), path.join(RUN, 'node_modules'), { recursive: true, force: true })
}

const args = process.argv.slice(2)
if (!args.length) {
  console.error('usage: node run-tests.cjs <file>[:--import=<loader>] ...')
  process.exit(2)
}
mirror()

let failed = 0
for (const spec of args) {
  const [file, opt] = spec.split('::')
  const nodeArgs = opt ? ['--import', opt, file] : [file]
  const r = spawnSync(process.execPath, nodeArgs, { cwd: RUN, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = String(r.stdout || '')
  const err = String(r.stderr || '')
  for (const line of out.split('\n')) if (/passed ====|FAIL/.test(line)) console.log(line.trim())
  if (r.status !== 0) {
    failed += 1
    console.log('SUITE FAILED ' + file)
    for (const l of (err || out).split('\n').filter((l) => /Error|FAIL|reason|missing|ENOENT/i.test(l)).slice(0, 4)) {
      console.log('   ' + l.trim().slice(0, 170))
    }
  }
}
console.log(failed ? 'FAILED SUITES: ' + failed : 'ALL SUITES PASSED')
process.exit(failed ? 1 : 0)
