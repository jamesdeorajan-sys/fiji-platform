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
