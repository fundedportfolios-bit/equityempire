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
    case 'medium_multifamily':
      return portfolioValue >= 750000
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

// ─── Blended valuation config ──────────────────────────────────
// compWeight:       share of value driven by comparable-sales appreciation
// incomeWeight:     share of value driven by NOI cap-rate income approach
// capRate:          expected NOI yield used to estimate income-based value
// maxMonthlyShift:  max fraction blendedPreUpgradeValue can move in one month
export const VALUATION_CONFIG = {
  single_ltr:         { compWeight: 0.85, incomeWeight: 0.15, capRate: 0.0775, maxMonthlyShift: 0.010 },
  single_str:         { compWeight: 0.70, incomeWeight: 0.30, capRate: 0.0950, maxMonthlyShift: 0.020 },
  small_multifamily:  { compWeight: 0.60, incomeWeight: 0.40, capRate: 0.0750, maxMonthlyShift: 0.015 },
  medium_multifamily: { compWeight: 0.35, incomeWeight: 0.65, capRate: 0.0725, maxMonthlyShift: 0.020 },
  micro_resort:       { compWeight: 0.40, incomeWeight: 0.60, capRate: 0.1000, maxMonthlyShift: 0.025 },
  apartment_building: { compWeight: 0.20, incomeWeight: 0.80, capRate: 0.0675, maxMonthlyShift: 0.020 },
  apartment_complex:  { compWeight: 0.10, incomeWeight: 0.90, capRate: 0.0650, maxMonthlyShift: 0.020 },
  // fix_flip: not listed → pure baseMarketValue appreciation, no income blend
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
// Income model (v5):
//   gross monthlyIncome = PITIAUC + expectedCostDrag + adjustedTargetCashFlow
//
// where:
//   adjustedTargetCashFlow = (ownerCashFlowTargetPerUnit[difficulty] × units / 12)
//                            × deal.cashFlowMultiplier × yieldBoost
//   expectedCostDrag       = (costDragPerUnitMonthly[difficulty] × units)
//                            × deal.expenseMultiplier
//
// The player sees gross income and PITIAUC as monthly expenses. Their visible
// Net CF looks high; in practice the event system drains ~expectedCostDrag/mo,
// landing actual long-run owner CF near adjustedTargetCashFlow.
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

  const yieldBoost      = modifierOpts.yieldBoost || 1
  const isIncomeType    = template.incomeType !== 'none'
  const units           = template.units || 1

  let monthlyIncome           = 0
  let projectedOwnerCashFlow  = 0
  let expectedCostDrag        = 0
  let adjustedTargetCF        = 0

  if (isIncomeType) {
    // Per-unit owner CF target (annual $) → monthly target before deal mods
    const targets             = template.ownerCashFlowTargetPerUnit || {}
    const targetPerUnit       = targets[difficulty] ?? targets.medium ?? 2400
    const baseMonthlyTargetCF = (targetPerUnit * units) / 12

    // Expected monthly cost drag — represents long-run event + maintenance burn.
    // The event system still fires; this number is the buffer baked into income.
    const dragPerUnit       = (template.costDragPerUnitMonthly || {})[difficulty] ?? 50
    const baseCostDrag      = dragPerUnit * units
    expectedCostDrag        = Math.round(baseCostDrag * deal.expenseMultiplier)

    // Condition and archetype modifiers apply ONLY to the target CF component.
    adjustedTargetCF = Math.round(baseMonthlyTargetCF * deal.cashFlowMultiplier * yieldBoost)

    // Floor: gross income must at least cover PITIAUC (1.0× — never less than break-even
    // on the fixed costs). Below that we'd be selling a property no one would rent.
    const grossUncapped = pitiauc + expectedCostDrag + adjustedTargetCF
    const grossFloor    = Math.round(pitiauc * 1.0)
    const grossRaw      = Math.max(grossUncapped, grossFloor)
    monthlyIncome       = Math.round(grossRaw / 25) * 25

    // Projected owner CF = what we display in the invest card after drag is paid.
    // Recompute from rounded income so display stays consistent with stored value.
    projectedOwnerCashFlow = monthlyIncome - Math.round(pitiauc) - expectedCostDrag
  }

  // Visible monthly expenses
  //   - Income-producing: just PITIAUC (the actual fixed bill)
  //   - Non-income (fix-flip): holding costs as % of price, with expenseMultiplier
  const monthlyExpenses = !isIncomeType
    ? Math.round((purchasePrice * (template.monthlyExpensePercent / 100)) / 12 * deal.expenseMultiplier)
    : Math.round(pitiauc)

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
    pitiauc:                  Math.round(pitiauc),
    expectedCostDrag,
    projectedOwnerCashFlow,
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
    upgradePotential:          deal.upgradePotential,
    conditionId:               deal.conditionId,
    conditionLabel:            deal.conditionLabel,
    conditionScore:            deal.conditionScore,
    valueAddPotential:         deal.valueAddPotential,
    maintenanceRiskMultiplier: deal.maintenanceRiskMultiplier,
  }
}

// Projected owner CF positivity check — non-income properties don't have a
// target CF (judged on appreciation instead).
function isProjectedPositive(opt) {
  if (opt.monthlyIncome === 0) return true
  return (opt.projectedOwnerCashFlow ?? 0) > 0
}

// Slot plan: portfolio-value tiers determine which property TYPES each slot
// should try, in order of preference. Every slot must produce an option whose
// cashNeeded ≤ state.cash (the picker retries with different price rolls,
// falling back through the type list).
function buildSlots(state) {
  const pv = state.portfolioValue || 0

  // Game start: player has no properties — 3 affordable LTRs, good condition, positive CF
  if (state.properties.length === 0) {
    const opts = { allowedConditionIds: ['good', 'excellent'], requirePositiveCashFlow: true }
    return [
      { types: ['single_ltr'], modifierOpts: opts },
      { types: ['single_ltr'], modifierOpts: opts },
      { types: ['single_ltr'], modifierOpts: opts },
    ]
  }

  // Portfolio < $1M: 1 LTR + 1 STR + (LTR or STR)
  if (pv < 1_000_000) {
    return [
      { types: ['single_ltr'] },
      { types: ['single_str', 'single_ltr'] },
      { types: ['single_str', 'single_ltr'] },
    ]
  }

  // $1M ≤ pv < $2M: at least 1 small multifamily, others LTR/STR/medium MF
  if (pv < 2_000_000) {
    return [
      { types: ['small_multifamily'] },
      { types: ['single_ltr', 'single_str', 'medium_multifamily'] },
      { types: ['single_str', 'medium_multifamily', 'single_ltr'] },
    ]
  }

  // pv ≥ $2M: 1 LTR or STR + 2 from apartments/resorts
  return [
    { types: ['single_ltr', 'single_str'] },
    { types: ['micro_resort', 'apartment_building', 'apartment_complex'] },
    { types: ['apartment_building', 'apartment_complex', 'micro_resort'] },
  ]
}

// For a single slot: walk through the requested types, generate options of
// each, return the first affordable one. If none are affordable across all
// attempts, fall back to a single LTR (always unlocked). Last resort: cheapest
// option we found during the retries.
function pickOptionForSlot(slot, state, apr) {
  const cash    = state.cash || 0
  const modOpts = slot.modifierOpts || {}
  let cheapest  = null

  for (const typeId of slot.types) {
    const template = PROPERTY_TYPES.find(pt => pt.id === typeId && isUnlocked(pt, state))
    if (!template) continue
    for (let i = 0; i < 8; i++) {
      const opt = generateOption(template, state.difficulty, apr, modOpts)
      if (opt.cashNeeded <= cash) return opt
      if (!cheapest || opt.cashNeeded < cheapest.cashNeeded) cheapest = opt
    }
  }

  // Fallback: cheapest affordable LTR
  const ltr = PROPERTY_TYPES.find(pt => pt.id === 'single_ltr')
  if (ltr) {
    for (let i = 0; i < 6; i++) {
      const opt = generateOption(ltr, state.difficulty, apr, modOpts)
      if (opt.cashNeeded <= cash) return opt
      if (!cheapest || opt.cashNeeded < cheapest.cashNeeded) cheapest = opt
    }
  }

  return cheapest
}

export function generatePropertyOptions(state) {
  const apr       = (state.marketInterestRate ?? 0.0678) + 0.012
  const openCount = state.investOpenCount || 0
  const isHotDeal = openCount > 0 && openCount % 6 === 0

  const slots   = buildSlots(state)
  const options = []

  // Hot deal prepended when triggered — only included if we can find one
  // that is BOTH affordable AND meets the hot deal positive-CF requirement.
  if (isHotDeal) {
    const ltr = PROPERTY_TYPES.find(pt => pt.id === 'single_ltr')
    if (ltr) {
      const hot = findAffordableHotDeal(ltr, state.difficulty, apr, state.cash)
      if (hot) options.push(hot)
    }
  }

  for (const slot of slots) {
    const opt = pickOptionForSlot(slot, state, apr)
    if (opt) options.push(opt)
  }

  return options.filter(Boolean)
}

// Try up to 18 generations to find a hot deal that is affordable AND has a
// positive projected owner CF. Returns null if none can be found — caller
// should then NOT prepend a hot deal at all.
function findAffordableHotDeal(template, difficulty, apr, cash) {
  const opts = {
    allowedConditionIds: ['good', 'excellent'],
    excludeArchetypeIds: ['overpriced'],
    forceLowPrice: true,
    yieldBoost: 1.5,
    requirePositiveCashFlow: true,
  }
  for (let i = 0; i < 18; i++) {
    const opt = generateOption(template, difficulty, apr, opts)
    if (opt.cashNeeded <= cash && isProjectedPositive(opt)) {
      return { ...opt, isHotDeal: true }
    }
  }
  return null
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
    purchasePrice:           option.purchasePrice,
    currentValue:            option.purchasePrice,
    baseMarketValue:         option.purchasePrice,
    totalUpgradeValueBoost:  0,
    blendedPreUpgradeValue:  option.purchasePrice,
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
    pitiauc:                   option.pitiauc                   ?? 0,
    expectedCostDrag:          option.expectedCostDrag          ?? 0,
    projectedOwnerCashFlow:    option.projectedOwnerCashFlow    ?? 0,
    dealArchetypeId:           option.dealArchetypeId,
    dealArchetypeLabel:        option.dealArchetypeLabel,
    dealDescription:           option.dealDescription,
    upgradePotential:          option.upgradePotential,
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

// ─── Blended value computation ─────────────────────────────────
// Call this whenever a property's income, baseMarketValue, or upgrade
// boosts change.  Returns { blendedPreUpgradeValue, currentValue }.
//
// NOI excludes debt service (P&I). Stored breakdown:
//   monthlyExpenses = pitiauc = P&I + T&I + HOA + STR_extras
//   monthlyDebtService = P&I only
//   → operatingExpenses (non-debt) = monthlyExpenses − monthlyDebtService
//   → monthlyNOI = monthlyRent − operatingExpenses − expectedCostDrag
//
// STR/micro_resort: apply seasoning haircut on effectiveRent before NOI.
// fix_flip (not in VALUATION_CONFIG): pure baseMarketValue + upgradeBoost.
export function computeBlendedValue(property) {
  const config = VALUATION_CONFIG[property.templateId]

  // fix_flip or any unknown type: skip income blend
  if (!config) {
    const base  = property.baseMarketValue ?? property.currentValue
    const boost = property.totalUpgradeValueBoost ?? 0
    return {
      blendedPreUpgradeValue: Math.round(base),
      currentValue:           Math.round(base + boost),
    }
  }

  // STR seasoning haircut (prevents one strong month inflating value)
  const mo     = property.monthsOwned ?? 0
  const isSTR  = property.templateId === 'single_str' || property.templateId === 'micro_resort'
  const haircut = isSTR
    ? (mo >= 12 ? 1.0 : mo >= 7 ? 0.9 : mo >= 4 ? 0.8 : 0.7)
    : 1.0
  const effectiveRent = (property.monthlyRent ?? 0) * haircut

  // Monthly NOI (debt service excluded)
  const monthlyNOI = effectiveRent
    - ((property.monthlyExpenses ?? 0) - (property.monthlyDebtService ?? 0))
    - (property.expectedCostDrag ?? 0)
  const annualNOI  = Math.max(0, monthlyNOI) * 12

  const incomeValue = annualNOI / config.capRate
  const baseMarket  = property.baseMarketValue ?? property.currentValue

  // Raw blend before smoothing
  const rawBlended = baseMarket * config.compWeight + incomeValue * config.incomeWeight

  // Monthly shift cap: prevents income noise from spiking value
  const prevBlended = property.blendedPreUpgradeValue ?? baseMarket
  const maxShift    = prevBlended * config.maxMonthlyShift
  const clamped     = Math.max(prevBlended - maxShift, Math.min(prevBlended + maxShift, rawBlended))

  const upgradeBoost = property.totalUpgradeValueBoost ?? 0
  return {
    blendedPreUpgradeValue: Math.round(clamped),
    currentValue:           Math.round(clamped + upgradeBoost),
  }
}

// ─── Affordability check ───────────────────────────────────────
export function canAffordOption(state, option) {
  return state.cash >= option.cashNeeded
}

// Debug-only export — used by src/debug/incomeCalibration.js
export const _debug_generateOption = generateOption

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
