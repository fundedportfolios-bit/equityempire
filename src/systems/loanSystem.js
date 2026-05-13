import { calculateMortgagePayment } from '../utils/financeMath.js'
import { LOAN_RULES, REFI_RULES } from '../data/loanRules.js'

// ─── Purchase loan validation (existing) ──────────────────────
export function validateLoan(state, purchasePrice, downPaymentPct, loanProductId = 'conventional') {
  const rules = LOAN_RULES[loanProductId]
  if (!rules) return { valid: false, reason: 'Unknown loan product.' }

  const downPayment = purchasePrice * downPaymentPct
  const loanAmount  = purchasePrice - downPayment
  const ltv         = loanAmount / purchasePrice

  if (downPaymentPct < rules.minDownPaymentPct)
    return { valid: false, reason: `Minimum down payment is ${rules.minDownPaymentPct * 100}%.` }
  if (ltv > rules.maxLTV)
    return { valid: false, reason: `Loan exceeds max LTV of ${rules.maxLTV * 100}%.` }
  if (state.cash < downPayment)
    return { valid: false, reason: 'Insufficient cash for down payment.' }

  return {
    valid: true, loanAmount, downPayment,
    monthlyPayment: calculateMortgagePayment(loanAmount, rules.baseInterestRate, rules.termMonths),
  }
}

// ─── Sell / Refinance helpers ──────────────────────────────────

// Max gross cash available before closing costs (75% LTV cap)
export function getMaxRefiCash(property) {
  const maxLoan = Math.round(property.currentValue * REFI_RULES.maxLTV)
  return Math.max(0, maxLoan - property.loanBalance)
}

export function canRefinance(property) {
  return (property.monthsOwned || 0) >= REFI_RULES.seasoningMonths
}

export function canFullRefinance(property) {
  return (property.monthsOwned || 0) >= REFI_RULES.maxRefiSeasoningMonths
}

// fraction: 0.5 = Low Risk, 1.0 = Max
// rate: override the refi interest rate (defaults to REFI_RULES.annualInterestRate)
export function calcRefiOption(property, fraction, rate = REFI_RULES.annualInterestRate) {
  const maxLoan        = Math.round(property.currentValue * REFI_RULES.maxLTV)
  const maxGross       = Math.max(0, maxLoan - property.loanBalance)
  const grossCashOut   = Math.round(maxGross * fraction)
  const newLoanBalance = property.loanBalance + grossCashOut
  const closingCosts   = Math.round(newLoanBalance * REFI_RULES.closingCostPercent)
  const netCash        = Math.max(0, grossCashOut - closingCosts)

  // Only P&I changes on refi; TI + HOA (fixedExpenses) stay the same
  const newPI          = calculateMortgagePayment(newLoanBalance, rate, REFI_RULES.loanTermMonths)
  const fixedExpenses  = (property.monthlyExpenses || 0) - (property.monthlyDebtService || 0)
  const newMonthlyExpenses = Math.round(newPI + fixedExpenses)

  const oldCF = (property.monthlyRent || 0) - (property.monthlyExpenses || 0)
  const newCF = (property.monthlyRent || 0) - newMonthlyExpenses

  return {
    grossCashOut,
    closingCosts,
    netCash,
    newLoanBalance,
    oldMonthlyDebtService: Math.round(property.monthlyDebtService || 0),
    newMonthlyDebtService: Math.round(newPI),
    oldMonthlyExpenses:    property.monthlyExpenses || 0,
    newMonthlyExpenses,
    oldCashFlow:   oldCF,
    newCashFlow:   newCF,
    cashFlowDelta: newCF - oldCF,
  }
}

export function calcSaleProceeds(property) {
  const salePrice    = property.currentValue
  const sellingCosts = Math.round(salePrice * REFI_RULES.saleCostPercent)
  const loanPayoff   = property.loanBalance
  const netProceeds  = Math.max(0, salePrice - sellingCosts - loanPayoff)
  return { salePrice, sellingCosts, loanPayoff, netProceeds }
}
