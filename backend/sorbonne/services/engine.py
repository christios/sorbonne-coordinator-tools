"""The one pool of database connections this process keeps.

Every store here used to call `create_engine` in its own `__init__`, and every store is
built fresh by `Depends(...)` on every request. An engine's pool starts empty, so each of
those requests opened a brand-new connection: TCP, then TLS, then the password exchange,
all of it across the network to a database that is not on the same machine. Measured
against production that cost between two and four tenths of a second — *per store*, and a
request that reads through two or three stores paid it two or three times over, before a
single row was read. It was the largest single cost in most of the API's answers.

An `Engine` is thread-safe and is meant to be long-lived; only the connections it hands
out are not. So there is one per database URL for the life of the process, and the stores
borrow it. A second request finds the connection already open and pays nothing.

The pool is kept small deliberately. A connection is held only while a statement runs, so
a handful serves far more requests than that number suggests, and the database has its own
ceiling on how many it will accept — one this process must not try to spend on its own.

`pool_pre_ping` is on, which it could not usefully be before: a ping on a connection that
was opened a microsecond ago tests nothing, and the two hot stores had turned it off for
exactly that reason. On a pooled connection it is the opposite — it is the one round-trip
that tells us the connection has not been closed underneath us while the process idled,
and it costs a fraction of what re-opening one does.
"""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import Engine, create_engine

#: How many connections to hold open, and how far the pool may stretch under load.
POOL_SIZE = 5
MAX_OVERFLOW = 15
#: Replace a connection rather than trust one that has been idle this long.
RECYCLE_SECONDS = 300


@lru_cache(maxsize=8)
def engine_for(database_url: str) -> Engine:
    """The process's engine for this database, made once and shared from then on.

    Keyed by URL so that a test which points at its own database gets its own pool, and
    the cache is bounded so a pathological caller cannot accumulate engines without end.
    """
    return create_engine(
        database_url,
        pool_size=POOL_SIZE,
        max_overflow=MAX_OVERFLOW,
        pool_recycle=RECYCLE_SECONDS,
        pool_pre_ping=True,
    )
