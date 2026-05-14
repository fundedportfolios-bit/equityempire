import { useState, useMemo } from 'react'
import { useGame } from '../core/gameState.js'
import { refinanceBatch } from '../core/gameEngine.js'
import { calculateRefinanceOptions, getMaxRefiNetCash } from '../systems/loanSystem.js'
import { formatCurrency, formatShort } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'

// ─── Eligibility badge (unchanged behavior) ───────────────────
function eligibilityLabel(property, state) {
  const options = calculateRefinanceOptions(property, state)
  if (options.every(o => o.isSeasoned))  return { text: 'All tiers eligible', cls: 'refi-elig refi-elig--full' }
  if (options.some(o => o.isSeasoned))   return { text: 'Low Risk eligible',  cls: 'refi-elig refi-elig--low'  }
  const months = property.monthsOwned || 0
  const remaining = Math.max(0, 6 - months)
  return { text: `Eligible in ${remaining} mo`, cls: 'refi-elig refi-elig--none' }
}

// ─── Single-property picker card (default mode) ───────────────
function RefiPropertyCard({ property, state, onSelect }) {
  const equity    = property.currentValue - property.loanBalance
  const maxCash   = getMaxRefiNetCash(property, state)
  const elig      = eligibilityLabel(property, state)
  const canRefi   = maxCash > 0

  return (
    <div className={`refi-picker-card${canRefi ? '' : ' refi-picker-card--ineligible'}`}>
      <div className="refi-picker-card-header">
        <PropertyIcon emoji={property.icon} image={property.iconImage} templateId={property.templateId} className="refi-picker-icon" />
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

// ─── Batch row (batch mode) ───────────────────────────────────
function BatchRefiRow({ property, state, selectedTierId, onPickTier }) {
  const options = useMemo(() => calculateRefinanceOptions(property, state), [property, state])
  const equity  = property.currentValue - property.loanBalance
  const anyAvailable = options.some(o => o.isAvailable)
  const isChecked    = !!selectedTierId

  function pickTier(tierId) {
    const opt = options.find(o => o.tierId === tierId)
    if (!opt?.isAvailable) return
    // Toggle off if re-tapping the same tier; otherwise swap.
    onPickTier(selectedTierId === tierId ? null : tierId)
  }

  return (
    <div className={`refi-picker-card refi-picker-card--batch${!anyAvailable ? ' refi-picker-card--ineligible' : ''}${isChecked ? ' refi-picker-card--checked' : ''}`}>
      <div className="refi-batch-row-top">
        <span className={`refi-batch-checkbox${isChecked ? ' refi-batch-checkbox--on' : ''}`}>
          {isChecked ? '✓' : ''}
        </span>
        <PropertyIcon emoji={property.icon} image={property.iconImage} templateId={property.templateId} className="refi-picker-icon" />
        <div className="refi-picker-name">
          <div className="refi-picker-prop-name">{property.name}</div>
          <div className="refi-picker-mo-owned">{property.monthsOwned || 0} mo owned · Equity {formatShort(equity)}</div>
        </div>
      </div>

      <div className="refi-batch-tier-row">
        {options.map(o => {
          const isActive   = selectedTierId === o.tierId
          const isDisabled = !o.isAvailable
          return (
            <button
              key={o.tierId}
              className={`refi-batch-tier-btn${isActive ? ' refi-batch-tier-btn--active' : ''}${isDisabled ? ' refi-batch-tier-btn--disabled' : ''}`}
              disabled={isDisabled}
              onClick={() => pickTier(o.tierId)}
              title={isDisabled ? (o.unavailableReason || 'Unavailable') : `Net ${formatCurrency(o.netCashToOwner)}`}
            >
              <span className="refi-batch-tier-label">{o.tierLabel}</span>
              <span className="refi-batch-tier-cash">{isDisabled ? '—' : formatCurrency(o.netCashToOwner)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────
export default function PortfolioRefiModal({ onSelectProperty, onClose }) {
  const { state, dispatch } = useGame()
  const refiRate = (state.marketInterestRate ?? 0.0678) + 0.012

  const [batchMode, setBatchMode]   = useState(false)
  // selections: { [propertyId]: tierId | null }
  const [selections, setSelections] = useState({})

  const sorted = [...state.properties].sort((a, b) => {
    const equityA = a.currentValue - a.loanBalance
    const equityB = b.currentValue - b.loanBalance
    return equityB - equityA
  })

  const canShowBatch = state.portfolioValue >= 2_000_000

  // Build the refi payload list from current selections. Filtered to valid+available.
  const refis = useMemo(() => {
    return Object.entries(selections)
      .map(([propertyId, tierId]) => {
        if (!tierId) return null
        const property = state.properties.find(p => p.id === propertyId)
        if (!property) return null
        const options = calculateRefinanceOptions(property, state)
        const opt = options.find(o => o.tierId === tierId)
        if (!opt?.isAvailable) return null
        return {
          propertyId,
          netCash:               opt.netCashToOwner,
          newLoanBalance:        opt.newLoanBalance,
          newMonthlyDebtService: opt.newMonthlyDebtService,
          newMonthlyExpenses:    opt.newMonthlyExpenses,
        }
      })
      .filter(Boolean)
  }, [selections, state])

  const totalNet   = refis.reduce((s, r) => s + r.netCash, 0)
  const canConfirm = refis.length > 0

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  function enterBatch() {
    setBatchMode(true)
  }
  function exitBatch() {
    setBatchMode(false)
    setSelections({})
  }
  function setTierFor(propertyId, tierId) {
    setSelections(prev => ({ ...prev, [propertyId]: tierId }))
  }
  function handleConfirm() {
    if (!canConfirm) return
    dispatch(refinanceBatch(refis))
    onClose()
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
          <div className="refi-header-actions">
            {canShowBatch && !batchMode && (
              <button className="btn btn-sm btn-primary refi-batch-toggle-btn" onClick={enterBatch}>
                Batch Refinance
              </button>
            )}
            {batchMode && (
              <button className="btn btn-sm btn-ghost refi-batch-toggle-btn" onClick={exitBatch}>
                ← Exit Batch
              </button>
            )}
            <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <div className="modal-body">
          {sorted.length === 0 ? (
            <p className="empty-state">No properties in your portfolio yet.</p>
          ) : batchMode ? (
            sorted.map(property => (
              <BatchRefiRow
                key={property.id}
                property={property}
                state={state}
                selectedTierId={selections[property.id] || null}
                onPickTier={(tierId) => setTierFor(property.id, tierId)}
              />
            ))
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

        {batchMode && (
          <div className="refi-batch-footer">
            <div className="refi-batch-summary">
              <span><strong>{refis.length}</strong> selected</span>
              <span>·</span>
              <span>Total net cash: <strong className={totalNet > 0 ? 'positive' : ''}>{formatCurrency(totalNet)}</strong></span>
            </div>
            <button
              className="btn btn-primary refi-batch-confirm-btn"
              disabled={!canConfirm}
              onClick={handleConfirm}
            >
              Confirm — refinance {refis.length}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
