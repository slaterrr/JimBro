"""In-process event bus feeding the Pi station display.

Each event gets a monotonically increasing ``seq`` so clients can discard duplicates or
out-of-order deliveries after reconnecting. Slow subscribers lose their oldest events,
never the newest. Publishing is safe from FastAPI's worker threads.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any

Event = dict[str, Any]


class EventBus:
    def __init__(self, max_queue: int = 100) -> None:
        self.max_queue = max_queue
        self.subscribers: dict[asyncio.Queue[Event], asyncio.AbstractEventLoop] = {}
        self.last: Event | None = None
        self._seq = 0
        self._lock = threading.Lock()

    def subscribe(self) -> asyncio.Queue[Event]:
        queue: asyncio.Queue[Event] = asyncio.Queue()
        self.subscribers[queue] = asyncio.get_running_loop()
        return queue

    def unsubscribe(self, queue: asyncio.Queue[Event]) -> None:
        self.subscribers.pop(queue, None)

    def _put(self, queue: asyncio.Queue[Event], event: Event) -> None:
        while queue.qsize() >= self.max_queue:
            queue.get_nowait()
        queue.put_nowait(event)

    def publish(self, event: Event) -> Event:
        with self._lock:
            self._seq += 1
            stamped = {**event, "seq": self._seq}
            self.last = stamped
        try:
            current: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
        except RuntimeError:
            current = None
        for queue, loop in list(self.subscribers.items()):
            if loop is current:
                self._put(queue, stamped)
            else:
                loop.call_soon_threadsafe(self._put, queue, stamped)
        return stamped
