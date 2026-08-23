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
const productsTs = readFileSync(path.join(ROOT, 'src/products.ts'), 'utf8');
const candidatesTs = readFileSync(path.join(ROOT, 'src/candidates.ts'), 'utf8');
const placesTs = readFileSync(path.join(ROOT, 'src/places.ts'), 'utf8');
const taxonomyMigrationSql = readFileSync(path.join(ROOT, 'migrations/0007_place_taxonomy.sql'), 'utf8');
const dealAgentTs = readFileSync(path.join(ROOT, 'src/deal-agent.ts'), 'utf8');
const dealsTs = readFileSync(path.join(ROOT, 'src/deals.ts'), 'utf8');
const dealsAdminUiTs = readFileSync(path.join(ROOT, 'src/deals-admin-ui.ts'), 'utf8');
const dealsHubTs = readFileSync(path.join(ROOT, 'src/deals-hub.ts'), 'utf8');
const dealQualityTs = readFileSync(path.join(ROOT, 'src/deal-quality.ts'), 'utf8');
const providerOnboardingTs = readFileSync(path.join(ROOT, 'src/provider-onboarding.ts'), 'utf8');
const supplyDashboardTs = readFileSync(path.join(ROOT, 'src/supply-dashboard.ts'), 'utf8');
const providerOnboardingUiTs = readFileSync(path.join(ROOT, 'src/provider-onboarding-ui.ts'), 'utf8');
const directoryGateTs = readFileSync(path.join(ROOT, 'src/directory-gate.ts'), 'utf8');
const batchReviewUiTs = readFileSync(path.join(ROOT, 'src/batch-review-ui.ts'), 'utf8');
const migration0014Sql = readFileSync(path.join(ROOT, 'migrations/0014_ai_supply_discovery.sql'), 'utf8');
const discoveryBridgeTs = readFileSync(path.join(ROOT, 'src/discovery-bridge.ts'), 'utf8');
const supplySprintUiTs = readFileSync(path.join(ROOT, 'src/supply-sprint-ui.ts'), 'utf8');
const supplySchedulerTs = readFileSync(path.join(ROOT, 'src/supply-scheduler.ts'), 'utf8');
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

  // Any AI-calling module must import the shared constant rather than hardcoding its own model
  // string - this is exactly the bug class that motivated DEFAULT_MODEL existing in the first
  // place (see STAGE1-RECOVERY.md). A hardcoded '@cf/...' literal outside src/ai.ts is a
  // duplicate-truth risk even if it happens to match today.
  if (!/from ['"]\.\/ai['"]/.test(productsTs) || !/DEFAULT_MODEL/.test(productsTs)) {
    fail('src/products.ts does not import DEFAULT_MODEL from ./ai - it may be hardcoding its own model string');
  } else {
    ok('src/products.ts imports the shared DEFAULT_MODEL rather than hardcoding a model string');
  }
  const hardcodedInProducts = productsTs.match(/AI\.run\(\s*'(@cf\/[^']+)'/);
  if (hardcodedInProducts) fail(`src/products.ts hardcodes a model string directly in an AI.run() call: '${hardcodedInProducts[1]}' - should use DEFAULT_MODEL`);
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
  // actually belongs to. /claim/:slug is a deliberate named exemption - see
  // EVIDENCE-AND-PROMOTION-GOVERNANCE.md for why (claiming is an onboarding step, not public
  // marketplace discovery). Every /api/admin/* route is also exempt as a class: these are
  // authenticated internal governance mechanisms (candidate review, promotion, verification
  // decisions) that must be able to look up an operator/product regardless of its publication
  // state - Pilot 3's own instruction was explicit that "the publication gate applies to PUBLIC
  // marketplace discovery, not internal governance records."
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
    const isAdminRoute = /^'\/api\/admin\//.test(routePath);
    if (EXEMPT_ROUTES.includes(routePath) || isAdminRoute) {
      ok(`${routePath} - exempt from the publication gate (${isAdminRoute ? 'admin/internal route' : 'documented exemption'})`);
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

console.log('== 9. Verification and publication remain independent - dangerous write patterns ==');
{
  // AI must never write VAKAVITI_VERIFIED. src/products.ts only ever writes to
  // product_candidates (never operators/products), and src/ai.ts never touches D1 verification
  // columns at all - either file containing this literal would mean an AI-callable path can
  // verify something.
  for (const [name, content] of [['src/products.ts', productsTs], ['src/ai.ts', aiTs]]) {
    if (/VAKAVITI_VERIFIED/.test(content)) {
      fail(`${name} references 'VAKAVITI_VERIFIED' - AI-adjacent code must never write this value`);
    } else {
      ok(`${name} contains no reference to VAKAVITI_VERIFIED`);
    }
  }

  // Promotion (candidate -> operator, and candidate -> product) must always force NOT_VERIFIED,
  // never VAKAVITI_VERIFIED, at the exact INSERT that creates the row.
  const promoteBlocks = [...candidatesTs.matchAll(/\.post\(['"][^'"]*promote[^'"]*['"][\s\S]*?\n\}\);/g)]
    .concat([...productsTs.matchAll(/\.post\(['"][^'"]*promote[^'"]*['"][\s\S]*?\n\}\);/g)]);
  if (promoteBlocks.length === 0) {
    fail('No /promote route handlers found in candidates.ts/products.ts - the regex may be broken');
  }
  for (const m of promoteBlocks) {
    const block = m[0];
    if (/VAKAVITI_VERIFIED/.test(block)) fail('A /promote handler references VAKAVITI_VERIFIED - promotion must always force NOT_VERIFIED');
    if (!/NOT_VERIFIED/.test(block)) fail('A /promote handler does not force NOT_VERIFIED anywhere in its INSERT');
  }
  if (promoteBlocks.length > 0 && promoteBlocks.every(m => /NOT_VERIFIED/.test(m[0]) && !/VAKAVITI_VERIFIED/.test(m[0]))) {
    ok(`${promoteBlocks.length} /promote handler(s) force NOT_VERIFIED and never reference VAKAVITI_VERIFIED`);
  }

  // The verification-decision endpoint itself must never touch commercial_status - verification
  // and publication must vary independently in both directions.
  const verifyMatch = indexTs.match(/app\.post\(['"][^'"]*verification[^'"]*['"][\s\S]*?\n\}\);/);
  if (!verifyMatch) {
    fail('No .../verification POST route handler found in src/index.ts - the regex may be broken');
  } else {
    const block = verifyMatch[0];
    const updateStatements = [...block.matchAll(/UPDATE operators SET[^`]*`/g)].map(m => m[0]);
    const touchesCommercialStatus = updateStatements.some(s => /commercial_status\s*=/.test(s));
    if (touchesCommercialStatus) fail('The verification-decision endpoint\'s UPDATE statement references commercial_status - verification must never change publication state');
    else ok('The verification-decision endpoint never writes commercial_status');
  }

  // Symmetric check: the publication gate itself (the commercial_status='ACTIVE' filters checked
  // in section 8) must never appear alongside a verification_status write in the same statement -
  // publication reads must stay reads, never silently promote something to verified.
  const setVerificationOutsideEndpoint = [...indexTs.matchAll(/UPDATE (?:operators|products) SET[^`]*verification_status\s*=\s*'VAKAVITI_VERIFIED'[^`]*`/g)];
  const insideVerificationEndpoint = verifyMatch ? verifyMatch[0] : '';
  const stray = setVerificationOutsideEndpoint.filter(m => !insideVerificationEndpoint.includes(m[0]));
  if (stray.length > 0) fail(`Found ${stray.length} UPDATE statement(s) outside the verification endpoint that set verification_status='VAKAVITI_VERIFIED'`);
  else ok('No UPDATE statement outside the verification-decision endpoint sets VAKAVITI_VERIFIED');
}

console.log('== 10. Place Authority: admin-only, append-only, never mutates canonical identity (Pilot 6B) ==');
{
  // (a) + (h): no public (non-admin) route may query places / place_evidence / place_aliases /
  // place_external_mappings. Same route-splitting approach as check 8.
  const routeBlocks = indexTs.split(/(?=app\.(?:get|post)\()/);
  const placeTables = ['FROM places', 'FROM place_evidence', 'FROM place_aliases', 'FROM place_external_mappings'];
  let publicLeak = false;
  for (const block of routeBlocks) {
    const routeMatch = block.match(/^app\.(?:get|post)\((['"][^'"]+['"])/);
    if (!routeMatch) continue;
    const routePath = routeMatch[1];
    const isAdminRoute = /^'\/api\/admin\//.test(routePath);
    if (isAdminRoute) continue;
    for (const t of placeTables) {
      if (block.includes(t)) { fail(`Public route ${routePath} appears to query ${t} - Place Authority must stay admin-only`); publicLeak = true; }
    }
  }
  if (!publicLeak) ok('No public (non-admin) route in src/index.ts queries places/place_evidence/place_aliases/place_external_mappings');

  // (b) + (c) + (e): no code path anywhere may UPDATE or DELETE the places table, or mutate a
  // plc_* id - the base canonical record has no write endpoint at all in this pilot.
  for (const [name, content] of [['src/places.ts', placesTs], ['src/index.ts', indexTs]]) {
    if (/UPDATE\s+places\b/.test(content)) fail(`${name} contains an UPDATE against the places table - the canonical record must remain immutable via application code`);
    else ok(`${name} contains no UPDATE against the places table`);
    if (/DELETE\s+FROM\s+places\b/i.test(content)) fail(`${name} contains a DELETE FROM places - Place records must never be deletable via application code`);
    else ok(`${name} contains no DELETE FROM places`);
  }

  // (d): aliases must never auto-promote to a canonical place - no INSERT INTO places anywhere.
  if (/INSERT\s+INTO\s+places\b/.test(placesTs)) fail('src/places.ts contains an INSERT INTO places - no code path may mint a new canonical Place record in this pilot');
  else ok('src/places.ts contains no INSERT INTO places (no code path can create a canonical Place)');

  // (f): AI may propose evidence but must never verify it, and no AI-adjacent file may reference
  // place_evidence/place_aliases/place_external_mappings at all yet (no AI wiring exists this pilot).
  for (const [name, content] of [['src/ai.ts', aiTs], ['src/products.ts', productsTs]]) {
    if (/place_evidence|place_aliases|place_external_mappings/.test(content)) {
      fail(`${name} references Place Authority tables - no AI code path is authorized to touch them yet`);
    } else {
      ok(`${name} contains no reference to Place Authority fact-level tables`);
    }
  }
  // The evidence insert endpoint itself must never hardcode evidence_status='VERIFIED' - only a
  // future explicit human decision endpoint may ever set that value, and none exists yet.
  const evidenceInsertMatch = placesTs.match(/INSERT INTO place_evidence[\s\S]*?\.run\(\);/);
  if (evidenceInsertMatch && /evidence_status/.test(evidenceInsertMatch[0])) {
    fail('The place_evidence INSERT statement explicitly sets evidence_status - it must always fall back to the UNVERIFIED default');
  } else {
    ok('The place_evidence INSERT statement never sets evidence_status explicitly (always defaults to UNVERIFIED)');
  }

  // (g): every Place Authority write route must sit behind the router-level requireAdmin
  // middleware - confirmed structurally by requiring the `places.use('*', requireAdmin)` line to
  // appear before any places.post( definition in the file.
  const middlewareIdx = placesTs.indexOf(`places.use('*', requireAdmin)`);
  const postIndices = [...placesTs.matchAll(/places\.post\(/g)].map(m => m.index);
  if (middlewareIdx === -1) fail('src/places.ts is missing the router-level requireAdmin middleware registration');
  else if (postIndices.some(i => i < middlewareIdx)) fail('A places.post( write route is defined before the requireAdmin middleware is registered - it would be unguarded');
  else ok(`All ${postIndices.length} Place Authority write route(s) are registered after requireAdmin middleware`);
}

console.log('== 11. Place Type taxonomy: additive only, no rebuild, no write path (Pilot 6D-A) ==');
{
  // The taxonomy migration must never rebuild, drop, or redefine the existing `places` table -
  // it may only ADD a new column and CREATE new tables/indexes.
  if (/DROP\s+TABLE\s+places\b/i.test(taxonomyMigrationSql)) fail('0007_place_taxonomy.sql contains DROP TABLE places - a rebuild occurred, which was never authorized');
  else ok('0007_place_taxonomy.sql contains no DROP TABLE places');

  if (/CREATE\s+TABLE\s+places\b/i.test(taxonomyMigrationSql)) fail('0007_place_taxonomy.sql contains CREATE TABLE places - a rebuild occurred, which was never authorized');
  else ok('0007_place_taxonomy.sql contains no CREATE TABLE places (no rebuild)');

  // The only ALTER on `places` may add place_type_code - it must never touch the legacy
  // place_type column or its CHECK constraint.
  const alterMatches = [...taxonomyMigrationSql.matchAll(/ALTER TABLE places[^;]*;/gi)];
  if (alterMatches.length !== 1) fail(`0007_place_taxonomy.sql has ${alterMatches.length} ALTER TABLE places statement(s) - expected exactly 1`);
  else {
    const stmt = alterMatches[0][0];
    if (!/ADD COLUMN place_type_code/.test(stmt)) fail('The ALTER TABLE places statement does not add place_type_code as expected');
    else if (/\bplace_type\b(?!_code)/.test(stmt.replace('place_type_code', ''))) fail('The ALTER TABLE places statement appears to reference the legacy place_type column - it must only add place_type_code');
    else ok('0007_place_taxonomy.sql\'s single ALTER TABLE places statement only adds place_type_code, never touches legacy place_type');
  }

  // No write path may exist anywhere for place_type_code, place_types, or place_change_events -
  // taxonomy is exposed read-only; backfill/correction happen outside application code.
  for (const pattern of [/UPDATE\s+places\s+SET[^;]*place_type_code/i, /INSERT\s+INTO\s+place_types/i, /INSERT\s+INTO\s+place_change_events/i]) {
    if (pattern.test(placesTs) || pattern.test(indexTs)) {
      fail(`Application code contains a write path matching ${pattern} - Place Type taxonomy must remain read-only via the API`);
    }
  }
  if (![/UPDATE\s+places\s+SET[^;]*place_type_code/i, /INSERT\s+INTO\s+place_types/i, /INSERT\s+INTO\s+place_change_events/i].some(p => p.test(placesTs) || p.test(indexTs))) {
    ok('No write path exists anywhere in application code for place_type_code, place_types, or place_change_events');
  }

  // GET /types and GET /:id/change-events must both be registered after the requireAdmin
  // middleware, same as every other route on this router.
  const middlewareIdx = placesTs.indexOf(`places.use('*', requireAdmin)`);
  for (const routePath of [`places.get('/types'`, `places.get('/:id/change-events'`]) {
    const idx = placesTs.indexOf(routePath);
    if (idx === -1) fail(`Expected read-only taxonomy route not found: ${routePath}`);
    else if (idx < middlewareIdx) fail(`${routePath} is registered before requireAdmin middleware - it would be unguarded`);
    else ok(`${routePath} is registered after requireAdmin middleware`);
  }
}

console.log('== 12. Verification grants require qualifying non-CEO, non-AI evidence (P1 remediation) ==');
{
  // The disqualification function must exist and must reject exactly CEO_AUTHORIZATION plus any
  // AI-pattern source_type - not an arbitrary/incomplete rule.
  const fnMatch = indexTs.match(/const isDisqualifiedEvidenceSourceType[\s\S]*?\n\};/);
  if (!fnMatch) {
    fail('isDisqualifiedEvidenceSourceType function not found in src/index.ts');
  } else {
    const fn = fnMatch[0];
    if (!/CEO_AUTHORIZATION/.test(fn)) fail('isDisqualifiedEvidenceSourceType does not disqualify CEO_AUTHORIZATION');
    else ok('isDisqualifiedEvidenceSourceType disqualifies CEO_AUTHORIZATION');
    if (!/AI/.test(fn)) fail('isDisqualifiedEvidenceSourceType does not disqualify any AI-derived pattern');
    else ok('isDisqualifiedEvidenceSourceType disqualifies AI-derived source types');
  }

  // The qualifying-evidence check must be gated to grants only (targetState === 'VAKAVITI_VERIFIED')
  // - revocation must never require it - and must run before the UPDATE operators statement, so a
  // rejected grant writes nothing.
  const verifyMatch = indexTs.match(/app\.post\(['"][^'"]*verification[^'"]*['"][\s\S]*?\n\}\);/);
  if (!verifyMatch) {
    fail('No .../verification POST route handler found - the regex may be broken');
  } else {
    const block = verifyMatch[0];
    const qualIdx = block.indexOf('no_qualifying_evidence');
    const updateIdx = block.indexOf('UPDATE operators SET');
    if (qualIdx === -1) fail('no_qualifying_evidence check not found inside the verification endpoint');
    else if (updateIdx === -1) fail('UPDATE operators statement not found inside the verification endpoint - the regex may be broken');
    else if (qualIdx > updateIdx) fail('The qualifying-evidence check appears AFTER the UPDATE operators statement - a rejected grant could leave a partial write');
    else ok('The qualifying-evidence check runs before UPDATE operators - a rejected grant writes nothing');

    // Must be gated to the grant path only, not applied to revocation.
    const gateMatch = block.match(/if\s*\(targetState === 'VAKAVITI_VERIFIED'\)\s*\{\s*const qualifying/);
    if (!gateMatch) fail('The qualifying-evidence check does not appear gated to targetState === \'VAKAVITI_VERIFIED\' only - revocation must never require qualifying evidence');
    else ok('The qualifying-evidence check is gated to grants only - revocation remains unaffected');
  }
}

console.log('== 13. Deal Intelligence: AI cannot approve/publish, human-only file is the sole write path ==');
{
  // src/deal-agent.ts (AI/scheduled code) must never import from src/deals.ts (human-actioned
  // admin code) - the separation between "AI can propose" and "only a human can approve" must
  // be structural (two files, one direction of dependency), not just documented.
  if (/from ['"]\.\/deals['"]/.test(dealAgentTs)) {
    fail('src/deal-agent.ts imports from src/deals.ts - AI-facing code must not have access to the human-only approval module');
  } else {
    ok('src/deal-agent.ts does not import src/deals.ts');
  }

  // deal-agent.ts must never reference the ADMIN_TOKEN comparison itself and must never
  // literally write the human-only review_status values as a string target outside its own
  // declared DISCOVERY_WRITABLE_STATES set.
  const HUMAN_ONLY_STATUSES = ['VAKAVITI_HUMAN_REVIEWED', 'PROVIDER_APPROVED', 'PUBLICATION_APPROVED', 'PUBLISHED'];
  for (const status of HUMAN_ONLY_STATUSES) {
    // Allow the status to appear in the DISCOVERY_WRITABLE_STATES exclusion set's own comment/
    // definition context is not present (that set is deliberately narrow); a bare reference
    // outside a comment is what we're checking for.
    const codeLines = dealAgentTs.split('\n').filter(l => !l.trim().startsWith('//'));
    const hit = codeLines.some(l => l.includes(`'${status}'`) || l.includes(`"${status}"`));
    if (hit) fail(`src/deal-agent.ts references human-only status '${status}' outside a comment - AI-facing code must never write this value`);
  }
  if (!HUMAN_ONLY_STATUSES.some(s => dealAgentTs.split('\n').filter(l => !l.trim().startsWith('//')).some(l => l.includes(`'${s}'`) || l.includes(`"${s}"`)))) {
    ok('src/deal-agent.ts contains no live reference to VAKAVITI_HUMAN_REVIEWED, PROVIDER_APPROVED, PUBLICATION_APPROVED, or PUBLISHED');
  }

  // The writeReviewStatus() guard function must exist and must be the only way review_status
  // values are constructed in deal-agent.ts's INSERT statement.
  if (!/const writeReviewStatus/.test(dealAgentTs)) {
    fail('src/deal-agent.ts is missing the writeReviewStatus() guard function');
  } else {
    ok('src/deal-agent.ts defines a writeReviewStatus() guard function');
  }

  // Every route in deals.ts must sit behind requireAdmin - checked the same way as every other
  // admin router in this app (Pilot 6A/6B/6D-A pattern): the middleware registration must occur
  // before any .post( or .get( definition on the `deals` router specifically (dealsPublic is
  // deliberately NOT gated - it is the controlled public route, gated instead by
  // isPubliclyEligible()).
  const dealsMiddlewareIdx = dealsTs.indexOf(`deals.use('*', requireAdmin)`);
  if (dealsMiddlewareIdx === -1) {
    fail('src/deals.ts is missing the deals.use(\'*\', requireAdmin) middleware registration');
  } else {
    const dealsRouteIndices = [...dealsTs.matchAll(/deals\.(get|post)\(/g)].map(m => m.index);
    if (dealsRouteIndices.some(i => i < dealsMiddlewareIdx)) {
      fail('A deals.get(/deals.post( route is registered before requireAdmin middleware - it would be unguarded');
    } else {
      ok(`All ${dealsRouteIndices.length} admin deal route(s) are registered after requireAdmin middleware`);
    }
  }

  // The public preview route must filter through isPubliclyEligible - not just query
  // PUBLISHED directly and trust it blindly.
  const publicRouteMatch = dealsTs.match(/dealsPublic\.get\('\/[\s\S]*?\n\}\);/);
  if (!publicRouteMatch) {
    fail('dealsPublic.get(\'/\', ...) route not found in src/deals.ts');
  } else if (!publicRouteMatch[0].includes('isPubliclyEligible')) {
    fail('The public deals preview route does not filter through isPubliclyEligible() - it could leak ungated rows');
  } else {
    ok('The public deals preview route filters every row through isPubliclyEligible()');
  }

  // isPubliclyEligible must check review_status === 'PUBLISHED' as its first gate.
  if (!/function isPubliclyEligible[\s\S]*?review_status !== 'PUBLISHED'/.test(dealsTs)) {
    fail('isPubliclyEligible() does not appear to gate on review_status === \'PUBLISHED\'');
  } else {
    ok('isPubliclyEligible() gates on review_status === \'PUBLISHED\' as a precondition');
  }
}

console.log('== 14. Deal Intelligence P1: Human Review Centre auth, public hub eligibility gate, no fabricated urgency/social-proof language ==');
{
  // (a) The AI/scheduled file must have no path at all to either new human-facing surface, same
  // reasoning as check 13's deal-agent.ts -> deals.ts separation.
  for (const [name, mod] of [['./deals-admin-ui', 'src/deals-admin-ui.ts'], ['./deals-hub', 'src/deals-hub.ts']]) {
    if (new RegExp(`from ['"]${name.replace('.', '\\.')}['"]`).test(dealAgentTs)) {
      fail(`src/deal-agent.ts imports from ${mod} - AI-facing code must not have access to any human-only surface`);
    } else {
      ok(`src/deal-agent.ts does not import ${mod}`);
    }
  }

  // (b) Every route on the admin HTML router must sit behind requireAdminSession, with the sole
  // documented exemption being /login (GET+POST, needed to establish the session) and /logout
  // (POST, needed to clear it) - both registered, by necessity, before the middleware line.
  const adminMiddlewareIdx = dealsAdminUiTs.indexOf(`dealsAdminUi.use('*', requireAdminSession)`);
  if (adminMiddlewareIdx === -1) {
    fail('src/deals-admin-ui.ts is missing the dealsAdminUi.use(\'*\', requireAdminSession) middleware registration');
  } else {
    const EXEMPT_ADMIN_ROUTES = new Set(["'/login'", "'/logout'"]);
    const adminRouteMatches = [...dealsAdminUiTs.matchAll(/dealsAdminUi\.(get|post)\((['"][^'"]+['"])/g)];
    if (adminRouteMatches.length === 0) fail('No dealsAdminUi.get(/post( routes found in src/deals-admin-ui.ts - the regex may be broken');
    let unguarded = 0;
    for (const m of adminRouteMatches) {
      const [full, , routePath] = m;
      if (m.index < adminMiddlewareIdx && !EXEMPT_ADMIN_ROUTES.has(routePath)) {
        fail(`${routePath} is registered before requireAdminSession middleware and is not in the documented exemption list (/login, /logout) - it would be unguarded`);
        unguarded++;
      }
    }
    if (unguarded === 0) ok(`All ${adminRouteMatches.length} dealsAdminUi route(s) are either behind requireAdminSession or in the documented /login,/logout exemption`);
  }

  // (c) Every public hub route must filter through the shared eligibility gate - either directly
  // (isPubliclyEligible) or via getEligibleDeals(), which itself wraps isPubliclyEligible().
  if (!/function getEligibleDeals[\s\S]*?isPubliclyEligible/.test(dealsHubTs)) {
    fail('getEligibleDeals() in src/deals-hub.ts does not appear to filter through isPubliclyEligible()');
  } else {
    ok('getEligibleDeals() filters through isPubliclyEligible()');
  }
  const hubRouteBlocks = dealsHubTs.split(/(?=dealsHub\.get\()/).filter(b => /^dealsHub\.get\(/.test(b));
  if (hubRouteBlocks.length === 0) fail('No dealsHub.get( routes found in src/deals-hub.ts - the regex may be broken');
  let ungatedHubRoutes = 0;
  for (const block of hubRouteBlocks) {
    const routeMatch = block.match(/^dealsHub\.get\((['"][^'"]+['"])/);
    const routePath = routeMatch ? routeMatch[1] : '(unknown)';
    if (!/getEligibleDeals|isPubliclyEligible/.test(block)) {
      fail(`Public hub route ${routePath} does not reference getEligibleDeals() or isPubliclyEligible() - it could serve ungated rows`);
      ungatedHubRoutes++;
    }
  }
  if (ungatedHubRoutes === 0) ok(`All ${hubRouteBlocks.length} dealsHub.get( route(s) filter through getEligibleDeals()/isPubliclyEligible()`);

  // (d) No fabricated scarcity/countdown/review/rating language anywhere in the hub's static
  // template strings - the CEO directive is explicit that only visible, human-approved facts may
  // ever be shown; nothing invented to create urgency or borrowed social proof.
  const FORBIDDEN_PHRASES = [
    'only 1 left', 'only 2 left', 'spots left', 'rooms left', 'selling fast', 'hurry',
    'act now', 'limited time only', 'limited time offer', 'countdown', 'expires in 0',
    'guests rated', 'star rating', 'verified reviews', 'money-back guarantee',
    'best price guarantee', 'people are viewing', 'booked \\d+ times today'
  ];
  const hits = FORBIDDEN_PHRASES.filter(p => new RegExp(p, 'i').test(dealsHubTs));
  if (hits.length > 0) fail(`src/deals-hub.ts contains forbidden fabricated urgency/social-proof language: ${hits.join(', ')}`);
  else ok('src/deals-hub.ts contains no fabricated scarcity/countdown/review/rating language in its static templates');
}

console.log('== 15. P1.2 candidate-quality gate: deterministic, AI has no path to it, low-information scans cannot reach the review queue ==');
{
  // (a) deal-quality.ts must be pure - no AI.run() call, no D1 access, no env.DB reference. Its
  // entire value is being independently inspectable/testable outside the discovery loop that
  // calls it - if it ever reached into D1 or the model itself, that guarantee would be gone.
  const dealQualityCodeLines = dealQualityTs.split('\n').filter(l => !l.trim().startsWith('//'));
  if (dealQualityCodeLines.some(l => /AI\.run\(/.test(l))) fail('src/deal-quality.ts calls AI.run() outside a comment - the quality gate must stay deterministic, never AI-judged');
  else ok('src/deal-quality.ts contains no live AI.run() call');
  if (/env\.DB|D1Database/.test(dealQualityTs)) fail('src/deal-quality.ts references D1/env.DB - it must be a pure function module with no database access');
  else ok('src/deal-quality.ts contains no D1/env.DB reference');

  // (b) deal-agent.ts must still have no import path to any human-only file - the P1.2 addition
  // (importing ./deal-quality) must not have accidentally widened this.
  for (const [name, mod] of [['./deals', 'src/deals.ts'], ['./deals-admin-ui', 'src/deals-admin-ui.ts'], ['./deals-hub', 'src/deals-hub.ts']]) {
    if (new RegExp(`from ['"]${name.replace('.', '\\.')}['"]`).test(dealAgentTs)) {
      fail(`src/deal-agent.ts imports ${mod} - AI-facing code must not gain access to any human-only surface`);
    } else {
      ok(`src/deal-agent.ts does not import ${mod}`);
    }
  }

  // (c) Prompt-injection detection must run and must be capable of rejecting outright - checked
  // structurally by requiring detectPromptInjection to be defined and referenced inside
  // evaluateQualityGates before any gate-1..7,9,10 push to `passed`.
  if (!/function detectPromptInjection/.test(dealQualityTs)) {
    fail('src/deal-quality.ts is missing detectPromptInjection()');
  } else {
    const fnMatch = dealQualityTs.match(/export function evaluateQualityGates[\s\S]*?\n}/);
    if (!fnMatch) fail('evaluateQualityGates() not found in src/deal-quality.ts');
    else {
      const body = fnMatch[0];
      const injectionIdx = body.indexOf('detectPromptInjection');
      const firstGatePushIdx = body.indexOf(`passed.push('gate_1`);
      if (injectionIdx === -1) fail('evaluateQualityGates() never calls detectPromptInjection()');
      else if (firstGatePushIdx !== -1 && injectionIdx > firstGatePushIdx) fail('detectPromptInjection() is checked after gate_1 already passed - injection must short-circuit first');
      else ok('evaluateQualityGates() checks detectPromptInjection() before any other gate is evaluated');
    }
  }

  // (d) Generic provider-homepage/informational pages must be structurally excluded from gate 1,
  // not just discouraged by comment - the CEO directive is explicit that these page types must
  // never generate a candidate regardless of marketing language present.
  if (!/PROVIDER_HOME_PAGE['"]?\s*\|\|\s*classification\s*===\s*['"]INFORMATIONAL_PAGE/.test(dealQualityTs) &&
      !/classification === 'PROVIDER_HOME_PAGE' \|\| classification === 'INFORMATIONAL_PAGE'/.test(dealQualityTs)) {
    fail('src/deal-quality.ts does not appear to structurally exclude PROVIDER_HOME_PAGE/INFORMATIONAL_PAGE from passing the identifiable-proposition gate');
  } else {
    ok('src/deal-quality.ts structurally excludes PROVIDER_HOME_PAGE/INFORMATIONAL_PAGE from the identifiable-proposition gate');
  }

  // (e) deal-agent.ts must only INSERT a new deal_offer_candidates row inside insertCandidate(),
  // and that function must only be called after a quality-gate rejection check has already had
  // the chance to `continue` - i.e. the call site for insertCandidate( must textually follow the
  // `quality.decision === 'QUALITY_REJECTED'` check in runDailyDiscovery().
  const runFnMatch = dealAgentTs.match(/export async function runDailyDiscovery[\s\S]*$/);
  if (!runFnMatch) {
    fail('runDailyDiscovery() not found in src/deal-agent.ts');
  } else {
    const body = runFnMatch[0];
    const rejectionCheckIdx = body.indexOf(`quality.decision === 'QUALITY_REJECTED'`);
    const insertCallIdx = body.indexOf('await insertCandidate(');
    if (rejectionCheckIdx === -1) fail('runDailyDiscovery() does not check quality.decision === \'QUALITY_REJECTED\' anywhere');
    else if (insertCallIdx === -1) fail('runDailyDiscovery() never calls insertCandidate(');
    else if (insertCallIdx < rejectionCheckIdx) fail('insertCandidate( is called before the QUALITY_REJECTED check - a rejected extraction could still create a candidate');
    else ok('insertCandidate( is only reachable after the QUALITY_REJECTED check has already had the chance to skip this source');

    // No other INSERT INTO deal_offer_candidates may exist in this file outside insertCandidate().
    const rawInserts = [...dealAgentTs.matchAll(/INSERT INTO deal_offer_candidates/g)];
    if (rawInserts.length !== 1) {
      fail(`src/deal-agent.ts has ${rawInserts.length} INSERT INTO deal_offer_candidates statement(s) - expected exactly 1, inside insertCandidate()`);
    } else {
      ok('src/deal-agent.ts has exactly one INSERT INTO deal_offer_candidates statement, inside insertCandidate()');
    }
  }

  // (f) A material change to an existing candidate must never rewrite its factual columns - only
  // review_status/updated_at may be SET on that UPDATE, so prior evidence is never overwritten.
  const materialChangeUpdateMatch = dealAgentTs.match(/UPDATE deal_offer_candidates SET review_status=\?, updated_at=CURRENT_TIMESTAMP WHERE id=\?/);
  if (!materialChangeUpdateMatch) {
    fail('Could not find the expected narrow UPDATE deal_offer_candidates SET review_status=... statement - material-change handling may have grown wider than review_status/updated_at');
  } else {
    ok('The material-change UPDATE to an existing candidate touches only review_status and updated_at - no factual column is ever overwritten');
  }
}

console.log('== 16. P1.3A CEO-confirmed provider fast-track: admin-only, AI has no path to it, no claim-status leakage ==');
{
  // (a) deal-agent.ts (AI-facing) must have no import path to provider-onboarding.ts - the CEO
  // confirmation authorization event must stay structurally out of AI's reach, same as every
  // other human-only file in this app.
  if (/from ['"]\.\/provider-onboarding['"]/.test(dealAgentTs)) {
    fail('src/deal-agent.ts imports src/provider-onboarding.ts - AI-facing code must not have access to the CEO-confirmation authorization module');
  } else {
    ok('src/deal-agent.ts does not import src/provider-onboarding.ts');
  }

  // (b) provider-onboarding.ts must be requireAdmin-gated for every route, with zero exemptions -
  // unlike deals-admin-ui.ts there is no login/logout carve-out here at all.
  const mwIdx = providerOnboardingTs.indexOf(`providerOnboarding.use('*', requireAdmin)`);
  if (mwIdx === -1) {
    fail('src/provider-onboarding.ts is missing the providerOnboarding.use(\'*\', requireAdmin) middleware registration');
  } else {
    const routeIndices = [...providerOnboardingTs.matchAll(/providerOnboarding\.(get|post)\(/g)].map(m => m.index);
    if (routeIndices.some(i => i < mwIdx)) {
      fail('A providerOnboarding.get(/post( route is registered before requireAdmin middleware - it would be unguarded');
    } else {
      ok(`All ${routeIndices.length} provider-onboarding route(s) are registered after requireAdmin middleware, with zero exemptions`);
    }
  }

  // (c) Never sets VAKAVITI_VERIFIED - the fast-track publishes (commercial_status) but must
  // never touch verification, which remains governed solely by the existing hardened endpoint
  // in src/index.ts (checked already by check 9's own file list; this extends that guarantee
  // explicitly to the new file).
  const providerOnboardingCodeLines = providerOnboardingTs.split('\n').filter(l => !l.trim().startsWith('//'));
  if (providerOnboardingCodeLines.some(l => /VAKAVITI_VERIFIED/.test(l))) {
    fail('src/provider-onboarding.ts references VAKAVITI_VERIFIED outside a comment - the fast-track must never grant verification, only NOT_VERIFIED publication');
  } else {
    ok('src/provider-onboarding.ts contains no live reference to VAKAVITI_VERIFIED');
  }
  // Every operator/product INSERT in this file must force NOT_VERIFIED explicitly.
  const insertOperatorMatch = providerOnboardingTs.match(/INSERT INTO operators[\s\S]*?\.run\(\);/);
  if (!insertOperatorMatch || !/NOT_VERIFIED/.test(insertOperatorMatch[0])) {
    fail('The INSERT INTO operators statement in src/provider-onboarding.ts does not force NOT_VERIFIED');
  } else {
    ok('The INSERT INTO operators statement forces NOT_VERIFIED');
  }

  // (d) P1.3C: this validation now lives in the shared createCeoConfirmation() service function
  // (both the JSON route and the session-UI route call it), not in the route handler itself - the
  // missing-fields check must appear before the INSERT, inside that function.
  const createFnBlockMatch = providerOnboardingTs.match(/export async function createCeoConfirmation[\s\S]*?\n\}/);
  if (!createFnBlockMatch) {
    fail('createCeoConfirmation() not found in src/provider-onboarding.ts');
  } else {
    const block = createFnBlockMatch[0];
    const missingCheckIdx = block.indexOf('missing_required_confirmation_fields');
    const insertIdx = block.indexOf('INSERT INTO provider_ceo_confirmations');
    if (missingCheckIdx === -1) fail('createCeoConfirmation() does not check for missing required confirmation fields');
    else if (insertIdx === -1) fail('createCeoConfirmation() never writes provider_ceo_confirmations - the regex may be broken');
    else if (missingCheckIdx > insertIdx) fail('createCeoConfirmation() writes provider_ceo_confirmations before validating required fields');
    else ok('createCeoConfirmation() validates required fields before ever writing provider_ceo_confirmations');

    // Duplicate/ambiguous identity must fail closed (409) before that same INSERT.
    const dupCheckIdx = block.indexOf('duplicate_provider_confirmation');
    if (dupCheckIdx === -1 || dupCheckIdx > insertIdx) fail('createCeoConfirmation() does not check for a duplicate provider confirmation before writing');
    else ok('createCeoConfirmation() checks for a duplicate provider confirmation before writing');
  }

  // (e) Publication (commercial_status='ACTIVE') must only ever happen guarded behind a contact
  // check - never unconditionally the moment a confirmation is recorded.
  const publishGateMatch = providerOnboardingTs.match(/if \(hasContact\) \{[\s\S]*?UPDATE operators SET commercial_status='ACTIVE'[\s\S]*?\n  \}/);
  if (!publishGateMatch) {
    fail('Could not find an UPDATE operators SET commercial_status=\'ACTIVE\' statement structurally inside an `if (hasContact)` guard');
  } else {
    ok('Operator publication (commercial_status=\'ACTIVE\') is gated behind a contact-method check, never unconditional');
  }

  // (f) No public route in src/index.ts may select operators.claim_status - claim status must
  // stay administration-only, never even fetched on a guest-facing page. Split on every
  // app.get(/app.post( boundary (not just /operators ones) so each block is properly bounded and
  // never bleeds into unrelated code further down the file (the same technique check 8 uses).
  const allRouteBlocks = indexTs.split(/(?=app\.(?:get|post)\()/);
  const publicOperatorRoutes = allRouteBlocks.filter(b => /^app\.get\(['"]\/operators/.test(b));
  // Strip comment-only lines before scanning - this check's own explanatory comments legitimately
  // spell out "claim_status"/"unclaimed" to describe what must NOT appear in live code, which
  // would otherwise false-positive against itself (same lesson as checks 15/16(c)).
  const codeOnly = (block) => block.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  let claimLeak = false;
  for (const block of publicOperatorRoutes) {
    if (/claim_status/.test(codeOnly(block))) {
      fail('A public /operators route in src/index.ts still selects claim_status outside a comment - claim status must never reach a guest page');
      claimLeak = true;
    }
  }
  if (!claimLeak && publicOperatorRoutes.length > 0) ok(`${publicOperatorRoutes.length} public /operators route(s) in src/index.ts select no claim_status field at all`);
  else if (publicOperatorRoutes.length === 0) fail('No public /operators routes found in src/index.ts - the regex may be broken');

  // Forbidden guest-facing words, checked only within the public operator route blocks' live code
  // (the words "Verified"/"Claimed" are fine when driven by real verification_status/pilot-partner
  // state elsewhere - this check targets the specific banned literals the CEO directive names).
  const FORBIDDEN_LITERALS = ['unclaimed', 'Claimed profile', 'Officially verified', 'Approved by Vakaviti', 'Guaranteed'];
  let literalLeak = false;
  for (const block of publicOperatorRoutes) {
    const live = codeOnly(block);
    for (const lit of FORBIDDEN_LITERALS) {
      if (live.includes(lit)) { fail(`A public /operators route contains the banned literal "${lit}" outside a comment`); literalLeak = true; }
    }
  }
  if (!literalLeak) ok('No public /operators route contains a banned claim-status/unsupported-trust literal');
}

console.log('== 17. P1.3B supply dashboard: admin-only, read-only, no write path at all ==');
{
  if (/from ['"]\.\/supply-dashboard['"]/.test(dealAgentTs)) {
    fail('src/deal-agent.ts imports src/supply-dashboard.ts - AI-facing code must not have access to admin reporting');
  } else {
    ok('src/deal-agent.ts does not import src/supply-dashboard.ts');
  }

  const mwIdx = supplyDashboardTs.indexOf(`supplyDashboard.use('*', requireAdmin)`);
  if (mwIdx === -1) {
    fail('src/supply-dashboard.ts is missing the supplyDashboard.use(\'*\', requireAdmin) middleware registration');
  } else {
    const routeIndices = [...supplyDashboardTs.matchAll(/supplyDashboard\.(get|post)\(/g)].map(m => m.index);
    if (routeIndices.some(i => i < mwIdx)) fail('A supplyDashboard route is registered before requireAdmin middleware');
    else ok(`All ${routeIndices.length} supply-dashboard route(s) are registered after requireAdmin middleware`);
  }

  // Read-only: no INSERT/UPDATE/DELETE statement anywhere in this file - it must be structurally
  // incapable of acting on what it reports.
  if (/\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i.test(supplyDashboardTs)) {
    fail('src/supply-dashboard.ts contains a write statement (INSERT/UPDATE/DELETE) - the dashboard must be read-only');
  } else {
    ok('src/supply-dashboard.ts contains no INSERT/UPDATE/DELETE statement - fully read-only');
  }

  // "Deals live" must be computed via the shared isPubliclyEligible() gate, not a second,
  // independently-drifting SQL definition of "live".
  if (!/isPubliclyEligible/.test(supplyDashboardTs)) {
    fail('src/supply-dashboard.ts does not reference isPubliclyEligible() - "deals live" must reuse the one shared eligibility gate, not redefine it');
  } else {
    ok('src/supply-dashboard.ts computes "deals live" via the shared isPubliclyEligible() gate');
  }
}

console.log('== 18. P1.3C onboarding console: one governed service, session-gated, no client-supplied actor, CSRF+Origin enforced ==');
{
  // (a) AI has no import path to the new console.
  if (/from ['"]\.\/provider-onboarding-ui['"]/.test(dealAgentTs)) {
    fail('src/deal-agent.ts imports src/provider-onboarding-ui.ts - AI-facing code must not have access to the CEO onboarding console');
  } else {
    ok('src/deal-agent.ts does not import src/provider-onboarding-ui.ts');
  }

  // (b) providerOnboardingUi must be requireAdminSession-gated for every single route - unlike
  // deals-admin-ui.ts, this file deliberately has NO login/logout exemption at all (it reuses the
  // existing /admin/deals/login instead of duplicating a login form).
  const uiMwIdx = providerOnboardingUiTs.indexOf(`providerOnboardingUi.use('*', requireAdminSession)`);
  if (uiMwIdx === -1) {
    fail('src/provider-onboarding-ui.ts is missing the providerOnboardingUi.use(\'*\', requireAdminSession) middleware registration');
  } else {
    const uiRouteIndices = [...providerOnboardingUiTs.matchAll(/providerOnboardingUi\.(get|post)\(/g)].map(m => m.index);
    if (uiRouteIndices.some(i => i < uiMwIdx)) {
      fail('A providerOnboardingUi route is registered before requireAdminSession middleware - it would be unguarded');
    } else {
      ok(`All ${uiRouteIndices.length} provider-onboarding-ui route(s) are registered after requireAdminSession, with zero login/logout exemption`);
    }
  }

  // (c) The governed service functions must never read `actor` off their own `input` parameter -
  // actor is only ever a function parameter supplied by the calling route's own auth context.
  const createFnMatch = providerOnboardingTs.match(/export async function createCeoConfirmation[\s\S]*?\n}/);
  if (!createFnMatch) {
    fail('createCeoConfirmation() not found in src/provider-onboarding.ts');
  } else if (/input\.actor/.test(createFnMatch[0])) {
    fail('createCeoConfirmation() reads input.actor - actor must only ever come from the function parameter, never client-supplied input');
  } else {
    ok('createCeoConfirmation() never reads actor from its input parameter');
  }
  const revokeFnMatch = providerOnboardingTs.match(/export async function revokeCeoConfirmation[\s\S]*?\n}/);
  if (!revokeFnMatch) {
    fail('revokeCeoConfirmation() not found in src/provider-onboarding.ts');
  } else if (/body\.actor|input\.actor/.test(revokeFnMatch[0])) {
    fail('revokeCeoConfirmation() reads actor from a body/input field - actor must only ever come from the function parameter');
  } else {
    ok('revokeCeoConfirmation() never reads actor from its input');
  }

  // (d) Neither POST handler in the console reads a client-supplied actor - both must call the
  // service with the fixed literal 'CEO (admin session)'.
  const onboardPostMatch = providerOnboardingUiTs.match(/providerOnboardingUi\.post\('\/onboard'[\s\S]*?\n\}\);/);
  const revokePostMatch = providerOnboardingUiTs.match(/providerOnboardingUi\.post\('\/:id\/revoke'[\s\S]*?\n\}\);/);
  for (const [label, m] of [['POST /onboard', onboardPostMatch], ['POST /:id/revoke', revokePostMatch]]) {
    if (!m) { fail(`${label} route not found in src/provider-onboarding-ui.ts`); continue; }
    if (!/'CEO \(admin session\)'/.test(m[0])) {
      fail(`${label} does not call the governed service with the fixed 'CEO (admin session)' actor literal`);
    } else if (/body\.actor/.test(m[0])) {
      fail(`${label} references body.actor - actor must never be read from the submitted form`);
    } else {
      ok(`${label} uses the fixed 'CEO (admin session)' actor and never reads actor from the form`);
    }
  }

  // (e) CSRF validation must occur before any write in both POST handlers.
  for (const [label, m] of [['POST /onboard', onboardPostMatch], ['POST /:id/revoke', revokePostMatch]]) {
    if (!m) continue;
    const block = m[0];
    const csrfIdx = block.indexOf('csrfValid(');
    const writeIdx = Math.min(...['createCeoConfirmation(', 'revokeCeoConfirmation('].map(s => { const i = block.indexOf(s); return i === -1 ? Infinity : i; }));
    if (csrfIdx === -1) fail(`${label} never calls csrfValid()`);
    else if (writeIdx !== Infinity && csrfIdx > writeIdx) fail(`${label} calls the governed service before validating CSRF`);
    else ok(`${label} validates CSRF before calling the governed service`);
  }

  // (f) Origin/Referer enforcement must occur before any write in both POST handlers - checked
  // against the actual write-call position, not a fragile character-offset heuristic.
  for (const [label, m] of [['POST /onboard', onboardPostMatch], ['POST /:id/revoke', revokePostMatch]]) {
    if (!m) continue;
    const block = m[0];
    const originIdx = block.indexOf('originAllowed(c)');
    const writeIdx = Math.min(...['createCeoConfirmation(', 'revokeCeoConfirmation('].map(s => { const i = block.indexOf(s); return i === -1 ? Infinity : i; }));
    if (originIdx === -1) fail(`${label} never calls originAllowed()`);
    else if (writeIdx !== Infinity && originIdx > writeIdx) fail(`${label} calls the governed service before checking Origin/Referer`);
    else ok(`${label} enforces Origin/Referer before calling the governed service`);
  }

  // (g) ADMIN_TOKEN must never appear in an HTML-rendered string literal in this file (it is only
  // ever used as an HMAC signing key or compared server-side, never echoed into a response).
  const htmlEmitLines = providerOnboardingUiTs.split('\n').filter(l => /c\.html\(|shell\(/.test(l) && !l.trim().startsWith('//'));
  if (htmlEmitLines.some(l => /ADMIN_TOKEN/.test(l))) {
    fail('src/provider-onboarding-ui.ts appears to reference ADMIN_TOKEN directly on an HTML-emitting line - it must never be echoed into a response');
  } else {
    ok('src/provider-onboarding-ui.ts never references ADMIN_TOKEN on an HTML-emitting line');
  }
}

console.log('== 19. P1.3D directory gate + standing policy: pure logic, AI has zero write path to standing_policies ==');
{
  // (a) directory-gate.ts is pure - no D1 access, no AI.run() call, no network fetch. Its output
  // must be fully inspectable/testable in isolation, same discipline as deal-quality.ts. Comment
  // lines are excluded first - this file's own header comment explains that discipline in prose
  // and would otherwise self-trigger the very check it's describing.
  const directoryGateCodeLines = directoryGateTs.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  if (/\bD1Database\b|AI\.run\(|await fetch\(/.test(directoryGateCodeLines)) {
    fail('src/directory-gate.ts appears to reference D1/AI.run/fetch - it must remain pure, deterministic logic only');
  } else {
    ok('src/directory-gate.ts is pure - no D1, AI.run, or fetch reference');
  }

  // (b) AI-facing code (deal-agent.ts) must never import the directory promotion path or the
  // batch review console - it may read/propose evidence, never publish.
  for (const [label, mod] of [['./candidates (promoteCandidateToDirectoryListing)', "from './candidates'"], ['./batch-review-ui', "from './batch-review-ui'"]]) {
    if (dealAgentTs.includes(mod)) fail(`src/deal-agent.ts imports ${label} - AI-facing code must not be able to publish a directory listing`);
    else ok(`src/deal-agent.ts does not import ${label}`);
  }

  // (c) No application code (only migration SQL) may INSERT or UPDATE standing_policies - a
  // standing policy may only be granted or revoked outside any code path, per the CEO directive's
  // "AI must not alter the standing policy" instruction.
  for (const [label, text] of [['src/candidates.ts', candidatesTs], ['src/batch-review-ui.ts', batchReviewUiTs], ['src/deal-agent.ts', dealAgentTs], ['src/index.ts', indexTs]]) {
    if (/\b(INSERT INTO|UPDATE)\s+standing_policies\b/i.test(text)) {
      fail(`${label} contains a write statement against standing_policies - only a migration may create/modify this table`);
    } else {
      ok(`${label} contains no write statement against standing_policies`);
    }
  }
  if (!/CREATE TABLE IF NOT EXISTS standing_policies/.test(migration0014Sql) || !/INSERT INTO standing_policies/.test(migration0014Sql)) {
    fail('migrations/0014_ai_supply_discovery.sql does not both create and seed standing_policies as expected');
  } else {
    ok('migrations/0014_ai_supply_discovery.sql creates and seeds the standing_policies table');
  }

  // (d) promoteCandidateToDirectoryListing() is called only from the authenticated batch review
  // console, never from within candidates.ts's own Bearer-token routes (which would let a bare
  // ADMIN_TOKEN request bypass the human batch-review screen) and never from deal-agent.ts.
  const promoteFnMatch = candidatesTs.match(/export async function promoteCandidateToDirectoryListing[\s\S]*?\n}/);
  if (!promoteFnMatch) {
    fail('promoteCandidateToDirectoryListing() not found in src/candidates.ts');
  } else {
    ok('promoteCandidateToDirectoryListing() is defined in src/candidates.ts');
    // Same law as every other promotion path in this app (see check above for the .post routes):
    // always NOT_VERIFIED, never VAKAVITI_VERIFIED, at the exact INSERT that creates the row.
    if (/VAKAVITI_VERIFIED/.test(promoteFnMatch[0])) fail('promoteCandidateToDirectoryListing() references VAKAVITI_VERIFIED - it must always force NOT_VERIFIED');
    else if (!/NOT_VERIFIED/.test(promoteFnMatch[0])) fail('promoteCandidateToDirectoryListing() does not force NOT_VERIFIED anywhere in its INSERT');
    else ok('promoteCandidateToDirectoryListing() forces NOT_VERIFIED and never references VAKAVITI_VERIFIED');
  }
  const candidatesRoutesOnly = candidatesTs.replace(/export async function promoteCandidateToDirectoryListing[\s\S]*?\n}/, '');
  if (/promoteCandidateToDirectoryListing\(/.test(candidatesRoutesOnly)) {
    fail('src/candidates.ts calls promoteCandidateToDirectoryListing() from one of its own Bearer-token routes - it must only be called from the batch review console');
  } else {
    ok('src/candidates.ts never calls promoteCandidateToDirectoryListing() from its own routes');
  }
  if (!/promoteCandidateToDirectoryListing\(/.test(batchReviewUiTs)) {
    fail('src/batch-review-ui.ts does not call promoteCandidateToDirectoryListing() - the approve action appears disconnected');
  } else {
    ok('src/batch-review-ui.ts calls promoteCandidateToDirectoryListing()');
  }
}

console.log('== 20. P1.3D batch review console: session-gated, no client-supplied actor, CSRF+Origin enforced, independent per-candidate re-validation ==');
{
  // (a) AI has no import path to the console.
  if (/from ['"]\.\/batch-review-ui['"]/.test(dealAgentTs)) {
    fail('src/deal-agent.ts imports src/batch-review-ui.ts - AI-facing code must not have access to the batch review console');
  } else {
    ok('src/deal-agent.ts does not import src/batch-review-ui.ts');
  }

  // (b) Every route must be requireAdminSession-gated.
  const mwIdx = batchReviewUiTs.indexOf(`batchReviewUi.use('*', requireAdminSession)`);
  if (mwIdx === -1) {
    fail('src/batch-review-ui.ts is missing the batchReviewUi.use(\'*\', requireAdminSession) middleware registration');
  } else {
    const routeIndices = [...batchReviewUiTs.matchAll(/batchReviewUi\.(get|post)\(/g)].map(m => m.index);
    if (routeIndices.some(i => i < mwIdx)) fail('A batchReviewUi route is registered before requireAdminSession middleware');
    else ok(`All ${routeIndices.length} batch-review-ui route(s) are registered after requireAdminSession`);
  }

  // (c) Both POST handlers use the fixed actor literal, never a client-supplied one.
  const approveMatch = batchReviewUiTs.match(/batchReviewUi\.post\('\/directory\/approve'[\s\S]*?\n\}\);/);
  const rejectMatch = batchReviewUiTs.match(/batchReviewUi\.post\('\/directory\/reject'[\s\S]*?\n\}\);/);
  for (const [label, m] of [['POST /directory/approve', approveMatch], ['POST /directory/reject', rejectMatch]]) {
    if (!m) { fail(`${label} route not found in src/batch-review-ui.ts`); continue; }
    if (!/'CEO \(batch review session\)'/.test(m[0])) {
      fail(`${label} does not use the fixed 'CEO (batch review session)' actor literal`);
    } else if (/body\.actor/.test(m[0])) {
      fail(`${label} references body.actor - actor must never be read from the submitted form`);
    } else {
      ok(`${label} uses the fixed actor literal and never reads actor from the form`);
    }
  }

  // (d) CSRF and Origin must both be validated before any write in both POST handlers, checked
  // against the actual write-call position.
  for (const [label, m] of [['POST /directory/approve', approveMatch], ['POST /directory/reject', rejectMatch]]) {
    if (!m) continue;
    const block = m[0];
    const writeIdx = Math.min(...['promoteCandidateToDirectoryListing(', "workflow_state='REJECTED'"].map(s => { const i = block.indexOf(s); return i === -1 ? Infinity : i; }));
    const csrfIdx = block.indexOf('csrfValid(');
    const originIdx = block.indexOf('originAllowed(c)');
    if (csrfIdx === -1) fail(`${label} never calls csrfValid()`);
    else if (writeIdx !== Infinity && csrfIdx > writeIdx) fail(`${label} performs a write before validating CSRF`);
    else ok(`${label} validates CSRF before any write`);
    if (originIdx === -1) fail(`${label} never calls originAllowed()`);
    else if (writeIdx !== Infinity && originIdx > writeIdx) fail(`${label} performs a write before checking Origin/Referer`);
    else ok(`${label} enforces Origin/Referer before any write`);
  }

  // (e) The approve handler must re-validate every candidate independently (never trust the
  // submitted list) - i.e. it must call the governed service inside a loop over the submitted ids,
  // not assume the list is already safe.
  if (approveMatch && !/for\s*\(const id of ids\)/.test(approveMatch[0])) {
    fail('POST /directory/approve does not appear to iterate and independently re-validate each submitted candidate id');
  } else if (approveMatch) {
    ok('POST /directory/approve independently re-validates each submitted candidate id via promoteCandidateToDirectoryListing()');
  }

  // (f) ADMIN_TOKEN must never appear on an HTML-emitting line.
  const htmlEmitLines = batchReviewUiTs.split('\n').filter(l => /c\.html\(|shell\(/.test(l) && !l.trim().startsWith('//'));
  if (htmlEmitLines.some(l => /ADMIN_TOKEN/.test(l))) {
    fail('src/batch-review-ui.ts appears to reference ADMIN_TOKEN directly on an HTML-emitting line');
  } else {
    ok('src/batch-review-ui.ts never references ADMIN_TOKEN on an HTML-emitting line');
  }
}

console.log('== 21. P1.4 discovery bridge: AI-facing, private-only writes, no path to publication ==');
{
  // (a) discovery-bridge.ts never writes to operators/products/provider_ceo_confirmations/
  // standing_policies/deal_offer_candidates - every write must land in the four private
  // candidate-stage tables only.
  const forbiddenWrites = [
    /\b(INSERT INTO|UPDATE)\s+operators\b/i,
    /\b(INSERT INTO|UPDATE)\s+products\b/i,
    /\b(INSERT INTO|UPDATE)\s+provider_ceo_confirmations\b/i,
    /\b(INSERT INTO|UPDATE)\s+standing_policies\b/i,
    /\b(INSERT INTO|UPDATE)\s+deal_offer_candidates\b/i,
  ];
  const violations = forbiddenWrites.filter(re => re.test(discoveryBridgeTs));
  if (violations.length) {
    fail(`src/discovery-bridge.ts contains a write statement against a publication/deal table it must never touch`);
  } else {
    ok('src/discovery-bridge.ts writes only to private candidate-stage tables');
  }

  // (b) it must actually write to the 4 expected private tables - a bridge that writes to none
  // of them would be a silent no-op, not a passing "safe" file.
  for (const table of ['candidate_operators', 'candidate_sources', 'candidate_claims', 'product_candidates']) {
    if (!new RegExp(`INSERT INTO\\s+${table}\\b`, 'i').test(discoveryBridgeTs)) {
      fail(`src/discovery-bridge.ts never inserts into ${table} - the bridge appears incomplete`);
    } else {
      ok(`src/discovery-bridge.ts inserts into ${table}`);
    }
  }

  // (c) new candidates must never be created in an already-public workflow_state - discovery can
  // only ever produce DISCOVERED or ENRICHED, never QUALIFIED/SHORTLISTED (which imply human
  // review has already happened) and never call promoteCandidateToDirectoryListing() itself.
  // Comment lines are excluded first - this file's own header comment explains that discipline in
  // prose and would otherwise self-trigger the very check it's describing.
  const discoveryBridgeCodeLines = discoveryBridgeTs.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  if (/QUALIFIED|SHORTLISTED/.test(discoveryBridgeCodeLines)) {
    fail('src/discovery-bridge.ts references QUALIFIED/SHORTLISTED workflow_state - AI discovery must only ever produce DISCOVERED or ENRICHED');
  } else {
    ok('src/discovery-bridge.ts never references QUALIFIED/SHORTLISTED workflow_state');
  }
  if (/promoteCandidateToDirectoryListing/.test(discoveryBridgeCodeLines)) {
    fail('src/discovery-bridge.ts references promoteCandidateToDirectoryListing() - discovery must never call the publication path directly');
  } else {
    ok('src/discovery-bridge.ts never calls promoteCandidateToDirectoryListing()');
  }

  // (d) idempotency guard must run before any fetch - the existence check(s) must textually
  // precede the safeFetchSource() call.
  const fetchIdx = discoveryBridgeTs.indexOf('await safeFetchSource(');
  const guardIdx = discoveryBridgeTs.indexOf("FROM operators WHERE website_url LIKE");
  if (fetchIdx === -1) fail('src/discovery-bridge.ts never calls safeFetchSource()');
  else if (guardIdx === -1) fail('src/discovery-bridge.ts is missing the existing-operator idempotency guard');
  else if (guardIdx > fetchIdx) fail('src/discovery-bridge.ts fetches before checking for an existing operator - idempotency guard must run first');
  else ok('src/discovery-bridge.ts checks for an existing operator before fetching');
}

console.log('== 22. P1.4 supply sprint console: session-gated, no client-supplied actor, CSRF+Origin enforced, bounded batches ==');
{
  if (/from ['"]\.\/supply-sprint-ui['"]/.test(dealAgentTs) || /from ['"]\.\/supply-sprint-ui['"]/.test(discoveryBridgeTs)) {
    fail('AI-facing code imports src/supply-sprint-ui.ts - AI-facing code must not have access to the sprint console');
  } else {
    ok('AI-facing code does not import src/supply-sprint-ui.ts');
  }

  const mwIdx = supplySprintUiTs.indexOf(`supplySprintUi.use('*', requireAdminSession)`);
  if (mwIdx === -1) {
    fail('src/supply-sprint-ui.ts is missing the supplySprintUi.use(\'*\', requireAdminSession) middleware registration');
  } else {
    const routeIndices = [...supplySprintUiTs.matchAll(/supplySprintUi\.(get|post)\(/g)].map(m => m.index);
    if (routeIndices.some(i => i < mwIdx)) fail('A supplySprintUi route is registered before requireAdminSession middleware');
    else ok(`All ${routeIndices.length} supply-sprint-ui route(s) are registered after requireAdminSession`);
  }

  const startMatch = supplySprintUiTs.match(/supplySprintUi\.post\('\/start'[\s\S]*?\n\}\);/);
  const continueMatch = supplySprintUiTs.match(/supplySprintUi\.post\('\/:runId\/continue'[\s\S]*?\n\}\);/);
  for (const [label, m] of [['POST /start', startMatch], ['POST /:runId/continue', continueMatch]]) {
    if (!m) { fail(`${label} route not found in src/supply-sprint-ui.ts`); continue; }
    if (/body\.actor/.test(m[0])) fail(`${label} references body.actor - actor must never be read from the submitted form`);
    else ok(`${label} never reads actor from the form`);
  }
  if (!/'CEO \(admin session\)'/.test(supplySprintUiTs)) {
    fail("src/supply-sprint-ui.ts does not use the fixed 'CEO (admin session)' actor literal anywhere");
  } else {
    ok("src/supply-sprint-ui.ts uses the fixed 'CEO (admin session)' actor literal");
  }

  for (const [label, m] of [['POST /start', startMatch], ['POST /:runId/continue', continueMatch]]) {
    if (!m) continue;
    const block = m[0];
    const writeIdx = Math.min(...['processBatch(', 'INSERT OR IGNORE INTO supply_sprint_runs'].map(s => { const i = block.indexOf(s); return i === -1 ? Infinity : i; }));
    const csrfIdx = block.indexOf('csrfValid(');
    const originIdx = block.indexOf('originAllowed(c)');
    if (csrfIdx === -1) fail(`${label} never calls csrfValid()`);
    else if (writeIdx !== Infinity && csrfIdx > writeIdx) fail(`${label} performs a write before validating CSRF`);
    else ok(`${label} validates CSRF before any write`);
    if (originIdx === -1) fail(`${label} never calls originAllowed()`);
    else if (writeIdx !== Infinity && originIdx > writeIdx) fail(`${label} performs a write before checking Origin/Referer`);
    else ok(`${label} enforces Origin/Referer before any write`);
  }

  // Bounded batch: must cap processing at MAX_SOURCES_PER_BATCH per call, never process the full
  // source list in one request (the exact failure class this whole staged-scan discipline exists
  // to prevent - see deal-agent.ts's own P0 containment history).
  if (!/MAX_SOURCES_PER_BATCH\s*=\s*3/.test(supplySprintUiTs)) {
    fail('src/supply-sprint-ui.ts does not define MAX_SOURCES_PER_BATCH=3 - batch size must stay bounded and match the CEO directive\'s stated limit');
  } else {
    ok('src/supply-sprint-ui.ts caps batches at MAX_SOURCES_PER_BATCH=3');
  }
  if (!/\.slice\(run\.next_batch_offset, run\.next_batch_offset \+ MAX_SOURCES_PER_BATCH\)/.test(supplySprintUiTs)) {
    fail('src/supply-sprint-ui.ts does not appear to slice the source list to a bounded batch before processing');
  } else {
    ok('src/supply-sprint-ui.ts processes only a bounded slice of sources per call');
  }

  const htmlEmitLines = supplySprintUiTs.split('\n').filter(l => /c\.html\(|shell\(/.test(l) && !l.trim().startsWith('//'));
  if (htmlEmitLines.some(l => /ADMIN_TOKEN/.test(l))) {
    fail('src/supply-sprint-ui.ts appears to reference ADMIN_TOKEN directly on an HTML-emitting line');
  } else {
    ok('src/supply-sprint-ui.ts never references ADMIN_TOKEN on an HTML-emitting line');
  }
}

console.log('== 23. P1.4A activation UX fix: safe return_to, double-submit guard, sanitized observability ==');
{
  // (a) isSafeReturnPath must exist and be a strict allowlist (path must start with /admin/, and
  // the check must explicitly reject a leading "//" - the classic protocol-relative open-redirect
  // trick).
  if (!/export function isSafeReturnPath/.test(dealsAdminUiTs)) {
    fail('src/deals-admin-ui.ts does not export isSafeReturnPath() - the return_to validator is missing');
  } else {
    ok('src/deals-admin-ui.ts exports isSafeReturnPath()');
  }
  const isSafeFnMatch = dealsAdminUiTs.match(/export function isSafeReturnPath[\s\S]*?\n\}/);
  if (isSafeFnMatch && !/startsWith\('\/\/'\)/.test(isSafeFnMatch[0])) {
    fail('isSafeReturnPath() does not appear to reject a leading "//" - protocol-relative open-redirect risk');
  } else if (isSafeFnMatch) {
    ok('isSafeReturnPath() explicitly rejects a leading "//"');
  }

  // (b) the login POST handler must re-validate return_to server-side (never trust the submitted
  // field blindly) - it must call isSafeReturnPath on the body value, not redirect to it raw.
  const loginPostMatch = dealsAdminUiTs.match(/dealsAdminUi\.post\('\/login'[\s\S]*?\n\}\);/);
  if (!loginPostMatch) {
    fail('POST /login route not found in src/deals-admin-ui.ts');
  } else if (!/isSafeReturnPath\(returnToRaw\)/.test(loginPostMatch[0])) {
    fail('POST /login does not re-validate the submitted return_to with isSafeReturnPath() - it must never trust the client value directly');
  } else {
    ok('POST /login re-validates return_to server-side before using it');
  }

  // (c) every admin console's requireAdminSession must pass return_to when redirecting to login -
  // a bare redirect to /admin/deals/login (no query string at all) is exactly the P1.4A root
  // cause and must not regress in any of the four consoles.
  for (const [label, text] of [
    ['src/supply-sprint-ui.ts', supplySprintUiTs],
    ['src/batch-review-ui.ts', batchReviewUiTs],
    ['src/provider-onboarding-ui.ts', providerOnboardingUiTs],
  ]) {
    if (!/return_to=\$\{encodeURIComponent\(c\.req\.path\)\}/.test(text)) {
      fail(`${label}'s requireAdminSession does not pass return_to when redirecting to login`);
    } else {
      ok(`${label}'s requireAdminSession passes return_to when redirecting to login`);
    }
  }

  // (d) POST /start's idempotency key must be derived from the CSRF nonce (identical across a
  // genuine double-tap of the same rendered form), not a fresh timestamp/uuid every call - this
  // is what makes "double submission creates at most one run" a DB-enforced guarantee rather than
  // a best-effort client-side disable.
  const startMatch2 = supplySprintUiTs.match(/supplySprintUi\.post\('\/start'[\s\S]*?\n\}\);/);
  if (!startMatch2) {
    fail('POST /start route not found in src/supply-sprint-ui.ts');
  } else if (!/supply-sprint-start-\$\{nonce\}/.test(startMatch2[0])) {
    fail('POST /start does not derive its idempotency key from the CSRF nonce - double-submit is not DB-guaranteed to collide');
  } else {
    ok('POST /start derives its idempotency key from the CSRF nonce (double-submit is DB-guaranteed to collide)');
  }

  // (e) the activation logger must never be given a secret, cookie, CSRF value, or token - it may
  // only ever receive the fixed, sanitized field set.
  const logFnMatch = supplySprintUiTs.match(/async function logActivation[\s\S]*?\n\}/);
  if (!logFnMatch) {
    fail('logActivation() not found in src/supply-sprint-ui.ts');
  } else if (/ADMIN_TOKEN|csrf_sig|csrf_nonce|cookie/i.test(logFnMatch[0])) {
    fail('logActivation() appears to reference a secret/token/cookie/CSRF value directly - observability must stay sanitized');
  } else {
    ok('logActivation() never references a secret, token, cookie, or CSRF value');
  }
  // Every call site must only ever pass the fixed sanitized field set - never a raw request body,
  // header, or cookie object.
  const logCallSites = [...supplySprintUiTs.matchAll(/logActivation\(c\.env,\s*\{[^}]*\}\)/g)].map(m => m[0]);
  if (logCallSites.length === 0) {
    fail('logActivation() is defined but never called - activation attempts are not actually being logged');
  } else if (logCallSites.some(s => /ADMIN_TOKEN|csrf_sig|csrf_nonce|body\.token|cookie/i.test(s))) {
    fail('A logActivation() call site passes a secret/token/cookie/CSRF value');
  } else {
    ok(`${logCallSites.length} logActivation() call site(s) pass only sanitized fields`);
  }
}

console.log('== 24. P1.5 supply scheduler + Class B detection: Cron-only trigger, no fabricated rights, bounded batches ==');
{
  // (a) One-way dependency: deal-agent.ts and discovery-bridge.ts must never import the
  // scheduler (which itself imports them) - no import cycle, and AI-facing per-source logic
  // stays ignorant of the orchestration/auto-publish layer above it.
  for (const [label, text] of [['src/deal-agent.ts', dealAgentTs], ['src/discovery-bridge.ts', discoveryBridgeTs]]) {
    if (/from ['"]\.\/supply-scheduler['"]/.test(text)) fail(`${label} imports src/supply-scheduler.ts - this would create an import cycle`);
    else ok(`${label} does not import src/supply-scheduler.ts`);
  }

  // (b) The scheduler must never write to operators/products directly - only through the one
  // governed promotion function, same as every other caller.
  if (/\b(INSERT INTO|UPDATE)\s+products\b/i.test(supplySchedulerTs)) {
    fail('src/supply-scheduler.ts writes to products directly - it must only ever act through promoteCandidateToDirectoryListing()');
  } else {
    ok('src/supply-scheduler.ts never writes to products directly');
  }
  const schedulerCodeLines = supplySchedulerTs.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  if (/INSERT INTO operators\b/i.test(schedulerCodeLines)) {
    fail('src/supply-scheduler.ts inserts into operators directly - it must only ever act through promoteCandidateToDirectoryListing()');
  } else {
    ok('src/supply-scheduler.ts never inserts into operators directly (only an UPDATE for the freshness withdrawal path is allowed)');
  }
  if (/VAKAVITI_VERIFIED/.test(schedulerCodeLines)) {
    fail('src/supply-scheduler.ts references VAKAVITI_VERIFIED');
  } else {
    ok('src/supply-scheduler.ts never references VAKAVITI_VERIFIED');
  }
  for (const table of ['provider_ceo_confirmations', 'standing_policies']) {
    if (new RegExp(`\\b(INSERT INTO|UPDATE)\\s+${table}\\b`, 'i').test(supplySchedulerTs)) {
      fail(`src/supply-scheduler.ts writes to ${table} - it must never touch this table`);
    } else {
      ok(`src/supply-scheduler.ts never writes to ${table}`);
    }
  }

  // (c) it must actually call the governed promotion function - not just be present as unused
  // scaffolding - and index.ts's scheduled() handler must actually invoke it, proving the
  // "no manual click" wiring is real and not orphaned code.
  if (!/promoteCandidateToDirectoryListing\(/.test(supplySchedulerTs)) {
    fail('src/supply-scheduler.ts never calls promoteCandidateToDirectoryListing() - the auto-publish wiring is missing');
  } else {
    ok('src/supply-scheduler.ts calls promoteCandidateToDirectoryListing()');
  }
  if (!/runSupplyBootstrap\(env\)/.test(indexTs)) {
    fail('src/index.ts scheduled() handler does not call runSupplyBootstrap() - the bootstrap is not wired to Cron');
  } else {
    ok('src/index.ts scheduled() handler calls runSupplyBootstrap()');
  }

  // (d) bounded batch, same discipline as every other scheduled loop in this app.
  if (!/MAX_SOURCES_PER_TICK\s*=\s*3/.test(supplySchedulerTs)) {
    fail('src/supply-scheduler.ts does not cap MAX_SOURCES_PER_TICK at 3');
  } else {
    ok('src/supply-scheduler.ts caps MAX_SOURCES_PER_TICK at 3');
  }

  // (e) Class B detection (evaluateDealAutoPublishGates) must require ALL FOUR human-only
  // judgment fields - this is the specific property that keeps it from ever silently becoming a
  // real auto-publish path without a human first recording a rights/ownership decision.
  const dealAutoPublishFnMatch = dealQualityTs.match(/export function evaluateDealAutoPublishGates[\s\S]*?\n\}/);
  if (!dealAutoPublishFnMatch) {
    fail('evaluateDealAutoPublishGates() not found in src/deal-quality.ts');
  } else {
    const body = dealAutoPublishFnMatch[0];
    for (const field of ['fulfilment_operator', 'response_owner', 'content_rights_status', 'image_rights_status']) {
      if (!body.includes(`c.${field}`)) fail(`evaluateDealAutoPublishGates() does not check c.${field} - a required human-judgment field could be silently skipped`);
    }
    if (['fulfilment_operator', 'response_owner', 'content_rights_status', 'image_rights_status'].every(f => body.includes(`c.${f}`))) {
      ok('evaluateDealAutoPublishGates() checks all four human-only judgment fields');
    }
  }
  // It must not be referenced from any write-capable file - detection only, per its own header.
  // Comment lines are excluded first - src/supply-scheduler.ts's own header comment explains why
  // it deliberately does NOT call this function, in prose, which would otherwise self-trigger the
  // very check it's describing.
  for (const [label, text] of [['src/deals.ts', dealsTs], ['src/deal-agent.ts', dealAgentTs], ['src/supply-scheduler.ts', supplySchedulerTs], ['src/candidates.ts', candidatesTs]]) {
    const codeOnly = text.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    if (codeOnly.includes('evaluateDealAutoPublishGates')) {
      fail(`${label} references evaluateDealAutoPublishGates() - it must remain display-only (src/supply-dashboard.ts is the only permitted caller)`);
    } else {
      ok(`${label} does not reference evaluateDealAutoPublishGates()`);
    }
  }
  if (!supplyDashboardTs.includes('evaluateDealAutoPublishGates')) {
    fail('src/supply-dashboard.ts does not reference evaluateDealAutoPublishGates() - the Class B visibility metric appears disconnected');
  } else {
    ok('src/supply-dashboard.ts references evaluateDealAutoPublishGates() for read-only visibility');
  }
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
