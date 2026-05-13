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
import { applyDealModifier } from './dealModifierSystem.js'

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
function generateOption(template, difficulty, apr = DEFAULT_APR, modifierOpts = {}) {
  // Hot deals target the lower third of the price range
  const priceMax = modifierOpts.forceLowPrice
    ? Math.round(template.purchasePriceMin + (template.purchasePriceMax - template.purchasePriceMin) * 0.35)
    : template.purchasePriceMax
  const rawPrice = randomInt(template.purchasePriceMin, priceMax)
  const basePurchasePrice = Math.round(rawPrice / 5000) * 5000

  const deal = applyDealModifier(basePurchasePrice, modifierOpts)
  const purchasePrice = Math.round(basePurchasePrice * deal.priceMultiplier / 5000) * 5000

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
  const yieldBoost = modifierOpts.yieldBoost || 1
  if (yieldTable && difficulty && yieldTable[difficulty] != null) {
    const netCFPerMonth = Math.round(pitiauc * (yieldTable[difficulty] / 100) * yieldBoost)
    monthlyIncome = Math.round((pitiauc + netCFPerMonth) / 25) * 25
  } else if (template.incomeMultiplier > 0) {
    monthlyIncome = Math.round((pitiauc * template.incomeMultiplier) / 25) * 25
  }

  // Apply deal income multiplier (floor 0 — distressed deals may have zero income)
  monthlyIncome = monthlyIncome === 0 ? 0 : Math.round((monthlyIncome * deal.incomeMultiplier) / 25) * 25

  // Expenses: apply deal expense multiplier to both paths
  const monthlyExpenses = monthlyIncome === 0
    ? Math.round((purchasePrice * (template.monthlyExpensePercent / 100)) / 12 * deal.expenseMultiplier)
    : Math.round(pitiauc * deal.expenseMultiplier)

  const netCashFlow = monthlyIncome - monthlyExpenses

  const closingCosts      = Math.round(purchasePrice * (template.closingCostPercent / 100))
  const setupCost         = isSTR
    ? Math.round(purchasePrice * (template.strSetupCostPercent || 0) / 100)
    : 0
  const startupActionCost = getTotalStartupCost(template.propertyType)

  // Immediate repair cost from deal condition, capped at 30% of purchase price
  const immediateRepairCost = Math.min(
    deal.immediateRepairCostRaw,
    Math.round(purchasePrice * 0.30)
  )

  const cashNeeded = downPayment + closingCosts + setupCost + startupActionCost + immediateRepairCost

  const appreciationRate = template.valueGrowthPercent / 100 / 12

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
    immediateRepairCost,
    cashNeeded,
    loanBalance,
    appreciationRate,
    monthlyDebtService,
    interestRate:    apr,
    loanTermMonths:  PITIA_TERM,
    dealArchetypeId:           deal.dealArchetypeId,
    dealArchetypeLabel:        deal.dealArchetypeLabel,
    dealDescription:           deal.dealDescription,
    conditionId:               deal.conditionId,
    conditionLabel:            deal.conditionLabel,
    conditionScore:            deal.conditionScore,
    valueAddPotential:         deal.valueAddPotential,
    maintenanceRiskMultiplier: deal.maintenanceRiskMultiplier,
  }
}

// Retry wrapper — returns first option under maxCashNeeded (and positive CF when required).
// Fallback priority: cheapest positive-CF option > cheapest any option.
function generateAffordableOption(template, difficulty, apr, maxCashNeeded, modifierOpts = {}) {
  const needsPositiveCF = modifierOpts.requirePositiveCashFlow === true
  let cheapest = null
  let cheapestPositiveCF = null
  for (let i = 0; i < 10; i++) {
    const opt = generateOption(template, difficulty, apr, modifierOpts)
    const cfOk = !needsPositiveCF || opt.netCashFlow > 0
    if (opt.cashNeeded <= maxCashNeeded && cfOk) return opt
    if (opt.netCashFlow > 0 && (!cheapestPositiveCF || opt.cashNeeded < cheapestPositiveCF.cashNeeded)) {
      cheapestPositiveCF = opt
    }
    if (!cheapest || opt.cashNeeded < cheapest.cashNeeded) cheapest = opt
  }
  return cheapestPositiveCF ?? cheapest
}

// Hot deal: lower price range, good/excellent condition, 50% yield boost, positive CF required.
function generateHotDeal(template, difficulty, apr, maxCashNeeded) {
  const opts = {
    allowedConditionIds: ['good', 'excellent'],
    excludeArchetypeIds: ['overpriced'],
    forceLowPrice: true,
    yieldBoost: 1.5,
    requirePositiveCashFlow: true,
  }
  let cheapest = null
  for (let i = 0; i < 12; i++) {
    const opt = generateOption(template, difficulty, apr, opts)
    if (opt.cashNeeded <= maxCashNeeded && opt.netCashFlow > 0) return { ...opt, isHotDeal: true }
    if (!cheapest || opt.cashNeeded < cheapest.cashNeeded) cheapest = opt
  }
  return { ...cheapest, isHotDeal: true }
}

// Slot spec based on how much cash the player has.
// Each slot specifies which property type to offer and the cash budget cap.
function buildSlots(state) {
  const cash = state.cash

  // Game start: player has no properties — 3 affordable LTRs, good condition, positive CF
  if (state.properties.length === 0) {
    const opts = { allowedConditionIds: ['good', 'excellent'], requirePositiveCashFlow: true }
    return [
      { typeId: 'single_ltr', maxCashNeeded: 50000, modifierOpts: opts },
      { typeId: 'single_ltr', maxCashNeeded: 50000, modifierOpts: opts },
      { typeId: 'single_ltr', maxCashNeeded: 50000, modifierOpts: opts },
    ]
  }

  if (cash >= 200000) {
    return [
      { typeId: 'single_ltr',        maxCashNeeded: Math.floor(cash * 0.55) },
      { typeId: 'single_str',        maxCashNeeded: Math.floor(cash * 0.75) },
      { typeId: 'small_multifamily', maxCashNeeded: Math.floor(cash * 0.95) },
    ]
  }
  if (cash >= 100000) {
    return [
      { typeId: 'single_ltr',        maxCashNeeded: Math.floor(cash * 0.60) },
      { typeId: 'single_str',        maxCashNeeded: Math.floor(cash * 0.80) },
      { typeId: 'small_multifamily', maxCashNeeded: Math.floor(cash * 0.95) },
    ]
  }
  if (cash >= 60000) {
    return [
      { typeId: 'single_ltr', maxCashNeeded: Math.floor(cash * 0.65) },
      { typeId: 'single_ltr', maxCashNeeded: Math.floor(cash * 0.85) },
      { typeId: 'single_str', maxCashNeeded: Math.floor(cash * 0.95) },
    ]
  }
  if (cash >= 50000) {
    return [
      { typeId: 'single_ltr', maxCashNeeded: Math.floor(cash * 0.60) },
      { typeId: 'single_ltr', maxCashNeeded: Math.floor(cash * 0.80) },
      { typeId: 'single_ltr', maxCashNeeded: Math.floor(cash * 0.95) },
    ]
  }
  if (cash >= 40000) {
    return [
      { typeId: 'single_ltr', maxCashNeeded: Math.floor(cash * 0.70) },
      { typeId: 'single_ltr', maxCashNeeded: Math.floor(cash * 0.95) },
      { typeId: 'single_ltr', maxCashNeeded: cash },
    ]
  }
  return [
    { typeId: 'single_ltr', maxCashNeeded: cash },
    { typeId: 'single_ltr', maxCashNeeded: cash },
    { typeId: 'single_ltr', maxCashNeeded: cash },
  ]
}

export function generatePropertyOptions(state) {
  const apr       = (state.marketInterestRate ?? 0.0678) + 0.012
  const openCount = state.investOpenCount || 0
  const isHotDeal = openCount > 0 && openCount % 6 === 0

  const slots   = buildSlots(state)
  const options = []

  // Hot deal prepended when triggered (every 6th open)
  if (isHotDeal) {
    const ltr = PROPERTY_TYPES.find(pt => pt.id === 'single_ltr')
    if (ltr) options.push(generateHotDeal(ltr, state.difficulty, apr, state.cash * 0.85))
  }

  for (const slot of slots) {
    const template = PROPERTY_TYPES.find(pt => pt.id === slot.typeId && isUnlocked(pt, state))
      ?? PROPERTY_TYPES.find(pt => pt.id === 'single_ltr')
    options.push(generateAffordableOption(
      template, state.difficulty, apr, slot.maxCashNeeded, slot.modifierOpts ?? {}
    ))
  }

  return options.filter(Boolean)
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
    immediateRepairCost:       option.immediateRepairCost       ?? 0,
    dealArchetypeId:           option.dealArchetypeId,
    dealArchetypeLabel:        option.dealArchetypeLabel,
    dealDescription:           option.dealDescription,
    conditionId:               option.conditionId,
    conditionLabel:            option.conditionLabel,
    conditionScore:            option.conditionScore,
    valueAddPotential:         option.valueAddPotential,
    maintenanceRiskMultiplier: option.maintenanceRiskMultiplier ?? 1,
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
