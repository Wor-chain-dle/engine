"""Small line-oriented terminal adapter; game rules stay in the JSONL engine."""

import argparse
import os
from pathlib import Path
import random
import sys

from .client import EngineClient, EngineError, EngineRequestError

ROOT = Path(__file__).resolve().parents[2]
HELP = """Enter a five-letter word to submit it, including the locked letter.
Enter one letter to add it to the draft. An empty line submits the draft.
/type TEXT   Add editable letters one by one
/bs          Delete the last editable letter
/enter       Submit the draft
/new         Start another game
/help        Show these commands
/quit        Exit (Ctrl+D also exits)
Green = correct, purple = present, gray = absent. [X] is a locked chain letter.
This is a line-oriented demo: press Enter after each command.
Use /bs to record an engine deletion; terminal line editing is not counted."""

MESSAGES = {
    "word_submitted": "Guess submitted.",
    "word_incomplete": "Word not completed. Fill all editable cells first.",
    "word_not_found": "No word like that in the dictionary. Edit the draft or try another word.",
    "input_full": "The draft is full. Use /bs or submit it.",
    "input_empty": "Nothing to delete. Locked letters cannot be deleted.",
    "invalid_action": "Unsupported input action.",
    "invalid_character": "Use one English letter at a time (a-z).",
    "invalid_length": "Submit exactly five letters, including the locked letter.",
    "chain_mismatch": "That word does not match the locked chain letter.",
    "game_over": "This game has ended. Use /new or /quit.",
}


def render_board(observation, color=False):
    lines = []
    history = observation["guesses"]
    draft = observation["input"]
    colors = {"correct": "32", "present": "35", "absent": "90"}
    for row in range(observation["maxGuesses"]):
        if row < len(history):
            guess = history[row]
            cells = []
            for letter, status in zip(guess["word"], guess["feedback"]):
                cell = " " + letter.upper() + " "
                if color:
                    cell = "\033[" + colors[status] + "m" + cell + "\033[0m"
                cells.append(cell)
            lines.append(str(row + 1) + "  " + " ".join(cells))
        else:
            cells = []
            for index in range(observation["wordLength"]):
                letter = draft["cells"][index] if draft and row == len(history) else None
                locked = draft and row == len(history) and index == draft["lockedIndex"]
                cells.append("[" + letter.upper() + "]" if locked else " " + (letter.upper() if letter else "_") + " ")
            lines.append(str(row + 1) + "  " + " ".join(cells))
    if draft and draft["lockedIndex"] is not None:
        lines.append("Locked position: " + str(draft["lockedIndex"] + 1) + ", letter: " + observation["chain"]["letter"].upper())
    return "\n".join(lines)


def show_result(result, solution, color):
    observation = result["observation"]
    print()
    print(render_board(observation, color))
    code = result.get("feedback", {}).get("code")
    if code in MESSAGES:
        print(MESSAGES[code])
    if observation["status"] != "playing":
        if observation["status"] == "won":
            print("Solved in " + str(observation["guessCount"]) + "/" + str(observation["maxGuesses"]) + "!")
        elif observation["endReason"] == "dead_end":
            print("Dead end: the next locked letter rules out the answer.")
        else:
            print("No guesses left.")
        print("Answer: " + solution.upper())
        stats = result["stats"]
        print("Typed: {lettersTyped} | Backspace: {backspacePresses} | Enter: {enterPresses} | Direct submissions: {directSubmissions}".format(**stats))
        print("Use /new for another game, or /quit.")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Play Wor-chain-dle without typing JSON.")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--solution", help="fixed answer for testing")
    selection.add_argument("--seed", type=int, help="seed for reproducible random answers")
    parser.add_argument("--node", default=os.environ.get("WCD_NODE_BINARY", "node"))
    parser.add_argument("--server", default=os.environ.get("WCD_ENGINE_SERVER", str(ROOT / "bin/wor-chain-dle-jsonl.mjs")))
    parser.add_argument("--no-color", action="store_true")
    args = parser.parse_args(argv)
    if not Path(args.server).is_file():
        print("Engine server not found. Run npm run build, or specify --server.", file=sys.stderr)
        return 2
    if not (ROOT / "dist/jsonl.js").is_file() and args.server == str(ROOT / "bin/wor-chain-dle-jsonl.mjs"):
        print("Build the engine first: npm run build", file=sys.stderr)
        return 2
    rng = random.Random(args.seed)
    color = sys.stdout.isatty() and not args.no_color and "NO_COLOR" not in os.environ
    try:
        with EngineClient([args.node, args.server]) as client:
            answers = client.dictionary()["answers"]

            def choose_answer():
                return args.solution.strip().lower() if args.solution else rng.choice(answers)

            solution = choose_answer()
            initial = client.create("terminal", solution)
            print("Wor-chain-dle | 5 letters, 6 guesses")
            print(HELP)
            show_result(initial, solution, color)
            while True:
                try:
                    line = input("\n> ").strip()
                except EOFError:
                    print("\nGoodbye.")
                    return 0
                command, _, argument = line.partition(" ")
                command = command.lower()
                if command in ("/quit", "/q"):
                    print("Goodbye.")
                    return 0
                if command == "/help":
                    print(HELP)
                    continue
                if command == "/new":
                    solution = choose_answer()
                    result = client.reset("terminal", solution)
                    print("New game.")
                elif command in ("/bs", "/backspace"):
                    result = client.act("terminal", {"type": "backspace"})
                elif command == "/enter" or not line:
                    result = client.act("terminal", {"type": "enter"})
                elif command == "/type":
                    if not argument:
                        print("Usage: /type TEXT")
                        continue
                    for letter in argument.lower():
                        result = client.act("terminal", {"type": "type", "letter": letter})
                        if not result["accepted"]:
                            break
                elif command.startswith("/"):
                    print("Unknown command. Use /help.")
                    continue
                elif len(line) == 1:
                    result = client.act("terminal", {"type": "type", "letter": line.lower()})
                else:
                    result = client.act("terminal", {"type": "submit", "word": line.lower()})
                show_result(result, solution, color)
    except KeyboardInterrupt:
        print("\nGoodbye.")
        return 130
    except EngineRequestError as error:
        message = "That solution is not in the dictionary." if error.code == "invalid_solution" else "Engine request failed: " + error.code
        print(message, file=sys.stderr)
        return 1
    except EngineError as error:
        print("Engine connection failed: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
