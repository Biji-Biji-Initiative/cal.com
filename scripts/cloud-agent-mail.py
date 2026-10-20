#!/usr/bin/env python3
"""Canonical Cloud Agent Mail transport; CLI probes only, never registers agents."""

import argparse
import json
import os
import re
import selectors
import subprocess
import time

ENDPOINT = "https://agentmail.mereka.dev/mcp/"
MAX_BODY = 4 * 1024 * 1024
MAX_HEADERS = 64 * 1024
MAX_CONFIG = 1024 * 1024
TIMEOUT = 35


class TransportError(Exception):
    """Stable, credential-free failure category."""


def quote_config(value):
    if not isinstance(value, str) or any(ord(c) < 32 or ord(c) > 126 for c in value):
        raise TransportError("invalid_config_value")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def capture(argv, data, limit=MAX_BODY + MAX_HEADERS, timeout=TIMEOUT):
    """Drain stdin/stdout together so payloads and responses have finite budgets."""
    deadline = time.monotonic() + timeout
    output = bytearray()
    with subprocess.Popen(
        argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    ) as process, selectors.DefaultSelector() as selector:
        try:
            for stream in (process.stdin, process.stdout):
                os.set_blocking(stream.fileno(), False)
            selector.register(process.stdin, selectors.EVENT_WRITE)
            selector.register(process.stdout, selectors.EVENT_READ)
            pending = memoryview(data)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TransportError("transport_timeout")
                for key, _ in selector.select(remaining):
                    if key.fileobj is process.stdin:
                        if pending:
                            pending = pending[os.write(key.fd, pending[:65536]):]
                        if not pending:
                            selector.unregister(process.stdin)
                            process.stdin.close()
                    else:
                        block = os.read(key.fd, min(65536, limit + 1 - len(output)))
                        if not block:
                            selector.unregister(process.stdout)
                        output.extend(block)
                        if len(output) > limit:
                            raise TransportError("response_too_large")
            try:
                code = process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise TransportError("transport_timeout") from None
            return code, bytes(output)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def decode_http(raw):
    used = 0
    status = None
    headers = {}
    while raw.startswith(b"HTTP/"):
        head, separator, raw = raw.partition(b"\r\n\r\n")
        used += len(head) + len(separator)
        if not separator or used > MAX_HEADERS:
            raise TransportError("invalid_http_headers")
        lines = head.decode("iso-8859-1").split("\r\n")
        match = re.fullmatch(r"HTTP/(?:1\.[01]|2|3) (\d{3})(?: .*)?", lines[0])
        if not match:
            raise TransportError("invalid_http_status")
        status, headers = int(match[1]), {}
        for line in lines[1:]:
            key, separator, value = line.partition(":")
            if not separator or (
                key.lower() in headers and key.lower() in ("mcp-session-id", "content-type")
            ):
                raise TransportError("invalid_http_headers")
            headers[key.lower()] = value.strip()
    if status is None or len(raw) > MAX_BODY:
        raise TransportError("invalid_http_response")
    return status, headers, raw


def decode_rpc(raw, content_type, request_id):
    try:
        text = raw.decode("utf-8")
        if "text/event-stream" in content_type:
            candidates, data = [], []
            for line in text.replace("\r\n", "\n").split("\n") + [""]:
                if not line and data:
                    candidates.append(json.loads("\n".join(data)))
                    data = []
                elif line.startswith("data:"):
                    data.append(line[5:].lstrip(" "))
        else:
            candidates = [json.loads(text)]
        for payload in candidates:
            if isinstance(payload, dict) and payload.get("id") == request_id:
                if payload.get("error") is not None:
                    raise TransportError("rpc_error")
                if "result" in payload:
                    return payload["result"]
    except (UnicodeError, ValueError):
        raise TransportError("invalid_rpc_response") from None
    raise TransportError("missing_rpc_result")


class Client:
    """Results/session stay in memory; callers own authorization and durable identity."""

    def __init__(self):
        self.session = None
        self.protocol = None
        self.counter = 0
        self.receipts = []
        self.stage = None

    def rpc(self, method, params, notification=False):
        self.stage = method
        token = os.environ.get("MCP_AGENT_MAIL_TOKEN", "")
        if not token:
            raise TransportError("bound_token_absent")
        if not (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")):
            raise TransportError("managed_proxy_absent")
        self.counter += 1
        envelope = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notification:
            envelope["id"] = self.counter
        headers = {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        if self.protocol:
            headers["MCP-Protocol-Version"] = self.protocol
        config = "url = " + quote_config(ENDPOINT) + '\nrequest = "POST"\n'
        config += "".join(
            "header = " + quote_config(key + ": " + value) + "\n"
            for key, value in headers.items()
        )
        config += "data-binary = " + quote_config(json.dumps(envelope)) + "\n"
        encoded = config.encode("ascii")
        if len(encoded) > MAX_CONFIG:
            raise TransportError("request_too_large")
        # Ignore implicit curlrc overrides; retain curl's UA, inherited proxy and CA.
        argv = [
            "curl", "--disable", "--silent", "--show-error", "--include",
            "--max-time", "30", "--connect-timeout", "10",
            "--max-filesize", str(MAX_BODY), "--proto", "=https", "--config", "-",
        ]
        code, raw = capture(argv, encoded)
        if code:
            raise TransportError("curl_exit_" + str(code))
        status, response_headers, body = decode_http(raw)
        self.receipts.append({"method": method, "http_status": status, "curl_exit": code})
        if status not in (200, 202, 204):
            raise TransportError("http_" + str(status))
        session = response_headers.get("mcp-session-id")
        if session:
            if not re.fullmatch(r"[\x21-\x7e]{1,512}", session):
                raise TransportError("invalid_session_header")
            self.session = session
        if notification:
            return None
        return decode_rpc(body, response_headers.get("content-type", ""), self.counter)

    def initialize(self):
        result = self.rpc("initialize", {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "cal-cloud-agent-mail", "version": "1"},
        })
        protocol = result.get("protocolVersion") if isinstance(result, dict) else None
        if not isinstance(protocol, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", protocol):
            raise TransportError("invalid_protocol_version")
        self.protocol = protocol
        self.rpc("notifications/initialized", {}, notification=True)

    def call(self, name, arguments):
        result = self.rpc("tools/call", {"name": name, "arguments": arguments})
        if not isinstance(result, dict) or result.get("isError"):
            raise TransportError("tool_failed")
        if isinstance(result.get("structuredContent"), (dict, list)):
            return result["structuredContent"]
        for block in result.get("content", []):
            if isinstance(block, dict) and block.get("type") == "text":
                try:
                    value = json.loads(block.get("text", ""))
                except (ValueError, TypeError):
                    continue
                if isinstance(value, (dict, list)):
                    return value
        raise TransportError("missing_tool_json")

    def probe(self):
        self.initialize()
        names, params = [], {}
        for _ in range(20):
            result = self.rpc("tools/list", params)
            if not isinstance(result, dict) or not isinstance(result.get("tools"), list):
                raise TransportError("invalid_tool_list")
            for tool in result["tools"]:
                name = tool.get("name") if isinstance(tool, dict) else None
                if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", name):
                    raise TransportError("invalid_tool_name")
                names.append(name)
            cursor = result.get("nextCursor")
            if not cursor:
                return {"success": True, "tool_names": names, "receipts": self.receipts}
            params = {"cursor": cursor}
        raise TransportError("tool_pagination_limit")


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    client = Client()
    try:
        result = client.probe()
    except (TransportError, OSError) as error:
        category = str(error) if isinstance(error, TransportError) else "local_transport_error"
        result = {"success": False, "stage": client.stage, "category": category, "receipts": client.receipts}
    print(json.dumps(result))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
