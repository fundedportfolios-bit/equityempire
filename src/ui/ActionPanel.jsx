import { useState, useEffect, useRef, useMemo } from 'react'
import { useGame } from '../core/gameState.js'
import { advanceMonth, setPaused } from '../core/gameEngine.js'
import { formatMonthLabel } from '../core/timeSystem.js'
import { countAffordableTypes } from '../systems/propertySystem.js'
import { getMaxRefiNetCash } from '../systems/loanSystem.js'
import { getCurrentStaffCostByRole, getTotalStaffExpense, canHireStaffRole } from '../systems/staffSystem.js'
import { STAFF_ROLE_ORDER } from '../data/staffRules.js'
import { getAvailableUpgrades } from '../systems/eventSystem.js'
import { formatShort } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'

const ACTIONS = [
  { id: 'invest',    label: 'Invest',    icon: '🏠' },
  { id: 'upgrade',   label: 'Upgrade',   icon: '🔧' },
  { id: 'refinance', label: 'Manage Equity', icon: '💰' },
  { id: 'staff',     label: 'Staff',     icon: '👤', iconImage: '/icons/staff.png' },
  { id: 'trivia',    label: 'Trivia',    icon: '🎓', isToggle: true },
]

const MS = { low: 10000, med: 6000, high: 3000 }
const TICK = 100

function formatDateParts(monthLabel) {
  const parts = monthLabel.split(' — ')
  return { month: parts[0] ?? '', year: parts[1] ?? '' }
}

function upgradeCost(template, units) {
  return (template.baseCost || 0) + (template.unitCostFactor || 0) * (units ?? 1)
}

export default function ActionPanel({ onInvest, onStaff, onManage, onRefinance, onTriviaToggle }) {
  const { state, dispatch } = useGame()

  const [speed, setSpeedState]  = useState('paused')
  const [progress, setProgress] = useState(0)
  const hasManuallyStopped      = useRef(false)
  const lastSpeedRef            = useRef('low')
  const speedBeforeModalRef     = useRef('paused')
  const progressRef             = useRef(0)

  const handlers = { invest: onInvest, staff: onStaff, upgrade: onManage, refinance: onRefinance }

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

  // ─── Button badge data ─────────────────────────────────────────
  const affordableCount = useMemo(
    () => countAffordableTypes(state),
    [state.cash, state.properties.length, state.marketInterestRate, state.difficulty]
  )

  const maintenanceCount = state.properties.reduce((n, p) => n + (p.activeEvents?.length || 0), 0)

  const upgradeCount = useMemo(
    () => state.properties.reduce((n, p) => {
      return n + getAvailableUpgrades(p).filter(t => upgradeCost(t, p.units) <= state.cash).length
    }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.properties.map(p => p.id + (p.completedUpgrades?.length ?? 0)).join(), state.cash]
  )

  const refiPotential = useMemo(
    () => state.properties
      .reduce((sum, p) => sum + getMaxRefiNetCash(p, state), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.properties, state.marketInterestRate]
  )

  // Staff affordability — count distinct roles the player can currently hire.
  // Badge reads "N Roles Available" so the player knows multiple options exist.
  const hireableRoles = STAFF_ROLE_ORDER.filter(r => canHireStaffRole(state, r))
  const staffAffordable = hireableRoles.length

  const btnMeta = {
    invest: {
      disabled: affordableCount === 0,
      badges:   affordableCount > 0 ? [`${affordableCount} Available`] : [],
    },
    upgrade: {
      disabled: upgradeCount === 0,
      badges:   upgradeCount > 0 ? [`${upgradeCount} Affordable`] : [],
    },
    refinance: {
      disabled: refiPotential <= 0,
      badges:   refiPotential > 0 ? [`${formatShort(refiPotential)} Potential`] : [],
    },
    staff: {
      disabled: staffAffordable === 0,
      badges:   staffAffordable > 0 ? [`${staffAffordable} Role${staffAffordable !== 1 ? 's' : ''} Available`] : [],
    },
  }

  const isPlaying    = speed !== 'paused'
  const hasProperty  = state.properties.length > 0
  const dateLabel    = formatMonthLabel(state.currentMonth)
  const { month, year } = formatDateParts(dateLabel)

  return (
    <>
      <div className="speed-row">
        {/* Speed Controls */}
        <div className="speed-controls" data-tutorial="speed-controls">
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

        {/* Month Progress */}
        <div className="month-progress">
          <span className="tc-label">MONTH</span>
          <div className="month-bar-track">
            <div
              className="month-bar-fill"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>

        {/* Date Display */}
        <div className="date-display">
          <span className="date-month">{month}</span>
          <span className="date-year">{year}</span>
        </div>
      </div>

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
                  data-tutorial={`action-${action.id}`}
                >
                  <PropertyIcon emoji={action.icon} image={action.iconImage} className="action-icon" />
                  <span className="action-label">{action.label}</span>
                  <span className="action-toggle-badge">{on ? 'ON' : 'OFF'}</span>
                </button>
              )
            }
            const meta = btnMeta[action.id] || { disabled: false, badges: [] }
            return (
              <button
                key={action.id}
                className={`action-btn action-btn--live action-btn--${action.id}${meta.disabled ? ' action-btn--muted' : ''}`}
                disabled={action.id !== 'staff' && meta.disabled}
                onClick={() => handlers[action.id]?.()}
                data-tutorial={`action-${action.id}`}
              >
                <PropertyIcon emoji={action.icon} image={action.iconImage} className="action-icon" />
                <span className="action-label">{action.label}</span>
                {meta.badges.map(b => (
                  <span key={b} className="action-badge">{b}</span>
                ))}
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}
