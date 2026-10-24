/**
 * Comparing two brokers, stage 1.
 *
 * Both sides hand over the same Bitwarden blobs that sit in their databases
 * (`2.iv|ct|mac`), so this module never sees a credential and never needs the
 * master key. That is the whole reason sync is possible at all: the ciphertext
 * is portable, the key is not.
 *
 * Stage 1 only reads. Nothing is written to either broker, and there is no
 * apply step until the merge rules are agreed.
 *
 * No Node built-ins here: the worker imports this file too, so the panel can
 * show the same comparison the CLI prints.
 */

export const pullRemote = async (baseUrl, token, { timeoutMs = 15000 } = {}) => {
  const url = String(baseUrl ?? '').replace(/\/+$/, '')
  const response = await fetch(`${url}/sync/pull`, {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) {
    let message = text
    try {
      const parsed = JSON.parse(text)
      message = parsed?.error ?? parsed?.message ?? text
    } catch {}
    throw new Error(`${url}/sync/pull answered ${response.status}: ${String(message).slice(0, 200)}`)
  }
  const body = JSON.parse(text)
  if (!Array.isArray(body.items)) throw new Error(`${url}/sync/pull did not return items`)
  return body
}

const stamp = (item) => {
  const at = Date.parse(item.updatedAt ?? item.createdAt ?? '')
  return Number.isNaN(at) ? 0 : at
}

const same = (a, b) =>
  String(a.name ?? '') === String(b.name ?? '') &&
  String(a.data ?? '') === String(b.data ?? '') &&
  String(a.notes ?? '') === String(b.notes ?? '') &&
  String(a.key ?? '') === String(b.key ?? '') &&
  String(a.folderId ?? '') === String(b.folderId ?? '') &&
  (a.deletedAt ? 1 : 0) === (b.deletedAt ? 1 : 0)

/**
 * Work out what a merge would do, without doing it.
 *
 * Every entry is one of:
 *   push     only the local broker has it, or the local copy is newer
 *   pull     only the remote broker has it, or the remote copy is newer
 *   delete   one side is a tombstone (deletedAt set) and the other is not
 *   equal    same ciphertext, nothing to do
 *
 * Newer is decided per item on updatedAt (last write wins), never on the whole
 * vault: a stale snapshot from one side cannot roll the other side back.
 */
export function diffVaults(local, remote) {
  const byId = (items) => new Map((items ?? []).map((item) => [String(item.id), item]))
  const localById = byId(local)
  const remoteById = byId(remote)
  const out = { push: [], pull: [], delete: [], equal: 0, conflict: [], skipped: 0 }

  for (const [id, item] of localById) {
    const other = remoteById.get(id)
    if (!other) {
      // A tombstone on one side and nothing on the other is not a change: the
      // item is already gone everywhere it needs to be.
      if (item.deletedAt) out.skipped += 1
      else out.push.push({ id, item, why: 'local-only' })
      continue
    }
    const localDeleted = Boolean(item.deletedAt)
    const remoteDeleted = Boolean(other.deletedAt)
    if (localDeleted !== remoteDeleted) {
      // Delete beats an older edit; a newer edit beats the delete (resurrection).
      const deleted = localDeleted ? item : other
      if (stamp(deleted) >= stamp(localDeleted ? other : item)) {
        out.delete.push({ id, side: localDeleted ? 'remote' : 'local', item: deleted })
      } else if (localDeleted) {
        out.push.push({ id, item, why: 'local-newer' })
      } else {
        out.pull.push({ id, item: other, why: 'remote-newer' })
      }
      continue
    }
    if (same(item, other)) {
      out.equal += 1
      continue
    }
    const a = stamp(item)
    const b = stamp(other)
    if (a === b) out.conflict.push({ id, local: item, remote: other, why: 'same-timestamp-different-ciphertext' })
    else if (a > b) out.push.push({ id, item, why: 'local-newer' })
    else out.pull.push({ id, item: other, why: 'remote-newer' })
  }
  for (const [id, item] of remoteById) {
    if (localById.has(id)) continue
    if (item.deletedAt) out.skipped += 1
    else out.pull.push({ id, item, why: 'remote-only' })
  }
  return out
}

export const diffCounts = (diff) => ({
  push: diff.push.length,
  pull: diff.pull.length,
  delete: diff.delete.length,
  conflict: diff.conflict.length,
  equal: diff.equal,
  skipped: diff.skipped,
})

/** The same comparison, shaped for the panel: ids and timestamps, no blobs. */
export function diffSummary(diff, { limit = 20 } = {}) {
  const rows = [
    ...diff.push.map((entry) => ({ direction: 'push', id: entry.item.id, updatedAt: entry.item.updatedAt ?? entry.item.createdAt ?? '', why: entry.why })),
    ...diff.pull.map((entry) => ({ direction: 'pull', id: entry.item.id, updatedAt: entry.item.updatedAt ?? entry.item.createdAt ?? '', why: entry.why })),
    ...diff.delete.map((entry) => ({ direction: 'delete', id: entry.item.id, updatedAt: entry.item.updatedAt ?? entry.item.createdAt ?? '', why: entry.side === 'remote' ? 'remote-has-tombstone' : 'local-has-tombstone' })),
    ...diff.conflict.map((entry) => ({ direction: 'conflict', id: entry.local.id, updatedAt: entry.local.updatedAt ?? entry.local.createdAt ?? '', why: entry.why })),
  ]
  return { counts: diffCounts(diff), total: rows.length, rows: rows.slice(0, limit) }
}

const when = (item) => item?.updatedAt ?? item?.createdAt ?? '—'

export function formatDiff(diff, { localUrl, remoteUrl, verbose = false } = {}) {
  const lines = []
  const rowsTotal = diff.push.length + diff.pull.length + diff.delete.length + diff.conflict.length + diff.equal
  lines.push(`local:  ${localUrl}`)
  lines.push(`remote: ${remoteUrl}`)
  lines.push('')
  lines.push(`本地条目 ${rowsTotal} 与远端比对完成（去重后 ${rowsTotal} 个 id）`)
  lines.push(`  将上传（只在本地 / 本地较新）: ${diff.push.length}`)
  lines.push(`  将下载（只在远端 / 远端较新）: ${diff.pull.length}`)
  lines.push(`  将删除（一侧是墓碑）:         ${diff.delete.length}`)
  lines.push(`  冲突（同一时刻、内容不同）:   ${diff.conflict.length}`)
  lines.push(`  一致:                         ${diff.equal}`)
  if (diff.skipped) lines.push(`  忽略（只有墓碑、另一侧本来就没有）: ${diff.skipped}`)
  if (!diff.push.length && !diff.pull.length && !diff.delete.length && !diff.conflict.length) {
    lines.push('')
    lines.push('两边已经一致，没有要同步的内容。')
    return lines.join('\n')
  }
  const rows = [
    ...diff.push.map((entry) => ['上传', entry.item, entry.why]),
    ...diff.pull.map((entry) => ['下载', entry.item, entry.why]),
    ...diff.delete.map((entry) => ['删除', entry.item, entry.side === 'remote' ? '远端有墓碑' : '本地有墓碑']),
    ...diff.conflict.map((entry) => ['冲突', entry.local, entry.why]),
  ]
  const shown = verbose ? rows : rows.slice(0, 20)
  lines.push('')
  lines.push('方向  条目 id（密文，名字要用主密码才解得开）        更新时间')
  for (const [direction, item, why] of shown) {
    const id = String(item.id ?? '').slice(0, 8)
    lines.push(`${direction.padEnd(6, ' ')} ${id.padEnd(10, ' ')} ${String(when(item)).padEnd(22, ' ')} ${why}`)
  }
  if (rows.length > shown.length) lines.push(`… 还有 ${rows.length - shown.length} 条（加 --verbose 全部显示）`)
  lines.push('')
  lines.push('这是只读预览：两个 broker 都没有写入。')
  return lines.join('\n')
}
