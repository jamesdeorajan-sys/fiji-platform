import { Hono } from 'hono';

type Bindings = { DB: D1Database; ADMIN_TOKEN?: string };
export const places = new Hono<{ Bindings: Bindings }>();

const requireAdmin = async (c: any, next: any) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: 'ADMIN_TOKEN not configured' }, 503);
  const supplied = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (supplied !== expected) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

places.use('*', requireAdmin);

const CLAIM_TYPES = ['IDENTITY', 'CANONICAL_NAME', 'PLACE_TYPE', 'PARENT', 'COORDINATES', 'ALIAS', 'RELATIONSHIP'];
const ALIAS_TYPES = ['FORMAL', 'COMMON', 'ALTERNATE', 'CODE', 'LEGACY', 'DEPRECATED'];

const normalizeAlias = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// Admin-only, read-only by design for the base place record (Pilot 6A). No endpoint here can
// ever mutate a plc_* id, place_type, canonical_name, slug, or parent_place_id - that remains
// out of scope until a governed write path for the base record itself is explicitly authorized.
// Stage 1's public marketplace routes never import or query this table.
places.get('/', async c => {
  const placeType = c.req.query('place_type');
  const parentId = c.req.query('parent_place_id');
  let sql = `SELECT * FROM places WHERE 1=1`;
  const params: any[] = [];
  if (placeType) { sql += ` AND place_type=?`; params.push(placeType); }
  if (parentId) { sql += ` AND parent_place_id=?`; params.push(parentId); }
  sql += ` ORDER BY canonical_name LIMIT 200`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all<any>();
  return c.json({ results: rows.results || [] });
});

places.get('/:id', async c => {
  const id = c.req.param('id');
  const place = await c.env.DB.prepare(`SELECT * FROM places WHERE id=?`).bind(id).first<any>();
  if (!place) return c.json({ error: 'not_found' }, 404);
  const children = await c.env.DB.prepare(`SELECT id,canonical_name,slug,place_type FROM places WHERE parent_place_id=? ORDER BY canonical_name`).bind(id).all<any>();
  const relationships = await c.env.DB.prepare(`SELECT * FROM place_relationships WHERE from_place_id=? OR to_place_id=? ORDER BY created_at`).bind(id, id).all<any>();
  return c.json({ place, children: children.results || [], relationships: relationships.results || [] });
});

// --- Pilot 6B: fact-level evidence, aliases, external identifier mappings -------------------
//
// CEO LAW (Pilot 6B): canonical ID != verified fact != alias != external ID != relationship !=
// publication. These endpoints only ever append rows to place_evidence / place_aliases /
// place_external_mappings. None of them can touch places.status, places.place_type,
// places.parent_place_id, or places.id - there is no code path here that writes to the
// `places` table at all. Evidence is append-only: nothing here sets evidence_status to
// VERIFIED (that is a human-only future decision, exactly like operator/product verification -
// see EVIDENCE-AND-PROMOTION-GOVERNANCE.md). AI may call these endpoints to propose evidence in
// a future pilot; it may never verify it, and no such AI wiring exists yet.

places.get('/:id/evidence', async c => {
  const id = c.req.param('id');
  const place = await c.env.DB.prepare(`SELECT id FROM places WHERE id=?`).bind(id).first<any>();
  if (!place) return c.json({ error: 'not_found' }, 404);
  const rows = await c.env.DB.prepare(`SELECT * FROM place_evidence WHERE place_id=? ORDER BY created_at`).bind(id).all<any>();
  return c.json({ results: rows.results || [] });
});

places.post('/:id/evidence', async c => {
  const id = c.req.param('id');
  const place = await c.env.DB.prepare(`SELECT id FROM places WHERE id=?`).bind(id).first<any>();
  if (!place) return c.json({ error: 'not_found', detail: 'no such place_id' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const claimType = String(body.claim_type || '');
  const claimValue = String(body.claim_value || '');
  const sourceType = String(body.source_type || '');
  if (!CLAIM_TYPES.includes(claimType)) return c.json({ error: 'invalid_claim_type', allowed: CLAIM_TYPES }, 400);
  if (!claimValue) return c.json({ error: 'claim_value required' }, 400);
  if (!sourceType) return c.json({ error: 'source_type required' }, 400);

  const evidenceId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO place_evidence (id, place_id, claim_type, claim_value, source_type, source_url, confidence, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    evidenceId, id, claimType, claimValue, sourceType,
    body.source_url ? String(body.source_url) : null,
    body.confidence ? String(body.confidence) : null,
    body.observed_at ? String(body.observed_at) : null
  ).run();

  const row = await c.env.DB.prepare(`SELECT * FROM place_evidence WHERE id=?`).bind(evidenceId).first<any>();
  return c.json({ evidence: row }, 201);
});

places.get('/:id/aliases', async c => {
  const id = c.req.param('id');
  const place = await c.env.DB.prepare(`SELECT id FROM places WHERE id=?`).bind(id).first<any>();
  if (!place) return c.json({ error: 'not_found' }, 404);
  const rows = await c.env.DB.prepare(`SELECT * FROM place_aliases WHERE place_id=? ORDER BY created_at`).bind(id).all<any>();
  return c.json({ results: rows.results || [] });
});

// Aliases never create a second canonical place. This endpoint only ever inserts into
// place_aliases - it has no code path that can create, update, or reassign a `places` row.
places.post('/:id/aliases', async c => {
  const id = c.req.param('id');
  const place = await c.env.DB.prepare(`SELECT id FROM places WHERE id=?`).bind(id).first<any>();
  if (!place) return c.json({ error: 'not_found', detail: 'no such place_id' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const aliasText = String(body.alias_text || '').trim();
  const aliasType = String(body.alias_type || '');
  if (!aliasText) return c.json({ error: 'alias_text required' }, 400);
  if (!ALIAS_TYPES.includes(aliasType)) return c.json({ error: 'invalid_alias_type', allowed: ALIAS_TYPES }, 400);

  const normalized = normalizeAlias(aliasText);
  const existing = await c.env.DB.prepare(
    `SELECT id FROM place_aliases WHERE place_id=? AND normalized_alias=?`
  ).bind(id, normalized).first<any>();
  if (existing) return c.json({ error: 'duplicate_alias', existing_id: existing.id }, 409);

  const aliasId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO place_aliases (id, place_id, alias_text, normalized_alias, alias_type, source_type, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    aliasId, id, aliasText, normalized, aliasType,
    body.source_type ? String(body.source_type) : null,
    body.source_url ? String(body.source_url) : null
  ).run();

  const row = await c.env.DB.prepare(`SELECT * FROM place_aliases WHERE id=?`).bind(aliasId).first<any>();
  return c.json({ alias: row }, 201);
});

places.get('/:id/external-mappings', async c => {
  const id = c.req.param('id');
  const place = await c.env.DB.prepare(`SELECT id FROM places WHERE id=?`).bind(id).first<any>();
  if (!place) return c.json({ error: 'not_found' }, 404);
  const rows = await c.env.DB.prepare(`SELECT * FROM place_external_mappings WHERE place_id=? ORDER BY created_at`).bind(id).all<any>();
  return c.json({ results: rows.results || [] });
});

// External identifiers never replace or alias a canonical plc_* id - this only ever inserts a
// translation row into place_external_mappings, scoped to one existing place.
places.post('/:id/external-mappings', async c => {
  const id = c.req.param('id');
  const place = await c.env.DB.prepare(`SELECT id FROM places WHERE id=?`).bind(id).first<any>();
  if (!place) return c.json({ error: 'not_found', detail: 'no such place_id' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const system = String(body.system || '').trim();
  const externalId = String(body.external_id || '').trim();
  if (!system) return c.json({ error: 'system required' }, 400);
  if (!externalId) return c.json({ error: 'external_id required' }, 400);

  const mappingId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO place_external_mappings (id, place_id, system, external_type, external_id, external_slug, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    mappingId, id, system,
    body.external_type ? String(body.external_type) : null,
    externalId,
    body.external_slug ? String(body.external_slug) : null,
    body.source ? String(body.source) : null
  ).run();

  const row = await c.env.DB.prepare(`SELECT * FROM place_external_mappings WHERE id=?`).bind(mappingId).first<any>();
  return c.json({ mapping: row }, 201);
});
