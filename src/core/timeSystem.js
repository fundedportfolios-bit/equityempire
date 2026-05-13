export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const MONTH_ABBREVS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
]

// Game month 1 = January of Year 1; cycles through calendar months indefinitely
export function getMonthName(gameMonth) {
  return MONTH_NAMES[(gameMonth - 1) % 12]
}

export function getGameYear(gameMonth) {
  return Math.ceil(gameMonth / 12)
}

// e.g. "JAN — YR 1"
export function formatMonthLabel(gameMonth) {
  const abbrev = MONTH_ABBREVS[(gameMonth - 1) % 12]
  return `${abbrev} — YR ${getGameYear(gameMonth)}`
}

// Short form: "Month 7"
export function formatMonthShort(gameMonth) {
  return `Month ${gameMonth}`
}
