# PowerShell Test Suite

Use these checks after deploying the Cloudflare Worker or whenever you want to verify the NASA proxy.

## Requirements

- PowerShell 7 or newer
- Internet access
- Deployed Worker at `https://nasa-data-proxy.mikegyver.workers.dev`

Start by defining the Worker URL:

```powershell
$WorkerBase = "https://nasa-data-proxy.mikegyver.workers.dev"
```

## 1. Basic health check

```powershell
Invoke-RestMethod "$WorkerBase/health"
```

Expected values include:

```text
ok      : True
service : nasa-data-proxy
version : 1.1.0
routes  : {/health, /apod, /donki-flr, /osdr-search, /radlab}
```

## 2. Assert the health response

This test stops with an error if the service identity, status, or required routes are incorrect.

```powershell
$Health = Invoke-RestMethod "$WorkerBase/health"

if ($Health.ok -ne $true) {
    throw "Health check failed: ok was not true."
}

if ($Health.service -ne "nasa-data-proxy") {
    throw "Health check failed: unexpected service '$($Health.service)'."
}

$RequiredRoutes = @("/health", "/apod", "/donki-flr", "/osdr-search", "/radlab")
$MissingRoutes = $RequiredRoutes | Where-Object { $_ -notin $Health.routes }

if ($MissingRoutes) {
    throw "Health check failed: missing routes $($MissingRoutes -join ', ')."
}

Write-Host "PASS: Worker health is OK (version $($Health.version))." -ForegroundColor Green
```

## 3. Verify HTTP status and no-cache headers

```powershell
$HealthResponse = Invoke-WebRequest "$WorkerBase/health"

if ($HealthResponse.StatusCode -ne 200) {
    throw "Expected HTTP 200; received $($HealthResponse.StatusCode)."
}

if ($HealthResponse.Headers["Cache-Control"] -notcontains "no-store") {
    throw "Expected Cache-Control: no-store."
}

Write-Host "PASS: /health returned HTTP 200 with no-store caching." -ForegroundColor Green
```

## 4. Verify the friendly RadLab validation error

A bare RadLab request is intentionally invalid. The Worker should return HTTP 400 with usage guidance instead of forwarding NASA's HTTP 500 response.

```powershell
$RadLabErrorResponse = Invoke-WebRequest "$WorkerBase/radlab" -SkipHttpErrorCheck
$RadLabError = $RadLabErrorResponse.Content | ConvertFrom-Json

if ($RadLabErrorResponse.StatusCode -ne 400) {
    throw "Expected HTTP 400; received $($RadLabErrorResponse.StatusCode)."
}

if (-not $RadLabError.usage -or -not $RadLabError.example) {
    throw "RadLab error response did not include usage and example fields."
}

Write-Host "PASS: Bare /radlab returned helpful HTTP 400 guidance." -ForegroundColor Green
```

## 5. Verify a valid RadLab request

This retrieves REM radiation readings from the ISS for December 5, 2019.

```powershell
$RadLabUrl = "$WorkerBase/radlab?spacecraft=ISS&instrument=REM&timestamp%3E=2019-12-05&timestamp%3C2019-12-06&absorbed_dose_rate&instrument_family&module&format=json"
$RadLab = Invoke-RestMethod $RadLabUrl

if ("absorbed_dose_rate" -notin $RadLab.columns) {
    throw "RadLab response is missing the absorbed_dose_rate column."
}

if ($RadLab.data.Count -lt 1) {
    throw "RadLab returned no data rows."
}

Write-Host "PASS: RadLab returned $($RadLab.data.Count) radiation records." -ForegroundColor Green
```

## 6. Smoke-test the remaining routes

### Astronomy Picture of the Day

```powershell
$Apod = Invoke-RestMethod "$WorkerBase/apod"

if (-not $Apod.date -or -not $Apod.title) {
    throw "APOD response is missing its date or title."
}

Write-Host "PASS: APOD returned '$($Apod.title)' for $($Apod.date)." -ForegroundColor Green
```

### DONKI solar-flare data

```powershell
$EndDate = Get-Date
$StartDate = $EndDate.AddDays(-7)
$DonkiUrl = "$WorkerBase/donki-flr?startDate=$($StartDate.ToString('yyyy-MM-dd'))&endDate=$($EndDate.ToString('yyyy-MM-dd'))"
$Flares = @(Invoke-RestMethod $DonkiUrl)

Write-Host "PASS: DONKI returned $($Flares.Count) solar-flare records for the last seven days." -ForegroundColor Green
```

### OSDR search

```powershell
$Osdr = Invoke-RestMethod "$WorkerBase/osdr-search?term=radiation&type=cgene&size=1"

if ($null -eq $Osdr) {
    throw "OSDR search returned no response."
}

Write-Host "PASS: OSDR search responded successfully." -ForegroundColor Green
```

## 7. Confirm local Git synchronization

Run this from the repository root:

```powershell
Set-Location "E:\dev\junior-astronaut-mission-trainer"

git fetch origin
git pull --ff-only
git status --short
git rev-parse --short HEAD
git rev-parse --short origin/main
```

A synchronized repository reports `Already up to date.`, prints nothing for `git status --short`, and shows the same commit ID for `HEAD` and `origin/main`.

## Troubleshooting

- HTTP 400 from bare `/radlab` is expected and confirms that request validation is working.
- A valid RadLab request must specify filters and at least one data column.
- HTTP 502 usually means an upstream NASA service failed or returned a non-success status.
- If `Invoke-WebRequest -SkipHttpErrorCheck` is unavailable, install PowerShell 7 or test the bare RadLab response with `curl.exe`.
- Never put a NASA API key in these commands, `index.html`, or a committed file. Store it with `npx wrangler secret put NASA_API_KEY`.
