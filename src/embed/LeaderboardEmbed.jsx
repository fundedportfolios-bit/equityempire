import { useState, useEffect } from 'react'
import { fetchLeaders } from '../systems/leaderboardSystem.js'
import { formatShort } from '../utils/formatters.js'

// ─── Public embeddable leaderboard widget ──────────────────────────
// Rendered standalone at the /leaderboard-embed route (see App.jsx).
//
//  • Public + read-only: a single getDocs read of the leaderboard
//    collections (rules allow `read: if true`). No auth, no writes,
//    no joining/editing/deleting.
//  • No game state — not wrapped in GameProvider, uses no useGame.
//  • Only renders publicUsername + public game stats. Never userId,
//    runId, saveSlotIndex, email, or real name.
//  • Fluid width (no fixed pixel widths) so it adapts to its iframe.
//
// Designed to sit in an <iframe> on an external marketing site.

// The widget is served from the game's own domain, so window.origin is
// the game URL — buttons open the game in a new top-level tab.
const GAME_URL = (typeof window !== 'undefined' ? window.location.origin : '') + '/'

const ROWS = [
  { key: 'fastest_1b',     label: 'Fastest to $1B' },
  { key: 'fastest_10b',    label: 'Fastest to $10B' },
  { key: 'biggest_empire', label: 'Biggest Empire Ever' },
]

function leaderValue(key, entry) {
  if (!entry) return ''
  if (key === 'biggest_empire') return formatShort(entry.highestPortfolioValue || 0)
  return `Month ${entry.monthReached ?? '—'}`
}

export default function LeaderboardEmbed() {
  const [status,  setStatus]  = useState('loading')   // loading | ready | error
  const [leaders, setLeaders] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchLeaders()
      .then(l => { if (!cancelled) { setLeaders(l); setStatus('ready') } })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="lbe-root">
      <div className="lbe-card">
        <div className="lbe-header">
          <span className="lbe-trophy">🏆</span>
          <h1 className="lbe-title">Equity Empire Leaderboard</h1>
        </div>

        <div className="lbe-rows">
          {ROWS.map(({ key, label }) => {
            const entry = leaders?.[key]
            return (
              <div className="lbe-row" key={key}>
                <span className="lbe-row-label">{label}</span>
                {status === 'loading' && <span className="lbe-row-muted">Loading…</span>}
                {status === 'error'   && <span className="lbe-row-muted">Unavailable</span>}
                {status === 'ready' && (
                  entry ? (
                    <span className="lbe-row-leader">
                      <span className="lbe-row-name">{entry.publicUsername || 'Player'}</span>
                      <span className="lbe-row-value">{leaderValue(key, entry)}</span>
                    </span>
                  ) : (
                    <span className="lbe-row-muted">No entries yet</span>
                  )
                )}
              </div>
            )
          })}
        </div>

        <p className="lbe-tagline">Beat the board. Build your empire.</p>

        <div className="lbe-actions">
          <a className="lbe-btn lbe-btn-primary" href={GAME_URL} target="_blank" rel="noopener noreferrer">
            Play Equity Empire
          </a>
          <a className="lbe-btn lbe-btn-ghost" href={GAME_URL} target="_blank" rel="noopener noreferrer">
            View Full Leaderboard
          </a>
        </div>
      </div>
    </div>
  )
}
