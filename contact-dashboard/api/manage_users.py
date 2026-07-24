from __future__ import annotations

import argparse
import getpass

from app import connect, iso_now, migrate, password_hash


def add_or_update(email: str, display_name: str) -> None:
    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Repeat password: ")
    if len(password) < 12:
        raise SystemExit("Password must be at least 12 characters.")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")
    migrate()
    now = iso_now()
    with connect() as db:
        db.execute(
            """
            INSERT INTO users
                (email,display_name,password_hash,enabled,created_at,updated_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(email) DO UPDATE SET
                display_name=excluded.display_name,
                password_hash=excluded.password_hash,
                enabled=1,
                updated_at=excluded.updated_at
            """,
            (
                email.strip().lower(),
                display_name.strip(),
                password_hash(password),
                1,
                now,
                now,
            ),
        )
    print(f"User {email.strip().lower()} is active.")


def disable(email: str) -> None:
    migrate()
    with connect() as db:
        result = db.execute(
            "UPDATE users SET enabled=0,updated_at=? WHERE email=?",
            (iso_now(), email.strip().lower()),
        )
        if result.rowcount == 0:
            raise SystemExit("User not found.")
        db.execute(
            "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)",
            (email.strip().lower(),),
        )
    print(f"User {email.strip().lower()} is disabled.")


parser = argparse.ArgumentParser(description="Manage marketing dashboard users.")
subparsers = parser.add_subparsers(dest="command", required=True)
upsert = subparsers.add_parser("upsert")
upsert.add_argument("--email", required=True)
upsert.add_argument("--name", required=True)
disable_parser = subparsers.add_parser("disable")
disable_parser.add_argument("--email", required=True)
arguments = parser.parse_args()

if arguments.command == "upsert":
    add_or_update(arguments.email, arguments.name)
else:
    disable(arguments.email)
