#!/usr/bin/env python3
"""Regression check for the QA secret cleanup step in the CI workflow.

CEO CORRECTION (2026-08-25): proves, from the committed workflow text itself, that:
  - the cleanup step targets exactly QA_AUTH_SECRET on the QA Worker, never any other secret;
  - the unsupported --force flag (confirmed absent from wrangler@4.125.0's real CLI surface -
    see packages/wrangler/src/secret/index.ts) never reappears;
  - the cleanup step and the absence-verification step both remain under if: always();
  - the absence-verification step's own failure is never suppressed (no `|| true`, no
    continue-on-error) - a failed verification must fail the job, not be silently swallowed.

This is a plain-text/regex check scoped to the exact named steps' text, not a full YAML/structural
parse - deliberately narrow so it cannot produce the same class of false positive that a
whole-file text search produced against wrangler.toml's own explanatory comments (that defect is
exactly why scripts/verify_qa_isolation.py exists as a real TOML parse instead of grep).
"""
import re
import sys


def _step_block(text: str, step_name: str) -> str | None:
    pattern = re.escape(f"- name: {step_name}") + r".*?\n(.*?)(?=\n      - name:|\Z)"
    m = re.search(pattern, text, re.DOTALL)
    return m.group(0) if m else None


def _strip_comments(block: str) -> str:
    """Drop full-line YAML/shell comments before scanning for actual command content - a comment
    EXPLAINING that --force was removed, or naming another secret only as an example, must never
    be mistaken for the real command text. This is exactly the class of bug that motivated
    scripts/verify_qa_isolation.py's move to a real TOML parse instead of grep for wrangler.toml -
    applied here too, since this checker is intentionally staying a lightweight text scan rather
    than a full YAML parse (a step's `run: |` block content itself isn't otherwise addressable in
    plain text without a real YAML block-scalar parser)."""
    return "\n".join(line for line in block.splitlines() if not line.strip().startswith("#"))


def check(workflow_text: str) -> list[str]:
    failures: list[str] = []

    delete_block_raw = _step_block(workflow_text, "Rotate the ephemeral QA auth secret out (leave nothing live after this run)")
    if not delete_block_raw:
        failures.append("Could not find the QA secret cleanup ('Rotate the ephemeral QA auth secret out') step at all.")
    else:
        # if: always() is itself a directive, not command content - checked against the raw block
        # (comments never contain a real `if:` key), everything else against the comment-stripped
        # version so an explanatory comment can never be mistaken for real command text.
        if "if: always()" not in delete_block_raw:
            failures.append("The cleanup step is missing if: always().")
        delete_block = _strip_comments(delete_block_raw)
        if "--force" in delete_block:
            failures.append("The cleanup step still references the unsupported --force flag.")
        if "wrangler secret delete QA_AUTH_SECRET --env qa" not in delete_block:
            failures.append("The cleanup step does not call the exact expected command: wrangler secret delete QA_AUTH_SECRET --env qa")
        other_secret_targets = [name for name in re.findall(r"secret delete (\S+)", delete_block) if name != "QA_AUTH_SECRET"]
        if other_secret_targets:
            failures.append(f"The cleanup step targets a secret other than QA_AUTH_SECRET: {other_secret_targets}")

    verify_block_raw = _step_block(workflow_text, "Verify the QA auth secret is actually absent after deletion")
    if not verify_block_raw:
        failures.append("Could not find the 'Verify the QA auth secret is actually absent after deletion' step at all.")
    else:
        if "if: always()" not in verify_block_raw:
            failures.append("The absence-verification step is missing if: always() - it must still run and still be able to fail the job.")
        verify_block = _strip_comments(verify_block_raw)
        if re.search(r"\|\|\s*true\b", verify_block) or "continue-on-error" in verify_block:
            failures.append("The absence-verification step appears to suppress its own failure (|| true or continue-on-error found) - a failed verification must fail the job.")

    playwright_block_raw = _step_block(workflow_text, "Run the complete Playwright suite (mobile/accessibility, SEO, and the 7 deferred QA tests)")
    if not playwright_block_raw:
        failures.append("Could not find the Playwright suite step at all.")
    else:
        playwright_block = _strip_comments(playwright_block_raw)
        if re.search(r"^\s*GITHUB_SHA\s*:", playwright_block, re.MULTILINE):
            failures.append("The Playwright step still overrides the reserved GITHUB_SHA variable - use EXPECTED_GIT_COMMIT_SHA instead.")
        if "EXPECTED_GIT_COMMIT_SHA:" not in playwright_block:
            failures.append("The Playwright step does not set EXPECTED_GIT_COMMIT_SHA.")

    return failures


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: verify_qa_cleanup_workflow.py <path-to-workflow.yml>")
        sys.exit(2)
    with open(sys.argv[1], encoding="utf-8") as f:
        text = f.read()
    failures = check(text)
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        print(f"\n{len(failures)} violation(s) found in {sys.argv[1]}.")
        sys.exit(1)
    print(f"OK: {sys.argv[1]} - QA secret cleanup and build-identity steps are correctly scoped and use only supported syntax.")
    sys.exit(0)


if __name__ == "__main__":
    main()
