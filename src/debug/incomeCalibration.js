// Debug helper — generates N sample properties per type/difficulty and logs
// the cash-flow distribution. Useful for verifying that the new owner-CF
// calibration lands near targets.
//
// Usage (in the browser dev console):
//   import('./debug/incomeCalibration.js').then(m => m.runIncomeCalibration())
// or with a custom sample size:
//   m.runIncomeCalibration(20)

import { PROPERTY_TYPES } from '../data/propertyTypes.js'

const DEFAULT_APR = 0.0798   // PMMS + spread, current default

function generateRaw(template, difficulty, apr) {
  // Avoid circular import; load lazily on first call
  // eslint-disable-next-line no-restricted-syntax
  return import('../systems/propertySystem.js').then(({ default: _default, ...m }) => {
    // We need the internal generateOption — re-export via a small wrapper.
    // Since it's not exported, the easiest path is to call generatePropertyOptions
    // with a fake state and pick the first option of that type. To get a *clean*
    // signal, we just call it once per sample, ignoring slot constraints.
    return m._debug_generateOption?.(template, difficulty, apr)
  })
}

export async function runIncomeCalibration(samplesPerType = 20) {
  const { _debug_generateOption } = await import('../systems/propertySystem.js')
  if (!_debug_generateOption) {
    console.error('Debug hook _debug_generateOption is not exported from propertySystem.js')
    return
  }

  const apr         = DEFAULT_APR
  const difficulties = ['easy', 'medium', 'hard']
  const fmt          = (n) => Math.round(n).toLocaleString()

  console.log('%c=== Owner Cash Flow Calibration ===', 'font-weight:bold;font-size:14px')
  console.log(`Samples per type × difficulty: ${samplesPerType}\n`)

  const summary = []

  for (const pt of PROPERTY_TYPES) {
    if (pt.incomeType === 'none') continue   // fix_flip: skip

    for (const diff of difficulties) {
      const ownerCFs   = []
      const ownerCFPU  = []
      const samples    = []

      for (let i = 0; i < samplesPerType; i++) {
        const o = _debug_generateOption(pt, diff, apr, {})
        ownerCFs.push(o.projectedOwnerCashFlow)
        ownerCFPU.push((o.projectedOwnerCashFlow * 12) / o.units)
        if (i < 3) samples.push(o)   // keep 3 examples per group for the log
      }

      const target   = pt.ownerCashFlowTargetPerUnit?.[diff] ?? 0
      const meanCF   = ownerCFs.reduce((a, b) => a + b, 0) / ownerCFs.length
      const meanPU   = ownerCFPU.reduce((a, b) => a + b, 0) / ownerCFPU.length
      const minPU    = Math.min(...ownerCFPU)
      const maxPU    = Math.max(...ownerCFPU)

      summary.push({
        type:           pt.id,
        difficulty:     diff,
        targetPerUnit:  target,
        meanPerUnit:    Math.round(meanPU),
        minPerUnit:     Math.round(minPU),
        maxPerUnit:     Math.round(maxPU),
        meanMonthlyCF:  Math.round(meanCF),
      })

      // Per-sample detail
      console.groupCollapsed(`${pt.id} • ${diff} — target $${fmt(target)}/unit/yr | observed mean $${fmt(meanPU)}/unit/yr`)
      samples.forEach((o, i) => {
        console.log(
          `[${i + 1}] price=$${fmt(o.purchasePrice)} units=${o.units} ` +
          `cond=${o.conditionLabel} arch=${o.dealArchetypeLabel} | ` +
          `PITIAUC=$${fmt(o.pitiauc)} drag=$${fmt(o.expectedCostDrag)} ` +
          `gross=$${fmt(o.monthlyIncome)} ownerCF=$${fmt(o.projectedOwnerCashFlow)}/mo ` +
          `($${fmt((o.projectedOwnerCashFlow * 12) / o.units)}/unit/yr) ` +
          `cashNeeded=$${fmt(o.cashNeeded)}`
        )
      })
      console.groupEnd()
    }
  }

  // Print summary table
  console.log('\n%c=== Summary ===', 'font-weight:bold')
  console.table(summary)

  return summary
}

// Expose globally so devtools console can call it without imports
if (typeof window !== 'undefined') {
  window.runIncomeCalibration = runIncomeCalibration
}
