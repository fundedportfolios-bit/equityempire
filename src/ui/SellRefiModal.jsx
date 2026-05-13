import { useGame } from '../core/gameState.js'
import { sellProperty, refinanceProperty } from '../core/gameEngine.js'
import { calcRefiOption, calcSaleProceeds, canRefinance, canFullRefinance, getMaxRefiCash } from '../systems/loanSystem.js'
import { formatCurrency, formatShort } from '../utils/formatters.js'
import { REFI_RULES } from '../data/loanRules.js'

function DeltaValue({ value }) {
  if (value === 0) return <span className="cash-flow-delta neutral">No change</span>
  const sign = value > 0 ? '+' : ''
  return (
    <span className={`cash-flow-delta ${value >= 0 ? 'positive' : 'negative'}`}>
      {sign}{formatCurrency(value)}/mo
    </span>
  )
}

function RefiCard({ label, option, seasoned, onConfirm }) {
  const isDisabled = !seasoned

  return (
    <div className={`refi-option-card${isDisabled ? ' refi-option-card--disabled' : ''}`}>
      <div className="refi-card-title">{label}</div>

      <div className="refi-detail-rows">
        <div className="refi-detail-row">
          <span>Gross cash out</span>
          <span>{formatCurrency(option.grossCashOut)}</span>
        </div>
        <div className="refi-detail-row">
          <span>Closing costs (4%)</span>
          <span className="negative">−{formatCurrency(option.closingCosts)}</span>
        </div>
        <div className="refi-detail-row refi-detail-row--highlight">
          <span>Net cash received</span>
          <span className="positive">{formatCurrency(option.netCash)}</span>
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
      </div>

      {isDisabled ? (
        <p className="seasoning-note">Seasoning required — not yet eligible</p>
      ) : option.netCash <= 0 ? (
        <p className="seasoning-note">No cash available after closing costs</p>
      ) : (
        <button className="btn btn-primary btn-sm refi-confirm-btn" onClick={onConfirm}>
          Confirm — receive {formatCurrency(option.netCash)}
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

export default function SellRefiModal({ propertyId, onClose }) {
  const { state, dispatch } = useGame()
  const property = state.properties.find(p => p.id === propertyId)
  if (!property) return null

  const seasoned        = canRefinance(property)
  const fullySeasoned   = canFullRefinance(property)
  const maxRefiCash     = getMaxRefiCash(property)
  const monthsOwned     = property.monthsOwned || 0
  const monthsToLowRef  = Math.max(0, REFI_RULES.seasoningMonths - monthsOwned)
  const monthsToFullRef = Math.max(0, REFI_RULES.maxRefiSeasoningMonths - monthsOwned)
  const equity          = property.currentValue - property.loanBalance

  const refiRate      = (state.marketInterestRate ?? 0.0678) + 0.012
  const lowRiskOption = calcRefiOption(property, 0.5, refiRate)
  const maxOption     = calcRefiOption(property, 1.0, refiRate)
  const saleData      = calcSaleProceeds(property)

  function handleRefi(option) {
    dispatch(refinanceProperty(propertyId, {
      netCash:              option.netCash,
      newLoanBalance:       option.newLoanBalance,
      newMonthlyDebtService: option.newMonthlyDebtService,
      newMonthlyExpenses:   option.newMonthlyExpenses,
    }))
    onClose()
  }

  function handleSell() {
    dispatch(sellProperty(propertyId, saleData.netProceeds))
    onClose()
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  // Determine which seasoning banner to show
  const showNoBanner   = seasoned && fullySeasoned
  const showMidBanner  = seasoned && !fullySeasoned
  const showEarlyBanner = !seasoned

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">
              {property.icon} {property.name}
            </h2>
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
              <span className="sellrefi-stat-label">Max Refi Cash</span>
              <span className="sellrefi-stat-value">{formatCurrency(maxRefiCash)}</span>
            </div>
          </div>

          {/* Seasoning banner */}
          {showEarlyBanner && (
            <div className="seasoning-banner">
              ⏳ Low Risk refi available after {REFI_RULES.seasoningMonths} months
              ({monthsToLowRef} month{monthsToLowRef !== 1 ? 's' : ''} remaining)
            </div>
          )}
          {showMidBanner && (
            <div className="seasoning-banner seasoning-banner--partial">
              ✓ Low Risk refi available &nbsp;·&nbsp; Max refi unlocks at {REFI_RULES.maxRefiSeasoningMonths} months
              ({monthsToFullRef} month{monthsToFullRef !== 1 ? 's' : ''} remaining)
            </div>
          )}

          <section className="manage-section">
            <h3 className="manage-section-title">Refinance Options</h3>
            <RefiCard
              label="Refinance — Low Risk (50%)"
              option={lowRiskOption}
              seasoned={seasoned}
              onConfirm={() => handleRefi(lowRiskOption)}
            />
            <RefiCard
              label="Refinance — Max (100%)"
              option={maxOption}
              seasoned={fullySeasoned}
              onConfirm={() => handleRefi(maxOption)}
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
