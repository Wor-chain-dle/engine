"""Validate a persistent Python/Node connection against direct engine execution.

Four curated games cover all end reasons; remaining games use a seeded random
chain-legal policy whose decisions receive observations and a public dictionary,
not solutions. Replayed key and batch runs use those same word choices.
"""

import argparse
import json
import os
from pathlib import Path
import random
import subprocess
import tempfile
import time

from wor_chain_dle import EngineClient

ROOT = Path(__file__).resolve().parents[1]
CURATED = [
    ("crane", ["crane"]),
    ("crane", ["stale", "blaze", "boost", "first", "forge", "crane"]),
    ("crane", ["stale", "blaze", "boost", "first", "flood"]),
    ("crane", ["stale", "blaze", "boost", "first", "forge", "pride"]),
]


def action_view(result):
    return {key: result[key] for key in ("accepted", "feedback", "observation", "stats")}


def choose_word(observation, allowed_words, rng):
    chain = observation["chain"]
    if chain:
        index = observation["input"]["lockedIndex"]
        allowed_words = [word for word in allowed_words if word[index] == chain["letter"]]
    return rng.choice(allowed_words)


def key_actions(words, observations):
    actions = []
    for row, word in enumerate(words):
        locked_index = observations[row]["input"]["lockedIndex"]
        actions.extend([{"type": "enter"}, {"type": "backspace"}])
        if row == 0:
            actions.extend({"type": "type", "letter": letter} for letter in "zzzzz")
            actions.append({"type": "enter"})
            actions.extend({"type": "backspace"} for _ in range(5))
        editable = "".join(letter for index, letter in enumerate(word) if index != locked_index)
        actions.extend({"type": "type", "letter": letter} for letter in editable)
        actions.extend([{"type": "type", "letter": "x"}, {"type": "enter"}])
    return actions


def verify(games, seed):
    node = os.environ.get("WCD_NODE_BINARY", "node")
    server = os.environ.get("WCD_ENGINE_SERVER", str(ROOT / "bin/wor-chain-dle-jsonl.mjs"))
    module = os.environ.get("WCD_ENGINE_MODULE", str(ROOT / "dist/index.js"))
    rng = random.Random(seed)
    plans = []
    wire_results = []
    elapsed = {"word": 0.0, "key": 0.0, "batch": 0.0}
    actions_count = {key: 0 for key in elapsed}
    endings = {}
    startup = time.perf_counter()
    with EngineClient([node, server]) as client:
        startup_ms = (time.perf_counter() - startup) * 1000
        pid = client.pid
        dictionary = client.dictionary()
        assert "zzzzz" not in dictionary["allowedWords"]
        for index in range(games):
            solution = CURATED[index][0] if index < len(CURATED) else rng.choice(dictionary["answers"])
            created = client.create("word", solution)
            assert "solution" not in json.dumps(created)
            observation = created["observation"]
            words = []
            word_results = []
            while observation["status"] == "playing":
                # Only this policy's inputs determine random choices, not solution.
                word = CURATED[index][1][len(words)] if index < len(CURATED) else choose_word(observation, dictionary["allowedWords"], rng)
                words.append(word)
                started = time.perf_counter()
                result = client.act("word", {"type": "submit", "word": word})
                elapsed["word"] += time.perf_counter() - started
                assert result["accepted"]
                word_results.append(action_view(result))
                observation = result["observation"]
            actions_count["word"] += len(words)
            endings[observation["endReason"]] = endings.get(observation["endReason"], 0) + 1
            plans.append({"solution": solution, "actions": [{"type": "submit", "word": word} for word in words]})
            wire_results.append(word_results)

            # Interleave sessions and ensure editing one does not change the other.
            client.create("key", solution)
            expected_word = client.observe("word")
            keys = key_actions(words, [created["observation"]] + [result["observation"] for result in word_results[:-1]])
            key_results = []
            for action in keys:
                started = time.perf_counter()
                result = client.act("key", action)
                elapsed["key"] += time.perf_counter() - started
                key_results.append(action_view(result))
            actions_count["key"] += len(keys)
            assert key_results[-1]["observation"] == observation
            assert client.observe("word") == expected_word
            plans.append({"solution": solution, "actions": keys})
            wire_results.append(key_results)

            client.create("batch", solution)
            started = time.perf_counter()
            batched = client.batch("batch", keys)["results"]
            elapsed["batch"] += time.perf_counter() - started
            actions_count["batch"] += len(keys)
            assert batched == key_results
            assert client.pid == pid
            for session_id in ("word", "key", "batch"):
                client.drop(session_id)
        info = client.info

    # Compare every action, feedback, observation and counter against direct calls.
    # Temporary plans contain solutions for the trusted verifier, not model inputs.
    with tempfile.TemporaryDirectory(prefix="wcd-python-parity-") as directory:
        plan_path = Path(directory) / "plans.json"
        plan_path.write_text(json.dumps(plans), encoding="utf-8")
        reference = subprocess.run(
            [node, str(ROOT / "scripts/reference-replay.mjs"), str(plan_path), module],
            text=True, encoding="utf-8", capture_output=True, check=True, timeout=30,
        )
        expected = json.loads(reference.stdout)
    assert wire_results == expected["results"], "Direct-library/Python transport mismatch"
    assert set(endings) == {"win", "dead_end", "guess_limit"}
    return {
        "games": games, "seed": seed, "engineProcessStarts": 1,
        "executedSessions": games * 3, "allResultsMatchDirect": True,
        "batchMatchesSerialKeys": True, "endReasons": endings,
        "startupMs": round(startup_ms, 3),
        "directReferenceComputeMs": round(expected["computeMs"], 3),
        "modes": {mode: {"actions": actions_count[mode], "elapsedMs": round(elapsed[mode] * 1000, 3),
                         "actionsPerSecond": round(actions_count[mode] / elapsed[mode])} for mode in elapsed},
        "versions": info,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--seed", type=int, default=20260216)
    args = parser.parse_args()
    if not 4 <= args.games <= 1000:
        parser.error("games must be between 4 and 1000")
    print(json.dumps(verify(args.games, args.seed), ensure_ascii=False, indent=2))
