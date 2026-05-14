import { useGame } from '../core/gameState.js'
import { DIFFICULTY_SETTINGS } from '../data/difficultySettings.js'
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

function PropertyTypeBar({ properties, staffCount }) {
  const groups = properties.reduce((acc, p) => {
    const key = p.icon || '🏠'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const entries = Object.entries(groups)
  if (entries.length === 0 && staffCount === 0) return null
  return (
    <div className="property-type-bar">
      <div className="ptb-icons">
        {entries.map(([icon, count]) => (
          <div key={icon} className="property-type-chip">
            <span className="ptc-count">{count}</span>
            <span className="ptc-icon">{icon}</span>
          </div>
        ))}
        {entries.length === 0 && <span className="ptb-empty">No properties yet</span>}
      </div>
      <div className="ptb-staff">
        <span className="ptc-icon">👤</span>
        <span className="ptc-count">{staffCount}</span>
      </div>
    </div>
  )
}

export default function PortfolioSummary() {
  const { state } = useGame()
  const equity      = calculateEquity(state.portfolioValue, state.totalDebt)
  const netCashFlow = calculateNetCashFlow(state.monthlyIncome, state.monthlyExpenses) - (state.staffExpense || 0)

  const goal        = state.cashFlowGoal || 10000
  const goalPct     = goal > 0 ? Math.round((netCashFlow / goal) * 100) : 0
  const goalPctDisplay = `${goalPct}%`
  const goalClass   = goalPct >= 100 ? 'positive' : goalPct >= 50 ? 'goal-mid' : ''

  // Avg Return/Yr = total return % ÷ years elapsed
  const initialCash    = DIFFICULTY_SETTINGS[state.difficulty]?.startingCash ?? 75000
  const totalReturnPct = ((equity + state.cash - initialCash) / initialCash) * 100
  const monthsElapsed  = Math.max(1, (state.currentMonth || 1) - 1)
  const yearsElapsed   = Math.max(1 / 12, monthsElapsed / 12)
  const annualReturn   = Math.round(totalReturnPct / yearsElapsed)
  const annualReturnDisplay = annualReturn === 0 ? '0%' : `${annualReturn > 0 ? '+' : ''}${annualReturn}%`
  const annualReturnClass   = annualReturn >= 20 ? 'positive' : annualReturn < 0 ? 'negative' : ''

  return (
    <section className="portfolio-summary">
      {/* ── Row 1 + 2: named DASHBOARD ─────────────────────── */}
      <div className="stats-block">
        <span className="stats-section-label">DASHBOARD</span>
        <div className="stats-strip">
          <StatCard label="Cash"   value={formatShort(state.cash)} />
          <StatCard label="Value"  value={formatShort(state.portfolioValue)} />
          <StatCard
            label="Equity"
            value={formatShort(equity)}
            valueClass={equity >= 0 ? 'positive' : 'negative'}
          />
          <StatCard label="Debt" value={formatShort(state.totalDebt)} />
          <StatCard
            label="Avg Return/Yr"
            value={annualReturnDisplay}
            valueClass={annualReturnClass}
          />
          <StatCard
            label="% Goal"
            value={goalPctDisplay}
            valueClass={goalClass}
          />
        </div>
      </div>

      {/* ── Monthly row: no label, distinct border + bg ─────── */}
      <div className="stats-block stats-block--monthly">
        <div className="stats-strip">
          <StatCard label="Income"   value={formatShort(state.monthlyIncome)} />
          <StatCard label="Expenses" value={formatShort(state.monthlyExpenses)} />
          <StatCard
            label="Net Cash Flow"
            value={formatCashFlow(netCashFlow)}
            valueClass={netCashFlow >= 0 ? 'positive' : 'negative'}
          />
        </div>
      </div>

      <PropertyTypeBar properties={state.properties} staffCount={state.staffCount || 0} />
    </section>
  )
}
