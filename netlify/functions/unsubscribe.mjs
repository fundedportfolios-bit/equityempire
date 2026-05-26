// ═══════════════════════════════════════════════════════════════
// unsubscribe — opt-out endpoint for player-facing email
// Netlify Functions v2 · GET + POST /api/unsubscribe
//
//   • GET  — user clicks the link in the email footer; we verify the
//            HMAC signature, write an emailOptOut record, and show a
//            simple confirmation HTML page.
//   • POST — RFC 8058 one-click unsubscribe (triggered by Gmail/Apple
//            Mail's native "Unsubscribe" button when the message has
//            `List-Unsubscribe-Post: List-Unsubscribe=One-Click`).
//            Returns 200 with no body — the only thing mail clients
//            need to confirm success.
//
// The opt-out record lives in Firestore at emailOptOut/{normalized-email}.
// sendReport.mjs queries this collection before sending and refuses to
// email a recipient who has unsubscribed.
//
// Required env: UNSUBSCRIBE_SECRET (set on Netlify). If missing, the
// endpoint responds 503 — never silently "succeed".
// ═══════════════════════════════════════════════════════════════

import { getFirebaseAdmin } from './utils/firebaseAdmin.mjs'
import { normalizeEmail, verifyEmail } from './utils/unsubscribeToken.mjs'

export const config = { path: '/api/unsubscribe' }

function htmlPage({ title, message, color = '#0f2a43', status = 200 }) {
  const body = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
           background:#f3f5f7; color:#1a2330; display:flex; min-height:100vh;
           align-items:center; justify-content:center; padding:24px; }
    .card { background:#fff; max-width:480px; width:100%; padding:32px;
            border-radius:12px; box-shadow:0 6px 32px rgba(0,0,0,0.08);
            text-align:center; }
    h1 { margin:0 0 12px; color:${color}; font-size:22px; font-weight:700; }
    p { margin:8px 0; color:#465061; line-height:1.55; font-size:15px; }
    .small { color:#9aa5b1; font-size:12px; margin-top:18px; }
    strong { color:#0f2a43; }
  </style>
</head><body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="small">Equity Empire</p>
  </div>
</body></html>`
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function recordOptOut(email) {
  const fb = await getFirebaseAdmin()
  if (!fb.hasAdmin) {
    console.warn('[unsubscribe] Firebase Admin unavailable:', fb.reason)
    return { ok: false, reason: 'admin-unavailable' }
  }
  try {
    await fb.db.collection('emailOptOut').doc(email).set({
      email,
      optedOutAt: fb.FieldValue.serverTimestamp(),
      source: 'email-link',
    }, { merge: true })
    return { ok: true }
  } catch (e) {
    console.error('[unsubscribe] Firestore write failed:', e?.message || e)
    return { ok: false, reason: 'write-failed' }
  }
}

export default async (req) => {
  const secret = process.env.UNSUBSCRIBE_SECRET
  if (!secret) {
    console.warn('[unsubscribe] UNSUBSCRIBE_SECRET not set.')
    return htmlPage({
      title:   'Unsubscribe unavailable',
      message: 'Unsubscribe is not configured on the server. Please reply to the email and we will remove you manually.',
      color:   '#b91c1c',
      status:  503,
    })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Token comes from the query string on both GET and POST (the
  // List-Unsubscribe header points at the same signed URL).
  let email = ''
  let sig   = ''
  try {
    const url = new URL(req.url)
    email = normalizeEmail(url.searchParams.get('e') || '')
    sig   = url.searchParams.get('s') || ''
  } catch {
    return htmlPage({
      title:   'Invalid link',
      message: 'This unsubscribe link looks malformed. Reply to the email and we will help.',
      color:   '#b91c1c',
      status:  400,
    })
  }

  if (!email || !verifyEmail(email, sig, secret)) {
    return htmlPage({
      title:   'Link expired',
      message: 'This unsubscribe link is invalid or expired. Reply to the email and we will remove you manually.',
      color:   '#b91c1c',
      status:  400,
    })
  }

  const result = await recordOptOut(email)
  if (!result.ok) {
    return htmlPage({
      title:   'Something went wrong',
      message: 'We could not record your unsubscribe right now. Please reply to the email and we will remove you manually.',
      color:   '#b91c1c',
      status:  500,
    })
  }

  console.log('[unsubscribe] opted out:', email, '| method:', req.method)

  // RFC 8058 one-click: Gmail/Apple just want a 2xx and won't render the body.
  if (req.method === 'POST') {
    return new Response('', { status: 200, headers: { 'cache-control': 'no-store' } })
  }

  return htmlPage({
    title:   "You're unsubscribed",
    message: `<strong>${email}</strong> has been removed from Equity Empire emails. You won't receive any more reports unless you request one again from inside the game.`,
  })
}
