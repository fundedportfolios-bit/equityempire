import { useState, useEffect }                                from 'react'
import { signOut }                                           from 'firebase/auth'
import { auth }                                              from '../firebase/config.js'
import { getAllSlotsFromFirestore, deleteSlotFromFirestore, saveSlotToFirestore } from '../firebase/firestoreService.js'
import { getAllSlots, deleteSlot, SLOT_COUNT, getUserGoal, setUserGoal } from '../auth/saveSlots.js'
import { DIFFICULTY_SETTINGS }                               from '../data/difficultySettings.js'
import { formatShort }                                       from '../utils/formatters.js'
import { formatMonthLabel }                                  from '../core/timeSystem.js'
import { generateRunId }                                     from '../core/gameState.js'
import { syncSlot, removeRunEntries }                        from '../systems/leaderboardSystem.js'
import LeaderboardPreview                                    from './LeaderboardPreview.jsx'
import LeaderboardScreen                                     from './LeaderboardScreen.jsx'
import LeaderboardSignupModal                                from './LeaderboardSignupModal.jsx'

const GOAL_OPTIONS = [5000, ...Array.from({ length: 23 }, (_, i) => 6000 + i * 2000)]
const isCloudUser  = (user) => user?.id && user.id !== 'guest'
const PMMS_CACHE   = 'equity_empire_pmms'
const FALLBACK_APR = 0.0678

// Read today's APR from the same cache used by useMarketRate, so the slot
// screen always reflects whatever the in-game system would.
function readCachedApr() {
  try {
    const cached = JSON.parse(localStorage.getItem(PMMS_CACHE) || 'null')
    if (cached && typeof cached.rate === 'number') return cached.rate
  } catch {}
  return FALLBACK_APR
}

// ─── SlotCard ─────────────────────────────────────────────
function SlotCard({ slotIndex, data, defaultGoal, canJoinLeaderboard, onNewGame, onContinue, onDelete, onJoinLeaderboard }) {
  const [pickingDifficulty, setPickingDifficulty] = useState(false)
  const [confirmDelete,     setConfirmDelete]     = useState(false)
  // Initial goal for the picker: saved game's existing goal if any, else default.
  const initialGoal = (data?.state?.cashFlowGoal) || defaultGoal
  const [pendingGoal, setPendingGoal] = useState(initialGoal)

  if (data) {
    const { state, savedAt, updatedAt } = data
    const displayDate = updatedAt ?? savedAt
    const savedDate   = displayDate
      ? new Date(displayDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '—'
    const monthLabel    = formatMonthLabel(state.currentMonth ?? 1).replace(' — ', ' ')
    const propCount     = state.properties?.length ?? 0
    const onLeaderboard = !!state.leaderboardProfile?.leaderboardEnabled

    return (
      <div className="slot-card slot-card--filled">
        <div className="slot-card-label">Slot {slotIndex + 1}</div>
        <div className="slot-card-month">{monthLabel}</div>

        <div className="slot-stats">
          <div className="slot-stat">
            <span className="slot-stat-label">Portfolio</span>
            <span className="slot-stat-value">{formatShort(state.portfolioValue ?? 0)}</span>
          </div>
          <div className="slot-stat">
            <span className="slot-stat-label">Cash</span>
            <span className="slot-stat-value">{formatShort(state.cash ?? 0)}</span>
          </div>
          <div className="slot-stat">
            <span className="slot-stat-label">Properties</span>
            <span className="slot-stat-value">{propCount}</span>
          </div>
          <div className="slot-stat">
            <span className="slot-stat-label">Difficulty</span>
            <span className="slot-stat-value" style={{ textTransform: 'capitalize' }}>{state.difficulty ?? '—'}</span>
          </div>
        </div>

        {/* Editable cash-flow goal for this slot — the value chosen here is
            applied to the in-progress game on Continue. */}
        <div className="slot-card-goal-row">
          <label className="slot-card-goal-label" htmlFor={`slot-goal-${slotIndex}`}>Cash Flow Goal</label>
          <select
            id={`slot-goal-${slotIndex}`}
            className="slot-card-goal-select"
            value={pendingGoal}
            onChange={(e) => setPendingGoal(parseInt(e.target.value, 10))}
          >
            {GOAL_OPTIONS.map(v => (
              <option key={v} value={v}>${v.toLocaleString()}/mo</option>
            ))}
          </select>
        </div>

        {/* Per-slot leaderboard opt-in. Guests see no Join button. */}
        {onLeaderboard ? (
          <div className="slot-lb-row">
            <span className="slot-lb-badge">🏆 On Leaderboard</span>
          </div>
        ) : canJoinLeaderboard ? (
          <div className="slot-lb-row">
            <button className="slot-lb-join-btn" onClick={() => onJoinLeaderboard(slotIndex)}>
              🏆 Join Leaderboard
            </button>
          </div>
        ) : null}

        <p className="slot-saved-at">Last saved {savedDate}</p>

        <div className="slot-actions">
          <button className="btn btn-primary slot-continue-btn" onClick={() => onContinue(pendingGoal)}>
            Continue →
          </button>
          {confirmDelete ? (
            <div className="slot-delete-confirm">
              <span>
                {onLeaderboard
                  ? 'This save is connected to the leaderboard. Deleting it will also remove this run from the leaderboard, including any Fastest to $1B, Fastest to $10B, or Biggest Empire Ever entries from this save. Other players may move up in the rankings. Are you sure?'
                  : 'Delete this save?'}
              </span>
              <button className="btn btn-danger btn-sm" onClick={onDelete}>Yes, delete</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm slot-delete-btn" onClick={() => setConfirmDelete(true)}>
              🗑 Delete
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="slot-card slot-card--empty">
      <div className="slot-card-label">Slot {slotIndex + 1}</div>
      <div className="slot-card-empty-text">Empty</div>

      <div className="slot-card-goal-row">
        <label className="slot-card-goal-label" htmlFor={`slot-goal-${slotIndex}`}>Cash Flow Goal</label>
        <select
          id={`slot-goal-${slotIndex}`}
          className="slot-card-goal-select"
          value={pendingGoal}
          onChange={(e) => setPendingGoal(parseInt(e.target.value, 10))}
        >
          {GOAL_OPTIONS.map(v => (
            <option key={v} value={v}>${v.toLocaleString()}/mo</option>
          ))}
        </select>
      </div>

      {pickingDifficulty ? (
        <div className="slot-difficulty-picker">
          <p className="slot-difficulty-prompt">Choose difficulty</p>
          {Object.entries(DIFFICULTY_SETTINGS).map(([key, s]) => (
            <button
              key={key}
              className={`slot-difficulty-btn slot-diff-${key}`}
              onClick={() => onNewGame(key, pendingGoal)}
            >
              <span className="slot-diff-label">{s.label}</span>
              <span className="slot-diff-cash">${s.startingCash.toLocaleString()} start</span>
            </button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setPickingDifficulty(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn btn-primary slot-new-btn" onClick={() => setPickingDifficulty(true)}>
          + New Game
        </button>
      )}
    </div>
  )
}

// ─── SlotScreen ───────────────────────────────────────────
export default function SlotScreen({ user, onSelectSlot, onLogout }) {
  const cloud = isCloudUser(user)

  const [slots,   setSlots]   = useState(() => cloud ? null : getAllSlots(user.id))
  const [loading, setLoading] = useState(cloud)
  const [apr]                 = useState(readCachedApr)

  // Leaderboard UI state.
  const [lbScreenOpen,   setLbScreenOpen]   = useState(false)
  const [joiningSlot,    setJoiningSlot]    = useState(null)  // slot index mid-join, or null
  const [pendingNewGame, setPendingNewGame] = useState(null)  // { slotIndex, difficulty, goal } mid new-game signup

  // Default goal saved per user — used as the starting selection in each
  // empty slot card. Persists last-used goal so the dropdown isn't reset.
  const [defaultGoal, setDefaultGoal] = useState(() => getUserGoal(user.id))

  function persistDefaultGoal(g) {
    setDefaultGoal(g)
    setUserGoal(user.id, g)
  }

  useEffect(() => {
    if (!cloud) return
    console.log('[SlotScreen] Loading cloud slots for uid:', user.id)
    getAllSlotsFromFirestore(user.id)
      .then(s => {
        console.log('[SlotScreen] Cloud slots loaded:', s.map((d, i) => d ? `slot ${i}: month ${d.state?.currentMonth}` : `slot ${i}: empty`))
        setSlots(s)
        setLoading(false)
      })
      .catch(e => {
        console.error('[SlotScreen] Failed to load cloud slots:', e)
        setSlots(Array(SLOT_COUNT).fill(null))
        setLoading(false)
      })
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDelete(i) {
    const slotData = slots?.[i]
    const onLb     = !!slotData?.state?.leaderboardProfile?.leaderboardEnabled
    const runId    = slotData?.state?.runId
    if (cloud) {
      try {
        await deleteSlotFromFirestore(user.id, i)
        // Remove this run's leaderboard entries (only this run — other slots
        // from the same user are untouched). Username reservation is
        // user-level and intentionally kept.
        if (onLb && runId) await removeRunEntries(runId)
        const updated = await getAllSlotsFromFirestore(user.id)
        setSlots(updated)
      } catch (e) {
        console.error('[SlotScreen] Cloud delete failed:', e)
        alert(`Cloud delete failed: ${e.message}\n\nCheck the console for details.`)
      }
    } else {
      deleteSlot(user.id, i)
      setSlots(getAllSlots(user.id))
    }
  }

  // Confirmed leaderboard signup for a save slot (cloud users only). Writes
  // the profile into the slot's saved state, backfills leaderboard entries,
  // and persists. The run is NOT loaded into the game for this.
  async function handleSlotJoinConfirm(slotIndex, profile) {
    const slotData = slots?.[slotIndex]
    if (!slotData?.state) { setJoiningSlot(null); return }
    const baseState = { ...slotData.state, leaderboardProfile: profile }
    if (!baseState.runId) baseState.runId = generateRunId()
    try {
      const res = await syncSlot(baseState, { uid: user.id, saveSlotIndex: slotIndex }, { force: true, backfilled: true })
      const finalState = { ...baseState, leaderboardProfile: res.updatedProfile || profile }
      await saveSlotToFirestore(user.id, slotIndex, finalState)
      const updated = await getAllSlotsFromFirestore(user.id)
      setSlots(updated)
    } catch (e) {
      console.error('[SlotScreen] leaderboard join failed:', e)
      alert(`Could not join the leaderboard: ${e.message}`)
    }
    setJoiningSlot(null)
  }

  // New-game leaderboard prompt. A logged-in player who picks a difficulty is
  // offered leaderboard signup before the game starts. Either choice starts
  // the game: joining carries a fresh profile into NEW_GAME, skipping carries
  // null — they can still join later from this slot screen.
  function startPendingNewGame(profile) {
    const png = pendingNewGame
    setPendingNewGame(null)
    if (!png) return
    onSelectSlot({
      slotIndex:          png.slotIndex,
      isNew:              true,
      difficulty:         png.difficulty,
      cashFlowGoal:       png.goal,
      leaderboardProfile: profile || null,
    })
  }

  async function handleLogout() {
    if (cloud) {
      try { await signOut(auth) } catch {}
    }
    onLogout()
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <p className="loading-text">Loading saves…</p>
      </div>
    )
  }

  return (
    <div className="slot-screen">
      <div className="slot-screen-header">
        <div className="slot-header-top">
          <h1 className="slot-title">Equity Empire<span className="game-version">v4.0</span></h1>
          <div className="slot-user-row">
            {user.picture && (
              <img src={user.picture} className="slot-avatar" alt="" referrerPolicy="no-referrer" />
            )}
            <span className="slot-user-name">{user.name}</span>
            <button className="btn btn-ghost btn-sm slot-logout-btn" onClick={handleLogout}>
              Sign Out
            </button>
          </div>
        </div>
        <div className="slot-apr-row" title="30-year fixed mortgage rate (Freddie Mac PMMS)">
          <span className="slot-apr-label">Today's APR</span>
          <span className="slot-apr-value">{(apr * 100).toFixed(2)}%</span>
        </div>
        <p className="slot-apr-note">Today's investments will lock in this rate!</p>

        <LeaderboardPreview onView={() => setLbScreenOpen(true)} />
      </div>

      <h2 className="slot-choose-label">Choose a Save Slot</h2>

      {cloud && (
        <p className="slot-cloud-badge">☁ Saves sync across all your devices</p>
      )}

      <div className="slot-cards">
        {(slots || Array(SLOT_COUNT).fill(null)).map((data, i) => (
          <SlotCard
            key={i}
            slotIndex={i}
            data={data}
            defaultGoal={defaultGoal}
            canJoinLeaderboard={cloud}
            onNewGame={(difficulty, goal) => {
              persistDefaultGoal(goal)
              if (cloud) {
                // Logged-in: offer leaderboard signup before the game starts.
                setPendingNewGame({ slotIndex: i, difficulty, goal })
              } else {
                onSelectSlot({ slotIndex: i, isNew: true, difficulty, cashFlowGoal: goal })
              }
            }}
            onContinue={(goal) => onSelectSlot({ slotIndex: i, isNew: false, cashFlowGoal: goal })}
            onDelete={() => handleDelete(i)}
            onJoinLeaderboard={(idx) => setJoiningSlot(idx)}
          />
        ))}
      </div>

      {lbScreenOpen && (
        <LeaderboardScreen onClose={() => setLbScreenOpen(false)} />
      )}
      {joiningSlot != null && (
        <LeaderboardSignupModal
          uid={user.id}
          onConfirm={(profile) => handleSlotJoinConfirm(joiningSlot, profile)}
          onClose={() => setJoiningSlot(null)}
        />
      )}
      {pendingNewGame && (
        <LeaderboardSignupModal
          uid={user.id}
          cancelLabel="Skip for Now"
          onConfirm={(profile) => startPendingNewGame(profile)}
          onClose={() => startPendingNewGame(null)}
        />
      )}
    </div>
  )
}
