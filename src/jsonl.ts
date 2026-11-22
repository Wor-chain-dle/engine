import { createGame } from './game.js'
import {
  applyInput,
  createInputSession,
  observeInput,
  INPUT_PROTOCOL_VERSION,
  type InputSession,
  type InputObservation,
  type InputStats,
  type InputResult,
} from './input.js'
import { RULES_VERSION } from './config.js'
import { SELECTION_VERSION } from './selection.js'
import {
  ALLOWED_WORDS,
  WORDS,
  DICTIONARY_VERSION,
  DICTIONARY_METADATA,
} from './dictionary.js'

export const JSONL_PROTOCOL_VERSION = 'jsonl-v1' as const
export const JSONL_LIMITS = Object.freeze({
  maxSessions: 128,
  maxBatchActions: 128,
  maxRequestBytes: 65536,
})

export type RequestId = string | number
export type JsonlErrorCode =
  | 'invalid_json'
  | 'line_too_long'
  | 'invalid_request'
  | 'unsupported_version'
  | 'unknown_operation'
  | 'session_exists'
  | 'session_not_found'
  | 'session_limit'
  | 'invalid_solution'
  | 'batch_limit'

type Envelope = Readonly<{
  id: RequestId
  protocolVersion: typeof JSONL_PROTOCOL_VERSION
}>
export type JsonlRequest = Envelope &
  (
    | { op: 'info' | 'dictionary' }
    | { op: 'create' | 'reset'; sessionId: string; solution: string }
    | { op: 'observe' | 'drop'; sessionId: string }
    | { op: 'act'; sessionId: string; action: unknown }
    | { op: 'batch'; sessionId: string; actions: readonly unknown[] }
  )

type ActionView = Readonly<{
  accepted: boolean
  feedback: InputResult['feedback']
  observation: InputObservation
  stats: InputStats
}>
type SessionView = Readonly<{
  sessionId: string
  observation: InputObservation
  stats: InputStats
}>
type Info = Readonly<{
  engineVersion: string
  jsonlProtocolVersion: typeof JSONL_PROTOCOL_VERSION
  rulesVersion: typeof RULES_VERSION
  dictionaryVersion: typeof DICTIONARY_VERSION
  selectionVersion: typeof SELECTION_VERSION
  inputProtocolVersion: typeof INPUT_PROTOCOL_VERSION
  limits: typeof JSONL_LIMITS
}>
type ResultData =
  | Info
  | SessionView
  | (ActionView & { sessionId: string })
  | Readonly<{ sessionId: string; results: readonly ActionView[] }>
  | Readonly<{ sessionId: string }>
  | Readonly<{
      dictionaryVersion: typeof DICTIONARY_VERSION
      metadata: typeof DICTIONARY_METADATA
      answers: readonly string[]
      allowedWords: readonly string[]
    }>

export type JsonlResponse =
  | Readonly<{
      protocolVersion: typeof JSONL_PROTOCOL_VERSION
      id: RequestId
      ok: true
      result: ResultData
    }>
  | Readonly<{
      protocolVersion: typeof JSONL_PROTOCOL_VERSION
      id: RequestId | null
      ok: false
      error: Readonly<{ code: JsonlErrorCode }>
    }>

export function jsonlError(
  id: RequestId | null,
  code: JsonlErrorCode,
): JsonlResponse {
  return Object.freeze({
    protocolVersion: JSONL_PROTOCOL_VERSION,
    id,
    ok: false,
    error: Object.freeze({ code }),
  })
}

function validId(value: unknown): value is RequestId {
  return typeof value === 'string'
    ? value.length > 0 && value.length <= 128
    : typeof value === 'number' && Number.isSafeInteger(value)
}

function actionView(result: InputResult): ActionView {
  // Explicit allowlist: never spread the privileged InputResult or session.
  return Object.freeze({
    accepted: result.accepted,
    feedback: result.feedback,
    observation: result.observation,
    stats: result.state.stats,
  })
}

/** Process-local dispatcher. No I/O, current clock, or implicit answer selection. */
export function createJsonlDispatcher(
  engineVersion: string,
): (value: unknown) => JsonlResponse {
  const sessions = new Map<string, InputSession>()
  return (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return jsonlError(null, 'invalid_request')
    }
    const request = value as Record<string, unknown>
    const id = validId(request.id) ? request.id : null
    if (id === null || typeof request.op !== 'string')
      return jsonlError(id, 'invalid_request')
    if (request.protocolVersion !== JSONL_PROTOCOL_VERSION)
      return jsonlError(id, 'unsupported_version')
    const allowed: Record<string, readonly string[]> = {
      info: [],
      dictionary: [],
      create: ['sessionId', 'solution'],
      reset: ['sessionId', 'solution'],
      observe: ['sessionId'],
      drop: ['sessionId'],
      act: ['sessionId', 'action'],
      batch: ['sessionId', 'actions'],
    }
    if (!Object.prototype.hasOwnProperty.call(allowed, request.op))
      return jsonlError(id, 'unknown_operation')
    const fields = ['id', 'protocolVersion', 'op', ...allowed[request.op]]
    if (
      Object.keys(request).length !== fields.length ||
      !fields.every((key) => Object.prototype.hasOwnProperty.call(request, key))
    ) {
      return jsonlError(id, 'invalid_request')
    }
    const success = (result: ResultData): JsonlResponse =>
      Object.freeze({
        protocolVersion: JSONL_PROTOCOL_VERSION,
        id,
        ok: true,
        result: Object.freeze(result),
      })
    if (request.op === 'info')
      return success({
        engineVersion,
        jsonlProtocolVersion: JSONL_PROTOCOL_VERSION,
        rulesVersion: RULES_VERSION,
        dictionaryVersion: DICTIONARY_VERSION,
        selectionVersion: SELECTION_VERSION,
        inputProtocolVersion: INPUT_PROTOCOL_VERSION,
        limits: JSONL_LIMITS,
      })
    if (request.op === 'dictionary')
      return success({
        dictionaryVersion: DICTIONARY_VERSION,
        metadata: DICTIONARY_METADATA,
        answers: WORDS,
        allowedWords: ALLOWED_WORDS,
      })

    const sessionId = request.sessionId
    if (
      typeof sessionId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)
    ) {
      return jsonlError(id, 'invalid_request')
    }
    const view = (session: InputSession): SessionView => ({
      sessionId,
      observation: observeInput(session),
      stats: session.stats,
    })
    if (request.op === 'create' || request.op === 'reset') {
      if (typeof request.solution !== 'string')
        return jsonlError(id, 'invalid_request')
      if (request.op === 'create' && sessions.has(sessionId))
        return jsonlError(id, 'session_exists')
      if (request.op === 'reset' && !sessions.has(sessionId))
        return jsonlError(id, 'session_not_found')
      if (request.op === 'create' && sessions.size >= JSONL_LIMITS.maxSessions)
        return jsonlError(id, 'session_limit')
      let session: InputSession
      try {
        session = createInputSession(createGame({ solution: request.solution }))
      } catch (error) {
        if (error instanceof RangeError)
          return jsonlError(id, 'invalid_solution')
        throw error
      }
      sessions.set(sessionId, session)
      return success(view(session))
    }
    let session = sessions.get(sessionId)
    if (!session) return jsonlError(id, 'session_not_found')
    switch (request.op) {
      case 'observe':
        return success(view(session))
      case 'drop':
        sessions.delete(sessionId)
        return success({ sessionId })
      case 'act': {
        const result = applyInput(session, request.action)
        sessions.set(sessionId, result.state)
        return success({ sessionId, ...actionView(result) })
      }
      case 'batch': {
        if (!Array.isArray(request.actions))
          return jsonlError(id, 'invalid_request')
        if (
          request.actions.length === 0 ||
          request.actions.length > JSONL_LIMITS.maxBatchActions
        )
          return jsonlError(id, 'batch_limit')
        const results = request.actions.map((action) => {
          const result = applyInput(session!, action)
          session = result.state
          return actionView(result)
        })
        sessions.set(sessionId, session)
        return success({ sessionId, results: Object.freeze(results) })
      }
      default:
        return jsonlError(id, 'unknown_operation')
    }
  }
}
