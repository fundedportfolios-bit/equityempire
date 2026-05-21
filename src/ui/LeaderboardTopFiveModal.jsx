// Celebration popup when a joined run newly enters / climbs within the top 5
// of a board. Mirrors the MilestoneModal visual family.
// Props: boardType, rank (1-5), onClose.

const BOARD_LABEL = {
  fastest_1b:     'Fastest to $1B',
  fastest_10b:    'Fastest to $10B',
  biggest_empire: 'Biggest Empire Ever',
}

export default function LeaderboardTopFiveModal({ boardType, rank, onClose }) {
  if (!boardType || !rank) return null
  const label = BOARD_LABEL[boardType] || 'the leaderboard'

  return (
    <div className="milestone-overlay">
      <div className="milestone-modal" style={{ '--mc': '#f59e0b' }}>
        <div className="milestone-glow" />
        <div className="milestone-emoji">🏆</div>
        <h2 className="milestone-title">You made the Top 5!</h2>
        <p className="milestone-sub">
          Your run is now ranked <strong>#{rank}</strong> on {label}.
        </p>
        <button className="milestone-btn" onClick={onClose}>
          Keep Building →
        </button>
      </div>
    </div>
  )
}
