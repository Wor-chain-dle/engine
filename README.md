# Wor-chain-dle Engine

Shared, deterministic game rules for the [Wor-chain-dle web game](https://github.com/Ootzk/Wor-chain-dle), future CLI clients, and solving agents.

## Status

Initial engine extraction for v1.0.0 is in development. This is an ESM TypeScript package with declarations, not yet published to a registry. `private: true` prevents publishing until the registry and release process are configured.

The existing web game is unchanged. Integration will happen on a separate experimental branch after the engine is verified. See [extraction provenance and compatibility](docs/EXTRACTION.md) for the source commit, preserved behavior, and known boundaries.

## Development

Use Node.js 22 or later.

```bash
npm ci
npm run lint
npm test
npm run build
npm pack
```

`npm test` builds the package and runs Node's test runner. Tests include execution of pinned original web code, without a sibling checkout or browser. `npm pack` builds a local installable tarball; it does not publish it.

## Play a game programmatically

Install a locally packed artifact in a consumer:

```bash
npm install /path/to/wor-chain-dle-engine-1.0.0.tgz
```

```ts
import { createGame, observe, step } from '@wor-chain-dle/engine'

let state = createGame({ solution: 'crane' })
const initialObservation = observe(state)

const result = step(state, 'stale')
if (result.accepted) {
  state = result.state
  console.log(result.observation.chain)
  // { letter: 'e', position: 'last' }
} else {
  console.log(result.error)
}
```

Actions are complete, lowercase five-letter words including the locked chain letter. Inputs are not silently lowercased or trimmed. Invalid actions return a structured error and the exact unchanged state; they do not consume a submitted guess.

`GameState` is privileged: it contains the answer. Give a solver only `observe(state)` or `result.observation`, never the state or entire step result. Observations contain feedback history, the next chain constraint, remaining guess slots, status, and termination reason. A dead-end loss has one unused guess slot but is terminal. State and observations are deeply frozen.

`replayGame({ solution, guesses })` restores submitted history through the same validation and terminal checks. Rejecting malformed or post-terminal histories is deliberate; this is not an importer for arbitrary browser localStorage.

## Answer selection

The core receives a solution; callers choose the selection policy. Shared helpers accept explicit inputs and never read the current clock.

```ts
import {
  createGame,
  createSeededRandom,
  getDailyWord,
  getEventWordOfDay,
  getRandomWord,
} from '@wor-chain-dle/engine'

// Web/CLI supplies its local ISO calendar date.
const daily = getDailyWord('2026-02-20')
if (daily.solution !== undefined) {
  const game = createGame({ solution: daily.solution }) // hydro
}

const practiceWord = getRandomWord() // same Math.random policy as the web
const reproducibleWord = getRandomWord(createSeededRandom(123))
const eventWord = getEventWordOfDay('v1.7.0-event', '2026-05-20')
```

- **Daily:** committed answer order, days since `2026-02-16`, no runtime seed or shuffle. The historical `solutionIndex` is the unwrapped day counter. Pre-epoch dates retain the web's raw-remainder behavior and may return `undefined`.
- **Practice:** random answer-list entry, optionally using an injected RNG.
- **Event selection:** existing seed hash, PRNG, and Fisher–Yates permutation; this does not implement seasonal gameplay.
- **Custom:** pass a dictionary-valid solution directly. Both answer words and additional allowed guesses are accepted as Custom solutions.

The offline Daily shuffler seed `20260216` is provenance, not a command to reshuffle the bundled dictionary. Do not regenerate or reorder it during integration.

## Reuse and experiments

Exports include `getGuessStatuses`, `getStatuses`, `getChainInfo`, `buildFullGuess`, `isChainDeadEnd`, and dictionary lookup helpers. `WORDS` contains answer words, `VALIDGUESSES` additional guesses, and `ALLOWED_WORDS` their deduplicated union. All dictionary arrays are frozen.

Record `RULES_VERSION`, `DICTIONARY_VERSION`, `DICTIONARY_METADATA`, and `SELECTION_VERSION` with experiments. Dictionary metadata contains the source commit and ordered-content fingerprints.

LLM providers, candidate filtering, entropy strategies, batch evaluation, interactive CLI, and a JSON transport are not implemented in this initial extraction. They can consume this engine without duplicating rules. Website UI, persistence, Daily countdown, records, achievements, cosmetics, and seasonal effects remain outside the engine.

## License

MIT. See [LICENSE](LICENSE). Source code is derived from [Wor-chain-dle](https://github.com/Ootzk/Wor-chain-dle), based on [AnyLanguage-Word-Guessing-Game](https://github.com/roedoejet/AnyLanguage-Word-Guessing-Game). Pinned source fixtures retain upstream attribution; see [extraction notes](docs/EXTRACTION.md).
