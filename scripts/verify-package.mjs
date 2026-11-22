import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Test the shipped artifact in isolation, not imports from this source checkout.
const directory = mkdtempSync(join(tmpdir(), 'wor-chain-dle-consumer-'))
try {
  const [packed] = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
      { encoding: 'utf8' },
    ),
  )
  assert(packed.files.some((file) => file.path === 'dist/index.js'))
  assert(packed.files.some((file) => file.path === 'dist/index.d.ts'))
  assert(packed.files.some((file) => file.path === 'LICENSE'))
  assert(packed.files.some((file) => file.path === 'docs/EXTRACTION.md'))
  assert(
    !packed.files.some((file) => /^(src|tests|node_modules)\//.test(file.path)),
  )
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  )
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(directory, packed.filename),
    ],
    { cwd: directory, stdio: 'pipe' },
  )

  const consumer = `
    import assert from 'node:assert/strict';
    import {
      createGame, observe, step, replayGame, getDailyWord,
      getEventWordOfDay, getRandomWord, createSeededRandom,
      WORDS, VALIDGUESSES, DICTIONARY_METADATA,
    } from '@wor-chain-dle/engine';
    assert.equal(getDailyWord('2026-02-20').solution, 'hydro');
    assert.equal(getEventWordOfDay('v1.7.0-event', '2026-05-20').solution, 'smirk');
    assert.equal(getRandomWord(createSeededRandom(42)), getRandomWord(createSeededRandom(42)));
    assert.equal(WORDS.length, DICTIONARY_METADATA.answers.count);
    const state = replayGame({ solution: 'crane', guesses: ['stale', 'blaze', 'boost', 'first', 'flood'] });
    assert.equal(state.endReason, 'dead_end');
    assert.equal(observe(state).guessCount, 5);
    const initial = createGame({ solution: VALIDGUESSES[0] });
    assert.equal(JSON.stringify(observe(initial)).includes(VALIDGUESSES[0]), false);
    assert.equal(step(initial, VALIDGUESSES[0]).state.endReason, 'win');
    console.log('Packed ESM consumer passed');
  `
  execFileSync(process.execPath, ['--input-type=module', '--eval', consumer], {
    cwd: directory,
    stdio: 'inherit',
  })

  writeFileSync(
    join(directory, 'consumer.ts'),
    `
    import { createGame, step, observe, getDailyWord } from '@wor-chain-dle/engine'
    import type { Observation, ActionError } from '@wor-chain-dle/engine'
    const selection = getDailyWord('2026-02-20')
    if (selection.solution !== undefined) {
      const state = createGame({ solution: selection.solution })
      const observation: Observation = observe(state)
      const result = step(state, 'stale')
      if (!result.accepted) {
        const error: ActionError = result.error
      }
    }
  `,
  )
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2020',
      '--module',
      'NodeNext',
      'consumer.ts',
    ],
    { cwd: directory, stdio: 'inherit' },
  )
  console.log('Packed TypeScript declarations passed')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
