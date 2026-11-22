import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]


class TerminalTests(unittest.TestCase):
    def play(self, text, *arguments):
        return subprocess.run(
            [sys.executable, str(ROOT / "python/play.py"), "--no-color", *arguments],
            input=text, text=True, encoding="utf-8", capture_output=True,
            cwd=ROOT, env=os.environ.copy(), timeout=10,
        )

    def test_full_word_play_hides_json_and_reports_actual_actions(self):
        result = self.play("prior\n/quit\n", "--solution", "prior")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Solved in 1/6!", result.stdout)
        self.assertIn("Answer: PRIOR", result.stdout)
        self.assertIn("Direct submissions: 1", result.stdout)
        self.assertNotIn('"protocolVersion"', result.stdout)
        self.assertNotIn('"observation"', result.stdout)

    def test_key_editing_error_recovery_and_stats(self):
        result = self.play("/type priox\n/enter\n/bs\nr\n\n/quit\n", "--solution", "prior")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No word like that", result.stdout)
        self.assertIn("Solved in 1/6!", result.stdout)
        self.assertIn("Typed: 6 | Backspace: 1 | Enter: 2 | Direct submissions: 0", result.stdout)

    def test_new_help_and_eof_do_not_reveal_unplayed_answers(self):
        result = self.play("/help\n/new\n", "--seed", "123")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("New game.", result.stdout)
        self.assertIn("Goodbye.", result.stdout)
        self.assertNotIn("Answer:", result.stdout)
        self.assertNotIn("Traceback", result.stderr)

    def test_invalid_fixed_answer_is_a_readable_error(self):
        result = self.play("", "--solution", "zzzzz")
        self.assertEqual(result.returncode, 1)
        self.assertIn("not in the dictionary", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
