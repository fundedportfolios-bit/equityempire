import React, { createContext, useContext, useReducer } from 'react'
import { DIFFICULTY_SETTINGS } from '../data/difficultySettings.js'
import { calculateNetCashFlow, calculateMortgagePayment } from '../utils/financeMath.js'
import { createPropertyInstance, recalculatePortfolioTotals } from '../systems/propertySystem.js'
import { processMonthlyEvents, attachStartupActions } from '../systems/eventSystem.js'
import { processStaffResolution, calcStaffExpense } from '../systems/staffSystem.js'
import { selectTriviaQuestion } from '../systems/triviaSystem.js'
import { TRIVIA_RULES } from '../data/triviaRules.js'

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

  // Staff
  staffCount:   0,
  staffExpense: 0,

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

  // Meta
  gameStarted: false,
  gameOver: false,
  winner: false,
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

        // Monthly property value appreciation (all types)
        if (monthlyValRate > 0 && mo > 0) {
          updated = { ...updated, currentValue: Math.round(updated.currentValue * (1 + monthlyValRate)) }
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

      // Staff auto-resolution (after appreciation, before cash update)
      const preStaffTotals = recalculatePortfolioTotals(updatedProperties, newMonth)
      const { resolvedProperties, staffAlerts } = processStaffResolution(
        updatedProperties, state.staffCount || 0, preStaffTotals.portfolioValue
      )

      // Staff expense recalculated at new month (raises apply)
      const newStaffExpense = calcStaffExpense(state.staffCount || 0, newMonth)

      const netCashFlow = state.monthlyIncome - state.monthlyExpenses - newStaffExpense
      const newCash     = state.cash + netCashFlow
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
      const justWon   = !state.gameWon && newMonth > 1 && newNetCF >= (state.cashFlowGoal || 10000)

      const MILESTONES = [1000000, 5000000, 10000000, 50000000]
      const newMilestone = MILESTONES.find(m =>
        totals.portfolioValue >= m &&
        !(state.milestonesHit || []).includes(m) &&
        (state.portfolioValue || 0) < m
      ) ?? null

      return {
        ...state,
        currentMonth:          newMonth,
        cash:                  newCash,
        properties:            resolvedProperties,
        portfolioValue:        totals.portfolioValue,
        totalDebt:             totals.totalDebt,
        monthlyIncome:         totals.monthlyIncome,
        monthlyExpenses:       totals.monthlyExpenses,
        staffExpense:          newStaffExpense,
        activeTriviaQuestion:  triviaQuestion,
        lastTriviaMonth:       shouldTriggerTrivia ? newMonth : (state.lastTriviaMonth ?? 0),
        usedTriviaQuestionIds: state.usedTriviaQuestionIds ?? [],
        isModalOpen:           shouldTriggerTrivia ? true : (newMilestone ? true : state.isModalOpen),
        alerts:                allAlerts,
        isPaused:              newMilestone ? true : (shouldPause ? true : state.isPaused),
        gameWon:               justWon ? true : state.gameWon,
        activeMilestone:       newMilestone ?? state.activeMilestone,
        milestonesHit:         newMilestone ? [...(state.milestonesHit || []), newMilestone] : (state.milestonesHit || []),
      }
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
      return {
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
        return {
          ...p,
          activeEvents:  (p.activeEvents || []).filter(e => e.instanceId !== instanceId),
          currentValue:  Math.min(p.purchasePrice * 2, p.currentValue + (instance.valueImpact     || 0)),
          condition:     Math.min(100,                 (p.condition   ?? 0) + (instance.conditionImpact || 0)),
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
      return {
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
        const newRent  = p.monthlyRent  + (upgradeInstance.permanentRentBoost  || 0)
        const newValue = p.currentValue + (upgradeInstance.permanentValueBoost || 0)
        return {
          ...p,
          monthlyRent:       Math.round(newRent),
          currentValue:      Math.round(newValue),
          completedUpgrades: [...(p.completedUpgrades || []), upgradeInstance.sourceId],
        }
      })
      const totals = recalculatePortfolioTotals(updatedProperties, state.currentMonth)
      const upgradeAlert = {
        id:        `upgrade-${upgradeInstance.sourceId}-${Date.now()}`,
        message:   `Upgrade complete: ${upgradeInstance.name} — paid $${upgradeInstance.rolledCost.toLocaleString()}. Monthly income and property value updated.`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      return {
        ...state,
        cash:            state.cash - upgradeInstance.rolledCost,
        properties:      updatedProperties,
        portfolioValue:  totals.portfolioValue,
        totalDebt:       totals.totalDebt,
        monthlyIncome:   totals.monthlyIncome,
        monthlyExpenses: totals.monthlyExpenses,
        alerts:          [upgradeAlert, ...state.alerts].slice(0, 20),
      }
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
      return {
        ...state,
        cash:            state.cash + netProceeds,
        properties:      remainingProps,
        portfolioValue:  sellTotals.portfolioValue,
        totalDebt:       sellTotals.totalDebt,
        monthlyIncome:   sellTotals.monthlyIncome,
        monthlyExpenses: sellTotals.monthlyExpenses,
        alerts:          [sellAlert, ...state.alerts].slice(0, 20),
      }
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
      return {
        ...state,
        cash:            state.cash + netCash,
        properties:      refiProps,
        portfolioValue:  refiTotals.portfolioValue,
        totalDebt:       refiTotals.totalDebt,
        monthlyIncome:   refiTotals.monthlyIncome,
        monthlyExpenses: refiTotals.monthlyExpenses,
        alerts:          [refiAlert, ...state.alerts].slice(0, 20),
      }
    }

    case 'CLOSE_TRIVIA': {
      const { reward, dismissed } = action.payload
      const newAlerts = dismissed
        ? state.alerts
        : reward > 0
          ? [{ id: `kpu-reward-${Date.now()}`, message: `Knowledge Power-Up bonus: $${reward.toLocaleString()}`, type: 'success', timestamp: state.currentMonth }, ...state.alerts]
          : [{ id: `kpu-skip-${Date.now()}`,   message: 'Knowledge Power-Up answered — no bonus this time.',    type: 'info',    timestamp: state.currentMonth }, ...state.alerts]
      return {
        ...state,
        cash:                  state.cash + reward,
        activeTriviaQuestion:  null,
        usedTriviaQuestionIds: [...(state.usedTriviaQuestionIds ?? []), state.activeTriviaQuestion?.id].filter(Boolean),
        isModalOpen:           false,
        alerts:                newAlerts.slice(0, 20),
      }
    }

    case 'HIRE_STAFF': {
      const newCount   = (state.staffCount || 0) + 1
      const newExpense = calcStaffExpense(newCount, state.currentMonth)
      const alert = {
        id:        `hire-staff-${Date.now()}`,
        message:   `Staff hired. Monthly staff expense is now $${newExpense.toLocaleString()}.`,
        type:      'success',
        timestamp: state.currentMonth,
      }
      return {
        ...state,
        staffCount:   newCount,
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

    case 'SET_MARKET_RATE': {
      return { ...state, marketInterestRate: action.payload.rate }
    }

    case 'LOAD_GAME': {
      const saved = action.payload.savedState
      const migratedProperties = (saved.properties || []).map(p => {
        const piPayment = p.loanBalance > 0
          ? calculateMortgagePayment(p.loanBalance, 0.08, 360)
          : 0
        return {
          activeEvents:           [],
          completedUpgrades:      [],
          activeExpenseIncreases: [],
          monthlyDebtService:     Math.round(piPayment),
          interestRate:           0.08,
          loanTermMonths:         360,
          ...p,
        }
      })
      return {
        ...INITIAL_STATE,
        staffCount:            0,
        staffExpense:          0,
        activeTriviaQuestion:  null,
        lastTriviaMonth:       0,
        usedTriviaQuestionIds: [],
        marketInterestRate:    null,
        triviaEnabled:         true,
        ...saved,
        cashFlowGoal:  action.payload.cashFlowGoal ?? saved.cashFlowGoal ?? 10000,
        properties:    migratedProperties,
        gameStarted:   true,
      }
    }

    case 'DISMISS_MILESTONE': {
      const hasCritical = state.properties.some(p =>
        (p.activeEvents || []).some(e => e.priority === 'Critical')
      )
      return { ...state, activeMilestone: null, isPaused: hasCritical, isModalOpen: hasCritical }
    }

    case 'TOGGLE_TRIVIA':
      return { ...state, triviaEnabled: !state.triviaEnabled }

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
