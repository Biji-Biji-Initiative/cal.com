#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run enterprise tests against a new private, disposable PostgreSQL."""
from __future__ import annotations

import argparse
import json
import shlex
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.parse import quote


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pg-bin", type=Path, help="Directory containing initdb and pg_ctl")
    parser.add_argument("--scratch-root", type=Path, help="Parent for the disposable fixture")
    parser.add_argument("--prisma-cli", type=Path, help="Explicit installed Prisma CLI; its version must match the repo pin")
    parser.add_argument("--suite", choices=("bookings", "built-web", "teams", "hosts", "team-journey", "identity-link"), default="bookings")
    parser.add_argument("--concurrency", action="store_true", help="Run the additional deterministic booking-conflict acceptance probe")
    args = parser.parse_args()
    if args.concurrency and args.suite != "team-journey":
        parser.error("--concurrency requires --suite team-journey")
    root = Path(__file__).resolve().parent.parent
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        parser.error("Run as an unprivileged developer, never root")
    pg_bin = args.pg_bin
    if pg_bin is None:
        executable = shutil.which("initdb")
        if not executable:
            parser.error("Pass --pg-bin pointing to an installed PostgreSQL binary directory")
        pg_bin = Path(executable).parent
    for name in ("initdb", "pg_ctl"):
        if not (pg_bin / name).is_file():
            parser.error(f"Missing PostgreSQL binary: {pg_bin / name}")
    node = shutil.which("node")
    if not node:
        parser.error("Node.js is required")
    dependency_roots = [root / "node_modules", root / "packages/prisma/node_modules"]
    dependency_roots.extend(Path(value) for value in os.environ.get("NODE_PATH", "").split(os.pathsep) if value)
    prisma = next((path / "prisma/build/index.js" for path in dependency_roots if (path / "prisma/build/index.js").is_file()), None)
    prisma = args.prisma_cli or prisma
    if prisma is None or not prisma.is_file():
        parser.error("Install the repository dependencies before running database tests")
    expected = json.loads((root / "packages/prisma/package.json").read_text())["dependencies"]["prisma"]
    actual = json.loads((prisma.resolve().parent.parent / "package.json").read_text())["version"]
    if actual != expected:
        parser.error(f"Prisma {actual} does not match repository pin {expected}")
    print(f"Schema CLI: Prisma {actual} at {prisma}", flush=True)
    environment = {name: os.environ[name] for name in ("PATH", "HOME", "USER", "LANG", "NODE_PATH") if name in os.environ}
    environment["PRISMA_GENERATE_SKIP_AUTOINSTALL"] = "true"
    if args.suite == "team-journey":
        environment["CAL_TEAM_BROWSER_JOURNEY"] = "true"
    if args.concurrency:
        environment["CAL_BOOKING_CONCURRENCY_PROBE"] = "true"

    with tempfile.TemporaryDirectory(prefix="cal-enterprise-", dir=args.scratch_root) as directory:
        fixture = Path(directory)
        pgdata, socket = fixture / "postgres", fixture / "pgsocket"
        socket.mkdir(mode=0o700)
        started = False
        try:
            subprocess.run([str(pg_bin / "initdb"), "-D", str(pgdata), "-U", "cal_enterprise_test",
                            "--auth-local=trust", "--auth-host=reject", "--no-locale", "-E", "UTF8"],
                           check=True, env=environment, timeout=60)
            # Full Next server tests use several bounded Prisma/Kysely pools;
            # service-only suites retain the smaller fixture limit.
            connections = 40 if args.suite in ("built-web", "team-journey") else 12
            options = shlex.join(["-k", str(socket), "-p", "55439", "-c", "listen_addresses=", "-c", f"max_connections={connections}", "-c", "shared_buffers=32MB", "-c", "statement_timeout=15000"])
            subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(pgdata), "-l", str(fixture / "postgres.log"),
                            "-o", options, "-w", "-t", "30", "start"], check=True, env=environment, timeout=40)
            started = True
            database_url = "postgresql://cal_enterprise_test@localhost:55439/postgres?host=" + quote(str(socket), safe="")
            environment.update(DATABASE_URL=database_url, DATABASE_DIRECT_URL=database_url,
                               CAL_ENTERPRISE_TEST_SOCKET=str(socket), CAL_ENTERPRISE_TEST_PGDATA=str(pgdata))
            # This creates a NEW test schema. It is deliberately not a migration,
            # seed, restore, or connection to any configured application database.
            subprocess.run([node, str(prisma), "db", "push", "--schema", str(root / "packages/prisma/schema.prisma"),
                            "--skip-generate"], cwd=root, env=environment, check=True, timeout=180)
            command = ([node, "node_modules/vitest/vitest.mjs", "run", "--config", "tests/community-enterprise/vitest.postgres.config.mts", {"hosts": "tests/community-enterprise/postgres-hosts.test.ts", "teams": "tests/community-enterprise/postgres-teams.test.ts", "identity-link": "tests/community-enterprise/postgres-identity-link.test.ts"}[args.suite]]
                       if args.suite in ("teams", "hosts", "identity-link") else
                       [node, "--test", "--test-reporter=spec", {"bookings": "tests/community-enterprise/postgres-bookings.test.cjs", "built-web": "tests/community-enterprise/built-web.test.cjs", "team-journey": "tests/community-enterprise/built-web.test.cjs"}[args.suite]])
            result = subprocess.run(command, cwd=root, env=environment, timeout=480 if args.suite == "team-journey" else 300)
            return result.returncode
        finally:
            if started:
                subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(pgdata), "-w", "-t", "30", "-m", "fast", "stop"],
                               check=True, env=environment, timeout=40)


if __name__ == "__main__":
    raise SystemExit(main())
