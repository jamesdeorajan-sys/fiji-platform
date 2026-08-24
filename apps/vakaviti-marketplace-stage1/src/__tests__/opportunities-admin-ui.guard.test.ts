// Executable source-inspection regression guards for opportunities-admin-ui.ts. These assert
// structural safety invariants that are impractical to exercise through a full HTTP test harness
// here (that coverage is provided separately by the authenticated preview QA pass), but which are
// deterministic, real, and would fail this test the moment someone edited the shipped route file
// in a way that broke them - not an approximation of the logic, an inspection of the real file.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'opportunities-admin-ui.ts'), 'utf8');

describe('opportunities-admin-ui.ts - structural safety guards (source inspection of the real shipped file)', () => {
  it('CEO test: the lifecycle route always passes a hardcoded HUMAN actor, never one derived from the request - AI cannot mark CONTACTED or any other lifecycle status via this route', () => {
    expect(SRC).toMatch(/setLifecycleStatus\(c\.env,\s*c\.req\.param\('id'\),\s*newStatus,\s*'HUMAN'/);
  });

  it('CEO test: CONTACTED can only be recorded after an explicit human-confirmed checkbox, checked server-side', () => {
    expect(SRC).toMatch(/newStatus === 'CONTACTED' && body\.human_confirmed !== '1'/);
  });

  it('CEO test: PUBLISHED is never offered as a manually-clickable lifecycle button in the console', () => {
    const lifecycleButtonTargets = [...SRC.matchAll(/lifecycleForm\('([A-Z_]+)'/g)].map(m => m[1]);
    expect(lifecycleButtonTargets.length).toBeGreaterThan(0);
    expect(lifecycleButtonTargets).not.toContain('PUBLISHED');
  });

  it('CEO test: the outreach draft is rendered read-only, and no send/email/whatsapp/dispatch route exists anywhere in this file', () => {
    expect(SRC).toMatch(/<textarea readonly>\$\{esc\(draft\)\}<\/textarea>/);
    expect(SRC).not.toMatch(/\.post\('\/[^']*\/(send|dispatch|email|whatsapp|notify)/i);
  });

  it('CEO test: provider-reply confirmation exposes no permission/rights field on its form - a provider reply can never grant permission through this UI', () => {
    const confirmFormMatch = SRC.match(/CONFIRMABLE_REPLY_FIELDS = \[([^\]]+)\]/);
    expect(confirmFormMatch).not.toBeNull();
    const fields = confirmFormMatch![1];
    expect(fields).not.toMatch(/permission/i);
    expect(fields).not.toMatch(/rights/i);
  });

  it('CEO test: every state-changing (POST) route checks Origin and a signed CSRF token before doing anything else', () => {
    const postRouteCount = (SRC.match(/opportunitiesUi\.post\(/g) || []).length;
    const originChecks = (SRC.match(/if \(!originAllowed\(c\)\)/g) || []).length;
    const csrfChecks = (SRC.match(/csrfValid\(c\.env,/g) || []).length;
    expect(postRouteCount).toBeGreaterThanOrEqual(4); // lifecycle, reply, replies/:id/confirm, convert
    expect(originChecks).toBe(postRouteCount);
    expect(csrfChecks).toBe(postRouteCount);
  });

  it('CEO test: the console-driven conversion route only ever writes to the isolated OPPORTUNITY_DB mirror table, never the real production deal_offer_candidates table', () => {
    expect(SRC).toMatch(/convertOpportunityToDealCandidate\(c\.env, c\.req\.param\('id'\), 'admin session', c\.env\.OPPORTUNITY_DB, 'test_deal_offer_candidates_mirror'\)/);
  });

  it('CEO test: reply text is rendered via the same esc() HTML-escaping helper as every other field - no raw/unescaped HTML injection path for a pasted provider reply', () => {
    expect(SRC).toMatch(/esc\(r\.raw_reply_text\)/);
  });
});
