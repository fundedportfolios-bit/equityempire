import { useEffect, useState, useLayoutEffect } from 'react'
import { TUTORIAL_STEPS } from '../data/tutorialSteps.js'

// Welcome screen rendered as step 0; the tutorial-step UI takes over after
// "Start Tour" is tapped. Skip closes immediately.
function WelcomeScreen({ onStart, onSkip }) {
  return (
    <div className="tutorial-overlay tutorial-overlay--center">
      <div className="tutorial-dim" />
      <div className="tutorial-card tutorial-card--center" role="dialog" aria-labelledby="tutorial-welcome-title">
        <h2 id="tutorial-welcome-title" className="tutorial-title">Welcome to Equity Empire</h2>
        <p className="tutorial-body">
          Build a real estate portfolio, manage cash flow, handle maintenance, hire staff,
          refinance, and scale into bigger assets.
        </p>
        <div className="tutorial-actions">
          <button className="btn btn-ghost tutorial-btn" onClick={onSkip}>Skip</button>
          <button className="btn btn-primary tutorial-btn" onClick={onStart}>Start Tour →</button>
        </div>
      </div>
    </div>
  )
}

// Tries to compute a position adjacent to the highlighted target. Falls back
// to centered modal if target is missing or there isn't enough room.
function computeCardPosition(targetEl, placement, fallbackPlacement) {
  if (!targetEl) {
    return { mode: 'center' }
  }
  const rect = targetEl.getBoundingClientRect()
  const cardWidth = Math.min(360, window.innerWidth - 32)
  const cardHeight = 200 // approximation; final card may be a bit shorter
  const margin = 12
  const vw = window.innerWidth
  const vh = window.innerHeight

  function tryPlacement(p) {
    if (p === 'above') {
      const top = rect.top - cardHeight - margin
      if (top < 8) return null
      return { mode: 'pointer', top, left: clamp(rect.left + rect.width / 2 - cardWidth / 2, 16, vw - cardWidth - 16), width: cardWidth }
    }
    if (p === 'below') {
      const top = rect.bottom + margin
      if (top + cardHeight > vh - 8) return null
      return { mode: 'pointer', top, left: clamp(rect.left + rect.width / 2 - cardWidth / 2, 16, vw - cardWidth - 16), width: cardWidth }
    }
    return null // 'center' is handled separately below
  }

  return tryPlacement(placement) || tryPlacement(fallbackPlacement) || { mode: 'center' }
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)) }

// Step card with pointer placement (or centered as fallback).
function StepCard({ step, index, total, onBack, onNext, onSkip, onDone }) {
  const [pos, setPos] = useState({ mode: 'center' })
  const [highlightRect, setHighlightRect] = useState(null)

  // Recompute position whenever step changes (or on resize/scroll).
  useLayoutEffect(() => {
    let cancelled = false

    function update() {
      if (cancelled) return
      const targetEl = step.target
        ? document.querySelector(`[data-tutorial="${step.target}"]`)
        : null
      // Scroll into view if needed.
      if (targetEl) {
        try { targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch {}
        // Defer position calc one frame to let scroll settle.
        requestAnimationFrame(() => {
          if (cancelled) return
          const rect = targetEl.getBoundingClientRect()
          setHighlightRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
          setPos(computeCardPosition(targetEl, step.placement, step.fallbackPlacement))
        })
      } else {
        setHighlightRect(null)
        setPos({ mode: 'center' })
      }
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelled = true
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step.id, step.target, step.placement, step.fallbackPlacement])

  const isLast = index === total - 1

  const cardStyle = pos.mode === 'pointer'
    ? { position: 'fixed', top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }
    : {}

  return (
    <div className="tutorial-overlay">
      <div className="tutorial-dim" />
      {highlightRect && (
        <div
          className="tutorial-highlight"
          style={{
            top:    highlightRect.top - 6,
            left:   highlightRect.left - 6,
            width:  highlightRect.width + 12,
            height: highlightRect.height + 12,
          }}
        />
      )}
      <div
        className={`tutorial-card${pos.mode === 'center' ? ' tutorial-card--center' : ''}`}
        style={cardStyle}
        role="dialog"
        aria-labelledby={`tutorial-title-${step.id}`}
      >
        <div className="tutorial-step-count">Step {index + 1} of {total}</div>
        <h2 id={`tutorial-title-${step.id}`} className="tutorial-title">{step.title}</h2>
        <p className="tutorial-body">{step.body}</p>
        <div className="tutorial-actions">
          <button className="btn btn-ghost tutorial-btn" onClick={onSkip}>Skip</button>
          <button className="btn btn-ghost tutorial-btn" onClick={onBack} disabled={index === 0}>← Back</button>
          {isLast
            ? <button className="btn btn-primary tutorial-btn" onClick={onDone}>Done</button>
            : <button className="btn btn-primary tutorial-btn" onClick={onNext}>Next →</button>
          }
        </div>
      </div>
    </div>
  )
}

// ─── Top-level overlay ────────────────────────────────────────
// Props:
//   onClose(seen)  — called when user finishes/skips. `seen=true` always.
//   showWelcome    — if true, show the Welcome screen before step 1.
export default function TutorialOverlay({ onClose, showWelcome = true }) {
  const [phase, setPhase] = useState(showWelcome ? 'welcome' : 'steps')
  const [index, setIndex] = useState(0)

  // Lock body scroll while the tutorial is open so the dim layer covers cleanly.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  function handleDone() { onClose(true) }
  function handleSkip() { onClose(true) }
  function handleStart() { setPhase('steps') }
  function handleNext() { setIndex(i => Math.min(i + 1, TUTORIAL_STEPS.length - 1)) }
  function handleBack() { setIndex(i => Math.max(0, i - 1)) }

  if (phase === 'welcome') {
    return <WelcomeScreen onStart={handleStart} onSkip={handleSkip} />
  }
  return (
    <StepCard
      step={TUTORIAL_STEPS[index]}
      index={index}
      total={TUTORIAL_STEPS.length}
      onBack={handleBack}
      onNext={handleNext}
      onSkip={handleSkip}
      onDone={handleDone}
    />
  )
}
