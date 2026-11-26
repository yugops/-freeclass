# Run once against the freeclass database as superuser (postgres)
# Usage:
#   $env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/freeclass"
#   .\db\setup.ps1

param(
    [string]$DatabaseUrl = $env:DATABASE_URL
)

if (-not $DatabaseUrl) {
    Write-Error "DATABASE_URL is not set. Example: `$env:DATABASE_URL = 'postgresql://postgres:password@localhost:5432/freeclass'"
    exit 1
}

$scriptDir = $PSScriptRoot

Write-Host "Running 01_schema.sql..."
psql $DatabaseUrl -v ON_ERROR_STOP=1 -q -f "$scriptDir\01_schema.sql"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Running 03_logic.sql..."
psql $DatabaseUrl -v ON_ERROR_STOP=1 -q -f "$scriptDir\03_logic.sql"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Running 04_seed.sql..."
psql $DatabaseUrl -v ON_ERROR_STOP=1 -q -f "$scriptDir\04_seed.sql"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Running 05_checkin.sql..."
psql $DatabaseUrl -v ON_ERROR_STOP=1 -q -f "$scriptDir\05_checkin.sql"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Database setup completed successfully."
