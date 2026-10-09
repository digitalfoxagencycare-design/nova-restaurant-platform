"""Operator commands. The first Nova admin is created here, with a password typed at a prompt (never an env default)."""
from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from motor.motor_asyncio import AsyncIOMotorClient

from .core.config import Settings
from .core.startup_checks import assert_safe_startup
from .services.auth import create_platform_admin
from .tenancy.db import PlatformDB, ensure_indexes


async def _create_admin(email: str) -> None:
    s = Settings()
    assert_safe_startup(s)
    pw = getpass.getpass("Password (min 10 chars): ")
    if pw != getpass.getpass("Repeat password: "):
        sys.exit("Passwords do not match")
    db = AsyncIOMotorClient(s.mongo_url)[s.db_name]
    await ensure_indexes(db)
    await create_platform_admin(PlatformDB(db), email, pw)
    print(f"Platform admin {email} created.")


def main() -> None:
    ap = argparse.ArgumentParser(prog="nova")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("create-platform-admin")
    a.add_argument("--email", required=True)
    args = ap.parse_args()
    if args.cmd == "create-platform-admin":
        asyncio.run(_create_admin(args.email))


if __name__ == "__main__":
    main()
