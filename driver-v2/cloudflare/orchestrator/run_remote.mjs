// THE remote entry point (NOT RUN in this package build). Builds the real Cloudflare client + driver and executes the staged state machine.
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { runStagedProof } from './orchestrator.mjs'; import { makeCloudflareClient, makeCloudflareDriver, realExec } from './cloudflare_driver.mjs';
const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = process.env;
if (!accountId || !apiToken) { console.error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required'); process.exit(2); }
const outDir = path.join(PKG, '..', 'evidence', 'gate15', `remote-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const cf = makeCloudflareClient({ accountId, apiToken }); const driver = makeCloudflareDriver({ cf, exec: realExec(PKG, process.env.WRANGLER_BIN || 'wrangler'), packageRoot: PKG, evidenceDir: outDir });
const v = await runStagedProof(driver, { outDir, env: process.env, log: (m) => console.log(m) });
console.log(JSON.stringify({ verdict: v.verdict, reason: v.reason, evidence: outDir })); process.exit(v.verdict === 'PASS' ? 0 : 1);
