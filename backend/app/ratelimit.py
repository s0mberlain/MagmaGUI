"""Failed sign-in attempts per client address (in memory, per process).

The account lockout (MAX_FAILED_LOGINS) protects one account; this limits password spraying over
many accounts from one address. With several replicas each counts on its own, which still caps the
rate at replicas x LOGIN_IP_MAX_FAILURES per window.
"""

import threading
import time
from collections import deque


class FailureLimiter:
    def __init__(self, max_failures: int, window_seconds: int):
        self.max = max_failures
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        q = self._hits.setdefault(key, deque())
        while q and q[0] <= now - self.window:
            q.popleft()
        return q

    def blocked(self, key: str | None) -> bool:
        if not key or self.max <= 0:
            return False
        with self._lock:
            q = self._prune(key, time.monotonic())
            if not q:
                self._hits.pop(key, None)
            return len(q) >= self.max

    def failed(self, key: str | None) -> None:
        if not key or self.max <= 0:
            return
        with self._lock:
            now = time.monotonic()
            self._prune(key, now).append(now)
            if len(self._hits) > 50_000:  # keep memory bounded under a flood of addresses
                for k in [k for k, q in self._hits.items() if not q or q[-1] <= now - self.window]:
                    del self._hits[k]
