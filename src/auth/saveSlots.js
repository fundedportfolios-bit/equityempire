const USER_KEY  = 'equity_empire_user'
const slotKey   = (userId, i) => `equity_empire_slot_${userId}_${i}`
export const SLOT_COUNT = 3

// ─── User ──────────────────────────────────────────────────────
export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)) } catch { return null }
}
export function storeUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export function clearStoredUser() {
  localStorage.removeItem(USER_KEY)
}

// ─── Slots ─────────────────────────────────────────────────────
export function getSlot(userId, slotIndex) {
  try { return JSON.parse(localStorage.getItem(slotKey(userId, slotIndex))) } catch { return null }
}
export function setSlot(userId, slotIndex, state) {
  localStorage.setItem(slotKey(userId, slotIndex), JSON.stringify({
    state,
    savedAt: new Date().toISOString(),
  }))
}
export function deleteSlot(userId, slotIndex) {
  localStorage.removeItem(slotKey(userId, slotIndex))
}
export function getAllSlots(userId) {
  return Array.from({ length: SLOT_COUNT }, (_, i) => getSlot(userId, i))
}

// ─── Per-user settings ─────────────────────────────────────────
const goalKey = (userId) => `equity_empire_goal_${userId}`
export function getUserGoal(userId) {
  try { const v = localStorage.getItem(goalKey(userId)); return v ? parseInt(v, 10) : 10000 }
  catch { return 10000 }
}
export function setUserGoal(userId, goal) {
  localStorage.setItem(goalKey(userId), String(goal))
}

// ─── JWT decode (no verification — we trust Google's token) ────
export function decodeGoogleJwt(token) {
  try {
    const base64Url = token.split('.')[1]
    const base64    = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64))
  } catch {
    return null
  }
}
