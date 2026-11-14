"""Command line tools: `magma <command>` (or `python -m app.cli <command>`).

magma migrate                      apply database migrations
magma demo-data --seed 42          fill the catalogue with generated demo data
magma db-copy --source URL --target URL [--replace]
                                   copy all data, e.g. SQLite -> PostgreSQL
magma rotate-secret --old KEY      re-encrypt the TOTP seeds after SECRET_KEY was changed
"""

import argparse
import logging
import sys

from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.db import make_engine


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="magma", description="MaGMa UCF command line tools")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="apply database migrations and seed an empty database")
    demo = sub.add_parser("demo-data", help="replace the data with generated demo data")
    demo.add_argument("--seed", type=int, default=42)
    cp = sub.add_parser("db-copy", help="copy all data to another database")
    cp.add_argument("--source", help="source database URL (default: DATABASE_URL)")
    cp.add_argument("--target", required=True, help="target database URL")
    cp.add_argument("--replace", action="store_true", help="delete existing data in the target")
    rot = sub.add_parser(
        "rotate-secret", help="re-encrypt stored TOTP seeds with the current SECRET_KEY"
    )
    rot.add_argument("--old", required=True, help="the previous SECRET_KEY")
    args = p.parse_args(argv)

    settings = get_settings()
    if args.cmd == "db-copy":
        from app.dbcopy import CopyError, copy_database

        try:
            res = copy_database(args.source or settings.database_url, args.target, args.replace)
        except CopyError as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        for name, n in res.rows.items():
            print(f"{name:28} {n:>8}")
        print(f"{'total':28} {res.total:>8}")
        return 0

    if args.cmd == "rotate-secret":
        from app.config import check_secret_key
        from app.totp import reencrypt_all

        check_secret_key(settings)
        engine = make_engine(settings.database_url, settings)
        with sessionmaker(bind=engine)() as db:
            done, failed = reencrypt_all(db, args.old, settings.secret_key)
            db.commit()
        engine.dispose()
        print(f"re-encrypted {done} TOTP secret(s)")
        if failed:
            print(
                f"error: {len(failed)} could not be decrypted with --old: {', '.join(failed)}",
                file=sys.stderr,
            )
            return 1
        return 0

    from app.startup import initialize

    engine = make_engine(settings.database_url, settings)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    initialize(engine, factory, settings)
    if args.cmd == "demo-data":
        from app.demo import apply_demo_data

        with factory() as db:
            print(
                apply_demo_data(db, args.seed, default_interval=settings.default_verification_days)
            )
    engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
