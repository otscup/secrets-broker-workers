/**
 * Comparing two brokers, stage 1.
 *
 * Both sides hand over the same Bitwarden blobs that sit in their databases
 * (`2.iv|ct|mac`), so this module never sees a credential and never needs the
 * master key. That is the whole reason sync is possible at all: the ciphertext
 * is portable, the key is not.
 *
 * Stage 1 only reads. Nothing is written to either broker, and `--apply` is
 * deliberately absent until the merge rules are agreed.
 */

const pull = async (baseUrl, token) => {
  const response = await fetch(`${baseUrl}/sync/pull`, {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  const text = await response.text()
  if (!response.ok) {
    let message = text
    try {
      const parsed = JSON.parse(text)
      message = parsed?.error ?? parsed?.message ?? text
    } catch {}
    throw new Error(`${baseUrl}/sync/pull answered ${response.status}: ${String(message).slice(0, 200)}`)
  }
  const body = JSON.parse(text)
  if (!Array.isArray(body.items)) throw new Error(`${baseUrl}/sync/pull did not return items`)
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

const when = (item) => item?.updatedAt ?? item?.createdAt ?? '—'

export function formatDiff(diff, { localUrl, remoteUrl, verbose = false } = {}) {
  const lines = []
  const total = diff.push.length + diff.pull.length + diff.delete.length + diff.equal + diff.conflict.length
  lines.push(`local:  ${localUrl}`)
  lines.push(`remote: ${remoteUrl}`)
  lines.push('')
  lines.push(`本地条目 ${diff.push.length + diff.pull.length + diff.delete.length + diff.equal + diff.conflict.length} 与远端比对完成（去重后 ${total} 个 id）`)
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

export async function runSync({ localUrl, localToken, remoteUrl, remoteToken, verbose = false }) {
  if (!remoteUrl) throw new Error('missing --remote URL')
  const [local, remote] = await Promise.all([pull(localUrl, localToken), pull(remoteUrl, remoteToken)])
  const diff = diffVaults(local.items, remote.items)
  const text = formatDiff(diff, { localUrl, remoteUrl, verbose })
  return { local, remote, diff, text }
}
