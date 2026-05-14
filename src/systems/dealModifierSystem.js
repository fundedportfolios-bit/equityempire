// dealModifierSystem.js
//
// Picks a random archetype × condition combination for a generated property
// option, and produces multipliers used by the property income calibration:
//   - priceMultiplier            → adjusts purchase price
//   - cashFlowMultiplier         → adjusts target owner cash flow component only
//                                  (NOT the full gross income — that uses targetCF
//                                  per-unit baseline from the property template)
//   - expenseMultiplier          → multiplies expected cost drag (and visible
//                                  monthly expenses for non-income properties)
//   - maintenanceRiskMultiplier  → carried to the property for the event system
//   - immediateRepairCostRaw     → upfront repair cost
//   - upgradePotential           → informational; used for UI badges

import MODIFIERS from '../data/dealModifiers.json'

function randBetween(min, max) {
  return min + Math.random() * (max - min)
}

export function applyDealModifier(basePurchasePrice, opts = {}) {
  const { conditionProfiles, dealArchetypes } = MODIFIERS

  // Optionally restrict archetypes to those compatible with requested conditions
  let archetypes = dealArchetypes
  if (opts.allowedConditionIds) {
    const compatible = dealArchetypes.filter(a =>
      a.allowedConditionIds.some(cid => opts.allowedConditionIds.includes(cid))
    )
    if (compatible.length > 0) archetypes = compatible
  }
  if (opts.excludeArchetypeIds) {
    const filtered = archetypes.filter(a => !opts.excludeArchetypeIds.includes(a.id))
    if (filtered.length > 0) archetypes = filtered
  }

  const archetype = archetypes[Math.floor(Math.random() * archetypes.length)]

  let allowed = conditionProfiles.filter(c => archetype.allowedConditionIds.includes(c.id))
  if (opts.allowedConditionIds) {
    const filtered = allowed.filter(c => opts.allowedConditionIds.includes(c.id))
    if (filtered.length > 0) allowed = filtered
  }
  const condition = allowed[Math.floor(Math.random() * allowed.length)]

  const conditionScore = Math.round(
    condition.scoreMin + Math.random() * (condition.scoreMax - condition.scoreMin)
  )

  const archPriceMult   = randBetween(archetype.purchasePriceMultiplierMin, archetype.purchasePriceMultiplierMax)
  const condPriceMult   = randBetween(condition.purchasePriceMultiplierMin, condition.purchasePriceMultiplierMax)
  const priceMultiplier = Math.max(0.45, Math.min(1.55, archPriceMult * condPriceMult))

  // Cash-flow multiplier: archetype × condition (floor 0).
  // Applied ONLY to the target owner CF component, not to gross income.
  const archCFMult        = randBetween(archetype.cashFlowMultiplierMin, archetype.cashFlowMultiplierMax)
  const condCFMult        = randBetween(condition.cashFlowMultiplierMin, condition.cashFlowMultiplierMax)
  const cashFlowMultiplier = Math.max(0, archCFMult * condCFMult)

  const expenseMultiplier         = condition.monthlyExpenseMultiplier
  const maintenanceRiskMultiplier = condition.maintenanceRiskMultiplier

  const repairPercent          = randBetween(
    condition.immediateRepairCostPercentMin,
    condition.immediateRepairCostPercentMax
  )
  const immediateRepairCostRaw = Math.round(basePurchasePrice * (repairPercent / 100))

  return {
    dealArchetypeId:            archetype.id,
    dealArchetypeLabel:         archetype.label,
    dealDescription:            archetype.description,
    upgradePotential:           archetype.upgradePotential ?? 'medium',
    conditionId:                condition.id,
    conditionLabel:             condition.label,
    conditionScore,
    valueAddPotential:          condition.valueAddPotential,
    maintenanceRiskMultiplier,
    priceMultiplier,
    cashFlowMultiplier,
    expenseMultiplier,
    immediateRepairCostRaw,
    immediateRepairCostPercent: Math.round(repairPercent * 10) / 10,
  }
}
