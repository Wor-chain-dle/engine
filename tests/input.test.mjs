import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGame,
  observe,
  replayGame,
  step,
  createInputSession,
  observeInput,
  applyInput,
  INPUT_PROTOCOL_VERSION,
  INPUT_FEEDBACK_CODES,
  ALLOWED_WORDS,
  getRandomWord,
  createSeededRandom,
} from '../dist/index.js'
import { createUpstream } from './upstream.mjs'

function typeText(session, text) {
  for (const letter of text) {
    const result = applyInput(session, { type: 'type', letter })
    assert.equal(result.accepted, true)
    session = result.state
  }
  return session
}

test('key input exposes only draft state until Enter and then shares the core result', () => {
  let session = createInputSession(createGame({ solution: 'crane' }))
  assert.equal(
    observeInput(session).inputProtocolVersion,
    INPUT_PROTOCOL_VERSION,
  )
  assert.deepEqual(observeInput(session).input.cells, Array(5).fill(null))
  session = typeText(session, 'stale')
  const draft = observeInput(session)
  assert.equal(draft.input.editableText, 'stale')
  assert.deepEqual(draft.input.cells, [...'stale'])
  assert.equal(draft.input.isComplete, true)
  assert.deepEqual(draft.guesses, [])
  assert.equal('solution' in draft, false)
  assert.equal(JSON.stringify(draft).includes('crane'), false)
  const submitted = applyInput(session, { type: 'enter' })
  assert.equal(submitted.accepted, true)
  assert.equal(submitted.feedback.code, 'word_submitted')
  assert.deepEqual(submitted.state.game, step(session.game, 'stale').state)
  assert.equal(submitted.state.buffer, '')
  assert.equal(submitted.state.stats.enterPresses, 1)
  assert.equal(submitted.state.stats.validSubmissions, 1)
})

test('chain lock alternates correctly and cannot be typed over or deleted', () => {
  let session = createInputSession(createGame({ solution: 'crane' }))
  session = applyInput(session, { type: 'submit', word: 'stale' }).state
  assert.deepEqual(observeInput(session).input.cells, [
    null,
    null,
    null,
    null,
    'e',
  ])
  assert.equal(observeInput(session).input.lockedIndex, 4)
  session = applyInput(session, { type: 'backspace' }).state
  assert.deepEqual(observeInput(session).input.cells, [
    null,
    null,
    null,
    null,
    'e',
  ])
  session = typeText(session, 'blaz')
  assert.equal(
    applyInput(session, { type: 'type', letter: 'x' }).feedback.code,
    'input_full',
  )
  session = applyInput(session, { type: 'enter' }).state
  assert.deepEqual(session.game.guesses, ['stale', 'blaze'])
  assert.deepEqual(observeInput(session).input.cells, [
    'b',
    null,
    null,
    null,
    null,
  ])
  assert.equal(observeInput(session).input.lockedIndex, 0)
  session = typeText(session, 'oost')
  session = applyInput(session, { type: 'backspace' }).state
  assert.deepEqual(observeInput(session).input.cells, [
    'b',
    'o',
    'o',
    's',
    null,
  ])
  session = typeText(session, 't')
  session = applyInput(session, { type: 'enter' }).state
  assert.deepEqual(session.game.guesses, ['stale', 'blaze', 'boost'])
  assert.equal(observeInput(session).input.lockedIndex, 4)
})

test('incomplete and unknown words preserve draft and consume no guess', () => {
  const initial = createInputSession(createGame({ solution: 'crane' }))
  const partial = typeText(initial, 'cr')
  const incomplete = applyInput(partial, { type: 'enter' })
  assert.equal(incomplete.accepted, false)
  assert.equal(incomplete.feedback.code, 'word_incomplete')
  assert.equal(incomplete.state.buffer, 'cr')
  assert.equal(incomplete.state.game, initial.game)
  assert.equal(incomplete.state.stats.incompleteSubmissions, 1)
  const unknown = typeText(initial, 'zzzzz')
  const invalid = applyInput(unknown, { type: 'enter' })
  assert.equal(invalid.feedback.code, 'word_not_found')
  assert.equal(invalid.state.buffer, 'zzzzz')
  assert.equal(invalid.state.game, initial.game)
  assert.equal(invalid.state.stats.invalidWordSubmissions, 1)
  assert.equal(invalid.observation.remainingGuesses, 6)
})

test('editing an invalid word can recover and win without consuming an extra guess', () => {
  let session = typeText(
    createInputSession(createGame({ solution: 'crane' })),
    'cranx',
  )
  session = applyInput(session, { type: 'enter' }).state
  session = applyInput(session, { type: 'backspace' }).state
  session = typeText(session, 'e')
  const result = applyInput(session, { type: 'enter' })
  assert.equal(result.feedback.code, 'win')
  assert.equal(result.observation.guessCount, 1)
  assert.equal(result.observation.input, null)
  assert.equal(result.state.stats.lettersTyped, 6)
  assert.equal(result.state.stats.backspacePresses, 1)
  assert.equal(result.state.stats.enterPresses, 2)
})

test('empty Backspace counts a real press; full-row typing does not insert a letter', () => {
  let session = createInputSession(createGame({ solution: 'crane' }))
  const empty = applyInput(session, { type: 'backspace' })
  assert.equal(empty.accepted, false)
  assert.equal(empty.feedback.code, 'input_empty')
  assert.equal(empty.state.stats.backspacesByInputLength[0], 1)
  session = typeText(empty.state, 'stale')
  const full = applyInput(session, { type: 'type', letter: 'a' })
  assert.equal(full.accepted, false)
  assert.equal(full.feedback.code, 'input_full')
  assert.equal(full.state.buffer, 'stale')
  assert.equal(full.state.stats.lettersTyped, 5)
  assert.equal(full.state.stats.actionCount, 7)
  assert.equal(full.state.stats.rejectedActions, 2)
})

test('atomic submissions use full words and record no synthetic key or delete presses', () => {
  let session = typeText(
    createInputSession(createGame({ solution: 'crane' })),
    'c',
  )
  const rejected = applyInput(session, { type: 'submit', word: 'zzzzz' })
  assert.equal(rejected.state.buffer, 'c')
  assert.equal(rejected.state.game, session.game)
  session = applyInput(rejected.state, { type: 'submit', word: 'stale' }).state
  assert.equal(session.buffer, '')
  assert.equal(session.stats.directSubmissions, 2)
  assert.equal(session.stats.enterPresses, 0)
  assert.equal(session.stats.lettersTyped, 1)
  assert.equal(session.stats.backspacePresses, 0)
  const lockViolation = applyInput(session, { type: 'submit', word: 'boost' })
  assert.equal(lockViolation.feedback.code, 'chain_mismatch')
  assert.equal(lockViolation.state.game, session.game)
  session = typeText(session, 'blaz')
  session = applyInput(session, { type: 'enter' }).state
  assert.deepEqual(session.game.guesses, ['stale', 'blaze'])
  assert.equal(session.stats.enterPresses, 1)
  assert.equal(session.stats.directSubmissions, 2)
})

test('direct and key modes produce the same core observations through a full game', () => {
  const words = ['stale', 'blaze', 'boost', 'first', 'forge', 'crane']
  let direct = createInputSession(createGame({ solution: 'crane' }))
  let keys = createInputSession(createGame({ solution: 'crane' }))
  for (const word of words) {
    const lock = observeInput(keys).chain
    const editable = !lock
      ? word
      : lock.position === 'first'
        ? word.slice(1)
        : word.slice(0, -1)
    keys = typeText(keys, editable)
    const keyResult = applyInput(keys, { type: 'enter' })
    const directResult = applyInput(direct, { type: 'submit', word })
    assert.equal(keyResult.feedback.code, directResult.feedback.code)
    assert.deepEqual(keyResult.observation, directResult.observation)
    keys = keyResult.state
    direct = directResult.state
  }
  assert.equal(direct.game.endReason, 'win')
  assert.equal(direct.stats.lettersTyped, 0)
  assert.equal(direct.stats.enterPresses, 0)
  assert.equal(direct.stats.directSubmissions, 6)
  assert.equal(keys.stats.enterPresses, 6)
  assert.equal(keys.stats.lettersTyped, 25)
})

test('terminal feedback preserves exact win, dead-end, and guess-limit semantics', () => {
  for (const [solution, guesses, reason, code] of [
    ['crane', ['crane'], 'win', 'win'],
    [
      'crane',
      ['stale', 'blaze', 'boost', 'first', 'flood'],
      'dead_end',
      'loss',
    ],
    [
      'crane',
      ['stale', 'blaze', 'boost', 'first', 'forge', 'pride'],
      'guess_limit',
      'loss',
    ],
  ]) {
    let session = createInputSession(createGame({ solution }))
    let result
    for (const word of guesses) {
      result = applyInput(session, { type: 'submit', word })
      session = result.state
    }
    assert.equal(result.feedback.code, code)
    assert.equal(result.observation.endReason, reason)
    assert.equal(result.observation.guessCount, guesses.length)
    for (const action of [
      { type: 'enter' },
      { type: 'backspace' },
      { type: 'type', letter: 'c' },
      { type: 'submit', word: 'crane' },
    ]) {
      const ended = applyInput(session, action)
      assert.equal(ended.feedback.code, 'game_over')
      assert.equal(ended.accepted, false)
      assert.equal(ended.state, session)
    }
  }
})

test('malformed actions and invalid letters return stable codes without corrupting state', () => {
  const initial = createInputSession(createGame({ solution: 'crane' }))
  for (const action of [
    null,
    [],
    '<submit>',
    { type: 'unknown' },
    { type: 'enter', word: 'crane' },
    { type: 'submit' },
    { type: 'type', letter: 1 },
    Object.assign(Object.create({ type: 'enter' }), { extra: 1 }),
  ]) {
    const result = applyInput(initial, action)
    assert.equal(result.feedback.code, 'invalid_action')
    assert.equal(result.state.buffer, '')
    assert.equal(result.state.game, initial.game)
    assert.equal(result.state.stats.actionCount, 1)
    assert.equal(result.state.stats.rejectedActions, 1)
  }
  for (const letter of ['', 'ab', 'C', ' ', '🍀']) {
    assert.equal(
      applyInput(initial, { type: 'type', letter }).feedback.code,
      'invalid_character',
    )
  }
  for (const [word, code] of [
    ['cr', 'word_incomplete'],
    ['cranes', 'invalid_length'],
    ['CRANE', 'invalid_character'],
  ]) {
    assert.equal(
      applyInput(initial, { type: 'submit', word }).feedback.code,
      code,
    )
  }
})

test('input state, feedback, counters, and observation are immutable and isolated', () => {
  const session = createInputSession(createGame({ solution: 'crane' }))
  const result = applyInput(session, { type: 'type', letter: 'c' })
  for (const value of [
    session,
    session.stats,
    session.stats.backspacesByInputLength,
    result,
    result.feedback,
    result.state,
    result.state.stats,
    result.state.stats.backspacesByInputLength,
    result.observation,
    result.observation.input,
    result.observation.input.cells,
  ]) {
    assert.equal(Object.isFrozen(value), true)
  }
  assert.equal(session.buffer, '')
  assert.equal(session.stats.actionCount, 0)
  assert.throws(
    () => result.state.stats.backspacesByInputLength.push(1),
    TypeError,
  )
  assert.throws(() => (result.observation.input.cells[0] = 'x'), TypeError)
  assert.equal(JSON.stringify(result.observation).includes('crane'), false)
  assert.deepEqual(observe(session.game), observe(result.state.game))
})

test('wrapping an existing game preserves it and does not invent historical action metrics', () => {
  const game = replayGame({ solution: 'crane', guesses: ['stale', 'blaze'] })
  const session = createInputSession(game)
  assert.equal(session.game, game)
  assert.equal(session.stats.validSubmissions, 0)
  assert.equal(observeInput(session).guessCount, 2)
  assert.deepEqual(observeInput(session).input.cells, [
    'b',
    null,
    null,
    null,
    null,
  ])
})

test('replaying JSON actions is deterministic and independent sessions do not interfere', () => {
  const actions = [...'cranx'].map((letter) => ({ type: 'type', letter }))
  actions.push(
    { type: 'enter' },
    { type: 'backspace' },
    { type: 'type', letter: 'e' },
    { type: 'enter' },
  )
  const replay = (history) =>
    history.reduce(
      (state, action) => applyInput(state, action).state,
      createInputSession(createGame({ solution: 'crane' })),
    )
  assert.deepEqual(replay(actions), replay(JSON.parse(JSON.stringify(actions))))
  const other = createInputSession(createGame({ solution: 'stale' }))
  assert.equal(other.stats.actionCount, 0)
  assert.equal(other.game.endReason, null)
})

test('character actions and input-stat calls match the original React handlers', () => {
  const original = createUpstream()
  const random = createSeededRandom(197)
  for (let gameIndex = 0; gameIndex < 50; gameIndex++) {
    const solution = getRandomWord(random)
    const web = original.createInputHarness(solution)
    let session = createInputSession(createGame({ solution }))
    const compare = (action) => {
      const expected = web.apply(action)
      const result = applyInput(session, action)
      session = result.state
      assert(INPUT_FEEDBACK_CODES.includes(result.feedback.code))
      assert.equal(session.buffer, expected.buffer)
      assert.deepEqual(session.game.guesses, expected.guesses)
      assert.equal(session.game.endReason, expected.endReason)
      for (const [key, value] of Object.entries(expected.counters)) {
        assert.deepEqual(session.stats[key], value, key)
      }
    }
    while (session.game.endReason === null) {
      compare({ type: 'enter' })
      compare({ type: 'backspace' })
      const input = observeInput(session).input
      for (let i = 0; i < input.maxEditableLength; i++)
        compare({ type: 'type', letter: 'z' })
      compare({ type: 'enter' })
      compare({ type: 'type', letter: 'x' })
      for (let i = 0; i < input.maxEditableLength; i++)
        compare({ type: 'backspace' })
      const chain = observeInput(session).chain
      const legal = ALLOWED_WORDS.filter(
        (word) =>
          !chain || word[chain.position === 'first' ? 0 : 4] === chain.letter,
      )
      const word =
        legal.includes(solution) && random() < 0.3
          ? solution
          : legal[Math.floor(random() * legal.length)]
      const editable = !chain
        ? word
        : chain.position === 'first'
          ? word.slice(1)
          : word.slice(0, -1)
      for (const letter of editable) compare({ type: 'type', letter })
      compare({ type: 'enter' })
    }
    compare({ type: 'type', letter: 'c' })
    compare({ type: 'backspace' })
    compare({ type: 'enter' })
  }
})
