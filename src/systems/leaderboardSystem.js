// ═══════════════════════════════════════════════════════════════
// LEADERBOARD SYSTEM
//
// Opt-in, per-save-slot leaderboard. Three boards:
//   fastest_1b      — fewest months to a $1B portfolio   (top 10)
//   fastest_10b     — fewest months to a $10B portfolio  (top 10)
//   biggest_empire  — highest portfolio value ever        (top 25)
//
// Identity model:
//   • owner   = Firebase uid (signed-in users only — security only)
//   • run     = state.runId (stable per game run; survives save/load)
//   • a leaderboard entry is keyed by runId, so one user's multiple
//     save slots each get independent entries.
//
// Firestore layout (per-board sub-collections so a single-field
// orderBy is enough — no composite indexes to configure):
//   leaderboard/{boardType}/entries/{runId}
//   leaderboardUsernames/{usernameLower}
//
// All Firestore writes happen here or in the sync hook — never in a
// reducer (reducers stay pure). Anti-cheat is intentionally light for
// v1; a Cloud Function could validate scores server-side later.
// ═══════════════════════════════════════════════════════════════

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, orderBy, limit,
} from 'firebase/firestore'
import { db } from '../firebase/config.js'
import { sanitizeForFirestore } from '../firebase/firestoreService.js'
import {
  GAME_VERSION, SCORE_VERSION, BOARD_TYPES, BOARD_LIMITS,
  THRESHOLD_1B, THRESHOLD_10B,
} from '../data/gameVersion.js'

// ─── Username validation + reservation ────────────────────────
export function validateUsername(raw) {
  const trimmed = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (trimmed.length < 3)  return { ok: false, error: 'Username must be at least 3 characters.' }
  if (trimmed.length > 20) return { ok: false, error: 'Username must be 20 characters or fewer.' }
  if (!/^[A-Za-z0-9 _]+$/.test(trimmed)) {
    return { ok: false, error: 'Use only letters, numbers, spaces, and underscores.' }
  }
  return { ok: true, value: trimmed, usernameLower: trimmed.toLowerCase() }
}

// Available if the name is unclaimed OR already owned by this same uid.
export async function checkUsernameAvailability(usernameLower, uid) {
  try {
    const snap = await getDoc(doc(db, 'leaderboardUsernames', usernameLower))
    if (!snap.exists()) return { available: true, ownedBySelf: false }
    const data = snap.data()
    if (data.ownerUserId === uid) return { available: true, ownedBySelf: true, username: data.username }
    return { available: false, ownedBySelf: false }
  } catch (e) {
    console.warn('[leaderboard] username availability check failed:', e?.message)
    return { available: false, ownedBySelf: false, error: 'Could not check availability.' }
  }
}

// Reserve (or re-confirm) a username for this uid. Security rules block
// overwriting a name owned by a different user.
export async function reserveUsername(usernameLower, username, uid) {
  await setDoc(
    doc(db, 'leaderboardUsernames', usernameLower),
    { ownerUserId: uid, username, createdAt: new Date().toISOString() },
    { merge: true },
  )
}

// All usernames this uid already reserved (powers "use existing username").
export async function getUserExistingUsernames(uid) {
  try {
    const q = query(collection(db, 'leaderboardUsernames'), where('ownerUserId', '==', uid))
    const snap = await getDocs(q)
    return snap.docs.map(d => d.data().username).filter(Boolean)
  } catch (e) {
    console.warn('[leaderboard] existing-usernames lookup failed:', e?.message)
    return []
  }
}

// ─── Fresh profile (stored in save state on join) ─────────────
export function makeFreshProfile({ username, usernameLower }) {
  return {
    leaderboardEnabled:      true,
    publicUsername:          username,
    usernameLower,
    joinedLeaderboardAt:     new Date().toISOString(),
    lastNotifiedRankByBoard: { fastest_1b: null, fastest_10b: null, biggest_empire: null },
    lastSubmitted:           { fastest_1b: null, fastest_10b: null, biggest_empire: null },
  }
}

// ─── Score derivation helpers ─────────────────────────────────
function netCashFlow(state) {
  return (state.monthlyIncome || 0) - (state.monthlyExpenses || 0) - (state.staffExpense || 0)
}
function highestPortfolio(state) {
  return Math.max(state.reporting?.currentRecords?.highestPortfolioValue || 0, state.portfolioValue || 0)
}

// First month the portfolio reached `threshold`. Prefers the monthly-snapshot
// trail; falls back to the reporting milestone map; final fallback is the
// current month flagged backfilled (reached but not precisely recorded).
function computeMonthReached(state, threshold) {
  const snaps = state.reporting?.monthlySnapshots || []
  for (const s of snaps) {
    if ((s.portfolioValue || 0) >= threshold) return { month: s.month, backfilled: false }
  }
  const mm = state.reporting?.milestones?.portfolioValueMilestones || {}
  if (mm[threshold] != null) return { month: mm[threshold], backfilled: false }
  return { month: state.currentMonth || 1, backfilled: true }
}

// Assemble a leaderboard entry. ctx = { uid, saveSlotIndex }.
function buildEntry(boardType, state, ctx, extra = {}) {
  const profile = state.leaderboardProfile || {}
  const now     = new Date().toISOString()
  const pv      = state.portfolioValue || 0
  return sanitizeForFirestore({
    boardType,
    userId:               ctx.uid,
    saveSlotIndex:         ctx.saveSlotIndex ?? null,
    runId:                state.runId,
    publicUsername:        profile.publicUsername || '',
    usernameLower:         profile.usernameLower || '',
    monthReached:          extra.monthReached ?? null,
    monthsPlayed:          Math.max(0, (state.currentMonth || 1) - 1),
    portfolioValue:        pv,
    highestPortfolioValue: highestPortfolio(state),
    netMonthlyCashFlow:    netCashFlow(state),
    equity:                pv - (state.totalDebt || 0),
    debt:                  state.totalDebt || 0,
    cash:                  state.cash || 0,
    propertiesOwned:       state.properties?.length || 0,
    refinancesCompleted:   state.reporting?.totals?.refinancesCompleted || 0,
    totalCashOutFromRefis: state.reporting?.totals?.totalCashOutFromRefinances || 0,
    planetsOwned:          (state.properties || []).filter(p => p.templateId === 'planet').length,
    difficulty:            state.difficulty || null,
    scoreVersion:          SCORE_VERSION,
    gameVersion:           GAME_VERSION,
    submittedAt:           now,
    updatedAt:             now,
    backfilled:            !!extra.backfilled,
  })
}

function entryRef(boardType, runId) {
  return doc(db, 'leaderboard', boardType, 'entries', runId)
}

async function submitEntry(entry) {
  await setDoc(entryRef(entry.boardType, entry.runId), entry, { merge: true })
}

// ─── Ranking comparators (client-side, after Firestore orderBy) ──
function compareFastest(a, b) {
  const am = a.monthReached ?? Infinity, bm = b.monthReached ?? Infinity
  if (am !== bm) return am - bm
  if ((b.netMonthlyCashFlow || 0) !== (a.netMonthlyCashFlow || 0)) return (b.netMonthlyCashFlow || 0) - (a.netMonthlyCashFlow || 0)
  if ((b.equity || 0) !== (a.equity || 0)) return (b.equity || 0) - (a.equity || 0)
  return (b.portfolioValue || 0) - (a.portfolioValue || 0)
}
function compareBiggest(a, b) {
  if ((b.highestPortfolioValue || 0) !== (a.highestPortfolioValue || 0)) return (b.highestPortfolioValue || 0) - (a.highestPortfolioValue || 0)
  if ((b.netMonthlyCashFlow || 0) !== (a.netMonthlyCashFlow || 0)) return (b.netMonthlyCashFlow || 0) - (a.netMonthlyCashFlow || 0)
  if ((b.equity || 0) !== (a.equity || 0)) return (b.equity || 0) - (a.equity || 0)
  return (a.monthsPlayed || 0) - (b.monthsPlayed || 0)
}

// ─── Reads ────────────────────────────────────────────────────
// Fetch + rank one board. Over-fetches a little so the client-side
// tie-breaker sort is accurate, then slices to `displayLimit`.
export async function fetchBoard(boardType, displayLimit) {
  const fetchN = Math.max(displayLimit + 30, 60)
  const col = collection(db, 'leaderboard', boardType, 'entries')
  const q = boardType === BOARD_TYPES.BIGGEST_EMPIRE
    ? query(col, orderBy('highestPortfolioValue', 'desc'), limit(fetchN))
    : query(col, orderBy('monthReached', 'asc'), limit(fetchN))
  const snap = await getDocs(q)
  const rows = snap.docs.map(d => d.data())
  rows.sort(boardType === BOARD_TYPES.BIGGEST_EMPIRE ? compareBiggest : compareFastest)
  return rows.slice(0, displayLimit)
}

// Rank-1 entry of each board, for the home-screen preview.
export async function fetchLeaders() {
  const [a, b, c] = await Promise.all([
    fetchBoard(BOARD_TYPES.FASTEST_1B, 1).catch(() => []),
    fetchBoard(BOARD_TYPES.FASTEST_10B, 1).catch(() => []),
    fetchBoard(BOARD_TYPES.BIGGEST_EMPIRE, 1).catch(() => []),
  ])
  return { fastest_1b: a[0] || null, fastest_10b: b[0] || null, biggest_empire: c[0] || null }
}

// 1-based rank of a run on a board, or null if not present.
export async function getRankForRun(boardType, runId) {
  const rows = await fetchBoard(boardType, Math.max(BOARD_LIMITS[boardType] || 25, 50))
  const idx = rows.findIndex(r => r.runId === runId)
  return idx >= 0 ? idx + 1 : null
}

// Delete all 3 entries for a run (called when a leaderboard save slot is deleted).
export async function removeRunEntries(runId) {
  if (!runId) return
  await Promise.all(
    Object.values(BOARD_TYPES).map(b => deleteDoc(entryRef(b, runId)).catch(() => {})),
  )
}

// ─── Auto-tracking sync ───────────────────────────────────────
// Decides which board entries need a write for the current run, writes
// them, and returns an updated profile (with refreshed `lastSubmitted`)
// plus the list of boards that changed. Pure-ish: only Firestore writes,
// no game-state mutation.
//
//   ctx  = { uid, saveSlotIndex }
//   opts = { force }  — force re-submits biggest_empire (used on join/exit)
export async function syncSlot(state, ctx, opts = {}) {
  const profile = state.leaderboardProfile
  if (!profile?.leaderboardEnabled || !state.runId || !ctx?.uid) {
    return { updatedProfile: profile, boardsChanged: [], wrote: false }
  }
  const force     = !!opts.force
  const portfolio = state.portfolioValue || 0
  const highest   = highestPortfolio(state)
  const month     = state.currentMonth || 1
  const boardsChanged = []
  const nextProfile = {
    ...profile,
    lastSubmitted: { ...(profile.lastSubmitted || {}) },
  }

  // fastest_1b — write on first reach, then only if monthReached improves.
  if (portfolio >= THRESHOLD_1B) {
    const { month: mr, backfilled } = computeMonthReached(state, THRESHOLD_1B)
    const prev = profile.lastSubmitted?.fastest_1b
    if (prev == null || mr < prev) {
      await submitEntry(buildEntry(BOARD_TYPES.FASTEST_1B, state, ctx, { monthReached: mr, backfilled }))
      nextProfile.lastSubmitted.fastest_1b = mr
      boardsChanged.push(BOARD_TYPES.FASTEST_1B)
    }
  }

  // fastest_10b — same rule against the $10B threshold.
  if (portfolio >= THRESHOLD_10B) {
    const { month: mr, backfilled } = computeMonthReached(state, THRESHOLD_10B)
    const prev = profile.lastSubmitted?.fastest_10b
    if (prev == null || mr < prev) {
      await submitEntry(buildEntry(BOARD_TYPES.FASTEST_10B, state, ctx, { monthReached: mr, backfilled }))
      nextProfile.lastSubmitted.fastest_10b = mr
      boardsChanged.push(BOARD_TYPES.FASTEST_10B)
    }
  }

  // biggest_empire — throttled: portfolio rises almost every month, so an
  // un-throttled "new high" rule would write every tick. Write only when
  // forced (join/exit), or the high grew >=10%, or >=12 in-game months
  // passed since the last submit.
  {
    const prev      = profile.lastSubmitted?.biggest_empire
    const isNewHigh = !prev || highest > (prev.highestPortfolioValue || 0)
    if (highest > 0 && (force || isNewHigh)) {
      const passesThrottle = force || !prev
        || highest >= (prev.highestPortfolioValue || 0) * 1.10
        || (month - (prev.month || 0)) >= 12
      if (passesThrottle) {
        await submitEntry(buildEntry(BOARD_TYPES.BIGGEST_EMPIRE, state, ctx, { backfilled: !!opts.backfilled }))
        nextProfile.lastSubmitted.biggest_empire = { highestPortfolioValue: highest, month }
        boardsChanged.push(BOARD_TYPES.BIGGEST_EMPIRE)
      }
    }
  }

  return { updatedProfile: nextProfile, boardsChanged, wrote: boardsChanged.length > 0 }
}
