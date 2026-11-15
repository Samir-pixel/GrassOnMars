$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
# Prefer local PG+PostGIS tree (.local/pg18); fall back to Program Files install
$pgBin = if (Test-Path "$root\.local\pg18\bin\pg_ctl.exe") {
  "$root\.local\pg18\bin"
} else {
  "C:\Program Files\PostgreSQL\18\bin"
}
$pgData = "$root\.local\pgdata"
if (Test-Path "$root\.local\pg18\gdal-data") { $env:GDAL_DATA = "$root\.local\pg18\gdal-data" }
$proj = Get-ChildItem "$root\.local\pg18" -Recurse -Filter "proj.db" -EA SilentlyContinue | Select-Object -First 1
if ($proj) { $env:PROJ_LIB = $proj.DirectoryName }
$pathPrefix = $pgBin
if (Test-Path "$root\.local\pg18\lib") { $pathPrefix = "$pgBin;$root\.local\pg18\lib" }

if (Test-Path "$pgBin\pg_ctl.exe") {
  $env:PATH = "$pathPrefix;$env:PATH"
  & "$pgBin\pg_isready.exe" -h 127.0.0.1 -p 5433 | Out-Null
  if ($LASTEXITCODE -ne 0 -and (Test-Path "$pgData\PG_VERSION")) {
    & "$pgBin\pg_ctl.exe" -D $pgData -l "$root\.local\postgres-pg18.log" -o "-h 127.0.0.1 -p 5433" start
  }
}

Set-Location "$root\backend"
& "$root\backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
