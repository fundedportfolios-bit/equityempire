// ═══════════════════════════════════════════════════════════════
// STAFF RULES — workload-points operations model
// ═══════════════════════════════════════════════════════════════
//
// Properties create workload. Maintenance issues create workload.
// Staff members provide workload capacity. Senior + Executive roles
// improve the effectiveness of the whole team via a leadership
// multiplier (capped at 2.5×).
//
// Coverage ratio = effectiveCapacity / totalOperationsWorkload
//
// All workload, capacity, and salary values live here so designers
// can balance without touching React components or system code.

// ─── Staff role definitions ────────────────────────────────────
// All four roles share the same salary escalation rule (3% per
// 12-month period from each role's own base).
export const STAFF_ROLES = {
  partTime: {
    id:                'partTime',
    label:             'Part Time Help',
    baseMonthlyCost:   2200,
    baseCapacity:      25,
    leadershipBonus:   0,
    canResolve:        ['routine', 'recurring'],
    icon:              '👤',
    iconImage:         '/icons/staff-part-time.png',
    blurb:             'Good for early routine and recurring tasks.',
    handles:           'Handles routine and recurring issues.',
  },
  fullTime: {
    id:                'fullTime',
    label:             'Full Time Staff',
    baseMonthlyCost:   6700,
    baseCapacity:      100,
    leadershipBonus:   0,
    canResolve:        ['routine', 'recurring', 'urgent'],
    icon:              '👤',
    iconImage:         '/icons/staff-full-time.png',
    blurb:             'Good for growing portfolios.',
    handles:           'Handles routine, recurring, and urgent issues.',
  },
  seniorManager: {
    id:                'seniorManager',
    label:             'Senior Manager',
    baseMonthlyCost:   11000,
    baseCapacity:      140,
    leadershipBonus:   0.20,
    canResolve:        ['routine', 'recurring', 'urgent', 'critical'],
    icon:              '👤',
    iconImage:         '/icons/staff-senior-manager.png',
    blurb:             'Improves team efficiency and handles critical issues.',
    handles:           'Handles routine, recurring, urgent, and critical issues.',
  },
  executiveOperator: {
    id:                'executiveOperator',
    label:             'Executive Operator',
    baseMonthlyCost:   18000,
    baseCapacity:      200,
    leadershipBonus:   0.50,
    canResolve:        ['routine', 'recurring', 'urgent', 'critical'],
    icon:              '👤',
    iconImage:         '/icons/staff-executive.png',
    blurb:             'Best for large or complex portfolios.',
    handles:           'Handles routine, recurring, urgent, and critical issues.',
  },
}

// Ordered list used for UI rendering + iteration.
export const STAFF_ROLE_ORDER = ['partTime', 'fullTime', 'seniorManager', 'executiveOperator']

// ─── Salary escalation ────────────────────────────────────────
// 3% raise applied every 12 months from each role's own base cost.
// Formula: currentCost = baseMonthlyCost * (1.03 ^ floor((month-1)/12))
export const SALARY_ESCALATION = {
  annualRaisePercent:  0.03,
  monthsBetweenRaises: 12,
}

// ─── Property workload (operations points / month) ────────────
// Active owned properties contribute base oversight workload.
// fix_flip only counts while held (it's a project, not a rental).
export const PROPERTY_WORKLOAD = {
  single_ltr:         10,
  single_str:         30,
  fix_flip:           35,
  small_multifamily:  45,
  medium_multifamily: 80,
  micro_resort:       120,
  apartment_building: 150,
  apartment_complex:  300,
}

// ─── Issue workload (operations points / issue) ───────────────
// Upgrades carry zero auto workload — staff never auto-completes
// upgrades; they remain a manual player decision.
export const ISSUE_WORKLOAD = {
  routine:   10,
  recurring: 15,
  urgent:    30,
  critical:  60,
  upgrade:   0,
}

// ─── Leadership multiplier ────────────────────────────────────
// multiplier = 1 + (seniorMgrs × 0.20) + (executives × 0.50)
// hard-capped at 2.5× so a single executive doesn't break the model.
export const LEADERSHIP_MULTIPLIER_CAP = 2.5

// ─── Coverage status thresholds ───────────────────────────────
// coverageRatio = effectiveCapacity / totalOperationsWorkload
//   No Staff:        any role count = 0 total
//   Covered:         ratio ≥ 1.00
//   Stretched:       ratio in [0.75, 1.00)
//   Overloaded:      ratio in [0.50, 0.75)
//   Breakdown Risk:  ratio < 0.50
// If totalWorkload === 0 and staff > 0 → Covered.
export const COVERAGE_THRESHOLDS = {
  covered:        1.00,
  stretched:      0.75,
  overloaded:     0.50,
  // anything below 0.50 → 'Breakdown Risk'
}

export const COVERAGE_STATUSES = {
  NO_STAFF:       'No Staff',
  COVERED:        'Covered',
  STRETCHED:      'Stretched',
  OVERLOADED:     'Overloaded',
  BREAKDOWN_RISK: 'Breakdown Risk',
}

// ─── Default staff state shape ────────────────────────────────
// Spread into INITIAL_STATE and used as the migration target for
// pre-v5 saves that stored a scalar staffCount.
export const DEFAULT_STAFF = {
  partTime:          0,
  fullTime:          0,
  seniorManager:     0,
  executiveOperator: 0,
}
