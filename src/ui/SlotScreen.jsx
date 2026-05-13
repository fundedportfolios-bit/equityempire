import { useState } from 'react'
import { googleLogout } from '@react-oauth/google'
import { getAllSlots, deleteSlot, SLOT_COUNT } from '../auth/saveSlots.js'
import { DIFFICULTY_SETTINGS } from '../data/difficultySettings.js'
import { formatShort } from '../utils/formatters.js'
import { formatMonthLabel } from '../core/timeSystem.js'

function SlotCard({ slotIndex, data, onNewGame, onContinue, onDelete }) {
  const [pickingDifficulty, setPickingDifficulty] = useState(false)
  const [confirmDelete, setConfirmDelete]         = useState(false)

  if (data) {
    const { state, savedAt } = data
    const savedDate  = new Date(savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

export default function SlotScreen({ user, onSelectSlot, onLogout }) {
  const [slots, setSlots] = useState(() => getAllSlots(user.id))

  function handleDelete(i) {
    deleteSlot(user.id, i)
    setSlots(getAllSlots(user.id))
  }

  function handleLogout() {
    try { googleLogout() } catch {}
    onLogout()
  }

  return (
    <div className="slot-screen">
      <div className="slot-screen-header">
        <h1 className="slot-title">Equity Empire</h1>
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

      <h2 className="slot-choose-label">Choose a Save Slot</h2>

      <div className="slot-cards">
        {slots.map((data, i) => (
          <SlotCard
            key={i}
            slotIndex={i}
            data={data}
            onNewGame={(difficulty) => onSelectSlot({ slotIndex: i, isNew: true, difficulty })}
            onContinue={() => onSelectSlot({ slotIndex: i, isNew: false })}
            onDelete={() => handleDelete(i)}
          />
        ))}
      </div>
    </div>
  )
}
