# Stage 1 Isolation Verification

Purpose: confirm that Cloudflare Pages `path_excludes` for `apps/vakaviti-marketplace-stage1/*`
on `nadi-marketplace-staging` and `vakaviti-lagi-public` correctly stops those unrelated
projects from building on Stage 1-only commits.

This file carries no application behavior. It exists only to be the smallest possible
change under this app's path for that empirical test.

Verification marker: stage1-isolation-check-001
