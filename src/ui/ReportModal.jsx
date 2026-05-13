import { useRef, useState } from 'react'
import { useGame } from '../core/gameState.js'
import { DIFFICULTY_SETTINGS } from '../data/difficultySettings.js'

function formatTimeline(months) {
  if (months <= 0)  return '1 month'
  if (months < 12)  return `${months} month${months !== 1 ? 's' : ''}`
  const yrs = Math.floor(months / 12)
  const mos = months % 12
  if (mos === 0) return `${yrs} yr${yrs !== 1 ? 's' : ''}`
  return `${yrs} yr ${mos} mo`
}

const PROP_LABEL = {
  'Single Long-Term Rental':  ['Long-Term Rental',  'Long-Term Rentals'],
  'Single Short-Term Rental': ['Short-Term Rental', 'Short-Term Rentals'],
  'Small Multifamily':        ['Multifamily',       'Multifamily'],
  'Fix and Flip':             ['Fix & Flip',        'Fix & Flips'],
  'Micro Resort':             ['Micro Resort',      'Micro Resorts'],
  'Apartment Building':       ['Apt Building',      'Apt Buildings'],
  'Apartment Complex':        ['Apt Complex',       'Apt Complexes'],
}

function buildPortfolioMakeup(properties) {
  const counts = properties.reduce((acc, p) => { acc[p.name] = (acc[p.name] || 0) + 1; return acc }, {})
  return Object.entries(counts)
    .map(([name, n]) => { const [sg, pl] = PROP_LABEL[name] || [name, name + 's']; return `${n} ${n === 1 ? sg : pl}` })
    .join(' · ')
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

  const shareStats = reportStats

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
      <div className="win-modal">
        <button className="modal-close-btn report-close-btn" onClick={onClose} aria-label="Close">×</button>
        <div className="win-confetti-row">📊 🏗️ 💼 📈 🏠</div>
        <h1 className="win-title report-title">Portfolio Snapshot</h1>
        <p className="win-subtitle">
          Month {state.currentMonth - 1} · <strong>{goalPct}%</strong> to ${goal.toLocaleString()}/mo goal
        </p>

        <p className="wsc-makeup">{buildPortfolioMakeup(state.properties)}</p>

        <div className="win-stats-grid">
          {reportStats.map(s => (
            <div key={s.label} className={`win-stat${s.highlight ? ' win-stat--hl' : ''}`}>
              <span className="win-stat-label">{s.label}</span>
              <span className="win-stat-value">{s.value}</span>
            </div>
          ))}
        </div>

        <div className="win-actions">
          <button className="win-btn-continue" onClick={onClose}>Resume Game</button>
          <button className="win-btn-share" onClick={handleShare} disabled={sharing}>
            {sharing ? 'Generating…' : '📸 Share'}
          </button>
        </div>
      </div>

      <div className="win-share-card" ref={shareRef} aria-hidden="true">
        <div className="wsc-header">
          <span className="wsc-logo">📊 Equity Empire</span>
          <span className="wsc-badge">Portfolio Snapshot</span>
        </div>

        <p className="wsc-makeup">{buildPortfolioMakeup(state.properties)}</p>

        <div className="wsc-stats">
          {shareStats.map(s => (
            <div className="wsc-stat" key={s.label}>
              <span className="wsc-stat-val" style={s.highlight ? { color: '#22c55e' } : {}}>{s.value}</span>
              <span className="wsc-stat-lbl">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
