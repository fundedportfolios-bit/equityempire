import { useGame } from '../core/gameState.js'
import { calculateRefinanceOptions, getMaxRefiNetCash } from '../systems/loanSystem.js'
import { formatCurrency, formatShort } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'

function eligibilityLabel(property, state) {
  const options = calculateRefinanceOptions(property, state)
  if (options.every(o => o.isSeasoned))  return { text: 'All tiers eligible', cls: 'refi-elig refi-elig--full' }
  if (options.some(o => o.isSeasoned))   return { text: 'Low Risk eligible',  cls: 'refi-elig refi-elig--low'  }
  const months = property.monthsOwned || 0
  const remaining = Math.max(0, 6 - months)
  return { text: `Eligible in ${remaining} mo`, cls: 'refi-elig refi-elig--none' }
}

function RefiPropertyCard({ property, state, onSelect }) {
  const equity    = property.currentValue - property.loanBalance
  const maxCash   = getMaxRefiNetCash(property, state)
  const elig      = eligibilityLabel(property, state)
  const canRefi   = maxCash > 0

  return (
    <div className={`refi-picker-card${canRefi ? '' : ' refi-picker-card--ineligible'}`}>
      <div className="refi-picker-card-header">
        <PropertyIcon emoji={property.icon} image={property.iconImage} className="refi-picker-icon" />
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
                state={state}
                onSelect={() => onSelectProperty(property.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
