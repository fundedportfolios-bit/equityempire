import { useState, useMemo } from 'react'
import { useGame } from '../core/gameState.js'
import { refinanceBatch, sellPropertiesBatch } from '../core/gameEngine.js'
import { calculateRefinanceOptions, getMaxRefiNetCash, calcSaleProceeds } from '../systems/loanSystem.js'
import { formatCurrency, formatShort } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'

// ─── Eligibility badge (default mode) ──────────────────────────
function eligibilityLabel(property, state) {
  const options = calculateRefinanceOptions(property, state)
  if (options.every(o => o.isSeasoned))  return { text: 'All tiers eligible', cls: 'refi-elig refi-elig--full' }
  if (options.some(o => o.isSeasoned))   return { text: 'Low Risk eligible',  cls: 'refi-elig refi-elig--low'  }
  const months = property.monthsOwned || 0
  const remaining = Math.max(0, 6 - months)
  return { text: `Eligible in ${remaining} mo`, cls: 'refi-elig refi-elig--none' }
}

// ─── Single-property picker card (default mode) ────────────────
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

// ─── Batch refi row ───────────────────────────────────────────
function BatchRefiRow({ property, state, selectedTierId, onPickTier }) {
  const options = useMemo(() => calculateRefinanceOptions(property, state), [property, state])
  const equity  = property.currentValue - property.loanBalance
  const anyAvailable = options.some(o => o.isAvailable)
  const isChecked    = !!selectedTierId

  function pickTier(tierId) {
    const opt = options.find(o => o.tierId === tierId)
    if (!opt?.isAvailable) return
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

// ─── Batch sell row ───────────────────────────────────────────
function BatchSellRow({ property, saleData, isChecked, onToggle }) {
  const equity      = property.currentValue - property.loanBalance
  const netCF       = (property.monthlyRent || 0) - (property.monthlyExpenses || 0)
  const cfYield     = property.currentValue > 0 ? (netCF * 12) / property.currentValue : 0
  const canSell     = saleData.netProceeds > 0

  return (
    <div className={`refi-picker-card refi-picker-card--batch${!canSell ? ' refi-picker-card--ineligible' : ''}${isChecked ? ' refi-picker-card--checked' : ''}`}>
      <div className="refi-batch-row-top">
        <span className={`refi-batch-checkbox${isChecked ? ' refi-batch-checkbox--on' : ''}`}>
          {isChecked ? '✓' : ''}
        </span>
        <PropertyIcon emoji={property.icon} image={property.iconImage} templateId={property.templateId} className="refi-picker-icon" />
        <div className="refi-picker-name">
          <div className="refi-picker-prop-name">{property.name}</div>
          <div className="refi-picker-mo-owned">
            {netCF >= 0 ? '+' : ''}{formatCurrency(netCF)}/mo · {(cfYield * 100).toFixed(1)}% CF yield
          </div>
        </div>
      </div>
      <div className="refi-batch-sell-row">
        <div className="refi-batch-sell-stat">
          <span className="refi-batch-sell-label">Value</span>
          <span>{formatShort(property.currentValue)}</span>
        </div>
        <div className="refi-batch-sell-stat">
          <span className="refi-batch-sell-label">Loan</span>
          <span>{formatShort(property.loanBalance)}</span>
        </div>
        <div className="refi-batch-sell-stat">
          <span className="refi-batch-sell-label">Equity</span>
          <span>{formatShort(equity)}</span>
        </div>
        <div className="refi-batch-sell-stat">
          <span className="refi-batch-sell-label">Net proceeds</span>
          <span className={canSell ? 'positive' : 'negative'}>{formatCurrency(saleData.netProceeds)}</span>
        </div>
      </div>
      <button
        className={`btn btn-sm refi-batch-sell-toggle${isChecked ? ' btn-danger' : ''}`}
        onClick={onToggle}
        disabled={!canSell}
        title={canSell ? `Sell ${property.name}` : 'Loan payoff exceeds sale proceeds'}
      >
        {isChecked ? 'Selected for sale ✓' : (canSell ? 'Mark to sell' : 'Cannot sell at a loss')}
      </button>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────
export default function PortfolioRefiModal({ onSelectProperty, onClose }) {
  const { state, dispatch } = useGame()
  const refiRate = (state.marketInterestRate ?? 0.0678) + 0.012

  // Three modes: 'default' | 'batchRefi' | 'batchSell'
  const [mode, setMode]                         = useState('default')
  const [refiSelections, setRefiSelections]     = useState({})  // propertyId → tierId
  const [sellSelections, setSellSelections]     = useState({})  // propertyId → true

  const canShowBatch = state.portfolioValue >= 2_000_000

  // Sorting:
  //   default    → by equity desc (existing behavior)
  //   batchRefi  → by max refi net cash desc (most cash up top)
  //   batchSell  → by (cashFlow / currentValue) asc (weakest performers up top)
  const sorted = useMemo(() => {
    const arr = [...state.properties]
    if (mode === 'batchRefi') {
      return arr.sort((a, b) => getMaxRefiNetCash(b, state) - getMaxRefiNetCash(a, state))
    }
    if (mode === 'batchSell') {
      const yieldOf = p => {
        if (!p.currentValue) return Infinity  // bad data → bottom
        return ((p.monthlyRent || 0) - (p.monthlyExpenses || 0)) / p.currentValue
      }
      return arr.sort((a, b) => yieldOf(a) - yieldOf(b))
    }
    // default
    return arr.sort((a, b) => (b.currentValue - b.loanBalance) - (a.currentValue - a.loanBalance))
  }, [mode, state.properties, state])

  // ── Batch refi payload ──
  const refis = useMemo(() => {
    return Object.entries(refiSelections)
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
  }, [refiSelections, state])

  const totalRefiNet = refis.reduce((s, r) => s + r.netCash, 0)
  const canConfirmRefi = refis.length > 0

  // ── Batch sell payload ──
  const sales = useMemo(() => {
    return Object.entries(sellSelections)
      .map(([propertyId, on]) => {
        if (!on) return null
        const property = state.properties.find(p => p.id === propertyId)
        if (!property) return null
        const saleData = calcSaleProceeds(property)
        if (saleData.netProceeds <= 0) return null  // never sell at a loss in batch
        return { propertyId, netProceeds: saleData.netProceeds, name: property.name }
      })
      .filter(Boolean)
  }, [sellSelections, state.properties])

  const totalSellProceeds = sales.reduce((s, x) => s + x.netProceeds, 0)
  const canConfirmSell    = sales.length > 0

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  function enterBatchRefi() { setMode('batchRefi') }
  function enterBatchSell() { setMode('batchSell') }
  function exitBatch() {
    setMode('default')
    setRefiSelections({})
    setSellSelections({})
  }
  function setRefiTierFor(propertyId, tierId) {
    setRefiSelections(prev => ({ ...prev, [propertyId]: tierId }))
  }
  function toggleSellFor(propertyId) {
    setSellSelections(prev => ({ ...prev, [propertyId]: !prev[propertyId] }))
  }
  function handleConfirmRefi() {
    if (!canConfirmRefi) return
    dispatch(refinanceBatch(refis))
    onClose()
  }
  function handleConfirmSell() {
    if (!canConfirmSell) return
    dispatch(sellPropertiesBatch(sales.map(s => ({ propertyId: s.propertyId, netProceeds: s.netProceeds }))))
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Refinance / Sell</h2>
            <p className="modal-subtitle">
              Available cash: <strong>{formatShort(state.cash)}</strong>
              {' · '}Rate: <strong>{((refiRate) * 100).toFixed(2)}%</strong>
            </p>
          </div>
          <div className="refi-header-actions">
            {canShowBatch && mode === 'default' && (
              <>
                <button className="btn btn-sm btn-primary refi-batch-toggle-btn" onClick={enterBatchRefi}>
                  Batch Refinance
                </button>
                <button className="btn btn-sm btn-danger refi-batch-toggle-btn" onClick={enterBatchSell}>
                  Batch Sell
                </button>
              </>
            )}
            {mode !== 'default' && (
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
          ) : mode === 'batchRefi' ? (
            sorted.map(property => (
              <BatchRefiRow
                key={property.id}
                property={property}
                state={state}
                selectedTierId={refiSelections[property.id] || null}
                onPickTier={(tierId) => setRefiTierFor(property.id, tierId)}
              />
            ))
          ) : mode === 'batchSell' ? (
            sorted.map(property => (
              <BatchSellRow
                key={property.id}
                property={property}
                saleData={calcSaleProceeds(property)}
                isChecked={!!sellSelections[property.id]}
                onToggle={() => toggleSellFor(property.id)}
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

        {mode === 'batchRefi' && (
          <div className="refi-batch-footer">
            <div className="refi-batch-summary">
              <span><strong>{refis.length}</strong> selected</span>
              <span>·</span>
              <span>Total net cash: <strong className={totalRefiNet > 0 ? 'positive' : ''}>{formatCurrency(totalRefiNet)}</strong></span>
            </div>
            <button
              className="btn btn-primary refi-batch-confirm-btn"
              disabled={!canConfirmRefi}
              onClick={handleConfirmRefi}
            >
              Confirm — refinance {refis.length}
            </button>
          </div>
        )}

        {mode === 'batchSell' && (
          <div className="refi-batch-footer">
            <div className="refi-batch-summary">
              <span><strong>{sales.length}</strong> selected</span>
              <span>·</span>
              <span>Total proceeds: <strong className={totalSellProceeds > 0 ? 'positive' : ''}>{formatCurrency(totalSellProceeds)}</strong></span>
            </div>
            <button
              className="btn btn-danger refi-batch-confirm-btn"
              disabled={!canConfirmSell}
              onClick={handleConfirmSell}
            >
              Confirm — sell {sales.length}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
