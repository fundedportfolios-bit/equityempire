export function calculateNetCashFlow(monthlyIncome, monthlyExpenses) {
  return monthlyIncome - monthlyExpenses
}

export function calculateEquity(portfolioValue, totalDebt) {
  return portfolioValue - totalDebt
}

export function calculateLTV(totalDebt, portfolioValue) {
  if (portfolioValue === 0) return 0
  return totalDebt / portfolioValue
}

// Standard amortizing mortgage payment formula
// principal: loan amount, annualRate: e.g. 0.07, termMonths: e.g. 360
export function calculateMortgagePayment(principal, annualRate, termMonths) {
  if (principal <= 0) return 0
  const monthlyRate = annualRate / 12
  if (monthlyRate === 0) return principal / termMonths
  const factor = Math.pow(1 + monthlyRate, termMonths)
  return (principal * monthlyRate * factor) / (factor - 1)
}

// Returns the principal portion of a single payment given current balance
export function calculatePrincipalPortion(balance, annualRate, termMonths) {
  const payment = calculateMortgagePayment(balance, annualRate, termMonths)
  const interestPortion = balance * (annualRate / 12)
  return Math.max(0, payment - interestPortion)
}

export function calculateCapRate(netOperatingIncome, propertyValue) {
  if (propertyValue === 0) return 0
  return netOperatingIncome / propertyValue
}

export function calculateCashOnCashReturn(annualCashFlow, totalCashInvested) {
  if (totalCashInvested === 0) return 0
  return annualCashFlow / totalCashInvested
}
