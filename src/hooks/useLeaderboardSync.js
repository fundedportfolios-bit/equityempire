import { useEffect, useRef, useState } from 'react'
import { setLeaderboardProfile } from '../core/gameEngine.js'
import { syncSlot, getRankForRun } from '../systems/leaderboardSystem.js'

// Drives automatic leaderboard tracking for the active game run.
//
// Mounted in Dashboard. Watches portfolioValue / currentMonth; when the run's
// leaderboardProfile is enabled it runs a throttled syncSlot, persists the
// refreshed profile back into game state, and surfaces a Top-5 popup when the
// run newly enters / climbs within the top 5 of a board.
//
// All Firestore writes happen here (async) — reducers stay pure. ctx must be
// { uid, saveSlotIndex } with uid null for guests (guests can't write).
//
// Returns { topFive, dismissTopFive }.
export function useLeaderboardSync(state, dispatch, ctx) {
  const [topFive, setTopFive] = useState(null)  // { boardType, rank } | null
  const runningRef = useRef(false)
  const didInitRef = useRef(false)              // first qualifying run forces a sync

  useEffect(() => {
    const profile = state.leaderboardProfile
    if (!profile?.leaderboardEnabled || !ctx?.uid || !state.runId) return
    if (runningRef.current) return  // a previous sync is still in flight — skip

    runningRef.current = true
    const force = !didInitRef.current
    didInitRef.current = true
    let cancelled = false

    ;(async () => {
      try {
        const res = await syncSlot(state, ctx, { force })
        if (cancelled || !res.wrote) return

        // For each board that changed, check rank → fire Top-5 popup when the
        // run newly reaches / improves within the top 5 (vs lastNotified).
        let finalProfile = res.updatedProfile
        let popup = null
        for (const board of res.boardsChanged) {
          const rank = await getRankForRun(board, state.runId)
          console.log('[leaderboard] rank on', board, '→', rank ?? 'not found in board')
          if (cancelled) return
          if (rank != null && rank <= 5) {
            const last = profile.lastNotifiedRankByBoard?.[board]
            if (last == null || rank < last) {
              popup = { boardType: board, rank }
              finalProfile = {
                ...finalProfile,
                lastNotifiedRankByBoard: {
                  ...finalProfile.lastNotifiedRankByBoard,
                  [board]: rank,
                },
              }
            }
          }
        }
        if (cancelled) return
        dispatch(setLeaderboardProfile(finalProfile))
        if (popup) setTopFive(popup)
      } catch (e) {
        console.warn('[leaderboard] sync failed:', e?.code || '(no code)', '—', e?.message)
      } finally {
        runningRef.current = false
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.portfolioValue, state.currentMonth, state.leaderboardProfile?.leaderboardEnabled, ctx?.uid])

  return { topFive, dismissTopFive: () => setTopFive(null) }
}
