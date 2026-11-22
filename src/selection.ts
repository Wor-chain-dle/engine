import { Temporal } from 'temporal-polyfill'
import { CONFIG } from './config.js'
import { WORDS } from './dictionary.js'

export const SELECTION_VERSION = 'web-v1.7.0-v1' as const

/** Structural ISO date type also accepts Temporal.PlainDate without leaking its declarations. */
export type CalendarDateInput =
  string | Readonly<{ year: number; month: number; day: number }>

function getDayIndex(date: CalendarDateInput): number {
  return Temporal.PlainDate.from(date).since(
    Temporal.PlainDate.from(CONFIG.startDate),
  ).days
}

/**
 * Preserves the web's raw remainder and unwrapped solutionIndex (day counter).
 * Pre-epoch dates can yield undefined; callers must handle this historical edge.
 * No current clock, time zone, or runtime shuffle is consulted.
 */
export function getDailyWord(date: CalendarDateInput): {
  solution: string | undefined
  solutionIndex: number
  dateKey: string
} {
  const day = Temporal.PlainDate.from(date)
  const index = getDayIndex(day)
  return {
    solution: WORDS[index % WORDS.length],
    solutionIndex: index,
    dateKey: day.toString(),
  }
}

export function getRandomWord(random: () => number = Math.random): string {
  const value = random()
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Random source must return a finite number in [0, 1)')
  }
  return WORDS[Math.floor(value * WORDS.length)]
}

const hashSeed = (seed: string) =>
  seed.split('').reduce((hash, char) => {
    return (hash * 31 + char.charCodeAt(0)) >>> 0
  }, 0)

/** Exact PRNG used by web Event selection; not the offline Daily shuffler. */
export const createSeededRandom = (seed: number) => {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function getEventWordPermutation(answerSeed: string): readonly number[] {
  // No mutable global cache: experiment seeds do not accumulate for process life.
  const random = createSeededRandom(hashSeed(answerSeed))
  const permutation = Array.from({ length: WORDS.length }, (_, index) => index)
  for (let i = permutation.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const current = permutation[i]
    permutation[i] = permutation[j]
    permutation[j] = current
  }
  return Object.freeze(permutation)
}

/** Seed selection only: seasonal mechanics and active Event policy stay outside. */
export function getEventWordOfDay(
  answerSeed: string,
  date: CalendarDateInput,
): {
  solution: string
  solutionIndex: number
} {
  const dayIndex = getDayIndex(date)
  const permutation = getEventWordPermutation(answerSeed)
  const permutationIndex =
    ((dayIndex % permutation.length) + permutation.length) % permutation.length
  const solutionIndex = permutation[permutationIndex]
  return { solution: WORDS[solutionIndex], solutionIndex }
}
