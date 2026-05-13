import { STAFF_RULES } from '../data/staffRules.js'

const PRIORITY_ORDER = { Critical: 4, High: 3, Medium: 2, Low: 1 }

export function calcCurrentStaffCost(currentMonth) {
  const raiseCount = Math.floor((currentMonth - 1) / STAFF_RULES.monthsBetweenRaises)
  return Math.round(STAFF_RULES.baseMonthlyStaffCost * Math.pow(1 + STAFF_RULES.annualRaisePercent, raiseCount))
}

export function calcStaffExpense(staffCount, currentMonth) {
  if (!staffCount) return 0
  return calcCurrentStaffCost(currentMonth) * staffCount
}

export function calcStaffCapacity(staffCount) {
  return staffCount * STAFF_RULES.capacityPerStaff
}

export function getStaffStatus(staffCount, portfolioValue) {
  if (!staffCount) return 'No Staff'
  return portfolioValue <= calcStaffCapacity(staffCount) ? 'Adequate' : 'Overloaded'
}

export function canHireStaff(monthlyIncome, monthlyExpenses, currentStaffExpense, currentMonth) {
  const costPerNew = calcCurrentStaffCost(currentMonth)
  return monthlyIncome - monthlyExpenses - currentStaffExpense - costPerNew >= 0
}

// Called during ADVANCE_MONTH after processMonthlyEvents + appreciation.
// Resolves eligible events in-place (no cash deduction — covered by salary).
export function processStaffResolution(properties, staffCount, portfolioValue) {
  if (!staffCount) return { resolvedProperties: properties, resolvedCount: 0, staffAlerts: [] }

  const capacity     = calcStaffCapacity(staffCount)
  const isOverloaded = portfolioValue > capacity
  const capacityRatio = isOverloaded ? capacity / portfolioValue : 1

  let totalResolved = 0

  const resolvedProperties = properties.map(prop => {
    const eligible = (prop.activeEvents || []).filter(isStaffResolvable)
    if (!eligible.length) return prop

    let toResolve
    if (!isOverloaded) {
      toResolve = eligible
    } else {
      const sorted     = [...eligible].sort((a, b) => (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0))
      const minResolve = eligible.some(e => e.priority === 'Critical') ? 1 : 0
      const count      = Math.max(minResolve, Math.floor(eligible.length * capacityRatio))
      toResolve        = sorted.slice(0, count)
    }

    if (!toResolve.length) return prop
    totalResolved += toResolve.length
    const resolvedIds = new Set(toResolve.map(e => e.instanceId))

    let newCondition = prop.condition ?? 100
    let newValue     = prop.currentValue ?? prop.purchasePrice

    toResolve.forEach(ev => {
      newCondition = Math.min(100, newCondition + (ev.conditionImpact || 0))
      newValue     = Math.min((prop.purchasePrice ?? prop.currentValue) * 2, newValue + (ev.valueImpact || 0))
    })

    return {
      ...prop,
      activeEvents: (prop.activeEvents || []).filter(e => !resolvedIds.has(e.instanceId)),
      condition:    newCondition,
      currentValue: Math.round(newValue),
    }
  })

  const staffAlerts = []
  if (totalResolved > 0) {
    staffAlerts.push({
      id:      `staff-res-${Date.now()}`,
      message: `Staff resolved ${totalResolved} maintenance issue${totalResolved !== 1 ? 's' : ''} this month.`,
      type:    'success',
    })
  }
  if (isOverloaded) {
    staffAlerts.push({
      id:      `staff-overload-${Date.now()}`,
      message: 'Staff is overloaded — some lower-priority issues remain unresolved.',
      type:    'warning',
    })
  }

  return { resolvedProperties, resolvedCount: totalResolved, staffAlerts }
}

function isStaffResolvable(event) {
  if (event.category === 'startupAction') return false
  return event.cashImpactType === 'immediateBill' || event.cashImpactType === 'scheduledMaintenance'
}
