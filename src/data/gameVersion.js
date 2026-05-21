// Version constants — used to stamp leaderboard entries so future game-balance
// changes can be separated from older scores if ever needed.

export const GAME_VERSION  = '4.0.0'
export const SCORE_VERSION = '1.0'

// Leaderboard board identifiers.
export const BOARD_TYPES = {
  FASTEST_1B:     'fastest_1b',
  FASTEST_10B:    'fastest_10b',
  BIGGEST_EMPIRE: 'biggest_empire',
}

// Portfolio-value thresholds the fastest boards measure against.
export const THRESHOLD_1B  = 1_000_000_000
export const THRESHOLD_10B = 10_000_000_000

// Display row limits per board.
export const BOARD_LIMITS = {
  fastest_1b:     10,
  fastest_10b:    10,
  biggest_empire: 25,
}
