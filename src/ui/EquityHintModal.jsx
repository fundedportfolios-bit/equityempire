import { useLayoutEffect, useState } from 'react'

// One-time popup fired (in any difficulty) when a player's first asset has
// appreciated enough that a max cash-out refinance would return at least the
// original down payment. Points at the "Manage Equity" action button at the
// bottom of the screen; the popup dismisses on any click.
//
// Props:
//   target     — data-tutorial attribute of the button to point at (defaults
//                to the Manage Equity action button)
//   onDismiss  — () => void; fires on any click anywhere
export default function EquityHintModal({ target = 'action-refinance', onDismiss }) {
  const [rect, setRect] = useState(null)

  useLayoutEffect(() => {
    function update() {
      const el = document.querySelector(`[data-tutorial="${target}"]`)
      if (!el) { setRect(null); return }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const id = setInterval(update, 300)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      clearInterval(id)
    }
  }, [target])

  return (
    <div className="equity-hint-overlay" onClick={onDismiss}>
      <div className="equity-hint-card">
        <div className="equity-hint-emoji">💰</div>
        <h2 className="equity-hint-title">You've Built Equity!</h2>
        <p className="equity-hint-body">
          Your property has appreciated enough to leverage. Use <strong>Manage Equity</strong>
          to refinance and pull cash out for your next deal.
        </p>
        <p className="equity-hint-dismiss-hint">Tap anywhere to dismiss</p>
      </div>
      {rect && (
        <>
          <div className="equity-hint-ring" style={{
            top:    rect.top - 6,
            left:   rect.left - 6,
            width:  rect.width + 12,
            height: rect.height + 12,
          }} />
          <div className="equity-hint-arrow" style={{
            top:  rect.top - 52,
            left: rect.left + rect.width / 2 - 16,
          }}>👇</div>
        </>
      )}
    </div>
  )
}
