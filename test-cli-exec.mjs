// `secrets-broker exec` puts a credential in a child process's environment so a
// key never has to sit in a .env file an agent can read. The child is real, so
// the assertion is what that child actually printed.
import { buildEnv, runExec, parseSpec } from './cli/exec.mjs'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const vault = [
  { id: 'a1', kind: 'api', payload: { name: 'openai-prod', secret: 'sk-live-1' } },
  { id: 'b2', kind: 'web', payload: { name: 'GitHub', username: 'octocat', password: 'hunter2', url: 'https://github.com', totp: 'JBSWY3DPEHPK3PXP' } },
  { id: 'c3', kind: 'api', deleted: true },
]

// E1: a plain KEY=item becomes that env var, and nothing else leaks in.
{
  const { env, missing } = buildEnv(vault, ['OPENAI_API_KEY=openai-prod'])
  const ok = env.OPENAI_API_KEY === 'sk-live-1' && Object.keys(env).length === 1 && missing.length === 0
  ok ? pass('E1 KEY=item puts exactly that one value in the environment') : fail('E1', JSON.stringify({ env, missing }))
}

// E2: a web login can hand over one field instead of the password.
{
  const { env } = buildEnv(vault, ['GH_USER=GitHub@username', 'GH_TOTP=GitHub@totp', 'GH_URL=GitHub@url'])
  const ok = env.GH_USER === 'octocat' && env.GH_TOTP.length === 16 && env.GH_URL === 'https://github.com'
  ok ? pass('E2 @field picks username, totp or url') : fail('E2', JSON.stringify(env))
}

// E3: a name that does not exist is reported, never guessed into the child.
{
  const { env, missing } = buildEnv(vault, ['KEY=openai prod'])
  const ok = Object.keys(env).length === 0 && missing[0]?.guess === 'openai-prod'
  ok ? pass('E3 a wrong name is reported with the near miss') : fail('E3', JSON.stringify({ env, missing }))
}

// E4: an unknown field is refused instead of silently giving the secret.
{
  let said = ''
  try { parseSpec('GitHub@pin') } catch (error) { said = String(error.message) }
  said.includes('unknown field') ? pass('E4 an unknown field is refused') : fail('E4', said)
}

// E5: the real child can read the value — it exits 3 if the value is wrong.
{
  const { env } = buildEnv(vault, ['TOKEN=openai-prod'])
  const script = "process.exit(process.env.TOKEN === 'sk-live-1' ? 0 : 3)"
  const result = await runExec({ command: [process.execPath, '-e', script], env })
  result.code === 0 ? pass('E5 a real child receives the value it was promised') : fail('E5', JSON.stringify(result))
}

// E6: a failing child's code is passed through, not swallowed into 0.
{
  const result = await runExec({ command: [process.execPath, '-e', 'process.exit(7)'], env: {} })
  result.code === 7 ? pass('E6 the child exit code is passed through') : fail('E6', JSON.stringify(result))
}

const failed = results.filter((r) => !r.ok)
console.log('\n==== cli exec ' + results.filter((r) => r.ok).length + '/' + results.length + ' passed ====')
process.exit(failed.length ? 1 : 0)
