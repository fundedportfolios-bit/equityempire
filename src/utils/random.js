export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function randomItem(array) {
  if (!array || array.length === 0) return undefined
  return array[Math.floor(Math.random() * array.length)]
}

// Returns true with the given probability (0–1)
export function randomChance(probability) {
  return Math.random() < probability
}

// Shuffles array in place using Fisher-Yates
export function shuffle(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
