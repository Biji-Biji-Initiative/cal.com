#!/usr/bin/env python3
"""Offline controls for local app isolation; no application/provider credentials."""
import importlib.util
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


if __name__ == "__main__":
    unittest.main()
