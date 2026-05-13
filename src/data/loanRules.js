// Loan product definitions. loanSystem.js will use these to validate
// and calculate mortgage payments for property purchases and refinances.
export const LOAN_RULES = {
  conventional: {
    id: 'conventional',
    label: 'Conventional Loan',
    description: '30-year fixed-rate mortgage. Standard product for investment properties.',
    termMonths: 360,
    minDownPaymentPct: 0.20,
    maxLTV: 0.80,
    baseInterestRate: 0.07,   // overridden by difficulty setting
    maxProperties: null,       // no hard cap
  },
  portfolio: {
    id: 'portfolio',
    label: 'Portfolio Loan',
    description: 'Lender holds the note. More flexible underwriting for seasoned investors.',
    termMonths: 240,
    minDownPaymentPct: 0.25,
    maxLTV: 0.75,
    baseInterestRate: 0.085,
    maxProperties: null,
  },
  hardMoney: {
    id: 'hardMoney',
    label: 'Hard Money Loan',
    description: 'Short-term, high-rate bridge financing for quick acquisitions.',
    termMonths: 12,
    minDownPaymentPct: 0.30,
    maxLTV: 0.70,
    baseInterestRate: 0.12,
    maxProperties: null,
  },
}

export const DEFAULT_LOAN = 'conventional'

export const REFI_RULES = {
  annualInterestRate: 0.085,  // 8.5% refi rate (above original 8% so cash-out always increases debt service)
  loanTermMonths:     360,    // 30-year fixed
  maxLTV:             0.75,   // 75% max loan-to-value
  closingCostPercent: 0.04,   // 4% of new loan balance
  seasoningMonths:        6,   // must own 6+ months for low-risk refi
  maxRefiSeasoningMonths: 12,  // must own 12+ months for max (full) refi
  saleCostPercent:    0.04,   // 4% of sale price
}
