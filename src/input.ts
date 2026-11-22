import { CONFIG } from './config.js'
import {
  observe,
  step,
  type GameState,
  type Observation,
  type ActionError,
} from './game.js'

/** Version of actions, feedback codes, input observations, and counter semantics. */
export const INPUT_PROTOCOL_VERSION = 'input-v1' as const

export type InputAction =
  | Readonly<{ type: 'type'; letter: string }>
  | Readonly<{ type: 'backspace' }>
  | Readonly<{ type: 'enter' }>
  | Readonly<{ type: 'submit'; word: string }>

export const INPUT_FEEDBACK_CODES = Object.freeze([
  'letter_typed',
  'letter_deleted',
  'word_submitted',
  'win',
  'loss',
  'word_incomplete',
  'word_not_found',
  'input_full',
  'input_empty',
  'invalid_action',
  'invalid_character',
  'invalid_length',
  'chain_mismatch',
  'game_over',
] as const)

export type InputFeedbackCode = (typeof INPUT_FEEDBACK_CODES)[number]

/** Cumulative actions observed since this input session was created. No clock reads. */
export type InputStats = Readonly<{
  actionCount: number
  lettersTyped: number
  backspacePresses: number
  backspacesByInputLength: readonly number[]
  enterPresses: number
  directSubmissions: number
  validSubmissions: number
  incompleteSubmissions: number
  invalidWordSubmissions: number
  rejectedActions: number
}>

/** Privileged session: game contains the solution. Send only observeInput() to agents. */
export type InputSession = Readonly<{
  game: GameState
  /** Editable letters only; never includes the locked chain letter. */
  buffer: string
  stats: InputStats
}>

export type InputDraft = Readonly<{
  editableText: string
  cells: readonly (string | null)[]
  lockedIndex: number | null
  maxEditableLength: number
  isComplete: boolean
}>

export type InputObservation = Observation &
  Readonly<{
    inputProtocolVersion: typeof INPUT_PROTOCOL_VERSION
    /** No active draft after game termination. */
    input: InputDraft | null
  }>

export type InputResult = Readonly<{
  /** True when input was edited or a valid word was submitted, including a loss. */
  accepted: boolean
  feedback: Readonly<{ code: InputFeedbackCode }>
  state: InputSession
  observation: InputObservation
}>

function freezeSession(
  game: GameState,
  buffer: string,
  stats: InputStats,
): InputSession {
  return Object.freeze({
    game,
    buffer,
    stats: Object.freeze({
      ...stats,
      backspacesByInputLength: Object.freeze([
        ...stats.backspacesByInputLength,
      ]),
    }),
  })
}

/** Attach input handling to an existing game; historical input metrics are not inferred. */
export function createInputSession(game: GameState): InputSession {
  return freezeSession(game, '', {
    actionCount: 0,
    lettersTyped: 0,
    backspacePresses: 0,
    backspacesByInputLength: Array(CONFIG.wordLength + 1).fill(0),
    enterPresses: 0,
    directSubmissions: 0,
    validSubmissions: 0,
    incompleteSubmissions: 0,
    invalidWordSubmissions: 0,
    rejectedActions: 0,
  })
}

/** A model-neutral view; no dictionary-validity hint or partial-answer feedback. */
export function observeInput(session: InputSession): InputObservation {
  const game = observe(session.game)
  let input: InputDraft | null = null
  if (game.status === 'playing') {
    const lockedIndex = game.chain
      ? game.chain.position === 'first'
        ? 0
        : CONFIG.wordLength - 1
      : null
    const cells: (string | null)[] = Array(CONFIG.wordLength).fill(null)
    if (lockedIndex !== null && game.chain)
      cells[lockedIndex] = game.chain.letter
    const offset = lockedIndex === 0 ? 1 : 0
    for (let index = 0; index < session.buffer.length; index++) {
      cells[index + offset] = session.buffer[index]
    }
    const maxEditableLength = game.chain
      ? CONFIG.wordLength - 1
      : CONFIG.wordLength
    input = Object.freeze({
      editableText: session.buffer,
      cells: Object.freeze(cells),
      lockedIndex,
      maxEditableLength,
      isComplete: session.buffer.length === maxEditableLength,
    })
  }
  return Object.freeze({
    ...game,
    inputProtocolVersion: INPUT_PROTOCOL_VERSION,
    input,
  })
}

function parseAction(value: unknown): InputAction | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  const action = value as Record<string, unknown>
  const keys = Object.keys(action)
  if (
    (action.type === 'backspace' || action.type === 'enter') &&
    keys.length === 1 &&
    keys[0] === 'type'
  ) {
    return { type: action.type }
  }
  if (
    action.type === 'type' &&
    keys.length === 2 &&
    keys.includes('type') &&
    keys.includes('letter') &&
    typeof action.letter === 'string'
  ) {
    return { type: 'type', letter: action.letter }
  }
  if (
    action.type === 'submit' &&
    keys.length === 2 &&
    keys.includes('type') &&
    keys.includes('word') &&
    typeof action.word === 'string'
  ) {
    return { type: 'submit', word: action.word }
  }
  return null
}

function submissionError(error: ActionError, word: string): InputFeedbackCode {
  switch (error) {
    case 'invalid_length':
      return [...word].length < CONFIG.wordLength
        ? 'word_incomplete'
        : 'invalid_length'
    case 'not_in_dictionary':
      return 'word_not_found'
    case 'invalid_characters':
      return 'invalid_character'
    case 'invalid_type':
      return 'invalid_action'
    default:
      return error
  }
}

/**
 * Accepts untrusted JSON-shaped actions, but expects a session created by this API.
 * Enter submits the draft; submit validates a complete word atomically. Successful
 * submission clears the draft. Failed submission preserves it, including direct mode.
 */
export function applyInput(session: InputSession, value: unknown): InputResult {
  const result = (
    state: InputSession,
    accepted: boolean,
    code: InputFeedbackCode,
  ): InputResult =>
    Object.freeze({
      accepted,
      feedback: Object.freeze({ code }),
      state,
      observation: observeInput(state),
    })

  // Mirrors the web: actions after termination do not count as in-game activity.
  if (session.game.endReason !== null)
    return result(session, false, 'game_over')
  const stats = {
    ...session.stats,
    actionCount: session.stats.actionCount + 1,
    backspacesByInputLength: [...session.stats.backspacesByInputLength],
  }
  const reject = (code: InputFeedbackCode): InputResult => {
    stats.rejectedActions++
    return result(
      freezeSession(session.game, session.buffer, stats),
      false,
      code,
    )
  }
  const action = parseAction(value)
  if (!action) return reject('invalid_action')

  if (action.type === 'type') {
    if (!/^[a-z]$/.test(action.letter)) return reject('invalid_character')
    const maximum = observeInput(session).input!.maxEditableLength
    if (session.buffer.length === maximum) return reject('input_full')
    stats.lettersTyped++
    return result(
      freezeSession(session.game, session.buffer + action.letter, stats),
      true,
      'letter_typed',
    )
  }
  if (action.type === 'backspace') {
    stats.backspacePresses++
    stats.backspacesByInputLength[session.buffer.length]++
    if (session.buffer.length === 0) return reject('input_empty')
    return result(
      freezeSession(session.game, session.buffer.slice(0, -1), stats),
      true,
      'letter_deleted',
    )
  }

  let word: string
  if (action.type === 'enter') {
    stats.enterPresses++
    const input = observeInput(session).input!
    if (!input.isComplete) {
      stats.incompleteSubmissions++
      return reject('word_incomplete')
    }
    word = input.cells.join('')
  } else {
    stats.directSubmissions++
    word = action.word
  }

  const submission = step(session.game, word)
  if (!submission.accepted) {
    const code = submissionError(submission.error, word)
    if (code === 'word_incomplete') stats.incompleteSubmissions++
    if (code === 'word_not_found') stats.invalidWordSubmissions++
    return reject(code)
  }
  stats.validSubmissions++
  const feedback =
    submission.state.endReason === 'win'
      ? 'win'
      : submission.state.endReason === null
        ? 'word_submitted'
        : 'loss'
  return result(freezeSession(submission.state, '', stats), true, feedback)
}
