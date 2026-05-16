import { useState, useEffect } from 'react'
import { useGame } from '../core/gameState.js'
import { buyProperty } from '../core/gameEngine.js'
import { generatePropertyOptions, canAffordOption } from '../systems/propertySystem.js'
import { formatCurrency, formatShort, formatCashFlow } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'

const RISK_COLORS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high' }
const TIER_LABELS  = { early: 'Early Game', mid: 'Mid Game', late: 'Late Game' }

function PropertyOption({ option, playerCash, onBuy }) {
  const canAfford = playerCash >= option.cashNeeded
  const deficit   = option.cashNeeded - playerCash

  return (
    <div className={`option-card${!canAfford ? ' option-card--unaffordable' : ''}`}>
      {option.isHotDeal && (
        <div className="hot-deal-banner">🔥 HOT DEAL FOUND!</div>
      )}
      <div className="option-header">
        <div className="option-header-left">
          <PropertyIcon emoji={option.icon} image={option.iconImage} className="option-icon" />
          <div>
            <div className="option-type">{option.propertyType}</div>
            <div className="option-badges">
              <span className={`badge ${RISK_COLORS[option.riskLevel] ?? ''}`}>
                {option.riskLevel} risk
              </span>
              <span className="badge badge-tier">{TIER_LABELS[option.tier] ?? option.tier}</span>
              <span className="badge badge-strategy">{option.typicalStrategy}</span>
            </div>
          </div>
        </div>
        <div className="option-price">{formatShort(option.purchasePrice)}</div>
      </div>

      <p className="option-description">{option.description}</p>

      <div className="option-stats-grid">
        <div className="option-stat">
          <span className="option-stat-label">Monthly Income</span>
          <span className="option-stat-value positive">
            {option.monthlyIncome === 0 ? '—' : formatCurrency(option.monthlyIncome)}
          </span>
        </div>
        <div className="option-stat">
          <span className="option-stat-label">Monthly Expenses</span>
          <span className="option-stat-value">{formatCurrency(option.monthlyExpenses)}</span>
        </div>
        <div className="option-stat">
          <span className="option-stat-label">Net Cash Flow</span>
          <span className={`option-stat-value ${option.netCashFlow >= 0 ? 'positive' : 'negative'}`}>
            {formatCashFlow(option.netCashFlow)}/mo
          </span>
        </div>
        {option.monthlyIncome > 0 && (
          <div className="option-stat option-stat--highlight-cf">
            <span className="option-stat-label">Projected Owner CF</span>
            <span className={`option-stat-value ${option.projectedOwnerCashFlow >= 0 ? 'positive' : 'negative'}`}>
              {formatCashFlow(option.projectedOwnerCashFlow ?? 0)}/mo
            </span>
          </div>
        )}
        <div className="option-stat">
          <span className="option-stat-label">Down Payment</span>
          <span className="option-stat-value">{formatCurrency(option.downPayment)}</span>
        </div>
        <div className="option-stat">
          <span className="option-stat-label">Closing Costs</span>
          <span className="option-stat-value">{formatCurrency(option.closingCosts)}</span>
        </div>
        {option.setupCost > 0 && (
          <div className="option-stat">
            <span className="option-stat-label">Setup & Furnishing</span>
            <span className="option-stat-value">{formatCurrency(option.setupCost)}</span>
          </div>
        )}
        {option.startupActionCost > 0 && (
          <div className="option-stat">
            <span className="option-stat-label">Startup Costs</span>
            <span className="option-stat-value">{formatCurrency(option.startupActionCost)}</span>
          </div>
        )}
        {option.immediateRepairCost > 0 && (
          <div className="option-stat">
            <span className="option-stat-label">Immediate Repairs</span>
            <span className="option-stat-value negative">{formatCurrency(option.immediateRepairCost)}</span>
          </div>
        )}
        <div className="option-stat option-stat--highlight">
          <span className="option-stat-label">Cash Needed</span>
          <span className="option-stat-value">{formatCurrency(option.cashNeeded)}</span>
        </div>
      </div>

      {option.startupActionCost > 0 && (
        <p className="option-str-note">
          ⚠ Cash Needed includes ${option.startupActionCost.toLocaleString()} reserved for immediate startup costs after purchase.
        </p>
      )}

      {option.conditionLabel && (
        <div className="deal-info">
          <div className="deal-info-row">
            <span className="deal-info-label">Condition</span>
            <span className="deal-info-value">{option.conditionLabel}, {option.conditionScore}/100</span>
          </div>
          <div className="deal-info-row">
            <span className="deal-info-label">Deal Type</span>
            <span className="deal-info-value">{option.dealArchetypeLabel}</span>
          </div>
          {option.immediateRepairCost > 0 && (
            <div className="deal-info-row">
              <span className="deal-info-label">Immediate Repairs</span>
              <span className="deal-info-value deal-info-value--warn">{formatCurrency(option.immediateRepairCost)}</span>
            </div>
          )}
          <div className="deal-info-row">
            <span className="deal-info-label">Value Add Potential</span>
            <span className={`deal-info-value deal-vap-${option.valueAddPotential}`}>
              {option.valueAddPotential.charAt(0).toUpperCase() + option.valueAddPotential.slice(1)}
            </span>
          </div>
          <p className="deal-description">{option.dealDescription}</p>
        </div>
      )}

      {!canAfford && (
        <p className="option-deficit">
          Need {formatCurrency(deficit)} more to buy this property.
        </p>
      )}

      <button
        className="btn btn-primary option-buy-btn"
        disabled={!canAfford}
        onClick={() => onBuy(option)}
      >
        {canAfford ? `Buy — ${formatCurrency(option.cashNeeded)} cash` : 'Not enough cash'}
      </button>
    </div>
  )
}

export default function InvestModal({ onClose }) {
  const { state, dispatch } = useGame()
  const [options, setOptions] = useState([])

  // Generate options once when the modal opens.
  // Hot deal always lands at the top; other options sort by highest projected
  // net cash flow first (best earner up top).
  useEffect(() => {
    const opts = generatePropertyOptions(state)
    const hot  = opts.filter(o => o.isHotDeal)
    const rest = opts.filter(o => !o.isHotDeal).sort(
      (a, b) => (b.netCashFlow ?? 0) - (a.netCashFlow ?? 0)
    )
    setOptions([...hot, ...rest])
  }, [])

  function handleBuy(option) {
    if (!canAffordOption(state, option)) return
    dispatch(buyProperty(option))
    onClose()
  }

  // Close on overlay click
  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Properties Currently For Sale</h2>
            <p className="modal-subtitle modal-subtitle--hint">
              Close and re-open for more options
            </p>
            <p className="modal-subtitle">
              Available cash: <strong>{formatShort(state.cash)}</strong>
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {options.length === 0 ? (
            <p className="empty-state">
              No affordable properties this round — close and try again, or save up more cash.
            </p>
          ) : (
            options.map(option => (
              <PropertyOption
                key={option.id}
                option={option}
                playerCash={state.cash}
                onBuy={handleBuy}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
