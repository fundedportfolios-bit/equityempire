// valuationDebug.js
// Exposes window.runValuationDebug(difficulty?) in the dev console.
// Generates one sample property per type and logs the full valuation breakdown.
//
// Usage:
//   window.runValuationDebug()            // medium difficulty
//   window.runValuationDebug('easy')
//   window.runValuationDebug('hard')

import { PROPERTY_TYPES }                             from '../data/propertyTypes.js'
import { _debug_generateOption, computeBlendedValue,
         VALUATION_CONFIG }                           from '../systems/propertySystem.js'

const REFI_LTV    = 0.75
const TARGET_DSCR = 1.25

window.runValuationDebug = function (difficulty = 'medium') {
  console.group(`=== Valuation Debug [difficulty: ${difficulty}] ===`)

  PROPERTY_TYPES.forEach(template => {
    if (template.incomeType === 'none') {
      console.log(`\n[${template.id}] — fix_flip: pure appreciation, no income blend`)
      return
    }

    const opt  = _debug_generateOption(template, difficulty)
    const config = VALUATION_CONFIG[template.id] ?? {}

    // Simulate a property at 24 months owned (past all STR seasoning tiers)
    const prop = {
      templateId:             opt.templateId,
      monthlyRent:            opt.monthlyIncome,
      monthlyExpenses:        opt.monthlyExpenses,
      monthlyDebtService:     opt.monthlyDebtService ?? 0,
      expectedCostDrag:       opt.expectedCostDrag   ?? 0,
      purchasePrice:          opt.purchasePrice,
      loanBalance:            opt.loanBalance,
      monthsOwned:            24,
      baseMarketValue:        opt.purchasePrice,
      totalUpgradeValueBoost: 0,
      blendedPreUpgradeValue: opt.purchasePrice,
    }

    const { currentValue, blendedPreUpgradeValue } = computeBlendedValue(prop)

    const monthlyNOI  = prop.monthlyRent
      - (prop.monthlyExpenses - prop.monthlyDebtService)
      - prop.expectedCostDrag
    const annualNOI   = Math.max(0, monthlyNOI) * 12
    const incomeVal   = config.capRate ? Math.round(annualNOI / config.capRate) : 0
    const equity      = currentValue - prop.loanBalance
    const maxRefiLTV  = Math.round(currentValue * REFI_LTV)

    // DSCR max loan (inverse mortgage formula)
    const r = 0.085 / 12  // typical refi rate
    const n = 360
    const maxPayDSCR  = Math.max(0, monthlyNOI / TARGET_DSCR)
    const maxLoanDSCR = maxPayDSCR > 0
      ? Math.round(maxPayDSCR * ((1 - Math.pow(1 + r, -n)) / r))
      : 0

    console.log(`\n[${template.id}]`)
    console.table({
      'Property Type':         template.propertyType,
      'Purchase Price':        `$${opt.purchasePrice.toLocaleString()}`,
      'Months Owned':          24,
      'Annual Gross Income':   `$${Math.round(prop.monthlyRent * 12).toLocaleString()}`,
      'Annual NOI':            `$${Math.round(annualNOI).toLocaleString()}`,
      'Cap Rate':              config.capRate ? `${(config.capRate * 100).toFixed(2)}%` : '—',
      'Base Market Value':     `$${prop.baseMarketValue.toLocaleString()}`,
      'Income Value':          `$${incomeVal.toLocaleString()}`,
      'Comp Weight':           config.compWeight  != null ? `${(config.compWeight  * 100).toFixed(0)}%` : '—',
      'Income Weight':         config.incomeWeight != null ? `${(config.incomeWeight * 100).toFixed(0)}%` : '—',
      'Upgrade Value Boost':   '$0',
      'Final Current Value':   `$${currentValue.toLocaleString()}`,
      'Loan Balance':          `$${prop.loanBalance.toLocaleString()}`,
      'Equity':                `$${equity.toLocaleString()}`,
      'Max Refi (LTV 75%)':    `$${maxRefiLTV.toLocaleString()}`,
      'Max Refi (DSCR 1.25×)': `$${maxLoanDSCR.toLocaleString()}`,
      'DSCR Constrains Refi?': maxLoanDSCR < maxRefiLTV ? 'YES' : 'no',
    })
  })

  console.groupEnd()
}
