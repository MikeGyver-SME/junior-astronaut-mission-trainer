# Junior Astronaut Mission Trainer

An interactive STEM mission-training experience created for the 2026 NASA International Space Apps Challenge. Young explorers establish a Moon or Mars outpost, complete a preflight readiness check, manage oxygen, power, and shielding, respond to mission events, and explore real NASA data.

## 🚀 Launch the Trainer

### [Launch the Junior Astronaut Mission Trainer →](https://mikegyver-sme.github.io/junior-astronaut-mission-trainer/)

No installation required—open the live mission trainer in any modern browser.

## Project contents

- `index.html` — application structure and mission logic
- `styles.css` — complete visual design layer, separated for independent UI work
- `worker/worker.js` — Cloudflare Worker proxy for NASA data services
- `worker/wrangler.toml` — Worker deployment configuration

## NASA data used

The application uses its companion Cloudflare Worker to access:

- NASA Astronomy Picture of the Day (APOD)
- NASA DONKI solar-flare data
- NASA Open Science Data Repository (OSDR) search
- NASA OSDR RadLab data support

The Worker keeps the optional `NASA_API_KEY` server-side and limits proxy traffic to designated NASA services. If no secret is configured, it falls back to NASA's public `DEMO_KEY`.

## Run the frontend locally

Keep `index.html` and `styles.css` together. You can open `index.html` directly, although serving the directory with a local static web server provides the most representative browser behavior.

The frontend currently calls:

```text
https://nasa-data-proxy.mikegyver.workers.dev
```

## Worker health

### [Check the live Worker health →](https://nasa-data-proxy.mikegyver.workers.dev/health)

The no-cache JSON response reports the service status, deployed API version, timestamp, and available routes.

```powershell
Invoke-RestMethod "https://nasa-data-proxy.mikegyver.workers.dev/health"
```

A healthy deployment returns HTTP `200` with `"ok": true`.

## Deploy the Cloudflare Worker

From the `worker` directory, deploy with Wrangler:

```powershell
npx wrangler deploy
```

To use a personal NASA API key, store it as a Worker secret—never place it in the source code:

```powershell
npx wrangler secret put NASA_API_KEY
```

If the deployed Worker URL changes, update `NASA_PROXY_BASE` in `index.html`.

## GitHub Pages

Because `index.html` and `styles.css` are in the repository root, the frontend is ready to publish from the root of the `main` branch using GitHub Pages.

## Security

Do not commit `.dev.vars`, `.env` files, API keys, Cloudflare tokens, or other credentials. The included `.gitignore` excludes common local secret and tool-state files.

## Attribution

This independent educational project uses publicly available NASA data and imagery. It is not an official NASA product, and inclusion of NASA data does not imply NASA endorsement.
