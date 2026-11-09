# Junior Astronaut Mission Trainer — API compatibility patch v1.1.1

Based on the original repository ZIP (September 24, 2026).

## Changes
- Cloudflare Worker `/apod` uses NASA's current WordPress APOD API, returns one object, and preserves `url` as image URL for backward compatibility. Adds `article_url` for the NASA article.
- `/donki-flr` uses NASA CCMC's working `DONKI-API/get/FLR` endpoint and retains the array response.
- 12-second upstream request timeout; diagnostic errors return 502/504 instead of hanging indefinitely.
- Frontend checks HTTP status, sends APOD link to the article, and avoids presenting flare counts as an astronaut dose/risk measurement.
- Other Worker routes intentionally unchanged in their upstream destinations.

## Deploy cautiously
1. Back up the currently deployed Worker v1.1.0 and current GitHub Pages `index.html`.
2. Deploy `worker/worker.js` first (Cloudflare dashboard or Wrangler). Existing secret `NASA_API_KEY` may remain, although these two migrated endpoints don't require it.
3. Run the PowerShell checks below. Verify `/health` says 1.1.1, `/apod` returns a real image and `article_url`, and `/donki-flr` returns an array.
4. Only after Worker success, publish the revised `index.html` to the GitHub Pages repository and reload bypassing cache.
5. Check the app's NASA Data view, plus OSDR and RadLab behavior. Roll back if any route regresses.

## PowerShell smoke test
```powershell
$Base = 'https://nasa-data-proxy.mikegyver.workers.dev'
Invoke-RestMethod "$Base/health" | ConvertTo-Json -Depth 4
$apod = Invoke-RestMethod "$Base/apod" -TimeoutSec 20
$apod | Select-Object date,title,media_type,url,article_url | Format-List
$end = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$start = (Get-Date).ToUniversalTime().AddDays(-7).ToString('yyyy-MM-dd')
$flares = @(Invoke-RestMethod "$Base/donki-flr?startDate=$start&endDate=$end" -TimeoutSec 20)
"DONKI records: $($flares.Count)"
$flares | Select-Object -First 3 classType,peakTime,sourceLocation | Format-Table
```

**Status:** Prepared locally; not deployed or live-tested from this package.
