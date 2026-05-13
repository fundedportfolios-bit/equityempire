import { useGame } from '../core/gameState.js'
import { canRefinance, canFullRefinance, getMaxRefiCash } from '../systems/loanSystem.js'
import { REFI_RULES } from '../data/loanRules.js'
import { formatCurrency, formatShort } from '../utils/formatters.js'

function eligibilityLabel(property) {
  if (canFullRefinance(property)) return { text: 'Max refi eligible', cls: 'refi-elig refi-elig--full' }
  if (canRefinance(property))     return { text: 'Low Risk eligible',  cls: 'refi-elig refi-elig--low'  }
  const months = property.monthsOwned || 0
  const remaining = REFI_RULES.seasoningMonths - months
  return { text: `Eligible in ${remaining} mo`, cls: 'refi-elig refi-elig--none' }
}

function RefiPropertyCard({ property, refiRate, onSelect }) {
  const equity    = property.currentValue - property.loanBalance
  const maxCash   = getMaxRefiCash(property)
  const elig      = eligibilityLabel(property)
  const canRefi   = canRefinance(property) && maxCash > 0

  return (
    <div className={`refi-picker-card${canRefi ? '' : ' refi-picker-card--ineligible'}`}>
      <div className="refi-picker-card-header">
        <span className="refi-picker-icon">{property.icon}</span>
        <div className="refi-picker-name">
          <div className="refi-picker-prop-name">{property.name}</div>
          <div className="refi-picker-mo-owned">{property.monthsOwned || 0} months owned</div>
        </div>
        <span className={elig.cls}>{elig.text}</span>
      </div>

      <div className="refi-picker-stats">
        <div className="refi-picker-stat">
          <span className="refi-picker-stat-label">Value</span>
          <span className="refi-picker-stat-value">{formatShort(property.currentValue)}</span>
        </div>
        <div className="refi-picker-stat">
          <span className="refi-picker-stat-label">Loan</span>
          <span className="refi-picker-stat-value">{formatShort(property.loanBalance)}</span>
        </div>
        <div className="refi-picker-stat">
          <span className="refi-picker-stat-label">Equity</span>
          <span className={`refi-picker-stat-value${equity > 0 ? ' positive' : ' negative'}`}>
            {formatShort(equity)}
          </span>
        </div>
        <div className="refi-picker-stat">
          <span className="refi-picker-stat-label">Max Cash Out</span>
          <span className="refi-picker-stat-value">{formatCurrency(maxCash)}</span>
        </div>
      </div>

      <button
        className={`btn btn-sm refi-picker-btn${canRefi ? ' btn-primary' : ''}`}
        disabled={!canRefi}
        onClick={onSelect}
      >
        {canRefi ? 'View Options →' : 'Not yet eligible'}
      </button>
    </div>
  )
}

export default function PortfolioRefiModal({ onSelectProperty, onClose }) {
  const { state } = useGame()
  const refiRate = (state.marketInterestRate ?? 0.0678) + 0.012

  const sorted = [...state.properties].sort((a, b) => {
    const equityA = a.currentValue - a.loanBalance
    const equityB = b.currentValue - b.loanBalance
    return equityB - equityA
  })

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Refinance Options</h2>
            <p className="modal-subtitle">
              Available cash: <strong>{formatShort(state.cash)}</strong>
              {' · '}Rate: <strong>{((refiRate) * 100).toFixed(2)}%</strong>
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {sorted.length === 0 ? (
            <p className="empty-state">No properties in your portfolio yet.</p>
          ) : (
            sorted.map(property => (
              <RefiPropertyCard
                key={property.id}
                property={property}
                refiRate={refiRate}
                onSelect={() => onSelectProperty(property.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
