#!/usr/bin/env python3
"""Fail if the working tree contains something that looks like a real secret.

Runs locally (pre-commit) and in CI next to gitleaks. Deliberately conservative: it knows the shapes of the
credentials that leaked in the source project (Atlas URIs with passwords, Meta tokens, Razorpay keys, default JWT secrets).
Usage: scan_secrets.py [paths...]   (default: whole repo)
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

PATTERNS = {
    "MongoDB URI with credentials": re.compile(r"mongodb(?:\+srv)?://[^\s:/@'\"<>]+:[^\s@'\"<>]{3,}@(?!cluster0\.xxxxx)[^\s'\"<>]+"),
    "Meta/WhatsApp access token": re.compile(r"\bEAA[A-Za-z0-9]{40,}"),
    "Razorpay key": re.compile(r"\brzp_(?:live|test)_[A-Za-z0-9]{8,}"),
    "Razorpay/gateway client key": re.compile(r"\b[a-z]{2,4}_sec_[0-9a-f]{20,}\b"),
    "Private key block": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----"),
    "Google API key": re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"),
    "Hard-coded JWT/secret default": re.compile(r"(?i)(?:jwt_secret|secret_key|api_secret)\s*[=:]\s*['\"][^'\"\s]{8,}['\"]"),
    "Hard-coded password assignment": re.compile(r"(?i)\b(?:admin|staff|driver|root|db)_?password\s*[=:]\s*['\"][^'\"\s<{$][^'\"\s]{3,}['\"]"),
}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", ".ruff_cache", ".pytest_cache"}
SKIP_FILES = {"scan_secrets.py"}  # this file contains the patterns
BINARY = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".zip", ".woff", ".woff2", ".ttf", ".pdf", ".jks"}
ALLOW_MARK = "scan-secrets: allow"  # same-line escape hatch for documented fakes


def iter_files(paths: list[str]):
    roots = [Path(p) for p in paths] or [Path(__file__).resolve().parents[1]]
    for root in roots:
        files = [root] if root.is_file() else root.rglob("*")
        for f in files:
            if f.is_file() and not (set(f.parts) & SKIP_DIRS) and f.suffix.lower() not in BINARY and f.name not in SKIP_FILES:
                yield f


def scan(paths: list[str]) -> list[tuple[str, int, str]]:
    hits = []
    for f in iter_files(paths):
        try:
            text = f.read_text(errors="ignore")
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            if ALLOW_MARK in line:
                continue
            for name, rx in PATTERNS.items():
                if rx.search(line):
                    hits.append((str(f), n, name))
    return hits


def main() -> int:
    hits = scan(sys.argv[1:])
    for path, n, name in hits:
        print(f"{path}:{n}: {name}  (value hidden)")
    if hits:
        print(f"\n{len(hits)} possible secret(s). Remove them, load from the environment, and ROTATE anything real.")
        return 1
    print("scan_secrets: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
