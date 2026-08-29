import { describe, it, expect } from 'vitest';
import {
  sanitizeDiscoveredCandidate, type SearchDiscoveryProvider, type SitemapDiscoveryProvider,
  type HumanSubmissionDiscoveryProvider, type DiscoveredCandidateUrl,
} from '../discovery-providers';

describe('sanitizeDiscoveredCandidate', () => {
  it('copies only url/discoveredVia and hard-codes authority to DISCOVERY_ONLY', () => {
    const out = sanitizeDiscoveredCandidate({ url: 'https://example.com/deals', discoveredVia: 'search' });
    expect(out).toEqual({ url: 'https://example.com/deals', discoveredVia: 'search', authority: 'DISCOVERY_ONLY' });
  });

  it('strips a smuggled fact field - a misbehaving provider cannot make search results authoritative', () => {
    const malicious: any = { url: 'https://example.com/deals', discoveredVia: 'search', price: '$1', currency: 'FJD', authority: 'AUTHORITATIVE' };
    const out = sanitizeDiscoveredCandidate(malicious) as any;
    expect(out.price).toBeUndefined();
    expect(out.currency).toBeUndefined();
    expect(out.authority).toBe('DISCOVERY_ONLY'); // caller-supplied 'AUTHORITATIVE' is ignored, never trusted
    expect(Object.keys(out).sort()).toEqual(['authority', 'discoveredVia', 'url']);
  });

  it('defaults discoveredVia to "unknown" rather than throwing when absent', () => {
    const out = sanitizeDiscoveredCandidate({ url: 'https://example.com/x' });
    expect(out.discoveredVia).toBe('unknown');
  });
});

describe('discovery provider interfaces are structurally discovery-only', () => {
  it('a fake SearchDiscoveryProvider can only return DiscoveredCandidateUrl shapes when routed through the sanitizer', async () => {
    const fakeSearch: SearchDiscoveryProvider = {
      name: 'fake-search',
      async discover(input) {
        // Simulates a search API that returns rich snippets including a price - the provider
        // implementation itself must sanitize before returning, per the interface's contract.
        const rawResults = [{ url: 'https://provider.example/deal-1', snippetPrice: '$99' }];
        return rawResults.map(r => sanitizeDiscoveredCandidate({ url: r.url, discoveredVia: 'fake-search' }));
      },
    };
    const results: DiscoveredCandidateUrl[] = await fakeSearch.discover({ query: 'fiji deals' });
    expect(results).toHaveLength(1);
    expect(results[0].authority).toBe('DISCOVERY_ONLY');
    expect((results[0] as any).snippetPrice).toBeUndefined();
  });

  it('HumanSubmissionDiscoveryProvider output is equally discovery-only - being human-submitted does not bypass authority', async () => {
    const fakeHuman: HumanSubmissionDiscoveryProvider = {
      name: 'fake-human-submission',
      async discover(input) {
        return [sanitizeDiscoveredCandidate({ url: input.submittedUrl, discoveredVia: `human:${input.submittedByActorId}` })];
      },
    };
    const results = await fakeHuman.discover({ submittedUrl: 'https://provider.example/x', submittedByActorId: 'ceo-1' });
    expect(results[0].authority).toBe('DISCOVERY_ONLY');
  });

  it('SitemapDiscoveryProvider fits the same generic shape with its own input type', async () => {
    const fakeSitemap: SitemapDiscoveryProvider = {
      name: 'fake-sitemap',
      async discover(input) {
        return [sanitizeDiscoveredCandidate({ url: 'https://provider.example/from-sitemap', discoveredVia: input.sitemapUrl })];
      },
    };
    const results = await fakeSitemap.discover({ sitemapUrl: 'https://provider.example/sitemap.xml' });
    expect(results[0].discoveredVia).toBe('https://provider.example/sitemap.xml');
  });
});
