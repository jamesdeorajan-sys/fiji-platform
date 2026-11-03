// Stand-in for gate15_proof.mjs used ONLY by orchestrator unit tests: fails the stage named in FAKE_FAIL_STAGE, records invocations in FAKE_LOG.
import fs from 'node:fs';
const stage = process.env.GATE15_STAGE, phase = process.env.GATE15_PHASE, fail = process.env.FAKE_FAIL_STAGE === stage || process.env.FAKE_FAIL_PHASE === phase;
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ phase, stage, races: process.env.GATE15_RACES, base: process.env.GATE15_BASE_URL, hasToken: !!process.env.GATE15_CONTROL_TOKEN }) + '\n');
fs.writeFileSync(process.env.GATE15_OUT, JSON.stringify({ checks_failed: fail ? 1 : 0, checks_total: 5, checks: fail ? [{ name: `[checkpoint ${stage}] global invariants`, pass: false }] : [] }));
process.exit(fail ? 1 : 0);
