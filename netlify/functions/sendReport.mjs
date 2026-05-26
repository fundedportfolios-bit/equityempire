// ═══════════════════════════════════════════════════════════════
// sendReport — Equity Empire detailed gameplay report email
// Netlify Functions v2 · exposed at /api/sendReport (config.path below)
//
// PLAYER-FACING FLOW (replaces the earlier internal-testing mode that
// always emailed the owner only):
//   • The player submits { player:{name,email}, contactPreference, payload }
//   • The detailed HTML+text report is emailed to the PLAYER.
//   • from = REPORT_FROM_EMAIL, replyTo = REPORT_OWNER_EMAIL.
//   • Only if contactPreference === 'requestSupport' do we ALSO send a
//     lead-notification email to REPORT_OWNER_EMAIL.
//
// Secrets come from Netlify env only — never hard-coded, never shipped to
// the browser:
//   RESEND_API_KEY     — Resend API key (server only)
//   REPORT_FROM_EMAIL  — "Equity Empire <equityempire_results@fundedportfolios.com>"
//   REPORT_OWNER_EMAIL — fundedportfolios@gmail.com
//   ALLOWED_ORIGIN     — https://equityempiregame.netlify.app
//
// The frontend NEVER chooses the sender, CC, or BCC. The only recipients
// the backend will ever email are: (a) the validated player address, and
// (b) REPORT_OWNER_EMAIL — and (b) only when requestedSupport is true.
// ═══════════════════════════════════════════════════════════════

import { getFirebaseAdmin } from './utils/firebaseAdmin.mjs'
import { normalizeEmail, buildUnsubscribeUrl } from './utils/unsubscribeToken.mjs'

export const config = {
  path: '/api/sendReport',
}

const MAX_BODY_BYTES = 256 * 1024 // 256 KB hard cap on the request body
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  })
}

function num(n) {
  const v = Number(n)
  if (!isFinite(v)) return '—'
  return `$${Math.round(v).toLocaleString('en-US')}`
}

function plain(n) {
  const v = Number(n)
  return isFinite(v) ? v.toLocaleString('en-US') : '—'
}

// Escape user-submitted + payload text before embedding in HTML.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── HTML report (player-facing) ──────────────────────────────
function buildPlayerHtml(payload, playerName, unsubUrl) {
  const s   = payload?.summary || {}
  const m   = payload?.milestones || {}
  const pb  = payload?.propertyBreakdown || {}
  const snaps = payload?.charts?.monthlySnapshots || []
  const hist  = payload?.history || []

  const pvMs = m.portfolioValueMilestones || {}
  const cfMs = m.monthlyCashFlowMilestones || {}

  const reachedRows = (label, map) =>
    Object.keys(map)
      .filter(k => map[k] != null)
      .sort((a, b) => Number(a) - Number(b))
      .map(k => `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">${label} ${num(k)}</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">Month ${plain(map[k])}</td></tr>`)
      .join('')

  const propCounts = pb.propertyCountsByType || {}
  const propRows = Object.keys(propCounts)
    .map(name => `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">${esc(name)}</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(propCounts[name])}</td></tr>`)
    .join('') || `<tr><td colspan="2" style="padding:4px 10px;color:#888;">No properties owned</td></tr>`

  // Growth sampling: first + every ~10th + last snapshot.
  const sampled = snaps.filter((_, i) => i === 0 || i === snaps.length - 1 || i % 10 === 0)
  const firstSnap = snaps[0]
  const lastSnap  = snaps[snaps.length - 1]
  const growthRows = sampled
    .map(sn => `<tr>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;">Mo ${plain(sn.month)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(sn.portfolioValue)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(sn.equity)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(sn.netCashFlow)}/mo</td>
    </tr>`)
    .join('') || `<tr><td colspan="4" style="padding:4px 10px;color:#888;">No snapshots recorded</td></tr>`

  const recentHist = hist.slice(-20).reverse()
    .map(h => `<tr>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;">Mo ${plain(h.month)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;">${esc(h.title)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${h.amount != null ? num(h.amount) : ''}</td>
    </tr>`)
    .join('') || `<tr><td colspan="3" style="padding:4px 10px;color:#888;">No major events recorded</td></tr>`

  // Plain-English growth blurb.
  let growthBlurb = ''
  if (firstSnap && lastSnap && firstSnap !== lastSnap) {
    growthBlurb = `Over ${plain(s.monthsPlayed)} months your portfolio went from
      ${num(firstSnap.portfolioValue)} to ${num(lastSnap.portfolioValue)} and your
      net monthly cash flow moved from ${num(firstSnap.netCashFlow)}/mo to
      ${num(lastSnap.netCashFlow)}/mo.`
  } else {
    growthBlurb = `You finished with a portfolio value of ${num(s.finalPortfolioValue)}
      and net monthly cash flow of ${num(s.finalNetCashFlow)}/mo.`
  }

  const goal = payload?.playerInfo?.desiredMonthlyCashFlow ?? null
  const goalLine = goal != null
    ? `${num(goal)}/mo${m.desiredCashFlowAchievedMonth != null ? ` — achieved in month ${plain(m.desiredCashFlowAchievedMonth)}` : ' — not yet achieved'}`
    : 'Not set'

  const th = 'padding:6px 10px;text-align:left;background:#0f2a43;color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:.04em;'
  const sectionTitle = 'margin:28px 0 8px;font-size:16px;color:#0f2a43;border-bottom:2px solid #38bdf8;padding-bottom:4px;'
  const rowL = 'padding:4px 10px;border-bottom:1px solid #eee;'
  const rowR = 'padding:4px 10px;border-bottom:1px solid #eee;text-align:right;'

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2330;">
  <div style="max-width:680px;margin:0 auto;padding:24px;">
    <div style="background:#0f2a43;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;">
      <h1 style="margin:0;font-size:22px;">🏙️ Your Equity Empire Report</h1>
      <p style="margin:6px 0 0;color:#9fc4e3;font-size:13px;">Difficulty: ${esc(payload?.difficulty || '—')}</p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 10px 10px;">

      <p style="font-size:15px;line-height:1.6;">Hi ${esc(playerName)},</p>
      <p style="font-size:14px;line-height:1.6;color:#46506180;color:#465061;">
        Here's the detailed summary of how your real estate empire played out.
      </p>

      <h2 style="${sectionTitle}">Portfolio Growth</h2>
      <p style="font-size:14px;line-height:1.6;color:#465061;">${growthBlurb}</p>

      <h2 style="${sectionTitle}">Session Summary</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="${rowL}">Starting cash</td><td style="${rowR}">${num(s.startingCash)}</td></tr>
        <tr><td style="${rowL}">Cash on hand</td><td style="${rowR}">${num(s.finalCash)}</td></tr>
        <tr><td style="${rowL}">Portfolio value</td><td style="${rowR}">${num(s.finalPortfolioValue)}</td></tr>
        <tr><td style="${rowL}">Total equity</td><td style="${rowR}">${num(s.finalEquity)}</td></tr>
        <tr><td style="${rowL}">Total debt</td><td style="${rowR}">${num(s.finalDebt)}</td></tr>
        <tr><td style="${rowL}">Monthly income</td><td style="${rowR}">${num(s.finalMonthlyIncome)}</td></tr>
        <tr><td style="${rowL}">Monthly expenses</td><td style="${rowR}">${num(s.finalMonthlyExpenses)}</td></tr>
        <tr><td style="${rowL}"><strong>Net monthly cash flow</strong></td><td style="${rowR}"><strong>${num(s.finalNetCashFlow)}/mo</strong></td></tr>
        <tr><td style="${rowL}">Cash flow goal</td><td style="${rowR}">${esc(goalLine)}</td></tr>
        <tr><td style="${rowL}">Months played</td><td style="${rowR}">${plain(s.monthsPlayed)}</td></tr>
        <tr><td style="${rowL}">Properties owned</td><td style="${rowR}">${plain(s.propertiesOwned)}</td></tr>
      </table>

      <h2 style="${sectionTitle}">What You Did</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="${rowL}">Properties purchased</td><td style="${rowR}">${plain(s.propertiesPurchased)}</td></tr>
        <tr><td style="${rowL}">Properties sold</td><td style="${rowR}">${plain(s.propertiesSold)}</td></tr>
        <tr><td style="${rowL}">Refinances completed</td><td style="${rowR}">${plain(s.refinancesCompleted)}</td></tr>
        <tr><td style="${rowL}">Total cash out from refinances</td><td style="${rowR}">${num(s.totalCashOutFromRefinances)}</td></tr>
        <tr><td style="${rowL}">Upgrades completed</td><td style="${rowR}">${plain(s.upgradesCompleted)}</td></tr>
        <tr><td style="${rowL}">Staff hired</td><td style="${rowR}">${plain(s.staffHired)}</td></tr>
        <tr><td style="${rowL}">Maintenance issues resolved</td><td style="${rowR}">${plain(s.maintenanceIssuesResolved)}</td></tr>
        <tr><td style="${rowL}">Critical issues resolved</td><td style="${rowR}">${plain(s.criticalIssuesResolved)}</td></tr>
        <tr><td style="${rowL}">Trivia bonus earned</td><td style="${rowR}">${num(s.triviaBonusEarned)}</td></tr>
      </table>

      <h2 style="${sectionTitle}">Milestones Reached</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${reachedRows('Portfolio', pvMs)}
        ${reachedRows('Cash flow', cfMs)}
        ${m.firstPropertyPurchaseMonth != null ? `<tr><td style="${rowL}">First property purchase</td><td style="${rowR}">Month ${plain(m.firstPropertyPurchaseMonth)}</td></tr>` : ''}
        ${m.firstRefinanceMonth != null ? `<tr><td style="${rowL}">First refinance</td><td style="${rowR}">Month ${plain(m.firstRefinanceMonth)}</td></tr>` : ''}
        ${m.firstStaffHireMonth != null ? `<tr><td style="${rowL}">First staff hire</td><td style="${rowR}">Month ${plain(m.firstStaffHireMonth)}</td></tr>` : ''}
      </table>

      <h2 style="${sectionTitle}">Property Breakdown</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><th style="${th}">Type</th><th style="${th}text-align:right;">Count</th></tr>
        ${propRows}
      </table>

      <h2 style="${sectionTitle}">Growth History</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><th style="${th}">Month</th><th style="${th}text-align:right;">Portfolio</th><th style="${th}text-align:right;">Equity</th><th style="${th}text-align:right;">Net CF</th></tr>
        ${growthRows}
      </table>

      <h2 style="${sectionTitle}">Recent Notable Moves</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><th style="${th}">Month</th><th style="${th}">Event</th><th style="${th}text-align:right;">Amount</th></tr>
        ${recentHist}
      </table>

      <div style="margin-top:28px;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:12px;color:#7c4a03;line-height:1.5;">
        <strong>Disclaimer:</strong> Equity Empire is a game and educational tool.
        This report is based on gameplay results and is not investment, tax, legal,
        or lending advice.
      </div>

      <p style="margin-top:18px;font-size:12px;color:#9aa5b1;line-height:1.55;text-align:center;">
        You received this because you requested a report from Equity Empire.
        Your email is only used to send this report and respond if you asked for follow-up.
        ${unsubUrl
          ? `<br>Don't want these emails? <a href="${unsubUrl}" style="color:#9aa5b1;text-decoration:underline;">Unsubscribe</a>.`
          : ''}
      </p>
    </div>
  </div>
</body></html>`
}

// ─── Plain-text fallback ──────────────────────────────────────
function buildPlayerText(payload, playerName, unsubUrl) {
  const s = payload?.summary || {}
  const lines = [
    `Hi ${playerName},`,
    '',
    `Here's your Equity Empire report (difficulty: ${payload?.difficulty || '—'}).`,
    '',
    'SESSION SUMMARY',
    `  Starting cash:        ${num(s.startingCash)}`,
    `  Cash on hand:         ${num(s.finalCash)}`,
    `  Portfolio value:      ${num(s.finalPortfolioValue)}`,
    `  Total equity:         ${num(s.finalEquity)}`,
    `  Total debt:           ${num(s.finalDebt)}`,
    `  Net monthly cashflow: ${num(s.finalNetCashFlow)}/mo`,
    `  Months played:        ${plain(s.monthsPlayed)}`,
    `  Properties owned:     ${plain(s.propertiesOwned)}`,
    '',
    'WHAT YOU DID',
    `  Properties purchased: ${plain(s.propertiesPurchased)}`,
    `  Properties sold:      ${plain(s.propertiesSold)}`,
    `  Refinances:           ${plain(s.refinancesCompleted)}`,
    `  Cash out from refis:  ${num(s.totalCashOutFromRefinances)}`,
    `  Upgrades completed:   ${plain(s.upgradesCompleted)}`,
    `  Staff hired:          ${plain(s.staffHired)}`,
    `  Issues resolved:      ${plain(s.maintenanceIssuesResolved)}`,
    `  Trivia bonus earned:  ${num(s.triviaBonusEarned)}`,
    '',
    'Disclaimer: Equity Empire is a game and educational tool. This report is',
    'based on gameplay results and is not investment, tax, legal, or lending advice.',
    '',
    'You received this because you requested a report from Equity Empire.',
    ...(unsubUrl ? [`Unsubscribe: ${unsubUrl}`] : []),
  ]
  return lines.join('\n')
}

// ─── Owner lead-notification (only when requestSupport) ───────
function buildOwnerHtml(payload, player) {
  const s = payload?.summary || {}
  const goal = payload?.playerInfo?.desiredMonthlyCashFlow ?? null
  const rowL = 'padding:5px 10px;border-bottom:1px solid #eee;'
  const rowR = 'padding:5px 10px;border-bottom:1px solid #eee;text-align:right;'
  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a2330;">
  <div style="max-width:560px;margin:0 auto;padding:20px;">
    <h2 style="color:#0f2a43;">Equity Empire — Support Request</h2>
    <p>A player explicitly asked for follow-up about applying this to real-world investing.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="${rowL}">Name</td><td style="${rowR}">${esc(player.name)}</td></tr>
      <tr><td style="${rowL}">Email</td><td style="${rowR}">${esc(player.email)}</td></tr>
      <tr><td style="${rowL}">Contact preference</td><td style="${rowR}">requestSupport</td></tr>
      <tr><td style="${rowL}">Cash flow goal</td><td style="${rowR}">${goal != null ? num(goal) + '/mo' : 'Not set'}</td></tr>
      <tr><td style="${rowL}">Net monthly cash flow</td><td style="${rowR}">${num(s.finalNetCashFlow)}/mo</td></tr>
      <tr><td style="${rowL}">Portfolio value</td><td style="${rowR}">${num(s.finalPortfolioValue)}</td></tr>
      <tr><td style="${rowL}">Total equity</td><td style="${rowR}">${num(s.finalEquity)}</td></tr>
      <tr><td style="${rowL}">Cash on hand</td><td style="${rowR}">${num(s.finalCash)}</td></tr>
      <tr><td style="${rowL}">Properties owned</td><td style="${rowR}">${plain(s.propertiesOwned)}</td></tr>
      <tr><td style="${rowL}">Months played</td><td style="${rowR}">${plain(s.monthsPlayed)}</td></tr>
    </table>
    <p style="margin-top:14px;font-size:13px;color:#465061;">
      This player checked: "I'm building a portfolio and have real questions.
      Somebody email me, please." Reply directly to ${esc(player.email)}.
    </p>
  </div>
</body></html>`
}

async function sendViaResend(apiKey, message) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type':  'application/json',
    },
    body: JSON.stringify(message),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, status: res.status, detail }
  }
  return { ok: true }
}

export default async (req) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || ''
  const corsHeaders = {
    'access-control-allow-origin':  allowedOrigin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders })
  }

  // 1. POST only
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed. Use POST.' }, 405, corsHeaders)
  }

  // 2/3. Origin validation
  const origin  = req.headers.get('origin') || ''
  const referer = req.headers.get('referer') || ''
  if (allowedOrigin) {
    const originOk  = origin === allowedOrigin
    const refererOk = referer.startsWith(allowedOrigin)
    if (!originOk && !refererOk) {
      return json({ ok: false, error: 'Forbidden: origin not allowed.' }, 403, corsHeaders)
    }
  }

  // 11. Body size limit
  let raw
  try {
    raw = await req.text()
  } catch {
    return json({ ok: false, error: 'Could not read request body.' }, 400, corsHeaders)
  }
  if (raw.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Request body too large.' }, 413, corsHeaders)
  }

  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400, corsHeaders)
  }

  // 7/8/9/10. Validate inputs — never trust the frontend blindly.
  const player  = body?.player || {}
  const name    = typeof player.name === 'string'  ? player.name.trim()  : ''
  const email   = typeof player.email === 'string' ? player.email.trim() : ''
  const pref    = body?.contactPreference
  const payload = body?.payload

  if (!name) {
    return json({ ok: false, error: 'Please enter your name.' }, 400, corsHeaders)
  }
  if (name.length > 120) {
    return json({ ok: false, error: 'Name is too long.' }, 400, corsHeaders)
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 200) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400, corsHeaders)
  }
  if (pref !== 'reportOnly' && pref !== 'requestSupport') {
    return json({ ok: false, error: 'Invalid contact preference.' }, 400, corsHeaders)
  }
  if (!payload || typeof payload !== 'object' || !payload.summary) {
    return json({ ok: false, error: 'Missing or invalid report payload.' }, 400, corsHeaders)
  }

  // 4/5/6. Server config
  const apiKey     = process.env.RESEND_API_KEY
  const fromEmail  = process.env.REPORT_FROM_EMAIL
  const ownerEmail = process.env.REPORT_OWNER_EMAIL
  if (!apiKey || !fromEmail || !ownerEmail) {
    return json({ ok: false, error: 'Server email configuration is incomplete.' }, 500, corsHeaders)
  }

  const requestedSupport = pref === 'requestSupport'
  const normalizedEmail  = normalizeEmail(email)

  // ── Opt-out check ───────────────────────────────────────────────────
  // If this address previously unsubscribed via /api/unsubscribe, do NOT
  // send another email. Fail-open if Firebase Admin is unavailable so a
  // transient Firestore outage doesn't block a player's report.
  const unsubSecret = process.env.UNSUBSCRIBE_SECRET || ''
  try {
    const fb = await getFirebaseAdmin()
    if (fb.hasAdmin) {
      const doc = await fb.db.collection('emailOptOut').doc(normalizedEmail).get()
      if (doc.exists) {
        console.log('[sendReport] Recipient previously unsubscribed:', normalizedEmail)
        return json({
          ok: false,
          error: "This email address has unsubscribed from Equity Empire emails. " +
                 "Reply to a prior email if you'd like us to re-subscribe you.",
        }, 400, corsHeaders)
      }
    }
  } catch (e) {
    console.warn('[sendReport] opt-out check failed (sending anyway):', e?.message)
  }

  // Build the unsubscribe URL once per request. Site URL is auto-provided
  // by Netlify in the URL env var; SITE_URL is a manual override.
  const siteUrl  = process.env.URL || process.env.SITE_URL || ''
  const unsubUrl = (siteUrl && unsubSecret)
    ? buildUnsubscribeUrl(siteUrl, normalizedEmail, unsubSecret)
    : null
  if (!unsubUrl) {
    console.warn('[sendReport] Unsubscribe URL not built — missing URL/SITE_URL or UNSUBSCRIBE_SECRET env. ' +
                 'Email will send without an unsubscribe footer.')
  }

  // ── Firestore lead storage (intentionally NOT wired up) ──────────────
  // TODO: Persisting a `reportRequests` record from this serverless
  // function would require firebase-admin + a service-account credential
  // (e.g. a FIREBASE_SERVICE_ACCOUNT env var holding the JSON key) because
  // the project only ships the Firebase *client* SDK to the browser. The
  // client SDK can't authenticate a trusted server write here. To enable:
  //   1. Create a service account in the Firebase console, download JSON.
  //   2. Add it as a Netlify env var (single-line JSON), e.g.
  //      FIREBASE_SERVICE_ACCOUNT.
  //   3. `npm i firebase-admin`, init with cert(JSON.parse(env)), then
  //      db.collection('reportRequests').add({ playerName, playerEmail,
  //      contactPreference, requestedSupport, reportRequested:true,
  //      createdAt: FieldValue.serverTimestamp(), firebaseUid,
  //      finalMonthlyCashFlow, finalPortfolioValue, finalEquity,
  //      cashOnHand, propertiesOwned, monthsPlayed, status:'new',
  //      source:'equityEmpireReportButton' }).
  // Per the requirements, we do NOT block the email flow on this — the
  // report still sends. The frontend already passes payload.firebaseUid
  // when available so it's ready to persist once the above is set up.

  // 12/13/14/15/16. Send the detailed report to the PLAYER.
  const html = buildPlayerHtml(payload, name, unsubUrl)
  const text = buildPlayerText(payload, name, unsubUrl)
  const subject = `Your Equity Empire Report — ${payload?.summary?.monthsPlayed ?? '?'} months, ${num(payload?.summary?.finalPortfolioValue)} portfolio`

  // RFC 2369 + RFC 8058: List-Unsubscribe with one-click POST lets Gmail
  // and Apple Mail show a native "Unsubscribe" button in the message header
  // and trigger our /api/unsubscribe endpoint without a round-trip click.
  const playerHeaders = unsubUrl
    ? {
        'List-Unsubscribe':      `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      }
    : undefined

  const playerSend = await sendViaResend(apiKey, {
    from:     fromEmail,
    to:       [email],            // validated player address only
    reply_to: ownerEmail,
    subject,
    html,
    text,
    ...(playerHeaders ? { headers: playerHeaders } : {}),
  })

  if (!playerSend.ok) {
    console.error('[sendReport] Player email failed', playerSend.status, playerSend.detail)
    return json({ ok: false, error: `Email provider rejected the request (${playerSend.status || 'unknown'}).` }, 502, corsHeaders)
  }

  // 17/18. Owner lead notification — ONLY when the player asked for support.
  if (requestedSupport) {
    const ownerSend = await sendViaResend(apiKey, {
      from:     fromEmail,
      to:       [ownerEmail],
      reply_to: email,            // so the owner can reply straight to the player
      subject:  'Equity Empire support request',
      html:     buildOwnerHtml(payload, { name, email }),
    })
    if (!ownerSend.ok) {
      // Don't fail the whole request — the player already got their report.
      console.error('[sendReport] Owner lead email failed', ownerSend.status, ownerSend.detail)
    } else {
      console.log('[sendReport] Support lead notified for', email)
    }
  }

  console.log('[sendReport] Report sent to player', email,
    '| support:', requestedSupport,
    '| months:', payload?.summary?.monthsPlayed,
    '| portfolio:', payload?.summary?.finalPortfolioValue)

  return json({ ok: true }, 200, corsHeaders)
}
