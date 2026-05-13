import { useState, useEffect, useRef } from 'react'
import { useGame } from '../core/gameState.js'
import { advanceMonth, setPaused } from '../core/gameEngine.js'
import { formatMonthLabel } from '../core/timeSystem.js'

const ACTIONS = [
  { id: 'invest',    label: 'Invest',    icon: '🏠' },
  { id: 'manage',    label: 'Manage',    icon: '🔧' },
  { id: 'refinance', label: 'Refinance', icon: '💰' },
  { id: 'staff',     label: 'Staff',     icon: '👤' },
  { id: 'trivia',    label: 'Trivia',    icon: '🎓', isToggle: true },
]

const MS = { low: 10000, med: 6000, high: 3000 }
const TICK = 100

function formatDateParts(monthLabel) {
  const parts = monthLabel.split(' — ')
  return { month: parts[0] ?? '', year: parts[1] ?? '' }
}

export default function ActionPanel({ onInvest, onStaff, onManage, onRefinance, onTriviaToggle }) {
  const { state, dispatch } = useGame()

  const [speed, setSpeedState]  = useState('paused')
  const [progress, setProgress] = useState(0)
  const hasManuallyStopped      = useRef(false)
  const lastSpeedRef            = useRef('low')
  const speedBeforeModalRef     = useRef('paused')
  const progressRef             = useRef(0)

  const handlers = { invest: onInvest, staff: onStaff, manage: onManage, refinance: onRefinance }

  // Auto-start at Low after first property purchased (only if no system pause is active)
  useEffect(() => {
    if (state.properties.length > 0 && speed === 'paused' && !hasManuallyStopped.current && !state.isPaused) {
      setSpeedState(lastSpeedRef.current)
    }
  }, [state.properties.length])

  // System pause / auto-resume
  useEffect(() => {
    if (state.isPaused) {
      progressRef.current = 0
      setSpeedState('paused')
      setProgress(0)
    } else if (state.properties.length > 0 && !hasManuallyStopped.current) {
      // Critical event resolved — resume at last player-selected speed
      setSpeedState(lastSpeedRef.current)
    }
  }, [state.isPaused])

  // Pause when a modal opens; restore speed when it closes
  useEffect(() => {
    if (state.isModalOpen) {
      speedBeforeModalRef.current = speed
      progressRef.current = 0
      setSpeedState('paused')
      setProgress(0)
    } else if (!state.isPaused) {
      setSpeedState(speedBeforeModalRef.current)
    }
  }, [state.isModalOpen])

  // Auto-advance timer — dispatch is outside the setState updater to avoid React StrictMode double-fire
  useEffect(() => {
    if (speed === 'paused') return
    const id = setInterval(() => {
      progressRef.current += (TICK / MS[speed]) * 100
      if (progressRef.current >= 100) {
        progressRef.current = 0
        dispatch(advanceMonth())
      }
      setProgress(progressRef.current)
    }, TICK)
    return () => clearInterval(id)
  }, [speed])

  function handlePause() {
    hasManuallyStopped.current = true
    progressRef.current = 0
    setSpeedState('paused')
    setProgress(0)
    dispatch(setPaused(false))
  }

  function handleSetSpeed(s) {
    hasManuallyStopped.current = false
    lastSpeedRef.current = s
    dispatch(setPaused(false))
    setSpeedState(s)
  }

  function handlePlay() {
    hasManuallyStopped.current = false
    dispatch(setPaused(false))
    setSpeedState(lastSpeedRef.current)
  }

  const isPlaying    = speed !== 'paused'
  const hasProperty  = state.properties.length > 0
  const dateLabel  = formatMonthLabel(state.currentMonth)
  const { month, year } = formatDateParts(dateLabel)

  return (
    <nav className="action-panel">
      <div className="action-grid">
        {ACTIONS.map(action => {
          if (action.isToggle) {
            const on = state.triviaEnabled !== false
            return (
              <button
                key={action.id}
                className={`action-btn action-btn--toggle${on ? ' action-btn--toggle-on' : ' action-btn--toggle-off'}`}
                onClick={onTriviaToggle}
                title={on ? 'Knowledge Power-Up: ON — click to disable' : 'Knowledge Power-Up: OFF — click to enable'}
              >
                <span className="action-icon">{action.icon}</span>
                <span className="action-label">{action.label}</span>
                <span className="action-toggle-badge">{on ? 'ON' : 'OFF'}</span>
              </button>
            )
          }
          return (
            <button
              key={action.id}
              className={`action-btn action-btn--live${action.id === 'staff' ? ' action-btn--staff' : ''}`}
              onClick={() => handlers[action.id]?.()}
            >
              <span className="action-icon">{action.icon}</span>
              <span className="action-label">{action.label}</span>
            </button>
          )
        })}
      </div>

      <div className="time-control-panel">
        {/* Speed Controls — 50% */}
        <div className="speed-controls">
          <span className="tc-label">SPEED</span>
          <div className="speed-btn-row">
            {isPlaying ? (
              <button className="speed-btn speed-btn--pause" disabled={!hasProperty} onClick={handlePause} title="Pause">
                ⏸
              </button>
            ) : (
              <button className="speed-btn speed-btn--play" disabled={!hasProperty} onClick={handlePlay} title="Play">
                ▶
              </button>
            )}
            {['low', 'med', 'high'].map(s => (
              <button
                key={s}
                className={`speed-btn${speed === s ? ' speed-btn--active' : ''}`}
                disabled={!hasProperty}
                onClick={() => handleSetSpeed(s)}
                title={s === 'low' ? '10s/month' : s === 'med' ? '6s/month' : '3s/month'}
              >
                {s === 'low' ? 'Low' : s === 'med' ? 'Med' : 'High'}
              </button>
            ))}
          </div>
          {state.isPaused && (
            <span className="tc-pause-reason">⚠ Critical issue — resolve to resume</span>
          )}
        </div>

        {/* Month Progress — 25% */}
        <div className="month-progress">
          <span className="tc-label">MONTH</span>
          <div className="month-bar-track">
            <div
              className="month-bar-fill"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>

        {/* Date Display — 25% */}
        <div className="date-display">
          <span className="date-month">{month}</span>
          <span className="date-year">{year}</span>
        </div>
      </div>
    </nav>
  )
}
