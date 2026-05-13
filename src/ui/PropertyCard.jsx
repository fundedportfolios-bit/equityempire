import { formatShort, formatCashFlow, formatCurrency } from '../utils/formatters.js'
import { calculateNetCashFlow } from '../utils/financeMath.js'
import { getMaxRefiCash } from '../systems/loanSystem.js'
import { getAvailableUpgrades } from '../systems/eventSystem.js'
import { useGame } from '../core/gameState.js'

export default function PropertyCard({ property, onUpgrade, onSellRefi }) {
  const { state }     = useGame()
  const netCashFlow   = calculateNetCashFlow(property.monthlyRent, property.monthlyExpenses)
  const equity        = property.currentValue - property.loanBalance
  const maxRefiCash   = getMaxRefiCash(property)
  const units         = property.units ?? 1
  const affordableUpgradeCount = getAvailableUpgrades(property).filter(t =>
    ((t.baseCost || 0) + (t.unitCostFactor || 0) * units) <= state.cash
  ).length

  return (
    <div className="property-card">
      <div className="property-card-header">
        <span className="property-name">{property.name}</span>
        <span className={`property-cashflow ${netCashFlow >= 0 ? 'positive' : 'negative'}`}>
          {formatCashFlow(netCashFlow)}/mo
        </span>
      </div>

      <div className="property-stats">
        <div className="property-stat">
          <span className="property-stat-label">Value</span>
          <span className="property-stat-value">{formatShort(property.currentValue)}</span>
        </div>
        <div className="property-stat">
          <span className="property-stat-label">Equity</span>
          <span className="property-stat-value">{formatShort(equity)}</span>
        </div>
        <div className="property-stat">
          <span className="property-stat-label">Rent</span>
          <span className="property-stat-value">{formatCurrency(property.monthlyRent)}</span>
        </div>
        <div className="property-stat">
          <span className="property-stat-label">Expenses</span>
          <span className="property-stat-value">{formatCurrency(property.monthlyExpenses)}</span>
        </div>
        <div className="property-stat">
          <span className="property-stat-label">Mo. Owned</span>
          <span className="property-stat-value">{property.monthsOwned || 0}</span>
        </div>
        <div className="property-stat">
          <span className="property-stat-label">Max Refi $</span>
          <span className="property-stat-value">{formatCurrency(maxRefiCash)}</span>
        </div>
      </div>

      {property.condition !== undefined && (
        <div className="property-condition">
          <span className="property-stat-label">Condition</span>
          <div className="condition-bar">
            <div
              className="condition-fill"
              style={{ width: `${property.condition}%` }}
              data-condition={property.condition > 60 ? 'good' : property.condition > 30 ? 'fair' : 'poor'}
            />
          </div>
          <span className="condition-label">{property.condition}%</span>
        </div>
      )}

      <div className="property-btn-row">
        <button
          className={`btn btn-secondary btn-sm property-manage-btn${affordableUpgradeCount === 0 ? ' btn-muted' : ''}`}
          onClick={() => onUpgrade(property.id)}
        >
          Upgrade
          {affordableUpgradeCount > 0 && <span className="event-badge">{affordableUpgradeCount}</span>}
        </button>
        <button
          className="btn btn-outline btn-sm property-sellrefi-btn"
          onClick={() => onSellRefi(property.id)}
        >
          Sell / Refi
        </button>
      </div>
    </div>
  )
}
