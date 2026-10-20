"""Synthetic transport controls; never use a real credential or contact a service."""

import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("cloud_mail", ROOT / "scripts/cloud-agent-mail.py")
mail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mail)
ENV = {"MCP_AGENT_MAIL_TOKEN": "SYNTHETIC-ONLY-NOT-A-CREDENTIAL", "HTTPS_PROXY": "http://proxy.invalid:8080"}


def response(result=None, status=200, headers="", request_id=1, sse=False):
    data = json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}).encode()
    if sse:
        data = b": keepalive\n\ndata: " + data + b"\n\n"
    kind = "text/event-stream" if sse else "application/json"
    return (f"HTTP/2 {status}\r\nContent-Type: {kind}\r\n{headers}\r\n".encode() + data)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, ENV)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_header_values_are_validated_and_escaped(self):
        self.assertEqual(mail.quote_config('a"b\\c'), '"a\\"b\\\\c"')
        for value in ["bad\rheader", "bad\nheader", "bad\x00header", "bad\theader", "nonascii\u00e9"]:
            with self.subTest(value=value), self.assertRaises(mail.TransportError):
                mail.quote_config(value)

    def test_credentials_only_reach_stdin_and_standard_curl_route(self):
        with patch.object(mail, "capture", return_value=(0, response({"ok": True}))) as capture:
            self.assertTrue(mail.Client().rpc("synthetic", {})["ok"])
        argv, config = capture.call_args.args
        self.assertNotIn(ENV["MCP_AGENT_MAIL_TOKEN"], " ".join(argv))
        self.assertIn(ENV["MCP_AGENT_MAIL_TOKEN"].encode(), config)
        self.assertEqual(argv[:2], ["curl", "--disable"])
        self.assertEqual(argv[-2:], ["--config", "-"])
        self.assertIn(mail.ENDPOINT.encode(), config)
        for forbidden in ["--location", "-L", "--insecure", "-k", "--user-agent", "-A", "--resolve", "--retry"]:
            self.assertNotIn(forbidden, argv)
        self.assertIn("--max-filesize", argv)
        self.assertIn("--max-time", argv)

    def test_invalid_binding_or_proxy_refuses_before_spawning(self):
        for value in ["", "SYNTHETIC\r\nInjected: bad"]:
            with patch.dict(os.environ, {"MCP_AGENT_MAIL_TOKEN": value}), patch.object(mail, "capture") as capture:
                with self.assertRaises(mail.TransportError):
                    mail.Client().rpc("synthetic", {})
                capture.assert_not_called()
        with patch.dict(os.environ, {"HTTPS_PROXY": "", "https_proxy": ""}), patch.object(mail, "capture") as capture:
            with self.assertRaisesRegex(mail.TransportError, "managed_proxy_absent"):
                mail.Client().rpc("synthetic", {})
            capture.assert_not_called()

    def test_oversized_request_refuses_before_spawning(self):
        with patch.object(mail, "capture") as capture:
            with self.assertRaisesRegex(mail.TransportError, "request_too_large"):
                mail.Client().rpc("synthetic", {"payload": "x" * mail.MAX_CONFIG})
            capture.assert_not_called()

    def test_initialize_notification_protocol_session_and_sse_sequence(self):
        replies = [
            (0, b"HTTP/1.1 200 Connection established\r\n\r\n" + response(
                {"protocolVersion": "2024-11-05"}, headers="Mcp-Session-Id: synthetic-session\r\n")),
            (0, b"HTTP/2 202\r\n\r\n"),
            (0, response({"tools": [{"name": "synthetic_tool"}]}, request_id=3, sse=True)),
        ]
        with patch.object(mail, "capture", side_effect=replies) as capture:
            result = mail.Client().probe()
        self.assertTrue(result["success"])
        self.assertEqual(result["tool_names"], ["synthetic_tool"])
        configs = [call.args[1] for call in capture.call_args_list]
        self.assertIn(b"Mcp-Session-Id: synthetic-session", configs[1])
        self.assertIn(b"MCP-Protocol-Version: 2024-11-05", configs[2])
        self.assertIn(b"notifications/initialized", configs[1])
        self.assertNotIn(b"register_agent", b"".join(configs))
        self.assertNotIn(b"sender_token", b"".join(configs))

    def test_tool_pagination_is_bounded(self):
        c = mail.Client()
        with patch.object(c, "initialize"), patch.object(c, "rpc", return_value={"tools": [], "nextCursor": "synthetic"}) as rpc:
            with self.assertRaisesRegex(mail.TransportError, "tool_pagination_limit"):
                c.probe()
            self.assertEqual(rpc.call_count, 20)

    def test_errors_and_redirects_are_sanitized_not_retried(self):
        for code, raw, category in [
            (0, response(status=302), "http_302"),
            (0, response(status=403), "http_403"),
            (7, b"SYNTHETIC-secret-error", "curl_exit_7"),
            (0, b"HTTP/2 200\r\nContent-Type: application/json\r\n\r\ninvalid", "invalid_rpc_response"),
        ]:
            with patch.object(mail, "capture", return_value=(code, raw)) as capture:
                with self.assertRaisesRegex(mail.TransportError, "^" + category + "$"):
                    mail.Client().rpc("synthetic", {})
                self.assertEqual(capture.call_count, 1)

    def test_header_and_body_budgets_and_ambiguous_session(self):
        for raw in [
            b"HTTP/2 200\r\nX-Large: " + b"x" * mail.MAX_HEADERS + b"\r\n\r\n",
            b"HTTP/2 200\r\nMcp-Session-Id: a\r\nMcp-Session-Id: b\r\n\r\n",
            b"HTTP/2 200\r\n\r\n" + b"x" * (mail.MAX_BODY + 1),
        ]:
            with self.assertRaises(mail.TransportError):
                mail.decode_http(raw)
        raw = response({}, headers="Set-Cookie: first\r\nSet-Cookie: second\r\n")
        self.assertEqual(mail.decode_http(raw)[0], 200)

    def test_rpc_ids_protocol_and_session_are_validated(self):
        with self.assertRaisesRegex(mail.TransportError, "missing_rpc_result"):
            mail.decode_rpc(response({}).split(b"\r\n\r\n")[1], "application/json", 2)
        for reply, operation in [
            (response({"protocolVersion": "bad"}), "initialize"),
            (response({}, headers="Mcp-Session-Id: bad session\r\n"), "rpc"),
        ]:
            with patch.object(mail, "capture", return_value=(0, reply)), self.assertRaises(mail.TransportError):
                c = mail.Client()
                c.initialize() if operation == "initialize" else c.rpc("synthetic", {})

    def test_tool_result_decoding_keeps_sensitive_results_private(self):
        c = mail.Client()
        for result in [
            {"structuredContent": {"registration_token": "SYNTHETIC-RESULT"}},
            {"content": [{"type": "text", "text": '{"registration_token":"SYNTHETIC-RESULT"}'}]},
        ]:
            with patch.object(c, "rpc", return_value=result), patch("sys.stdout", new_callable=io.StringIO) as output:
                self.assertIn("registration_token", c.call("synthetic_tool", {}))
                self.assertEqual(output.getvalue(), "")
        with patch.object(c, "rpc", return_value={"isError": True, "content": []}):
            with self.assertRaisesRegex(mail.TransportError, "tool_failed"):
                c.call("synthetic_tool", {})

    def test_cli_errors_only_emit_stage_category_and_safe_receipts(self):
        with patch.dict(os.environ, {"MCP_AGENT_MAIL_TOKEN": ""}), patch.object(sys, "argv", ["probe"]), patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(mail.main(), 1)
        result = json.loads(output.getvalue())
        self.assertEqual(result["stage"], "initialize")
        self.assertEqual(result["category"], "bound_token_absent")
        self.assertNotIn(ENV["MCP_AGENT_MAIL_TOKEN"], output.getvalue())

    def test_actual_child_io_is_bounded_and_times_out(self):
        code, data = mail.capture([sys.executable, "-c", "import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())"], b"synthetic" * 10000)
        self.assertEqual(code, 0)
        self.assertEqual(data, b"synthetic" * 10000)
        with self.assertRaisesRegex(mail.TransportError, "response_too_large"):
            mail.capture([sys.executable, "-c", "print('x'*10000)"], b"", limit=128)
        with self.assertRaisesRegex(mail.TransportError, "transport_timeout"):
            mail.capture([sys.executable, "-c", "import time;time.sleep(2)"], b"", timeout=0.05)


if __name__ == "__main__":
    unittest.main()
