"""Offline controls for the owned PostgreSQL fixture launcher."""

import importlib.util
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("cloud_pg", ROOT / "scripts/run-community-enterprise-cloud-tasker.py")
pg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pg)
runner_spec = importlib.util.spec_from_file_location("canonical_pg", ROOT / "scripts/run-community-enterprise-postgres.py")
runner = importlib.util.module_from_spec(runner_spec)
runner_spec.loader.exec_module(runner)
IMAGE = "sha256:" + "a" * 64
CID = "b" * 64


def result(code=0, text=""):
    return SimpleNamespace(returncode=code, stdout=text, stderr="")


class CloudTaskerTests(unittest.TestCase):
    def test_offline_engine_selector_defaults_to_the_unchanged_clean_environment(self):
        with patch.object(runner.subprocess, "check_output") as output:
            self.assertEqual(runner.schema_engine_environment(None, "node", Path("/synthetic/prisma.js")), {})
            output.assert_not_called()

    def test_offline_engine_selector_requires_the_installed_prisma_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = Path(directory) / "engine"
            engine.write_text("synthetic-only")
            engine.chmod(0o700)
            expected = "a" * 40
            with patch.object(runner.subprocess, "check_output", side_effect=[expected, "schema-engine-cli " + expected]):
                self.assertEqual(runner.schema_engine_environment(engine, "node", Path("/synthetic/prisma.js")), {"PRISMA_SCHEMA_ENGINE_BINARY": str(engine.resolve())})
            with patch.object(runner.subprocess, "check_output", side_effect=[expected, "schema-engine-cli " + "b" * 40]):
                with self.assertRaisesRegex(ValueError, "does not match"):
                    runner.schema_engine_environment(engine, "node", Path("/synthetic/prisma.js"))
            engine.chmod(0o600)
            with self.assertRaisesRegex(ValueError, "existing executable"):
                runner.schema_engine_environment(engine, "node", Path("/synthetic/prisma.js"))

    def test_arbitrary_suite_is_refused_before_docker_or_execution(self):
        with patch.object(pg, "docker") as docker:
            with self.assertRaisesRegex(pg.FixtureError, "unsupported_suite"):
                pg.execute(IMAGE, Path("/synthetic/receipt"), "node", suite="arbitrary")
            docker.assert_not_called()

    def test_mutable_images_and_root_are_refused(self):
        for image in ["postgres:18", "postgres:latest", "sha256:short"]:
            with self.assertRaisesRegex(pg.FixtureError, "local_image_digest_required"):
                pg.container_arguments(image, Path("/tmp/f"), Path("/tmp/p"), 1000, 1000, "synthetic")
        with self.assertRaisesRegex(pg.FixtureError, "unprivileged_user_required"):
            pg.container_arguments(IMAGE, Path("/tmp/f"), Path("/tmp/p"), 0, 0, "synthetic")

    def test_socket_budget_fails_before_container_creation(self):
        with self.assertRaisesRegex(pg.FixtureError, "unix_socket_path_too_long"):
            pg.container_arguments(IMAGE, Path("/tmp/" + "x" * 80), Path("/tmp/p"), 1000, 1000, "synthetic")

    def test_fixture_is_offline_unprivileged_bounded_and_has_only_own_mounts(self):
        args = pg.container_arguments(IMAGE, Path("/tmp/owned/f"), Path("/tmp/owned/p"), 1000, 1000, "synthetic")
        for flag in ["--network=none", "--pull=never", "--memory=768m", "--memory-swap=768m", "--cpus=1", "--pids-limit=128", "--cap-drop=ALL", "--read-only"]:
            self.assertIn(flag, args)
        self.assertEqual(args[args.index("--user") + 1], "1000:1000")
        mounts = [args[i + 1] for i, arg in enumerate(args) if arg == "--mount"]
        self.assertEqual(mounts, ["type=bind,src=/tmp/owned/f,dst=/tmp/owned/f", "type=bind,src=/tmp/owned/p,dst=/etc/passwd,readonly"])
        self.assertFalse(any("privileged" in x or "network=host" in x for x in args))

    def test_daemon_selection_is_local_without_changing_parent_or_registry_context(self):
        with patch.dict(os.environ, {"DOCKER_HOST": "tcp://synthetic.invalid", "DOCKER_CONTEXT": "synthetic", "DOCKER_CONFIG": "/synthetic/docker"}):
            env = pg.docker_environment()
            self.assertFalse(any(x in env for x in pg.SELECTORS))
            self.assertEqual(env["DOCKER_CONFIG"], "/synthetic/docker")
            self.assertEqual(os.environ["DOCKER_HOST"], "tcp://synthetic.invalid")

    def test_cleanup_never_removes_another_ownership_label(self):
        with patch.object(pg, "docker", return_value=result(text="another-owner")) as docker:
            self.assertFalse(pg.cleanup(CID, "synthetic"))
            self.assertEqual(docker.call_count, 1)
        with patch.object(pg, "docker") as docker:
            self.assertFalse(pg.cleanup("arbitrary-container-name", "synthetic"))
            docker.assert_not_called()

    def test_cleanup_requires_actual_absence_and_keeps_errors_unknown(self):
        with patch.object(pg, "docker", side_effect=[result(text="synthetic"), result(), result()]):
            self.assertTrue(pg.cleanup(CID, "synthetic"))
        with patch.object(pg, "docker", side_effect=[result(text="synthetic"), result(), result(code=1)]):
            self.assertFalse(pg.cleanup(CID, "synthetic"))
        with patch.object(pg, "docker", side_effect=[result(code=1), result(text=CID)]):
            self.assertFalse(pg.cleanup(CID, "synthetic"))

    def test_unknown_start_response_reconciles_only_the_exact_own_label(self):
        with patch.object(pg, "docker", return_value=result(text=CID)) as docker, patch.object(pg, "cleanup", return_value=True) as cleanup:
            self.assertTrue(pg.cleanup_created(None, "synthetic"))
            self.assertIn("label=cal-cloud-fixture=synthetic", docker.call_args.args[0])
            cleanup.assert_called_once_with(CID, "synthetic")
        with patch.object(pg, "docker", return_value=result(text=CID + "\n" + "c" * 64)), patch.object(pg, "cleanup") as cleanup:
            self.assertFalse(pg.cleanup_created(None, "synthetic"))
            cleanup.assert_not_called()

    def test_wrappers_use_exact_container_and_preserve_logs_without_auth_material(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"DOCKER_CONFIG": "/synthetic/docker", "MCP_AGENT_MAIL_TOKEN": "SYNTHETIC-NOT-FOR-PG"}):
            path = Path(directory)
            pg.write_wrappers(path, CID, path)
            for name in ["initdb", "pg_ctl"]:
                wrapper = path / name
                text = wrapper.read_text()
                compile(text, str(wrapper), "exec")
                self.assertIn("unix:///var/run/docker.sock", text)
                self.assertIn(CID, text)
                self.assertIn("postgres.log", text)
                self.assertIn("/synthetic/docker", text)
                self.assertNotIn("SYNTHETIC-NOT-FOR-PG", text)
                self.assertEqual(stat.S_IMODE(wrapper.stat().st_mode), 0o700)


if __name__ == "__main__":
    unittest.main()
