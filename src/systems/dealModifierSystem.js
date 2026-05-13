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

  const archPriceMult = randBetween(archetype.purchasePriceMultiplierMin, archetype.purchasePriceMultiplierMax)
  const condPriceMult = randBetween(condition.purchasePriceMultiplierMin, condition.purchasePriceMultiplierMax)
  const priceMultiplier = Math.max(0.45, Math.min(1.55, archPriceMult * condPriceMult))

  const archIncomeMult = randBetween(archetype.incomeMultiplierMin, archetype.incomeMultiplierMax)
  const incomeMultiplier = Math.max(0, archIncomeMult * condition.incomeMultiplier)

  const expenseMultiplier = condition.monthlyExpenseMultiplier
  const maintenanceRiskMultiplier = condition.maintenanceRiskMultiplier

  const repairPercent = randBetween(
    condition.immediateRepairCostPercentMin,
    condition.immediateRepairCostPercentMax
  )
  const immediateRepairCostRaw = Math.round(basePurchasePrice * (repairPercent / 100))

  return {
    dealArchetypeId:            archetype.id,
    dealArchetypeLabel:         archetype.label,
    dealDescription:            archetype.description,
    conditionId:                condition.id,
    conditionLabel:             condition.label,
    conditionScore,
    valueAddPotential:          condition.valueAddPotential,
    maintenanceRiskMultiplier,
    priceMultiplier,
    incomeMultiplier,
    expenseMultiplier,
    immediateRepairCostRaw,
    immediateRepairCostPercent: Math.round(repairPercent * 10) / 10,
  }
}
