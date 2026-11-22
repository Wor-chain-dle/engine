import { CONFIG, RULES_VERSION } from './config.js'
import { getChainInfo, isChainDeadEnd, type ChainInfo } from './chain.js'
import { DICTIONARY_VERSION, isWordInWordList } from './dictionary.js'
import { getGuessStatuses, type CharStatus } from './statuses.js'

export type EndReason = 'win' | 'dead_end' | 'guess_limit'
export type GameStatus = 'playing' | 'won' | 'lost'

/** Privileged engine state. Never pass this object to a solver or untrusted UI. */
export type GameState = Readonly<{
  rulesVersion: typeof RULES_VERSION
  dictionaryVersion: typeof DICTIONARY_VERSION
  solution: string
  guesses: readonly string[]
  endReason: EndReason | null
}>

export type GuessObservation = Readonly<{
  word: string
  feedback: readonly CharStatus[]
}>

export type Observation = Readonly<{
  rulesVersion: typeof RULES_VERSION
  dictionaryVersion: typeof DICTIONARY_VERSION
  wordLength: number
  maxGuesses: number
  guesses: readonly GuessObservation[]
  guessCount: number
  remainingGuesses: number
  chain: Readonly<ChainInfo> | null
  status: GameStatus
  endReason: EndReason | null
}>

export type ActionError =
  | 'game_over'
  | 'invalid_type'
  | 'invalid_length'
  | 'invalid_characters'
  | 'not_in_dictionary'
  | 'chain_mismatch'

export type StepResult =
  | Readonly<{
      accepted: true
      state: GameState
      observation: Observation
    }>
  | Readonly<{
      accepted: false
      error: ActionError
      state: GameState
      observation: Observation
    }>

function freezeState(
  solution: string,
  guesses: readonly string[],
  endReason: EndReason | null,
): GameState {
  return Object.freeze({
    rulesVersion: RULES_VERSION,
    dictionaryVersion: DICTIONARY_VERSION,
    solution,
    guesses: Object.freeze([...guesses]),
    endReason,
  })
}

/** Accepts both answer-list words and allowed guesses, as Custom mode does. */
export function createGame({ solution }: { solution: string }): GameState {
  if (typeof solution !== 'string' || !isWordInWordList(solution)) {
    throw new RangeError('Solution must be a word in the bundled dictionary')
  }
  return freezeState(solution, [], null)
}

/** A fresh, deeply frozen view without the solution or references to internal state. */
export function observe(state: GameState): Observation {
  const guesses = state.guesses.map((word) =>
    Object.freeze({
      word,
      feedback: Object.freeze(getGuessStatuses([...word], state.solution)),
    }),
  )
  const chain = state.endReason
    ? null
    : getChainInfo(state.guesses.map((word) => [...word]))
  return Object.freeze({
    rulesVersion: RULES_VERSION,
    dictionaryVersion: DICTIONARY_VERSION,
    wordLength: CONFIG.wordLength,
    maxGuesses: CONFIG.tries,
    guesses: Object.freeze(guesses),
    guessCount: guesses.length,
    remainingGuesses: CONFIG.tries - guesses.length,
    chain: chain ? Object.freeze(chain) : null,
    status:
      state.endReason === null
        ? 'playing'
        : state.endReason === 'win'
          ? 'won'
          : 'lost',
    endReason: state.endReason,
  })
}

/** Pure transition. Actions are full lowercase words including the locked letter. */
export function step(state: GameState, word: unknown): StepResult {
  const reject = (error: ActionError): StepResult =>
    Object.freeze({
      accepted: false,
      error,
      state,
      observation: observe(state),
    })
  if (state.endReason !== null) return reject('game_over')
  if (typeof word !== 'string') return reject('invalid_type')
  if ([...word].length !== CONFIG.wordLength) return reject('invalid_length')
  if (!/^[a-z]{5}$/.test(word)) return reject('invalid_characters')
  if (!isWordInWordList(word)) return reject('not_in_dictionary')
  const rows = state.guesses.map((guess) => [...guess])
  const chain = getChainInfo(rows)
  if (
    chain &&
    word[chain.position === 'first' ? 0 : CONFIG.wordLength - 1] !==
      chain.letter
  ) {
    return reject('chain_mismatch')
  }

  const guesses = [...state.guesses, word]
  const nextRows = [...rows, [...word]]
  let endReason: EndReason | null = null
  if (word === state.solution) {
    endReason = 'win'
  } else if (
    guesses.length === CONFIG.tries - 1 &&
    isChainDeadEnd(nextRows, [...state.solution])
  ) {
    endReason = 'dead_end'
  } else if (guesses.length === CONFIG.tries) {
    endReason = 'guess_limit'
  }
  const next = freezeState(state.solution, guesses, endReason)
  return Object.freeze({
    accepted: true,
    state: next,
    observation: observe(next),
  })
}

/** Restore trusted submitted guesses through the same validation and transitions. */
export function replayGame({
  solution,
  guesses,
}: {
  solution: string
  guesses: readonly string[]
}): GameState {
  let state = createGame({ solution })
  guesses.forEach((word, index) => {
    const result = step(state, word)
    if (!result.accepted) {
      throw new RangeError(
        `Invalid replay action ${index + 1}: ${result.error}`,
      )
    }
    state = result.state
  })
  return state
}
