import { TRIVIA_RULES } from '../data/triviaRules.js'
import { TRIVIA_QUESTIONS } from '../data/triviaQuestions.js'
import { randomItem } from '../utils/random.js'

const ANSWER_INDEX = { A: 0, B: 1, C: 2 }

function getPortfolioStage(portfolioValue) {
  if (portfolioValue >= 1_000_000) return 'late'
  if (portfolioValue >= 300_000)   return 'mid'
  return 'early'
}

export function selectTriviaQuestion(usedIds = [], portfolioValue = 0) {
  const allActive = TRIVIA_QUESTIONS.filter(q => q.active)
  const unused    = allActive.filter(q => !usedIds.includes(q.id))
  const pool      = unused.length > 0 ? unused : allActive

  const stage  = getPortfolioStage(portfolioValue)
  const staged = pool.filter(q => q.portfolioStage === stage || q.portfolioStage === 'any')
  return randomItem(staged.length > 0 ? staged : pool)
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
