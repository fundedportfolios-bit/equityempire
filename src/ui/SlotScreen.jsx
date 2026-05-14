import { useState, useEffect }                                from 'react'
import { signOut }                                           from 'firebase/auth'
import { auth }                                              from '../firebase/config.js'
import { getAllSlotsFromFirestore, deleteSlotFromFirestore }  from '../firebase/firestoreService.js'
import { getAllSlots, deleteSlot, SLOT_COUNT, getUserGoal, setUserGoal } from '../auth/saveSlots.js'
import { DIFFICULTY_SETTINGS }                               from '../data/difficultySettings.js'
import { formatShort }                                       from '../utils/formatters.js'
import { formatMonthLabel }                                  from '../core/timeSystem.js'

const GOAL_OPTIONS = [5000, ...Array.from({ length: 23 }, (_, i) => 6000 + i * 2000)]
const isCloudUser  = (user) => user?.id && user.id !== 'guest'

// ─── SlotCard ─────────────────────────────────────────────
function SlotCard({ slotIndex, data, onNewGame, onContinue, onDelete }) {
  const [pickingDifficulty, setPickingDifficulty] = useState(false)
  const [confirmDelete,     setConfirmDelete]     = useState(false)

  if (data) {
    const { state, savedAt, updatedAt } = data
    const displayDate = updatedAt ?? savedAt
    const savedDate   = displayDate
      ? new Date(displayDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '—'
    const monthLabel = formatMonthLabel(state.currentMonth ?? 1).replace(' — ', ' ')
    const propCount  = state.properties?.length ?? 0

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

        <p className="slot-saved-at">Last saved {savedDate}</p>

        <div className="slot-actions">
          <button className="btn btn-primary slot-continue-btn" onClick={onContinue}>
            Continue →
          </button>
          {confirmDelete ? (
            <div className="slot-delete-confirm">
              <span>Delete this save?</span>
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

      {pickingDifficulty ? (
        <div className="slot-difficulty-picker">
          <p className="slot-difficulty-prompt">Choose difficulty</p>
          {Object.entries(DIFFICULTY_SETTINGS).map(([key, s]) => (
            <button
              key={key}
              className={`slot-difficulty-btn slot-diff-${key}`}
              onClick={() => onNewGame(key)}
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

  // Slots — null = still loading (cloud users only)
  const [slots,   setSlots]   = useState(() => cloud ? null : getAllSlots(user.id))
  const [loading, setLoading] = useState(cloud)
  const [goal,    setGoal]    = useState(() => getUserGoal(user.id))

  // Load cloud saves on mount
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

  function handleGoalChange(e) {
    const val = parseInt(e.target.value, 10)
    setGoal(val)
    setUserGoal(user.id, val)
  }

  async function handleDelete(i) {
    if (cloud) {
      try {
        await deleteSlotFromFirestore(user.id, i)
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
        <div className="slot-goal-row">
          <label className="slot-goal-label" htmlFor="cash-flow-goal">Monthly Cash Flow Goal</label>
          <select
            id="cash-flow-goal"
            className="slot-goal-select"
            value={goal}
            onChange={handleGoalChange}
          >
            {GOAL_OPTIONS.map(v => (
              <option key={v} value={v}>${v.toLocaleString()}/mo</option>
            ))}
          </select>
        </div>
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
            onNewGame={(difficulty) => onSelectSlot({ slotIndex: i, isNew: true, difficulty, cashFlowGoal: goal })}
            onContinue={() => onSelectSlot({ slotIndex: i, isNew: false, cashFlowGoal: goal })}
            onDelete={() => handleDelete(i)}
          />
        ))}
      </div>
    </div>
  )
}
