"""Copy all data from one database to another, e.g. from the SQLite file to PostgreSQL.

    python -m app.cli db-copy --source sqlite:////data/magma.db \
        --target postgresql+psycopg://magma:secret@postgres:5432/magma

Both databases are migrated to the latest schema first. The target must be empty (a freshly
started app only holds the seeded catalogue and first admin: pass --replace to wipe it).
Row ids are kept, so links between tables stay intact; PostgreSQL sequences are moved past the
copied ids afterwards.
"""

import logging
from dataclasses import dataclass, field

from sqlalchemy import Engine, func, insert, select, text

from app import models  # noqa: F401  (registers the tables)
from app.db import Base, is_postgres, make_engine, wait_for_db
from app.startup import ensure_sqlite_dir, migrate

log = logging.getLogger("magma.dbcopy")
BATCH = 500


class CopyError(RuntimeError):
    pass


@dataclass
class CopyResult:
    rows: dict[str, int] = field(default_factory=dict)

    @property
    def total(self) -> int:
        return sum(self.rows.values())


def _count(engine: Engine, table) -> int:
    with engine.connect() as conn:
        return conn.scalar(select(func.count()).select_from(table)) or 0


def copy_database(source_url: str, target_url: str, replace: bool = False) -> CopyResult:
    if source_url == target_url:
        raise CopyError("Source and target are the same database")
    ensure_sqlite_dir(target_url)
    src, dst = make_engine(source_url), make_engine(target_url)
    try:
        wait_for_db(dst, 30)
        migrate(src)
        migrate(dst)
        tables = Base.metadata.sorted_tables
        if not any(_count(src, t) for t in tables if t.name in ("users", "l1_use_cases")):
            # e.g. a wrong path, which SQLite would silently create as a new empty file
            raise CopyError("Source database is empty; check the --source URL")
        filled = [t.name for t in tables if _count(dst, t)]
        if filled and not replace:
            raise CopyError(
                "Target database is not empty (" + ", ".join(filled) + "). "
                "Use --replace to delete its data first."
            )
        res = CopyResult()
        with dst.begin() as out:
            for t in reversed(tables):
                out.execute(t.delete())
            with src.connect() as inp:
                for t in tables:
                    n = 0
                    result = inp.execution_options(stream_results=True).execute(select(t))
                    while chunk := result.mappings().fetchmany(BATCH):
                        out.execute(insert(t), [dict(r) for r in chunk])
                        n += len(chunk)
                    res.rows[t.name] = n
            if is_postgres(dst):
                for t in tables:
                    pk = list(t.primary_key.columns)
                    if len(pk) == 1 and pk[0].autoincrement and pk[0].type.python_type is int:
                        col = pk[0].name
                        seq = f"pg_get_serial_sequence('{t.name}', '{col}')"
                        top = f"COALESCE((SELECT MAX({col}) FROM {t.name}), 0) + 1"
                        out.execute(text(f"SELECT setval({seq}, {top}, false)"))
        log.info("Copied %d rows in %d tables", res.total, len(res.rows))
        return res
    finally:
        src.dispose()
        dst.dispose()
