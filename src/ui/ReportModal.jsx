import { useEffect, useRef, useState } from 'react'
import { useGame } from '../core/gameState.js'
import { createReportPayload } from '../systems/reportingSystem.js'
import { formatShort, formatCashFlow } from '../utils/formatters.js'

// ⚠️  TEMPORARY INTERNAL TESTING MODE ⚠️
// We do NOT collect the player's name/email yet and we do NOT email the
// player. On open we build the structured report payload from current game
// state and POST it to /api/sendReport, which (server-side) always emails
// the formatted HTML report to the internal owner address only. The player
// just sees the simple stats card below — same visual family as the
// goal-achievement WinModal, intentionally minimal.
//
// LATER: collect player name + email + consent here and let the backend
// send the player their own copy.

function formatMonths(m) {
  if (m <= 0) return '0 months'
  if (m < 12) return `${m} month${m !== 1 ? 's' : ''}`
  const yrs = Math.floor(m / 12)
  const mos = m % 12
  if (mos === 0) return `${yrs} yr${yrs !== 1 ? 's' : ''}`
  return `${yrs} yr ${mos} mo`
}

// Highest portfolio-value milestone reached, for the "major milestone" line.
function topMilestone(reporting) {
  const map = reporting?.milestones?.portfolioValueMilestones || {}
  const reached = Object.keys(map)
    .filter(k => map[k] != null)
    .map(Number)
    .sort((a, b) => b - a)
  if (reached.length === 0) return null
  return `${formatShort(reached[0])} portfolio`
}

export default function ReportModal({ onClose }) {
  const { state } = useGame()
  const sentRef = useRef(false)
  const [sendStatus, setSendStatus] = useState('sending') // 'sending' | 'sent' | 'error'

  const netCashFlow = state.monthlyIncome - state.monthlyExpenses - (state.staffExpense || 0)
  const equity      = (state.portfolioValue || 0) - (state.totalDebt || 0)
  const monthsPlayed = Math.max(0, (state.currentMonth || 1) - 1)
  const milestone    = topMilestone(state.reporting)

  // Fire the report send once, in the background. The player never sees
  // backend details, the recipient address, or any logs.
  useEffect(() => {
    if (sentRef.current) return
    sentRef.current = true

    let cancelled = false
    const payload = createReportPayload(state, {})

    fetch('/api/sendReport', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload }),
    })
      .then(r => r.json().catch(() => ({ ok: false })))
      .then(res => { if (!cancelled) setSendStatus(res?.ok ? 'sent' : 'error') })
      .catch(() => { if (!cancelled) setSendStatus('error') })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  const stats = [
    { label: 'Monthly Cash Flow', value: formatCashFlow(netCashFlow) + '/mo', highlight: true },
    { label: 'Portfolio Value',   value: formatShort(state.portfolioValue || 0) },
    { label: 'Total Equity',      value: formatShort(equity) },
    { label: 'Cash on Hand',      value: formatShort(state.cash || 0) },
    { label: 'Properties Owned',  value: String(state.properties?.length || 0) },
    { label: 'Months Played',     value: formatMonths(monthsPlayed) },
  ]

  return (
    <div className="win-overlay report-overlay" onClick={handleOverlayClick}>
      <div className="win-modal report-modal">
        <button className="modal-close-btn report-close-btn" onClick={onClose} aria-label="Close">×</button>
        <div className="win-confetti-row">📊 🏗️ 💼 📈 🏠</div>
        <h1 className="win-title report-title">Portfolio Snapshot</h1>
        <p className="win-subtitle">
          Month {monthsPlayed}{milestone ? ` · Top milestone: ${milestone}` : ''}
        </p>

        <div className="win-stats-grid">
          {stats.map(s => (
            <div key={s.label} className={`win-stat${s.highlight ? ' win-stat--hl' : ''}`}>
              <span className="win-stat-label">{s.label}</span>
              <span className="win-stat-value">{s.value}</span>
            </div>
          ))}
        </div>

        <p className="report-send-status">
          {sendStatus === 'sending' && '⏳ Preparing your detailed report…'}
          {sendStatus === 'sent'    && '✅ Detailed report generated.'}
          {sendStatus === 'error'   && 'ℹ️ Snapshot shown above. Detailed report will be available soon.'}
        </p>

        <div className="win-actions">
          <button className="win-btn-continue" onClick={onClose}>Resume Game</button>
        </div>

        <p className="report-form-disclaimer">
          Equity Empire is a game and educational tool — not investment advice.
        </p>
      </div>
    </div>
  )
}
