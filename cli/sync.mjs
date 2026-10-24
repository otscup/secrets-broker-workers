/**
 * Comparing two brokers, stage 1 — the CLI side.
 *
 * The comparison itself lives in src/vaultdiff.js so the panel can show the
 * same numbers without shelling out. This file keeps the command-line shape:
 * pull both sides, diff, print.
 */
import { pullRemote, diffVaults, formatDiff } from '../src/vaultdiff.js'

export { diffVaults, formatDiff, pullRemote }

export async function runSync({ localUrl, localToken, remoteUrl, remoteToken, verbose = false }) {
  if (!remoteUrl) throw new Error('missing --remote URL')
  const [local, remote] = await Promise.all([pullRemote(localUrl, localToken), pullRemote(remoteUrl, remoteToken)])
  const diff = diffVaults(local.items, remote.items)
  const text = formatDiff(diff, { localUrl, remoteUrl, verbose })
  return { local, remote, diff, text }
}
