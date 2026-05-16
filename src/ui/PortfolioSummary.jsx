import { useGame } from '../core/gameState.js'
import { DIFFICULTY_SETTINGS } from '../data/difficultySettings.js'
import { calculateEquity, calculateNetCashFlow } from '../utils/financeMath.js'
import { formatShort, formatCashFlow } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'
import { getStaffCounts, getTotalStaffCount, getCoverageRatio, getStaffStatus } from '../systems/staffSystem.js'
import { STAFF_ROLES, STAFF_ROLE_ORDER, COVERAGE_STATUSES } from '../data/staffRules.js'

function StatCard({ label, value, valueClass = '' }) {
  return (
    <div className="stat-item">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${valueClass}`}>{value}</span>
    </div>
  )
}

function PropertyTypeBar({ properties, state }) {
  // Group properties by templateId so we can pull both the emoji and the
  // image path from the first matching property in each group.
  const groups = properties.reduce((acc, p) => {
    const key = p.templateId || p.icon || 'unknown'
    if (!acc[key]) acc[key] = { count: 0, emoji: p.icon || '🏠', image: p.iconImage, templateId: p.templateId }
    acc[key].count++
    return acc
  }, {})
  const entries     = Object.entries(groups)
  const staffCounts = getStaffCounts(state)
  const totalStaff  = getTotalStaffCount(state)
  if (entries.length === 0 && totalStaff === 0) return null
  return (
    <div className="property-type-bar">
      <div className="ptb-icons">
        {entries.map(([key, { count, emoji, image, templateId }]) => (
          <div key={key} className="property-type-chip">
            <span className="ptc-count">{count}</span>
            <PropertyIcon emoji={emoji} image={image} templateId={templateId} className="ptc-icon" />
          </div>
        ))}
        {entries.length === 0 && <span className="ptb-empty">No properties yet</span>}
      </div>
      <div className="ptb-staff-group">
        {STAFF_ROLE_ORDER.map(role => {
          const count = staffCounts[role] || 0
          if (count === 0) return null
          const cfg = STAFF_ROLES[role]
          return (
            <div key={role} className="ptb-staff-chip" title={`${cfg.label}: ${count}`}>
              <PropertyIcon emoji={cfg.icon} image={cfg.iconImage} className="ptc-icon" />
              <span className="ptc-count">{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CoverageStatusRow({ state }) {
  const totalStaff = getTotalStaffCount(state)
  if (totalStaff === 0) return null
  const status = getStaffStatus(state)
  const ratio  = getCoverageRatio(state)
  const pct    = isFinite(ratio) ? `${Math.round(Math.min(ratio, 2) * 100)}%` : '100%'
  const cls    = (() => {
    switch (status) {
      case COVERAGE_STATUSES.COVERED:        return 'coverage-row--covered'
      case COVERAGE_STATUSES.STRETCHED:      return 'coverage-row--stretched'
      case COVERAGE_STATUSES.OVERLOADED:     return 'coverage-row--overloaded'
      case COVERAGE_STATUSES.BREAKDOWN_RISK: return 'coverage-row--breakdown'
      default:                                return ''
    }
  })()
  return (
    <div className={`coverage-row ${cls}`}>
      <span className="coverage-row-label">Coverage</span>
      <span className="coverage-row-value">{pct}</span>
      <span className="coverage-row-status">{status}</span>
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

      <PropertyTypeBar properties={state.properties} state={state} />
      <CoverageStatusRow state={state} />
    </section>
  )
}
