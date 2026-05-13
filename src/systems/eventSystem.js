// eventSystem.js v2.0
//
// Event routing by cashImpactType:
//   immediateBill          → activeEvents (player pays to resolve)
//   scheduledMaintenance   → activeEvents (from PM schedule, player pays to resolve)
//   monthlyExpenseIncrease → auto-applied to property.monthlyExpenses, tracked in
//                            property.activeExpenseIncreases, expires after durationMonths
//   warningOnly            → alert only, no player action required
//   reputationPenalty      → alert only
//   occupancyPenalty       → alert only
//   refinanceBlocker       → requiresTrigger: true, skipped in random rolling
//   triggeredComplianceEvent → requiresTrigger: true, skipped in random rolling

import { startupActions, preventiveMaintenance, randomEvents, upgrades } from '../data/maintenanceEvents.js'
import { randomInt } from '../utils/random.js'

// ─── Helpers ───────────────────────────────────────────────────────────────

function matchesPropertyType(templateType, propertyName) {
  return templateType === 'All' || templateType === propertyName
}

function capitalizeFirst(str) {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function getAlertType(priority) {
  const p = priority?.toLowerCase()
  if (p === 'critical') return 'error'
  if (p === 'high') return 'warning'
  return 'info'
}

// Weighted random selection using probabilityWeight field
function weightedSelect(items) {
  const total = items.reduce((s, i) => s + (i.probabilityWeight || 1), 0)
  let r = Math.random() * total
  for (const item of items) {
    r -= (item.probabilityWeight || 1)
    if (r <= 0) return item
  }
  return items[items.length - 1]
}

// After 3 months unresolved, cost escalates ×1.25, capped at 2× original. Startup actions never escalate.
function escalateEvents(activeEvents) {
  return activeEvents.map(ev => {
    if (ev.category === 'startupAction') return ev
    if (ev.monthsActive < 3) return ev
    const cap       = ev.originalCost * 2
    const escalated = Math.min(Math.round(ev.rolledCost * 1.25), cap)
    if (escalated === ev.rolledCost) return ev
    return { ...ev, rolledCost: escalated }
  })
}

function makeEventInstance(eventId, name, category, cashImpactType, priority, rolledCost, monthSpawned, frequencyMonths = null) {
  const p = capitalizeFirst(priority)
  return {
    instanceId:          `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourceId:            eventId,
    category,
    cashImpactType,
    name,
    priority:            p,
    originalPriority:    p,
    rolledCost,
    originalCost:        rolledCost,
    monthSpawned,
    monthsActive:        0,
    frequencyMonths,
    valueImpact:         0,
    conditionImpact:     0,
    permanentRentBoost:  undefined,
    permanentValueBoost: undefined,
  }
}

// Priority escalation: Low→Medium at 6mo, Medium→High at 12mo, High→Critical at 18mo
// Returns { updatedProp, escalatedEvents, newCriticalCount }
function escalatePriority(prop, events) {
  const ORDER = ['Low', 'Medium', 'High', 'Critical']
  let updatedProp = prop
  let newCriticalCount = 0

  const escalatedEvents = events.map(ev => {
    const idx = ORDER.indexOf(ev.priority)
    if (idx === -1 || idx === 3) return ev  // unknown or already Critical

    let newIdx = idx
    if      (ev.monthsActive >= 18 && idx < 3) newIdx = idx + 1
    else if (ev.monthsActive >= 12 && idx < 2) newIdx = idx + 1
    else if (ev.monthsActive >= 6  && idx < 1) newIdx = idx + 1

    if (newIdx === idx) return ev

    const newPriority = ORDER[newIdx]
    const updatedEv   = { ...ev, priority: newPriority }

    // Apply condition/value impact when escalating TO High or Critical
    if (newPriority === 'High' || newPriority === 'Critical') {
      const addedValue     = updatedEv.rolledCost
      const addedCondition = Math.round(updatedEv.rolledCost / (updatedProp.purchasePrice || 1) * 100)
      updatedEv.valueImpact     = (updatedEv.valueImpact     || 0) + addedValue
      updatedEv.conditionImpact = (updatedEv.conditionImpact || 0) + addedCondition
      updatedProp = {
        ...updatedProp,
        currentValue: Math.max(0, (updatedProp.currentValue || updatedProp.purchasePrice) - addedValue),
        condition:    Math.max(0, (updatedProp.condition    ?? 100)                       - addedCondition),
      }
    }

    if (newPriority === 'Critical') newCriticalCount++
    return updatedEv
  })

  return { updatedProp: { ...updatedProp, activeEvents: escalatedEvents }, newCriticalCount }
}

const PRIORITY_CONDITION_IMPACT = { Low: 2, Medium: 3, High: 5, Critical: 10 }

function applyConditionImpact(prop, instance) {
  if (instance.category === 'startupAction') return prop
  const isHighOrCritical = instance.priority === 'High' || instance.priority === 'Critical'
  const conditionImpact  = PRIORITY_CONDITION_IMPACT[instance.priority] ?? 2
  const valueImpact      = isHighOrCritical ? instance.rolledCost : 0
  instance.conditionImpact = conditionImpact
  instance.valueImpact     = valueImpact
  return {
    ...prop,
    currentValue: Math.max(0, (prop.currentValue || prop.purchasePrice) - valueImpact),
    condition:    Math.max(0, (prop.condition ?? 100) - conditionImpact),
  }
}

// ─── Core export: called from ADVANCE_MONTH reducer ───────────────────────

export function processMonthlyEvents(state, difficultySettings) {
  const earlyGameMonths  = difficultySettings.earlyGameProtectionMonths   ?? 6
  const probMult         = difficultySettings.eventProbabilityMultiplier   ?? 1
  const costMult         = difficultySettings.costMultiplier                ?? 1
  const pmDivisor        = difficultySettings.pmFrequencyDivisor            ?? 1
  const inflationRate    = difficultySettings.costAnnualInflationRate        ?? 0
  const newAlerts        = []
  const nextMonth        = state.currentMonth + 1
  let   totalEscalatedCritical = 0

  // Year-based cost inflation: costs grow annually by difficulty rate
  const gameYear  = Math.floor(nextMonth / 12)
  const inflMult  = Math.pow(1 + inflationRate, gameYear)
  const totalCost = (min, max) => Math.round(randomInt(min, max) * costMult * inflMult)

  // Upgrade-based maintenance reduction: every 5 upgrades halves event frequency.
  // 0–4: ×1.0 (no reduction), 5–9: ×0.5, 10+: ×0.25
  function upgradeMaintMult(prop) {
    const n = (prop.completedUpgrades || []).length
    if (n >= 10) return 0.25
    if (n >= 5)  return 0.5
    return 1.0
  }

  const updatedProperties = state.properties.map(property => {
    let prop = { ...property }
    const newMonthsOwned = (prop.monthsOwned || 0) + 1

    // 1. Increment monthsActive on all pending activeEvents
    prop.activeEvents = (prop.activeEvents || []).map(ev => ({
      ...ev,
      monthsActive: ev.monthsActive + 1,
    }))

    // 2. Escalate costs on deferred immediateBill / scheduledMaintenance events
    prop.activeEvents = escalateEvents(prop.activeEvents)

    // 3. Escalate priority on long-unresolved events (Low→Med→High→Critical)
    let newCriticalFromEscalation = 0
    ;({ updatedProp: prop, newCriticalCount: newCriticalFromEscalation } = escalatePriority(prop, prop.activeEvents))
    totalEscalatedCritical += newCriticalFromEscalation

    // 4. Expire active expense increases (monthlyExpenseIncrease events)
    const activeIncreases = prop.activeExpenseIncreases || []
    const expired         = activeIncreases.filter(i => i.monthsRemaining <= 1)
    const remaining       = activeIncreases
      .filter(i => i.monthsRemaining > 1)
      .map(i => ({ ...i, monthsRemaining: i.monthsRemaining - 1 }))

    if (expired.length > 0) {
      const totalExpired = expired.reduce((s, i) => s + i.increase, 0)
      prop.monthlyExpenses    = Math.max(0, (prop.monthlyExpenses || 0) - totalExpired)
      prop.activeExpenseIncreases = remaining
    }

    // 5. Roll for one random event this month
    const isEarlyGame = newMonthsOwned < earlyGameMonths

    const eligible = randomEvents.filter(evt => {
      if (evt.requiresTrigger)  return false  // trigger-only events never fire randomly
      if (evt.monthlyProbability <= 0) return false
      if (!matchesPropertyType(evt.propertyType, prop.name)) return false
      if (isEarlyGame && evt.blockedInEarlyGame) return false
      if (newMonthsOwned < (evt.minimumPropertyAgeMonths || 0)) return false
      // No duplicate active events from same source
      if (prop.activeEvents.some(e => e.sourceId === evt.eventId)) return false
      return true
    })

    // Each eligible event is an independent Bernoulli trial with its monthlyProbability.
    // upgradeMaintMult reduces probability as the player upgrades the property.
    const upgMult = upgradeMaintMult(prop)
    const hits = eligible.filter(evt =>
      Math.random() < Math.min(evt.monthlyProbability * probMult * upgMult, 1)
    )

    if (hits.length > 0) {
      // Pick one by weighted selection, then route by cashImpactType
      const selected = weightedSelect(hits)

      if (selected.cashImpactType === 'immediateBill') {
        const rolledCost = totalCost(selected.costMin, selected.costMax)
        const instance   = makeEventInstance(
          selected.eventId, selected.eventName, 'randomEvent',
          'immediateBill', selected.priority, rolledCost, nextMonth
        )
        prop = applyConditionImpact(prop, instance)
        prop.activeEvents = [...prop.activeEvents, instance]
        newAlerts.push({
          id:        `event-${prop.id}-${instance.instanceId}`,
          message:   `${prop.name}: ${instance.name} — estimated cost $${rolledCost.toLocaleString()}.`,
          type:      getAlertType(selected.priority),
          timestamp: nextMonth,
        })

      } else if (selected.cashImpactType === 'monthlyExpenseIncrease') {
        const increase = totalCost(selected.monthlyExpenseIncreaseMin, selected.monthlyExpenseIncreaseMax)
        if (increase > 0) {
          const expEntry = {
            id:             `exp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            eventId:        selected.eventId,
            name:           selected.eventName,
            increase,
            monthsRemaining: selected.durationMonths || 3,
          }
          prop.activeExpenseIncreases = [...(prop.activeExpenseIncreases || []), expEntry]
          prop.monthlyExpenses        = (prop.monthlyExpenses || 0) + increase
          newAlerts.push({
            id:        `expinc-${prop.id}-${expEntry.id}`,
            message:   `${prop.name}: ${selected.eventName} — monthly expenses +$${increase.toLocaleString()}/mo for ${selected.durationMonths} months.`,
            type:      'warning',
            timestamp: nextMonth,
          })
        }

      } else if (
        selected.cashImpactType === 'warningOnly' ||
        selected.cashImpactType === 'reputationPenalty' ||
        selected.cashImpactType === 'occupancyPenalty'
      ) {
        newAlerts.push({
          id:        `warn-${prop.id}-${selected.eventId}-${nextMonth}`,
          message:   `${prop.name}: ${selected.eventName} — ${selected.description}`,
          type:      getAlertType(selected.priority),
          timestamp: nextMonth,
        })
      }
      // refinanceBlocker / triggeredComplianceEvent: requiresTrigger: true so already filtered out
    }

    // 6. Check preventive maintenance schedule (max 1 PM spawn per property per month)
    if (prop.activeEvents.length < 3) {
      // upgMult < 1 increases effectiveFreq (longer interval = less frequent PM)
      const pmUpgMult = upgradeMaintMult(prop)
      const pmDue = preventiveMaintenance.filter(t => {
        if (!matchesPropertyType(t.propertyType, prop.name)) return false
        if (prop.activeEvents.some(e => e.sourceId === t.maintenanceId)) return false
        const effectiveFreq = Math.max(1, Math.round(t.preventiveMaintenanceFrequencyMonths / pmDivisor / pmUpgMult))
        return newMonthsOwned > 0 && newMonthsOwned % effectiveFreq === 0
      })

      if (pmDue.length > 0) {
        // Spawn the highest-priority one only
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
        const template      = pmDue.sort(
          (a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
        )[0]

        const effectiveFreq = Math.max(1, Math.round(template.preventiveMaintenanceFrequencyMonths / pmDivisor / pmUpgMult))
        const rolledCost    = totalCost(template.costMin, template.costMax)
        const instance      = makeEventInstance(
          template.maintenanceId, template.maintenanceName, 'preventiveMaintenance',
          'scheduledMaintenance', template.priority, rolledCost, nextMonth,
          effectiveFreq
        )
        prop = applyConditionImpact(prop, instance)
        prop.activeEvents = [...prop.activeEvents, instance]
        newAlerts.push({
          id:        `pm-${prop.id}-${instance.instanceId}`,
          message:   `${prop.name}: ${instance.name} is due — estimated cost $${rolledCost.toLocaleString()}.`,
          type:      'info',
          timestamp: nextMonth,
        })
      }
    }

    prop.monthsOwned = newMonthsOwned
    return prop
  })

  return { updatedProperties, newAlerts: newAlerts.slice(0, 5), newEscalatedCritical: totalEscalatedCritical }
}

// ─── Attach startup actions to a newly purchased property ─────────────────

export function attachStartupActions(property, currentMonth) {
  const eligible = startupActions.filter(t => matchesPropertyType(t.propertyType, property.name))
  const instances = eligible.map(t => {
    const rolledCost = randomInt(t.costMin, t.costMax)
    return {
      instanceId:          `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sourceId:            t.actionId,
      category:            'startupAction',
      cashImpactType:      'immediateBill',
      name:                t.actionName,
      priority:            capitalizeFirst(t.priority),
      rolledCost,
      originalCost:        rolledCost,
      monthSpawned:        currentMonth,
      monthsActive:        0,
      frequencyMonths:     null,
      valueImpact:         0,
      conditionImpact:     0,
      permanentRentBoost:  undefined,
      permanentValueBoost: undefined,
    }
  })
  return { ...property, activeEvents: [...(property.activeEvents || []), ...instances] }
}

// ─── Compute upgrades available for a property ────────────────────────────
// Returns upgrade templates (not instances). Filters by type, not-yet-completed, prereq met.

export function getAvailableUpgrades(property) {
  const completed    = property.completedUpgrades || []
  const ownedMonths  = property.monthsOwned || 0

  const hasPrereq = (req) => {
    if (!req) return true
    // Check if a startup action with that name was completed (completedUpgrades stores actionIds)
    // Also check if the named startup action is NOT still in activeEvents (i.e. it was resolved)
    const stillPending = (property.activeEvents || []).some(e => e.name === req)
    if (stillPending) return false
    // If the property has been owned long enough, assume named prereq was done
    return ownedMonths >= 3
  }

  return upgrades.filter(t => {
    if (!matchesPropertyType(t.propertyType, property.name)) return false
    if (completed.includes(t.upgradeId)) return false
    if (!hasPrereq(t.requiresPriorUpgrade)) return false
    return true
  })
}
