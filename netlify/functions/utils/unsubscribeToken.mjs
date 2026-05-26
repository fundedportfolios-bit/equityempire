// ═══════════════════════════════════════════════════════════════
// HMAC helpers for unsubscribe links.
//
// Each unsubscribe URL is the email plus a short HMAC-SHA256 signature
// keyed by UNSUBSCRIBE_SECRET. Without the secret, a third party can't
// forge an unsubscribe URL for a different address. The secret itself
// never leaves the server.
//
// Format:  /api/unsubscribe?e=<urlencoded-email>&s=<32-hex-sig>
// ═══════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from 'node:crypto'

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function signEmail(email, secret) {
  const norm = normalizeEmail(email)
  return createHmac('sha256', secret).update(norm).digest('hex').slice(0, 32)
}

export function verifyEmail(email, sig, secret) {
  if (!email || !sig || !secret) return false
  const expected = signEmail(email, secret)
  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))
  } catch { return false }
}

// Build the unsubscribe URL for the email footer / List-Unsubscribe header.
// Caller passes the live site URL (e.g. process.env.URL on Netlify).
export function buildUnsubscribeUrl(siteUrl, email, secret) {
  const sig      = signEmail(email, secret)
  const encEmail = encodeURIComponent(normalizeEmail(email))
  const base     = (siteUrl || '').replace(/\/$/, '')
  return `${base}/api/unsubscribe?e=${encEmail}&s=${sig}`
}
