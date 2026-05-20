// ═══════════════════════════════════════════════════════════════
// logGameActivity — Equity Empire activity-tracking endpoint
// Netlify Functions v2 · exposed at /api/logGameActivity
//
// Accepts safe event payloads from the game and writes them to a Firestore
// `gameActivity` collection. Anonymous play is supported via guestId; if
// the client sends a Firebase ID token we verify it server-side and record
// the verified uid.
//
// Privacy:
//   • Only meaningful events are accepted (eventType allow-list).
//   • playerName / playerEmail are stored ONLY for report/support events
//     where the player explicitly typed them in.
//   • Frontend cannot set arbitrary fields — only the whitelisted ones
//     below are copied through.
//   • No raw game state is stored. The `details` object is hard-capped.
// ═══════════════════════════════════════════════════════════════

import { getFirebaseAdmin } from './utils/firebaseAdmin.mjs'

export const config = { path: '/api/logGameActivity' }

const MAX_BODY_BYTES = 32 * 1024  // 32 KB — way more than we ever need
const MAX_DETAILS_KEYS = 20
const MAX_STRING_LEN   = 200

const ALLOWED_EVENT_TYPES = new Set([
  'session_started',
  'report_requested',
  'support_requested',
  'goal_reached',
  'milestone_reached',
  'property_acquired',
  'refinance_completed',
  'upgrade_completed',
  'staff_hired',
  'game_snapshot',
])

const ALLOWED_CONTACT_PREFS = new Set(['reportOnly', 'requestSupport'])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  })
}

// Sanitize a string: trim, drop ASCII control bytes (0-31 and 127), cap length.
// Uses an explicit code-point loop so this source file stays free of any
// literal control characters.
function sanitizeString(v, maxLen = MAX_STRING_LEN) {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  let out = ''
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0)
    if (cp >= 32 && cp !== 127) out += ch
    if (out.length >= maxLen) break
  }
  return out || null
}

function sanitizeNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function sanitizeDetails(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  const out = {}
  let count = 0
  for (const [k, v] of Object.entries(d)) {
    if (count >= MAX_DETAILS_KEYS) break
    const key = sanitizeString(k, 64)
    if (!key) continue
    if (v == null) { out[key] = null; count++; continue }
    if (typeof v === 'string')  { out[key] = sanitizeString(v); count++; continue }
    if (typeof v === 'number')  { out[key] = Number.isFinite(v) ? v : null; count++; continue }
    if (typeof v === 'boolean') { out[key] = v; count++; continue }
    // Skip nested objects/arrays — keep details flat + safe.
  }
  return out
}

export default async (req) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || ''
  const corsHeaders = {
    'access-control-allow-origin':  allowedOrigin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
  }

  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed.' }, 405, corsHeaders)
  }

  // Origin validation
  const origin  = req.headers.get('origin') || ''
  const referer = req.headers.get('referer') || ''
  if (allowedOrigin) {
    const ok = origin === allowedOrigin || referer.startsWith(allowedOrigin)
    if (!ok) return json({ ok: false, error: 'Forbidden: origin not allowed.' }, 403, corsHeaders)
  }

  // Body size + JSON
  let raw
  try { raw = await req.text() } catch { return json({ ok: false, error: 'Could not read body.' }, 400, corsHeaders) }
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: 'Body too large.' }, 413, corsHeaders)
  let body
  try { body = JSON.parse(raw) } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400, corsHeaders) }

  // Event type allow-list
  const eventType = sanitizeString(body?.eventType, 50)
  if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
    return json({ ok: false, error: 'Invalid event type.' }, 400, corsHeaders)
  }

  // Identity — sanitize even before Firebase verify
  const sessionId  = sanitizeString(body?.sessionId, 64)
  const guestId    = sanitizeString(body?.guestId, 64)
  if (!sessionId) {
    return json({ ok: false, error: 'Missing sessionId.' }, 400, corsHeaders)
  }

  // Optional ID token — verify if Admin is configured.
  const authHeader = req.headers.get('authorization') || ''
  const idToken    = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  let verifiedUid     = null
  let verifiedProvider = null
  const fbAdmin = await getFirebaseAdmin()

  if (idToken && fbAdmin.hasAdmin) {
    const decoded = await fbAdmin.verifyIdToken(idToken)
    if (decoded) {
      verifiedUid     = decoded.uid
      verifiedProvider = decoded.firebase?.sign_in_provider || null
    }
  }

  // Optional player-supplied identifiers (only valid for report/support events)
  const isReportLike = eventType === 'report_requested' || eventType === 'support_requested'
  const playerName   = isReportLike ? sanitizeString(body?.playerName, 120) : null
  const playerEmail  = isReportLike ? sanitizeString(body?.playerEmail, 200) : null
  if (playerEmail && !EMAIL_RE.test(playerEmail)) {
    return json({ ok: false, error: 'Invalid email format.' }, 400, corsHeaders)
  }

  const contactPreference = isReportLike && ALLOWED_CONTACT_PREFS.has(body?.contactPreference)
    ? body.contactPreference
    : null
  const requestedSupport = isReportLike && body?.requestedSupport === true
    ? true
    : (contactPreference === 'requestSupport')

  // Game stats — all optional, all numeric
  const monthlyCashFlow  = sanitizeNumber(body?.monthlyCashFlow)
  const portfolioValue   = sanitizeNumber(body?.portfolioValue)
  const totalEquity      = sanitizeNumber(body?.totalEquity)
  const cashOnHand       = sanitizeNumber(body?.cashOnHand)
  const propertiesOwned  = sanitizeNumber(body?.propertiesOwned)
  const monthsPlayed     = sanitizeNumber(body?.monthsPlayed)
  const milestoneName    = sanitizeString(body?.milestoneName, 64)
  const details          = sanitizeDetails(body?.details)

  if (!fbAdmin.hasAdmin) {
    // No Firestore — accept and no-op so the frontend never crashes mid-game.
    // The `reason` and (when available) `code` come from getFirebaseAdmin and
    // are categorical, not value-leaking — safe to return.
    console.warn(`[logGameActivity] Admin disabled (${fbAdmin.reason || 'unknown'}); dropping event ${eventType}`)
    return json({
      ok:      true,
      stored:  false,
      reason:  fbAdmin.reason || 'admin-disabled',
      missing: fbAdmin.missing || null,
      code:    fbAdmin.code    || null,
      message: fbAdmin.message || null,
    }, 200, corsHeaders)
  }

  // Build document. Field is omitted (vs null) when not supplied — keeps the
  // collection tidy and avoids accidentally storing empty strings.
  const doc = {
    eventType,
    createdAt: fbAdmin.FieldValue.serverTimestamp(),
    sessionId,
    guestId:        guestId  || null,
    uid:            verifiedUid     || null,
    authProvider:   verifiedProvider || null,
    playerName:     playerName  || null,
    playerEmail:    playerEmail || null,
    contactPreference: contactPreference || null,
    requestedSupport: !!requestedSupport,
    monthlyCashFlow,
    portfolioValue,
    totalEquity,
    cashOnHand,
    propertiesOwned,
    monthsPlayed,
    milestoneName:  milestoneName || null,
    details:        details || null,
    source:         'equityEmpireGame',
  }

  try {
    await fbAdmin.db.collection('gameActivity').add(doc)
    return json({ ok: true }, 200, corsHeaders)
  } catch (e) {
    console.error('[logGameActivity] Firestore write failed:', e?.message || e)
    return json({ ok: false, error: 'Could not save activity.' }, 500, corsHeaders)
  }
}
