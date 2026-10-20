#!/usr/bin/env python3
"""Qualify the normal Next dev app on an owned offline PostgreSQL18, without vault access."""
import argparse
import ctypes
import hashlib
import http.client
from http.cookies import CookieError, SimpleCookie
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote, urlencode, urlsplit

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
KEEP = frozenset("PATH HOME USER LANG LC_ALL LC_CTYPE TZ TMPDIR HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy NODE_EXTRA_CA_CERTS SSL_CERT_FILE SSL_CERT_DIR CURL_CA_BUNDLE LD_PRELOAD LD_LIBRARY_PATH OIC_MANIFEST_PATH CODEX_PROXY_CERT CODEX_PROXY_CA_BUNDLE CODEX_CA_CERT CODEX_ENV_GUARD CODEX_SANDBOX CODEX_SANDBOX_NETWORK_DISABLED".split())


def environment(inherited, node):
    result = {key: value for key, value in inherited.items() if key in KEEP}
    result["PATH"] = str(Path(node).resolve().parent) + os.pathsep + result.get("PATH", "")
    return result


def config_contents(schema, values):
    keys = list(dict.fromkeys(re.findall(r"^([A-Za-z_][A-Za-z0-9_]*)=", schema, re.M)))
    return "".join(key + "=" + json.dumps(values.get(key, "")) + "\n" for key in keys)


def local_redirect(location):
    if not isinstance(location, str) or not location.startswith("/") or location.startswith("//"):
        raise RuntimeError("nonlocal_redirect_refused")
    parsed = urlsplit(location)
    if parsed.scheme or parsed.netloc or parsed.fragment or any(ord(c) < 32 for c in location):
        raise RuntimeError("invalid_local_redirect")
    return location


class LocalCookies:
    """In-memory cookies for the doctor's single fixed loopback origin."""

    def __init__(self):
        self._cookies = {}

    def capture(self, headers):
        updated = self._cookies.copy()
        try:
            if sum(len(value) for value in headers) > 16384:
                raise ValueError()
            for value in headers:
                if any(ord(c) < 32 or ord(c) > 126 for c in value):
                    raise ValueError()
                parsed = SimpleCookie()
                parsed.load(value)
                if not parsed:
                    raise ValueError()
                for name, cookie in parsed.items():
                    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", name) or re.search(r"[\s;,]", cookie.value):
                        raise ValueError()
                    if cookie["secure"] or cookie["domain"] not in ("", "localhost") or cookie["path"] not in ("", "/"):
                        raise ValueError()
                    if cookie["max-age"] and int(cookie["max-age"]) <= 0:
                        updated.pop(name, None)
                    else:
                        updated[name] = cookie.value
            if len(updated) > 32 or len(self._header(updated)) > 16384:
                raise ValueError()
        except (CookieError, ValueError):
            raise RuntimeError("invalid_local_cookie") from None
        self._cookies = updated

    @staticmethod
    def _header(cookies):
        return "; ".join(name + "=" + value for name, value in cookies.items())

    def header(self):
        return self._header(self._cookies)


def qualify_local_session(request, payload, expected):
    def anonymous():
        code, body = request("/api/auth/session")
        if code != 200 or json.loads(body) != {}:
            raise RuntimeError("anonymous_session_failed")

    def csrf():
        code, body = request("/api/auth/csrf")
        token = json.loads(body).get("csrfToken")
        if code != 200 or not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", token):
            raise RuntimeError("local_csrf_failed")
        return token

    anonymous()
    credentials = {"email": payload["email_address"], "password": payload["password"],
                   "csrfToken": csrf(), "json": "true", "callbackUrl": "/event-types"}
    if request("/api/auth/callback/credentials", {**credentials, "password": payload["password"] + "-wrong"}, form=True)[0] != 401:
        raise RuntimeError("bad_password_denial_failed")
    anonymous()
    if request("/api/auth/callback/credentials", credentials, form=True)[0] != 200:
        raise RuntimeError("native_credentials_failed")
    code, body = request("/api/auth/session")
    user = json.loads(body).get("user", {})
    if code != 200 or any(user.get(key) != value for key, value in expected.items()):
        raise RuntimeError("exact_database_session_failed")
    if request("/api/auth/signout", {"csrfToken": csrf(), "json": "true", "callbackUrl": "/auth/login"}, form=True)[0] != 200:
        raise RuntimeError("native_signout_failed")
    anonymous()
    return {"anonymous": True, "bad_password_denied": True, "exact_database_user": True, "native_signout": True}


def subreaper():
    if not sys.platform.startswith("linux") or ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0):
        raise RuntimeError("subreaper_unavailable")


def stop(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    reaped, deadline = 0, time.monotonic() + 15
    while time.monotonic() < deadline:
        while True:
            try:
                child, _status = os.waitpid(-1, os.WNOHANG)
                if not child:
                    break
                reaped += 1
            except ChildProcessError:
                break
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return True, reaped
        time.sleep(.1)
    return False, reaped


def remove_owned(path, identity, digest):
    if path.is_symlink() or not path.exists() or path.stat().st_ino != identity:
        return False
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        return False
    path.unlink()
    return True


def execute(args):
    os.umask(0o077)
    subreaper()
    out = args.receipt_dir.resolve()
    out.mkdir(mode=0o700)
    started = time.monotonic()
    record = {"stage": "preflight", "accepted": False, "exits": {}, "probes": []}
    owned, app, container, attempted = [], None, None, False
    nonce = secrets.token_hex(12)
    spec = importlib.util.spec_from_file_location("cloud_pg", ROOT / "scripts/run-community-enterprise-cloud-tasker.py")
    pg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pg)

    def stage(name):
        record.update(stage=name, seconds=round(time.monotonic() - started, 2))
        (out / "receipt.json").write_text(json.dumps(record, indent=2))

    def remaining(limit):
        value = min(limit, 900 - (time.monotonic() - started))
        if value <= 0:
            raise RuntimeError("overall_deadline")
        return value

    def run(name, command, env, timeout=180):
        stage(name)
        with (out / (name + ".log")).open("w") as log:
            child = subprocess.Popen(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                     stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                record["exits"][name] = child.wait(timeout=remaining(timeout))
            finally:
                stop(child)
                record["exits"][name] = child.returncode
        if record["exits"].get(name) != 0:
            raise RuntimeError(name + "_failed")

    cookies = LocalCookies()

    def request(path, body=None, form=False):
        local_redirect(path)
        stage("http_" + path.replace("/", "_"))
        client = http.client.HTTPConnection("127.0.0.1", args.port, timeout=remaining(240))
        try:
            data = (urlencode(body) if form else json.dumps(body)).encode() if body is not None else None
            headers = {"Content-Type": "application/x-www-form-urlencoded" if form else "application/json"} if data else {}
            headers["Host"] = f"localhost:{args.port}"
            if cookies.header():
                headers["Cookie"] = cookies.header()
            client.request("POST" if data else "GET", path, data, headers)
            response = client.getresponse()
            content = response.read(2 * 1024 * 1024 + 1)
            if len(content) > 2 * 1024 * 1024:
                raise RuntimeError("response_budget")
            cookies.capture(response.headers.get_all("Set-Cookie", []))
            record["probes"].append({"path": path, "method": "POST" if data else "GET",
                                     "status": response.status, "bytes": len(content),
                                     "sha256": hashlib.sha256(content).hexdigest(),
                                     "location": response.getheader("Location")})
            return response.status, content
        finally:
            client.close()

    def navigate(path):
        for _hop in range(4):
            code, content = request(path)
            if code == 200:
                return
            if code not in (301, 302, 303, 307, 308):
                raise RuntimeError("document_failed")
            path = local_redirect(record["probes"][-1]["location"])
        raise RuntimeError("redirect_budget")

    try:
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", args.image) or os.getuid() == 0:
            raise RuntimeError("owned_unprivileged_local_image_required")
        version = subprocess.check_output([args.node, "--version"], text=True, timeout=10).strip()
        if not re.fullmatch(r"v20\.\d+\.\d+", version):
            raise RuntimeError("qualified_node20_required")
        record["node_version"] = version
        runner_spec = importlib.util.spec_from_file_location("canonical_pg", ROOT / "scripts/run-community-enterprise-postgres.py")
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        runner.schema_engine_environment(args.schema_engine, args.node, ROOT / "node_modules/prisma/build/index.js")
        expected = json.loads((ROOT / "packages/prisma/package.json").read_text())["dependencies"]["prisma"]
        if json.loads((ROOT / "node_modules/prisma/package.json").read_text())["version"] != expected:
            raise RuntimeError("source_prisma_pin_mismatch")
        record["prisma_version"] = expected
        record["source"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        for name in ["package.json", "yarn.lock", "packages/prisma/schema.prisma", "docs/community-enterprise/TASK_GRAPH.json"]:
            record.setdefault("input_sha256", {})[name] = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        for directory in [ROOT, ROOT / "apps/web"]:
            for name in [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local", ".env.appStore"]:
                if os.path.lexists(directory / name):
                    raise RuntimeError("existing_environment_file_refused")
        stage("local_port_preflight")
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", args.port))
        inspected = pg.docker(["image", "inspect", args.image, "--format", "{{json .RepoDigests}}"])
        origins = json.loads(inspected.stdout) if inspected.returncode == 0 else []
        if not any(re.fullmatch(r"(?:docker.io/library/)?postgres@sha256:[0-9a-f]{64}", x) for x in origins):
            raise RuntimeError("official_local_postgres_image_required")
        scratch = Path(tempfile.mkdtemp(prefix="ccapp-"))
        record.update(scratch=str(scratch), image=args.image, image_origins=origins)
        fixtures = scratch / "fixtures"
        fixtures.mkdir()
        (fixtures / "socket").mkdir()
        passwd = scratch / "passwd"
        passwd.write_text(f"root:x:0:0:root:/nonexistent:/bin/false\ncloud_fixture:x:{os.getuid()}:{os.getgid()}:fixture:{fixtures}:/bin/false\n")
        record.update(ownership_nonce=nonce, container_start_attempted=True)
        stage("container_start")
        attempted = True
        result = pg.docker(pg.container_arguments(args.image, fixtures, passwd, os.getuid(), os.getgid(), nonce))
        if result.returncode or not re.fullmatch(r"[0-9a-f]{64}", result.stdout.strip()):
            raise RuntimeError("container_start_unconfirmed")
        container = result.stdout.strip()
        record.update(container_id=container, ownership_nonce=nonce)
        result = pg.docker(["exec", container, "postgres", "--version"])
        if result.returncode or not re.match(r"postgres \(PostgreSQL\) 18\.", result.stdout):
            raise RuntimeError("postgres18_required")
        record["postgres_version"] = result.stdout.strip()
        for name, command in [
            ("initdb", ["initdb", "-D", str(fixtures / "data"), "-A", "trust", "-U", "cal_local_app"]),
            ("pg_start", ["pg_ctl", "-D", str(fixtures / "data"), "-l", str(fixtures / "postgres.log"), "-o",
                          f"-k {fixtures}/socket -p 55439 -c listen_addresses= -c max_connections=32 -c shared_buffers=64MB", "-w", "-t", "30", "start"]),
        ]:
            stage(name)
            result = pg.docker(["exec", container, *command], timeout=45)
            (out / (name + ".log")).write_text(result.stdout + result.stderr)
            record["exits"][name] = result.returncode
            if result.returncode:
                raise RuntimeError(name + "_failed")
        url = "postgresql://cal_local_app@localhost:55439/postgres?host=" + quote(str(fixtures / "socket"), safe="")
        values = {"DATABASE_URL": url, "DATABASE_DIRECT_URL": url, "NEXTAUTH_SECRET": secrets.token_urlsafe(32),
                  "CALENDSO_ENCRYPTION_KEY": secrets.token_hex(16), "NEXT_PUBLIC_WEBAPP_URL": f"http://localhost:{args.port}",
                  "NEXTAUTH_URL": f"http://localhost:{args.port}/api/auth"}
        env = environment(os.environ, args.node)
        env.update(values, PRISMA_SCHEMA_ENGINE_BINARY=str(args.schema_engine.resolve()), NEXT_TELEMETRY_DISABLED="1",
                   CALCOM_TELEMETRY_DISABLED="1", TURBO_TELEMETRY_DISABLED="1", DO_NOT_TRACK="1",
                   NEXT_PUBLIC_LOGGER_LEVEL="6", NODE_OPTIONS="--max-old-space-size=6144", TZ="UTC")
        for name, schema in [(".env", ".env.example"), (".env.appStore", ".env.appStore.example")]:
            path = ROOT / name
            with path.open("x") as stream:
                stream.write(config_contents((ROOT / schema).read_text(), values))
            path.chmod(0o600)
            owned.append((path, path.stat().st_ino, hashlib.sha256(path.read_bytes()).hexdigest()))
        record["required_nonempty_keys"] = list(values)
        run("schema_push", [args.node, ".yarn/releases/yarn-4.12.0.cjs", "prisma", "db", "push", "--skip-generate"], env)
        command = [args.node, ".yarn/releases/yarn-4.12.0.cjs", "dev", "--env-mode=loose", "--", "--hostname", "127.0.0.1", "--port", str(args.port)]
        record["app_command"] = command
        stage("app_start")
        with (out / "app.log").open("w") as log:
            app = subprocess.Popen(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True)
            record["app_pid"] = app.pid
            deadline = time.monotonic() + remaining(120)
            listening = False
            while time.monotonic() < deadline and app.poll() is None:
                try:
                    with socket.create_connection(("127.0.0.1", args.port), timeout=1):
                        listening = True
                    break
                except OSError:
                    time.sleep(1)
            if not listening:
                raise RuntimeError("app_not_listening")
            code, content = request("/api/version")
            if code != 200 or json.loads(content).get("version") != json.loads((ROOT / "apps/web/package.json").read_text())["version"]:
                raise RuntimeError("native_version_failed")
            navigate("/auth/login")
            payload = {"username": "cloud-local-proof", "full_name": "Cloud Local Proof",
                       "email_address": "cloud-local-proof@example.test", "password": secrets.token_urlsafe(24) + "Aa4!"}
            if request("/api/auth/setup", payload)[0] != 200:
                raise RuntimeError("native_setup_failed")
            query = """const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});(async()=>{const i=(await p.query("SELECT current_setting('data_directory') AS directory,current_user AS actor")).rows[0];const u=(await p.query('SELECT count(*)::int AS n FROM users')).rows[0];const identity=(await p.query('SELECT id,username,email,role FROM users')).rows[0];const w=(await p.query('SELECT count(*)::int AS n FROM "UserPassword" WHERE length(hash)>30')).rows[0];console.log(JSON.stringify({directory:i.directory,actor:i.actor,users:u.n,password_rows:w.n,identity}));await p.end()})().catch(()=>process.exit(1));"""
            stage("database_readback")
            result = subprocess.run([args.node, "-e", query], cwd=ROOT, env=env, capture_output=True, text=True, timeout=20)
            data = json.loads(result.stdout) if result.returncode == 0 else {}
            record["database"] = {"exact_own_directory": data.get("directory") == str(fixtures / "data"),
                                  "actor": data.get("actor"), "users": data.get("users"), "password_rows": data.get("password_rows")}
            if not record["database"]["exact_own_directory"] or data.get("users") != 1 or data.get("password_rows") != 1:
                raise RuntimeError("database_proof_failed")
            if request("/api/auth/setup", payload)[0] != 400:
                raise RuntimeError("setup_replay_guard_failed")
            navigate("/auth/login")
            identity = data.get("identity", {})
            if (identity.get("email") != payload["email_address"] or identity.get("username") != payload["username"]
                    or identity.get("role") != "ADMIN" or not isinstance(identity.get("id"), int)):
                raise RuntimeError("exact_local_user_failed")
            record["native_session"] = qualify_local_session(request, payload, identity)
            record["accepted"] = app.poll() is None
    except Exception as error:
        record["failed_stage"] = record["stage"]
        record["category"] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        if isinstance(error, OSError):
            record["errno"] = error.errno
    finally:
        if app is not None:
            absent, reaped = stop(app)
            record.update(app_exit=app.returncode, app_group_absent=absent, adopted_children_reaped=reaped,
                          app_stop_signal="SIGTERM")
        record["container_cleanup_verified"] = pg.cleanup_created(container, nonce) if attempted else True
        record["local_config_removed"] = all([remove_owned(*entry) for entry in owned])
        for name, digest in record.get("input_sha256", {}).items():
            record.setdefault("inputs_unchanged", {})[name] = hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest
        log = out / "app.log"
        record["public_font_download_degraded"] = log.exists() and "Failed to download" in log.read_text(errors="replace")
        record["accepted"] = (record["accepted"] and record.get("app_group_absent", False)
                              and record["container_cleanup_verified"] and record["local_config_removed"]
                              and all(record.get("inputs_unchanged", {}).values()))
        stage("accepted" if record["accepted"] else "failed")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--schema-engine", required=True, type=Path)
    parser.add_argument("--receipt-dir", required=True, type=Path)
    parser.add_argument("--port", type=int, default=3000)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("use an unprivileged loopback port")
    try:
        result = execute(args)
        print(json.dumps({key: result.get(key) for key in ["accepted", "stage", "category", "seconds", "database", "app_group_absent", "container_cleanup_verified", "public_font_download_degraded"]}))
        return 0 if result["accepted"] else 1
    except Exception:
        print(json.dumps({"accepted": False, "category": "preflight_failed_redacted"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
