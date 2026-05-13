import { useGame } from '../core/gameState.js'
import { calculateEquity, calculateNetCashFlow } from '../utils/financeMath.js'
import { formatShort, formatCashFlow } from '../utils/formatters.js'

function StatCard({ label, value, valueClass = '' }) {
  return (
    <div className="stat-item">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${valueClass}`}>{value}</span>
    </div>
  )
}

function PropertyTypeBar({ properties }) {
  const groups = properties.reduce((acc, p) => {
    const key = p.icon || '🏠'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const entries = Object.entries(groups)
  if (entries.length === 0) return null
  return (
    <div className="property-type-bar">
      {entries.map(([icon, count]) => (
        <div key={icon} className="property-type-chip">
          <span className="ptc-count">{count}</span>
          <span className="ptc-icon">{icon}</span>
        </div>
      ))}
    </div>
  )
}

export default function PortfolioSummary() {
  const { state } = useGame()
  const equity = calculateEquity(state.portfolioValue, state.totalDebt)
  const netCashFlow = calculateNetCashFlow(state.monthlyIncome, state.monthlyExpenses) - (state.staffExpense || 0)

  const pmmsRate    = state.marketInterestRate ?? 0.0678
  const displayRate = ((pmmsRate + 0.012) * 100).toFixed(2)

  return (
    <section className="portfolio-summary">
      <div className="stats-strip">
        <StatCard label="Cash" value={formatShort(state.cash)} />
        <StatCard label="Portfolio Value" value={formatShort(state.portfolioValue)} />
        <StatCard label="Total Debt" value={formatShort(state.totalDebt)} />
        <StatCard
          label="Net Equity"
          value={formatShort(equity)}
          valueClass={equity >= 0 ? 'positive' : 'negative'}
        />
        <StatCard label="Monthly Income" value={formatShort(state.monthlyIncome)} />
        <StatCard label="Monthly Expenses" value={formatShort(state.monthlyExpenses)} />
        <StatCard
          label="Net Cash Flow"
          value={formatCashFlow(netCashFlow)}
          valueClass={netCashFlow >= 0 ? 'positive' : 'negative'}
        />
        <StatCard label="Interest Rate" value={`${displayRate}%`} />
        <StatCard label="Staff" value={`👤 ${state.staffCount || 0}`} />
      </div>
      <PropertyTypeBar properties={state.properties} />

    </section>
  )
}
