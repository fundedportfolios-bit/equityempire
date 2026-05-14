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

// ═══════════════════════════════════════════════════════════════
// REFINANCE SYSTEM
// ═══════════════════════════════════════════════════════════════
//
// Three tiers, each with independent LTV, DSCR, seasoning, and
// closing-cost rules.  Income underwriting uses PITIA method for
// residential (LTR, small MF) and NOI method for commercial-style
// assets (medium MF, apartments, resort).  STR/resort income is
// smoothed via a seasoning haircut to prevent one strong month
// from unlocking an outsized refi.
//
// The shared helper `calculateRefinanceOptions(property, state)`
// is the single source of truth for both the property card and
// the refinance menu.

// ─── Tier definitions ─────────────────────────────────────────
export const REFI_TIERS = [
  {
    id:                 'lowRisk',
    label:              'Low Risk',
    seasoningMonths:    6,
    maxLTV:             0.70,
    targetDSCR:         1.30,
    closingCostPercent: 0.035,
  },
  {
    id:                 'standard',
    label:              'Standard Cash-Out',
    seasoningMonths:    12,
    maxLTV:             0.75,
    targetDSCR:         1.20,
    closingCostPercent: 0.04,
  },
  {
    id:                 'maxCashOut',
    label:              'Max Cash-Out',
    seasoningMonths:    12,
    maxLTV:             0.80,
    targetDSCR:         1.15,
    closingCostPercent: 0.05,
  },
]

// ─── Underwriting method lookup ───────────────────────────────
// PITIA types: DSCR applied to rent vs total PITIA payment
//   → maxPI = (effectiveIncome / DSCR) − T&I − HOA
// NOI types:  DSCR applied to NOI vs debt service only
//   → maxDS = (effectiveIncome − operatingExpenses − costDrag) / DSCR
const PITIA_UNDERWRITING = new Set(['single_ltr', 'small_multifamily'])
const STR_SMOOTHING      = new Set(['single_str', 'micro_resort'])

// ─── Helpers ──────────────────────────────────────────────────

// Inverse of mortgage payment formula: max principal whose P&I ≤ maxPayment
function maxLoanFromPayment(maxMonthlyPayment, annualRate, termMonths) {
  const r = annualRate / 12
  if (r === 0) return Math.round(maxMonthlyPayment * termMonths)
  return Math.round(maxMonthlyPayment * ((1 - Math.pow(1 + r, -termMonths)) / r))
}

// STR/resort: apply seasoning haircut. Others: full monthlyRent.
function getEffectiveMonthlyIncome(property) {
  const rent = property.monthlyRent || 0
  if (!STR_SMOOTHING.has(property.templateId)) return rent
  const mo = property.monthsOwned || 0
  if (mo >= 12) return rent
  if (mo >= 7)  return rent * 0.9
  if (mo >= 4)  return rent * 0.8
  return rent * 0.7
}

// Returns the maximum loan principal that the property's income can support
// at the given DSCR and interest rate, using the appropriate underwriting
// method for the property type.
function calcMaxLoanByIncome(property, targetDSCR, rate) {
  const effectiveIncome = getEffectiveMonthlyIncome(property)
  const fixedNonDebt    = (property.monthlyExpenses || 0) - (property.monthlyDebtService || 0)
  const termMonths      = REFI_RULES.loanTermMonths

  if (PITIA_UNDERWRITING.has(property.templateId)) {
    // PITIA method: full PITIA (P&I + T&I + HOA) must be ≤ income / DSCR
    // fixedNonDebt = T&I + HOA (no STR extras for these types)
    const maxPITIA = effectiveIncome / targetDSCR
    const maxPI    = maxPITIA - fixedNonDebt
    if (maxPI <= 0) return 0
    return maxLoanFromPayment(maxPI, rate, termMonths)
  }

  // NOI method: debt service ≤ NOI / DSCR
  // NOI = income − operating expenses − cost drag
  // (operating expenses already exclude debt service)
  const monthlyNOI   = effectiveIncome - fixedNonDebt - (property.expectedCostDrag ?? 0)
  const maxMonthlyDS = monthlyNOI / targetDSCR
  if (maxMonthlyDS <= 0) return 0
  return maxLoanFromPayment(maxMonthlyDS, rate, termMonths)
}

// ─── Single-tier calculation ──────────────────────────────────
function calcRefiTier(property, tier, rate) {
  const monthsOwned = property.monthsOwned || 0
  const isSeasoned  = monthsOwned >= tier.seasoningMonths

  // ── LTV cap ──────────────────────────────────────────────
  const maxLoanByLTV = Math.round(property.currentValue * tier.maxLTV)

  // ── Income cap ───────────────────────────────────────────
  const maxLoanByIncome = calcMaxLoanByIncome(property, tier.targetDSCR, rate)

  // ── Effective cap ────────────────────────────────────────
  const maxNewLoan   = Math.max(0, Math.min(maxLoanByLTV, Math.round(maxLoanByIncome)))
  const grossCashOut = Math.max(0, maxNewLoan - property.loanBalance)
  const closingCosts = Math.round(maxNewLoan * tier.closingCostPercent)
  const netCashToOwner = Math.max(0, maxNewLoan - property.loanBalance - closingCosts)

  // ── New monthly payment ──────────────────────────────────
  const newPI = maxNewLoan > 0
    ? calculateMortgagePayment(maxNewLoan, rate, REFI_RULES.loanTermMonths)
    : 0
  const fixedExpenses      = (property.monthlyExpenses || 0) - (property.monthlyDebtService || 0)
  const newMonthlyExpenses = Math.round(newPI + fixedExpenses)
  const newMonthlyDebtService = Math.round(newPI)

  const oldCF = (property.monthlyRent || 0) - (property.monthlyExpenses || 0)
  const newCF = (property.monthlyRent || 0) - newMonthlyExpenses

  // ── Availability / reason ────────────────────────────────
  let isAvailable      = true
  let unavailableReason = null

  if (!isSeasoned) {
    isAvailable = false
    const rem = tier.seasoningMonths - monthsOwned
    unavailableReason = `Needs ${rem} more month${rem !== 1 ? 's' : ''} of seasoning`
  } else if (grossCashOut <= 0) {
    isAvailable = false
    unavailableReason = maxLoanByIncome < maxLoanByLTV
      ? 'Income does not support a larger loan'
      : 'Not enough equity at this LTV'
  } else if (netCashToOwner <= 0) {
    isAvailable = false
    unavailableReason = 'No cash available after closing costs'
  }

  return {
    tierId:              tier.id,
    tierLabel:           tier.label,
    isAvailable,
    isSeasoned,
    unavailableReason,
    // Loan
    maxLoanByLTV,
    maxLoanByIncome:     Math.round(maxLoanByIncome),
    maxNewLoan,
    newLoanBalance:      maxNewLoan,
    // Cash
    grossCashOut,
    closingCosts,
    closingCostPercent:  tier.closingCostPercent,
    netCashToOwner,
    // Debt service & expenses
    oldMonthlyDebtService: Math.round(property.monthlyDebtService || 0),
    newMonthlyDebtService,
    oldMonthlyExpenses:    property.monthlyExpenses || 0,
    newMonthlyExpenses,
    // Cash flow
    oldCashFlow:   oldCF,
    newCashFlow:   newCF,
    cashFlowDelta: newCF - oldCF,
    // Meta
    maxLTV:                tier.maxLTV,
    targetDSCR:            tier.targetDSCR,
    dscrConstraintActive:  maxLoanByIncome < maxLoanByLTV,
  }
}

// ─── Shared helper — single source of truth ───────────────────
// Returns one option per tier. Both PropertyCard and SellRefiModal
// call this so the numbers always match.
export function calculateRefinanceOptions(property, state) {
  const rate = (state?.marketInterestRate ?? 0.0678) + 0.012
  return REFI_TIERS.map(tier => calcRefiTier(property, tier, rate))
}

// Property card shortcut: best net cash from available tiers
export function getMaxRefiNetCash(property, state) {
  const options   = calculateRefinanceOptions(property, state)
  const available = options.filter(o => o.isAvailable)
  if (available.length === 0) return 0
  return Math.max(...available.map(o => o.netCashToOwner))
}

// ─── Legacy exports (kept for backward compat) ────────────────
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

// ─── Sell ─────────────────────────────────────────────────────
export function calcSaleProceeds(property) {
  const salePrice    = property.currentValue
  const sellingCosts = Math.round(salePrice * REFI_RULES.saleCostPercent)
  const loanPayoff   = property.loanBalance
  const netProceeds  = Math.max(0, salePrice - sellingCosts - loanPayoff)
  return { salePrice, sellingCosts, loanPayoff, netProceeds }
}
