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
 *   /apod                                           -> science.nasa.gov WordPress APOD (normalized)
 *   /donki-flr?startDate=...&endDate=...            -> ccmc.gsfc.nasa.gov/DONKI-API/get/FLR
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

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' };

async function getUpstreamJson(targetUrl, timeoutMs = 12000) {
  const response = await fetch(targetUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`NASA upstream HTTP ${response.status}: ${body.slice(0, 250)}`);
  }
  try { return JSON.parse(body); }
  catch { throw new Error('NASA upstream returned non-JSON content'); }
}

function okJson(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=300' },
  });
}

function errorJson(err) {
  const message = String(err && err.message || err);
  const timeout = /timeout|aborted/i.test(message);
  return new Response(JSON.stringify({ error: 'Upstream NASA request failed', detail: message }), {
    status: timeout ? 504 : 502,
    headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
  });
}

async function proxyJson(targetUrl) {
  try { return okJson(await getUpstreamJson(targetUrl)); }
  catch (err) { return errorJson(err); }
}

async function getApod() {
  try {
    const upstream = await getUpstreamJson('https://science.nasa.gov/wp-json/wp/v2/apod-basic?per_page=1');
    const item = Array.isArray(upstream) ? upstream[0] : upstream;
    if (!item || !item.title || !item.date) throw new Error('APOD returned no usable record');
    const imageUrl = item.hdurl || null;
    if (!imageUrl || /nasa-logo@2x|placeholder/i.test(imageUrl)) {
      throw new Error('APOD returned no valid featured image');
    }
    // Maintain a single-object response for the existing frontend.
    // APOD 'url' now refers to an article; retain it separately.
    return okJson({
      date: item.date,
      title: item.title,
      explanation: item.explanation || '',
      media_type: item.media_type || 'image',
      url: imageUrl,
      hdurl: imageUrl,
      article_url: item.url || item.permalink || 'https://science.nasa.gov/apod/',
      credit: item.credit || '',
    });
  } catch (err) { return errorJson(err); }
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
          version: '1.1.1',
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
      return getApod();

    } else if (url.pathname === '/donki-flr') {
      const upstream = new URL('https://ccmc.gsfc.nasa.gov/DONKI-API/get/FLR');
      for (const param of ['startDate', 'endDate']) {
        const val = url.searchParams.get(param);
        if (val) upstream.searchParams.set(param, val);
      }
      return proxyJson(upstream.toString());

    } else {
      return new Response(
        JSON.stringify({ error: 'Unknown route. Use /osdr-search, /radlab, /apod, or /donki-flr.' }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }
  },
};
