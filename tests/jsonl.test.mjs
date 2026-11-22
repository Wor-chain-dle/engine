import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createJsonlDispatcher,
  JSONL_PROTOCOL_VERSION,
  JSONL_LIMITS,
} from '../dist/jsonl.js'
import { createGame, createInputSession, applyInput } from '../dist/index.js'

const envelope = (op, fields = {}, id = 1) => ({
  id,
  protocolVersion: JSONL_PROTOCOL_VERSION,
  op,
  ...fields,
})

test('dispatcher reports metadata and only allowlisted session fields', () => {
  const dispatch = createJsonlDispatcher('1.0.0')
  assert.equal(dispatch(envelope('info')).result.engineVersion, '1.0.0')
  assert.equal(dispatch(envelope('dictionary')).result.answers.length, 2315)
  const created = dispatch(
    envelope('create', { sessionId: 'a', solution: 'crane' }),
  )
  assert.equal(created.ok, true)
  assert.deepEqual(Object.keys(created.result).sort(), [
    'observation',
    'sessionId',
    'stats',
  ])
  assert(!JSON.stringify(created).includes('crane'))
  let core = createInputSession(createGame({ solution: 'crane' }))
  for (const action of [
    { type: 'enter' },
    { type: 'type', letter: 'c' },
    { type: 'backspace' },
    { type: 'submit', word: 'stale' },
  ]) {
    const expected = applyInput(core, action)
    core = expected.state
    const actual = dispatch(envelope('act', { sessionId: 'a', action }))
    assert.equal(actual.ok, true)
    assert.deepEqual(actual.result, {
      sessionId: 'a',
      accepted: expected.accepted,
      feedback: expected.feedback,
      observation: expected.observation,
      stats: core.stats,
    })
    assert(!('state' in actual.result))
  }
})

test('sessions, resets, duplicate creation, dropping and dispatchers are isolated', () => {
  const dispatch = createJsonlDispatcher('test')
  for (const id of ['a', 'b'])
    dispatch(envelope('create', { sessionId: id, solution: 'crane' }))
  dispatch(
    envelope('act', { sessionId: 'a', action: { type: 'type', letter: 'c' } }),
  )
  assert.equal(
    dispatch(envelope('observe', { sessionId: 'b' })).result.observation.input
      .editableText,
    '',
  )
  assert.equal(
    dispatch(envelope('create', { sessionId: 'a', solution: 'stale' })).error
      .code,
    'session_exists',
  )
  assert.equal(
    dispatch(envelope('reset', { sessionId: 'a', solution: 'zzzzz' })).error
      .code,
    'invalid_solution',
  )
  assert.equal(
    dispatch(envelope('observe', { sessionId: 'a' })).result.observation.input
      .editableText,
    'c',
  )
  const reset = dispatch(
    envelope('reset', { sessionId: 'a', solution: 'stale' }),
  )
  assert.equal(reset.result.stats.actionCount, 0)
  assert.equal(reset.result.observation.input.editableText, '')
  assert.equal(
    dispatch(
      envelope('act', {
        sessionId: 'a',
        action: { type: 'submit', word: 'stale' },
      }),
    ).result.feedback.code,
    'win',
  )
  assert.equal(
    createJsonlDispatcher('test')(envelope('observe', { sessionId: 'b' })).error
      .code,
    'session_not_found',
  )
  assert.equal(dispatch(envelope('drop', { sessionId: 'a' })).ok, true)
  assert.equal(
    dispatch(envelope('observe', { sessionId: 'a' })).error.code,
    'session_not_found',
  )
})

test('batch matches sequential actions including rejections and terminal no-ops', () => {
  const actions = [
    { type: 'enter' },
    null,
    { type: 'submit', word: 'crane' },
    { type: 'backspace' },
  ]
  const dispatch = createJsonlDispatcher('test')
  dispatch(envelope('create', { sessionId: 'a', solution: 'crane' }))
  const result = dispatch(envelope('batch', { sessionId: 'a', actions }))
  assert.equal(result.ok, true)
  let core = createInputSession(createGame({ solution: 'crane' }))
  actions.forEach((action, index) => {
    const expected = applyInput(core, action)
    core = expected.state
    assert.deepEqual(result.result.results[index], {
      accepted: expected.accepted,
      feedback: expected.feedback,
      observation: expected.observation,
      stats: core.stats,
    })
  })
  assert.equal(
    dispatch(envelope('observe', { sessionId: 'a' })).result.stats.actionCount,
    3,
  )
})

test('invalid envelopes and limits do not mutate sessions', () => {
  const dispatch = createJsonlDispatcher('test')
  dispatch(envelope('create', { sessionId: 'a', solution: 'crane' }))
  for (const request of [
    null,
    [],
    {},
    envelope('act', { sessionId: 'a' }),
    envelope('observe', { sessionId: 'a', extra: true }),
    envelope('observe', { sessionId: 'bad id' }),
    envelope('info', {}, NaN),
  ]) {
    assert.equal(dispatch(request).ok, false)
  }
  assert.equal(
    dispatch({ ...envelope('info'), protocolVersion: 'wrong' }).error.code,
    'unsupported_version',
  )
  assert.equal(
    dispatch(envelope('constructor')).error.code,
    'unknown_operation',
  )
  assert.equal(
    dispatch(envelope('batch', { sessionId: 'a', actions: [] })).error.code,
    'batch_limit',
  )
  assert.equal(
    dispatch(
      envelope('batch', {
        sessionId: 'a',
        actions: Array(129).fill({ type: 'enter' }),
      }),
    ).error.code,
    'batch_limit',
  )
  assert.equal(
    dispatch(envelope('observe', { sessionId: 'a' })).result.stats.actionCount,
    0,
  )
  for (let index = 1; index < JSONL_LIMITS.maxSessions; index++) {
    assert.equal(
      dispatch(
        envelope('create', { sessionId: 's' + index, solution: 'crane' }),
      ).ok,
      true,
    )
  }
  assert.equal(
    dispatch(envelope('create', { sessionId: 'overflow', solution: 'crane' }))
      .error.code,
    'session_limit',
  )
  dispatch(envelope('drop', { sessionId: 'a' }))
  assert.equal(
    dispatch(envelope('create', { sessionId: 'overflow', solution: 'crane' }))
      .ok,
    true,
  )
})

test(
  'CLI handles chunks, CRLF, invalid JSON/UTF-8, oversized frames, and final EOF frame',
  { timeout: 10000 },
  async (t) => {
    const cli = new URL('../bin/wor-chain-dle-jsonl.mjs', import.meta.url)
    const child = spawn(process.execPath, [fileURLToPath(cli)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    t.after(() => {
      if (child.exitCode === null) child.kill()
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (data) => {
      stdout += data
    })
    child.stderr.setEncoding('utf8').on('data', (data) => {
      stderr += data
    })
    const exited = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', resolve)
    })
    const first = JSON.stringify(envelope('info', {}, 'unicode-🍀'))
    // Split a UTF-8 code point across writes to exercise byte framing.
    const bytes = Buffer.from(first)
    const position = bytes.indexOf(Buffer.from('🍀')) + 1
    child.stdin.write(bytes.subarray(0, position))
    child.stdin.write(bytes.subarray(position))
    child.stdin.write('\r\nnot json\n')
    child.stdin.write(Buffer.from([0xff, 0x0a]))
    child.stdin.write('x'.repeat(JSONL_LIMITS.maxRequestBytes + 1) + '\n')
    child.stdin.write(JSON.stringify(envelope('info', {}, 2)) + '\n')
    child.stdin.end(JSON.stringify(envelope('info', {}, 3)))
    assert.equal(await exited, 0)
    assert.equal(stderr, '')
    const responses = stdout.trim().split('\n').map(JSON.parse)
    assert.equal(responses.length, 6)
    assert.equal(responses[0].id, 'unicode-🍀')
    assert.equal(responses[1].error.code, 'invalid_json')
    assert.equal(responses[2].error.code, 'invalid_json')
    assert.equal(responses[3].error.code, 'line_too_long')
    assert.equal(responses[4].id, 2)
    assert.equal(responses[5].id, 3)
    assert.equal(responses[5].ok, true)
  },
)
