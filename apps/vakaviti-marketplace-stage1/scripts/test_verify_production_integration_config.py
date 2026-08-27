#!/usr/bin/env python3
"""Regression test matrix for verify_production_integration_config.py (governed activation
guard update, 2026-08-27). Builds temporary wrangler.toml + minimal src/ fixtures per case and
invokes the real script as a subprocess (the same way CI does), so this test exercises the actual
CLI entry point, not just an imported function. Never touches the real repo's wrangler.toml or
source files - every fixture lives under a fresh tempfile.TemporaryDirectory().

Usage: python3 scripts/test_verify_production_integration_config.py
Exits non-zero if any case's actual result does not match its expected PASS/FAIL.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).parent / "verify_production_integration_config.py"

PRODUCTION_DB_ID = "f23a881b-80b9-4c2b-ab28-60751091ac25"
PREVIEW_DB_ID = "3f9a36c7-829c-4f9d-8af0-bb5332860f4b"
QA_DB_ID = "2fccc7a7-e943-48bd-a810-687dd6c01b36"

BASE_ENV_QA = '''
[env.qa]
name = "vakaviti-live-deal-exchange-qa"

[env.qa.vars]
ENVIRONMENT = "qa"
QA_TEST_MODE = "true"
DEAL_EXCHANGE_PUBLIC_ENABLED = "false"

[[env.qa.d1_databases]]
binding = "DEAL_EXCHANGE_QA_DB"
database_name = "vakaviti-live-deal-exchange-qa-db"
database_id = "''' + QA_DB_ID + '''"
'''

# Intact source fixtures - satisfy every activation invariant (item 8) exactly.
INTACT_INDEX_TS = "app.route('/', dealExchangeUi);\n"
INTACT_UI_TS = """
dealExchangeUi.use('*', async (c, next) => {
  if (!c.env.DEAL_EXCHANGE_DB) return c.text('not configured', 503);
  if (c.env.DEAL_EXCHANGE_PUBLIC_ENABLED !== 'true') return c.text('not enabled', 503);
  await next();
});
const shellHead = '<meta name="robots" content="noindex,nofollow">';
const q1 = `SELECT * FROM deal_exchange_offers WHERE publication_decision='ELIGIBLE' ORDER BY checked_at DESC`;
const q2 = `SELECT * FROM deal_exchange_offers WHERE id=?`;
if (!o || o.publication_decision !== 'ELIGIBLE') return c.notFound();
"""


def make_wrangler_toml(db_id=PRODUCTION_DB_ID, db_name="vakaviti-live-deal-exchange-db",
                        flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = "false"',
                        extra_top_vars="", extra_top_d1="", env_qa=BASE_ENV_QA,
                        duplicate_flag=False):
    dup = '\nDEAL_EXCHANGE_PUBLIC_ENABLED = "false"' if duplicate_flag else ""
    return f'''name = "vakaviti-marketplace-stage1"
main = "src/index.ts"
compatibility_date = "2026-08-01"

[[d1_databases]]
binding = "DB"
database_name = "vakaviti-marketplace-stage1-db"
database_id = "f2753057-4319-404d-bcda-84cccd288fe1"

[[d1_databases]]
binding = "DEAL_EXCHANGE_DB"
database_name = "{db_name}"
database_id = "{db_id}"
{extra_top_d1}

[ai]
binding = "AI"

[vars]
ENVIRONMENT = "preview"
{flag_line}{dup}
{extra_top_vars}

[version_metadata]
binding = "CF_VERSION_METADATA"

[triggers]
crons = ["0 */4 * * *"]
{env_qa}
'''


def run_case(tmp: Path, wrangler_content: str, index_ts: str | None = INTACT_INDEX_TS, ui_ts: str | None = INTACT_UI_TS):
    app_dir = tmp / f"case_{id(wrangler_content)}"
    (app_dir / "src").mkdir(parents=True, exist_ok=True)
    wrangler_path = app_dir / "wrangler.toml"
    wrangler_path.write_text(wrangler_content, encoding="utf-8")
    if index_ts is not None:
        (app_dir / "src" / "index.ts").write_text(index_ts, encoding="utf-8")
    if ui_ts is not None:
        (app_dir / "src" / "deal-exchange-ui.ts").write_text(ui_ts, encoding="utf-8")
    result = subprocess.run([sys.executable, str(SCRIPT), str(wrangler_path)], capture_output=True, text=True)
    return result.returncode, result.stdout + result.stderr


def main() -> None:
    failures = []
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        cases = [
            # ---- PASS cases ----
            ("1. PASS: production DB + public=false", make_wrangler_toml(flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = "false"'), True),
            ("2. PASS: production DB + public=true", make_wrangler_toml(flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = "true"'), True),
            ("3. PASS: public=true with intact noindex/eligibility/isolation invariants", make_wrangler_toml(flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = "true"'), True),

            # ---- FAIL cases ----
            ("4. FAIL: preview DB + public=false", make_wrangler_toml(db_id=PREVIEW_DB_ID, db_name="vakaviti-live-deal-exchange-preview-db", flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = "false"'), False),
            ("5. FAIL: preview DB + public=true", make_wrangler_toml(db_id=PREVIEW_DB_ID, db_name="vakaviti-live-deal-exchange-preview-db", flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = "true"'), False),
            ("6. FAIL: QA DB at top level", make_wrangler_toml(db_id=QA_DB_ID, db_name="vakaviti-live-deal-exchange-qa-db"), False),
            ("7. FAIL: production UUID under env.qa", make_wrangler_toml(env_qa=BASE_ENV_QA.replace(QA_DB_ID, PRODUCTION_DB_ID)), False),
            ("8. FAIL: QA binding at top level", make_wrangler_toml(extra_top_d1=f'\n[[d1_databases]]\nbinding = "DEAL_EXCHANGE_QA_DB"\ndatabase_name = "x"\ndatabase_id = "{QA_DB_ID}"'), False),
            ("9. FAIL: QA secret/mode at top level", make_wrangler_toml(extra_top_vars='QA_TEST_MODE = "true"\nQA_AUTH_SECRET = "x"'), False),
            ("10. FAIL: missing public flag", make_wrangler_toml(flag_line=""), False),
            ("11. FAIL: empty public flag", make_wrangler_toml(flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = ""'), False),
            ("12. FAIL: boolean true instead of string \"true\"", make_wrangler_toml(flag_line="DEAL_EXCHANGE_PUBLIC_ENABLED = true"), False),
            ("13. FAIL: uppercase/malformed flag value", make_wrangler_toml(flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = "True"'), False),
            ("14. FAIL: duplicate public-flag declaration", make_wrangler_toml(duplicate_flag=True), False),
        ]

        for name, toml_content, expect_pass in cases:
            rc, output = run_case(tmp, toml_content)
            actual_pass = (rc == 0)
            ok = actual_pass == expect_pass
            status = "PASS" if ok else "TEST FAILED"
            print(f"[{status}] {name} (expected {'PASS' if expect_pass else 'FAIL'}, got {'PASS' if actual_pass else 'FAIL'})")
            if not ok:
                failures.append(name)
                print("  ---", output.strip().replace("\n", "\n  --- "))

        # ---- 15/16/17: public=true with a specific invariant deliberately removed ----
        broken_noindex_ui = INTACT_UI_TS.replace('<meta name="robots" content="noindex,nofollow">', "")
        rc, output = run_case(tmp, make_wrangler_toml(flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = "true"'), ui_ts=broken_noindex_ui)
        ok = rc != 0
        print(f"[{'PASS' if ok else 'TEST FAILED'}] 15. FAIL: public=true with noindex removed (expected FAIL, got {'FAIL' if rc != 0 else 'PASS'})")
        if not ok:
            failures.append("15")
            print("  ---", output.strip())

        broken_eligibility_ui = INTACT_UI_TS.replace(
            "const q2 = `SELECT * FROM deal_exchange_offers WHERE id=?`;\nif (!o || o.publication_decision !== 'ELIGIBLE') return c.notFound();",
            "const q2 = `SELECT * FROM deal_exchange_offers WHERE id=?`;\nreturn q2;",
        )
        rc, output = run_case(tmp, make_wrangler_toml(flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = "true"'), ui_ts=broken_eligibility_ui)
        ok = rc != 0
        print(f"[{'PASS' if ok else 'TEST FAILED'}] 16. FAIL: public=true with eligibility gating removed (expected FAIL, got {'FAIL' if rc != 0 else 'PASS'})")
        if not ok:
            failures.append("16")
            print("  ---", output.strip())

        # QA isolation weakened while public=true: production UUID leaked into env.qa.
        rc, output = run_case(tmp, make_wrangler_toml(flag_line='DEAL_EXCHANGE_PUBLIC_ENABLED = "true"', env_qa=BASE_ENV_QA.replace(QA_DB_ID, PRODUCTION_DB_ID)))
        ok = rc != 0
        print(f"[{'PASS' if ok else 'TEST FAILED'}] 17. FAIL: public=true with QA isolation weakened (expected FAIL, got {'FAIL' if rc != 0 else 'PASS'})")
        if not ok:
            failures.append("17")
            print("  ---", output.strip())

    print()
    if failures:
        print(f"{len(failures)} TEST CASE(S) DID NOT MATCH EXPECTATION: {failures}")
        sys.exit(1)
    print("All 17 test cases matched their expected PASS/FAIL result.")
    sys.exit(0)


if __name__ == "__main__":
    main()
