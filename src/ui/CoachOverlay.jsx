import { useLayoutEffect, useState } from 'react'

// Focused click-through overlay used by the Easy-mode first-purchase coach.
// Dims everything except the targeted element (data-tutorial attribute) using
// four positioned dim panels around the target — so clicks land on the target
// normally, while everything else is unreachable. Shows a pulsing highlight,
// a bouncing arrow, and a message bubble.
//
// Props:
//   target   — string matching a [data-tutorial="..."] attribute
//   message  — short instruction string rendered above the arrow
export default function CoachOverlay({ target, message }) {
  const [rect, setRect] = useState(null)

  useLayoutEffect(() => {
    let cancelled = false
    function update() {
      if (cancelled) return
      const el = document.querySelector(`[data-tutorial="${target}"]`)
      if (!el) { setRect(null); return }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    // Catch animated / layout changes briefly after mount (modal open, etc.).
    const id = setInterval(update, 300)
    return () => {
      cancelled = true
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      clearInterval(id)
    }
  }, [target])

  // Until the target is located, dim the whole screen with one block.
  if (!rect) {
    return (
      <div className="coach-overlay">
        <div className="coach-cutout coach-cutout--full" />
      </div>
    )
  }

  const pad = 8
  const innerTop    = Math.max(0, rect.top - pad)
  const innerLeft   = Math.max(0, rect.left - pad)
  const innerRight  = Math.max(0, rect.left + rect.width + pad)
  const innerBottom = Math.max(0, rect.top + rect.height + pad)
  const cutoutWidth = rect.height + pad * 2

  // Bubble placement: above the arrow, clamped within the viewport.
  const bubbleWidth = 280
  const bubbleTop   = Math.max(16, rect.top - 144)
  const bubbleLeft  = Math.max(
    12,
    Math.min(
      (typeof window !== 'undefined' ? window.innerWidth : 360) - bubbleWidth - 12,
      rect.left + rect.width / 2 - bubbleWidth / 2,
    ),
  )

  return (
    <div className="coach-overlay">
      {/* Four dim panels framing the target — gap between them is the click-
          through zone where the highlighted control sits. */}
      <div className="coach-cutout" style={{ top: 0, left: 0, right: 0, height: innerTop }} />
      <div className="coach-cutout" style={{ top: innerTop, left: 0, width: innerLeft, height: cutoutWidth }} />
      <div className="coach-cutout" style={{ top: innerTop, left: innerRight, right: 0, height: cutoutWidth }} />
      <div className="coach-cutout" style={{ top: innerBottom, left: 0, right: 0, bottom: 0 }} />

      {/* Pulsing ring around the target */}
      <div className="coach-highlight" style={{
        top:    rect.top - pad,
        left:   rect.left - pad,
        width:  rect.width + pad * 2,
        height: rect.height + pad * 2,
      }} />

      {/* Bouncing arrow above the target */}
      <div className="coach-arrow" style={{
        top:  rect.top - 56,
        left: rect.left + rect.width / 2 - 18,
      }}>👇</div>

      {/* Instruction bubble */}
      <div className="coach-bubble" style={{ top: bubbleTop, left: bubbleLeft, width: bubbleWidth }}>
        {message}
      </div>
    </div>
  )
}
