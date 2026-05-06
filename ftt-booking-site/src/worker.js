export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Serve static assets from KV or inline
    const MIME = {
      '.html': 'text/html; charset=utf-8',
      '.css':  'text/css; charset=utf-8',
      '.js':   'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.ico':  'image/x-icon',
      '.png':  'image/png',
      '.svg':  'image/svg+xml',
    };

    // Simple booking API endpoint
    if (path === '/api/booking' && request.method === 'POST') {
      try {
        const body = await request.json();
        // In production: save to D1 database or send via email/webhook
        const ref = 'FTT-' + Date.now().toString(36).toUpperCase().slice(-6);
        return new Response(JSON.stringify({ success: true, ref }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
      }
    }

    // Serve index for all non-asset routes (SPA behaviour)
    return new Response('Not found', { status: 404 });
  }
};
