# Stage 4: enable PostGIS on the local cluster, migrate, run tests. Stops at the first failure.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pgBin = if (Test-Path "$root\.local\pg18\bin\pg_ctl.exe") {
  "$root\.local\pg18\bin"
} else {
  "C:\Program Files\PostgreSQL\18\bin"
}
$pgData = "$root\.local\pgdata"
$py = "$root\backend\.venv\Scripts\python.exe"
$env:PATH = "$pgBin;$env:PATH"  # pure-Python psycopg loads libpq from PATH
$env:PGPASSWORD = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "marswalk_dev_password" }
$env:PATH = "$pgBin;$root\.local\pg18\lib;$env:PATH"
if (Test-Path "$root\.local\pg18\gdal-data") { $env:GDAL_DATA = "$root\.local\pg18\gdal-data" }
$proj = Get-ChildItem "$root\.local\pg18" -Recurse -Filter "proj.db" -EA SilentlyContinue | Select-Object -First 1
if ($proj) { $env:PROJ_LIB = $proj.DirectoryName }

function Step($name, [scriptblock]$cmd) {
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "$name failed (exit $LASTEXITCODE)" }
}

& "$pgBin\pg_isready.exe" -h 127.0.0.1 -p 5433 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Step "pg_ctl start" { & "$pgBin\pg_ctl.exe" -D $pgData -l "$root\.local\postgres-pg18.log" -o "-h 127.0.0.1 -p 5433" -w start }
}

Step "CREATE EXTENSION postgis" {
  & "$pgBin\psql.exe" -h 127.0.0.1 -p 5433 -U marswalk -d marswalk -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS postgis; SELECT PostGIS_Version();"
}

Set-Location "$root\backend"
Step "alembic upgrade" { & $py -m alembic upgrade head }
Step "pytest" { & $py -m pytest -v }
Write-Output "Stage 4 apply done."
