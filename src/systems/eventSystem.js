// eventSystem.js v3.0 — workload-pressure event generation
//
// Generation model:
//   1. Each property declares issuePressure: { monthly, maxNewPerMonth, maxActive }
//      in its templates (propertyTypes.js).
//   2. Each month we compute spawnCount via a count-first roll on the property's
//      expected monthlyIssuePressure, clamped by maxNewPerMonth and the remaining
//      maxActive headroom.
//   3. Operational events are picked via weightedSelect() over an eligibility-
//      filtered candidate set. monthlyProbability acts as the relative weight.
//   4. Major-failure events (RE_MAJOR_* + RE_WEATHER_*) run on their existing
//      independent Bernoulli path and are NOT reduced by upgradeMaintMult.
//   5. Escalation: 2/2/2 model. After 2 months at a priority tier, events
//      escalate to the next tier (Low/Medium → High → Critical) and apply
//      value+condition damage. Critical events grow rolledCost by 10%/month
//      after another 2 months, capped at 3× original.
//   6. Follow-on issues: when an event escalates to High/Critical, if its
//      template has followOnEventId AND event.hasSpawnedFollowOn isn't set,
//      we spawn the referenced template (respecting maxActive unless the
//      follow-on is critical).
//   7. Cooldowns: template.cooldownMonths gates re-firing of the same eventId
//      on the same property. Tracked via property.eventCooldowns map.
//
// Event routing by cashImpactType:
//   immediateBill            → activeEvents (player pays to resolve)
//   scheduledMaintenance     → activeEvents (from PM schedule)
//   monthlyExpenseIncrease   → auto-applied to property.monthlyExpenses
//   warningOnly              → alert only
//   reputationPenalty        → alert only
//   occupancyPenalty         → alert only
//   refinanceBlocker         → requiresTrigger: true (skipped in random rolling)
//   triggeredComplianceEvent → requiresTrigger: true (skipped in random rolling)

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

// Weighted random selection. Uses monthlyProbability as relative weight so
// frequently-rolled templates remain frequently-rolled in the new picker.
function weightedSelect(items) {
  if (!items.length) return null
  const total = items.reduce((s, i) => s + (i.monthlyProbability || i.probabilityWeight || 1), 0)
  let r = Math.random() * total
  for (const item of items) {
    r -= (item.monthlyProbability || item.probabilityWeight || 1)
    if (r <= 0) return item
  }
  return items[items.length - 1]
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
    priorityChangedAt:   monthSpawned,
    hasSpawnedFollowOn:  false,
    frequencyMonths,
    valueImpact:         0,
    conditionImpact:     0,
    permanentRentBoost:  undefined,
    permanentValueBoost: undefined,
  }
}

// ─── Escalation (2/2/2 model) ──────────────────────────────────────────────
// Each event tracks priorityChangedAt (initialized to monthSpawned). After 2
// months at the current priority, escalate:
//   Low/Medium → High  (apply damage)
//   High       → Critical (apply damage)
//   Critical   → cost grows 10%/month (after another 2 months at Critical)
//
// Cost growth on Critical caps at 3× originalCost.
function escalatePriority(prop, events, currentMonth) {
  let updatedProp = prop
  let newCriticalCount = 0

  const result = events.map(ev => {
    const priorityChangedAt = ev.priorityChangedAt ?? ev.monthSpawned
    const monthsAtCurrentPriority = currentMonth - priorityChangedAt

    // Startup actions never escalate (they're one-time tasks).
    if (ev.category === 'startupAction') return ev

    // Critical: rolledCost grows by 10%/month after 2+ months stuck at Critical.
    if (ev.priority === 'Critical') {
      if (monthsAtCurrentPriority >= 2) {
        const cap = ev.originalCost * 3
        const grown = Math.min(Math.round(ev.rolledCost * 1.10), cap)
        if (grown !== ev.rolledCost) return { ...ev, rolledCost: grown }
      }
      return ev
    }

    // Not yet 2 months at current priority → no escalation.
    if (monthsAtCurrentPriority < 2) return ev

    // Bump priority (Low or Medium → High; High → Critical) and apply damage.
    const newPriority = ev.priority === 'High' ? 'Critical' : 'High'

    const addedValue     = ev.rolledCost
    const addedCondition = Math.round((ev.rolledCost / (updatedProp.purchasePrice || 1)) * 100)
    updatedProp = {
      ...updatedProp,
      currentValue: Math.max(0, (updatedProp.currentValue || updatedProp.purchasePrice) - addedValue),
      condition:    Math.max(0, (updatedProp.condition    ?? 100) - addedCondition),
    }
    if (newPriority === 'Critical') newCriticalCount++

    return {
      ...ev,
      priority:          newPriority,
      priorityChangedAt: currentMonth,
      valueImpact:       (ev.valueImpact     || 0) + addedValue,
      conditionImpact:   (ev.conditionImpact || 0) + addedCondition,
    }
  })

  return { updatedProp: { ...updatedProp, activeEvents: result }, newCriticalCount, escalatedEvents: result }
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

// ─── Eligibility / spawn helpers ───────────────────────────────────────────

// Operational event candidates: not trigger-only, not major-failure, match
// property type, not blocked-early, age requirement met, not already active
// on the property, not on cooldown.
function getEligibleOperationalEvents(prop, isEarlyGame, currentMonth) {
  return randomEvents.filter(evt => {
    if (evt.requiresTrigger) return false
    if (evt.isMajorFailure)  return false
    if ((evt.monthlyProbability || 0) <= 0) return false
    if (!matchesPropertyType(evt.propertyType, prop.name)) return false
    if (isEarlyGame && evt.blockedInEarlyGame) return false
    if ((prop.monthsOwned || 0) < (evt.minimumPropertyAgeMonths || 0)) return false
    if ((prop.activeEvents || []).some(e => e.sourceId === evt.eventId)) return false
    if (evt.cooldownMonths) {
      const lastFired = (prop.eventCooldowns || {})[evt.eventId]
      if (lastFired != null && currentMonth - lastFired < evt.cooldownMonths) return false
    }
    return true
  })
}

// Count-first spawn count. Decimal pressure rolls like Poisson-lite: integer
// guaranteed, fractional probability of one more.
function getMonthlyIssueSpawnCount(pressure, probMult, upgMult) {
  const effective = Math.max(0, pressure * probMult * upgMult)
  const integerPart = Math.floor(effective)
  const fractionalPart = effective - integerPart
  return integerPart + (Math.random() < fractionalPart ? 1 : 0)
}

// Spawn a single event instance from a chosen template. Routes by cashImpactType.
// Returns { prop (mutated), instance (or null), alert (or null) }.
function spawnEventFromTemplate(prop, template, currentMonth, totalCost) {
  // Record cooldown if applicable
  if (template.cooldownMonths) {
    prop = { ...prop, eventCooldowns: { ...(prop.eventCooldowns || {}), [template.eventId]: currentMonth } }
  }

  if (template.cashImpactType === 'immediateBill') {
    const rolledCost = totalCost(template.costMin, template.costMax)
    const instance   = makeEventInstance(
      template.eventId, template.eventName, 'randomEvent',
      'immediateBill', template.priority, rolledCost, currentMonth
    )
    const updated = applyConditionImpact(prop, instance)
    return {
      prop:     { ...updated, activeEvents: [...(updated.activeEvents || []), instance] },
      instance,
      alert: {
        id:        `event-${prop.id}-${instance.instanceId}`,
        message:   `${prop.name}: ${instance.name} — estimated cost $${rolledCost.toLocaleString()}.`,
        type:      getAlertType(template.priority),
        timestamp: currentMonth,
      },
      alertSeverity: template.priority?.toLowerCase() || 'low',
    }
  }

  if (template.cashImpactType === 'monthlyExpenseIncrease') {
    const increase = totalCost(template.monthlyExpenseIncreaseMin, template.monthlyExpenseIncreaseMax)
    if (increase <= 0) return { prop, instance: null, alert: null }
    const expEntry = {
      id:              `exp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      eventId:         template.eventId,
      name:            template.eventName,
      increase,
      monthsRemaining: template.durationMonths || 3,
    }
    return {
      prop: {
        ...prop,
        activeExpenseIncreases: [...(prop.activeExpenseIncreases || []), expEntry],
        monthlyExpenses:        (prop.monthlyExpenses || 0) + increase,
      },
      instance: null,
      alert: {
        id:        `expinc-${prop.id}-${expEntry.id}`,
        message:   `${prop.name}: ${template.eventName} — monthly expenses +$${increase.toLocaleString()}/mo for ${template.durationMonths} months.`,
        type:      'warning',
        timestamp: currentMonth,
      },
      alertSeverity: 'medium',
    }
  }

  if (
    template.cashImpactType === 'warningOnly' ||
    template.cashImpactType === 'reputationPenalty' ||
    template.cashImpactType === 'occupancyPenalty'
  ) {
    const instance = makeEventInstance(
      template.eventId, template.eventName, 'randomEvent',
      template.cashImpactType, template.priority, 0, currentMonth
    )
    return {
      prop: { ...prop, activeEvents: [...(prop.activeEvents || []), instance] },
      instance,
      alert: {
        id:        `warn-${prop.id}-${template.eventId}-${currentMonth}`,
        message:   `${prop.name}: ${template.eventName} — ${template.description}`,
        type:      getAlertType(template.priority),
        timestamp: currentMonth,
      },
      alertSeverity: template.priority?.toLowerCase() || 'low',
    }
  }

  return { prop, instance: null, alert: null }
}

// Spawn a follow-on issue for an event that just escalated. Respects
// maxActive cap unless the follow-on itself is critical.
function maybeSpawnFollowOn(prop, sourceEvent, currentMonth, totalCost) {
  if (sourceEvent.hasSpawnedFollowOn) return { prop, alert: null }

  const sourceTemplate = randomEvents.find(t => t.eventId === sourceEvent.sourceId)
  if (!sourceTemplate?.followOnEventId) return { prop, alert: null }

  const followOnTemplate = randomEvents.find(t => t.eventId === sourceTemplate.followOnEventId)
  if (!followOnTemplate) return { prop, alert: null }

  // Property-type compatibility — skip silently if the follow-on doesn't fit.
  if (!matchesPropertyType(followOnTemplate.propertyType, prop.name)) return { prop, alert: null }

  // Don't double up if the follow-on is already active.
  if ((prop.activeEvents || []).some(e => e.sourceId === followOnTemplate.eventId)) {
    // Still mark the source so we don't keep retrying.
    const flagged = (prop.activeEvents || []).map(e =>
      e.instanceId === sourceEvent.instanceId ? { ...e, hasSpawnedFollowOn: true } : e
    )
    return { prop: { ...prop, activeEvents: flagged }, alert: null }
  }

  // Respect maxActive unless the follow-on is critical.
  const cap = prop.issuePressure?.maxActive ?? 3
  const isCriticalFollowOn = (followOnTemplate.priority || '').toLowerCase() === 'critical'
  if (!isCriticalFollowOn && (prop.activeEvents || []).length >= cap) return { prop, alert: null }

  const { prop: afterSpawn, alert } = spawnEventFromTemplate(prop, followOnTemplate, currentMonth, totalCost)
  // Mark source event so it won't spawn another follow-on.
  const flagged = (afterSpawn.activeEvents || []).map(e =>
    e.instanceId === sourceEvent.instanceId ? { ...e, hasSpawnedFollowOn: true } : e
  )
  const followAlert = alert ? {
    ...alert,
    id:      `followon-${alert.id}`,
    message: `${prop.name}: ${followOnTemplate.eventName} (follow-on from ${sourceEvent.name}) — ${followOnTemplate.description}`,
  } : null
  return { prop: { ...afterSpawn, activeEvents: flagged }, alert: followAlert }
}

// ─── Core export: called from ADVANCE_MONTH reducer ────────────────────────

export function processMonthlyEvents(state, difficultySettings) {
  const earlyGameMonths = difficultySettings.earlyGameProtectionMonths ?? 6
  const probMult        = difficultySettings.eventProbabilityMultiplier ?? 1
  const costMult        = difficultySettings.costMultiplier             ?? 1
  const pmDivisor       = difficultySettings.pmFrequencyDivisor         ?? 1
  const inflationRate   = difficultySettings.costAnnualInflationRate     ?? 0
  const newAlerts       = []
  const nextMonth       = state.currentMonth + 1
  let   totalEscalatedCritical = 0

  // Year-based cost inflation: costs grow annually by difficulty rate.
  const gameYear  = Math.floor(nextMonth / 12)
  const inflMult  = Math.pow(1 + inflationRate, gameYear)
  const totalCost = (min, max) => Math.round(randomInt(min, max) * costMult * inflMult)

  // Upgrade-based maintenance reduction: only applied to operational pressure,
  // never to major system failures. 0–4: ×1.0, 5–9: ×0.5, 10+: ×0.25.
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
      monthsActive: (ev.monthsActive || 0) + 1,
    }))

    // 2. Priority escalation (2/2/2) — applies damage, may upgrade to Critical
    let escalation
    ;({ updatedProp: prop, newCriticalCount: escalation = 0 } = escalatePriority(prop, prop.activeEvents, nextMonth))
    totalEscalatedCritical += escalation

    // 3. Follow-on issue spawning — walk newly-escalated High/Critical events
    //    (we identify them by priorityChangedAt === nextMonth)
    const newlyEscalated = (prop.activeEvents || []).filter(e =>
      (e.priority === 'High' || e.priority === 'Critical') &&
      e.priorityChangedAt === nextMonth &&
      !e.hasSpawnedFollowOn
    )
    for (const sourceEvent of newlyEscalated) {
      const { prop: afterFollow, alert } = maybeSpawnFollowOn(prop, sourceEvent, nextMonth, totalCost)
      prop = afterFollow
      if (alert) newAlerts.push(alert)
    }

    // 4. Expire active expense increases
    const activeIncreases = prop.activeExpenseIncreases || []
    const expired = activeIncreases.filter(i => i.monthsRemaining <= 1)
    const remaining = activeIncreases
      .filter(i => i.monthsRemaining > 1)
      .map(i => ({ ...i, monthsRemaining: i.monthsRemaining - 1 }))
    if (expired.length > 0) {
      const totalExpired = expired.reduce((s, i) => s + i.increase, 0)
      prop.monthlyExpenses        = Math.max(0, (prop.monthlyExpenses || 0) - totalExpired)
      prop.activeExpenseIncreases = remaining
    } else {
      prop.activeExpenseIncreases = remaining
    }

    // 5. Operational event generation — count-first model driven by pressure
    const isEarlyGame  = newMonthsOwned < earlyGameMonths
    const pressureCfg  = prop.issuePressure || { monthly: 0.25, maxNewPerMonth: 1, maxActive: 3 }
    const upgMult      = upgradeMaintMult(prop)
    const headroom     = Math.max(0, pressureCfg.maxActive - (prop.activeEvents || []).length)
    const maxNew       = Math.min(pressureCfg.maxNewPerMonth, headroom)
    const targetCount  = getMonthlyIssueSpawnCount(pressureCfg.monthly, probMult, upgMult)
    const spawnCount   = Math.min(targetCount, maxNew)

    const lowSeverityAlerts = []
    const highSeverityAlerts = []

    for (let i = 0; i < spawnCount; i++) {
      const candidates = getEligibleOperationalEvents(prop, isEarlyGame, nextMonth)
      if (!candidates.length) break
      const selected = weightedSelect(candidates)
      const { prop: after, alert, alertSeverity } = spawnEventFromTemplate(prop, selected, nextMonth, totalCost)
      prop = after
      if (alert) {
        if (alertSeverity === 'low') lowSeverityAlerts.push({ alert, name: selected.eventName })
        else                          highSeverityAlerts.push(alert)
      }
    }

    // Alert consolidation: if 3+ low-severity events spawned this month for this
    // property, collapse into one summary alert. Otherwise emit individually.
    if (lowSeverityAlerts.length >= 3) {
      newAlerts.push({
        id:        `ops-summary-${prop.id}-${nextMonth}`,
        message:   `${prop.name}: ${lowSeverityAlerts.length} minor operational issues this month (${lowSeverityAlerts.map(a => a.name).join(', ')}).`,
        type:      'info',
        timestamp: nextMonth,
      })
    } else {
      lowSeverityAlerts.forEach(a => newAlerts.push(a.alert))
    }
    highSeverityAlerts.forEach(a => newAlerts.push(a))

    // 6. Major-failure path — independent Bernoulli per template, NO upgrade reduction.
    const majorCandidates = randomEvents.filter(evt =>
      evt.isMajorFailure &&
      !evt.requiresTrigger &&
      matchesPropertyType(evt.propertyType, prop.name) &&
      !(isEarlyGame && evt.blockedInEarlyGame) &&
      newMonthsOwned >= (evt.minimumPropertyAgeMonths || 0) &&
      !(prop.activeEvents || []).some(e => e.sourceId === evt.eventId)
    )
    const majorHits = majorCandidates.filter(evt =>
      Math.random() < Math.min((evt.monthlyProbability || 0) * probMult, 1)
    )
    if (majorHits.length > 0) {
      const selected = weightedSelect(majorHits)
      // Still respect maxActive — but major failures bypass the cap if critical.
      const cap = pressureCfg.maxActive
      const isCritical = (selected.priority || '').toLowerCase() === 'critical'
      if (isCritical || (prop.activeEvents || []).length < cap) {
        const { prop: after, alert } = spawnEventFromTemplate(prop, selected, nextMonth, totalCost)
        prop = after
        if (alert) newAlerts.push(alert)
      }
    }

    // 7. Preventive maintenance — keyed to pressureCap (was hardcoded 3)
    if ((prop.activeEvents || []).length < pressureCfg.maxActive) {
      const pmUpgMult = upgradeMaintMult(prop)
      const pmDue = preventiveMaintenance.filter(t => {
        if (!matchesPropertyType(t.propertyType, prop.name)) return false
        if ((prop.activeEvents || []).some(e => e.sourceId === t.maintenanceId)) return false
        const effectiveFreq = Math.max(1, Math.round(t.preventiveMaintenanceFrequencyMonths / pmDivisor / pmUpgMult))
        return newMonthsOwned > 0 && newMonthsOwned % effectiveFreq === 0
      })

      if (pmDue.length > 0) {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
        const template = pmDue.sort(
          (a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
        )[0]
        const effectiveFreq = Math.max(1, Math.round(template.preventiveMaintenanceFrequencyMonths / pmDivisor / pmUpgMult))
        const rolledCost = totalCost(template.costMin, template.costMax)
        const instance = makeEventInstance(
          template.maintenanceId, template.maintenanceName, 'preventiveMaintenance',
          'scheduledMaintenance', template.priority, rolledCost, nextMonth, effectiveFreq
        )
        prop = applyConditionImpact(prop, instance)
        prop.activeEvents = [...(prop.activeEvents || []), instance]
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

  // Cap alerts at 5 to avoid spam.
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
      priorityChangedAt:   currentMonth,
      hasSpawnedFollowOn:  false,
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
  const completed   = property.completedUpgrades || []
  const ownedMonths = property.monthsOwned || 0

  const hasPrereq = (req) => {
    if (!req) return true
    const stillPending = (property.activeEvents || []).some(e => e.name === req)
    if (stillPending) return false
    return ownedMonths >= 3
  }

  return upgrades.filter(t => {
    if (!matchesPropertyType(t.propertyType, property.name)) return false
    if (completed.includes(t.upgradeId)) return false
    if (!hasPrereq(t.requiresPriorUpgrade)) return false
    return true
  })
}
