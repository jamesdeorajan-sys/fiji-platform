#!/usr/bin/env python3
"""Structural proof that production wrangler.toml carries safe Deal Exchange configuration -
covering BOTH the disabled ("false") and the deliberately, governance-authorized enabled ("true")
states of DEAL_EXCHANGE_PUBLIC_ENABLED. Distinct from, and in addition to, verify_qa_isolation.py
(unchanged, still proves the ordinary top-level config cannot reach QA resources) - this script
proves the properties that matter specifically to production: which database is actually bound,
that no preview/QA identifier ever appears at the top level or leaks into [env.qa], and - only
when the flag is "true" - that the application-code safety invariants a live activation depends on
(the fail-closed gate, noindex, and ELIGIBLE-only publication) are still structurally present.

CEO AUTHORIZATION (2026-08-27): earlier revisions of this script hard-required the public flag to
be exactly "false", because at the time no controlled activation had been authorized and the only
safe state was disabled. That was correct for that moment but is now a stale assumption - a
deliberate, governed activation is a legitimate configuration this script must permit, not an
error. This revision accepts EITHER "false" or "true" and applies the SAME database/QA/route/Cron
isolation checks to both - flipping the flag does not, and must never, relax any of them. There is
no second "I am authorized" flag for this script to check: git history, commit messages, and the
production branch's own review process are the authorization record: this script's only job is
configuration safety and isolation, never who approved what.

Uses Python 3's standard-library tomllib - real TOML structure, comments are never seen because
tomllib strips them during parsing, not via text matching, so this cannot repeat the earlier
comment-false-positive class of bug.

Usage: python3 verify_production_integration_config.py <path-to-wrangler.toml>
Source-level checks (item 8, only when the flag is "true") read src/index.ts and
src/deal-exchange-ui.ts relative to wrangler.toml's own directory - no separate argument needed,
since both files always live at fixed, known paths in this app.
"""
import sys
from pathlib import Path

if sys.version_info < (3, 11):
    print("FAIL: this script requires Python 3.11+ for the standard-library tomllib module.")
    sys.exit(1)

import tomllib  # noqa: E402

DEAL_EXCHANGE_DB_BINDING = "DEAL_EXCHANGE_DB"
PRODUCTION_DB_NAME = "vakaviti-live-deal-exchange-db"
PRODUCTION_DB_ID = "f23a881b-80b9-4c2b-ab28-60751091ac25"
FORBIDDEN_DB_IDS = {
    "3f9a36c7-829c-4f9d-8af0-bb5332860f4b": "shared preview Deal Exchange database",
    "2fccc7a7-e943-48bd-a810-687dd6c01b36": "QA Deal Exchange database",
}
QA_WORKER_NAME = "vakaviti-live-deal-exchange-qa"
QA_DB_BINDING = "DEAL_EXCHANGE_QA_DB"
QA_DB_ID = "2fccc7a7-e943-48bd-a810-687dd6c01b36"
ALLOWED_PUBLIC_FLAG_VALUES = ("false", "true")


def check_config(doc: dict) -> list[str]:
    """Checks that apply identically regardless of whether the public flag is false or true."""
    failures: list[str] = []
    top_level = {k: v for k, v in doc.items() if k != "env"}

    # [1]/[2]/[3] top-level DEAL_EXCHANGE_DB must be exactly the real production binding, never
    # preview/QA, and never merely "close" (name and id both checked, not id alone).
    top_d1 = top_level.get("d1_databases", [])
    entry = next((db for db in top_d1 if db.get("binding") == DEAL_EXCHANGE_DB_BINDING), None)
    if entry is None:
        failures.append(f"[1] No top-level d1_databases entry with binding {DEAL_EXCHANGE_DB_BINDING!r} found.")
    else:
        db_id = entry.get("database_id")
        db_name = entry.get("database_name")
        if db_id in FORBIDDEN_DB_IDS:
            failures.append(f"[2] Top-level {DEAL_EXCHANGE_DB_BINDING} database_id {db_id!r} is the {FORBIDDEN_DB_IDS[db_id]} - forbidden.")
        elif db_id != PRODUCTION_DB_ID:
            failures.append(f"[3] Top-level {DEAL_EXCHANGE_DB_BINDING} database_id is {db_id!r}, expected the production id {PRODUCTION_DB_ID!r}.")
        if db_name != PRODUCTION_DB_NAME:
            failures.append(f"[3b] Top-level {DEAL_EXCHANGE_DB_BINDING} database_name is {db_name!r}, expected {PRODUCTION_DB_NAME!r}.")

    # [4] the public flag must be present, a string, and exactly "false" or "true" - nothing else.
    # This deliberately rejects: missing (None), empty (""), non-string (bool/int - a bare `true`/
    # `false` TOML literal parses as a Python bool, not a string), case variants ("True", "TRUE",
    # "False"), and any value that isn't one of the two allowed strings.
    top_vars = top_level.get("vars", {})
    public_flag = top_vars.get("DEAL_EXCHANGE_PUBLIC_ENABLED")
    if not isinstance(public_flag, str) or public_flag not in ALLOWED_PUBLIC_FLAG_VALUES:
        failures.append(f"[4] Top-level DEAL_EXCHANGE_PUBLIC_ENABLED is {public_flag!r} ({type(public_flag).__name__}), expected exactly the string 'false' or the string 'true'.")
        public_flag = None  # do not attempt flag-dependent checks below on a value we can't trust

    # [5]/[6] top-level must carry no QA identifiers at all, regardless of the flag - belt-and-
    # braces alongside the separate, unmodified verify_qa_isolation.py check.
    if any(db.get("binding") == QA_DB_BINDING or db.get("database_id") == QA_DB_ID for db in top_d1):
        failures.append("[5] Top-level d1_databases references the QA binding/database - forbidden.")
    if "QA_TEST_MODE" in top_vars or "QA_AUTH_SECRET" in top_vars:
        failures.append("[6] Top-level [vars] contains a QA-only variable.")
    if top_level.get("name") == QA_WORKER_NAME:
        failures.append(f"[6b] Top-level Worker name equals the dedicated QA Worker name ({QA_WORKER_NAME!r}) - forbidden.")

    # [7]-[11] [env.qa] must still exist, unchanged in shape, and must never reference the
    # production database id - checked identically regardless of the public flag's value.
    env_qa = doc.get("env", {}).get("qa")
    if not env_qa:
        failures.append("[7] [env.qa] table is absent - it must remain present and unchanged.")
    else:
        if env_qa.get("name") != QA_WORKER_NAME:
            failures.append(f"[8] [env.qa] name is {env_qa.get('name')!r}, expected {QA_WORKER_NAME!r}.")
        qa_d1 = env_qa.get("d1_databases", [])
        if any(db.get("database_id") == PRODUCTION_DB_ID for db in qa_d1):
            failures.append(f"[9] [env.qa] d1_databases references the production database id {PRODUCTION_DB_ID!r} - forbidden.")
        qa_entry = next((db for db in qa_d1 if db.get("binding") == QA_DB_BINDING), None)
        if not qa_entry or qa_entry.get("database_id") != QA_DB_ID:
            failures.append(f"[10] [env.qa] {QA_DB_BINDING} is not correctly bound to {QA_DB_ID!r}.")
        if str(env_qa.get("vars", {}).get("QA_TEST_MODE")).lower() != "true":
            failures.append("[11] [env.qa.vars] QA_TEST_MODE is not 'true'.")

    # [12] no route/custom_domain anywhere at top level, regardless of the flag - activating the
    # public flag is a governed, noindex, non-promoted preview; it is never itself authorization
    # for a route, custom domain, or DNS change, which remain entirely separate decisions.
    for key in ("routes", "route", "custom_domain", "custom_domains"):
        if key in top_level:
            failures.append(f"[12] Top-level declares {key!r}: {top_level[key]!r} - forbidden.")

    # [13] the pre-existing "Deal Intelligence" Cron (unrelated to Deal Exchange) must be carried
    # over completely unchanged, regardless of the flag.
    EXPECTED_CRON = ["0 */4 * * *"]
    actual_cron = top_level.get("triggers", {}).get("crons")
    if actual_cron != EXPECTED_CRON:
        failures.append(f"[13] Top-level Cron trigger is {actual_cron!r}, expected the pre-existing, unrelated Deal Intelligence schedule {EXPECTED_CRON!r} to be carried over unchanged.")

    return failures, public_flag


def check_activation_invariants(app_dir: Path) -> list[str]:
    """Item 8: when the public flag is "true", additionally require structural proof (from the
    application source, not just wrangler.toml) that the safety invariants a live activation
    depends on are still present. Every check here is a plain substring/pattern match against
    committed source text - deliberately simple and auditable, matching the same philosophy as
    the rest of this file: real structure, not a guess about runtime behavior."""
    failures: list[str] = []

    index_ts_path = app_dir / "src" / "index.ts"
    ui_ts_path = app_dir / "src" / "deal-exchange-ui.ts"

    if not index_ts_path.is_file():
        return [f"[14] src/index.ts not found at {index_ts_path} - cannot verify activation invariants."]
    if not ui_ts_path.is_file():
        return [f"[14] src/deal-exchange-ui.ts not found at {ui_ts_path} - cannot verify activation invariants."]

    index_ts = index_ts_path.read_text(encoding="utf-8")
    ui_ts = ui_ts_path.read_text(encoding="utf-8")

    # [14] the Deal Exchange mount and its fail-closed gate must both still exist. The mount alone
    # is not enough - a mount without the gate would make every route unconditionally public.
    if "app.route('/', dealExchangeUi)" not in index_ts:
        failures.append("[14] src/index.ts no longer mounts the Deal Exchange router at '/' - the feature gate this check depends on would not even run.")
    if "dealExchangeUi.use('*'" not in ui_ts:
        failures.append("[14b] src/deal-exchange-ui.ts no longer registers the wildcard fail-closed gate (dealExchangeUi.use('*', ...)) - a bound production database with no gate would make every route unconditionally public regardless of this flag.")
    if "DEAL_EXCHANGE_PUBLIC_ENABLED" not in ui_ts:
        failures.append("[14c] src/deal-exchange-ui.ts's gate no longer references DEAL_EXCHANGE_PUBLIC_ENABLED - the flag this script is validating would have no effect on the deployed app at all.")

    # [15] every Deal Exchange HTML page must still carry noindex. This app renders every page
    # through one shared shell() template, so one correctly-placed noindex covers all of them -
    # checked here as a real, non-optional part of what "true" is allowed to mean.
    if 'name="robots" content="noindex' not in ui_ts:
        failures.append("[15] src/deal-exchange-ui.ts's page shell no longer sets a noindex robots meta tag - activating the flag must never also make these pages indexable.")

    # [16] private/incomplete/rejected records must remain excluded. Every offer-fetching query
    # must enforce ELIGIBLE-only either in the SQL itself (the common case: a filtered listing
    # query) OR, for a single-row lookup-by-id query, in the very next line of application code
    # (the pattern deal-exchange-ui.ts uses for /live-deals/:id: fetch by id alone, then
    # `if (!o || o.publication_decision !== 'ELIGIBLE') return c.notFound();` before anything is
    # ever rendered) - both are equally safe; checking for the SQL filter alone would be a false
    # positive against this second, equally valid pattern.
    eligible_sql_filter = "publication_decision='ELIGIBLE'"
    eligible_js_pattern_a = "publication_decision !== 'ELIGIBLE'"
    eligible_js_pattern_b = "publication_decision === 'ELIGIBLE'"
    lines = ui_ts.splitlines()
    offer_query_indices = [i for i, line in enumerate(lines) if "FROM deal_exchange_offers" in line]
    if not offer_query_indices:
        failures.append("[16] No query against deal_exchange_offers found at all - cannot confirm eligibility gating.")
    else:
        unguarded = []
        for i in offer_query_indices:
            window = "\n".join(lines[i:i + 3])
            if eligible_sql_filter not in window and eligible_js_pattern_a not in window and eligible_js_pattern_b not in window:
                unguarded.append(lines[i].strip())
        if unguarded:
            failures.append(f"[16] {len(unguarded)} quer(y/ies) against deal_exchange_offers are not guarded by ELIGIBLE-only, in SQL or in the immediately following application code - a private/incomplete/rejected record could be exposed: {unguarded[:2]!r}")

    return failures


def check(doc: dict, app_dir: Path | None) -> list[str]:
    failures, public_flag = check_config(doc)
    if public_flag == "true" and app_dir is not None:
        failures += check_activation_invariants(app_dir)
    return failures


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: verify_production_integration_config.py <path-to-wrangler.toml>")
        sys.exit(2)
    path = Path(sys.argv[1])
    try:
        with open(path, "rb") as f:
            doc = tomllib.load(f)
    except tomllib.TOMLDecodeError as e:
        # Covers genuinely duplicate/ambiguous keys in the same table, which TOML itself forbids -
        # surfaced here as a clean FAIL rather than an unhandled traceback.
        print(f"FAIL: [0] {path} is not valid TOML - {e}")
        sys.exit(1)
    failures = check(doc, path.parent)
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        print(f"\n{len(failures)} structural violation(s) found in {path}.")
        sys.exit(1)
    flag = doc.get("vars", {}).get("DEAL_EXCHANGE_PUBLIC_ENABLED")
    print(f"OK: {path} carries safe Deal Exchange configuration (production DB bound, public flag {flag!r}, [env.qa] isolated" + (", activation invariants intact" if flag == "true" else "") + ").")
    sys.exit(0)


if __name__ == "__main__":
    main()
