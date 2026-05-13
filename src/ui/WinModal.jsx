import { useGame } from '../core/gameState.js'

export default function WinModal({ onContinue, onExit }) {
  const { state } = useGame()
  const netCashFlow = state.monthlyIncome - state.monthlyExpenses - (state.staffExpense || 0)
  const goal        = state.cashFlowGoal || 10000

  return (
    <div className="win-overlay">
      <div className="win-modal">
        <div className="win-confetti-row">🎊 🏆 🎉 💰 🎊</div>
        <h1 className="win-title">Goal Achieved!</h1>
        <p className="win-subtitle">You've built a cash-flowing empire!</p>

        <div className="win-stats">
          <div className="win-stat">
            <span className="win-stat-label">Monthly Cash Flow</span>
            <span className="win-stat-value win-stat-cf">${netCashFlow.toLocaleString()}/mo</span>
          </div>
          <div className="win-stat">
            <span className="win-stat-label">Your Goal</span>
            <span className="win-stat-value">${goal.toLocaleString()}/mo</span>
          </div>
          <div className="win-stat">
            <span className="win-stat-label">Portfolio Value</span>
            <span className="win-stat-value">${state.portfolioValue.toLocaleString()}</span>
          </div>
        </div>

        <p className="win-message">
          Congratulations! Your portfolio generates{' '}
          <strong>${netCashFlow.toLocaleString()}</strong> per month in net cash flow —
          beating your goal of <strong>${goal.toLocaleString()}</strong>.
          What's your next move?
        </p>

        <div className="win-actions">
          <button className="win-btn-continue" onClick={onContinue}>
            Keep Building 🚀
          </button>
          <button className="win-btn-exit" onClick={onExit}>
            Exit to Slots →
          </button>
        </div>
      </div>
    </div>
  )
}
