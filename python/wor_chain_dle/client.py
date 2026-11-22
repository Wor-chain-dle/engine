"""Persistent, synchronous JSONL connection. Python 3.9+, no third-party packages."""

from __future__ import annotations

import json
import math
import queue
import subprocess
import threading
from typing import Any, Sequence

PROTOCOL_VERSION = "jsonl-v1"
MAX_REQUEST_BYTES = 65536
MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class EngineError(Exception):
    """Base class for engine client errors."""


class EngineRequestError(EngineError):
    """A recoverable protocol rejection, distinct from accepted=False game actions."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class EngineConnectionError(EngineError):
    pass


class EngineProtocolError(EngineError):
    pass


class EngineTimeoutError(EngineConnectionError):
    pass


class EngineClient:
    """One persistent process; requests are serialized, including across threads.

    stderr is inherited, never mixed with protocol stdout or left in an unread pipe.
    The I/O worker permits a timeout covering both request writes and response reads.
    A timeout or broken protocol closes the connection instead of risking desync.
    """

    def __init__(self, command: Sequence[str], timeout: float = 10.0):
        if not command or isinstance(command, (str, bytes)):
            raise ValueError("command must be a nonempty argument sequence")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("timeout must be finite and positive")
        self.timeout = timeout
        self._lock = threading.RLock()
        self._closed = False
        self._next_id = 0
        self._writes: queue.Queue = queue.Queue()
        self._responses: queue.Queue = queue.Queue()
        try:
            self._process = subprocess.Popen(
                list(command), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=None, shell=False,
            )
        except OSError as error:
            raise EngineConnectionError("Cannot start engine process") from error
        self._worker = threading.Thread(target=self._exchange, daemon=True)
        self._worker.start()
        try:
            self.info = self.request("info")
        except BaseException:
            self._shutdown(force=True)
            raise

    @property
    def pid(self) -> int:
        return self._process.pid

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def returncode(self):
        return self._process.poll()

    def _exchange(self):
        while True:
            payload = self._writes.get()
            if payload is None:
                return
            try:
                self._process.stdin.write(payload)
                self._process.stdin.flush()
                line = self._process.stdout.readline(MAX_RESPONSE_BYTES + 1)
                self._responses.put(line)
            except (OSError, ValueError) as error:
                self._responses.put(error)
                return

    def request(self, op: str, **fields) -> dict[str, Any]:
        """Return result data, or raise a typed transport/request error.

        Game input failures remain normal results with accepted=False and feedback.
        Do not forward runner requests (which can contain a solution) to a model.
        """
        with self._lock:
            if self._closed:
                raise EngineConnectionError("Engine client is closed")
            if {"id", "protocolVersion", "op"}.intersection(fields):
                raise ValueError("Reserved envelope fields cannot be overridden")
            self._next_id += 1
            request_id = "py-" + str(self._next_id)
            payload = json.dumps(
                {"id": request_id, "protocolVersion": PROTOCOL_VERSION, "op": op, **fields},
                ensure_ascii=False, allow_nan=False, separators=(",", ":"),
            ).encode("utf-8")
            if len(payload) > MAX_REQUEST_BYTES:
                raise ValueError("Request exceeds the JSONL byte limit")
            self._writes.put(payload + b"\n")
            try:
                line = self._responses.get(timeout=self.timeout)
            except queue.Empty:
                self._shutdown(force=True)
                raise EngineTimeoutError("Engine response timed out") from None
            except BaseException:
                # Cancellation must not leave a writer/read blocked behind close().
                self._shutdown(force=True)
                raise
            if isinstance(line, BaseException) or not line:
                self._shutdown(force=True)
                raise EngineConnectionError("Engine process disconnected")
            try:
                if len(line) > MAX_RESPONSE_BYTES or not line.endswith(b"\n"):
                    raise ValueError("Invalid response framing")
                response = json.loads(line.decode("utf-8"))
                if not isinstance(response, dict):
                    raise ValueError("Invalid response envelope")
                if response.get("id") != request_id or response.get("protocolVersion") != PROTOCOL_VERSION:
                    raise ValueError("Mismatched response envelope")
                if response.get("ok") is False:
                    error = response.get("error")
                    if not isinstance(error, dict) or not isinstance(error.get("code"), str):
                        raise ValueError("Invalid error response")
                    raise EngineRequestError(error["code"])
                if response.get("ok") is not True or not isinstance(response.get("result"), dict):
                    raise ValueError("Invalid success response")
                return response["result"]
            except EngineRequestError:
                raise
            except (ValueError, UnicodeError):
                self._shutdown(force=True)
                raise EngineProtocolError("Invalid JSONL response") from None

    def create(self, session_id: str, solution: str):
        return self.request("create", sessionId=session_id, solution=solution)

    def reset(self, session_id: str, solution: str):
        return self.request("reset", sessionId=session_id, solution=solution)

    def observe(self, session_id: str):
        return self.request("observe", sessionId=session_id)

    def act(self, session_id: str, action):
        return self.request("act", sessionId=session_id, action=action)

    def batch(self, session_id: str, actions):
        return self.request("batch", sessionId=session_id, actions=actions)

    def drop(self, session_id: str):
        return self.request("drop", sessionId=session_id)

    def dictionary(self):
        return self.request("dictionary")

    def _shutdown(self, force: bool):
        if self._closed:
            return
        self._closed = True
        self._writes.put(None)
        if force and self._process.poll() is None:
            try:
                self._process.terminate()
            except ProcessLookupError:
                pass
        if not force:
            try:
                self._process.stdin.close()
            except (OSError, ValueError):
                pass
        try:
            self._process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait()
        self._worker.join(timeout=1)
        for stream in (self._process.stdin, self._process.stdout):
            try:
                stream.close()
            except (OSError, ValueError):
                pass

    def close(self):
        with self._lock:
            self._shutdown(force=False)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
