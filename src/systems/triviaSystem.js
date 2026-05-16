import { TRIVIA_RULES } from '../data/triviaRules.js'
import { TRIVIA_QUESTIONS } from '../data/triviaQuestions.js'
import { randomItem } from '../utils/random.js'

const ANSWER_INDEX = { A: 0, B: 1, C: 2 }

function getPortfolioStage(portfolioValue) {
  if (portfolioValue >= 200_000_000) return 'advanced'
  if (portfolioValue >= 1_000_000)   return 'late'
  if (portfolioValue >= 300_000)     return 'mid'
  return 'early'
}

// Trivia selection — three layered priorities:
//   1. Intro questions (portfolioStage: 'intro') are served first in any new
//      game until exhausted. Random order among themselves.
//   2. Stage-appropriate selection. At 'advanced' (>=$200M), the pool also
//      includes 'late' questions so the player keeps seeing the broader
//      curriculum mixed with the new advanced material.
//   3. If a stage-filtered subset is exhausted, fall back to anything
//      non-intro and stage-allowed (so the player doesn't loop intros after
//      they're "seen", and never accidentally sees an advanced question
//      before reaching the advanced stage).
export function selectTriviaQuestion(usedIds = [], portfolioValue = 0) {
  const allActive = TRIVIA_QUESTIONS.filter(q => q.active)
  const unused    = allActive.filter(q => !usedIds.includes(q.id))

  // 1. Intro priority — always served first while any are unused.
  const unusedIntros = unused.filter(q => q.portfolioStage === 'intro')
  if (unusedIntros.length > 0) {
    return randomItem(unusedIntros)
  }

  // 2 + 3. Stage-appropriate. Build the eligibility predicate once.
  const stage = getPortfolioStage(portfolioValue)
  const isStageAllowed = (q) => {
    if (q.portfolioStage === 'intro')    return false
    if (q.portfolioStage === 'any')      return true
    if (q.portfolioStage === 'advanced') return stage === 'advanced'
    // Advanced stage also includes late-tier material (broader curriculum).
    if (stage === 'advanced') return q.portfolioStage === 'late'
    return q.portfolioStage === stage
  }

  // Prefer unused stage-appropriate first.
  const fromUnused = unused.filter(isStageAllowed)
  if (fromUnused.length > 0) return randomItem(fromUnused)

  // Otherwise cycle through all stage-appropriate (allowing repeats), so we
  // never accidentally serve an advanced question before the player reaches
  // the advanced stage just because their unused pool ran out.
  const fromAll = allActive.filter(isStageAllowed)
  if (fromAll.length > 0) return randomItem(fromAll)

  // Last resort: any active non-intro (shouldn't happen with normal data).
  const safe = allActive.filter(q => q.portfolioStage !== 'intro')
  return randomItem(safe.length > 0 ? safe : allActive)
}

export function evaluateTriviaAnswer(question, selectedIndex) {
  return selectedIndex === ANSWER_INDEX[question.correctAnswer]
}

export function calcTriviaReward(portfolioValue) {
  const { minRewardPercentOfPortfolio, maxRewardPercentOfPortfolio,
          starterMinReward, starterMaxReward, rewardRounding } = TRIVIA_RULES
  const min = portfolioValue > 0 ? portfolioValue * minRewardPercentOfPortfolio : starterMinReward
  const max = portfolioValue > 0 ? portfolioValue * maxRewardPercentOfPortfolio : starterMaxReward
  const raw = min + Math.random() * (max - min)
  return Math.round(raw / rewardRounding) * rewardRounding
}
