# Stage 5: acquire the real NASA/USGS data, one source after another in the Stage 5.2 order.
# Needs the network and a migrated database; stops at the first failure. Safe to run again.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:PATH = "C:\Program Files\PostgreSQL\18\bin;$env:PATH"  # pure-Python psycopg loads libpq from PATH
Set-Location "$root\backend"
foreach ($source in "trek", "mola", "ctx_dtm", "perseverance", "meda") {
  & ".\.venv\Scripts\python.exe" -m "app.integrations.$source"
  if ($LASTEXITCODE -ne 0) { throw "$source failed (exit $LASTEXITCODE)" }
}
Write-Output "Stage 5 ingestion done."
