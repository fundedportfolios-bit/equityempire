// ═══════════════════════════════════════════════════════════════
// weeklyActivityReport — scheduled weekly owner summary
// Netlify Functions v2 · runs at 13:00 UTC every Monday (cron 0 13 * * 1)
//
// Reads the last 7 days of gameActivity from Firestore, summarizes by
// uid (logged-in users) and guestId (anonymous players), and emails the
// summary to WEEKLY_REPORT_EMAIL via Resend.
//
// Run manually from Netlify dashboard → Functions → weeklyActivityReport →
// "Run now" to test after deploy.
// ═══════════════════════════════════════════════════════════════

import { getFirebaseAdmin } from './utils/firebaseAdmin.mjs'

export const config = {
  schedule: '0 13 * * 1',
}

// ─── Helpers ───────────────────────────────────────────────────
function num(n) {
  const v = Number(n)
  if (!isFinite(v)) return '—'
  return `$${Math.round(v).toLocaleString('en-US')}`
}
// Compact $ for narrow table cells in the email — e.g. $16,364,624,429 → $16.4B.
// Use in wide tables only; keep num() for headline stats where space is plentiful.
function numShort(n) {
  const v = Number(n)
  if (!isFinite(v)) return '—'
  const abs  = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1_000_000)     return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 10_000)        return `${sign}$${Math.round(abs / 1000)}K`
  if (abs >= 1_000)         return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
}
function plain(n) {
  const v = Number(n)
  return isFinite(v) ? v.toLocaleString('en-US') : '—'
}
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function fmtDate(d) {
  try { return new Date(d).toISOString().slice(0, 10) } catch { return '—' }
}

async function sendViaResend(apiKey, message) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(message),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, status: res.status, detail }
  }
  return { ok: true }
}

// ─── Aggregation ───────────────────────────────────────────────
function aggregate(events) {
  const byActor = new Map()   // key = uid:<id> or guest:<id>
  const sessionIds = new Set()
  const supportEvents = []

  let totalEvents       = events.length
  let reportRequests    = 0
  let supportRequests   = 0
  let goalsReached      = 0
  let propertyEvents    = 0
  let refiEvents        = 0
  let upgradeEvents     = 0
  let staffEvents       = 0
  let uniqueLoggedIn    = new Set()
  let uniqueGuests      = new Set()

  for (const e of events) {
    if (e.sessionId) sessionIds.add(e.sessionId)
    const isUid = !!e.uid
    const actorKey = isUid ? `uid:${e.uid}` : `guest:${e.guestId || 'unknown'}`
    if (isUid) uniqueLoggedIn.add(e.uid)
    else if (e.guestId) uniqueGuests.add(e.guestId)

    if (!byActor.has(actorKey)) {
      byActor.set(actorKey, {
        key:              actorKey,
        isUid,
        id:               isUid ? e.uid : (e.guestId || 'unknown'),
        sessions:         new Set(),
        highestCashFlow:  -Infinity,
        highestPortfolio: -Infinity,
        highestEquity:    -Infinity,
        propertiesOwned:  0,
        reportRequests:   0,
        supportRequested: false,
        lastActiveAt:     null,
        playerName:       null,
        playerEmail:      null,
      })
    }
    const a = byActor.get(actorKey)
    if (e.sessionId) a.sessions.add(e.sessionId)
    if (Number.isFinite(e.monthlyCashFlow)) a.highestCashFlow  = Math.max(a.highestCashFlow,  e.monthlyCashFlow)
    if (Number.isFinite(e.portfolioValue))  a.highestPortfolio = Math.max(a.highestPortfolio, e.portfolioValue)
    if (Number.isFinite(e.totalEquity))     a.highestEquity    = Math.max(a.highestEquity,    e.totalEquity)
    if (Number.isFinite(e.propertiesOwned)) a.propertiesOwned  = Math.max(a.propertiesOwned,  e.propertiesOwned)
    if (e.eventType === 'report_requested') { reportRequests++; a.reportRequests++ }
    if (e.eventType === 'support_requested') {
      supportRequests++
      a.supportRequested = true
      supportEvents.push(e)
    }
    if (e.eventType === 'goal_reached')          goalsReached++
    if (e.eventType === 'property_acquired')     propertyEvents++
    if (e.eventType === 'refinance_completed')   refiEvents++
    if (e.eventType === 'upgrade_completed')     upgradeEvents++
    if (e.eventType === 'staff_hired')           staffEvents++

    if (e.playerName && !a.playerName)   a.playerName = e.playerName
    if (e.playerEmail && !a.playerEmail) a.playerEmail = e.playerEmail
    const ts = e.createdAt?.toDate ? e.createdAt.toDate() : (e.createdAt ? new Date(e.createdAt) : null)
    if (ts && (!a.lastActiveAt || ts > a.lastActiveAt)) a.lastActiveAt = ts
  }

  // Build top-N actor list — sort by sessions then by highestPortfolio
  const topActors = Array.from(byActor.values())
    .map(a => ({
      ...a,
      sessionCount: a.sessions.size,
      highestCashFlow:  a.highestCashFlow  === -Infinity ? null : a.highestCashFlow,
      highestPortfolio: a.highestPortfolio === -Infinity ? null : a.highestPortfolio,
      highestEquity:    a.highestEquity    === -Infinity ? null : a.highestEquity,
    }))
    .sort((a, b) =>
      ((b.highestPortfolio ?? 0) - (a.highestPortfolio ?? 0)) ||
      (b.sessionCount - a.sessionCount)
    )
    .slice(0, 25)

  return {
    totalEvents,
    sessionCount:     sessionIds.size,
    uniqueLoggedIn:   uniqueLoggedIn.size,
    uniqueGuests:     uniqueGuests.size,
    reportRequests,
    supportRequests,
    goalsReached,
    propertyEvents,
    refiEvents,
    upgradeEvents,
    staffEvents,
    topActors,
    supportEvents,
  }
}

// ─── Email composition ─────────────────────────────────────────
function buildHtml(stats, range) {
  // Top Players & Support Requests render as stacked cards (one <table> per
  // entry) rather than wide multi-column tables, because the wide-table
  // approach overflows narrow Gmail/Outlook panes regardless of how tight
  // the column widths are. Cards reflow naturally at any viewport width.
  const sectionTitle = 'margin:24px 0 8px;font-size:16px;color:#0f2a43;border-bottom:2px solid #38bdf8;padding-bottom:4px;'

  // Card layout (instead of wide tables) — every email client renders
  // <table>-based cards reliably, and the inline "·"-separated stat list
  // wraps naturally at any viewport width with no horizontal overflow.
  const sep = '<span style="color:#94a3b8;"> · </span>'

  const actorCards = stats.topActors.map(a => `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
      style="width:100%;border-collapse:collapse;margin-bottom:10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
      <tr><td style="padding:10px 12px;">
        <div style="font-weight:700;color:#0f2a43;font-size:14px;word-break:break-all;">
          ${esc(a.isUid ? `uid:${a.id.slice(0, 16)}…` : `guest:${a.id.slice(0, 16)}…`)}
        </div>
        <div style="font-size:13px;color:#465061;margin-top:6px;line-height:1.55;">
          <strong>Portfolio:</strong> ${a.highestPortfolio != null ? numShort(a.highestPortfolio) : '—'}${sep}
          <strong>Equity:</strong> ${a.highestEquity != null ? numShort(a.highestEquity) : '—'}${sep}
          <strong>Top CF:</strong> ${a.highestCashFlow != null ? numShort(a.highestCashFlow) + '/mo' : '—'}
        </div>
        <div style="font-size:13px;color:#465061;margin-top:4px;line-height:1.55;">
          <strong>Properties:</strong> ${plain(a.propertiesOwned)}${sep}
          <strong>Sessions:</strong> ${plain(a.sessionCount)}${sep}
          <strong>Reports:</strong> ${plain(a.reportRequests)}${sep}
          <strong>Support:</strong> ${a.supportRequested ? '✅' : '—'}
        </div>
        <div style="font-size:11px;color:#7c8895;margin-top:6px;">
          Last active ${a.lastActiveAt ? fmtDate(a.lastActiveAt) : '—'}
        </div>
      </td></tr>
    </table>`).join('') || `<p style="color:#888;font-size:13px;">No activity in the last 7 days.</p>`

  const supportCards = stats.supportEvents.map(e => `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
      style="width:100%;border-collapse:collapse;margin-bottom:10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
      <tr><td style="padding:10px 12px;">
        <div style="font-weight:700;color:#0f2a43;font-size:14px;">${esc(e.playerName || '—')}</div>
        <div style="font-size:13px;color:#465061;margin-top:2px;word-break:break-all;overflow-wrap:anywhere;">
          ${esc(e.playerEmail || '—')}
        </div>
        <div style="font-size:13px;color:#465061;margin-top:6px;line-height:1.55;">
          <strong>Portfolio:</strong> ${numShort(e.portfolioValue)}${sep}
          <strong>Net CF:</strong> ${numShort(e.monthlyCashFlow)}/mo${sep}
          <strong>Properties:</strong> ${plain(e.propertiesOwned)}${sep}
          <strong>Months:</strong> ${plain(e.monthsPlayed)}
        </div>
      </td></tr>
    </table>`).join('') || `<p style="color:#888;font-size:13px;">No support requests this week.</p>`

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2330;">
  <div style="max-width:760px;margin:0 auto;padding:24px;">
    <div style="background:#0f2a43;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;">
      <h1 style="margin:0;font-size:22px;">📊 Weekly Equity Empire Activity Report</h1>
      <p style="margin:6px 0 0;color:#9fc4e3;font-size:13px;">${esc(range.from)} → ${esc(range.to)} (UTC)</p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 10px 10px;">

      <h2 style="${sectionTitle}">Headline Stats</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Total events</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.totalEvents)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Total sessions</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.sessionCount)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Unique logged-in users</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.uniqueLoggedIn)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Unique guest players</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.uniqueGuests)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Report requests</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.reportRequests)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Support requests</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.supportRequests)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Goals reached</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.goalsReached)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Properties acquired</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.propertyEvents)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Refinances completed</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.refiEvents)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Upgrades completed</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.upgradeEvents)}</td></tr>
        <tr><td style="padding:4px 10px;border-bottom:1px solid #eee;">Staff hires</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;">${plain(stats.staffEvents)}</td></tr>
      </table>

      <h2 style="${sectionTitle}">Support Requests</h2>
      <p style="font-size:13px;color:#465061;">Players who explicitly requested follow-up via the in-game form.</p>
      ${supportCards}

      <h2 style="${sectionTitle}">Top Players & Guests</h2>
      <p style="font-size:13px;color:#465061;">Sorted by highest portfolio value. Long list — at the end of the email so it can extend without pushing other sections out of view.</p>
      ${actorCards}

      <p style="margin-top:24px;font-size:12px;color:#7c8895;line-height:1.55;">
        Guest identities are anonymous unless the player explicitly requested
        a report or support, in which case the name/email they typed appears
        in the relevant rows above.
      </p>
    </div>
  </div>
</body></html>`
}

function buildText(stats, range) {
  const lines = [
    `Weekly Equity Empire Activity Report`,
    `${range.from} → ${range.to} (UTC)`,
    ``,
    `HEADLINE`,
    `  Total events:           ${plain(stats.totalEvents)}`,
    `  Total sessions:         ${plain(stats.sessionCount)}`,
    `  Unique logged-in users: ${plain(stats.uniqueLoggedIn)}`,
    `  Unique guest players:   ${plain(stats.uniqueGuests)}`,
    `  Report requests:        ${plain(stats.reportRequests)}`,
    `  Support requests:       ${plain(stats.supportRequests)}`,
    `  Goals reached:          ${plain(stats.goalsReached)}`,
    `  Properties acquired:    ${plain(stats.propertyEvents)}`,
    `  Refinances:             ${plain(stats.refiEvents)}`,
    `  Upgrades:               ${plain(stats.upgradeEvents)}`,
    `  Staff hires:            ${plain(stats.staffEvents)}`,
    ``,
    `Top actors: ${stats.topActors.length}; support requests: ${stats.supportEvents.length}.`,
    `Guest identities are anonymous unless they requested a report.`,
  ]
  return lines.join('\n')
}

// ─── Main handler (scheduled + manual Run now) ─────────────────
export default async () => {
  const apiKey       = process.env.RESEND_API_KEY
  const fromEmail    = process.env.REPORT_FROM_EMAIL
  const ownerEmail   = process.env.REPORT_OWNER_EMAIL
  const weeklyEmail  = process.env.WEEKLY_REPORT_EMAIL || process.env.REPORT_OWNER_EMAIL

  if (!apiKey || !fromEmail || !weeklyEmail) {
    console.error('[weeklyActivityReport] Missing env: need RESEND_API_KEY, REPORT_FROM_EMAIL, WEEKLY_REPORT_EMAIL')
    return new Response(JSON.stringify({ ok: false, error: 'Missing email env vars.' }), { status: 500 })
  }

  const fb = await getFirebaseAdmin()
  if (!fb.hasAdmin) {
    console.error('[weeklyActivityReport] Firebase Admin unavailable — cannot read gameActivity.')
    return new Response(JSON.stringify({ ok: false, error: 'Firebase Admin not configured.' }), { status: 500 })
  }

  // Date range: last 7 days, UTC.
  const now      = new Date()
  const weekAgo  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const range    = { from: weekAgo.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }

  // Query Firestore — order by createdAt desc, filter to last 7 days.
  let snap
  try {
    snap = await fb.db.collection('gameActivity')
      .where('createdAt', '>=', fb.Timestamp.fromDate(weekAgo))
      .orderBy('createdAt', 'desc')
      .limit(5000)
      .get()
  } catch (e) {
    console.error('[weeklyActivityReport] Firestore query failed:', e?.message || e)
    return new Response(JSON.stringify({ ok: false, error: 'Firestore query failed.' }), { status: 500 })
  }

  const events = snap.docs.map(d => d.data())
  const stats  = aggregate(events)

  console.log('[weeklyActivityReport] events:', stats.totalEvents,
    'sessions:', stats.sessionCount,
    'users:', stats.uniqueLoggedIn,
    'guests:', stats.uniqueGuests,
    'reports:', stats.reportRequests,
    'support:', stats.supportRequests)

  const html = buildHtml(stats, range)
  const text = buildText(stats, range)

  const send = await sendViaResend(apiKey, {
    from:     fromEmail,
    to:       [weeklyEmail],
    reply_to: ownerEmail || weeklyEmail,
    subject:  `Weekly Equity Empire Activity Report (${range.from} → ${range.to})`,
    html,
    text,
  })
  if (!send.ok) {
    console.error('[weeklyActivityReport] Resend failed', send.status, send.detail)
    return new Response(JSON.stringify({ ok: false, error: 'Email send failed.' }), { status: 502 })
  }
  return new Response(JSON.stringify({ ok: true, events: stats.totalEvents }), { status: 200 })
}
