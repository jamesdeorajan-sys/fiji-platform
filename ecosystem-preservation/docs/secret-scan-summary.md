# Secret / personal-data scan summary

Scan method: regex-based pattern match for API-key shapes (Anthropic, OpenAI, SendGrid, Google,
AWS, JWT, WhatsApp), hardcoded password assignments, email literals, and phone-number literals,
run against all 23 non-empty deployed Worker bundles. Initial loose-pattern findings were then
re-verified with a stricter, word-bounded phone pattern and manual context inspection before any
conclusion was drawn — several initial matches turned out to be false positives from numeric
substrings inside internal ID strings (e.g. `kq_1778957552589_...`), not real phone numbers.

## Verified findings

| Worker | Finding | Sensitivity | Reasoning |
|---|---|---|---|
| fiji-chat-widget | `+61 478 886 145` (×~15), `leads@vakaviti.ai` | Low | Published business WhatsApp number, already public on live `wa.me` links; business inbox address |
| fiji-chat-widget | One line combining `"James"` + the same number in a notification-template array | Low-medium | Looks like a hardcoded test/seed fixture, not a real customer record |
| fijitourtransfers-guides | Same business WhatsApp number (×2) | Low | Same number, same reasoning |
| nadi-dispatch-api | Same business WhatsApp number (×1) | Low | Same number |
| nadi-dispatch-api | `ADMIN_LOGIN_PHONE = "[REDACTED — number withheld from this public branch]"` | **Medium — genuine finding** | An admin-authentication-relevant phone number hardcoded as a source literal instead of a secret binding. Not third-party personal data, but a real credential-hygiene defect independent of git-publication risk. The actual number is intentionally not reproduced in this document or anywhere else in this branch — it was disclosed to James directly outside git. |
| vakaviti-config | Same business WhatsApp number (×1) | Low | Same number |
| vakaviti-dashboard-api | Same business WhatsApp number (×1), `leads@vakaviti.ai` | Low | Same |
| vakaviti-onboard, vakaviti-leads, vakaviti-leads-v2 | `leads@vakaviti.ai` only | Low | Business inbox address |
| vakaviti-zone-manager | `alerts@vakaviti.ai` only | Low | Business inbox address |
| vakaviti-ingest-bl | One garbled/truncated email-shaped string, two loose phone-pattern hits that did not survive strict re-verification | Unresolved | Could not confidently classify from an automated scan; treated conservatively as unresolved rather than clean |
| vakaviti-kb-inspect | A hardcoded list of ~10 `knowledge_queue` row IDs to delete | Not personal data, but a one-off maintenance script left permanently deployed | Should be removed or turned into a proper admin action rather than living in the deployed script |

## Clean on both passes

come-to-fiji-link-checker, come-to-fiji-sync-fjt-trigger, fiji-drafting-console,
seo-visibility-audit, vakaviti-build-dashboard, vakaviti-directory, vakaviti-error-sentinel,
vakaviti-events, vakaviti-leads, vakaviti-leads-v2 (phone-clean; only the business email above),
vakaviti-marketplace-stage1, vakaviti-reviews, vakaviti-reviews-scheduler, vakaviti-whatsapp,
vakaviti-zone-manager (phone-clean; only the business email above).

## Decision

Per the directive: the repository is public, and the scan found genuine embedded values (at
minimum the hardcoded `ADMIN_LOGIN_PHONE` in nadi-dispatch-api, plus several unresolved/business
literals elsewhere). No raw Worker source is committed to this branch, and the flagged
`ADMIN_LOGIN_PHONE` value itself is not reproduced anywhere in this branch's documentation either —
only its existence and classification are recorded above. Full bundles were delivered to James
privately outside git. A future, separately-authorized pass could commit the individually-verified-
clean subset once `vakaviti-ingest-bl`'s ambiguous match is resolved and the business WhatsApp
number is centralized to a binding rather than a literal.
