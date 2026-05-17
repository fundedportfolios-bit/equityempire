import { useState } from 'react'
import { useGame } from '../core/gameState.js'
import { sellProperty, refinanceProperty, payDownLoan } from '../core/gameEngine.js'
import { calculateRefinanceOptions, calcSaleProceeds, getMaxRefiNetCash } from '../systems/loanSystem.js'
import { calculateMortgagePayment } from '../utils/financeMath.js'
import { formatCurrency, formatShort } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'

function DeltaValue({ value }) {
  if (value === 0) return <span className="cash-flow-delta neutral">No change</span>
  const sign = value > 0 ? '+' : ''
  return (
    <span className={`cash-flow-delta ${value >= 0 ? 'positive' : 'negative'}`}>
      {sign}{formatCurrency(value)}/mo
    </span>
  )
}

function RefiCard({ option, onConfirm }) {
  const disabled = !option.isAvailable

  return (
    <div className={`refi-option-card${disabled ? ' refi-option-card--disabled' : ''}`}>
      <div className="refi-card-title">
        {option.tierLabel}
        <span className="refi-card-meta">
          {Math.round(option.maxLTV * 100)}% LTV · {option.targetDSCR.toFixed(2)}× DSCR
        </span>
      </div>

      <div className="refi-detail-rows">
        <div className="refi-detail-row">
          <span>Gross cash out</span>
          <span>{formatCurrency(option.grossCashOut)}</span>
        </div>
        <div className="refi-detail-row">
          <span>Closing costs ({(option.closingCostPercent * 100).toFixed(1)}%)</span>
          <span className="negative">−{formatCurrency(option.closingCosts)}</span>
        </div>
        <div className="refi-detail-row refi-detail-row--highlight">
          <span>Net cash received</span>
          <span className="positive">{formatCurrency(option.netCashToOwner)}</span>
        </div>
        <div className="refi-detail-row">
          <span>New loan balance</span>
          <span>{formatCurrency(option.newLoanBalance)}</span>
        </div>
      </div>

      <div className="refi-effect-section">
        <div className="refi-effect-label">Monthly debt service</div>
        <div className="refi-effect-row">
          <span>{formatCurrency(option.oldMonthlyDebtService)}/mo</span>
          <span className="refi-arrow">→</span>
          <span>{formatCurrency(option.newMonthlyDebtService)}/mo</span>
        </div>
        <div className="refi-effect-label">Monthly cash flow</div>
        <div className="refi-effect-row">
          <span>{formatCurrency(option.oldCashFlow)}/mo</span>
          <span className="refi-arrow">→</span>
          <span>{formatCurrency(option.newCashFlow)}/mo</span>
        </div>
        <div className="refi-effect-delta">
          <DeltaValue value={option.cashFlowDelta} />
        </div>
        {option.dscrConstraintActive && option.isSeasoned && (
          <p className="refi-dscr-note">DSCR constraint limits this option</p>
        )}
      </div>

      {disabled ? (
        <p className="seasoning-note">{option.unavailableReason}</p>
      ) : (
        <button className="btn btn-primary btn-sm refi-confirm-btn" onClick={onConfirm}>
          Confirm — receive {formatCurrency(option.netCashToOwner)}
        </button>
      )}
    </div>
  )
}

function SellCard({ saleData, onConfirm }) {
  return (
    <div className="refi-option-card refi-option-card--sell">
      <div className="refi-card-title">Sell Property</div>

      <div className="refi-detail-rows">
        <div className="refi-detail-row">
          <span>Sale price</span>
          <span>{formatCurrency(saleData.salePrice)}</span>
        </div>
        <div className="refi-detail-row">
          <span>Selling costs (4%)</span>
          <span className="negative">−{formatCurrency(saleData.sellingCosts)}</span>
        </div>
        <div className="refi-detail-row">
          <span>Loan payoff</span>
          <span className="negative">−{formatCurrency(saleData.loanPayoff)}</span>
        </div>
        <div className="refi-detail-row refi-detail-row--highlight">
          <span>Net proceeds</span>
          <span className={saleData.netProceeds > 0 ? 'positive' : 'negative'}>
            {formatCurrency(saleData.netProceeds)}
          </span>
        </div>
      </div>

      <div className="refi-sell-note">
        Property will be removed from your portfolio. All income, expenses, and maintenance events will stop.
      </div>

      {saleData.netProceeds <= 0 ? (
        <p className="seasoning-note">Loan payoff exceeds sale proceeds — selling would result in a loss</p>
      ) : (
        <button className="btn btn-danger btn-sm refi-confirm-btn" onClick={onConfirm}>
          Confirm Sale — receive {formatCurrency(saleData.netProceeds)}
        </button>
      )}
    </div>
  )
}

function PayDownCard({ property, availableCash, onConfirm }) {
  const loanBalance = property.loanBalance || 0
  const rate        = property.interestRate ?? 0.08
  const term        = property.loanTermMonths ?? 360
  const oldPI       = Math.round(property.monthlyDebtService || 0)
  const oldExpenses = property.monthlyExpenses || 0
  const oldCF       = (property.monthlyRent || 0) - oldExpenses

  // Slider range: 0 to min(cash, loanBalance). Default 0.
  const sliderMax = Math.min(availableCash, loanBalance)
  const [amount, setAmount] = useState(0)
  const safeAmount = Math.min(Math.max(0, amount), sliderMax)

  // Live preview of post-pay-down numbers.
  const newBalance = Math.max(0, loanBalance - safeAmount)
  const newPI      = Math.round(calculateMortgagePayment(newBalance, rate, term))
  const newExp     = Math.max(0, oldExpenses - oldPI + newPI)
  const newCF      = (property.monthlyRent || 0) - newExp
  const cfDelta    = newCF - oldCF

  const canPayOff = loanBalance > 0 && availableCash >= loanBalance
  const canApply  = loanBalance > 0 && safeAmount > 0 && availableCash >= safeAmount

  function handlePayOffClick() {
    setAmount(loanBalance)
  }

  return (
    <div className="refi-option-card refi-option-card--paydown">
      <div className="refi-card-title">
        Pay Down Loan
        <span className="refi-card-meta">
          {(rate * 100).toFixed(2)}% APR · {term / 12}-yr term
        </span>
      </div>

      <div className="refi-detail-rows">
        <div className="refi-detail-row">
          <span>Current loan balance</span>
          <span>{formatCurrency(loanBalance)}</span>
        </div>
        <div className="refi-detail-row">
          <span>Current monthly P&amp;I</span>
          <span>{formatCurrency(oldPI)}/mo</span>
        </div>
        <div className="refi-detail-row">
          <span>Cash available</span>
          <span>{formatCurrency(availableCash)}</span>
        </div>
      </div>

      <div className="paydown-slider-wrap">
        <div className="paydown-slider-header">
          <span className="paydown-slider-label">Amount to apply</span>
          <span className="paydown-slider-value">{formatCurrency(safeAmount)}</span>
        </div>
        <input
          type="range"
          className="paydown-slider"
          min={0}
          max={Math.max(sliderMax, 0)}
          step={Math.max(100, Math.floor(sliderMax / 200) || 1)}
          value={safeAmount}
          onChange={(e) => setAmount(Number(e.target.value))}
          disabled={sliderMax <= 0}
        />
        <div className="paydown-slider-row">
          <button
            type="button"
            className="btn btn-ghost btn-sm paydown-payoff-btn"
            onClick={handlePayOffClick}
            disabled={!canPayOff}
            title={canPayOff
              ? `Apply ${formatCurrency(loanBalance)} to pay off this loan entirely`
              : 'Not enough cash to pay off the full loan'}
          >
            Pay Off · {formatCurrency(loanBalance)}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setAmount(0)}
            disabled={safeAmount === 0}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="refi-effect-section">
        <div className="refi-effect-label">Monthly debt service</div>
        <div className="refi-effect-row">
          <span>{formatCurrency(oldPI)}/mo</span>
          <span className="refi-arrow">→</span>
          <span>{formatCurrency(newPI)}/mo</span>
        </div>
        <div className="refi-effect-label">Monthly cash flow</div>
        <div className="refi-effect-row">
          <span>{formatCurrency(oldCF)}/mo</span>
          <span className="refi-arrow">→</span>
          <span>{formatCurrency(newCF)}/mo</span>
        </div>
        <div className="refi-effect-delta">
          {cfDelta === 0
            ? <span className="cash-flow-delta neutral">No change</span>
            : <span className={`cash-flow-delta ${cfDelta >= 0 ? 'positive' : 'negative'}`}>
                {cfDelta >= 0 ? '+' : ''}{formatCurrency(cfDelta)}/mo
              </span>
          }
        </div>
        {newBalance > 0 && (
          <div className="refi-effect-label paydown-note">
            New loan balance: <strong>{formatCurrency(newBalance)}</strong>
          </div>
        )}
        {newBalance === 0 && safeAmount > 0 && (
          <p className="paydown-note paydown-note--success">
            Loan fully paid off. Taxes, insurance, HOA, and any STR utilities remain.
          </p>
        )}
      </div>

      {loanBalance === 0 ? (
        <p className="seasoning-note">This property has no remaining loan to pay down.</p>
      ) : (
        <button
          className="btn btn-primary btn-sm refi-confirm-btn"
          disabled={!canApply}
          onClick={() => onConfirm(safeAmount)}
        >
          {safeAmount === loanBalance && safeAmount > 0
            ? `Pay Off — ${formatCurrency(safeAmount)}`
            : safeAmount > 0
              ? `Apply ${formatCurrency(safeAmount)}`
              : 'Pick an amount'}
        </button>
      )}
    </div>
  )
}

export default function SellRefiModal({ propertyId, onClose }) {
  const { state, dispatch } = useGame()
  const property = state.properties.find(p => p.id === propertyId)
  if (!property) return null

  // ── Shared refinance calculation (single source of truth) ──
  const refiOptions  = calculateRefinanceOptions(property, state)
  const maxNetCash   = getMaxRefiNetCash(property, state)
  const equity       = property.currentValue - property.loanBalance
  const monthsOwned  = property.monthsOwned || 0

  const lowRisk  = refiOptions[0]  // Low Risk
  const standard = refiOptions[1]  // Standard Cash-Out
  const maxOpt   = refiOptions[2]  // Max Cash-Out

  const saleData = calcSaleProceeds(property)

  function handleRefi(option) {
    dispatch(refinanceProperty(propertyId, {
      netCash:               option.netCashToOwner,
      newLoanBalance:        option.newLoanBalance,
      newMonthlyDebtService: option.newMonthlyDebtService,
      newMonthlyExpenses:    option.newMonthlyExpenses,
    }))
    onClose()
  }

  function handleSell() {
    dispatch(sellProperty(propertyId, saleData.netProceeds))
    onClose()
  }

  function handlePayDown(amount) {
    if (!amount || amount <= 0) return
    dispatch(payDownLoan(propertyId, amount))
    onClose()
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  // ── Seasoning banner logic ──────────────────────────────────
  const anyAvailable = refiOptions.some(o => o.isSeasoned)
  const allAvailable = refiOptions.every(o => o.isSeasoned)
  const monthsToLow  = Math.max(0, 6 - monthsOwned)
  const monthsToFull = Math.max(0, 12 - monthsOwned)

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">
              <PropertyIcon emoji={property.icon} image={property.iconImage} templateId={property.templateId} inline /> {property.name}
            </h2>
            <p className="modal-subtitle modal-subtitle--equity">
              Manage Equity — Refinance, Pay Down, Sell
            </p>
            <p className="modal-subtitle">
              Available cash: <strong>{formatShort(state.cash)}</strong>
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {/* Property summary */}
          <div className="sellrefi-summary-strip">
            <div className="sellrefi-stat">
              <span className="sellrefi-stat-label">Current Value</span>
              <span className="sellrefi-stat-value">{formatShort(property.currentValue)}</span>
            </div>
            <div className="sellrefi-stat">
              <span className="sellrefi-stat-label">Loan Balance</span>
              <span className="sellrefi-stat-value">{formatShort(property.loanBalance)}</span>
            </div>
            <div className="sellrefi-stat">
              <span className="sellrefi-stat-label">Equity</span>
              <span className="sellrefi-stat-value">{formatShort(equity)}</span>
            </div>
            <div className="sellrefi-stat">
              <span className="sellrefi-stat-label">Mo. Owned</span>
              <span className="sellrefi-stat-value">{monthsOwned}</span>
            </div>
            <div className="sellrefi-stat">
              <span className="sellrefi-stat-label">Max Refi $</span>
              <span className="sellrefi-stat-value">{formatCurrency(maxNetCash)}</span>
            </div>
          </div>

          {/* Seasoning banner */}
          {!anyAvailable && (
            <div className="seasoning-banner">
              ⏳ Low Risk refi available after 6 months
              ({monthsToLow} month{monthsToLow !== 1 ? 's' : ''} remaining)
            </div>
          )}
          {anyAvailable && !allAvailable && (
            <div className="seasoning-banner seasoning-banner--partial">
              ✓ Low Risk refi available &nbsp;·&nbsp; Standard & Max unlock at 12 months
              ({monthsToFull} month{monthsToFull !== 1 ? 's' : ''} remaining)
            </div>
          )}

          <section className="manage-section">
            <h3 className="manage-section-title">Refinance Options</h3>
            <RefiCard option={lowRisk}  onConfirm={() => handleRefi(lowRisk)} />
            <RefiCard option={standard} onConfirm={() => handleRefi(standard)} />
            <RefiCard option={maxOpt}   onConfirm={() => handleRefi(maxOpt)} />
          </section>

          <section className="manage-section">
            <h3 className="manage-section-title">Pay Down Loan</h3>
            <PayDownCard
              property={property}
              availableCash={state.cash}
              onConfirm={handlePayDown}
            />
          </section>

          <section className="manage-section">
            <h3 className="manage-section-title">Sell Property</h3>
            <SellCard saleData={saleData} onConfirm={handleSell} />
          </section>
        </div>
      </div>
    </div>
  )
}
