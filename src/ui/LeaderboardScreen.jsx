import { useState, useEffect } from 'react'
import { fetchBoard } from '../systems/leaderboardSystem.js'
import { BOARD_TYPES, BOARD_LIMITS } from '../data/gameVersion.js'
import { formatShort, formatCashFlow } from '../utils/formatters.js'

// Full 3-tab leaderboard. Self-contained — fetches each board on demand and
// caches the result. `currentRunId` (optional) highlights the player's row.

const TABS = [
  { id: BOARD_TYPES.FASTEST_1B,     label: 'Fastest to $1B'    },
  { id: BOARD_TYPES.FASTEST_10B,    label: 'Fastest to $10B'   },
  { id: BOARD_TYPES.BIGGEST_EMPIRE, label: 'Biggest Empire'    },
]

function StatChip({ label, value }) {
  return (
    <span className="lb-stat-chip">
      <span className="lb-stat-chip-label">{label}</span>
      <span className="lb-stat-chip-value">{value}</span>
    </span>
  )
}

function LeaderRow({ row, rank, isMine, boardType }) {
  const isBiggest = boardType === BOARD_TYPES.BIGGEST_EMPIRE
  return (
    <div className={`lb-row${isMine ? ' lb-row--mine' : ''}${rank <= 3 ? ' lb-row--podium' : ''}`}>
      <div className="lb-row-top">
        <span className={`lb-rank lb-rank--${rank <= 3 ? rank : 'n'}`}>#{rank}</span>
        <span className="lb-username">{row.publicUsername || 'Player'}</span>
        {isMine && <span className="lb-mine-badge">YOU</span>}
        <span className="lb-headline">
          {isBiggest
            ? formatShort(row.highestPortfolioValue || 0)
            : `Month ${row.monthReached ?? '—'}`}
        </span>
      </div>
      <div className="lb-row-stats">
        {isBiggest ? (
          <>
            <StatChip label="Months" value={row.monthsPlayed ?? '—'} />
            <StatChip label="Net CF" value={`${formatCashFlow(row.netMonthlyCashFlow || 0)}/mo`} />
            <StatChip label="Props" value={row.propertiesOwned ?? 0} />
            <StatChip label="Planets" value={row.planetsOwned ?? 0} />
            <StatChip label="Refis" value={row.refinancesCompleted ?? 0} />
          </>
        ) : (
          <>
            <StatChip label="Portfolio" value={formatShort(row.portfolioValue || 0)} />
            <StatChip label="Net CF" value={`${formatCashFlow(row.netMonthlyCashFlow || 0)}/mo`} />
            <StatChip label="Props" value={row.propertiesOwned ?? 0} />
            <StatChip label="Refis" value={row.refinancesCompleted ?? 0} />
          </>
        )}
      </div>
    </div>
  )
}

export default function LeaderboardScreen({ onClose, currentRunId = null }) {
  const [activeTab, setActiveTab] = useState(BOARD_TYPES.FASTEST_1B)
  // Per-board cache: { [boardType]: { status, rows } }
  const [boards, setBoards] = useState({})

  useEffect(() => {
    if (boards[activeTab]) return  // already loaded / loading
    let cancelled = false
    setBoards(b => ({ ...b, [activeTab]: { status: 'loading', rows: [] } }))
    fetchBoard(activeTab, BOARD_LIMITS[activeTab] || 25)
      .then(rows => { if (!cancelled) setBoards(b => ({ ...b, [activeTab]: { status: 'ready', rows } })) })
      .catch(() => { if (!cancelled) setBoards(b => ({ ...b, [activeTab]: { status: 'error', rows: [] } })) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  const board = boards[activeTab] || { status: 'loading', rows: [] }
  const limit = BOARD_LIMITS[activeTab] || 25

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">🏆 Leaderboard</h2>
            <p className="modal-subtitle">Top players across every Equity Empire run</p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="lb-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`lb-tab${activeTab === t.id ? ' lb-tab--active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          <p className="lb-limit-note">
            {activeTab === BOARD_TYPES.BIGGEST_EMPIRE
              ? 'Top 25 — ranked by the highest portfolio value ever reached.'
              : 'Top 10 — ranked by fewest months to reach the goal.'}
          </p>

          {board.status === 'loading' && (
            <p className="empty-state">Loading leaderboard…</p>
          )}
          {board.status === 'error' && (
            <p className="empty-state">Couldn't load the leaderboard. Check your connection and try again.</p>
          )}
          {board.status === 'ready' && board.rows.length === 0 && (
            <p className="empty-state">No entries yet — be the first to make this board!</p>
          )}
          {board.status === 'ready' && board.rows.length > 0 && (
            <div className="lb-rows">
              {board.rows.slice(0, limit).map((row, i) => (
                <LeaderRow
                  key={row.runId || i}
                  row={row}
                  rank={i + 1}
                  isMine={currentRunId && row.runId === currentRunId}
                  boardType={activeTab}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
