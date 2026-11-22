# JSONL transport and Python client

`jsonl-v1` is a local stdio protocol around the existing input session. It does not
change game rules, choose answers implicitly, or define model tokens and rewards.

## Run

From a source checkout after `npm ci`:

```bash
npm run build
node bin/wor-chain-dle-jsonl.mjs
```

The installed npm package also exposes `wor-chain-dle-jsonl`. When launching from
another program, invoke its executable or `node /path/to/bin/wor-chain-dle-jsonl.mjs`
directly. Do not launch through an npm script that prints banners to protocol stdout.

stdin and stdout carry UTF-8 JSON, one object per line. stdout has no startup banner
or log messages. Diagnostics go to stderr. Requests are processed in input order;
this is a persistent process with multiple logical sessions, not parallel CPU workers.
EOF closes the server and discards its sessions. It also accepts a final request
without a trailing newline at EOF. CRLF is supported. Blank lines are invalid JSON.

## Request and response envelopes

```json
{
  "id": "request-1",
  "protocolVersion": "jsonl-v1",
  "op": "create",
  "sessionId": "game-1",
  "solution": "crane"
}
```

Every request requires `id`, `protocolVersion`, and `op`, plus exactly the fields
listed for its operation. Extra or missing fields are rejected. IDs are nonempty
strings up to 128 UTF-16 code units or safe integers. Session IDs contain 1–128 ASCII
letters, digits, `_`, or `-`.

Success responses use `{"id":...,"protocolVersion":"jsonl-v1","ok":true,"result":...}`.
Errors use `{"id":...,"protocolVersion":"jsonl-v1","ok":false,"error":{"code":...}}`.
Framing, decoding, and unidentifiable-request errors use `id: null`.

IDs correlate requests and responses; they are not idempotency keys. Repeating an
action request executes it again. Do not automatically retry an uncertain action
after a timeout on a live connection.

## Operations

| Operation    | Additional fields       | Result                                                                            |
| ------------ | ----------------------- | --------------------------------------------------------------------------------- |
| `info`       | none                    | Package/rules/dictionary/selection/input/transport versions and limits            |
| `dictionary` | none                    | Ordered answer list, deduplicated allowed words, source metadata and fingerprints |
| `create`     | `sessionId`, `solution` | New observation and zeroed session counters                                       |
| `reset`      | `sessionId`, `solution` | Replace an existing session with a new game and zeroed counters                   |
| `observe`    | `sessionId`             | Current observation and counters without changing state                           |
| `act`        | `sessionId`, `action`   | Accepted flag, feedback, observation and counters after one input action          |
| `batch`      | `sessionId`, `actions`  | Ordered per-action results for one session                                        |
| `drop`       | `sessionId`             | Remove the session; return its ID                                                 |

`create` rejects duplicate IDs. `reset` requires an existing ID; an invalid solution
does not destroy the previous game. Solutions must satisfy the existing dictionary
check, including Custom-compatible additional guesses. The trusted runner selects
and supplies solutions. Never forward those creation requests to a model.

Session views contain `sessionId`, `observation`, and `stats`. `act` adds `accepted`
and `feedback`. `batch` returns `sessionId` and a `results` array, with each element
containing only `accepted`, `feedback`, `observation`, and `stats`. No response exposes
privileged game/session state or a selected solution field. The dictionary operation
returns the public answer pool, not which answer belongs to a session. Submitted
guesses can of course contain the answer after a successful guess.

Input actions and feedback are defined in [INPUT_PROTOCOL.md](INPUT_PROTOCOL.md).
For example:

```json
{"id":2,"protocolVersion":"jsonl-v1","op":"act","sessionId":"game-1","action":{"type":"type","letter":"c"}}
{"id":3,"protocolVersion":"jsonl-v1","op":"act","sessionId":"game-1","action":{"type":"enter"}}
{"id":4,"protocolVersion":"jsonl-v1","op":"act","sessionId":"game-1","action":{"type":"submit","word":"crane"}}
```

The second response is a successful transport exchange (`ok: true`) with a rejected
game action (`accepted: false`, feedback `word_incomplete`). It consumes no guess.
Protocol errors do not count as input actions; malformed actions inside a valid
`act` request do count as rejected input actions.

## Batches and bounds

- At most 128 live sessions per process; `drop` frees capacity.
- At most 128 actions per batch, and the array must be nonempty.
- At most 65,536 request bytes, excluding LF but including any CR. Oversized frames
  are discarded through the next newline, with bounded request buffering.
- The Python client accepts response frames up to 4 MiB, sufficient for these
  limits and the bundled dictionary.

Invalid batch envelopes or size limits reject the request before any action runs.
A valid batch runs sequentially. Game-action rejections do not roll it back or stop
later actions; actions after a terminal result return `game_over` with no changes.

Batching is useful for replay and predetermined actions. It does not provide a
policy the opportunity to inspect intermediate observations before choosing later
actions. A character-level model that decides after every observation should use
individual `act` requests.

Protocol error codes are `invalid_json`, `line_too_long`, `invalid_request`,
`unsupported_version`, `unknown_operation`, `session_exists`, `session_not_found`,
`session_limit`, `invalid_solution`, and `batch_limit`. Invalid JSON/UTF-8 or a bad
request does not prevent processing the next valid frame. Responses never echo
raw invalid requests or exception stacks.

## Python reference client

`python/wor_chain_dle/` is a Python 3.9+ standard-library module, also shipped in
the npm tarball. There is no separate PyPI distribution. Add the checkout/package's
`python` directory to `PYTHONPATH`, or vendor the module into a consumer.

```python
from wor_chain_dle import EngineClient

with EngineClient(["node", "/path/to/engine/bin/wor-chain-dle-jsonl.mjs"]) as client:
    initial = client.create("game-1", "crane")
    for letter in "crane":
        result = client.act("game-1", {"type": "type", "letter": letter})
    result = client.act("game-1", {"type": "enter"})
    assert result["feedback"]["code"] == "win"
    client.reset("game-1", "stale")
    result = client.act("game-1", {"type": "submit", "word": "stale"})
```

One client owns one process, performs an `info` handshake, and serializes requests
even when called by multiple Python threads. It uses an I/O worker so its timeout
covers both writing and reading. stderr is inherited, preventing unread stderr-pipe
deadlocks. A timeout, cancelled exchange, EOF, malformed response, wrong version/ID, or broken pipe
closes and reaps the process rather than leaving an uncertain connection reusable.
Normal context-manager exit closes stdin and waits for the process.

- `EngineRequestError.code`: recoverable protocol rejection; connection remains usable.
- `EngineConnectionError`: launch/disconnection failure.
- `EngineTimeoutError`: timed-out exchange; connection closed.
- `EngineProtocolError`: invalid/mismatched response; connection closed.
- Game-action rejections remain ordinary returned dictionaries, not exceptions.

Local serialization/oversize errors raise before writing. Each process holds state
in memory only; restarting requires replay or recreating games under runner control.

## Verification

```bash
npm run test:python
```

Set `PYTHON` to a Python executable if `python3` is not appropriate. This command
builds the engine, runs client lifecycle/error tests, and verifies 100 game cases
with seed `20260216`. Each case executes as word actions, serial key actions, and
a key-action batch: 300 sessions within one persistent engine process.

Four curated cases cover first/sixth-guess wins, dead end, and guess-limit loss.
The other 96 choose random chain-legal words from public observations/dictionaries.
Key traces include incomplete Enter, empty Backspace, an unknown word, correction,
and blocked typing. Every feedback, observation, and counter is compared with a
separate direct-library replay; batched results must equal serial key results.
Interleaved sessions must remain independent. Validation plans containing answers
exist only in temporary verifier files and are not model input.

The report records versions, seed, process starts, end reasons, and timings.
Per-mode timings cover action exchanges, excluding startup, dictionary retrieval,
session creation/drop, and policy selection. Direct-reference compute time excludes
process startup and JSON output. These are diagnostic timings, not an LLM training
benchmark or a performance guarantee. Batch action throughput includes many actions
per exchange and must not be interpreted as adaptive per-character decision speed.
