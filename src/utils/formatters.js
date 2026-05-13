export function formatCurrency(n) {
  if (n === null || n === undefined) return '$0'
  return '$' + Math.round(n).toLocaleString('en-US')
}

// Compact form: $50K, $1.2M, $4.8B
export function formatShort(n) {
  if (n === null || n === undefined) return '$0'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000)     return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)         return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${Math.round(abs)}`
}

// Signed cash flow: "+$1,200" or "-$400"
export function formatCashFlow(n) {
  const prefix = n >= 0 ? '+' : ''
  return `${prefix}${formatCurrency(n)}`
}

export function formatPercent(n, decimals = 1) {
  return `${(n * 100).toFixed(decimals)}%`
}

export function formatMonth(gameMonth) {
  return `Month ${gameMonth}`
}
