// Worker provisional: sirve los archivos de public/ directamente desde GitHub (rama en REF).
// Cada push a esa rama se publica solo (en ~1 minuto por la caché).
// Cuando se conecte Workers Builds con wrangler.jsonc, este archivo deja de usarse.
const TYPES = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    let path = decodeURIComponent(url.pathname);
    if (path.includes('..')) return new Response('Bad request', { status: 400 });
    if (path.endsWith('/')) path += 'index.html';
    let ext = (path.split('/').pop().split('.')[1] || '').toLowerCase();
    if (!ext) { path = '/index.html'; ext = 'html'; }  // rutas de la app → index.html

    const cache = caches.default;
    const key = new Request(`https://cache.local/${env.REF}${path}`);
    let res = await cache.match(key);
    if (!res) {
      const upstream = await fetch(`https://raw.githubusercontent.com/${env.REPO}/${env.REF}/public${path}`, { cf: { cacheTtl: 60 } });
      if (!upstream.ok) return new Response('No encontrado', { status: 404 });
      res = new Response(upstream.body, {
        headers: {
          'Content-Type': TYPES[ext] || 'application/octet-stream',
          'Cache-Control': ext === 'html' || path === '/sw.js' ? 'no-cache' : 'public, max-age=60',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Permissions-Policy': 'camera=(self), geolocation=(), microphone=()',
        },
      });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    return res;
  },
};
