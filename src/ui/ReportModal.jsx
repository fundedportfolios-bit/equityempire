import { useEffect, useRef } from 'react'
import { useGame } from '../core/gameState.js'
import { createReportPayload } from '../systems/reportingSystem.js'
import { formatShort, formatCashFlow } from '../utils/formatters.js'
import { STAFF_ROLES, STAFF_ROLE_ORDER } from '../data/staffRules.js'
import { getStaffCounts } from '../systems/staffSystem.js'

// ⚠️  TEMPORARY INTERNAL TESTING MODE ⚠️
// We do NOT collect the player's name/email yet and we do NOT email the
// player. On open we build the structured report payload from current game
// state and POST it to /api/sendReport, which (server-side) always emails
// the formatted HTML report to the internal owner address only. The player
// just sees the simple stats card below — same visual family as the
// goal-achievement WinModal, intentionally minimal. The send happens
// silently in the background — no status text is shown to the player.
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

// "3 Single LTR · 2 Micro Resort · 1 Apartment Complex"
function buildPropertySummary(properties) {
  if (!properties?.length) return 'No properties owned'
  const counts = properties.reduce((acc, p) => {
    const key = p.name || 'Property'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${n} ${name}`)
    .join(' · ')
}

// "2 Full Time Staff · 1 Senior Manager"
function buildStaffSummary(state) {
  const counts = getStaffCounts(state)
  const parts = STAFF_ROLE_ORDER
    .filter(role => (counts[role] || 0) > 0)
    .map(role => `${counts[role]} ${STAFF_ROLES[role].label}`)
  return parts.length ? parts.join(' · ') : 'No staff hired'
}

export default function ReportModal({ onClose }) {
  const { state } = useGame()
  const sentRef = useRef(false)

  const netCashFlow  = state.monthlyIncome - state.monthlyExpenses - (state.staffExpense || 0)
  const equity       = (state.portfolioValue || 0) - (state.totalDebt || 0)
  const monthsPlayed = Math.max(0, (state.currentMonth || 1) - 1)
  const propSummary  = buildPropertySummary(state.properties)
  const staffSummary = buildStaffSummary(state)

  // Fire the report send once, silently in the background. The player never
  // sees backend details, the recipient address, send status, or any logs.
  useEffect(() => {
    if (sentRef.current) return
    sentRef.current = true
    const payload = createReportPayload(state, {})
    fetch('/api/sendReport', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload }),
    }).catch(() => { /* silent — never surfaced to the player */ })
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

        <div className="report-portfolio-summary">
          <div className="report-summary-line">
            <span className="report-summary-label">Properties</span>
            <span className="report-summary-value">{propSummary}</span>
          </div>
          <div className="report-summary-line">
            <span className="report-summary-label">Staff</span>
            <span className="report-summary-value">{staffSummary}</span>
          </div>
        </div>

        <div className="win-stats-grid">
          {stats.map(s => (
            <div key={s.label} className={`win-stat${s.highlight ? ' win-stat--hl' : ''}`}>
              <span className="win-stat-label">{s.label}</span>
              <span className="win-stat-value">{s.value}</span>
            </div>
          ))}
        </div>

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
