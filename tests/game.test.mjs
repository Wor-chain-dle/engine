import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGame,
  observe,
  step,
  replayGame,
  WORDS,
  VALIDGUESSES,
  ALLOWED_WORDS,
  ORTHOGRAPHY,
  getGuessStatuses,
  getRandomWord,
  createSeededRandom,
  getDailyWord,
} from '../dist/index.js'

test('new game and nested observations are frozen and exclude the hidden answer', () => {
  const initial = createGame({ solution: 'crane' })
  const first = observe(initial)
  assert.equal(first.status, 'playing')
  assert.equal(first.guessCount, 0)
  assert.equal(first.remainingGuesses, 6)
  assert.equal(first.chain, null)
  assert.equal(JSON.stringify(first).includes('crane'), false)
  assert.equal('solution' in first, false)
  const result = step(initial, 'stale')
  assert.equal(result.accepted, true)
  assert.equal(initial.guesses.length, 0)
  assert.deepEqual(result.observation.chain, { letter: 'e', position: 'last' })
  for (const value of [
    initial,
    initial.guesses,
    result,
    result.state,
    result.state.guesses,
    result.observation,
    result.observation.guesses,
    result.observation.guesses[0],
    result.observation.guesses[0].feedback,
    result.observation.chain,
  ]) {
    assert.equal(Object.isFrozen(value), true)
  }
  assert.throws(() => result.state.guesses.push('crane'), TypeError)
  assert.equal(JSON.stringify(result.observation).includes('crane'), false)
})

test('invalid actions leave the exact state intact and report structured errors', () => {
  const initial = createGame({ solution: 'crane' })
  for (const [action, error] of [
    [null, 'invalid_type'],
    [12345, 'invalid_type'],
    ['abcd', 'invalid_length'],
    ['abcdef', 'invalid_length'],
    ['CRANE', 'invalid_characters'],
    ['cr ne', 'invalid_characters'],
    ['zzzzz', 'not_in_dictionary'],
  ]) {
    const result = step(initial, action)
    assert.equal(result.accepted, false)
    assert.equal(result.error, error)
    assert.equal(result.state, initial)
  }
  const next = step(initial, 'stale').state
  assert.equal(step(next, 'boost').error, 'chain_mismatch')
  assert.equal(step(next, 'boost').state, next)
})

test('duplicate-letter matches consume exact occurrences before present occurrences', () => {
  assert.deepEqual(getGuessStatuses([...'allee'], 'apple'), [
    'correct',
    'present',
    'absent',
    'absent',
    'correct',
  ])
})

test('chain mismatch with solution does not end early before the fifth submission', () => {
  const state = step(createGame({ solution: 'crane' }), 'boost').state
  assert.equal(state.endReason, null)
  assert.equal(observe(state).status, 'playing')
  assert.equal(observe(state).chain.letter, 't')
})

test('fifth guess dead end records actual five guesses and cannot accept more', () => {
  const state = replayGame({
    solution: 'crane',
    guesses: ['stale', 'blaze', 'boost', 'first', 'flood'],
  })
  assert.equal(state.endReason, 'dead_end')
  assert.equal(observe(state).guessCount, 5)
  assert.equal(observe(state).remainingGuesses, 1)
  assert.equal(observe(state).status, 'lost')
  assert.equal(step(state, 'proud').error, 'game_over')
})

test('sixth-guess win takes priority and sixth-guess failure reaches guess limit', () => {
  const prefix = ['stale', 'blaze', 'boost', 'first', 'forge']
  const playing = replayGame({ solution: 'crane', guesses: prefix })
  assert.equal(playing.endReason, null)
  assert.equal(step(playing, 'crane').state.endReason, 'win')
  const loss = step(playing, 'pride').state
  assert.equal(loss.endReason, 'guess_limit')
  assert.equal(observe(loss).guessCount, 6)
})

test('fifth-guess victory precedes the dead-end predicate', () => {
  const state = replayGame({
    solution: 'flood',
    guesses: ['stale', 'blaze', 'boost', 'first', 'flood'],
  })
  assert.equal(state.endReason, 'win')
})

test('Custom solutions support additional guess words and dictionary data is immutable', () => {
  const custom = VALIDGUESSES.find((word) => !WORDS.includes(word))
  assert.equal(
    step(createGame({ solution: custom }), custom).state.endReason,
    'win',
  )
  for (const words of [WORDS, VALIDGUESSES, ALLOWED_WORDS, ORTHOGRAPHY]) {
    assert(Object.isFrozen(words))
  }
  for (const solution of ['CRANE', 'zzzzz', '', null]) {
    assert.throws(() => createGame({ solution }), RangeError)
  }
})

test('replay restores identical state and rejects corrupt or post-terminal histories', () => {
  const guesses = ['stale', 'blaze', 'boost', 'first', 'forge', 'crane']
  const state = replayGame({ solution: 'crane', guesses })
  assert.deepEqual(
    observe(
      replayGame(JSON.parse(JSON.stringify({ solution: 'crane', guesses }))),
    ),
    observe(state),
  )
  assert.throws(
    () => replayGame({ solution: 'crane', guesses: ['stale', 'boost'] }),
    /chain_mismatch/,
  )
  assert.throws(
    () => replayGame({ solution: 'crane', guesses: ['crane', 'crane'] }),
    /game_over/,
  )
})

test('seeded practice selection is reproducible and rejects invalid random sources', () => {
  const a = createSeededRandom(123)
  const b = createSeededRandom(123)
  assert.deepEqual(
    Array.from({ length: 30 }, () => getRandomWord(a)),
    Array.from({ length: 30 }, () => getRandomWord(b)),
  )
  for (const value of [-1, 1, NaN, Infinity]) {
    assert.throws(() => getRandomWord(() => value), RangeError)
  }
})

test('selection accepts a structural ISO date without requiring Temporal types in consumers', () => {
  assert.deepEqual(
    getDailyWord({ year: 2026, month: 2, day: 20 }),
    getDailyWord('2026-02-20'),
  )
  assert.throws(() => getDailyWord('2026-02-30'), RangeError)
})
