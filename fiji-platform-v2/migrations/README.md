# Migrations

Migration files are immutable, forward-only SQL named with contiguous four-digit prefixes (`0001_`, `0002_`, `0003_`, ...). Never edit an applied migration; add the next number.

For local verification, apply every file in lexical order to an empty SQLite database (the test suite does this in memory). A future isolated staging environment will use the same ordered list through Wrangler only after an explicit deployment phase and environment review; Phase 1A performs no Cloudflare command or remote database access.

If a migration fails, stop, retain the error evidence, and do not mark it applied. Correct the cause with a new forward migration when any environment has already applied the faulty file; do not silently rewrite history. Backups and a rehearsed restore procedure are prerequisites for production migration work.
