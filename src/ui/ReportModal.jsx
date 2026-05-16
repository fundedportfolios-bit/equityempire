import { useRef, useState, useMemo } from 'react'
import { useGame } from '../core/gameState.js'
import { DIFFICULTY_SETTINGS } from '../data/difficultySettings.js'
import { STAFF_ROLES, STAFF_ROLE_ORDER } from '../data/staffRules.js'
import { getStaffCounts, getCurrentStaffCostByRole } from '../systems/staffSystem.js'
import PropertyIcon from './PropertyIcon.jsx'

function formatTimeline(months) {
  if (months <= 0)  return '1 month'
  if (months < 12)  return `${months} month${months !== 1 ? 's' : ''}`
  const yrs = Math.floor(months / 12)
  const mos = months % 12
  if (mos === 0) return `${yrs} yr${yrs !== 1 ? 's' : ''}`
  return `${yrs} yr ${mos} mo`
}

// Group owned properties by name so we can render a clean table row per type.
function buildPropertyRows(properties) {
  const groups = new Map()
  for (const p of properties) {
    const key = p.name || 'Property'
    if (!groups.has(key)) {
      groups.set(key, {
        name:        key,
        templateId:  p.templateId,
        icon:        p.icon,
        iconImage:   p.iconImage,
        count:       0,
        totalValue:  0,
        totalRent:   0,
        totalExp:    0,
      })
    }
    const g = groups.get(key)
    g.count++
    g.totalValue += (p.currentValue   || 0)
    g.totalRent  += (p.monthlyRent    || 0)
    g.totalExp   += (p.monthlyExpenses|| 0)
  }
  return Array.from(groups.values()).sort((a, b) => b.totalValue - a.totalValue)
}

function fmtMoney(n) {
  if (typeof n !== 'number') return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${abs.toLocaleString()}`
}

export default function ReportModal({ onClose }) {
  const { state }             = useGame()
  const shareRef              = useRef(null)
  const [sharing, setSharing] = useState(false)

  const diff        = DIFFICULTY_SETTINGS[state.difficulty] || {}
  const startCash   = diff.startingCash || 50000
  const netCashFlow = state.monthlyIncome - state.monthlyExpenses - (state.staffExpense || 0)
  const goal        = state.cashFlowGoal || 10000
  const equity      = state.portfolioValue - state.totalDebt
  const goalPct     = goal > 0 ? Math.round((netCashFlow / goal) * 100) : 0
  const timeline    = formatTimeline(state.currentMonth - 1)

  const reportStats = [
    { label: 'Timeline',        value: timeline },
    { label: 'Starting Cash',   value: `$${startCash.toLocaleString()}` },
    { label: 'Final Equity',    value: `$${equity.toLocaleString()}` },
    { label: 'Total Debt',      value: `$${state.totalDebt.toLocaleString()}` },
    { label: 'Portfolio Value', value: `$${state.portfolioValue.toLocaleString()}` },
    { label: 'Net Cash Flow',   value: `${netCashFlow >= 0 ? '+' : ''}$${netCashFlow.toLocaleString()}/mo`, highlight: true },
  ]

  // ── Portfolio table data (properties grouped by name + staff rows) ──
  const propertyRows = useMemo(() => buildPropertyRows(state.properties || []), [state.properties])
  const staffCounts  = useMemo(() => getStaffCounts(state), [state.staff])
  const staffRows    = useMemo(() => {
    return STAFF_ROLE_ORDER
      .map(role => {
        const count = staffCounts[role] || 0
        if (count === 0) return null
        const cfg  = STAFF_ROLES[role]
        const cost = getCurrentStaffCostByRole(role, state.currentMonth || 1)
        return {
          role,
          name:      cfg.label,
          icon:      cfg.icon,
          iconImage: cfg.iconImage,
          count,
          totalCost: count * cost,
        }
      })
      .filter(Boolean)
  }, [staffCounts, state.currentMonth])

  async function handleShare() {
    if (sharing || !shareRef.current) return
    setSharing(true)
    try {
      const { toPng } = await import('html-to-image')
      const dataUrl   = await toPng(shareRef.current, { cacheBust: true, pixelRatio: 2, style: { transform: 'none' } })
      const blob      = await (await fetch(dataUrl)).blob()
      const file      = new File([blob], 'equity-empire-report.png', { type: 'image/png' })

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'My Equity Empire Portfolio',
          text:  `${goalPct}% to my $${goal.toLocaleString()}/mo goal — Equity Empire`,
        })
      } else {
        const a    = document.createElement('a')
        a.href     = dataUrl
        a.download = 'equity-empire-report.png'
        a.click()
      }
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('Share failed:', err)
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="win-overlay report-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="win-modal report-modal">
        <button className="modal-close-btn report-close-btn" onClick={onClose} aria-label="Close">×</button>
        <div className="win-confetti-row">📊 🏗️ 💼 📈 🏠</div>
        <h1 className="win-title report-title">Portfolio Snapshot</h1>
        <p className="win-subtitle">
          Month {state.currentMonth - 1} · <strong>{goalPct}%</strong> to ${goal.toLocaleString()}/mo goal
        </p>

        {/* ── Top-level summary stats ──────────────────────────── */}
        <div className="win-stats-grid">
          {reportStats.map(s => (
            <div key={s.label} className={`win-stat${s.highlight ? ' win-stat--hl' : ''}`}>
              <span className="win-stat-label">{s.label}</span>
              <span className="win-stat-value">{s.value}</span>
            </div>
          ))}
        </div>

        {/* ── Portfolio table (properties + staff) ─────────────── */}
        <h3 className="report-section-title">Portfolio</h3>
        {propertyRows.length === 0 && staffRows.length === 0 ? (
          <p className="empty-state report-empty">No properties or staff yet.</p>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="num">Count</th>
                  <th className="num">Value</th>
                  <th className="num">Net/mo</th>
                </tr>
              </thead>
              <tbody>
                {propertyRows.map(row => {
                  const net = row.totalRent - row.totalExp
                  return (
                    <tr key={row.name}>
                      <td>
                        <span className="report-row-name">
                          <PropertyIcon emoji={row.icon} image={row.iconImage} templateId={row.templateId} inline />
                          {row.name}
                        </span>
                      </td>
                      <td className="num">{row.count}</td>
                      <td className="num">{fmtMoney(row.totalValue)}</td>
                      <td className={`num ${net >= 0 ? 'positive' : 'negative'}`}>{net >= 0 ? '+' : ''}{fmtMoney(net)}</td>
                    </tr>
                  )
                })}
                {staffRows.length > 0 && (
                  <tr className="report-table-divider"><td colSpan={4}>Staff</td></tr>
                )}
                {staffRows.map(row => (
                  <tr key={row.role}>
                    <td>
                      <span className="report-row-name">
                        <PropertyIcon emoji={row.icon} image={row.iconImage} inline />
                        {row.name}
                      </span>
                    </td>
                    <td className="num">{row.count}</td>
                    <td className="num">—</td>
                    <td className="num negative">-{fmtMoney(row.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="win-actions">
          <button className="win-btn-continue" onClick={onClose}>Resume Game</button>
          <button className="win-btn-share" onClick={handleShare} disabled={sharing}>
            {sharing ? 'Generating…' : '📸 Share'}
          </button>
        </div>
      </div>

      {/* Share card (off-screen, used only for image export) */}
      <div className="win-share-card" ref={shareRef} aria-hidden="true">
        <div className="wsc-header">
          <span className="wsc-logo">📊 Equity Empire</span>
          <span className="wsc-badge">Portfolio Snapshot</span>
        </div>
        <div className="wsc-stats">
          {reportStats.map(s => (
            <div className="wsc-stat" key={s.label}>
              <span className="wsc-stat-val" style={s.highlight ? { color: '#22c55e' } : {}}>{s.value}</span>
              <span className="wsc-stat-lbl">{s.label}</span>
            </div>
          ))}
        </div>
        <table className="report-table wsc-table">
          <thead>
            <tr>
              <th>Type</th>
              <th className="num">Count</th>
              <th className="num">Value</th>
              <th className="num">Net/mo</th>
            </tr>
          </thead>
          <tbody>
            {propertyRows.map(row => {
              const net = row.totalRent - row.totalExp
              return (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td className="num">{row.count}</td>
                  <td className="num">{fmtMoney(row.totalValue)}</td>
                  <td className="num">{net >= 0 ? '+' : ''}{fmtMoney(net)}</td>
                </tr>
              )
            })}
            {staffRows.map(row => (
              <tr key={row.role}>
                <td>{row.name}</td>
                <td className="num">{row.count}</td>
                <td className="num">—</td>
                <td className="num">-{fmtMoney(row.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
