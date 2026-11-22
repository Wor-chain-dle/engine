# Wor🔗dle Engine

[![Release](https://img.shields.io/github/v/release/Wor-chain-dle/engine?label=release&logo=github)](https://github.com/Wor-chain-dle/engine/releases)

The shared game engine for [Wor🔗dle](https://github.com/Ootzk/Wor-chain-dle): a five-letter word guessing game with alternating word-chain constraints.

Use it to build web or CLI clients, solving bots, and training environments. The engine provides game rules, dictionaries, answer selection, tile feedback, and input handling without depending on a UI or browser storage.

## Install

Requires Node.js 22+. The optional Python client requires Python 3.9+.

Install a versioned `.tgz` from [GitHub Releases](https://github.com/Wor-chain-dle/engine/releases):

```bash
npm install --save-exact https://github.com/Wor-chain-dle/engine/releases/download/v0.1.0/wor-chain-dle-engine-0.1.0.tgz
```

Packages include compiled JavaScript, TypeScript declarations, a JSONL executable, and the Python client. SHA-256 checksums accompany release downloads. Packages are distributed through GitHub Releases rather than a package registry.

## JavaScript / TypeScript

### Submit a word

```ts
import { createGame, observe, step } from '@wor-chain-dle/engine'

let game = createGame({ solution: 'crane' })
const initialObservation = observe(game)

const result = step(game, 'stale')
if (result.accepted) {
  game = result.state
  console.log(result.observation.chain) // { letter: 'e', position: 'last' }
} else {
  console.log(result.error)
}
```

Submit lowercase five-letter words, including any locked chain letter. Invalid submissions do not consume a guess. Observations contain guess history, tile feedback, chain constraints, remaining guess slots, and game status.

**Game state contains the answer.** Give agents only `observe(game)` or `result.observation`.

### Type one letter at a time

```ts
import {
  createGame,
  createInputSession,
  applyInput,
} from '@wor-chain-dle/engine'

let session = createInputSession(createGame({ solution: 'crane' }))

for (const letter of 'crane') {
  session = applyInput(session, { type: 'type', letter }).state
}
const result = applyInput(session, { type: 'enter' })
session = result.state
console.log(result.feedback.code) // win
```

| Action                              | Purpose                         |
| ----------------------------------- | ------------------------------- |
| `{ type: 'type', letter: 'c' }`     | Append a letter to the draft    |
| `{ type: 'backspace' }`             | Delete an editable letter       |
| `{ type: 'enter' }`                 | Submit the current draft        |
| `{ type: 'submit', word: 'crane' }` | Submit a complete word directly |

Locked chain letters are supplied automatically when typing. Feedback includes codes such as `word_incomplete`, `word_not_found`, and `input_full`. Sessions track actual typing, deletion, and submission counts; direct word submissions do not fabricate key presses.

Always retain the returned session, including rejected actions, to preserve counters. Give agents only its observation and feedback. See the [input protocol](docs/INPUT_PROTOCOL.md) for the full contract.

## Python / JSONL

Python clients run the same Node engine through a persistent JSONL process; no rule port is needed. From a project with the package installed:

```python
from pathlib import Path
import sys

engine = Path('node_modules/@wor-chain-dle/engine').resolve()
sys.path.insert(0, str(engine / 'python'))
from wor_chain_dle import EngineClient

with EngineClient(['node', str(engine / 'bin/wor-chain-dle-jsonl.mjs')]) as client:
    client.create('demo', 'crane')
    result = client.act('demo', {'type': 'submit', 'word': 'stale'})
    print(result['observation'])
    print(result['feedback'])
```

The environment selects the answer and keeps creation requests private. Game responses expose observations, feedback, and counters without internal state.

The JSONL interface supports `info`, `dictionary`, `create`, `reset`, `observe`, `act`, `batch`, and `drop`. See [JSONL and Python documentation](docs/JSONL_PROTOCOL.md) for request schemas, batching, timeouts, and process lifecycle.

## Other APIs

| Area                | Exports                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| Game                | `createGame`, `step`, `observe`, `replayGame`                                         |
| Input               | `createInputSession`, `applyInput`, `observeInput`                                    |
| Answer selection    | `getDailyWord`, `getRandomWord`, `createSeededRandom`, `getEventWordOfDay`            |
| Dictionaries        | `WORDS`, `VALIDGUESSES`, `ALLOWED_WORDS`, `isWordInWordList`                          |
| Feedback and chains | `getGuessStatuses`, `getStatuses`, `getChainInfo`, `buildFullGuess`, `isChainDeadEnd` |

Answer selection accepts explicit dates, seeds, or randomness. Daily preserves the web game's committed dictionary order; Event selection preserves its seeded shuffle. Seasonal Event gameplay is separate from these selection helpers.

For reproducible experiments, record the package version and `RULES_VERSION`, `DICTIONARY_VERSION`, `DICTIONARY_METADATA`, `SELECTION_VERSION`, and `INPUT_PROTOCOL_VERSION`. Python clients expose version information through `client.info`.

## Try it locally

From a source checkout:

```bash
npm ci
npm run play
```

Enter a word to submit it, or a letter to edit the draft. `/bs` deletes a letter, an empty line submits the draft, `/new` starts another game, and `/help` lists commands. Use `npm run play -- --seed 123` for a reproducible answer sequence.

The demo displays colored tile feedback, locked cells, and action counters. Terminal line editing happens locally; use `/bs` to send an engine Backspace action.

## Development

```bash
npm run lint
npm test
npm run test:python
npm run test:package
npm pack
```

Tests cover original-source parity and installed-package use from JavaScript, TypeScript, and Python. `npm pack` builds an installable tarball locally. See [extraction and compatibility notes](docs/EXTRACTION.md) for provenance and scope, and [AGENTS.md](AGENTS.md) for contribution and release procedures.

## License

[MIT](LICENSE). Derived from [Wor🔗dle](https://github.com/Ootzk/Wor-chain-dle), based on [AnyLanguage-Word-Guessing-Game](https://github.com/roedoejet/AnyLanguage-Word-Guessing-Game).
