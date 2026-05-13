// propertySystem.js
//
// Owns all property lifecycle logic:
//   - Unlock checks (which types the player can see)
//   - Generating randomized property options for the invest modal
//   - Creating a property instance that gets stored in game state
//   - Recalculating portfolio totals from owned properties
//   - Future: appreciation, condition decay, selling

import { PROPERTY_TYPES } from '../data/propertyTypes.js'
import { randomInt, shuffle } from '../utils/random.js'
import { calculateMortgagePayment } from '../utils/financeMath.js'
import { getTotalStartupCost } from '../data/maintenanceEvents.js'

// ─── Unlock logic ──────────────────────────────────────────────
function isUnlocked(pt, state) {
  const owned = state.properties.length
  const cash = state.cash
  const portfolioValue = state.portfolioValue

  switch (pt.id) {
    case 'single_ltr':
      return true
    case 'single_str':
      return owned >= 1 || cash >= 25000
    case 'small_multifamily':
    case 'fix_flip':
    case 'micro_resort':
    case 'apartment_building':
    case 'apartment_complex':
      return portfolioValue >= 1000000
    default:
      return false
  }
}

// ─── PITIA/PITIAUC helpers ─────────────────────────────────────
const DEFAULT_APR      = 0.08   // fallback when no live rate is available
const PITIA_TERM       = 360    // 30-year fixed
const PITIA_TI_ANNUAL  = 0.015  // 1.5% of purchase price for taxes + insurance

function calcPITIA(purchasePrice, loanBalance, hoa, apr = DEFAULT_APR) {
  const pi = calculateMortgagePayment(loanBalance, apr, PITIA_TERM)
  const ti = (purchasePrice * PITIA_TI_ANNUAL) / 12
  return pi + ti + hoa
}

// ─── Option generation ─────────────────────────────────────────
function generateOption(template, difficulty, apr = DEFAULT_APR) {
  // Round purchase price to nearest $5,000 for clean numbers
  const rawPrice = randomInt(template.purchasePriceMin, template.purchasePriceMax)
  const purchasePrice = Math.round(rawPrice / 5000) * 5000

  const downPayment = Math.round(purchasePrice * (template.downPaymentPercent / 100))
  const loanBalance = purchasePrice - downPayment

  const isSTR   = template.incomeType === 'str'
  const addlExp = isSTR
    ? (template.strMonthlyUtilities || 0) + (template.strMonthlyCleaning || 0)
    : 0

  const pitia   = calcPITIA(purchasePrice, loanBalance, template.hoaMonthly, apr)
  const pitiauc = pitia + addlExp   // for non-STR: addlExp = 0, pitiauc === pitia

  let monthlyIncome = 0
  const yieldTable = template.netYieldByDifficulty
  if (yieldTable && difficulty && yieldTable[difficulty] != null) {
    // Income = PITIAUC + target net cash flow (difficulty-based % of PITIAUC)
    const netCFPerMonth = Math.round(pitiauc * (yieldTable[difficulty] / 100))
    monthlyIncome = Math.round((pitiauc + netCFPerMonth) / 25) * 25
  } else if (template.incomeMultiplier > 0) {
    monthlyIncome = Math.round((pitiauc * template.incomeMultiplier) / 25) * 25
  }

  // Expenses: PITIAUC is the carrying cost; fix_flip uses purchase-price holding cost instead
  const monthlyExpenses = monthlyIncome === 0
    ? Math.round((purchasePrice * (template.monthlyExpensePercent / 100)) / 12)
    : Math.round(pitiauc)

  const netCashFlow = monthlyIncome - monthlyExpenses

  const closingCosts       = Math.round(purchasePrice * (template.closingCostPercent / 100))
  const setupCost          = isSTR
    ? Math.round(purchasePrice * (template.strSetupCostPercent || 0) / 100)
    : 0
  const startupActionCost  = getTotalStartupCost(template.propertyType)
  const cashNeeded         = downPayment + closingCosts + setupCost + startupActionCost

  // Monthly appreciation rate from annual percentage
  const appreciationRate = template.valueGrowthPercent / 100 / 12

  // P&I only (excludes TI + HOA); fix_flip has no rental income so no debt service to track
  const monthlyDebtService = monthlyIncome === 0
    ? 0
    : Math.round(calculateMortgagePayment(loanBalance, apr, PITIA_TERM))

  return {
    id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    templateId: template.id,
    propertyType: template.propertyType,
    tier: template.tier,
    riskLevel: template.riskLevel,
    typicalStrategy: template.typicalStrategy,
    description: template.description,
    icon: template.icon,
    units: template.units ?? 1,
    purchasePrice,
    monthlyIncome,
    monthlyExpenses,
    netCashFlow,
    downPayment,
    closingCosts,
    setupCost,
    startupActionCost,
    cashNeeded,
    loanBalance,
    appreciationRate,
    monthlyDebtService,
    interestRate:    apr,
    loanTermMonths:  PITIA_TERM,
  }
}

// Returns `count` randomized options from unlocked property types.
// Cycles through available types if fewer than `count` are unlocked,
// so the player always sees 3 options (with possible duplicates of type).
export function generatePropertyOptions(state, count = 3) {
  const available = PROPERTY_TYPES.filter(pt => isUnlocked(pt, state))
  if (available.length === 0) return []

  const apr      = (state.marketInterestRate ?? 0.0678) + 0.012
  const shuffled = shuffle(available)
  const options  = []
  for (let i = 0; i < count; i++) {
    options.push(generateOption(shuffled[i % shuffled.length], state.difficulty, apr))
  }
  return options
}

// ─── Instance creation ─────────────────────────────────────────
// Converts a generated option into the property object stored in state.
// Uses `monthlyRent` to match existing PropertyCard + portfolio math expectations.
export function createPropertyInstance(option, currentMonth = null) {
  const isSTR = option.templateId === 'single_str' || option.templateId === 'micro_resort'
  return {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    templateId: option.templateId,
    name: option.propertyType,
    tier: option.tier,
    riskLevel: option.riskLevel,
    typicalStrategy: option.typicalStrategy,
    icon: option.icon,
    units: option.units ?? 1,
    purchasePrice: option.purchasePrice,
    currentValue: option.purchasePrice,
    monthlyRent: option.monthlyIncome,
    monthlyExpenses: option.monthlyExpenses,
    loanBalance: option.loanBalance,
    appreciationRate: option.appreciationRate,
    monthlyDebtService: option.monthlyDebtService ?? 0,
    interestRate:       option.interestRate       ?? DEFAULT_APR,
    loanTermMonths:     option.loanTermMonths     ?? 360,
    condition: 100,
    monthsOwned: 0,
    activeEvents: [],
    completedUpgrades: [],
    activeExpenseIncreases: [],
    revenueStartMonth: (isSTR && currentMonth != null) ? currentMonth + 2 : null,
  }
}

// ─── Portfolio totals ──────────────────────────────────────────
// Called by the reducer after any change to the properties array.
// Pass currentMonth to exclude income for STR properties still in their ramp-up period.
export function recalculatePortfolioTotals(properties, currentMonth = null) {
  return properties.reduce(
    (totals, p) => {
      const inRampUp = currentMonth !== null
        && p.revenueStartMonth !== null
        && p.revenueStartMonth !== undefined
        && currentMonth < p.revenueStartMonth
      return {
        portfolioValue:  totals.portfolioValue  + p.currentValue,
        totalDebt:       totals.totalDebt       + p.loanBalance,
        monthlyIncome:   totals.monthlyIncome   + (inRampUp ? 0 : p.monthlyRent),
        monthlyExpenses: totals.monthlyExpenses + p.monthlyExpenses,
      }
    },
    { portfolioValue: 0, totalDebt: 0, monthlyIncome: 0, monthlyExpenses: 0 }
  )
}

// ─── Affordability check ───────────────────────────────────────
export function canAffordOption(state, option) {
  return state.cash >= option.cashNeeded
}

// Count how many unlocked property types are affordable at minimum purchase price.
// Used for the Invest button badge — avoids running the random generator.
export function countAffordableTypes(state) {
  return PROPERTY_TYPES.filter(pt => {
    if (!isUnlocked(pt, state)) return false
    const price   = pt.purchasePriceMin
    const dp      = Math.round(price * (pt.downPaymentPercent  / 100))
    const cc      = Math.round(price * (pt.closingCostPercent  / 100))
    const setup   = pt.incomeType === 'str'
      ? Math.round(price * (pt.strSetupCostPercent || 0) / 100)
      : 0
    const startup = getTotalStartupCost(pt.propertyType)
    return state.cash >= dp + cc + setup + startup
  }).length
}
