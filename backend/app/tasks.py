"""Celery application: delivery processing with retries, plus scheduled maintenance."""
from __future__ import annotations

import logging
import uuid

from celery import Celery

from .config import get_settings
from .logging_conf import configure_logging

log = logging.getLogger(__name__)
_s = get_settings()

celery_app = Celery("mailbox", broker=_s.redis_url or "memory://", backend=None)
celery_app.conf.update(
    task_acks_late=True,                # a crashed worker leaves the task for another worker
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_ignore_result=True,
    broker_connection_retry_on_startup=True,
    timezone="UTC",
    beat_schedule={
        "retention-cleanup": {"task": "mailbox.cleanup", "schedule": 3600.0},
        "requeue-stale-deliveries": {"task": "mailbox.requeue_stale", "schedule": 300.0},
    },
)

MAX_RETRIES = 5


@celery_app.on_after_configure.connect
def _setup_logging(**_):  # pragma: no cover - worker bootstrap
    configure_logging(_s.log_level)


@celery_app.task(name="mailbox.process_delivery", bind=True, max_retries=MAX_RETRIES)
def process_delivery_task(self, delivery_id: str) -> str:
    from .mail.ingest import TransientError, process_delivery

    final = self.request.retries >= MAX_RETRIES
    try:
        return process_delivery(delivery_id, final_attempt=final)
    except TransientError as exc:
        # 15 s, 30 s, 60 s, 120 s, 240 s
        raise self.retry(exc=exc, countdown=15 * (2 ** self.request.retries))


@celery_app.task(name="mailbox.cleanup")
def cleanup_task() -> dict:
    from .maintenance import run_cleanup

    return run_cleanup()


@celery_app.task(name="mailbox.requeue_stale")
def requeue_stale_task() -> int:
    from .db import SessionLocal
    from .mail.ingest import stale_queued_deliveries

    db = SessionLocal()
    try:
        ids = stale_queued_deliveries(db)
    finally:
        db.close()
    for did in ids:
        enqueue_delivery(did)
    return len(ids)


def enqueue_delivery(delivery_id: uuid.UUID | str) -> None:
    """Hand a delivery to the worker. With PROCESS_INLINE it is processed immediately in-process."""
    if get_settings().process_inline:
        from .mail.ingest import process_delivery

        process_delivery(delivery_id, final_attempt=True)
        return
    try:
        process_delivery_task.delay(str(delivery_id))
    except Exception:
        # Broker unavailable: the delivery stays "queued" and requeue_stale picks it up later.
        log.warning("could not enqueue delivery %s; it will be retried by the scheduler", delivery_id)
