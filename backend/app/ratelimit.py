"""Fixed-window rate limiting. Uses Redis when configured, otherwise a per-process dict."""
from __future__ import annotations

import logging
import threading
import time
from functools import lru_cache

from fastapi import HTTPException

from .config import get_settings

log = logging.getLogger(__name__)


@lru_cache
def get_redis():
    url = get_settings().redis_url
    if not url:
        return None
    try:
        import redis

        client = redis.Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2)
        return client
    except Exception:  # pragma: no cover - import/config problems
        log.warning("redis unavailable; using in-process rate limits")
        return None


class RateLimiter:
    def __init__(self):
        self._mem: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        """Count one hit. Returns (allowed, retry_after_seconds)."""
        if limit <= 0:
            return True, 0
        now = time.time()
        bucket = int(now // window_seconds)
        full_key = f"rl:{key}:{bucket}"
        retry_after = int((bucket + 1) * window_seconds - now) + 1
        r = get_redis()
        if r is not None:
            try:
                pipe = r.pipeline()
                pipe.incr(full_key)
                pipe.expire(full_key, window_seconds + 5)
                count = pipe.execute()[0]
                return count <= limit, retry_after
            except Exception:
                log.warning("redis error during rate limiting; falling back to memory")
        with self._lock:
            count, exp = self._mem.get(full_key, (0, now + window_seconds))
            count += 1
            self._mem[full_key] = (count, exp)
            if len(self._mem) > 50_000:
                self._mem = {k: v for k, v in self._mem.items() if v[1] > now}
        return count <= limit, retry_after

    def reset(self):
        with self._lock:
            self._mem.clear()


limiter = RateLimiter()


def enforce(key: str, limit: int, window_seconds: int, message: str = "Too many requests") -> None:
    allowed, retry_after = limiter.hit(key, limit, window_seconds)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"{message}. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )
