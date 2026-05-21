import React, { createContext, useContext, useReducer } from 'react'
import { DIFFICULTY_SETTINGS } from '../data/difficultySettings.js'
import { calculateNetCashFlow, calculateMortgagePayment } from '../utils/financeMath.js'
import { createPropertyInstance, recalculatePortfolioTotals,
         computeBlendedValue }                               from '../systems/propertySystem.js'
import { processMonthlyEvents, attachStartupActions } from '../systems/eventSystem.js'
import {
  processStaffMonthlyResolution,
  getTotalStaffExpense,
  getStaffCounts,
  getCurrentStaffCostByRole,
  getStaffStatus,
} from '../systems/staffSystem.js'
import { DEFAULT_STAFF, STAFF_ROLES, COVERAGE_STATUSES } from '../data/staffRules.js'
import {
  REPORTING_DEFAULTS,
  initializeReportingState,
  migrateReporting,
  recordMonthlySnapshot,
  recordPropertyPurchase,
  recordRefinance,
  recordPropertySale,
  recordUpgradeCompleted,
  recordStaffHire,
  recordMaintenanceResolved,
  recordTriviaResult,
  recordLoanPayoff,
  saveReportRequest,
} from '../systems/reportingSystem.js'
import { selectTriviaQuestion } from '../systems/triviaSystem.js'
import { TRIVIA_RULES } from '../data/triviaRules.js'

// Stable per-run identifier for the leaderboard. crypto.randomUUID is
// available in every modern browser over HTTPS (and in Node 16+); the
// fallback covers any environment that lacks it.
export function generateRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `run_${crypto.randomUUID()}`
  } catch { /* fall through */ }
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

export const INITIAL_STATE = {
  // Player financials
  cash: 50000,
  monthlyIncome: 0,
  monthlyExpenses: 0,

  // Portfolio
  portfolioValue: 0,
  totalDebt: 0,
  properties: [],
  unlockedTiers: ['starter'],

  // Time
  currentMonth: 1,
  isPaused: false,
  isModalOpen: false,

  // Alerts & log
  alerts: [],
  completedActions: [],

  // Settings
  difficulty: 'medium',
  gameSpeed: 1,

  // Staff (workload-points model)
  staff:        { ...DEFAULT_STAFF },
  staffExpense: 0,
  lastStaffStatus: 'No Staff',  // throttles "backlog warning" alerts to once per status change

  // Trivia
  activeTriviaQuestion:  null,
  lastTriviaMonth:       0,
  usedTriviaQuestionIds: [],
  triviaEnabled:         true,

  // Market data
  marketInterestRate: null,

  // Win condition
  cashFlowGoal: 10000,
  gameWon: false,

  // Milestones
  activeMilestone: null,
  milestonesHit: [],
  cashFlowMilestoneHit: false,
  billionaireSeen: false,  // fires once when cash first crosses $1B

  // Meta
  gameStarted: false,
  gameOver: false,
  winner: false,
  tutorialSeen: false,  // set true after first completion/skip; persists with save

  // Leaderboard — runId uniquely identifies this game run for the leaderboard
  // (a save slot is just (uid, slotIndex); runId survives save/load and is the
  // stable per-run identity). leaderboardProfile is null until the slot opts in.
  runId: null,
  leaderboardProfile: null,

  // Reporting (captures gameplay data for the future emailed game report)
  reporting: REPORTING_DEFAULTS,

  // Invest modal tracking
  investOpenCount: 0,
}

export function gameReducer(state, action) {
  switch (action.type) {
    case 'NEW_GAME': {
      const settings = DIFFICULTY_SETTINGS[action.payload.difficulty]
      return {
        ...INITIAL_STATE,
        difficulty:    action.payload.difficulty,
        cashFlowGoal:  action.payload.cashFlowGoal || 10000,
        cash:          settings.startingCash,
        gameStarted:   true,
        // Mint a stable run id for this new game (leaderboard identity).
        runId:         generateRunId(),
        leaderboardProfile: null,
        // Seed reporting with starting cash + month so the report can show
        // "started with X, ended with Y" later.
        reporting: initializeReportingState({
          startingCash:  settings.startingCash,
          startingMonth: 1,
        }),
        alerts: [
          {
            id: 'welcome',
            message: `Welcome to Equity Empire! You're starting with $${settings.startingCash.toLocaleString()}. Buy your first property to begin building your portfolio.`,
            type: 'info',
            timestamp: 1,
          },
        ],
      }
    }

    case 'ADVANCE_MONTH': {
      const difficultySettings = DIFFICULTY_SETTINGS[state.difficulty]
      const { updatedProperties: rawProperties, newAlerts, newEscalatedCritical } =
        processMonthlyEvents(state, difficultySettings)

      // Apply value and rent appreciation per difficulty
      const annualRate     = difficultySettings.rentAnnualAppreciationRate || 0
      const monthlyValRate = annualRate / 12
      const updatedProperties = rawProperties.map(p => {
        let updated = p
        const mo   = updated.monthsOwned
        const name = updated.name

        // Monthly property value appreciation → applied to baseMarketValue
        // Use property-specific appreciationRate if set; fall back to global difficulty rate.
        // Then blend baseMarketValue with income-based value via computeBlendedValue.
        if (mo > 0) {
          const propAppRate = updated.appreciationRate ?? monthlyValRate
          const newBase = propAppRate > 0
            ? Math.round((updated.baseMarketValue ?? updated.currentValue) * (1 + propAppRate))
            : (updated.baseMarketValue ?? updated.currentValue)
          updated = { ...updated, baseMarketValue: newBase }
          const { blendedPreUpgradeValue, currentValue: newCV } = computeBlendedValue(updated)
          updated = { ...updated, blendedPreUpgradeValue, currentValue: newCV }
        }

        // Rent appreciation: LTR/Multifamily/Apartment annual; STR/Resort monthly
        const isLTR = name.includes('Long-Term') || name.includes('Multifamily') ||
                      name.includes('Apartment')
        const isSTR = name.includes('Short-Term') || name === 'Micro Resort'
        if (isLTR && mo > 0 && mo % 12 === 0) {
          updated = { ...updated, monthlyRent: Math.round(updated.monthlyRent * (1 + annualRate)) }
        } else if (isSTR && mo > 0) {
          updated = { ...updated, monthlyRent: Math.round(updated.monthlyRent * (1 + annualRate / 12)) }
        }
        return updated
      })

      const newMonth = state.currentMonth + 1

      // Staff auto-resolution (workload-points model — after appreciation, before cash update)
      const preStaffTotals = recalculatePortfolioTotals(updatedProperties, newMonth)
      const preStaffState  = { ...state, properties: updatedProperties, currentMonth: newMonth }
      const {
        resolvedProperties,
        staffAlerts,
        cashSpent: staffCashSpent,
      } = processStaffMonthlyResolution(preStaffState)

      // Staff expense recalculated at new month (raises apply per role)
      const newStaffExpense = getTotalStaffExpense({ staff: state.staff, currentMonth: newMonth })

      // Backlog warning — throttled: only fire when status worsens into a problem tier.
      const postStaffSnapshot = {
        staff:           state.staff,
        properties:      resolvedProperties,
        monthlyIncome:   preStaffTotals.monthlyIncome,
        monthlyExpenses: preStaffTotals.monthlyExpenses,
        currentMonth:    newMonth,
      }
      const newStaffStatus    = getStaffStatus(postStaffSnapshot)
      const backlogStatuses   = [COVERAGE_STATUSES.STRETCHED, COVERAGE_STATUSES.OVERLOADED, COVERAGE_STATUSES.BREAKDOWN_RISK]
      const wasBacklog        = backlogStatuses.includes(state.lastStaffStatus)
      const nowBacklog        = backlogStatuses.includes(newStaffStatus)
      if (nowBacklog && (!wasBacklog || newStaffStatus !== state.lastStaffStatus)) {
        staffAlerts.push({
          id:      `staff-backlog-${Date.now()}`,
          message: `Operations team is ${newStaffStatus.toLowerCase()} — routine issues may age into urgent ones.`,
          type:    'warning',
        })
      }

      // Staff repair-cost deductions (urgent/critical auto-resolutions still
      // charge the rolled repair cost) are subtracted on top of monthly CF.
      const netCashFlow = state.monthlyIncome - state.monthlyExpenses - newStaffExpense
      const newCash     = state.cash + netCashFlow - (staffCashSpent || 0)
      const totals      = recalculatePortfolioTotals(resolvedProperties, newMonth)

      // Pause if any newly-spawned OR newly-escalated critical event remains after staff resolution
      const hasCriticalSpawn = resolvedProperties.some(p =>
        (p.activeEvents || []).some(e => e.priority === 'Critical' && e.monthSpawned === newMonth)
      )
      const shouldPause = hasCriticalSpawn ||
        (newEscalatedCritical > 0 && resolvedProperties.some(p =>
          (p.activeEvents || []).some(e => e.priority === 'Critical')
        ))

      // Trivia trigger — check after all monthly processing
      const shouldTriggerTrivia = (
        state.triviaEnabled !== false &&
        newMonth % TRIVIA_RULES.triviaIntervalMonths === 0 &&
        (state.lastTriviaMonth ?? 0) !== newMonth
      )
      const triviaQuestion = shouldTriggerTrivia
        ? selectTriviaQuestion(state.usedTriviaQuestionIds ?? [], totals.portfolioValue)
        : (state.activeTriviaQuestion ?? null)

      const monthAlert = {
        id:        `month-${newMonth}`,
        message:   `Month ${newMonth}: Cash flow of ${netCashFlow >= 0 ? '+' : ''}$${netCashFlow.toLocaleString()} applied. Balance: $${newCash.toLocaleString()}`,
        type:      netCashFlow >= 0 ? 'success' : 'warning',
        timestamp: newMonth,
      }
      const strActivationAlerts = resolvedProperties
        .filter(p => p.revenueStartMonth === newMonth)
        .map(p => ({
          id:        `str-active-${p.id}`,
          message:   `${p.name} is ready to host! Revenue starts this month.`,
          type:      'success',
          timestamp: newMonth,
        }))
      const allAlerts = [monthAlert, ...strActivationAlerts, ...staffAlerts.map(a => ({ ...a, timestamp: newMonth })), ...newAlerts.map(a => ({ ...a, timestamp: a.timestamp ?? newMonth })), ...state.alerts].slice(0, 20)

      const newNetCF  = totals.monthlyIncome - totals.monthlyExpenses - newStaffExpense
      const goal      = state.cashFlowGoal || 10000
      const justWon   = !state.gameWon && newMonth > 1 && newNetCF >= goal

      const MILESTONES = [1000000, 5000000, 10000000, 50000000]
      const portfolioMilestone = MILESTONES.find(m =>
        totals.portfolioValue >= m &&
        !(state.milestonesHit || []).includes(m) &&
        (state.portfolioValue || 0) < m
      ) ?? null

      // Cash flow halfway milestone — fires once when net CF first crosses 50% of goal
      const halfwayGoal       = goal * 0.5
      const justHitHalfwayCF  =
        !state.cashFlowMilestoneHit &&
        !state.gameWon &&
        !justWon &&
        !portfolioMilestone &&
        newMonth > 1 &&
        newNetCF >= halfwayGoal

      // Billionaire status — fires once when cash first crosses $1B.
      // Prefers other milestones if they also fire this tick (queued for later).
      const justBillionaire =
        !state.billionaireSeen &&
        newCash >= 1_000_000_000 &&
        !portfolioMilestone &&
        !justHitHalfwayCF &&
        !justWon

      const newMilestone =
        portfolioMilestone
        ?? (justHitHalfwayCF ? 'halfwayCF' : null)
        ?? (justBillionaire ? 'billionaire' : null)
      const milestoneOrWin = newMilestone || justWon

      // Build the post-month state, then record a reporting snapshot.
      const advancedState = {
        ...state,
        currentMonth:          newMonth,
        cash:                  newCash,
        properties:            resolvedProperties,
        portfolioValue:        totals.portfolioValue,
        totalDebt:             totals.totalDebt,
        monthlyIncome:         totals.monthlyIncome,
        monthlyExpenses:       totals.monthlyExpenses,
        staffExpense:          newStaffExpense,
        lastStaffStatus:       newStaffStatus,
        activeTriviaQuestion:  triviaQuestion,
        lastTriviaMonth:       shouldTriggerTrivia ? newMonth : (state.lastTriviaMonth ?? 0),
        usedTriviaQuestionIds: state.usedTriviaQuestionIds ?? [],
        isModalOpen:           shouldTriggerTrivia ? true : (milestoneOrWin ? true : state.isModalOpen),
        alerts:                allAlerts,
        isPaused:              milestoneOrWin ? true : (shouldPause ? true : state.isPaused),
        gameWon:               justWon ? true : state.gameWon,
        activeMilestone:       newMilestone ?? state.activeMilestone,
        milestonesHit:         portfolioMilestone ? [...(state.milestonesHit || []), portfolioMilestone] : (state.milestonesHit || []),
        cashFlowMilestoneHit:  state.cashFlowMilestoneHit || justHitHalfwayCF,
        billionaireSeen:       state.billionaireSeen || justBillionaire,
      }
      return { ...advancedState, reporting: recordMonthlySnapshot(advancedState) }
    }

    case 'BUY_PROPERTY': {
      const { option } = action.payload
      const newCash        = state.cash - option.cashNeeded
      const baseProperty   = createPropertyInstance(option, state.currentMonth)
      const newProperty    = attachStartupActions(baseProperty, state.currentMonth)
      const newProperties  = [...state.properties, newProperty]
      const totals         = recalculatePortfolioTotals(newProperties, state.currentMonth)
      const hasCriticalStartup = (newProperty.activeEvents || []).some(e => e.priority === 'Critical')
      const isSTRPurchase  = option.templateId === 'single_str' || option.templateId === 'micro_resort'
      const alert = {
        id:        `buy-${Date.now()}`,
        message:   isSTRPurchase
          ? `Purchased ${option.propertyType} for $${option.purchasePrice.toLocaleString()}. Revenue starts in 2 months after setup. Cash used: $${option.cashNeeded.toLocaleString()}.`
          : `Purchased ${option.propertyType} for $${option.purchasePrice.toLocaleString()}. Cash used: $${option.cashNeeded.toLocaleString()} (down payment + closing costs).`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      const buyState = {
        ...state,
        cash:            newCash,
        properties:      newProperties,
        portfolioValue:  totals.portfolioValue,
        totalDebt:       totals.totalDebt,
        monthlyIncome:   totals.monthlyIncome,
        monthlyExpenses: totals.monthlyExpenses,
        alerts:          [alert, ...state.alerts].slice(0, 20),
        isPaused:        hasCriticalStartup ? true : state.isPaused,
      }
      const downPayment  = Math.round((option.purchasePrice || 0) * ((option.downPaymentPercent ?? 0) / 100))
      const closingCosts = Math.round((option.purchasePrice || 0) * ((option.closingCostPercent  ?? 0) / 100))
      return {
        ...buyState,
        reporting: recordPropertyPurchase(buyState, {
          property:    newProperty,
          option,
          cashNeeded:  option.cashNeeded,
          downPayment,
          closingCosts,
        }),
      }
    }

    case 'RESOLVE_EVENT': {
      const { propertyId, instanceId } = action.payload
      const targetProp = state.properties.find(p => p.id === propertyId)
      const instance   = (targetProp?.activeEvents || []).find(e => e.instanceId === instanceId)
      if (!instance) return state

      if (state.cash < instance.rolledCost) {
        const noFundsAlert = {
          id:        `nofunds-${Date.now()}`,
          message:   `Not enough cash to resolve ${instance.name}. Need $${instance.rolledCost.toLocaleString()}.`,
          type:      'error',
          timestamp: state.currentMonth,
        }
        return { ...state, alerts: [noFundsAlert, ...state.alerts].slice(0, 20) }
      }

      const updatedProperties = state.properties.map(p => {
        if (p.id !== propertyId) return p
        // Apply value impact to baseMarketValue (not currentValue directly)
        // so it feeds into the blended formula instead of bypassing it.
        const newBase = Math.min(
          p.purchasePrice * 2,
          (p.baseMarketValue ?? p.currentValue) + (instance.valueImpact || 0)
        )
        const { blendedPreUpgradeValue, currentValue: newCurrentValue } = computeBlendedValue({
          ...p,
          baseMarketValue: newBase,
        })
        return {
          ...p,
          activeEvents:          (p.activeEvents || []).filter(e => e.instanceId !== instanceId),
          baseMarketValue:       newBase,
          blendedPreUpgradeValue: blendedPreUpgradeValue,
          currentValue:          newCurrentValue,
          condition:             Math.min(100, (p.condition ?? 0) + (instance.conditionImpact || 0)),
        }
      })
      const totals = recalculatePortfolioTotals(updatedProperties, state.currentMonth)

      // Auto-unpause if no Critical events remain after this resolution
      const stillHasCritical = updatedProperties.some(p =>
        (p.activeEvents || []).some(e => e.priority === 'Critical')
      )

      const resolveAlert = {
        id:        `resolve-${instanceId}`,
        message:   `Resolved: ${instance.name} — paid $${instance.rolledCost.toLocaleString()}.`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      const resolveState = {
        ...state,
        cash:            state.cash - instance.rolledCost,
        properties:      updatedProperties,
        portfolioValue:  totals.portfolioValue,
        totalDebt:       totals.totalDebt,
        monthlyIncome:   totals.monthlyIncome,
        monthlyExpenses: totals.monthlyExpenses,
        alerts:          [resolveAlert, ...state.alerts].slice(0, 20),
        isPaused:        stillHasCritical ? state.isPaused : false,
      }
      return {
        ...resolveState,
        reporting: recordMaintenanceResolved(resolveState, {
          property: targetProp,
          event:    instance,
          cost:     instance.rolledCost,
        }),
      }
    }

    case 'INSTALL_UPGRADE': {
      const { propertyId, upgradeInstance } = action.payload
      if (!upgradeInstance) return state

      if (state.cash < upgradeInstance.rolledCost) {
        const noFundsAlert = {
          id:        `nofunds-upgrade-${Date.now()}`,
          message:   `Not enough cash to install ${upgradeInstance.name}. Need $${upgradeInstance.rolledCost.toLocaleString()}.`,
          type:      'error',
          timestamp: state.currentMonth,
        }
        return { ...state, alerts: [noFundsAlert, ...state.alerts].slice(0, 20) }
      }

      const updatedProperties = state.properties.map(p => {
        if (p.id !== propertyId) return p
        const newRent       = p.monthlyRent + (upgradeInstance.permanentRentBoost || 0)
        const newTotalBoost = (p.totalUpgradeValueBoost ?? 0) + (upgradeInstance.permanentValueBoost || 0)
        // Recompute currentValue via blend so upgrade boost is never double-counted
        const { currentValue: newCurrentValue } = computeBlendedValue({
          ...p,
          monthlyRent:            Math.round(newRent),
          totalUpgradeValueBoost: newTotalBoost,
        })
        return {
          ...p,
          monthlyRent:            Math.round(newRent),
          totalUpgradeValueBoost: newTotalBoost,
          currentValue:           newCurrentValue,
          completedUpgrades:      [...(p.completedUpgrades || []), upgradeInstance.sourceId],
        }
      })
      const totals = recalculatePortfolioTotals(updatedProperties, state.currentMonth)
      const upgradeAlert = {
        id:        `upgrade-${upgradeInstance.sourceId}-${Date.now()}`,
        message:   `Upgrade complete: ${upgradeInstance.name} — paid $${upgradeInstance.rolledCost.toLocaleString()}. Monthly income and property value updated.`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      const upgState = {
        ...state,
        cash:            state.cash - upgradeInstance.rolledCost,
        properties:      updatedProperties,
        portfolioValue:  totals.portfolioValue,
        totalDebt:       totals.totalDebt,
        monthlyIncome:   totals.monthlyIncome,
        monthlyExpenses: totals.monthlyExpenses,
        alerts:          [upgradeAlert, ...state.alerts].slice(0, 20),
      }
      return {
        ...upgState,
        reporting: recordUpgradeCompleted(upgState, {
          property:        updatedProperties.find(p => p.id === propertyId),
          upgradeInstance,
          cost:            upgradeInstance.rolledCost,
          incomeIncrease:  upgradeInstance.permanentRentBoost || 0,
          valueIncrease:   upgradeInstance.permanentValueBoost || 0,
        }),
      }
    }

    case 'INSTALL_UPGRADES_BATCH': {
      const { propertyId: batchPropId, upgradeInstances } = action.payload
      if (!Array.isArray(upgradeInstances) || upgradeInstances.length === 0) return state

      const totalCost = upgradeInstances.reduce((s, u) => s + (u.rolledCost || 0), 0)
      if (state.cash < totalCost) {
        const noFundsAlert = {
          id:        `nofunds-batch-${Date.now()}`,
          message:   `Not enough cash to install ${upgradeInstances.length} upgrades. Need $${totalCost.toLocaleString()}.`,
          type:      'error',
          timestamp: state.currentMonth,
        }
        return { ...state, alerts: [noFundsAlert, ...state.alerts].slice(0, 20) }
      }

      const totalRent  = upgradeInstances.reduce((s, u) => s + (u.permanentRentBoost  || 0), 0)
      const totalValue = upgradeInstances.reduce((s, u) => s + (u.permanentValueBoost || 0), 0)
      const sourceIds  = upgradeInstances.map(u => u.sourceId).filter(Boolean)

      const updatedBatchProperties = state.properties.map(p => {
        if (p.id !== batchPropId) return p
        const newRent       = (p.monthlyRent || 0) + totalRent
        const newTotalBoost = (p.totalUpgradeValueBoost ?? 0) + totalValue
        const { currentValue: newCurrentValue } = computeBlendedValue({
          ...p,
          monthlyRent:            Math.round(newRent),
          totalUpgradeValueBoost: newTotalBoost,
        })
        return {
          ...p,
          monthlyRent:            Math.round(newRent),
          totalUpgradeValueBoost: newTotalBoost,
          currentValue:           newCurrentValue,
          completedUpgrades:      [...(p.completedUpgrades || []), ...sourceIds],
        }
      })
      const batchTotals = recalculatePortfolioTotals(updatedBatchProperties, state.currentMonth)
      const batchProp   = state.properties.find(p => p.id === batchPropId)
      const batchAlert  = {
        id:        `upgrade-batch-${Date.now()}`,
        message:   `Installed ${upgradeInstances.length} upgrade${upgradeInstances.length !== 1 ? 's' : ''}${batchProp ? ` on ${batchProp.name}` : ''} — paid $${totalCost.toLocaleString()}. +$${totalRent.toLocaleString()}/mo rent.`,
        type:      'success',
        timestamp: state.currentMonth,
      }

      const batchUpgState = {
        ...state,
        cash:            state.cash - totalCost,
        properties:      updatedBatchProperties,
        portfolioValue:  batchTotals.portfolioValue,
        totalDebt:       batchTotals.totalDebt,
        monthlyIncome:   batchTotals.monthlyIncome,
        monthlyExpenses: batchTotals.monthlyExpenses,
        alerts:          [batchAlert, ...state.alerts].slice(0, 20),
      }
      // Record each upgrade instance in the batch.
      let nextReporting = batchUpgState.reporting
      const batchProperty = updatedBatchProperties.find(p => p.id === batchPropId)
      for (const u of upgradeInstances) {
        nextReporting = recordUpgradeCompleted(
          { ...batchUpgState, reporting: nextReporting },
          {
            property:        batchProperty,
            upgradeInstance: u,
            cost:            u.rolledCost,
            incomeIncrease:  u.permanentRentBoost || 0,
            valueIncrease:   u.permanentValueBoost || 0,
          }
        )
      }
      return { ...batchUpgState, reporting: nextReporting }
    }

    case 'SELL_PROPERTY': {
      const { propertyId: sellId, netProceeds } = action.payload
      const soldProp = state.properties.find(p => p.id === sellId)
      if (!soldProp) return state

      const remainingProps = state.properties.filter(p => p.id !== sellId)
      const sellTotals     = recalculatePortfolioTotals(remainingProps, state.currentMonth)
      const sellAlert = {
        id:        `sell-${sellId}-${Date.now()}`,
        message:   `Sold ${soldProp.name} — net proceeds: $${netProceeds.toLocaleString()} added to cash.`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      const sellState = {
        ...state,
        cash:            state.cash + netProceeds,
        properties:      remainingProps,
        portfolioValue:  sellTotals.portfolioValue,
        totalDebt:       sellTotals.totalDebt,
        monthlyIncome:   sellTotals.monthlyIncome,
        monthlyExpenses: sellTotals.monthlyExpenses,
        alerts:          [sellAlert, ...state.alerts].slice(0, 20),
      }
      return {
        ...sellState,
        reporting: recordPropertySale(sellState, {
          property:    soldProp,
          salePrice:   soldProp.currentValue || 0,
          sellingCosts:Math.round((soldProp.currentValue || 0) * 0.04),
          loanPayoff:  soldProp.loanBalance || 0,
          netProceeds,
        }),
      }
    }

    case 'SELL_PROPERTIES_BATCH': {
      const { sales } = action.payload
      if (!Array.isArray(sales) || sales.length === 0) return state

      const ids = new Set(sales.map(s => s.propertyId))
      const remainingPropsBatch = state.properties.filter(p => !ids.has(p.id))
      const totalProceeds = sales.reduce((s, x) => s + (x.netProceeds || 0), 0)
      const batchSellTotals = recalculatePortfolioTotals(remainingPropsBatch, state.currentMonth)
      const batchSellAlert = {
        id:        `sell-batch-${Date.now()}`,
        message:   `Sold ${sales.length} propert${sales.length === 1 ? 'y' : 'ies'} — net proceeds: $${totalProceeds.toLocaleString()} added to cash.`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      const batchSellState = {
        ...state,
        cash:            state.cash + totalProceeds,
        properties:      remainingPropsBatch,
        portfolioValue:  batchSellTotals.portfolioValue,
        totalDebt:       batchSellTotals.totalDebt,
        monthlyIncome:   batchSellTotals.monthlyIncome,
        monthlyExpenses: batchSellTotals.monthlyExpenses,
        alerts:          [batchSellAlert, ...state.alerts].slice(0, 20),
      }
      // Record each sale in the batch.
      let nextSellReporting = batchSellState.reporting
      for (const s of sales) {
        const soldP = state.properties.find(p => p.id === s.propertyId)
        if (!soldP) continue
        nextSellReporting = recordPropertySale(
          { ...batchSellState, reporting: nextSellReporting },
          {
            property:    soldP,
            salePrice:   soldP.currentValue || 0,
            sellingCosts:Math.round((soldP.currentValue || 0) * 0.04),
            loanPayoff:  soldP.loanBalance || 0,
            netProceeds: s.netProceeds || 0,
          }
        )
      }
      return { ...batchSellState, reporting: nextSellReporting }
    }

    case 'REFINANCE_PROPERTY': {
      const { propertyId: refiId, netCash, newLoanBalance, newMonthlyDebtService, newMonthlyExpenses } = action.payload
      const refiProp = state.properties.find(p => p.id === refiId)
      if (!refiProp) return state

      const refiProps = state.properties.map(p => {
        if (p.id !== refiId) return p
        return {
          ...p,
          loanBalance:        newLoanBalance,
          monthlyDebtService: newMonthlyDebtService,
          monthlyExpenses:    newMonthlyExpenses,
        }
      })
      const refiTotals = recalculatePortfolioTotals(refiProps, state.currentMonth)
      const refiAlert = {
        id:        `refi-${refiId}-${Date.now()}`,
        message:   `Refinanced ${refiProp.name} — received $${netCash.toLocaleString()} cash. New loan balance: $${newLoanBalance.toLocaleString()}.`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      const refiState = {
        ...state,
        cash:            state.cash + netCash,
        properties:      refiProps,
        portfolioValue:  refiTotals.portfolioValue,
        totalDebt:       refiTotals.totalDebt,
        monthlyIncome:   refiTotals.monthlyIncome,
        monthlyExpenses: refiTotals.monthlyExpenses,
        alerts:          [refiAlert, ...state.alerts].slice(0, 20),
      }
      return {
        ...refiState,
        reporting: recordRefinance(refiState, {
          property:               refiProp,
          netCash,
          oldLoanBalance:         refiProp.loanBalance,
          newLoanBalance,
          oldMonthlyDebtService:  refiProp.monthlyDebtService,
          newMonthlyDebtService,
        }),
      }
    }

    case 'REFINANCE_BATCH': {
      const { refis } = action.payload
      if (!refis?.length) return state

      const byId = new Map(refis.map(r => [r.propertyId, r]))
      const refiProps = state.properties.map(p => {
        const r = byId.get(p.id)
        if (!r) return p
        return {
          ...p,
          loanBalance:        r.newLoanBalance,
          monthlyDebtService: r.newMonthlyDebtService,
          monthlyExpenses:    r.newMonthlyExpenses,
        }
      })

      const totals    = recalculatePortfolioTotals(refiProps, state.currentMonth)
      const totalCash = refis.reduce((s, r) => s + (r.netCash || 0), 0)
      const propCount = refis.length
      const batchAlert = {
        id:        `batch-refi-${Date.now()}`,
        message:   `Batch refinanced ${propCount} propert${propCount === 1 ? 'y' : 'ies'} — received $${totalCash.toLocaleString()} cash.`,
        type:      'success',
        timestamp: state.currentMonth,
      }

      const batchRefiState = {
        ...state,
        properties:      refiProps,
        cash:            state.cash + totalCash,
        portfolioValue:  totals.portfolioValue,
        totalDebt:       totals.totalDebt,
        monthlyIncome:   totals.monthlyIncome,
        monthlyExpenses: totals.monthlyExpenses,
        alerts:          [batchAlert, ...state.alerts].slice(0, 20),
      }
      // Record each refi in the batch.
      let nextBatchReporting = batchRefiState.reporting
      for (const r of refis) {
        const oldP = state.properties.find(p => p.id === r.propertyId)
        if (!oldP) continue
        nextBatchReporting = recordRefinance(
          { ...batchRefiState, reporting: nextBatchReporting },
          {
            property:              oldP,
            netCash:               r.netCash || 0,
            oldLoanBalance:        oldP.loanBalance,
            newLoanBalance:        r.newLoanBalance,
            oldMonthlyDebtService: oldP.monthlyDebtService,
            newMonthlyDebtService: r.newMonthlyDebtService,
          }
        )
      }
      return { ...batchRefiState, reporting: nextBatchReporting }
    }

    case 'PAY_DOWN_LOAN': {
      const { propertyId: payProp, amount } = action.payload
      const target = state.properties.find(p => p.id === payProp)
      if (!target) return state

      const reqAmount = Math.max(0, Math.min(amount || 0, target.loanBalance || 0))
      if (reqAmount <= 0)             return state
      if (state.cash < reqAmount)     return state

      const rate      = target.interestRate ?? 0.08
      const term      = target.loanTermMonths ?? 360
      const newBalance = (target.loanBalance || 0) - reqAmount
      const newPI      = Math.round(calculateMortgagePayment(newBalance, rate, term))
      const oldPI      = Math.round(target.monthlyDebtService || 0)
      const newExp     = Math.max(0, (target.monthlyExpenses || 0) - oldPI + newPI)

      const updatedProps = state.properties.map(p => {
        if (p.id !== payProp) return p
        return {
          ...p,
          loanBalance:        newBalance,
          monthlyDebtService: newPI,
          monthlyExpenses:    newExp,
        }
      })
      const totals = recalculatePortfolioTotals(updatedProps, state.currentMonth)
      const wasFull = newBalance === 0
      const payDownAlert = {
        id:        `paydown-${payProp}-${Date.now()}`,
        message:   wasFull
          ? `Paid off ${target.name} — $${reqAmount.toLocaleString()} applied. Monthly debt service eliminated.`
          : `Paid down ${target.name} — $${reqAmount.toLocaleString()} applied. Loan balance now $${newBalance.toLocaleString()}.`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      const payDownState = {
        ...state,
        cash:            state.cash - reqAmount,
        properties:      updatedProps,
        portfolioValue:  totals.portfolioValue,
        totalDebt:       totals.totalDebt,
        monthlyIncome:   totals.monthlyIncome,
        monthlyExpenses: totals.monthlyExpenses,
        alerts:          [payDownAlert, ...state.alerts].slice(0, 20),
      }
      return {
        ...payDownState,
        reporting: recordLoanPayoff(payDownState, { amount: reqAmount, fullyPaidOff: wasFull }),
      }
    }

    case 'PAY_OFF_LOANS_BATCH': {
      const { payoffs } = action.payload
      if (!Array.isArray(payoffs) || payoffs.length === 0) return state

      // Resolve actual payoff amounts per property (cap at loanBalance).
      const resolved = payoffs
        .map(po => {
          const target = state.properties.find(p => p.id === po.propertyId)
          if (!target) return null
          const amt = Math.max(0, Math.min(po.amount || target.loanBalance || 0, target.loanBalance || 0))
          if (amt <= 0) return null
          return { propertyId: po.propertyId, amount: amt, target }
        })
        .filter(Boolean)
      if (resolved.length === 0) return state

      const totalCost = resolved.reduce((s, r) => s + r.amount, 0)
      if (state.cash < totalCost) {
        const noFundsAlert = {
          id:        `nofunds-batch-payoff-${Date.now()}`,
          message:   `Not enough cash for batch loan payoff. Need $${totalCost.toLocaleString()}.`,
          type:      'error',
          timestamp: state.currentMonth,
        }
        return { ...state, alerts: [noFundsAlert, ...state.alerts].slice(0, 20) }
      }

      const byId = new Map(resolved.map(r => [r.propertyId, r]))
      const updatedBatchProps = state.properties.map(p => {
        const r = byId.get(p.id)
        if (!r) return p
        const rate     = p.interestRate ?? 0.08
        const term     = p.loanTermMonths ?? 360
        const newBal   = (p.loanBalance || 0) - r.amount
        const newPI    = Math.round(calculateMortgagePayment(newBal, rate, term))
        const oldPI    = Math.round(p.monthlyDebtService || 0)
        const newExp   = Math.max(0, (p.monthlyExpenses || 0) - oldPI + newPI)
        return {
          ...p,
          loanBalance:        newBal,
          monthlyDebtService: newPI,
          monthlyExpenses:    newExp,
        }
      })
      const totals = recalculatePortfolioTotals(updatedBatchProps, state.currentMonth)
      const count  = resolved.length
      const batchPayoffAlert = {
        id:        `batch-payoff-${Date.now()}`,
        message:   `Paid off ${count} loan${count !== 1 ? 's' : ''} — $${totalCost.toLocaleString()} applied. Monthly debt service reduced.`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      const batchPayoffState = {
        ...state,
        cash:            state.cash - totalCost,
        properties:      updatedBatchProps,
        portfolioValue:  totals.portfolioValue,
        totalDebt:       totals.totalDebt,
        monthlyIncome:   totals.monthlyIncome,
        monthlyExpenses: totals.monthlyExpenses,
        alerts:          [batchPayoffAlert, ...state.alerts].slice(0, 20),
      }
      return {
        ...batchPayoffState,
        reporting: recordLoanPayoff(batchPayoffState, { amount: totalCost, fullyPaidOff: true }),
      }
    }

    case 'CLOSE_TRIVIA': {
      const { reward, dismissed } = action.payload
      const newAlerts = dismissed
        ? state.alerts
        : reward > 0
          ? [{ id: `kpu-reward-${Date.now()}`, message: `Knowledge Power-Up bonus: $${reward.toLocaleString()}`, type: 'success', timestamp: state.currentMonth }, ...state.alerts]
          : [{ id: `kpu-skip-${Date.now()}`,   message: 'Knowledge Power-Up answered — no bonus this time.',    type: 'info',    timestamp: state.currentMonth }, ...state.alerts]
      const triviaState = {
        ...state,
        cash:                  state.cash + reward,
        activeTriviaQuestion:  null,
        usedTriviaQuestionIds: [...(state.usedTriviaQuestionIds ?? []), state.activeTriviaQuestion?.id].filter(Boolean),
        isModalOpen:           false,
        alerts:                newAlerts.slice(0, 20),
      }
      return {
        ...triviaState,
        reporting: recordTriviaResult(triviaState, {
          wasCorrect: !dismissed && reward > 0,
          reward,
          dismissed,
        }),
      }
    }

    case 'HIRE_STAFF_ROLE': {
      const { role } = action.payload
      const cfg = STAFF_ROLES[role]
      if (!cfg) return state

      const currentStaff = getStaffCounts(state)
      const newStaff     = { ...currentStaff, [role]: (currentStaff[role] || 0) + 1 }
      const newExpense   = getTotalStaffExpense({ staff: newStaff, currentMonth: state.currentMonth })
      const alert = {
        id:        `hire-${role}-${Date.now()}`,
        message:   `Hired 1 ${cfg.label}. Monthly staff expense is now $${newExpense.toLocaleString()}.`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      const hireState = {
        ...state,
        staff:        newStaff,
        staffExpense: newExpense,
        alerts:       [alert, ...state.alerts].slice(0, 20),
      }
      const totalStaffCountAfter =
        newStaff.partTime + newStaff.fullTime + newStaff.seniorManager + newStaff.executiveOperator
      return {
        ...hireState,
        reporting: recordStaffHire(hireState, {
          role:                 cfg.label,
          monthlyCost:          getCurrentStaffCostByRole(role, state.currentMonth),
          totalStaffCountAfter,
        }),
      }
    }

    case 'FIRE_STAFF_ROLE': {
      const { role } = action.payload
      const cfg = STAFF_ROLES[role]
      if (!cfg) return state

      const currentStaff = getStaffCounts(state)
      const currentCount = currentStaff[role] || 0
      if (currentCount <= 0) return state  // nothing to fire

      const newStaff   = { ...currentStaff, [role]: currentCount - 1 }
      const newExpense = getTotalStaffExpense({ staff: newStaff, currentMonth: state.currentMonth })
      const alert = {
        id:        `fire-${role}-${Date.now()}`,
        message:   `Let go 1 ${cfg.label}. Monthly staff expense is now $${newExpense.toLocaleString()}.`,
        type:      'info',
        timestamp: state.currentMonth,
      }
      return {
        ...state,
        staff:        newStaff,
        staffExpense: newExpense,
        alerts:       [alert, ...state.alerts].slice(0, 20),
      }
    }

    case 'ADD_ALERT': {
      const { id, message, type, timestamp } = action.payload
      return {
        ...state,
        alerts: [{ id, message, type, timestamp: timestamp ?? state.currentMonth }, ...state.alerts].slice(0, 20),
      }
    }

    case 'CLEAR_ALERT': {
      return {
        ...state,
        alerts: state.alerts.filter(a => a.id !== action.payload.id),
      }
    }

    case 'CLEAR_ALL_ALERTS': {
      return { ...state, alerts: [] }
    }

    case 'SET_DIFFICULTY': {
      return { ...state, difficulty: action.payload.difficulty }
    }

    case 'SET_SPEED': {
      return { ...state, gameSpeed: action.payload.gameSpeed }
    }

    case 'SET_PAUSED': {
      return { ...state, isPaused: action.payload.paused }
    }

    case 'SET_MODAL_OPEN': {
      return { ...state, isModalOpen: action.payload.open }
    }

    case 'OPEN_INVEST_MODAL': {
      return { ...state, isModalOpen: true, investOpenCount: state.investOpenCount + 1 }
    }

    case 'SET_MARKET_RATE': {
      return { ...state, marketInterestRate: action.payload.rate }
    }

    case 'LOAD_GAME': {
      const saved = action.payload.savedState
      const migratedProperties = (saved.properties || []).map(p => {
        const piPayment = p.loanBalance > 0
          ? calculateMortgagePayment(p.loanBalance, 0.08, 360)
          : 0
        // Merge defaults first so spread can override with saved values
        const base = {
          activeEvents:           [],
          completedUpgrades:      [],
          activeExpenseIncreases: [],
          monthlyDebtService:     Math.round(piPayment),
          interestRate:           0.08,
          loanTermMonths:         360,
          // v4 blended valuation fields — initialize from currentValue for old saves
          baseMarketValue:        p.currentValue,
          totalUpgradeValueBoost: 0,
          blendedPreUpgradeValue: p.currentValue,
        }
        return { ...base, ...p }
      })
      // Migrate staff shape: old scalar staffCount → new role object.
      // Existing fullTime-equivalent staff are mapped to fullTime; the
      // other three role buckets initialize to zero.
      const migratedStaff = (() => {
        if (saved.staff && typeof saved.staff === 'object') {
          return { ...DEFAULT_STAFF, ...saved.staff }
        }
        if (typeof saved.staffCount === 'number' && saved.staffCount > 0) {
          return { ...DEFAULT_STAFF, fullTime: saved.staffCount }
        }
        return { ...DEFAULT_STAFF }
      })()
      const migratedStaffExpense = getTotalStaffExpense({
        staff:        migratedStaff,
        currentMonth: saved.currentMonth || 1,
      })

      // Drop legacy fields from the spread to avoid polluting new state.
      const { staffCount: _legacyStaffCount, staff: _legacyStaff, staffExpense: _legacyExp, ...savedRest } = saved

      return {
        ...INITIAL_STATE,
        staff:                 { ...DEFAULT_STAFF },
        staffExpense:          0,
        lastStaffStatus:       'No Staff',
        activeTriviaQuestion:  null,
        lastTriviaMonth:       0,
        usedTriviaQuestionIds: [],
        marketInterestRate:    null,
        triviaEnabled:         true,
        ...savedRest,
        staff:         migratedStaff,
        staffExpense:  migratedStaffExpense,
        cashFlowGoal:  action.payload.cashFlowGoal ?? saved.cashFlowGoal ?? 10000,
        properties:    migratedProperties,
        // Migrate reporting: fill missing fields with defaults so older saves
        // that predate this system still load cleanly.
        reporting:     migrateReporting(saved.reporting),
        // Leaderboard: assign a runId to pre-leaderboard saves so they have a
        // stable identity; carry the existing leaderboardProfile if present.
        runId:              saved.runId || generateRunId(),
        leaderboardProfile: saved.leaderboardProfile ?? null,
        gameStarted:   true,
      }
    }

    case 'DISMISS_MILESTONE': {
      const hasCritical = state.properties.some(p =>
        (p.activeEvents || []).some(e => e.priority === 'Critical')
      )
      return { ...state, activeMilestone: null, isPaused: hasCritical, isModalOpen: hasCritical }
    }

    case 'DISMISS_WIN': {
      const hasCritical = state.properties.some(p =>
        (p.activeEvents || []).some(e => e.priority === 'Critical')
      )
      return { ...state, isPaused: hasCritical, isModalOpen: hasCritical }
    }

    case 'TOGGLE_TRIVIA':
      return { ...state, triviaEnabled: !state.triviaEnabled }

    case 'MARK_TUTORIAL_SEEN':
      return { ...state, tutorialSeen: true }

    case 'SET_LEADERBOARD_PROFILE':
      // Replaces the whole leaderboardProfile object. The leaderboard sync
      // layer owns this object and passes a fully-formed replacement.
      return { ...state, leaderboardProfile: action.payload.profile }

    case 'SUBMIT_REPORT_REQUEST': {
      const { playerInfo } = action.payload || {}
      if (!playerInfo) return state
      // Log to console so we can validate the payload shape before email
      // delivery is wired up.
      const nextReporting = saveReportRequest(state, playerInfo)
      const latest = nextReporting.reportRequests[nextReporting.reportRequests.length - 1]
      // eslint-disable-next-line no-console
      console.log('[Reporting] Report request saved:', latest)
      return { ...state, reporting: nextReporting }
    }

    default:
      return state
  }
}

export const GameContext = createContext(null)

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(gameReducer, INITIAL_STATE)
  return React.createElement(
    GameContext.Provider,
    { value: { state, dispatch } },
    children
  )
}

export function useGame() {
  const context = useContext(GameContext)
  if (!context) throw new Error('useGame must be used within a GameProvider')
  return context
}
