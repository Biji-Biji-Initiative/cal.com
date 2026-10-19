# SPDX-License-Identifier: MIT
"""Admit an exact Cal candidate locally; publish only from its manual workflow."""
import argparse
import collections
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import resource
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPOSITORY = "Biji-Biji-Initiative/cal.com"
REGISTRY = "ghcr.io/biji-biji-initiative/cal.com"
ORIGIN = "https://cal.mereka.dev"
SHA = r"[0-9a-f]{64}"
DIGEST = r"sha256:" + SHA
FILES = {"archive": "image.oci.tar", "build": "enterprise-build.json", "container": "container.json",
         "scan": "scan.json", "ledger": "high-ledger.json"}
MAX_JSON = 32 * 1024 * 1024
MAX_ARCHIVE = 2 * 1024 * 1024 * 1024
MAX_EXPANDED = 4 * MAX_ARCHIVE
READ_SECONDS = 180
MANIFEST = "application/vnd.oci.image.manifest.v1+json"
RECIPES = {"dockerfileSha256": "Dockerfile.enterprise-preview",
           "entrypointSha256": "scripts/enterprise-runtime-entrypoint.cjs",
           "migrationPreflightSha256": "scripts/check-enterprise-migration.sql", "lockSha256": "yarn.lock"}
REQUIRED = {"calcom/node_modules/next/package.json": "next", "calcom/node_modules/axios/package.json": "axios",
            "calcom/node_modules/effect/package.json": "effect", "calcom/ops/node_modules/effect/package.json": "effect",
            "calcom/ops/node_modules/prisma/package.json": "prisma"}


class Refused(Exception):
    pass


def need(condition, message):
    if not condition:
        raise Refused(message)


def shape(value, keys):
    need(type(value) is dict and set(value) == set(keys.split()), "Invalid object schema")
    return value


def pattern(value, expression):
    need(type(value) is str and re.fullmatch(expression, value) is not None, "Invalid identity syntax")
    return value


def integer(value, maximum, minimum=1):
    need(type(value) is int and minimum <= value <= maximum, "Invalid bounded integer")
    return value


def sha(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(data):
    need(len(data) <= MAX_JSON, "JSON exceeds bound")
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    def invalid(_):
        raise Refused("Invalid JSON number")
    return json.loads(data, object_pairs_hook=pairs, parse_constant=invalid)


def file_hash(file):
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_time(value):
    pattern(value, r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z")
    # Preserve the raw nanoseconds in evidence; comparisons floor to microseconds.
    if "." in value:
        seconds, fraction = value[:-1].split(".")
        value = seconds + "." + fraction[:6].ljust(6, "0") + "Z"
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def fresh(value, now):
    age = (now - parse_time(value)).total_seconds()
    need(-300 <= age <= 86400, "Evidence is stale or future-dated")


def command(args, *, input_data=None, env=None, timeout=60):
    def bound_output():
        _, hard = resource.getrlimit(resource.RLIMIT_FSIZE)
        limit = MAX_JSON + 1 if hard == resource.RLIM_INFINITY else min(hard, MAX_JSON + 1)
        resource.setrlimit(resource.RLIMIT_FSIZE, (limit, limit))
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        result = subprocess.run(args, input=input_data, stdout=stdout, stderr=stderr, env=env,
                                timeout=timeout, check=False, preexec_fn=bound_output)
        need(stdout.tell() <= MAX_JSON and stderr.tell() <= MAX_JSON, "Command output exceeds bound")
        stdout.seek(0)
        stderr.seek(0)
        result.stdout, result.stderr = stdout.read(), stderr.read()
        return result


def git_bytes(checkout, revision, file):
    result = command(["git", "-C", str(checkout), "show", f"{revision}:{file}"])
    need(result.returncode == 0, "Application source recipe is unavailable")
    return result.stdout


def request_schema(receipt, source, actor, now):
    shape(receipt, "schemaVersion repository sourceSha producerActor producedAt publicOrigin artifacts")
    need(type(receipt["schemaVersion"]) is int and receipt["schemaVersion"] == 1, "Unsupported receipt version")
    pattern(source, r"[0-9a-f]{40}")
    pattern(actor, r"[A-Za-z0-9][A-Za-z0-9-]{0,38}")
    need(receipt["repository"] == REPOSITORY and receipt["sourceSha"] == source, "Wrong application source")
    need(receipt["producerActor"] == actor and receipt["publicOrigin"] == ORIGIN, "Wrong producer or public origin")
    fresh(receipt["producedAt"], now)
    shape(receipt["artifacts"], " ".join(FILES))
    ids = set()
    for kind, asset in receipt["artifacts"].items():
        shape(asset, "assetId sha256 bytes")
        integer(asset["assetId"], 2**53 - 1)
        need(asset["assetId"] not in ids, "Repeated asset identity")
        ids.add(asset["assetId"])
        pattern(asset["sha256"], SHA)
        integer(asset["bytes"], MAX_ARCHIVE if kind == "archive" else MAX_JSON)


def build_schema(build, source, checkout):
    shape(build, "schemaVersion sourceSha publicOrigin buildId buildManifestSha256 lockSha256 entrypointSha256 migrationPreflightSha256 dockerfileSha256 migrationEngineVersion operationsTraceFiles copiedLicenseNotices traceWarnings")
    need(type(build["schemaVersion"]) is int and build["schemaVersion"] == 1, "Unsupported build version")
    need(build["sourceSha"] == source and build["publicOrigin"] == ORIGIN, "Build identity mismatch")
    revision_type = command(["git", "-C", str(checkout), "cat-file", "-t", source])
    need(revision_type.returncode == 0 and revision_type.stdout.strip() == b"commit", "Application revision is not a commit")
    pattern(build["buildId"], r"[A-Za-z0-9_-]{1,128}")
    pattern(build["buildManifestSha256"], SHA)
    pattern(build["migrationEngineVersion"], r"\d+\.\d+\.\d+")
    integer(build["operationsTraceFiles"], 1000000)
    integer(build["copiedLicenseNotices"], 1000000)
    need(type(build["traceWarnings"]) is list and len(build["traceWarnings"]) <= 100
         and all(type(v) is str and len(v) <= 2000 for v in build["traceWarnings"]), "Invalid trace warning inventory")
    for field, file in RECIPES.items():
        need(pattern(build[field], SHA) == sha(git_bytes(checkout, source, file)), "Recipe differs from application source")


def config_schema(config, build):
    need(config.get("os") == "linux" and config.get("architecture") == "amd64", "Unsupported image platform")
    c = config.get("config", {})
    need(c.get("User") == "1000:1000" and c.get("WorkingDir") == "/calcom"
         and c.get("Entrypoint") == ["node", "/calcom/scripts/enterprise-runtime-entrypoint.cjs"]
         and c.get("Cmd") == ["web"], "Wrong runtime launch contract")
    labels = {"org.opencontainers.image.source": "https://github.com/" + REPOSITORY,
              "org.opencontainers.image.revision": build["sourceSha"], "io.mereka.cal.build-id": build["buildId"],
              "io.mereka.cal.dockerfile-sha256": build["dockerfileSha256"],
              "io.mereka.cal.entrypoint-sha256": build["entrypointSha256"],
              "io.mereka.cal.distribution": "community-enterprise-preview"}
    need(c.get("Labels") == labels, "Image labels differ from source-bound build")
    allowed = {"PATH": r"[/A-Za-z0-9_:.-]+", "NODE_VERSION": r"22\.\d+\.\d+", "YARN_VERSION": r"\d+\.\d+\.\d+",
               "NODE_ENV": "production", "NEXT_TELEMETRY_DISABLED": "1", "CHECKPOINT_DISABLE": "1",
               "PRISMA_HIDE_UPDATE_MESSAGE": "1", "PRISMA_GENERATE_SKIP_AUTOINSTALL": "true", "HOSTNAME": "0.0.0.0", "PORT": "3000",
               "HOME": "/home/node", "SSL_CERT_FILE": r"/etc/ssl/certs/ca-certificates\.crt"}
    need(type(c.get("Env")) is list, "Missing runtime environment inventory")
    names = set()
    for entry in c["Env"]:
        need(type(entry) is str and "=" in entry, "Invalid runtime environment metadata")
        name, value = entry.split("=", 1)
        need(name in allowed and name not in names, "Unexpected runtime environment metadata")
        names.add(name)
        pattern(value, allowed[name])
    need("NODE_ENV" in names, "Missing production runtime metadata")


def hidden_or_replaced(key, seen, non_directories, whiteouts):
    parents = [str(parent) for parent in Path(key).parents if str(parent) != "."]
    return key in seen or any(parent in non_directories for parent in parents) or any(
        not hidden or key == hidden or key.startswith(hidden + "/") for hidden in whiteouts)


def installed_aliases(aliases, tree, packages, protected, deadline):
    need(not any(parent in aliases for key in protected
                 for parent in [key, *(str(value) for value in Path(key).parents if str(value) != ".")]),
         "Unsupported installed-component alias ancestor")
    for alias in aliases:
        if "node_modules" not in alias.split("/"):
            continue
        need(aliases[alias][0] == "symlink", "Unsupported installed hardlink")
        pending, resolved, followed, states = alias.split("/"), [], 0, set()
        while pending:
            need(time.monotonic() <= deadline and len(pending) <= 2048, "Installed alias exceeds bound")
            part = pending.pop(0)
            if part in {"", "."}:
                continue
            if part == "..":
                need(resolved, "Installed alias escapes image")
                resolved.pop()
                continue
            resolved.append(part)
            key = "/".join(resolved)
            if key in aliases:
                kind, target = aliases[key]
                need(kind == "symlink", "Unsupported installed hardlink")
                need(type(target) is str and 0 < len(target) <= 4096 and "\\" not in target
                     and all(ord(c) >= 32 and ord(c) != 127 for c in target), "Invalid installed alias target")
                followed += 1
                state = (key, tuple(pending))
                need(followed <= 40 and state not in states, "Installed alias cycle or depth")
                states.add(state)
                resolved.pop()
                if target.startswith("/"):
                    resolved = []
                pending = target.split("/") + pending
            else:
                need(key in tree, "Dangling installed alias")
                need(not pending or tree[key] == "dir", "Installed alias traverses non-directory")
        target = "/".join(resolved)
        package_file = target + "/package.json"
        need(tree.get(target) == "dir" and tree.get(package_file) == "file" and package_file in packages,
             "Installed alias lacks physical package target")
        metadata = strict_json(packages[package_file])
        need(type(metadata) is dict and "name" in metadata and "version" in metadata,
             "Installed alias target lacks complete identity")
        pattern(metadata["name"], r"[A-Za-z0-9_@./-]{1,300}")
        pattern(metadata["version"], r"[A-Za-z0-9_.+~-]{1,300}")


def node_inventory(files, deadline):
    metadata, installed = {}, {}
    for name, data in files.items():
        need(time.monotonic() <= deadline, "Installed package metadata exceeds time bound")
        package = strict_json(data)
        need(type(package) is dict, "Invalid installed package metadata")
        metadata[name] = package
        if "name" in package and "version" in package:
            installed[name] = (pattern(package["name"], r"[A-Za-z0-9_@./-]{1,300}"),
                               pattern(package["version"], r"[A-Za-z0-9_.+~-]{1,300}"))
    for name, package in metadata.items():
        need(time.monotonic() <= deadline, "Installed package metadata exceeds time bound")
        if name in installed:
            continue
        parts = name.split("/")
        anchor = max(i for i, part in enumerate(parts) if part == "node_modules")
        width = 2 if parts[anchor + 1].startswith("@") else 1
        root = "/".join(parts[:anchor + 1 + width])
        need(name != root + "/package.json" and root + "/package.json" in installed,
             "Incomplete installed package root")
        parents = [str(parent) + "/package.json" for parent in Path(name).parent.parents
                   if str(parent) == root or str(parent).startswith(root + "/")]
        parent = next((candidate for candidate in parents if candidate in installed), None)
        need(parent is not None, "Missing complete module descriptor parent")
        parent_name, parent_version = installed[parent]
        directory = str(Path(name).parent)
        component = str(Path(parent).parent)
        fields = {"name", "version", "type", "main", "module", "browser", "react-native", "types",
                  "exports", "sideEffects", "private", "author", "license"}
        need(package and set(package) <= fields and any(key in package for key in
             ["type", "main", "module", "browser", "react-native", "types", "exports"]),
             "Unsupported nested module descriptor")
        if "name" in package:
            label = pattern(package["name"], r"[A-Za-z0-9_@./-]{1,300}")
            need(not any(part in {"", ".", ".."} for part in label.split("/")), "Invalid module descriptor name")
            relative = name.removeprefix(component + "/")
            bundle = relative.removeprefix("dist/compiled/").removesuffix("/package.json")
            compiled = (root.endswith("/node_modules/next") and parent == root + "/package.json"
                        and parent_name == "next" and relative.startswith("dist/compiled/")
                        and (bundle == label or bundle.startswith(label + "/"))
                        and {"name", "main"} <= set(package) <= {"name", "main", "author", "license"})
            need(label == parent_name or label.startswith(parent_name + "/") or compiled,
                 "Contradictory module descriptor identity")
        if "version" in package:
            need(pattern(package["version"], r"[A-Za-z0-9_.+~-]{1,300}") == parent_version,
                 "Contradictory module descriptor version")
        if "type" in package:
            need(type(package["type"]) is str and package["type"] in {"module", "commonjs"}, "Invalid module descriptor type")
        if "private" in package:
            need(type(package["private"]) is bool, "Invalid module descriptor private flag")
        def target(value):
            need(time.monotonic() <= deadline, "Installed package metadata exceeds time bound")
            need(type(value) is str and 0 < len(value) <= 4096 and "\\" not in value
                 and all(ord(char) >= 32 and ord(char) != 127 for char in value)
                 and not value.startswith("/"), "Invalid module descriptor target")
            resolved = os.path.normpath(directory + "/" + value)
            need(resolved == component or resolved.startswith(component + "/"), "Module descriptor target escapes parent")
        for key in ["main", "module", "browser", "react-native", "types"]:
            if key in package:
                target(package[key])
        if "sideEffects" in package:
            effects = package["sideEffects"]
            need(type(effects) is bool or type(effects) is list and len(effects) <= 1000,
                 "Invalid module descriptor side effects")
            if type(effects) is list:
                for value in effects:
                    target(value)
        def export_targets(value, depth=0):
            need(time.monotonic() <= deadline, "Installed package metadata exceeds time bound")
            need(depth <= 16, "Module descriptor exports exceed bound")
            if type(value) is str:
                target(value)
            elif value is not None:
                need(type(value) in {dict, list} and len(value) <= 1000, "Invalid module descriptor exports")
                if type(value) is dict:
                    need(all(type(key) is str and len(key) <= 300 for key in value), "Invalid module descriptor export key")
                for child in value.values() if type(value) is dict else value:
                    export_targets(child, depth + 1)
        if "exports" in package:
            export_targets(package["exports"])
        if "license" in package:
            pattern(package["license"], r"[^\x00-\x1f\x7f]{1,4096}")
        if "author" in package:
            author = package["author"]
            need(type(author) is str or type(author) is dict and set(author) <= {"name", "email", "url"},
                 "Invalid module descriptor author")
            for value in author.values() if type(author) is dict else [author]:
                need(time.monotonic() <= deadline, "Installed package metadata exceeds time bound")
                pattern(value, r"[^\x00-\x1f\x7f]{1,4096}")
    return installed


def dpkg_inventory(files):
    """Read final regular control records, without merging or fabricating files."""
    combined = "var/lib/dpkg/status"
    need(files and not (combined in files and len(files) > 1), "Missing or mixed dpkg inventory formats")
    need(all(name == combined or re.fullmatch(r"var/lib/dpkg/status\.d/[^/]+", name)
             and not name.endswith(".md5sums") for name in files), "Invalid dpkg control record path")
    installed, occurrences = [], set()
    for name, data in files.items():
        status_d = name != combined
        text = data.decode("utf-8")
        need("\r" not in text and "\x00" not in text, "Invalid dpkg control encoding")
        paragraphs, fields, previous = [], {}, None
        for line in [*text.split("\n"), ""]:
            if not line:
                if fields:
                    paragraphs.append(fields)
                    need(len(paragraphs) <= 20000, "Excessive dpkg control paragraphs")
                fields, previous = {}, None
                continue
            need(all(ord(char) >= 32 or char == "\t" for char in line), "Invalid dpkg control character")
            if line[0] in " \t":
                need(previous is not None and previous not in {"package", "version", "status", "architecture"},
                     "Invalid dpkg identity continuation")
                continue
            match = re.fullmatch(r"([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(.*)", line)
            need(match is not None, "Invalid dpkg control field")
            key, value = match.group(1).lower(), match.group(2)
            need(key not in fields and len(fields) < 1000, "Duplicate or excessive dpkg control fields")
            fields[key], previous = value, key
        need(paragraphs and (not status_d or len(paragraphs) == 1), "Invalid dpkg control record count")
        for fields in paragraphs:
            package = pattern(fields.get("package"), r"[a-z0-9][a-z0-9+.-]{0,254}(?::[a-z0-9][a-z0-9-]{0,31})?")
            version = pattern(fields.get("version"), r"(?:[0-9]+:)?[0-9][A-Za-z0-9.+:~-]{0,298}")
            need(package not in occurrences and len(occurrences) < 20000, "Duplicate or excessive OS package occurrences")
            occurrences.add(package)
            need(status_d or "status" in fields, "Missing combined dpkg status")
            status = fields.get("status", "install ok installed")
            pattern(status, r"(?:unknown|install|hold|deinstall|purge) (?:ok|reinstreq) (?:not-installed|config-files|half-installed|unpacked|half-configured|triggers-awaited|triggers-pending|installed)")
            if status == "install ok installed":
                installed.append((package, version))
    need(installed, "Empty installed OS package inventory")
    return installed


def image_archive(file, build, layout=None):
    with tarfile.open(file, mode="r:") as tar:
        members = {}
        for member in tar:
            name = member.name.removeprefix("./").rstrip("/")
            need(name not in members and len(members) < 20000, "Duplicate or excessive archive members")
            need(name in {"blobs", "blobs/sha256"} and member.isdir() or
                 re.fullmatch(r"(?:oci-layout|index\.json|blobs/sha256/" + SHA + r")", name) and member.isfile(),
                 "Unsafe OCI archive member")
            integer(member.size, MAX_ARCHIVE, 0)
            members[name] = member
        def content(name):
            need(name in members and members[name].isfile() and members[name].size <= MAX_JSON, "Missing or oversized OCI metadata")
            return strict_json(tar.extractfile(members[name]).read())
        need(content("oci-layout") == {"imageLayoutVersion": "1.0.0"}, "Unsupported OCI layout")
        index = content("index.json")
        need(type(index) is dict and set(index) <= {"schemaVersion", "mediaType", "manifests"}
             and index.get("mediaType", "application/vnd.oci.image.index.v1+json") == "application/vnd.oci.image.index.v1+json"
             and type(index.get("schemaVersion")) is int and index["schemaVersion"] == 2
             and type(index.get("manifests")) is list and len(index["manifests"]) == 1,
             "Exactly one OCI platform manifest is required")
        def descriptor(desc, media_type=None, selected=False):
            keys = {"mediaType", "digest", "size", "platform"}
            if selected:
                keys.add("annotations")
            need(type(desc) is dict and set(desc) <= keys, "Invalid OCI descriptor")
            if "annotations" in desc:
                shape(desc["annotations"], "org.opencontainers.image.created")
                try:
                    parse_time(desc["annotations"]["org.opencontainers.image.created"])
                except ValueError:
                    raise Refused("Invalid selected OCI creation timestamp") from None
            pattern(desc.get("digest"), DIGEST)
            integer(desc.get("size"), MAX_ARCHIVE)
            name = "blobs/sha256/" + desc["digest"][7:]
            need(name in members and members[name].size == desc["size"], "Missing or changed OCI blob")
            if media_type:
                need(desc.get("mediaType") == media_type, "Unsupported OCI media type")
            return name
        picked = index["manifests"][0]
        manifest_name = descriptor(picked, MANIFEST, selected=True)
        need(picked.get("platform", {"os": "linux", "architecture": "amd64"}) == {"os": "linux", "architecture": "amd64"}, "Wrong selected OCI platform")
        manifest = content(manifest_name)
        shape(manifest, "schemaVersion mediaType config layers")
        need(type(manifest["schemaVersion"]) is int and manifest["schemaVersion"] == 2 and manifest["mediaType"] == MANIFEST, "Invalid OCI manifest")
        config_name = descriptor(manifest.get("config"), "application/vnd.oci.image.config.v1+json")
        need(type(manifest.get("layers")) is list and 0 < len(manifest["layers"]) <= 200, "Invalid layer inventory")
        required = {manifest_name, config_name}
        for layer in manifest["layers"]:
            need(layer.get("mediaType") in {"application/vnd.oci.image.layer.v1.tar+gzip", "application/vnd.oci.image.layer.v1.tar"}, "Unsupported layer type")
            required.add(descriptor(layer))
        need({name for name in members if name.startswith("blobs/sha256/")} == required, "Unreferenced OCI payload")
        for name in required:
            digest = hashlib.sha256()
            destination = None
            if layout:
                destination_path = layout / name
                destination_path.parent.mkdir(parents=True, exist_ok=True)
                destination = destination_path.open("xb")
            try:
                with tar.extractfile(members[name]) as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(block)
                        if destination:
                            destination.write(block)
            finally:
                if destination:
                    destination.close()
            need(digest.hexdigest() == name.rsplit("/", 1)[1], "OCI blob digest mismatch")
        config = content(config_name)
        config_schema(config, build)
        need(config.get("rootfs", {}).get("type") == "layers" and len(config["rootfs"].get("diff_ids", [])) == len(manifest["layers"]), "Incomplete root filesystem identity")
        for value in config["rootfs"]["diff_ids"]:
            pattern(value, DIGEST)
        expected = {"calcom/enterprise-build.json": None,
                    "calcom/scripts/enterprise-runtime-entrypoint.cjs": build["entrypointSha256"],
                    "calcom/scripts/check-enterprise-migration.sql": build["migrationPreflightSha256"],
                    "calcom/apps/web/.next/BUILD_ID": None,
                    "calcom/apps/web/.next/build-manifest.json": build["buildManifestSha256"]}
        shipped = {}
        package_files = {}
        aliases = {}
        final_tree = {}
        os_files = {}
        expanded = 0
        deadline = time.monotonic() + READ_SECONDS
        for number, layer in enumerate(manifest["layers"]):
            raw = tar.extractfile(members[descriptor(layer)])
            stream = gzip.GzipFile(fileobj=raw) if layer["mediaType"].endswith("+gzip") else raw
            diff = hashlib.sha256()
            with stream:
                while True:
                    block = stream.read(1024 * 1024)
                    if not block:
                        break
                    expanded += len(block)
                    need(expanded <= MAX_EXPANDED and time.monotonic() <= deadline, "Expanded image exceeds byte/time bound")
                    diff.update(block)
            need("sha256:" + diff.hexdigest() == config["rootfs"]["diff_ids"][number], "Root filesystem diff digest mismatch")
            raw = tar.extractfile(members[descriptor(layer)])
            stream = gzip.GzipFile(fileobj=raw) if layer["mediaType"].endswith("+gzip") else raw
            with stream, tarfile.open(fileobj=stream, mode="r|") as filesystem:
                seen = set()
                non_directories = set()
                layer_values = {}
                layer_aliases = {}
                layer_tree = {}
                whiteouts = set()
                for entries, entry in enumerate(filesystem, 1):
                    need(entries <= 500000 and filesystem.offset <= MAX_EXPANDED and time.monotonic() <= deadline, "Expanded layer exceeds bound")
                    name = entry.name.removeprefix("./").rstrip("/")
                    need(not name.startswith("/") and ".." not in name.split("/"), "Unsafe layer path")
                    need(name not in seen, "Ambiguous repeated layer path")
                    seen.add(name)
                    if not entry.isdir():
                        non_directories.add(name)
                    parent, _, base = name.rpartition("/")
                    if base.startswith(".wh."):
                        need(entry.isfile() and entry.size == 0 and (base == ".wh..wh..opq" or len(base) > 4), "Invalid OCI whiteout")
                        hidden = parent if base == ".wh..wh..opq" else (parent + "/" + base[4:]).lstrip("/")
                        whiteouts.add(hidden)
                    else:
                        layer_tree[name] = ("dir" if entry.isdir() else "file" if entry.isfile() else
                                            "symlink" if entry.issym() else "hardlink" if entry.islnk() else "special")
                    if name == "var/lib/dpkg/status" or (parent == "var/lib/dpkg/status.d"
                            and not base.startswith(".wh.") and not base.endswith(".md5sums")):
                        need(entry.type in {tarfile.REGTYPE, tarfile.AREGTYPE} and not entry.sparse
                             and entry.size <= MAX_JSON, "Invalid dpkg inventory file")
                        layer_values[name] = filesystem.extractfile(entry).read()
                        need(len(layer_values) <= 20000 and sum(len(v) for v in layer_values.values()) <= 2 * MAX_JSON,
                             "Installed-component inventory exceeds bound")
                    if "node_modules/" in name and name.endswith("/package.json"):
                        need(entry.isfile() and entry.size <= MAX_JSON, "Unsupported package-copy alias or file type")
                        layer_values[name] = filesystem.extractfile(entry).read()
                        need(len(layer_values) <= 20000 and sum(len(v) for v in layer_values.values()) <= 2 * MAX_JSON, "Installed-component inventory exceeds bound")
                    if entry.issym() or entry.islnk():
                        layer_aliases[name] = ("symlink" if entry.issym() else "hardlink", entry.linkname)
                    for key in expected:
                        if name == key:
                            need(entry.isfile() and entry.size <= MAX_JSON, "Runtime identity file has wrong type/size")
                            layer_values[key] = filesystem.extractfile(entry).read()
                        elif key.startswith(name + "/"):
                            need(entry.isdir(), "Runtime identity ancestor is not a directory")
                for inventory in [shipped, package_files, os_files, aliases, final_tree]:
                    for key in list(inventory):
                        if hidden_or_replaced(key, seen, non_directories, whiteouts):
                            inventory.pop(key)
                # OCI whiteouts affect lower layers even if their markers follow
                # replacement entries in the same tar stream.
                for key, value in layer_values.items():
                    need(not any(str(parent) in non_directories for parent in Path(key).parents if str(parent) != "."), "Ambiguous layer ancestor replacement")
                    if key in expected:
                        shipped[key] = value
                    elif key == "var/lib/dpkg/status" or key.startswith("var/lib/dpkg/status.d/"):
                        os_files[key] = value
                    else:
                        package_files[key] = value
                aliases.update(layer_aliases)
                final_tree.update(layer_tree)
                for key in layer_tree:
                    for parent in Path(key).parents:
                        if str(parent) != ".":
                            final_tree.setdefault(str(parent), "dir")
                need(len(final_tree) <= 500000, "Final filesystem inventory exceeds bound")
                need(len(package_files) <= 20000 and sum(len(v) for v in package_files.values()) <= 2 * MAX_JSON, "Installed-component inventory exceeds bound")
                need(len(os_files) <= 20000 and sum(len(v) for v in os_files.values()) <= 2 * MAX_JSON, "OS inventory exceeds bound")
        identity_paths = {*expected, *package_files, *os_files, "var/lib/dpkg/status", "var/lib/dpkg/status.d"}
        installed_aliases(aliases, final_tree, package_files, identity_paths, deadline)
        need(set(shipped) == set(expected), "Missing shipped runtime identity files")
        need(strict_json(shipped["calcom/enterprise-build.json"]) == build
             and shipped["calcom/apps/web/.next/BUILD_ID"].decode().strip() == build["buildId"], "Embedded build identity mismatch")
        for name, digest in expected.items():
            if digest:
                need(sha(shipped[name]) == digest, "Shipped runtime recipe/build bytes differ")
        # Every descriptor remains in the hashed layer bytes and bounded final metadata.
        installed = node_inventory(package_files, deadline)
        need(final_tree.get("var/lib/dpkg/status.d") in {None, "dir"}, "Invalid dpkg inventory directory")
        os_packages = dpkg_inventory(os_files)
        need(installed and os_packages, "Empty installed-component inventory")
        if layout:
            for name in ["index.json", "oci-layout"]:
                (layout / name).write_bytes(tar.extractfile(members[name]).read())
        return picked["digest"], manifest["config"]["digest"], config, installed, os_packages


def proof_identity(proof, source, manifest, config, now):
    need(proof["schemaVersion"] == 1 and type(proof["schemaVersion"]) is int and proof["sourceSha"] == source
         and proof["manifestDigest"] == manifest and proof["configDigest"] == config, "Native evidence identity mismatch")
    need(type(proof["exitCode"]) is int and proof["exitCode"] == 0, "Native evidence did not complete")
    fresh(proof["completedAt"], now)


def native_proofs(container, scan, ledger, source, manifest, config, now, build, installed, os_packages):
    shape(container, "schemaVersion sourceSha publicOrigin buildId manifestDigest configDigest completedAt exitCode nativeReceiptSha256 checks expectedMigrations appliedMigrations")
    proof_identity(container, source, manifest, config, now)
    need(container["publicOrigin"] == ORIGIN and container["buildId"] == build["buildId"], "Native container origin/build mismatch")
    pattern(container["nativeReceiptSha256"], SHA)
    shape(container["checks"], "migration migrationReplay nonRootReadOnlyWeb nativePublicCallback anonymousSession")
    need(all(v is True for v in container["checks"].values()), "Incomplete native container acceptance")
    integer(container["expectedMigrations"], 100000)
    need(type(container["appliedMigrations"]) is int and container["appliedMigrations"] == container["expectedMigrations"], "Incomplete native migration acceptance")
    shape(scan, "schemaVersion sourceSha manifestDigest configDigest completedAt exitCode scanner rawReportSha256 secretScope report releaseApproved")
    proof_identity(scan, source, manifest, config, now)
    need(scan["releaseApproved"] is False, "Candidate cannot confer release approval")
    shape(scan["scanner"], "version binarySha256 databaseSha256 databaseMetadata ignoredFindings skipFiles skipDirs ignoreUnfixed")
    scanner = scan["scanner"]
    pattern(scanner["version"], r"\d+\.\d+\.\d+")
    for key in ["binarySha256", "databaseSha256"]:
        pattern(scanner[key], SHA)
    db = shape(scanner["databaseMetadata"], "raw sha256")
    need(type(db["raw"]) is str and len(db["raw"]) <= 4096
         and sha(db["raw"].encode()) == pattern(db["sha256"], SHA), "Database metadata byte identity mismatch")
    metadata = shape(strict_json(db["raw"].encode()), "Version UpdatedAt NextUpdate DownloadedAt")
    need(type(metadata["Version"]) is int and metadata["Version"] == 2, "Unsupported scanner database format")
    updated, expires, downloaded = [parse_time(metadata[k]) for k in ["UpdatedAt", "NextUpdate", "DownloadedAt"]]
    completed = parse_time(scan["completedAt"])
    need(0 < (expires - updated).total_seconds() <= 172800 and now < expires and completed < expires
         and -300 <= (now - downloaded).total_seconds() <= 86400
         and (downloaded - updated).total_seconds() >= -300
         and (completed - downloaded).total_seconds() >= -300
         and (completed - updated).total_seconds() >= -300, "Scanner database is stale or implausible")
    need(type(scanner["ignoredFindings"]) is int and scanner["ignoredFindings"] == 0 and scanner["skipFiles"] == []
         and scanner["skipDirs"] == [] and scanner["ignoreUnfixed"] is False, "Suppressed scan coverage")
    pattern(scan["rawReportSha256"], SHA)
    shape(scan["secretScope"], "filesystem allLayers configAndHistory findings exitCode")
    need(all(scan["secretScope"][k] is True for k in ["filesystem", "allLayers", "configAndHistory"])
         and type(scan["secretScope"]["findings"]) is int and scan["secretScope"]["findings"] == 0
         and type(scan["secretScope"]["exitCode"]) is int and scan["secretScope"]["exitCode"] == 0, "Secret analysis incomplete or positive")
    report = shape(scan["report"], "SchemaVersion ArtifactType Metadata Results")
    need(report["SchemaVersion"] == 2 and report["ArtifactType"] == "container_image", "Wrong scan analysis type")
    metadata = shape(report["Metadata"], "ImageID OS")
    shape(metadata["OS"], "Family Name")
    need(metadata["ImageID"] == config and metadata["OS"]["Family"] == "debian", "Scan has no matching OS/image analysis")
    pattern(metadata["OS"]["Name"], r"(?:12|13)(?:\.\d+)?")
    need(type(report["Results"]) is list and 0 < len(report["Results"]) <= 10000, "Missing scan results")
    counts = collections.Counter()
    highs = []
    components = {}
    scanned_os = []
    os_ids = []
    os_results = 0
    for result in report["Results"]:
        shape(result, "Target Class Type Packages Vulnerabilities Secrets")
        pattern(result["Target"], r"[A-Za-z0-9_@./+() -]{1,600}")
        need(type(result["Secrets"]) is list and not result["Secrets"], "Detected secrets in scan")
        need(type(result["Packages"]) is list and type(result["Vulnerabilities"]) is list, "Incomplete installed-package analysis")
        if result["Class"] == "os-pkgs":
            os_results += 1
            need(result["Type"] == "debian" and result["Packages"], "Missing Debian package analysis")
        else:
            need(result["Class"] == "lang-pkgs" and result["Type"] == "node-pkg", "Unexpected scan analysis class")
        for package in result["Packages"]:
            shape(package, "ID Name Version PkgPath")
            for key in ["ID", "Name", "Version"]:
                pattern(package[key], r"[A-Za-z0-9_@.+:~/-]{1,300}")
            need(type(package["PkgPath"]) is str and len(package["PkgPath"]) <= 600, "Invalid package location")
            if result["Class"] == "os-pkgs":
                os_ids.append(package["ID"])
                scanned_os.append((package["Name"], package["Version"]))
            else:
                location = (package["PkgPath"] or result["Target"]).lstrip("/")
                need(location not in components, "Duplicate runtime component occurrence")
                components[location] = (package["Name"], package["Version"])
        for finding in result["Vulnerabilities"]:
            shape(finding, "VulnerabilityID PkgName InstalledVersion Severity")
            for key in ["VulnerabilityID", "PkgName", "InstalledVersion"]:
                pattern(finding[key], r"[A-Za-z0-9_@.+:~/-]{1,300}")
            need(finding["Severity"] in {"CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"}, "Unknown severity vocabulary")
            counts[finding["Severity"]] += 1
            if finding["Severity"] == "HIGH":
                highs.append((result["Target"], finding["PkgName"], finding["InstalledVersion"], finding["VulnerabilityID"]))
    need(os_results == 1 and len(os_ids) > 0 and len(os_ids) == len(set(os_ids))
         and components == installed and collections.Counter(scanned_os) == collections.Counter(os_packages), "Incomplete or duplicate OS/Node occurrence coverage")
    need(all(components.get(file, (None,))[0] == name for file, name in REQUIRED.items()), "Missing required runtime sentinel")
    need(counts["CRITICAL"] == 0, "Critical findings block candidate publication")
    shape(ledger, "schemaVersion sourceSha manifestDigest releaseApproved entries")
    need(type(ledger["schemaVersion"]) is int and ledger["schemaVersion"] == 1 and ledger["sourceSha"] == source
         and ledger["manifestDigest"] == manifest and ledger["releaseApproved"] is False, "Wrong HIGH disposition identity")
    need(type(ledger["entries"]) is list, "Missing HIGH occurrence ledger")
    actual = []
    for row in ledger["entries"]:
        shape(row, "target package version advisory disposition")
        need(row["disposition"] == "unwaived", "HIGH findings cannot be waived by publication")
        actual.append((row["target"], row["package"], row["version"], row["advisory"]))
    need(collections.Counter(actual) == collections.Counter(highs), "HIGH occurrence ledger is incomplete")
    return dict(counts)


def admit(directory, receipt_hash, source, actor, checkout, now=None, layout=None):
    pattern(receipt_hash, SHA)
    need(directory.is_dir() and not directory.is_symlink(), "Invalid artifact directory")
    need({p.name for p in directory.iterdir()} == {"publication.json", *FILES.values()}, "Unexpected artifact files")
    for file in directory.iterdir():
        need(stat.S_ISREG(file.lstat().st_mode), "Artifact must be a regular file")
    receipt_file = directory / "publication.json"
    need(receipt_file.stat().st_size <= 65536 and file_hash(receipt_file) == receipt_hash, "Receipt checksum mismatch")
    receipt = strict_json(receipt_file.read_bytes())
    now = now or dt.datetime.now(dt.timezone.utc)
    request_schema(receipt, source, actor, now)
    for kind, asset in receipt["artifacts"].items():
        file = directory / FILES[kind]
        need(file.stat().st_size == asset["bytes"] and file_hash(file) == asset["sha256"], "Artifact checksum or size mismatch")
    build = strict_json((directory / FILES["build"]).read_bytes())
    build_schema(build, source, checkout)
    manifest, config, image_config, installed, os_packages = image_archive(directory / FILES["archive"], build, layout)
    proofs = [strict_json((directory / FILES[k]).read_bytes()) for k in ["container", "scan", "ledger"]]
    counts = native_proofs(*proofs, source, manifest, config, now, build, installed, os_packages)
    need(file_hash(receipt_file) == receipt_hash, "Receipt changed during admission")
    for kind, asset in receipt["artifacts"].items():
        file = directory / FILES[kind]
        need(stat.S_ISREG(file.lstat().st_mode) and file.stat().st_size == asset["bytes"]
             and file_hash(file) == asset["sha256"], "Artifact changed during admission")
    return {"sourceSha": source, "publicOrigin": ORIGIN, "producerActor": actor,
            "manifestDigest": manifest, "configDigest": config, "counts": counts,
            "releaseApproved": False, "tag": f"candidate-{source}-{manifest[7:]}", "config": image_config}


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urllib.parse.urlsplit(newurl)
        need(url.scheme == "https" and url.hostname in {"release-assets.githubusercontent.com", "objects.githubusercontent.com"}
             and not url.username and not url.password and url.port in {None, 443}, "Unapproved asset redirect")
        return urllib.request.Request(newurl, headers={"Accept": "application/octet-stream"})


def download(endpoint, output, limit, token):
    need(endpoint.startswith(f"https://api.github.com/repos/{REPOSITORY}/releases/"), "Unapproved asset endpoint")
    request = urllib.request.Request(endpoint, headers={"Accept": "application/octet-stream" if output else "application/vnd.github+json",
                                                       **({"Authorization": "Bearer " + token} if token else {})})
    opener = urllib.request.build_opener(SafeRedirect())
    deadline = time.monotonic() + 600
    with opener.open(request, timeout=30) as response:
        if output is None:
            return strict_json(response.read(limit + 1))
        with output.open("xb") as stream:
            os.chmod(output, 0o600)
            size = 0
            while True:
                need(time.monotonic() < deadline, "Asset transfer exceeded deadline")
                block = response.read(min(1024 * 1024, limit - size + 1))
                if not block:
                    break
                size += len(block)
                need(size <= limit, "Asset exceeds bound")
                stream.write(block)


def fetch(directory, release_id, receipt_id, receipt_hash, source, actor):
    pattern(source, r"[0-9a-f]{40}")
    pattern(receipt_hash, SHA)
    integer(release_id, 2**53 - 1)
    integer(receipt_id, 2**53 - 1)
    need(not directory.exists(), "Download directory already exists")
    token = os.environ.get("GITHUB_TOKEN", "")
    base = f"https://api.github.com/repos/{REPOSITORY}/releases/"
    release = download(base + str(release_id), None, MAX_JSON, token)
    need(type(release.get("id")) is int and release["id"] == release_id and release.get("draft") is False and release.get("prerelease") is True
         and release.get("tag_name") == "cal-candidate-" + source and release.get("target_commitish") == source
         and release.get("author", {}).get("login") == actor, "Wrong candidate release identity")
    assets = release.get("assets")
    need(type(assets) is list and len(assets) == 6, "Candidate release must contain only six admitted assets")
    metadata = {}
    for asset in assets:
        integer(asset.get("id"), 2**53 - 1)
        integer(asset.get("size"), MAX_ARCHIVE)
        need(asset["id"] not in metadata and asset.get("state") == "uploaded", "Invalid release asset identity")
        metadata[asset["id"]] = asset
    need(receipt_id in metadata and metadata[receipt_id].get("name") == "publication.json"
         and 0 < metadata[receipt_id].get("size", 0) <= 65536, "Wrong receipt asset")
    directory.mkdir(mode=0o700)
    download(base + "assets/" + str(receipt_id), directory / "publication.json", 65536, token)
    need(file_hash(directory / "publication.json") == receipt_hash, "Receipt checksum mismatch")
    receipt = strict_json((directory / "publication.json").read_bytes())
    request_schema(receipt, source, actor, dt.datetime.now(dt.timezone.utc))
    expected_ids = {receipt_id}
    for kind, asset in receipt["artifacts"].items():
        need(asset["assetId"] != receipt_id, "Receipt cannot also be an image/proof asset")
        selected = metadata.get(asset["assetId"], {})
        need(selected.get("name") == FILES[kind] and selected.get("size") == asset["bytes"], "Wrong asset metadata")
        expected_ids.add(asset["assetId"])
        download(base + "assets/" + str(asset["assetId"]), directory / FILES[kind], asset["bytes"], token)
    need(expected_ids == set(metadata), "Unbound release assets")


def publish(directory, receipt_hash, source, actor, checkout, run=command):
    env = os.environ.copy()
    need(env.get("GITHUB_ACTIONS") == "true" and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
         and env.get("GITHUB_REPOSITORY") == REPOSITORY and env.get("GITHUB_ACTOR") == actor, "Publication requires the canonical manual workflow actor")
    pattern(env.get("GITHUB_SHA"), r"[0-9a-f]{40}")
    need(env.get("GITHUB_WORKFLOW_REF", "").startswith(REPOSITORY + "/.github/workflows/build-fork-image.yml@refs/"), "Wrong publisher workflow")
    revision = command(["git", "-C", str(checkout), "rev-parse", "HEAD"])
    need(revision.returncode == 0 and revision.stdout.decode().strip() == env["GITHUB_SHA"], "Publisher checkout revision mismatch")
    pattern(env.get("GITHUB_RUN_ID"), r"[1-9][0-9]{0,19}")
    token = env.get("GITHUB_TOKEN", "")
    need(token, "Missing repository publication credential")
    with tempfile.TemporaryDirectory(prefix="cal-prebuilt-") as scratch:
        scratch = Path(scratch)
        layout = scratch / "layout"
        layout.mkdir(mode=0o700)
        admitted = admit(directory, receipt_hash, source, actor, checkout, layout=layout)
        env["DOCKER_CONFIG"] = str(scratch / "auth")
        Path(env["DOCKER_CONFIG"]).mkdir(mode=0o700)
        def crane(*args, input_data=None):
            return run(["crane", *args], input_data=input_data, env=env, timeout=900)
        need(crane("auth", "login", "ghcr.io", "-u", actor, "--password-stdin", input_data=token.encode()).returncode == 0, "Registry authentication failed")
        target = REGISTRY + ":" + admitted["tag"]
        existing = crane("digest", target)
        if existing.returncode:
            need(b"MANIFEST_UNKNOWN" in existing.stderr and not any(v in existing.stderr.lower() for v in [b"unauthorized", b"denied", b"forbidden", b"401", b"403"]), "Registry absence is unproved or access denied")
            need(crane("push", str(layout), target).returncode == 0, "Candidate push failed")
            state = "published"
        else:
            need(existing.stdout.decode().strip() == admitted["manifestDigest"], "Existing candidate tag conflicts")
            state = "already-present"
        readback = crane("digest", target)
        need(readback.returncode == 0 and readback.stdout.decode().strip() == admitted["manifestDigest"], "Registry manifest digest readback failed")
        immutable = REGISTRY + "@" + admitted["manifestDigest"]
        remote_manifest = crane("manifest", immutable)
        remote_config = crane("blob", REGISTRY + "@" + admitted["configDigest"])
        need(remote_manifest.returncode == 0 and remote_config.returncode == 0, "Registry metadata readback failed")
        need("sha256:" + sha(remote_manifest.stdout) == admitted["manifestDigest"]
             and "sha256:" + sha(remote_config.stdout) == admitted["configDigest"]
             and strict_json(remote_manifest.stdout).get("config", {}).get("digest") == admitted["configDigest"]
             and strict_json(remote_config.stdout) == admitted["config"], "Registry manifest/config bytes differ")
        admitted.update({"registryRef": immutable, "state": state, "publisherRevision": env["GITHUB_SHA"],
                         "publisherActor": actor, "runId": env["GITHUB_RUN_ID"]})
        return admitted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["admit", "fetch", "publish"])
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--receipt-sha256", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--checkout", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--release-id", type=int)
    parser.add_argument("--receipt-asset-id", type=int)
    args = parser.parse_args()
    if args.operation == "fetch":
        fetch(args.directory, args.release_id, args.receipt_asset_id, args.receipt_sha256, args.source_sha, args.actor)
        result = admit(args.directory, args.receipt_sha256, args.source_sha, args.actor, args.checkout)
    elif args.operation == "publish":
        result = publish(args.directory, args.receipt_sha256, args.source_sha, args.actor, args.checkout)
    else:
        result = admit(args.directory, args.receipt_sha256, args.source_sha, args.actor, args.checkout)
    result.pop("config", None)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Provider bodies, image metadata and credential-bearing command stderr stay private.
        print("Prebuilt candidate refused; inspect private evidence and documented admission requirements", file=sys.stderr)
        sys.exit(1)
