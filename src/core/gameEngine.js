
const SAVE_KEY = 'equity_empire_save'

export function startNewGame(difficulty, cashFlowGoal = 10000) {
  return { type: 'NEW_GAME', payload: { difficulty, cashFlowGoal } }
}

export function advanceMonth() {
  return { type: 'ADVANCE_MONTH' }
}

export function resolveEvent(propertyId, instanceId) {
  return { type: 'RESOLVE_EVENT', payload: { propertyId, instanceId } }
}

export function installUpgrade(propertyId, upgradeInstance) {
  return { type: 'INSTALL_UPGRADE', payload: { propertyId, upgradeInstance } }
}

export function addAlert(message, type = 'info', id = null) {
  return {
    type: 'ADD_ALERT',
    payload: {
      id: id ?? `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      message,
      type,
    },
  }
}

export function clearAlert(id) {
  return { type: 'CLEAR_ALERT', payload: { id } }
}

export function clearAllAlerts() {
  return { type: 'CLEAR_ALL_ALERTS' }
}

export function setDifficulty(difficulty) {
  return { type: 'SET_DIFFICULTY', payload: { difficulty } }
}

export function setSpeed(gameSpeed) {
  return { type: 'SET_SPEED', payload: { gameSpeed } }
}

export function setPaused(paused) {
  return { type: 'SET_PAUSED', payload: { paused } }
}

export function setModalOpen(open) {
  return { type: 'SET_MODAL_OPEN', payload: { open } }
}

export function openInvestModal() {
  return { type: 'OPEN_INVEST_MODAL' }
}

export function saveGame(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function hasSave() {
  return localStorage.getItem(SAVE_KEY) !== null
}

export function deleteSave() {
  localStorage.removeItem(SAVE_KEY)
}

export function buyProperty(option) {
  return { type: 'BUY_PROPERTY', payload: { option } }
}

export function sellProperty(propertyId, netProceeds) {
  return { type: 'SELL_PROPERTY', payload: { propertyId, netProceeds } }
}

export function refinanceProperty(propertyId, refiData) {
  return { type: 'REFINANCE_PROPERTY', payload: { propertyId, ...refiData } }
}

export function hireStaff() {
  return { type: 'HIRE_STAFF' }
}

export function closeTrivia(reward, dismissed = false) {
  return { type: 'CLOSE_TRIVIA', payload: { reward, dismissed } }
}

export function setMarketRate(rate) {
  return { type: 'SET_MARKET_RATE', payload: { rate } }
}

export function toggleTrivia() {
  return { type: 'TOGGLE_TRIVIA' }
}

export function dismissMilestone() {
  return { type: 'DISMISS_MILESTONE' }
}

// Placeholder — will grow as win/loss conditions are defined
export function checkWinLoss(state) {
  if (state.cash < 0 && state.monthlyIncome === 0) return 'loss'
  return null
}
