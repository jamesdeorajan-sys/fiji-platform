import { ApiError } from './errors.js';
import { D1BookingRepository } from './repositories.js';
import { BookingService } from './service.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

async function body(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
}

function context(request) {
  const actorId = request.headers.get('x-actor-id');
  const actorType = request.headers.get('x-actor-type');
  const purpose = request.headers.get('x-purpose');
  if (!actorId || !actorType || !purpose) throw new ApiError(401, 'ACTOR_REQUIRED', 'Authenticated actor and purpose headers are required');
  return {
    actorId,
    actorType,
    purpose,
    correlationId: request.headers.get('x-correlation-id') || crypto.randomUUID(),
    idempotencyKey: request.headers.get('idempotency-key'),
  };
}

export default {
  async fetch(request, env) {
    const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
    try {
      if (!env.BOOKINGS_DB) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Booking database is unavailable');
      const repository = new D1BookingRepository(env.BOOKINGS_DB);
      const service = new BookingService(repository);
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, '') || '/';

      if (request.method === 'GET' && path === '/health') {
        return json({ status: (await repository.health()) ? 'ok' : 'unavailable' });
      }
      if (request.method === 'POST' && path === '/quotes') {
        const ctx = context(request);
        return json(await service.createQuote(await body(request), ctx), 201, { 'x-correlation-id': ctx.correlationId });
      }
      if (request.method === 'POST' && path === '/bookings') {
        const ctx = context(request);
        return json(await service.createBooking(await body(request), ctx), 201, { 'x-correlation-id': ctx.correlationId });
      }
      const match = path.match(/^\/bookings\/([^/]+)(\/cancel)?$/);
      if (match && request.method === 'GET' && !match[2]) {
        const ctx = context(request);
        return json(await service.getBooking(decodeURIComponent(match[1])), 200, { 'x-correlation-id': ctx.correlationId });
      }
      if (match && request.method === 'POST' && match[2]) {
        const ctx = context(request);
        return json(await service.cancelBooking(decodeURIComponent(match[1]), await body(request), ctx), 200, { 'x-correlation-id': ctx.correlationId });
      }
      return json({ error: { code: 'NOT_FOUND', message: 'Route not found' }, correlation_id: correlationId }, 404);
    } catch (error) {
      const known = error instanceof ApiError;
      return json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Internal error', ...(known && error.details ? { details: error.details } : {}) }, correlation_id: correlationId }, known ? error.status : 500);
    }
  },
};
