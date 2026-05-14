import { useGame } from '../core/gameState.js'
import { dismissMilestone } from '../core/gameEngine.js'
import { formatShort } from '../utils/formatters.js'

const MILESTONE_CONFIG = {
  1000000:    { emoji: '🎯', color: '#22c55e', label: '$1M Portfolio!' },
  5000000:    { emoji: '🚀', color: '#3b82f6', label: '$5M Portfolio!' },
  10000000:   { emoji: '👑', color: '#a855f7', label: '$10M Portfolio!' },
  50000000:   { emoji: '🏆', color: '#f59e0b', label: '$50M Portfolio!' },
  halfwayCF:  { emoji: '💸', color: '#fbbf24', label: 'Halfway to Cash Flow Goal!' },
}

function formatMonths(m) {
  if (m < 12) return `${m} month${m !== 1 ? 's' : ''}`
  const yrs = Math.floor(m / 12)
  const mos = m % 12
  return mos === 0 ? `${yrs} yr${yrs !== 1 ? 's' : ''}` : `${yrs} yr ${mos} mo`
}

export default function MilestoneModal() {
  const { state, dispatch } = useGame()
  const m = state.activeMilestone
  if (!m) return null

  const cfg      = MILESTONE_CONFIG[m] || { emoji: '🎊', color: '#22c55e', label: `${formatShort(m)} Portfolio!` }
  const equity   = state.portfolioValue - state.totalDebt
  const netCF    = state.monthlyIncome - state.monthlyExpenses - (state.staffExpense || 0)
  const timeline = formatMonths(Math.max(1, state.currentMonth - 1))
  const goal     = state.cashFlowGoal || 10000
  const subtitle = m === 'halfwayCF'
    ? `You're earning ${formatShort(netCF)}/mo — halfway to your ${formatShort(goal)}/mo goal · ${timeline}`
    : `Reached in ${timeline}`

  return (
    <div className="milestone-overlay">
      <div className="milestone-modal" style={{ '--mc': cfg.color }}>
        <div className="milestone-glow" />
        <div className="milestone-emoji">{cfg.emoji}</div>
        <h2 className="milestone-title">{cfg.label}</h2>
        <p className="milestone-sub">{subtitle}</p>

        <div className="milestone-stats">
          <div className="milestone-stat">
            <span className="milestone-stat-val">{formatShort(state.portfolioValue)}</span>
            <span className="milestone-stat-lbl">Portfolio Value</span>
          </div>
          <div className="milestone-stat">
            <span className="milestone-stat-val">{formatShort(equity)}</span>
            <span className="milestone-stat-lbl">Total Equity</span>
          </div>
          <div className="milestone-stat">
            <span className="milestone-stat-val">{netCF >= 0 ? '+' : ''}{formatShort(netCF)}/mo</span>
            <span className="milestone-stat-lbl">Net Cash Flow</span>
          </div>
          <div className="milestone-stat">
            <span className="milestone-stat-val">{formatShort(state.totalDebt)}</span>
            <span className="milestone-stat-lbl">Debt Leveraged</span>
          </div>
        </div>

        <button className="milestone-btn" onClick={() => dispatch(dismissMilestone())}>
          Keep Building →
        </button>
      </div>
    </div>
  )
}
