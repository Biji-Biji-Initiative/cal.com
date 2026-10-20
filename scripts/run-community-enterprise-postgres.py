#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run enterprise tests against a new private, disposable PostgreSQL."""
from __future__ import annotations

import argparse
import json
import re
import shlex
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.parse import quote


def schema_engine_environment(engine, node, prisma):
    if engine is None:
        return {}
    engine = engine.resolve()
    if not engine.is_file() or not os.access(engine, os.X_OK):
        raise ValueError("Schema engine must be an existing executable")
    expected = subprocess.check_output(
        [node, "-e", "const r=require('node:module').createRequire(process.argv[1]);process.stdout.write(r('@prisma/engines-version').enginesVersion)", str(prisma.resolve())],
        text=True, timeout=10,
    ).strip()
    actual = subprocess.check_output([str(engine), "--version"], text=True, timeout=10).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", expected) or actual != "schema-engine-cli " + expected:
        raise ValueError("Schema engine does not match the installed Prisma engine commit")
    return {"PRISMA_SCHEMA_ENGINE_BINARY": str(engine)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pg-bin", type=Path, help="Directory containing initdb and pg_ctl")
    parser.add_argument("--scratch-root", type=Path, help="Parent for the disposable fixture")
    parser.add_argument("--prisma-cli", type=Path, help="Explicit installed Prisma CLI; its version must match the repo pin")
    parser.add_argument("--schema-engine", type=Path, help="Verified offline schema engine; must match the installed Prisma engine commit")
    parser.add_argument("--suite", choices=("bookings", "built-web", "teams", "hosts", "team-journey", "identity-link", "api-keys", "api-auth", "api-key-http", "calendar-boundary", "migration-preflight", "onboarding-journey", "organizations", "organization-journey", "invitations", "invitation-journey", "member-lifecycle", "member-journey", "scheduling-handoff", "handoff-journey", "provider-lifecycle", "provider-journey", "tasker", "tasker-runtime", "api-assembled", "custom-roles", "custom-role-journey"), default="bookings")
    parser.add_argument("--concurrency", action="store_true", help="Run the additional deterministic booking-conflict acceptance probe")
    parser.add_argument("--accepted-organization-member", action="store_true", help="Run onboarding for a member admitted through the native organization service")
    parser.add_argument("--api-node-image", help="Existing local Node runtime image ID; no pull or publication")
    parser.add_argument("--api-redis-image", help="Existing local Redis runtime image ID; no pull or publication")
    args = parser.parse_args()
    if args.suite == "api-assembled":
        for value in (args.api_node_image, args.api_redis_image):
            if not value or not value.startswith("sha256:") or len(value) != 71 or any(c not in "0123456789abcdef" for c in value[7:]):
                parser.error("api-assembled requires explicit local sha256 image IDs via --api-node-image and --api-redis-image")
    elif args.api_node_image or args.api_redis_image:
        parser.error("API fixture image inputs require --suite api-assembled")

    if args.accepted_organization_member and args.suite != "onboarding-journey":
        parser.error("--accepted-organization-member requires --suite onboarding-journey")

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
    try:
        environment.update(schema_engine_environment(args.schema_engine, node, prisma))
    except (ValueError, OSError, subprocess.SubprocessError):
        parser.error("The explicit schema engine is unavailable or does not match the installed Prisma")
    if args.suite == "api-assembled":
        environment["CAL_ENTERPRISE_API_NODE_IMAGE"] = args.api_node_image
        environment["CAL_ENTERPRISE_API_REDIS_IMAGE"] = args.api_redis_image

    if args.suite == "team-journey":
        environment["CAL_TEAM_BROWSER_JOURNEY"] = "true"
    if args.suite == "onboarding-journey":
        environment["CAL_ONBOARDING_BROWSER_JOURNEY"] = "true"
        if args.accepted_organization_member:
            environment["CAL_ONBOARDING_ACCEPTED_MEMBER"] = "true"
    if args.suite == "organization-journey":
        environment["CAL_ORGANIZATION_BROWSER_JOURNEY"] = "true"
    if args.suite == "invitation-journey":
        environment["CAL_INVITATION_BROWSER_JOURNEY"] = "true"
    if args.suite == "member-journey":
        environment["CAL_MEMBER_BROWSER_JOURNEY"] = "true"
    if args.suite == "handoff-journey":
        environment["CAL_HANDOFF_BROWSER_JOURNEY"] = "true"
    if args.suite == "provider-journey":
        environment["CAL_PROVIDER_BROWSER_JOURNEY"] = "true"
    if args.suite == "tasker-runtime":
        environment["CAL_TASKER_RUNTIME_JOURNEY"] = "true"
    if args.suite == "custom-role-journey":
        environment["CAL_ROLE_BROWSER_JOURNEY"] = "true"
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
            connections = 40 if args.suite in ("built-web", "team-journey", "onboarding-journey", "organization-journey", "invitation-journey", "member-journey", "handoff-journey", "provider-journey", "tasker-runtime", "custom-role-journey") else 12
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
            command = ([node, "node_modules/vitest/vitest.mjs", "run", "--config", "tests/community-enterprise/vitest.postgres.config.mts", {"hosts": "tests/community-enterprise/postgres-hosts.test.ts", "teams": "tests/community-enterprise/postgres-teams.test.ts", "identity-link": "tests/community-enterprise/postgres-identity-link.test.ts", "organizations": "tests/community-enterprise/postgres-organizations.test.ts", "invitations": "tests/community-enterprise/postgres-invitations.test.ts", "member-lifecycle": "tests/community-enterprise/postgres-member-lifecycle.test.ts", "scheduling-handoff": "tests/community-enterprise/postgres-scheduling-handoff.test.ts", "custom-roles": "tests/community-enterprise/postgres-custom-roles.test.ts"}[args.suite]]
                       if args.suite in ("teams", "hosts", "identity-link", "organizations", "invitations", "member-lifecycle", "scheduling-handoff", "custom-roles") else
                       [node, "--test", "--test-reporter=spec", {"provider-lifecycle": "tests/community-enterprise/postgres-provider-lifecycle.test.cjs", "tasker": "tests/community-enterprise/postgres-tasker.test.cjs", "api-keys": "tests/community-enterprise/postgres-api-keys.test.cjs", "api-auth": "tests/community-enterprise/postgres-api-auth.test.cjs",
                "api-key-http": "tests/community-enterprise/postgres-api-key-controller.test.cjs", "migration-preflight": "tests/community-enterprise/postgres-migration-preflight.test.cjs", "calendar-boundary": "tests/community-enterprise/postgres-calendar-boundary.test.cjs", "bookings": "tests/community-enterprise/postgres-bookings.test.cjs", "built-web": "tests/community-enterprise/built-web.test.cjs", "team-journey": "tests/community-enterprise/built-web.test.cjs", "onboarding-journey": "tests/community-enterprise/built-web.test.cjs", "organization-journey": "tests/community-enterprise/built-web.test.cjs", "invitation-journey": "tests/community-enterprise/built-web.test.cjs", "member-journey": "tests/community-enterprise/built-web.test.cjs", "handoff-journey": "tests/community-enterprise/built-web.test.cjs", "provider-journey": "tests/community-enterprise/built-web.test.cjs", "tasker-runtime": "tests/community-enterprise/built-web.test.cjs", "api-assembled": "tests/community-enterprise/api-assembled.test.cjs", "custom-role-journey": "tests/community-enterprise/built-web.test.cjs"}[args.suite]])
            result = subprocess.run(command, cwd=root, env=environment, timeout=480 if args.suite in ("team-journey", "onboarding-journey", "organization-journey", "invitation-journey", "member-journey", "handoff-journey", "provider-journey", "tasker-runtime", "custom-role-journey") else 300)
            return result.returncode
        finally:
            if started:
                subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(pgdata), "-w", "-t", "30", "-m", "fast", "stop"],
                               check=True, env=environment, timeout=40)


if __name__ == "__main__":
    raise SystemExit(main())
