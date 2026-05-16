// ═══════════════════════════════════════════════════════════════
// STAFF SYSTEM — workload-points operations model
// ═══════════════════════════════════════════════════════════════
//
// Replaces the old "$ portfolio capacity" model. Now:
//   - Properties + active issues generate workload points
//   - Each role provides raw capacity points
//   - Senior + Executive roles boost team via leadership multiplier
//   - Staff auto-resolves eligible issues each month, prioritized
//     critical → urgent → recurring → routine
//   - Urgent + critical repairs still charge their rolledCost
//     (routine + recurring are covered by salary)

import {
  STAFF_ROLES,
  STAFF_ROLE_ORDER,
  SALARY_ESCALATION,
  PROPERTY_WORKLOAD,
  ISSUE_WORKLOAD,
  LEADERSHIP_MULTIPLIER_CAP,
  COVERAGE_THRESHOLDS,
  COVERAGE_STATUSES,
  DEFAULT_STAFF,
} from '../data/staffRules.js'

const ISSUE_PRIORITY_ORDER = ['critical', 'urgent', 'recurring', 'routine']

// ─── State accessor (defensive against old saves) ─────────────
// Always returns an object with all 4 role counts as numbers, even
// if state.staff is missing or holds an unmigrated scalar.
export function getStaffCounts(gameState) {
  const s = gameState?.staff
  if (s && typeof s === 'object') {
    return {
      partTime:          s.partTime          || 0,
      fullTime:          s.fullTime          || 0,
      seniorManager:     s.seniorManager     || 0,
      executiveOperator: s.executiveOperator || 0,
    }
  }
  // Migrate scalar staffCount → fullTime so old saves keep their team.
  if (typeof gameState?.staffCount === 'number' && gameState.staffCount > 0) {
    return { ...DEFAULT_STAFF, fullTime: gameState.staffCount }
  }
  return { ...DEFAULT_STAFF }
}

export function getTotalStaffCount(gameState) {
  const c = getStaffCounts(gameState)
  return c.partTime + c.fullTime + c.seniorManager + c.executiveOperator
}

// ─── Salary escalation ────────────────────────────────────────
// 3% per 12-month period from each role's own base.
export function getCurrentStaffCostByRole(role, currentMonth) {
  const cfg = STAFF_ROLES[role]
  if (!cfg) return 0
  const periods = Math.floor((Math.max(1, currentMonth) - 1) / SALARY_ESCALATION.monthsBetweenRaises)
  return Math.round(cfg.baseMonthlyCost * Math.pow(1 + SALARY_ESCALATION.annualRaisePercent, periods))
}

// Total monthly staff expense across all roles, escalated by month.
export function getTotalStaffExpense(gameState) {
  const counts = getStaffCounts(gameState)
  const month  = gameState?.currentMonth || 1
  return STAFF_ROLE_ORDER.reduce((sum, role) => {
    return sum + (counts[role] * getCurrentStaffCostByRole(role, month))
  }, 0)
}

// ─── Capacity calculation ─────────────────────────────────────
export function getRawStaffCapacity(gameState) {
  const counts = getStaffCounts(gameState)
  return STAFF_ROLE_ORDER.reduce((sum, role) => {
    return sum + (counts[role] * STAFF_ROLES[role].baseCapacity)
  }, 0)
}

export function getLeadershipMultiplier(gameState) {
  const counts = getStaffCounts(gameState)
  const raw    = 1
    + (counts.seniorManager     * STAFF_ROLES.seniorManager.leadershipBonus)
    + (counts.executiveOperator * STAFF_ROLES.executiveOperator.leadershipBonus)
  return Math.min(LEADERSHIP_MULTIPLIER_CAP, raw)
}

export function getEffectiveStaffCapacity(gameState) {
  return Math.round(getRawStaffCapacity(gameState) * getLeadershipMultiplier(gameState))
}

// ─── Workload calculation ─────────────────────────────────────
// Active owned properties contribute base monthly workload.
export function getPropertyBaseWorkload(properties) {
  if (!Array.isArray(properties)) return 0
  return properties.reduce((sum, p) => sum + (PROPERTY_WORKLOAD[p.templateId] || 0), 0)
}

// Maps a single event instance to a workload-type bucket.
// Returns one of: 'routine' | 'recurring' | 'urgent' | 'critical' | 'upgrade'
export function getIssueWorkloadType(event) {
  if (!event) return 'routine'

  // Upgrades are never auto-resolved.
  if (event.category === 'upgrades' || event.permanentValueBoost || event.permanentRentBoost) {
    return 'upgrade'
  }

  // Priority-based mapping (priority is capitalized at runtime).
  const p = (event.priority || '').toLowerCase()
  if (p === 'critical') return 'critical'
  if (p === 'high')     return 'urgent'

  // Recurring PM events spawn from preventiveMaintenance templates with
  // frequencyMonths set — treat them as recurring regardless of priority.
  if (event.category === 'preventiveMaintenance' || event.frequencyMonths) return 'recurring'

  // Everything else (medium, low, untagged) → routine.
  return 'routine'
}

// Workload points contributed by active unresolved issues across all properties.
export function getActiveIssueWorkload(properties) {
  if (!Array.isArray(properties)) return 0
  let sum = 0
  for (const p of properties) {
    for (const ev of (p.activeEvents || [])) {
      sum += ISSUE_WORKLOAD[getIssueWorkloadType(ev)] || 0
    }
  }
  return sum
}

export function getTotalOperationsWorkload(gameState) {
  const props = gameState?.properties || []
  return getPropertyBaseWorkload(props) + getActiveIssueWorkload(props)
}

// ─── Coverage status ──────────────────────────────────────────
export function getCoverageRatio(gameState) {
  const workload = getTotalOperationsWorkload(gameState)
  if (workload <= 0) return Infinity
  return getEffectiveStaffCapacity(gameState) / workload
}

export function getStaffStatus(gameState) {
  const totalStaff = getTotalStaffCount(gameState)
  if (totalStaff === 0) return COVERAGE_STATUSES.NO_STAFF
  const workload = getTotalOperationsWorkload(gameState)
  if (workload === 0) return COVERAGE_STATUSES.COVERED
  const ratio = getCoverageRatio(gameState)
  if (ratio >= COVERAGE_THRESHOLDS.covered)    return COVERAGE_STATUSES.COVERED
  if (ratio >= COVERAGE_THRESHOLDS.stretched)  return COVERAGE_STATUSES.STRETCHED
  if (ratio >= COVERAGE_THRESHOLDS.overloaded) return COVERAGE_STATUSES.OVERLOADED
  return COVERAGE_STATUSES.BREAKDOWN_RISK
}

// ─── Hiring rules ─────────────────────────────────────────────
// Player can hire any role if post-hire net monthly CF stays ≥ 0.
export function canHireStaffRole(gameState, role) {
  if (!STAFF_ROLES[role]) return false
  const month         = gameState.currentMonth || 1
  const newRoleCost   = getCurrentStaffCostByRole(role, month)
  const currentExp    = getTotalStaffExpense(gameState)
  const netCFAfter    = (gameState.monthlyIncome || 0)
                      - (gameState.monthlyExpenses || 0)
                      - currentExp
                      - newRoleCost
  return netCFAfter >= 0
}

// ─── Eligible-issue-types based on highest role employed ──────
// Per spec Part 10: simplify by team's highest role.
export function getEligibleIssueTypesForTeam(gameState) {
  const counts = getStaffCounts(gameState)
  if (counts.executiveOperator > 0 || counts.seniorManager > 0) {
    return ['routine', 'recurring', 'urgent', 'critical']
  }
  if (counts.fullTime > 0) return ['routine', 'recurring', 'urgent']
  if (counts.partTime > 0) return ['routine', 'recurring']
  return []
}

// ─── Monthly auto-resolution loop ─────────────────────────────
// Called from ADVANCE_MONTH (after processMonthlyEvents). Returns:
//   { resolvedProperties, resolvedCount, staffAlerts, cashSpent, unpaidCount }
//
// Rules:
//   1. Reserve base property workload from effective capacity.
//      remainingPoints = effectiveCapacity - basePropertyWorkload
//   2. If remaining ≤ 0 → only critical (if team has senior+) are resolvable.
//   3. Otherwise, iterate issues priority-first (critical → urgent → recurring → routine).
//   4. Skip issues whose type isn't in team's eligible set.
//   5. Skip + alert if urgent/critical and not enough cash (charges rolledCost).
//   6. Routine + recurring resolutions don't deduct cash (covered by salary).
export function processStaffMonthlyResolution(gameState) {
  const properties = gameState?.properties || []
  const totalStaff = getTotalStaffCount(gameState)

  if (totalStaff === 0) {
    return { resolvedProperties: properties, resolvedCount: 0, staffAlerts: [], cashSpent: 0, unpaidCount: 0 }
  }

  const effectiveCap      = getEffectiveStaffCapacity(gameState)
  const basePropWorkload  = getPropertyBaseWorkload(properties)
  const eligibleTypes     = getEligibleIssueTypesForTeam(gameState)
  const counts            = getStaffCounts(gameState)
  const teamHasSeniorPlus = counts.seniorManager > 0 || counts.executiveOperator > 0

  let remaining = effectiveCap - basePropWorkload

  // ── Gather candidate issues across all properties, with priority bucket ──
  const candidates = []
  properties.forEach((p, propIdx) => {
    (p.activeEvents || []).forEach(ev => {
      const issueType = getIssueWorkloadType(ev)
      if (issueType === 'upgrade') return                    // never auto-resolve upgrades
      if (!eligibleTypes.includes(issueType)) return         // team can't handle this type
      candidates.push({ propIdx, propId: p.id, propName: p.name, ev, issueType })
    })
  })

  // ── Sort: priority order asc-index = highest first ──
  candidates.sort((a, b) => {
    const aIdx = ISSUE_PRIORITY_ORDER.indexOf(a.issueType)
    const bIdx = ISSUE_PRIORITY_ORDER.indexOf(b.issueType)
    return aIdx - bIdx
  })

  // ── Determine which to resolve, respecting capacity & cash ──
  const toResolveByProp = new Map()   // propIdx → Set<instanceId>
  let resolvedCount     = 0
  let cashSpent         = 0
  let unpaidCount       = 0
  let availableCash     = gameState.cash || 0
  let escalatedCritical = 0           // for alert if overloaded but team still handles a critical

  for (const c of candidates) {
    const cost = ISSUE_WORKLOAD[c.issueType]

    // If overloaded (remaining ≤ 0): only critical resolutions allowed
    // and only when team has senior+ AND we still have cash for the repair.
    if (remaining <= 0) {
      if (c.issueType !== 'critical' || !teamHasSeniorPlus) continue
      // Still need cash for the repair below; fall through.
    } else if (cost > remaining) {
      continue                        // skip — not enough capacity left
    }

    // Urgent + critical still charge the rolled repair cost.
    const repairCost = (c.issueType === 'urgent' || c.issueType === 'critical')
      ? (c.ev.rolledCost || 0)
      : 0

    if (repairCost > availableCash) {
      unpaidCount++
      continue                        // leave unresolved — ages another month
    }

    // ✓ Resolve.
    if (!toResolveByProp.has(c.propIdx)) toResolveByProp.set(c.propIdx, new Set())
    toResolveByProp.get(c.propIdx).add(c.ev.instanceId)
    resolvedCount++
    if (remaining > 0) remaining -= cost
    if (repairCost > 0) { availableCash -= repairCost; cashSpent += repairCost }
    if (c.issueType === 'critical') escalatedCritical++
  }

  // ── Apply resolutions to property array ──
  const resolvedProperties = properties.map((p, idx) => {
    const ids = toResolveByProp.get(idx)
    if (!ids || !ids.size) return p

    let newCondition = p.condition ?? 100
    let newValue     = p.currentValue ?? p.purchasePrice
    const remaining  = []
    for (const ev of (p.activeEvents || [])) {
      if (ids.has(ev.instanceId)) {
        newCondition = Math.min(100, newCondition + (ev.conditionImpact || 0))
        newValue     = Math.min((p.purchasePrice ?? p.currentValue) * 2, newValue + (ev.valueImpact || 0))
      } else {
        remaining.push(ev)
      }
    }
    return {
      ...p,
      activeEvents: remaining,
      condition:    newCondition,
      currentValue: Math.round(newValue),
    }
  })

  // ── Alerts (single summary; spec: avoid spam) ──
  const staffAlerts = []
  if (resolvedCount > 0) {
    const cashNote = cashSpent > 0 ? ` ($${cashSpent.toLocaleString()} in repairs)` : ''
    staffAlerts.push({
      id:      `staff-res-${Date.now()}`,
      message: `Staff resolved ${resolvedCount} issue${resolvedCount !== 1 ? 's' : ''} this month${cashNote}.`,
      type:    'success',
    })
  }
  if (unpaidCount > 0) {
    staffAlerts.push({
      id:      `staff-cash-${Date.now()}`,
      message: `Staff could not complete ${unpaidCount} repair${unpaidCount !== 1 ? 's' : ''} — insufficient cash.`,
      type:    'warning',
    })
  }

  return { resolvedProperties, resolvedCount, staffAlerts, cashSpent, unpaidCount }
}

// ─── Legacy compatibility shims ───────────────────────────────
// Kept so any lingering callers don't crash mid-migration. These
// delegate to the new model wherever possible.

export function calcCurrentStaffCost(currentMonth) {
  // Maps to fullTime escalation since old saves migrated to fullTime.
  return getCurrentStaffCostByRole('fullTime', currentMonth)
}

export function calcStaffExpense(staffCountOrState, currentMonth) {
  if (typeof staffCountOrState === 'object') {
    return getTotalStaffExpense(staffCountOrState)
  }
  // scalar legacy form: assume fullTime.
  if (!staffCountOrState) return 0
  return calcCurrentStaffCost(currentMonth) * staffCountOrState
}
