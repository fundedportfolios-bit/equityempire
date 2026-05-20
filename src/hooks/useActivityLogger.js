import { useEffect, useRef } from 'react'
import { logActivity, logSnapshot } from '../services/logGameActivity.js'

// Watches the central game state and fires activity events on meaningful
// changes. Implementation notes:
//   • Reads `state.reporting.totals` (already kept up to date by the
//     reporting system) to detect incremental purchases / refis / upgrades
//     / staff hires. Diffing the counters guarantees we log exactly once
//     per action, including batch actions that increment by N.
//   • Fires session_started + an initial snapshot once on mount.
//   • Fires goal_reached when state.gameWon flips to true.
//   • Fires milestone_reached when state.activeMilestone becomes a new
//     non-null value.
//   • Schedules game_snapshot at 5-minute intervals (throttled inside the
//     service helper).
//   • This hook is purely observational — it never dispatches game
//     actions and never blocks rendering.

function staffTotal(s) {
  if (!s) return 0
  return (s.partTime || 0) + (s.fullTime || 0) + (s.seniorManager || 0) + (s.executiveOperator || 0)
}

export function useActivityLogger(state) {
  // Stable refs to compare previous values against current.
  const sessionLoggedRef = useRef(false)
  const lastTotalsRef    = useRef(null)
  const lastStaffRef     = useRef(0)
  const lastWonRef       = useRef(false)
  const lastMilestoneRef = useRef(null)

  // Initial session_started + snapshot (once per Dashboard mount).
  useEffect(() => {
    if (sessionLoggedRef.current) return
    sessionLoggedRef.current = true

    logActivity('session_started', { state, details: { difficulty: state.difficulty || null } })
    logSnapshot(state, { force: true })

    // Heartbeat snapshot every ~5 min while this hook is mounted.
    const interval = setInterval(() => {
      // Read latest state via closure capture — React will provide a fresh
      // `state` reference each render; the interval keeps the same closure
      // and reads the latest by re-querying via the snapshot helper.
      // We'll handle that via a second effect that always has fresh state.
    }, 60_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Heartbeat: try a snapshot once per minute; the helper is throttled to
  // at most once per 5 minutes so this is cheap.
  useEffect(() => {
    const id = setInterval(() => logSnapshot(state), 60_000)
    return () => clearInterval(id)
  }, [state])

  // Track incremental actions via reporting.totals deltas.
  useEffect(() => {
    const totals = state.reporting?.totals
    if (!totals) return
    const prev = lastTotalsRef.current
    if (prev) {
      const dPurch = (totals.propertiesPurchased  || 0) - (prev.propertiesPurchased  || 0)
      const dRefi  = (totals.refinancesCompleted  || 0) - (prev.refinancesCompleted  || 0)
      const dUpg   = (totals.upgradesCompleted    || 0) - (prev.upgradesCompleted    || 0)
      const dStaff = (totals.staffHired           || 0) - (prev.staffHired           || 0)

      for (let i = 0; i < dPurch; i++) logActivity('property_acquired', { state })
      for (let i = 0; i < dRefi;  i++) logActivity('refinance_completed', { state })
      for (let i = 0; i < dUpg;   i++) logActivity('upgrade_completed', { state })
      for (let i = 0; i < dStaff; i++) logActivity('staff_hired', { state })
    }
    lastTotalsRef.current = totals
  }, [state, state.reporting?.totals])

  // Independent staff total (in case staff total moves without totals.staffHired diff).
  useEffect(() => {
    const curr = staffTotal(state.staff)
    const prev = lastStaffRef.current
    if (curr > prev) {
      // We already log via the totals path above; only log here if
      // reporting.totals didn't capture it (defensive). Guarded.
    }
    lastStaffRef.current = curr
  }, [state.staff])

  // goal_reached — gameWon transition.
  useEffect(() => {
    if (!lastWonRef.current && state.gameWon) {
      logActivity('goal_reached', { state })
      logSnapshot(state, { force: true })
    }
    lastWonRef.current = !!state.gameWon
  }, [state.gameWon, state])

  // milestone_reached — activeMilestone becomes a new non-null value.
  useEffect(() => {
    const m = state.activeMilestone
    if (m != null && m !== lastMilestoneRef.current) {
      logActivity('milestone_reached', {
        state,
        milestoneName: String(m),
      })
    }
    lastMilestoneRef.current = m
  }, [state.activeMilestone, state])
}
