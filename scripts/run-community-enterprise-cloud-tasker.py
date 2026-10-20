#!/usr/bin/env python3
"""Run a canonical enterprise DB suite with an owned, offline managed-Docker PG18 fixture."""

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
SELECTORS = ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH")
LABEL = "cal-cloud-fixture"


class FixtureError(Exception):
    pass


def docker_environment():
    env = os.environ.copy()
    for key in SELECTORS:
        env.pop(key, None)
    return env


def docker(args, timeout=30):
    return subprocess.run(
        ["docker", "--host=unix:///var/run/docker.sock", *args], env=docker_environment(),
        capture_output=True, text=True, timeout=timeout,
    )


def container_arguments(image, scratch, passwd, uid, gid, nonce):
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
        raise FixtureError("local_image_digest_required")
    if uid == 0 or gid < 0:
        raise FixtureError("unprivileged_user_required")
    # The canonical runner appends its own directory and PostgreSQL socket name.
    suffix = "/cal-enterprise-xxxxxxxx/pgsocket/.s.PGSQL.55439"
    if len((str(scratch) + suffix).encode()) > 107:
        raise FixtureError("unix_socket_path_too_long")
    return [
        "run", "--detach", "--rm", "--pull=never", "--network=none", "--user", f"{uid}:{gid}",
        "--memory=768m", "--memory-swap=768m", "--cpus=1", "--pids-limit=128", "--cap-drop=ALL",
        "--security-opt=no-new-privileges:true", "--read-only", "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=64m", "--mount", f"type=bind,src={scratch},dst={scratch}",
        "--mount", f"type=bind,src={passwd},dst=/etc/passwd,readonly", "--label", f"{LABEL}={nonce}",
        "--entrypoint", "tail", image, "-f", "/dev/null",
    ]


def cleanup(container_id, nonce):
    if not re.fullmatch(r"[0-9a-f]{64}", container_id):
        return False
    current = docker(["inspect", "--format", '{{ index .Config.Labels "cal-cloud-fixture" }}', container_id])
    if current.returncode == 0:
        if current.stdout.strip() != nonce:
            return False
        if docker(["rm", "--force", container_id]).returncode:
            return False
    absent = docker(["ps", "--all", "--no-trunc", "--filter", "id=" + container_id, "--format", "{{.ID}}"])
    return absent.returncode == 0 and not absent.stdout.strip()


def cleanup_created(container_id, nonce):
    if container_id and re.fullmatch(r"[0-9a-f]{64}", container_id):
        return cleanup(container_id, nonce)
    found = docker(["ps", "--all", "--no-trunc", "--filter", f"label={LABEL}={nonce}", "--format", "{{.ID}}"])
    if found.returncode:
        return False
    matches = found.stdout.split()
    return not matches or (len(matches) == 1 and cleanup(matches[0], nonce))


def write_wrappers(directory, container_id, receipt):
    # Only an approved Docker config path is retained across the canonical
    # runner's deliberately clean child environment; no credential file is read.
    config = {"DOCKER_CONFIG": os.environ["DOCKER_CONFIG"]} if "DOCKER_CONFIG" in os.environ else {}
    for tool in ("initdb", "pg_ctl"):
        script = directory / tool
        script.write_text(
            "#!/usr/bin/env python3\nimport os,sys,subprocess,pathlib,shutil\n"
            "env=os.environ.copy()\n"
            f"for key in {SELECTORS!r}:env.pop(key,None)\n"
            f"env.update({config!r})\n"
            f"command={['docker', '--host=unix:///var/run/docker.sock', 'exec', container_id, tool]!r}\n"
            "result=subprocess.run(command+sys.argv[1:],env=env)\n"
            "if '-D' in sys.argv:\n"
            " log=pathlib.Path(sys.argv[sys.argv.index('-D')+1]).parent/'postgres.log'\n"
            f" if log.exists():shutil.copyfile(log,{str(receipt / 'postgres.log')!r})\n"
            "raise SystemExit(result.returncode)\n"
        )
        script.chmod(0o700)


def execute(image, receipt, node, scratch_parent=None, schema_engine=None, suite="tasker"):
    if suite not in ("tasker", "scim-provenance", "scim-identity"):
        raise FixtureError("unsupported_suite")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
        raise FixtureError("local_image_digest_required")
    if os.getuid() == 0:
        raise FixtureError("unprivileged_user_required")
    version = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10)
    if version.returncode or not re.fullmatch(r"v20\.\d+\.\d+\s*", version.stdout):
        raise FixtureError("qualified_node20_required")
    inspected = docker(["image", "inspect", image, "--format", "{{json .RepoDigests}}"])
    if inspected.returncode:
        raise FixtureError("local_image_unavailable")
    try:
        origins = json.loads(inspected.stdout)
        official = any(re.fullmatch(r"(?:docker.io/library/)?postgres@sha256:[0-9a-f]{64}", x) for x in origins)
    except (TypeError, ValueError):
        official = False
    if not official:
        raise FixtureError("official_postgres_image_required")
    receipt.mkdir(mode=0o700)
    record = {"suite": suite, "image": image, "image_origins": origins, "runner_exit": None, "cleanup_verified": False}
    started = time.monotonic()
    container_id = None
    try:
        with tempfile.TemporaryDirectory(prefix="ccpg-", dir=scratch_parent) as temp:
            work = Path(temp)
            scratch, wrappers, passwd = work / "fixtures", work / "pg-bin", work / "passwd"
            scratch.mkdir(mode=0o700)
            wrappers.mkdir(mode=0o700)
            uid, gid, nonce = os.getuid(), os.getgid(), secrets.token_hex(12)
            # Synthetic account metadata makes getpwuid work without mounting a home.
            passwd.write_text(f"root:x:0:0:root:/nonexistent:/bin/false\ncloud_fixture:x:{uid}:{gid}:fixture:{scratch}:/bin/false\n")
            arguments = container_arguments(image, scratch, passwd, uid, gid, nonce)
            record.update(ownership_nonce=nonce, start_attempted=True)
            (receipt / "receipt.json").write_text(json.dumps(record, indent=2))
            try:
                result = docker(arguments)
                (receipt / "container-start.log").write_text(result.stderr)
                if result.returncode:
                    raise FixtureError("container_start_failed")
                container_id = result.stdout.strip()
                if not re.fullmatch(r"[0-9a-f]{64}", container_id):
                    raise FixtureError("invalid_container_id")
                record["container_id"] = container_id
                pg = docker(["exec", container_id, "postgres", "--version"])
                if pg.returncode or not re.match(r"postgres \(PostgreSQL\) 18\.", pg.stdout):
                    raise FixtureError("postgres18_required")
                record["postgres_version"] = pg.stdout.strip()
                write_wrappers(wrappers, container_id, receipt)
                env = os.environ.copy()
                env.update(PATH=str(Path(node).resolve().parent) + os.pathsep + env["PATH"], TZ="UTC", PYTHONDONTWRITEBYTECODE="1")
                command = [sys.executable, str(ROOT / "scripts/run-community-enterprise-postgres.py"),
                           "--suite", suite, "--pg-bin", str(wrappers), "--scratch-root", str(scratch)]
                if schema_engine is not None:
                    command.extend(["--schema-engine", str(schema_engine.resolve())])
                record["command"] = command
                with (receipt / "tasker.log").open("w") as log:
                    process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                    try:
                        record["runner_exit"] = process.wait(timeout=600)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGTERM)
                        try:
                            process.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            os.killpg(process.pid, signal.SIGKILL)
                            process.wait()
                        raise FixtureError("runner_timeout") from None
            finally:
                try:
                    for log in scratch.glob("cal-enterprise-*/postgres.log"):
                        if not log.is_symlink():
                            shutil.copyfile(log, receipt / "postgres.log")
                finally:
                    record["cleanup_verified"] = cleanup_created(container_id, nonce)
    except FixtureError as error:
        record["category"] = str(error)
    except (OSError, subprocess.SubprocessError):
        record["category"] = "local_fixture_error"
    finally:
        record["seconds"] = round(time.monotonic() - started, 2)
        record["accepted"] = record["runner_exit"] == 0 and record["cleanup_verified"]
        log = receipt / "tasker.log"
        if log.exists():
            record["tests"] = {key: int(value) for key, value in re.findall(r"^ℹ (tests|pass|fail|skipped) (\d+)$", log.read_text(), re.MULTILINE)}
        (receipt / "receipt.json").write_text(json.dumps(record, indent=2))
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("tasker", "scim-provenance", "scim-identity"), default="tasker")
    parser.add_argument("--image", required=True, help="Already-local official PostgreSQL18 sha256 image ID; never pulled here")
    parser.add_argument("--receipt-dir", type=Path, required=True, help="New private receipt directory; must not exist")
    parser.add_argument("--node", default=shutil.which("node"), help="Qualified Node20 executable")
    parser.add_argument("--scratch-parent", type=Path, help="Short private temp parent; default system temp")
    parser.add_argument("--schema-engine", type=Path, help="SHA-verified offline schema engine, checked by the canonical runner")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if not args.node:
            raise FixtureError("qualified_node20_required")
        result = execute(args.image, args.receipt_dir, args.node, args.scratch_parent, args.schema_engine, args.suite)
    except (FixtureError, OSError, subprocess.SubprocessError) as error:
        result = {"accepted": False, "category": str(error) if isinstance(error, FixtureError) else "local_fixture_error"}
    print(json.dumps(result))
    return 0 if result["accepted"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
