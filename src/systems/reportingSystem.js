// ═══════════════════════════════════════════════════════════════
// REPORTING SYSTEM — captures gameplay data for the future emailed
// game report. All functions are pure and accept `state` + event
// details, returning a new `reporting` subtree. Reducers in
// gameState.js call these helpers and spread the result back into
// state. Existing game math is never touched.
//
// Schema lives in INITIAL_STATE.reporting (see gameState.js).
// ═══════════════════════════════════════════════════════════════

// Default skeleton — used by initializeReportingState() and as a
// defensive merge target when loading older saves that predate this
// system.
export const REPORTING_DEFAULTS = {
  startingSnapshot: {
    startingCash:   null,
    startingMonth:  null,
    startedAt:      null,
  },
  playerGoals: {
    desiredMonthlyCashFlow: null,
    desiredPortfolioValue:  null,
  },
  currentRecords: {
    highestCashBalance:        0,
    highestPortfolioValue:     0,
    highestEquity:             0,
    highestMonthlyIncome:      0,
    highestMonthlyNetCashFlow: 0,
    highestDebt:               0,
    largestPropertyPurchase:   0,
    largestRefiCashOut:        0,
    bestCashFlowingProperty:   null,
  },
  milestones: {
    firstPropertyPurchaseMonth:  null,
    firstUpgradeMonth:           null,
    firstRefinanceMonth:         null,
    firstSaleMonth:              null,
    firstStaffHireMonth:         null,
    firstTriviaBonusMonth:       null,
    portfolioValueMilestones: {
      1000000:    null,
      2000000:    null,
      5000000:    null,
      10000000:   null,
      50000000:   null,
      100000000:  null,
      1000000000: null,
    },
    monthlyCashFlowMilestones: {
      1000:    null,
      5000:    null,
      10000:   null,
      25000:   null,
      50000:   null,
      100000:  null,
      500000:  null,
      1000000: null,
    },
    desiredCashFlowAchievedMonth: null,
  },
  totals: {
    propertiesPurchased:        0,
    propertiesSold:             0,
    refinancesCompleted:        0,
    upgradesCompleted:          0,
    staffHired:                 0,
    maintenanceIssuesResolved:  0,
    criticalIssuesResolved:     0,
    triviaQuestionsAnswered:    0,
    triviaCorrectAnswers:       0,
    triviaBonusEarned:          0,
    totalPurchaseVolume:        0,
    totalDownPaymentsPaid:      0,
    totalClosingCostsPaid:      0,
    totalCashOutFromRefinances: 0,
    totalSaleProceeds:          0,
    totalUpgradeSpend:          0,
    totalMaintenanceSpend:      0,
    totalStaffSpend:            0,
    totalLoanPayoffs:           0,
  },
  propertyCountsByType: {},
  monthlySnapshots:     [],
  gameHistory:          [],
  reportRequests:       [],
}

const HISTORY_CAP = 250  // keep history bounded so the save payload stays reasonable

// ─── Initialization & migration ────────────────────────────────
export function initializeReportingState({ startingCash, startingMonth }) {
  return {
    ...REPORTING_DEFAULTS,
    startingSnapshot: {
      startingCash,
      startingMonth: startingMonth ?? 1,
      startedAt:     new Date().toISOString(),
    },
    currentRecords: {
      ...REPORTING_DEFAULTS.currentRecords,
      highestCashBalance: Math.max(0, startingCash ?? 0),
    },
    propertyCountsByType:  {},
    monthlySnapshots:      [],
    gameHistory:           [],
    reportRequests:        [],
  }
}

// Deep merge a saved reporting object against the defaults so missing
// fields are filled. Used by LOAD_GAME migration.
export function migrateReporting(saved) {
  if (!saved || typeof saved !== 'object') return { ...REPORTING_DEFAULTS }
  return {
    ...REPORTING_DEFAULTS,
    ...saved,
    startingSnapshot:  { ...REPORTING_DEFAULTS.startingSnapshot,  ...(saved.startingSnapshot  || {}) },
    playerGoals:       { ...REPORTING_DEFAULTS.playerGoals,       ...(saved.playerGoals       || {}) },
    currentRecords:    { ...REPORTING_DEFAULTS.currentRecords,    ...(saved.currentRecords    || {}) },
    milestones: {
      ...REPORTING_DEFAULTS.milestones,
      ...(saved.milestones || {}),
      portfolioValueMilestones:  { ...REPORTING_DEFAULTS.milestones.portfolioValueMilestones,  ...(saved.milestones?.portfolioValueMilestones  || {}) },
      monthlyCashFlowMilestones: { ...REPORTING_DEFAULTS.milestones.monthlyCashFlowMilestones, ...(saved.milestones?.monthlyCashFlowMilestones || {}) },
    },
    totals:                { ...REPORTING_DEFAULTS.totals,                ...(saved.totals                || {}) },
    propertyCountsByType:  { ...(saved.propertyCountsByType || {}) },
    monthlySnapshots:      Array.isArray(saved.monthlySnapshots) ? saved.monthlySnapshots : [],
    gameHistory:           Array.isArray(saved.gameHistory)      ? saved.gameHistory      : [],
    reportRequests:        Array.isArray(saved.reportRequests)   ? saved.reportRequests   : [],
  }
}

// ─── Internal helpers ─────────────────────────────────────────
function getReporting(state) {
  return state.reporting && typeof state.reporting === 'object'
    ? state.reporting
    : migrateReporting(null)
}

function netCashFlow(state) {
  return (state.monthlyIncome || 0) - (state.monthlyExpenses || 0) - (state.staffExpense || 0)
}

function equityOf(state) {
  return (state.portfolioValue || 0) - (state.totalDebt || 0)
}

// Push a history entry capped at HISTORY_CAP.
function appendHistory(history, entry) {
  const next = [...(history || []), entry]
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next
}

// Update high-water records given the current state values.
function nextRecords(records, state, extra = {}) {
  const cf       = netCashFlow(state)
  const eq       = equityOf(state)
  return {
    ...records,
    highestCashBalance:        Math.max(records.highestCashBalance        || 0, state.cash || 0),
    highestPortfolioValue:     Math.max(records.highestPortfolioValue     || 0, state.portfolioValue || 0),
    highestEquity:             Math.max(records.highestEquity             || 0, eq),
    highestMonthlyIncome:      Math.max(records.highestMonthlyIncome      || 0, state.monthlyIncome || 0),
    highestMonthlyNetCashFlow: Math.max(records.highestMonthlyNetCashFlow || 0, cf),
    highestDebt:               Math.max(records.highestDebt               || 0, state.totalDebt || 0),
    largestPropertyPurchase:   Math.max(records.largestPropertyPurchase   || 0, extra.purchaseAmount || 0),
    largestRefiCashOut:        Math.max(records.largestRefiCashOut        || 0, extra.refiCashOut    || 0),
  }
}

// Pick the single property with the strongest monthly cash flow.
function findBestCashFlowingProperty(state) {
  if (!state.properties?.length) return null
  let best = null
  let bestCF = -Infinity
  for (const p of state.properties) {
    const cf = (p.monthlyRent || 0) - (p.monthlyExpenses || 0)
    if (cf > bestCF) {
      bestCF = cf
      best   = { id: p.id, name: p.name, templateId: p.templateId, monthlyCashFlow: cf }
    }
  }
  return best
}

// ─── Milestone scanning (used by ADVANCE_MONTH) ───────────────
// Sets a milestone key to `month` only if it's still null and the
// current value meets/exceeds the threshold. Returns updated map.
function setIfReached(map, value, month) {
  let next = map
  let mutated = false
  for (const key of Object.keys(map)) {
    const threshold = Number(key)
    if (map[key] == null && value >= threshold) {
      if (!mutated) { next = { ...map }; mutated = true }
      next[key] = month
    }
  }
  return { next, mutated }
}

// ─── Per-event recorders ──────────────────────────────────────
//
// Each recorder takes `state` (the state *after* the action's math
// has already been applied — so totals/portfolioValue/cash reflect
// post-action numbers) and an event detail object. Returns the new
// `reporting` subtree to be spread back into the parent state.

export function recordMonthlySnapshot(state) {
  const r = getReporting(state)
  const cf = netCashFlow(state)
  const snapshot = {
    month:           state.currentMonth || 1,
    cash:            state.cash || 0,
    portfolioValue:  state.portfolioValue || 0,
    equity:          equityOf(state),
    debt:            state.totalDebt || 0,
    monthlyIncome:   state.monthlyIncome || 0,
    monthlyExpenses: state.monthlyExpenses || 0,
    staffExpense:    state.staffExpense || 0,
    netCashFlow:     cf,
    propertyCount:   state.properties?.length || 0,
    staffCount:      sumStaff(state.staff),
  }

  // Capture record updates + check portfolio + CF milestones.
  const records = nextRecords(r.currentRecords, state, {})
  const month   = snapshot.month
  const pvRes   = setIfReached(r.milestones.portfolioValueMilestones, snapshot.portfolioValue, month)
  const cfRes   = setIfReached(r.milestones.monthlyCashFlowMilestones, cf, month)

  // Check desired-CF goal achievement if a goal exists and not yet recorded.
  let desiredMonth = r.milestones.desiredCashFlowAchievedMonth
  const goal = r.playerGoals.desiredMonthlyCashFlow
  if (goal != null && desiredMonth == null && cf >= goal) {
    desiredMonth = month
  }

  // Record best-cash-flowing property snapshot.
  const best = findBestCashFlowingProperty(state) || records.bestCashFlowingProperty

  // Add gameHistory entries for any milestones reached this tick.
  let history = r.gameHistory
  if (pvRes.mutated) {
    for (const key of Object.keys(pvRes.next)) {
      if (r.milestones.portfolioValueMilestones[key] == null && pvRes.next[key] === month) {
        history = appendHistory(history, baseHistoryEntry({
          month, type: 'milestone',
          title: `Portfolio value hit $${Number(key).toLocaleString()}`,
          state,
        }))
      }
    }
  }
  if (cfRes.mutated) {
    for (const key of Object.keys(cfRes.next)) {
      if (r.milestones.monthlyCashFlowMilestones[key] == null && cfRes.next[key] === month) {
        history = appendHistory(history, baseHistoryEntry({
          month, type: 'milestone',
          title: `Net monthly cash flow hit $${Number(key).toLocaleString()}`,
          state,
        }))
      }
    }
  }

  return {
    ...r,
    monthlySnapshots: [...r.monthlySnapshots, snapshot].slice(-600),  // ~50 yrs cap
    currentRecords:   { ...records, bestCashFlowingProperty: best },
    milestones: {
      ...r.milestones,
      portfolioValueMilestones:    pvRes.next,
      monthlyCashFlowMilestones:   cfRes.next,
      desiredCashFlowAchievedMonth: desiredMonth,
    },
    gameHistory: history,
  }
}

function sumStaff(staff) {
  if (!staff || typeof staff !== 'object') return 0
  return (staff.partTime || 0) + (staff.fullTime || 0) + (staff.seniorManager || 0) + (staff.executiveOperator || 0)
}

function baseHistoryEntry({ month, type, title, amount, propertyId, propertyType, state, details }) {
  return {
    month,
    type,
    title,
    amount:              amount ?? null,
    propertyId:          propertyId ?? null,
    propertyType:        propertyType ?? null,
    cashAfter:           state?.cash ?? null,
    portfolioValueAfter: state?.portfolioValue ?? null,
    equityAfter:         state ? equityOf(state) : null,
    debtAfter:           state?.totalDebt ?? null,
    netCashFlowAfter:    state ? netCashFlow(state) : null,
    details:             details ?? null,
  }
}

// ─── Action-specific recorders ────────────────────────────────

export function recordPropertyPurchase(state, { property, option, cashNeeded, downPayment, closingCosts }) {
  const r = getReporting(state)
  const month = state.currentMonth || 1
  const purchasePrice = option?.purchasePrice ?? property?.purchasePrice ?? 0
  const propType      = property?.name ?? option?.propertyType ?? 'Property'

  const counts = { ...(r.propertyCountsByType || {}) }
  counts[propType] = (counts[propType] || 0) + 1

  return {
    ...r,
    totals: {
      ...r.totals,
      propertiesPurchased:    (r.totals.propertiesPurchased || 0) + 1,
      totalPurchaseVolume:    (r.totals.totalPurchaseVolume || 0) + purchasePrice,
      totalDownPaymentsPaid:  (r.totals.totalDownPaymentsPaid || 0) + (downPayment || 0),
      totalClosingCostsPaid:  (r.totals.totalClosingCostsPaid || 0) + (closingCosts || 0),
    },
    milestones: {
      ...r.milestones,
      firstPropertyPurchaseMonth: r.milestones.firstPropertyPurchaseMonth ?? month,
    },
    propertyCountsByType: counts,
    currentRecords: nextRecords(r.currentRecords, state, { purchaseAmount: purchasePrice }),
    gameHistory: appendHistory(r.gameHistory, baseHistoryEntry({
      month, type: 'purchase',
      title: `Bought ${propType}`,
      amount: -(cashNeeded || 0),
      propertyId:   property?.id || null,
      propertyType: propType,
      state,
      details: { purchasePrice, downPayment: downPayment || null, closingCosts: closingCosts || null },
    })),
  }
}

export function recordRefinance(state, {
  property, netCash, oldLoanBalance, newLoanBalance,
  oldMonthlyDebtService, newMonthlyDebtService,
  closingCosts, grossCashOut,
}) {
  const r = getReporting(state)
  const month   = state.currentMonth || 1
  const cfDelta = (oldMonthlyDebtService || 0) - (newMonthlyDebtService || 0)
  return {
    ...r,
    totals: {
      ...r.totals,
      refinancesCompleted:        (r.totals.refinancesCompleted || 0) + 1,
      totalCashOutFromRefinances: (r.totals.totalCashOutFromRefinances || 0) + (netCash || 0),
      totalClosingCostsPaid:      (r.totals.totalClosingCostsPaid || 0) + (closingCosts || 0),
    },
    milestones: {
      ...r.milestones,
      firstRefinanceMonth: r.milestones.firstRefinanceMonth ?? month,
    },
    currentRecords: nextRecords(r.currentRecords, state, { refiCashOut: netCash || 0 }),
    gameHistory: appendHistory(r.gameHistory, baseHistoryEntry({
      month, type: 'refinance',
      title: `Refinanced ${property?.name || 'property'}`,
      amount: netCash || 0,
      propertyId:   property?.id || null,
      propertyType: property?.name || null,
      state,
      details: {
        grossCashOut: grossCashOut ?? null,
        closingCosts: closingCosts ?? null,
        netCashReceived: netCash || 0,
        oldLoanBalance: oldLoanBalance ?? null,
        newLoanBalance: newLoanBalance ?? null,
        oldMonthlyDebtPayment: oldMonthlyDebtService ?? null,
        newMonthlyDebtPayment: newMonthlyDebtService ?? null,
        cashFlowChange: cfDelta,
      },
    })),
  }
}

export function recordPropertySale(state, { property, salePrice, sellingCosts, loanPayoff, netProceeds }) {
  const r = getReporting(state)
  const month = state.currentMonth || 1
  const counts = { ...(r.propertyCountsByType || {}) }
  if (property?.name && counts[property.name] != null) {
    counts[property.name] = Math.max(0, counts[property.name] - 1)
  }
  return {
    ...r,
    totals: {
      ...r.totals,
      propertiesSold:    (r.totals.propertiesSold || 0) + 1,
      totalSaleProceeds: (r.totals.totalSaleProceeds || 0) + (netProceeds || 0),
    },
    milestones: {
      ...r.milestones,
      firstSaleMonth: r.milestones.firstSaleMonth ?? month,
    },
    propertyCountsByType: counts,
    currentRecords: nextRecords(r.currentRecords, state, {}),
    gameHistory: appendHistory(r.gameHistory, baseHistoryEntry({
      month, type: 'sale',
      title: `Sold ${property?.name || 'property'}`,
      amount: netProceeds || 0,
      propertyId:   property?.id || null,
      propertyType: property?.name || null,
      state,
      details: { salePrice, sellingCosts, loanPayoff, netSaleProceeds: netProceeds },
    })),
  }
}

export function recordUpgradeCompleted(state, { property, upgradeInstance, cost, incomeIncrease, valueIncrease }) {
  const r = getReporting(state)
  const month = state.currentMonth || 1
  return {
    ...r,
    totals: {
      ...r.totals,
      upgradesCompleted: (r.totals.upgradesCompleted || 0) + 1,
      totalUpgradeSpend: (r.totals.totalUpgradeSpend || 0) + (cost || 0),
    },
    milestones: {
      ...r.milestones,
      firstUpgradeMonth: r.milestones.firstUpgradeMonth ?? month,
    },
    currentRecords: nextRecords(r.currentRecords, state, {}),
    gameHistory: appendHistory(r.gameHistory, baseHistoryEntry({
      month, type: 'upgrade',
      title: `Installed ${upgradeInstance?.name || 'upgrade'}${property?.name ? ` on ${property.name}` : ''}`,
      amount: -(cost || 0),
      propertyId:   property?.id || null,
      propertyType: property?.name || null,
      state,
      details: {
        upgradeName: upgradeInstance?.name || null,
        propertyType: property?.name || null,
        cost: cost || 0,
        incomeIncrease: incomeIncrease ?? null,
        valueIncrease:  valueIncrease  ?? null,
      },
    })),
  }
}

export function recordStaffHire(state, { role, monthlyCost, totalStaffCountAfter, staffCapacityAfter, coverageAfter }) {
  const r = getReporting(state)
  const month = state.currentMonth || 1
  return {
    ...r,
    totals: {
      ...r.totals,
      staffHired: (r.totals.staffHired || 0) + 1,
    },
    milestones: {
      ...r.milestones,
      firstStaffHireMonth: r.milestones.firstStaffHireMonth ?? month,
    },
    currentRecords: nextRecords(r.currentRecords, state, {}),
    gameHistory: appendHistory(r.gameHistory, baseHistoryEntry({
      month, type: 'staffHire',
      title: `Hired ${role}`,
      amount: null,
      state,
      details: { role, monthlyCost: monthlyCost || 0, totalStaffCountAfter, staffCapacityAfter, coverageAfter },
    })),
  }
}

export function recordMaintenanceResolved(state, { property, event, cost }) {
  const r = getReporting(state)
  const month = state.currentMonth || 1
  const priority = (event?.priority || '').toLowerCase()
  const isCritical = priority === 'critical'
  const isUrgent   = priority === 'high' || priority === 'critical'

  const next = {
    ...r,
    totals: {
      ...r.totals,
      maintenanceIssuesResolved: (r.totals.maintenanceIssuesResolved || 0) + 1,
      criticalIssuesResolved:    (r.totals.criticalIssuesResolved   || 0) + (isCritical ? 1 : 0),
      totalMaintenanceSpend:     (r.totals.totalMaintenanceSpend    || 0) + (cost || 0),
    },
    currentRecords: nextRecords(r.currentRecords, state, {}),
  }

  // Only append to gameHistory for urgent + critical to avoid spam.
  if (isUrgent) {
    next.gameHistory = appendHistory(r.gameHistory, baseHistoryEntry({
      month, type: 'maintenance',
      title: `Resolved ${event?.name || 'maintenance issue'}${property?.name ? ` at ${property.name}` : ''}`,
      amount: -(cost || 0),
      propertyId:   property?.id || null,
      propertyType: property?.name || null,
      state,
      details: { priority: event?.priority || null, cost: cost || 0 },
    }))
  }
  return next
}

export function recordTriviaResult(state, { wasCorrect, reward, dismissed }) {
  const r = getReporting(state)
  const month = state.currentMonth || 1
  const asked = dismissed ? 0 : 1   // skipped = not "answered"
  const next = {
    ...r,
    totals: {
      ...r.totals,
      triviaQuestionsAnswered: (r.totals.triviaQuestionsAnswered || 0) + asked,
      triviaCorrectAnswers:    (r.totals.triviaCorrectAnswers    || 0) + (wasCorrect ? 1 : 0),
      triviaBonusEarned:       (r.totals.triviaBonusEarned       || 0) + (reward || 0),
    },
    milestones: {
      ...r.milestones,
      firstTriviaBonusMonth: (r.milestones.firstTriviaBonusMonth ?? (reward > 0 ? month : null)),
    },
    currentRecords: nextRecords(r.currentRecords, state, {}),
  }
  if (reward > 0) {
    next.gameHistory = appendHistory(r.gameHistory, baseHistoryEntry({
      month, type: 'triviaBonus',
      title: `Trivia bonus earned`,
      amount: reward,
      state,
      details: { reward, wasCorrect },
    }))
  }
  return next
}

// Loan-payoff tracking (single + batch). Doesn't fire history — pay-downs
// affect cash flow / debt but aren't a "headline" event for the report.
export function recordLoanPayoff(state, { amount, fullyPaidOff }) {
  const r = getReporting(state)
  return {
    ...r,
    totals: {
      ...r.totals,
      totalLoanPayoffs: (r.totals.totalLoanPayoffs || 0) + (amount || 0),
    },
    currentRecords: nextRecords(r.currentRecords, state, {}),
  }
}

// ─── Player goals + report request ────────────────────────────
export function setPlayerGoals(state, { desiredMonthlyCashFlow, desiredPortfolioValue }) {
  const r = getReporting(state)
  return {
    ...r,
    playerGoals: {
      ...r.playerGoals,
      desiredMonthlyCashFlow: desiredMonthlyCashFlow ?? r.playerGoals.desiredMonthlyCashFlow,
      desiredPortfolioValue:  desiredPortfolioValue  ?? r.playerGoals.desiredPortfolioValue,
    },
  }
}

// Scan existing monthlySnapshots for the first month the player hit
// `goal` (used when the player enters a goal after-the-fact via the
// Report form).
export function findFirstMonthAchievingCashFlow(snapshots, goal) {
  if (!goal || !Array.isArray(snapshots) || snapshots.length === 0) return null
  for (const s of snapshots) {
    if ((s.netCashFlow || 0) >= goal) return s.month
  }
  return null
}

// Build the report payload that will eventually be sent to the email
// pipeline. Pure function — does not touch state.
export function createReportPayload(state, playerInfo = {}) {
  const r = getReporting(state)
  const finalCF = netCashFlow(state)
  const goal    = playerInfo.desiredMonthlyCashFlow ?? r.playerGoals.desiredMonthlyCashFlow
  let desiredAchieved = r.milestones.desiredCashFlowAchievedMonth
  if (goal && desiredAchieved == null) {
    desiredAchieved = findFirstMonthAchievingCashFlow(r.monthlySnapshots, goal)
  }

  return {
    payloadVersion: 1,
    generatedAt:    new Date().toISOString(),
    playerInfo: {
      name:                   playerInfo.name           || null,
      email:                  playerInfo.email          || null,
      desiredMonthlyCashFlow: goal                      || null,
      consentToEmailReport:   !!playerInfo.consentToEmailReport,
      consentToFollowUp:      !!playerInfo.consentToFollowUp,
    },
    summary: {
      startingCash:        r.startingSnapshot.startingCash ?? null,
      finalCash:           state.cash || 0,
      finalPortfolioValue: state.portfolioValue || 0,
      finalEquity:         equityOf(state),
      finalDebt:           state.totalDebt || 0,
      finalMonthlyIncome:  state.monthlyIncome || 0,
      finalMonthlyExpenses:(state.monthlyExpenses || 0) + (state.staffExpense || 0),
      finalNetCashFlow:    finalCF,
      monthsPlayed:        Math.max(0, (state.currentMonth || 1) - 1),
      propertiesOwned:     state.properties?.length || 0,
      propertiesPurchased:        r.totals.propertiesPurchased || 0,
      propertiesSold:             r.totals.propertiesSold || 0,
      refinancesCompleted:        r.totals.refinancesCompleted || 0,
      totalCashOutFromRefinances: r.totals.totalCashOutFromRefinances || 0,
      upgradesCompleted:          r.totals.upgradesCompleted || 0,
      staffHired:                 r.totals.staffHired || 0,
      maintenanceIssuesResolved:  r.totals.maintenanceIssuesResolved || 0,
      criticalIssuesResolved:     r.totals.criticalIssuesResolved || 0,
      triviaBonusEarned:          r.totals.triviaBonusEarned || 0,
    },
    milestones: {
      portfolioValueMilestones:     r.milestones.portfolioValueMilestones,
      monthlyCashFlowMilestones:    r.milestones.monthlyCashFlowMilestones,
      desiredCashFlowAchievedMonth: desiredAchieved,
      firstPropertyPurchaseMonth:   r.milestones.firstPropertyPurchaseMonth,
      firstRefinanceMonth:          r.milestones.firstRefinanceMonth,
      firstStaffHireMonth:          r.milestones.firstStaffHireMonth,
      firstSaleMonth:               r.milestones.firstSaleMonth,
      firstUpgradeMonth:            r.milestones.firstUpgradeMonth,
      firstTriviaBonusMonth:        r.milestones.firstTriviaBonusMonth,
    },
    charts: {
      monthlySnapshots: r.monthlySnapshots,
    },
    history: r.gameHistory,
    propertyBreakdown: {
      propertyCountsByType:        r.propertyCountsByType,
      currentPropertiesSummary:    (state.properties || []).map(p => ({
        id:             p.id,
        name:           p.name,
        templateId:     p.templateId,
        currentValue:   p.currentValue || 0,
        loanBalance:    p.loanBalance || 0,
        equity:         (p.currentValue || 0) - (p.loanBalance || 0),
        monthlyRent:    p.monthlyRent || 0,
        monthlyExpenses:p.monthlyExpenses || 0,
        monthsOwned:    p.monthsOwned || 0,
      })),
    },
    currentRecords: r.currentRecords,
    difficulty:     state.difficulty,
    saveStartedAt:  r.startingSnapshot.startedAt,
  }
}

// Save a report request into reporting.reportRequests. Also patches
// playerGoals with the player's desiredMonthlyCashFlow and (if not yet
// recorded) backfills desiredCashFlowAchievedMonth from snapshots.
export function saveReportRequest(state, playerInfo) {
  const r = getReporting(state)
  const payload = createReportPayload(state, playerInfo)
  const newRequest = {
    submittedAt: new Date().toISOString(),
    playerInfo:  payload.playerInfo,
    payload,
  }
  const goal = playerInfo.desiredMonthlyCashFlow ?? r.playerGoals.desiredMonthlyCashFlow
  let desiredAchieved = r.milestones.desiredCashFlowAchievedMonth
  if (goal && desiredAchieved == null) {
    desiredAchieved = findFirstMonthAchievingCashFlow(r.monthlySnapshots, goal)
  }
  return {
    ...r,
    playerGoals: {
      ...r.playerGoals,
      desiredMonthlyCashFlow: goal ?? r.playerGoals.desiredMonthlyCashFlow,
    },
    milestones: {
      ...r.milestones,
      desiredCashFlowAchievedMonth: desiredAchieved,
    },
    reportRequests: [...(r.reportRequests || []), newRequest].slice(-20),  // cap stored requests
  }
}
