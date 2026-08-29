import { describe, it, expect } from 'vitest';
import { isPathAuthorized, isFieldAuthoritativeForFamily, isPageTypePermitted, type SourceFamily } from '../source-family-model';

function family(overrides: Partial<SourceFamily> = {}): SourceFamily {
  return {
    id: 'fam-1', legalProviderOrSellerIdentity: 'South Sea Cruises', approvedDomain: 'southseacruisesfiji.com',
    allowedPathPatterns: [], excludedPathPatterns: [], authoritativeFields: ['price', 'currency'],
    extractionProfile: 'STANDARD_HTML', currencyExpectations: ['FJD'], permittedPageTypes: ['OFFER_PAGE'],
    recheckScheduleHours: 24, rateLimitPerHour: 30, robotsAccessPolicy: 'ROBOTS_TXT_HONORED',
    approvalActorId: 'human-1', approvalActorType: 'HUMAN', approvalEvidenceUrl: null,
    approvedAt: '2026-08-29T00:00:00Z', ...overrides,
  };
}

describe('isPathAuthorized', () => {
  it('domain approval alone (empty allowedPathPatterns) authorizes NOTHING', () => {
    const f = family({ allowedPathPatterns: [] });
    expect(isPathAuthorized(f, '/anything').authorized).toBe(false);
    expect(isPathAuthorized(f, '/').authorized).toBe(false);
    expect(isPathAuthorized(f, '/deals/summer-special').authorized).toBe(false);
  });

  it('authorizes only paths matching an explicit allowed pattern', () => {
    const f = family({ allowedPathPatterns: ['/deals/*', '/specials'] });
    expect(isPathAuthorized(f, '/deals/summer-special').authorized).toBe(true);
    expect(isPathAuthorized(f, '/specials').authorized).toBe(true);
    expect(isPathAuthorized(f, '/account/login').authorized).toBe(false);
    expect(isPathAuthorized(f, '/admin/edit').authorized).toBe(false);
  });

  it('an excluded pattern always wins even when a broader allowed pattern would also match', () => {
    const f = family({ allowedPathPatterns: ['/*'], excludedPathPatterns: ['/admin/*', '/account/*'] });
    expect(isPathAuthorized(f, '/deals/x').authorized).toBe(true);
    expect(isPathAuthorized(f, '/admin/edit').authorized).toBe(false);
    expect(isPathAuthorized(f, '/account/settings').authorized).toBe(false);
  });

  it('a path that matches neither list is not authorized', () => {
    const f = family({ allowedPathPatterns: ['/deals/*'] });
    expect(isPathAuthorized(f, '/booking-engine/checkout').authorized).toBe(false);
  });
});

describe('isFieldAuthoritativeForFamily / isPageTypePermitted', () => {
  it('only lists fields/page types explicitly granted to the family', () => {
    const f = family({ authoritativeFields: ['price'], permittedPageTypes: ['OFFER_PAGE'] });
    expect(isFieldAuthoritativeForFamily(f, 'price')).toBe(true);
    expect(isFieldAuthoritativeForFamily(f, 'booking_route')).toBe(false);
    expect(isPageTypePermitted(f, 'OFFER_PAGE')).toBe(true);
    expect(isPageTypePermitted(f, 'BOOKING_ENGINE_PAGE')).toBe(false);
  });
});
