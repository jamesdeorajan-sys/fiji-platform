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

// Read-only by design (Pilot 6A). No write/mutation endpoint exists in this file, and none is
// authorized yet - seeding and any future writes happen outside application code (direct D1)
// until a governed write path is explicitly authorized, matching how Stage 1's own operators/
// products started. Stage 1's public marketplace routes never import or query this table.
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
