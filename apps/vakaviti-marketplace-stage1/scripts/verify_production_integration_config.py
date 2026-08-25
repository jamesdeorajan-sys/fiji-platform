#!/usr/bin/env python3
"""Structural proof that THIS branch (ceo/vakaviti-live-deal-exchange-production-integration)
carries the corrected production configuration, never the preview/QA one, and that [env.qa]
remains exactly the isolated environment it always was.

CEO AUTHORIZATION (2026-08-26): this branch changes only wrangler.toml configuration plus this
guard script - no application code changes relative to the QA-proven cea9fb5d. Distinct from, and
in addition to, scripts/verify_qa_isolation.py (untouched on this branch, still checked in
`validate`) which proves the ordinary/top-level config cannot reach QA resources. This script
proves the separate, additional property that matters only on THIS branch: the top-level config
points at the real, freshly-migrated production database and has the public flag off, not at the
preview database or a public='true' flag.

Uses Python 3's standard-library tomllib - same reasoning as verify_qa_isolation.py: real TOML
structure, comments are never seen because tomllib strips them during parsing, not via text
matching, so this cannot repeat the earlier comment-false-positive class of bug.

Usage: python3 verify_production_integration_config.py <path-to-wrangler.toml>
"""
import sys

if sys.version_info < (3, 11):
    print("FAIL: this script requires Python 3.11+ for the standard-library tomllib module.")
    sys.exit(1)

import tomllib  # noqa: E402

DEAL_EXCHANGE_DB_BINDING = "DEAL_EXCHANGE_DB"
PRODUCTION_DB_ID = "f23a881b-80b9-4c2b-ab28-60751091ac25"
FORBIDDEN_DB_IDS = {
    "3f9a36c7-829c-4f9d-8af0-bb5332860f4b": "shared preview Deal Exchange database",
    "2fccc7a7-e943-48bd-a810-687dd6c01b36": "QA Deal Exchange database",
}
QA_WORKER_NAME = "vakaviti-live-deal-exchange-qa"
QA_DB_BINDING = "DEAL_EXCHANGE_QA_DB"
QA_DB_ID = "2fccc7a7-e943-48bd-a810-687dd6c01b36"


def check(doc: dict) -> list[str]:
    failures: list[str] = []
    top_level = {k: v for k, v in doc.items() if k != "env"}

    # [1]/[2] top-level DEAL_EXCHANGE_DB must be the real production id, never preview/QA.
    top_d1 = top_level.get("d1_databases", [])
    entry = next((db for db in top_d1 if db.get("binding") == DEAL_EXCHANGE_DB_BINDING), None)
    if entry is None:
        failures.append(f"[1] No top-level d1_databases entry with binding {DEAL_EXCHANGE_DB_BINDING!r} found.")
    else:
        db_id = entry.get("database_id")
        if db_id in FORBIDDEN_DB_IDS:
            failures.append(f"[2] Top-level {DEAL_EXCHANGE_DB_BINDING} database_id {db_id!r} is the {FORBIDDEN_DB_IDS[db_id]} - forbidden on this branch.")
        elif db_id != PRODUCTION_DB_ID:
            failures.append(f"[3] Top-level {DEAL_EXCHANGE_DB_BINDING} database_id is {db_id!r}, expected the production id {PRODUCTION_DB_ID!r}.")

    # [4] top-level public flag must be exactly the string "false".
    top_vars = top_level.get("vars", {})
    public_flag = top_vars.get("DEAL_EXCHANGE_PUBLIC_ENABLED")
    if public_flag != "false":
        failures.append(f"[4] Top-level DEAL_EXCHANGE_PUBLIC_ENABLED is {public_flag!r}, expected the string 'false' exactly.")

    # [5] top-level must still carry no QA identifiers at all (belt-and-braces alongside the
    # separate, unmodified verify_qa_isolation.py check).
    if any(db.get("binding") == QA_DB_BINDING or db.get("database_id") == QA_DB_ID for db in top_d1):
        failures.append("[5] Top-level d1_databases references the QA binding/database - forbidden.")
    if "QA_TEST_MODE" in top_vars or "QA_AUTH_SECRET" in top_vars:
        failures.append("[6] Top-level [vars] contains a QA-only variable.")

    # [7] [env.qa] must still exist, unchanged in shape, and must never reference the new
    # production database id (guards against an accidental copy/paste aliasing it into QA).
    env_qa = doc.get("env", {}).get("qa")
    if not env_qa:
        failures.append("[7] [env.qa] table is absent - it must remain present and unchanged on this branch.")
    else:
        if env_qa.get("name") != QA_WORKER_NAME:
            failures.append(f"[8] [env.qa] name is {env_qa.get('name')!r}, expected {QA_WORKER_NAME!r}.")
        qa_d1 = env_qa.get("d1_databases", [])
        if any(db.get("database_id") == PRODUCTION_DB_ID for db in qa_d1):
            failures.append(f"[9] [env.qa] d1_databases references the new production database id {PRODUCTION_DB_ID!r} - forbidden.")
        qa_entry = next((db for db in qa_d1 if db.get("binding") == QA_DB_BINDING), None)
        if not qa_entry or qa_entry.get("database_id") != QA_DB_ID:
            failures.append(f"[10] [env.qa] {QA_DB_BINDING} is not correctly bound to {QA_DB_ID!r}.")
        if str(env_qa.get("vars", {}).get("QA_TEST_MODE")).lower() != "true":
            failures.append("[11] [env.qa.vars] QA_TEST_MODE is not 'true'.")

    # [12] no route/custom_domain anywhere at top level - none exists today and none should be
    # added while this feature sits behind a disabled public flag on a pre-merge branch.
    for key in ("routes", "route", "custom_domain", "custom_domains"):
        if key in top_level:
            failures.append(f"[12] Top-level declares {key!r}: {top_level[key]!r} - forbidden on this branch.")

    # [13] the pre-existing "Deal Intelligence" Cron (unrelated to Deal Exchange) must be carried
    # over completely unchanged - this is a real, already-live production schedule, not something
    # this branch should add, remove, or alter.
    EXPECTED_CRON = ["0 */4 * * *"]
    actual_cron = top_level.get("triggers", {}).get("crons")
    if actual_cron != EXPECTED_CRON:
        failures.append(f"[13] Top-level Cron trigger is {actual_cron!r}, expected the pre-existing, unrelated Deal Intelligence schedule {EXPECTED_CRON!r} to be carried over unchanged.")

    return failures


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: verify_production_integration_config.py <path-to-wrangler.toml>")
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
    print(f"OK: {path} carries the corrected production configuration (production DB bound, public flag false, [env.qa] unchanged and isolated).")
    sys.exit(0)


if __name__ == "__main__":
    main()
