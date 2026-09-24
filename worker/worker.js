/**
 * NASA Data Proxy — Cloudflare Worker
 * -----------------------------------
 * Fixes CORS-blocked NASA data sources AND keeps your NASA API key off the client
 * for the Junior Astronaut Mission Trainer.
 *
 * WHY THIS EXISTS
 * (1) osdr.nasa.gov / visualization.osdr.nasa.gov (RadLab) don't send CORS headers,
 *     so browsers block fetch() calls to them no matter how the request is written.
 * (2) Any API key placed in index.html's JavaScript is visible to anyone who views
 *     source — there is no way to hide a secret in code the browser executes. The
 *     correct fix is to keep the real key server-side (as a Worker secret) and have
 *     the browser call your Worker, which attaches the key before forwarding to NASA.
 *
 * A tiny proxy that does both — fetches server-to-server (where CORS doesn't apply)
 * and injects the key server-side — solves both problems at once.
 *
 * WHAT IT PROXIES
 *   /health                                         -> worker status and route inventory
 *   /osdr-search?term=radiation&type=cgene&size=6   -> osdr.nasa.gov/osdr/data/search
 *   /radlab?spacecraft=ISS&instrument=REM&...       -> visualization.osdr.nasa.gov/radlab/api/
 *   /apod                                           -> api.nasa.gov/planetary/apod  (key injected)
 *   /donki-flr?startDate=...&endDate=...            -> api.nasa.gov/DONKI/FLR       (key injected)
 * Only these NASA hosts are reachable through this worker — it is not an open
 * proxy, so it's safe to deploy publicly. The client never sends or sees your key.
 *
 * DEPLOY (takes about 3 minutes)
 * 1. Go to https://dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker
 * 2. Give it a name (e.g. "nasa-data-proxy") and click Deploy
 * 3. Click "Edit code", delete the placeholder, paste this entire file, click Deploy
 * 4. Set your real NASA API key as a secret (do NOT put it in this file):
 *      - In the Worker's dashboard page: Settings -> Variables and Secrets
 *        -> Add -> name it NASA_API_KEY, type "Secret", paste your real key, Save
 *      - Or via CLI:  wrangler secret put NASA_API_KEY
 *    Get a free key (higher rate limit than DEMO_KEY) at https://api.nasa.gov/
 * 5. Copy the worker's URL (looks like https://nasa-data-proxy.YOUR-SUBDOMAIN.workers.dev)
 * 6. In junior-astronaut-mission-trainer.html, set:
 *      const NASA_PROXY_BASE = 'https://nasa-data-proxy.YOUR-SUBDOMAIN.workers.dev';
 *    (Paste your worker's real URL there, no trailing slash.) The game will then
 *    route ALL NASA calls through your worker — no key of any kind lives in the HTML.
 *
 * If you skip step 4, the worker falls back to NASA's shared DEMO_KEY automatically —
 * it'll work, just with a lower shared rate limit (30/hr, 50/day).
 */

const ALLOWED_ORIGIN = '*'; // tighten to your game's domain if you want, e.g. 'https://www.webhtml5.info'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function proxyJson(targetUrl) {
  try {
    const upstreamResponse = await fetch(targetUrl, { headers: { 'Accept': 'application/json' } });
    const body = await upstreamResponse.text();
    return new Response(body, {
      status: upstreamResponse.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'public, max-age=300', // cache 5 min to be gentle on NASA's servers
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Upstream NASA request failed', detail: String(err) }),
      { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Your real key, read from the Worker secret. Falls back to NASA's public
    // DEMO_KEY if you haven't set one yet, so the worker still works out of the box.
    const apiKey = (env && env.NASA_API_KEY) ? env.NASA_API_KEY : 'DEMO_KEY';

    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          ok: true,
          service: 'nasa-data-proxy',
          version: '1.1.0',
          timestamp: new Date().toISOString(),
          routes: ['/health', '/apod', '/donki-flr', '/osdr-search', '/radlab'],
        }),
        {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        }
      );

    } else if (url.pathname === '/osdr-search') {
      const upstream = new URL('https://osdr.nasa.gov/osdr/data/search');
      upstream.search = url.search; // forward term, type, size, from, etc. as-is
      return proxyJson(upstream.toString());

    } else if (url.pathname === '/radlab') {
      if (!url.search) {
        return new Response(
          JSON.stringify({
            error: 'RadLab requires query parameters specifying filters and data columns.',
            usage: '/radlab?spacecraft=ISS&instrument=REM&timestamp&absorbed_dose_rate&format=json',
            example: `${url.origin}/radlab?spacecraft=ISS&instrument=REM&timestamp%3E=2019-12-05&timestamp%3C2019-12-06&absorbed_dose_rate&instrument_family&module&format=json`,
          }),
          {
            status: 400,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
          }
        );
      }

      const upstream = new URL('https://visualization.osdr.nasa.gov/radlab/api/');
      upstream.search = url.search; // forward spacecraft, instrument, timestamp filters, etc.
      return proxyJson(upstream.toString());

    } else if (url.pathname === '/apod') {
      const upstream = new URL('https://api.nasa.gov/planetary/apod');
      upstream.searchParams.set('api_key', apiKey);
      return proxyJson(upstream.toString());

    } else if (url.pathname === '/donki-flr') {
      const upstream = new URL('https://api.nasa.gov/DONKI/FLR');
      upstream.search = url.search; // forward startDate, endDate
      upstream.searchParams.set('api_key', apiKey);
      return proxyJson(upstream.toString());

    } else {
      return new Response(
        JSON.stringify({ error: 'Unknown route. Use /osdr-search, /radlab, /apod, or /donki-flr.' }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }
  },
};
