import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { Temporal } from 'temporal-polyfill'
import {
  WORDS,
  VALIDGUESSES,
  ALLOWED_WORDS,
  CONFIG,
  DICTIONARY_METADATA,
  getGuessStatuses,
  getStatuses,
  getChainInfo,
  buildFullGuess,
  isChainDeadEnd,
  getDailyWord,
  getRandomWord,
  getEventWordPermutation,
  getEventWordOfDay,
  createSeededRandom,
  createGame,
  step,
  observe,
} from '../dist/index.js'
import { createUpstream, fixtureRoot, manifest } from './upstream.mjs'

const original = createUpstream()
const plain = (value) => JSON.parse(JSON.stringify(value))

test('pinned source files and complete dictionaries match their fingerprints', () => {
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
  for (const [path, expected] of Object.entries(manifest.files)) {
    assert.equal(hash(readFileSync(resolve(fixtureRoot, path))), expected, path)
  }
  assert.deepEqual(WORDS, [...original.answers])
  assert.deepEqual(VALIDGUESSES, [...original.additionalGuesses])
  for (const [words, key] of [
    [WORDS, 'answers'],
    [VALIDGUESSES, 'additionalGuesses'],
  ]) {
    assert.equal(words.length, DICTIONARY_METADATA[key].count)
    assert.equal(hash(words.join('\n') + '\n'), DICTIONARY_METADATA[key].sha256)
    assert.equal(
      words.every((word) => /^[a-z]{5}$/.test(word)),
      true,
    )
  }
})

test('chain assembly and predicate match the original for every turn', () => {
  const history = ['stale', 'blaze', 'boost', 'first', 'flood', 'proud']
  for (let count = 0; count <= CONFIG.tries; count++) {
    const rows = history.slice(0, count).map((word) => [...word])
    assert.deepEqual(
      getChainInfo(rows),
      plain(original.chain.getChainInfo(rows)),
    )
    assert.deepEqual(buildFullGuess(['a', 'b', 'c', 'd'], rows), [
      ...original.chain.buildFullGuess(['a', 'b', 'c', 'd'], rows),
    ])
    for (const solution of ['crane', 'flood', 'proud']) {
      assert.equal(
        isChainDeadEnd(rows, [...solution]),
        original.chain.isChainDeadEnd(rows, [...solution]),
      )
    }
  }
})

test('duplicate-letter and keyboard feedback match pinned web code', () => {
  const random = createSeededRandom(123)
  const cases = [
    ['allee', 'apple'],
    ['sassy', 'assay'],
    ['eerie', 'serve'],
    ['aaaaa', 'cacao'],
  ]
  for (let i = 0; i < 1000; i++) {
    cases.push([
      ALLOWED_WORDS[Math.floor(random() * ALLOWED_WORDS.length)],
      getRandomWord(random),
    ])
  }
  for (const [guess, solution] of cases) {
    const feedback = getGuessStatuses([...guess], solution)
    assert.deepEqual(feedback, [
      ...original.statuses.getGuessStatuses([...guess], solution),
    ])
    assert.deepEqual(
      getStatuses([[...guess], [...solution]], solution),
      plain(
        original.statuses.getStatuses([[...guess], [...solution]], solution),
      ),
    )
    for (const letter of new Set(guess)) {
      const matched = [...guess].filter(
        (char, index) => char === letter && feedback[index] !== 'absent',
      ).length
      assert(matched <= [...solution].filter((char) => char === letter).length)
    }
  }
})

test('Daily selection matches the full cycle, wraparound, and pre-epoch behavior', () => {
  const epoch = Temporal.PlainDate.from(CONFIG.startDate)
  for (let offset = -2; offset <= WORDS.length + 2; offset++) {
    const date = epoch.add({ days: offset }).toString()
    original.setDate(date)
    const old = original.words.getWordOfDay()
    const next = getDailyWord(date)
    assert.equal(next.solution, old.solution, date)
    assert.equal(next.solutionIndex, old.solutionIndex, date)
    assert.equal(next.dateKey, old.dateKey, date)
  }
  assert.equal(getDailyWord('2026-02-20').solution, 'hydro')
  assert.equal(getDailyWord('2026-02-15').solution, undefined)
  for (const offset of [-WORDS.length - 1, -WORDS.length, -WORDS.length + 1]) {
    const date = epoch.add({ days: offset }).toString()
    original.setDate(date)
    assert.equal(
      getDailyWord(date).solution,
      original.words.getWordOfDay().solution,
    )
  }
})

test('explicit local dates preserve Daily choices on DST transition dates in multiple zones', () => {
  for (const zone of [
    'Asia/Seoul',
    'America/New_York',
    'Europe/Berlin',
    'Pacific/Kiritimati',
  ]) {
    for (const date of ['2026-03-08', '2026-03-29', '2026-11-01']) {
      original.setDate(date, zone)
      const old = original.words.getWordOfDay()
      assert.equal(getDailyWord(date).solution, old.solution)
      const tomorrow = Temporal.PlainDate.from(date)
        .add({ days: 1 })
        .toZonedDateTime(zone)
      assert.equal(old.tomorrow, tomorrow.epochMilliseconds)
    }
  }
})

test('Event permutations and full daily cycles preserve exact seed behavior', () => {
  const epoch = Temporal.PlainDate.from(CONFIG.startDate)
  for (const seed of ['v1.7.0-event', 'different-event', '', '🍀한글']) {
    const expected = original.events.getEventWordPermutation(seed)
    assert.deepEqual(getEventWordPermutation(seed), [...expected])
    assert.equal(new Set(expected).size, WORDS.length)
    for (let offset = -2; offset <= WORDS.length + 1; offset++) {
      const date = epoch.add({ days: offset })
      const old = original.events.getEventWordOfDay({ answerSeed: seed }, date)
      assert.deepEqual(getEventWordOfDay(seed, date), plain(old))
    }
  }
})

test('Practice random selection matches original indexing, including endpoints', () => {
  for (const value of [0, 0.1, 0.5, 0.9999999999999999]) {
    original.setRandom(value)
    assert.equal(
      getRandomWord(() => value),
      original.words.getRandomWord(),
    )
  }
})

test('game transitions match the actual original App.onEnter callback', () => {
  const random = createSeededRandom(20260216)
  const histories = [
    ['crane', ['crane']],
    ['crane', ['stale', 'blaze', 'boost', 'first', 'flood']],
    ['crane', ['stale', 'blaze', 'boost', 'first', 'forge', 'pride']],
    ['crane', ['stale', 'blaze', 'boost', 'first', 'forge', 'crane']],
  ]
  for (let i = 0; i < 200; i++) {
    const solution = getRandomWord(random)
    let state = createGame({ solution })
    const actions = []
    while (!state.endReason) {
      const chain = observe(state).chain
      const legal = ALLOWED_WORDS.filter(
        (word) =>
          !chain || word[chain.position === 'first' ? 0 : 4] === chain.letter,
      )
      const action =
        legal.includes(solution) && random() < 0.3
          ? solution
          : legal[Math.floor(random() * legal.length)]
      actions.push(action)
      state = step(state, action).state
    }
    histories.push([solution, actions])
  }
  for (const [solution, actions] of histories) {
    let state = createGame({ solution })
    for (const action of actions) {
      const old = original.submit(
        solution,
        state.guesses,
        action,
        state.endReason,
      )
      const next = step(state, action)
      assert.equal(next.accepted, true)
      assert.deepEqual(next.state.guesses, old.guesses)
      assert.equal(next.state.endReason, old.endReason)
      const restored = original.restoreStatus(solution, next.state.guesses)
      assert.equal(next.observation.status === 'won', restored.won)
      assert.equal(next.observation.status === 'lost', restored.lost)
      state = next.state
    }
    assert.notEqual(state.endReason, null)
    const old = original.submit(
      solution,
      state.guesses,
      solution,
      state.endReason,
    )
    assert.deepEqual(old.guesses, [...state.guesses])
    assert.equal(step(state, solution).error, 'game_over')
  }
})

test('original incomplete and dictionary-invalid submissions consume no guesses', () => {
  for (const action of ['abcd', 'zzzzz']) {
    const old = original.submit('crane', [], action)
    assert.deepEqual(old.guesses, [])
    assert.equal(
      step(createGame({ solution: 'crane' }), action).accepted,
      false,
    )
  }
})
