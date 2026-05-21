// Tutorial step data — driven entirely from this file so copy and target
// pointers can be tuned without touching any UI component.
//
// Schema per step:
//   id                — stable string identifier
//   title             — short heading
//   body              — 1-3 sentence explanation
//   target            — name of a `data-tutorial="<x>"` attribute on the
//                       DOM element to highlight, or null for centered.
//   placement         — preferred placement of the card relative to target:
//                       'above' | 'below' | 'center'
//   fallbackPlacement — if `placement` doesn't fit, fall back to this.

export const TUTORIAL_STEPS = [
  {
    id:                'dashboard',
    title:             'Dashboard',
    body:              'This is your portfolio scoreboard. Watch cash, value, equity, debt, income, expenses, and net cash flow to see whether your empire is growing safely.',
    target:            'dashboard-summary',
    placement:         'below',
    fallbackPlacement: 'center',
  },
  {
    id:                'speed',
    title:             'Game Speed Controls',
    body:              'Use the speed controls to decide how quickly months pass. Faster speed grows the game faster, but maintenance issues and decisions can pile up.',
    target:            'speed-controls',
    placement:         'below',
    fallbackPlacement: 'center',
  },
  {
    id:                'ptb',
    title:             'Portfolio and Staff Snapshot',
    body:              'These icons summarize what you own and the staff you have hired. As your portfolio grows, this area helps you quickly see your scale.',
    target:            'property-staff-icons',
    placement:         'below',
    fallbackPlacement: 'center',
  },
  {
    id:                'coverage',
    title:             'Coverage',
    body:              'Coverage shows whether your staff can keep up with your operating workload. If coverage drops, issues may start piling up.',
    target:            'coverage-status',
    placement:         'below',
    fallbackPlacement: 'center',
  },
  {
    id:                'maintenance',
    title:             'Maintenance Issues',
    body:              'Issues appear here as properties operate. Resolve them yourself or hire staff to help. If issues sit too long, they can become more serious and expensive.',
    target:            'maintenance-issues',
    placement:         'below',
    fallbackPlacement: 'center',
  },
  {
    id:                'invest',
    title:             'Invest',
    body:              'Tap Invest to find properties you can buy. This is how you grow from small deals into larger assets. Every click will show you new deals to review!',
    target:            'action-invest',
    placement:         'above',
    fallbackPlacement: 'center',
  },
  {
    id:                'upgrade',
    title:             'Upgrade',
    body:              'Tap Upgrade when improvements are available. Upgrades can increase income, increase value, or reduce future operating pressure.',
    target:            'action-upgrade',
    placement:         'above',
    fallbackPlacement: 'center',
  },
  {
    id:                'refinance',
    title:             'Manage Equity',
    body:              'Tap Manage Equity to manage the amount of cash you have available to invest by selling, refinancing, or paying down your loans. This is one of the main ways to scale your portfolio.',
    target:            'action-refinance',
    placement:         'above',
    fallbackPlacement: 'center',
  },
  {
    id:                'staff',
    title:             'Staff',
    body:              'Tap Staff to hire help. Staff can handle maintenance workload so larger portfolios do not overwhelm you.',
    target:            'action-staff',
    placement:         'above',
    fallbackPlacement: 'center',
  },
  {
    id:                'trivia',
    title:             'Knowledge Power Ups',
    body:              'This button enables Trivia. Answering correctly results in increasingly large cash bonuses to help you meet your goals.',
    target:            'action-trivia',
    placement:         'above',
    fallbackPlacement: 'center',
  },
  {
    id:                'portfolio',
    title:             'Property Cards',
    body:              'Scroll here to review individual properties. Property cards show value, debt, cash flow, months owned, upgrades, and maintenance needs.',
    target:            'portfolio-list',
    placement:         'above',
    fallbackPlacement: 'center',
  },
  {
    id:                'report',
    title:             'Progress Report',
    body:              'Send yourself a detailed progress report anytime you like.',
    target:            'action-report',
    placement:         'below',
    fallbackPlacement: 'center',
  },
  // Finale card — `isFinale: true` means TutorialOverlay hides the step
  // counter and treats this as a closer after the 12 numbered steps.
  {
    id:                'ready',
    title:             'Time to Invest!',
    body:              'Pick your first investment carefully and start managing and growing your empire!',
    target:            null,
    placement:         'center',
    fallbackPlacement: 'center',
    isFinale:          true,
  },
]
