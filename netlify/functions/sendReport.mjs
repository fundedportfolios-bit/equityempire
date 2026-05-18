// ═══════════════════════════════════════════════════════════════
// sendReport — Equity Empire gameplay report email (Netlify Function v2)
//
// ⚠️  TEMPORARY INTERNAL TESTING MODE ⚠️
// This function ALWAYS sends the report to REPORT_OWNER_EMAIL only,
// regardless of anything the frontend sends. The frontend does NOT
// collect a player name/email yet and we are NOT emailing players.
// This phase exists purely to iterate on the HTML report formatting.
//
// LATER: switch to collecting the player's name + email on the frontend,
// validate consent, and send the report to the player (with this owner
// copy optionally kept as a BCC/archive). When that happens, replace the
// hard-coded `to: ownerEmail` below with the validated player address.
//
// Secrets come from Netlify environment variables — never hard-coded,
// never shipped to the browser:
//   RESEND_API_KEY     — Resend API key (server only)
//   REPORT_FROM_EMAIL  — "Equity Empire <equityempire_results@fundedportfolios.com>"
//   REPORT_OWNER_EMAIL — fundedportfolios@gmail.com (the only recipient for now)
//   ALLOWED_ORIGIN     — https://equityempiregame.netlify.app
//
// Exposed at /api/sendReport via the config.path export below.
// ═══════════════════════════════════════════════════════════════

export const config = {
  path: '/api/sendReport',
}

const MAX_BODY_BYTES = 256 * 1024 // 256 KB hard cap on the request body

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

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Build the detailed internal HTML email from the report payload. Defensive
// against missing fields — older saves may not have every section.
function buildHtml(payload) {
  const s   = payload?.summary || {}
  const m   = payload?.milestones || {}
  const pb  = payload?.propertyBreakdown || {}
  const rec = payload?.currentRecords || {}
  const snaps = payload?.charts?.monthlySnapshots || []
  const hist  = payload?.history || []

  const pvMs = m.portfolioValueMilestones || {}
  const cfMs = m.monthlyCashFlowMilestones || {}

  const reachedRow = (label, map) =>
    Object.keys(map)
      .filter(k => map[k] != null)
      .sort((a, b) => Number(a) - Number(b))
      .map(k => `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">${label} ${num(k)}</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">Month ${plain(map[k])}</td></tr>`)
      .join('')

  const propCounts = pb.propertyCountsByType || {}
  const propRows = Object.keys(propCounts)
    .map(name => `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">${esc(name)}</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(propCounts[name])}</td></tr>`)
    .join('') || `<tr><td colspan="2" style="padding:4px 10px;color:#888;">No properties owned</td></tr>`

  // Compact growth history: first + every ~10th + last snapshot.
  const sampled = snaps.filter((_, i) => i === 0 || i === snaps.length - 1 || i % 10 === 0)
  const growthRows = sampled
    .map(sn => `<tr>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;">Mo ${plain(sn.month)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(sn.portfolioValue)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(sn.equity)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(sn.netCashFlow)}/mo</td>
    </tr>`)
    .join('') || `<tr><td colspan="4" style="padding:4px 10px;color:#888;">No snapshots recorded</td></tr>`

  // Recent notable events (last 25).
  const recentHist = hist.slice(-25).reverse()
    .map(h => `<tr>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;">Mo ${plain(h.month)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;">${esc(h.type)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;">${esc(h.title)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${h.amount != null ? num(h.amount) : ''}</td>
    </tr>`)
    .join('') || `<tr><td colspan="4" style="padding:4px 10px;color:#888;">No major events recorded</td></tr>`

  const goal      = payload?.playerInfo?.desiredMonthlyCashFlow ?? null
  const goalLine  = goal != null
    ? `${num(goal)}/mo${m.desiredCashFlowAchievedMonth != null ? ` — achieved in month ${plain(m.desiredCashFlowAchievedMonth)}` : ' — not yet achieved'}`
    : 'Not set'

  const th = 'padding:6px 10px;text-align:left;background:#0f2a43;color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:.04em;'
  const sectionTitle = 'margin:28px 0 8px;font-size:16px;color:#0f2a43;border-bottom:2px solid #38bdf8;padding-bottom:4px;'

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2330;">
  <div style="max-width:680px;margin:0 auto;padding:24px;">
    <div style="background:#0f2a43;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;">
      <h1 style="margin:0;font-size:22px;">🏙️ Equity Empire — Gameplay Report</h1>
      <p style="margin:6px 0 0;color:#9fc4e3;font-size:13px;">
        Internal testing copy · Difficulty: ${esc(payload?.difficulty || '—')} · Generated ${esc(payload?.generatedAt || '')}
      </p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 10px 10px;">

      <h2 style="${sectionTitle}">Session Summary</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Starting cash</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(s.startingCash)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Cash on hand</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(s.finalCash)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Portfolio value</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(s.finalPortfolioValue)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Total equity</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(s.finalEquity)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Total debt</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(s.finalDebt)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Monthly income</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(s.finalMonthlyIncome)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Monthly expenses</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(s.finalMonthlyExpenses)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;"><strong>Net monthly cash flow</strong></td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;"><strong>${num(s.finalNetCashFlow)}/mo</strong></td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Cash flow goal</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${esc(goalLine)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Months played</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(s.monthsPlayed)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Properties owned</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(s.propertiesOwned)}</td></tr>
      </table>

      <h2 style="${sectionTitle}">Activity Totals</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Properties purchased</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(s.propertiesPurchased)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Properties sold</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(s.propertiesSold)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Refinances completed</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(s.refinancesCompleted)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Total cash out from refinances</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(s.totalCashOutFromRefinances)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Upgrades completed</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(s.upgradesCompleted)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Staff hired</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(s.staffHired)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Maintenance issues resolved</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(s.maintenanceIssuesResolved)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Critical issues resolved</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(s.criticalIssuesResolved)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Trivia bonus earned</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${num(s.triviaBonusEarned)}</td></tr>
      </table>

      <h2 style="${sectionTitle}">Milestones</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${reachedRow('Portfolio', pvMs)}
        ${reachedRow('Cash flow', cfMs)}
        ${m.firstPropertyPurchaseMonth != null ? `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">First property purchase</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">Month ${plain(m.firstPropertyPurchaseMonth)}</td></tr>` : ''}
        ${m.firstRefinanceMonth != null ? `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">First refinance</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">Month ${plain(m.firstRefinanceMonth)}</td></tr>` : ''}
        ${m.firstStaffHireMonth != null ? `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">First staff hire</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">Month ${plain(m.firstStaffHireMonth)}</td></tr>` : ''}
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

      <h2 style="${sectionTitle}">Recent Notable Events</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><th style="${th}">Month</th><th style="${th}">Type</th><th style="${th}">Event</th><th style="${th}text-align:right;">Amount</th></tr>
        ${recentHist}
      </table>

      <div style="margin-top:28px;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:12px;color:#7c4a03;line-height:1.5;">
        <strong>Disclaimer:</strong> Equity Empire is a game and educational tool only.
        Nothing in this report is investment, financial, tax, or legal advice. Simulated
        results do not represent real-world performance. Always consult a qualified
        professional before making real investment decisions.
      </div>

      <p style="margin-top:18px;font-size:11px;color:#9aa5b1;">
        Internal testing report · sent to project owner only · no player email collected in this phase.
      </p>
    </div>
  </div>
</body></html>`
}

export default async (req) => {
  const allowedOrigin  = process.env.ALLOWED_ORIGIN || ''
  const corsHeaders = {
    'access-control-allow-origin':  allowedOrigin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders })
  }

  // 1. POST only
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed. Use POST.' }, 405, corsHeaders)
  }

  // 2. Origin validation against ALLOWED_ORIGIN
  const origin  = req.headers.get('origin') || ''
  const referer = req.headers.get('referer') || ''
  if (allowedOrigin) {
    const originOk  = origin === allowedOrigin
    const refererOk = referer.startsWith(allowedOrigin)
    if (!originOk && !refererOk) {
      return json({ ok: false, error: 'Forbidden: origin not allowed.' }, 403, corsHeaders)
    }
  }

  // 4. Body size limit (read raw text first)
  let raw
  try {
    raw = await req.text()
  } catch {
    return json({ ok: false, error: 'Could not read request body.' }, 400, corsHeaders)
  }
  if (raw.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Request body too large.' }, 413, corsHeaders)
  }

  // 3. Validate report payload presence
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400, corsHeaders)
  }
  const payload = body?.payload
  if (!payload || typeof payload !== 'object' || !payload.summary) {
    return json({ ok: false, error: 'Missing or invalid report payload.' }, 400, corsHeaders)
  }

  // Required server config
  const apiKey     = process.env.RESEND_API_KEY
  const fromEmail  = process.env.REPORT_FROM_EMAIL
  const ownerEmail = process.env.REPORT_OWNER_EMAIL
  if (!apiKey || !fromEmail || !ownerEmail) {
    return json({ ok: false, error: 'Server email configuration is incomplete.' }, 500, corsHeaders)
  }

  // 5/6/7/8. Build HTML + send via Resend.
  // TEMP: recipient is ALWAYS the owner email. Any address the frontend
  // might send is intentionally ignored in this internal testing phase.
  const html = buildHtml(payload)
  const subject = `Equity Empire Report — ${payload?.difficulty || 'game'} · ${payload?.summary?.monthsPlayed ?? '?'} mo · ${num(payload?.summary?.finalPortfolioValue)} portfolio`

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type':  'application/json',
      },
      body: JSON.stringify({
        from:     fromEmail,
        to:       [ownerEmail],     // owner only — see TEMP note at top of file
        reply_to: ownerEmail,
        subject,
        html,
      }),
    })

    if (!resendRes.ok) {
      const detail = await resendRes.text().catch(() => '')
      console.error('[sendReport] Resend API error', resendRes.status, detail)
      return json({ ok: false, error: `Email provider rejected the request (${resendRes.status}).` }, 502, corsHeaders)
    }

    console.log('[sendReport] Report emailed to owner. months:', payload?.summary?.monthsPlayed,
      'portfolio:', payload?.summary?.finalPortfolioValue)
    return json({ ok: true }, 200, corsHeaders)
  } catch (e) {
    console.error('[sendReport] Unexpected error', e?.message || e)
    return json({ ok: false, error: 'Unexpected server error sending report.' }, 500, corsHeaders)
  }
}
