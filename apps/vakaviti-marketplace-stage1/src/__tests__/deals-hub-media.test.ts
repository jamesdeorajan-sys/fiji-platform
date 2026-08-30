// CEO AUTHORIZATION — IMPLEMENT MEDIA ACCURACY AND FALLBACK SYSTEM (2026-08-29/30), Phase 4.
import { describe, it, expect } from 'vitest';
import { dealMedia } from '../deals-hub';

describe('dealMedia', () => {
  it('APPROVED rights with a recorded image_url produces ENTITY_SPECIFIC', () => {
    const asset = dealMedia({ image_rights_status: 'APPROVED', image_url: 'https://provider.example/photo.jpg', category: 'ACCOMMODATION', proposed_offer_name: 'Resort special' });
    expect(asset.class).toBe('ENTITY_SPECIFIC');
    expect(asset.url).toBe('https://provider.example/photo.jpg');
  });

  it('APPROVED rights but NO recorded image_url does not fabricate a photo - falls to the category BRANDED_FALLBACK', () => {
    const asset = dealMedia({ image_rights_status: 'APPROVED', image_url: null, category: 'DINING', proposed_offer_name: 'Dinner special' });
    expect(asset.class).toBe('BRANDED_FALLBACK');
    expect(asset.fallbackCategory).toBe('dining');
  });

  it('NO_IMAGE rights status renders the category BRANDED_FALLBACK - publication is never blocked on a missing photo', () => {
    const asset = dealMedia({ image_rights_status: 'NO_IMAGE', image_url: null, category: 'CRUISE', proposed_offer_name: 'Day cruise' });
    expect(asset.class).toBe('BRANDED_FALLBACK');
    expect(asset.fallbackCategory).toBe('cruise_island');
  });

  it('DENIED rights status never uses image_url even if one happens to be present - denial always wins', () => {
    const asset = dealMedia({ image_rights_status: 'DENIED', image_url: 'https://provider.example/should-not-be-used.jpg', category: 'TRANSPORT', proposed_offer_name: 'Transfer deal' });
    expect(asset.class).toBe('BRANDED_FALLBACK');
    expect(asset.url).toBeNull();
  });

  it('every deal category maps to a sensible fallback; an unrecognised category defaults to general_operator', () => {
    expect(dealMedia({ image_rights_status: 'NO_IMAGE', category: 'ACTIVITY' }).fallbackCategory).toBe('tour_activity');
    expect(dealMedia({ image_rights_status: 'NO_IMAGE', category: 'EXPERIENCE' }).fallbackCategory).toBe('tour_activity');
    expect(dealMedia({ image_rights_status: 'NO_IMAGE', category: 'SOMETHING_UNKNOWN' }).fallbackCategory).toBe('general_operator');
  });
});
