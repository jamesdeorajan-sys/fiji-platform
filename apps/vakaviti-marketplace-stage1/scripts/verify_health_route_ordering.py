#!/usr/bin/env python3
"""Structural proof that no application route on `app` (src/index.ts) is registered after the
root Deal Exchange mount (app.route('/', dealExchangeUi)) - unless explicitly exempted below and
covered by its own test.

CEO HOTFIX AUTHORIZATION (2026-08-27): this exact defect broke production - app.route('/',
dealExchangeUi) is a wildcard mount, and dealExchangeUi's own fail-closed gate is a wildcard
middleware, so Hono's registration-order composition meant any route registered on `app` after
this line was intercepted by that gate before its own handler ever ran (silently masked on every
prior deployment because the public flag was always "true" there, so the gate never denied
anything). Fixed by moving /api/health above the mount; this script makes the ordering constraint
permanent and enforced, not just a comment.

Comment-stripping mirrors the established lesson from scripts/verify_qa_isolation.py and
scripts/verify_qa_cleanup_workflow.py earlier in this engagement: a plain-text scan that doesn't
strip `//` comments can match its own explanatory prose as if it were code. This script strips
single-line `//` comments before scanning for real `app.<method>(` calls.

Usage: python3 verify_health_route_ordering.py <path-to-index.ts>
"""
import re
import sys

MOUNT_LINE = "app.route('/', dealExchangeUi)"
ROUTE_CALL = re.compile(r"\bapp\.(get|post|put|delete|patch|route|all)\s*\(")

# Routes deliberately allowed to remain registered after the mount, because they are themselves
# part of - or deliberately layered on top of - the Deal Exchange feature and are covered by their
# own tests (src/__tests__/deal-exchange-public-flag-guard.test.ts,
# src/__tests__/health-route-ordering.test.ts). Empty today - add an entry here only alongside a
# comment explaining why, and a test proving it behaves correctly either side of the flag.
EXEMPT_LINE_SUBSTRINGS: list[str] = []


def strip_line_comment(line: str) -> str:
    # Good enough for this file: no route-registration line in index.ts contains a string literal
    # with "//" inside it, so a plain split on the first "//" cannot misfire here the way a
    # generic comment stripper might on arbitrary source.
    idx = line.find("//")
    return line if idx == -1 else line[:idx]


def check(source: str) -> list[str]:
    lines = source.splitlines()
    mount_index = None
    for i, raw_line in enumerate(lines):
        if MOUNT_LINE in strip_line_comment(raw_line):
            mount_index = i
            break

    if mount_index is None:
        return [f"Could not find the exact mount line {MOUNT_LINE!r} - has it been renamed or removed?"]

    failures = []
    for i in range(mount_index + 1, len(lines)):
        code = strip_line_comment(lines[i])
        if any(sub in code for sub in EXEMPT_LINE_SUBSTRINGS):
            continue
        if ROUTE_CALL.search(code):
            failures.append(f"line {i + 1}: application route registered after the Deal Exchange mount: {lines[i].strip()!r}")
    return failures


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: verify_health_route_ordering.py <path-to-index.ts>")
        sys.exit(2)
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        source = f.read()
    failures = check(source)
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        print(f"\n{len(failures)} violation(s) found in {sys.argv[1]}.")
        sys.exit(1)
    print(f"OK: {sys.argv[1]} - no application route is registered after the Deal Exchange mount.")
    sys.exit(0)


if __name__ == "__main__":
    main()
