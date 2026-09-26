"""Every table, as production holds it, so a developer's database can be production's.

Copy prod used to be a step per feature: cohorts, then students, then rules, then sets —
some thirty hand-written routes through the API, each translating production's ids into
the ones the local writes handed back. Every table added after a step was written was a
table the copy did not know about, and nothing said so. The survey that replaced it found
half the schema missing: warning dismissals, cancellations and covers, the registrar's
removed and added classes, comments, student history, tasks, syllabi, users. Each absence
looked, on a developer's screen, like a bug in the page rather than a hole in the copy.

So this copies tables, not features. Production answers with every table's rows; the
developer's database is emptied and filled with them, ids and all, and a table added
tomorrow travels tomorrow without anybody remembering to teach the copy about it. The one
thing that can still go wrong — a new table nobody has decided about — is caught by a test
that lists the schema and fails on any table that is neither copied nor excluded here with
its reason.

One kind of id is translated, because it is not this database's: a Student Hub semester's.
The Hub is an application with a database of its own, and a developer's Hub holds the
semesters it imported itself, under ids of its own. Whoever copies says which production
semester is which of theirs, and every value naming one is rewritten to name the other —
every table, every text column, so a table added tomorrow is covered tomorrow too.

**No student names travel, because the server holds none.** Staff names and contact
details do: the part-time database is copied like everything else, because a developer's
copy that leaves it behind is a copy whose teacher pages are all wrong.
"""

from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import JSON, MetaData, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Connection, Engine

#: The tables that do not travel, each with the reason. Everything else does. A table
#: belongs here only when copying it would be wrong, never because it is inconvenient.
EXCLUDED: dict[str, str] = {
    "alembic_version": (
        "The schema's own bookkeeping, not data. The two ends must already be at the same "
        "revision; the copy checks that and refuses otherwise, rather than copying it."
    ),
    "api_tokens": (
        "Credentials. Copied, every production token would authenticate against a "
        "developer's laptop. A developer mints their own token in their own Settings."
    ),
}


class SchemaMismatch(Exception):
    """The two databases are at different revisions, so their tables do not line up."""


def _reflect(engine: Engine) -> MetaData:
    held = MetaData()
    held.reflect(bind=engine)
    return held


def copied_tables(engine: Engine) -> list[str]:
    """Every table that travels, parents before children.

    In dependency order so a reader can follow a copy table by table, and so a load that
    could not switch the foreign keys off would still land. The two folder trees that
    point at themselves are not ordered by this, and do not need to be: the load switches
    the checks off for its own transaction.
    """
    return [table.name for table in _reflect(engine).sorted_tables if table.name not in EXCLUDED]


def revision(engine: Engine) -> str:
    with engine.connect() as connection:
        return str(connection.execute(text("SELECT version_num FROM alembic_version")).scalar() or "")


def row_counts(engine: Engine) -> dict[str, int]:
    with engine.connect() as connection:
        return {
            name: int(connection.execute(text(f'SELECT count(*) FROM "{name}"')).scalar() or 0)  # noqa: S608
            for name in copied_tables(engine)
        }


def _plain(value: Any) -> Any:
    """A column's value as JSON can carry it, and as Postgres will take it back."""
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, bytes | memoryview):
        raise TypeError("A binary column has appeared. Decide how it travels before copying it.")
    return value


def export_table(engine: Engine, name: str) -> dict[str, Any]:
    """One table, every row, in its own column order. Refuses an excluded or unknown name."""
    if name in EXCLUDED or name not in set(copied_tables(engine)):
        raise KeyError(name)
    table = _reflect(engine).tables[name]
    columns = [column.name for column in table.columns]
    order = ", ".join(f'"{column}"' for column in (table.primary_key.columns.keys() or columns[:1]))
    # JSON columns travel as their own text. Read as Python, the JSON value null and an
    # empty cell are both None, and a column that must not be empty but holds null — the
    # syllabus history does, for a field that had no value before — would arrive empty and
    # be refused. As text, "null" is null and None is nothing.
    quoted = ", ".join(
        f'"{column.name}"::text AS "{column.name}"' if isinstance(column.type, JSONB) else f'"{column.name}"'
        for column in table.columns
    )
    with engine.connect() as connection:
        rows = connection.execute(text(f'SELECT {quoted} FROM "{name}" ORDER BY {order}')).all()  # noqa: S608
    return {"table": name, "columns": columns, "rows": [[_plain(value) for value in row] for row in rows]}


def _rename(connection: Connection, held: MetaData, names: list[str], renames: dict[str, str]) -> None:
    """Every copied value that names one of these ids names its counterpart instead.

    Wherever it is: a column of its own (a set's semester), part of a key (a dismissed
    warning's), or inside JSON. Ids are UUIDs, so a match in the middle of a value is
    that id and never a coincidence.
    """
    for name in names:
        for column in held.tables[name].columns:
            if isinstance(column.type, JSON | JSONB):
                value, back = f'"{column.name}"::text', "::jsonb" if isinstance(column.type, JSONB) else "::json"
            elif isinstance(column.type, String):
                value, back = f'"{column.name}"', ""
            else:
                continue
            for old, new in renames.items():
                connection.execute(
                    text(
                        f'UPDATE "{name}" SET "{column.name}" = replace({value}, :old, :new){back} '  # noqa: S608
                        f"WHERE strpos({value}, :old) > 0"
                    ),
                    {"old": old, "new": new},
                )


def load_tables(
    engine: Engine,
    tables: dict[str, dict[str, Any]],
    *,
    source_revision: str,
    renames: dict[str, str] | None = None,
) -> dict[str, int]:
    """Replace every copied table's rows with these. One transaction: all of it or none.

    The foreign keys are switched off for the load and only for it — the rows are whole
    and consistent as production wrote them, and loading them in an order that satisfied
    every key one row at a time would mean untangling two folder trees that point at
    themselves. Then the counters of the two tables that number their own rows are moved
    past what arrived, or the next row written locally would collide with production's.

    `renames` pairs ids from outside this database — production's Student Hub semesters —
    with this machine's; see the module's docstring.

    The caller has already refused anything but a developer's own database. This refuses
    the other thing that would make it wrong: two schemas that do not line up.
    """
    here = revision(engine)
    if source_revision != here:
        raise SchemaMismatch(
            f"Production's database is at {source_revision or 'no revision'} and this one at "
            f"{here or 'no revision'}. Bring them to the same revision first — pull and migrate "
            "this machine, or deploy — then copy again."
        )
    held = _reflect(engine)
    names = copied_tables(engine)
    missing = sorted(set(names) - set(tables))
    if missing:
        raise SchemaMismatch(f"Production sent nothing for {', '.join(missing)}. Nothing was changed.")

    loaded: dict[str, int] = {}
    with engine.begin() as connection:
        connection.execute(text("SET LOCAL session_replication_role = replica"))
        for name in reversed(names):
            connection.execute(text(f'DELETE FROM "{name}"'))  # noqa: S608
        for name in names:
            table = held.tables[name]
            payload = tables[name]
            columns = [column for column in payload["columns"] if column in table.columns]
            if not payload["rows"]:
                loaded[name] = 0
                continue
            keys = [f"c{index}" for index in range(len(columns))]
            statement = text(
                f'INSERT INTO "{name}" ({", ".join(chr(34) + column + chr(34) for column in columns)}) '  # noqa: S608
                f"VALUES ({', '.join(':' + key for key in keys)})"
            )
            place = {column: index for index, column in enumerate(payload["columns"])}
            # JSON columns arrive as their text and go in as it; Postgres parses it back.
            batch = [
                {key: row[place[column]] for key, column in zip(keys, columns, strict=True)}
                for row in payload["rows"]
            ]
            connection.execute(statement, batch)
            loaded[name] = len(batch)
        if renames:
            _rename(connection, held, names, renames)
        for name, column in connection.execute(
            text("""SELECT table_name, column_name FROM information_schema.columns
                    WHERE table_schema = 'public' AND is_identity = 'YES'""")
        ).all():
            if name in EXCLUDED:
                continue
            connection.execute(
                text(
                    f"SELECT setval(pg_get_serial_sequence('\"{name}\"', '{column}'), "  # noqa: S608
                    f'COALESCE((SELECT max("{column}") FROM "{name}"), 0) + 1, false)'
                )
            )
    return loaded
