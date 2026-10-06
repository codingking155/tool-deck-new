"""Small in-memory sliding-window rate limiter (per process).

Good enough for a single instance; replace with Redis (e.g. a sorted set per key) when
running several replicas.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque

from errors import ApiError


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        """Record a hit for ``key`` or raise a 429 ``ApiError`` if over the limit."""
        if self.limit <= 0:
            return
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                retry_after = max(1, math.ceil(self.window - (now - hits[0])))
                error = ApiError(
                    429,
                    "rate_limited",
                    f"You're going a little fast. Please wait {retry_after} seconds and try again.",
                )
                error.retry_after = retry_after  # type: ignore[attr-defined]
                raise error
            hits.append(now)
            # Opportunistically drop idle keys so memory stays bounded.
            if len(self._hits) > 10_000:
                for stale in [k for k, v in self._hits.items() if not v or now - v[-1] >= self.window]:
                    self._hits.pop(stale, None)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
