const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
export const b64ToBytes = (text) => Uint8Array.from(atob(String(text)), (c) => c.charCodeAt(0))

export function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

export function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function sha256Base64(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)))
  return bytesToB64(digest)
}

export async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes))
}

export async function pbkdf2(password, salt, iterations, length = 32) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(String(salt)), iterations }, key, length * 8)
  return new Uint8Array(bits)
}

export async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const infoBytes = encoder.encode(info || '')
  const out = new Uint8Array(length)
  let previous = new Uint8Array(0)
  let offset = 0
  let counter = 1
  while (offset < length) {
    const input = new Uint8Array(previous.length + infoBytes.length + 1)
    input.set(previous)
    input.set(infoBytes, previous.length)
    input[input.length - 1] = counter & 0xff
    previous = new Uint8Array(await crypto.subtle.sign('HMAC', key, input))
    const copyLength = Math.min(previous.length, length - offset)
    out.set(previous.slice(0, copyLength), offset)
    offset += copyLength
    counter += 1
  }
  return out
}

/** Decrypt one Bitwarden EncString (type 2 = AES-CBC + HMAC-SHA256). */
export async function decryptBw(cipherString, encKey, macKey) {
  if (typeof cipherString !== 'string' || !cipherString) throw new Error('empty cipher string')
  const dot = cipherString.indexOf('.')
  if (dot <= 0) throw new Error('invalid cipher string')
  const type = Number(cipherString.slice(0, dot))
  const parts = cipherString.slice(dot + 1).split('|')
  const iv = b64ToBytes(parts[0])
  const cipher = b64ToBytes(parts[1])
  if (type === 2) {
    if (!macKey || !parts[2]) throw new Error('missing MAC')
    const expected = await hmacSha256(macKey, concatBytes(iv, cipher))
    if (!constantTimeEqual(expected, b64ToBytes(parts[2]))) throw new Error('MAC mismatch')
  } else if (![0, 1, 4].includes(type)) {
    throw new Error('unsupported cipher type')
  }
  const key = await crypto.subtle.importKey('raw', encKey, { name: 'AES-CBC' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, cipher)
  return new Uint8Array(plain)
}

export async function decryptStr(cipherString, encKey, macKey) {
  return decoder.decode(await decryptBw(cipherString, encKey, macKey))
}

/** Encrypt one Bitwarden EncString (type 2). */
export async function encryptStr(text, encKey, macKey) {
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encKey, { name: 'AES-CBC' }, false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, encoder.encode(String(text))))
  const mac = await hmacSha256(macKey, concatBytes(iv, cipher))
  return `2.${bytesToB64(iv)}|${bytesToB64(cipher)}|${bytesToB64(mac)}`
}

export async function cipherKeys(row, session) {
  const userEnc = b64ToBytes(session.symEncKey)
  const userMac = b64ToBytes(session.symMacKey)
  let itemEnc = userEnc
  let itemMac = userMac
  if (row.key) {
    try {
      const itemKey = await decryptBw(row.key, userEnc, userMac)
      if (itemKey.length >= 64) {
        itemEnc = itemKey.slice(0, 32)
        itemMac = itemKey.slice(32, 64)
      }
    } catch {}
  }
  return { userEnc, userMac, itemEnc, itemMac }
}

/** Unwrap the user's 64-byte symmetric key from the profile key. */
export async function unlockUserKey(profileKey, masterKey) {
  const encKey = await hkdfExpand(masterKey, 'enc', 32)
  const macKey = await hkdfExpand(masterKey, 'mac', 32)
  const userKey = await decryptBw(profileKey, encKey, macKey)
  if (userKey.length < 64) throw new Error('invalid user key')
  return { encKey: userKey.slice(0, 32), macKey: userKey.slice(32, 64) }
}

async function decryptFieldWithFallback(value, itemEnc, itemMac, userEnc, userMac) {
  if (!value) return ''
  try {
    return await decryptStr(value, itemEnc, itemMac)
  } catch {
    if (itemEnc !== userEnc || itemMac !== userMac) {
      try { return await decryptStr(value, userEnc, userMac) } catch {}
    }
    return ''
  }
}

const looksLikeEncrypted = (value) => typeof value === 'string' && /^\d+\./.test(value)

/** Decrypt every nested Bitwarden EncString inside NodeWarden's JSON cipher body. */
async function decryptDeep(value, itemEnc, itemMac, userEnc, userMac) {
  if (typeof value === 'string') {
    if (!looksLikeEncrypted(value)) return value
    return decryptFieldWithFallback(value, itemEnc, itemMac, userEnc, userMac)
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => decryptDeep(entry, itemEnc, itemMac, userEnc, userMac)))
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = await decryptDeep(entry, itemEnc, itemMac, userEnc, userMac)
    }
    return out
  }
  return value
}

/**
 * Decrypt one D1 cipher row. NodeWarden stores `data` as a JSON object whose
 * string fields (login.username/password, uris, fields, ...) are EncStrings;
 * older/imported rows may instead carry a single encrypted string.
 */
export async function decryptCipherRow(row, session) {
  const { userEnc, userMac, itemEnc, itemMac } = await cipherKeys(row, session)
  const name = await decryptFieldWithFallback(row.name, itemEnc, itemMac, userEnc, userMac)
  const notes = await decryptFieldWithFallback(row.notes, itemEnc, itemMac, userEnc, userMac)
  let data = null
  let dataText = ''
  if (row.data) {
    let parsed = null
    try { parsed = JSON.parse(row.data) } catch {}
    if (parsed && typeof parsed === 'object') {
      data = await decryptDeep(parsed, itemEnc, itemMac, userEnc, userMac)
      dataText = JSON.stringify(data)
    } else {
      dataText = await decryptFieldWithFallback(row.data, itemEnc, itemMac, userEnc, userMac)
      try { data = JSON.parse(dataText) } catch {}
    }
  }
  return { id: row.id, type: Number(row.type) || 0, name, notes, data, dataText }
}

export function extractUsername(decrypted) {
  return typeof decrypted?.data?.login?.username === 'string' ? decrypted.data.login.username : ''
}

export function extractTotp(decrypted) {
  return typeof decrypted?.data?.login?.totp === 'string' ? decrypted.data.login.totp : ''
}

export function extractSecret(decrypted, preferredField) {
  const data = decrypted.data
  const fields = Array.isArray(data?.fields) ? data.fields : []
  const fieldValue = (name) => {
    const match = fields.find((field) => String(field?.name ?? '').toLowerCase() === name)
    return typeof match?.value === 'string' ? match.value : ''
  }
  const candidates = []
  if (preferredField) candidates.push(fieldValue(preferredField))
  if (data && typeof data === 'object') {
    candidates.push(data.login?.password, data.password, data.value, data.secret, data.apiKey, data.token)
    if (Array.isArray(data.fields)) candidates.push(...data.fields.map((field) => field?.value))
  }
  if (decrypted.dataText && !data) candidates.push(decrypted.dataText)
  candidates.push(decrypted.notes)
  return candidates.find((value) => typeof value === 'string' && value.length > 0) ?? ''
}

export async function wrapWithKek(bytes, kekBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', kekBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)
  return `${bytesToB64(iv)}.${bytesToB64(new Uint8Array(cipher))}`
}

export async function unwrapWithKek(text, kekBytes) {
  const [ivPart, cipherPart] = String(text).split('.')
  const key = await crypto.subtle.importKey('raw', kekBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivPart) }, key, b64ToBytes(cipherPart))
  return new Uint8Array(plain)
}

export async function hmacToken(keyBytes, text) {
  return bytesToB64(await hmacSha256(keyBytes, encoder.encode(text)))
}
