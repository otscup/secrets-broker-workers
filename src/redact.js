// Best-effort echo scrub for values the broker injected into an upstream request.
// It is not a guarantee against transforms the upstream applies; see SECURITY.md.
export function scrubSecret(input, value, authPrefix = 'Bearer ') {
  if (typeof input !== 'string' || !value) return input
  let out = input
  out = out.split(authPrefix + value).join('[REDACTED]')
  out = out.split(value).join('[REDACTED]')
  out = out.split(encodeURIComponent(value)).join('[REDACTED]')
  out = out.split(Buffer.from(value).toString('base64')).join('[REDACTED]')
  return out
}
