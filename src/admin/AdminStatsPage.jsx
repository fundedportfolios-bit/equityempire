import { useEffect, useState } from 'react'
import { formatShort, formatCashFlow } from '../utils/formatters.js'

// ─── Private all-time game stats page ──────────────────────────────
// Routed by App.jsx when the pathname matches /admin/<TOKEN>. Token is
// passed through to /api/admin-stats?token=<TOKEN>; any non-200 renders
// a generic "Not found" page so an attacker can't distinguish a wrong
// token from a non-existent route. Read-only — no game state, no auth.

function setNoReferrer() {
  if (typeof document === 'undefined') return
  let meta = document.querySelector('meta[name="referrer"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'referrer')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', 'no-referrer')
}

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toISOString().slice(0, 10) } catch { return '—' }
}
function fmtDateTime(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  } catch { return '—' }
}

function StatTile({ label, value }) {
  return (
    <div className="adm-tile">
      <div className="adm-tile-value">{value}</div>
      <div className="adm-tile-label">{label}</div>
    </div>
  )
}

// ─── Usage-over-time chart ─────────────────────────────────────────
// Inline SVG bar chart of daily sessions for the last 90 days, split
// into signed-in (amber) + guest (slate) for composition at a glance.
// No chart library — keeps the bundle small. Browser tooltip on hover.
function UsageChart({ series }) {
  if (!series || series.length === 0) return null

  // Y-axis scale. Use a minimum of 1 so a brand-new account doesn't
  // divide by zero. Round the top tick up for readable gridlines.
  const peak = series.reduce((m, d) => Math.max(m, d.sessions || 0), 0)
  const yMax = Math.max(1, niceCeil(peak))

  // SVG viewBox geometry — scales to the container width via CSS.
  const W = 1000
  const H = 240
  const padTop    = 14
  const padBottom = 30
  const padLeft   = 36
  const padRight  = 10
  const chartW = W - padLeft - padRight
  const chartH = H - padTop - padBottom
  const gap    = 1
  const barW   = Math.max(2, (chartW / series.length) - gap)

  const yTicks = [0, 0.5, 1].map(f => ({
    v: Math.round(yMax * f),
    y: padTop + chartH * (1 - f),
  }))

  // X-axis: emit a month label on day 01 (and the first bar).
  const monthLabels = series
    .map((d, i) => {
      if (i === 0 || d.date.slice(8, 10) === '01') {
        const monthName = new Date(d.date + 'T00:00:00Z')
          .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
        return { i, label: monthName }
      }
      return null
    })
    .filter(Boolean)

  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart-legend">
        <span><i className="adm-chart-swatch adm-chart-swatch--signed" /> Signed-in sessions</span>
        <span><i className="adm-chart-swatch adm-chart-swatch--guest"  /> Guest sessions</span>
        <span className="adm-chart-peak">Peak: {peak} session{peak === 1 ? '' : 's'}/day</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="adm-chart"
        role="img"
        aria-label={`Daily sessions for the last ${series.length} days`}
      >
        {/* Gridlines + Y labels */}
        {yTicks.map(t => (
          <g key={t.v}>
            <line x1={padLeft} x2={W - padRight} y1={t.y} y2={t.y}
                  stroke="#283546" strokeDasharray="3,4" strokeWidth="1" />
            <text x={padLeft - 6} y={t.y + 4} textAnchor="end"
                  fontSize="11" fill="#94a3b8">{t.v}</text>
          </g>
        ))}

        {/* Stacked bars: guest (slate) base + signed-in (amber) on top */}
        {series.map((d, i) => {
          const x = padLeft + i * (barW + gap)
          const guestH  = chartH * ((d.guestSessions    || 0) / yMax)
          const signedH = chartH * ((d.signedInSessions || 0) / yMax)
          const guestY  = padTop + chartH - guestH
          const signedY = guestY - signedH
          const total   = d.sessions || 0
          return (
            <g key={d.date}>
              {d.guestSessions > 0 && (
                <rect x={x} y={guestY} width={barW} height={guestH} fill="#475569" />
              )}
              {d.signedInSessions > 0 && (
                <rect x={x} y={signedY} width={barW} height={signedH} fill="#f59e0b" />
              )}
              <title>
                {d.date} · {total} session{total === 1 ? '' : 's'}
                {' '}({d.signedInSessions} signed-in, {d.guestSessions} guest)
                {' · '}{d.events} event{d.events === 1 ? '' : 's'}
                {d.uniqueActors > 0 ? ` · ${d.uniqueActors} unique` : ''}
              </title>
            </g>
          )
        })}

        {/* Baseline */}
        <line x1={padLeft} x2={W - padRight}
              y1={padTop + chartH} y2={padTop + chartH}
              stroke="#3a4a5e" strokeWidth="1" />

        {/* X-axis month labels */}
        {monthLabels.map(({ i, label }) => (
          <text key={i}
                x={padLeft + i * (barW + gap)}
                y={H - 10}
                textAnchor="start"
                fontSize="11"
                fill="#94a3b8">
            {label}
          </text>
        ))}
      </svg>
    </div>
  )
}

// Round up to a "nice" number for the y-axis top tick.
function niceCeil(n) {
  if (n <= 5)   return 5
  if (n <= 10)  return 10
  if (n <= 25)  return 25
  if (n <= 50)  return 50
  if (n <= 100) return 100
  // For larger values, round up to the next multiple of 10^(digits-1).
  const mag  = Math.pow(10, Math.floor(Math.log10(n)))
  return Math.ceil(n / mag) * mag
}

function ActorRow({ a }) {
  return (
    <div className="adm-row">
      <div className="adm-row-id">
        <span className="adm-row-name">
          {a.playerName || (a.isUid ? `uid:${String(a.id).slice(0, 14)}…` : `guest:${String(a.id).slice(0, 14)}…`)}
        </span>
        <span className="adm-row-tag">{a.isUid ? (a.authProvider || 'signed-in') : 'guest'}</span>
        {a.supportRequested && <span className="adm-row-tag adm-row-tag-warn">support</span>}
        <span className="adm-row-when">last active {fmtDate(a.lastActiveAt)}</span>
      </div>
      <div className="adm-row-stats">
        <span><strong>{a.highestPortfolio != null ? formatShort(a.highestPortfolio) : '—'}</strong> portfolio</span>
        <span><strong>{a.highestEquity != null ? formatShort(a.highestEquity) : '—'}</strong> equity</span>
        <span><strong>{a.highestCashFlow != null ? formatCashFlow(a.highestCashFlow) + '/mo' : '—'}</strong> CF</span>
        <span><strong>{a.propertiesOwned ?? 0}</strong> props</span>
        <span><strong>{a.sessionCount ?? 0}</strong> sessions</span>
        <span><strong>{a.reportRequests ?? 0}</strong> reports</span>
      </div>
    </div>
  )
}

function EventRow({ e, warn }) {
  return (
    <div className={`adm-row${warn ? ' adm-row-warn' : ''}`}>
      <div className="adm-row-id">
        <span className="adm-row-name">{e.playerName || '—'}</span>
        <span className="adm-row-tag">{e.playerEmail || '—'}</span>
        <span className="adm-row-when">{fmtDateTime(e.createdAt)}</span>
      </div>
      {e.details && <p className="adm-row-detail">"{e.details}"</p>}
      <div className="adm-row-stats">
        <span><strong>{formatShort(e.portfolioValue || 0)}</strong> portfolio</span>
        <span><strong>{formatCashFlow(e.monthlyCashFlow || 0)}/mo</strong> CF</span>
        <span><strong>{e.propertiesOwned || 0}</strong> props</span>
        <span><strong>{e.monthsPlayed || 0}</strong> months</span>
        {e.contactPreference && <span>via {e.contactPreference}</span>}
      </div>
    </div>
  )
}

export default function AdminStatsPage({ token }) {
  const [status, setStatus] = useState('loading')   // loading | ready | denied
  const [stats,  setStats]  = useState(null)

  useEffect(() => { setNoReferrer() }, [])

  async function load() {
    setStatus('loading')
    try {
      const res = await fetch(`/api/admin-stats?token=${encodeURIComponent(token)}`, {
        cache: 'no-store',
      })
      if (!res.ok) { setStatus('denied'); return }
      const data = await res.json()
      if (!data?.ok || !data?.stats) { setStatus('denied'); return }
      setStats(data.stats)
      setStatus('ready')
    } catch {
      setStatus('denied')
    }
  }
  useEffect(() => { load() }, [token])

  if (status === 'denied') {
    return (
      <div className="adm-root">
        <div className="adm-card">
          <h1 className="adm-not-found">Not found</h1>
        </div>
      </div>
    )
  }

  if (status === 'loading' || !stats) {
    return (
      <div className="adm-root">
        <div className="adm-card">
          <p className="adm-loading">Loading…</p>
        </div>
      </div>
    )
  }

  const recentReports = (stats.reportEvents  || []).slice(0, 20)
  const recentSupport = (stats.supportEvents || []).slice(0, 20)

  return (
    <div className="adm-root">
      <div className="adm-card">
        <div className="adm-header">
          <h1 className="adm-title">📊 All-Time Game Stats</h1>
          <button className="adm-refresh" onClick={load} aria-label="Refresh">↻ Refresh</button>
        </div>
        <p className="adm-subtitle">
          {fmtDate(stats.firstEventAt)} → {fmtDate(stats.lastEventAt)} · {stats.totalEvents.toLocaleString()} events
        </p>

        <h2 className="adm-section">Headline</h2>
        <div className="adm-tiles">
          <StatTile label="Total events"        value={stats.totalEvents.toLocaleString()} />
          <StatTile label="Sessions"            value={stats.sessionCount.toLocaleString()} />
          <StatTile label="Signed-in players"   value={stats.uniqueLoggedIn.toLocaleString()} />
          <StatTile label="Guest players"       value={stats.uniqueGuests.toLocaleString()} />
          <StatTile label="Goals reached"       value={stats.goalsReached.toLocaleString()} />
          <StatTile label="Report requests"     value={stats.reportRequests.toLocaleString()} />
          <StatTile label="Support requests"    value={stats.supportRequests.toLocaleString()} />
          <StatTile label="Properties acquired" value={stats.propertyEvents.toLocaleString()} />
          <StatTile label="Refinances"          value={stats.refiEvents.toLocaleString()} />
          <StatTile label="Upgrades"            value={stats.upgradeEvents.toLocaleString()} />
          <StatTile label="Staff hires"         value={stats.staffEvents.toLocaleString()} />
        </div>

        <h2 className="adm-section">Usage — Last 90 Days</h2>
        <p className="adm-section-sub">Daily sessions, broken out by signed-in vs guest. Hover a bar for the exact counts.</p>
        <UsageChart series={stats.dailySeries || []} />

        <h2 className="adm-section">Top Players & Guests</h2>
        <p className="adm-section-sub">Sorted by highest portfolio value. Top 25 across all time.</p>
        <div className="adm-rows">
          {stats.topActors.length === 0 && <p className="adm-empty">No activity yet.</p>}
          {stats.topActors.map(a => <ActorRow key={a.key} a={a} />)}
        </div>

        <h2 className="adm-section">Recent Report Requests</h2>
        <div className="adm-rows">
          {recentReports.length === 0 && <p className="adm-empty">No report requests yet.</p>}
          {recentReports.map((e, i) => <EventRow key={`r${i}`} e={e} />)}
        </div>

        <h2 className="adm-section">Recent Support Requests</h2>
        <div className="adm-rows">
          {recentSupport.length === 0 && <p className="adm-empty">No support requests yet.</p>}
          {recentSupport.map((e, i) => <EventRow key={`s${i}`} e={e} warn />)}
        </div>
      </div>
    </div>
  )
}
