#!/usr/bin/env python3
"""Offline controls for local app isolation; no application/provider credentials."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("local_app", ROOT / "scripts/run-community-enterprise-cloud-local.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class LocalAppControls(unittest.TestCase):
    def test_only_proxy_trust_and_runtime_selectors_survive_for_child(self):
        inherited = {"PATH": "/synthetic/bin", "HTTPS_PROXY": "http://synthetic-proxy:8080",
                     "NODE_EXTRA_CA_CERTS": "/synthetic/ca.pem", "HOME": "/synthetic/home",
                     "LD_PRELOAD": "/synthetic/runtime.so", "MCP_AGENT_MAIL_TOKEN": "fake-mail",
                     "GH_TOKEN": "fake-github", "OPENAI_API_KEY": "fake-model",
                     "INFISICAL_UA_CLIENT_SECRET": "fake-bootstrap", "DATABASE_URL": "fake-shared-db"}
        actual = app.environment(inherited, "/synthetic/node20/node")
        self.assertEqual(actual["HTTPS_PROXY"], inherited["HTTPS_PROXY"])
        self.assertEqual(actual["NODE_EXTRA_CA_CERTS"], inherited["NODE_EXTRA_CA_CERTS"])
        self.assertEqual(actual["LD_PRELOAD"], inherited["LD_PRELOAD"])
        self.assertFalse(any(name in actual for name in ["MCP_AGENT_MAIL_TOKEN", "GH_TOKEN", "OPENAI_API_KEY", "INFISICAL_UA_CLIENT_SECRET", "DATABASE_URL"]))
        self.assertEqual(inherited["DATABASE_URL"], "fake-shared-db")

    def test_schema_supplies_names_only_and_cannot_copy_vendor_values(self):
        result = app.config_contents('OPTIONAL_PROVIDER="do-not-copy"\nNEXTAUTH_SECRET=template-value\nOPTIONAL_PROVIDER=duplicate\n', {"NEXTAUTH_SECRET": "synthetic-local", "UNDECLARED": "ignored"})
        self.assertIn('OPTIONAL_PROVIDER=""', result)
        self.assertIn('NEXTAUTH_SECRET="synthetic-local"', result)
        self.assertNotIn("do-not-copy", result)
        self.assertNotIn("template-value", result)
        self.assertNotIn("UNDECLARED", result)
        self.assertEqual(result.count("OPTIONAL_PROVIDER="), 1)

    def test_only_relative_local_navigation_is_followed(self):
        self.assertEqual(app.local_redirect("/auth/setup?step=1"), "/auth/setup?step=1")
        for location in [None, "https://example.invalid/auth", "//example.invalid", "javascript:alert(1)", "/auth\nLocation:other", "/auth#fragment"]:
            with self.subTest(location=location), self.assertRaises(RuntimeError):
                app.local_redirect(location)

    def test_config_cleanup_preserves_foreign_edits_and_replacements(self):
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("synthetic-owned")
            inode = path.stat().st_ino
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            path.write_text("concurrent-edit")
            self.assertFalse(app.remove_owned(path, inode, digest))
            self.assertEqual(path.read_text(), "concurrent-edit")
            path.unlink()
            target = Path(directory) / "foreign"
            target.write_text("foreign-preserved")
            path.symlink_to(target)
            self.assertFalse(app.remove_owned(path, inode, digest))
            self.assertEqual(target.read_text(), "foreign-preserved")

    def test_cleanup_removes_only_unchanged_owned_file(self):
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("synthetic-owned")
            self.assertTrue(app.remove_owned(path, path.stat().st_ino, hashlib.sha256(path.read_bytes()).hexdigest()))
            self.assertFalse(path.exists())

    def test_actual_child_and_grandchild_are_killed_and_reaped(self):
        app.subreaper()
        source = "import subprocess,sys,time;subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);print('ready',flush=True);time.sleep(60)"
        child = subprocess.Popen([sys.executable, "-c", source], stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, start_new_session=True, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), "ready")
            absent, reaped = app.stop(child)
            self.assertTrue(absent)
            self.assertGreaterEqual(reaped, 1)
        finally:
            if child.poll() is None:
                app.stop(child)
            child.stdout.close()

    def test_memory_only_cookie_jar_handles_rotation_chunks_and_expiry(self):
        jar = app.LocalCookies()
        jar.capture(["next-auth.csrf-token=fake%7Cproof; Path=/; HttpOnly",
                     "next-auth.session-token.0=fake-part-one; Path=/; HttpOnly",
                     "next-auth.session-token.1=fake-part-two; Path=/; HttpOnly"])
        self.assertIn("next-auth.session-token.0=fake-part-one", jar.header())
        self.assertIn("next-auth.session-token.1=fake-part-two", jar.header())
        jar.capture(["next-auth.session-token.0=; Max-Age=0; Path=/",
                     "next-auth.session-token.1=; Max-Age=0; Path=/"])
        self.assertNotIn("session-token", jar.header())
        jar.capture(["next-auth.csrf-token=rotated; Path=/; HttpOnly"])
        self.assertEqual(jar.header(), "next-auth.csrf-token=rotated")
        self.assertNotIn("rotated", repr(jar))

    def test_cookie_budget_and_header_injection_are_refused_without_echoing_values(self):
        for headers in [["fake=secret\r\nInjected: value"], ["fake=" + "x" * 17000],
                        ["fake=secret; Secure"], ["fake=secret; Domain=foreign.invalid"],
                        ["fake=secret; Path=/foreign"],
                        [f"fake{i}=x" for i in range(33)]]:
            with self.subTest(), self.assertRaisesRegex(RuntimeError, "^invalid_local_cookie$"):
                app.LocalCookies().capture(headers)

    def test_real_session_contract_requires_denial_exact_database_identity_and_signout(self):
        expected = {"id": 7, "username": "synthetic-person", "email": "synthetic@example.test", "role": "ADMIN"}
        payload = {"email_address": expected["email"], "password": "fake-local-password"}
        paths = []
        responses = [(200, {}), (200, {"csrfToken": "fake-csrf"}), (401, {"url": "/auth/error"}),
                     (200, {}), (200, {"url": "/event-types"}),
                     (200, {"user": expected}), (200, {"csrfToken": "next-fake-csrf"}),
                     (200, {"url": "/auth/login"}), (200, {})]
        def request(path, body=None, form=False):
            paths.append((path, body, form))
            status, response = responses.pop(0)
            return status, json.dumps(response).encode()
        result = app.qualify_local_session(request, payload, expected)
        self.assertTrue(all(result.values()))
        self.assertEqual(len(paths), 9)
        self.assertNotEqual(paths[2][1]["password"], payload["password"])
        self.assertEqual(paths[4][1]["password"], payload["password"])
        self.assertTrue(paths[4][2])
        self.assertEqual(paths[7][1]["csrfToken"], "next-fake-csrf")
        self.assertNotIn("fake-csrf", json.dumps(result))
        self.assertNotIn(payload["password"], json.dumps(result))

    def test_session_contract_rejects_accidental_authentication_wrong_user_and_ineffective_signout(self):
        expected = {"id": 7, "username": "synthetic-person", "email": "synthetic@example.test", "role": "ADMIN"}
        payload = {"email_address": expected["email"], "password": "fake-local-password"}
        base = [(200, {}), (200, {"csrfToken": "fake-csrf"}), (401, {}), (200, {}), (200, {}),
                (200, {"user": expected}), (200, {"csrfToken": "fake-csrf"}), (200, {}), (200, {})]
        for index, replacement in [(3, (200, {"user": expected})),
                                   (2, (500, {})), (2, (200, {})),
                                   (5, (200, {"user": {**expected, "id": 8}})),
                                   (5, (500, {"user": expected})),
                                   (8, (200, {"user": expected}))]:
            responses = list(base)
            responses[index] = replacement
            def request(*_args, **_kwargs):
                status, response = responses.pop(0)
                return status, json.dumps(response).encode()
            with self.subTest(index=index), self.assertRaises(RuntimeError):
                app.qualify_local_session(request, payload, expected)


if __name__ == "__main__":
    unittest.main()
