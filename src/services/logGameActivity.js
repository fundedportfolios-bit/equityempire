// Client-side helper for /api/logGameActivity.
//
// Responsibilities:
//   • Maintain a stable anonymous guestId in localStorage.
//   • Maintain a per-tab sessionId.
//   • Attach a Firebase ID token (Authorization: Bearer …) when the user is
//     logged in — the backend verifies it server-side via firebase-admin
//     and records the resulting uid.
//   • Build sanitized payloads (only safe fields are sent).
//   • Fire-and-forget. Activity logging MUST NEVER break gameplay — every
//     failure path swallows the error and at most console.warns.

import { auth } from '../firebase/config.js'

const GUEST_KEY   = 'equity_empire_guest_id'
const SESSION_KEY = 'equity_empire_session_id'   // sessionStorage

function makeId() {
  // 22-char URL-safe random ID (~128 bits).
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {}
  return 'id-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
}

export function getGuestId() {
  try {
    let id = localStorage.getItem(GUEST_KEY)
    if (!id) {
      id = makeId()
      localStorage.setItem(GUEST_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

export function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = makeId()
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return makeId()
  }
}

// Derive a snapshot of relevant game stats from a state object. Only safe
// numeric fields — no raw state, no large nested objects.
export function gameSnapshotFields(state) {
  if (!state) return {}
  const netCF  = (state.monthlyIncome || 0) - (state.monthlyExpenses || 0) - (state.staffExpense || 0)
  const equity = (state.portfolioValue || 0) - (state.totalDebt || 0)
  return {
    monthlyCashFlow:  Number.isFinite(netCF) ? Math.round(netCF) : null,
    portfolioValue:   Math.round(state.portfolioValue || 0),
    totalEquity:      Math.round(equity),
    cashOnHand:       Math.round(state.cash || 0),
    propertiesOwned:  state.properties?.length || 0,
    monthsPlayed:     Math.max(0, (state.currentMonth || 1) - 1),
  }
}

async function getIdToken() {
  try {
    const u = auth?.currentUser
    if (!u) return null
    return await u.getIdToken(false)
  } catch {
    return null
  }
}

// Core: post one event. Always returns void. Errors swallowed.
export async function logActivity(eventType, opts = {}) {
  try {
    const body = {
      eventType,
      sessionId:        getSessionId(),
      guestId:          getGuestId(),
      // Optional player-supplied identifiers — backend only stores these for
      // report/support events.
      playerName:       opts.playerName  || null,
      playerEmail:      opts.playerEmail || null,
      contactPreference: opts.contactPreference || null,
      requestedSupport:  !!opts.requestedSupport,
      milestoneName:    opts.milestoneName || null,
      details:          opts.details      || null,
      // Stats snapshot.
      ...(opts.state ? gameSnapshotFields(opts.state) : {
        monthlyCashFlow:  opts.monthlyCashFlow  ?? null,
        portfolioValue:   opts.portfolioValue   ?? null,
        totalEquity:      opts.totalEquity      ?? null,
        cashOnHand:       opts.cashOnHand       ?? null,
        propertiesOwned:  opts.propertiesOwned  ?? null,
        monthsPlayed:     opts.monthsPlayed     ?? null,
      }),
    }

    const headers = { 'content-type': 'application/json' }
    const token = await getIdToken()
    if (token) headers['authorization'] = `Bearer ${token}`

    await fetch('/api/logGameActivity', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // Use keepalive so the request can survive a page navigation/unload.
      keepalive: true,
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[logActivity] swallowed:', e?.message || e)
  }
}

// ─── Snapshot throttle ────────────────────────────────────────
// game_snapshot fires at session start, report request, goal reached, and
// at most once every 5 minutes during active play. Use force: true to
// bypass the throttle (session start / report / goal).

let lastSnapshotAt = 0
const SNAPSHOT_MIN_MS = 5 * 60 * 1000

export function logSnapshot(state, { force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastSnapshotAt < SNAPSHOT_MIN_MS) return
  lastSnapshotAt = now
  logActivity('game_snapshot', { state })
}
