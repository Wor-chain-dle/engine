# Extraction provenance and compatibility

## Source

- Repository: https://github.com/Ootzk/Wor-chain-dle
- Web version: v1.7.0
- Source commit: [`b25c70cf91c0c02b7b428e016dc258255111f59e`](https://github.com/Ootzk/Wor-chain-dle/tree/b25c70cf91c0c02b7b428e016dc258255111f59e)
- Source license: MIT, copyright Hannah Park; engine additions copyright Ootzk.
- Unmodified source snapshots: `tests/fixtures/upstream/`, with byte-level SHA-256 fingerprints in `manifest.json`.

The engine is implemented by copying from this source. The web repository has not been modified. Fixtures are not shipped in the package and tests do not require the web checkout.

## Mapping

| Web source                      | Engine location                         | Adaptation                                                                  |
| ------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `src/constants/wordlist.ts`     | `src/constants/wordlist.ts`             | Preserved order, contents and NFC normalization; frozen export              |
| `src/constants/validGuesses.ts` | `src/constants/validGuesses.ts`         | Preserved contents and NFC normalization; frozen export                     |
| `src/constants/config.ts`       | `src/config.ts`                         | Only rule, normalization and epoch values retained                          |
| `src/constants/orthography.ts`  | `src/orthography.ts`                    | Preserved alphabet; frozen export                                           |
| `src/lib/tokenizer.ts`          | `src/tokenizer.ts`                      | Preserved regex construction; local ESM imports                             |
| `src/lib/chain.ts`              | `src/chain.ts`                          | Preserved chain math; readonly inputs and fresh unlocked-input result       |
| `src/lib/statuses.ts`           | `src/statuses.ts`                       | Preserved duplicate-letter and keyboard feedback; readonly inputs           |
| `src/lib/words.ts`              | `src/dictionary.ts`, `src/selection.ts` | Set membership; explicit date and injectable RNG; no import-time clock read |
| `src/lib/events.ts`             | `src/selection.ts`                      | Copied seed hash, PRNG, permutation and day indexing; explicit seed/date    |
| `src/App.tsx` submission flow   | `src/game.ts`                           | Pure immutable transition; UI, timers, persistence and rewards removed      |

## Compatibility invariants

- Six guesses, five lowercase English letters. The chain alternates last, first, last, first, last. Submissions contain the locked letter.
- Winning takes priority. A wrong chain letter relative to the solution does not itself end an early turn. `dead_end` is checked only after the fifth valid submission. A full-limit loss records six submitted guesses; a dead end records five.
- Duplicate feedback consumes correct matches before present matches. Keyboard summaries preserve the original separate aggregation behavior.
- Wrong-length and dictionary-invalid submissions do not consume guesses. The engine additionally rejects malformed types, unsupported characters and explicit chain violations; the original UI constructs chain-compliant input automatically.
- Repeated valid guesses are permitted, as in the web game.
- Both dictionaries may supply an explicit Custom solution; Daily/Practice/Event selection uses the answer list only.
- Daily uses `WORDS[dayIndex % WORDS.length]` from epoch `2026-02-16`. There is no runtime shuffle. Daily's `solutionIndex` retains the source's day-counter meaning even after wraparound.
- Pre-epoch Daily dates can return `undefined` due to negative remainder. This existing edge is exposed in the return type, not silently fixed. Event normalizes its remainder and returns a word for pre-epoch dates.
- Event seed hashing iterates UTF-16 code units, not Unicode code points. Hashing, PRNG and shuffle operations preserve source behavior, including non-ASCII seeds. The mutable source cache is omitted; results remain identical and are frozen.
- Practice defaults to `Math.random`; injected values must be finite and in `[0, 1)`. The RNG validation is a new API boundary and does not affect normal web selection.
- Dates use Temporal with explicit inputs. Local date acquisition, midnight countdown, and page refresh remain adapter responsibilities.

The offline Daily shuffler at `scripts/shuffle-wordlist.js` uses seed `20260216`. Its source is retained as provenance and is never executed by the extraction or tests. The committed dictionary order is the compatibility baseline.

## Ordered dictionary fingerprints

Hash format: SHA-256 of UTF-8 words joined by LF, followed by a trailing LF. Hashes refer to normalized exported words, not TypeScript file formatting.

| Data               | Count  | SHA-256                                                            |
| ------------------ | ------ | ------------------------------------------------------------------ |
| Answers            | 2,315  | `7fab5f67afbb22ef7bb48b7a1d8c007c8fc86f43c3ae356a6f029576da36f73b` |
| Additional guesses | 10,657 | `f012ef5ecdbeb94274186abcbbd5388d92bb86fe8ae0635fffcc5e9be4aa3d33` |

The additional-guess count is taken from the pinned source. Older documentation states 10,656; no dictionary entry was removed to match that text.

## Verification

- Verify every pinned source file against its byte fingerprint and compare every ordered dictionary entry.
- Execute original chain/status/word functions in a VM harness; extract original Event selection declarations using TypeScript's parser.
- Compare Daily over a full dictionary cycle plus wraparound and negative offsets.
- Compare full Event permutations and cycles for the active seed and additional ASCII, empty, and non-ASCII seeds.
- Compare local dates around DST transitions in multiple time zones; the engine does not own the clock or countdown.
- Extract and execute the actual original `App.tsx` `onEnter` and `applyLoadedGameStatus` callbacks with UI/statistics side effects stubbed. Compare curated win/loss cases, seeded generated games, and restored statuses against the engine. Rule helpers remain the original implementations in that harness.
- Test malformed actions, immutability, solver observations, replay rejection, terminal behavior, Custom solutions, and deterministic RNG injection.

These are engine parity checks, not web integration or E2E checks. Before web adoption, a separate experimental branch must verify persistence restoration, midnight behavior, records, achievements, sharing, Event interactions, and browser builds against the existing web tests.

## Runtime and publication boundaries

The package contains ESM JavaScript and TypeScript declarations. Runtime code has no Node-only imports, browser storage, React, network calls, or current-clock reads. Node.js 22 is the development/test baseline; browser bundler compatibility will be checked during web integration.

`GameState` and `StepResult.state` contain the hidden solution. Only `Observation` is intended for solvers. This API separation prevents accidental answer exposure; it is not a security sandbox against code that can access privileged state.

No registry publication, UI integration, seasonal game mechanics, or solver strategy is part of this extraction. The subsequent JSONL transport is documented in [JSONL_PROTOCOL.md](JSONL_PROTOCOL.md). The package remains private until publishing is configured separately.
