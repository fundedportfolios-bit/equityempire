// ═══════════════════════════════════════════════════════════════
// adminStats — token-gated all-time game stats endpoint
// Netlify Functions v2 · GET /api/admin-stats?token=<SECRET>
//
// Returns a JSON rollup of the entire gameActivity collection (no time
// filter), aggregated by the same helper the weekly email uses, so the
// admin page and the weekly digest never drift apart.
//
// Security model — "security by obscurity" + a real token check:
//   • The expected token lives ONLY in the ADMIN_STATS_TOKEN env var
//     on Netlify. It is never bundled into the client and never logged.
//   • Comparison is constant-time so the token can't be guessed via
//     response timing.
//   • Any failure path (missing env, missing token, wrong token, admin
//     SDK down, Firestore error) returns plain 404 with no body — the
//     endpoint is indistinguishable from a non-existent URL.
//   • Cache-Control: no-store so no CDN / proxy / browser caches the data.
// ═══════════════════════════════════════════════════════════════

import { timingSafeEqual } from 'node:crypto'
import { getFirebaseAdmin } from './utils/firebaseAdmin.mjs'
import { aggregateActivity } from './utils/aggregateActivity.mjs'

export const config = { path: '/api/admin-stats' }

const notFound = () => new Response(null, { status: 404 })

function constEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  try { return timingSafeEqual(aBuf, bBuf) } catch { return false }
}

export default async (req) => {
  const expected = process.env.ADMIN_STATS_TOKEN
  if (!expected) {
    console.warn('[adminStats] ADMIN_STATS_TOKEN not set — returning 404.')
    return notFound()
  }

  let provided = ''
  try {
    const url = new URL(req.url)
    provided = url.searchParams.get('token') || ''
  } catch { return notFound() }

  if (!constEq(provided, expected)) return notFound()

  const fb = await getFirebaseAdmin()
  if (!fb.hasAdmin) {
    console.error('[adminStats] Firebase Admin unavailable:', fb.reason)
    return notFound()
  }

  let snap
  try {
    // Order desc + cap so a runaway collection can't blow memory. 20k events
    // covers a long runway given the current write volume.
    snap = await fb.db.collection('gameActivity')
      .orderBy('createdAt', 'desc')
      .limit(20000)
      .get()
  } catch (e) {
    console.error('[adminStats] Firestore query failed:', e?.message || e)
    return notFound()
  }

  const events = snap.docs.map(d => d.data())
  const stats  = aggregateActivity(events)

  console.log('[adminStats] served — events:', stats.totalEvents,
    'users:', stats.uniqueLoggedIn, 'guests:', stats.uniqueGuests)

  return new Response(JSON.stringify({ ok: true, stats }), {
    status: 200,
    headers: {
      'Content-Type':  'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
