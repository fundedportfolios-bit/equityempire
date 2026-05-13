import { useState, useEffect } from 'react'
import { useGame } from '../core/gameState.js'
import { buyProperty } from '../core/gameEngine.js'
import { generatePropertyOptions, canAffordOption } from '../systems/propertySystem.js'
import { formatCurrency, formatShort, formatCashFlow } from '../utils/formatters.js'

const RISK_COLORS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high' }
const TIER_LABELS  = { early: 'Early Game', mid: 'Mid Game', late: 'Late Game' }

function PropertyOption({ option, playerCash, onBuy }) {
  const canAfford = playerCash >= option.cashNeeded
  const deficit   = option.cashNeeded - playerCash

  return (
    <div className={`option-card${!canAfford ? ' option-card--unaffordable' : ''}`}>
      <div className="option-header">
        <div className="option-header-left">
          <span className="option-icon">{option.icon}</span>
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
        <div className="option-stat option-stat--highlight">
          <span className="option-stat-label">Cash Needed</span>
          <span className="option-stat-value">{formatCurrency(option.cashNeeded)}</span>
        </div>
      </div>

      {option.setupCost > 0 && (
        <p className="option-str-note">
          ⚠ STR requires sufficient cash for setup &amp; furnishing in addition to down payment and closing costs.
        </p>
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

  // Generate options once when the modal opens
  useEffect(() => {
    setOptions(generatePropertyOptions(state))
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
            <h2 className="modal-title">Choose a Property</h2>
            <p className="modal-subtitle">
              Available cash: <strong>{formatShort(state.cash)}</strong>
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {options.length === 0 ? (
            <p className="empty-state">No properties available yet. Grow your portfolio to unlock more types.</p>
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
