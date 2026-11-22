import json
import os
from pathlib import Path
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from wor_chain_dle import (
    EngineClient, EngineConnectionError, EngineProtocolError,
    EngineRequestError, EngineTimeoutError,
)

ROOT = Path(__file__).resolve().parents[2]
NODE = os.environ.get("WCD_NODE_BINARY", "node")
SERVER = os.environ.get("WCD_ENGINE_SERVER", str(ROOT / "bin/wor-chain-dle-jsonl.mjs"))


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.client = EngineClient([NODE, SERVER])
        self.addCleanup(self.client.close)

    def test_persistent_process_both_input_modes_and_no_answer_in_observations(self):
        client = self.client
        pid = client.pid
        created = client.create("keys", "crane")
        self.assertNotIn("crane", json.dumps(created))
        client.create("word", "crane")
        for letter in "cranx":
            client.act("keys", {"type": "type", "letter": letter})
        invalid = client.act("keys", {"type": "enter"})
        self.assertFalse(invalid["accepted"])
        self.assertEqual(invalid["feedback"]["code"], "word_not_found")
        self.assertEqual(invalid["observation"]["guessCount"], 0)
        self.assertNotIn("crane", json.dumps(invalid))
        client.act("keys", {"type": "backspace"})
        client.act("keys", {"type": "type", "letter": "e"})
        keys = client.act("keys", {"type": "enter"})
        word = client.act("word", {"type": "submit", "word": "crane"})
        self.assertEqual(keys["observation"], word["observation"])
        self.assertEqual(word["stats"]["lettersTyped"], 0)
        self.assertEqual(keys["stats"]["backspacePresses"], 1)
        self.assertEqual(client.pid, pid)

    def test_sessions_reset_drop_and_recoverable_request_errors(self):
        client = self.client
        client.create("a", "crane")
        client.create("b", "stale")
        client.act("a", {"type": "type", "letter": "c"})
        self.assertEqual(client.observe("b")["observation"]["input"]["editableText"], "")
        for op, fields, code in [
            ("create", {"sessionId": "a", "solution": "stale"}, "session_exists"),
            ("reset", {"sessionId": "a", "solution": "zzzzz"}, "invalid_solution"),
            ("observe", {"sessionId": "missing"}, "session_not_found"),
            ("unknown", {}, "unknown_operation"),
            ("batch", {"sessionId": "a", "actions": []}, "batch_limit"),
        ]:
            with self.assertRaises(EngineRequestError) as error:
                client.request(op, **fields)
            self.assertEqual(error.exception.code, code)
            self.assertFalse(client.closed)
        self.assertEqual(client.observe("a")["observation"]["input"]["editableText"], "c")
        reset = client.reset("a", "stale")
        self.assertEqual(reset["stats"]["actionCount"], 0)
        client.drop("a")
        with self.assertRaises(EngineRequestError):
            client.observe("a")

    def test_batch_continues_after_game_rejections_and_preserves_per_action_views(self):
        client = self.client
        client.create("a", "crane")
        result = client.batch("a", [
            {"type": "enter"}, {"type": "submit", "word": "crane"}, {"type": "backspace"},
        ])
        self.assertEqual([item["feedback"]["code"] for item in result["results"]],
                         ["word_incomplete", "win", "game_over"])
        self.assertEqual(client.observe("a")["stats"]["actionCount"], 2)

    def test_dictionary_and_local_serialization_errors(self):
        client = self.client
        dictionary = client.dictionary()
        self.assertEqual(len(dictionary["answers"]), 2315)
        self.assertIn("crane", dictionary["allowedWords"])
        with self.assertRaises(ValueError):
            client.request("info", id="override")
        with self.assertRaises(ValueError):
            client.request("info", value=float("nan"))
        with self.assertRaises(ValueError):
            client.request("info", value="x" * 65536)
        self.assertFalse(client.closed)
        self.assertEqual(client.request("info"), client.info)

    def test_threads_serialize_requests_and_close_reaps_process(self):
        client = self.client
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: client.request("info"), range(16)))
        self.assertTrue(all(result == client.info for result in results))
        client.close()
        client.close()
        self.assertTrue(client.closed)
        self.assertEqual(client.returncode, 0)
        with self.assertRaises(EngineConnectionError):
            client.request("info")

    def test_cancelled_exchange_closes_and_reaps_the_process(self):
        client = self.client
        with patch.object(client._responses, "get", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                client.request("info")
        self.assertTrue(client.closed)
        self.assertIsNotNone(client.returncode)


class BrokenProcessTests(unittest.TestCase):
    def test_missing_executable(self):
        with self.assertRaises(EngineConnectionError):
            EngineClient([str(ROOT / "nonexistent-engine-binary")])

    def test_process_exit_after_handshake_closes_the_client(self):
        client = EngineClient([NODE, SERVER])
        self.addCleanup(client.close)
        client._process.kill()
        client._process.wait()
        with self.assertRaises(EngineConnectionError):
            client.request("info")
        self.assertTrue(client.closed)
        self.assertIsNotNone(client.returncode)

    def test_eof_during_handshake(self):
        with self.assertRaises(EngineConnectionError):
            EngineClient([sys.executable, "-u", "-c", "pass"])

    def test_timeout_covers_a_process_that_does_not_read_requests(self):
        with self.assertRaises(EngineTimeoutError):
            EngineClient([sys.executable, "-u", "-c", "import time; time.sleep(60)"], timeout=0.1)

    def test_bad_json_and_wrong_request_id(self):
        for response in ["not json\n", json.dumps({"protocolVersion": "jsonl-v1", "id": "wrong", "ok": True, "result": {}}) + "\n"]:
            code = "import sys; sys.stdin.readline(); sys.stdout.write(" + repr(response) + "); sys.stdout.flush()"
            with self.assertRaises(EngineProtocolError):
                EngineClient([sys.executable, "-u", "-c", code])

    def test_truncated_response_closes_the_client(self):
        code = "import sys; request=__import__('json').loads(sys.stdin.readline()); print(__import__('json').dumps({'protocolVersion':'jsonl-v1','id':request['id'],'ok':True,'result':{}}),end='')"
        with self.assertRaises(EngineProtocolError):
            EngineClient([sys.executable, "-u", "-c", code])


if __name__ == "__main__":
    unittest.main()
