# Input and feedback protocol

`INPUT_PROTOCOL_VERSION = 'input-v1'` identifies the actions, input observation,
feedback codes, and counter semantics below. This is a model-neutral API, not a
tokenizer vocabulary, chat template, JSONL transport, or training framework.

## Two interfaces, one game

The core `step(game, word)` remains available for complete-word submissions.
For draft editing, feedback events, and measured actions, wrap a core game:

```ts
import {
  createGame,
  createInputSession,
  observeInput,
  applyInput,
} from '@wor-chain-dle/engine'

let session = createInputSession(createGame({ solution: 'crane' }))
session = applyInput(session, { type: 'type', letter: 'c' }).state
session = applyInput(session, { type: 'type', letter: 'r' }).state

const incomplete = applyInput(session, { type: 'enter' })
// incomplete.accepted === false
// incomplete.feedback.code === 'word_incomplete'
// incomplete.state.buffer === 'cr'
// incomplete.observation.guessCount === 0
session = incomplete.state

// A complete-word agent can act on the same session.
const submitted = applyInput(session, { type: 'submit', word: 'crane' })
// submitted.accepted === true
// submitted.feedback.code === 'win'
// submitted.state.buffer === ''
// submitted.observation.input === null
```

Always keep the returned `state`, including rejected actions, to preserve counters.
States and observations are immutable; actions do not mutate earlier sessions.

`InputSession.game` and `InputResult.state` contain the hidden solution. Give agents
only `observeInput(session)` or `result.observation`, along with `result.feedback`.
No observation contains the solution, and incomplete drafts receive no new tile
feedback, dictionary hint, or hint about the hidden answer.

## Actions

| Action                              | Meaning                                                     |
| ----------------------------------- | ----------------------------------------------------------- |
| `{ type: 'type', letter: 'c' }`     | Append exactly one lowercase ASCII letter to editable input |
| `{ type: 'backspace' }`             | Delete the last editable letter                             |
| `{ type: 'enter' }`                 | Submit the current row, including its locked chain letter   |
| `{ type: 'submit', word: 'crane' }` | Atomically validate and submit a complete five-letter word  |

Both submission paths call the same core transition. Repeated valid guesses are
allowed. Invalid submissions never consume a guess or change the draft. Only a
valid submitted word receives new tile feedback.

Complete-word submission includes the locked chain letter and validates it. A
successful direct submission clears any existing draft. A rejected direct submission
preserves it. Direct submissions do not generate synthetic letter, Backspace, or
Enter actions. The two interfaces can be mixed within one session.

Malformed objects, unsupported fields, non-string parameters, and unsupported action
types return `invalid_action`. Letter input does not trim or lowercase its argument;
multi-letter strings, uppercase, whitespace, and non-ASCII input are rejected.

## Input observation

`InputObservation` extends the core observation with `inputProtocolVersion` and an
`input` object:

- `editableText`: typed characters, excluding the locked chain letter.
- `cells`: five strings/nulls in board order; unfilled cells are `null`.
- `lockedIndex`: `null`, `0`, or `4` under standard rules.
- `maxEditableLength`: five on the first row, four on later rows.
- `isComplete`: whether every editable position is filled. This does not imply
  that the word is in the dictionary.

For a last-letter lock of `e` and editable text `cr`, cells are
`['c', 'r', null, null, 'e']`. Backspace cannot delete the locked `e`.
For a first-letter lock of `b`, typing `oost` constructs `boost`.

After termination, `input` is `null`. Submitted history and the core termination
reason remain available. Remaining guess slots retain their core meaning: a dead
end has five submitted guesses, one unused slot, and no further playable turn.

## Feedback codes

`result.feedback.code` is one of `INPUT_FEEDBACK_CODES`. It contains no translated
message or model-specific token. Web, CLI, and model adapters choose their own
rendering. The original core error codes are unchanged; only the input adapter maps
them to these feedback codes.

| Code                | Accepted | Effect                                                                    |
| ------------------- | -------- | ------------------------------------------------------------------------- |
| `letter_typed`      | yes      | Editable input grows by one letter                                        |
| `letter_deleted`    | yes      | Last editable letter is removed                                           |
| `word_submitted`    | yes      | Guess submitted; game continues on the next row                           |
| `win`               | yes      | Guess submitted; game won                                                 |
| `loss`              | yes      | Guess submitted; game lost; inspect `observation.endReason`               |
| `word_incomplete`   | no       | Enter on an incomplete row, or a direct word shorter than five characters |
| `word_not_found`    | no       | Complete word is not in the dictionary                                    |
| `input_full`        | no       | Letter input on an already full row                                       |
| `input_empty`       | no       | Backspace with no editable letters                                        |
| `invalid_action`    | no       | Malformed or unsupported action                                           |
| `invalid_character` | no       | Unsupported character or invalid one-letter action                        |
| `invalid_length`    | no       | Direct word exceeds five characters                                       |
| `chain_mismatch`    | no       | Direct word violates the locked letter                                    |
| `game_over`         | no       | Session already terminated; state and counters unchanged                  |

`accepted` means the input was edited or a valid guess was submitted, including
a losing guess. It does not mean the episode was won, or that all state is unchanged
when false: live rejected actions update counters while preserving game and draft.

## Counters

`session.stats` records cumulative activity since the input session was attached.
Counters are separate from the agent observation. Wrapping a partially played or
completed core game does not infer any historical key presses or submissions.

- `actionCount`: all requests while the game is live, including malformed actions
  and no-ops. Requests after termination are excluded.
- `lettersTyped`: successful one-letter insertions, excluding blocked/full input.
- `backspacePresses`: recognized Backspace requests, including an empty draft.
- `backspacesByInputLength`: six buckets indexed by editable length before deletion;
  the locked letter does not contribute to that length.
- `enterPresses`: recognized Enter requests, including incomplete or unknown words.
- `directSubmissions`: recognized direct word submissions, valid or rejected.
- `validSubmissions`: accepted guesses from either submission interface.
- `incompleteSubmissions`: rejected Enter/direct submissions with insufficient input.
- `invalidWordSubmissions`: complete-word submissions rejected by dictionary lookup.
- `rejectedActions`: requests returning `accepted: false` during a live game.

The session does not read a clock, store a full action log, impose an external
action/time budget, compute learning rewards, or persist data. Runners may record
actions/results, supply their own timestamps, and stop an experiment separately
from natural game termination. This avoids changing game rules for a training run.

## Adapters and compatibility

A GPT adapter can map one engine action to one dedicated token and feedback codes
to its observation vocabulary. A general LLM can instead use structured tool calls.
The engine neither adds special tokens nor interprets raw control-token strings.

Pinned original `App.tsx` character, delete, and Enter handlers are executed in
tests. Buffer contents, submitted guesses, termination, and input-stat hook calls
are compared over generated key-action games. Empty Backspace counts and full-row
input behavior match the source. UI effects, clocks, per-row browser timing stats,
storage, and real browser integration remain outside this adapter and require
separate web integration checks.
