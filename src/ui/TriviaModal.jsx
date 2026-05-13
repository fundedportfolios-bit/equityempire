import { useState } from 'react'
import { useGame } from '../core/gameState.js'
import { closeTrivia } from '../core/gameEngine.js'
import { evaluateTriviaAnswer, calcTriviaReward } from '../systems/triviaSystem.js'

const LETTERS = ['A', 'B', 'C']
const ANSWER_INDEX = { A: 0, B: 1, C: 2 }

export default function TriviaModal() {
  const { state, dispatch } = useGame()
  const question = state.activeTriviaQuestion

  const [selectedIndex, setSelectedIndex] = useState(null)
  const [submitted, setSubmitted]         = useState(false)
  const [isCorrect, setIsCorrect]         = useState(false)
  const [reward, setReward]               = useState(0)

  if (!question) return null

  function handleSubmit() {
    if (selectedIndex === null) return
    const correct = evaluateTriviaAnswer(question, selectedIndex)
    const prize   = correct ? calcTriviaReward(state.portfolioValue) : 0
    setIsCorrect(correct)
    setReward(prize)
    setSubmitted(true)
  }

  function handleClose() {
    dispatch(closeTrivia(reward, false))
  }

  function handleDismiss() {
    dispatch(closeTrivia(submitted ? reward : 0, true))
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) handleDismiss()
  }

  const correctIndex = ANSWER_INDEX[question.correctAnswer]

  return (
    <div className="modal-overlay trivia-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet trivia-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Knowledge Power-Up</h2>
            <p className="modal-subtitle">{question.category} · {question.difficulty}</p>
          </div>
          <button className="modal-close-btn" onClick={handleDismiss} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {!submitted ? (
            <>
              <p className="trivia-question">{question.question}</p>
              <div className="trivia-options">
                {question.options.map((opt, i) => (
                  <button
                    key={i}
                    className={`trivia-option${selectedIndex === i ? ' trivia-option--selected' : ''}`}
                    onClick={() => setSelectedIndex(i)}
                  >
                    <span className="trivia-option-letter">{LETTERS[i]}</span>
                    {opt}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-primary trivia-submit-btn"
                disabled={selectedIndex === null}
                onClick={handleSubmit}
              >
                Submit Answer
              </button>
            </>
          ) : (
            <>
              <div className={`trivia-result trivia-result--${isCorrect ? 'correct' : 'incorrect'}`}>
                {isCorrect ? 'Correct!' : 'Incorrect'}
              </div>

              {!isCorrect && (
                <p className="trivia-correct-answer">
                  Correct answer: <strong>{LETTERS[correctIndex]}) {question.options[correctIndex]}</strong>
                </p>
              )}

              <p className="trivia-explanation">{question.explanation}</p>

              {isCorrect && (
                <div className="trivia-prize">
                  <span className="trivia-prize-label">Cash Prize</span>
                  <span className="trivia-prize-amount">${reward.toLocaleString()}</span>
                </div>
              )}

              <button className="btn btn-primary trivia-submit-btn" onClick={handleClose}>
                {isCorrect ? 'Back to Empire' : 'Continue'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
