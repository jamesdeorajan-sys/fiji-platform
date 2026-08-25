#!/usr/bin/env python3
"""Structural proof that the ordinary (top-level) wrangler.toml config cannot reach QA
resources, and that [env.qa] is the isolated, correctly-shaped QA environment.

CEO CORRECTION (2026-08-25): replaces an earlier awk/grep literal-string check that produced a
false positive against its own explanatory comments (a comment saying "QA_AUTH_SECRET is
deliberately absent from this section" itself contains the string "QA_AUTH_SECRET"). This script
parses real TOML structure via Python 3's standard-library `tomllib` - no new npm, Python, or
GitHub Action dependency - and inspects actual keys/tables, never raw text. Comments are ignored
naturally because tomllib never sees them at all; they aren't part of the parsed document.

Usage: python3 verify_qa_isolation.py <path-to-wrangler.toml>
Exit 0 and prints "OK: ..." if every check passes. Exit 1 and prints one "FAIL: ..." line per
violation otherwise.
"""
import sys

if sys.version_info < (3, 11):
    print("FAIL: this script requires Python 3.11+ for the standard-library tomllib module.")
    sys.exit(1)

import tomllib  # noqa: E402  (import after the version guard, deliberately)

QA_WORKER_NAME = "vakaviti-live-deal-exchange-qa"
QA_DB_BINDING = "DEAL_EXCHANGE_QA_DB"
QA_DB_ID = "2fccc7a7-e943-48bd-a810-687dd6c01b36"
PRODUCTION_DB_ID = "f2753057-4319-404d-bcda-84cccd288fe1"
SHARED_PREVIEW_DB_ID = "3f9a36c7-829c-4f9d-8af0-bb5332860f4b"


def check(doc: dict) -> list[str]:
    failures: list[str] = []

    # ------------------------------------------------------------------
    # Ordinary (top-level) configuration - everything except the parsed `env` table.
    # This is what Cloudflare Workers Builds actually deploys for the branch preview and,
    # eventually, production - it must be structurally incapable of reaching QA resources.
    # ------------------------------------------------------------------
    top_level = {k: v for k, v in doc.items() if k != "env"}

    for db in top_level.get("d1_databases", []):
        if db.get("binding") == QA_DB_BINDING:
            failures.append(f"[1] Top-level d1_databases contains a binding named {QA_DB_BINDING} - must exist only under [env.qa].")
        if db.get("database_id") == QA_DB_ID:
            failures.append(f"[2] Top-level d1_databases references the QA database id {QA_DB_ID} - must exist only under [env.qa].")

    top_vars = top_level.get("vars", {})
    if "QA_TEST_MODE" in top_vars:
        failures.append("[3] Top-level [vars] contains QA_TEST_MODE - must exist only under [env.qa.vars].")
    if "QA_AUTH_SECRET" in top_vars:
        failures.append("[4] Top-level [vars] contains QA_AUTH_SECRET - must exist only under [env.qa.vars].")
    if "GIT_COMMIT_SHA" in top_vars:
        failures.append("[5] Top-level [vars] contains GIT_COMMIT_SHA - this is injected transiently via `wrangler deploy --var` for the QA deploy only, never a static top-level value.")

    if top_level.get("name") == QA_WORKER_NAME:
        failures.append(f"[6] Top-level Worker name equals the dedicated QA Worker name ({QA_WORKER_NAME!r}) - the ordinary Worker must never be named this.")

    # [7] Any QA-only route/custom domain/Cron in the top level. A legitimate top-level
    # [triggers] block (the real production Deal Intelligence Cron) is expected and fine - what
    # must never appear is a route/custom_domain/cron that is itself QA-flavoured.
    for key in ("routes", "route", "custom_domain", "custom_domains"):
        value = top_level.get(key)
        if value is None:
            continue
        text = str(value).lower()
        if "qa" in text or QA_WORKER_NAME in text:
            failures.append(f"[7] Top-level {key!r} appears to reference the QA environment: {value!r}.")

    # ------------------------------------------------------------------
    # env.qa - positively verify it is the correctly-shaped, isolated QA environment.
    # ------------------------------------------------------------------
    env_qa = doc.get("env", {}).get("qa")
    if not env_qa:
        failures.append("[env.qa missing] [env.qa] table is absent entirely.")
        return failures  # nothing further to check

    if env_qa.get("name") != QA_WORKER_NAME:
        failures.append(f"[env.qa name] expected {QA_WORKER_NAME!r}, found {env_qa.get('name')!r}.")

    qa_d1 = env_qa.get("d1_databases", [])
    qa_db_entry = next((db for db in qa_d1 if db.get("binding") == QA_DB_BINDING), None)
    if not qa_db_entry:
        failures.append(f"[env.qa d1] no d1_databases entry with binding {QA_DB_BINDING!r} found.")
    elif qa_db_entry.get("database_id") != QA_DB_ID:
        failures.append(f"[env.qa d1 id] {QA_DB_BINDING} has database_id {qa_db_entry.get('database_id')!r}, expected {QA_DB_ID!r}.")

    for db in qa_d1:
        if db.get("database_id") in (PRODUCTION_DB_ID, SHARED_PREVIEW_DB_ID):
            failures.append(f"[env.qa no prod/preview id] [env.qa] references a non-QA database id {db.get('database_id')!r} - production/shared-preview databases must never be bound here.")

    qa_vars = env_qa.get("vars", {})
    qa_test_mode = qa_vars.get("QA_TEST_MODE")
    if str(qa_test_mode).lower() != "true":
        failures.append(f"[env.qa QA_TEST_MODE] expected 'true', found {qa_test_mode!r}.")

    if "routes" in env_qa or "route" in env_qa:
        failures.append("[env.qa no route] [env.qa] declares a route - the QA environment must never take routed traffic.")
    if "custom_domain" in env_qa or "custom_domains" in env_qa:
        failures.append("[env.qa no custom domain] [env.qa] declares a custom domain.")
    if "triggers" in env_qa and env_qa["triggers"].get("crons"):
        failures.append("[env.qa no cron] [env.qa] declares a Cron trigger - the QA environment must never run on a schedule.")

    return failures


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: verify_qa_isolation.py <path-to-wrangler.toml>")
        sys.exit(2)
    path = sys.argv[1]
    with open(path, "rb") as f:
        doc = tomllib.load(f)
    failures = check(doc)
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        print(f"\n{len(failures)} structural violation(s) found in {path}.")
        sys.exit(1)
    print(f"OK: {path} passes all QA isolation structural checks (top-level clean, [env.qa] correctly shaped).")
    sys.exit(0)


if __name__ == "__main__":
    main()
