# Wor🔗dle

Shared, deterministic game rules for the [Wor-chain-dle web game](https://github.com/Ootzk/Wor-chain-dle), future CLI clients, and solving agents.

## Status

The initial engine release is v0.1.0. This is an ESM TypeScript package with declarations. Release packages are distributed as GitHub Release assets; `private: true` prevents accidental registry publication.

The existing web game is unchanged. Integration will happen on a separate experimental branch after the engine is verified. See [extraction provenance and compatibility](docs/EXTRACTION.md) for the source commit, preserved behavior, and known boundaries.

## Development

Use Node.js 22 or later. Python 3.9 or later is required for Python bridge and installed-package checks.

```bash
npm ci
npm run lint
npm test
npm run test:python
npm run build
npm pack
```

`npm test` builds the package and runs Node's test runner. Tests include execution of pinned original web code, without a sibling checkout or browser. `npm pack` builds a local installable tarball; it does not publish it.

## Releases and installation

After CI passes for a `Release v0.1.0` PR merged from `release/v0.1.0` into `main`, automation creates the `v0.1.0` tag at that exact merge commit and publishes a GitHub Release using the PR body as its notes. Each release attaches `wor-chain-dle-engine-0.1.0.tgz` and its `.sha256` checksum. Later releases follow the same version convention. Nothing is published to npm or GitHub Packages.

The workflow stages assets in a draft before publication. A failed release job can be rerun; it resumes a draft, rejects a tag pointing elsewhere, and leaves an already published release unchanged. Keep the manifest version, release branch, and PR title aligned. Bump both npm manifests with `npm version <version> --no-git-tag-version` before opening the release PR.

### Use from GPT or another consumer

Run these commands in the consumer repository **after v0.1.0 is published**. Downloading an explicit version and committing the consumer's `package-lock.json` keeps experiments reproducible.

```bash
mkdir -p /tmp/wcd-engine-v0.1.0
gh release download v0.1.0 --repo Wor-chain-dle/engine \
  --pattern 'wor-chain-dle-engine-0.1.0.tgz*' --dir /tmp/wcd-engine-v0.1.0
(cd /tmp/wcd-engine-v0.1.0 && shasum -a 256 -c wor-chain-dle-engine-0.1.0.tgz.sha256)
npm install --save-exact https://github.com/Wor-chain-dle/engine/releases/download/v0.1.0/wor-chain-dle-engine-0.1.0.tgz
```

Node.js 22+ is required even when the solver uses Python. The package includes the compiled engine, JSONL executable, and Python reference client. It is an engine package, not a pip package. For example, run this from the consumer root:

```python
from pathlib import Path
import sys

engine = Path("node_modules/@wor-chain-dle/engine").resolve()
sys.path.insert(0, str(engine / "python"))
from wor_chain_dle import EngineClient

with EngineClient(["node", str(engine / "bin/wor-chain-dle-jsonl.mjs")]) as client:
    print(client.info)  # Record engine and protocol versions with experiments.
    client.create("demo", "prior")  # Only the environment chooses the answer.
    result = client.act("demo", {"type": "submit", "word": "prior"})
    print(result["feedback"]["code"])  # win
```

Give the model observations and feedback only; keep answer selection and creation requests inside the environment adapter. Package verification runs an isolated installed-package consumer through ESM, TypeScript, JSONL, Python, and the terminal demo without relying on a sibling engine checkout.

## Play in your terminal

```bash
npm run play
# Fixed answer for testing:
npm run play -- --solution prior
```

The Python demo displays the board, locked chain letter, readable feedback, and action counters while handling JSONL internally. Answers are randomly chosen by default; `--seed 123` makes the answer sequence reproducible.

- Enter a complete word to submit it, or a single letter to edit the draft.
- `/type TEXT` appends editable letters; `/bs` deletes the last one.
- An empty line or `/enter` submits the draft.
- `/help` shows commands, `/new` starts another game, and `/quit` or Ctrl+D exits.
- Green, purple, and gray letters indicate correct, present, and absent feedback; `[X]` marks a locked cell.

This is a line-oriented demo: press Enter after each word or command. Physical Backspace used to edit the terminal line is handled locally; `/bs` sends an engine deletion. Full-word submissions do not fabricate individual key presses. `/new` keeps a fixed `--solution` when supplied. The answer is revealed only after game termination.

After building, you can also run `python3 python/play.py` directly. `--no-color` disables ANSI colors. The installed package includes the module entrypoint `python3 -m wor_chain_dle.terminal` when its `python` directory is on `PYTHONPATH`.

## Play a game programmatically

Install a locally packed artifact in a consumer:

```bash
npm install /path/to/wor-chain-dle-engine-0.1.0.tgz
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

## Character and complete-word input

The input session supports both human-like key actions and complete-word agents:

```ts
import {
  createGame,
  createInputSession,
  applyInput,
} from '@wor-chain-dle/engine'

let session = createInputSession(createGame({ solution: 'crane' }))
session = applyInput(session, { type: 'type', letter: 'c' }).state
session = applyInput(session, { type: 'backspace' }).state

// Equivalent submission rules without synthetic key presses:
const result = applyInput(session, { type: 'submit', word: 'stale' })
session = result.state
console.log(result.feedback.code) // word_submitted

// Enter submits the current editable draft plus its locked chain letter.
const incomplete = applyInput(session, { type: 'enter' })
console.log(incomplete.feedback.code) // word_incomplete
```

Input observations expose the editable draft and locked cells without the solution. Feedback codes such as `word_incomplete`, `word_not_found`, and `input_full` are independent of UI language and LLM tokenization. Session counters record actual typing, deletion, Enter, and direct submissions. Always retain the returned state, including rejected actions, to keep those counters.

See the [input and feedback protocol](docs/INPUT_PROTOCOL.md) for action shapes, every feedback code, draft behavior, metrics, and the boundary between engine and model adapters.

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

For character-level interactions, also record `INPUT_PROTOCOL_VERSION`.

## JSONL and Python

The Node-only `bin/wor-chain-dle-jsonl.mjs` executable runs a persistent stdio server. It supports multiple sessions, observation, single actions, batches, reset, and cleanup. Game responses include only public observations, feedback, and action counters. The browser entrypoint does not import Node modules.

`python/wor_chain_dle/` provides a standard-library reference client with a response timeout and process cleanup. Run `npm run test:python` to verify 100 game cases in word, serial-key, and batch-key modes against direct engine calls. See [JSONL protocol and Python usage](docs/JSONL_PROTOCOL.md).

LLM providers, candidate filtering, entropy strategies, and a general training/evaluation runner are not implemented. Website UI, persistence, Daily countdown, records, achievements, cosmetics, and seasonal effects remain outside the engine.

## License

MIT. See [LICENSE](LICENSE). Source code is derived from [Wor-chain-dle](https://github.com/Ootzk/Wor-chain-dle), based on [AnyLanguage-Word-Guessing-Game](https://github.com/roedoejet/AnyLanguage-Word-Guessing-Game). Pinned source fixtures retain upstream attribution; see [extraction notes](docs/EXTRACTION.md).
