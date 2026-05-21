import { useState, useEffect } from 'react'
import { fetchLeaders } from '../systems/leaderboardSystem.js'
import { formatShort } from '../utils/formatters.js'

// Compact home-screen leaderboard preview — shows just the current rank-1
// for each board, plus a "View Leaderboard" button. Public-read, so it
// works for guests and signed-in users alike.
// Props: onView — () => void to open the full LeaderboardScreen.

function PreviewLine({ label, leader, valueText }) {
  return (
    <div className="lb-preview-line">
      <span className="lb-preview-board">{label}</span>
      {leader
        ? (
          <span className="lb-preview-leader">
            <span className="lb-preview-name">{leader.publicUsername || 'Player'}</span>
            <span className="lb-preview-value">{valueText}</span>
          </span>
        )
        : <span className="lb-preview-empty">No entries yet</span>}
    </div>
  )
}

export default function LeaderboardPreview({ onView }) {
  const [status,  setStatus]  = useState('loading')  // 'loading' | 'ready' | 'error'
  const [leaders, setLeaders] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchLeaders()
      .then(l => { if (!cancelled) { setLeaders(l); setStatus('ready') } })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="lb-preview">
      <div className="lb-preview-header">
        <span className="lb-preview-title">🏆 Leaderboard</span>
        <button className="btn btn-sm lb-preview-view-btn" onClick={onView}>
          View Leaderboard →
        </button>
      </div>

      {status === 'loading' && <p className="lb-preview-status">Loading…</p>}
      {status === 'error'   && <p className="lb-preview-status">Leaderboard unavailable right now.</p>}
      {status === 'ready' && leaders && (
        <div className="lb-preview-lines">
          <PreviewLine
            label="Fastest to $1B"
            leader={leaders.fastest_1b}
            valueText={leaders.fastest_1b ? `Month ${leaders.fastest_1b.monthReached ?? '—'}` : ''}
          />
          <PreviewLine
            label="Fastest to $10B"
            leader={leaders.fastest_10b}
            valueText={leaders.fastest_10b ? `Month ${leaders.fastest_10b.monthReached ?? '—'}` : ''}
          />
          <PreviewLine
            label="Biggest Empire Ever"
            leader={leaders.biggest_empire}
            valueText={leaders.biggest_empire ? formatShort(leaders.biggest_empire.highestPortfolioValue || 0) : ''}
          />
        </div>
      )}
    </div>
  )
}
