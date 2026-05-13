import { useRef, useState } from 'react'
import { useGame } from '../core/gameState.js'
import { DIFFICULTY_SETTINGS } from '../data/difficultySettings.js'

function formatTimeline(months) {
  if (months <= 0)  return '1 month'
  if (months < 12)  return `${months} month${months !== 1 ? 's' : ''}`
  const yrs = Math.floor(months / 12)
  const mos = months % 12
  if (mos === 0)    return `${yrs} yr${yrs !== 1 ? 's' : ''}`
  return `${yrs} yr ${mos} mo`
}

export default function WinModal({ onContinue, onExit }) {
  const { state }             = useGame()
  const shareRef              = useRef(null)
  const [sharing, setSharing] = useState(false)

  const diff        = DIFFICULTY_SETTINGS[state.difficulty] || {}
  const startCash   = diff.startingCash || 50000
  const netCashFlow = state.monthlyIncome - state.monthlyExpenses - (state.staffExpense || 0)
  const goal        = state.cashFlowGoal || 10000
  const equity      = state.portfolioValue - state.totalDebt
  const timeline    = formatTimeline(state.currentMonth - 1)

  const modalStats = [
    { label: 'Timeline',        value: timeline },
    { label: 'Portfolio Value', value: `$${state.portfolioValue.toLocaleString()}` },
    { label: 'Cash in Bank',    value: `$${state.cash.toLocaleString()}` },
    { label: 'Debt Leveraged',  value: `$${state.totalDebt.toLocaleString()}` },
    { label: 'Total Equity',    value: `$${equity.toLocaleString()}` },
    { label: 'Monthly CF',      value: `+$${netCashFlow.toLocaleString()}/mo`, highlight: true },
  ]

  async function handleShare() {
    if (sharing || !shareRef.current) return
    setSharing(true)
    try {
      const { toPng } = await import('html-to-image')
      const dataUrl   = await toPng(shareRef.current, { cacheBust: true, pixelRatio: 2 })
      const blob      = await (await fetch(dataUrl)).blob()
      const file      = new File([blob], 'equity-empire-win.png', { type: 'image/png' })

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'I built a real estate empire!',
          text:  `Monthly cash flow: +$${netCashFlow.toLocaleString()}/mo on Equity Empire`,
        })
      } else {
        const a    = document.createElement('a')
        a.href     = dataUrl
        a.download = 'equity-empire-win.png'
        a.click()
      }
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('Share failed:', err)
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="win-overlay">
      <div className="win-modal">
        <div className="win-confetti-row">🎊 🏆 🎉 💰 🎊</div>
        <h1 className="win-title">Goal Achieved!</h1>
        <p className="win-subtitle">
          Your portfolio now generates{' '}
          <strong>+${netCashFlow.toLocaleString()}/mo</strong> — you hit your $
          {goal.toLocaleString()}/mo goal!
        </p>

        <div className="win-stats-grid">
          {modalStats.map(s => (
            <div key={s.label} className={`win-stat${s.highlight ? ' win-stat--hl' : ''}`}>
              <span className="win-stat-label">{s.label}</span>
              <span className="win-stat-value">{s.value}</span>
            </div>
          ))}
        </div>

        <p className="win-meta">
          Started with ${startCash.toLocaleString()} · {state.difficulty} difficulty · Goal ${goal.toLocaleString()}/mo
        </p>

        <div className="win-actions">
          <button className="win-btn-continue" onClick={onContinue}>Keep Building 🚀</button>
          <button className="win-btn-share"   onClick={handleShare} disabled={sharing}>
            {sharing ? 'Generating…' : '📸 Share'}
          </button>
          <button className="win-btn-exit"    onClick={onExit}>Exit to Slots →</button>
        </div>
      </div>

      {/* Off-screen share card captured as the shareable image */}
      <div className="win-share-card" ref={shareRef} aria-hidden="true">
        <div className="wsc-header">
          <span className="wsc-logo">🏆 Equity Empire</span>
          <span className="wsc-badge">Goal Achieved!</span>
        </div>

        <div className="wsc-hero">
          <span className="wsc-cf-label">Monthly Cash Flow</span>
          <span className="wsc-cf">+${netCashFlow.toLocaleString()}<span className="wsc-cf-unit">/mo</span></span>
          <span className="wsc-goal-hit">Goal: ${goal.toLocaleString()}/mo ✓</span>
        </div>

        <div className="wsc-stats">
          <div className="wsc-stat">
            <span className="wsc-stat-val">${state.portfolioValue.toLocaleString()}</span>
            <span className="wsc-stat-lbl">Portfolio Value</span>
          </div>
          <div className="wsc-stat">
            <span className="wsc-stat-val">${equity.toLocaleString()}</span>
            <span className="wsc-stat-lbl">Total Equity</span>
          </div>
          <div className="wsc-stat">
            <span className="wsc-stat-val">${state.totalDebt.toLocaleString()}</span>
            <span className="wsc-stat-lbl">Debt Leveraged</span>
          </div>
          <div className="wsc-stat">
            <span className="wsc-stat-val">${state.cash.toLocaleString()}</span>
            <span className="wsc-stat-lbl">Cash in Bank</span>
          </div>
          <div className="wsc-stat">
            <span className="wsc-stat-val">{timeline}</span>
            <span className="wsc-stat-lbl">Time to Victory</span>
          </div>
          <div className="wsc-stat">
            <span className="wsc-stat-val">${startCash.toLocaleString()}</span>
            <span className="wsc-stat-lbl">Started With</span>
          </div>
        </div>

        <div className="wsc-footer">
          {state.difficulty?.charAt(0).toUpperCase() + state.difficulty?.slice(1)} difficulty
          &nbsp;·&nbsp; Equity Empire v3.1
        </div>
      </div>
    </div>
  )
}
