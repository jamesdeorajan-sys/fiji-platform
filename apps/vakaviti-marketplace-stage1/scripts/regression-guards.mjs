#!/usr/bin/env node
// Vakaviti Stage 1 — static build-accuracy regression guards.
//
// These are deterministic, code-level checks only (missing files, broken references, config
// drift). They deliberately do NOT and CANNOT judge whether a photograph "looks right" for a
// product - that remains a human live-visual-QA gate (see ACCEPTANCE-MATRIX.md /
// DEFINITION-OF-DONE.md). Run with: node scripts/regression-guards.mjs
//
// Exits non-zero (failing CI) if any check fails.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const indexTs = readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8');
const aiTs = readFileSync(path.join(ROOT, 'src/ai.ts'), 'utf8');
const wranglerToml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');

let failures = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => console.log(`  OK  ${msg}`);

console.log('== 1. Image assets referenced in code actually exist on disk ==');
{
  const refs = new Set([...indexTs.matchAll(/\/images\/[a-zA-Z0-9._-]+\.(webp|jpg|png)/g)].map(m => m[0]));
  if (refs.size === 0) fail('No /images/* references found in src/index.ts - unexpected, check the regex/file.');
  for (const ref of refs) {
    const filePath = path.join(ROOT, 'public', ref);
    if (existsSync(filePath)) ok(`${ref} exists`);
    else fail(`Referenced image asset missing from disk: ${ref} (expected at public${ref})`);
  }
}

console.log('== 2. Every semantic key used by PRODUCT_IMAGE_KEY / OPERATOR_IMAGE_KEY exists in SEMANTIC_IMAGES ==');
{
  const semanticBlockMatch = indexTs.match(/const SEMANTIC_IMAGES:[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!semanticBlockMatch) fail('Could not locate SEMANTIC_IMAGES definition in src/index.ts');
  const knownKeys = semanticBlockMatch
    ? new Set([...semanticBlockMatch[1].matchAll(/^\s*([a-zA-Z0-9_]+):\s*\{/gm)].map(m => m[1]))
    : new Set();

  for (const mapName of ['PRODUCT_IMAGE_KEY', 'OPERATOR_IMAGE_KEY']) {
    const blockMatch = indexTs.match(new RegExp(`const ${mapName}:[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
    if (!blockMatch) { fail(`Could not locate ${mapName} definition in src/index.ts`); continue; }
    const usedKeys = [...blockMatch[1].matchAll(/:\s*'([a-zA-Z0-9_]+)'/g)].map(m => m[1]);
    if (usedKeys.length === 0) fail(`${mapName} appears to define no entries - check the regex/file.`);
    for (const key of usedKeys) {
      if (knownKeys.has(key)) ok(`${mapName} -> '${key}' is a valid SEMANTIC_IMAGES key`);
      else fail(`${mapName} references unknown semantic image key '${key}' (not in SEMANTIC_IMAGES)`);
    }
  }
}

console.log('== 3. og:image is always constructed via absoluteImage() on detail routes ==');
{
  const ogImageAssignments = [...indexTs.matchAll(/ogImage:\s*([^,}]+)/g)].map(m => m[1].trim());
  if (ogImageAssignments.length === 0) fail('No explicit ogImage: assignments found - expected at least one on product/operator detail routes.');
  for (const expr of ogImageAssignments) {
    if (expr.startsWith('absoluteImage(')) ok(`ogImage assignment is wrapped in absoluteImage(): ${expr}`);
    else fail(`ogImage assignment is NOT wrapped in absoluteImage(), risking a relative social-share URL: ${expr}`);
  }
}

console.log('== 4. Stage 1 config: preview environment + central enquiry destination configured ==');
{
  if (/ENVIRONMENT\s*=\s*"preview"/.test(wranglerToml)) ok('ENVIRONMENT = "preview" present');
  else fail('wrangler.toml is missing ENVIRONMENT = "preview"');

  if (/MARKETPLACE_ENQUIRY_WHATSAPP\s*=\s*"\+?[0-9]+"/.test(wranglerToml)) ok('MARKETPLACE_ENQUIRY_WHATSAPP is configured with a non-empty value');
  else fail('wrangler.toml is missing a non-empty MARKETPLACE_ENQUIRY_WHATSAPP value');
}

console.log('== 5. No protected production domain/project references in Stage 1 config or code ==');
{
  const denylist = [
    'bookfijitours.com.au', 'tourfiji.tours', 'cometofiji.com',
    'driver.fijidash.com', 'driver.vakaviti.ai', 'book.fijidash.com', 'fijidash.com',
    'nadi-marketplace-staging', 'vakaviti-lagi-public', 'vakaviti-lagi'
  ];
  for (const file of [['wrangler.toml', wranglerToml], ['src/index.ts', indexTs]]) {
    const [name, content] = file;
    const hit = denylist.find(d => content.toLowerCase().includes(d.toLowerCase()));
    if (hit) fail(`${name} contains a reference to protected production domain/project "${hit}"`);
    else ok(`${name} contains no protected production domain/project references`);
  }
}

console.log('== 6. Workers AI model is the pinned, non-deprecated value ==');
{
  const EXPECTED_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
  const match = aiTs.match(/DEFAULT_MODEL\s*=\s*'([^']+)'/);
  if (!match) fail('Could not find DEFAULT_MODEL in src/ai.ts');
  else if (match[1] === EXPECTED_MODEL) ok(`DEFAULT_MODEL is the pinned value (${EXPECTED_MODEL})`);
  else fail(`DEFAULT_MODEL changed to '${match[1]}' (expected '${EXPECTED_MODEL}') - if this is a deliberate upgrade, update EXPECTED_MODEL in this guard too`);
}

console.log('== 7. No duplicate product slugs hard-coded across the image-key maps (structural sanity) ==');
{
  for (const mapName of ['PRODUCT_IMAGE_KEY', 'OPERATOR_IMAGE_KEY']) {
    const blockMatch = indexTs.match(new RegExp(`const ${mapName}:[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
    if (!blockMatch) continue;
    const slugs = [...blockMatch[1].matchAll(/^\s*'([a-z0-9-]+)':/gm)].map(m => m[1]);
    const seen = new Set();
    for (const s of slugs) {
      if (seen.has(s)) fail(`${mapName} has a duplicate key '${s}'`);
      seen.add(s);
    }
    ok(`${mapName} has ${slugs.length} unique slug keys`);
  }
}

console.log('== 8. Public routes enforce the commercial_status publication gate ==');
{
  // Split the file into per-route chunks so each query can be checked against the route it
  // actually belongs to. /claim/:slug is the one deliberate exemption - see
  // EVIDENCE-AND-PROMOTION-GOVERNANCE.md for why (claiming is an onboarding step, not public
  // marketplace discovery).
  const EXEMPT_ROUTES = ["'/claim/:slug'"];
  const routeBlocks = indexTs.split(/(?=app\.(?:get|post)\()/);
  let checked = 0;
  for (const block of routeBlocks) {
    const routeMatch = block.match(/^app\.(?:get|post)\((['"][^'"]+['"])/);
    if (!routeMatch) continue;
    const routePath = routeMatch[1];
    const hasOperatorQuery = /FROM operators/.test(block);
    const hasProductQuery = /FROM products/.test(block);
    if (!hasOperatorQuery && !hasProductQuery) continue;
    if (EXEMPT_ROUTES.includes(routePath)) {
      ok(`${routePath} - exempt from the publication gate (documented)`);
      continue;
    }
    checked++;
    // Every FROM operators / FROM products query line in a non-exempt route must carry the
    // commercial_status='ACTIVE' filter somewhere in that same statement.
    const queryLines = block.split('\n').filter(l => /FROM operators|FROM products/.test(l));
    for (const line of queryLines) {
      if (!/commercial_status\s*=\s*'ACTIVE'/.test(line)) {
        fail(`${routePath} has a FROM operators/products query with no commercial_status='ACTIVE' filter: ${line.trim().slice(0, 140)}...`);
      }
    }
    if (queryLines.every(l => /commercial_status\s*=\s*'ACTIVE'/.test(l))) {
      ok(`${routePath} - all operator/product queries enforce commercial_status='ACTIVE'`);
    }
  }
  if (checked === 0) fail('No public routes with FROM operators/products queries were found to check - the regex may be broken');
}

console.log('\n----------------------------------------');
console.log('NOTE: D1-level checks (orphan products, invalid operator relationships, duplicate');
console.log('slugs IN THE DATABASE, invalid pricing_basis/currency combinations) are NOT run by');
console.log('this script - they require live Cloudflare D1 credentials that CI does not hold.');
console.log('These remain a manual Phase 9 "Data QA" step, documented in DEFINITION-OF-DONE.md.');
console.log('This script also cannot and does not judge photo semantic correctness - that is a');
console.log('mandatory human live-visual-QA gate, never an automated check.');
console.log('----------------------------------------\n');

if (failures.length) {
  console.error(`FAILED: ${failures.length} regression guard(s) did not pass:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log('All static regression guards passed.');
  process.exit(0);
}
